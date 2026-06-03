import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type {
  AppConfig,
  ProjectSkillTarget,
  SkillHubConfig,
  SkillHubDeletePreview,
  SkillHubImportConflict,
  SkillHubImportResult,
  SkillHubImportSkipped,
  SkillHubOpenTarget,
  SkillHubSkill,
  SkillHubSource,
  SkillHubSourceUpdatePreview,
  SkillHubUpdateCheckResult,
  SkillHubUpdateItem,
  LocalOpenResponse
} from "../../shared/types.js";
import type { AppDatabase } from "../storage/database.js";
import { nowIso } from "../core/time.js";
import { openLocalPath } from "../core/localFilesystem.js";
import { removeDirectoryLink } from "./links.js";

interface ImportOptions {
  overwrite?: boolean;
}

interface GitHubImportOptions extends ImportOptions {
  fixturePath?: string;
}

interface DiscoveredSkill {
  path: string;
  folderName: string;
  skillName: string | null;
  description: string | null;
  sourceRelativePath: string | null;
  libraryRelativePath: string;
  contentHash: string;
}

interface GitHubInput {
  owner: string;
  repo: string;
  repoKey: string;
  branch: string | null;
  inputPath: string | null;
  remoteUrl: string;
}

const DIRECT_SKILLS_SOURCE_ID = "skills";

export function resolveSkillHubConfig(config: AppConfig, dataDir: string): SkillHubConfig {
  const rootDir = config.skillhub.rootDir.trim() || path.join(dataDir, "skillhub");
  return { rootDir, libraryDir: path.join(rootDir, "library") };
}

export function ensureSkillHub(config: AppConfig, dataDir: string): SkillHubConfig {
  const resolved = resolveSkillHubConfig(config, dataDir);
  fs.mkdirSync(resolved.libraryDir, { recursive: true });
  return resolved;
}

export function listSkillHub(database: AppDatabase, config: AppConfig, dataDir: string, query = "") {
  const resolved = ensureSkillHub(config, dataDir);
  assignDirectLibrarySkillsSource(database, resolved.libraryDir);
  return {
    config: resolved,
    sources: database.listSkillHubSources(),
    skills: database.listSkillHubSkills(query)
  };
}

export function importLocalSkills(
  database: AppDatabase,
  config: AppConfig,
  dataDir: string,
  inputPath: string,
  options: ImportOptions = {}
): SkillHubImportResult {
  const resolved = ensureSkillHub(config, dataDir);
  const sourcePath = path.resolve(inputPath);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    throw new Error("导入路径必须是已存在的目录");
  }

  const { discoveries, skipped } = discoverLocalSkills(sourcePath, resolved.libraryDir);
  const source = usesDirectSkillsSource(discoveries)
    ? upsertDirectSkillsSource(database, resolved.libraryDir)
    : database.upsertSkillHubSource({
        id: crypto.randomUUID(),
        type: "local",
        label: path.basename(sourcePath) || sourcePath,
        repoKey: null,
        owner: null,
        repo: null,
        branch: null,
        input: sourcePath,
        inputPath: null,
        resolvedPath: sourcePath,
        currentRevision: null,
        checkoutPath: null
      });

  return commitDiscoveredSkills(database, resolved.libraryDir, source, discoveries, skipped, options);
}

export function parseGitHubInput(input: string): GitHubInput {
  const trimmed = input.trim();
  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/(.+))?$/.exec(trimmed);
  if (ssh?.[1] && ssh[2]) return githubInput(ssh[1], ssh[2], null, ssh[3] ?? null, `git@github.com:${ssh[1]}/${ssh[2]}.git`);

  const url = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/tree\/([^/\s]+)(?:\/(.+))?|\/(.+))?$/.exec(trimmed);
  if (url?.[1] && url[2]) return githubInput(url[1], url[2], url[3] ?? null, url[4] ?? url[5] ?? null, `https://github.com/${url[1]}/${url[2]}.git`);

  const shorthand = /^([^/\s]+)\/([^/\s]+)(?:\/(.+))?$/.exec(trimmed);
  if (shorthand?.[1] && shorthand[2]) return githubInput(shorthand[1], shorthand[2], null, shorthand[3] ?? null, `https://github.com/${shorthand[1]}/${shorthand[2]}.git`);

  throw new Error("不支持的 GitHub 输入格式");
}

