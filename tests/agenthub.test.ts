import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyProjectAgentTarget,
  conversionPreview,
  deleteAgentHubAgent,
  deleteAgentHubSource,
  disableProjectAgentTarget,
  importBuiltInAgencyAgents,
  importLocalAgentFolder,
  listAgentHub,
  listProjectAgentState,
  migrateProjectLocalAgent,
  reparseAgentHubAgent,
  syncProjectAgents
} from "../src/server/agenthub/agenthub.js";
import { AppDatabase } from "../src/server/storage/database.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;

afterEach(() => {
  if (directory) cleanup(directory);
  directory = null;
});

describe("AgentHub", () => {
  it("lazily seeds packaged agency-agents as ordinary source data with searchable categories", () => {
    directory = testDir("agenthub-seed");
    const db = new AppDatabase(directory);
    const expectedAgentFiles = listPackagedAgencyAgentFiles();
    const expectedCategories = [...new Set(expectedAgentFiles.map((file) => file.split("/")[0]!))].sort();

    const first = listAgentHub(db, directory);
    const second = listAgentHub(db, directory, "academic-anthropologist");

    expect(first.sources).toHaveLength(1);
    expect(first.sources[0]).toMatchObject({ id: "agency-agents", type: "builtin", sourceTruthTool: "claude" });
    expect(expectedAgentFiles.length).toBeGreaterThan(200);
    expect(first.agents).toHaveLength(expectedAgentFiles.length);
    expect(first.agents.map((agent) => agent.sourceRelativePath).filter(isString).sort()).toEqual(expectedAgentFiles);
    expect([...new Set(first.agents.map((agent) => agent.category).filter(isString))].sort()).toEqual(expectedCategories);
    expect(first.agents.every((agent) => agent.sourceTruthTool === "claude" && agent.truthRole === "subagent")).toBe(true);
    expect(first.agents.map((agent) => agent.sourceRelativePath)).not.toContain("README.md");
    expect(first.agents.some((agent) => agent.sourceRelativePath?.includes("scripts"))).toBe(false);
    expect(first.agents.some((agent) => agent.slug === "engineering-code-reviewer")).toBe(true);
    expect(second.agents.map((agent) => agent.slug)).toEqual(["academic-anthropologist"]);

    const deleted = deleteAgentHubSource(db, directory, "agency-agents");
    expect(deleted.agentsDeleted).toHaveLength(expectedAgentFiles.length);
    expect(listAgentHub(db, directory, "", { seedDefaultSources: false }).agents).toHaveLength(0);

    const reimported = importBuiltInAgencyAgents(db, directory);
    expect(reimported.imported).toHaveLength(expectedAgentFiles.length);
    expect(listAgentHub(db, directory).agents).toHaveLength(expectedAgentFiles.length);
    db.close();
  }, 60000);

  it("upgrades an already-seeded packaged agency-agents source when the bundled snapshot changes", () => {
    directory = testDir("agenthub-upgrade-stale-builtin");
    const db = new AppDatabase(directory);
    const oldNativePath = path.join(directory, "agenthub", "library", "agency-agents", "engineering", "code-reviewer.md");
    fs.mkdirSync(path.dirname(oldNativePath), { recursive: true });
    fs.writeFileSync(oldNativePath, importedNative("Code Reviewer", "Old four-agent placeholder."), "utf8");
    const source = db.upsertAgentHubSource({
      id: "agency-agents",
      type: "builtin",
      label: "msitarzewski/agency-agents",
      inputPath: "builtin-agents/agency-agents",
      resolvedPath: path.join(process.cwd(), "builtin-agents", "agency-agents"),
      sourceTruthTool: "claude",
      importedAt: new Date(0).toISOString(),
      metadata: { packaged: true }
    });
    db.upsertAgentHubAgent(staleBuiltInAgent(source.id, oldNativePath));
    db.setSetting("agenthub.builtin.agency-agents.seeded.v1", true);

    const view = listAgentHub(db, directory);
    const expectedAgentFiles = listPackagedAgencyAgentFiles();

    expect(view.agents).toHaveLength(expectedAgentFiles.length);
    expect(view.agents.map((agent) => agent.sourceRelativePath)).not.toContain("engineering/code-reviewer.md");
    expect(view.agents.some((agent) => agent.slug === "engineering-code-reviewer")).toBe(true);
    expect(db.getAgentHubSource("agency-agents")?.metadata.packagedAgentCount).toBe(expectedAgentFiles.length);
    db.close();
  }, 60000);

  it("imports local native agents, detects conflicts, preserves stable slugs on reparse, and renders all MVP targets", () => {
    directory = testDir("agenthub-local-import");
    const db = new AppDatabase(directory);
    skipBuiltInAgencySeed(db);
    const sourceRoot = path.join(directory, "local-agents");
    fs.mkdirSync(path.join(sourceRoot, "nested"), { recursive: true });
    fs.writeFileSync(
      path.join(sourceRoot, "nested", "planner.md"),
      `---\nname: Planner\ndescription: Plans implementation slices\ntools: ["Read"]\n---\n\n# Planner\n\nCreate a narrow implementation plan.\n`,
      "utf8"
    );

    const imported = importLocalAgentFolder(db, directory, sourceRoot, "claude");
    expect(imported.imported).toHaveLength(1);
    const planner = imported.imported[0]!;
    expect(planner).toMatchObject({ slug: "planner", category: "nested", sourceTruthTool: "claude" });
    expect(fs.existsSync(planner.nativePath)).toBe(true);

    fs.writeFileSync(path.join(sourceRoot, "nested", "planner.md"), importedNative("Planner v2", "Changed content"), "utf8");
    const conflict = importLocalAgentFolder(db, directory, sourceRoot, "claude");
    expect(conflict.requiresConfirmation).toBe(true);
    expect(conflict.conflicts[0]?.slug).toBe("planner");

    const renamed = importLocalAgentFolder(db, directory, sourceRoot, "claude", {
      conflictResolutions: [{ slug: "planner", action: "rename", renameSlug: "planner-copy" }]
    });
    expect(renamed.imported[0]?.slug).toBe("planner-copy");

    fs.writeFileSync(planner.nativePath, importedNative("Planner renamed", "New center instructions"), "utf8");
    const reparsed = reparseAgentHubAgent(db, planner.id);
    expect(reparsed.name).toBe("Planner renamed");
    expect(reparsed.slug).toBe("planner");

    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["claude", "codex", "opencode", "cursor", "qwen"]);
    for (const toolId of ["claude", "codex", "opencode", "cursor", "qwen"] as const) {
      const preview = conversionPreview(reparsed, toolId, projectRoot, "create");
      expect(preview.targetPath).toContain(reparsed.slug);
      expect(preview.outputHash).toMatch(/^[a-f0-9]{64}$/);
      const applied = applyProjectAgentTarget(db, directory, project, reparsed.id, toolId);
      expect(applied.action).toBe("applied");
      expect(fs.existsSync(applied.preview.targetPath)).toBe(true);
    }
    expect(listProjectAgentState(db, directory, project).targets.filter((target) => target.binding && target.status === "current")).toHaveLength(5);

    const replacementRoot = path.join(directory, "replacement-agents");
    fs.mkdirSync(replacementRoot, { recursive: true });
    fs.writeFileSync(path.join(replacementRoot, "planner.md"), importedNative("Planner replacement", "Replacement planner."), "utf8");
    const replacement = importLocalAgentFolder(db, directory, replacementRoot, "claude").imported[0]!;
    const replacementPreview = applyProjectAgentTarget(db, directory, project, replacement.id, "codex");
    expect(replacementPreview).toMatchObject({ action: "needs-confirmation", requiresConfirmation: true });
    expect(replacementPreview.preview.action).toBe("replace-managed");
    expect(replacementPreview.replacedBindings[0]?.agentId).toBe(reparsed.id);
    const replaced = applyProjectAgentTarget(db, directory, project, replacement.id, "codex", { conflictMode: "replace-managed" });
    expect(replaced.binding?.id).toBe(replacementPreview.replacedBindings[0]?.id);
    expect(replaced.binding?.agentId).toBe(replacement.id);
    expect(db.listProjectAgentTargetsForAgent(reparsed.id).map((target) => target.toolId)).not.toContain("codex");
    db.close();
  });

  it("deletes a single AgentHub agent and its bindings without deleting project target files", () => {
    directory = testDir("agenthub-delete-agent");
    const db = new AppDatabase(directory);
    skipBuiltInAgencySeed(db);
    const sourceRoot = path.join(directory, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "reviewer.md"), importedNative("Reviewer", "Review the current patch."), "utf8");
    const agent = importLocalAgentFolder(db, directory, sourceRoot, "claude").imported[0]!;
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["claude"]);
    const applied = applyProjectAgentTarget(db, directory, project, agent.id, "claude");
    expect(fs.existsSync(applied.preview.targetPath)).toBe(true);

    const deleted = deleteAgentHubAgent(db, directory, agent.id);

    expect(deleted.agent.id).toBe(agent.id);
    expect(deleted.targetsDeleted.map((target) => target.toolId)).toEqual(["claude"]);
    expect(fs.existsSync(agent.nativePath)).toBe(false);
    expect(fs.existsSync(applied.preview.targetPath)).toBe(true);
    expect(db.getAgentHubAgent(agent.id)).toBeNull();
    expect(db.listProjectAgentTargetsForAgent(agent.id)).toHaveLength(0);
    db.close();
  });

  it("parses same-tool native truth for every MVP adapter and reports invalid project files", () => {
    directory = testDir("agenthub-native-adapters");
    const db = new AppDatabase(directory);
    skipBuiltInAgencySeed(db);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["claude", "codex", "opencode", "cursor", "qwen"]);
    const fixtures = [
      {
        toolId: "claude" as const,
        filename: "reviewer.md",
        content: `---\nname: Claude Reviewer\ndescription: Claude native\nmodel: sonnet\ntools: ["Read"]\n---\n\nReview Claude context.\n`,
        preserved: "model",
        expectedText: "model: sonnet"
      },
      {
        toolId: "codex" as const,
        filename: "planner.toml",
        content: `name = "Codex Planner"\ndescription = "Codex native"\ndeveloper_instructions = """Plan with Codex context."""\n`,
        preserved: "developer_instructions",
        expectedText: "developer_instructions"
      },
      {
        toolId: "opencode" as const,
        filename: "builder.md",
        content: `---\ndescription: OpenCode native\nmode: primary\ncolor: blue\n---\n\nBuild with OpenCode context.\n`,
        preserved: "mode",
        expectedText: "mode: primary"
      },
      {
        toolId: "cursor" as const,
        filename: "rule.mdc",
        content: `---\ndescription: Cursor native\nalwaysApply: true\n---\n\nUse Cursor project rules.\n`,
        preserved: "alwaysApply",
        expectedText: "alwaysApply: true"
      },
      {
        toolId: "qwen" as const,
        filename: "qwen-reviewer.md",
        content: `---\nname: Qwen Reviewer\ndescription: Qwen native\ntools: ["Read"]\n---\n\nReview Qwen context.\n`,
        preserved: "tools",
        expectedText: "tools:"
      }
    ];

    for (const fixture of fixtures) {
      const sourceRoot = path.join(directory, `source-${fixture.toolId}`);
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.writeFileSync(path.join(sourceRoot, fixture.filename), fixture.content, "utf8");
      const agent = importLocalAgentFolder(db, directory, sourceRoot, fixture.toolId).imported[0]!;
      const preview = conversionPreview(agent, fixture.toolId, projectRoot, "create");
      expect(preview.preservedNativeFields).toContain(fixture.preserved);
      const applied = applyProjectAgentTarget(db, directory, project, agent.id, fixture.toolId);
      expect(fs.readFileSync(applied.preview.targetPath, "utf8")).toContain(fixture.expectedText);
    }

    const invalidSource = path.join(directory, "invalid-codex");
    fs.mkdirSync(invalidSource, { recursive: true });
    fs.writeFileSync(path.join(invalidSource, "empty.toml"), "", "utf8");
    expect(importLocalAgentFolder(db, directory, invalidSource, "codex").skipped[0]?.reason).toContain("Codex agent 缺少");

    const invalidProjectPath = path.join(projectRoot, ".codex", "agents", "invalid.toml");
    fs.mkdirSync(path.dirname(invalidProjectPath), { recursive: true });
    fs.writeFileSync(invalidProjectPath, "", "utf8");
    expect(listProjectAgentState(db, directory, project).localAgents.find((item) => item.outputPath === invalidProjectPath)).toMatchObject({
      type: "invalid",
      status: "invalid"
    });
    db.close();
  });

  it("tracks project target status, sync, unmanaged conflicts, migration, disable, and backup behavior", () => {
    directory = testDir("agenthub-project-lifecycle");
    const db = new AppDatabase(directory);
    skipBuiltInAgencySeed(db);
    const sourceRoot = path.join(directory, "source");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "reviewer.md"), importedNative("Reviewer", "Review the current patch."), "utf8");
    const agent = importLocalAgentFolder(db, directory, sourceRoot, "claude").imported[0]!;

    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["claude", "cursor"]);

    const applied = applyProjectAgentTarget(db, directory, project, agent.id, "claude");
    expect(applied.state?.status).toBe("current");

    fs.writeFileSync(agent.nativePath, importedNative("Reviewer", "Review with extra care."), "utf8");
    const updatedAgent = reparseAgentHubAgent(db, agent.id);
    expect(listProjectAgentState(db, directory, project).targets.find((target) => target.binding?.id === applied.binding?.id)?.status).toBe("outdated");
    const synced = syncProjectAgents(db, directory, project);
    expect(synced.updated).toHaveLength(1);
    expect(fs.readFileSync(applied.preview.targetPath, "utf8")).toContain("extra care");

    fs.appendFileSync(applied.preview.targetPath, "\nlocal edit\n", "utf8");
    const drifted = listProjectAgentState(db, directory, project).targets.find((target) => target.binding?.id === applied.binding?.id);
    expect(drifted?.status).toBe("drifted");
    const disablePreview = disableProjectAgentTarget(db, project, applied.binding!.id);
    expect(disablePreview.requiresConfirmation).toBe(true);
    const disabledKeep = disableProjectAgentTarget(db, project, applied.binding!.id, { mode: "keep-file" });
    expect(disabledKeep.deletedFile).toBe(false);
    expect(fs.existsSync(applied.preview.targetPath)).toBe(true);
    expect(listProjectAgentState(db, directory, project).localAgents.find((item) => item.outputPath === applied.preview.targetPath)?.type).toBe("unmanaged");

    const conflict = applyProjectAgentTarget(db, directory, project, updatedAgent.id, "claude");
    expect(conflict.requiresConfirmation).toBe(true);
    const overwritten = applyProjectAgentTarget(db, directory, project, updatedAgent.id, "claude", { conflictMode: "migrate-then-overwrite" });
    expect(overwritten.backups).toHaveLength(1);
    expect(fs.existsSync(overwritten.backups[0]!.backupPath)).toBe(true);
    expect(db.getAgentHubSource("project-local-agents")).not.toBeNull();

    fs.unlinkSync(overwritten.preview.targetPath);
    const missing = listProjectAgentState(db, directory, project).targets.find((target) => target.binding?.id === overwritten.binding?.id);
    expect(missing?.status).toBe("missing");
    const disabledMissing = disableProjectAgentTarget(db, project, overwritten.binding!.id);
    expect(disabledMissing.removed).toBe(true);

    const cursorPath = path.join(projectRoot, ".cursor", "rules", "local-rule.mdc");
    fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
    fs.writeFileSync(cursorPath, `---\ndescription: Local cursor rule\nalwaysApply: true\n---\n\nUse local project context.\n`, "utf8");
    const localBefore = listProjectAgentState(db, directory, project).localAgents.find((item) => item.outputPath === cursorPath);
    expect(localBefore).toMatchObject({ type: "unmanaged", toolId: "cursor" });
    const migrated = migrateProjectLocalAgent(db, directory, project, "cursor", cursorPath, {
      type: "existing-source",
      sourceId: "project-local-agents"
    });
    expect(migrated).toMatchObject({ action: "migrated", requiresConfirmation: false });
    expect(migrated.binding?.outputPath).toBe(cursorPath);
    expect(listProjectAgentState(db, directory, project).localAgents.find((item) => item.outputPath === cursorPath)?.type).toBe("managed");
    db.close();
  });
});

