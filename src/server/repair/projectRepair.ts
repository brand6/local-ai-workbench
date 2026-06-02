import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AppConfig, ParserWarning, Project, ProjectRepairCandidate, ProjectRepairResult, SessionEntry } from "../../shared/types.js";
import { displayPath, isPathInsideOrEqual, isStrictChildPath, normalizeFsPath } from "../core/pathUtils.js";
import { confirmRelocation } from "../relocation/relocation.js";
import type { AppDatabase } from "../storage/database.js";

interface SourceSignals {
  slug: string;
  pathTokens: Set<string>;
  contentTokens: Set<string>;
  fileSignals: FileSignals;
}

interface RepairTarget {
  projectId: string;
  rootPath: string;
  sessions: SessionEntry[];
  parentRootPath: string | null;
}

interface FileSignals {
  relativePaths: Set<string>;
  fileNames: Set<string>;
}

const PROJECT_SIGNAL_FILES = ["README.md", "README.txt", "README", "project.godot", "package.json"];
const PROJECT_SIGNAL_READ_LIMIT = 24_000;
const SAME_DIRECTORY_NAME_SCORE = 1_000;
const FILE_TREE_LIMIT = 2_000;
const PATH_FIELD_NAMES = new Set([
  "file",
  "filename",
  "fileName",
  "filepath",
  "filePath",
  "file_path",
  "oldPath",
  "old_path",
  "newPath",
  "new_path",
  "path",
  "relativePath",
  "relative_path",
  "targetPath",
  "target_path"
]);
const EXCLUDED_FILE_SIGNAL_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor"
]);
const GENERIC_FILE_SIGNAL_NAMES = new Set([
  ".gitignore",
  "agents.md",
  "claude.md",
  "license",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "qwen.md",
  "readme",
  "readme.md",
  "readme.txt",
  "tsconfig.json",
  "yarn.lock"
]);

export function listProjectRepairCandidates(database: AppDatabase, projectId: string): ProjectRepairCandidate[] {
  const project = database.getProject(projectId);
  if (!project) return [];

  const sessions = database.listSessionsForProject(project);
  const warnings = database.listParserWarningsForProject(project);
  if (!hasRepairSignal(project, sessions, warnings)) return [];

  const sourceSignals: SourceSignals = {
    slug: slug(path.basename(project.rootPath)),
    pathTokens: keywords(path.basename(project.rootPath)),
    contentTokens: keywords(sessionText(sessions, readProjectSignalText(project.rootPath))),
    fileSignals: sourceFileSignals(project.rootPath, sessions)
  };

  return repairTargets(database, project)
    .map((target) => scoreCandidate(project, sourceSignals, target))
    .filter((candidate): candidate is ProjectRepairCandidate => Boolean(candidate))
    .sort((a, b) => b.score - a.score || b.sessionCount - a.sessionCount || a.rootPath.localeCompare(b.rootPath))
    .slice(0, 8);
}

export function confirmProjectRepair(
  database: AppDatabase,
  config: AppConfig,
  dataDir: string,
  sourceProjectId: string,
  targetProjectId: string,
  targetRootPath?: string | null
): ProjectRepairResult {
  const sourceProject = database.getProject(sourceProjectId);
  const targetProject = database.getProject(targetProjectId);
  if (!sourceProject) throw new Error("source-project-not-found");
  if (!targetProject) throw new Error("target-project-not-found");
  const targetRoot = displayPath(targetRootPath?.trim() || targetProject.rootPath);
  if (sourceProject.id === targetProject.id && normalizeFsPath(sourceProject.rootPath) === normalizeFsPath(targetRoot)) {
    throw new Error("repair-target-must-be-different");
  }
  if (!isPathInsideOrEqual(targetProject.rootPath, targetRoot)) throw new Error("repair-target-root-outside-project");
  if (!fs.existsSync(targetRoot)) throw new Error("repair-target-path-missing");

  const relocation = confirmRelocation(database, config, dataDir, sourceProject.rootPath, targetRoot);
  const mergedTargetId = relocation.projectMerges.find((merge) => merge.sourceProjectId === sourceProjectId)?.targetProjectId;

  return {
    sourceProjectId,
    targetProjectId: mergedTargetId ?? targetProjectId,
    targetRootPath: targetRoot,
    relocation
  };
}

