import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { deleteSession } from "../src/server/scanning/sessionDeletion.js";
import { refreshAllSessions, refreshProjectSessions, refreshSessionFiles } from "../src/server/scanning/sessionScanner.js";
import { AppDatabase } from "../src/server/storage/database.js";
import type { AppConfig, SessionEntry, ToolId } from "../src/shared/types.js";
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

    const result = refreshProjectSessions(db, configWithClaudeSource(claudeProjects, directory), project);
    const sessions = db.listSessions();
    const warnings = db.listParserWarnings();
    db.close();

    expect(result.skippedCount).toBe(1);
    expect(result.warningCount).toBe(0);
    expect(sessions).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("ignores Copilot metadata files because they are not resumable sessions", () => {
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

    const result = refreshProjectSessions(db, configWithClaudeSource(directory, directory), project);

    expect(result.indexedCount).toBe(1);
    expect(db.getSession("claude:project-123")?.title).toBe("更新项目会话标题");
    expect(db.getSession("claude:other-123")?.title).toBe("Other");
    db.close();
  });

  it("discovers new Codex session files when refreshing an existing project", () => {
    directory = testDir("scanner-project-discovers-codex");
    const projectRoot = path.join(directory, "repo");
    const sessionSource = path.join(directory, "codex-sessions");
    const oldSource = path.join(sessionSource, "old-session.jsonl");
    const newSource = path.join(sessionSource, "new-session.jsonl");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(sessionSource, { recursive: true });
    fs.writeFileSync(
      oldSource,
      JSON.stringify({
        session_meta: { payload: { id: "old-123", cwd: projectRoot } },
        title: "旧会话",
        timestamp: "2026-06-02T04:00:00Z"
      })
    );
    fs.writeFileSync(
      newSource,
      JSON.stringify({
        session_meta: { payload: { id: "new-123", cwd: projectRoot } },
        title: "下午新增会话",
        timestamp: "2026-06-02T12:30:00Z"
      })
    );

    const db = new AppDatabase(directory);
    const project = db.addProject(projectRoot).project;
    db.upsertSession(session("codex:old-123", "旧会话", projectRoot, oldSource, "codex"));

    const result = refreshProjectSessions(db, configWithCodexSource(sessionSource, directory), project);
    const sessionIds = db
      .listSessionsForProject(project)
      .map((entry) => entry.nativeSessionId)
      .sort();
    db.close();

    expect(result.indexedCount).toBe(2);
    expect(sessionIds).toEqual(["new-123", "old-123"]);
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

  it("indexes Kilo Code CLI sessions from the native SQLite database source", () => {
    directory = testDir("scanner-kilo-sqlite");
    const projectRoot = path.join(directory, "kilo-project");
    const kiloDb = path.join(directory, ".local", "share", "kilo", "kilo.db");
    fs.mkdirSync(projectRoot, { recursive: true });
    createOpencodeDb(kiloDb, [
      {
        id: "ses_kilo_1",
        directory: projectRoot,
        title: "Kilo 会话恢复",
        timeUpdated: 1780000003000
      }
    ]);

    const db = new AppDatabase(directory);
    const result = refreshAllSessions(db, configWithKiloSource(kiloDb, directory));
    const sessions = db.listSessions();
    const deleted = deleteSession(db, "kilo:ses_kilo_1");
    db.close();

    expect(result.indexedCount).toBe(1);
    expect(result.warningCount).toBe(0);
    expect(sessions[0]).toMatchObject({
      id: "kilo:ses_kilo_1",
      toolId: "kilo",
      nativeSessionId: "ses_kilo_1",
      sourceFile: kiloDb,
      sourceFormat: "kilo-sqlite",
      originalCwd: projectRoot,
      resumeStatus: "ready"
    });
    expect(deleted).toMatchObject({ deletedSourceFile: false, deletedNativeSession: true, removedIndexCount: 1 });
    expect(fs.existsSync(kiloDb)).toBe(true);
  });

  it("indexes Kimi Code sessions from the native session index", () => {
    directory = testDir("scanner-kimi-index");
    const projectRoot = path.join(directory, "kimi-project");
    const indexFile = path.join(directory, ".kimi-code", "session_index.jsonl");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(path.dirname(indexFile), { recursive: true });
    fs.writeFileSync(
      indexFile,
      [
        JSON.stringify({
          session_id: "kimi-1",
          workspaceRoot: projectRoot,
          title: "Kimi 会话恢复",
          updated_at: "2026-06-04T10:00:00Z"
        }),
        JSON.stringify({
          id: "kimi-2",
          projectPath: projectRoot,
          summary: "继续处理 CLI 接入",
          updated_at: "2026-06-04T11:00:00Z"
        })
      ].join("\n")
    );

    const db = new AppDatabase(directory);
    const result = refreshAllSessions(db, configWithKimiSource(indexFile, directory));
    const sessions = db.listSessions().sort((left, right) => left.id.localeCompare(right.id));
    db.close();

    expect(result.indexedCount).toBe(2);
    expect(result.warningCount).toBe(0);
    expect(sessions.map((session) => session.id)).toEqual(["kimi:kimi-1", "kimi:kimi-2"]);
    expect(sessions[0]).toMatchObject({
      toolId: "kimi",
      sourceFile: indexFile,
      sourceFormat: "kimi-code-index",
      originalCwd: projectRoot,
      resumeStatus: "ready"
    });
  });

  it("indexes CodeBuddy Code sessions from JSON session files", () => {
    directory = testDir("scanner-codebuddy-json");
    const projectRoot = path.join(directory, "codebuddy-project");
    const sessionsRoot = path.join(directory, ".codebuddy", "sessions");
    const sourceFile = path.join(sessionsRoot, "codebuddy-1.json");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(sessionsRoot, { recursive: true });
    fs.writeFileSync(
      sourceFile,
      JSON.stringify(
        {
          sessionId: "codebuddy-1",
          workspaceRoot: projectRoot,
          title: "CodeBuddy 会话",
          updatedAt: "2026-06-04T12:00:00Z"
        },
        null,
        2
      )
    );

    const db = new AppDatabase(directory);
    const result = refreshAllSessions(db, configWithCodeBuddySource(sessionsRoot, directory));
    const sessions = db.listSessions();
    db.close();

    expect(result.indexedCount).toBe(1);
    expect(sessions[0]).toMatchObject({
      id: "codebuddy:codebuddy-1",
      toolId: "codebuddy",
      nativeSessionId: "codebuddy-1",
      originalCwd: projectRoot,
      resumeStatus: "ready"
    });
  });

  it("indexes Cursor and Antigravity sessions from native JSON session sources", () => {
    directory = testDir("scanner-cursor-antigravity");
    const projectRoot = path.join(directory, "cursor-antigravity-project");
    const cursorSource = path.join(directory, ".cursor", "projects", "project-1", "agent-transcripts", "cursor-1.json");
    const antigravitySource = path.join(directory, ".gemini", "antigravity", "brain", "antigravity-1.jsonl");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(path.dirname(cursorSource), { recursive: true });
    fs.mkdirSync(path.dirname(antigravitySource), { recursive: true });
    fs.writeFileSync(
      cursorSource,
      JSON.stringify({
        chatId: "cursor-1",
        workspaceRoot: projectRoot,
        title: "Cursor 项目会话",
        updatedAt: "2026-06-05T10:00:00Z"
      })
    );
    fs.writeFileSync(
      antigravitySource,
      JSON.stringify({
        conversationId: "antigravity-1",
        projectRoot,
        title: "Antigravity 项目会话",
        updatedAt: "2026-06-05T11:00:00Z"
      })
    );

    const db = new AppDatabase(directory);
    const result = refreshAllSessions(db, configWithCursorAntigravitySources(path.dirname(cursorSource), path.dirname(antigravitySource), directory));
    const sessions = db.listSessions().sort((left, right) => left.id.localeCompare(right.id));
    db.close();

    expect(result.indexedCount).toBe(2);
    expect(result.warningCount).toBe(0);
    expect(sessions.map((session) => session.id)).toEqual(["antigravity:antigravity-1", "cursor:cursor-1"]);
    expect(sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolId: "cursor", sourceFormat: "cursor-json", originalCwd: projectRoot, resumeStatus: "ready" }),
        expect.objectContaining({ toolId: "antigravity", sourceFormat: "antigravity-json", originalCwd: projectRoot, resumeStatus: "ready" })
      ])
    );
  });

  it("indexes Cursor sessions from local store.db metadata", () => {
    directory = testDir("scanner-cursor-sqlite");
    const projectRoot = path.join(directory, "cursor-sqlite-project");
    const cursorDb = path.join(directory, ".cursor", "chats", "project-hash", "cursor-sqlite-1", "store.db");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(path.dirname(cursorDb), { recursive: true });
    const sqlite = new DatabaseSync(cursorDb);
    try {
      sqlite.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);");
      sqlite.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)").run("workspaceRoot", projectRoot);
      sqlite.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)").run("title", "Cursor SQLite 会话");
      sqlite.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)").run("updatedAt", "2026-06-05T12:00:00Z");
    } finally {
      sqlite.close();
    }

    const db = new AppDatabase(directory);
    const result = refreshAllSessions(db, configWithCursorAntigravitySources(path.join(directory, ".cursor", "chats"), path.join(directory, "missing-antigravity"), directory));
    const sessions = db.listSessions();
    const deleted = deleteSession(db, "cursor:cursor-sqlite-1");
    db.close();

    expect(result.indexedCount).toBe(1);
    expect(result.warningCount).toBe(0);
    expect(sessions[0]).toMatchObject({
      id: "cursor:cursor-sqlite-1",
      toolId: "cursor",
      sourceFormat: "cursor-sqlite",
      originalCwd: projectRoot,
      resumeStatus: "ready"
    });
    expect(deleted).toMatchObject({ deletedSourceFile: false, deletedNativeSession: false, removedIndexCount: 1 });
    expect(fs.existsSync(cursorDb)).toBe(true);
  });

  it("indexes Cline sessions from a SQLite session store without deleting the source database", () => {
    directory = testDir("scanner-cline-sqlite");
    const projectRoot = path.join(directory, "cline-project");
    const clineDb = path.join(directory, ".cline", "data", "sessions", "history.db");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(path.dirname(clineDb), { recursive: true });
    const sqlite = new DatabaseSync(clineDb);
    try {
      sqlite.exec("CREATE TABLE sessions (taskId TEXT PRIMARY KEY, workspaceRoot TEXT, title TEXT, updatedAt TEXT);");
      sqlite.prepare("INSERT INTO sessions (taskId, workspaceRoot, title, updatedAt) VALUES (?, ?, ?, ?)").run(
        "cline-1",
        projectRoot,
        "Cline 会话",
        "2026-06-04T13:00:00Z"
      );
    } finally {
      sqlite.close();
    }

    const db = new AppDatabase(directory);
    const result = refreshAllSessions(db, configWithClineSource(clineDb, directory));
    const sessions = db.listSessions();
    db.close();

    expect(result.indexedCount).toBe(1);
    expect(sessions[0]).toMatchObject({
      id: "cline:cline-1",
      toolId: "cline",
      sourceFile: clineDb,
      sourceFormat: "cline-sqlite",
      originalCwd: projectRoot,
      resumeStatus: "ready"
    });
    expect(fs.existsSync(clineDb)).toBe(true);
  });

  it("indexes Reasonix JSONL sessions without treating sidecars as sessions", () => {
    directory = testDir("scanner-reasonix-jsonl");
    const projectRoot = path.join(directory, "reasonix-project");
    const sessionsRoot = path.join(directory, ".reasonix", "sessions");
    const sourceFile = path.join(sessionsRoot, "main.jsonl");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(sessionsRoot, { recursive: true });
    fs.writeFileSync(
      sourceFile,
      JSON.stringify({
        sessionName: "main",
        workspaceRoot: projectRoot,
        title: "Reasonix 会话恢复",
        updatedAt: "2026-06-05T13:30:00Z"
      })
    );
    fs.writeFileSync(path.join(sessionsRoot, "main.events.jsonl"), JSON.stringify({ type: "tool", sessionName: "main" }));
    fs.writeFileSync(path.join(sessionsRoot, "main.meta.json"), JSON.stringify({ sessionName: "main" }));

    const db = new AppDatabase(directory);
    const result = refreshAllSessions(db, configWithReasonixSource(sessionsRoot, directory));
    const sessions = db.listSessions();
    db.close();

    expect(result.indexedCount).toBe(1);
    expect(result.warningCount).toBe(0);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "reasonix:main",
      toolId: "reasonix",
      nativeSessionId: "main",
      sourceFile,
      sourceFormat: "reasonix-jsonl",
      originalCwd: projectRoot,
      resumeStatus: "ready"
    });
  });

  it("indexes Deep Code sessions from sessions-index.json without indexing message JSONL files", () => {
    directory = testDir("scanner-deepcode-index");
    const projectRoot = path.join(directory, "deepcode-project");
    const deepcodeProjectRoot = path.join(directory, ".deepcode", "projects", "deepcode-project");
    const indexFile = path.join(deepcodeProjectRoot, "sessions-index.json");
    const messageFile = path.join(deepcodeProjectRoot, "deepcode-session-1.jsonl");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(deepcodeProjectRoot, { recursive: true });
    fs.writeFileSync(
      indexFile,
      JSON.stringify(
        {
          version: 1,
          originalPath: projectRoot,
          entries: [
            {
              id: "deepcode-session-1",
              summary: "Deep Code 项目会话",
              status: "completed",
              updateTime: "2026-06-05T10:30:00Z"
            }
          ]
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      messageFile,
      JSON.stringify({
        id: "message-1",
        sessionId: "deepcode-session-1",
        role: "user",
        content: "这不是独立 session 文件",
        createTime: "2026-06-05T10:00:00Z"
      })
    );

    const db = new AppDatabase(directory);
    const result = refreshAllSessions(db, configWithDeepcodeSource(path.join(directory, ".deepcode", "projects"), directory));
    const sessions = db.listSessions();
    db.close();

    expect(result.indexedCount).toBe(1);
    expect(result.warningCount).toBe(0);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "deepcode:deepcode-session-1",
      toolId: "deepcode",
      nativeSessionId: "deepcode-session-1",
      sourceFile: indexFile,
      sourceFormat: "deepcode-index",
      originalCwd: projectRoot,
      resumeStatus: "ready"
    });
  });

  it("does not delete multi-session source files for index-backed sessions", () => {
    directory = testDir("scanner-multi-session-delete");
    const projectRoot = path.join(directory, "repo");
    const kimiIndex = path.join(directory, ".kimi-code", "session_index.jsonl");
    const deepcodeIndex = path.join(directory, ".deepcode", "projects", "repo", "sessions-index.json");
    const clineDb = path.join(directory, ".cline", "data", "sessions", "history.db");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(path.dirname(kimiIndex), { recursive: true });
    fs.mkdirSync(path.dirname(deepcodeIndex), { recursive: true });
    fs.mkdirSync(path.dirname(clineDb), { recursive: true });
    fs.writeFileSync(kimiIndex, JSON.stringify({ session_id: "kimi-delete", workspaceRoot: projectRoot }));
    fs.writeFileSync(deepcodeIndex, JSON.stringify({ version: 1, originalPath: projectRoot, entries: [{ id: "deepcode-delete" }] }));
    fs.writeFileSync(clineDb, "sqlite placeholder");

    const db = new AppDatabase(directory);
    db.upsertSession({
      ...session("kimi:kimi-delete", "Kimi", projectRoot, kimiIndex, "kimi"),
      sourceFormat: "kimi-code-index"
    });
    db.upsertSession({
      ...session("deepcode:deepcode-delete", "Deep Code", projectRoot, deepcodeIndex, "deepcode"),
      sourceFormat: "deepcode-index"
    });
    db.upsertSession({
      ...session("cline:cline-delete", "Cline", projectRoot, clineDb, "cline"),
      sourceFormat: "cline-sqlite"
    });

    const kimiDeleted = deleteSession(db, "kimi:kimi-delete");
    const deepcodeDeleted = deleteSession(db, "deepcode:deepcode-delete");
    const clineDeleted = deleteSession(db, "cline:cline-delete");
    db.close();

    expect(kimiDeleted).toMatchObject({ deletedSourceFile: false, deletedNativeSession: false, removedIndexCount: 1 });
    expect(deepcodeDeleted).toMatchObject({ deletedSourceFile: false, deletedNativeSession: false, removedIndexCount: 1 });
    expect(clineDeleted).toMatchObject({ deletedSourceFile: false, deletedNativeSession: false, removedIndexCount: 1 });
    expect(fs.existsSync(kimiIndex)).toBe(true);
    expect(fs.existsSync(deepcodeIndex)).toBe(true);
    expect(fs.existsSync(clineDb)).toBe(true);
  });
});

