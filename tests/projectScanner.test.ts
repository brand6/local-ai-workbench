import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/server/storage/database.js";
import { scanProjectCandidates, confirmScanCandidates } from "../src/server/scanning/projectScanner.js";
import { normalizeFsPath } from "../src/server/core/pathUtils.js";
import type { SessionEntry } from "../src/shared/types.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;

afterEach(() => {
  if (directory) cleanup(directory);
  directory = null;
});

describe("project scanner", () => {
  it("persists AI-first candidates but only confirms candidates with sessions", () => {
    directory = testDir("project-scanner");
    const workspace = path.join(directory, "workspace");
    const project = path.join(workspace, "repo");
    const traceOnly = path.join(workspace, "trace-only");
    const plainGit = path.join(workspace, "plain-git");
    fs.mkdirSync(path.join(project, ".codex"), { recursive: true });
    fs.mkdirSync(path.join(traceOnly, ".codex"), { recursive: true });
    fs.mkdirSync(path.join(plainGit, ".git"), { recursive: true });

    const db = new AppDatabase(directory);
    try {
      db.upsertSession(session("codex:1", project));
      const result = scanProjectCandidates(db, { scope: "directory", roots: [workspace] });

      expect(result.candidates.map((candidate) => candidate.path)).toEqual(expect.arrayContaining([project, traceOnly]));
      expect(result.candidates.map((candidate) => candidate.path)).not.toContain(plainGit);

      const added = confirmScanCandidates(db, result.scanRunId, result.candidates.map((candidate) => candidate.id));
      expect(added).toHaveLength(1);
      expect(db.listProjects()).toHaveLength(1);
      expect(db.listProjects()[0]?.rootPath).toBe(project);

      const traceOnlyCandidate = result.candidates.find((candidate) => candidate.path === traceOnly);
      expect(traceOnlyCandidate).toBeDefined();
      const addedWithEmpty = confirmScanCandidates(db, result.scanRunId, [traceOnlyCandidate!.id], {
        includeEmptyCandidates: true
      });
      expect(addedWithEmpty).toHaveLength(1);
      expect(db.listProjects().map((storedProject) => storedProject.rootPath)).toEqual(expect.arrayContaining([project, traceOnly]));
    } finally {
      db.close();
    }
  });
});

function session(id: string, cwd: string): SessionEntry {
  return {
    id,
    toolId: "codex",
    nativeSessionId: id,
    title: "已有会话",
    summary: null,
    originalCwd: cwd,
    normalizedCwd: normalizeFsPath(cwd),
    updatedAt: "2026-06-01T01:00:00Z",
    sourceFile: `${id}.jsonl`,
    sourceFormat: "codex-jsonl",
    parserVersion: "test",
    resumeStatus: "ready",
    indexedAt: "2026-06-01T01:00:00Z"
  };
}
