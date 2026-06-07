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
import { deleteSkillHubSkill, importLocalSkills, listProjectLocalSkillsState, previewDeleteSkillHubSkill } from "../src/server/skillhub/skillhub.js";
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
  it("seeds Superpowers as a deletable built-in source on first catalog access", () => {
    directory = testDir("pluginhub-builtin-superpowers");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);

    const listed = listPluginHub(db, config, directory);
    const source = listed.sources.find((item) => item.id === "pluginhub-source-superpowers");
    const plugin = listed.plugins.find((item) => item.sourceId === source?.id && item.name === "superpowers");

    expect(source).toMatchObject({
      id: "pluginhub-source-superpowers",
      kind: "single-plugin",
      label: "obra/superpowers",
      inputPath: "builtin-plugins/superpowers",
      pluginCount: 1
    });
    expect(source?.componentCount).toBeGreaterThan(0);
    expect(plugin).toMatchObject({ displayName: "Superpowers", sourceId: "pluginhub-source-superpowers" });
    expect(plugin?.componentRefs.length).toBeGreaterThan(0);
    expect(listed.skills.some((skill) => skill.folderName === "using-superpowers")).toBe(true);

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

  it("installs a project plugin, materializes private files, and marks plugin-owned skills readonly", () => {
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
    const skillPath = path.join(projectRoot, ".codex", "skills", "review");
    const privatePath = path.join(projectRoot, ".agents", "plugins", "python-development", "commands", "test.md");
    const localSkills = listProjectLocalSkillsState(db, project);

    expect(installed).toMatchObject({ requiresConfirmation: false, binding: { managedComponentCount: 1, existingComponentCount: 0, privateFileCount: 2 } });
    expect(fs.lstatSync(skillPath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(privatePath, "utf8")).toBe("run pytest");
    expect(localSkills.skills).toMatchObject([{ type: "plugin", folderName: "review", plugin: { id: plugin.id } }]);

    const replacementSource = path.join(directory, "replacement");
    writePlugin(replacementSource, "replacement", [["review", "Replacement review"]]);
    const replacement = importPluginHubLocalSource(db, config, directory, replacementSource).importedSkills[0];
    const blocked = setProjectSkillTargets(db, project, replacement.id, ["codex"], { replaceConflicts: true });

    expect(blocked.failures).toEqual([expect.objectContaining({ reason: "该目标由项目 Plugin 管理，请从 Plugin 入口卸载或同步" })]);
    uninstallProjectPluginBinding(db, project, installed.binding?.id ?? "");
    expect(fs.existsSync(skillPath)).toBe(false);
    expect(fs.existsSync(privatePath)).toBe(false);
    db.close();
  });

  it("preflights plugin-private local overwrites and blocks different private-file owners", () => {
    directory = testDir("pluginhub-private-preflight");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["codex"]);

    const first = createCustomPlugin(db, directory, {
      name: "first-private",
      privateFiles: [{ sourceRelativePath: "notes.md", targetRelativePath: ".agents/plugins/shared/notes.md", content: "first" }]
    });
    const firstMaterialRoot = path.dirname(path.dirname(first.privateFiles[0].contentPath));
    const editedFirst = updateCustomPlugin(db, directory, first.id, { name: "first-private", description: "Updated description" });
    expect(editedFirst.privateFiles).toEqual(first.privateFiles);
    expect(fs.existsSync(first.privateFiles[0].contentPath)).toBe(true);
    const second = createCustomPlugin(db, directory, {
      name: "second-private",
      privateFiles: [{ sourceRelativePath: "other.md", targetRelativePath: ".agents/plugins/shared/notes.md", content: "second" }]
    });
    const privatePath = path.join(projectRoot, ".agents", "plugins", "shared", "notes.md");
    fs.mkdirSync(path.dirname(privatePath), { recursive: true });
    fs.writeFileSync(privatePath, "local", "utf8");

    const preview = installProjectPlugin(db, project, first.id, "codex");
    expect(preview).toMatchObject({ requiresConfirmation: true, binding: null });
    expect(preview.preflight).toEqual([expect.objectContaining({ targetResourceType: "private-file", existingOwnerType: "local", backupRequired: true })]);

    const installed = installProjectPlugin(db, project, first.id, "codex", { conflictMode: "overwrite" });
    expect(installed.backups).toEqual([expect.objectContaining({ hub: "PluginHub", targetResourceType: "private-file", originalPath: privatePath })]);
    expect(fs.existsSync(installed.backups[0].metadataPath)).toBe(true);
    expect(fs.readFileSync(privatePath, "utf8")).toBe("first");

    const blocked = installProjectPlugin(db, project, second.id, "codex");
    expect(blocked).toMatchObject({ blocked: true, requiresConfirmation: false, binding: null });
    expect(blocked.preflight).toEqual([expect.objectContaining({ targetResourceType: "private-file", existingOwnerType: "plugin-private" })]);

    uninstallProjectPluginBinding(db, project, installed.binding?.id ?? "");
    expect(fs.existsSync(privatePath)).toBe(false);
    deletePluginHubPlugin(db, first.id);
    expect(fs.existsSync(firstMaterialRoot)).toBe(false);
    db.close();
  });

  it("preflights local overwrites, supports skip installs, and backs up confirmed overwrites", () => {
    directory = testDir("pluginhub-preflight");
    const db = new AppDatabase(directory);
    const config = configFixture(directory);
    const library = path.join(directory, "library");
    writePlugin(path.join(library, "plugins", "python-development"), "python-development", [["review", "Python review"]]);
    const plugin = importPluginHubLocalSource(db, config, directory, library).plugins[0];
    const projectRoot = path.join(directory, "repo");
    writeSkill(path.join(projectRoot, ".codex", "skills", "review"), "review", "Local review");
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["codex"]);

    const preview = installProjectPlugin(db, project, plugin.id, "codex");
    const skipped = installProjectPlugin(db, project, plugin.id, "codex", { conflictMode: "skip" });

    expect(preview).toMatchObject({ requiresConfirmation: true, binding: null });
    expect(preview.preflight).toEqual([expect.objectContaining({ existingOwnerType: "local", backupRequired: true })]);
    expect(skipped.binding).toMatchObject({ managedComponentCount: 0, existingComponentCount: 1 });
    expect(fs.lstatSync(path.join(projectRoot, ".codex", "skills", "review")).isSymbolicLink()).toBe(false);
    const overwritten = installProjectPlugin(db, project, plugin.id, "codex", { conflictMode: "overwrite" });
    expect(overwritten.binding).toMatchObject({ managedComponentCount: 1, existingComponentCount: 0 });
    expect(overwritten.backups[0]).toMatchObject({ hub: "PluginHub", targetResourceType: "skill" });
    expect(fs.existsSync(overwritten.backups[0].metadataPath)).toBe(true);
    expect(fs.lstatSync(path.join(projectRoot, ".codex", "skills", "review")).isSymbolicLink()).toBe(true);
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
    const skillPath = path.join(projectRoot, ".codex", "skills", "review");

    uninstallProjectPluginBinding(db, project, sourceInstall.binding?.id ?? "");
    expect(fs.existsSync(skillPath)).toBe(true);

    uninstallProjectPluginBinding(db, project, customInstall.binding?.id ?? "");
    expect(fs.existsSync(skillPath)).toBe(false);
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
    expect(fs.existsSync(path.join(projectRoot, ".codex", "skills", "triage"))).toBe(true);

    updateCustomPlugin(db, directory, custom.id, {
      name: "workflow",
      componentRefs: [{ type: "skill", componentId: triage.id, required: false }]
    });
    const syncedRemoval = syncProjectPluginBinding(db, project, installed.binding?.id ?? "");

    expect(syncedRemoval.binding).toMatchObject({ managedComponentCount: 1 });
    expect(fs.existsSync(path.join(projectRoot, ".codex", "skills", "review"))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, ".codex", "skills", "triage"))).toBe(true);
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