function configWithClaudeSource(claudeProjects: string, directory: string): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex", sessionSources: [path.join(directory, "missing-codex-sessions")] },
      claude: { command: "claude", sessionSources: [claudeProjects] },
      cline: { command: "cline", sessionSources: [path.join(directory, "missing-cline-sessions")] },
      opencode: { command: "opencode", sessionSources: [path.join(directory, "missing-opencode-sessions")] },
      kilo: { command: "kilo", sessionSources: [path.join(directory, "missing-kilo-sessions")] },
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

function configWithCodexSource(codexSessions: string, directory: string): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex", sessionSources: [codexSessions] },
      claude: { command: "claude", sessionSources: [path.join(directory, "missing-claude-sessions")] },
      cline: { command: "cline", sessionSources: [path.join(directory, "missing-cline-sessions")] },
      opencode: { command: "opencode", sessionSources: [path.join(directory, "missing-opencode-sessions")] },
      kilo: { command: "kilo", sessionSources: [path.join(directory, "missing-kilo-sessions")] },
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

function configWithCopilotSource(copilotState: string, directory: string): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex", sessionSources: [path.join(directory, "missing-codex-sessions")] },
      claude: { command: "claude", sessionSources: [path.join(directory, "missing-claude-sessions")] },
      cline: { command: "cline", sessionSources: [path.join(directory, "missing-cline-sessions")] },
      opencode: { command: "opencode", sessionSources: [path.join(directory, "missing-opencode-sessions")] },
      kilo: { command: "kilo", sessionSources: [path.join(directory, "missing-kilo-sessions")] },
      qwen: { command: "qwen", sessionSources: [path.join(directory, "missing-qwen-sessions")] },
      deepcode: { command: "deepcode", sessionSources: [path.join(directory, "missing-deepcode-sessions")] },
      kimi: { command: "kimi", sessionSources: [path.join(directory, "missing-kimi-sessions")] },
      qoder: { command: "qodercli", sessionSources: [path.join(directory, "missing-qoder-sessions")] },
      codebuddy: { command: "codebuddy", sessionSources: [path.join(directory, "missing-codebuddy-sessions")] },
      copilot: { command: "copilot", sessionSources: [copilotState] },
      cursor: { command: "cursor-agent", sessionSources: [path.join(directory, "missing-cursor-sessions")] },
      antigravity: { command: "agy", sessionSources: [path.join(directory, "missing-antigravity-sessions")] },
      reasonix: { command: "reasonix", sessionSources: [path.join(directory, "missing-reasonix-sessions")] }
    },
    terminal: { mode: "new-window" },
    skillhub: { rootDir: path.join(directory, "skillhub") }
  };
}

