import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AppContext } from "../src/server/appContext.js";
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

function configureClaudeAvailable(appContext: AppContext): void {
  appContext.config().tools.claude.command = "node";
}

describe("HookHub API", () => {
  it("creates a suite, applies it to a selected project group, lists status, and exports suite JSON", async () => {
    directory = testDir("hookhub-api");
    context = new AppContext(directory);
    configureClaudeAvailable(context);
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const projectRoot = path.join(directory, "repo");
    const childRoot = path.join(projectRoot, "packages", "app");
    fs.mkdirSync(childRoot, { recursive: true });

    const suite = await request(app)
      .post("/api/hookhub/suites")
      .send({
        name: "提交前检查",
        payloads: { claude: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm test" }] }] } }
      })
      .expect(201);
    expect(suite.body).toMatchObject({ name: "提交前检查", toolIds: ["claude"] });

    const added = await request(app)
      .post("/api/projects")
      .send({ rootPath: projectRoot, includeSubdirectories: true, toolIds: ["claude"] })
      .expect(201);

    const applied = await request(app)
      .put(`/api/projects/${added.body.project.id}/hooks/claude/apply/${suite.body.suiteId}`)
      .send({ targetRootPath: childRoot })
      .expect(200);
    expect(applied.body).toMatchObject({ toolId: "claude", targetRootPath: childRoot, suite: { name: "提交前检查" } });
    expect(JSON.parse(fs.readFileSync(path.join(childRoot, ".claude", "settings.json"), "utf8")).hooks).toEqual(suite.body.payloads.claude);

    const state = await request(app)
      .get(`/api/projects/${added.body.project.id}/hooks`)
      .query({ targetRootPath: childRoot })
      .expect(200);
    expect(state.body.tools.find((tool: { toolId: string }) => tool.toolId === "claude")).toMatchObject({
      status: "current",
      suite: { suiteId: suite.body.suiteId }
    });

    fs.rmSync(path.join(childRoot, ".claude", "settings.json"), { force: true });
    const removed = await request(app)
      .delete(`/api/projects/${added.body.project.id}/hooks/claude/binding`)
      .query({ targetRootPath: childRoot })
      .expect(200);
    expect(removed.body).toMatchObject({ removed: true, state: { status: "missing", binding: null } });

    const exported = await request(app)
      .get(`/api/hookhub/suites/${suite.body.suiteId}/export`)
      .expect(200);
    expect(exported.body.format).toBe("hookhub-suite-v1");
    expect(JSON.stringify(exported.body)).not.toContain("targetRootPath");
  });
});
