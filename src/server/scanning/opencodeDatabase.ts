import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { ParserWarning, SessionEntry, ToolId } from "../../shared/types.js";
import { normalizeFsPath } from "../core/pathUtils.js";
import { nowIso, toIso } from "../core/time.js";

interface ParseContext {
  toolId?: ToolId;
  parserVersion: string;
  sourceFormat?: string;
  sourceFile: string;
  scanRunId: string | null;
}

export interface ParsedSessionSource {
  sessions: SessionEntry[];
  warnings: Array<Omit<ParserWarning, "id" | "createdAt">>;
  skipped: boolean;
}

type Row = Record<string, unknown>;

export function parseOpencodeDatabaseFile(context: ParseContext): ParsedSessionSource {
  const warnings: Array<Omit<ParserWarning, "id" | "createdAt">> = [];
  const stat = fs.statSync(context.sourceFile);
  const toolId = context.toolId ?? "opencode";
  const toolName = toolId === "kilo" ? "Kilo" : "OpenCode";
  let db: DatabaseSync | null = null;

  try {
    db = new DatabaseSync(context.sourceFile, { readOnly: true });
    const rows = db
      .prepare(
        `SELECT
          s.id AS session_id,
          s.directory AS directory,
          s.title AS title,
          s.slug AS slug,
          s.time_created AS session_time_created,
          s.time_updated AS session_time_updated,
          p.worktree AS project_worktree,
          p.name AS project_name
        FROM session s
        LEFT JOIN project p ON p.id = s.project_id
        ORDER BY s.time_updated DESC`
      )
      .all();

    const sessions = rows.map((row, index) => rowToSession(context, row, index, stat.mtime.toISOString(), warnings));
    if (sessions.length === 0) {
      warnings.push({
        scanRunId: context.scanRunId,
        toolId,
        sourceFile: context.sourceFile,
        errorType: "empty-session",
        message: `No readable ${toolName} sessions were found`,
        line: null
      });
    }

    return { sessions, warnings, skipped: sessions.length === 0 };
  } catch (error) {
    warnings.push({
      scanRunId: context.scanRunId,
      toolId,
      sourceFile: context.sourceFile,
      errorType: toolId === "kilo" ? "kilo-sqlite-error" : "opencode-sqlite-error",
      message: error instanceof Error ? error.message : `Failed to read ${toolName} SQLite database`,
      line: null
    });
    return { sessions: [], warnings, skipped: true };
  } finally {
    db?.close();
  }
}

function rowToSession(
  context: ParseContext,
  row: Row,
  index: number,
  fallbackUpdatedAt: string,
  warnings: Array<Omit<ParserWarning, "id" | "createdAt">>
): SessionEntry {
  const toolId = context.toolId ?? "opencode";
  const toolName = toolId === "kilo" ? "Kilo" : "OpenCode";
  const nativeSessionId = stringValue(row.session_id);
  const cwd = usablePath(stringValue(row.directory)) ?? usablePath(stringValue(row.project_worktree));
  const title =
    stringValue(row.title) ??
    stringValue(row.slug) ??
    stringValue(row.project_name) ??
    `未命名会话 ${nativeSessionId ?? index + 1}`;

  if (!nativeSessionId) {
    warnings.push({
      scanRunId: context.scanRunId,
      toolId,
      sourceFile: context.sourceFile,
      errorType: "missing-session-id",
      message: `${toolName} session id was missing; resume is disabled`,
      line: null
    });
  }

  if (!cwd) {
    warnings.push({
      scanRunId: context.scanRunId,
      toolId,
      sourceFile: context.sourceFile,
      errorType: "missing-cwd",
      message: `${toolName} session directory was missing; resume is disabled`,
      line: null
    });
  }

  const updatedAt =
    toIso(row.session_time_updated) ??
    toIso(row.session_time_created) ??
    fallbackUpdatedAt;
  const resumeStatus = !nativeSessionId ? "missing_session_id" : !cwd ? "missing_cwd" : fs.existsSync(cwd) ? "ready" : "cwd_missing";
  const stableId = nativeSessionId ?? `${normalizeFsPath(context.sourceFile)}:${index}`;

  return {
    id: `${toolId}:${stableId}`,
    toolId,
    nativeSessionId,
    title: title.slice(0, 180),
    summary: null,
    originalCwd: cwd,
    normalizedCwd: cwd ? normalizeFsPath(cwd) : null,
    updatedAt,
    sourceFile: context.sourceFile,
    sourceFormat: context.sourceFormat ?? "opencode-sqlite",
    parserVersion: context.parserVersion,
    resumeStatus,
    indexedAt: nowIso()
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function usablePath(value: string | null): string | null {
  if (!value || value === "/" || value === ".") return null;
  return value;
}