export function importGitHubSource(
  database: AppDatabase,
  config: AppConfig,
  dataDir: string,
  input: string,
  options: GitHubImportOptions = {}
): SkillHubImportResult {
  const resolved = ensureSkillHub(config, dataDir);
  const parsed = parseGitHubInput(input);
  const existing = database.getSkillHubSourceByRepoKey(parsed.repoKey);
  const sourceId = existing?.id ?? crypto.randomUUID();
  const checkoutPath = path.join(resolved.rootDir, "sources", sourceId, "checkout");
  materializeGitHubCheckout(parsed, checkoutPath, options.fixturePath);
  const revision = gitOutput(["-C", checkoutPath, "rev-parse", "HEAD"]);
  const branch = parsed.branch ?? (gitOutput(["-C", checkoutPath, "rev-parse", "--abbrev-ref", "HEAD"], false) || null);
  const scanRoot = parsed.inputPath ? path.join(checkoutPath, parsed.inputPath) : checkoutPath;
  if (!fs.existsSync(scanRoot) || !fs.statSync(scanRoot).isDirectory()) {
    throw new Error(`GitHub source path not found: ${parsed.inputPath ?? "."}`);
  }
  const discoveries = discoverSkills(scanRoot, parsed.inputPath, parsed.repoKey);
  const source = database.upsertSkillHubSource({
    id: sourceId,
    type: "github",
    label: parsed.repoKey,
    repoKey: parsed.repoKey,
    owner: parsed.owner,
    repo: parsed.repo,
    branch,
    input,
    inputPath: parsed.inputPath,
    resolvedPath: parsed.inputPath,
    currentRevision: revision,
    checkoutPath
  });
  return commitDiscoveredSkills(database, resolved.libraryDir, source, discoveries, [], options);
}

export function checkGitHubUpdates(database: AppDatabase, config: AppConfig, dataDir: string): SkillHubUpdateCheckResult {
  ensureSkillHub(config, dataDir);
  const previews = database
    .listSkillHubSources()
    .filter((source) => source.type === "github")
    .map((source) => previewGitHubSourceUpdate(database, source));
  return { previews };
}

export function applyGitHubSourceUpdate(
  database: AppDatabase,
  config: AppConfig,
  dataDir: string,
  sourceId: string,
  options: { confirmDestructive?: boolean } = {}
): SkillHubSourceUpdatePreview {
  const resolved = ensureSkillHub(config, dataDir);
  const source = database.getSkillHubSource(sourceId);
  if (!source || source.type !== "github") throw new Error("GitHub source not found");
  const preview = previewGitHubSourceUpdate(database, source);
  if (preview.destructive && !options.confirmDestructive) {
    return preview;
  }

  const incoming = new Map(scanGitHubSource(source).discoveries.map((skill) => [skill.sourceRelativePath ?? skill.libraryRelativePath, skill]));
  for (const item of preview.items) {
    if (item.kind === "added") {
      const discovered = incoming.get(item.nextSourceRelativePath ?? item.libraryRelativePath);
      if (discovered) {
        commitDiscoveredSkills(database, resolved.libraryDir, source, [discovered], [], { overwrite: true });
      }
      continue;
    }

    if (!item.skillId) continue;
    const current = database.getSkillHubSkill(item.skillId);
    if (!current) continue;

    if (item.kind === "deleted") {
      removeTargets(database, item.affectedTargets);
      fs.rmSync(current.libraryPath, { recursive: true, force: true });
      database.deleteSkillHubSkill(current.id);
      continue;
    }

    const discovered = incoming.get(item.nextSourceRelativePath ?? current.sourceRelativePath ?? current.libraryRelativePath);
    if (!discovered) continue;
    replaceDirectory(discovered.path, current.libraryPath);
    database.upsertSkillHubSkill({
      ...current,
      sourceRelativePath: discovered.sourceRelativePath,
      contentHash: discovered.contentHash,
      skillName: discovered.skillName,
      description: discovered.description,
      folderName: discovered.folderName
    });
  }

  const revision = source.checkoutPath ? gitOutput(["-C", source.checkoutPath, "rev-parse", "HEAD"], false) : null;
  database.upsertSkillHubSource({ ...source, currentRevision: revision ?? source.currentRevision });
  return previewGitHubSourceUpdate(database, database.getSkillHubSource(source.id) ?? source);
}