function hasRepairSignal(project: Project, sessions: SessionEntry[], warnings: ParserWarning[]): boolean {
  if (!fs.existsSync(project.rootPath)) return true;
  if (sessions.some((session) => session.resumeStatus === "cwd_missing" || session.resumeStatus === "missing_cwd")) return true;
  return warnings.some((warning) => warning.errorType === "missing-cwd");
}

function repairTargets(database: AppDatabase, sourceProject: Project): RepairTarget[] {
  const targets: RepairTarget[] = [];
  const seen = new Set<string>();
  const projects = database.listProjects();

  for (const candidate of projects) {
    if (candidate.id === sourceProject.id || !fs.existsSync(candidate.rootPath)) continue;
    addTarget(targets, seen, {
      projectId: candidate.id,
      rootPath: candidate.rootPath,
      sessions: database.listSessionsForProject(candidate),
      parentRootPath: null
    });

    for (const child of childSessionTargets(database, candidate)) {
      if (normalizeFsPath(child.rootPath) === normalizeFsPath(sourceProject.rootPath)) continue;
      addTarget(targets, seen, child);
    }
  }

  return targets;
}

function childSessionTargets(database: AppDatabase, parentProject: Project): RepairTarget[] {
  const groups = new Map<string, { rootPath: string; sessions: SessionEntry[] }>();
  for (const session of database.listSessions()) {
    if (!session.normalizedCwd || !session.originalCwd) continue;
    if (!isDirectChildPath(parentProject.rootPath, session.originalCwd)) continue;
    if (!fs.existsSync(session.originalCwd)) continue;
    const normalized = normalizeFsPath(session.originalCwd);
    const existing = groups.get(normalized);
    groups.set(normalized, {
      rootPath: existing?.rootPath ?? displayPath(session.originalCwd),
      sessions: [...(existing?.sessions ?? []), session]
    });
  }

  return [...groups.values()].map((group) => ({
    projectId: parentProject.id,
    rootPath: group.rootPath,
    sessions: group.sessions,
    parentRootPath: parentProject.rootPath
  }));
}

function addTarget(targets: RepairTarget[], seen: Set<string>, target: RepairTarget): void {
  const key = `${target.projectId}:${normalizeFsPath(target.rootPath)}`;
  if (seen.has(key)) return;
  seen.add(key);
  targets.push(target);
}

