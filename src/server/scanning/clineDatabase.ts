import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { ParserWarning, SessionEntry } from "../../shared/types.js";
import { normalizeFsPath } from "../core/pathUtils.js";
import { maxIso, nowIso, toIso } from "../core/time.js";

type Row = Record<string, unknown>;

interface ParseContext {
  parserVersion: string;
  sourceFile: string;
  scanRunId: string | null;
}

export function parseClineDatabaseFile(context: ParseContext): {
  sessions: SessionEntry[];
  warnings: Array<Omit<ParserWarning, "id" | "createdAt">>;
  skipped: boolean;
} {
  const warnings: Array<Omit<ParserWarning, "id" | "createdAt">> = [];
  const sessions: SessionEntry[] = [];
  const stat = fs.statSync(context.sourceFile);
  let db: DatabaseSync;

  try {
    db = new DatabaseSync(context.sourceFile, { readOnly: true });
  } catch (error) {
    warnings.push({
      scanRunId: context.scanRunId,
      toolId: "cline",
      sourceFile: context.sourceFile,
      errorType: "cline-sqlite-open-failed",
      message: error instanceof Error ? error.message : "Cline SQLite database could not be opened",
      line: null
    });
    return { sessions: [], warnings, skipped: true };
  }

  try {
    for (const table of sqliteTables(db)) {
      const columns = sqliteColumns(db, table);
      if (!mayContainSessions(table, columns)) continue;
      const rows = db.prepare(`SELECT * FROM ${quoteSqliteIdentifier(table)} LIMIT 1000`).all() as Row[];
      let parsedRows = 0;
      for (const row of rows) {
        const session = sessionFromRow(context, table, row, stat.mtime.toISOString(), warnings);
        if (!session) continue;
        parsedRows += 1;
        sessions.push(session);
      }
      if (rows.length > 0 && parsedRows === 0 && mayContainSessions(table, columns)) {
        warnings.push({
          scanRunId: context.scanRunId,
          toolId: "cline",
          sourceFile: context.sourceFile,
          errorType: "cline-sqlite-table-unrecognized",
          message: `Cline SQLite table did not expose resumable session rows: ${table}`,
          line: null
        });
      }
    }
  } catch (error) {
    warnings.push({
      scanRunId: context.scanRunId,
      toolId: "cline",
      sourceFile: context.sourceFile,
      errorType: "cline-sqlite-parse-failed",
      message: error instanceof Error ? error.message : "Cline SQLite database could not be parsed",
      line: null
    });
  } finally {
    db.close();
  }

  if (sessions.length === 0) {
    warnings.push({
      scanRunId: context.scanRunId,
      toolId: "cline",
      sourceFile: context.sourceFile,
      errorType: "empty-session",
      message: "No readable Cline sessions were found",
      line: null
    });
  }

  return { sessions, warnings, skipped: sessions.length === 0 };
}

function sessionFromRow(
  context: ParseContext,
  table: string,
  row: Row,
  fallbackUpdatedAt: string,
  warnings: Array<Omit<ParserWarning, "id" | "createdAt">>
): SessionEntry | null {
  const jsonValues = jsonColumnValues(row);
  const nativeSessionId = firstString(row, sessionIdColumns) ?? firstString(jsonValues, sessionIdColumns);
  if (!nativeSessionId) return null;

  const cwd = firstString(row, cwdColumns) ?? firstString(jsonValues, cwdColumns);
  const normalizedCwd = cwd ? normalizeFsPath(cwd) : null;
  const title =
    firstString(row, titleColumns) ??
    firstString(jsonValues, titleColumns) ??
    firstUserText(jsonValues) ??
    `未命名会话 ${nativeSessionId}`;
  const summary = firstString(row, summaryColumns) ?? firstString(jsonValues, summaryColumns);
  const updatedAt = maxIso([...timestampCandidates(row), ...jsonValues.flatMap(timestampCandidates)]) ?? fallbackUpdatedAt;

  if (!cwd) {
    warnings.push({
      scanRunId: context.scanRunId,
      toolId: "cline",
      sourceFile: context.sourceFile,
      errorType: "missing-cwd",
      message: `Cline SQLite row is missing cwd; resume is disabled: ${table}`,
      line: null
    });
  }

  const resumeStatus = !cwd ? "missing_cwd" : fs.existsSync(cwd) ? "ready" : "cwd_missing";
  return {
    id: `cline:${nativeSessionId}`,
    toolId: "cline",
    nativeSessionId,
    title: title.slice(0, 180),
    summary: summary?.slice(0, 2000) ?? null,
    originalCwd: cwd,
    normalizedCwd,
    updatedAt,
    sourceFile: context.sourceFile,
    sourceFormat: "cline-sqlite",
    parserVersion: context.parserVersion,
    resumeStatus,
    indexedAt: nowIso()
  };
}

const sessionIdColumns = ["taskId", "task_id", "sessionId", "session_id", "conversationId", "conversation_id", "id", "uuid"];
const cwdColumns = [
  "cwd",
  "workspaceRoot",
  "workspace_root",
  "workspacePath",
  "workspace_path",
  "projectRoot",
  "project_root",
  "projectPath",
  "project_path",
  "workingDirectory",
  "working_directory",
  "rootPath",
  "root_path"
];
const titleColumns = ["title", "name", "description", "conversationTitle"];
const summaryColumns = ["summary", "synopsis"];
const timestampColumns = ["updatedAt", "updated_at", "lastUpdatedAt", "last_updated_at", "createdAt", "created_at", "timestamp", "time"];

function mayContainSessions(table: string, columns: Set<string>): boolean {
  const lower = table.toLowerCase();
  if (lower.includes("session") || lower.includes("task") || lower.includes("conversation") || lower.includes("history")) return true;
  return sessionIdColumns.some((column) => columns.has(column)) && cwdColumns.some((column) => columns.has(column));
}

function firstString(row: Row | Row[], keys: string[]): string | null {
  if (Array.isArray(row)) {
    for (const item of row) {
      const found = firstString(item, keys);
      if (found) return found;
    }
    return null;
  }
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function firstUserText(values: Row[]): string | null {
  for (const value of values) {
    const role = typeof value.role === "string" ? value.role.toLowerCase() : "";
    if (role && role !== "user" && role !== "human") continue;
    const text = firstString(value, ["content", "text", "message", "prompt"]);
    if (text) return text.slice(0, 80);
  }
  return null;
}

function jsonColumnValues(row: Row): Row[] {
  const values: Row[] = [];
  for (const value of Object.values(row)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      collectObjects(parsed, values);
    } catch {
      // Ignore non-JSON text columns.
    }
  }
  return values;
}

function collectObjects(value: unknown, target: Row[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, target);
    return;
  }
  if (!value || typeof value !== "object") return;
  const row = value as Row;
  target.push(row);
  for (const child of Object.values(row)) {
    if (child && typeof child === "object") collectObjects(child, target);
  }
}

function timestampCandidates(row: Row): string[] {
  const timestamps: string[] = [];
  for (const key of timestampColumns) {
    const iso = toIso(row[key]);
    if (iso) timestamps.push(iso);
  }
  return timestamps;
}

function sqliteTables(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => String((row as Row).name))
    .filter((name) => name.length > 0);
}

function sqliteColumns(db: DatabaseSync, table: string): Set<string> {
  return new Set(
    db
      .prepare(`PRAGMA table_info(${quoteSqliteIdentifier(table)})`)
      .all()
      .map((row) => String((row as Row).name))
      .filter((name) => name.length > 0)
  );
}

function quoteSqliteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
