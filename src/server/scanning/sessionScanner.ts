import fs from "node:fs";
import path from "node:path";
import type { Project, RefreshResult, ToolId } from "../../shared/types.js";
import { AppDatabase } from "../storage/database.js";
import { existingSources, sessionSourcesForAdapter, toolAdapters } from "../tools/adapters.js";
import type { ToolAdapter } from "../tools/toolAdapter.js";
import { parseClineDatabaseFile } from "./clineDatabase.js";
import { parseCursorDatabaseFile } from "./cursorDatabase.js";
import { parseOpencodeDatabaseFile } from "./opencodeDatabase.js";
import { parseSessionFile, parseSessionIndexFile } from "./sessionParser.js";
import type { AppConfig } from "../../shared/types.js";
import { isStrictChildPath } from "../core/pathUtils.js";

const SESSION_EXTENSIONS = new Set([".jsonl", ".json"]);
const CLINE_DATABASE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);
const OPENCODE_DATABASE_FILE = "opencode.db";
const KILO_DATABASE_FILE = "kilo.db";
const CURSOR_DATABASE_FILE = "store.db";

export interface RefreshAllSessionsOptions {
  toolIds?: ToolId[];
  autoAddProjects?: boolean;
}

export interface SessionSourceTarget {
  toolId: ToolId;
  sourceRoot: string;
  sourceFile: string;
}

export interface RefreshSessionFilesOptions {
  scope?: string;
  missingSourceMessage?: string;
}

export function refreshAllSessions(database: AppDatabase, config: AppConfig, options: RefreshAllSessionsOptions = {}): RefreshResult {
  const selectedTools = options.toolIds?.length ? new Set<ToolId>(options.toolIds) : null;
  const adapters = Object.values(toolAdapters).filter((adapter) => {
    return adapter.capabilities.scanHistory && (!selectedTools || selectedTools.has(adapter.id));
  });
  const scanRun = database.createScanRun("sessions", adapters.flatMap((adapter) => sessionSourcesForAdapter(adapter, config)));
  let indexedCount = 0;
  let skippedCount = 0;

  for (const adapter of adapters) {
    const sources = existingSources(sessionSourcesForAdapter(adapter, config));
    const result = scanAdapterSources(database, adapter, sources, scanRun.id);
    indexedCount += result.indexedCount;
    skippedCount += result.skippedCount;
  }

  const warningCount = database.countParserWarningsForRun(scanRun.id);
  const completed = database.completeScanRun(scanRun.id, { indexedCount, skippedCount, warningCount });
  const addedProjectCount = options.autoAddProjects ? database.addSessionProjectsForTools(options.toolIds) : 0;
  return { scanRun: completed, indexedCount, skippedCount, warningCount, addedProjectCount };
}

export function refreshProjectSessions(database: AppDatabase, config: AppConfig, project: Project): RefreshResult {
  const adapters = Object.values(toolAdapters).filter((adapter) => adapter.capabilities.scanHistory);
  const scanRun = database.createScanRun("project-sessions", [project.rootPath]);
  const targets = new Map<string, { toolId: ToolId; sourceFile: string }>();

  for (const session of database.listSessionsForProject(project)) {
    targets.set(targetKey(session.toolId, session.sourceFile), {
      toolId: session.toolId,
      sourceFile: session.sourceFile
    });
  }

  for (const warning of database.listParserWarningsForProject(project)) {
    if (!warning.toolId || !warning.sourceFile) continue;
    targets.set(targetKey(warning.toolId, warning.sourceFile), {
      toolId: warning.toolId,
      sourceFile: warning.sourceFile
    });
  }

  let indexedCount = 0;
  let skippedCount = 0;

  for (const target of targets.values()) {
    const adapter = toolAdapters[target.toolId];
    const result = refreshParsedSourceFile(database, adapter, target.sourceFile, scanRun.id);
    indexedCount += result.indexedCount;
    skippedCount += result.skippedCount;
  }

  for (const adapter of adapters) {
    const sources = existingSources(sessionSourcesForAdapter(adapter, config));
    for (const file of sources.flatMap((source) => sessionFiles(adapter, source))) {
      const key = targetKey(adapter.id, file);
      if (targets.has(key)) continue;

      const parsed = parseSourceFile(adapter, file, scanRun.id);
      if (!parsedSourceBelongsToProject(parsed.sessions, project) && !warningSourceBelongsToProject(adapter, file, project)) {
        continue;
      }

      targets.set(key, { toolId: adapter.id, sourceFile: file });
      const result = refreshParsedSourceFile(database, adapter, file, scanRun.id, parsed);
      indexedCount += result.indexedCount;
      skippedCount += result.skippedCount;
    }
  }

  const warningCount = database.countParserWarningsForRun(scanRun.id);
  const completed = database.completeScanRun(scanRun.id, { indexedCount, skippedCount, warningCount });
  return { scanRun: completed, indexedCount, skippedCount, warningCount };
}