function scoreCandidate(
  sourceProject: Project,
  sourceSignals: SourceSignals,
  candidate: RepairTarget
): ProjectRepairCandidate | null {
  const candidateSlug = slug(path.basename(candidate.rootPath));
  const candidatePathTokens = keywords(path.basename(candidate.rootPath));
  const candidateMetadataTokens = keywords(readProjectSignalText(candidate.rootPath));
  const candidateContentTokens = mergeTokenSets(keywords(sessionText(candidate.sessions)), candidateMetadataTokens);
  const candidateFileSignals = projectFileSignals(candidate.rootPath);
  const pathOverlap = overlap(sourceSignals.pathTokens, candidatePathTokens).slice(0, 4);
  const projectNameOverlap = overlap(sourceSignals.contentTokens, candidatePathTokens).slice(0, 4);
  const contentOverlap = overlap(sourceSignals.contentTokens, candidateContentTokens).slice(0, 6);
  const metadataNameOverlap = overlap(sourceSignals.contentTokens, candidateMetadataTokens).filter(isHanToken).slice(0, 4);
  const relativeFilePathOverlap = overlap(sourceSignals.fileSignals.relativePaths, candidateFileSignals.relativePaths).slice(0, 6);
  const fileNameOverlap = overlap(sourceSignals.fileSignals.fileNames, candidateFileSignals.fileNames).slice(0, 8);
  const sameName = Boolean(sourceSignals.slug && sourceSignals.slug === candidateSlug);
  const strongPathMatch = pathOverlap.length >= 2;
  const strongProjectNameMatch = projectNameOverlap.length > 0;
  const strongContentMatch = contentOverlap.length >= 2;
  const strongMetadataNameMatch = metadataNameOverlap.length >= 2;
  const strongFileMatch = relativeFilePathOverlap.length > 0 || fileNameOverlap.length > 0;

  if (!sameName && !strongPathMatch && !strongProjectNameMatch && !strongContentMatch && !strongMetadataNameMatch && !strongFileMatch) {
    return null;
  }

  const reasons: string[] = [];
  let score = 5;

  if (fs.existsSync(candidate.rootPath)) {
    reasons.push("目标路径存在");
  }

  if (candidate.parentRootPath) {
    score += 35;
    reasons.push(`父项目子目录：${path.basename(candidate.parentRootPath)}`);
  }

  if (sameName) {
    score += SAME_DIRECTORY_NAME_SCORE;
    reasons.push("目录名匹配");
  }

  if (pathOverlap.length > 0) {
    score += pathOverlap.length * 25;
    reasons.push(`目录关键词匹配：${pathOverlap.join("、")}`);
  }

  if (projectNameOverlap.length > 0) {
    score += projectNameOverlap.length * 45;
    reasons.push(`项目名关键词匹配：${projectNameOverlap.join("、")}`);
  }

  if (contentOverlap.length > 0) {
    score += contentOverlap.length * 25;
    reasons.push(`内容关键词匹配：${contentOverlap.join("、")}`);
  }

  if (metadataNameOverlap.length > 0) {
    score += metadataNameOverlap.length * 70;
    reasons.push(`项目元信息匹配：${metadataNameOverlap.join("、")}`);
  }

  if (relativeFilePathOverlap.length > 0) {
    score += relativeFilePathOverlap.length * 140;
    reasons.push(`项目内相对路径匹配：${relativeFilePathOverlap.join("、")}`);
  }

  if (fileNameOverlap.length > 0) {
    score += fileNameOverlap.length * 60;
    reasons.push(`文件名匹配：${fileNameOverlap.join("、")}`);
  }

  if (candidate.sessions.length > 0) {
    score += Math.min(candidate.sessions.length, 10);
    reasons.push(`${candidate.sessions.length} 个已索引会话`);
  }

  if (normalizeFsPath(sourceProject.rootPath) === normalizeFsPath(candidate.rootPath)) {
    return null;
  }

  return {
    projectId: candidate.projectId,
    rootPath: candidate.rootPath,
    ...(candidate.parentRootPath ? { targetRootPath: candidate.rootPath } : {}),
    score,
    reasons,
    sessionCount: candidate.sessions.length
  };
}

function isDirectChildPath(parentRootPath: string, candidatePath: string): boolean {
  if (!isStrictChildPath(parentRootPath, candidatePath)) return false;
  const relative = path.relative(displayPath(parentRootPath), displayPath(candidatePath));
  return relative.split(/[\\/]+/).filter(Boolean).length === 1;
}

function sourceFileSignals(sourceRootPath: string, sessions: SessionEntry[]): FileSignals {
  const signals = emptyFileSignals();
  const roots = uniqueDisplayPaths([sourceRootPath, ...sessions.flatMap((session) => (session.originalCwd ? [session.originalCwd] : []))]);
  collectOpencodeFileReferences(signals, roots, sessions);
  collectJsonlFileReferences(signals, roots, sessions);
  return signals;
}

function collectOpencodeFileReferences(signals: FileSignals, roots: string[], sessions: SessionEntry[]): void {
  const bySourceFile = new Map<string, string[]>();
  for (const session of sessions) {
    if (session.sourceFormat !== "opencode-sqlite" || !session.nativeSessionId) continue;
    bySourceFile.set(session.sourceFile, [...(bySourceFile.get(session.sourceFile) ?? []), session.nativeSessionId]);
  }

  for (const [sourceFile, ids] of bySourceFile) {
    if (!fs.existsSync(sourceFile) || ids.length === 0) continue;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(sourceFile, { readOnly: true });
      const selectedIds = [...new Set(ids)].slice(0, 80);
      const placeholders = selectedIds.map(() => "?").join(",");
      const rows = db.prepare(`SELECT data FROM part WHERE session_id IN (${placeholders})`).all(...selectedIds);
      for (const row of rows) {
        const raw = typeof row.data === "string" ? row.data : null;
        if (!raw) continue;
        try {
          collectPathFields(JSON.parse(raw), (value) => addFileReference(signals, roots, value));
        } catch {
          // Malformed historical tool part payloads should not block repair scoring.
        }
      }
    } catch {
      // Older OpenCode fixtures or databases may not have part-level tool data.
    } finally {
      db?.close();
    }
  }
}

