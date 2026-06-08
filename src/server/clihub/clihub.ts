import { exec, execFile, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  CliHubChannel,
  CliHubCli,
  CliHubCustomInstallCommandInput,
  CliHubCustomLocalPathInput,
  CliHubList,
  CliHubOperationKind,
  CliHubOperationResult,
  CliHubProvider,
  CliHubProviderRef,
  CliHubRunningOperation,
  LaunchCommand
} from "../../shared/types.js";
import { nowIso } from "../core/time.js";
import type { AppDatabase } from "../storage/database.js";

export interface CliHubCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CliHubCommandRunner {
  lookup(commandName: string): Promise<string[]>;
  run(command: string, args: string[], options?: { timeoutMs?: number; cwd?: string }): Promise<CliHubCommandResult>;
}

export interface CliHubPathManager {
  ensureUserPath(directory: string): Promise<void>;
  refreshProcessPath?(): Promise<void>;
}

export interface CliHubRuntimeOptions {
  commandRunner?: CliHubCommandRunner;
  pathManager?: CliHubPathManager;
  operationRunner?: CliHubOperationRunner;
}

export interface CliHubUpdateLaunchPlan {
  cli: CliHubCli;
  provider: CliHubProvider;
  command: LaunchCommand;
  commandText: string;
}

export interface CliHubUpdateCompletionCallback {
  url: string;
  token: string;
}

export interface CliHubTerminalUpdateCompletion {
  exitCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
}

interface BuiltInCli {
  cliId: string;
  displayName: string;
  kind: CliHubCli["kind"];
  commandNames: string[];
  channels: CliHubChannel[];
  windowsPathHints?: string[];
}

interface InstallCommandParseResult {
  channel: CliHubChannel;
  inferredCommandName: string;
  displayName: string;
}

interface CliHubDiscoveryOptions {
  includeDetails?: boolean;
}

const outputLimit = 1200;
const defaultCommandTimeoutMs = 30000;
const discoveryCommandTimeoutMs = 3000;
const versionCommandTimeoutMs = 5000;
const pathWriteTimeoutMs = 10000;
const updateCheckCommandTimeoutMs = 60000;
const installOrUpdateCommandTimeoutMs = 5 * 60 * 1000;
const defaultCommandRunner: CliHubCommandRunner = {
  async lookup(commandName: string) {
    const result =
      process.platform === "win32"
        ? await runProcess("where.exe", [commandName], { timeoutMs: discoveryCommandTimeoutMs })
        : await runProcess("sh", ["-lc", `command -v ${shellQuote(commandName)}`], { timeoutMs: discoveryCommandTimeoutMs });
    if (result.exitCode !== 0) return [];
    const paths = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return process.platform === "win32" ? sortWindowsCommandPaths(paths) : paths;
  },
  async run(command: string, args: string[], options = {}) {
    const resolvedCommand = process.platform === "win32" ? resolveWindowsCommand(command) : command;
    return runProcess(resolvedCommand, args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? defaultCommandTimeoutMs,
      shell: process.platform === "win32" && isWindowsShellCommand(resolvedCommand)
    });
  }
};

const defaultPathManager: CliHubPathManager = {
  async ensureUserPath(directory: string) {
    const key = process.platform === "win32" && process.env.Path !== undefined ? "Path" : "PATH";
    if (process.platform === "win32") {
      const userEntries = readWindowsRegistryPath("HKCU\\Environment");
      if (!userEntries.some((entry) => samePath(entry, directory))) {
        const result = spawnSync("setx", ["PATH", uniquePathEntries([...userEntries, directory]).join(path.delimiter)], {
          encoding: "utf8",
          timeout: pathWriteTimeoutMs
        });
        if (result.status !== 0) throw new Error(`用户 PATH 写入失败：${clipText(String(result.stderr || result.stdout || ""))}`);
      }
      const nextProcessPath = uniquePathEntries([...splitPathEntries(process.env[key] ?? process.env.PATH ?? ""), directory]).join(path.delimiter);
      process.env[key] = nextProcessPath;
      process.env.PATH = nextProcessPath;
      return;
    }
    const current = process.env[key] ?? "";
    const entries = current.split(path.delimiter).filter(Boolean);
    if (entries.some((entry) => samePath(entry, directory))) return;
    const next = [...entries, directory].join(path.delimiter);
    process.env[key] = next;
    if (key !== "PATH") process.env.PATH = next;
  },
  async refreshProcessPath() {
    refreshProcessPathFromRegistry();
  }
};

interface RunProcessOptions {
  timeoutMs: number;
  cwd?: string | undefined;
  shell?: boolean;
}

interface ChildProcessError extends Error {
  code?: number | string | null;
}

function runProcess(command: string, args: string[], options: RunProcessOptions): Promise<CliHubCommandResult> {
  return new Promise((resolve) => {
    const onComplete = (error: ChildProcessError | null, stdout: string | Buffer, stderr: string | Buffer) => {
      const stdoutText = String(stdout ?? "");
      const stderrText = String(stderr ?? "");
      const errorText = error && !stdoutText.trim() && !stderrText.trim() ? error.message : "";
      resolve({
        exitCode: error ? childProcessExitCode(error) : 0,
        stdout: clipText(stdoutText),
        stderr: clipText([stderrText, errorText].filter(Boolean).join("\n"))
      });
    };
    const execOptions = {
      cwd: options.cwd,
      encoding: "utf8" as const,
      timeout: options.timeoutMs,
      windowsHide: true
    };

    try {
      if (options.shell) {
        exec(windowsCommandLine([command, ...args]), execOptions, onComplete);
        return;
      }
      execFile(command, args, execOptions, onComplete);
    } catch (error) {
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: clipText(error instanceof Error ? error.message : "command failed")
      });
    }
  });
}

function childProcessExitCode(error: ChildProcessError): number {
  return typeof error.code === "number" ? error.code : 1;
}

function refreshProcessPathFromRegistry(): void {
  if (process.platform !== "win32") return;
  const key = process.env.Path !== undefined ? "Path" : "PATH";
  const current = process.env[key] ?? process.env.PATH ?? "";
  const next = uniquePathEntries([...splitPathEntries(current), ...readWindowsRegistryPath("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"), ...readWindowsRegistryPath("HKCU\\Environment")]);
  if (next.length === 0) return;
  const value = next.join(path.delimiter);
  process.env[key] = value;
  process.env.PATH = value;
}

