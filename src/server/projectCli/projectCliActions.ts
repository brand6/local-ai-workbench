import { execFile } from "node:child_process";
import path from "node:path";
import type {
  AppConfig,
  CliHubAvailabilityState,
  CliHubCli,
  LaunchCommand,
  Project,
  ProjectCliAction,
  ProjectCliActionAvailability,
  ProjectCliActionExecutionMode,
  ProjectCliActionGroup,
  ProjectCliCommand,
  ProjectCliActionRunResult,
  ProjectCliActionState
} from "../../shared/types.js";
import { nowIso } from "../core/time.js";
import { ensureBuiltInCliHubClis, type CliHubCommandResult, type CliHubCommandRunner, type CliHubRuntimeOptions } from "../clihub/clihub.js";
import { launchInTerminal, terminalWindowTarget } from "../launch/terminal.js";
import type { AppDatabase } from "../storage/database.js";

interface ProjectCliActionDefinition {
  actionId: string;
  cliId: string;
  cliDisplayName: string;
  label: string;
  defaultCommand: string;
  args: string[];
  executionMode: ProjectCliActionExecutionMode;
  writesProject: boolean;
  requiresConfirmation: boolean;
  affectedSubpaths: string[];
}

interface ProjectCliCommandDefinition {
  commandId: string;
  label: string;
  args: string[];
  description: string;
  argsPlaceholder?: string | null;
  executionMode: ProjectCliActionExecutionMode;
  writesProject: boolean;
  requiresConfirmation: boolean;
  affectedSubpaths?: string[];
}

export class ProjectCliActionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400
  ) {
    super(message);
  }
}

const inlineCommandTimeoutMs = 60_000;
const outputLimit = 6000;

const projectCliActions: ProjectCliActionDefinition[] = [
  {
    actionId: "codegraph:init",
    cliId: "codegraph",
    cliDisplayName: "CodeGraph",
    label: "初始化索引",
    defaultCommand: "codegraph",
    args: ["init", "-i"],
    executionMode: "terminal",
    writesProject: true,
    requiresConfirmation: true,
    affectedSubpaths: [".codegraph"]
  },
  {
    actionId: "codegraph:status",
    cliId: "codegraph",
    cliDisplayName: "CodeGraph",
    label: "查看状态",
    defaultCommand: "codegraph",
    args: ["status"],
    executionMode: "terminal",
    writesProject: false,
    requiresConfirmation: false,
    affectedSubpaths: []
  },
  {
    actionId: "codegraph:index-force",
    cliId: "codegraph",
    cliDisplayName: "CodeGraph",
    label: "重建索引",
    defaultCommand: "codegraph",
    args: ["index", "--force"],
    executionMode: "terminal",
    writesProject: true,
    requiresConfirmation: true,
    affectedSubpaths: [".codegraph"]
  },
  {
    actionId: "codegraph:sync",
    cliId: "codegraph",
    cliDisplayName: "CodeGraph",
    label: "增量同步",
    defaultCommand: "codegraph",
    args: ["sync"],
    executionMode: "terminal",
    writesProject: true,
    requiresConfirmation: true,
    affectedSubpaths: [".codegraph"]
  }
];

