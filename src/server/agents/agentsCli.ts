import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  agentsIntegrationNames,
  type AppConfig,
  type AgentsCommandResult,
  type AgentsConfigSyncStatus,
  type AgentsIntegrationName,
  type AgentsStatusPayload
} from "../../shared/types.js";

interface AgentsTarget {
  id: string;
  rootPath: string;
}

interface ResolvedAgentsCli {
  available: boolean;
  command: string;
  baseArgs: string[];
  displayCommand: string;
  shell: boolean;
  reason: string | null;
}

interface RawCommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function getAgentsStatus(config: AppConfig, project: AgentsTarget): AgentsConfigSyncStatus {
  const cli = resolveAgentsCli(config);
  const configPath = agentsConfigPath(project.rootPath);
  const initialized = fs.existsSync(configPath);

  if (!cli.available) {
    return statusEnvelope(project, cli, initialized, null, cli.reason ?? "未找到 agents CLI");
  }

  if (!initialized) {
    return statusEnvelope(project, cli, false, null, null);
  }

  const result = runAgentsCli(cli, project.rootPath, ["status", "--path", project.rootPath, "--json", "--fast"]);
  if (result.exitCode !== 0) {
    return statusEnvelope(project, cli, true, null, compactCommandError(result));
  }

  const parsed = parseAgentsStatus(result.stdout);
  if (!parsed) {
    return statusEnvelope(project, cli, true, null, "agents status returned invalid JSON");
  }

  return statusEnvelope(project, cli, true, parsed, null);
}

export function initializeAgentsProject(config: AppConfig, project: AgentsTarget): AgentsCommandResult {
  const result = runProjectCommand(config, project, "init", ["init", "--path", project.rootPath], [0]);
  return result;
}

export function syncAgentsProject(config: AppConfig, project: AgentsTarget, check: boolean): AgentsCommandResult {
  return runProjectCommand(
    config,
    project,
    check ? "sync-check" : "sync",
    ["sync", "--path", project.rootPath, ...(check ? ["--check"] : [])],
    check ? [0, 2] : [0]
  );
}

export function updateAgentsIntegrations(config: AppConfig, project: AgentsTarget, enabledIntegrations: AgentsIntegrationName[]): AgentsCommandResult {
  const current = getAgentsStatus(config, project);
  if (!current.initialized) {
    throw new Error("请先初始化 agents 配置");
  }
  if (!current.status) {
    throw new Error(current.error ?? "无法读取 agents 当前配置");
  }

  const next = uniqueIntegrations(enabledIntegrations);
  const currentEnabled = current.status.enabledIntegrations;
  const toDisable = currentEnabled.filter((name) => !next.includes(name));
  const toEnable = next.filter((name) => !currentEnabled.includes(name));

  let last: RawCommandResult | null = null;
  const cli = resolveAgentsCli(config);
  if (!cli.available) {
    throw new Error(cli.reason ?? "未找到 agents CLI");
  }

  if (toDisable.length > 0) {
    last = runAgentsCli(cli, project.rootPath, ["disconnect", "--path", project.rootPath, "--llm", toDisable.join(",")]);
    assertAllowedExit(last, [0]);
  }

  if (toEnable.length > 0) {
    last = runAgentsCli(cli, project.rootPath, ["connect", "--path", project.rootPath, "--llm", toEnable.join(",")]);
    assertAllowedExit(last, [0]);
  }

  if (!last) {
    const status = getAgentsStatus(config, project);
    return {
      projectId: project.id,
      projectRoot: project.rootPath,
      action: "integrations",
      command: cli.displayCommand,
      exitCode: 0,
      ok: true,
      changed: [],
      stdout: "",
      stderr: "",
      status
    };
  }

  const status = getAgentsStatus(config, project);
  return {
    projectId: project.id,
    projectRoot: project.rootPath,
    action: "integrations",
    command: last.command,
    exitCode: last.exitCode,
    ok: true,
    changed: parseChangedEntries(`${last.stdout}\n${last.stderr}`),
    stdout: last.stdout,
    stderr: last.stderr,
    status
  };
}

function runProjectCommand(
  config: AppConfig,
  project: AgentsTarget,
  action: AgentsCommandResult["action"],
  args: string[],
  allowedExitCodes: number[]
): AgentsCommandResult {
  const cli = resolveAgentsCli(config);
  if (!cli.available) {
    throw new Error(cli.reason ?? "未找到 agents CLI");
  }
  const result = runAgentsCli(cli, project.rootPath, args);
  assertAllowedExit(result, allowedExitCodes);
  const status = getAgentsStatus(config, project);
  return {
    projectId: project.id,
    projectRoot: project.rootPath,
    action,
    command: result.command,
    exitCode: result.exitCode,
    ok: allowedExitCodes.includes(result.exitCode),
    changed: parseChangedEntries(`${result.stdout}\n${result.stderr}`),
    stdout: result.stdout,
    stderr: result.stderr,
    status
  };
}

