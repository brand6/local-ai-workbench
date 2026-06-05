import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/server/storage/database.js";
import {
  applyProjectMcpServer,
  deleteMcpHubServer,
  disableProjectMcpServer,
  importMcpHubJson,
  listMcpHub,
  listProjectMcpState,
  migrateProjectLocalMcp
} from "../src/server/mcphub/mcphub.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;

afterEach(() => {
  if (directory) cleanup(directory);
  directory = null;
});

describe("McpHub", () => {
  it("lists built-in servers and imports repaired JSON while preserving stable server ids", () => {
    directory = testDir("mcphub-import");
    const db = new AppDatabase(directory);

    const firstList = listMcpHub(db);
    const secondList = listMcpHub(db);
    expect(firstList.servers.map((server) => server.serverId)).toEqual(["context7", "playwright", "unityMCP"]);
    expect(firstList.servers.every((server) => server.builtin)).toBe(true);
    expect(secondList.servers).toHaveLength(3);
    expect(db.listMcpHubServers()).toHaveLength(3);

    const imported = importMcpHubJson(
      db,
      `
      prose before
      \`\`\`json
      {
        // copied from docs
        "mcpServers": {
          "docs": { "command": "node", "args": ["server.js"], },
          "unity": { "url": "http://127.0.0.1:8082/mcp" }
        }
      \`\`\`
    `
    );
    expect(imported.added.map((server) => server.serverId)).toEqual(["docs", "unity"]);
    expect(imported.failed).toEqual([]);

    const patched = importMcpHubJson(db, `{"serverId":"docs","args":["next.js"],"requiredEnv":["DOCS_TOKEN"]}`);
    expect(patched.patched[0]).toMatchObject({ serverId: "docs", command: "node", args: ["next.js"], requiredEnv: ["DOCS_TOKEN"] });

    const incomplete = importMcpHubJson(db, `{"serverId":"new-partial","args":["missing-command"]}`);
    expect(incomplete.failed[0]).toMatchObject({ serverId: "new-partial" });

    const unsupported = importMcpHubJson(db, `{"mcpServers":{"bad":{"transport":"sse","url":"http://example.test/sse"}}}`);
    expect(unsupported.failed[0]).toMatchObject({ serverId: "bad" });
    db.close();
  });

  it("does not delete built-in MCP servers", () => {
    directory = testDir("mcphub-built-in-delete");
    const db = new AppDatabase(directory);

    listMcpHub(db);

    expect(() => deleteMcpHubServer(db, "context7")).toThrow("内置 MCP server 不能删除");
    expect(listMcpHub(db).servers.map((server) => server.serverId)).toEqual(["context7", "playwright", "unityMCP"]);
    db.close();
  });

  it("applies and disables Claude, Codex, and OpenCode project config without dropping unrelated fields", () => {
    directory = testDir("mcphub-apply");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".mcp.json"), JSON.stringify({ keep: true, mcpServers: { localOnly: { command: "node" } } }, null, 2), "utf8");
    fs.writeFileSync(path.join(projectRoot, ".codex", "config.toml"), 'model = "gpt-5"\n\n[mcp_servers.keep]\ncommand = "keep"\n', "utf8");
    fs.writeFileSync(path.join(projectRoot, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", provider: {} }, null, 2), "utf8");
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["claude", "codex", "opencode"]);
    const server = db.upsertMcpHubServer({
      serverId: "docs",
      name: "docs",
      description: "Docs server",
      transport: "stdio",
      command: "node",
      args: ["${PROJECT_ROOT}\\server.js"],
      url: null,
      headers: {},
      env: { DOCS_TOKEN: "${DOCS_TOKEN}" },
      requiredEnv: ["DOCS_TOKEN"]
    });

    const claude = applyProjectMcpServer(db, project, "claude", server.serverId);
    const codex = applyProjectMcpServer(db, project, "codex", server.serverId);
    const opencode = applyProjectMcpServer(db, project, "opencode", server.serverId);

    expect(claude.warnings).toEqual(["缺少环境变量：DOCS_TOKEN"]);
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8"))).toMatchObject({
      keep: true,
      mcpServers: {
        localOnly: { command: "node" },
        docs: { command: "node", args: [`${projectRoot}\\server.js`], env: { DOCS_TOKEN: "${DOCS_TOKEN}" } }
      }
    });
    expect(fs.readFileSync(path.join(projectRoot, ".codex", "config.toml"), "utf8")).toContain('model = "gpt-5"');
    expect(fs.readFileSync(path.join(projectRoot, ".codex", "config.toml"), "utf8")).toContain("[mcp_servers.docs]");
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.json"), "utf8"))).toMatchObject({
      $schema: "https://opencode.ai/config.json",
      mcp: { docs: { type: "local", command: ["node", `${projectRoot}\\server.js`], environment: { DOCS_TOKEN: "${DOCS_TOKEN}" } } }
    });
    expect(db.listProjectMcpBindings(project.id, project.rootPath)).toHaveLength(3);

    const disabled = disableProjectMcpServer(db, project, "codex", "docs");
    expect(disabled).toMatchObject({ removedBinding: true, modified: true });
    const codexText = fs.readFileSync(path.join(projectRoot, ".codex", "config.toml"), "utf8");
    expect(codexText).toContain("[mcp_servers.keep]");
    expect(codexText).not.toContain("[mcp_servers.docs]");
    expect(db.listProjectMcpBindings(project.id, project.rootPath).map((binding) => binding.toolId).sort()).toEqual(["claude", "opencode"]);

    expect(codex.configPath).toBe(path.join(projectRoot, ".codex", "config.toml"));
    expect(opencode.configPath).toBe(path.join(projectRoot, "opencode.json"));
    db.close();
  });

  it("applies additional project-local MCP target formats", () => {
    directory = testDir("mcphub-apply-additional-tools");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["cursor", "antigravity"]);
    const server = db.upsertMcpHubServer({
      serverId: "docs",
      name: "docs",
      description: "Docs server",
      transport: "stdio",
      command: "node",
      args: ["${PROJECT_ROOT}\\server.js"],
      url: null,
      headers: {},
      env: { DOCS_TOKEN: "${DOCS_TOKEN}" },
      requiredEnv: []
    });

    applyProjectMcpServer(db, project, "cursor", server.serverId);
    applyProjectMcpServer(db, project, "antigravity", server.serverId);

    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".cursor", "mcp.json"), "utf8"))).toMatchObject({
      mcpServers: {
        docs: { type: "stdio", command: "node", args: [`${projectRoot}\\server.js`], env: { DOCS_TOKEN: "${DOCS_TOKEN}" } }
      }
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".agents", "mcp_config.json"), "utf8"))).toMatchObject({
      mcpServers: {
        docs: { command: "node", args: [`${projectRoot}\\server.js`], env: { DOCS_TOKEN: "${DOCS_TOKEN}" } }
      }
    });
    db.close();
  });

  it("keeps failed MCP cleanup bindings owned when deleting a center server", () => {
    directory = testDir("mcphub-delete-partial-failure");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".mcp.json"), JSON.stringify({ mcpServers: {} }, null, 2), "utf8");
    fs.writeFileSync(path.join(projectRoot, ".codex", "config.toml"), "", "utf8");
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["claude", "codex"]);
    const server = db.upsertMcpHubServer({
      serverId: "docs",
      name: "docs",
      description: null,
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      url: null,
      headers: {},
      env: {},
      requiredEnv: []
    });

    applyProjectMcpServer(db, project, "claude", server.serverId);
    applyProjectMcpServer(db, project, "codex", server.serverId);
    fs.writeFileSync(path.join(projectRoot, ".mcp.json"), "{ invalid json", "utf8");

    const deleted = deleteMcpHubServer(db, server.serverId);

    expect(deleted.deleted).toBe(false);
    expect(deleted.failures).toEqual([expect.objectContaining({ path: path.join(projectRoot, ".mcp.json") })]);
    expect(deleted.bindingsRemoved.map((binding) => binding.toolId)).toEqual(["codex"]);
    expect(db.getMcpHubServer(server.serverId)).not.toBeNull();
    expect(db.getProjectMcpBinding(project.id, project.rootPath, "claude", server.serverId)).not.toBeNull();
    expect(db.getProjectMcpBinding(project.id, project.rootPath, "codex", server.serverId)).toBeNull();
    expect(fs.readFileSync(path.join(projectRoot, ".codex", "config.toml"), "utf8")).not.toContain("[mcp_servers.docs]");
    db.close();
  });

  it("marks MCP targets by current project tool enablement and refuses disabled tools", () => {
    directory = testDir("mcphub-project-tool-targets");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["claude", "codex"]);
    const server = db.upsertMcpHubServer({
      serverId: "docs",
      name: "docs",
      description: "Docs server",
      transport: "stdio",
      command: "node",
      args: [],
      url: null,
      headers: {},
      env: {},
      requiredEnv: []
    });

    const state = listProjectMcpState(db, project);
    expect(state.targets.map((target) => ({ toolId: target.toolId, enabled: target.enabled }))).toEqual([
      { toolId: "claude", enabled: true },
      { toolId: "codex", enabled: true },
      { toolId: "opencode", enabled: false },
      { toolId: "cursor", enabled: false },
      { toolId: "antigravity", enabled: false }
    ]);

    expect(() => applyProjectMcpServer(db, project, "opencode", server.serverId)).toThrow("该工具未在项目中启用");
    expect(applyProjectMcpServer(db, project, "claude", server.serverId)).toMatchObject({ toolId: "claude" });
    db.close();
  });

  it("discovers and migrates equivalent local MCP entries without rewriting project files", () => {
    directory = testDir("mcphub-local-migrate");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { shared: { command: "node", args: ["server.js"], env: { ROOT: "${PROJECT_ROOT}" } } } }, null, 2),
      "utf8"
    );
    fs.writeFileSync(path.join(projectRoot, ".codex", "config.toml"), '[mcp_servers.shared]\ncommand = "node"\nargs = ["server.js"]\nenv = { ROOT = "${PROJECT_ROOT}" }\n', "utf8");
    fs.writeFileSync(
      path.join(projectRoot, "opencode.json"),
      JSON.stringify({ mcp: { shared: { type: "local", command: ["node", "server.js"], environment: { ROOT: "${PROJECT_ROOT}" } } } }, null, 2),
      "utf8"
    );
    const project = db.addProject(projectRoot).project;
    const beforeFiles = [
      fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8"),
      fs.readFileSync(path.join(projectRoot, ".codex", "config.toml"), "utf8"),
      fs.readFileSync(path.join(projectRoot, "opencode.json"), "utf8")
    ];

    const before = listProjectMcpState(db, project);
    expect(before.localEntries).toHaveLength(3);
    expect(before.localEntries.every((entry) => entry.status === "unmanaged")).toBe(true);

    const migrated = migrateProjectLocalMcp(db, project, "shared");
    const after = listProjectMcpState(db, project);

    expect(migrated).toMatchObject({ action: "migrated", requiresConfirmation: false, server: { serverId: "shared" } });
    expect(migrated.bindings.map((binding) => binding.toolId).sort()).toEqual(["claude", "codex", "opencode"]);
    expect(after.localEntries.every((entry) => entry.status === "managed")).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8")).toBe(beforeFiles[0]);
    expect(fs.readFileSync(path.join(projectRoot, ".codex", "config.toml"), "utf8")).toBe(beforeFiles[1]);
    expect(fs.readFileSync(path.join(projectRoot, "opencode.json"), "utf8")).toBe(beforeFiles[2]);
    db.close();
  });

  it("does not remove unmanaged same-id local entries without ownership", () => {
    directory = testDir("mcphub-unmanaged-preserve");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".mcp.json"), JSON.stringify({ mcpServers: { docs: { command: "node" } } }, null, 2), "utf8");
    const project = db.addProject(projectRoot).project;
    db.upsertMcpHubServer({
      serverId: "docs",
      name: "docs",
      description: null,
      transport: "stdio",
      command: "node",
      args: [],
      url: null,
      headers: {},
      env: {},
      requiredEnv: []
    });

    const disabled = disableProjectMcpServer(db, project, "claude", "docs");
    const deleted = deleteMcpHubServer(db, "docs");

    expect(disabled).toMatchObject({ removedBinding: false, modified: false });
    expect(deleted.modifiedFiles).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8")).mcpServers.docs).toMatchObject({ command: "node" });
    db.close();
  });
});