const projectCliCommandTemplates: Record<string, ProjectCliCommandDefinition[]> = {
  git: [
    {
      commandId: "init",
      label: "初始化仓库",
      args: ["init"],
      description: "在当前 Project Group 目录创建 Git 仓库。",
      argsPlaceholder: "可选参数，例如 -b main",
      executionMode: "terminal",
      writesProject: true,
      requiresConfirmation: true,
      affectedSubpaths: [".git"]
    },
    {
      commandId: "status",
      label: "查看状态",
      args: ["status", "--short"],
      description: "查看当前目录的未提交变更、暂存区和未跟踪文件。",
      argsPlaceholder: "可选参数，例如 --ignored",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    },
    {
      commandId: "branch-current",
      label: "查看当前分支",
      args: ["branch", "--show-current"],
      description: "显示当前工作目录所在的 Git 分支名称。",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    },
    {
      commandId: "log-recent",
      label: "查看最近提交",
      args: ["log", "--oneline", "--decorate", "-n", "20"],
      description: "用紧凑格式查看最近 20 条提交。",
      argsPlaceholder: "可选参数，例如 --since=1.week",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    },
    {
      commandId: "diff-stat",
      label: "查看差异摘要",
      args: ["diff", "--stat"],
      description: "查看未提交改动涉及的文件和行数摘要。",
      argsPlaceholder: "可选参数，例如 --cached",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    }
  ],
  gh: [
    {
      commandId: "auth-status",
      label: "查看登录状态",
      args: ["auth", "status"],
      description: "检查 GitHub CLI 当前账号和认证状态。",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    },
    {
      commandId: "repo-view",
      label: "查看仓库信息",
      args: ["repo", "view"],
      description: "显示当前 GitHub 仓库的基本信息。",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    },
    {
      commandId: "pr-list",
      label: "查看 PR 列表",
      args: ["pr", "list"],
      description: "列出当前仓库的 Pull Request。",
      argsPlaceholder: "可选参数，例如 --state all",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    },
    {
      commandId: "issue-list",
      label: "查看 Issue 列表",
      args: ["issue", "list"],
      description: "列出当前仓库的 Issue。",
      argsPlaceholder: "可选参数，例如 --state all",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    }
  ],
  npm: [
    {
      commandId: "install",
      label: "安装依赖",
      args: ["install"],
      description: "根据当前目录的 package.json 和 lockfile 安装依赖。",
      executionMode: "terminal",
      writesProject: true,
      requiresConfirmation: true,
      affectedSubpaths: ["node_modules", "package-lock.json"]
    },
    {
      commandId: "test",
      label: "运行测试",
      args: ["test"],
      description: "运行 package.json 中定义的 test 脚本。",
      argsPlaceholder: "可选参数，例如 -- --runInBand",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    },
    {
      commandId: "run",
      label: "运行脚本",
      args: ["run"],
      description: "运行 package.json scripts 中的指定脚本；不填参数时列出脚本。",
      argsPlaceholder: "脚本名或参数，例如 build",
      executionMode: "terminal",
      writesProject: true,
      requiresConfirmation: true
    },
    {
      commandId: "outdated",
      label: "查看过期依赖",
      args: ["outdated"],
      description: "检查当前项目可更新的 npm 依赖。",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    }
  ],
  node: [
    {
      commandId: "version",
      label: "查看版本",
      args: ["--version"],
      description: "显示当前 Node.js 版本。",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    },
    {
      commandId: "check",
      label: "检查脚本语法",
      args: ["--check"],
      description: "检查指定 JavaScript 文件的语法，不执行脚本。",
      argsPlaceholder: "文件路径，例如 scripts/check.js",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    }
  ],
  playwright: [
    {
      commandId: "version",
      label: "查看版本",
      args: ["--version"],
      description: "显示当前 Playwright CLI 版本。",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    },
    {
      commandId: "test",
      label: "运行测试",
      args: ["test"],
      description: "在当前项目目录运行 Playwright 测试。",
      argsPlaceholder: "可选参数，例如 tests/example.spec.ts",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    },
    {
      commandId: "test-ui",
      label: "打开测试 UI",
      args: ["test", "--ui"],
      description: "打开 Playwright UI 模式以交互式运行测试。",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    }
  ],
  "lark-cli": [
    {
      commandId: "help",
      label: "查看帮助",
      args: ["--help"],
      description: "查看 lark-cli 支持的命令和参数。",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    },
    {
      commandId: "version",
      label: "查看版本",
      args: ["--version"],
      description: "显示当前 lark-cli 版本。",
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    }
  ]
};