function readWindowsRegistryPath(registryKey: string): string[] {
  const result = spawnSync("reg.exe", ["query", registryKey, "/v", "Path"], {
    encoding: "utf8",
    timeout: discoveryCommandTimeoutMs
  });
  if (result.status !== 0) return [];
  const output = String(result.stdout ?? "");
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s{2,}/);
    if ((parts[0] ?? "").toLowerCase() !== "path" || !/^REG_/i.test(parts[1] ?? "")) continue;
    return splitPathEntries(expandWindowsEnvironmentVariables(parts.slice(2).join("  ")));
  }
  return [];
}

function expandWindowsEnvironmentVariables(value: string): string {
  return value.replace(/%([^%]+)%/g, (match, name: string) => process.env[name] ?? process.env[name.toUpperCase()] ?? process.env[name.toLowerCase()] ?? match);
}

function splitPathEntries(value: string): string[] {
  return value.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
}

function uniquePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const entry of entries) {
    const key = path.resolve(entry).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

const builtInClis: BuiltInCli[] = [
  {
    cliId: "codex",
    displayName: "Codex",
    kind: "project-tool",
    commandNames: ["codex"],
    channels: [
      providerChannel("codex:npm", "npm", "@openai/codex"),
      providerChannel("codex:winget", "winget", "OpenAI.Codex")
    ]
  },
  {
    cliId: "claude",
    displayName: "Claude Code",
    kind: "project-tool",
    commandNames: ["claude"],
    channels: [
      providerChannel("claude:npm", "npm", "@anthropic-ai/claude-code"),
      providerChannel("claude:winget", "winget", "Anthropic.ClaudeCode")
    ]
  },
  {
    cliId: "cline",
    displayName: "Cline",
    kind: "project-tool",
    commandNames: ["cline"],
    channels: [providerChannel("cline:npm", "npm", "cline")]
  },
  {
    cliId: "opencode",
    displayName: "OpenCode",
    kind: "project-tool",
    commandNames: ["opencode"],
    channels: [providerChannel("opencode:npm", "npm", "opencode-ai")]
  },
  {
    cliId: "kilo",
    displayName: "Kilo Code CLI",
    kind: "project-tool",
    commandNames: ["kilo"],
    channels: [providerChannel("kilo:npm", "npm", "@kilocode/cli")]
  },
  {
    cliId: "qwen",
    displayName: "Qwen Code",
    kind: "project-tool",
    commandNames: ["qwen"],
    channels: [providerChannel("qwen:npm", "npm", "@qwen-code/qwen-code")]
  },
  {
    cliId: "kimi",
    displayName: "Kimi Code",
    kind: "project-tool",
    commandNames: ["kimi"],
    channels: [
      providerChannel("kimi:npm", "npm", "@moonshot-ai/kimi-code"),
      installerCommandChannel("kimi:official-windows", "official install script: Windows PowerShell", "kimi", [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "irm https://code.kimi.com/kimi-code/install.ps1 | iex"
      ])
    ]
  },
  {
    cliId: "qoder",
    displayName: "Qoder",
    kind: "project-tool",
    commandNames: ["qoder"],
    channels: [providerChannel("qoder:npm", "npm", "@qoder-ai/qodercli")]
  },
  {
    cliId: "codebuddy",
    displayName: "CodeBuddy Code",
    kind: "project-tool",
    commandNames: ["codebuddy"],
    channels: [providerChannel("codebuddy:npm", "npm", "@tencent-ai/codebuddy-code")]
  },
  {
    cliId: "copilot",
    displayName: "GitHub Copilot CLI",
    kind: "project-tool",
    commandNames: ["copilot"],
    channels: [providerChannel("copilot:npm", "npm", "@github/copilot")]
  },
  {
    cliId: "cursor",
    displayName: "Cursor Agent",
    kind: "project-tool",
    commandNames: ["cursor-agent"],
    windowsPathHints: ["%LOCALAPPDATA%\\cursor-agent\\cursor-agent.cmd"],
    channels: [
      installerCommandChannel("cursor:official-windows", "official install script: Windows PowerShell", "cursor-agent", [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "iex (irm 'https://cursor.com/install?win32=true')"
      ])
    ]
  },
  {
    cliId: "antigravity",
    displayName: "Antigravity",
    kind: "project-tool",
    commandNames: ["agy"],
    windowsPathHints: ["%LOCALAPPDATA%\\agy\\bin\\agy.exe"],
    channels: [
      installerCommandChannel("antigravity:official-windows", "official install script: Windows PowerShell", "agy", [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "iex (irm 'https://antigravity.google/cli/install.ps1')"
      ])
    ]
  },
  {
    cliId: "lark-cli",
    displayName: "lark-cli",
    kind: "function",
    commandNames: ["lark-cli"],
    channels: []
  },
  {
    cliId: "gh",
    displayName: "GitHub CLI",
    kind: "function",
    commandNames: ["gh"],
    channels: [
      providerChannel("gh:winget", "winget", "GitHub.cli"),
      providerChannel("gh:choco", "choco", "gh"),
      providerChannel("gh:scoop", "scoop", "gh")
    ]
  },
  {
    cliId: "playwright",
    displayName: "Playwright",
    kind: "function",
    commandNames: ["playwright"],
    channels: [providerChannel("playwright:npm", "npm", "@playwright/test")]
  },
  {
    cliId: "node",
    displayName: "Node.js",
    kind: "dependency",
    commandNames: ["node"],
    channels: [
      providerChannel("node:winget", "winget", "OpenJS.NodeJS.LTS"),
      providerChannel("node:choco", "choco", "nodejs-lts"),
      providerChannel("node:scoop", "scoop", "nodejs-lts")
    ]
  },
  {
    cliId: "npm",
    displayName: "npm",
    kind: "dependency",
    commandNames: ["npm"],
    channels: [providerChannel("npm:winget-node", "winget", "OpenJS.NodeJS.LTS")]
  },
  {
    cliId: "git",
    displayName: "Git",
    kind: "dependency",
    commandNames: ["git"],
    channels: [
      providerChannel("git:winget", "winget", "Git.Git"),
      providerChannel("git:choco", "choco", "git"),
      providerChannel("git:scoop", "scoop", "git")
    ]
  }
];

const localOnlyExperimentalCliIds = new Set(["deepcode", "reasonix"]);

export class CliHubOperationRunner {
  private running: CliHubRunningOperation | null = null;

  current(): CliHubRunningOperation | null {
    return this.running;
  }

  async run<T>(cli: Pick<CliHubCli, "cliId" | "displayName">, kind: CliHubOperationKind, action: () => Promise<T>): Promise<T> {
    if (this.running) throw new Error(`CliHub operation already running: ${this.running.cliDisplayName}`);
    this.running = { kind, cliId: cli.cliId, cliDisplayName: cli.displayName, startedAt: nowIso() };
    try {
      return await action();
    } finally {
      this.running = null;
    }
  }
}

const defaultOperationRunner = new CliHubOperationRunner();

export function listCliHub(database: AppDatabase, options: CliHubRuntimeOptions = {}): CliHubList {
  ensureBuiltInCliHubClis(database);
  return { clis: database.listCliHubClis(), operation: operationRunner(options).current() };
}

export function ensureBuiltInCliHubClis(database: AppDatabase): void {
  demoteLocalOnlyExperimentalBuiltInClis(database);
  database.deleteStaleBuiltInCliHubClis(builtInClis.map((cli) => cli.cliId));
  for (const builtIn of builtInClis) {
    const existing = database.getCliHubCli(builtIn.cliId);
    const channels = mergeChannels(builtIn.channels, existing?.channels.filter((channel) => channel.builtin === false) ?? []);
    database.upsertCliHubCli({
      ...(existing ?? emptyCli(builtIn.cliId, builtIn.displayName, builtIn.kind, "builtin", "builtin", builtIn.commandNames)),
      displayName: builtIn.displayName,
      kind: builtIn.kind,
      sourceType: "builtin",
      sourceState: "builtin",
      commandNames: builtIn.commandNames,
      localPath: null,
      channels
    });
  }
}

function demoteLocalOnlyExperimentalBuiltInClis(database: AppDatabase): void {
  for (const cli of database.listCliHubClis()) {
    if (cli.sourceType !== "builtin" || !localOnlyExperimentalCliIds.has(cli.cliId)) continue;
    const localPath = cli.localPath ?? cli.resolvedPaths[0] ?? null;
    if (!localPath) continue;
    database.upsertCliHubCli({
      ...cli,
      kind: "custom",
      sourceType: "custom",
      sourceState: "local-path",
      localPath,
      channels: [],
      currentProvider: {
        provider: "local-path",
        packageId: null,
        confidence: "high",
        reason: "从已移除的内置实验 CLI 保留为本地自定义 CLI"
      },
      providerCandidates: [],
      updateStatus: "unknown",
      updateCheckedAt: null,
      updateError: null,
      recentOperation: null
    });
  }
}

export async function refreshCliHubDiscovery(database: AppDatabase, cliId?: string | null, options: CliHubRuntimeOptions = {}, discoveryOptions: CliHubDiscoveryOptions = {}): Promise<CliHubList> {
  ensureBuiltInCliHubClis(database);
  const runner = commandRunner(options);
  const clis = cliId ? [requiredCli(database, cliId)] : database.listCliHubClis();
  const discoveredClis = await Promise.all(clis.map((cli) => discoverCli(cli, runner, { includeDetails: discoveryOptions.includeDetails ?? true })));
  for (const cli of discoveredClis) database.upsertCliHubCli(cli);
  return listCliHub(database, options);
}

export async function addCustomLocalPathCli(
  database: AppDatabase,
  input: CliHubCustomLocalPathInput,
  options: CliHubRuntimeOptions = {}
): Promise<CliHubCli> {
  const executablePath = path.resolve(input.executablePath);
  if (!path.isAbsolute(input.executablePath) || !fs.existsSync(executablePath)) {
    throw new Error("本地 CLI 路径必须是存在的可执行文件路径");
  }
  const commandName = normalizeCommandName(input.commandName ?? path.basename(executablePath, path.extname(executablePath)));
  if (!commandName) throw new Error("commandName 不能为空");
  const cli = database.upsertCliHubCli({
    ...emptyCli(customCliId("local", commandName, executablePath), input.displayName?.trim() || commandName, "custom", "custom", "local-path", [commandName]),
    localPath: executablePath,
    channels: [],
    currentProvider: {
      provider: "local-path",
      packageId: null,
      confidence: "high",
      reason: "用户登记的本地可执行文件路径"
    }
  });
  await refreshCliHubDiscovery(database, cli.cliId, options);
  return requiredCli(database, cli.cliId);
}

export async function addCustomInstallCommandCli(
  database: AppDatabase,
  input: CliHubCustomInstallCommandInput,
  options: CliHubRuntimeOptions = {}
): Promise<CliHubCli> {
  const parsed = parseInstallCommand(input.installCommand);
  const commandName = normalizeCommandName(input.commandName ?? parsed.inferredCommandName);
  if (!commandName) throw new Error("commandName 不能为空");
  const displayName = input.displayName?.trim() || parsed.displayName;
  const cli = database.upsertCliHubCli({
    ...emptyCli(customCliId("command", commandName, input.installCommand), displayName, "custom", "custom", "install-command", [commandName]),
    channels: [parsed.channel]
  });
  await refreshCliHubDiscovery(database, cli.cliId, options);
  return requiredCli(database, cli.cliId);
}

export function addCliHubChannel(database: AppDatabase, cliId: string, installCommand: string): CliHubCli {
  ensureBuiltInCliHubClis(database);
  const cli = requiredCli(database, cliId);
  const parsed = parseInstallCommand(installCommand);
  return database.upsertCliHubCli({
    ...cli,
    channels: mergeChannels(cli.channels, [{ ...parsed.channel, builtin: false }])
  });
}

export async function installCliHubCli(
  database: AppDatabase,
  dataDir: string,
  cliId: string,
  channelId?: string | null,
  options: CliHubRuntimeOptions = {}
): Promise<CliHubCli> {
  ensureBuiltInCliHubClis(database);
  const initial = requiredCli(database, cliId);
  return operationRunner(options).run(initial, "install", async () => {
    await refreshCliHubDiscovery(database, cliId, options);
    const cli = requiredCli(database, cliId);
    if (cli.availabilityState === "available") {
      throw new Error("CLI 已可用，CliHub 已阻止安装第二份 provider");
    }
    const channel = channelId ? cli.channels.find((item) => item.channelId === channelId) : cli.channels[0];
    if (!channel) throw new Error("没有可用安装渠道");
    const startedAt = nowIso();
    try {
      let result: CliHubCommandResult;
      const manager = pathManager(options);
      if (channel.provider === "github-release" || channel.appManaged) {
        result = await installManagedBinary(cli, channel, dataDir, manager);
      } else {
        if (!channel.installCommand) throw new Error("安装渠道缺少 installCommand");
        result = await commandRunner(options).run(channel.installCommand[0] ?? "", channel.installCommand.slice(1), {
          timeoutMs: installOrUpdateCommandTimeoutMs
        });
      }
      if (result.exitCode !== 0) throw new CliHubCommandError("CLI 安装失败", result);
      await manager.refreshProcessPath?.();
      await ensureKnownCliInstallDirectoriesOnPath(cli, manager);
      storeOperation(database, cli, commandOperation("install", "success", channel.provider, startedAt, result, "CLI 安装完成"));
      await refreshCliHubDiscovery(database, cliId, options);
      return requiredCli(database, cliId);
    } catch (error) {
      const result = error instanceof CliHubCommandError ? error.result : { exitCode: 1, stdout: "", stderr: errorMessage(error) };
      storeOperation(database, cli, commandOperation("install", "failed", channel.provider, startedAt, result, errorMessage(error)));
      throw error;
    }
  });
}

export async function checkCliHubUpdates(
  database: AppDatabase,
  cliId?: string | null,
  options: CliHubRuntimeOptions = {}
): Promise<CliHubList> {
  ensureBuiltInCliHubClis(database);
  const target = cliId ? requiredCli(database, cliId) : { cliId: "all", displayName: "全部 CLI" };
  await operationRunner(options).run(target, "update-check", async () => {
    const clis = cliId ? [requiredCli(database, cliId)] : database.listCliHubClis();
    for (const cli of clis) {
      await checkOneCliUpdate(database, cli, options);
    }
  });
  return listCliHub(database, options);
}

export async function updateCliHubCli(database: AppDatabase, cliId: string, options: CliHubRuntimeOptions = {}): Promise<CliHubCli> {
  ensureBuiltInCliHubClis(database);
  const initial = requiredCli(database, cliId);
  return operationRunner(options).run(initial, "update", async () => {
    const cli = requiredCli(database, cliId);
    const provider = cli.currentProvider;
    if (!provider || provider.confidence !== "high") throw new Error("当前 CLI 没有明确 provider，不能执行更新");
    if (provider.provider === "local-path") throw new Error("本地路径 CLI 不支持更新");
    const channel = matchingChannel(cli, provider);
    const command = updateCommandFor(channel, provider);
    if (!command) throw new Error("当前 provider 没有明确更新命令");
    const startedAt = nowIso();
    try {
      const result = await commandRunner(options).run(command[0] ?? "", command.slice(1), { timeoutMs: installOrUpdateCommandTimeoutMs });
      if (result.exitCode !== 0) throw new CliHubCommandError("CLI 更新失败", result);
      storeOperation(database, cli, commandOperation("update", "success", provider.provider, startedAt, result, "CLI 更新完成"));
      await refreshCliHubDiscovery(database, cliId, options);
      return requiredCli(database, cliId);
    } catch (error) {
      const result = error instanceof CliHubCommandError ? error.result : { exitCode: 1, stdout: "", stderr: errorMessage(error) };
      storeOperation(database, cli, commandOperation("update", "failed", provider.provider, startedAt, result, errorMessage(error)));
      throw error;
    }
  });
}

export function createCliHubUpdateLaunchPlan(database: AppDatabase, cliId: string, cwd: string): CliHubUpdateLaunchPlan {
  ensureBuiltInCliHubClis(database);
  const cli = requiredCli(database, cliId);
  const provider = cli.currentProvider;
  if (!provider || provider.confidence !== "high") throw new Error("当前 CLI 没有明确 provider，不能执行更新");
  if (provider.provider === "local-path") throw new Error("本地路径 CLI 不支持更新");
  const channel = matchingChannel(cli, provider);
  const parts = updateCommandFor(channel, provider);
  if (!parts?.[0]) throw new Error("当前 provider 没有明确更新命令");
  return {
    cli,
    provider: provider.provider,
    command: { command: parts[0], args: parts.slice(1), cwd },
    commandText: formatCommandLine(parts)
  };
}

export function withCliHubUpdateCompletionCallback(
  plan: CliHubUpdateLaunchPlan,
  callback: CliHubUpdateCompletionCallback,
  platform: NodeJS.Platform = process.platform
): CliHubUpdateLaunchPlan {
  if (platform !== "win32") return plan;
  return {
    ...plan,
    command: {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShellCommand(terminalUpdateCompletionScript(plan.command, callback))],
      cwd: plan.command.cwd
    }
  };
}

