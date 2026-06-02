import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { refreshAllSessions, refreshProjectSessions, refreshSessionFiles } from "../src/server/scanning/sessionScanner.js";
import { AppDatabase } from "../src/server/storage/database.js";
import type { AppConfig, SessionEntry } from "../src/shared/types.js";
import { cleanup, testDir } from "./helpers.js";
import { createOpencodeDb } from "./opencodeDb.js";

let directory: string | null = null;

afterEach(() => {
  if (directory) cleanup(directory);
  directory = null;
});

describe("session scanner", () => {
  it("ignores Claude subagent metadata files because they are not resumable sessions", () => {
    directory = testDir("scanner-claude-meta");
    const claudeProjects = path.join(directory, ".claude", "projects");
    const subagents = path.join(claudeProjects, "E--new-ai-game", "session-123", "subagents");
    fs.mkdirSync(subagents, { recursive: true });
    fs.writeFileSync(
      path.join(subagents, "agent-1.meta.json"),
      JSON.stringify({ agentType: "Explore", description: "搜索 Godot 4.6 Web export 关键约束" })
    );

    const db = new AppDatabase(directory);
    db.addParserWarning({
      scanRunId: "previous-scan",
      toolId: "claude",
      sourceFile: path.join(subagents, "agent-1.meta.json"),
      errorType: "missing-cwd",
      message: "Session cwd was missing; resume is disabled",
      line: null
    });

    const result = refreshAllSessions(db, configWithClaudeSource(claudeProjects, directory));
    const sessions = db.listSessions();
    const warnings = db.listParserWarnings();
    db.close();

    expect(result.indexedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.warningCount).toBe(0);
    expect(sessions).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("ignores Claude tool result JSON files because they are not resumable sessions", () => {
    directory = testDir("scanner-claude-tool-results");
    const claudeProjects = path.join(directory, ".claude", "projects");
    const toolResults = path.join(claudeProjects, "E--san-guo-game", "session-123", "tool-results");
    const sourceFile = path.join(toolResults, "toolu_123.json");
    fs.mkdirSync(toolResults, { recursive: true });
    fs.writeFileSync(
      sourceFile,
      JSON.stringify([{ type: "text", text: "{\n  \"warningCount\": 1\n}" }], null, 2)
    );

    const db = new AppDatabase(directory);
    db.addParserWarning({
      scanRunId: "previous-scan",
      toolId: "claude",
      sourceFile,
      errorType: "malformed-jsonl",
      message: "Unexpected token ']', \"]\" is not valid JSON",
      line: null
    });
    db.upsertSession({
      id: `claude:${sourceFile.toLowerCase()}`,
      toolId: "claude",
      nativeSessionId: null,
      title: "未命名会话 toolu_123.json",
      summary: null,
      originalCwd: null,
      normalizedCwd: null,
      updatedAt: "2026-06-01T01:00:00.000Z",
      sourceFile,
      sourceFormat: "claude-jsonl",
      parserVersion: "old-parser",
      resumeStatus: "missing_session_id",
      indexedAt: "2026-06-01T01:00:00.000Z"
    });

    const result = refreshAllSessions(db, configWithClaudeSource(claudeProjects, directory));
    const sessions = db.listSessions();
    const warnings = db.listParserWarnings();
    db.close();

    expect(result.indexedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.warningCount).toBe(0);
    expect(sessions).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("refreshes project warning-only Claude metadata files and removes stale skipped sessions", () => {
    directory = testDir("scanner-project-claude-meta-warning");
    const projectRoot = path.join(directory, "san-guo-game");
    const claudeProjects = path.join(directory, ".claude", "projects");
    const sourceFile = path.join(
      claudeProjects,
      projectRoot.replace(/[:\\/]/g, "-"),
      "session-123",
      "subagents",
      "agent-1.meta.json"
    );
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(sourceFile, JSON.stringify({ agentType: "qa-tester", description: "QA 可测试性评审" }));

    const db = new AppDatabase(directory);
    const project = db.addProject(projectRoot, true).project;
    db.addParserWarning({
      scanRunId: "previous-scan",
      toolId: "claude",
      sourceFile,
      errorType: "missing-cwd",
      message: "Session cwd was missing; resume is disabled",
      line: null
    });
    db.upsertSession({
      id: `claude:${sourceFile.toLowerCase()}`,
      toolId: "claude",
      nativeSessionId: null,
      title: "未命名会话 agent-1.meta.json",
      summary: null,
      originalCwd: null,
      normalizedCwd: null,
      updatedAt: "2026-06-01T01:00:00.000Z",
      sourceFile,
      sourceFormat: "claude-jsonl",
      parserVersion: "old-parser",
      resumeStatus: "missing_session_id",
      indexedAt: "2026-06-01T01:00:00.000Z"
    });

    const result = refreshProjectSessions(db, project);
    const sessions = db.listSessions();
    const warnings = db.listParserWarnings();
    db.close();

    expect(result.skippedCount).toBe(1);
    expect(result.warningCount).toBe(0);
    expect(sessions).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("ignores Copilot VS Code metadata files because they are not resumable sessions", () => {
    directory = testDir("scanner-copilot-metadata");
    const copilotState = path.join(directory, ".copilot", "session-state");
    const sessionDirectory = path.join(copilotState, "2d674f5e-de7a-4c8a-977d-230bf890b39b");
    const metadataFile = path.join(sessionDirectory, "vscode.metadata.json");
    fs.mkdirSync(sessionDirectory, { recursive: true });
    fs.writeFileSync(metadataFile, JSON.stringify({ workspace: "metadata only" }));

    const db = new AppDatabase(directory);
    db.addParserWarning({
      scanRunId: "previous-scan",
      toolId: "copilot",
      sourceFile: metadataFile,
      errorType: "missing-cwd",
      message: "Session cwd was missing; resume is disabled",
      line: null
    });

    const result = refreshAllSessions(db, configWithCopilotSource(copilotState, directory));
    const sessions = db.listSessions();
    const warnings = db.listParserWarnings();
    db.close();

    expect(result.indexedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.warningCount).toBe(0);
    expect(sessions).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("removes stale sessions when a source file is now skipped", () => {
    directory = testDir("scanner-stale-skipped");
    const cwd = path.join(directory, "repo");
    fs.mkdirSync(cwd);
    const sourceFile = path.join(directory, "agent-sidechain.jsonl");
    fs.writeFileSync(
      sourceFile,
      JSON.stringify({
        isSidechain: true,
        sessionId: "claude-sidechain-123",
        cwd,
        type: "user",
        message: { role: "user", content: "子代理任务" },
        timestamp: "2026-06-01T01:00:00Z"
      })
    );

    const db = new AppDatabase(directory);
    db.upsertSession(session("claude:claude-sidechain-123", "Read", cwd, sourceFile));

    const result = refreshSessionFiles(db, [{ toolId: "claude", sourceFile }]);

    expect(result.skippedCount).toBe(1);
    expect(db.listSessions()).toHaveLength(0);
    db.close();
  });

  it("refreshes only source files already indexed under the selected project", () => {
    directory = testDir("scanner-project-refresh");
    const projectRoot = path.join(directory, "repo");
    const otherRoot = path.join(directory, "other");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(otherRoot, { recursive: true });
    const projectSource = path.join(directory, "project-session.jsonl");
    const otherSource = path.join(directory, "other-session.jsonl");
    fs.writeFileSync(
      projectSource,
      [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "更新项目会话标题" },
          sessionId: "project-123",
          cwd: projectRoot,
          timestamp: "2026-06-01T02:00:00Z"
        })
      ].join("\n")
    );
    fs.writeFileSync(
      otherSource,
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "不应被项目刷新碰到" },
        sessionId: "other-123",
        cwd: otherRoot,
        timestamp: "2026-06-01T02:00:00Z"
      })
    );

    const db = new AppDatabase(directory);
    const project = db.addProject(projectRoot).project;
    db.upsertSession(session("claude:project-123", "Read", projectRoot, projectSource));
    db.upsertSession(session("claude:other-123", "Other", otherRoot, otherSource));

    const result = refreshProjectSessions(db, project);

    expect(result.indexedCount).toBe(1);
    expect(db.getSession("claude:project-123")?.title).toBe("更新项目会话标题");
    expect(db.getSession("claude:other-123")?.title).toBe("Other");
    db.close();
  });

  it("indexes multiple OpenCode sessions from the SQLite database source", () => {
    directory = testDir("scanner-opencode-sqlite");
    const projectRoot = path.join(directory, "opencode-game-studios");
    const opencodeDb = path.join(directory, ".local", "share", "opencode", "opencode.db");
    fs.mkdirSync(projectRoot, { recursive: true });
    createOpencodeDb(opencodeDb, [
      {
        id: "ses_opencode_1",
        directory: projectRoot,
        title: "项目 AI 文档体系初始化",
        timeUpdated: 1780000001000
      },
      {
        id: "ses_opencode_2",
        directory: projectRoot,
        title: "技能文档一致性分析",
        timeUpdated: 1780000002000
      }
    ]);

    const db = new AppDatabase(directory);
    const result = refreshAllSessions(db, configWithOpencodeSource(opencodeDb, directory));
    const sessions = db.listSessions();
    db.close();

    expect(result.indexedCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(sessions.map((session) => session.id).sort()).toEqual(["opencode:ses_opencode_1", "opencode:ses_opencode_2"]);
    expect(sessions[0]).toMatchObject({
      toolId: "opencode",
      sourceFile: opencodeDb,
      sourceFormat: "opencode-sqlite",
      originalCwd: projectRoot,
      resumeStatus: "ready"
    });
  });
});

function configWithClaudeSource(claudeProjects: string, directory: string): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex", sessionSources: [path.join(directory, "missing-codex-sessions")] },
      claude: { command: "claude", sessionSources: [claudeProjects] },
      opencode: { command: "opencode", sessionSources: [path.join(directory, "missing-opencode-sessions")] },
      qwen: { command: "qwen", sessionSources: [path.join(directory, "missing-qwen-sessions")] },
      qoder: { command: "qodercli", sessionSources: [path.join(directory, "missing-qoder-sessions")] },
      copilot: { command: "copilot", sessionSources: [path.join(directory, "missing-copilot-sessions")] }
    },
    terminal: { mode: "new-window" }
  };
}

