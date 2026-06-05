import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultAppConfig } from "../src/server/core/bootstrap.js";
import {
  createCustomPlugin,
  deletePluginHubPlugin,
  deletePluginHubSource,
  importPluginHubLocalSource,
  installProjectPlugin,
  listPluginHub,
  listProjectPluginState,
  previewDeletePluginHubSource,
  syncProjectPluginBinding,
  uninstallProjectPluginBinding,
  updateCustomPlugin
} from "../src/server/pluginhub/pluginhub.js";
import { importLocalSkills, listProjectLocalSkillsState } from "../src/server/skillhub/skillhub.js";
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
    expect(imported.importedSkills.map((skill) => skill.libraryRelativePath)).toEqual([
      `pluginhub/${imported.source.id}/plugins/frontend/skills/lint`,
      `pluginhub/${imported.source.id}/plugins/python-development/skills/review`
    ]);
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
  fs.writeFileSync(path.join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`, "utf8");
}