export function recordCliHubUpdateTerminalLaunch(
  database: AppDatabase,
  plan: CliHubUpdateLaunchPlan,
  launch: { launched: boolean; host: string; reason: string | null }
): CliHubCli {
  const startedAt = nowIso();
  const message = launch.launched ? `已打开 ${launchHostLabel(launch.host)} 执行更新，实时状态以终端输出为准` : launch.reason ?? "更新终端启动失败";
  storeOperation(
    database,
    plan.cli,
    commandOperation(
      "update",
      launch.launched ? "success" : "failed",
      plan.provider,
      startedAt,
      { exitCode: nullCode(), stdout: plan.commandText, stderr: launch.launched ? "" : message },
      message
    )
  );
  return requiredCli(database, plan.cli.cliId);
}

export async function completeCliHubTerminalUpdate(
  database: AppDatabase,
  cliId: string,
  completion: CliHubTerminalUpdateCompletion,
  options: CliHubRuntimeOptions = {}
): Promise<CliHubList> {
  ensureBuiltInCliHubClis(database);
  const cli = requiredCli(database, cliId);
  const provider = cli.currentProvider?.provider ?? null;
  const startedAt = nowIso();
  const exitCode = completionExitCode(completion.exitCode);
  const result = {
    exitCode,
    stdout: completion.stdout ?? "",
    stderr: completion.stderr ?? ""
  };

  if (exitCode !== 0) {
    storeOperation(database, cli, commandOperation("update", "failed", provider, startedAt, result, `终端更新命令失败，退出码 ${exitCode}`));
    return listCliHub(database, options);
  }

  storeOperation(database, cli, commandOperation("update", "success", provider, startedAt, result, "终端更新完成，正在刷新状态"));
  await refreshCliHubDiscovery(database, cliId, options);
  await checkOneCliUpdate(database, requiredCli(database, cliId), options);
  const refreshed = requiredCli(database, cliId);
  database.upsertCliHubCli({
    ...refreshed,
    recentOperation: commandOperation("update", "success", provider, startedAt, result, terminalUpdateCompletionMessage(refreshed.updateStatus))
  });
  return listCliHub(database, options);
}

