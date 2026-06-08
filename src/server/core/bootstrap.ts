import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isTerminalMode, toolIds, type AppConfig, type BootstrapState, type ToolId } from "../../shared/types.js";

export interface BootstrapFile {
  version: 1;
  dataDir: string;
}

const appDirectoryName = "local-ai-workbench";
const legacyAppDirectoryName = "github-repo-manager";

export function getDefaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(base, appDirectoryName);
}

export function getBootstrapPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(base, appDirectoryName, "bootstrap.json");
}

export function getLegacyBootstrapPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(base, legacyAppDirectoryName, "bootstrap.json");
}

export function readBootstrap(bootstrapPath = getBootstrapPath()): BootstrapFile | null {
  if (!fs.existsSync(bootstrapPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(bootstrapPath, "utf8")) as Partial<BootstrapFile>;
  if (parsed.version !== 1 || typeof parsed.dataDir !== "string" || parsed.dataDir.length === 0) {
    throw new Error(`Invalid bootstrap config: ${bootstrapPath}`);
  }
  return { version: 1, dataDir: parsed.dataDir };
}

export function writeBootstrap(dataDir: string, bootstrapPath = getBootstrapPath()): void {
  fs.mkdirSync(path.dirname(bootstrapPath), { recursive: true });
  const payload: BootstrapFile = { version: 1, dataDir };
  fs.writeFileSync(bootstrapPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function defaultAppConfig(): AppConfig {
  const tools: Record<ToolId, { command: string; sessionSources?: string[] }> = {
    codex: { command: "codex" },
    claude: { command: "claude" },
    cline: { command: "cline" },
    opencode: { command: "opencode" },
    kilo: { command: "kilo" },
    qwen: { command: "qwen" },
    kimi: { command: "kimi" },
    qoder: { command: "qodercli" },
    codebuddy: { command: "codebuddy" },
    copilot: { command: "copilot" },
    cursor: { command: "cursor-agent" },
    antigravity: { command: "agy" },
    deepcode: { command: "deepcode" },
    reasonix: { command: "reasonix" }
  };
  return { version: 1, tools, terminal: { mode: "new-window" }, skillhub: { rootDir: "" } };
}

export function ensureConfigFiles(dataDir: string): AppConfig {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "backups"), { recursive: true });
  const configPath = path.join(dataDir, "config.json");
  if (!fs.existsSync(configPath)) {
    const config = normalizeConfig(defaultAppConfig(), dataDir);
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return config;
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as AppConfig;
  return normalizeConfig(config, dataDir);
}

export function writeAppConfig(dataDir: string, config: AppConfig): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const configPath = path.join(dataDir, "config.json");
  if (fs.existsSync(configPath)) {
    fs.copyFileSync(configPath, path.join(dataDir, "config.json.bak"));
  }
  fs.writeFileSync(configPath, `${JSON.stringify(normalizeConfig(config, dataDir), null, 2)}\n`, "utf8");
}

export function normalizeConfig(config: AppConfig, dataDir?: string): AppConfig {
  const defaults = defaultAppConfig();
  const configuredSkillHubRoot =
    typeof config.skillhub?.rootDir === "string" && config.skillhub.rootDir.trim().length > 0
      ? config.skillhub.rootDir.trim()
      : dataDir
        ? path.join(dataDir, "skillhub")
        : defaults.skillhub.rootDir;
  return {
    version: 1,
    tools: Object.fromEntries(toolIds.map((toolId) => [toolId, { ...defaults.tools[toolId], ...(config.tools?.[toolId] ?? {}) }])) as AppConfig["tools"],
    terminal: { mode: isTerminalMode(config.terminal?.mode) ? config.terminal.mode : defaults.terminal.mode },
    skillhub: { rootDir: configuredSkillHubRoot }
  };
}

export function resolveBootstrapState(dataDirArg: string | null): BootstrapState {
  const defaultDataDir = getDefaultDataDir();
  if (dataDirArg) {
    return {
      initialized: true,
      dataDir: dataDirArg,
      defaultDataDir,
      overriddenByArg: true
    };
  }

  const bootstrap = readBootstrap() ?? readBootstrap(getLegacyBootstrapPath());
  return {
    initialized: Boolean(bootstrap),
    dataDir: bootstrap?.dataDir ?? null,
    defaultDataDir,
    overriddenByArg: false
  };
}