export function previewDeleteSkillHubSkill(database: AppDatabase, skillId: string): SkillHubDeletePreview {
  const skill = database.getSkillHubSkill(skillId);
  if (!skill) throw new Error("SkillHub skill not found");
  const affectedTargets = database.listProjectSkillTargetsForSkill(skillId);
  const brokenTargets = affectedTargets.filter((target) => !fs.existsSync(target.linkPath));
  return { skill, affectedTargets, brokenTargets };
}

export function deleteSkillHubSkill(database: AppDatabase, skillId: string): SkillHubDeletePreview {
  const preview = previewDeleteSkillHubSkill(database, skillId);
  removeTargets(database, preview.affectedTargets);
  fs.rmSync(preview.skill.libraryPath, { recursive: true, force: true });
  database.deleteSkillHubSkill(skillId);
  return preview;
}

export function openSkillHubSkill(database: AppDatabase, skillId: string, target: SkillHubOpenTarget): LocalOpenResponse {
  const skill = database.getSkillHubSkill(skillId);
  if (!skill) throw new Error("SkillHub skill not found");
  return openLocalPath(target === "document" ? path.join(skill.libraryPath, "SKILL.md") : skill.libraryPath);
}

function commitDiscoveredSkills(
  database: AppDatabase,
  libraryDir: string,
  source: SkillHubSource,
  discoveries: DiscoveredSkill[],
  skipped: SkillHubImportSkipped[],
  options: ImportOptions
): SkillHubImportResult {
  const imported: SkillHubSkill[] = [];
  const updated: SkillHubSkill[] = [];
  const conflicts: SkillHubImportConflict[] = [];

  for (const discovery of discoveries) {
    const existing = database.getSkillHubSkillByLibraryRelativePath(discovery.libraryRelativePath);
    if (existing && existing.contentHash !== discovery.contentHash && !options.overwrite) {
      conflicts.push({
        existingSkill: existing,
        incoming: {
          folderName: discovery.folderName,
          libraryRelativePath: discovery.libraryRelativePath,
          sourceRelativePath: discovery.sourceRelativePath,
          path: discovery.path
        }
      });
      continue;
    }
    if (existing && existing.contentHash === discovery.contentHash) {
      continue;
    }

    const libraryPath = safeLibraryPath(libraryDir, discovery.libraryRelativePath);
    replaceDirectory(discovery.path, libraryPath);
    const skill = database.upsertSkillHubSkill({
      id: existing?.id ?? crypto.randomUUID(),
      sourceId: source.id,
      sourceType: source.type,
      folderName: discovery.folderName,
      skillName: discovery.skillName,
      description: discovery.description,
      libraryRelativePath: discovery.libraryRelativePath,
      libraryPath,
      sourceRelativePath: discovery.sourceRelativePath,
      contentHash: discovery.contentHash
    });
    if (existing) updated.push(skill);
    else imported.push(skill);
  }

  return { source, imported, updated, skipped, conflicts, requiresConfirmation: conflicts.length > 0 };
}

function discoverLocalSkills(sourcePath: string, libraryDir: string): { discoveries: DiscoveredSkill[]; skipped: SkillHubImportSkipped[] } {
  const basename = path.basename(sourcePath);
  const skipped: SkillHubImportSkipped[] = [];
  if (hasSkillMarker(sourcePath)) {
    return { discoveries: discoverSkills(sourcePath, basename, "skills", true), skipped };
  }

  if (basename === "skills") {
    const discoveries = discoverSkills(sourcePath, "", "skills");
    if (discoveries.length === 0) skipped.push({ path: sourcePath, reason: "未找到包含 SKILL.md 的技能目录" });
    return { discoveries, skipped };
  }

  const wrapped = path.join(sourcePath, "skills");
  if (fs.existsSync(wrapped) && fs.statSync(wrapped).isDirectory()) {
    const discoveries = discoverSkills(wrapped, path.join(basename, "skills"), path.join(basename, "skills"));
    if (discoveries.length === 0) skipped.push({ path: wrapped, reason: "未找到包含 SKILL.md 的技能目录" });
    return { discoveries, skipped };
  }

  skipped.push({ path: sourcePath, reason: `未找到可导入的技能目录；library root: ${libraryDir}` });
  return { discoveries: [], skipped };
}