export function listSessionSourceTargets(config: AppConfig, toolIds: ToolId[] = []): SessionSourceTarget[] {
  const selectedTools = toolIds.length ? new Set<ToolId>(toolIds) : null;
  const targets = new Map<string, SessionSourceTarget>();

  for (const adapter of Object.values(toolAdapters)) {
    if (!adapter.capabilities.scanHistory) continue;
    if (selectedTools && !selectedTools.has(adapter.id)) continue;

    for (const sourceRoot of existingSources(sessionSourcesForAdapter(adapter, config))) {
      for (const sourceFile of sessionFiles(adapter, sourceRoot)) {
        targets.set(targetKey(adapter.id, sourceFile), {
          toolId: adapter.id,
          sourceRoot,
          sourceFile
        });
      }
    }
  }

  return [...targets.values()].sort((a, b) => {
    return a.toolId.localeCompare(b.toolId) || a.sourceFile.localeCompare(b.sourceFile);
  });
}

export function refreshSessionFiles(
  database: AppDatabase,
  targets: Array<{ toolId: ToolId; sourceFile: string }>,
  options: RefreshSessionFilesOptions = {}
): RefreshResult {
  const uniqueTargets = [
    ...new Map(targets.map((target) => [`${target.toolId}:${path.resolve(target.sourceFile)}`, target])).values()
  ];
  const scanRun = database.createScanRun(options.scope ?? "relocation", uniqueTargets.map((target) => target.sourceFile));
  let indexedCount = 0;
  let skippedCount = 0;

  for (const target of uniqueTargets) {
    database.deleteParserWarningsBySourceFile(target.toolId, target.sourceFile);

    if (!fs.existsSync(target.sourceFile)) {
      skippedCount += 1;
      database.addParserWarning({
        scanRunId: scanRun.id,
        toolId: target.toolId,
        sourceFile: target.sourceFile,
        errorType: "missing-source-file",
        message: options.missingSourceMessage ?? "Relocation source file was missing during scoped index rebuild",
        line: null
      });
      continue;
    }

    const adapter = toolAdapters[target.toolId];
    const parsed = parseSourceFile(adapter, target.sourceFile, scanRun.id);

    for (const warning of parsed.warnings) {
      database.addParserWarning(warning);
    }

    if (parsed.sessions.length > 0) {
      database.deleteSessionsBySourceFile(adapter.id, target.sourceFile);
      for (const session of parsed.sessions) {
        database.upsertSession(session);
      }
      indexedCount += parsed.sessions.length;
    } else if (parsed.skipped) {
      database.deleteSessionsBySourceFile(adapter.id, target.sourceFile);
      skippedCount += 1;
    }
  }

  const warningCount = database.countParserWarningsForRun(scanRun.id);
  const completed = database.completeScanRun(scanRun.id, { indexedCount, skippedCount, warningCount });
  return { scanRun: completed, indexedCount, skippedCount, warningCount };
}

