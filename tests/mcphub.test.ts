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
    expect(firstList.servers.map((server) => server.serverId)).toEqual(["context7", "playwright", "skillhub", "unityMCP"]);
    expect(firstList.servers.every((server) => server.builtin)).toBe(true);
    expect(secondList.servers).toHaveLength(4);
    expect(db.listMcpHubServers()).toHaveLength(4);

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
    expect(listMcpHub(db).servers.map((server) => server.serverId)).toEqual(["context7", "playwright", "skillhub", "unityMCP"]);
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
    db.replaceProjectToolTargets(project.id, ["claude", "codex", "opencode", "codebuddy"]);
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
    expect(claude.backup).toMatchObject({ hub: "McpHub", targetResourceType: "mcp", originalPath: path.join(projectRoot, ".mcp.json") });
    expect(codex.backup).toMatchObject({ hub: "McpHub", targetResourceType: "mcp", originalPath: path.join(projectRoot, ".codex", "config.toml") });
    expect(opencode.backup).toMatchObject({ hub: "McpHub", targetResourceType: "mcp", originalPath: path.join(projectRoot, "opencode.json") });
    expect(fs.existsSync(claude.backup!.backupPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8"))).toMatchObject({
      keep: true,
      mcpServers: {
        localOnly: { command: "node" },
        docs: { command: "node", args: [path.join(projectRoot, "server.js")], env: { DOCS_TOKEN: "${DOCS_TOKEN}" } }
      }
    });
    expect(fs.readFileSync(path.join(projectRoot, ".codex", "config.toml"), "utf8")).toContain('model = "gpt-5"');
    expect(fs.readFileSync(path.join(projectRoot, ".codex", "config.toml"), "utf8")).toContain("[mcp_servers.docs]");
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.json"), "utf8"))).toMatchObject({
      $schema: "https://opencode.ai/config.json",
      mcp: { docs: { type: "local", command: ["node", `${projectRoot}\\server.js`], environment: { DOCS_TOKEN: "${DOCS_TOKEN}" } } }
    });
    expect(db.listProjectMcpBindings(project.id, project.rootPath)).toHaveLength(3);
    expect(db.listProjectMcpBindings(project.id, project.rootPath).every((binding) => binding.appliedFingerprint.length > 0)).toBe(true);

    const disabled = disableProjectMcpServer(db, project, "codex", "docs");
    expect(disabled).toMatchObject({ removedBinding: true, modified: true, backup: expect.objectContaining({ originalPath: path.join(projectRoot, ".codex", "config.toml") }) });
    expect(fs.readFileSync(disabled.backup!.backupPath, "utf8")).toContain("[mcp_servers.docs]");
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
    db.replaceProjectToolTargets(project.id, ["qwen", "codebuddy", "cursor", "antigravity", "trae", "kimi", "zcode", "workbuddy"]);
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

    applyProjectMcpServer(db, project, "qwen", server.serverId);
    applyProjectMcpServer(db, project, "codebuddy", server.serverId);
    applyProjectMcpServer(db, project, "cursor", server.serverId);
    applyProjectMcpServer(db, project, "antigravity", server.serverId);
    applyProjectMcpServer(db, project, "trae", server.serverId);
    applyProjectMcpServer(db, project, "kimi", server.serverId);
    applyProjectMcpServer(db, project, "zcode", server.serverId);
    applyProjectMcpServer(db, project, "workbuddy", server.serverId);

    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".qwen", "settings.json"), "utf8"))).toMatchObject({
      mcpServers: {
        docs: { command: "node", args: [path.join(projectRoot, "server.js")], env: { DOCS_TOKEN: "${DOCS_TOKEN}" } }
      }
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8"))).toMatchObject({
      mcpServers: {
        docs: { type: "stdio", command: "node", args: [path.join(projectRoot, "server.js")], env: { DOCS_TOKEN: "${DOCS_TOKEN}" } }
      }
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".cursor", "mcp.json"), "utf8"))).toMatchObject({
      mcpServers: {
        docs: { type: "stdio", command: "node", args: [path.join(projectRoot, "server.js")], env: { DOCS_TOKEN: "${DOCS_TOKEN}" } }
      }
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".agents", "mcp_config.json"), "utf8"))).toMatchObject({
      mcpServers: {
        docs: { command: "node", args: [path.join(projectRoot, "server.js")], env: { DOCS_TOKEN: "${DOCS_TOKEN}" } }
      }
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".trae", "mcp.json"), "utf8"))).toMatchObject({
      mcpServers: {
        docs: { command: "node", args: [path.join(projectRoot, "server.js")], env: { DOCS_TOKEN: "${DOCS_TOKEN}" } }
      }
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".kimi-code", "mcp.json"), "utf8"))).toMatchObject({
      mcpServers: {
        docs: { command: "node", args: [path.join(projectRoot, "server.js")], env: { DOCS_TOKEN: "${DOCS_TOKEN}" } }
      }
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".zcode", "config.json"), "utf8"))).toMatchObject({
      mcp: {
        servers: {
          docs: { command: "node", args: [path.join(projectRoot, "server.js")], env: { DOCS_TOKEN: "${DOCS_TOKEN}" } }
        }
      }
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".workbuddy", "mcp.json"), "utf8"))).toMatchObject({
      mcpServers: {
        docs: { command: "node", args: [path.join(projectRoot, "server.js")], env: { DOCS_TOKEN: "${DOCS_TOKEN}" } }
      }
    });

    db.close();
  });

  it("does not write Trae Solo MCP config without an official project config path", () => {
    directory = testDir("mcphub-trae-solo-unsupported");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(path.join(projectRoot, ".trae"), { recursive: true });
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["trae-solo"]);
    const server = db.upsertMcpHubServer({
      serverId: "docs",
      name: "docs",
      description: "Docs server",
      transport: "stdio",
      command: "node",
      args: ["${PROJECT_ROOT}\\server.js"],
      url: null,
      headers: {},
      env: {},
      requiredEnv: []
    });

    const state = listProjectMcpState(db, project);
    expect(state.targets).toContainEqual(
      expect.objectContaining({ toolId: "trae-solo", supported: false, reason: expect.stringContaining("未提供项目级 MCP 配置文件路径") })
    );
    expect(() => applyProjectMcpServer(db, project, "trae-solo", server.serverId)).toThrow("未提供项目级 MCP 配置文件路径");
    expect(fs.existsSync(path.join(projectRoot, ".trae", "mcp.json"))).toBe(false);
    db.close();
  });

  it("renders HTTP MCP entries for Claude, Codex, CodeBuddy, Qwen, TRAE CLI, Kimi, ZCode, and WorkBuddy", () => {
    directory = testDir("mcphub-apply-http-types");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["claude", "codex", "qwen", "codebuddy", "trae", "kimi", "zcode", "workbuddy"]);
    const server = db.upsertMcpHubServer({
      serverId: "skillhub",
      name: "skillhub",
      description: "SkillHub MCP",
      transport: "http",
      command: null,
      args: [],
      url: "http://127.0.0.1:3987/mcp",
      headers: { Authorization: "Bearer local" },
      env: {},
      requiredEnv: []
    });

    try {
      applyProjectMcpServer(db, project, "claude", server.serverId);
      applyProjectMcpServer(db, project, "codex", server.serverId);
      applyProjectMcpServer(db, project, "qwen", server.serverId);
      applyProjectMcpServer(db, project, "codebuddy", server.serverId);
      applyProjectMcpServer(db, project, "trae", server.serverId);
      applyProjectMcpServer(db, project, "kimi", server.serverId);
      applyProjectMcpServer(db, project, "zcode", server.serverId);
      applyProjectMcpServer(db, project, "workbuddy", server.serverId);

      expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8"))).toMatchObject({
        mcpServers: {
          skillhub: {
            type: "http",
            url: "http://127.0.0.1:3987/mcp",
            headers: { Authorization: "Bearer local" }
          }
        }
      });
      const codexConfig = fs.readFileSync(path.join(projectRoot, ".codex", "config.toml"), "utf8");
      expect(codexConfig).toContain("[mcp_servers.skillhub]");
      expect(codexConfig).toContain('type = "http"');
      expect(codexConfig).toContain('url = "http://127.0.0.1:3987/mcp"');
      expect(codexConfig).toContain('headers = { Authorization = "Bearer local" }');
      const qwenConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, ".qwen", "settings.json"), "utf8"));
      expect(qwenConfig.mcpServers.skillhub).toMatchObject({ httpUrl: "http://127.0.0.1:3987/mcp", headers: { Authorization: "Bearer local" } });
      expect(qwenConfig.mcpServers.skillhub.type).toBeUndefined();
      expect(qwenConfig.mcpServers.skillhub.url).toBeUndefined();
      const codebuddyConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8"));
      expect(codebuddyConfig.mcpServers.skillhub).toMatchObject({ type: "http", url: "http://127.0.0.1:3987/mcp", headers: { Authorization: "Bearer local" } });
      const traeConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, ".trae", "mcp.json"), "utf8"));
      expect(traeConfig.mcpServers.skillhub).toMatchObject({ type: "http", url: "http://127.0.0.1:3987/mcp", headers: { Authorization: "Bearer local" } });
      const kimiConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, ".kimi-code", "mcp.json"), "utf8"));
      expect(kimiConfig.mcpServers.skillhub).toMatchObject({ url: "http://127.0.0.1:3987/mcp", headers: { Authorization: "Bearer local" } });
      expect(kimiConfig.mcpServers.skillhub.type).toBeUndefined();
      expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".zcode", "config.json"), "utf8"))).toMatchObject({
        mcp: {
          servers: {
            skillhub: {
              type: "http",
              url: "http://127.0.0.1:3987/mcp",
              headers: { Authorization: "Bearer local" }
            }
          }
        }
      });
      const workbuddyConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, ".workbuddy", "mcp.json"), "utf8"));
      expect(workbuddyConfig.mcpServers.skillhub).toMatchObject({ url: "http://127.0.0.1:3987/mcp", headers: { Authorization: "Bearer local" } });
      expect(workbuddyConfig.mcpServers.skillhub.type).toBeUndefined();

    } finally {
      db.close();
    }
  });

  it("claims semantically equivalent unmanaged Claude MCP entries", () => {
    directory = testDir("mcphub-apply-equivalent-local");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { unityMCP: { url: "http://127.0.0.1:8082/mcp" } } }, null, 2),
      "utf8"
    );
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["claude"]);
    listMcpHub(db);

    const applied = applyProjectMcpServer(db, project, "claude", "unityMCP");

    expect(applied).toMatchObject({ toolId: "claude", server: { serverId: "unityMCP" } });
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8")).mcpServers.unityMCP).toMatchObject({
      type: "http",
      url: "http://127.0.0.1:8082/mcp"
    });
    expect(db.getProjectMcpBinding(project.id, project.rootPath, "claude", "unityMCP")).not.toBeNull();
    db.close();
  });

  it("reports read-only MCP config files as writeback conflicts", () => {
    directory = testDir("mcphub-readonly-config");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const configPath = path.join(projectRoot, ".mcp.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { PapeEngineLauncer: { type: "http", url: "http://127.0.0.1:18765/mcp" } } }, null, 2),
      "utf8"
    );
    fs.chmodSync(configPath, 0o444);
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["claude"]);
    listMcpHub(db);

    try {
      expect(() => applyProjectMcpServer(db, project, "claude", "unityMCP")).toThrow("目标 MCP 配置文件不可写");
      expect(JSON.parse(fs.readFileSync(configPath, "utf8")).mcpServers).toEqual({
        PapeEngineLauncer: { type: "http", url: "http://127.0.0.1:18765/mcp" }
      });
      expect(db.getProjectMcpBinding(project.id, project.rootPath, "claude", "unityMCP")).toBeNull();
    } finally {
      fs.chmodSync(configPath, 0o666);
      db.close();
    }
  });

  it("keeps failed MCP cleanup bindings owned when deleting a center server", () => {
    directory = testDir("mcphub-delete-partial-failure");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".mcp.json"), JSON.stringify({ mcpServers: {} }, null, 2), "utf8");
    fs.writeFileSync(path.join(projectRoot, ".codex", "config.toml"), "", "utf8");
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["claude", "codex", "qwen"]);
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
    expect(deleted.backups).toEqual([expect.objectContaining({ hub: "McpHub", targetResourceType: "mcp", originalPath: path.join(projectRoot, ".codex", "config.toml") })]);
    expect(fs.existsSync(deleted.backups[0]!.backupPath)).toBe(true);
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
    db.replaceProjectToolTargets(project.id, ["claude", "codex", "qwen"]);
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
    expect(state.targets.map((target) => ({ toolId: target.toolId, enabled: target.enabled, supported: target.supported, reason: target.reason }))).toEqual([
      { toolId: "claude", enabled: true, supported: true, reason: null },
      { toolId: "codex", enabled: true, supported: true, reason: null },
      { toolId: "qwen", enabled: true, supported: true, reason: null }
    ]);

    expect(() => applyProjectMcpServer(db, project, "opencode", server.serverId)).toThrow("该工具未在项目中启用");
    expect(applyProjectMcpServer(db, project, "claude", server.serverId)).toMatchObject({ toolId: "claude" });
    expect(applyProjectMcpServer(db, project, "qwen", server.serverId)).toMatchObject({ toolId: "qwen", configPath: path.join(projectRoot, ".qwen", "settings.json") });
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
    db.replaceProjectToolTargets(project.id, ["claude", "codex", "opencode", "codebuddy"]);
    const beforeFiles = [
      fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8"),
      fs.readFileSync(path.join(projectRoot, ".codex", "config.toml"), "utf8"),
      fs.readFileSync(path.join(projectRoot, "opencode.json"), "utf8")
    ];

    const before = listProjectMcpState(db, project);
    expect(before.localEntries).toHaveLength(4);
    expect(before.localEntries.every((entry) => entry.status === "unmanaged")).toBe(true);

    const migrated = migrateProjectLocalMcp(db, project, "shared");
    const after = listProjectMcpState(db, project);

    expect(migrated).toMatchObject({ action: "migrated", requiresConfirmation: false, server: { serverId: "shared" } });
    expect(migrated.bindings.map((binding) => binding.toolId).sort()).toEqual(["claude", "codebuddy", "codex", "opencode"]);
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

    expect(disabled).toMatchObject({ removedBinding: false, modified: false, backup: null });
    expect(deleted.modifiedFiles).toEqual([]);
    expect(deleted.backups).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8")).mcpServers.docs).toMatchObject({ command: "node" });
    db.close();
  });

  it("refuses to overwrite unmanaged same-id MCP entries", () => {
    directory = testDir("mcphub-unmanaged-apply-preserve");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".mcp.json"), JSON.stringify({ mcpServers: { docs: { command: "local-node" } } }, null, 2), "utf8");
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["claude"]);
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

    expect(() => applyProjectMcpServer(db, project, "claude", "docs")).toThrow("同名 MCP entry 已存在且不属于 McpHub");
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8")).mcpServers.docs).toMatchObject({ command: "local-node" });
    expect(db.getProjectMcpBinding(project.id, project.rootPath, "claude", "docs")).toBeNull();
    db.close();
  });

  it("preserves drifted managed MCP entries when disabling or deleting", () => {
    directory = testDir("mcphub-drift-preserve");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["claude"]);
    db.upsertMcpHubServer({
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

    applyProjectMcpServer(db, project, "claude", "docs");
    fs.writeFileSync(path.join(projectRoot, ".mcp.json"), JSON.stringify({ mcpServers: { docs: { command: "edited-node" } } }, null, 2), "utf8");

    expect(() => disableProjectMcpServer(db, project, "claude", "docs")).toThrow("目标 MCP entry 已被本地修改");
    const deleted = deleteMcpHubServer(db, "docs");

    expect(deleted.deleted).toBe(false);
    expect(deleted.failures).toEqual([expect.objectContaining({ reason: "目标 MCP entry 已被本地修改，未覆盖或删除" })]);
    expect(db.getMcpHubServer("docs")).not.toBeNull();
    expect(db.getProjectMcpBinding(project.id, project.rootPath, "claude", "docs")).not.toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8")).mcpServers.docs).toMatchObject({ command: "edited-node" });
    db.close();
  });
});
