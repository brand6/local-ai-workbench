import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { defaultAppConfig } from "../src/server/core/bootstrap.js";
import { AppDatabase } from "../src/server/storage/database.js";
import { importGitHubSource, importLocalSkills, checkGitHubUpdates, applyGitHubSourceUpdate, deleteSkillHubSkill, listSkillHub } from "../src/server/skillhub/skillhub.js";
import { applyRuleSync, commitRuleSyncTarget, getRuleSyncStatus } from "../src/server/skillhub/ruleSync.js";
import { listProjectToolTargets, setProjectSkillTargets, updateProjectToolTargets } from "../src/server/skillhub/projectSkills.js";
import type { AppConfig, Project } from "../src/shared/types.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;

afterEach(() => {
  if (directory) cleanup(directory);
  directory = null;
});

describe("SkillHub", () => {
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

    expect(listed.skills[0]).toMatchObject({ id: "skill-old", sourceId: "skills", source: { id: "skills", label: "skills" } });
    expect(db.getSkillHubSkill("skill-old")?.source?.id).toBe("skills");
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
});

function configFixture(dataDir: string): AppConfig {
  return { ...defaultAppConfig(), skillhub: { rootDir: path.join(dataDir, "skillhub") } };
}

function writeSkill(directory: string, name: string, description: string): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), skillText(name, description), "utf8");
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
