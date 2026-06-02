import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import type { LaunchCommand, LaunchResponse } from "../../shared/types.js";

interface TerminalHostOptions {
  platform?: NodeJS.Platform;
  windowsTerminalAvailable?: boolean;
}

export function validateLaunchCommand(command: LaunchCommand): string | null {
  if (!fs.existsSync(command.cwd)) return `目录不存在：${command.cwd}`;
  if (!command.command.trim()) return "启动命令不能为空";
  return null;
}

export function launchInTerminal(command: LaunchCommand, options: { dryRun?: boolean } = {}): LaunchResponse {
  const reason = validateLaunchCommand(command);
  if (reason) {
    return { launched: false, command, host: "direct", reason };
  }

  const host = buildTerminalHost(command);
  if (!options.dryRun) {
    const child = spawn(host.executable, host.args, {
      cwd: command.cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
  }

  return { launched: true, command, host: host.kind, reason: null };
}

export function buildTerminalHost(command: LaunchCommand, options: TerminalHostOptions = {}): { kind: LaunchResponse["host"]; executable: string; args: string[] } {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    const powershellArgs = powerShellHostArgs(command);
    const windowsTerminalAvailable = options.windowsTerminalAvailable ?? isExecutableAvailable("wt.exe", platform);
    if (windowsTerminalAvailable) {
      return {
        kind: "windows-terminal",
        executable: "wt.exe",
        args: ["-d", command.cwd, "powershell.exe", ...powershellArgs]
      };
    }

    return {
      kind: "powershell",
      executable: "powershell.exe",
      args: powershellArgs
    };
  }

  return { kind: "direct", executable: command.command, args: command.args };
}

export function isExecutableAvailable(command: string, platform: NodeJS.Platform = process.platform): boolean {
  const lookup = platform === "win32" ? "where.exe" : "command";
  const args = platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(lookup, args, { stdio: "ignore", shell: platform !== "win32" });
  return result.status === 0;
}

function powerShellHostArgs(command: LaunchCommand): string[] {
  return ["-NoExit", "-Command", powerShellInvoke(command.command, command.args)];
}

function powerShellInvoke(command: string, args: string[]): string {
  return ["&", quotePowerShell(command), ...args.map(quotePowerShell)].join(" ");
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