function configWithCopilotSource(copilotState: string, directory: string): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex", sessionSources: [path.join(directory, "missing-codex-sessions")] },
      claude: { command: "claude", sessionSources: [path.join(directory, "missing-claude-sessions")] },
      opencode: { command: "opencode", sessionSources: [path.join(directory, "missing-opencode-sessions")] },
      qwen: { command: "qwen", sessionSources: [path.join(directory, "missing-qwen-sessions")] },
      qoder: { command: "qodercli", sessionSources: [path.join(directory, "missing-qoder-sessions")] },
      copilot: { command: "copilot", sessionSources: [copilotState] }
    },
    terminal: { mode: "new-window" }
  };
}

function configWithOpencodeSource(opencodeDb: string, directory: string): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex", sessionSources: [path.join(directory, "missing-codex-sessions")] },
      claude: { command: "claude", sessionSources: [path.join(directory, "missing-claude-sessions")] },
      opencode: { command: "opencode", sessionSources: [opencodeDb] },
      qwen: { command: "qwen", sessionSources: [path.join(directory, "missing-qwen-sessions")] },
      qoder: { command: "qodercli", sessionSources: [path.join(directory, "missing-qoder-sessions")] },
      copilot: { command: "copilot", sessionSources: [path.join(directory, "missing-copilot-sessions")] }
    },
    terminal: { mode: "new-window" }
  };
}

function session(id: string, title: string, cwd: string, sourceFile: string): SessionEntry {
  return {
    id,
    toolId: "claude",
    nativeSessionId: id.replace(/^claude:/, ""),
    title,
    summary: null,
    originalCwd: cwd,
    normalizedCwd: cwd.toLowerCase(),
    updatedAt: "2026-06-01T01:00:00.000Z",
    sourceFile,
    sourceFormat: "claude-jsonl",
    parserVersion: "test",
    resumeStatus: "ready",
    indexedAt: "2026-06-01T01:00:00.000Z"
  };
}
