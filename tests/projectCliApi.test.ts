import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AppContext } from "../src/server/appContext.js";
import type { CliHubCommandResult, CliHubCommandRunner } from "../src/server/clihub/clihub.js";
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

describe("Project CLI API", () => {
  it("lists installed function and dependency CLI commands from CliHub", async () => {
    directory = testDir("project-cli-commands");
    const gitPath = "C:\\Program Files\\Git\\cmd\\git.exe";
    const ghPath = "C:\\Program Files\\GitHub CLI\\gh.exe";
    const runner = new FakeCliRunner({
      lookups: {
        git: [gitPath],
        gh: [ghPath]
      }
    });
    context = new AppContext(directory, { cliHub: { commandRunner: runner } });
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });

    const added = await request(app)
      .post("/api/projects")
      .send({ rootPath: projectRoot, includeSubdirectories: true })
      .expect(201);

    await request(app)
      .post("/api/clihub/discovery/refresh")
      .send({ cliId: "git", includeDetails: false })
      .expect(200);
    await request(app)
      .post("/api/clihub/discovery/refresh")
      .send({ cliId: "gh", includeDetails: false })
      .expect(200);

    const listed = await request(app)
      .get(`/api/projects/${added.body.project.id}/cli-actions`)
      .expect(200);

    expect(listed.body.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cliId: "git",
          displayName: "Git",
          actions: [],
          commands: expect.arrayContaining([
            expect.objectContaining({
              commandId: "init",
              label: "初始化仓库",
              kind: "dependency",
              command: "git",
              args: ["init"],
              commandText: "git init",
              description: expect.stringContaining("创建 Git 仓库"),
              cwd: projectRoot,
              executionMode: "terminal",
              writesProject: true,
              requiresConfirmation: true,
              affectedPaths: [path.join(projectRoot, ".git")],
              localPath: gitPath
            }),
            expect.objectContaining({
              commandId: "status",
              label: "查看状态",
              kind: "dependency",
              command: "git",
              args: ["status", "--short"],
              commandText: "git status --short",
              description: expect.stringContaining("未提交变更"),
              cwd: projectRoot,
              executionMode: "terminal",
              writesProject: false,
              requiresConfirmation: false,
              affectedPaths: [],
              localPath: gitPath
            })
          ])
        }),
        expect.objectContaining({
          cliId: "gh",
          displayName: "GitHub CLI",
          actions: [],
          commands: expect.arrayContaining([
            expect.objectContaining({
              commandId: "pr-list",
              label: "查看 PR 列表",
              kind: "function",
              command: "gh",
              args: ["pr", "list"],
              commandText: "gh pr list",
              cwd: projectRoot,
              executionMode: "terminal",
              writesProject: false,
              requiresConfirmation: false,
              localPath: ghPath
            })
          ])
        })
      ])
    );

    const ran = await request(app)
      .post(`/api/projects/${added.body.project.id}/cli-actions/commands/${encodeURIComponent("git")}/execute`)
      .send({ commandId: "status", argsText: "--ignored", dryRun: true })
      .expect(200);
    expect(ran.body).toMatchObject({
      actionId: "command:git:status",
      cliId: "git",
      label: "查看状态",
      command: "git",
      args: ["status", "--short", "--ignored"],
      commandText: "git status --short --ignored",
      cwd: projectRoot,
      executionMode: "terminal",
      status: "launched",
      exitCode: null,
      launch: {
        launched: true,
        host: expectedProjectCliTerminalHost(),
        command: { command: gitPath, args: ["status", "--short", "--ignored"], cwd: projectRoot }
      }
    });
    expect(runner.executed).toEqual([]);
  });

  it("lists and runs CodeGraph actions for the selected project group without requiring a real install", async () => {
    directory = testDir("project-cli-api");
    const codegraphPath = "C:\\tools\\codegraph.cmd";
    const runner = new FakeCliRunner();
    context = new AppContext(directory, { cliHub: { commandRunner: runner } });
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const projectRoot = path.join(directory, "repo");
    const childRoot = path.join(projectRoot, "packages", "app");
    fs.mkdirSync(childRoot, { recursive: true });

    const added = await request(app)
      .post("/api/projects")
      .send({ rootPath: projectRoot, includeSubdirectories: true })
      .expect(201);

    const empty = await request(app)
      .get(`/api/projects/${added.body.project.id}/cli-actions`)
      .query({ targetRootPath: childRoot })
      .expect(200);
    expect(empty.body.groups).toEqual([]);

    const customCodeGraph = await request(app)
      .post("/api/clihub/custom/install-command")
      .send({ installCommand: "npm install -g @colbymchenry/codegraph", displayName: "CodeGraph" })
      .expect(201);
    expect(customCodeGraph.body).toMatchObject({
      sourceType: "custom",
      commandNames: ["codegraph"],
      availabilityState: "unavailable"
    });

    const unavailable = await request(app)
      .get(`/api/projects/${added.body.project.id}/cli-actions`)
      .query({ targetRootPath: childRoot })
      .expect(200);
    expect(unavailable.body.groups[0].availability).toMatchObject({
      state: "unavailable",
      cliHubCliId: customCodeGraph.body.cliId
    });

    runner.lookups.codegraph = [codegraphPath];
    runner.runs[`${codegraphPath} --version`] = { exitCode: 0, stdout: "codegraph 0.4.0", stderr: "" };
    await request(app)
      .post("/api/clihub/discovery/refresh")
      .send({ cliId: customCodeGraph.body.cliId })
      .expect(200);

    const listed = await request(app)
      .get(`/api/projects/${added.body.project.id}/cli-actions`)
      .query({ targetRootPath: childRoot })
      .expect(200);
    expect(listed.body).toMatchObject({
      projectId: added.body.project.id,
      targetRootPath: childRoot,
      groups: [
        {
          cliId: customCodeGraph.body.cliId,
          displayName: "CodeGraph",
          availability: { state: "available" }
        }
      ]
    });
    expect(listed.body.groups[0].actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: "codegraph:init",
          command: "codegraph",
          args: ["init", "-i"],
          cwd: childRoot,
          executionMode: "terminal",
          writesProject: true,
          affectedPaths: [path.join(childRoot, ".codegraph")]
        }),
        expect.objectContaining({
          actionId: "codegraph:status",
          args: ["status"],
          executionMode: "terminal",
          writesProject: false
        })
      ])
    );

    const status = await request(app)
      .post(`/api/projects/${added.body.project.id}/cli-actions/${encodeURIComponent("codegraph:status")}/execute`)
      .send({ targetRootPath: childRoot, dryRun: true })
      .expect(200);
    expect(status.body).toMatchObject({
      actionId: "codegraph:status",
      cwd: childRoot,
      executionMode: "terminal",
      status: "launched",
      exitCode: null,
      launch: {
        launched: true,
        host: expectedProjectCliTerminalHost(),
        command: { command: codegraphPath, args: ["status"], cwd: childRoot }
      }
    });

    const launched = await request(app)
      .post(`/api/projects/${added.body.project.id}/cli-actions/${encodeURIComponent("codegraph:init")}/execute`)
      .send({ targetRootPath: childRoot, dryRun: true })
      .expect(200);
    expect(launched.body).toMatchObject({
      actionId: "codegraph:init",
      status: "launched",
      launch: {
        launched: true,
        command: { command: codegraphPath, args: ["init", "-i"], cwd: childRoot }
      }
    });
    expect(runner.executed).not.toContain("codegraph status");
    expect(runner.executed).not.toContain("codegraph init -i");

    await request(app)
      .post(`/api/projects/${added.body.project.id}/cli-actions/${encodeURIComponent("codegraph:missing")}/execute`)
      .send({ targetRootPath: childRoot })
      .expect(404);

    await request(app)
      .get(`/api/projects/${added.body.project.id}/cli-actions`)
      .query({ targetRootPath: path.join(directory, "outside") })
      .expect(400);
  });
});

function expectedProjectCliTerminalHost(): "powershell" | "direct" {
  return process.platform === "win32" ? "powershell" : "direct";
}

class FakeCliRunner implements CliHubCommandRunner {
  executed: string[] = [];
  readonly lookups: Record<string, string[]>;
  readonly runs: Record<string, CliHubCommandResult>;

  constructor(options: { lookups?: Record<string, string[]>; runs?: Record<string, CliHubCommandResult> } = {}) {
    this.lookups = options.lookups ?? {};
    this.runs = options.runs ?? {};
  }

  async lookup(commandName: string): Promise<string[]> {
    return this.lookups[commandName] ?? [];
  }

  async run(command: string, args: string[]): Promise<CliHubCommandResult> {
    const key = [command, ...args].join(" ");
    this.executed.push(key);
    return this.runs[key] ?? { exitCode: 0, stdout: "", stderr: "" };
  }
}
