import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CliHubOperationRunner,
  addCustomInstallCommandCli,
  addCustomLocalPathCli,
  checkCliHubUpdates,
  installCliHubCli,
  listCliHub,
  parseCliHubInstallCommand,
  refreshCliHubDiscovery,
  updateCliHubCli,
  type CliHubCommandResult,
  type CliHubCommandRunner
} from "../src/server/clihub/clihub.js";
import { AppDatabase } from "../src/server/storage/database.js";
import type { CliHubCli } from "../src/shared/types.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;
const itWindows = process.platform === "win32" ? it : it.skip;

afterEach(() => {
  if (directory) cleanup(directory);
  directory = null;
});

describe("CliHub", () => {
  it("seeds grouped built-in CLI inventory", () => {
    directory = testDir("clihub-inventory");
    const db = new AppDatabase(directory);

    const clihub = listCliHub(db);
    expect(clihub.clis.filter((cli) => cli.kind === "project-tool").map((cli) => cli.cliId)).toEqual([
      "claude",
      "codex",
      "copilot",
      "opencode",
      "qoder",
      "qwen"
    ]);
    expect(clihub.clis.filter((cli) => cli.kind === "function").map((cli) => cli.cliId)).toEqual(["gh", "playwright", "lark-cli"]);
    expect(clihub.clis.filter((cli) => cli.kind === "dependency").map((cli) => cli.cliId)).toEqual(["git", "node", "npm"]);
    expect(clihub.clis.find((cli) => cli.cliId === "codex")?.channels.some((channel) => channel.provider === "npm")).toBe(true);
    expect(clihub.clis.find((cli) => cli.cliId === "playwright")?.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: "playwright:npm",
          provider: "npm",
          packageId: "@playwright/test",
          installCommand: ["npm", "install", "-g", "@playwright/test"]
        })
      ])
    );

    db.close();
  });

  it("parses supported install providers and rejects unsafe or bare commands", () => {
    expect(parseCliHubInstallCommand("npm install -g example-cli")).toMatchObject({ provider: "npm", packageId: "example-cli" });
    expect(parseCliHubInstallCommand("winget install --id Git.Git")).toMatchObject({ provider: "winget", packageId: "Git.Git" });
    expect(parseCliHubInstallCommand("choco install gh")).toMatchObject({ provider: "choco", packageId: "gh" });
    expect(parseCliHubInstallCommand("scoop install git")).toMatchObject({ provider: "scoop", packageId: "git" });
    expect(parseCliHubInstallCommand("https://example.test/installer.exe")).toMatchObject({ provider: "installer-command" });

    expect(() => parseCliHubInstallCommand("codex")).toThrow("不能只填写 command name");
    expect(() => parseCliHubInstallCommand("curl https://example.test/install.sh | sh")).toThrow("复杂 shell");
    expect(() => parseCliHubInstallCommand("powershell -Command iwr https://example.test/install.ps1")).toThrow("powershell");
  });

  it("refreshes discovery without making version failure unavailable", async () => {
    directory = testDir("clihub-discovery");
    const db = new AppDatabase(directory);
    listCliHub(db);
    const runner = new FakeCliRunner({
      lookups: {
        codex: ["C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd"],
        claude: ["C:\\tools\\claude.exe"]
      },
      runs: {
        "C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd --version": { exitCode: 0, stdout: "codex 1.2.3", stderr: "" },
        "C:\\tools\\claude.exe --version": { exitCode: 1, stdout: "", stderr: "unknown option" }
      }
    });

    await refreshCliHubDiscovery(db, "codex", { commandRunner: runner });
    await refreshCliHubDiscovery(db, "claude", { commandRunner: runner });

    expect(db.getCliHubCli("codex")).toMatchObject({
      availabilityState: "available",
      version: "codex 1.2.3",
      versionState: "detected",
      currentProvider: { provider: "npm", confidence: "high" }
    });
    expect(db.getCliHubCli("claude")).toMatchObject({
      availabilityState: "available",
      version: null,
      versionState: "failed"
    });

    const windowsAppsCodexPath = "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0.0_x64__test\\codex.exe";
    await refreshCliHubDiscovery(
      db,
      "codex",
      {
        commandRunner: new FakeCliRunner({
          lookups: { codex: [windowsAppsCodexPath] },
          runs: {
            [`${windowsAppsCodexPath} --version`]: { exitCode: 0, stdout: "codex 2.0.0", stderr: "" }
          }
        })
      }
    );
    expect(db.getCliHubCli("codex")).toMatchObject({
      availabilityState: "available",
      version: "codex 2.0.0",
      currentProvider: { provider: "winget", packageId: "OpenAI.Codex", confidence: "high" }
    });

    db.close();
  });

  itWindows("runs Windows command shims during discovery and update checks", async () => {
    directory = testDir("clihub-windows-shims");
    const db = new AppDatabase(directory);
    const shimDir = path.join(directory, "bin");
    fs.mkdirSync(shimDir, { recursive: true });
    const localCliPath = path.join(shimDir, "local-tool.cmd");
    const npmPath = path.join(shimDir, "npm.cmd");
    fs.writeFileSync(localCliPath, "@echo off\r\necho local-tool 1.0.0\r\n", "utf8");
    fs.writeFileSync(
      npmPath,
      "@echo off\r\nif \"%1\"==\"outdated\" (\r\n  echo {}\r\n  exit /b 0\r\n)\r\necho npm 11.0.0\r\n",
      "utf8"
    );
    const originalPath = process.env.Path;
    const originalPATH = process.env.PATH;
    process.env.Path = [shimDir, originalPath ?? originalPATH ?? ""].filter(Boolean).join(path.delimiter);
    process.env.PATH = process.env.Path;

    try {
      const local = await addCustomLocalPathCli(db, { executablePath: localCliPath });
      expect(local).toMatchObject({
        availabilityState: "available",
        version: "local-tool 1.0.0",
        versionState: "detected"
      });

      listCliHub(db);
      const codex = db.getCliHubCli("codex");
      if (!codex) throw new Error("missing codex fixture");
      db.upsertCliHubCli({
        ...codex,
        availabilityState: "available",
        currentProvider: { provider: "npm", packageId: "@openai/codex", confidence: "high", reason: "test" }
      });

      const checked = await checkCliHubUpdates(db, "codex");
      expect(checked.clis.find((cli) => cli.cliId === "codex")).toMatchObject({
        updateStatus: "up-to-date",
        updateError: null
      });
    } finally {
      process.env.Path = originalPath;
      process.env.PATH = originalPATH;
      db.close();
    }
  });

  it("adds custom CLIs only from concrete local paths or structured install commands", async () => {
    directory = testDir("clihub-custom");
    const db = new AppDatabase(directory);
    const executable = path.join(directory, "internal-tool.exe");
    fs.writeFileSync(executable, "tool", "utf8");
    const runner = new FakeCliRunner({
      runs: {
        [`${executable} --version`]: { exitCode: 0, stdout: "internal 1.0.0", stderr: "" }
      }
    });

    const local = await addCustomLocalPathCli(db, { executablePath: executable }, { commandRunner: runner });
    expect(local).toMatchObject({ sourceState: "local-path", availabilityState: "available", currentProvider: { provider: "local-path" } });
    const checked = await checkCliHubUpdates(db, local.cliId, { commandRunner: runner });
    expect(checked.clis.find((cli) => cli.cliId === local.cliId)).toMatchObject({ updateStatus: "unknown" });

    const command = await addCustomInstallCommandCli(db, { installCommand: "npm install -g internal-cli" }, { commandRunner: runner });
    expect(command).toMatchObject({ sourceState: "install-command", commandNames: ["internal"] });
    await expect(addCustomInstallCommandCli(db, { installCommand: "internal-cli" }, { commandRunner: runner })).rejects.toThrow("不能只填写");

    db.close();
  });

  it("blocks second-provider installs and runs same-provider update commands", async () => {
    directory = testDir("clihub-install-update");
    const db = new AppDatabase(directory);
    listCliHub(db);
    const runner = new FakeCliRunner({
      lookups: {
        codex: []
      },
      runs: {
        "npm install -g @openai/codex": { exitCode: 0, stdout: "installed", stderr: "" },
        "C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd --version": { exitCode: 0, stdout: "codex 2.0.0", stderr: "" },
        "npm outdated -g --json @openai/codex": { exitCode: 1, stdout: "{\"@openai/codex\":{}}", stderr: "" },
        "npm update -g @openai/codex": { exitCode: 0, stdout: "updated", stderr: "" }
      },
      afterRun(command, args) {
        if ([command, ...args].join(" ") === "npm install -g @openai/codex") {
          this.lookups.codex = ["C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd"];
        }
      }
    });

    const installed = await installCliHubCli(db, directory, "codex", "codex:npm", { commandRunner: runner });
    expect(installed).toMatchObject({ availabilityState: "available", currentProvider: { provider: "npm" } });
    await expect(installCliHubCli(db, directory, "codex", "codex:winget", { commandRunner: runner })).rejects.toThrow("已阻止安装第二份");

    const checked = await checkCliHubUpdates(db, "codex", { commandRunner: runner });
    expect(checked.operation).toBeNull();
    expect(checked.clis.find((cli) => cli.cliId === "codex")).toMatchObject({ updateStatus: "update-available" });
    await updateCliHubCli(db, "codex", { commandRunner: runner });
    expect(runner.executed).toContain("npm update -g @openai/codex");

    db.close();
  });

  it("checks winget updates without running upgrade during check", async () => {
    directory = testDir("clihub-winget-update");
    const db = new AppDatabase(directory);
    listCliHub(db);
    const codex = db.getCliHubCli("codex");
    if (!codex) throw new Error("missing codex fixture");
    db.upsertCliHubCli({
      ...codex,
      availabilityState: "available",
      currentProvider: { provider: "winget", packageId: "OpenAI.Codex", confidence: "high", reason: "test" }
    });
    const runner = new FakeCliRunner({
      runs: {
        "winget list --id OpenAI.Codex --exact --upgrade-available": {
          exitCode: 0,
          stdout: "Name  Id           Version  Available  Source\nCodex OpenAI.Codex 1.0.0    2.0.0      winget",
          stderr: ""
        },
        "winget upgrade --id OpenAI.Codex --exact --disable-interactivity": { exitCode: 0, stdout: "updated", stderr: "" },
        "C:\\Program Files\\WindowsApps\\OpenAI.Codex_2.0.0_x64__test\\codex.exe --version": { exitCode: 0, stdout: "codex 2.0.0", stderr: "" }
      },
      lookups: {
        codex: ["C:\\Program Files\\WindowsApps\\OpenAI.Codex_2.0.0_x64__test\\codex.exe"]
      }
    });

    const checked = await checkCliHubUpdates(db, "codex", { commandRunner: runner });
    expect(checked.clis.find((cli) => cli.cliId === "codex")).toMatchObject({ updateStatus: "update-available" });
    expect(runner.executed).toContain("winget list --id OpenAI.Codex --exact --upgrade-available");
    expect(runner.executed).not.toContain("winget upgrade --id OpenAI.Codex --exact --disable-interactivity");

    await updateCliHubCli(db, "codex", { commandRunner: runner });
    expect(runner.executed).toContain("winget upgrade --id OpenAI.Codex --exact --disable-interactivity");

    db.close();
  });

  it("installs app-managed release binaries under dataDir and writes shims", async () => {
    directory = testDir("clihub-managed-binary");
    const db = new AppDatabase(directory);
    listCliHub(db);
    const sourceBinary = path.join(directory, "download", "codex.exe");
    fs.mkdirSync(path.dirname(sourceBinary), { recursive: true });
    fs.writeFileSync(sourceBinary, "binary", "utf8");
    const codex = db.getCliHubCli("codex");
    if (!codex) throw new Error("missing codex fixture");
    db.upsertCliHubCli({
      ...codex,
      channels: [
        ...codex.channels,
        {
          channelId: "codex:release-test",
          provider: "github-release",
          label: "GitHub release",
          packageId: "codex",
          installCommand: null,
          updateCommand: null,
          checkCommand: null,
          appManaged: true,
          metadata: { sourcePath: sourceBinary },
          builtin: false
        }
      ]
    });
    const runner = new FakeCliRunner({
      lookups: { codex: [] }
    });
    let userPathDirectory = "";
    const pathManager = {
      async ensureUserPath(directoryPath: string) {
        userPathDirectory = directoryPath;
        const shimName = process.platform === "win32" ? "codex.cmd" : "codex";
        runner.lookups.codex = [path.join(directoryPath, shimName)];
        runner.runs[`${path.join(directoryPath, shimName)} --version`] = { exitCode: 0, stdout: "codex managed", stderr: "" };
      }
    };

    const installed = await installCliHubCli(db, directory, "codex", "codex:release-test", { commandRunner: runner, pathManager });

    expect(installed).toMatchObject({ availabilityState: "available", version: "codex managed" });
    expect(fs.existsSync(path.join(directory, "clihub", "bin", "codex", "codex.exe"))).toBe(true);
    expect(fs.existsSync(path.join(directory, "clihub", "shims", process.platform === "win32" ? "codex.cmd" : "codex"))).toBe(true);
    expect(userPathDirectory).toBe(path.join(directory, "clihub", "shims"));

    db.close();
  });

  it("blocks a second CliHub operation while one is running", async () => {
    directory = testDir("clihub-serial");
    const db = new AppDatabase(directory);
    listCliHub(db);
    const codex = db.getCliHubCli("codex");
    if (!codex) throw new Error("missing codex fixture");
    db.upsertCliHubCli({
      ...codex,
      availabilityState: "available",
      currentProvider: { provider: "npm", packageId: "@openai/codex", confidence: "high", reason: "test" }
    });
    const operationRunner = new CliHubOperationRunner();
    let release: (() => void) | null = null;
    const runner: CliHubCommandRunner = {
      async lookup() {
        return [];
      },
      async run() {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    };

    const first = checkCliHubUpdates(db, "codex", { commandRunner: runner, operationRunner });
    await Promise.resolve();
    await expect(checkCliHubUpdates(db, "codex", { commandRunner: runner, operationRunner })).rejects.toThrow("already running");
    release?.();
    await first;

    db.close();
  });
});

class FakeCliRunner implements CliHubCommandRunner {
  executed: string[] = [];
  lookups: Record<string, string[]>;
  readonly runs: Record<string, CliHubCommandResult>;
  private readonly hook?: (this: FakeCliRunner, command: string, args: string[]) => void;

  constructor(options: {
    lookups?: Record<string, string[]>;
    runs?: Record<string, CliHubCommandResult>;
    afterRun?: (this: FakeCliRunner, command: string, args: string[]) => void;
  } = {}) {
    this.lookups = options.lookups ?? {};
    this.runs = options.runs ?? {};
    this.hook = options.afterRun;
  }

  async lookup(commandName: string): Promise<string[]> {
    return this.lookups[commandName] ?? [];
  }

  async run(command: string, args: string[]): Promise<CliHubCommandResult> {
    const key = [command, ...args].join(" ");
    this.executed.push(key);
    this.hook?.call(this, command, args);
    return this.runs[key] ?? { exitCode: 0, stdout: "", stderr: "" };
  }
}
