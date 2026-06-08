import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/server/storage/database.js";
import { normalizeFsPath } from "../src/server/core/pathUtils.js";
import type { SessionEntry, ToolId } from "../src/shared/types.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;

afterEach(() => {
  if (directory) cleanup(directory);
  directory = null;
});

describe("AppDatabase", () => {
  it("initializes schema and reloads projects", () => {
    directory = testDir("db-reload");
    const projectRoot = path.join(directory, "project");
    fs.mkdirSync(projectRoot);

    const db = new AppDatabase(directory);
    const added = db.addProject(projectRoot, true).project;
    db.close();

    const reopened = new AppDatabase(directory);
    expect(reopened.listProjects()).toMatchObject([
      {
        id: added.id,
        rootPath: projectRoot,
        includeSubdirectories: true
      }
    ]);
    reopened.close();
  });

  it("merges child projects into a later parent project", () => {
    directory = testDir("db-parent-child");
    const parent = path.join(directory, "repo");
    const child = path.join(parent, "packages", "ui");
    fs.mkdirSync(child, { recursive: true });

    const db = new AppDatabase(directory);
    db.addProject(child);
    const result = db.addProject(parent);

    expect(result.removedChildren).toHaveLength(1);
    expect(result.project.includeSubdirectories).toBe(true);
    expect(db.listProjects()).toHaveLength(1);
    db.close();
  });

  it("collapses stale nested projects when reopening the index", () => {
    directory = testDir("db-stale-parent-child");
    const parent = path.join(directory, "workspace");
    const child = path.join(parent, "lark");
    fs.mkdirSync(child, { recursive: true });

    const raw = new DatabaseSync(path.join(directory, "index.sqlite"));
    raw.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        normalized_root_path TEXT NOT NULL UNIQUE,
        include_subdirectories INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    raw
      .prepare(
        `INSERT INTO projects (id, root_path, normalized_root_path, include_subdirectories, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("child", child, normalizeFsPath(child), 0, "2026-06-01T06:01:43.723Z", "2026-06-01T06:01:43.723Z");
    raw
      .prepare(
        `INSERT INTO projects (id, root_path, normalized_root_path, include_subdirectories, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("parent", parent, normalizeFsPath(parent), 0, "2026-06-01T06:24:59.129Z", "2026-06-01T06:24:59.129Z");
    raw.close();

    const db = new AppDatabase(directory);
    const projects = db.listProjects();

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: "parent",
      rootPath: parent,
      includeSubdirectories: true
    });
    db.close();
  });

  it("sorts projects by latest session activity with empty projects last", () => {
    directory = testDir("db-project-session-sort");
    const oldRoot = path.join(directory, "old-repo");
    const recentRoot = path.join(directory, "recent-repo");
    const emptyRoot = path.join(directory, "empty-repo");
    fs.mkdirSync(oldRoot, { recursive: true });
    fs.mkdirSync(recentRoot, { recursive: true });
    fs.mkdirSync(emptyRoot, { recursive: true });

    const db = new AppDatabase(directory);
    const recentProject = db.addProject(recentRoot).project;
    const oldProject = db.addProject(oldRoot).project;
    const emptyProject = db.addProject(emptyRoot).project;
    db.upsertSession(session("codex:old", "codex", oldRoot, "2026-06-01T01:00:00Z"));
    db.upsertSession(session("claude:recent", "claude", recentRoot, "2026-06-02T01:00:00Z"));

    expect(db.listProjects().map((project) => project.id)).toEqual([recentProject.id, oldProject.id, emptyProject.id]);
    db.close();
  });

  it("reports the data directory when the sqlite database is locked", () => {
    directory = testDir("db-locked");
    const databasePath = path.join(directory, "index.sqlite");
    const locker = new DatabaseSync(databasePath);

    try {
      locker.exec("CREATE TABLE lock_holder (id INTEGER PRIMARY KEY);");
      locker.exec("BEGIN EXCLUSIVE;");

      expect(() => new AppDatabase(directory as string, { busyTimeoutMs: 1 })).toThrow(
        /Database is locked: .*index\.sqlite.*Another Local AI Workbench process/
      );
    } finally {
      locker.exec("ROLLBACK;");
      locker.close();
    }
  });
});

function session(id: string, toolId: ToolId, cwd: string, updatedAt: string): SessionEntry {
  return {
    id,
    toolId,
    nativeSessionId: id,
    title: id,
    summary: null,
    originalCwd: cwd,
    normalizedCwd: normalizeFsPath(cwd),
    updatedAt,
    sourceFile: `${id}.jsonl`,
    sourceFormat: `${toolId}-jsonl`,
    parserVersion: "test",
    resumeStatus: "ready",
    indexedAt: updatedAt
  };
}
