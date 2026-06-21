import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandAvailable } from "../core/commandAvailability.js";
import type { AppConfig, LaunchCommand, ProjectResourceDirectoryPreference, SessionEntry, ToolId, ToolStatus } from "../../shared/types.js";
import type { SkillTargetOptions, ToolAdapter } from "./toolAdapter.js";

function status(adapter: ToolAdapter, config: AppConfig): ToolStatus {
  const command = configuredCommand(config, adapter.id);
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

function unsupportedSkillDirectory(reason: string) {
  return { supported: false, directory: null, reason };
}

export interface ProjectSkillDirectoryOption {
  kind: ProjectResourceDirectoryPreference;
  directory: string;
}

interface SkillDirectoryParts {
  private: string[];
  public?: string[][];
}

const skillDirectoryPartsByTool: Partial<Record<ToolId, SkillDirectoryParts>> = {
  codex: { private: [".codex", "skills"], public: [[".agents", "skills"]] },
  claude: { private: [".claude", "skills"], public: [[".claude", "skills"]] },
  cline: { private: [".cline", "skills"], public: [[".claude", "skills"]] },
  opencode: { private: [".opencode", "skills"], public: [[".agents", "skills"], [".claude", "skills"]] },
  kilo: { private: [".kilo", "skills"], public: [[".agents", "skills"], [".claude", "skills"]] },
  qwen: { private: [".qwen", "skills"] },
  kimi: { private: [".kimi-code", "skills"], public: [[".agents", "skills"]] },
  qoder: { private: [".qoder", "skills"] },
  codebuddy: { private: [".codebuddy", "skills"] },
  copilot: { private: [".github", "skills"], public: [[".agents", "skills"], [".claude", "skills"]] },
  cursor: { private: [".cursor", "skills"], public: [[".agents", "skills"], [".claude", "skills"]] },
  antigravity: { private: [".agents", "skills"], public: [[".agents", "skills"]] },
  deepcode: { private: [".deepcode", "skills"] },
  trae: { private: [".traecli", "skills"], public: [[".trae", "skills"]] }
};

export function projectSkillDirectoryOptions(toolId: ToolId, projectRoot: string): ProjectSkillDirectoryOption[] {
  const parts = skillDirectoryPartsByTool[toolId];
  if (!parts) return [];
  const options: ProjectSkillDirectoryOption[] = [
    { kind: "private", directory: path.join(projectRoot, ...parts.private) },
    ...(parts.public ?? []).map((publicParts) => ({ kind: "public" as const, directory: path.join(projectRoot, ...publicParts) }))
  ];
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = option.directory.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function preferredProjectSkillDirectory(toolId: ToolId, projectRoot: string, options: SkillTargetOptions = {}) {
  const targets = projectSkillDirectoryOptions(toolId, projectRoot);
  if (targets.length === 0) return unsupportedSkillDirectory("Reasonix 暂无项目级 skill link 目录映射");
  const preferredKind = options.directoryPreference ?? "private";
  const target = targets.find((item) => item.kind === preferredKind) ?? targets[0]!;
  return { supported: true, directory: target.directory, reason: null };
}

function configuredCommand(config: AppConfig, toolId: ToolId): string {
  return config.tools[toolId]?.command ?? defaultCommands[toolId];
}

function configuredCommandName(command: string): string {
  const normalized = command.trim().replace(/^["']|["']$/g, "");
  return (normalized.split(/[\\/]/).pop() ?? normalized).replace(/\.(cmd|exe|ps1|bat)$/i, "").toLowerCase();
}

function isOpenSourceTraeCliCommand(command: string): boolean {
  return configuredCommandName(command) === "trae-cli";
}

const defaultCommands: Record<ToolId, string> = {
  codex: "codex",
  claude: "claude",
  cline: "cline",
  opencode: "opencode",
  kilo: "kilo",
  qwen: "qwen",
  kimi: "kimi",
  qoder: "qodercli",
  codebuddy: "codebuddy",
  copilot: "copilot",
  cursor: "cursor-agent",
  antigravity: "agy",
  trae: "traecli",
  deepcode: "deepcode",
  reasonix: "reasonix"
};

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
  skillTarget(projectRoot: string, options?: SkillTargetOptions) {
    return preferredProjectSkillDirectory("codex", projectRoot, options);
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
  skillTarget(projectRoot: string, options?: SkillTargetOptions) {
    return preferredProjectSkillDirectory("claude", projectRoot, options);
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

export const clineAdapter: ToolAdapter = {
  id: "cline",
  parserVersion: "cline-session-v1",
  sourceFormat: "cline-session",
  capabilities: { launchNew: true, scanHistory: true, resume: true },
  visibleInProjectUi: true,
  defaultSessionSources(env = process.env): string[] {
    const home = os.homedir();
    const clineHome = env.CLINE_HOME ?? path.join(home, ".cline");
    return [existing(clineHome, "data", "sessions"), existing(clineHome, "data", "tasks")];
  },
  skillTarget(projectRoot: string, options?: SkillTargetOptions) {
    return preferredProjectSkillDirectory("cline", projectRoot, options);
  },
  detect(config: AppConfig): ToolStatus {
    return status(this, config);
  },
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand {
    return { command: configuredCommand(config, "cline"), args: [], cwd };
  },
  buildResumeCommand(config: AppConfig, session: SessionEntry): LaunchCommand {
    if (!session.nativeSessionId) throw new Error("Cline session is missing native session id");
    if (!session.originalCwd) throw new Error("Cline session is missing cwd");
    return { command: configuredCommand(config, "cline"), args: ["--id", session.nativeSessionId], cwd: session.originalCwd };
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
  skillTarget(projectRoot: string, options?: SkillTargetOptions) {
    return preferredProjectSkillDirectory("opencode", projectRoot, options);
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

export const kiloAdapter: ToolAdapter = {
  id: "kilo",
  parserVersion: "kilo-sqlite-v1",
  sourceFormat: "kilo-sqlite",
  capabilities: { launchNew: true, scanHistory: true, resume: true },
  visibleInProjectUi: true,
  defaultSessionSources(env = process.env): string[] {
    const home = os.homedir();
    const dataDir =
      env.KILO_DATA_DIR ??
      (process.platform === "win32"
        ? path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "kilo")
        : path.join(home, ".local", "share", "kilo"));
    if (env.KILO_DB) return [path.isAbsolute(env.KILO_DB) || env.KILO_DB === ":memory:" ? env.KILO_DB : existing(dataDir, env.KILO_DB)];
    return [existing(dataDir, "kilo.db")];
  },
  skillTarget(projectRoot: string, options?: SkillTargetOptions) {
    return preferredProjectSkillDirectory("kilo", projectRoot, options);
  },
  detect(config: AppConfig): ToolStatus {
    return status(this, config);
  },
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand {
    return { command: configuredCommand(config, "kilo"), args: [], cwd };
  },
  buildResumeCommand(config: AppConfig, session: SessionEntry): LaunchCommand {
    if (!session.nativeSessionId) throw new Error("Kilo session is missing native session id");
    if (!session.originalCwd) throw new Error("Kilo session is missing cwd");
    return { command: configuredCommand(config, "kilo"), args: ["run", "--interactive", "--session", session.nativeSessionId], cwd: session.originalCwd };
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
  skillTarget(projectRoot: string, options?: SkillTargetOptions) {
    return preferredProjectSkillDirectory("qwen", projectRoot, options);
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

export const kimiAdapter: ToolAdapter = {
  id: "kimi",
  parserVersion: "kimi-code-json-v1",
  sourceFormat: "kimi-code-json",
  capabilities: { launchNew: true, scanHistory: true, resume: true },
  visibleInProjectUi: true,
  defaultSessionSources(env = process.env): string[] {
    const home = os.homedir();
    const kimiHome = env.KIMI_CODE_HOME ?? path.join(home, ".kimi-code");
    return [existing(kimiHome, "sessions"), existing(kimiHome, "session_index.jsonl")];
  },
  skillTarget(projectRoot: string, options?: SkillTargetOptions) {
    return preferredProjectSkillDirectory("kimi", projectRoot, options);
  },
  detect(config: AppConfig): ToolStatus {
    return status(this, config);
  },
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand {
    return { command: configuredCommand(config, "kimi"), args: [], cwd };
  },
  buildResumeCommand(config: AppConfig, session: SessionEntry): LaunchCommand {
    if (!session.nativeSessionId) throw new Error("Kimi Code session is missing native session id");
    if (!session.originalCwd) throw new Error("Kimi Code session is missing cwd");
    return { command: configuredCommand(config, "kimi"), args: ["--session", session.nativeSessionId], cwd: session.originalCwd };
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
  skillTarget(projectRoot: string, options?: SkillTargetOptions) {
    return preferredProjectSkillDirectory("qoder", projectRoot, options);
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

export const codeBuddyAdapter: ToolAdapter = {
  id: "codebuddy",
  parserVersion: "codebuddy-code-json-v1",
  sourceFormat: "codebuddy-code-json",
  capabilities: { launchNew: true, scanHistory: true, resume: true },
  visibleInProjectUi: true,
  defaultSessionSources(env = process.env): string[] {
    const home = os.homedir();
    const codebuddyHome = env.CODEBUDDY_HOME ?? path.join(home, ".codebuddy");
    return [existing(codebuddyHome, "sessions"), existing(codebuddyHome, "projects")];
  },
  skillTarget(projectRoot: string, options?: SkillTargetOptions) {
    return preferredProjectSkillDirectory("codebuddy", projectRoot, options);
  },
  detect(config: AppConfig): ToolStatus {
    return status(this, config);
  },
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand {
    return { command: configuredCommand(config, "codebuddy"), args: [], cwd };
  },
  buildResumeCommand(config: AppConfig, session: SessionEntry): LaunchCommand {
    if (!session.nativeSessionId) throw new Error("CodeBuddy Code session is missing native session id");
    if (!session.originalCwd) throw new Error("CodeBuddy Code session is missing cwd");
    return { command: configuredCommand(config, "codebuddy"), args: ["--resume", session.nativeSessionId], cwd: session.originalCwd };
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
  skillTarget(projectRoot: string, options?: SkillTargetOptions) {
    return preferredProjectSkillDirectory("copilot", projectRoot, options);
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

export const cursorAdapter: ToolAdapter = {
  id: "cursor",
  parserVersion: "cursor-json-v1",
  sourceFormat: "cursor-json",
  capabilities: { launchNew: true, scanHistory: true, resume: true },
  visibleInProjectUi: true,
  defaultSessionSources(env = process.env): string[] {
    const home = os.homedir();
    const cursorHome = env.CURSOR_HOME ?? path.join(home, ".cursor");
    return [existing(cursorHome, "projects"), existing(cursorHome, "chats")];
  },
  skillTarget(projectRoot: string, options?: SkillTargetOptions) {
    return preferredProjectSkillDirectory("cursor", projectRoot, options);
  },
  detect(config: AppConfig): ToolStatus {
    return status(this, config);
  },
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand {
    return { command: config.tools.cursor.command, args: [], cwd };
  },
  buildResumeCommand(config: AppConfig, session: SessionEntry): LaunchCommand {
    if (!session.nativeSessionId) throw new Error("Cursor Agent session is missing native session id");
    if (!session.originalCwd) throw new Error("Cursor Agent session is missing cwd");
    return { command: config.tools.cursor.command, args: ["--resume", session.nativeSessionId], cwd: session.originalCwd };
  }
};

export const antigravityAdapter: ToolAdapter = {
  id: "antigravity",
  parserVersion: "antigravity-json-v1",
  sourceFormat: "antigravity-json",
  capabilities: { launchNew: true, scanHistory: true, resume: true },
  visibleInProjectUi: true,
  defaultSessionSources(env = process.env): string[] {
    const home = os.homedir();
    const geminiHome = env.GEMINI_HOME ?? path.join(home, ".gemini");
    const antigravityHome = env.ANTIGRAVITY_HOME ?? path.join(geminiHome, "antigravity");
    const antigravityCliHome = env.ANTIGRAVITY_CLI_HOME ?? path.join(geminiHome, "antigravity-cli");
    return [
      existing(antigravityHome, "brain"),
      existing(antigravityHome, "conversations"),
      existing(antigravityCliHome, "conversations"),
      existing(geminiHome, "conversations")
    ];
  },
  skillTarget(projectRoot: string, options?: SkillTargetOptions) {
    return preferredProjectSkillDirectory("antigravity", projectRoot, options);
  },
  detect(config: AppConfig): ToolStatus {
    return status(this, config);
  },
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand {
    return { command: config.tools.antigravity.command, args: [], cwd };
  },
  buildResumeCommand(config: AppConfig, session: SessionEntry): LaunchCommand {
    if (!session.nativeSessionId) throw new Error("Antigravity session is missing native session id");
    if (!session.originalCwd) throw new Error("Antigravity session is missing cwd");
    return { command: config.tools.antigravity.command, args: ["--conversation", session.nativeSessionId], cwd: session.originalCwd };
  }
};


export const traeAdapter: ToolAdapter = {
  id: "trae",
  parserVersion: "trae-cli-undocumented-v1",
  sourceFormat: "trae-cli-undocumented",
  capabilities: { launchNew: true, scanHistory: false, resume: false },
  visibleInProjectUi: true,
  defaultSessionSources(): string[] {
    return [];
  },
  skillTarget(projectRoot: string, options?: SkillTargetOptions) {
    return preferredProjectSkillDirectory("trae", projectRoot, options);
  },
  detect(config: AppConfig): ToolStatus {
    return status(this, config);
  },
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand {
    const command = configuredCommand(config, "trae");
    return { command, args: isOpenSourceTraeCliCommand(command) ? ["interactive"] : [], cwd };
  },
  buildResumeCommand(): LaunchCommand {
    throw new Error("Trae CLI resume is not supported because the session history format is not documented");
  }
};

export const deepcodeAdapter: ToolAdapter = {
  id: "deepcode",
  parserVersion: "deepcode-index-v1",
  sourceFormat: "deepcode-index",
  capabilities: { launchNew: true, scanHistory: true, resume: true },
  visibleInProjectUi: true,
  defaultSessionSources(env = process.env): string[] {
    const home = os.homedir();
    const deepcodeHome = env.DEEPCODE_HOME ?? path.join(home, ".deepcode");
    return [existing(deepcodeHome, "projects")];
  },
  skillTarget(projectRoot: string, options?: SkillTargetOptions) {
    return preferredProjectSkillDirectory("deepcode", projectRoot, options);
  },
  detect(config: AppConfig): ToolStatus {
    return status(this, config);
  },
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand {
    return { command: configuredCommand(config, "deepcode"), args: [], cwd };
  },
  buildResumeCommand(config: AppConfig, session: SessionEntry): LaunchCommand {
    if (!session.nativeSessionId) throw new Error("Deep Code session is missing native session id");
    if (!session.originalCwd) throw new Error("Deep Code session is missing cwd");
    return { command: configuredCommand(config, "deepcode"), args: ["-p", `/resume ${session.nativeSessionId}`], cwd: session.originalCwd };
  }
};

export const reasonixAdapter: ToolAdapter = {
  id: "reasonix",
  parserVersion: "reasonix-jsonl-v1",
  sourceFormat: "reasonix-jsonl",
  capabilities: { launchNew: true, scanHistory: true, resume: true },
  visibleInProjectUi: true,
  defaultSessionSources(env = process.env): string[] {
    const home = os.homedir();
    const reasonixHome = env.REASONIX_HOME ?? path.join(home, ".reasonix");
    return [existing(reasonixHome, "sessions")];
  },
  skillTarget() {
    return unsupportedSkillDirectory("Reasonix 暂无项目级 skill link 目录映射");
  },
  detect(config: AppConfig): ToolStatus {
    return status(this, config);
  },
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand {
    return { command: configuredCommand(config, "reasonix"), args: ["code"], cwd };
  },
  buildResumeCommand(config: AppConfig, session: SessionEntry): LaunchCommand {
    if (!session.nativeSessionId) throw new Error("Reasonix session is missing native session id");
    if (!session.originalCwd) throw new Error("Reasonix session is missing cwd");
    return { command: configuredCommand(config, "reasonix"), args: ["code", "--session", session.nativeSessionId], cwd: session.originalCwd };
  }
};

export const toolAdapters: Record<ToolId, ToolAdapter> = {
  codex: codexAdapter,
  claude: claudeAdapter,
  cline: clineAdapter,
  opencode: opencodeAdapter,
  kilo: kiloAdapter,
  qwen: qwenAdapter,
  kimi: kimiAdapter,
  qoder: qoderAdapter,
  codebuddy: codeBuddyAdapter,
  copilot: copilotAdapter,
  cursor: cursorAdapter,
  antigravity: antigravityAdapter,
  trae: traeAdapter,
  deepcode: deepcodeAdapter,
  reasonix: reasonixAdapter
};

export function listToolStatuses(config: AppConfig): ToolStatus[] {
  return Object.values(toolAdapters).map((adapter) => adapter.detect(config));
}

export function projectVisibleToolStatuses(config: AppConfig): ToolStatus[] {
  return listToolStatuses(config).filter((tool) => tool.visibleInProjectUi);
}

export function projectConfigurableToolStatuses(config: AppConfig): ToolStatus[] {
  return listToolStatuses(config).filter((tool) => tool.visibleInProjectUi && tool.capabilities.launchNew && tool.available);
}

export function adapterFor(toolId: ToolId): ToolAdapter {
  return toolAdapters[toolId];
}

export function existingSources(sources: string[]): string[] {
  return sources.filter((source) => fs.existsSync(source));
}

export function sessionSourcesForAdapter(adapter: ToolAdapter, config: AppConfig): string[] {
  const configuredSources = config.tools[adapter.id]?.sessionSources;
  return configuredSources?.length ? configuredSources : adapter.defaultSessionSources();
}
