import fs from "node:fs";
import path from "node:path";
import type { Project, RefreshResult, ToolId } from "../../shared/types.js";
import { AppDatabase } from "../storage/database.js";
import { existingSources, toolAdapters } from "../tools/adapters.js";
import type { ToolAdapter } from "../tools/toolAdapter.js";
import { parseOpencodeDatabaseFile } from "./opencodeDatabase.js";
import { parseSessionFile } from "./sessionParser.js";
import type { AppConfig } from "../../shared/types.js";

const SESSION_EXTENSIONS = new Set([".jsonl", ".json"]);
const OPENCODE_DATABASE_FILE = "opencode.db";

export interface RefreshAllSessionsOptions {
  toolIds?: ToolId[];
  autoAddProjects?: boolean;
}

export function refreshAllSessions(database: AppDatabase, config: AppConfig, options: RefreshAllSessionsOptions = {}): RefreshResult {
  const selectedTools = options.toolIds?.length ? new Set<ToolId>(options.toolIds) : null;
  const adapters = Object.values(toolAdapters).filter((adapter) => {
    return adapter.capabilities.scanHistory && (!selectedTools || selectedTools.has(adapter.id));
  });
  const scanRun = database.createScanRun("sessions", adapters.flatMap((adapter) => adapter.detect(config).sessionSources));
  let indexedCount = 0;
  let skippedCount = 0;

  for (const adapter of adapters) {
    const sources = existingSources(adapter.detect(config).sessionSources);
    const result = scanAdapterSources(database, adapter, sources, scanRun.id);
    indexedCount += result.indexedCount;
    skippedCount += result.skippedCount;
  }

  const warningCount = database.countParserWarningsForRun(scanRun.id);
  const completed = database.completeScanRun(scanRun.id, { indexedCount, skippedCount, warningCount });
  const addedProjectCount = options.autoAddProjects ? database.addSessionProjectsForTools(options.toolIds) : 0;
  return { scanRun: completed, indexedCount, skippedCount, warningCount, addedProjectCount };
}

export function refreshProjectSessions(database: AppDatabase, project: Project): RefreshResult {
  return refreshSessionFiles(
    database,
    [
      ...database.listSessionsForProject(project).map((session) => ({
        toolId: session.toolId,
        sourceFile: session.sourceFile
      })),
      ...database
        .listParserWarningsForProject(project)
        .filter((warning) => warning.toolId && warning.sourceFile)
        .map((warning) => ({
          toolId: warning.toolId as ToolId,
          sourceFile: warning.sourceFile as string
        }))
    ]
  );
}

export function refreshSessionFiles(
  database: AppDatabase,
  targets: Array<{ toolId: ToolId; sourceFile: string }>
): RefreshResult {
  const uniqueTargets = [
    ...new Map(targets.map((target) => [`${target.toolId}:${path.resolve(target.sourceFile)}`, target])).values()
  ];
  const scanRun = database.createScanRun("relocation", uniqueTargets.map((target) => target.sourceFile));
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
        message: "Relocation source file was missing during scoped index rebuild",
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

function parseSourceFile(adapter: ToolAdapter, sourceFile: string, scanRunId: string) {
  if (adapter.id === "opencode" && isOpencodeDatabase(sourceFile)) {
    return parseOpencodeDatabaseFile({
      parserVersion: adapter.parserVersion,
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
  if (SESSION_EXTENSIONS.has(path.extname(file).toLowerCase())) return true;
  return adapter.id === "opencode" && isOpencodeDatabase(file);
}

function isOpencodeDatabase(file: string): boolean {
  return path.basename(file).toLowerCase() === OPENCODE_DATABASE_FILE;
}

function safeReadDir(directory: string): fs.Dirent[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}