function configWithOpencodeSource(opencodeDb: string, directory: string): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex", sessionSources: [path.join(directory, "missing-codex-sessions")] },
      claude: { command: "claude", sessionSources: [path.join(directory, "missing-claude-sessions")] },
      cline: { command: "cline", sessionSources: [path.join(directory, "missing-cline-sessions")] },
      opencode: { command: "opencode", sessionSources: [opencodeDb] },
      kilo: { command: "kilo", sessionSources: [path.join(directory, "missing-kilo-sessions")] },
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

function configWithKiloSource(kiloDb: string, directory: string): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex", sessionSources: [path.join(directory, "missing-codex-sessions")] },
      claude: { command: "claude", sessionSources: [path.join(directory, "missing-claude-sessions")] },
      cline: { command: "cline", sessionSources: [path.join(directory, "missing-cline-sessions")] },
      opencode: { command: "opencode", sessionSources: [path.join(directory, "missing-opencode-sessions")] },
      kilo: { command: "kilo", sessionSources: [kiloDb] },
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

function configWithKimiSource(kimiSource: string, directory: string): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex", sessionSources: [path.join(directory, "missing-codex-sessions")] },
      claude: { command: "claude", sessionSources: [path.join(directory, "missing-claude-sessions")] },
      cline: { command: "cline", sessionSources: [path.join(directory, "missing-cline-sessions")] },
      opencode: { command: "opencode", sessionSources: [path.join(directory, "missing-opencode-sessions")] },
      kilo: { command: "kilo", sessionSources: [path.join(directory, "missing-kilo-sessions")] },
      qwen: { command: "qwen", sessionSources: [path.join(directory, "missing-qwen-sessions")] },
      deepcode: { command: "deepcode", sessionSources: [path.join(directory, "missing-deepcode-sessions")] },
      kimi: { command: "kimi", sessionSources: [kimiSource] },
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