export function listProjectCliActions(database: AppDatabase, project: Project): ProjectCliActionState {
  ensureBuiltInCliHubClis(database);
  const actions = projectCliActions.flatMap((definition) => materializeAction(database, project, definition));
  const commands = installedProjectCliCommands(database, project);
  const groups = new Map<string, ProjectCliActionGroup>();
  for (const action of actions) {
    const current = groups.get(action.cliId);
    if (current) {
      current.actions.push(action);
      continue;
    }
    groups.set(action.cliId, {
      cliId: action.cliId,
      displayName: action.cliDisplayName,
      availability: action.availability,
      actions: [action]
    });
  }
  for (const command of commands) {
    const current = groups.get(command.cliId);
    if (current) {
      current.commands = [...(current.commands ?? []), command];
      continue;
    }
    groups.set(command.cliId, {
      cliId: command.cliId,
      displayName: command.displayName,
      availability: {
        state: "available",
        reason: null,
        cliHubCliId: command.cliId,
        cliHubAvailabilityState: "available"
      },
      commands: [command],
      actions: []
    });
  }

  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    groups: [...groups.values()]
  };
}

export async function executeProjectCliAction(
  database: AppDatabase,
  project: Project,
  actionId: string,
  config: AppConfig,
  options: CliHubRuntimeOptions = {},
  executionOptions: { dryRun?: boolean } = {}
): Promise<ProjectCliActionRunResult> {
  const action = listProjectCliActions(database, project)
    .groups.flatMap((group) => group.actions)
    .find((candidate) => candidate.actionId === actionId);
  if (!action) {
    throw new ProjectCliActionError("Project CLI action 不存在", "project-cli-action-not-found", 404);
  }
  if (action.availability.state !== "available") {
    throw new ProjectCliActionError(action.availability.reason ?? "CLI 当前不可用", "project-cli-unavailable", 409);
  }

  const startedAt = nowIso();
  if (action.executionMode === "terminal") {
    const terminalCommand = launchCommand(action);
    const launch = launchInTerminal(terminalCommand, {
      dryRun: Boolean(executionOptions.dryRun),
      preferPowerShell: true,
      windowTarget: terminalWindowTarget(config.terminal.mode, {
        toolId: action.cliId,
        cwd: action.cwd,
        projectRootPath: project.rootPath
      })
    });
    return {
      projectId: project.id,
      targetRootPath: project.rootPath,
      actionId: action.actionId,
      cliId: action.cliId,
      label: action.label,
      command: action.command,
      args: action.args,
      commandText: action.commandText,
      cwd: action.cwd,
      executionMode: action.executionMode,
      status: launch.launched ? "launched" : "failed",
      startedAt,
      completedAt: nowIso(),
      exitCode: null,
      stdout: "",
      stderr: launch.reason ?? "",
      launch
    };
  }

  const result = await runProjectCliCommand(commandRunner(options), action.command, action.args, action.cwd);
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    actionId: action.actionId,
    cliId: action.cliId,
    label: action.label,
    command: action.command,
    args: action.args,
    commandText: action.commandText,
    cwd: action.cwd,
    executionMode: action.executionMode,
    status: result.exitCode === 0 ? "success" : "failed",
    startedAt,
    completedAt: nowIso(),
    exitCode: result.exitCode,
    stdout: clipText(result.stdout),
    stderr: clipText(result.stderr),
    launch: null
  };
}

export async function executeProjectCliCommand(
  database: AppDatabase,
  project: Project,
  cliId: string,
  commandId: string,
  argsText: string | null,
  config: AppConfig,
  options: CliHubRuntimeOptions = {},
  executionOptions: { dryRun?: boolean } = {}
): Promise<ProjectCliActionRunResult> {
  const command = listProjectCliActions(database, project)
    .groups.flatMap((group) => group.commands ?? [])
    .find((candidate) => candidate.cliId === cliId && candidate.commandId === commandId);
  if (!command) {
    throw new ProjectCliActionError("Project CLI command 不存在或当前不可用", "project-cli-command-not-found", 404);
  }

  const args = [...command.args, ...parseProjectCliArgs(argsText ?? "")];
  const commandText = formatCommandLine([command.command, ...args]);
  const startedAt = nowIso();
  if (command.executionMode === "terminal") {
    const launchCommand: LaunchCommand = { command: command.command, args, cwd: command.cwd };
    const terminalCommand = { ...launchCommand, command: projectCliExecutable(command) };
    const launch = launchInTerminal(terminalCommand, {
      dryRun: Boolean(executionOptions.dryRun),
      preferPowerShell: true,
      windowTarget: terminalWindowTarget(config.terminal.mode, {
        toolId: command.cliId,
        cwd: command.cwd,
        projectRootPath: project.rootPath
      })
    });

    return {
      projectId: project.id,
      targetRootPath: project.rootPath,
      actionId: projectCliCommandActionId(command),
      cliId: command.cliId,
      label: command.label,
      command: command.command,
      args,
      commandText,
      cwd: command.cwd,
      executionMode: command.executionMode,
      status: launch.launched ? "launched" : "failed",
      startedAt,
      completedAt: nowIso(),
      exitCode: null,
      stdout: "",
      stderr: launch.reason ?? "",
      launch
    };
  }

  const result = await runProjectCliCommand(commandRunner(options), command.command, args, command.cwd);

  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    actionId: projectCliCommandActionId(command),
    cliId: command.cliId,
    label: command.label,
    command: command.command,
    args,
    commandText,
    cwd: command.cwd,
    executionMode: command.executionMode,
    status: result.exitCode === 0 ? "success" : "failed",
    startedAt,
    completedAt: nowIso(),
    exitCode: result.exitCode,
    stdout: clipText(result.stdout),
    stderr: clipText(result.stderr),
    launch: null
  };
}