export function parseCliHubInstallCommand(input: string): CliHubChannel {
  return parseInstallCommand(input).channel;
}

async function checkOneCliUpdate(database: AppDatabase, cli: CliHubCli, options: CliHubRuntimeOptions): Promise<void> {
  const provider = cli.currentProvider;
  const startedAt = nowIso();
  if (!provider || provider.confidence !== "high" || provider.provider === "local-path") {
    const message = "缺少明确 provider，无法检查更新";
    database.upsertCliHubCli({
      ...cli,
      updateStatus: "unknown",
      updateCheckedAt: nowIso(),
      updateError: message,
      recentOperation: commandOperation("update-check", "failed", provider?.provider ?? null, startedAt, { exitCode: nullCode(), stdout: "", stderr: "" }, message)
    });
    return;
  }
  const channel = matchingChannel(cli, provider);
  const command = checkCommandFor(channel, provider);
  if (!command) {
    const message = "当前 provider 没有明确更新检查命令";
    database.upsertCliHubCli({
      ...cli,
      updateStatus: "unknown",
      updateCheckedAt: nowIso(),
      updateError: message,
      recentOperation: commandOperation("update-check", "failed", provider.provider, startedAt, { exitCode: nullCode(), stdout: "", stderr: "" }, message)
    });
    return;
  }
  const result = await commandRunner(options).run(command[0] ?? "", command.slice(1), { timeoutMs: updateCheckCommandTimeoutMs });
  const updateStatus = updateStatusFromCheck(provider, result, channel);
  const message =
    updateStatus === "unknown"
      ? "更新检查失败"
      : updateStatus === "update-available"
        ? "发现可用更新"
        : "已是最新版本";
  database.upsertCliHubCli({
    ...cli,
    updateStatus,
    updateCheckedAt: nowIso(),
    updateError: updateStatus === "unknown" ? clipText(result.stderr || result.stdout || message) : null,
    recentOperation: commandOperation("update-check", updateStatus === "unknown" ? "failed" : "success", provider.provider, startedAt, result, message)
  });
}

