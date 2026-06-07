import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  withCliHubUpdateCompletionCallback,
  type CliHubCommandResult,
  type CliHubCommandRunner
} from "../src/server/clihub/clihub.js";
import { buildTerminalHost } from "../src/server/launch/terminal.js";
import { AppDatabase } from "../src/server/storage/database.js";
import type { CliHubCli } from "../src/shared/types.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;
const itWindows = process.platform === "win32" ? it : it.skip;
const originalLocalAppData = process.env.LOCALAPPDATA;

beforeEach(() => {
  process.env.LOCALAPPDATA = path.join(process.cwd(), ".tmp", "clihub-test-localappdata");
});

afterEach(() => {
  if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = originalLocalAppData;
  if (directory) cleanup(directory);
  directory = null;
});

describe("CliHub", () => {
  it("seeds grouped built-in CLI inventory", () => {
    directory = testDir("clihub-inventory");
    const db = new AppDatabase(directory);

    const clihub = listCliHub(db);
    const cliById = new Map(clihub.clis.map((cli) => [cli.cliId, cli]));
    const channels = (cliId: string) => {
      const cli = cliById.get(cliId);
      if (!cli) throw new Error(`missing ${cliId}`);
      return cli.channels;
    };
    const allChannels = clihub.clis.flatMap((cli) => cli.channels);

    expect(clihub.clis.filter((cli) => cli.kind === "project-tool").map((cli) => cli.cliId)).toEqual([
      "antigravity",
      "claude",
      "cline",
      "codebuddy",
      "codex",
      "cursor",
      "copilot",
      "kilo",
      "kimi",
      "opencode",
      "qoder",
      "qwen"
    ]);
    expect(clihub.clis.map((cli) => cli.cliId)).not.toEqual(expect.arrayContaining(["deepcode", "reasonix"]));
    expect(clihub.clis.map((cli) => cli.cliId)).not.toEqual(expect.arrayContaining(["aider"]));
    expect(clihub.clis.filter((cli) => cli.kind === "function").map((cli) => cli.cliId)).toEqual(["gh", "playwright", "lark-cli"]);
    expect(clihub.clis.filter((cli) => cli.kind === "dependency").map((cli) => cli.cliId)).toEqual(["git", "node", "npm"]);
    expect(allChannels.map((channel) => channel.channelId)).not.toEqual(
      expect.arrayContaining(["kimi:official-posix", "cursor:official-posix", "antigravity:official-posix"])
    );
    for (const channel of allChannels) {
      expect(channel.label).not.toMatch(/macOS|Linux|WSL/i);
      expect(channel.installCommand?.join(" ") ?? "").not.toMatch(/\bbash\b|install\.sh/);
    }
    expect(channels("codex").some((channel) => channel.provider === "npm")).toBe(true);
    expect(channels("playwright")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: "playwright:npm",
          provider: "npm",
          packageId: "@playwright/test",
          installCommand: ["npm", "install", "-g", "@playwright/test"]
        })
      ])
    );
    expect(channels("qoder")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: "qoder:npm",
          provider: "npm",
          packageId: "@qoder-ai/qodercli",
          installCommand: ["npm", "install", "-g", "@qoder-ai/qodercli"]
        })
      ])
    );
    expect(channels("cline")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: "cline:npm",
          provider: "npm",
          packageId: "cline",
          installCommand: ["npm", "install", "-g", "cline"]
        })
      ])
    );
    expect(channels("codebuddy")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: "codebuddy:npm",
          provider: "npm",
          packageId: "@tencent-ai/codebuddy-code",
          installCommand: ["npm", "install", "-g", "@tencent-ai/codebuddy-code"]
        })
      ])
    );
    expect(channels("kimi")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: "kimi:npm",
          provider: "npm",
          packageId: "@moonshot-ai/kimi-code",
          installCommand: ["npm", "install", "-g", "@moonshot-ai/kimi-code"]
        }),
        expect.objectContaining({
          channelId: "kimi:official-windows",
          provider: "installer-command",
          installCommand: ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://code.kimi.com/kimi-code/install.ps1 | iex"]
        })
      ])
    );
    expect(channels("kilo")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: "kilo:npm",
          provider: "npm",
          packageId: "@kilocode/cli",
          installCommand: ["npm", "install", "-g", "@kilocode/cli"]
        })
      ])
    );
    expect(channels("cursor")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: "cursor:official-windows",
          provider: "installer-command",
          installCommand: ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "iex (irm 'https://cursor.com/install?win32=true')"]
        })
      ])
    );
    expect(channels("antigravity")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelId: "antigravity:official-windows",
          provider: "installer-command",
          installCommand: ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "iex (irm 'https://antigravity.google/cli/install.ps1')"]
        })
      ])
    );
    db.close();
  });

  it("prunes stale built-in install channels while keeping custom channels", () => {
    directory = testDir("clihub-stale-channels");
    const db = new AppDatabase(directory);
    listCliHub(db);
    const antigravity = db.getCliHubCli("antigravity");
    if (!antigravity) throw new Error("missing antigravity fixture");
    db.upsertCliHubCli({
      ...antigravity,
      channels: [
        ...antigravity.channels,
        {
          channelId: "antigravity:official-posix",
          provider: "installer-command",
          label: "official install script: macOS/Linux",
          packageId: "agy",
          installCommand: ["bash", "-lc", "curl -fsSL https://antigravity.google/cli/install.sh | bash"],
          updateCommand: null,
          checkCommand: null,
          appManaged: false,
          metadata: {},
          builtin: true
        },
        {
          channelId: "custom:winget:test",
          provider: "winget",
          label: "winget: Test.Agy",
          packageId: "Test.Agy",
          installCommand: ["winget", "install", "--id", "Test.Agy"],
          updateCommand: null,
          checkCommand: null,
          appManaged: false,
          metadata: {},
          builtin: false
        }
      ]
    });

    const refreshed = listCliHub(db);
    const channels = refreshed.clis.find((cli) => cli.cliId === "antigravity")?.channels ?? [];

    expect(channels.map((channel) => channel.channelId)).not.toContain("antigravity:official-posix");
    expect(channels.map((channel) => channel.channelId)).toContain("custom:winget:test");

    db.close();
  });

  it("demotes local-only experimental built-in CLI rows to custom local CLIs", () => {
    directory = testDir("clihub-stale-builtins");
    const db = new AppDatabase(directory);
    const deepcodePath = path.join(directory, "deepcode.cmd");
    const reasonixPath = path.join(directory, "reasonix.cmd");
    const staleBuiltInIds = ["copilot_vscode", "gemini", "junie", "windsurf"];
    for (const cliId of staleBuiltInIds) {
      db.upsertCliHubCli(staleCliHubCli(cliId, "builtin"));
    }
    db.upsertCliHubCli({ ...staleCliHubCli("deepcode", "builtin"), availabilityState: "available", resolvedPaths: [deepcodePath] });
    db.upsertCliHubCli({ ...staleCliHubCli("reasonix", "builtin"), availabilityState: "available", resolvedPaths: [reasonixPath] });
    db.upsertCliHubCli(staleCliHubCli("custom-local-gemini", "custom"));
    db.upsertCliHubCli(staleCliHubCli("custom-local-deepcode", "custom"));

    const clihub = listCliHub(db);
    const cliIds = clihub.clis.map((cli) => cli.cliId);
    const cliById = new Map(clihub.clis.map((cli) => [cli.cliId, cli]));
    db.close();

    expect(cliIds.filter((cliId) => staleBuiltInIds.includes(cliId))).toEqual([]);
    expect(cliById.get("deepcode")).toMatchObject({ kind: "custom", sourceType: "custom", sourceState: "local-path", localPath: deepcodePath, channels: [] });
    expect(cliById.get("reasonix")).toMatchObject({ kind: "custom", sourceType: "custom", sourceState: "local-path", localPath: reasonixPath, channels: [] });
    expect(cliIds).toContain("custom-local-gemini");
    expect(cliIds).toContain("custom-local-deepcode");
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

  it("refreshes all CLI discovery without serializing version reads", async () => {
    directory = testDir("clihub-discovery-concurrent");
    const db = new AppDatabase(directory);
    listCliHub(db);
    const codexPath = "C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd";
    const claudePath = "C:\\tools\\claude.exe";
    const started: string[] = [];
    let releaseVersionReads = false;
    const waiters: Array<() => void> = [];
    const runner: CliHubCommandRunner = {
      async lookup(commandName: string) {
        if (commandName === "codex") return [codexPath];
        if (commandName === "claude") return [claudePath];
        return [];
      },
      async run(command: string): Promise<CliHubCommandResult> {
        started.push(command);
        if (!releaseVersionReads) {
          await new Promise<void>((resolve) => waiters.push(resolve));
        }
        return { exitCode: 0, stdout: `${path.basename(command)} 1.0.0`, stderr: "" };
      }
    };

    const refresh = refreshCliHubDiscovery(db, null, { commandRunner: runner });
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(started).toEqual(expect.arrayContaining([codexPath, claudePath]));
    } finally {
      releaseVersionReads = true;
      for (const resolve of waiters.splice(0)) resolve();
      await refresh;
      db.close();
    }
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
    expect(runner.runOptions.get("npm update -g @openai/codex")?.timeoutMs).toBeGreaterThan(30000);

    db.close();
  });

  it("refreshes shell PATH before discovering CLIs installed by external installers", async () => {
    directory = testDir("clihub-installer-refresh-path");
    const previousLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = directory;
    const db = new AppDatabase(directory);
    try {
      listCliHub(db);
      const cursorPath = "C:\\Users\\tester\\.cursor\\bin\\cursor-agent.exe";
      const runner = new FakeCliRunner({
        lookups: {
          "cursor-agent": []
        },
        runs: {
          "powershell -NoProfile -ExecutionPolicy Bypass -Command iex (irm 'https://cursor.com/install?win32=true')": {
            exitCode: 0,
            stdout: "installed",
            stderr: ""
          },
          [`${cursorPath} --version`]: { exitCode: 0, stdout: "cursor-agent 1.0.0", stderr: "" }
        }
      });
      const ensuredPaths: string[] = [];
      const pathManager = {
        async ensureUserPath(directoryPath: string) {
          ensuredPaths.push(directoryPath);
        },
        async refreshProcessPath() {
          runner.lookups["cursor-agent"] = [cursorPath];
        }
      };

      const installed = await installCliHubCli(db, directory, "cursor", "cursor:official-windows", { commandRunner: runner, pathManager });

      expect(installed).toMatchObject({
        availabilityState: "available",
        resolvedPaths: [cursorPath],
        version: "cursor-agent 1.0.0"
      });
      expect(ensuredPaths).toEqual([]);
    } finally {
      if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previousLocalAppData;
      db.close();
    }
  });

  itWindows("adds Cursor's known installer directory to PATH after official install", async () => {
    directory = testDir("clihub-cursor-install-path");
    const previousLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = directory;
    const db = new AppDatabase(directory);
    try {
      listCliHub(db);
      const cursorPath = path.join(directory, "cursor-agent", "cursor-agent.cmd");
      const installCommand = "powershell -NoProfile -ExecutionPolicy Bypass -Command iex (irm 'https://cursor.com/install?win32=true')";
      const runner = new FakeCliRunner({
        lookups: { "cursor-agent": [] },
        runs: {
          [installCommand]: { exitCode: 0, stdout: "installed", stderr: "" },
          [`${cursorPath} --version`]: { exitCode: 0, stdout: "cursor-agent 1.0.0", stderr: "" }
        },
        afterRun(command, args) {
          if ([command, ...args].join(" ") === installCommand) {
            fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
            fs.writeFileSync(cursorPath, "binary", "utf8");
          }
        }
      });
      const ensuredPaths: string[] = [];
      const pathManager = {
        async ensureUserPath(directoryPath: string) {
          ensuredPaths.push(directoryPath);
        },
        async refreshProcessPath() {}
      };

      const installed = await installCliHubCli(db, directory, "cursor", "cursor:official-windows", { commandRunner: runner, pathManager });

      expect(ensuredPaths).toContain(path.dirname(cursorPath));
      expect(installed).toMatchObject({
        availabilityState: "available",
        resolvedPaths: [cursorPath],
        version: "cursor-agent 1.0.0"
      });
    } finally {
      if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previousLocalAppData;
      db.close();
    }
  });

  itWindows("discovers Cursor from its official installer directory when PATH is missing it", async () => {
    directory = testDir("clihub-cursor-known-path");
    const previousLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = directory;
    const db = new AppDatabase(directory);
    try {
      listCliHub(db);
      const cursorPath = path.join(directory, "cursor-agent", "cursor-agent.cmd");
      fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
      fs.writeFileSync(cursorPath, "binary", "utf8");
      const runner = new FakeCliRunner({
        lookups: { "cursor-agent": [] },
        runs: {
          [`${cursorPath} --version`]: { exitCode: 0, stdout: "cursor-agent 1.0.0", stderr: "" }
        }
      });

      const refreshed = await refreshCliHubDiscovery(db, "cursor", { commandRunner: runner });

      expect(refreshed.clis.find((cli) => cli.cliId === "cursor")).toMatchObject({
        availabilityState: "available",
        resolvedPaths: [cursorPath],
        version: "cursor-agent 1.0.0",
        currentProvider: { provider: "installer-command", packageId: "cursor-agent", confidence: "high" }
      });
    } finally {
      if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previousLocalAppData;
      db.close();
    }
  });

  itWindows("adds Antigravity's known installer bin directory to PATH after official install", async () => {
    directory = testDir("clihub-antigravity-install-path");
    const previousLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = directory;
    const db = new AppDatabase(directory);
    try {
      listCliHub(db);
      const agyPath = path.join(directory, "agy", "bin", "agy.exe");
      const installCommand = "powershell -NoProfile -ExecutionPolicy Bypass -Command iex (irm 'https://antigravity.google/cli/install.ps1')";
      const runner = new FakeCliRunner({
        lookups: { agy: [] },
        runs: {
          [installCommand]: { exitCode: 0, stdout: "installed", stderr: "" },
          [`${agyPath} --version`]: { exitCode: 0, stdout: "1.0.6", stderr: "" }
        },
        afterRun(command, args) {
          if ([command, ...args].join(" ") === installCommand) {
            fs.mkdirSync(path.dirname(agyPath), { recursive: true });
            fs.writeFileSync(agyPath, "binary", "utf8");
          }
        }
      });
      const ensuredPaths: string[] = [];
      const pathManager = {
        async ensureUserPath(directoryPath: string) {
          ensuredPaths.push(directoryPath);
        },
        async refreshProcessPath() {}
      };

      const installed = await installCliHubCli(db, directory, "antigravity", "antigravity:official-windows", { commandRunner: runner, pathManager });

      expect(ensuredPaths).toContain(path.dirname(agyPath));
      expect(installed).toMatchObject({
        availabilityState: "available",
        resolvedPaths: [agyPath],
        version: "1.0.6"
      });
    } finally {
      if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previousLocalAppData;
      db.close();
    }
  });

  itWindows("discovers Antigravity from its official installer directory when PATH is missing it", async () => {
    directory = testDir("clihub-antigravity-known-path");
    const previousLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = directory;
    const db = new AppDatabase(directory);
    try {
      listCliHub(db);
      const agyPath = path.join(directory, "agy", "bin", "agy.exe");
      fs.mkdirSync(path.dirname(agyPath), { recursive: true });
      fs.writeFileSync(agyPath, "binary", "utf8");
      const runner = new FakeCliRunner({
        lookups: { agy: [] },
        runs: {
          [`${agyPath} --version`]: { exitCode: 0, stdout: "1.0.6", stderr: "" }
        }
      });

      const refreshed = await refreshCliHubDiscovery(db, "antigravity", { commandRunner: runner });

      expect(refreshed.clis.find((cli) => cli.cliId === "antigravity")).toMatchObject({
        availabilityState: "available",
        resolvedPaths: [agyPath],
        version: "1.0.6",
        currentProvider: { provider: "installer-command", packageId: "agy", confidence: "high" }
      });
    } finally {
      if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previousLocalAppData;
      db.close();
    }
  });

  it("keeps failed update stderr in the operation message", async () => {
    directory = testDir("clihub-update-failure-detail");
    const db = new AppDatabase(directory);
    listCliHub(db);
    const opencode = db.getCliHubCli("opencode");
    if (!opencode) throw new Error("missing opencode fixture");
    db.upsertCliHubCli({
      ...opencode,
      availabilityState: "available",
      resolvedPaths: ["C:\\Users\\tester\\AppData\\Roaming\\npm\\opencode.cmd"],
      currentProvider: { provider: "npm", packageId: "opencode-ai", confidence: "high", reason: "test" },
      updateStatus: "update-available"
    });
    const runner = new FakeCliRunner({
      runs: {
        "npm update -g opencode-ai": {
          exitCode: 1,
          stdout: "",
          stderr: "EEXIST: file already exists, mkdir 'C:\\Users\\tester\\.config\\opencode'"
        }
      }
    });

    try {
      await expect(updateCliHubCli(db, "opencode", { commandRunner: runner })).rejects.toThrow("EEXIST");
      const failed = db.getCliHubCli("opencode")?.recentOperation;
      expect(failed).toMatchObject({
        kind: "update",
        status: "failed",
        exitCode: 1,
        message: expect.stringContaining("EEXIST"),
        stderr: expect.stringContaining("C:\\Users\\tester\\.config\\opencode")
      });
    } finally {
      db.close();
    }
  });

  it("encodes Windows terminal update callbacks so wt.exe does not split the script", () => {
    const plan = withCliHubUpdateCompletionCallback(
      {
        cli: { cliId: "qwen" } as CliHubCli,
        provider: "npm",
        command: { command: "npm", args: ["update", "-g", "@qwen-code/qwen-code"], cwd: "E:\\repo" },
        commandText: "npm update -g @qwen-code/qwen-code"
      },
      { url: "http://127.0.0.1:3987/api/clihub/clis/qwen/update-terminal/complete", token: "local-token" },
      "win32"
    );

    expect(plan.command.args).toEqual(["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", expect.any(String)]);
    const host = buildTerminalHost(plan.command, { platform: "win32", windowsTerminalAvailable: true });
    const windowsTerminalArgs = host.args.join(" ");
    expect(windowsTerminalArgs).not.toContain("; ");
    expect(windowsTerminalArgs).not.toContain("exit $updateExitCode");

    const encodedScript = plan.command.args.at(-1);
    expect(Buffer.from(encodedScript ?? "", "base64").toString("utf16le")).toContain("exit $updateExitCode");
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
    expect(runner.runOptions.get("winget upgrade --id OpenAI.Codex --exact --disable-interactivity")?.timeoutMs).toBeGreaterThan(30000);

    db.close();
  });

  it("uses built-in winget channel package ids for detected local installs", async () => {
    directory = testDir("clihub-winget-detected-channel");
    const db = new AppDatabase(directory);
    listCliHub(db);
    const claude = db.getCliHubCli("claude");
    if (!claude) throw new Error("missing claude fixture");
    db.upsertCliHubCli({
      ...claude,
      availabilityState: "available",
      resolvedPaths: ["C:\\Users\\tester\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe"],
      version: "2.1.123 (Claude Code)",
      versionState: "detected",
      currentProvider: { provider: "winget", packageId: null, confidence: "high", reason: "路径位于 winget/WindowsApps 管理目录" }
    });
    const runner = new FakeCliRunner({
      runs: {
        "winget list --id Anthropic.ClaudeCode --exact --upgrade-available": {
          exitCode: 0,
          stdout: "Name        Id                   Version Available Source\nClaude Code Anthropic.ClaudeCode 2.1.123 2.1.163  winget",
          stderr: ""
        }
      }
    });

    const checked = await checkCliHubUpdates(db, "claude", { commandRunner: runner });

    expect(checked.clis.find((cli) => cli.cliId === "claude")).toMatchObject({ updateStatus: "update-available", updateError: null });
    expect(runner.executed).toContain("winget list --id Anthropic.ClaudeCode --exact --upgrade-available");

    db.close();
  });

  it("uses built-in npm channel package ids for detected local installs", async () => {
    directory = testDir("clihub-npm-detected-channel");
    const db = new AppDatabase(directory);
    listCliHub(db);
    const copilot = db.getCliHubCli("copilot");
    if (!copilot) throw new Error("missing copilot fixture");
    db.upsertCliHubCli({
      ...copilot,
      availabilityState: "available",
      resolvedPaths: ["C:\\Users\\tester\\AppData\\Roaming\\npm\\copilot.cmd", "C:\\Users\\tester\\AppData\\Roaming\\npm\\copilot"],
      version: "GitHub Copilot CLI 1.0.44",
      versionState: "detected",
      currentProvider: { provider: "npm", packageId: null, confidence: "high", reason: "路径位于 npm 全局目录" }
    });
    const runner = new FakeCliRunner({
      runs: {
        "npm outdated -g --json @github/copilot": {
          exitCode: 1,
          stdout: "{\"@github/copilot\":{\"current\":\"1.0.44\",\"wanted\":\"1.0.45\",\"latest\":\"1.0.45\"}}",
          stderr: ""
        }
      }
    });

    const checked = await checkCliHubUpdates(db, "copilot", { commandRunner: runner });

    expect(checked.clis.find((cli) => cli.cliId === "copilot")).toMatchObject({ updateStatus: "update-available", updateError: null });
    expect(runner.executed).toContain("npm outdated -g --json @github/copilot");

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

function staleCliHubCli(cliId: string, sourceType: "builtin" | "custom"): Omit<CliHubCli, "createdAt" | "updatedAt"> {
  return {
    cliId,
    displayName: cliId,
    kind: sourceType === "builtin" ? "project-tool" : "custom",
    sourceType,
    sourceState: sourceType === "builtin" ? "builtin" : "local-path",
    commandNames: [cliId],
    localPath: sourceType === "custom" ? path.join(directory ?? "", `${cliId}.cmd`) : null,
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

class FakeCliRunner implements CliHubCommandRunner {
  executed: string[] = [];
  runOptions = new Map<string, { timeoutMs?: number; cwd?: string } | undefined>();
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

  async run(command: string, args: string[], options?: { timeoutMs?: number; cwd?: string }): Promise<CliHubCommandResult> {
    const key = [command, ...args].join(" ");
    this.executed.push(key);
    this.runOptions.set(key, options);
    this.hook?.call(this, command, args);
    return this.runs[key] ?? { exitCode: 0, stdout: "", stderr: "" };
  }
}
