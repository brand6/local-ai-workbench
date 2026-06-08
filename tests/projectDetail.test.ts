import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/server/storage/database.js";
import { normalizeFsPath } from "../src/server/core/pathUtils.js";
import type { SessionEntry } from "../src/shared/types.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;

afterEach(() => {
  if (directory) cleanup(directory);
  directory = null;
});

describe("project detail grouping", () => {
  it("groups root and child sessions, sorts tools, and filters title/summary", () => {
    directory = testDir("project-detail");
    const root = path.join(directory, "repo");
    const child = path.join(root, "packages", "ui");
    fs.mkdirSync(child, { recursive: true });

    const db = new AppDatabase(directory);
    const project = db.addProject(root, true).project;
    db.upsertSession(session("codex:1", "codex", root, "根目录工作", null, "2026-06-01T01:00:00Z"));
    db.upsertSession(session("claude:1", "claude", child, "子目录修复", "包含按钮状态", "2026-06-01T03:00:00Z"));
    db.upsertSession(session("codex:2", "codex", child, "子目录实现", null, "2026-06-01T02:00:00Z"));

    const detail = db.createProjectDetail(project.id);
    expect(detail?.groups[0]?.isRoot).toBe(true);
    expect(detail?.groups[1]?.label).toContain(path.join("packages", "ui"));
    expect(detail?.groups[1]?.tools[0]?.toolId).toBe("claude");

    const filtered = db.createProjectDetail(project.id, "按钮");
    expect(filtered?.groups.flatMap((group) => group.tools.flatMap((tool) => tool.sessions))).toHaveLength(1);
    db.close();
  });

  it("can build a summary without session details", () => {
    directory = testDir("project-detail-summary");
    const root = path.join(directory, "repo");
    fs.mkdirSync(root, { recursive: true });

    const db = new AppDatabase(directory);
    const project = db.addProject(root, true).project;
    db.upsertSession(session("codex:1", "codex", root, "根目录工作", null, "2026-06-01T01:00:00Z"));
    db.upsertSession(session("codex:2", "codex", root, "第二个会话", null, "2026-06-01T02:00:00Z"));

    const detail = db.createProjectDetail(project.id, "", { includeSessions: false });
    expect(detail?.groups[0]?.sessionCount).toBe(2);
    expect(detail?.groups[0]?.tools[0]).toMatchObject({
      toolId: "codex",
      sessionCount: 2,
      latestActivity: "2026-06-01T02:00:00Z",
      sessions: []
    });
    db.close();
  });
});

function session(id: string, toolId: "codex" | "claude", cwd: string, title: string, summary: string | null, updatedAt: string): SessionEntry {
  return {
    id,
    toolId,
    nativeSessionId: id,
    title,
    summary,
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