function collectJsonlFileReferences(signals: FileSignals, roots: string[], sessions: SessionEntry[]): void {
  const sourceFiles = new Set(
    sessions
      .filter((session) => session.sourceFormat !== "opencode-sqlite")
      .map((session) => session.sourceFile)
  );

  for (const sourceFile of sourceFiles) {
    try {
      const content = fs.readFileSync(sourceFile, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          collectPathFields(JSON.parse(trimmed), (value) => addFileReference(signals, roots, value));
        } catch {
          // Malformed JSONL lines are reported by the parser; repair scoring can skip them.
        }
      }
    } catch {
      // Missing source files are already represented as parser warnings elsewhere.
    }
  }
}

function projectFileSignals(rootPath: string): FileSignals {
  const signals = emptyFileSignals();
  const root = displayPath(rootPath);
  const stack: string[] = [root];
  let scanned = 0;

  while (stack.length > 0 && scanned < FILE_TREE_LIMIT) {
    const current = stack.pop();
    if (!current) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_FILE_SIGNAL_DIRS.has(entry.name.toLowerCase())) stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, entryPath);
      addRelativeFileSignal(signals, relative);
      scanned += 1;
      if (scanned >= FILE_TREE_LIMIT) break;
    }
  }

  return signals;
}

function emptyFileSignals(): FileSignals {
  return { relativePaths: new Set(), fileNames: new Set() };
}

function collectPathFields(value: unknown, onPath: (value: string) => void, key: string | null = null): void {
  if (typeof value === "string") {
    if (key && PATH_FIELD_NAMES.has(key)) onPath(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPathFields(item, onPath, null);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    collectPathFields(childValue, onPath, childKey);
  }
}

function addFileReference(signals: FileSignals, roots: string[], input: string): void {
  const cleaned = cleanPathCandidate(input);
  if (!cleaned) return;

  if (path.isAbsolute(cleaned)) {
    for (const root of roots) {
      if (!isPathInsideOrEqual(root, cleaned) || normalizeFsPath(root) === normalizeFsPath(cleaned)) continue;
      addRelativeFileSignal(signals, path.relative(displayPath(root), displayPath(cleaned)));
      return;
    }
    return;
  }

  addRelativeFileSignal(signals, cleaned);
}

function addRelativeFileSignal(signals: FileSignals, input: string): void {
  const normalized = normalizeRelativeFilePath(input);
  if (!normalized) return;
  const fileName = path.posix.basename(normalized);
  if (!isMeaningfulFileName(fileName)) return;
  signals.relativePaths.add(normalized);
  signals.fileNames.add(fileName);
}

function normalizeRelativeFilePath(input: string): string | null {
  let value = input.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  value = path.posix.normalize(value);
  if (!value || value === "." || value.startsWith("../") || value === "..") return null;
  if (path.posix.isAbsolute(value) || /[*?<>|]/.test(value)) return null;
  const segments = value.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => EXCLUDED_FILE_SIGNAL_DIRS.has(segment.toLowerCase()))) return null;
  return segments.join("/").toLowerCase();
}