function importedNative(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${name} description\n---\n\n${body}\n`;
}

function staleBuiltInAgent(sourceId: string, nativePath: string) {
  return {
    id: "old-code-reviewer",
    sourceId,
    sourceType: "builtin" as const,
    sourceTruthTool: "claude" as const,
    truthRole: "subagent" as const,
    sourceFormat: "markdown" as const,
    slug: "code-reviewer",
    name: "Code Reviewer",
    description: "Old placeholder",
    nativePath,
    libraryRelativePath: "agency-agents/engineering/code-reviewer.md",
    sourceRelativePath: "engineering/code-reviewer.md",
    category: "engineering",
    projection: {
      name: "Code Reviewer",
      description: "Old placeholder",
      body: "Old four-agent placeholder.",
      slugCandidate: "code-reviewer",
      parseWarnings: []
    },
    nativeMetadata: { name: "Code Reviewer", description: "Old placeholder" },
    contentHash: "old-hash"
  };
}

function skipBuiltInAgencySeed(db: AppDatabase): void {
  db.setSetting("agenthub.builtin.agency-agents.seeded.v1", true);
}

function listPackagedAgencyAgentFiles(): string[] {
  const root = path.join(process.cwd(), "builtin-agents", "agency-agents");
  const skippedDirectories = new Set(["docs", "examples", "integrations", "scripts"]);
  const output: string[] = [];

  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || skippedDirectories.has(entry.name.toLowerCase())) continue;
        visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = normalizeRelativeTestPath(path.relative(root, fullPath));
      const lower = relativePath.toLowerCase();
      if (!lower.endsWith(".md")) continue;
      if (lower === "readme.md" || lower.endsWith("/readme.md")) continue;
      if (lower.split("/").length < 2) continue;
      output.push(relativePath);
    }
  }

  visit(root);
  return output.sort();
}

function normalizeRelativeTestPath(input: string): string {
  return input.split(/[\\/]+/).filter(Boolean).join("/");
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}
