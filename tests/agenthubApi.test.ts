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