async function discoverCli(cli: CliHubCli, runner: CliHubCommandRunner, options: Required<CliHubDiscoveryOptions>): Promise<CliHubCli> {
  const timestamp = nowIso();
  if (cli.sourceState === "local-path" && cli.localPath) {
    if (!fs.existsSync(cli.localPath)) {
      return {
        ...cli,
        availabilityState: "unavailable",
        resolvedPaths: [],
        version: null,
        versionState: "unknown",
        versionError: null,
        discoveredAt: timestamp,
        currentProvider: null,
        providerCandidates: []
      };
    }
    const version = options.includeDetails ? await readVersion(cli.localPath, runner) : currentVersionSnapshot(cli);
    return {
      ...cli,
      availabilityState: "available",
      resolvedPaths: [cli.localPath],
      version: version.version,
      versionState: version.state,
      versionError: version.error,
      discoveredAt: timestamp,
      currentProvider: { provider: "local-path", packageId: null, confidence: "high", reason: "用户登记的本地可执行文件路径" },
      providerCandidates: []
    };
  }

  const paths = sortCommandPaths(uniqueStrings([...(await Promise.all(cli.commandNames.map((command) => runner.lookup(command)))).flat(), ...knownCliPathCandidates(cli)]));
  if (paths.length === 0) {
    return {
      ...cli,
      availabilityState: "unavailable",
      resolvedPaths: [],
      version: null,
      versionState: "unknown",
      versionError: null,
      discoveredAt: timestamp,
      currentProvider: null,
      providerCandidates: []
    };
  }

  const version = options.includeDetails ? await readVersion(paths[0] ?? cli.commandNames[0] ?? cli.cliId, runner) : currentVersionSnapshot(cli);
  const provider = inferProvider(paths[0] ?? "", cli);
  return {
    ...cli,
    availabilityState: "available",
    resolvedPaths: paths,
    version: version.version,
    versionState: version.state,
    versionError: version.error,
    discoveredAt: timestamp,
    currentProvider: provider.current,
    providerCandidates: provider.candidates
  };
}

function currentVersionSnapshot(cli: CliHubCli): { version: string | null; state: CliHubCli["versionState"]; error: string | null } {
  return { version: cli.version, state: cli.versionState, error: cli.versionError };
}

async function readVersion(commandOrPath: string, runner: CliHubCommandRunner): Promise<{ version: string | null; state: CliHubCli["versionState"]; error: string | null }> {
  const result = await runner.run(commandOrPath, ["--version"], { timeoutMs: versionCommandTimeoutMs });
  const output = firstOutputLine(result.stdout) ?? firstOutputLine(result.stderr);
  if (result.exitCode === 0 && output) return { version: output, state: "detected", error: null };
  return {
    version: null,
    state: "failed",
    error: clipText(result.stderr || result.stdout || "version command failed")
  };
}

