import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface OpencodeSessionFixture {
  id: string;
  directory: string;
  title: string;
  parts?: unknown[];
  slug?: string;
  projectId?: string;
  projectWorktree?: string;
  timeCreated?: number;
  timeUpdated?: number;
}

export function createOpencodeDb(sourceFile: string, sessions: OpencodeSessionFixture[]): void {
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  const db = new DatabaseSync(sourceFile);
  try {
    db.exec(`
      CREATE TABLE project (
        id TEXT PRIMARY KEY,
        worktree TEXT NOT NULL,
        name TEXT,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL
      );

      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        directory TEXT NOT NULL,
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL
      );

      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);

    const insertProject = db.prepare(
      "INSERT INTO project (id, worktree, name, time_created, time_updated) VALUES (?, ?, ?, ?, ?)"
    );
    const insertSession = db.prepare(
      "INSERT INTO session (id, project_id, directory, title, slug, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertPart = db.prepare(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)"
    );

    const projectIds = new Set<string>();
    for (const session of sessions) {
      const projectId = session.projectId ?? "global";
      if (!projectIds.has(projectId)) {
        insertProject.run(
          projectId,
          session.projectWorktree ?? "/",
          null,
          session.timeCreated ?? 1780000000000,
          session.timeUpdated ?? 1780000000000
        );
        projectIds.add(projectId);
      }

      insertSession.run(
        session.id,
        projectId,
        session.directory,
        session.title,
        session.slug ?? session.id,
        session.timeCreated ?? 1780000000000,
        session.timeUpdated ?? 1780000000000
      );

      for (const [index, part] of (session.parts ?? []).entries()) {
        insertPart.run(
          `${session.id}:part:${index}`,
          `${session.id}:message`,
          session.id,
          session.timeCreated ?? 1780000000000,
          session.timeUpdated ?? 1780000000000,
          JSON.stringify(part)
        );
      }
    }
  } finally {
    db.close();
  }
}
