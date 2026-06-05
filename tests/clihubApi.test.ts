import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AppContext } from "../src/server/appContext.js";
import type { CliHubCommandResult, CliHubCommandRunner, CliHubPathManager } from "../src/server/clihub/clihub.js";
import { createHttpApp } from "../src/server/http/app.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;
let context: AppContext | null = null;

afterEach(() => {
  context?.close();
  context = null;
  if (directory) cleanup(directory);
  directory = null;
});

describe("CliHub API", () => {
  it("lists, refreshes, adds custom CLIs, and keeps project tools unchanged", async () => {
    directory = testDir("clihub-api");
    const executable = path.join(directory, "internal-tool.exe");
    fs.writeFileSync(executable, "tool", "utf8");
    const runner = new FakeCliRunner({
      lookups: {
        codex: ["C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd"]
      },
      runs: {
        "C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd --version": { exitCode: 0, stdout: "codex 1.2.3", stderr: "" },
        [`${executable} --version`]: { exitCode: 0, stdout: "internal 1.0.0", stderr: "" }
      }
    });
    context = new AppContext(directory, { cliHub: { commandRunner: runner } });
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    const listed = await request(app).get("/api/clihub").set("x-local-api-token", context.token).expect(200);
    expect(listed.body.clis.map((cli: { cliId: string }) => cli.cliId)).toEqual(
      expect.arrayContaining(["codex", "claude", "gh", "playwright", "node", "npm", "git"])
    );

    const refreshed = await request(app)
      .post("/api/clihub/discovery/refresh")
      .set("x-local-api-token", context.token)
      .send({ cliId: "codex" })
      .expect(200);
    expect(refreshed.body.clis.find((cli: { cliId: string }) => cli.cliId === "codex")).toMatchObject({
      availabilityState: "available",
      version: "codex 1.2.3"
    });

    const customLocal = await request(app)
      .post("/api/clihub/custom/local-path")
      .set("x-local-api-token", context.token)
      .send({ executablePath: executable })
      .expect(201);
    expect(customLocal.body).toMatchObject({ sourceState: "local-path", availabilityState: "available" });

    await request(app)
      .post("/api/clihub/custom/install-command")
      .set("x-local-api-token", context.token)
      .send({ installCommand: "internal-cli" })
      .expect(400);

    const tools = await request(app).get("/api/tools/status").set("x-local-api-token", context.token).expect(200);
    expect(tools.body.map((tool: { toolId: string }) => tool.toolId)).not.toContain(customLocal.body.cliId);
  });

  it("runs install, update checks, and updates through fake providers", async () => {
    directory = testDir("clihub-api-install");
    const runner = new FakeCliRunner({
      lookups: { codex: [] },
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
    const pathManager: CliHubPathManager = { async ensureUserPath() {} };
    context = new AppContext(directory, { cliHub: { commandRunner: runner, pathManager } });
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    const installed = await request(app)
      .post("/api/clihub/clis/codex/install")
      .set("x-local-api-token", context.token)
      .send({ channelId: "codex:npm" })
      .expect(200);
    expect(installed.body).toMatchObject({ availabilityState: "available", currentProvider: { provider: "npm" } });

    const checked = await request(app)
      .post("/api/clihub/clis/codex/check-updates")
      .set("x-local-api-token", context.token)
      .expect(200);
    expect(checked.body.clis.find((cli: { cliId: string }) => cli.cliId === "codex")).toMatchObject({ updateStatus: "update-available" });

    await request(app).post("/api/clihub/clis/codex/update").set("x-local-api-token", context.token).expect(200);
    expect(runner.executed).toContain("npm update -g @openai/codex");
  });
});

class FakeCliRunner implements CliHubCommandRunner {
  executed: string[] = [];
  lookups: Record<string, string[]>;
  private readonly runs: Record<string, CliHubCommandResult>;
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
