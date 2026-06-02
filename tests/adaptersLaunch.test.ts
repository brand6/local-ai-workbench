import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultAppConfig } from "../src/server/core/bootstrap.js";
import { buildTerminalHost, launchInTerminal } from "../src/server/launch/terminal.js";
import { adapterFor, claudeAdapter, codexAdapter, opencodeAdapter, projectVisibleToolStatuses } from "../src/server/tools/adapters.js";
import type { SessionEntry, ToolId } from "../src/shared/types.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;

afterEach(() => {
  if (directory) cleanup(directory);
  directory = null;
});

describe("tool adapters and terminal launcher", () => {
  it("constructs Codex and Claude new-session commands without shell interpolation", () => {
    const config = defaultAppConfig();
    expect(codexAdapter.buildNewSessionCommand(config, "E:\\repo")).toEqual({ command: "codex", args: [], cwd: "E:\\repo" });
    expect(claudeAdapter.buildNewSessionCommand(config, "E:\\repo")).toEqual({ command: "claude", args: [], cwd: "E:\\repo" });
  });

  it("constructs resume commands with the native session id", () => {
    const config = defaultAppConfig();
    const session: SessionEntry = {
      id: "codex:s1",
      toolId: "codex",
      nativeSessionId: "s1",
      title: "title",
      summary: null,
      originalCwd: "E:\\repo",
      normalizedCwd: "e:\\repo",
      updatedAt: "2026-06-01T00:00:00Z",
      sourceFile: "source.jsonl",
      sourceFormat: "codex-jsonl",
      parserVersion: "test",
      resumeStatus: "ready",
      indexedAt: "2026-06-01T00:00:00Z"
    };

    expect(codexAdapter.buildResumeCommand(config, session).args).toEqual(["resume", "s1"]);
    expect(claudeAdapter.buildResumeCommand(config, { ...session, toolId: "claude" }).args).toEqual(["--resume", "s1"]);
  });

  it("registers MVP-B tools behind the shared adapter interface", () => {
    const config = defaultAppConfig();
    const ids: ToolId[] = ["codex", "claude", "opencode", "qwen", "qoder", "copilot"];
    const session: SessionEntry = {
      id: "tool:s1",
      toolId: "opencode",
      nativeSessionId: "s1",
      title: "title",
      summary: null,
      originalCwd: "E:\\repo",
      normalizedCwd: "e:\\repo",
      updatedAt: "2026-06-01T00:00:00Z",
      sourceFile: "source.jsonl",
      sourceFormat: "jsonl",
      parserVersion: "test",
      resumeStatus: "ready",
      indexedAt: "2026-06-01T00:00:00Z"
    };

    expect(Object.keys(config.tools).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(adapterFor(id).buildNewSessionCommand(config, "E:\\repo").cwd).toBe("E:\\repo");
    }
    expect(adapterFor("opencode").buildResumeCommand(config, { ...session, toolId: "opencode" }).args).toEqual(["--session", "s1"]);
    expect(adapterFor("qwen").buildResumeCommand(config, { ...session, toolId: "qwen" }).args).toEqual(["--resume", "s1"]);
    expect(adapterFor("qoder").buildResumeCommand(config, { ...session, toolId: "qoder" }).args).toEqual(["-r", "s1"]);
    expect(adapterFor("copilot").buildResumeCommand(config, { ...session, toolId: "copilot" }).args).toEqual(["--resume", "s1"]);
  });

  it("exposes project-visible tools from adapter capabilities instead of hard-coded ids", () => {
    const statuses = projectVisibleToolStatuses(defaultAppConfig());
    expect(statuses.map((status) => status.toolId)).toEqual(["codex", "claude", "opencode", "qwen", "qoder", "copilot"]);
    expect(statuses.every((status) => status.capabilities.launchNew && status.capabilities.scanHistory && status.capabilities.resume)).toBe(true);
  });

  it("points OpenCode history scanning at the SQLite database by default", () => {
    const opencodeHome = path.join("E:\\", "tools", "opencode");
    expect(opencodeAdapter.defaultSessionSources({ OPENCODE_HOME: opencodeHome })).toEqual([
      path.join(opencodeHome, "opencode.db"),
      path.join(opencodeHome, "project")
    ]);
  });

  it("validates cwd before launch and supports dry-run terminal construction", () => {
    directory = testDir("launch");
    const cwd = path.join(directory, "repo");
    fs.mkdirSync(cwd);

    const response = launchInTerminal({ command: "node", args: ["--version"], cwd }, { dryRun: true });
    expect(response.launched).toBe(true);
    expect(response.command.cwd).toBe(cwd);
    expect(buildTerminalHost({ command: "node", args: ["--version"], cwd }).args.length).toBeGreaterThan(0);

    const failed = launchInTerminal({ command: "node", args: [], cwd: path.join(directory, "missing") }, { dryRun: true });
    expect(failed.launched).toBe(false);
    expect(failed.reason).toContain("目录不存在");
  });

  it("wraps Windows Terminal launches in PowerShell so command shims resolve", () => {
    const host = buildTerminalHost(
      { command: "opencode", args: ["--session", "ses_1"], cwd: "E:\\repo" },
      { platform: "win32", windowsTerminalAvailable: true }
    );

    expect(host).toEqual({
      kind: "windows-terminal",
      executable: "wt.exe",
      args: ["-d", "E:\\repo", "powershell.exe", "-NoExit", "-Command", "& 'opencode' '--session' 'ses_1'"]
    });
  });
});