function discoverSkills(root: string, sourceBaseRelativePath: string | null, libraryPrefix: string, rootIsSingleSkill = false): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];
  const rootResolved = path.resolve(root);

  function visit(directory: string): void {
    if (hasSkillMarker(directory)) {
      const relative = rootIsSingleSkill
        ? path.basename(directory)
        : normalizeRelativePath(path.relative(rootResolved, directory)) || path.basename(directory);
      const sourceRelativePath =
        sourceBaseRelativePath === null
          ? null
          : rootIsSingleSkill
            ? normalizeRelativePath(sourceBaseRelativePath)
            : normalizeRelativePath(path.join(sourceBaseRelativePath, relative));
      const libraryRelativePath = normalizeRelativePath(path.join(libraryPrefix, relative));
      skills.push(discoveredSkill(directory, sourceRelativePath, libraryRelativePath));
      return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) continue;
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      visit(path.join(directory, entry.name));
    }
  }

  visit(rootResolved);
  return skills;
}

function discoveredSkill(directory: string, sourceRelativePath: string | null, libraryRelativePath: string): DiscoveredSkill {
  const metadata = readSkillMetadata(path.join(directory, "SKILL.md"));
  return {
    path: directory,
    folderName: path.basename(directory),
    skillName: metadata.name,
    description: metadata.description,
    sourceRelativePath,
    libraryRelativePath,
    contentHash: hashDirectory(directory)
  };
}