function scanAdapterSources(database: AppDatabase, adapter: ToolAdapter, sources: string[], scanRunId: string) {
  let indexedCount = 0;
  let skippedCount = 0;

  for (const file of sources.flatMap((source) => sessionFiles(adapter, source))) {
    database.deleteParserWarningsBySourceFile(adapter.id, file);

    const parsed = parseSourceFile(adapter, file, scanRunId);

    for (const warning of parsed.warnings) {
      database.addParserWarning(warning);
    }

    if (parsed.sessions.length > 0) {
      database.deleteSessionsBySourceFile(adapter.id, file);
      for (const session of parsed.sessions) {
        database.upsertSession(session);
      }
      indexedCount += parsed.sessions.length;
    } else if (parsed.skipped) {
      database.deleteSessionsBySourceFile(adapter.id, file);
      skippedCount += 1;
    }
  }

  return { indexedCount, skippedCount };
}

function refreshParsedSourceFile(
  database: AppDatabase,
  adapter: ToolAdapter,
  sourceFile: string,
  scanRunId: string,
  parsed = parseSourceFile(adapter, sourceFile, scanRunId)
) {
  database.deleteParserWarningsBySourceFile(adapter.id, sourceFile);

  for (const warning of parsed.warnings) {
    database.addParserWarning(warning);
  }

  if (parsed.sessions.length > 0) {
    database.deleteSessionsBySourceFile(adapter.id, sourceFile);
    for (const session of parsed.sessions) {
      database.upsertSession(session);
    }
    return { indexedCount: parsed.sessions.length, skippedCount: 0 };
  }

  if (parsed.skipped) {
    database.deleteSessionsBySourceFile(adapter.id, sourceFile);
    return { indexedCount: 0, skippedCount: 1 };
  }

  return { indexedCount: 0, skippedCount: 0 };
}

function parseSourceFile(adapter: ToolAdapter, sourceFile: string, scanRunId: string) {
  if (adapter.id === "opencode" && isOpencodeDatabase(sourceFile)) {
    return parseOpencodeDatabaseFile({
      parserVersion: adapter.parserVersion,
      sourceFile,
      scanRunId
    });
  }
  if (adapter.id === "kilo" && isKiloDatabase(sourceFile)) {
    return parseOpencodeDatabaseFile({
      toolId: adapter.id,
      parserVersion: adapter.parserVersion,
      sourceFormat: "kilo-sqlite",
      sourceFile,
      scanRunId
    });
  }
  if (adapter.id === "cursor" && isCursorDatabase(sourceFile)) {
    return parseCursorDatabaseFile({
      parserVersion: adapter.parserVersion,
      sourceFile,
      scanRunId
    });
  }
  if (adapter.id === "cline" && isClineDatabase(sourceFile)) {
    return parseClineDatabaseFile({
      parserVersion: adapter.parserVersion,
      sourceFile,
      scanRunId
    });
  }
  if (adapter.id === "kimi" && isKimiSessionIndex(sourceFile)) {
    return parseSessionIndexFile({
      toolId: adapter.id,
      parserVersion: adapter.parserVersion,
      sourceFormat: "kimi-code-index",
      sourceFile,
      scanRunId
    });
  }
  const parsed = parseSessionFile({
    toolId: adapter.id,
    parserVersion: adapter.parserVersion,
    sourceFormat: adapter.sourceFormat,
    sourceFile,
    scanRunId
  });

  return {
    sessions: parsed.session ? [parsed.session] : [],
    warnings: parsed.warnings,
    skipped: parsed.skipped
  };
}

function targetKey(toolId: ToolId, sourceFile: string): string {
  return `${toolId}:${path.resolve(sourceFile)}`;
}

