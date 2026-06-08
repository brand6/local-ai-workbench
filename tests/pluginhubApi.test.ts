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

describe("PluginHub API", () => {
  it("returns cached rows first and seeds built-in plugins only through discovery refresh", async () => {
    directory = testDir("pluginhub-api-cached-first");
    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    const cached = await request(app).get("/api/pluginhub").set("x-local-api-token", context.token).expect(200);
    expect(cached.body.sources).toEqual([]);
    expect(cached.body.plugins).toEqual([]);

    const refreshed = await request(app).post("/api/pluginhub/discovery/refresh").set("x-local-api-token", context.token).expect(200);
    expect(refreshed.body.sources).toEqual([
      expect.objectContaining({ id: "pluginhub-source-caveman" }),
      expect.objectContaining({ id: "pluginhub-source-superpowers" })
    ]);
    expect(refreshed.body.plugins).toEqual([expect.objectContaining({ name: "caveman" }), expect.objectContaining({ name: "superpowers" })]);

    const afterRefresh = await request(app).get("/api/pluginhub").set("x-local-api-token", context.token).expect(200);
    expect(afterRefresh.body.sources).toEqual([
      expect.objectContaining({ id: "pluginhub-source-caveman" }),
      expect.objectContaining({ id: "pluginhub-source-superpowers" })
    ]);
  }, 20000);
});
