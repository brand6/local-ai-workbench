import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { defaultAppConfig } from "../src/server/core/bootstrap.js";
import {
  createCustomPlugin,
  deletePluginHubPlugin,
  deletePluginHubSource,
  importPluginHubGitHubSource,
  importPluginHubLocalSource,
  installProjectPlugin,
  listPluginHub,
  listProjectPluginState,
  previewDeletePluginHubSource,
  syncProjectPluginBinding,
  uninstallProjectPluginBinding,
  updatePluginHubGitHubSource,
  updateCustomPlugin
} from "../src/server/pluginhub/pluginhub.js";
import { deleteSkillHubSkill, importLocalSkills, previewDeleteSkillHubSkill } from "../src/server/skillhub/skillhub.js";
import { createHookHubSuite, deleteHookHubSuite } from "../src/server/hookhub/hookhub.js";
import { setProjectSkillTargets, updateProjectToolTargets } from "../src/server/skillhub/projectSkills.js";
import { AppDatabase } from "../src/server/storage/database.js";
import type { AppConfig } from "../src/shared/types.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;

afterEach(() => {
  if (directory) cleanup(directory);
  directory = null;
});

describe("PluginHub", () => {
  it("seeds built-in plugin sources as deletable sources on first catalog access", () => {
    directory = testDir("pluginhub-builtin-superpowers");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    db.setSetting("pluginhub.default-sources.seeded.v1", true);

    const listed = listPluginHub(db, config, directory);
    const source = listed.sources.find((item) => item.id === "pluginhub-source-superpowers");
    const plugin = listed.plugins.find((item) => item.sourceId === source?.id && item.name === "superpowers");
    const cavemanSource = listed.sources.find((item) => item.id === "pluginhub-source-caveman");
    const cavemanPlugin = listed.plugins.find((item) => item.sourceId === cavemanSource?.id && item.name === "caveman");
    const cavemanRefs = cavemanPlugin?.componentRefs ?? [];

    expect(source).toMatchObject({
      id: "pluginhub-source-superpowers",
      kind: "single-plugin",
      label: "obra/superpowers",
      inputPath: "builtin-plugins/superpowers",
      pluginCount: 1
    });
    expect(source?.componentCount).toBeGreaterThan(0);
    expect(source?.privateFileCount).toBeGreaterThan(10);
    expect(source?.privateFileCount).toBeLessThan(25);
    expect(plugin).toMatchObject({ displayName: "Superpowers", sourceId: "pluginhub-source-superpowers" });
    expect(plugin?.componentRefs.length).toBeGreaterThan(0);
    const superpowersPrivatePaths = plugin?.privateFiles.map((file) => file.sourceRelativePath) ?? [];
    expect(superpowersPrivatePaths).toEqual(
      expect.arrayContaining([
        "superpowers/.claude-plugin/plugin.json",
        "superpowers/.cursor-plugin/plugin.json",
        "superpowers/.opencode/plugins/superpowers.js",
        "superpowers/hooks/hooks.json",
        "superpowers/package.json"
      ])
    );
    expect(superpowersPrivatePaths.some((item) => item.startsWith("superpowers/tests/"))).toBe(false);
    expect(superpowersPrivatePaths.some((item) => item.startsWith("superpowers/.github/"))).toBe(false);
    expect(superpowersPrivatePaths.some((item) => item.startsWith("superpowers/docs/"))).toBe(false);
    expect(listed.skills.some((skill) => skill.folderName === "using-superpowers")).toBe(true);
    expect(cavemanSource).toMatchObject({
      id: "pluginhub-source-caveman",
      kind: "single-plugin",
      label: "JuliusBrussee/caveman",
      inputPath: "builtin-plugins/caveman",
      pluginCount: 1
    });
    expect(cavemanSource?.componentCount).toBe(10);
    expect(cavemanPlugin).toMatchObject({ displayName: "Caveman", sourceId: "pluginhub-source-caveman" });
    expect(cavemanRefs.filter((ref) => ref.type === "skill")).toHaveLength(7);
    expect(cavemanRefs.filter((ref) => ref.type === "agent")).toHaveLength(3);
    expect(cavemanPlugin?.privateFiles.map((file) => file.sourceRelativePath)).toEqual(
      expect.arrayContaining([
        "caveman/.claude-plugin/plugin.json",
        "caveman/commands/caveman.toml",
        "caveman/commands/caveman-init.toml",
        "caveman/src/hooks/caveman-mode-tracker.js",
        "caveman/src/hooks/caveman-statusline.ps1",
        "caveman/src/mcp-servers/caveman-shrink/index.js",
        "caveman/src/tools/caveman-init.js"
      ])
    );
    expect(listed.skills.some((skill) => skill.folderName === "caveman" && skill.sourceId === "pluginhub-source-caveman")).toBe(true);
    expect(listed.skills.some((skill) => skill.folderName === "caveman-compress" && skill.sourceId === "pluginhub-source-caveman")).toBe(true);
    expect(listed.skills.some((skill) => skill.folderName === "caveman-review" && skill.sourceId === "pluginhub-source-caveman")).toBe(true);
    expect(listed.agents.some((agent) => agent.slug === "cavecrew-builder" && agent.sourceId === "pluginhub-source-caveman")).toBe(true);

    deletePluginHubSource(db, source?.id ?? "", "remove-custom-components");
    const afterDelete = listPluginHub(db, config, directory);

    expect(afterDelete.sources.some((item) => item.id === "pluginhub-source-superpowers")).toBe(false);
    expect(afterDelete.plugins.some((item) => item.name === "superpowers")).toBe(false);
    db.close();
  });

  it("lists an empty catalog and distinguishes source plugins from custom plugins", () => {
    directory = testDir("pluginhub-empty");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const skillSource = seedSkillHubSkill(db, config, "team-source", "review", "Review skill");

    const custom = createCustomPlugin(db, directory, {
      name: "team-pack",
      componentRefs: [{ type: "skill", componentId: skillSource.id, required: true }],
      privateFiles: [{ sourceRelativePath: "README.md", content: "private notes" }]
    });
    const listed = listPluginHub(db);

    expect(listed.sources).toEqual([]);
    expect(listed.sourcePlugins).toEqual([]);
    expect(listed.customPlugins).toMatchObject([{ id: custom.id, kind: "custom", sourceId: null, name: "team-pack" }]);
    expect(custom.privateFiles[0]).toMatchObject({ targetRelativePath: ".agents/plugins/team-pack/README.md", required: true });
    db.close();
  });

  it("lists custom plugin component candidates from every component hub", () => {
    directory = testDir("pluginhub-component-candidates");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const skill = seedSkillHubSkill(db, config, "team-source", "review", "Review skill");
    const agentSource = db.upsertAgentHubSource({
      id: "team-agents",
      type: "local-import",
      label: "Team Agents",
      inputPath: null,
      resolvedPath: path.join(directory, "agents"),
      sourceTruthTool: "claude",
      importedAt: "2026-06-01T00:00:00Z",
      metadata: {}
    });
    const agent = db.upsertAgentHubAgent({
      id: "agent-1",
      sourceId: agentSource.id,
      sourceType: agentSource.type,
      sourceTruthTool: "claude",
      truthRole: "subagent",
      sourceFormat: "markdown",
      slug: "code-reviewer",
      name: "Code Reviewer",
      description: "Review changes",
      nativePath: path.join(directory, "agents", "code-reviewer.md"),
      libraryRelativePath: "team-agents/code-reviewer.md",
      sourceRelativePath: "code-reviewer.md",
      category: "engineering",
      projection: { name: "Code Reviewer", description: "Review changes", body: "Review changes.", slugCandidate: "code-reviewer", parseWarnings: [] },
      nativeMetadata: {},
      contentHash: "agent-hash"
    });
    const mcp = db.upsertMcpHubServer({
      serverId: "docs",
      name: "docs",
      description: "Docs MCP",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      url: null,
      headers: {},
      env: {},
      requiredEnv: []
    });
    const hook = db.upsertHookHubSuite({
      suiteId: "suite-1",
      name: "提交前检查",
      description: "Run checks",
      riskNotes: null,
      requiredEnv: [],
      payloads: { claude: { PreToolUse: [] } }
    });

    const listed = listPluginHub(db);

    expect(listed.skills).toContainEqual(expect.objectContaining({ id: skill.id }));
    expect(listed.agents).toContainEqual(expect.objectContaining({ id: agent.id }));
    expect(listed.mcpServers).toContainEqual(expect.objectContaining({ serverId: mcp.serverId }));
    expect(listed.hookSuites).toContainEqual(expect.objectContaining({ suiteId: hook.suiteId }));
    db.close();
  });

  it("imports plugin libraries and single plugin packages with source-level SkillHub identities", () => {
    directory = testDir("pluginhub-import");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const library = path.join(directory, "wshobson-agents");
    writePlugin(path.join(library, "plugins", "python-development"), "python-development", [["review", "Python review"]], {
      "commands/test.md": "run pytest",
      ".claude-plugin/plugin.json": JSON.stringify({ name: "python-development" }),
      ".cursor-plugin/plugin.json": JSON.stringify({ name: "python-development" }),
      ".opencode/plugins/python-development.js": "export default {};",
      "GEMINI.md": "Gemini instructions",
      "hooks/hooks.json": JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: "command", command: '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start' }]
            }
          ]
        }
      }),
      "hooks/run-hook.cmd": "echo hook"
    });
    writePlugin(path.join(library, "plugins", "frontend"), "frontend", [["lint", "Frontend lint"]]);

    const imported = importPluginHubLocalSource(db, config, directory, library);

    expect(imported.source).toMatchObject({ kind: "library", label: "wshobson-agents", pluginCount: 2 });
    expect(imported.source.resolvedPath.toLowerCase()).toBe(path.join(directory, "pluginhub", "sources", imported.source.id, "snapshot").toLowerCase());
    expect(imported.source.resolvedPath.toLowerCase()).not.toBe(library.toLowerCase());
    expect(imported.plugins.map((plugin) => plugin.name)).toEqual(["frontend", "python-development"]);
    expect(imported.importedSkills.map((skill) => skill.sourceId)).toEqual([imported.source.id, imported.source.id]);
    expect(imported.importedSkills.map((skill) => skill.sourceType)).toEqual(["plugin", "plugin"]);
    expect(imported.importedSkills.map((skill) => skill.libraryRelativePath)).toEqual([
      `pluginhub/${imported.source.id}/plugins/frontend/skills/lint`,
      `pluginhub/${imported.source.id}/plugins/python-development/skills/review`
    ]);
    expect(db.getSkillHubSource(imported.source.id)).toMatchObject({ type: "plugin", label: "wshobson-agents" });
    expect(() => previewDeleteSkillHubSkill(db, imported.importedSkills[0].id)).toThrow("Plugin 技能不能在 SkillHub 删除");
    expect(() => deleteSkillHubSkill(db, imported.importedSkills[0].id)).toThrow("Plugin 技能不能在 SkillHub 删除");
    const pythonPlugin = imported.plugins.find((plugin) => plugin.name === "python-development");
    const commandFile = pythonPlugin?.privateFiles.find((file) => file.sourceRelativePath.endsWith("commands/test.md"));
    expect(pythonPlugin?.privateFiles.map((file) => file.sourceRelativePath)).toEqual(
      expect.arrayContaining(["plugins/python-development/.codex-plugin/plugin.json", "plugins/python-development/commands/test.md"])
    );
    expect(commandFile?.role).toBe("native-command");
    expect(commandFile?.contentPath.toLowerCase()).toBe(path.join(imported.source.resolvedPath, "plugins", "python-development", "commands", "test.md").toLowerCase());
    expect(pythonPlugin?.privateFiles.find((file) => file.sourceRelativePath.endsWith(".claude-plugin/plugin.json"))?.role).toBe("native-manifest");
    expect(pythonPlugin?.privateFiles.find((file) => file.sourceRelativePath.endsWith("hooks/hooks.json"))?.role).toBe("native-hook");
    expect(pythonPlugin?.harnessSupport).toMatchObject({ codex: "native", claude: "native", cursor: "planned", opencode: "planned" });
    expect(pythonPlugin?.harnessSupport.qwen ?? "unsupported").toBe("component-only");
    writeBomSkill(path.join(library, "plugins", "python-development", "skills", "compose-editor-tool"), "compose-editor-tool", "编写 Unity 编辑器工具");
    writeBareMetadataSkill(path.join(library, "plugins", "python-development", "skills", "compose-imgui"), "compose-imgui", "编写 IMGUI 编辑器界面");
    const bareMetadataImport = importPluginHubLocalSource(db, config, directory, library);
    expect(bareMetadataImport.importedSkills.find((skill) => skill.folderName === "compose-editor-tool")).toMatchObject({
      skillName: "compose-editor-tool",
      description: "编写 Unity 编辑器工具"
    });
    expect(bareMetadataImport.importedSkills.find((skill) => skill.folderName === "compose-imgui")).toMatchObject({
      skillName: "compose-imgui",
      description: "编写 IMGUI 编辑器界面"
    });
    fs.writeFileSync(path.join(library, "plugins", "python-development", "commands", "test.md"), "changed outside Center Library", "utf8");
    expect(fs.readFileSync(commandFile?.contentPath ?? "", "utf8")).toBe("run pytest");
    expect(db.listSkillHubSkills().map((skill) => skill.folderName)).toEqual(expect.arrayContaining(["compose-editor-tool", "compose-imgui", "lint", "review"]));
    const duplicateImport = importPluginHubLocalSource(db, config, directory, library);
    expect(duplicateImport.source.id).toBe(imported.source.id);
    expect(duplicateImport.plugins.map((plugin) => plugin.id)).toEqual(imported.plugins.map((plugin) => plugin.id));

    const single = path.join(directory, "single-plugin");
    writePlugin(single, "solo", [["solo-skill", "Solo skill"]]);
    const singleImport = importPluginHubLocalSource(db, config, directory, single);

    expect(singleImport.source).toMatchObject({ kind: "single-plugin", pluginCount: 1 });
    expect(singleImport.plugins).toMatchObject([{ name: "solo", sourceId: singleImport.source.id }]);
    const invalid = path.join(directory, "invalid-plugin-source");
    fs.mkdirSync(invalid, { recursive: true });
    expect(() => importPluginHubLocalSource(db, config, directory, invalid)).toThrow("未找到可导入的 plugin");
    db.close();
  });

  it("preserves manifestless single-plugin source roots for agent knowledge references", () => {
    directory = testDir("pluginhub-manifestless-config-package");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const sourceRoot = path.join(directory, "AICodingConfig");
    writeSkill(path.join(sourceRoot, "skills", "module-knowledge"), "module-knowledge", "Route domain knowledge");
    fs.mkdirSync(path.join(sourceRoot, "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "agents", "project-dev-implement-ui.agent.md"),
      [
        "---",
        "name: Project Dev Implement UI",
        "description: Implement UI features",
        "skills: [module-knowledge]",
        "---",
        "",
        "Read `AICodingConfig/knowledges/index.md` before implementation.",
        "Also load `AICodingConfig/skills/module-knowledge/SKILL.md`."
      ].join("\n"),
      "utf8"
    );
    fs.mkdirSync(path.join(sourceRoot, "agents", "openspec"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "agents", "openspec", "config.yaml"), "schemas:\n  x3-dev: schemas/x3-dev/schema.yaml\n", "utf8");
    fs.mkdirSync(path.join(sourceRoot, "knowledges"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "knowledges", "index.md"), "# Knowledge index\n", "utf8");
    const imported = importPluginHubLocalSource(db, config, directory, sourceRoot);

    expect(imported.source).toMatchObject({ kind: "single-plugin", label: "AICodingConfig", pluginCount: 1 });
    expect(imported.plugins[0]).toMatchObject({ name: "AICodingConfig", sourceId: imported.source.id });
    expect(imported.plugins[0].privateFiles.map((file) => file.targetRelativePath)).toEqual(
      expect.arrayContaining([
        ".agents/plugins/AICodingConfig/AICodingConfig/knowledges/index.md"
      ])
    );
    expect(imported.plugins[0].privateFiles.map((file) => file.targetRelativePath)).not.toContain(
      ".agents/plugins/AICodingConfig/AICodingConfig/skills/module-knowledge/SKILL.md"
    );
    expect(imported.plugins[0].privateFiles.map((file) => file.targetRelativePath)).not.toContain(
      ".agents/plugins/AICodingConfig/AICodingConfig/agents/project-dev-implement-ui.agent.md"
    );
    expect(imported.plugins[0].privateFiles.map((file) => file.targetRelativePath)).toContain(".agents/plugins/AICodingConfig/AICodingConfig/agents/openspec/config.yaml");

    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["claude"]);
    const installed = installProjectPlugin(db, project, imported.plugins[0].id, "claude");
    const packageRoot = path.join(projectRoot, ".pluginhub", "claude-marketplace", "plugins", "AICodingConfig");

    expect(installed).toMatchObject({ requiresConfirmation: false, binding: expect.any(Object) });
    expect(fs.existsSync(path.join(packageRoot, "AICodingConfig", "knowledges", "index.md"))).toBe(true);
    expect(fs.existsSync(path.join(packageRoot, "AICodingConfig", "skills", "module-knowledge", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(packageRoot, "AICodingConfig", "agents", "openspec", "config.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(packageRoot, "AICodingConfig", "agents", "project-dev-implement-ui.agent.md"))).toBe(true);
    expect(fs.readFileSync(path.join(packageRoot, "agents", "project-dev-implement-ui.agent.md"), "utf8")).toContain("AICodingConfig/knowledges/index.md");
    db.close();
  });

  it("imports source plugin agents and structured MCP configs as PluginHub component refs", () => {
    directory = testDir("pluginhub-import-agents-mcp");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const library = path.join(directory, "library");
    const pluginRoot = path.join(library, "plugins", "review-pack");
    writePlugin(pluginRoot, "review-pack", [["review", "Review skill"]], {
      "agents/reviewer.md": "---\nname: Reviewer\ndescription: Review code\n---\n\nReview code changes.\n",
      ".mcp.json": JSON.stringify({ mcpServers: { docs: { command: "node", args: ["server.js"] } } }, null, 2)
    });

    const imported = importPluginHubLocalSource(db, config, directory, library);
    const plugin = imported.plugins[0];
    const listed = listPluginHub(db);

    expect(plugin.componentRefs.map((ref) => ref.type).sort()).toEqual(["agent", "mcp", "skill"]);
    expect(listed.agents).toEqual([expect.objectContaining({ sourceId: imported.source.id, slug: "reviewer", name: "Reviewer" })]);
    expect(listed.mcpServers).toEqual(expect.arrayContaining([expect.objectContaining({ serverId: "docs", command: "node" })]));
    db.close();
  });

  it("imports marketplace plugin sources that point at nested plugin directories", () => {
    directory = testDir("pluginhub-marketplace-nested-sources");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const repo = path.join(directory, "financial-services");
    writeMarketplace(repo, {
      name: "claude-for-financial-services",
      plugins: [
        {
          name: "financial-analysis",
          displayName: "Financial Analysis",
          source: "./plugins/vertical-plugins/financial-analysis",
          description: "Core financial modeling"
        },
        {
          name: "pitch-agent",
          displayName: "Pitch Agent",
          source: "./plugins/agent-plugins/pitch-agent",
          description: "Comps to branded pitch deck"
        }
      ]
    });
    writePlugin(path.join(repo, "plugins", "vertical-plugins", "financial-analysis"), "financial-analysis", [["dcf", "DCF valuation"]], {
      "commands/dcf.md": "Build DCF"
    });
    writePlugin(path.join(repo, "plugins", "agent-plugins", "pitch-agent"), "pitch-agent", [["pitch-deck", "Pitch deck"]], {
      "agents/pitch-agent.md": "---\nname: Pitch Agent\ndescription: Build pitch deck\n---\n\nBuild a pitch deck.\n"
    });

    const imported = importPluginHubLocalSource(db, config, directory, repo);
    const listed = listPluginHub(db);

    expect(imported.source).toMatchObject({ kind: "library", label: "financial-services", pluginCount: 2 });
    expect(imported.plugins.map((plugin) => plugin.name)).toEqual(["financial-analysis", "pitch-agent"]);
    expect(imported.plugins[0]).toMatchObject({ displayName: "Financial Analysis", description: "financial-analysis plugin" });
    expect(imported.importedSkills.map((skill) => skill.sourceRelativePath)).toEqual([
      "plugins/vertical-plugins/financial-analysis/skills/dcf",
      "plugins/agent-plugins/pitch-agent/skills/pitch-deck"
    ]);
    expect(listed.agents).toEqual([expect.objectContaining({ sourceId: imported.source.id, slug: "pitch-agent", name: "Pitch Agent" })]);
    db.close();
  });

  (gitAvailable() ? it : it.skip)(
    "imports and updates GitHub plugin sources from a local git fixture",
    () => {
      directory = testDir("pluginhub-github-update");
      const db = new AppDatabase(directory);
      const config = configFixture(directory);
      const repo = path.join(directory, "remote-repo");
      gitInit(repo);
      writePlugin(path.join(repo, "plugins", "python-development"), "python-development", [["review", "Initial GitHub review"]], {
        "commands/test.md": "run pytest"
      });
      git(repo, ["add", "."]);
      git(repo, ["commit", "-m", "initial"]);

      const imported = importPluginHubGitHubSource(db, config, directory, "owner/repo", { fixturePath: repo });
      const privateFile = imported.plugins[0]?.privateFiles.find((file) => file.sourceRelativePath.endsWith("commands/test.md"));
      expect(imported.source).toMatchObject({ type: "github", label: "owner/repo", repoKey: "owner-repo", pluginCount: 1 });
      expect(imported.plugins[0]).toMatchObject({ name: "python-development", sourceId: imported.source.id });
      expect(imported.importedSkills[0]).toMatchObject({ description: "Initial GitHub review", sourceId: imported.source.id });
      expect(privateFile).toBeTruthy();

      fs.writeFileSync(
        path.join(repo, "plugins", "python-development", "skills", "review", "SKILL.md"),
        skillText("review", "Changed GitHub review"),
        "utf8"
      );
      fs.writeFileSync(path.join(repo, "plugins", "python-development", "commands", "test.md"), "run vitest", "utf8");
      git(repo, ["add", "."]);
      git(repo, ["commit", "-m", "change plugin"]);

      const updated = updatePluginHubGitHubSource(db, config, directory, imported.source.id);
      const updatedPrivateFile = updated.plugins[0]?.privateFiles.find((file) => file.sourceRelativePath.endsWith("commands/test.md"));

      expect(updated.source.currentRevision).not.toBe(imported.source.currentRevision);
      expect(db.getSkillHubSkill(imported.importedSkills[0]?.id ?? "")?.description).toBe("Changed GitHub review");
      expect(updatedPrivateFile?.contentHash).not.toBe(privateFile?.contentHash);
      db.close();
    },
    15000
  );

  (gitAvailable() ? it : it.skip)(
    "prunes stale plugins and skills when a GitHub plugin source removes them",
    () => {
      directory = testDir("pluginhub-github-prune");
      const db = new AppDatabase(directory);
      const config = configFixture(directory);
      const repo = path.join(directory, "remote-repo");
      gitInit(repo);
      writePlugin(path.join(repo, "plugins", "python-development"), "python-development", [["review", "Python review"]]);
      writePlugin(path.join(repo, "plugins", "legacy-plugin"), "legacy-plugin", [["legacy-review", "Legacy review"]]);
      git(repo, ["add", "."]);
      git(repo, ["commit", "-m", "initial"]);

      const imported = importPluginHubGitHubSource(db, config, directory, "owner/repo", { fixturePath: repo });
      const stalePlugin = imported.plugins.find((plugin) => plugin.name === "legacy-plugin");
      const staleSkill = imported.importedSkills.find((skill) => skill.sourceRelativePath.startsWith("plugins/legacy-plugin/"));
      expect(stalePlugin).toBeTruthy();
      expect(staleSkill).toBeTruthy();

      fs.rmSync(path.join(repo, "plugins", "legacy-plugin"), { recursive: true, force: true });
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-m", "remove legacy plugin"]);

      const updated = updatePluginHubGitHubSource(db, config, directory, imported.source.id);

      expect(updated.plugins.map((plugin) => plugin.name)).toEqual(["python-development"]);
      expect(updated.skipped).toEqual([]);
      expect(db.getPluginHubPlugin(stalePlugin?.id ?? "")).toBeNull();
      expect(db.getSkillHubSkill(staleSkill?.id ?? "")).toBeNull();
      expect(db.listPluginHubPluginsForSource(imported.source.id).map((plugin) => plugin.name)).toEqual(["python-development"]);
      db.close();
    },
    15000
  );

  it("installs a Codex project plugin as a native repo marketplace package", () => {
    directory = testDir("pluginhub-install");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const library = path.join(directory, "library");
    writePlugin(path.join(library, "plugins", "python-development"), "python-development", [["review", "Python review"]], {
      "commands/test.md": "run pytest"
    });
    const imported = importPluginHubLocalSource(db, config, directory, library);
    const plugin = imported.plugins[0];
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["codex"]);

    const installed = installProjectPlugin(db, project, plugin.id, "codex");
    const packageRoot = path.join(projectRoot, "plugins", "python-development");
    const skillPath = path.join(packageRoot, "skills", "review");
    const commandPath = path.join(packageRoot, "commands", "test.md");
    const marketplacePath = path.join(projectRoot, ".agents", "plugins", "marketplace.json");
    const manifestPath = path.join(packageRoot, ".codex-plugin", "plugin.json");
    const hookPath = path.join(packageRoot, "hooks", "hooks.json");
    const hookScriptPath = path.join(packageRoot, "hooks", "run-hook.cmd");

    expect(installed).toMatchObject({ requiresConfirmation: false, binding: { managedComponentCount: 1, existingComponentCount: 0, privateFileCount: 1 } });
    expect(fs.existsSync(path.join(skillPath, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(commandPath)).toBe(false);
    expect(fs.existsSync(hookPath)).toBe(false);
    expect(fs.existsSync(hookScriptPath)).toBe(false);
    expect(fs.existsSync(path.join(packageRoot, ".claude-plugin", "plugin.json"))).toBe(false);
    expect(fs.existsSync(path.join(packageRoot, ".cursor-plugin", "plugin.json"))).toBe(false);
    expect(fs.existsSync(path.join(packageRoot, ".opencode", "plugins", "python-development.js"))).toBe(false);
    expect(fs.existsSync(path.join(packageRoot, "GEMINI.md"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(manifestPath, "utf8"))).toMatchObject({ name: "python-development", skills: "./skills/" });
    expect(JSON.parse(fs.readFileSync(marketplacePath, "utf8")).plugins).toEqual([
      expect.objectContaining({ name: "python-development", source: { source: "local", path: "./plugins/python-development" } })
    ]);

    const replacementSource = path.join(directory, "replacement");
    writePlugin(replacementSource, "replacement", [["review", "Replacement review"]]);
    const replacement = importPluginHubLocalSource(db, config, directory, replacementSource).importedSkills[0];
    const appliedSkill = setProjectSkillTargets(db, project, replacement.id, ["codex"], { replaceConflicts: true });

    expect(appliedSkill.failures).toEqual([]);
    uninstallProjectPluginBinding(db, project, installed.binding?.id ?? "");
    expect(fs.existsSync(skillPath)).toBe(false);
    expect(fs.existsSync(marketplacePath)).toBe(false);
    db.close();
  });

  it("preflights native package local overwrites and blocks different package owners", () => {
    directory = testDir("pluginhub-private-preflight");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["codex"]);

    const first = createCustomPlugin(db, directory, {
      name: "shared",
      privateFiles: [{ sourceRelativePath: "notes.md", content: "first" }]
    });
    const firstMaterialRoot = path.dirname(path.dirname(first.privateFiles[0].contentPath));
    const editedFirst = updateCustomPlugin(db, directory, first.id, { name: "shared", description: "Updated description" });
    expect(editedFirst.privateFiles).toEqual(first.privateFiles);
    expect(fs.existsSync(first.privateFiles[0].contentPath)).toBe(true);
    const sourceRoot = path.join(directory, "source-shared");
    writePlugin(sourceRoot, "shared", [], { "other.md": "second" });
    const second = importPluginHubLocalSource(db, configFixture(directory), directory, sourceRoot).plugins[0];
    const packageRoot = path.join(projectRoot, "plugins", "shared");
    const privatePath = path.join(packageRoot, "notes.md");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "local.txt"), "local", "utf8");

    const preview = installProjectPlugin(db, project, first.id, "codex");
    expect(preview).toMatchObject({ requiresConfirmation: true, binding: null });
    expect(preview.preflight).toEqual([expect.objectContaining({ targetResourceType: "native-plugin", existingOwnerType: "local", backupRequired: true })]);

    const installed = installProjectPlugin(db, project, first.id, "codex", { conflictMode: "overwrite" });
    expect(installed.backups).toEqual([expect.objectContaining({ hub: "PluginHub", targetResourceType: "native-plugin", originalPath: packageRoot })]);
    expect(fs.existsSync(installed.backups[0].metadataPath)).toBe(true);
    expect(fs.readFileSync(privatePath, "utf8")).toBe("first");

    const blocked = installProjectPlugin(db, project, second.id, "codex");
    expect(blocked).toMatchObject({ blocked: true, requiresConfirmation: false, binding: null });
    expect(blocked.preflight).toEqual([expect.objectContaining({ targetResourceType: "native-plugin", existingOwnerType: "plugin-private" })]);

    uninstallProjectPluginBinding(db, project, installed.binding?.id ?? "");
    expect(fs.existsSync(packageRoot)).toBe(false);
    deletePluginHubPlugin(db, first.id);
    expect(fs.existsSync(firstMaterialRoot)).toBe(false);
    db.close();
  });


  it("imports Qwen extension manifests and structured MCP configs", () => {
    directory = testDir("pluginhub-qwen-extension-import");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const library = path.join(directory, "library");
    const pluginRoot = path.join(library, "plugins", "qwen-workflow");
    fs.mkdirSync(path.join(pluginRoot, "commands"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, "qwen-extension.json"),
      JSON.stringify(
        {
          name: "qwen-workflow",
          displayName: "Qwen Workflow",
          description: "Qwen native workflow",
          mcpServers: {
            "qwen-docs": { command: "node", args: ["server.js"] }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    fs.writeFileSync(path.join(pluginRoot, "commands", "review.md"), "review command", "utf8");

    const imported = importPluginHubLocalSource(db, config, directory, library);
    const plugin = imported.plugins[0];

    expect(plugin).toMatchObject({ name: "qwen-workflow", displayName: "Qwen Workflow", description: "Qwen native workflow" });
    expect(plugin.privateFiles.find((file) => file.sourceRelativePath.endsWith("qwen-extension.json"))?.role).toBe("native-manifest");
    expect(plugin.privateFiles.find((file) => file.sourceRelativePath.endsWith("commands/review.md"))?.role).toBe("native-command");
    expect(plugin.componentRefs).toEqual(expect.arrayContaining([expect.objectContaining({ type: "mcp", componentId: "qwen-docs" })]));
    expect(plugin.harnessSupport.qwen).toBe("component-only");
    expect(db.getMcpHubServer("qwen-docs")).toMatchObject({ command: "node", args: ["server.js"] });
    db.close();
  });
  it("installs plugin-native Claude hooks through a Claude marketplace package without creating HookHub suites", () => {
    directory = testDir("pluginhub-native-hooks");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const pluginRoot = path.join(directory, "caveman");
    writePlugin(pluginRoot, "caveman", [["caveman", "Caveman skill"]], {
      ".claude-plugin/plugin.json": JSON.stringify(
        {
          name: "caveman",
          hooks: {
            SessionStart: [
              {
                hooks: [
                  {
                    type: "command",
                    command: 'node "${CLAUDE_PLUGIN_ROOT}/src/hooks/caveman-activate.js"',
                    timeout: 5
                  }
                ]
              }
            ]
          }
        },
        null,
        2
      ),
      ".cursor-plugin/plugin.json": JSON.stringify({ name: "caveman" }),
      ".opencode/plugins/caveman.js": "export default {};",
      "GEMINI.md": "Gemini instructions",
      "src/hooks/caveman-activate.js": "process.stdout.write('caveman');\n"
    });
    const plugin = importPluginHubLocalSource(db, config, directory, pluginRoot).plugins[0];
    const projectRoot = path.join(directory, "repo");
    const settingsPath = path.join(projectRoot, ".claude", "settings.local.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          permissions: { allow: ["Bash(npm test)"] },
          hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo local" }] }] }
        },
        null,
        2
      ),
      "utf8"
    );
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["claude"]);

    const preview = installProjectPlugin(db, project, plugin.id, "claude");
    expect(preview).toMatchObject({ requiresConfirmation: false, binding: expect.any(Object) });
    expect(db.listHookHubSuites()).toEqual([]);

    const installed = preview;
    const projectSettingsPath = path.join(projectRoot, ".claude", "settings.json");
    const projectSettings = JSON.parse(fs.readFileSync(projectSettingsPath, "utf8"));
    const localSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const packageRoot = path.join(projectRoot, ".pluginhub", "claude-marketplace", "plugins", "caveman");
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, ".claude-plugin", "plugin.json"), "utf8"));
    const hookCommand = manifest.hooks.SessionStart[0].hooks[0].command;

    expect(installed).toMatchObject({ requiresConfirmation: false, binding: { managedComponentCount: 1, existingComponentCount: 0, privateFileCount: 1 } });
    expect(installed.backups).toEqual([]);
    expect(localSettings.permissions).toEqual({ allow: ["Bash(npm test)"] });
    expect(localSettings.hooks.PreToolUse[0].hooks[0].command).toBe("echo local");
    expect(projectSettings.enabledPlugins).toEqual({ "caveman@pluginhub": true });
    expect(projectSettings.extraKnownMarketplaces.pluginhub.source).toEqual({ source: "directory", path: "./.pluginhub/claude-marketplace" });
    expect(hookCommand).toContain("${CLAUDE_PLUGIN_ROOT}/src/hooks/caveman-activate.js");
    expect(fs.readFileSync(path.join(packageRoot, "src", "hooks", "caveman-activate.js"), "utf8")).toContain("caveman");
    expect(fs.existsSync(path.join(packageRoot, ".codex-plugin", "plugin.json"))).toBe(false);
    expect(fs.existsSync(path.join(packageRoot, ".cursor-plugin", "plugin.json"))).toBe(false);
    expect(fs.existsSync(path.join(packageRoot, ".opencode", "plugins", "caveman.js"))).toBe(false);
    expect(fs.existsSync(path.join(packageRoot, "GEMINI.md"))).toBe(false);
    expect(installed.binding?.privateFileOwnership.some((item) => item.kind === "native-plugin")).toBe(true);
    expect(listPluginHub(db).hookSuites).toEqual([]);

    uninstallProjectPluginBinding(db, project, installed.binding?.id ?? "");
    const afterUninstall = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(afterUninstall.hooks.PreToolUse[0].hooks[0].command).toBe("echo local");
    expect(fs.existsSync(packageRoot)).toBe(false);
    db.close();
  });

  it("converts plugin-native Claude hooks into Codex project hooks during Codex install", () => {
    directory = testDir("pluginhub-convert-claude-hooks-to-codex");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const pluginRoot = path.join(directory, "claude-only");
    fs.mkdirSync(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
    fs.mkdirSync(path.join(pluginRoot, "src", "hooks"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify(
        {
          name: "claude-only",
          description: "Claude hook plugin",
          hooks: {
            SessionStart: [
              {
                matcher: "startup",
                hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/src/hooks/start.js"', timeout: 5 }]
              }
            ]
          }
        },
        null,
        2
      ),
      "utf8"
    );
    fs.writeFileSync(path.join(pluginRoot, "src", "hooks", "start.js"), "process.stdout.write('start');\n", "utf8");
    const plugin = importPluginHubLocalSource(db, config, directory, pluginRoot).plugins[0];
    expect(plugin.harnessSupport.codex).toBe("native");

    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["codex"]);

    const installed = installProjectPlugin(db, project, plugin.id, "codex");
    const packageRoot = path.join(projectRoot, "plugins", "claude-only");
    const hooksConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, ".codex", "hooks.json"), "utf8"));
    const command = hooksConfig.session_start[0].command as string;

    expect(installed).toMatchObject({ requiresConfirmation: false, binding: { privateFileCount: 1 } });
    expect(command.replace(/\\/g, "/")).toContain(path.join(packageRoot, "src", "hooks", "start.js").replace(/\\/g, "/"));
    expect(hooksConfig.session_start[0]).toMatchObject({ matcher: "startup", timeout: 5 });
    expect(fs.existsSync(path.join(packageRoot, "src", "hooks", "start.js"))).toBe(true);
    expect(fs.existsSync(path.join(packageRoot, ".claude-plugin", "plugin.json"))).toBe(false);
    expect(fs.existsSync(path.join(packageRoot, ".codex-plugin", "plugin.json"))).toBe(true);
    expect(installed.binding?.privateFileOwnership.some((item) => item.kind === "hook")).toBe(true);
    db.close();
  });

  it("materializes custom Claude plugin components into the native package and protects HookHub suite references", () => {
    directory = testDir("pluginhub-custom-claude-package");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const skill = seedSkillHubSkill(db, config, "team-source", "review", "Review skill");
    const agentSource = db.upsertAgentHubSource({
      id: "team-agents",
      type: "local-import",
      label: "Team Agents",
      inputPath: null,
      resolvedPath: path.join(directory, "agents"),
      sourceTruthTool: "claude",
      importedAt: "2026-06-01T00:00:00Z",
      metadata: {}
    });
    const agent = db.upsertAgentHubAgent({
      id: "agent-1",
      sourceId: agentSource.id,
      sourceType: agentSource.type,
      sourceTruthTool: "claude",
      truthRole: "subagent",
      sourceFormat: "markdown",
      slug: "code-reviewer",
      name: "Code Reviewer",
      description: "Review changes",
      nativePath: path.join(directory, "agents", "code-reviewer.md"),
      libraryRelativePath: "team-agents/code-reviewer.md",
      sourceRelativePath: "code-reviewer.md",
      category: "engineering",
      projection: { name: "Code Reviewer", description: "Review changes", body: "Review changes.", slugCandidate: "code-reviewer", parseWarnings: [] },
      nativeMetadata: {},
      contentHash: "agent-hash"
    });
    const mcp = db.upsertMcpHubServer({
      serverId: "docs",
      name: "docs",
      description: "Docs MCP",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      url: null,
      headers: {},
      env: {},
      requiredEnv: []
    });
    const hook = db.upsertHookHubSuite({
      suiteId: "suite-1",
      name: "提交前检查",
      description: "Run checks",
      riskNotes: null,
      requiredEnv: [],
      payloads: { claude: { PreToolUse: [{ hooks: [{ type: "command", command: "npm test" }] }] } }
    });
    const custom = createCustomPlugin(db, directory, {
      name: "workflow",
      componentRefs: [
        { type: "skill", componentId: skill.id, required: true },
        { type: "agent", componentId: agent.id, required: true },
        { type: "mcp", componentId: mcp.serverId, required: true },
        { type: "hook", componentId: hook.suiteId, required: true }
      ]
    });
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["claude"]);

    const installed = installProjectPlugin(db, project, custom.id, "claude", directory);
    const packageRoot = path.join(projectRoot, ".pluginhub", "claude-marketplace", "plugins", "workflow");
    const mcpConfig = JSON.parse(fs.readFileSync(path.join(packageRoot, ".mcp.json"), "utf8"));
    const hooksConfig = JSON.parse(fs.readFileSync(path.join(packageRoot, "hooks", "hooks.json"), "utf8"));

    expect(installed).toMatchObject({ requiresConfirmation: false, binding: { managedComponentCount: 4 } });
    expect(fs.existsSync(path.join(packageRoot, "skills", "review", "SKILL.md"))).toBe(true);
    expect(fs.readFileSync(path.join(packageRoot, "agents", "code-reviewer.md"), "utf8")).toContain("Review changes.");
    expect(mcpConfig.mcpServers.docs).toMatchObject({ command: "node", args: ["server.js"] });
    expect(hooksConfig.PreToolUse[0].hooks[0].command).toBe("npm test");
    expect(() => deleteHookHubSuite(db, hook.suiteId)).toThrow("HookHub suite 正被 PluginHub plugin 引用");
    db.close();
  });


  it("installs custom plugin components into Qwen project targets", () => {
    directory = testDir("pluginhub-custom-qwen-components");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const skill = seedSkillHubSkill(db, config, "team-source", "review", "Review skill");
    const agentSource = db.upsertAgentHubSource({
      id: "team-agents",
      type: "local-import",
      label: "Team Agents",
      inputPath: null,
      resolvedPath: path.join(directory, "agents"),
      sourceTruthTool: "claude",
      importedAt: "2026-06-01T00:00:00Z",
      metadata: {}
    });
    const agent = db.upsertAgentHubAgent({
      id: "agent-1",
      sourceId: agentSource.id,
      sourceType: agentSource.type,
      sourceTruthTool: "claude",
      truthRole: "subagent",
      sourceFormat: "markdown",
      slug: "code-reviewer",
      name: "Code Reviewer",
      description: "Review changes",
      nativePath: path.join(directory, "agents", "code-reviewer.md"),
      libraryRelativePath: "team-agents/code-reviewer.md",
      sourceRelativePath: "code-reviewer.md",
      category: "engineering",
      projection: { name: "Code Reviewer", description: "Review changes", body: "Review changes.", slugCandidate: "code-reviewer", parseWarnings: [] },
      nativeMetadata: {},
      contentHash: "agent-hash"
    });
    const mcp = db.upsertMcpHubServer({
      serverId: "docs",
      name: "docs",
      description: "Docs MCP",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      url: null,
      headers: {},
      env: {},
      requiredEnv: []
    });
    const hook = db.upsertHookHubSuite({
      suiteId: "suite-1",
      name: "提交前检查",
      description: "Run checks",
      riskNotes: null,
      requiredEnv: [],
      payloads: { qwen: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm test" }] }] } }
    });
    const custom = createCustomPlugin(db, directory, {
      name: "qwen-workflow",
      componentRefs: [
        { type: "skill", componentId: skill.id, required: true },
        { type: "agent", componentId: agent.id, required: true },
        { type: "mcp", componentId: mcp.serverId, required: true },
        { type: "hook", componentId: hook.suiteId, required: true }
      ]
    });
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["qwen"]);

    const installed = installProjectPlugin(db, project, custom.id, "qwen", directory);
    const qwenSettingsPath = path.join(projectRoot, ".qwen", "settings.json");
    const qwenSettings = JSON.parse(fs.readFileSync(qwenSettingsPath, "utf8"));

    expect(installed).toMatchObject({ requiresConfirmation: false, binding: { managedComponentCount: 4, privateFileCount: 0 } });
    expect(listProjectPluginState(db, project).plugins.find((plugin) => plugin.id === custom.id)?.harnessSupport.qwen).toBe("component-only");
    expect(fs.existsSync(path.join(projectRoot, ".qwen", "skills", "review", "SKILL.md"))).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, ".qwen", "agents", "code-reviewer.md"), "utf8")).toContain("Review changes.");
    expect(qwenSettings).toMatchObject({
      mcpServers: { docs: { command: "node", args: ["server.js"] } },
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm test" }] }] }
    });
    expect(qwenSettings.mcpServers.docs.transport).toBeUndefined();
    expect(db.listProjectMcpBindings(project.id, project.rootPath)).toEqual([expect.objectContaining({ toolId: "qwen", serverId: "docs" })]);

    uninstallProjectPluginBinding(db, project, installed.binding?.id ?? "");
    expect(fs.existsSync(path.join(projectRoot, ".qwen", "skills", "review"))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, ".qwen", "agents", "code-reviewer.md"))).toBe(false);
    expect(fs.existsSync(qwenSettingsPath)).toBe(false);
    expect(db.listProjectMcpBindings(project.id, project.rootPath)).toEqual([]);
    expect(db.listProjectAgentTargets(project.id, project.rootPath)).toEqual([]);
    db.close();
  }, 20000);
  it("installs custom plugin components into Kimi project targets", () => {
    directory = testDir("pluginhub-custom-kimi-components");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const skill = seedSkillHubSkill(db, config, "team-source", "review", "Review skill");
    const agentSource = db.upsertAgentHubSource({
      id: "team-agents",
      type: "local-import",
      label: "Team Agents",
      inputPath: null,
      resolvedPath: path.join(directory, "agents"),
      sourceTruthTool: "claude",
      importedAt: "2026-06-01T00:00:00Z",
      metadata: {}
    });
    const agent = db.upsertAgentHubAgent({
      id: "agent-1",
      sourceId: agentSource.id,
      sourceType: agentSource.type,
      sourceTruthTool: "claude",
      truthRole: "subagent",
      sourceFormat: "markdown",
      slug: "code-reviewer",
      name: "Code Reviewer",
      description: "Review changes",
      nativePath: path.join(directory, "agents", "code-reviewer.md"),
      libraryRelativePath: "team-agents/code-reviewer.md",
      sourceRelativePath: "code-reviewer.md",
      category: "engineering",
      projection: { name: "Code Reviewer", description: "Review changes", body: "Review changes.", slugCandidate: "code-reviewer", parseWarnings: [] },
      nativeMetadata: {},
      contentHash: "agent-hash"
    });
    const mcp = db.upsertMcpHubServer({
      serverId: "docs",
      name: "docs",
      description: "Docs MCP",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      url: null,
      headers: {},
      env: {},
      requiredEnv: []
    });
    const hook = db.upsertHookHubSuite({
      suiteId: "suite-1",
      name: "提交前检查",
      description: "Run checks",
      riskNotes: null,
      requiredEnv: [],
      payloads: { claude: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm test" }] }] } }
    });
    const custom = createCustomPlugin(db, directory, {
      name: "kimi-workflow",
      componentRefs: [
        { type: "skill", componentId: skill.id, required: true },
        { type: "agent", componentId: agent.id, required: true },
        { type: "mcp", componentId: mcp.serverId, required: true },
        { type: "hook", componentId: hook.suiteId, required: false }
      ]
    });
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["kimi"]);

    const installed = installProjectPlugin(db, project, custom.id, "kimi", directory);
    const skillPath = path.join(projectRoot, ".kimi-code", "skills", "review", "SKILL.md");
    const agentPath = path.join(projectRoot, ".kimi-code", "skills", "code-reviewer", "SKILL.md");
    const mcpConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, ".kimi-code", "mcp.json"), "utf8"));
    expect(installed).toMatchObject({ requiresConfirmation: false, binding: { managedComponentCount: 3 } });
    expect(listProjectPluginState(db, project).plugins.find((plugin) => plugin.id === custom.id)?.harnessSupport.kimi).toBe("component-only");
    expect(fs.existsSync(skillPath)).toBe(true);
    expect(fs.readFileSync(agentPath, "utf8")).toContain("agenthub: true");
    expect(mcpConfig.mcpServers.docs).toMatchObject({ command: "node", args: ["server.js"] });

    expect(db.listProjectMcpBindings(project.id, project.rootPath)).toHaveLength(1);

    uninstallProjectPluginBinding(db, project, installed.binding?.id ?? "");
    expect(fs.existsSync(skillPath)).toBe(false);
    expect(fs.existsSync(agentPath)).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".kimi-code", "mcp.json"), "utf8")).mcpServers.docs).toBeUndefined();
    expect(fs.existsSync(path.join(projectRoot, ".kimi-code", "config.toml"))).toBe(false);
    expect(db.listProjectMcpBindings(project.id, project.rootPath)).toEqual([]);
    expect(db.listProjectAgentTargets(project.id, project.rootPath)).toEqual([]);
    db.close();
  }, 60000);
  it("does not treat Kimi required hook-only plugins as installable", () => {
    directory = testDir("pluginhub-kimi-required-hook");
    const db = new AppDatabase(directory);
    const hook = db.upsertHookHubSuite({
      suiteId: "suite-1",
      name: "Kimi hook only",
      description: null,
      riskNotes: null,
      requiredEnv: [],
      payloads: { kimi: [{ event: "PreToolUse", matcher: "Bash", command: "npm test" }] }
    });
    const custom = createCustomPlugin(db, directory, {
      name: "kimi-hook-only",
      componentRefs: [{ type: "hook", componentId: hook.suiteId, required: true }]
    });
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["kimi"]);

    expect(listProjectPluginState(db, project).plugins.find((plugin) => plugin.id === custom.id)?.harnessSupport.kimi).toBe("unsupported");
    expect(() => installProjectPlugin(db, project, custom.id, "kimi", directory)).toThrow("该 Plugin 不支持安装到目标工具");
    expect(fs.existsSync(path.join(projectRoot, ".kimi-code", "config.toml"))).toBe(false);
    db.close();
  });
  it("installs custom Codex plugin agents through AgentHub project targets", () => {
    directory = testDir("pluginhub-custom-codex-agent");
    const db = new AppDatabase(directory);
    const agentSource = db.upsertAgentHubSource({
      id: "team-agents",
      type: "local-import",
      label: "Team Agents",
      inputPath: null,
      resolvedPath: path.join(directory, "agents"),
      sourceTruthTool: "claude",
      importedAt: "2026-06-01T00:00:00Z",
      metadata: {}
    });
    const agent = db.upsertAgentHubAgent({
      id: "agent-1",
      sourceId: agentSource.id,
      sourceType: agentSource.type,
      sourceTruthTool: "claude",
      truthRole: "subagent",
      sourceFormat: "markdown",
      slug: "code-reviewer",
      name: "Code Reviewer",
      description: "Review changes",
      nativePath: path.join(directory, "agents", "code-reviewer.md"),
      libraryRelativePath: "team-agents/code-reviewer.md",
      sourceRelativePath: "code-reviewer.md",
      category: "engineering",
      projection: { name: "Code Reviewer", description: "Review changes", body: "Review changes.", slugCandidate: "code-reviewer", parseWarnings: [] },
      nativeMetadata: {},
      contentHash: "agent-hash"
    });
    const custom = createCustomPlugin(db, directory, {
      name: "codex-workflow",
      componentRefs: [{ type: "agent", componentId: agent.id, required: true }]
    });
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["codex"]);

    const installed = installProjectPlugin(db, project, custom.id, "codex", directory);
    const codexAgentPath = path.join(projectRoot, ".codex", "agents", "code-reviewer.toml");
    const packageRoot = path.join(projectRoot, "plugins", "codex-workflow");

    expect(installed).toMatchObject({ requiresConfirmation: false, binding: { managedComponentCount: 1, privateFileCount: 1 } });
    expect(fs.readFileSync(codexAgentPath, "utf8")).toContain('name = "Code Reviewer"');
    expect(db.listProjectAgentTargets(project.id, project.rootPath)).toEqual([expect.objectContaining({ toolId: "codex", agentId: agent.id })]);
    expect(fs.existsSync(path.join(packageRoot, ".codex-plugin", "plugin.json"))).toBe(true);

    uninstallProjectPluginBinding(db, project, installed.binding?.id ?? "");
    expect(fs.existsSync(codexAgentPath)).toBe(false);
    expect(db.listProjectAgentTargets(project.id, project.rootPath)).toEqual([]);
    db.close();
  }, 20000);

  it("installs custom plugin components into OpenCode and CodeBuddy project targets", () => {
    directory = testDir("pluginhub-custom-opencode-codebuddy-components");
    const db = new AppDatabase(directory);
    const agentSource = db.upsertAgentHubSource({
      id: "team-agents",
      type: "local-import",
      label: "Team Agents",
      inputPath: null,
      resolvedPath: path.join(directory, "agents"),
      sourceTruthTool: "claude",
      importedAt: "2026-06-01T00:00:00Z",
      metadata: {}
    });
    const agent = db.upsertAgentHubAgent({
      id: "agent-1",
      sourceId: agentSource.id,
      sourceType: agentSource.type,
      sourceTruthTool: "claude",
      truthRole: "subagent",
      sourceFormat: "markdown",
      slug: "code-reviewer",
      name: "Code Reviewer",
      description: "Review changes",
      nativePath: path.join(directory, "agents", "code-reviewer.md"),
      libraryRelativePath: "team-agents/code-reviewer.md",
      sourceRelativePath: "code-reviewer.md",
      category: "engineering",
      projection: { name: "Code Reviewer", description: "Review changes", body: "Review changes.", slugCandidate: "code-reviewer", parseWarnings: [] },
      nativeMetadata: {},
      contentHash: "agent-hash"
    });
    const mcp = db.upsertMcpHubServer({
      serverId: "docs",
      name: "docs",
      description: "Docs MCP",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      url: null,
      headers: {},
      env: {},
      requiredEnv: []
    });
    const hookSuite = createHookHubSuite(db, {
      name: "CodeBuddy hooks",
      payloads: {
        codebuddy: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm test" }] }] }
      }
    });
    const custom = createCustomPlugin(db, directory, {
      name: "portable-workflow",
      componentRefs: [
        { type: "agent", componentId: agent.id, required: true },
        { type: "mcp", componentId: mcp.serverId, required: true },
        { type: "hook", componentId: hookSuite.suiteId, required: false }
      ]
    });
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["opencode", "codebuddy"]);

    const opencodeInstalled = installProjectPlugin(db, project, custom.id, "opencode", directory);
    const codebuddyInstalled = installProjectPlugin(db, project, custom.id, "codebuddy", directory);

    expect(listProjectPluginState(db, project).plugins.find((plugin) => plugin.id === custom.id)?.harnessSupport).toMatchObject({
      opencode: "component-only",
      codebuddy: "component-only"
    });
    expect(opencodeInstalled).toMatchObject({ requiresConfirmation: false, binding: { managedComponentCount: 2 } });
    expect(codebuddyInstalled).toMatchObject({ requiresConfirmation: false, binding: { managedComponentCount: 3 } });
    const opencodeAgentText = fs.readFileSync(path.join(projectRoot, ".opencode", "agents", "code-reviewer.md"), "utf8");
    expect(opencodeAgentText).toMatch(/mode:\s+"?subagent"?/);
    expect(opencodeAgentText).toContain("Review changes.");
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, "opencode.json"), "utf8")).mcp.docs).toMatchObject({ type: "local", command: ["node", "server.js"] });
    expect(fs.readFileSync(path.join(projectRoot, ".codebuddy", "agents", "code-reviewer.md"), "utf8")).toContain("Review changes.");
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8")).mcpServers.docs).toMatchObject({ type: "stdio", command: "node", args: ["server.js"] });
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".codebuddy", "settings.json"), "utf8")).hooks.PreToolUse[0]).toMatchObject({ matcher: "Bash", hooks: [{ type: "command", command: "npm test" }] });
    expect(db.listProjectMcpBindings(project.id, project.rootPath).map((binding) => binding.toolId).sort()).toEqual(["codebuddy", "opencode"]);
    expect(db.listProjectAgentTargets(project.id, project.rootPath).map((target) => target.toolId).sort()).toEqual(["codebuddy", "opencode"]);
    db.close();
  }, 20000);

  it("preflights local overwrites, supports skip installs, and backs up confirmed overwrites", () => {
    directory = testDir("pluginhub-preflight");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const library = path.join(directory, "library");
    writePlugin(path.join(library, "plugins", "python-development"), "python-development", [["review", "Python review"]]);
    const plugin = importPluginHubLocalSource(db, config, directory, library).plugins[0];
    const projectRoot = path.join(directory, "repo");
    const packageRoot = path.join(projectRoot, "plugins", "python-development");
    writeSkill(path.join(packageRoot, "skills", "review"), "review", "Local review");
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["codex"]);

    const preview = installProjectPlugin(db, project, plugin.id, "codex");
    const skipped = installProjectPlugin(db, project, plugin.id, "codex", { conflictMode: "skip" });

    expect(preview).toMatchObject({ requiresConfirmation: true, binding: null });
    expect(preview.preflight).toEqual([expect.objectContaining({ targetResourceType: "native-plugin", existingOwnerType: "local", backupRequired: true })]);
    expect(skipped).toMatchObject({ blocked: true, binding: null });
    expect(fs.existsSync(path.join(packageRoot, "skills", "review", "SKILL.md"))).toBe(true);
    const overwritten = installProjectPlugin(db, project, plugin.id, "codex", { conflictMode: "overwrite" });
    expect(overwritten.binding).toMatchObject({ managedComponentCount: 1, existingComponentCount: 0 });
    expect(overwritten.backups[0]).toMatchObject({ hub: "PluginHub", targetResourceType: "native-plugin", originalPath: packageRoot });
    expect(fs.existsSync(overwritten.backups[0].metadataPath)).toBe(true);
    expect(fs.existsSync(path.join(packageRoot, "skills", "review", "SKILL.md"))).toBe(true);
    fs.writeFileSync(path.join(packageRoot, "local-drift.txt"), "local edit", "utf8");

    const driftPreview = syncProjectPluginBinding(db, project, overwritten.binding?.id ?? "");
    expect(driftPreview).toMatchObject({ requiresConfirmation: true, binding: null });
    expect(driftPreview.preflight).toEqual([
      expect.objectContaining({
        targetResourceType: "native-plugin",
        existingOwnerType: "local",
        overwriteReason: "PluginHub 管理的原生 plugin package 已被本地修改",
        backupRequired: true
      })
    ]);
    const blockedUninstall = uninstallProjectPluginBinding(db, project, overwritten.binding?.id ?? "");
    expect(blockedUninstall).toMatchObject({ blocked: true, binding: expect.any(Object) });
    expect(fs.existsSync(path.join(packageRoot, "local-drift.txt"))).toBe(true);

    const resynced = syncProjectPluginBinding(db, project, overwritten.binding?.id ?? "", { conflictMode: "overwrite" });
    expect(resynced.backups).toEqual([expect.objectContaining({ targetResourceType: "native-plugin", originalPath: packageRoot })]);
    expect(fs.existsSync(path.join(packageRoot, "local-drift.txt"))).toBe(false);
    const uninstalled = uninstallProjectPluginBinding(db, project, overwritten.binding?.id ?? "");
    expect(uninstalled).toMatchObject({ blocked: false, binding: null });
    expect(fs.existsSync(packageRoot)).toBe(false);
    db.close();
  });

  it("keeps shared component owners on uninstall and removes the last owner", () => {
    directory = testDir("pluginhub-shared-owner");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const library = path.join(directory, "library");
    writePlugin(path.join(library, "plugins", "python-development"), "python-development", [["review", "Python review"]]);
    const imported = importPluginHubLocalSource(db, config, directory, library);
    const sourcePlugin = imported.plugins[0];
    const customPlugin = createCustomPlugin(db, directory, {
      name: "custom-review",
      componentRefs: [{ type: "skill", componentId: imported.importedSkills[0].id, required: true }]
    });
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["codex"]);
    const sourceInstall = installProjectPlugin(db, project, sourcePlugin.id, "codex");
    const customInstall = installProjectPlugin(db, project, customPlugin.id, "codex");
    const sourceSkillPath = path.join(projectRoot, "plugins", "python-development", "skills", "review", "SKILL.md");
    const customSkillPath = path.join(projectRoot, "plugins", "custom-review", "skills", "review", "SKILL.md");

    uninstallProjectPluginBinding(db, project, sourceInstall.binding?.id ?? "");
    expect(fs.existsSync(sourceSkillPath)).toBe(false);
    expect(fs.existsSync(customSkillPath)).toBe(true);

    uninstallProjectPluginBinding(db, project, customInstall.binding?.id ?? "");
    expect(fs.existsSync(customSkillPath)).toBe(false);
    db.close();
  });

  it("syncs custom plugin topology additions and removals", () => {
    directory = testDir("pluginhub-sync");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const review = seedSkillHubSkill(db, config, "source-a", "review", "Review");
    const triage = seedSkillHubSkill(db, config, "source-b", "triage", "Triage");
    const custom = createCustomPlugin(db, directory, {
      name: "workflow",
      componentRefs: [{ type: "skill", componentId: review.id, required: true }]
    });
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["codex"]);
    const installed = installProjectPlugin(db, project, custom.id, "codex");

    updateCustomPlugin(db, directory, custom.id, {
      name: "workflow",
      componentRefs: [
        { type: "skill", componentId: review.id, required: true },
        { type: "skill", componentId: triage.id, required: false }
      ]
    });
    expect(listProjectPluginState(db, project).syncRequiredPluginIds).toEqual([custom.id]);
    syncProjectPluginBinding(db, project, installed.binding?.id ?? "");
    expect(fs.existsSync(path.join(projectRoot, "plugins", "workflow", "skills", "triage", "SKILL.md"))).toBe(true);

    updateCustomPlugin(db, directory, custom.id, {
      name: "workflow",
      componentRefs: [{ type: "skill", componentId: triage.id, required: false }]
    });
    const syncedRemoval = syncProjectPluginBinding(db, project, installed.binding?.id ?? "");

    expect(syncedRemoval.binding).toMatchObject({ managedComponentCount: 1 });
    expect(fs.existsSync(path.join(projectRoot, "plugins", "workflow", "skills", "review"))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, "plugins", "workflow", "skills", "triage", "SKILL.md"))).toBe(true);
    db.close();
  });

  it("previews and deletes sources without leaving custom plugin dangling component refs", () => {
    directory = testDir("pluginhub-delete-source");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const library = path.join(directory, "library");
    writePlugin(path.join(library, "plugins", "python-development"), "python-development", [["review", "Python review"]]);
    const imported = importPluginHubLocalSource(db, config, directory, library);
    const custom = createCustomPlugin(db, directory, {
      name: "custom-review",
      componentRefs: [{ type: "skill", componentId: imported.importedSkills[0].id, required: true }]
    });
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["codex"]);
    const skillLinkPath = path.join(projectRoot, ".codex", "skills", "review");
    setProjectSkillTargets(db, project, imported.importedSkills[0].id, ["codex"]);

    const preview = previewDeletePluginHubSource(db, imported.source.id);
    const deleted = deletePluginHubSource(db, imported.source.id, "remove-custom-components");

    expect(preview).toMatchObject({
      source: { id: imported.source.id },
      sourcePlugins: [{ id: imported.plugins[0].id }],
      customPlugins: [{ id: custom.id }]
    });
    expect(deleted.failures).toEqual([]);
    expect(fs.existsSync(skillLinkPath)).toBe(false);
    expect(db.listProjectSkillTargetsForSkill(imported.importedSkills[0].id)).toEqual([]);
    expect(db.getPluginHubSource(imported.source.id)).toBeNull();
    expect(db.getPluginHubPlugin(imported.plugins[0].id)).toBeNull();
    expect(db.getPluginHubPlugin(custom.id)?.componentRefs).toEqual([]);
    expect(db.getSkillHubSkill(imported.importedSkills[0].id)).toBeNull();
    db.close();
  });

  it("preserves source records when project component cleanup fails", () => {
    directory = testDir("pluginhub-delete-source-failure");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const library = path.join(directory, "library");
    writePlugin(path.join(library, "plugins", "python-development"), "python-development", [["review", "Python review"]]);
    const imported = importPluginHubLocalSource(db, config, directory, library);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["codex"]);
    const skillLinkPath = path.join(projectRoot, ".codex", "skills", "review");
    setProjectSkillTargets(db, project, imported.importedSkills[0].id, ["codex"]);
    fs.rmSync(skillLinkPath, { recursive: true, force: true });
    writeSkill(skillLinkPath, "review", "Local replacement");

    const deleted = deletePluginHubSource(db, imported.source.id, "remove-custom-components");

    expect(deleted.failures).toEqual([expect.objectContaining({ path: skillLinkPath, reason: "目标不是 SkillHub 创建的 link" })]);
    expect(db.getPluginHubSource(imported.source.id)).not.toBeNull();
    expect(db.getSkillHubSkill(imported.importedSkills[0].id)).not.toBeNull();
    expect(db.getPluginHubPlugin(imported.plugins[0].id)).not.toBeNull();
    db.close();
  });
});