function readSkillMetadata(skillFile: string): { name: string | null; description: string | null } {
  const text = fs.readFileSync(skillFile, "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  const descriptionLine = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
  const foldedDescription = /^description:\s*>\s*\r?\n((?:\s+.+\r?\n?)+)/m.exec(frontmatter)?.[1];
  const description = descriptionLine
    ? stripYamlQuotes(descriptionLine)
    : foldedDescription
      ? foldedDescription
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .join(" ")
      : null;
  return { name: name ? stripYamlQuotes(name) : null, description };
}

function hashDirectory(directory: string): string {
  const hash = crypto.createHash("sha256");
  const files = listFiles(directory);
  for (const file of files) {
    hash.update(normalizeRelativePath(path.relative(directory, file)));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function listFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".git") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function previewGitHubSourceUpdate(database: AppDatabase, source: SkillHubSource): SkillHubSourceUpdatePreview {
  const { discoveries, revision, renameMap } = scanGitHubSource(source);
  const existing = database.listSkillHubSkillsForSource(source.id);
  const incomingBySource = new Map(discoveries.map((skill) => [skill.sourceRelativePath ?? skill.libraryRelativePath, skill]));
  const existingBySource = new Map(existing.map((skill) => [skill.sourceRelativePath ?? skill.libraryRelativePath, skill]));
  const added = new Map(incomingBySource);
  const deleted = new Map(existingBySource);
  const items: SkillHubUpdateItem[] = [];

  for (const [sourcePath, skill] of incomingBySource) {
    const current = existingBySource.get(sourcePath);
    if (!current) continue;
    added.delete(sourcePath);
    deleted.delete(sourcePath);
    if (current.contentHash !== skill.contentHash) {
      items.push(updateItem("changed", current, skill, database.listProjectSkillTargetsForSkill(current.id)));
    }
  }

  for (const [oldPath, newPath] of renameMap) {
    const current = deleted.get(oldPath);
    const incoming = added.get(newPath);
    if (!current || !incoming) continue;
    deleted.delete(oldPath);
    added.delete(newPath);
    items.push(updateItem("moved", current, incoming, database.listProjectSkillTargetsForSkill(current.id)));
  }

  for (const [oldPath, current] of [...deleted]) {
    const fallback = [...added].find(([, incoming]) => incoming.folderName === current.folderName);
    if (!fallback) continue;
    const [newPath, incoming] = fallback;
    deleted.delete(oldPath);
    added.delete(newPath);
    items.push(updateItem("moved", current, incoming, database.listProjectSkillTargetsForSkill(current.id)));
  }

  for (const skill of added.values()) {
    items.push({
      kind: "added",
      skillId: null,
      folderName: skill.folderName,
      skillName: skill.skillName,
      libraryRelativePath: skill.libraryRelativePath,
      previousSourceRelativePath: null,
      nextSourceRelativePath: skill.sourceRelativePath,
      destructive: false,
      affectedTargets: []
    });
  }

  for (const current of deleted.values()) {
    const affectedTargets = database.listProjectSkillTargetsForSkill(current.id);
    items.push({
      kind: "deleted",
      skillId: current.id,
      folderName: current.folderName,
      skillName: current.skillName,
      libraryRelativePath: current.libraryRelativePath,
      previousSourceRelativePath: current.sourceRelativePath,
      nextSourceRelativePath: null,
      destructive: affectedTargets.length > 0,
      affectedTargets
    });
  }

  return {
    source: { ...source, currentRevision: revision },
    items,
    hasUpdates: items.length > 0,
    destructive: items.some((item) => item.destructive),
    checkedAt: nowIso()
  };
}

function updateItem(kind: "changed" | "moved", current: SkillHubSkill, incoming: DiscoveredSkill, affectedTargets: ProjectSkillTarget[]): SkillHubUpdateItem {
  return {
    kind,
    skillId: current.id,
    folderName: incoming.folderName,
    skillName: incoming.skillName,
    libraryRelativePath: current.libraryRelativePath,
    previousSourceRelativePath: current.sourceRelativePath,
    nextSourceRelativePath: incoming.sourceRelativePath,
    destructive: false,
    affectedTargets
  };
}

function scanGitHubSource(source: SkillHubSource): { discoveries: DiscoveredSkill[]; revision: string | null; renameMap: Map<string, string> } {
  if (!source.checkoutPath || !source.repoKey) throw new Error("GitHub source checkout is missing");
  updateGitHubCheckout(source);
  const revision = gitOutput(["-C", source.checkoutPath, "rev-parse", "HEAD"], false);
  const scanRoot = source.resolvedPath ? path.join(source.checkoutPath, source.resolvedPath) : source.checkoutPath;
  const discoveries = fs.existsSync(scanRoot) ? discoverSkills(scanRoot, source.resolvedPath, source.repoKey) : [];
  return {
    discoveries,
    revision,
    renameMap: source.currentRevision && revision ? gitRenameMap(source.checkoutPath, source.currentRevision, revision) : new Map()
  };
}

function gitRenameMap(checkoutPath: string, oldRevision: string, newRevision: string): Map<string, string> {
  const output = gitOutput(["-C", checkoutPath, "diff", "--name-status", "-M", oldRevision, newRevision], false);
  const moves = new Map<string, string>();
  if (!output) return moves;
  for (const line of output.split(/\r?\n/)) {
    const parts = line.split(/\t/);
    if (!parts[0]?.startsWith("R") || parts.length < 3) continue;
    const oldPath = parts[1];
    const newPath = parts[2];
    if (!oldPath || !newPath) continue;
    const oldFile = normalizeRelativePath(oldPath);
    const newFile = normalizeRelativePath(newPath);
    if (path.basename(oldFile) !== "SKILL.md" || path.basename(newFile) !== "SKILL.md") continue;
    moves.set(normalizeRelativePath(path.dirname(oldFile)), normalizeRelativePath(path.dirname(newFile)));
  }
  return moves;
}

function materializeGitHubCheckout(parsed: GitHubInput, checkoutPath: string, fixturePath?: string): void {
  fs.mkdirSync(path.dirname(checkoutPath), { recursive: true });
  if (!fs.existsSync(checkoutPath)) {
    const remote = fixturePath ? path.resolve(fixturePath) : parsed.remoteUrl;
    const args = ["clone", remote, checkoutPath];
    if (parsed.branch) args.splice(1, 0, "--branch", parsed.branch);
    gitOutput(args);
    return;
  }
  updateGitHubCheckout({ checkoutPath, branch: parsed.branch } as SkillHubSource);
}

function updateGitHubCheckout(source: Pick<SkillHubSource, "checkoutPath" | "branch">): void {
  if (!source.checkoutPath || !fs.existsSync(path.join(source.checkoutPath, ".git"))) return;
  gitOutput(["-C", source.checkoutPath, "fetch", "--all", "--prune"], false);
  const branch = source.branch && source.branch !== "HEAD" ? source.branch : gitOutput(["-C", source.checkoutPath, "rev-parse", "--abbrev-ref", "HEAD"], false);
  if (branch && branch !== "HEAD") {
    gitOutput(["-C", source.checkoutPath, "reset", "--hard", `origin/${branch}`], false);
  }
}

function gitOutput(args: string[], required = true): string | null {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    if (!required) return null;
    throw new Error((result.stderr || result.stdout || "git command failed").trim());
  }
  return result.stdout.trim();
}

function githubInput(owner: string, repo: string, branch: string | null, inputPath: string | null, remoteUrl: string): GitHubInput {
  const cleanRepo = repo.replace(/\.git$/, "");
  const repoKey = `${owner}-${cleanRepo}`;
  return {
    owner,
    repo: cleanRepo,
    repoKey,
    branch,
    inputPath: inputPath ? normalizeRelativePath(inputPath) : null,
    remoteUrl
  };
}

function hasSkillMarker(directory: string): boolean {
  return fs.existsSync(path.join(directory, "SKILL.md")) && fs.statSync(path.join(directory, "SKILL.md")).isFile();
}

function safeLibraryPath(libraryDir: string, relativePath: string): string {
  const fullPath = path.resolve(libraryDir, relativePath);
  const root = path.resolve(libraryDir);
  if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing SkillHub path outside library: ${relativePath}`);
  }
  return fullPath;
}

function replaceDirectory(source: string, target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });
}

function removeTargets(database: AppDatabase, targets: ProjectSkillTarget[]): void {
  for (const target of targets) {
    removeDirectoryLink(target.linkPath);
    database.deleteProjectSkillTarget(target.projectId, target.toolId, target.skillId);
  }
}

function normalizeRelativePath(input: string): string {
  return input.split(/[\\/]+/).filter(Boolean).join("/");
}

function stripYamlQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}

function usesDirectSkillsSource(discoveries: DiscoveredSkill[]): boolean {
  return discoveries.length > 0 && discoveries.every((skill) => isDirectSkillsLibraryPath(skill.libraryRelativePath));
}

function isDirectSkillsLibraryPath(libraryRelativePath: string): boolean {
  const normalized = normalizeRelativePath(libraryRelativePath);
  return normalized === DIRECT_SKILLS_SOURCE_ID || normalized.startsWith(`${DIRECT_SKILLS_SOURCE_ID}/`);
}

function upsertDirectSkillsSource(database: AppDatabase, libraryDir: string): SkillHubSource {
  const skillsPath = path.join(libraryDir, DIRECT_SKILLS_SOURCE_ID);
  return database.upsertSkillHubSource({
    id: DIRECT_SKILLS_SOURCE_ID,
    type: "local",
    label: DIRECT_SKILLS_SOURCE_ID,
    repoKey: null,
    owner: null,
    repo: null,
    branch: null,
    input: skillsPath,
    inputPath: null,
    resolvedPath: skillsPath,
    currentRevision: null,
    checkoutPath: null
  });
}

function assignDirectLibrarySkillsSource(database: AppDatabase, libraryDir: string): void {
  const directSkills = database.listSkillHubSkills().filter((skill) => isDirectSkillsLibraryPath(skill.libraryRelativePath));
  const misplaced = directSkills.filter((skill) => skill.sourceId !== DIRECT_SKILLS_SOURCE_ID || skill.sourceType !== "local");
  if (misplaced.length === 0) return;

  const source = upsertDirectSkillsSource(database, libraryDir);
  for (const skill of misplaced) {
    database.upsertSkillHubSkill({
      id: skill.id,
      sourceId: source.id,
      sourceType: source.type,
      folderName: skill.folderName,
      skillName: skill.skillName,
      description: skill.description,
      libraryRelativePath: skill.libraryRelativePath,
      libraryPath: skill.libraryPath,
      sourceRelativePath: skill.sourceRelativePath,
      contentHash: skill.contentHash,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt
    });
  }
}
