import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyHookHubSuiteToProject,
  createHookHubSuite,
  exportHookHubSuite,
  importHookHubSuiteJson,
  listHookHub,
  listProjectHookState,
  removeProjectHookBinding,
  shareProjectHooksToHookHub,
  syncHookHubSuiteToEnabledProjects,
  updateHookHubSuite
} from "../src/server/hookhub/hookhub.js";
import { AppDatabase } from "../src/server/storage/database.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;

afterEach(() => {
  if (directory) cleanup(directory);
  directory = null;
});

describe("HookHub", () => {
  it("stores unique multi-tool suites with stable suite ids and exports without bindings", () => {
    directory = testDir("hookhub-suite-library");
    const db = new AppDatabase(directory);

    const suite = createHookHubSuite(db, {
      name: "安全检查",
      description: "阻止危险命令",
      riskNotes: "命令 hook 会运行本地检查",
      requiredEnv: ["AUDIT_TOKEN", "AUDIT_TOKEN"],
      payloads: {
        claude: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node guard.js" }] }] },
        codex: { shell: [{ command: "node guard.js" }] }
      }
    });

    expect(suite.toolIds.sort()).toEqual(["claude", "codex"]);
    expect(suite.requiredEnv).toEqual(["AUDIT_TOKEN"]);
    expect(() => createHookHubSuite(db, { name: "安全检查" })).toThrow("HookHub suite name 已存在");

    const renamed = updateHookHubSuite(db, suite.suiteId, {
      name: "安全检查 v2",
      payloads: { ...suite.payloads, qwen: { hooks: [{ command: "qwen-check" }] } }
    });
    expect(renamed.suiteId).toBe(suite.suiteId);
    expect(renamed.toolIds.sort()).toEqual(["claude", "codex", "qwen"]);
    expect(listHookHub(db, "AUDIT_TOKEN").suites[0]?.suiteId).toBe(suite.suiteId);

    const exported = exportHookHubSuite(db, suite.suiteId);
    expect(exported.format).toBe("hookhub-suite-v1");
    expect(JSON.stringify(exported)).not.toContain("projectId");

    const conflict = importHookHubSuiteJson(db, JSON.stringify(exported));
    expect(conflict).toMatchObject({ action: "needs-confirmation", conflict: { suiteId: suite.suiteId } });
    db.close();
  });

  it("detects project hook states by hooks-section fingerprints and preserves unrelated settings while applying", () => {
    directory = testDir("hookhub-project-state");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(path.join(projectRoot, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".qwen"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".qoder"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".claude", "settings.json"), JSON.stringify({ model: "sonnet", hooks: { Stop: [{ command: "old" }] } }, null, 2), "utf8");
    fs.writeFileSync(path.join(projectRoot, ".codex", "hooks.json"), JSON.stringify({ model: "gpt-5", hooks: { pre: [{ command: "old" }] } }, null, 2), "utf8");
    fs.writeFileSync(path.join(projectRoot, ".qwen", "settings.local.json"), JSON.stringify({ keep: true, hooks: { pre: [{ command: "old" }] } }, null, 2), "utf8");

    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["claude", "codex", "qwen", "qoder"]);
    const suite = createHookHubSuite(db, {
      name: "格式检查",
      payloads: {
        claude: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm test" }] }] },
        codex: { pre: [{ command: "npm test" }] },
        qwen: { pre: [{ command: "npm test" }] },
        qoder: { pre: [{ command: "npm test" }] }
      }
    });

    const initial = listProjectHookState(db, project);
    expect(initial.tools.find((tool) => tool.toolId === "claude")?.status).toBe("unmanaged");

    const appliedClaude = applyHookHubSuiteToProject(db, project, "claude", suite.suiteId, { mode: "overwrite" });
    const appliedCodex = applyHookHubSuiteToProject(db, project, "codex", suite.suiteId, { mode: "overwrite" });
    const appliedQwen = applyHookHubSuiteToProject(db, project, "qwen", suite.suiteId, { mode: "overwrite" });
    const appliedQoder = applyHookHubSuiteToProject(db, project, "qoder", suite.suiteId);

    expect(appliedClaude.backup.mode).toBe("local-backup");
    expect(fs.existsSync(appliedClaude.backup.backupPath as string)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".claude", "settings.json"), "utf8"))).toMatchObject({
      model: "sonnet",
      hooks: suite.payloads.claude
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".codex", "hooks.json"), "utf8"))).toMatchObject({
      model: "gpt-5",
      hooks: suite.payloads.codex
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".qwen", "settings.local.json"), "utf8"))).toMatchObject({
      keep: true,
      hooks: suite.payloads.qwen
    });
    expect(JSON.parse(fs.readFileSync(path.join(projectRoot, ".qoder", "settings.json"), "utf8")).hooks).toEqual(suite.payloads.qoder);
    expect([appliedCodex.status, appliedQwen.status, appliedQoder.status]).toEqual(["current", "current", "current"]);

    const afterApply = listProjectHookState(db, project);
    expect(afterApply.tools.filter((tool) => tool.status === "current").map((tool) => tool.toolId).sort()).toEqual(["claude", "codex", "qoder", "qwen"]);

    const updatedSuite = updateHookHubSuite(db, suite.suiteId, {
      payloads: { ...suite.payloads, claude: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm run lint" }] }] } }
    });
    const unrelatedOnly = JSON.parse(fs.readFileSync(path.join(projectRoot, ".claude", "settings.json"), "utf8"));
    unrelatedOnly.model = "opus";
    fs.writeFileSync(path.join(projectRoot, ".claude", "settings.json"), JSON.stringify(unrelatedOnly, null, 2), "utf8");
    expect(listProjectHookState(db, project).tools.find((tool) => tool.toolId === "claude")).toMatchObject({ status: "outdated" });

    const drifted = JSON.parse(fs.readFileSync(path.join(projectRoot, ".claude", "settings.json"), "utf8"));
    drifted.hooks = { Stop: [{ command: "local-change" }] };
    fs.writeFileSync(path.join(projectRoot, ".claude", "settings.json"), JSON.stringify(drifted, null, 2), "utf8");
    const sync = syncHookHubSuiteToEnabledProjects(db, updatedSuite.suiteId);
    expect(sync.updated.map((item) => item.toolId).sort()).toEqual([]);
    expect(sync.skipped.find((item) => item.toolId === "claude")).toMatchObject({ status: "drifted" });

    applyHookHubSuiteToProject(db, project, "claude", updatedSuite.suiteId, { mode: "overwrite" });
    expect(listProjectHookState(db, project).tools.find((tool) => tool.toolId === "claude")).toMatchObject({ status: "current" });

    fs.rmSync(path.join(projectRoot, ".qoder", "settings.json"), { force: true });
    const missingSync = syncHookHubSuiteToEnabledProjects(db, updatedSuite.suiteId);
    expect(missingSync.updated.map((item) => item.toolId)).not.toContain("qoder");
    expect(missingSync.skipped.find((item) => item.toolId === "qoder")).toMatchObject({ status: "missing" });
    expect(fs.existsSync(path.join(projectRoot, ".qoder", "settings.json"))).toBe(false);

    const removed = removeProjectHookBinding(db, project, "qoder");
    expect(removed).toMatchObject({ removed: true, state: { status: "missing", binding: null } });
    db.close();
  });

  it("shares unmanaged hooks without rewriting project files and shows discovery-only tools", () => {
    directory = testDir("hookhub-share-discovery");
    const db = new AppDatabase(directory);
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(path.join(projectRoot, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".opencode", "plugins"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".github", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".claude", "settings.json"), JSON.stringify({ hooks: { Stop: [{ command: "notify" }] } }, null, 2), "utf8");
    fs.writeFileSync(path.join(projectRoot, ".opencode", "plugins", "audit.ts"), "export default {}", "utf8");
    fs.writeFileSync(path.join(projectRoot, ".github", "hooks", "pre-commit.json"), "{}", "utf8");
    const before = fs.readFileSync(path.join(projectRoot, ".claude", "settings.json"), "utf8");
    const project = db.addProject(projectRoot).project;
    db.replaceProjectToolTargets(project.id, ["claude", "opencode", "copilot", "kilo"]);

    const shared = shareProjectHooksToHookHub(db, project, "claude", { name: "通知 hooks" });
    expect(shared.suite.payloads.claude).toEqual({ Stop: [{ command: "notify" }] });
    expect(fs.readFileSync(path.join(projectRoot, ".claude", "settings.json"), "utf8")).toBe(before);

    const state = listProjectHookState(db, project);
    expect(state.tools.find((tool) => tool.toolId === "opencode")).toMatchObject({
      status: "unsupported",
      supported: false
    });
    expect(state.tools.find((tool) => tool.toolId === "copilot")?.discovery).toContain(path.join(".github", "hooks", "pre-commit.json"));
    expect(state.tools.find((tool) => tool.toolId === "kilo")).toMatchObject({
      status: "unsupported",
      supported: false,
      reason: "尚未支持"
    });
    db.close();
  });
});