function runAgentsCli(cli: ResolvedAgentsCli, cwd: string, args: string[]): RawCommandResult {
  const fullArgs = [...cli.baseArgs, "--no-update-check", ...args];
  const result = spawnSync(cli.command, fullArgs, {
    cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    shell: cli.shell,
    env: {
      ...process.env,
      AGENTS_NO_UPDATE_CHECK: "1",
      NO_COLOR: "1"
    }
  });
  return {
    command: [cli.displayCommand, "--no-update-check", ...args].join(" "),
    exitCode: result.status ?? 1,
    stdout: stripAnsi(result.stdout ?? ""),
    stderr: stripAnsi(result.stderr ?? (result.error ? result.error.message : ""))
  };
}

function resolveAgentsCli(config: AppConfig): ResolvedAgentsCli {
  const configuredPath = config.agents.cliPath.trim();
  if (!configuredPath) {
    return unavailable("未启用多 agents 同步；请先在设置中填写 agents CLI 路径或 agents 项目目录", "未配置");
  }

  const resolvedPath = resolveCliPath(configuredPath);
  if (!resolvedPath) {
    return unavailable(`未找到 agents CLI：${configuredPath}`, configuredPath);
  }

  return commandForPath(resolvedPath);
}

function commandForPath(filePath: string): ResolvedAgentsCli {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".cmd" || extension === ".bat") {
    return {
      available: true,
      command: filePath,
      baseArgs: [],
      displayCommand: filePath,
      shell: true,
      reason: null
    };
  }

  return {
    available: true,
    command: process.execPath,
    baseArgs: [filePath],
    displayCommand: `${process.execPath} ${filePath}`,
    shell: false,
    reason: null
  };
}

function resolveCliPath(inputPath: string): string | null {
  if (fs.existsSync(inputPath) && fs.statSync(inputPath).isFile()) {
    return inputPath;
  }

  if (fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory()) {
    const candidates = [
      path.join(inputPath, "bin", "agents"),
      path.join(inputPath, "bin", "agents.cmd"),
      path.join(inputPath, "bin", "agents.bat"),
      path.join(inputPath, "agents"),
      path.join(inputPath, "agents.cmd"),
      path.join(inputPath, "agents.bat")
    ];
    return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
  }

  return null;
}

function unavailable(reason: string, displayCommand: string): ResolvedAgentsCli {
  return {
    available: false,
    command: displayCommand,
    baseArgs: [],
    displayCommand,
    shell: false,
    reason
  };
}

function statusEnvelope(
  project: AgentsTarget,
  cli: ResolvedAgentsCli,
  initialized: boolean,
  status: AgentsStatusPayload | null,
  error: string | null
): AgentsConfigSyncStatus {
  return {
    projectId: project.id,
    projectRoot: project.rootPath,
    available: cli.available,
    initialized,
    command: cli.displayCommand,
    configPath: agentsConfigPath(project.rootPath),
    status,
    error
  };
}

function agentsConfigPath(projectRoot: string): string {
  return path.join(projectRoot, ".agents", "agents.json");
}

function parseAgentsStatus(stdout: string): AgentsStatusPayload | null {
  const jsonText = firstJsonObject(stdout);
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as Partial<AgentsStatusPayload>;
    return {
      projectRoot: typeof parsed.projectRoot === "string" ? parsed.projectRoot : "",
      enabledIntegrations: uniqueIntegrations(parsed.enabledIntegrations),
      syncMode: typeof parsed.syncMode === "string" ? parsed.syncMode : "",
      selectedMcpServers: Array.isArray(parsed.selectedMcpServers)
        ? parsed.selectedMcpServers.filter((item): item is string => typeof item === "string")
        : [],
      mcp: {
        configured: typeof parsed.mcp?.configured === "number" ? parsed.mcp.configured : 0,
        localOverrides: typeof parsed.mcp?.localOverrides === "number" ? parsed.mcp.localOverrides : 0
      },
      files: isRecord(parsed.files) ? booleanRecord(parsed.files) : {},
      probes: isRecord(parsed.probes) ? stringRecord(parsed.probes) : {},
      probesSkipped: Boolean(parsed.probesSkipped)
    };
  } catch {
    return null;
  }
}

function firstJsonObject(stdout: string): string | null {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  return trimmed.slice(start, end + 1);
}

function uniqueIntegrations(values: unknown): AgentsIntegrationName[] {
  if (!Array.isArray(values)) return [];
  const allowed = new Set<string>(agentsIntegrationNames);
  return [...new Set(values.filter((value): value is AgentsIntegrationName => typeof value === "string" && allowed.has(value)))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function booleanRecord(value: Record<string, unknown>): Record<string, boolean> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Boolean(item)]));
}

function stringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function assertAllowedExit(result: RawCommandResult, allowedExitCodes: number[]): void {
  if (allowedExitCodes.includes(result.exitCode)) return;
  throw new Error(compactCommandError(result));
}

function compactCommandError(result: RawCommandResult): string {
  const detail = [result.stderr, result.stdout]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  return detail ?? `agents command failed with exit code ${result.exitCode}`;
}

function parseChangedEntries(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s>*→›-]+/, "").trim())
    .filter((line) => line.startsWith(".") || line.endsWith("-scope") || line.endsWith("-approval"));
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}
