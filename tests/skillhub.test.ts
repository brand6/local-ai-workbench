import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppConfig } from "../src/server/core/bootstrap.js";
import { AppDatabase } from "../src/server/storage/database.js";
import {
  importGitHubSource,
  importLocalSkills,
  checkGitHubUpdates,
  applyGitHubSourceUpdate,
  deleteSkillHubSkill,
  deleteSkillHubSource,
  listSkillHub,
  listProjectLocalSkillsState,
  migrateProjectLocalSkill
} from "../src/server/skillhub/skillhub.js";
import {
  applyRuleSync,
  commitRuleSyncTarget,
  createRuleFile,
  createRuleTemplateFile,
  DEFAULT_CLAUDE_RULE_TEMPLATE,
  getRuleSyncStatus,
  prepareRuleFileCreate
} from "../src/server/skillhub/ruleSync.js";
import { listProjectSkillTargetsState, listProjectToolTargets, setProjectSkillTargets, updateProjectToolTargets } from "../src/server/skillhub/projectSkills.js";
import { toolIds, type AppConfig, type Project, type SkillHubSkill, type SkillHubSource, type ToolId } from "../src/shared/types.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;

afterEach(() => {
  if (directory) cleanup(directory);
  directory = null;
});

describe("SkillHub", () => {
  it("seeds bundled mattpocock and unity skills as ordinary SkillHub entries", () => {
    directory = testDir("skillhub-default-skills");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);

    const listed = listSkillHub(db, config, directory);
    const tdd = listed.skills.find((skill) => skill.folderName === "tdd");
    const unity = listed.skills.find((skill) => skill.folderName === "unity-mcp-skill");

    expect(listed.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "mattpocock-skills", type: "github", label: "mattpocock/skills", repoKey: "mattpocock-skills" }),
        expect.objectContaining({ id: "skills", type: "local", label: "skills" })
      ])
    );
    expect(tdd).toMatchObject({ sourceId: "mattpocock-skills", libraryRelativePath: "mattpocock-skills/skills/engineering/tdd" });
    expect(unity).toMatchObject({ sourceId: "skills", libraryRelativePath: "skills/unity-mcp-skill" });
    expect(tdd).not.toHaveProperty("builtin");
    expect(unity).not.toHaveProperty("builtin");
    db.close();
  });

  it("groups direct library skills under one skills source", () => {
    directory = testDir("skillhub-direct-skills-source");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);
    const review = path.join(directory, "review");
    const triage = path.join(directory, "triage");
    writeSkill(review, "review", "Review code");
    writeSkill(triage, "triage", "Triage issues");

    const reviewResult = importLocalSkills(db, config, directory, review);
    const triageResult = importLocalSkills(db, config, directory, triage);
    const skills = db.listSkillHubSkills();

    expect(reviewResult.source).toMatchObject({ id: "skills", label: "skills", type: "local" });
    expect(triageResult.source).toMatchObject({ id: "skills", label: "skills", type: "local" });
    expect(skills.map((skill) => skill.libraryRelativePath)).toEqual(["skills/review", "skills/triage"]);
    expect(skills.map((skill) => skill.source?.label)).toEqual(["skills", "skills"]);
    expect(db.listSkillHubSources().filter((source) => source.id === "skills")).toHaveLength(1);
    db.close();
  });

  it("assigns historical direct library skills to the skills source when listing", () => {
    directory = testDir("skillhub-direct-skills-source-migration");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);
    const oldSource = db.upsertSkillHubSource({
      id: "source-old",
      type: "local",
      label: "review",
      repoKey: null,
      owner: null,
      repo: null,
      branch: null,
      input: path.join(directory, "review"),
      inputPath: null,
      resolvedPath: path.join(directory, "review"),
      currentRevision: null,
      checkoutPath: null
    });
    const libraryPath = path.join(config.skillhub.rootDir, "library", "skills", "review");
    writeSkill(libraryPath, "review", "Historical review skill");
    db.upsertSkillHubSkill({
      id: "skill-old",
      sourceId: oldSource.id,
      sourceType: oldSource.type,
      folderName: "review",
      skillName: "review",
      description: "Historical review skill",
      libraryRelativePath: "skills/review",
      libraryPath,
      sourceRelativePath: "review",
      contentHash: "old-hash"
    });

    const listed = listSkillHub(db, config, directory);
    const historicalSkill = listed.skills.find((skill) => skill.id === "skill-old");

    expect(historicalSkill).toMatchObject({ id: "skill-old", sourceId: "skills", source: { id: "skills", label: "skills" } });
    expect(db.getSkillHubSkill("skill-old")?.source?.id).toBe("skills");
    db.close();
  });

  it("marks historical PluginHub skills as plugin-owned when listing", () => {
    directory = testDir("skillhub-plugin-source-migration");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);
    const oldSource = db.upsertSkillHubSource({
      id: "pluginhub-source-old",
      type: "local",
      label: "team-plugin",
      repoKey: null,
      owner: null,
      repo: null,
      branch: null,
      input: path.join(directory, "plugin"),
      inputPath: null,
      resolvedPath: path.join(directory, "plugin"),
      currentRevision: null,
      checkoutPath: null
    });
    const libraryPath = path.join(config.skillhub.rootDir, "library", "pluginhub", oldSource.id, "plugins", "team", "skills", "review");
    writeSkill(libraryPath, "review", "Historical plugin skill");
    db.upsertSkillHubSkill({
      id: "plugin-skill-old",
      sourceId: oldSource.id,
      sourceType: oldSource.type,
      folderName: "review",
      skillName: "review",
      description: "Historical plugin skill",
      libraryRelativePath: `pluginhub/${oldSource.id}/plugins/team/skills/review`,
      libraryPath,
      sourceRelativePath: "plugins/team/skills/review",
      contentHash: "plugin-hash"
    });

    const listed = listSkillHub(db, config, directory);
    const historicalSkill = listed.skills.find((skill) => skill.id === "plugin-skill-old");

    expect(historicalSkill).toMatchObject({ sourceType: "plugin", source: { id: oldSource.id, type: "plugin" } });
    expect(db.getSkillHubSource(oldSource.id)).toMatchObject({ type: "plugin" });
    expect(db.getSkillHubSkill("plugin-skill-old")).toMatchObject({ sourceType: "plugin", source: { type: "plugin" } });
    db.close();
  });

  it("imports local skills parent-first and keeps same folder names from different library paths", () => {
    directory = testDir("skillhub-local-import");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);
    const sourceA = path.join(directory, "source-a");
    const sourceB = path.join(directory, "source-b");
    writeSkill(path.join(sourceA, "skills", "review"), "review", "A review skill");
    writeSkill(path.join(sourceA, "skills", "review", "examples", "nested"), "nested", "Should not import");
    writeSkill(path.join(sourceB, "skills", "review"), "review", "B review skill");
    fs.mkdirSync(path.join(sourceA, "skills", "invalid"), { recursive: true });

    const resultA = importLocalSkills(db, config, directory, sourceA);
    const resultB = importLocalSkills(db, config, directory, sourceB);

    expect(resultA.imported.map((skill) => skill.libraryRelativePath)).toEqual(["source-a/skills/review"]);
    expect(resultB.imported.map((skill) => skill.libraryRelativePath)).toEqual(["source-b/skills/review"]);
    expect(db.listSkillHubSkills().map((skill) => skill.folderName)).toEqual(["review", "review"]);
    expect(db.listSkillHubSkills().map((skill) => skill.libraryRelativePath)).toEqual(["source-a/skills/review", "source-b/skills/review"]);
    expect(fs.existsSync(path.join(config.skillhub.rootDir, "library", "source-a", "skills", "review", "SKILL.md"))).toBe(true);
    db.close();
  });

  it("imports and repairs skill metadata from SKILL.md descriptions", () => {
    directory = testDir("skillhub-skill-metadata-repair");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);
    const source = path.join(directory, "AICodingConfig");
    const description = "编写 Unity 编辑器工具（EditorWindow / Inspector / 编辑器面板）";
    writeBomSkill(path.join(source, "skills", "compose-editor-tool"), "compose-editor-tool", description);
    writeBareMetadataSkill(path.join(source, "skills", "compose-imgui"), "compose-imgui", "编写 IMGUI 编辑器界面");

    const imported = importLocalSkills(db, config, directory, source);
    const editorTool = imported.imported.find((skill) => skill.folderName === "compose-editor-tool");
    const imguiTool = imported.imported.find((skill) => skill.folderName === "compose-imgui");
    expect(editorTool).toMatchObject({ skillName: "compose-editor-tool", description });
    expect(imguiTool).toMatchObject({ skillName: "compose-imgui", description: "编写 IMGUI 编辑器界面" });

    db.upsertSkillHubSkill({
      ...editorTool!,
      skillName: "Skill Instructions",
      description: null
    });

    const listed = listSkillHub(db, config, directory);
    const repaired = listed.skills.find((skill) => skill.id === editorTool?.id);
    expect(repaired).toMatchObject({ skillName: "compose-editor-tool", description });
    expect(db.getSkillHubSkill(editorTool!.id)).toMatchObject({ skillName: "compose-editor-tool", description });
    db.close();
  });

  it("creates project skill links, handles same-name replacement, and deletes references before center content", () => {
    directory = testDir("skillhub-project-links");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    const sourceA = path.join(directory, "source-a");
    const sourceB = path.join(directory, "source-b");
    writeSkill(path.join(sourceA, "skills", "review"), "review", "A review skill");
    writeSkill(path.join(sourceB, "skills", "review"), "review", "B review skill");
    const skillA = importLocalSkills(db, config, directory, sourceA).imported[0];
    const skillB = importLocalSkills(db, config, directory, sourceB).imported[0];

    const inferred = listProjectToolTargets(db, project).find((target) => target.toolId === "codex");
    expect(inferred).toMatchObject({ enabled: true, supported: true, inferred: true });
    updateProjectToolTargets(db, project, ["codex"]);
    const first = setProjectSkillTargets(db, project, skillA.id, ["codex"]);
    expect(first.failures).toEqual([]);
    expect(fs.existsSync(path.join(projectRoot, ".codex", "skills", "review"))).toBe(true);

    const conflict = setProjectSkillTargets(db, project, skillB.id, ["codex"]);
    expect(conflict.requiresConfirmation).toBe(true);
    expect(conflict.conflicts[0]).toMatchObject({ toolId: "codex", requestedSkill: { id: skillB.id } });

    const replaced = setProjectSkillTargets(db, project, skillB.id, ["codex"], { replaceConflicts: true });
    expect(replaced.failures).toEqual([]);
    expect(db.getSkillHubSkill(skillA.id)).not.toBeNull();
    expect(db.listProjectSkillTargetsForSkill(skillB.id)).toHaveLength(1);

    const deleted = deleteSkillHubSkill(db, skillB.id);
    expect(deleted.affectedTargets).toHaveLength(1);
    expect(fs.existsSync(skillB.libraryPath)).toBe(false);
    expect(db.listProjectSkillTargetsForSkill(skillB.id)).toEqual([]);
    db.close();
  });

  it("links SkillHub skills into supported non-CLI project config targets without making them session tools", () => {
    directory = testDir("skillhub-non-cli-project-targets");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    const supportedTargets = [
      { toolId: "zcode" as const, directoryName: ".zcode" },
      { toolId: "trae-solo" as const, directoryName: ".trae" }
    ];
    const unsupportedTarget = { toolId: "workbuddy" as const, directoryName: ".workbuddy" };
    const nonCliTargets = [...supportedTargets, unsupportedTarget];
    for (const target of nonCliTargets) {
      fs.mkdirSync(path.join(projectRoot, target.directoryName), { recursive: true });
    }
    const project = db.addProject(projectRoot).project;
    const source = path.join(directory, "source");
    writeSkill(path.join(source, "skills", "review"), "review", "Review skill");
    const skill = importLocalSkills(db, config, directory, source).imported[0];

    const toolTargets = new Map(listProjectToolTargets(db, project).map((target) => [target.toolId, target]));
    for (const target of supportedTargets) {
      expect(toolIds).not.toContain(target.toolId);
      expect(toolTargets.get(target.toolId)).toMatchObject({
        enabled: true,
        inferred: true,
        supported: true,
        skillDirectory: path.join(projectRoot, target.directoryName, "skills")
      });
    }
    expect(toolIds).not.toContain(unsupportedTarget.toolId);
    expect(toolTargets.get(unsupportedTarget.toolId)).toMatchObject({
      enabled: true,
      inferred: true,
      supported: false,
      skillDirectory: null,
      reason: expect.stringContaining("未提供项目技能目录")
    });

    updateProjectToolTargets(db, project, nonCliTargets.map((target) => target.toolId));
    const linked = setProjectSkillTargets(db, project, skill.id, nonCliTargets.map((target) => target.toolId));

    expect(linked.failures).toHaveLength(1);
    expect(linked.failures[0]).toMatchObject({ toolId: "workbuddy", reason: expect.stringContaining("未提供项目技能目录") });
    for (const target of supportedTargets) {
      const linkPath = path.join(projectRoot, target.directoryName, "skills", "review");
      expect(linked.targets).toContainEqual(expect.objectContaining({ toolId: target.toolId, linkPath }));
      expect(fs.existsSync(linkPath)).toBe(true);
    }
    expect(fs.existsSync(path.join(projectRoot, ".workbuddy", "skills", "review"))).toBe(false);
    db.close();
  });

  it("resolves each local SkillHub link once instead of comparing against every center skill", () => {
    const project = projectFixture("E:\\repo");
    const config = configFixture("E:\\data");
    const projectRoot = project.rootPath;
    const libraryRoot = path.join(config.skillhub.rootDir, "library", "source", "skills");
    const skillDirectory = path.join(projectRoot, ".codex", "skills");
    const linkPath = path.join(skillDirectory, "skill-02");
    const skillFile = path.join(linkPath, "SKILL.md");
    const linkTarget = path.join(libraryRoot, "skill-02");
    const source: SkillHubSource = {
      id: "source",
      type: "local",
      label: "source",
      input: "E:\\source",
      inputPath: null,
      resolvedPath: "E:\\source",
      repoKey: null,
      remoteUrl: null,
      owner: null,
      repo: null,
      branch: null,
      currentRevision: null,
      checkoutPath: null,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z"
    };
    const skills: SkillHubSkill[] = Array.from({ length: 3 }, (_, index) => {
      const folderName = `skill-${String(index).padStart(2, "0")}`;
      const libraryPath = path.join(libraryRoot, folderName);
      return {
        id: `skill-${index}`,
        sourceId: source.id,
        sourceType: source.type,
        folderName,
        skillName: folderName,
        description: folderName,
        libraryRelativePath: `source/skills/${folderName}`,
        libraryPath,
        sourceRelativePath: `skills/${folderName}`,
        contentHash: `hash-${index}`,
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z",
        source
      };
    });
    const database = {
      listStoredProjectToolTargets: () => [
        {
          projectId: project.id,
          toolId: "codex",
          enabled: true,
          inferred: false,
          supported: true,
          skillDirectory,
          reason: null,
          updatedAt: "2026-06-01T00:00:00Z"
        }
      ],
      listSessionsForProject: () => [],
      upsertProjectToolTarget: () => null,
      listSkillHubSkills: () => skills,
      listSkillHubSources: () => [source],
      listProjectPluginBindings: () => []
    } as unknown as AppDatabase;

    const existsSync = vi.spyOn(fs, "existsSync").mockImplementation((input) => {
      const value = path.normalize(String(input));
      if (value === path.normalize(skillDirectory) || value === path.normalize(skillFile)) return true;
      return false;
    });
    const readdirSync = vi.spyOn(fs, "readdirSync").mockImplementation((input) => {
      if (path.normalize(String(input)) === path.normalize(skillDirectory)) {
        return [{ name: "skill-02", isDirectory: () => false, isSymbolicLink: () => true }] as fs.Dirent[];
      }
      return [];
    });
    const statSync = vi.spyOn(fs, "statSync").mockImplementation((input) => {
      if (path.normalize(String(input)) === path.normalize(skillFile)) return { isFile: () => true } as fs.Stats;
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    const lstatSync = vi.spyOn(fs, "lstatSync").mockImplementation((input) => {
      if (path.normalize(String(input)) === path.normalize(linkPath)) return { isSymbolicLink: () => true } as fs.Stats;
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    const readFileSync = vi.spyOn(fs, "readFileSync").mockImplementation((input) => {
      if (path.normalize(String(input)) === path.normalize(skillFile)) return skillText("skill-02", "skill-02");
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    const readlinkSync = vi.spyOn(fs, "readlinkSync");
    readlinkSync.mockReturnValue(linkTarget);
    try {
      const state = listProjectLocalSkillsState(database, project, config);
      expect(state.skills).toMatchObject([{ type: "skillhub", folderName: "skill-02" }]);
      expect(readlinkSync).toHaveBeenCalledTimes(1);
    } finally {
      readlinkSync.mockRestore();
      readFileSync.mockRestore();
      lstatSync.mockRestore();
      statSync.mockRestore();
      readdirSync.mockRestore();
      existsSync.mockRestore();
    }
  });

  it("keeps SkillHub targets and library content when project link removal fails", () => {
    directory = testDir("skillhub-delete-link-failure");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);
    const source = path.join(directory, "source");
    writeSkill(path.join(source, "skills", "review"), "review", "Review skill");
    const imported = importLocalSkills(db, config, directory, source);
    const skill = imported.imported[0];
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(path.join(projectRoot, ".codex", "skills"), { recursive: true });
    const project = db.addProject(projectRoot).project;
    updateProjectToolTargets(db, project, ["codex"]);

    const linked = setProjectSkillTargets(db, project, skill.id, ["codex"]);
    const linkPath = linked.targets[0].linkPath;
    fs.unlinkSync(linkPath);
    fs.mkdirSync(linkPath, { recursive: true });
    fs.writeFileSync(path.join(linkPath, "SKILL.md"), skillText("local-review", "Local replacement"), "utf8");

    const deleted = deleteSkillHubSkill(db, skill.id);

    expect(deleted.failures).toEqual([expect.objectContaining({ linkPath, reason: "目标不是 SkillHub 创建的 link" })]);
    expect(fs.existsSync(skill.libraryPath)).toBe(true);
    expect(db.getSkillHubSkill(skill.id)).not.toBeNull();
    expect(db.listProjectSkillTargetsForSkill(skill.id)).toHaveLength(1);
    db.close();
  });

  it("does not infer Copilot from generic GitHub or VS Code project folders", () => {
    directory = testDir("skillhub-project-tool-targets-generic-github-vscode");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(path.join(projectRoot, ".github", "workflows"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".vscode"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".github", "workflows", "ci.yml"), "name: ci\n", "utf8");
    fs.writeFileSync(path.join(projectRoot, ".vscode", "settings.json"), "{}\n", "utf8");
    const project = db.addProject(projectRoot).project;
    db.upsertProjectToolTarget(project.id, "copilot", true, true);

    const copilot = listProjectToolTargets(db, project).find((target) => target.toolId === "copilot");

    db.close();
    expect(copilot).toMatchObject({ enabled: false, inferred: true });
  });

  it("infers Copilot from explicit copilot instructions", () => {
    directory = testDir("skillhub-project-tool-targets-copilot-instructions");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(path.join(projectRoot, ".github"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".github", "copilot-instructions.md"), "Use project conventions.\n", "utf8");
    const project = db.addProject(projectRoot).project;

    const copilot = listProjectToolTargets(db, project).find((target) => target.toolId === "copilot");

    db.close();
    expect(copilot).toMatchObject({ enabled: true, inferred: true });
  });

  it("supports SkillHub links for all built-in project CLI skill targets", () => {
    directory = testDir("skillhub-built-in-project-cli-targets");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = db.addProject(projectRoot).project;
    const source = path.join(directory, "source");
    writeSkill(path.join(source, "skills", "review"), "review", "Review skill");
    const skill = importLocalSkills(db, config, directory, source).imported[0];
    const expectedDirectories: Array<[ToolId, string]> = [
      ["antigravity", path.join(projectRoot, ".agents", "skills")],
      ["claude", path.join(projectRoot, ".claude", "skills")],
      ["cline", path.join(projectRoot, ".cline", "skills")],
      ["codebuddy", path.join(projectRoot, ".codebuddy", "skills")],
      ["codex", path.join(projectRoot, ".codex", "skills")],
      ["cursor", path.join(projectRoot, ".cursor", "skills")],
      ["copilot", path.join(projectRoot, ".github", "skills")],
      ["kilo", path.join(projectRoot, ".kilo", "skills")],
      ["kimi", path.join(projectRoot, ".kimi-code", "skills")],
      ["opencode", path.join(projectRoot, ".opencode", "skills")],
      ["qoder", path.join(projectRoot, ".qoder", "skills")],
      ["qwen", path.join(projectRoot, ".qwen", "skills")],
      ["trae", path.join(projectRoot, ".traecli", "skills")]
    ];

    updateProjectToolTargets(
      db,
      project,
      expectedDirectories.map(([toolId]) => toolId)
    );
    const toolTargets = new Map(listProjectToolTargets(db, project).map((target) => [target.toolId, target]));
    for (const [toolId, skillDirectory] of expectedDirectories) {
      expect(toolTargets.get(toolId)).toMatchObject({ enabled: true, supported: true, skillDirectory });
    }

    const linked = setProjectSkillTargets(
      db,
      project,
      skill.id,
      expectedDirectories.map(([toolId]) => toolId)
    );

    expect(linked.failures).toEqual([]);
    expect(linked.targets).toHaveLength(expectedDirectories.length);
    for (const [, skillDirectory] of expectedDirectories) {
      expect(fs.existsSync(path.join(skillDirectory, "review"))).toBe(true);
    }
    db.close();
  });

  it("treats shared public skill directories as one target group and keeps private fallbacks", () => {
    directory = testDir("skillhub-public-directory-groups");
    const privateConfig = configFixture(directory);
    const publicConfig = configFixture(directory);
    publicConfig.projectResources.directoryPreference = "public";
    for (const toolId of toolIds) {
      privateConfig.tools[toolId].command = process.execPath;
      publicConfig.tools[toolId].command = process.execPath;
    }
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = db.addProject(projectRoot).project;
    const source = path.join(directory, "source");
    writeSkill(path.join(source, "skills", "review"), "review", "Review skill");
    const skill = importLocalSkills(db, publicConfig, directory, source).imported[0];

    updateProjectToolTargets(db, project, ["codex", "opencode", "kimi"], privateConfig);
    const privateLinked = setProjectSkillTargets(db, project, skill.id, ["codex"], {}, privateConfig);
    expect(privateLinked.failures).toEqual([]);
    expect(fs.existsSync(path.join(projectRoot, ".codex", "skills", "review"))).toBe(true);

    updateProjectToolTargets(db, project, ["codex", "opencode", "kimi"], publicConfig);
    const publicLinked = setProjectSkillTargets(db, project, skill.id, ["codex", "opencode"], {}, publicConfig);
    expect(publicLinked.failures).toEqual([]);
    expect([...new Set(publicLinked.targets.map((target) => target.toolId))].sort()).toEqual(["codex", "kimi", "opencode"]);
    expect(fs.existsSync(path.join(projectRoot, ".agents", "skills", "review"))).toBe(true);
    expect(
      [...new Set(listProjectSkillTargetsState(db, project, publicConfig)
        .skillTargets.filter((target) => target.skillId === skill.id)
        .map((target) => target.toolId))]
        .sort()
    ).toEqual(["codex", "kimi", "opencode"]);

    const removedPublic = setProjectSkillTargets(db, project, skill.id, ["codex", "kimi"], {}, publicConfig);
    expect(removedPublic.failures).toEqual([]);
    expect(fs.existsSync(path.join(projectRoot, ".agents", "skills", "review"))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, ".codex", "skills", "review"))).toBe(true);
    expect(
      [...new Set(listProjectSkillTargetsState(db, project, publicConfig)
        .skillTargets.filter((target) => target.skillId === skill.id)
        .map((target) => target.toolId))]
        .sort()
    ).toEqual(["codex"]);
    db.close();
  }, 60000);

  it("infers newly supported tool targets from their project skill directories", () => {
    directory = testDir("skillhub-project-tool-targets-skill-directories");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(path.join(projectRoot, ".cline", "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".kimi-code", "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".codebuddy", "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".github", "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".traecli", "skills", "review"), { recursive: true });
    const project = db.addProject(projectRoot).project;

    const targets = new Map(listProjectToolTargets(db, project).map((target) => [target.toolId, target]));

    db.close();
    expect(targets.get("cline")).toMatchObject({ enabled: true, inferred: true });
    expect(targets.get("kimi")).toMatchObject({ enabled: true, inferred: true });
    expect(targets.get("codebuddy")).toMatchObject({ enabled: true, inferred: true });
    expect(targets.get("copilot")).toMatchObject({ enabled: true, inferred: true });
    expect(targets.get("trae")).toMatchObject({ enabled: true, inferred: true });
  });

  it("keeps project skill links scoped to root and child directories under one managed project", () => {
    directory = testDir("skillhub-project-child-links");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    const childRoot = path.join(projectRoot, "packages", "app");
    fs.mkdirSync(childRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot, true).project;
    const childScope: Project = {
      ...project,
      rootPath: childRoot,
      normalizedRootPath: childRoot.toLowerCase(),
      includeSubdirectories: false
    };
    const source = path.join(directory, "source");
    writeSkill(path.join(source, "skills", "review"), "review", "Review skill");
    const skill = importLocalSkills(db, config, directory, source).imported[0];

    updateProjectToolTargets(db, project, ["codex"]);
    expect(setProjectSkillTargets(db, project, skill.id, ["codex"]).failures).toEqual([]);
    expect(setProjectSkillTargets(db, childScope, skill.id, ["codex"]).failures).toEqual([]);

    const rootLink = path.join(projectRoot, ".codex", "skills", "review");
    const childLink = path.join(childRoot, ".codex", "skills", "review");
    expect(fs.existsSync(rootLink)).toBe(true);
    expect(fs.existsSync(childLink)).toBe(true);
    expect(db.listProjectSkillTargetsForSkill(skill.id)).toHaveLength(2);
    expect(listProjectSkillTargetsState(db, project).skillTargets.map((target) => target.linkPath)).toEqual([rootLink]);
    expect(listProjectSkillTargetsState(db, childScope).skillTargets.map((target) => target.linkPath)).toEqual([childLink]);

    const removed = setProjectSkillTargets(db, childScope, skill.id, []);
    expect(removed.removed.map((target) => target.linkPath)).toEqual([childLink]);
    expect(fs.existsSync(rootLink)).toBe(true);
    expect(fs.existsSync(childLink)).toBe(false);
    expect(db.listProjectSkillTargetsForSkill(skill.id)).toHaveLength(1);
    db.close();
  });

  it("lists project SkillHub and Local skills and migrates a local skill into SkillHub", () => {
    directory = testDir("skillhub-project-local-migrate");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    const localSkillPath = path.join(projectRoot, ".codex", "skills", "review");
    writeSkill(localSkillPath, "review", "Local review");

    const before = listProjectLocalSkillsState(db, project);
    expect(before.skills).toMatchObject([{ type: "local", toolId: "codex", folderName: "review", migratable: true }]);

    const result = migrateProjectLocalSkill(db, config, directory, project, "codex", "review");
    const after = listProjectLocalSkillsState(db, project);

    expect(result).toMatchObject({ action: "migrated", requiresConfirmation: false, skill: { folderName: "review" } });
    expect(fs.lstatSync(localSkillPath).isSymbolicLink()).toBe(true);
    expect(after.skills).toMatchObject([{ type: "skillhub", toolId: "codex", folderName: "review" }]);
    expect(db.listProjectSkillTargetsForSkill(result.skill?.id ?? "")).toHaveLength(1);
    expect(fs.existsSync(path.join(config.skillhub.rootDir, "library", "skills", "review", "SKILL.md"))).toBe(true);
    db.close();
  });

  it("migrates a project local skill into a selected existing local source", () => {
    directory = testDir("skillhub-project-local-migrate-existing-source");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    const sourceRoot = path.join(directory, "source-a");
    writeSkill(path.join(sourceRoot, "skills", "review"), "review", "Source review");
    const source = importLocalSkills(db, config, directory, sourceRoot).source;
    const localSkillPath = path.join(projectRoot, ".codex", "skills", "triage");
    writeSkill(localSkillPath, "triage", "Local triage");

    const result = migrateProjectLocalSkill(db, config, directory, project, "codex", "triage", null, { type: "existing-source", sourceId: source.id });

    expect(result).toMatchObject({
      action: "migrated",
      requiresConfirmation: false,
      skill: { folderName: "triage", sourceId: source.id, libraryRelativePath: "source-a/skills/triage" }
    });
    expect(fs.existsSync(path.join(sourceRoot, "skills", "triage", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(config.skillhub.rootDir, "library", "source-a", "skills", "triage", "SKILL.md"))).toBe(true);
    expect(fs.lstatSync(localSkillPath).isSymbolicLink()).toBe(true);
    db.close();
  });

  it("migrates a project local skill into a new local source even when another source has the same folder name", () => {
    directory = testDir("skillhub-project-local-migrate-new-source");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    const sourceRoot = path.join(directory, "source-a");
    writeSkill(path.join(sourceRoot, "skills", "review"), "review", "Existing review");
    importLocalSkills(db, config, directory, sourceRoot);
    const localSkillPath = path.join(projectRoot, ".codex", "skills", "review");
    writeSkill(localSkillPath, "review", "Local review");
    const targetSourceRoot = path.join(directory, "team-source");

    const result = migrateProjectLocalSkill(db, config, directory, project, "codex", "review", null, { type: "new-source", path: targetSourceRoot });

    expect(result).toMatchObject({
      action: "migrated",
      requiresConfirmation: false,
      skill: { folderName: "review", libraryRelativePath: "team-source/skills/review" }
    });
    expect(db.listSkillHubSkills().filter((skill) => skill.folderName === "review")).toHaveLength(2);
    expect(fs.existsSync(path.join(targetSourceRoot, "skills", "review", "SKILL.md"))).toBe(true);
    expect(fs.lstatSync(localSkillPath).isSymbolicLink()).toBe(true);
    db.close();
  });

  it("previews same-name local skill conflicts and can replace local content with an existing SkillHub link", () => {
    directory = testDir("skillhub-project-local-link-existing");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    const source = path.join(directory, "source");
    writeSkill(path.join(source, "skills", "review"), "review", "SkillHub review");
    const skill = importLocalSkills(db, config, directory, source).imported[0];
    const localSkillPath = path.join(projectRoot, ".codex", "skills", "review");
    writeSkill(localSkillPath, "review", "Local review");

    const preview = migrateProjectLocalSkill(db, config, directory, project, "codex", "review");
    const linked = migrateProjectLocalSkill(db, config, directory, project, "codex", "review", "link-existing");

    expect(preview).toMatchObject({ action: "needs-confirmation", requiresConfirmation: true });
    expect(preview.conflictSkills.map((conflict) => conflict.id)).toEqual([skill.id]);
    expect(linked).toMatchObject({ action: "linked-existing", skill: { id: skill.id } });
    expect(fs.lstatSync(localSkillPath).isSymbolicLink()).toBe(true);
    expect(db.getSkillHubSkill(skill.id)?.description).toBe("SkillHub review");
    db.close();
  });

  it("can overwrite a same-name SkillHub skill from a project local skill before linking it", () => {
    directory = testDir("skillhub-project-local-overwrite");
    const config = configFixture(directory);
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "rules", "utf8");
    const project = db.addProject(projectRoot).project;
    const source = path.join(directory, "source");
    writeSkill(path.join(source, "skills", "review"), "review", "Old SkillHub review");
    const skill = importLocalSkills(db, config, directory, source).imported[0];
    const localSkillPath = path.join(projectRoot, ".codex", "skills", "review");
    writeSkill(localSkillPath, "review", "New local review");

    const overwritten = migrateProjectLocalSkill(db, config, directory, project, "codex", "review", "overwrite-skillhub");

    expect(overwritten).toMatchObject({ action: "overwrote-skillhub", skill: { id: skill.id, description: "New local review" } });
    expect(fs.readFileSync(path.join(skill.libraryPath, "SKILL.md"), "utf8")).toContain("New local review");
    expect(fs.lstatSync(localSkillPath).isSymbolicLink()).toBe(true);
    db.close();
  });

  (gitAvailable() ? it : it.skip)(
    "checks and applies GitHub source updates from a local git fixture",
    () => {
      directory = testDir("skillhub-github-update");
      const config = configFixture(directory);
      const db = new AppDatabase(directory);
      const repo = path.join(directory, "remote-repo");
      gitInit(repo);
      writeSkill(path.join(repo, "skills", "review"), "review", "Initial");
      git(repo, ["add", "."]);
      git(repo, ["commit", "-m", "initial"]);

      const imported = importGitHubSource(db, config, directory, "owner/repo", { fixturePath: repo });
      expect(imported.imported[0].libraryRelativePath).toBe("owner-repo/skills/review");

      fs.writeFileSync(path.join(repo, "skills", "review", "SKILL.md"), skillText("review", "Changed"), "utf8");
      git(repo, ["add", "."]);
      git(repo, ["commit", "-m", "change review"]);

      const preview = checkGitHubUpdates(db, config, directory).previews[0];
      expect(preview.items.map((item) => item.kind)).toEqual(["changed"]);
      applyGitHubSourceUpdate(db, config, directory, imported.source.id);
      expect(db.getSkillHubSkill(imported.imported[0].id)?.description).toBe("Changed");
      db.close();
    },
    15000
  );

  (gitAvailable() ? it : it.skip)(
    "uses the SKILL.md name for a GitHub source whose repository root is the skill",
    () => {
      directory = testDir("skillhub-github-root-skill-name");
      const config = configFixture(directory);
      const db = new AppDatabase(directory);
      const repo = path.join(directory, "remote-root-skill");
      gitInit(repo);
      fs.writeFileSync(
        path.join(repo, "SKILL.md"),
        `---\nname: code-review-skill\ndescription: |\n  Provides comprehensive code review guidance.\n  Helps catch bugs.\n---\n\n# Code Review Skill\n`,
        "utf8"
      );
      git(repo, ["add", "."]);
      git(repo, ["commit", "-m", "initial"]);

      const imported = importGitHubSource(db, config, directory, "owner/repo", { fixturePath: repo });
      const skill = imported.imported[0];

      expect(skill).toMatchObject({
        folderName: "code-review-skill",
        skillName: "code-review-skill",
        description: "Provides comprehensive code review guidance. Helps catch bugs."
      });

      db.upsertSkillHubSkill({
        id: skill.id,
        sourceId: skill.sourceId,
        sourceType: skill.sourceType,
        folderName: "checkout",
        skillName: skill.skillName,
        description: "|",
        libraryRelativePath: skill.libraryRelativePath,
        libraryPath: skill.libraryPath,
        sourceRelativePath: skill.sourceRelativePath,
        contentHash: skill.contentHash
      });

      expect(listSkillHub(db, config, directory).skills.find((item) => item.id === skill.id)).toMatchObject({
        folderName: "code-review-skill",
        description: "Provides comprehensive code review guidance. Helps catch bugs."
      });

      db.upsertSkillHubSkill({
        id: skill.id,
        sourceId: skill.sourceId,
        sourceType: skill.sourceType,
        folderName: "checkout",
        skillName: skill.skillName,
        description: "|",
        libraryRelativePath: skill.libraryRelativePath,
        libraryPath: skill.libraryPath,
        sourceRelativePath: skill.sourceRelativePath,
        contentHash: skill.contentHash
      });

      const reimported = importGitHubSource(db, config, directory, "owner/repo", { fixturePath: repo });
      expect(reimported.updated[0]).toMatchObject({
        id: skill.id,
        folderName: "code-review-skill",
        description: "Provides comprehensive code review guidance. Helps catch bugs."
      });
      expect(db.getSkillHubSkill(skill.id)).toMatchObject({
        folderName: "code-review-skill",
        description: "Provides comprehensive code review guidance. Helps catch bugs."
      });
      db.close();
    },
    15000
  );

  (gitAvailable() ? it : it.skip)("commits the dirty target rule file separately before manual rule sync", () => {
    directory = testDir("skillhub-rule-sync");
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "source rules\n", "utf8");
    fs.writeFileSync(path.join(projectRoot, "CLAUDE.md"), "old rules\n", "utf8");
    fs.writeFileSync(path.join(projectRoot, "notes.txt"), "unrelated\n", "utf8");
    gitInit(projectRoot);
    git(projectRoot, ["add", "CLAUDE.md"]);
    git(projectRoot, ["commit", "-m", "track claude"]);
    fs.writeFileSync(path.join(projectRoot, "CLAUDE.md"), "manual edits\n", "utf8");
    const project = projectFixture(projectRoot);

    const status = getRuleSyncStatus(project);
    expect(status.files["CLAUDE.md"]).toMatchObject({ gitManaged: true, dirty: true });
    const commit = commitRuleSyncTarget(project, "agents-to-claude");
    expect(commit.action).toBe("committed");
    expect(commit.backupCommit).toBeTruthy();
    expect(fs.readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8")).toBe("manual edits\n");

    const result = applyRuleSync(project, "agents-to-claude");

    expect(result.action).toBe("overwritten");
    expect(result.backupCommit).toBeNull();
    expect(fs.readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8")).toBe("source rules\n");
    expect(git(projectRoot, ["diff", "--cached", "--name-only"])).toBe("");
  });

  (gitAvailable() ? it : it.skip)("commits an untracked target rule file before manual rule sync", () => {
    directory = testDir("skillhub-rule-sync-untracked");
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "source rules\n", "utf8");
    fs.writeFileSync(path.join(projectRoot, "CLAUDE.md"), "old rules\n", "utf8");
    gitInit(projectRoot);
    git(projectRoot, ["add", "AGENTS.md"]);
    git(projectRoot, ["commit", "-m", "track agents"]);
    const project = projectFixture(projectRoot);

    const status = getRuleSyncStatus(project);
    expect(status.files["CLAUDE.md"]).toMatchObject({ gitManaged: false, dirty: null });

    const commit = commitRuleSyncTarget(project, "agents-to-claude");

    expect(commit.action).toBe("committed");
    expect(commit.backupCommit).toBeTruthy();
    expect(getRuleSyncStatus(project).files["CLAUDE.md"]).toMatchObject({ gitManaged: true, dirty: false });
    expect(fs.readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8")).toBe("old rules\n");
  });

  (gitAvailable() ? it : it.skip)("initializes git when committing a target rule file outside version control", () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "skillhub-rule-sync-git-init-"));
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "source rules\n", "utf8");
    fs.writeFileSync(path.join(projectRoot, "CLAUDE.md"), "old rules\n", "utf8");
    const project = projectFixture(projectRoot);

    const status = getRuleSyncStatus(project);
    expect(status.gitRoot).toBeNull();
    expect(status.files["CLAUDE.md"]).toMatchObject({ gitManaged: null, dirty: null });

    const commit = commitRuleSyncTarget(project, "agents-to-claude");

    expect(commit.action).toBe("committed");
    expect(commit.backupCommit).toBeTruthy();
    const refreshed = getRuleSyncStatus(project);
    expect(path.resolve(refreshed.gitRoot ?? "")).toBe(path.resolve(projectRoot));
    expect(refreshed.files["CLAUDE.md"]).toMatchObject({ gitManaged: true, dirty: false });
  });

  (gitAvailable() ? it : it.skip)("leaves git metadata unread for missing rule files in a git repo", () => {
    directory = testDir("skillhub-rule-sync-missing-git-metadata");
    const projectRoot = path.join(directory, "repo");
    gitInit(projectRoot);
    const project = projectFixture(projectRoot);

    const status = getRuleSyncStatus(project);

    expect(path.resolve(status.gitRoot ?? "")).toBe(path.resolve(projectRoot));
    expect(status.files["AGENTS.md"]).toMatchObject({ exists: false, gitManaged: null, dirty: null });
    expect(status.files["CLAUDE.md"]).toMatchObject({ exists: false, gitManaged: null, dirty: null });
  });

  it("previews and creates rule files from a template or another rule file", () => {
    directory = testDir("skillhub-rule-template");
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = projectFixture(projectRoot);

    const before = getRuleSyncStatus(project);
    expect(before.files["AGENTS.md"].exists).toBe(false);
    expect(before.files["CLAUDE.md"].exists).toBe(false);

    const preview = prepareRuleFileCreate(project, "CLAUDE.md", "template");

    expect(preview).toMatchObject({ file: "CLAUDE.md", source: "template", sourceFile: null });
    expect(preview.content).toBe(DEFAULT_CLAUDE_RULE_TEMPLATE);

    const editedContent = "# CLAUDE.md\n\nedited\n";
    const created = createRuleFile(project, "CLAUDE.md", editedContent);

    expect(created).toMatchObject({ file: "CLAUDE.md", action: "created", message: "已创建 CLAUDE.md" });
    expect(fs.readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8")).toBe(editedContent);
    expect(created.status.files["CLAUDE.md"].exists).toBe(true);
    expect(created.status.directions["claude-to-agents"].enabled).toBe(true);

    const syncPreview = prepareRuleFileCreate(project, "AGENTS.md", "sync");
    expect(syncPreview).toMatchObject({ file: "AGENTS.md", source: "sync", sourceFile: "CLAUDE.md" });
    expect(syncPreview.content).toBe(editedContent);
    expect(() => createRuleFile(project, "CLAUDE.md", "again")).toThrow("CLAUDE.md 已存在");
  });

  it("keeps the legacy CLAUDE.md template creator as a direct wrapper", () => {
    directory = testDir("skillhub-rule-template-legacy");
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = projectFixture(projectRoot);

    const created = createRuleTemplateFile(project);

    expect(created).toMatchObject({ file: "CLAUDE.md", action: "created", message: "已创建 CLAUDE.md" });
    expect(fs.readFileSync(path.join(projectRoot, "CLAUDE.md"), "utf8")).toBe(DEFAULT_CLAUDE_RULE_TEMPLATE);
  });
});

function configFixture(dataDir: string): AppConfig {
  return { ...defaultAppConfig(), skillhub: { rootDir: path.join(dataDir, "skillhub") } };
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

function projectFixture(rootPath: string): Project {
  return {
    id: "project-1",
    rootPath,
    normalizedRootPath: rootPath.toLowerCase(),
    includeSubdirectories: true,
    sessionOnly: false,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    childGroupCount: 0,
    sessionCount: 0
  };
}

function gitAvailable(): boolean {
  return spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
}

function gitInit(repo: string): void {
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "skillhub@example.test"]);
  git(repo, ["config", "user.name", "SkillHub Test"]);
}

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "git failed");
  }
  return result.stdout.trim();
}
