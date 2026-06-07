import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultAppConfig } from "../src/server/core/bootstrap.js";
import { buildTerminalHost, launchInTerminal, terminalWindowTarget } from "../src/server/launch/terminal.js";
import {
  adapterFor,
  claudeAdapter,
  codexAdapter,
  deepcodeAdapter,
  kiloAdapter,
  opencodeAdapter,
  projectVisibleToolStatuses,
  reasonixAdapter
} from "../src/server/tools/adapters.js";
import { toolIds, type SessionEntry, type ToolId } from "../src/shared/types.js";
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
    const fullLifecycleIds: ToolId[] = [
      "codex",
      "claude",
      "cline",
      "opencode",
      "kilo",
      "qwen",
      "kimi",
      "qoder",
      "codebuddy",
      "copilot",
      "cursor",
      "antigravity",
      "deepcode",
      "reasonix"
    ];
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

    expect(Object.keys(config.tools).sort()).toEqual([...toolIds].sort());
    for (const id of fullLifecycleIds) {
      expect(adapterFor(id).buildNewSessionCommand(config, "E:\\repo").cwd).toBe("E:\\repo");
    }
    expect(adapterFor("opencode").buildResumeCommand(config, { ...session, toolId: "opencode" }).args).toEqual(["--session", "s1"]);
    expect(adapterFor("kilo").buildResumeCommand(config, { ...session, toolId: "kilo" }).args).toEqual(["run", "--interactive", "--session", "s1"]);
    expect(adapterFor("qwen").buildResumeCommand(config, { ...session, toolId: "qwen" }).args).toEqual(["--resume", "s1"]);
    expect(adapterFor("kimi").buildResumeCommand(config, { ...session, toolId: "kimi" }).args).toEqual(["--session", "s1"]);
    expect(adapterFor("qoder").buildResumeCommand(config, { ...session, toolId: "qoder" }).args).toEqual(["-r", "s1"]);
    expect(adapterFor("codebuddy").buildResumeCommand(config, { ...session, toolId: "codebuddy" }).args).toEqual(["--resume", "s1"]);
    expect(adapterFor("copilot").buildResumeCommand(config, { ...session, toolId: "copilot" }).args).toEqual(["--resume", "s1"]);
    expect(adapterFor("cline").buildResumeCommand(config, { ...session, toolId: "cline" }).args).toEqual(["--id", "s1"]);
    expect(adapterFor("cursor").buildResumeCommand(config, { ...session, toolId: "cursor" }).args).toEqual(["--resume", "s1"]);
    expect(adapterFor("antigravity").buildResumeCommand(config, { ...session, toolId: "antigravity" }).args).toEqual(["--conversation", "s1"]);
    expect(adapterFor("deepcode").buildResumeCommand(config, { ...session, toolId: "deepcode" }).args).toEqual(["-p", "/resume s1"]);
    expect(adapterFor("reasonix").buildResumeCommand(config, { ...session, toolId: "reasonix" }).args).toEqual(["code", "--session", "s1"]);
    expect(adapterFor("reasonix").buildNewSessionCommand(config, "E:\\repo").args).toEqual(["code"]);
  });

  it("exposes project-visible tools from adapter capabilities instead of hard-coded ids", () => {
    const statuses = projectVisibleToolStatuses(defaultAppConfig());
    expect(statuses.map((status) => status.toolId)).toEqual([
      "codex",
      "claude",
      "cline",
      "opencode",
      "kilo",
      "qwen",
      "kimi",
      "qoder",
      "codebuddy",
      "copilot",
      "cursor",
      "antigravity",
      "deepcode",
      "reasonix"
    ]);
    expect(statuses.every((status) => status.capabilities.launchNew)).toBe(true);
    expect(statuses.filter((status) => status.capabilities.scanHistory).map((status) => status.toolId)).toEqual([
      "codex",
      "claude",
      "cline",
      "opencode",
      "kilo",
      "qwen",
      "kimi",
      "qoder",
      "codebuddy",
      "copilot",
      "cursor",
      "antigravity",
      "deepcode",
      "reasonix"
    ]);
  });

  it("points OpenCode history scanning at the SQLite database by default", () => {
    const opencodeHome = path.join("E:\\", "tools", "opencode");
    expect(opencodeAdapter.defaultSessionSources({ OPENCODE_HOME: opencodeHome })).toEqual([
      path.join(opencodeHome, "opencode.db"),
      path.join(opencodeHome, "project")
    ]);
  });

  it("points Kilo Code CLI history scanning at the SQLite database by default", () => {
    const kiloHome = path.join("E:\\", "tools", "kilo");
    const explicitDb = path.join(kiloHome, "custom.db");

    expect(kiloAdapter.defaultSessionSources({ KILO_DATA_DIR: kiloHome })).toEqual([path.join(kiloHome, "kilo.db")]);
    expect(kiloAdapter.defaultSessionSources({ KILO_DATA_DIR: kiloHome, KILO_DB: "sessions.db" })).toEqual([path.join(kiloHome, "sessions.db")]);
    expect(kiloAdapter.defaultSessionSources({ KILO_DB: explicitDb })).toEqual([explicitDb]);
  });

  it("points DeepCode and Reasonix history scanning at their local session roots", () => {
    const deepcodeHome = path.join("E:\\", "tools", "deepcode");
    const reasonixHome = path.join("E:\\", "tools", "reasonix");

    expect(deepcodeAdapter.defaultSessionSources({ DEEPCODE_HOME: deepcodeHome })).toEqual([path.join(deepcodeHome, "projects")]);
    expect(reasonixAdapter.defaultSessionSources({ REASONIX_HOME: reasonixHome })).toEqual([path.join(reasonixHome, "sessions")]);
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
      args: ["-w", "new", "new-tab", "-d", "E:\\repo", "powershell.exe", "-NoExit", "-Command", "& 'opencode' '--session' 'ses_1'"]
    });
  });

  it("targets stable Windows Terminal windows for the configured launch mode", () => {
    expect(terminalWindowTarget("new-window", { toolId: "codex", cwd: "E:\\repo" })).toBe("new");
    expect(terminalWindowTarget("per-tool", { toolId: "claude", cwd: "E:\\repo" })).toBe("grm-tool-claude");
    expect(terminalWindowTarget("per-project", { toolId: "codex", projectRootPath: "E:\\tools\\github-repo-manager" })).toMatch(
      /^grm-project-github-repo-manager-[a-f0-9]{12}$/
    );

    const host = buildTerminalHost(
      { command: "codex", args: [], cwd: "E:\\tools\\github-repo-manager\\src" },
      { platform: "win32", windowsTerminalAvailable: true, windowTarget: "grm-project-github-repo-manager-123456789abc" }
    );

    expect(host.args.slice(0, 5)).toEqual([
      "-w",
      "grm-project-github-repo-manager-123456789abc",
      "new-tab",
      "-d",
      "E:\\tools\\github-repo-manager\\src"
    ]);
  });
});