function configWithCodeBuddySource(codebuddySource: string, directory: string): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex", sessionSources: [path.join(directory, "missing-codex-sessions")] },
      claude: { command: "claude", sessionSources: [path.join(directory, "missing-claude-sessions")] },
      cline: { command: "cline", sessionSources: [path.join(directory, "missing-cline-sessions")] },
      opencode: { command: "opencode", sessionSources: [path.join(directory, "missing-opencode-sessions")] },
      kilo: { command: "kilo", sessionSources: [path.join(directory, "missing-kilo-sessions")] },
      qwen: { command: "qwen", sessionSources: [path.join(directory, "missing-qwen-sessions")] },
      deepcode: { command: "deepcode", sessionSources: [path.join(directory, "missing-deepcode-sessions")] },
      kimi: { command: "kimi", sessionSources: [path.join(directory, "missing-kimi-sessions")] },
      qoder: { command: "qodercli", sessionSources: [path.join(directory, "missing-qoder-sessions")] },
      codebuddy: { command: "codebuddy", sessionSources: [codebuddySource] },
      copilot: { command: "copilot", sessionSources: [path.join(directory, "missing-copilot-sessions")] },
      cursor: { command: "cursor-agent", sessionSources: [path.join(directory, "missing-cursor-sessions")] },
      antigravity: { command: "agy", sessionSources: [path.join(directory, "missing-antigravity-sessions")] },
      reasonix: { command: "reasonix", sessionSources: [path.join(directory, "missing-reasonix-sessions")] }
    },
    terminal: { mode: "new-window" },
    skillhub: { rootDir: path.join(directory, "skillhub") }
  };
}