function materializeAction(database: AppDatabase, project: Project, definition: ProjectCliActionDefinition): ProjectCliAction[] {
  const cli = findProjectCli(database, definition);
  if (!cli) return [];
  const command = cli.commandNames[0] ?? definition.defaultCommand;
  const availability = availabilityFromCli(cli.cliId, cli.availabilityState);
  return [{
    actionId: definition.actionId,
    cliId: cli.cliId,
    cliDisplayName: cli?.displayName ?? definition.cliDisplayName,
    label: definition.label,
    command,
    args: definition.args,
    commandText: formatCommandLine([command, ...definition.args]),
    cwd: project.rootPath,
    cwdPolicy: "target-root",
    executionMode: definition.executionMode,
    writesProject: definition.writesProject,
    requiresConfirmation: definition.requiresConfirmation,
    affectedPaths: definition.affectedSubpaths.map((subpath) => path.join(project.rootPath, subpath)),
    localPath: cli.localPath ?? null,
    resolvedPaths: cli.resolvedPaths,
    availability
  }];
}

function findProjectCli(database: AppDatabase, definition: ProjectCliActionDefinition): CliHubCli | null {
  const command = definition.defaultCommand.toLowerCase();
  return (
    database.listCliHubClis().find((cli) => cli.sourceType === "custom" && cli.commandNames.some((commandName) => commandName.toLowerCase() === command)) ??
    null
  );
}

function installedProjectCliCommands(database: AppDatabase, project: Project): ProjectCliCommand[] {
  return database
    .listCliHubClis()
    .filter((cli) => (cli.kind === "function" || cli.kind === "dependency") && cli.availabilityState === "available")
    .flatMap((cli) =>
      cli.commandNames.flatMap((command) =>
        projectCliCommandDefinitions(cli).map((definition) => ({
          commandId: definition.commandId,
          cliId: cli.cliId,
          displayName: cli.displayName,
          kind: cli.kind as ProjectCliCommand["kind"],
          label: definition.label,
          command,
          args: definition.args,
          commandText: formatCommandLine([command, ...definition.args]),
          description: definition.description,
          argsPlaceholder: definition.argsPlaceholder ?? null,
          cwd: project.rootPath,
          executionMode: definition.executionMode,
          writesProject: definition.writesProject,
          requiresConfirmation: definition.requiresConfirmation,
          affectedPaths: (definition.affectedSubpaths ?? []).map((subpath) => path.join(project.rootPath, subpath)),
          localPath: cli.localPath ?? cli.resolvedPaths[0] ?? null,
          resolvedPaths: cli.resolvedPaths,
          version: cli.version
        }))
      )
    );
}

function availabilityFromCli(cliId: string, state: CliHubAvailabilityState | null): ProjectCliActionAvailability {
  if (state === "available") {
    return { state: "available", reason: null, cliHubCliId: cliId, cliHubAvailabilityState: state };
  }
  if (state === "unavailable") {
    return {
      state: "unavailable",
      reason: "CLI 当前不可用，请到 CliHub 安装或刷新发现",
      cliHubCliId: cliId,
      cliHubAvailabilityState: state
    };
  }
  return {
    state: "unknown",
    reason: "CliHub 尚未发现该 CLI，请到 CliHub 刷新发现",
    cliHubCliId: cliId,
    cliHubAvailabilityState: state
  };
}

