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

describe("AgentHub API", () => {
  it("lists project local agents without seeding AgentHub sources", async () => {
    directory = testDir("agenthub-api-local-agents");
    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const projectRoot = path.join(directory, "repo");
    const agentPath = path.join(projectRoot, ".codex", "agents", "local-reviewer.toml");
    fs.mkdirSync(path.dirname(agentPath), { recursive: true });
    fs.writeFileSync(agentPath, 'name = "Local Reviewer"\ndescription = "Review locally"\n', "utf8");

    const added = await request(app)
      .post("/api/projects")
      .set("x-local-api-token", context.token)
      .send({ rootPath: projectRoot })
      .expect(201);

    const localAgents = await request(app)
      .get(`/api/projects/${added.body.project.id}/local-agents`)
      .set("x-local-api-token", context.token)
      .expect(200);

    expect(localAgents.body.agents).toEqual([]);
    expect(localAgents.body.sources).toEqual([]);
    expect(localAgents.body.localAgents).toEqual([expect.objectContaining({ type: "unmanaged", toolId: "codex", name: "Local Reviewer" })]);

    const agentHub = await request(app).get("/api/agenthub").set("x-local-api-token", context.token).expect(200);
    expect(agentHub.body.sources).toEqual([]);
    expect(agentHub.body.agents).toEqual([]);
  });

  it("returns cached rows first and seeds built-in agents only through discovery refresh", async () => {
    directory = testDir("agenthub-api-cached-first");
    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    const cached = await request(app).get("/api/agenthub").set("x-local-api-token", context.token).expect(200);
    expect(cached.body.sources).toEqual([]);
    expect(cached.body.agents).toEqual([]);

    const refreshed = await request(app).post("/api/agenthub/discovery/refresh").set("x-local-api-token", context.token).send({}).expect(200);
    expect(refreshed.body.sources).toEqual([expect.objectContaining({ id: "agency-agents" })]);
    expect(refreshed.body.agents.length).toBeGreaterThan(200);

    const afterRefresh = await request(app).get("/api/agenthub").set("x-local-api-token", context.token).expect(200);
    expect(afterRefresh.body.sources).toEqual([expect.objectContaining({ id: "agency-agents" })]);
  }, 60000);
});