function configWithClineSource(clineSource: string, directory: string): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex", sessionSources: [path.join(directory, "missing-codex-sessions")] },
      claude: { command: "claude", sessionSources: [path.join(directory, "missing-claude-sessions")] },
      cline: { command: "cline", sessionSources: [clineSource] },
      opencode: { command: "opencode", sessionSources: [path.join(directory, "missing-opencode-sessions")] },
      kilo: { command: "kilo", sessionSources: [path.join(directory, "missing-kilo-sessions")] },
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

function configWithCursorAntigravitySources(cursorSource: string, antigravitySource: string, directory: string): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex", sessionSources: [path.join(directory, "missing-codex-sessions")] },
      claude: { command: "claude", sessionSources: [path.join(directory, "missing-claude-sessions")] },
      cline: { command: "cline", sessionSources: [path.join(directory, "missing-cline-sessions")] },
      opencode: { command: "opencode", sessionSources: [path.join(directory, "missing-opencode-sessions")] },
      kilo: { command: "kilo", sessionSources: [path.join(directory, "missing-kilo-sessions")] },
      qwen: { command: "qwen", sessionSources: [path.join(directory, "missing-qwen-sessions")] },
      deepcode: { command: "deepcode", sessionSources: [path.join(directory, "missing-deepcode-sessions")] },
      kimi: { command: "kimi", sessionSources: [path.join(directory, "missing-kimi-sessions")] },
      qoder: { command: "qodercli", sessionSources: [path.join(directory, "missing-qoder-sessions")] },
      codebuddy: { command: "codebuddy", sessionSources: [path.join(directory, "missing-codebuddy-sessions")] },
      copilot: { command: "copilot", sessionSources: [path.join(directory, "missing-copilot-sessions")] },
      cursor: { command: "cursor-agent", sessionSources: [cursorSource] },
      antigravity: { command: "agy", sessionSources: [antigravitySource] },
      reasonix: { command: "reasonix", sessionSources: [path.join(directory, "missing-reasonix-sessions")] }
    },
    terminal: { mode: "new-window" },
    skillhub: { rootDir: path.join(directory, "skillhub") }
  };
}

