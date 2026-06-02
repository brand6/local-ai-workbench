import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { DeleteSessionResult, SessionEntry } from "../../shared/types.js";
import type { AppDatabase } from "../storage/database.js";

type Row = Record<string, unknown>;

export function deleteSession(database: AppDatabase, sessionId: string): DeleteSessionResult | null {
  const session = database.getSession(sessionId);
  if (!session) return null;

  if (session.sourceFormat === "opencode-sqlite") {
    const deletedNativeSession = deleteOpencodeSqliteSession(session);
    return {
      deleted: true,
      sessionId: session.id,
      sourceFile: session.sourceFile,
      sourceFormat: session.sourceFormat,
      deletedSourceFile: false,
      deletedNativeSession,
      removedIndexCount: database.deleteSession(session.id)
    };
  }

  const deletedSourceFile = deleteSourceFile(session.sourceFile);
  const removedIndexCount = database.deleteSessionsBySourceFile(session.toolId, session.sourceFile);
  database.deleteParserWarningsBySourceFile(session.toolId, session.sourceFile);

  return {
    deleted: true,
    sessionId: session.id,
    sourceFile: session.sourceFile,
    sourceFormat: session.sourceFormat,
    deletedSourceFile,
    deletedNativeSession: deletedSourceFile,
    removedIndexCount
  };
}

function deleteSourceFile(sourceFile: string): boolean {
  if (!fs.existsSync(sourceFile)) return false;
  if (!fs.statSync(sourceFile).isFile()) {
    throw new Error(`session-source-is-not-file: ${sourceFile}`);
  }
  fs.unlinkSync(sourceFile);
  return true;
}

function deleteOpencodeSqliteSession(session: SessionEntry): boolean {
  if (!session.nativeSessionId) {
    throw new Error("session-native-id-required");
  }
  if (!fs.existsSync(session.sourceFile)) return false;
  if (!fs.statSync(session.sourceFile).isFile()) {
    throw new Error(`session-source-is-not-file: ${session.sourceFile}`);
  }

  const db = new DatabaseSync(session.sourceFile);
  let changedRows = 0;

  db.exec("BEGIN;");
  try {
    const tables = sqliteTables(db);
    const sessionChildTables = tables
      .filter((tableName) => tableName !== "session")
      .filter((tableName) => sessionIdColumnName(sqliteColumns(db, tableName)))
      .sort((left, right) => sqliteDeletePriority(left) - sqliteDeletePriority(right) || left.localeCompare(right));

    for (const table of sessionChildTables) {
      const sessionIdColumn = sessionIdColumnName(sqliteColumns(db, table));
      if (!sessionIdColumn) continue;
      changedRows += Number(
        db
          .prepare(`DELETE FROM ${quoteSqliteIdentifier(table)} WHERE ${quoteSqliteIdentifier(sessionIdColumn)} = ?`)
          .run(session.nativeSessionId).changes
      );
    }

    if (!tables.includes("session")) {
      throw new Error("opencode-session-table-missing");
    }
    const sessionColumns = sqliteColumns(db, "session");
    if (!sessionColumns.has("id")) {
      throw new Error("opencode-session-id-column-missing");
    }
    changedRows += Number(
      db
        .prepare(`DELETE FROM ${quoteSqliteIdentifier("session")} WHERE ${quoteSqliteIdentifier("id")} = ?`)
        .run(session.nativeSessionId).changes
    );

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  } finally {
    db.close();
  }

  return changedRows > 0;
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

function sessionIdColumnName(columns: Set<string>): string | null {
  if (columns.has("session_id")) return "session_id";
  if (columns.has("sessionID")) return "sessionID";
  if (columns.has("sessionId")) return "sessionId";
  return null;
}

function sqliteDeletePriority(tableName: string): number {
  const normalized = tableName.toLowerCase();
  if (normalized.includes("part")) return 0;
  if (normalized.includes("message")) return 1;
  return 2;
}

function quoteSqliteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
