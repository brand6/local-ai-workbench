import { spawnSync } from "node:child_process";
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
  CliHubRunningOperation
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
}

export interface CliHubRuntimeOptions {
  commandRunner?: CliHubCommandRunner;
  pathManager?: CliHubPathManager;
  operationRunner?: CliHubOperationRunner;
}

interface BuiltInCli {
  cliId: string;
  displayName: string;
  kind: CliHubCli["kind"];
  commandNames: string[];
  channels: CliHubChannel[];
}

interface InstallCommandParseResult {
  channel: CliHubChannel;
  inferredCommandName: string;
  displayName: string;
}

const outputLimit = 1200;
const defaultCommandRunner: CliHubCommandRunner = {
  async lookup(commandName: string) {
    const result =
      process.platform === "win32"
        ? spawnSync("where.exe", [commandName], { encoding: "utf8", timeout: 3000 })
        : spawnSync("sh", ["-lc", `command -v ${shellQuote(commandName)}`], { encoding: "utf8", timeout: 3000 });
    if (result.status !== 0) return [];
    return String(result.stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  },
  async run(command: string, args: string[], options = {}) {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      timeout: options.timeoutMs ?? 30000
    });
    const errorText = result.error instanceof Error ? result.error.message : "";
    return {
      exitCode: result.status ?? (result.error ? 1 : 0),
      stdout: clipText(String(result.stdout ?? "")),
      stderr: clipText([String(result.stderr ?? ""), errorText].filter(Boolean).join("\n"))
    };
  }
};

const defaultPathManager: CliHubPathManager = {
  async ensureUserPath(directory: string) {
    const key = process.platform === "win32" && process.env.Path !== undefined ? "Path" : "PATH";
    const current = process.env[key] ?? "";
    const entries = current.split(path.delimiter).filter(Boolean);
    if (entries.some((entry) => samePath(entry, directory))) return;
    const next = [...entries, directory].join(path.delimiter);
    if (process.platform === "win32") {
      const result = spawnSync("setx", ["PATH", next], { encoding: "utf8", timeout: 10000 });
      if (result.status !== 0) throw new Error(`用户 PATH 写入失败：${clipText(String(result.stderr || result.stdout || ""))}`);
    }
    process.env[key] = next;
    if (key !== "PATH") process.env.PATH = next;
  }
};

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
    channels: [providerChannel("claude:npm", "npm", "@anthropic-ai/claude-code")]
  },
  {
    cliId: "opencode",
    displayName: "OpenCode",
    kind: "project-tool",
    commandNames: ["opencode"],
    channels: [providerChannel("opencode:npm", "npm", "opencode-ai")]
  },
  {
    cliId: "qwen",
    displayName: "Qwen Code",
    kind: "project-tool",
    commandNames: ["qwen"],
    channels: [providerChannel("qwen:npm", "npm", "@qwen-code/qwen-code")]
  },
  {
    cliId: "qoder",
    displayName: "Qoder",
    kind: "project-tool",
    commandNames: ["qoder"],
    channels: []
  },
  {
    cliId: "copilot",
    displayName: "GitHub Copilot CLI",
    kind: "project-tool",
    commandNames: ["copilot"],
    channels: []
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
  for (const builtIn of builtInClis) {
    const existing = database.getCliHubCli(builtIn.cliId);
    const channels = mergeChannels(builtIn.channels, existing?.channels ?? []);
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

export async function refreshCliHubDiscovery(database: AppDatabase, cliId?: string | null, options: CliHubRuntimeOptions = {}): Promise<CliHubList> {
  ensureBuiltInCliHubClis(database);
  const runner = commandRunner(options);
  const clis = cliId ? [requiredCli(database, cliId)] : database.listCliHubClis();
  for (const cli of clis) {
    database.upsertCliHubCli(await discoverCli(cli, runner));
  }
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
      if (channel.provider === "github-release" || channel.appManaged) {
        result = await installManagedBinary(cli, channel, dataDir, pathManager(options));
      } else {
        if (!channel.installCommand) throw new Error("安装渠道缺少 installCommand");
        result = await commandRunner(options).run(channel.installCommand[0] ?? "", channel.installCommand.slice(1));
      }
      if (result.exitCode !== 0) throw new CliHubCommandError("CLI 安装失败", result);
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
  return operationRunner(options).run(target, "update-check", async () => {
    const clis = cliId ? [requiredCli(database, cliId)] : database.listCliHubClis();
    for (const cli of clis) {
      await checkOneCliUpdate(database, cli, options);
    }
    return listCliHub(database, options);
  });
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
      const result = await commandRunner(options).run(command[0] ?? "", command.slice(1));
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
  const result = await commandRunner(options).run(command[0] ?? "", command.slice(1));
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  const updateStatus =
    result.exitCode === 0 && !/(update-available|outdated|upgrade available|available update)/i.test(combined)
      ? "up-to-date"
      : result.exitCode === 0 || result.stdout.trim()
        ? "update-available"
        : "unknown";
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

async function discoverCli(cli: CliHubCli, runner: CliHubCommandRunner): Promise<CliHubCli> {
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
    const version = await readVersion(cli.localPath, runner);
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

  const paths = uniqueStrings((await Promise.all(cli.commandNames.map((command) => runner.lookup(command)))).flat());
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

  const version = await readVersion(paths[0] ?? cli.commandNames[0] ?? cli.cliId, runner);
  const provider = inferProvider(paths[0] ?? "", cli.channels);
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

async function readVersion(commandOrPath: string, runner: CliHubCommandRunner): Promise<{ version: string | null; state: CliHubCli["versionState"]; error: string | null }> {
  const result = await runner.run(commandOrPath, ["--version"], { timeoutMs: 5000 });
  const output = firstOutputLine(result.stdout) ?? firstOutputLine(result.stderr);
  if (result.exitCode === 0 && output) return { version: output, state: "detected", error: null };
  return {
    version: null,
    state: "failed",
    error: clipText(result.stderr || result.stdout || "version command failed")
  };
}

function inferProvider(resolvedPath: string, channels: CliHubChannel[]): { current: CliHubProviderRef | null; candidates: CliHubProviderRef[] } {
  const normalized = resolvedPath.toLowerCase().replaceAll("/", "\\");
  const high =
    normalized.includes("\\scoop\\apps\\") || normalized.includes("\\scoop\\shims\\")
      ? providerRef("scoop", channels, "路径位于 Scoop apps/shims")
      : normalized.includes("\\chocolatey\\bin\\")
        ? providerRef("choco", channels, "路径位于 Chocolatey bin")
        : normalized.includes("\\winget\\") || normalized.includes("\\microsoft\\winget\\")
          ? providerRef("winget", channels, "路径位于 winget 管理目录")
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
  if (provider.provider === "winget") return ["winget", "upgrade", "--id", packageId];
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
  if (provider.provider === "winget") return ["winget", "upgrade", "--id", packageId];
  if (provider.provider === "choco") return ["choco", "upgrade", packageId, "-y"];
  if (provider.provider === "scoop") return ["scoop", "update", packageId];
  return null;
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
    super(message);
  }
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
  for (const channel of [...primary, ...secondary]) channels.set(channel.channelId, channel);
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

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "CliHub 操作失败";
}

function nullCode(): number {
  return Number.NaN;
}