function inferProvider(resolvedPath: string, cli: CliHubCli): { current: CliHubProviderRef | null; candidates: CliHubProviderRef[] } {
  const normalized = resolvedPath.toLowerCase().replaceAll("/", "\\");
  const channels = cli.channels;
  const high =
    knownCliPathCandidates(cli).some((candidate) => samePath(candidate, resolvedPath))
      ? providerRef("installer-command", channels, "路径位于官方安装器目录")
      : normalized.includes("\\scoop\\apps\\") || normalized.includes("\\scoop\\shims\\")
      ? providerRef("scoop", channels, "路径位于 Scoop apps/shims")
      : normalized.includes("\\chocolatey\\bin\\")
        ? providerRef("choco", channels, "路径位于 Chocolatey bin")
        : normalized.includes("\\winget\\") || normalized.includes("\\microsoft\\winget\\") || normalized.includes("\\windowsapps\\")
          ? providerRef("winget", channels, "路径位于 winget/WindowsApps 管理目录")
          : normalized.includes("\\appdata\\roaming\\npm\\") || normalized.includes("\\node_modules\\")
            ? providerRef("npm", channels, "路径位于 npm 全局目录")
            : null;
  if (high) return { current: high, candidates: [] };
  const candidates = channels
    .filter((channel) => channel.provider !== "github-release")
    .map((channel) => ({
      provider: channel.provider,
      packageId: channel.packageId,
      confidence: "low" as const,
      reason: "PATH 已发现 CLI，但路径不能高置信匹配 provider"
    }));
  return { current: null, candidates };
}

async function ensureKnownCliInstallDirectoriesOnPath(cli: CliHubCli, manager: CliHubPathManager): Promise<void> {
  const directories = uniquePathEntries(knownCliPathCandidates(cli).map((candidate) => path.dirname(candidate)));
  for (const directory of directories) {
    await manager.ensureUserPath(directory);
  }
}

function knownCliPathCandidates(cli: Pick<CliHubCli, "cliId">): string[] {
  if (process.platform !== "win32") return [];
  const builtIn = builtInClis.find((item) => item.cliId === cli.cliId);
  return (builtIn?.windowsPathHints ?? []).map(expandWindowsEnvironmentVariables).filter((candidate) => candidate && fs.existsSync(candidate));
}

function providerRef(provider: CliHubProvider, channels: CliHubChannel[], reason: string): CliHubProviderRef {
  const channel = channels.find((item) => item.provider === provider);
  return { provider, packageId: channel?.packageId ?? null, confidence: "high", reason };
}

function parseInstallCommand(input: string): InstallCommandParseResult {
  const text = input.trim();
  if (!text) throw new Error("installCommand 不能为空");
  if (hasUnsafeShellSyntax(text)) throw new Error("安装命令包含 pipe、重定向或复杂 shell 语法，已拒绝");
  const tokens = tokenizeCommandLine(text);
  if (tokens.length === 0) throw new Error("installCommand 不能为空");
  const executable = tokens[0]?.toLowerCase() ?? "";
  if (tokens.length === 1 && !looksLikeConcreteInstaller(tokens[0] ?? "")) {
    throw new Error("不能只填写 command name，请提供本地路径或可结构化安装命令");
  }
  if (executable === "cmd" || executable === "cmd.exe") throw new Error("不支持 cmd /c 安装命令");
  if (executable === "powershell" || executable === "powershell.exe" || executable === "pwsh" || executable === "pwsh.exe") {
    throw new Error("不支持 powershell -Command 安装命令");
  }

  if (executable === "npm") {
    const packageId = npmInstallPackage(tokens);
    if (packageId) return parsedChannel("npm", packageId, tokens, commandNameFromPackage(packageId), packageId);
  }
  if (executable === "winget") {
    const packageId = providerInstallPackage(tokens, "install", ["--id", "-id"]);
    if (packageId) return parsedChannel("winget", packageId, tokens, packageId, packageId);
  }
  if (executable === "choco" || executable === "chocolatey") {
    const packageId = providerInstallPackage(tokens, "install", []);
    if (packageId) return parsedChannel("choco", packageId, tokens, packageId, packageId);
  }
  if (executable === "scoop") {
    const packageId = providerInstallPackage(tokens, "install", []);
    if (packageId) return parsedChannel("scoop", packageId, tokens, packageId, packageId);
  }
  if (looksLikeConcreteInstaller(tokens[0] ?? "") || tokens.some((token) => /^https?:\/\//i.test(token))) {
    return parsedChannel("installer-command", tokens[0] ?? "installer", tokens, path.basename(tokens[0] ?? "installer"), path.basename(tokens[0] ?? "installer"));
  }
  throw new Error("安装命令无法解析为受支持 provider");
}

function parsedChannel(
  provider: Exclude<CliHubProvider, "local-path" | "github-release">,
  packageId: string,
  installCommand: string[],
  inferredCommandName: string,
  displayName: string
): InstallCommandParseResult {
  return {
    channel: {
      channelId: `custom:${provider}:${hash(`${packageId}\n${installCommand.join("\n")}`)}`,
      provider,
      label: providerLabel(provider, packageId),
      packageId,
      installCommand,
      updateCommand: null,
      checkCommand: null,
      appManaged: false,
      metadata: {},
      builtin: false
    },
    inferredCommandName,
    displayName
  };
}

async function installManagedBinary(cli: CliHubCli, channel: CliHubChannel, dataDir: string, manager: CliHubPathManager): Promise<CliHubCommandResult> {
  const sourcePath = channel.metadata.sourcePath;
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error("github-release 渠道缺少可安装的 sourcePath");
  }
  const installDir = path.join(dataDir, "clihub", "bin", cli.cliId);
  const shimsDir = path.join(dataDir, "clihub", "shims");
  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(shimsDir, { recursive: true });
  const targetPath = path.join(installDir, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);
  for (const commandName of cli.commandNames) {
    writeShim(shimsDir, commandName, targetPath);
  }
  await manager.ensureUserPath(shimsDir);
  return { exitCode: 0, stdout: targetPath, stderr: "" };
}

function writeShim(shimsDir: string, commandName: string, targetPath: string): void {
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(shimsDir, `${commandName}.cmd`), `@echo off\r\n"${targetPath}" %*\r\n`, "utf8");
    return;
  }
  const shimPath = path.join(shimsDir, commandName);
  fs.writeFileSync(shimPath, `#!/usr/bin/env sh\nexec "${targetPath}" "$@"\n`, "utf8");
  fs.chmodSync(shimPath, 0o755);
}

function checkCommandFor(channel: CliHubChannel | null, provider: CliHubProviderRef): string[] | null {
  if (channel?.checkCommand) return channel.checkCommand;
  const packageId = provider.packageId ?? channel?.packageId;
  if (!packageId) return null;
  if (provider.provider === "npm") return ["npm", "outdated", "-g", "--json", packageId];
  if (provider.provider === "winget") return ["winget", "list", "--id", packageId, "--exact", "--upgrade-available"];
  if (provider.provider === "choco") return ["choco", "outdated", "--limit-output", packageId];
  if (provider.provider === "scoop") return ["scoop", "status", packageId];
  if (provider.provider === "installer-command") return channel?.checkCommand ?? null;
  return null;
}