function parsedSourceBelongsToProject(sessions: Array<{ normalizedCwd: string | null }>, project: Project): boolean {
  return sessions.some((session) => {
    if (!session.normalizedCwd) return false;
    if (session.normalizedCwd === project.normalizedRootPath) return true;
    return project.includeSubdirectories && isStrictChildPath(project.normalizedRootPath, session.normalizedCwd);
  });
}

function warningSourceBelongsToProject(adapter: ToolAdapter, sourceFile: string, project: Project): boolean {
  if (adapter.id !== "claude") return false;
  return claudeProjectPathSegment(sourceFile) === encodeClaudeProjectPath(project.rootPath);
}

function encodeClaudeProjectPath(input: string): string {
  return path.resolve(input).replace(/[:\\/]/g, "-");
}

function claudeProjectPathSegment(sourceFile: string): string | null {
  const parts = path.normalize(sourceFile).split(/[\\/]+/);
  const projectsIndex = parts.findIndex((part, index) => part === "projects" && parts[index - 1] === ".claude");
  return projectsIndex >= 0 ? parts[projectsIndex + 1] ?? null : null;
}

function sessionFiles(adapter: ToolAdapter, source: string): string[] {
  if (!fs.existsSync(source)) return [];
  const stat = fs.statSync(source);
  if (stat.isFile()) {
    return isSessionFile(adapter, source) ? [source] : [];
  }

  const files: string[] = [];
  const stack = [source];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of safeReadDir(current)) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && isSessionFile(adapter, fullPath)) {
        files.push(fullPath);
      }
    }
  }
  return files.sort();
}

function isSessionFile(adapter: ToolAdapter, file: string): boolean {
  if (adapter.id === "cursor") return isCursorSessionFile(file);
  if (adapter.id === "antigravity") return isAntigravitySessionFile(file);
  if (adapter.id === "kilo") return isKiloDatabase(file);
  if (SESSION_EXTENSIONS.has(path.extname(file).toLowerCase())) return true;
  if (adapter.id === "cline" && isClineDatabase(file)) return true;
  return adapter.id === "opencode" && isOpencodeDatabase(file);
}

function isCursorSessionFile(file: string): boolean {
  if (isCursorDatabase(file)) return true;
  if (!SESSION_EXTENSIONS.has(path.extname(file).toLowerCase())) return false;
  const parts = normalizedParts(file);
  return (
    parts.includes("agent-transcripts") ||
    parts.includes("chats") ||
    (parts.includes(".cursor") && parts.includes("projects")) ||
    parts.includes("workspacestorage")
  );
}

function isAntigravitySessionFile(file: string): boolean {
  if (!SESSION_EXTENSIONS.has(path.extname(file).toLowerCase())) return false;
  const basename = path.basename(file).toLowerCase();
  if (basename === "settings.json" || basename === "config.json") return false;
  const parts = normalizedParts(file);
  return parts.includes("brain") || parts.includes("conversations") || (parts.includes(".system_generated") && parts.includes("logs"));
}

function normalizedParts(file: string): string[] {
  return path.normalize(file).split(/[\\/]+/).map((part) => part.toLowerCase());
}

function isOpencodeDatabase(file: string): boolean {
  return path.basename(file).toLowerCase() === OPENCODE_DATABASE_FILE;
}

function isKiloDatabase(file: string): boolean {
  const basename = path.basename(file).toLowerCase();
  return basename === KILO_DATABASE_FILE || (basename !== OPENCODE_DATABASE_FILE && CLINE_DATABASE_EXTENSIONS.has(path.extname(file).toLowerCase()));
}

function isCursorDatabase(file: string): boolean {
  return path.basename(file).toLowerCase() === CURSOR_DATABASE_FILE;
}

function isClineDatabase(file: string): boolean {
  return CLINE_DATABASE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function isKimiSessionIndex(file: string): boolean {
  return path.basename(file).toLowerCase() === "session_index.jsonl";
}

function safeReadDir(directory: string): fs.Dirent[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}
