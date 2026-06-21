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

function rpc(method: string, params?: Record<string, unknown>) {
  return { jsonrpc: "2.0", id: 1, method, params };
}

describe("MCP Endpoint", () => {
  it("handles initialize and returns protocol version", async () => {
    directory = testDir("mcp-endpoint");
    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    const res = await request(app).post("/mcp").send(rpc("initialize")).expect(200);
    expect(res.body.result).toMatchObject({
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "skillhub", version: "0.1.0" }
    });
  });

  it("lists the search_skills tool", async () => {
    directory = testDir("mcp-endpoint");
    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    const res = await request(app).post("/mcp").send(rpc("tools/list")).expect(200);
    expect(res.body.result.tools).toHaveLength(1);
    expect(res.body.result.tools[0]).toMatchObject({ name: "search_skills" });
    expect(res.body.result.tools[0].inputSchema).toBeDefined();
  });

  it("returns all skills when query is empty", async () => {
    directory = testDir("mcp-endpoint");
    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    // trigger default skill seeding
    await request(app).get("/api/skillhub").expect(200);

    const res = await request(app)
      .post("/mcp")
      .send(rpc("tools/call", { name: "search_skills", arguments: {} }))
      .expect(200);

    const skills = JSON.parse(res.body.result.content[0].text);
    expect(skills.length).toBeGreaterThan(0);
    expect(skills[0]).toHaveProperty("id");
    expect(skills[0]).toHaveProperty("folderName");
    expect(skills[0]).toHaveProperty("skillName");
    expect(skills[0]).toHaveProperty("description");
    expect(skills[0]).toHaveProperty("sourceType");
    expect(skills[0]).not.toHaveProperty("libraryPath");
    expect(skills[0]).not.toHaveProperty("contentHash");
  });

  it("filters skills by keyword", async () => {
    directory = testDir("mcp-endpoint");
    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    // seed skills
    await request(app).get("/api/skillhub").expect(200);

    // import a local skill with known name
    const localSkill = path.join(directory, "local", "my-test-skill");
    fs.mkdirSync(localSkill, { recursive: true });
    fs.writeFileSync(path.join(localSkill, "SKILL.md"), "---\nname: my-test-skill\ndescription: A unique findable skill\n---\n", "utf8");
    await request(app).post("/api/skillhub/import/local").send({ path: localSkill }).expect(200);

    const res = await request(app)
      .post("/mcp")
      .send(rpc("tools/call", { name: "search_skills", arguments: { query: "unique findable" } }))
      .expect(200);

    const skills = JSON.parse(res.body.result.content[0].text);
    expect(skills).toHaveLength(1);
    expect(skills[0].skillName).toBe("my-test-skill");
  });

  it("returns error for unknown tool", async () => {
    directory = testDir("mcp-endpoint");
    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    const res = await request(app)
      .post("/mcp")
      .send(rpc("tools/call", { name: "nonexistent_tool", arguments: {} }))
      .expect(200);

    expect(res.body.error).toMatchObject({ code: -32602, message: expect.stringContaining("nonexistent_tool") });
  });

  it("returns error for unknown method", async () => {
    directory = testDir("mcp-endpoint");
    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    const res = await request(app)
      .post("/mcp")
      .send(rpc("unknown/method"))
      .expect(200);

    expect(res.body.error).toMatchObject({ code: -32601 });
  });

  it("returns error for invalid JSON-RPC request", async () => {
    directory = testDir("mcp-endpoint");
    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    const res = await request(app)
      .post("/mcp")
      .send({ notJsonRpc: true })
      .expect(200);

    expect(res.body.error).toMatchObject({ code: -32600 });
  });
});