function cleanPathCandidate(input: string): string | null {
  const value = input.trim().replace(/^['"`]+|['"`]+$/g, "");
  if (!value || value.length > 260 || value.includes("\n") || /^[a-z]+:\/\//i.test(value)) return null;
  return value;
}

function isMeaningfulFileName(fileName: string): boolean {
  if (!fileName || GENERIC_FILE_SIGNAL_NAMES.has(fileName.toLowerCase())) return false;
  return fileName.length >= 3;
}

function uniqueDisplayPaths(values: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const display = displayPath(value);
    const normalized = normalizeFsPath(display);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    results.push(display);
  }
  return results;
}

function sessionText(sessions: SessionEntry[], extraText = ""): string {
  return [...sessions.flatMap((session) => [session.title, session.summary ?? ""]), extraText].join("\n");
}

function readProjectSignalText(rootPath: string): string {
  const chunks: string[] = [];
  for (const fileName of PROJECT_SIGNAL_FILES) {
    const filePath = path.join(rootPath, fileName);
    try {
      if (!fs.statSync(filePath).isFile()) continue;
      const handle = fs.openSync(filePath, "r");
      try {
        const buffer = Buffer.alloc(PROJECT_SIGNAL_READ_LIMIT);
        const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
        chunks.push(buffer.toString("utf8", 0, bytesRead));
      } finally {
        fs.closeSync(handle);
      }
    } catch {
      // Missing or unreadable metadata should not block repair candidate scoring.
    }
  }
  return chunks.join("\n");
}

function mergeTokenSets(...sets: Set<string>[]): Set<string> {
  return new Set(sets.flatMap((set) => [...set]));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function keywords(value: string): Set<string> {
  const results = new Set<string>();
  for (const match of value.toLowerCase().matchAll(/[a-z0-9][a-z0-9_-]{2,}/g)) {
    const token = match[0].replace(/^[-_]+|[-_]+$/g, "");
    addTokenWithAliases(results, token);
    for (const part of token.split(/[-_]+/)) {
      addTokenWithAliases(results, part);
    }
  }

  for (const match of value.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const text = match[0];
    for (let index = 0; index < text.length - 1; index += 1) {
      addTokenWithAliases(results, text.slice(index, index + 2));
    }
  }

  return results;
}

function overlap(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((token) => right.has(token));
}

function isHanToken(value: string): boolean {
  return /[\p{Script=Han}]/u.test(value);
}

function isMeaningfulToken(value: string): boolean {
  if (value.length < 3) return false;
  return !GENERIC_TOKENS.has(value);
}

function isMeaningfulHanToken(value: string): boolean {
  return value.length >= 2 && !GENERIC_TOKENS.has(value);
}

function addTokenWithAliases(results: Set<string>, token: string): void {
  if (!token) return;
  const meaningful = /[\p{Script=Han}]/u.test(token) ? isMeaningfulHanToken(token) : isMeaningfulToken(token);
  if (!meaningful) return;
  results.add(token);
  for (const alias of TOKEN_ALIASES[token] ?? []) {
    if (/[\p{Script=Han}]/u.test(alias) ? isMeaningfulHanToken(alias) : isMeaningfulToken(alias)) {
      results.add(alias);
    }
  }
}

const GENERIC_TOKENS = new Set([
  "做什",
  "agent",
  "analysis",
  "and",
  "apply",
  "art",
  "asset",
  "asset-apply",
  "asset-build",
  "brand",
  "build",
  "claude",
  "client",
  "clone",
  "code",
  "combat",
  "command",
  "commands",
  "config",
  "codex",
  "comfyui",
  "copilot",
  "cwd",
  "design",
  "dev",
  "disable",
  "docs",
  "file",
  "files",
  "format",
  "from",
  "game",
  "gdd",
  "git",
  "github",
  "godot",
  "interrupted",
  "init",
  "install",
  "installation",
  "json",
  "jsonl",
  "local",
  "lora",
  "main",
  "metadata",
  "meta",
  "mode",
  "model",
  "new",
  "none",
  "old",
  "opencode",
  "project",
  "projects",
  "plugin",
  "plugins",
  "qoder",
  "qwen",
  "request",
  "research",
  "recaps",
  "readme",
  "session",
  "sessions",
  "skill",
  "skills",
  "source",
  "status",
  "structure",
  "subagent",
  "subagents",
  "superpowers",
  "system",
  "task",
  "tools",
  "user",
  "users",
  "work",
  "working",
  "writing",
  "writing-skills",
  "一致",
  "一个",
  "个文",
  "中文",
  "什么",
  "人物",
  "任务",
  "中的",
  "会话",
  "可以",
  "协作",
  "分析",
  "初始",
  "开发",
  "创建",
  "内容",
  "修复",
  "文档",
  "文件",
  "构和",
  "规范",
  "没有",
  "独立",
  "项目",
  "目录",
  "探索",
  "自动",
  "小游",
  "是一",
  "结构",
  "技能",
  "代码",
  "测试",
  "这个",
  "更新",
  "立游",
  "游戏"
]);

const TOKEN_ALIASES: Record<string, string[]> = {
  academy: ["学院"],
  knight: ["骑士"],
  knights: ["骑士"],
  duel: ["对决"],
  duels: ["对决"],
  学院: ["academy"],
  骑士: ["knight"],
  对决: ["duel"]
};