function configWithReasonixSource(reasonixSource: string, directory: string): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex", sessionSources: [path.join(directory, "missing-codex-sessions")] },
      claude: { command: "claude", sessionSources: [path.join(directory, "missing-claude-sessions")] },
      cline: { command: "cline", sessionSources: [path.join(directory, "missing-cline-sessions")] },
      opencode: { command: "opencode", sessionSources: [path.join(directory, "missing-opencode-sessions")] },
      kilo: { command: "kilo", sessionSources: [path.join(directory, "missing-kilo-sessions")] },
      qwen: { command: "qwen", sessionSources: [path.join(directory, "missing-qwen-sessions")] },
      deepcode: { command: "deepcode", sessionSources: [path.join(directory, "missing-deepcode-sessions")] },
      kimi: { command: "kimi", sessionSources: [path.join(directory, "missing-kimi-sessions")] },
      qoder: { command: "qodercli", sessionSources: [path.join(directory, "missing-qoder-sessions")] },
      codebuddy: { command: "codebuddy", sessionSources: [path.join(directory, "missing-codebuddy-sessions")] },
      copilot: { command: "copilot", sessionSources: [path.join(directory, "missing-copilot-sessions")] },
      cursor: { command: "cursor-agent", sessionSources: [path.join(directory, "missing-cursor-sessions")] },
      antigravity: { command: "agy", sessionSources: [path.join(directory, "missing-antigravity-sessions")] },
      reasonix: { command: "reasonix", sessionSources: [reasonixSource] }
    },
    terminal: { mode: "new-window" },
    skillhub: { rootDir: path.join(directory, "skillhub") }
  };
}

