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
import { deleteHookHubSuite } from "../src/server/hookhub/hookhub.js";
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
    expect(source?.privateFileCount).toBeGreaterThan(90);
    expect(plugin).toMatchObject({ displayName: "Superpowers", sourceId: "pluginhub-source-superpowers" });
    expect(plugin?.componentRefs.length).toBeGreaterThan(0);
    expect(plugin?.privateFiles.map((file) => file.sourceRelativePath)).toEqual(
      expect.arrayContaining([
        "superpowers/.claude-plugin/plugin.json",
        "superpowers/.cursor-plugin/plugin.json",
        "superpowers/.opencode/plugins/superpowers.js",
        "superpowers/docs/README.opencode.md",
        "superpowers/hooks/hooks.json",
        "superpowers/scripts/sync-to-codex-plugin.sh"
      ])
    );
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
      "commands/test.md": "run pytest"
    });
    writePlugin(path.join(library, "plugins", "frontend"), "frontend", [["lint", "Frontend lint"]]);

    const imported = importPluginHubLocalSource(db, config, directory, library);

    expect(imported.source).toMatchObject({ kind: "library", label: "wshobson-agents", pluginCount: 2 });
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
    expect(imported.plugins.find((plugin) => plugin.name === "python-development")?.privateFiles.map((file) => file.sourceRelativePath)).toEqual(
      expect.arrayContaining(["plugins/python-development/.codex-plugin/plugin.json", "plugins/python-development/commands/test.md"])
    );
    expect(db.listSkillHubSkills().map((skill) => skill.folderName)).toEqual(["lint", "review"]);
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

    expect(installed).toMatchObject({ requiresConfirmation: false, binding: { managedComponentCount: 1, existingComponentCount: 0, privateFileCount: 1 } });
    expect(fs.existsSync(path.join(skillPath, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(commandPath)).toBe(false);
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
    expect(installed.binding?.privateFileOwnership.some((item) => item.kind === "native-plugin")).toBe(true);
    expect(listPluginHub(db).hookSuites).toEqual([]);

    uninstallProjectPluginBinding(db, project, installed.binding?.id ?? "");
    const afterUninstall = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(afterUninstall.hooks.PreToolUse[0].hooks[0].command).toBe("echo local");
    expect(fs.existsSync(packageRoot)).toBe(false);
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

function writeSkill(directory: string, name: string, description: string): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), skillText(name, description), "utf8");
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
