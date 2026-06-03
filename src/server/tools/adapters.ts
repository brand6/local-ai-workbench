import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { AppConfig, LaunchCommand, SessionEntry, ToolId, ToolStatus } from "../../shared/types.js";
import type { ToolAdapter } from "./toolAdapter.js";

function commandAvailable(command: string): boolean {
  const lookup = process.platform === "win32" ? "where.exe" : "command";
  const args = process.platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(lookup, args, { stdio: "ignore", shell: process.platform !== "win32" });
  return result.status === 0;
}

function status(adapter: ToolAdapter, config: AppConfig): ToolStatus {
  const command = config.tools[adapter.id].command;
  const available = commandAvailable(command);
  return {
    toolId: adapter.id,
    command,
    available,
    supported: adapter.capabilities.launchNew && adapter.capabilities.scanHistory && adapter.capabilities.resume,
    visibleInProjectUi: adapter.visibleInProjectUi,
    capabilities: adapter.capabilities,
    reason: available ? null : `未找到命令：${command}`,
    sessionSources: sessionSourcesForAdapter(adapter, config)
  };
}

function existing(...parts: string[]): string {
  return path.join(...parts);
}

function projectSkillDirectory(projectRoot: string, ...parts: string[]) {
  return { supported: true, directory: path.join(projectRoot, ...parts), reason: null };
}

function unsupportedSkillDirectory(reason: string) {
  return { supported: false, directory: null, reason };
}

export const codexAdapter: ToolAdapter = {
  id: "codex",
  parserVersion: "codex-jsonl-v1",
  sourceFormat: "codex-jsonl",
  capabilities: { launchNew: true, scanHistory: true, resume: true },
  visibleInProjectUi: true,
  defaultSessionSources(env = process.env): string[] {
    const home = os.homedir();
    const codexHome = env.CODEX_HOME ?? path.join(home, ".codex");
    return [existing(codexHome, "sessions"), existing(codexHome, "history.jsonl")];
  },
  skillTarget(projectRoot: string) {
    return projectSkillDirectory(projectRoot, ".codex", "skills");
  },
  detect(config: AppConfig): ToolStatus {
    return status(this, config);
  },
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand {
    return { command: config.tools.codex.command, args: [], cwd };
  },
  buildResumeCommand(config: AppConfig, session: SessionEntry): LaunchCommand {
    if (!session.nativeSessionId) throw new Error("Codex session is missing native session id");
    if (!session.originalCwd) throw new Error("Codex session is missing cwd");
    return { command: config.tools.codex.command, args: ["resume", session.nativeSessionId], cwd: session.originalCwd };
  }
};

export const claudeAdapter: ToolAdapter = {
  id: "claude",
  parserVersion: "claude-jsonl-v1",
  sourceFormat: "claude-jsonl",
  capabilities: { launchNew: true, scanHistory: true, resume: true },
  visibleInProjectUi: true,
  defaultSessionSources(env = process.env): string[] {
    const home = os.homedir();
    const claudeHome = env.CLAUDE_HOME ?? path.join(home, ".claude");
    return [existing(claudeHome, "projects")];
  },
  skillTarget(projectRoot: string) {
    return projectSkillDirectory(projectRoot, ".claude", "skills");
  },
  detect(config: AppConfig): ToolStatus {
    return status(this, config);
  },
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand {
    return { command: config.tools.claude.command, args: [], cwd };
  },
  buildResumeCommand(config: AppConfig, session: SessionEntry): LaunchCommand {
    if (!session.nativeSessionId) throw new Error("Claude session is missing native session id");
    if (!session.originalCwd) throw new Error("Claude session is missing cwd");
    return { command: config.tools.claude.command, args: ["--resume", session.nativeSessionId], cwd: session.originalCwd };
  }
};

export const opencodeAdapter: ToolAdapter = {
  id: "opencode",
  parserVersion: "opencode-json-v1",
  sourceFormat: "opencode-json",
  capabilities: { launchNew: true, scanHistory: true, resume: true },
  visibleInProjectUi: true,
  defaultSessionSources(env = process.env): string[] {
    const home = os.homedir();
    const opencodeHome = env.OPENCODE_HOME ?? path.join(home, ".local", "share", "opencode");
    return [existing(opencodeHome, "opencode.db"), existing(opencodeHome, "project")];
  },
  skillTarget(projectRoot: string) {
    return projectSkillDirectory(projectRoot, ".opencode", "skills");
  },
  detect(config: AppConfig): ToolStatus {
    return status(this, config);
  },
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand {
    return { command: config.tools.opencode.command, args: [], cwd };
  },
  buildResumeCommand(config: AppConfig, session: SessionEntry): LaunchCommand {
    if (!session.nativeSessionId) throw new Error("OpenCode session is missing native session id");
    if (!session.originalCwd) throw new Error("OpenCode session is missing cwd");
    return { command: config.tools.opencode.command, args: ["--session", session.nativeSessionId], cwd: session.originalCwd };
  }
};

