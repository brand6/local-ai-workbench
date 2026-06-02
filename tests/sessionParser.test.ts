import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSessionFile } from "../src/server/scanning/sessionParser.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;

afterEach(() => {
  if (directory) cleanup(directory);
  directory = null;
});

describe("session parser", () => {
  it("extracts Codex session fields and keeps summaries optional", () => {
    directory = testDir("parser-success");
    const cwd = path.join(directory, "repo");
    fs.mkdirSync(cwd);
    const sourceFile = path.join(directory, "session.jsonl");
    fs.writeFileSync(
      sourceFile,
      [
        JSON.stringify({ session_meta: { payload: { id: "codex-123" } }, cwd, title: "实现功能", timestamp: "2026-06-01T01:00:00Z" }),
        JSON.stringify({ role: "user", content: "请继续开发", summary: "已有摘要", timestamp: "2026-06-01T02:00:00Z" })
      ].join("\n")
    );

    const result = parseSessionFile({
      toolId: "codex",
      parserVersion: "test",
      sourceFormat: "codex-jsonl",
      sourceFile,
      scanRunId: "scan-1"
    });

    expect(result.session).toMatchObject({
      nativeSessionId: "codex-123",
      title: "实现功能",
      summary: "已有摘要",
      originalCwd: cwd,
      updatedAt: "2026-06-01T02:00:00.000Z",
      resumeStatus: "ready"
    });
    expect(result.warnings).toHaveLength(0);
  });

  it("extracts Codex Desktop session metadata and skips bootstrap context as title", () => {
    directory = testDir("parser-codex-desktop");
    const cwd = path.join(directory, "repo");
    fs.mkdirSync(cwd);
    const sourceFile = path.join(directory, "codex-desktop.jsonl");
    fs.writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          timestamp: "2026-06-02T01:00:00Z",
          type: "session_meta",
          payload: {
            id: "019e8606-25e5-7c41-911c-d69904e14179",
            cwd,
            originator: "Codex Desktop"
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-02T01:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "# AGENTS.md instructions for E:\\ai-tools\\github-repo-manager\n<environment_context></environment_context>"
              }
            ]
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-02T01:00:01Z",
          type: "turn_context",
          payload: { summary: "auto" }
        }),
        JSON.stringify({
          timestamp: "2026-06-02T01:00:02Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "为什么没有 Codex 对话" }]
          }
        })
      ].join("\n")
    );

    const result = parseSessionFile({
      toolId: "codex",
      parserVersion: "test",
      sourceFormat: "codex-jsonl",
      sourceFile,
      scanRunId: "scan-codex-desktop"
    });

    expect(result.session).toMatchObject({
      nativeSessionId: "019e8606-25e5-7c41-911c-d69904e14179",
      title: "为什么没有 Codex 对话",
      summary: null,
      originalCwd: cwd,
      resumeStatus: "ready"
    });
    expect(result.warnings).toHaveLength(0);
  });

  it("records parser warnings for malformed lines and missing fields", () => {
    directory = testDir("parser-warning");
    const sourceFile = path.join(directory, "bad.jsonl");
    fs.writeFileSync(sourceFile, "{bad json}\n" + JSON.stringify({ role: "user", content: "hello" }));

    const result = parseSessionFile({
      toolId: "claude",
      parserVersion: "test",
      sourceFormat: "claude-jsonl",
      sourceFile,
      scanRunId: "scan-2"
    });

    expect(result.session?.resumeStatus).toBe("missing_session_id");
    expect(result.warnings.map((warning) => warning.errorType)).toEqual(
      expect.arrayContaining(["malformed-jsonl", "missing-session-id", "missing-cwd"])
    );
  });

  it("does not use Claude tool names as session titles", () => {
    directory = testDir("parser-claude-tool-title");
    const cwd = path.join(directory, "repo");
    fs.mkdirSync(cwd);
    const sourceFile = path.join(directory, "claude-session.jsonl");
    fs.writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "请修复生成器，让它支持 Dictionary 和 Array" },
          sessionId: "claude-title-123",
          cwd,
          timestamp: "2026-06-01T01:00:00Z"
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", name: "Read", input: { file_path: path.join(cwd, "file.gd") } }]
          },
          sessionId: "claude-title-123",
          cwd,
          timestamp: "2026-06-01T01:01:00Z"
        })
      ].join("\n")
    );

    const result = parseSessionFile({
      toolId: "claude",
      parserVersion: "test",
      sourceFormat: "claude-jsonl",
      sourceFile,
      scanRunId: "scan-claude-title"
    });

    expect(result.session?.title).toBe("请修复生成器，让它支持 Dictionary 和 Array");
    expect(result.session?.title).not.toBe("Read");
  });

  it("skips Claude sidechain subagent files because they are not resumable conversations", () => {
    directory = testDir("parser-claude-sidechain");
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

    const result = parseSessionFile({
      toolId: "claude",
      parserVersion: "test",
      sourceFormat: "claude-jsonl",
      sourceFile,
      scanRunId: "scan-claude-sidechain"
    });

    expect(result.session).toBeNull();
    expect(result.skipped).toBe(true);
  });

  it("uses Claude summary events instead of local command caveats for titles", () => {
    directory = testDir("parser-claude-summary-title");
    const cwd = path.join(directory, "repo");
    fs.mkdirSync(cwd);
    const sourceFile = path.join(directory, "claude-summary.jsonl");
    fs.writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          type: "user",
          isMeta: true,
          message: {
            role: "user",
            content:
              "<local-command-caveat>Caveat: generated while running local commands.</local-command-caveat>"
          },
          sessionId: "claude-summary-123",
          cwd,
          timestamp: "2026-06-01T01:00:00Z"
        }),
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content:
              "<command-message>continue</command-message>\n<command-name>/continue</command-name>\n<command-args>main</command-args>"
          },
          sessionId: "claude-summary-123",
          cwd,
          timestamp: "2026-06-01T01:01:00Z"
        }),
        JSON.stringify({
          type: "system",
          subtype: "away_summary",
          content: "Sprint 35 ACS 系统开发中，下一步运行 `/continue main` 开始 S35-004。",
          sessionId: "claude-summary-123",
          cwd,
          timestamp: "2026-06-01T01:02:00Z"
        })
      ].join("\n")
    );

    const result = parseSessionFile({
      toolId: "claude",
      parserVersion: "test",
      sourceFormat: "claude-jsonl",
      sourceFile,
      scanRunId: "scan-claude-summary"
    });

    expect(result.session?.title).toBe("Sprint 35 ACS 系统开发中，下一步运行 `/continue main` 开始 S35-004。");
    expect(result.session?.summary).toBe("Sprint 35 ACS 系统开发中，下一步运行 `/continue main` 开始 S35-004。");
  });

  it("does not use Claude clear command markup as a title", () => {
    directory = testDir("parser-claude-clear-command");
    const cwd = path.join(directory, "repo");
    fs.mkdirSync(cwd);
    const sourceFile = path.join(directory, "claude-clear.jsonl");
    fs.writeFileSync(
      sourceFile,
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content:
            "<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>"
        },
        sessionId: "claude-clear-123",
        cwd,
        timestamp: "2026-06-01T01:00:00Z"
      })
    );

    const result = parseSessionFile({
      toolId: "claude",
      parserVersion: "test",
      sourceFormat: "claude-jsonl",
      sourceFile,
      scanRunId: "scan-claude-clear"
    });

    expect(result.session?.title).toBe(`未命名会话 ${path.basename(sourceFile)}`);
    expect(result.session?.title).not.toContain("<command-name>");
  });

  it("extracts MVP-B tool session ids and project root cwd fields", () => {
    directory = testDir("parser-mvp-b");
    const cwd = path.join(directory, "repo");
    fs.mkdirSync(cwd);
    const qwenSource = path.join(directory, "qwen.jsonl");
    fs.writeFileSync(
      qwenSource,
      JSON.stringify({
        type: "system",
        session_id: "qwen-123",
        projectRoot: cwd,
        title: "Qwen 会话",
        timestamp: "2026-06-01T03:00:00Z"
      })
    );

    const copilotSource = path.join(directory, "copilot.jsonl");
    fs.writeFileSync(
      copilotSource,
      JSON.stringify({
        sessionId: "copilot-123",
        workspaceRoot: cwd,
        title: "Copilot 会话",
        timestamp: "2026-06-01T04:00:00Z"
      })
    );

    expect(
      parseSessionFile({
        toolId: "qwen",
        parserVersion: "test",
        sourceFormat: "qwen-json",
        sourceFile: qwenSource,
        scanRunId: "scan-3"
      }).session
    ).toMatchObject({ nativeSessionId: "qwen-123", originalCwd: cwd, resumeStatus: "ready" });

    expect(
      parseSessionFile({
        toolId: "copilot",
        parserVersion: "test",
        sourceFormat: "copilot-jsonl",
        sourceFile: copilotSource,
        scanRunId: "scan-3"
      }).session
    ).toMatchObject({ nativeSessionId: "copilot-123", originalCwd: cwd, resumeStatus: "ready" });
  });

  it("marks Qwen chat files from a mismatched project bucket as non-resumable", () => {
    directory = testDir("parser-qwen-project-mismatch");
    const cwd = path.join(directory, "old-project");
    fs.mkdirSync(cwd);
    const sourceFile = path.join(directory, ".qwen", "projects", "d--work-project", "chats", "e83d984f-d610-4eae-bff9-8273372bea97.jsonl");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(
      sourceFile,
      JSON.stringify({
        type: "user",
        sessionId: "e83d984f-d610-4eae-bff9-8273372bea97",
        cwd,
        message: { role: "user", parts: [{ text: "继续旧项目" }] },
        timestamp: "2026-06-02T01:00:00Z"
      })
    );

    const result = parseSessionFile({
      toolId: "qwen",
      parserVersion: "test",
      sourceFormat: "qwen-json",
      sourceFile,
      scanRunId: "scan-qwen-mismatch"
    });

    expect(result.session).toMatchObject({
      nativeSessionId: "e83d984f-d610-4eae-bff9-8273372bea97",
      title: "继续旧项目",
      originalCwd: cwd,
      resumeStatus: "source_mismatch"
    });
    expect(result.warnings.map((warning) => warning.errorType)).not.toContain("missing-title");
    expect(result.warnings.map((warning) => warning.errorType)).toContain("qwen-project-source-mismatch");
  });

  it("skips Qwen project metadata files because they are not resumable sessions", () => {
    directory = testDir("parser-qwen-metadata");
    const sourceFile = path.join(directory, ".qwen", "projects", "d--work-project", "extract-cursor.json");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(
      sourceFile,
      JSON.stringify({
        sessionId: "e83d984f-d610-4eae-bff9-8273372bea97",
        processedOffset: 20,
        updatedAt: "2026-05-14T01:33:14.911Z"
      })
    );

    const result = parseSessionFile({
      toolId: "qwen",
      parserVersion: "test",
      sourceFormat: "qwen-json",
      sourceFile,
      scanRunId: "scan-qwen-metadata"
    });

    expect(result.session).toBeNull();
    expect(result.skipped).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});
