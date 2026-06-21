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

describe("McpHub API", () => {
  it("lists center servers and applies MCP to the selected project group", async () => {
    directory = testDir("mcphub-api");
    context = new AppContext(directory);
    configureClaudeAvailable(context);
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const projectRoot = path.join(directory, "repo");
    const childRoot = path.join(projectRoot, "packages", "app");
    fs.mkdirSync(childRoot, { recursive: true });

    const initial = await request(app).get("/api/mcphub").expect(200);
    expect(initial.body.servers.map((server: { serverId: string }) => server.serverId)).toEqual(["context7", "playwright", "skillhub", "unityMCP"]);
    expect(initial.body.servers.every((server: { builtin?: boolean }) => server.builtin)).toBe(true);

    const imported = await request(app)
      .post("/api/mcphub/import")
      .send({ input: '{"mcpServers":{"docs":{"command":"node","args":["server.js"]}}}' })
      .expect(200);
    expect(imported.body.added[0]).toMatchObject({ serverId: "docs", transport: "stdio" });

    const added = await request(app)
      .post("/api/projects")
      .send({ rootPath: projectRoot, includeSubdirectories: true, toolIds: ["claude"] })
      .expect(201);

    const applied = await request(app)
      .put(`/api/projects/${added.body.project.id}/mcp-bindings/docs/claude`)
      .send({ targetRootPath: childRoot })
      .expect(200);

    expect(applied.body).toMatchObject({ toolId: "claude", targetRootPath: childRoot, server: { serverId: "docs" } });
    expect(JSON.parse(fs.readFileSync(path.join(childRoot, ".mcp.json"), "utf8")).mcpServers.docs).toMatchObject({
      command: "node",
      args: ["server.js"]
    });

    const projectMcp = await request(app)
      .get(`/api/projects/${added.body.project.id}/mcp`)
      .query({ targetRootPath: childRoot })
      .expect(200);
    expect(projectMcp.body.bindings).toHaveLength(1);
    expect(projectMcp.body.localEntries[0]).toMatchObject({ serverId: "docs", status: "managed", toolId: "claude" });

    const disabled = await request(app)
      .delete(`/api/projects/${added.body.project.id}/mcp-bindings/docs/claude`)
      .query({ targetRootPath: childRoot })
      .expect(200);
    expect(disabled.body).toMatchObject({ removedBinding: true, modified: true });
    expect(JSON.parse(fs.readFileSync(path.join(childRoot, ".mcp.json"), "utf8")).mcpServers.docs).toBeUndefined();
  });

  it("returns a readable reason when MCP apply cannot write a read-only config", async () => {
    directory = testDir("mcphub-api-readonly");
    context = new AppContext(directory);
    configureClaudeAvailable(context);
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const configPath = path.join(projectRoot, ".mcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { PapeEngineLauncer: { type: "http", url: "http://127.0.0.1:18765/mcp" } } }, null, 2),
      "utf8"
    );
    fs.chmodSync(configPath, 0o444);

    try {
      const added = await request(app)
        .post("/api/projects")
        .send({ rootPath: projectRoot, includeSubdirectories: false, toolIds: ["claude"] })
        .expect(201);

      const failed = await request(app).put(`/api/projects/${added.body.project.id}/mcp-bindings/unityMCP/claude`).expect(400);

      expect(failed.body).toMatchObject({ error: "project-mcp-apply-failed" });
      expect(failed.body.reason).toContain("目标 MCP 配置文件不可写");
    } finally {
      fs.chmodSync(configPath, 0o666);
    }
  });
});
