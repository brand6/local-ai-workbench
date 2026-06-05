import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/shared/types.js";
import type { AppEvent } from "../src/server/events/appEvents.js";
import { SessionIndexService } from "../src/server/scanning/sessionIndexService.js";
import { AppDatabase } from "../src/server/storage/database.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;

afterEach(() => {
  vi.useRealTimers();
  if (directory) cleanup(directory);
  directory = null;
});

describe("session index service", () => {
  it("indexes changed source files and emits a session change event", () => {
    directory = testDir("session-index-service-changed");
    const projectRoot = path.join(directory, "repo");
    const sessionSource = path.join(directory, "sessions");
    const sourceFile = path.join(sessionSource, "codex-session.jsonl");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(sessionSource, { recursive: true });
    writeCodexSession(sourceFile, projectRoot, "auto-1", "初始会话");

    const db = new AppDatabase(directory);
    const events: AppEvent[] = [];
    const service = new SessionIndexService({
      database: () => db,
      config: () => configWithCodexSource(sessionSource, directory ?? ""),
      events: { emit: (event) => events.push(event) }
    });

    const firstRun = service.runOnce("test");
    expect(firstRun).toMatchObject({ changedSourceCount: 1, addedProjectCount: 1 });
    expect(db.getSession("codex:auto-1")).toMatchObject({ title: "初始会话", originalCwd: projectRoot });
    expect(events[0]).toMatchObject({ type: "sessions:changed", indexedCount: 1, addedProjectCount: 1 });

    events.length = 0;
    expect(service.runOnce("test")).toBeNull();
    expect(events).toHaveLength(0);

    writeCodexSession(sourceFile, projectRoot, "auto-1", "更新后的会话标题");
    const secondRun = service.runOnce("test");

    expect(secondRun).toMatchObject({ changedSourceCount: 1, addedProjectCount: 0 });
    expect(db.getSession("codex:auto-1")).toMatchObject({ title: "更新后的会话标题" });
    expect(events[0]).toMatchObject({ type: "sessions:changed", indexedCount: 1 });
    db.close();
  });

  it("removes indexed sessions when a tracked source file is deleted", () => {
    directory = testDir("session-index-service-deleted");
    const projectRoot = path.join(directory, "repo");
    const sessionSource = path.join(directory, "sessions");
    const sourceFile = path.join(sessionSource, "codex-session.jsonl");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(sessionSource, { recursive: true });
    writeCodexSession(sourceFile, projectRoot, "auto-delete-1", "待删除会话");

    const db = new AppDatabase(directory);
    const events: AppEvent[] = [];
    const service = new SessionIndexService({
      database: () => db,
      config: () => configWithCodexSource(sessionSource, directory ?? ""),
      events: { emit: (event) => events.push(event) }
    });

    service.runOnce("test");
    expect(db.getSession("codex:auto-delete-1")).not.toBeNull();
    events.length = 0;

    fs.unlinkSync(sourceFile);
    const deletedRun = service.runOnce("test");

    expect(deletedRun).toMatchObject({ removedSourceCount: 1, removedSessionCount: 1 });
    expect(db.getSession("codex:auto-delete-1")).toBeNull();
    expect(events[0]).toMatchObject({ type: "sessions:changed", removedSourceCount: 1, removedSessionCount: 1 });
    db.close();
  });

  it("persists source fingerprints so restart startup checks stay incremental", () => {
    directory = testDir("session-index-service-persisted-fingerprints");
    const projectRoot = path.join(directory, "repo");
    const sessionSource = path.join(directory, "sessions");
    const sourceFile = path.join(sessionSource, "codex-session.jsonl");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(sessionSource, { recursive: true });
    writeCodexSession(sourceFile, projectRoot, "auto-persist-1", "持久化指纹");

    let db = new AppDatabase(directory);
    const firstEvents: AppEvent[] = [];
    const firstService = new SessionIndexService({
      database: () => db,
      config: () => configWithCodexSource(sessionSource, directory ?? ""),
      events: { emit: (event) => firstEvents.push(event) }
    });

    expect(firstService.runOnce("startup")).toMatchObject({ changedSourceCount: 1 });
    expect(firstEvents[0]).toMatchObject({ type: "sessions:changed", indexedCount: 1 });
    db.close();

    db = new AppDatabase(directory);
    const restartEvents: AppEvent[] = [];
    const restartedService = new SessionIndexService({
      database: () => db,
      config: () => configWithCodexSource(sessionSource, directory ?? ""),
      events: { emit: (event) => restartEvents.push(event) }
    });

    expect(restartedService.runOnce("startup")).toBeNull();
    expect(restartEvents).toHaveLength(0);
    db.close();
  });

  it("does not block service startup while indexing the first batch", () => {
    vi.useFakeTimers();
    directory = testDir("session-index-service-startup-async");
    const projectRoot = path.join(directory, "repo");
    const sessionSource = path.join(directory, "sessions");
    const sourceFile = path.join(sessionSource, "codex-session.jsonl");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(sessionSource, { recursive: true });
    writeCodexSession(sourceFile, projectRoot, "auto-start-1", "启动后台索引");

    const db = new AppDatabase(directory);
    const events: AppEvent[] = [];
    const service = new SessionIndexService({
      database: () => db,
      config: () => configWithCodexSource(sessionSource, directory ?? ""),
      events: { emit: (event) => events.push(event) }
    });

    service.start();

    expect(db.getSession("codex:auto-start-1")).toBeNull();
    expect(events).toHaveLength(0);

    vi.advanceTimersByTime(0);

    expect(db.getSession("codex:auto-start-1")).toMatchObject({ title: "启动后台索引", originalCwd: projectRoot });
    expect(events[0]).toMatchObject({ type: "sessions:changed", reason: "startup", indexedCount: 1 });

    service.stop();
    db.close();
  });
});

function writeCodexSession(sourceFile: string, cwd: string, id: string, title: string): void {
  fs.writeFileSync(
    sourceFile,
    JSON.stringify({
      session_meta: { payload: { id, cwd } },
      title,
      timestamp: "2026-06-02T12:30:00Z"
    })
  );
}

function configWithCodexSource(codexSessions: string, directory: string): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex", sessionSources: [codexSessions] },
      claude: { command: "claude", sessionSources: [path.join(directory, "missing-claude-sessions")] },
      cline: { command: "cline", sessionSources: [path.join(directory, "missing-cline-sessions")] },
      opencode: { command: "opencode", sessionSources: [path.join(directory, "missing-opencode-sessions")] },
      qwen: { command: "qwen", sessionSources: [path.join(directory, "missing-qwen-sessions")] },
      deepcode: { command: "deepcode", sessionSources: [path.join(directory, "missing-deepcode-sessions")] },
      kimi: { command: "kimi", sessionSources: [path.join(directory, "missing-kimi-sessions")] },
      qoder: { command: "qodercli", sessionSources: [path.join(directory, "missing-qoder-sessions")] },
      codebuddy: { command: "codebuddy", sessionSources: [path.join(directory, "missing-codebuddy-sessions")] },
      copilot: { command: "copilot", sessionSources: [path.join(directory, "missing-copilot-sessions")] },
      cursor: { command: "cursor-agent", sessionSources: [path.join(directory, "missing-cursor-sessions")] },
      antigravity: { command: "agy", sessionSources: [path.join(directory, "missing-antigravity-sessions")] },
      reasonix: { command: "reasonix", sessionSources: [path.join(directory, "missing-reasonix-sessions")] }
    },
    terminal: { mode: "new-window" },
    skillhub: { rootDir: path.join(directory, "skillhub") }
  };
}