export const qwenAdapter: ToolAdapter = {
  id: "qwen",
  parserVersion: "qwen-json-v1",
  sourceFormat: "qwen-json",
  capabilities: { launchNew: true, scanHistory: true, resume: true },
  visibleInProjectUi: true,
  defaultSessionSources(env = process.env): string[] {
    const home = os.homedir();
    const qwenHome = env.QWEN_HOME ?? path.join(home, ".qwen");
    return [existing(qwenHome, "projects"), existing(qwenHome, "sessions")];
  },
  skillTarget(projectRoot: string) {
    return projectSkillDirectory(projectRoot, ".qwen", "skills");
  },
  detect(config: AppConfig): ToolStatus {
    return status(this, config);
  },
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand {
    return { command: config.tools.qwen.command, args: [], cwd };
  },
  buildResumeCommand(config: AppConfig, session: SessionEntry): LaunchCommand {
    if (!session.nativeSessionId) throw new Error("Qwen session is missing native session id");
    if (!session.originalCwd) throw new Error("Qwen session is missing cwd");
    return { command: config.tools.qwen.command, args: ["--resume", session.nativeSessionId], cwd: session.originalCwd };
  }
};

export const qoderAdapter: ToolAdapter = {
  id: "qoder",
  parserVersion: "qoder-json-v1",
  sourceFormat: "qoder-json",
  capabilities: { launchNew: true, scanHistory: true, resume: true },
  visibleInProjectUi: true,
  defaultSessionSources(env = process.env): string[] {
    const home = os.homedir();
    const qoderHome = env.QODER_HOME ?? path.join(home, ".qoder");
    return [existing(qoderHome, "sessions"), existing(qoderHome, "projects")];
  },
  skillTarget(projectRoot: string) {
    return projectSkillDirectory(projectRoot, ".qoder", "skills");
  },
  detect(config: AppConfig): ToolStatus {
    return status(this, config);
  },
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand {
    return { command: config.tools.qoder.command, args: [], cwd };
  },
  buildResumeCommand(config: AppConfig, session: SessionEntry): LaunchCommand {
    if (!session.nativeSessionId) throw new Error("Qoder session is missing native session id");
    if (!session.originalCwd) throw new Error("Qoder session is missing cwd");
    return { command: config.tools.qoder.command, args: ["-r", session.nativeSessionId], cwd: session.originalCwd };
  }
};

export const copilotAdapter: ToolAdapter = {
  id: "copilot",
  parserVersion: "copilot-jsonl-v1",
  sourceFormat: "copilot-jsonl",
  capabilities: { launchNew: true, scanHistory: true, resume: true },
  visibleInProjectUi: true,
  defaultSessionSources(env = process.env): string[] {
    const home = os.homedir();
    const copilotHome = env.COPILOT_HOME ?? path.join(home, ".copilot");
    return [existing(copilotHome, "session-state")];
  },
  skillTarget() {
    return unsupportedSkillDirectory("Copilot 暂无项目级 skill link 目录映射");
  },
  detect(config: AppConfig): ToolStatus {
    return status(this, config);
  },
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand {
    return { command: config.tools.copilot.command, args: [], cwd };
  },
  buildResumeCommand(config: AppConfig, session: SessionEntry): LaunchCommand {
    if (!session.nativeSessionId) throw new Error("Copilot session is missing native session id");
    if (!session.originalCwd) throw new Error("Copilot session is missing cwd");
    return { command: config.tools.copilot.command, args: ["--resume", session.nativeSessionId], cwd: session.originalCwd };
  }
};

export const toolAdapters: Record<ToolId, ToolAdapter> = {
  codex: codexAdapter,
  claude: claudeAdapter,
  opencode: opencodeAdapter,
  qwen: qwenAdapter,
  qoder: qoderAdapter,
  copilot: copilotAdapter
};

export function listToolStatuses(config: AppConfig): ToolStatus[] {
  return Object.values(toolAdapters).map((adapter) => adapter.detect(config));
}

export function projectVisibleToolStatuses(config: AppConfig): ToolStatus[] {
  return listToolStatuses(config).filter((tool) => tool.visibleInProjectUi);
}

export function adapterFor(toolId: ToolId): ToolAdapter {
  return toolAdapters[toolId];
}

export function existingSources(sources: string[]): string[] {
  return sources.filter((source) => fs.existsSync(source));
}

export function sessionSourcesForAdapter(adapter: ToolAdapter, config: AppConfig): string[] {
  const configuredSources = config.tools[adapter.id].sessionSources;
  return configuredSources?.length ? configuredSources : adapter.defaultSessionSources();
}