function updateCommandFor(channel: CliHubChannel | null, provider: CliHubProviderRef): string[] | null {
  if (channel?.updateCommand) return channel.updateCommand;
  const packageId = provider.packageId ?? channel?.packageId;
  if (!packageId) return null;
  if (provider.provider === "npm") return ["npm", "update", "-g", packageId];
  if (provider.provider === "winget") return ["winget", "upgrade", "--id", packageId, "--exact", "--disable-interactivity"];
  if (provider.provider === "choco") return ["choco", "upgrade", packageId, "-y"];
  if (provider.provider === "scoop") return ["scoop", "update", packageId];
  return null;
}

function updateStatusFromCheck(provider: CliHubProviderRef, result: CliHubCommandResult, channel: CliHubChannel | null): CliHubCli["updateStatus"] {
  if (provider.provider === "winget") return wingetUpdateStatus(provider.packageId ?? channel?.packageId ?? null, result);
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return result.exitCode === 0 && !/(update-available|outdated|upgrade available|available update)/i.test(combined)
    ? "up-to-date"
    : result.exitCode === 0 || result.stdout.trim()
      ? "update-available"
      : "unknown";
}

function wingetUpdateStatus(packageId: string | null, result: CliHubCommandResult): CliHubCli["updateStatus"] {
  const combined = `${result.stdout}\n${result.stderr}`;
  if (wingetOutputHasPackageRow(result.stdout, packageId)) return "update-available";
  if (/no installed package found|no available upgrade|no newer package versions are available|找不到|未找到|没有可用|无可用/i.test(combined)) {
    return "up-to-date";
  }
  if (result.exitCode === 0) return "up-to-date";
  return "unknown";
}

function wingetOutputHasPackageRow(output: string, packageId: string | null): boolean {
  if (!packageId) return false;
  return output.toLowerCase().includes(packageId.toLowerCase());
}

function matchingChannel(cli: CliHubCli, provider: CliHubProviderRef): CliHubChannel | null {
  return (
    cli.channels.find((channel) => channel.provider === provider.provider && (!provider.packageId || channel.packageId === provider.packageId)) ??
    cli.channels.find((channel) => channel.provider === provider.provider) ??
    null
  );
}

function commandOperation(
  kind: CliHubOperationKind,
  status: CliHubOperationResult["status"],
  provider: CliHubProvider | null,
  startedAt: string,
  result: CliHubCommandResult,
  message: string
): CliHubOperationResult {
  return {
    kind,
    status,
    provider,
    startedAt,
    completedAt: nowIso(),
    exitCode: Number.isFinite(result.exitCode) ? result.exitCode : null,
    stdout: clipText(result.stdout),
    stderr: clipText(result.stderr),
    message
  };
}

function storeOperation(database: AppDatabase, cli: CliHubCli, recentOperation: CliHubOperationResult): void {
  const current = database.getCliHubCli(cli.cliId) ?? cli;
  database.upsertCliHubCli({ ...current, recentOperation });
}

class CliHubCommandError extends Error {
  constructor(
    message: string,
    readonly result: CliHubCommandResult
  ) {
    super(commandErrorMessage(message, result));
  }
}

function commandErrorMessage(message: string, result: CliHubCommandResult): string {
  const detail = firstOutputLine(result.stderr) ?? firstOutputLine(result.stdout);
  return detail ? `${message}：${clipText(detail)}` : message;
}

function terminalUpdateCompletionMessage(updateStatus: CliHubCli["updateStatus"]): string {
  if (updateStatus === "up-to-date") return "终端更新完成，状态已刷新：已是最新版本";
  if (updateStatus === "update-available") return "终端更新完成，状态已刷新：仍检测到可更新";
  return "终端更新完成，状态已刷新：更新状态未知";
}

function completionExitCode(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function requiredCli(database: AppDatabase, cliId: string): CliHubCli {
  const cli = database.getCliHubCli(cliId);
  if (!cli) throw new Error("CliHub CLI 不存在");
  return cli;
}

function emptyCli(
  cliId: string,
  displayName: string,
  kind: CliHubCli["kind"],
  sourceType: CliHubCli["sourceType"],
  sourceState: CliHubCli["sourceState"],
  commandNames: string[]
): Omit<CliHubCli, "createdAt" | "updatedAt"> {
  return {
    cliId,
    displayName,
    kind,
    sourceType,
    sourceState,
    commandNames,
    localPath: null,
    channels: [],
    availabilityState: "unknown",
    resolvedPaths: [],
    version: null,
    versionState: "unknown",
    versionError: null,
    discoveredAt: null,
    currentProvider: null,
    providerCandidates: [],
    updateStatus: "unknown",
    updateCheckedAt: null,
    updateError: null,
    recentOperation: null
  };
}

function providerChannel(channelId: string, provider: Exclude<CliHubProvider, "local-path" | "installer-command">, packageId: string): CliHubChannel {
  const installCommand = installCommandFor(provider, packageId);
  return {
    channelId,
    provider,
    label: providerLabel(provider, packageId),
    packageId,
    installCommand,
    updateCommand: null,
    checkCommand: null,
    appManaged: provider === "github-release",
    metadata: {},
    builtin: true
  };
}

function installerCommandChannel(channelId: string, label: string, packageId: string, installCommand: string[]): CliHubChannel {
  return {
    channelId,
    provider: "installer-command",
    label,
    packageId,
    installCommand,
    updateCommand: null,
    checkCommand: null,
    appManaged: false,
    metadata: {},
    builtin: true
  };
}

function installCommandFor(provider: Exclude<CliHubProvider, "local-path">, packageId: string): string[] | null {
  if (provider === "npm") return ["npm", "install", "-g", packageId];
  if (provider === "winget") return ["winget", "install", "--id", packageId];
  if (provider === "choco") return ["choco", "install", packageId, "-y"];
  if (provider === "scoop") return ["scoop", "install", packageId];
  return null;
}

function providerLabel(provider: CliHubChannel["provider"], packageId: string): string {
  return `${provider}: ${packageId}`;
}

function mergeChannels(primary: CliHubChannel[], secondary: CliHubChannel[]): CliHubChannel[] {
  const channels = new Map<string, CliHubChannel>();
  for (const channel of primary) channels.set(channel.channelId, channel);
  for (const channel of secondary) {
    if (channel.builtin) continue;
    channels.set(channel.channelId, channel);
  }
  return [...channels.values()];
}

function npmInstallPackage(tokens: string[]): string | null {
  const installIndex = tokens.findIndex((token) => token === "install" || token === "i" || token === "add");
  if (installIndex < 0) return null;
  const global = tokens.some((token) => token === "-g" || token === "--global");
  if (!global) return null;
  for (let index = installIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.startsWith("-")) continue;
    return token;
  }
  return null;
}