function configWithDeepcodeSource(deepcodeSource: string, directory: string): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex", sessionSources: [path.join(directory, "missing-codex-sessions")] },
      claude: { command: "claude", sessionSources: [path.join(directory, "missing-claude-sessions")] },
      cline: { command: "cline", sessionSources: [path.join(directory, "missing-cline-sessions")] },
      opencode: { command: "opencode", sessionSources: [path.join(directory, "missing-opencode-sessions")] },
      kilo: { command: "kilo", sessionSources: [path.join(directory, "missing-kilo-sessions")] },
      qwen: { command: "qwen", sessionSources: [path.join(directory, "missing-qwen-sessions")] },
      deepcode: { command: "deepcode", sessionSources: [deepcodeSource] },
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

function session(id: string, title: string, cwd: string, sourceFile: string, toolId: ToolId = "claude"): SessionEntry {
  return {
    id,
    toolId,
    nativeSessionId: id.replace(/^[^:]+:/, ""),
    title,
    summary: null,
    originalCwd: cwd,
    normalizedCwd: cwd.toLowerCase(),
    updatedAt: "2026-06-01T01:00:00.000Z",
    sourceFile,
    sourceFormat: `${toolId}-jsonl`,
    parserVersion: "test",
    resumeStatus: "ready",
    indexedAt: "2026-06-01T01:00:00.000Z"
  };
}