function launchCommand(action: ProjectCliAction): LaunchCommand {
  return { command: projectCliExecutable(action), args: action.args, cwd: action.cwd };
}

function projectCliCommandActionId(command: Pick<ProjectCliCommand, "cliId" | "commandId">): string {
  return `command:${command.cliId}:${command.commandId}`;
}

export function buildProjectCliProcessCommand(
  command: string,
  args: string[],
  cwd: string,
  platform: NodeJS.Platform = process.platform
): LaunchCommand {
  if (platform !== "win32") return { command, args, cwd };
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", projectCliPowerShellScript(command, args)],
    cwd
  };
}

function projectCliCommandDefinitions(cli: CliHubCli): ProjectCliCommandDefinition[] {
  return projectCliCommandTemplates[cli.cliId] ?? [
    {
      commandId: "help",
      label: "查看帮助",
      args: ["--help"],
      description: `查看 ${cli.displayName} 支持的命令和参数。`,
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    },
    {
      commandId: "version",
      label: "查看版本",
      args: ["--version"],
      description: `显示当前 ${cli.displayName} 版本。`,
      executionMode: "terminal",
      writesProject: false,
      requiresConfirmation: false
    }
  ];
}

async function runProjectCliCommand(
  runner: CliHubCommandRunner | null,
  command: string,
  args: string[],
  cwd: string
): Promise<CliHubCommandResult> {
  const processCommand = buildProjectCliProcessCommand(command, args, cwd);
  if (runner) return runner.run(processCommand.command, processCommand.args, { cwd: processCommand.cwd, timeoutMs: inlineCommandTimeoutMs });
  return runProcess(processCommand);
}

function projectCliExecutable(cli: Pick<ProjectCliAction | ProjectCliCommand, "command" | "localPath" | "resolvedPaths">): string {
  return cli.localPath ?? cli.resolvedPaths[0] ?? cli.command;
}

function runProcess(command: LaunchCommand): Promise<CliHubCommandResult> {
  return new Promise((resolve) => {
    execFile(
      command.command,
      command.args,
      {
        cwd: command.cwd,
        encoding: "utf8",
        timeout: inlineCommandTimeoutMs,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error ? childExitCode(error) : 0,
          stdout: clipText(String(stdout ?? "")),
          stderr: clipText(String(stderr ?? "") || (error instanceof Error ? error.message : ""))
        });
      }
    );
  });
}

function projectCliPowerShellScript(command: string, args: string[]): string {
  return [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    `${powerShellInvoke(command, args)}; exit $LASTEXITCODE`
  ].join("; ");
}

function powerShellInvoke(command: string, args: string[]): string {
  return ["&", quotePowerShell(command), ...args.map(quotePowerShell)].join(" ");
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function childExitCode(error: unknown): number {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "number") return error.code;
  return 1;
}

function commandRunner(options: CliHubRuntimeOptions): CliHubCommandRunner | null {
  return options.commandRunner ?? null;
}

function formatCommandLine(parts: string[]): string {
  return parts.map((part) => (/\s/.test(part) ? `"${part.replaceAll("\"", "\\\"")}"` : part)).join(" ");
}

function clipText(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= outputLimit ? trimmed : `${trimmed.slice(0, outputLimit)}...`;
}

function parseProjectCliArgs(input: string): string[] {
  const value = input.trim();
  if (!value) return [];
  if (value.length > 2000) throw new ProjectCliActionError("CLI 参数过长", "project-cli-args-too-long", 400);

  const args: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  let escaping = false;

  for (const char of value) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping) current += "\\";
  if (quote) throw new ProjectCliActionError("CLI 参数引号未闭合", "project-cli-args-unclosed-quote", 400);
  if (current) args.push(current);
  if (args.length > 50) throw new ProjectCliActionError("CLI 参数数量过多", "project-cli-args-too-many", 400);
  return args;
}