function providerInstallPackage(tokens: string[], verb: string, idFlags: string[]): string | null {
  const verbIndex = tokens.findIndex((token) => token.toLowerCase() === verb);
  if (verbIndex < 0) return null;
  for (const flag of idFlags) {
    const index = tokens.findIndex((token) => token.toLowerCase() === flag);
    if (index >= 0 && tokens[index + 1]) return tokens[index + 1] ?? null;
  }
  for (let index = verbIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.startsWith("-")) {
      if (token && idFlags.includes(token.toLowerCase())) index += 1;
      continue;
    }
    return token;
  }
  return null;
}

function tokenizeCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) throw new Error("安装命令引号不完整");
  if (current) tokens.push(current);
  return tokens;
}

function hasUnsafeShellSyntax(input: string): boolean {
  return /[|<>;&`]/.test(input) || /\$\(/.test(input) || /\b(curl|iwr|Invoke-WebRequest)\b[\s\S]*\|/i.test(input);
}

function looksLikeConcreteInstaller(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    /^https?:\/\//i.test(value) ||
    /\.(exe|msi|pkg|dmg|sh|ps1)$/i.test(value) ||
    value.includes("/") ||
    value.includes("\\")
  );
}

function normalizeCommandName(value: string): string {
  return value.trim().replace(/\.(exe|cmd|bat)$/i, "");
}

function commandNameFromPackage(packageId: string): string {
  const cleaned = packageId.split("/").pop() ?? packageId;
  return cleaned.replace(/^@/, "").replace(/-cli$/i, "");
}

function customCliId(kind: string, commandName: string, seed: string): string {
  return `custom-${kind}-${slug(commandName)}-${hash(seed)}`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function hash(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function commandRunner(options: CliHubRuntimeOptions): CliHubCommandRunner {
  return options.commandRunner ?? defaultCommandRunner;
}

function pathManager(options: CliHubRuntimeOptions): CliHubPathManager {
  return options.pathManager ?? defaultPathManager;
}

function operationRunner(options: CliHubRuntimeOptions): CliHubOperationRunner {
  return options.operationRunner ?? defaultOperationRunner;
}

function clipText(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= outputLimit ? trimmed : `${trimmed.slice(0, outputLimit)}...`;
}

function firstOutputLine(value: string): string | null {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function sortCommandPaths(paths: string[]): string[] {
  return process.platform === "win32" ? sortWindowsCommandPaths(paths) : paths;
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatCommandLine(parts: string[]): string {
  return parts.map((part) => (/\s/.test(part) ? `"${part.replaceAll("\"", "\\\"")}"` : part)).join(" ");
}

function terminalUpdateCompletionScript(command: LaunchCommand, callback: CliHubUpdateCompletionCallback): string {
  const invoke = ["&", quotePowerShell(command.command), ...command.args.map(quotePowerShell)].join(" ");
  return [
    "$ErrorActionPreference = 'Continue'",
    "$global:LASTEXITCODE = 0",
    invoke,
    "$commandSucceeded = $?",
    "$updateExitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } elseif ($commandSucceeded) { 0 } else { 1 }",
    "$body = @{ exitCode = $updateExitCode } | ConvertTo-Json -Compress",
    "try {",
    `  Invoke-RestMethod -Method Post -Uri ${quotePowerShell(callback.url)} -Headers @{ 'x-local-api-token' = ${quotePowerShell(callback.token)} } -ContentType 'application/json' -Body $body | Out-Null`,
    "  Write-Host 'Local AI Workbench 已刷新 CliHub 状态。'",
    "} catch {",
    "  Write-Warning \"Local AI Workbench 状态刷新失败：$($_.Exception.Message)\"",
    "}",
    "exit $updateExitCode"
  ].join("; ");
}

function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function launchHostLabel(host: string): string {
  if (host === "windows-terminal") return "Windows Terminal PowerShell";
  if (host === "powershell") return "PowerShell";
  return "终端";
}

function sortWindowsCommandPaths(paths: string[]): string[] {
  return [...paths].sort((left, right) => windowsCommandPriority(left) - windowsCommandPriority(right));
}

function windowsCommandPriority(commandPath: string): number {
  const extension = path.extname(commandPath).toLowerCase();
  if (extension === ".exe" || extension === ".com") return 0;
  if (extension === ".cmd" || extension === ".bat") return 1;
  return 2;
}

function resolveWindowsCommand(command: string): string {
  if (path.isAbsolute(command) || command.includes("\\") || command.includes("/")) {
    return resolveWindowsPathCommand(command);
  }
  const result = spawnSync("where.exe", [command], { encoding: "utf8", timeout: 3000 });
  if (result.status !== 0) return command;
  const match = sortWindowsCommandPaths(
    String(result.stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  )[0];
  return match ?? command;
}

function resolveWindowsPathCommand(command: string): string {
  if (fs.existsSync(command)) return command;
  if (path.extname(command)) return command;
  for (const extension of [".exe", ".com", ".cmd", ".bat"]) {
    const candidate = `${command}${extension}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  return command;
}

function isWindowsShellCommand(command: string): boolean {
  const extension = path.extname(command).toLowerCase();
  return extension === ".cmd" || extension === ".bat";
}

function windowsCommandLine(parts: string[]): string {
  return parts.map(quoteWindowsCmdArg).join(" ");
}

function quoteWindowsCmdArg(value: string): string {
  if (!value) return "\"\"";
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "CliHub 操作失败";
}

function nullCode(): number {
  return Number.NaN;
}