function configFixture(dataDir: string): AppConfig {
  return { ...defaultAppConfig(), skillhub: { rootDir: path.join(dataDir, "skillhub") } };
}

function seedSkillHubSkill(db: AppDatabase, config: AppConfig, sourceLabel: string, folderName: string, description: string) {
  const sourceRoot = path.join(path.dirname(config.skillhub.rootDir), sourceLabel);
  writeSkill(path.join(sourceRoot, "skills", folderName), folderName, description);
  return importLocalSkills(db, config, path.dirname(config.skillhub.rootDir), sourceRoot).imported[0];
}

function writePlugin(pluginRoot: string, name: string, skills: Array<[string, string]>, privateFiles: Record<string, string> = {}): void {
  fs.mkdirSync(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ name, description: `${name} plugin` }, null, 2), "utf8");
  for (const [skillName, description] of skills) {
    writeSkill(path.join(pluginRoot, "skills", skillName), skillName, description);
  }
  for (const [relativePath, content] of Object.entries(privateFiles)) {
    const filePath = path.join(pluginRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
}

function writeMarketplace(repoRoot: string, marketplace: Record<string, unknown>): void {
  fs.mkdirSync(path.join(repoRoot, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".claude-plugin", "marketplace.json"), JSON.stringify(marketplace, null, 2), "utf8");
}

function writeSkill(directory: string, name: string, description: string): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), skillText(name, description), "utf8");
}

function writeBomSkill(directory: string, name: string, description: string): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), `\ufeff${skillText(name, description)}`, "utf8");
}

function writeBareMetadataSkill(directory: string, name: string, description: string): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), `name: ${name}\ndescription: ${description}\n\n# Skill Instructions\n`, "utf8");
}

function skillText(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
}

function gitAvailable(): boolean {
  return spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
}

function gitInit(repo: string): void {
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "pluginhub@example.test"]);
  git(repo, ["config", "user.name", "PluginHub Test"]);
}

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "git failed");
  }
  return result.stdout.trim();
}
