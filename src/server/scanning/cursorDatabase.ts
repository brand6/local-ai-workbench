import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ParserWarning, SessionEntry } from "../../shared/types.js";
import { parseSessionEvents } from "./sessionParser.js";

type Row = Record<string, unknown>;

export interface CursorDatabaseParseContext {
  parserVersion: string;
  sourceFile: string;
  scanRunId: string | null;
}

export interface ParsedCursorDatabase {
  sessions: SessionEntry[];
  warnings: Array<Omit<ParserWarning, "id" | "createdAt">>;
  skipped: boolean;
}

export function parseCursorDatabaseFile(context: CursorDatabaseParseContext): ParsedCursorDatabase {
  const warnings: Array<Omit<ParserWarning, "id" | "createdAt">> = [];
  let events: unknown[];

  try {
    const db = new DatabaseSync(context.sourceFile);
    try {
      events = cursorDatabaseEvents(db, context.sourceFile);
    } finally {
      db.close();
    }
  } catch (error) {
    warnings.push({
      scanRunId: context.scanRunId,
      toolId: "cursor",
      sourceFile: context.sourceFile,
      errorType: "cursor-sqlite-read-failed",
      message: error instanceof Error ? error.message : "Cursor SQLite session source could not be read",
      line: null
    });
    return { sessions: [], warnings, skipped: true };
  }

  const parsed = parseSessionEvents(
    {
      toolId: "cursor",
      parserVersion: context.parserVersion,
      sourceFormat: "cursor-sqlite",
      sourceFile: context.sourceFile,
      scanRunId: context.scanRunId
    },
    events,
    fs.statSync(context.sourceFile),
    warnings
  );

  return {
    sessions: parsed.session ? [parsed.session] : [],
    warnings: parsed.warnings,
    skipped: parsed.skipped
  };
}

function cursorDatabaseEvents(db: DatabaseSync, sourceFile: string): unknown[] {
  const events: unknown[] = [];
  const inferredId = inferCursorChatId(sourceFile);
  if (inferredId) events.push({ chatId: inferredId });

  for (const table of sqliteTables(db)) {
    const columns = sqliteColumns(db, table);
    if (columns.size === 0) continue;
    const rows = db.prepare(`SELECT * FROM ${quoteSqliteIdentifier(table)} LIMIT 500`).all() as Row[];
    if (hasKeyValueColumns(columns)) {
      const aggregate: Row = {};
      for (const row of rows) {
        const key = stringValue(row.key) ?? stringValue(row.name);
        const value = row.value ?? row.json ?? row.data ?? row.body;
        if (key) aggregate[key] = decodedValue(value);
      }
      events.push(aggregate);
    }

    for (const row of rows) {
      events.push(decodedRow(row));
    }
  }

  return events;
}

function sqliteTables(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => String((row as Row).name))
    .filter(Boolean);
}

function sqliteColumns(db: DatabaseSync, table: string): Set<string> {
  return new Set(
    db
      .prepare(`PRAGMA table_info(${quoteSqliteIdentifier(table)})`)
      .all()
      .map((row) => String((row as Row).name))
      .filter(Boolean)
  );
}

function hasKeyValueColumns(columns: Set<string>): boolean {
  return (columns.has("key") || columns.has("name")) && (columns.has("value") || columns.has("json") || columns.has("data") || columns.has("body"));
}

function decodedRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, decodedValue(value)]));
}

function decodedValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return decodedValue(Buffer.from(value).toString("utf8"));
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function inferCursorChatId(sourceFile: string): string | null {
  const id = path.basename(path.dirname(sourceFile));
  return /^[a-zA-Z0-9_-]{8,}$/.test(id) ? id : null;
}

function quoteSqliteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
