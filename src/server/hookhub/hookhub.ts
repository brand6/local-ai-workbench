import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type {
  AppConfig,
  HookHubApplyMode,
  HookHubApplyResult,
  HookHubBackupResult,
  HookHubDiscoveryToolId,
  HookHubExportDocument,
  HookHubImportConflictMode,
  HookHubImportResult,
  HookHubList,
  HookHubProjectStatus,
  HookHubShareResult,
  HookHubSupportedToolId,
  HookHubSuite,
  HookHubSuiteInput,
  LocalOpenResponse,
  Project,
  ProjectHookBinding,
  ProjectHookBindingRemovalResult,
  ProjectHookState,
  ProjectHookToolState,
  ProjectToolTarget,
  ToolId
} from "../../shared/types.js";
import { isToolId } from "../../shared/types.js";
import { openLocalPath } from "../core/localFilesystem.js";
import { displayPath, isPathInsideOrEqual, normalizeFsPath } from "../core/pathUtils.js";
import { nowIso } from "../core/time.js";
import type { AppDatabase } from "../storage/database.js";
import { listProjectToolTargets } from "../skillhub/projectSkills.js";

type SessionProjectToolTarget = ProjectToolTarget & { toolId: ToolId };

interface HookReadResult {
  toolId: HookHubSupportedToolId;
  label: string;
  configPath: string;
  scope: "project";
  hooks: unknown | null;
  hasHooks: boolean;
  error: string | null;
}

interface HookApplyOptions {
  mode?: HookHubApplyMode | null;
  preserveName?: string | null;
  description?: string | null;
  riskNotes?: string | null;
  requiredEnv?: string[];
  gitCommand?: string;
  config?: AppConfig | undefined;
}

interface SuiteImportOptions {
  conflictMode?: HookHubImportConflictMode | null;
  renameName?: string | null;
}

interface NativeImportInput extends HookHubSuiteInput {
  toolId: HookHubSupportedToolId;
  input: string;
}

interface JsonContainer {
  path: string;
  exists: boolean;
  value: unknown;
  error: string | null;
}

const supportedToolIds: HookHubSupportedToolId[] = ["claude", "codex", "qwen", "qoder", "kimi", "codebuddy"];
const projectWritebackToolIds: Exclude<HookHubSupportedToolId, "kimi">[] = ["claude", "codex", "qwen", "qoder", "codebuddy"];
const adapterLabels: Record<HookHubSupportedToolId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  qwen: "Qwen",
  qoder: "Qoder",
  kimi: "Kimi Code",
  codebuddy: "CodeBuddy Code"
};

export function listHookHub(database: AppDatabase, query = ""): HookHubList {
  return { suites: database.listHookHubSuites(query) };
}

export function createHookHubSuite(database: AppDatabase, input: HookHubSuiteInput): HookHubSuite {
  const suiteId = crypto.randomUUID();
  const suite = normalizeSuiteInput(input, suiteId);
  ensureUniqueSuiteName(database, suite.name, suiteId);
  return database.upsertHookHubSuite(suite);
}

export function updateHookHubSuite(database: AppDatabase, suiteId: string, input: Partial<HookHubSuiteInput>): HookHubSuite {
  const existing = database.getHookHubSuite(suiteId);
  if (!existing) throw new Error("HookHub suite 不存在");
  const next = normalizeSuiteInput(
    {
      name: input.name ?? existing.name,
      description: input.description === undefined ? existing.description : input.description,
      riskNotes: input.riskNotes === undefined ? existing.riskNotes : input.riskNotes,
      requiredEnv: input.requiredEnv ?? existing.requiredEnv,
      payloads: input.payloads ?? existing.payloads
    },
    suiteId,
    existing
  );
  ensureUniqueSuiteName(database, next.name, suiteId);
  return database.upsertHookHubSuite(next);
}

export function deleteHookHubSuite(database: AppDatabase, suiteId: string): { suiteId: string; deleted: boolean; bindingsRemoved: ProjectHookBinding[] } {
  const pluginRefs = database.listPluginHubPlugins().filter((plugin) => plugin.componentRefs.some((ref) => ref.type === "hook" && ref.componentId === suiteId));
  if (pluginRefs.length > 0) {
    throw new Error(`HookHub suite 正被 PluginHub plugin 引用：${pluginRefs.map((plugin) => plugin.displayName).join(", ")}`);
  }
  const bindingsRemoved = database.listProjectHookBindingsForSuite(suiteId);
  return { suiteId, deleted: database.deleteHookHubSuite(suiteId), bindingsRemoved };
}

export function exportHookHubSuite(database: AppDatabase, suiteId: string): HookHubExportDocument {
  const suite = database.getHookHubSuite(suiteId);
  if (!suite) throw new Error("HookHub suite 不存在");
  return { format: "hookhub-suite-v1", suite };
}

export function importHookHubSuiteJson(database: AppDatabase, input: string, options: SuiteImportOptions = {}): HookHubImportResult {
  const document = parseHookHubSuiteDocument(input);
  const incoming = normalizeSuiteInput(document.suite, document.suite.suiteId || crypto.randomUUID());
  const conflict = database.getHookHubSuiteByName(incoming.name);
  if (conflict && options.conflictMode !== "overwrite" && options.conflictMode !== "rename") {
    return { action: options.conflictMode === "cancel" ? "cancelled" : "needs-confirmation", suite: null, conflict };
  }

  if (conflict && options.conflictMode === "overwrite") {
    const suite = database.upsertHookHubSuite({ ...incoming, suiteId: conflict.suiteId, name: conflict.name, createdAt: conflict.createdAt });
    return { action: "overwritten", suite, conflict };
  }

  if (conflict && options.conflictMode === "rename") {
    const name = normalizeRequiredName(options.renameName ?? "");
    ensureUniqueSuiteName(database, name);
    const suite = database.upsertHookHubSuite({ ...incoming, suiteId: crypto.randomUUID(), name });
    return { action: "renamed", suite, conflict };
  }

  ensureUniqueSuiteName(database, incoming.name, incoming.suiteId);
  return { action: "created", suite: database.upsertHookHubSuite(incoming), conflict: null };
}

export function importNativeToolHooks(database: AppDatabase, input: NativeImportInput): HookHubImportResult {
  const parsed = parseJsonConfigText(input.input);
  const hooks = extractHooksPayload(input.toolId, parsed);
  if (isEmptyHooks(hooks)) throw new Error("没有可导入的 hooks section");
  const suite = createHookHubSuite(database, suiteInputWithPayload(input, input.toolId, hooks));
  return { action: "created", suite, conflict: null };
}

export function listProjectHookState(database: AppDatabase, project: Project, query = "", config?: AppConfig): ProjectHookState {
  const suites = database.listHookHubSuites(query);
  const suiteById = new Map(database.listHookHubSuites().map((suite) => [suite.suiteId, suite]));
  const bindings = new Map(database.listProjectHookBindings(project.id, project.rootPath).map((binding) => [binding.toolId, binding]));
  const tools: ProjectHookToolState[] = [];

  for (const toolTarget of listProjectToolTargets(database, project, config).filter((target): target is SessionProjectToolTarget => target.enabled && isToolId(target.toolId))) {
    if (isProjectHookWritebackToolId(toolTarget.toolId)) {
      const binding = bindings.get(toolTarget.toolId) ?? null;
      const suite = binding ? suiteById.get(binding.suiteId) ?? null : null;
      tools.push(projectHookToolState(project, toolTarget.toolId, binding, suite));
    } else if (isDiscoveryOnlyHookToolId(toolTarget.toolId)) {
      tools.push(discoveryOnlyToolState(project, toolTarget.toolId));
    } else {
      tools.push(unsupportedHookToolState(project, toolTarget));
    }
  }

  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    tools,
    suites
  };
}

export function writeProjectHooks(
  database: AppDatabase,
  project: Project,
  toolId: HookHubSupportedToolId,
  hooks: unknown,
  input: Partial<HookHubSuiteInput> = {},
  options: Pick<HookApplyOptions, "gitCommand" | "config"> = {}
): HookHubApplyResult | ProjectHookToolState {
  ensureProjectToolEnabled(database, project, toolId, options.config);
  const current = readProjectHooks(project, toolId, database.getProjectHookBinding(project.id, project.rootPath, toolId)?.configPath ?? null);
  if (current.error) throw new Error(current.error);
  const backup = protectBeforeReplacement(project.rootPath, current.configPath, toolId, options);
  writeHooksSection(toolId, current.configPath, hooks);

  if (input.name) {
    const suite = createHookHubSuite(database, suiteInputWithPayload({ ...input, name: input.name }, toolId, hooks));
    const binding = database.upsertProjectHookBinding({
      projectId: project.id,
      targetRootPath: project.rootPath,
      toolId,
      suiteId: suite.suiteId,
      configPath: current.configPath,
      scope: "project",
      appliedFingerprint: hooksFingerprint(hooks),
      appliedAt: nowIso()
    });
    return {
      projectId: project.id,
      targetRootPath: project.rootPath,
      toolId,
      suite,
      binding,
      configPath: current.configPath,
      status: "current",
      backup,
      warnings: []
    };
  }

  const binding = database.getProjectHookBinding(project.id, project.rootPath, toolId);
  const suite = binding ? database.getHookHubSuite(binding.suiteId) : null;
  return projectHookToolState(project, toolId, binding, suite);
}

export function shareProjectHooksToHookHub(database: AppDatabase, project: Project, toolId: HookHubSupportedToolId, input: HookHubSuiteInput): HookHubShareResult {
  ensureProjectHookWritebackSupported(toolId);
  const current = readProjectHooks(project, toolId, database.getProjectHookBinding(project.id, project.rootPath, toolId)?.configPath ?? null);
  if (current.error) throw new Error(current.error);
  if (!current.hasHooks) throw new Error("当前工具没有可上传的 hooks section");
  const suite = createHookHubSuite(database, {
    ...input,
    payloads: { [toolId]: current.hooks }
  });
  return { suite, sourceToolId: toolId, sourceConfigPath: current.configPath };
}

export function openProjectHookConfig(database: AppDatabase, project: Project, toolId: HookHubSupportedToolId, target: "document" | "folder"): LocalOpenResponse {
  ensureProjectHookWritebackSupported(toolId);
  const current = readProjectHooks(project, toolId, database.getProjectHookBinding(project.id, project.rootPath, toolId)?.configPath ?? null);
  return openLocalPath(target === "document" ? current.configPath : path.dirname(current.configPath));
}

export function removeProjectHookBinding(database: AppDatabase, project: Project, toolId: HookHubSupportedToolId): ProjectHookBindingRemovalResult {
  ensureProjectHookWritebackSupported(toolId);
  const binding = database.getProjectHookBinding(project.id, project.rootPath, toolId);
  const state = projectHookToolState(project, toolId, binding, binding ? database.getHookHubSuite(binding.suiteId) : null);
  if (binding && state.status !== "missing") throw new Error("只有 missing 状态可以移除 HookHub binding");
  const removed = binding ? database.deleteProjectHookBinding(project.id, project.rootPath, toolId) : false;
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId,
    removed,
    state: projectHookToolState(project, toolId, null, null)
  };
}

export function applyHookHubSuiteToProject(
  database: AppDatabase,
  project: Project,
  toolId: HookHubSupportedToolId,
  suiteId: string,
  options: HookApplyOptions = {}
): HookHubApplyResult {
  ensureProjectToolEnabled(database, project, toolId, options.config);
  const suite = database.getHookHubSuite(suiteId);
  if (!suite) throw new Error("HookHub suite 不存在");
  const payload = suite.payloads[toolId];
  if (payload === undefined) throw new Error("该 suite 没有目标工具 payload");

  const existingBinding = database.getProjectHookBinding(project.id, project.rootPath, toolId);
  const currentState = projectHookToolState(
    project,
    toolId,
    existingBinding,
    existingBinding ? database.getHookHubSuite(existingBinding.suiteId) : null
  );
  if (currentState.status === "invalid") throw new Error(currentState.error ?? "目标 hooks 配置无效");
  ensureReplacementMode(database, currentState, suite, options);
  preserveCurrentHooksIfRequested(database, currentState, options);

  const configPath = currentState.configPath ?? hookConfigPath(project.rootPath, toolId);
  const backup = protectBeforeReplacement(project.rootPath, configPath, toolId, options);
  writeHooksSection(toolId, configPath, payload);
  const binding = database.upsertProjectHookBinding({
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId,
    suiteId: suite.suiteId,
    configPath,
    scope: "project",
    appliedFingerprint: hooksFingerprint(payload),
    appliedAt: nowIso()
  });

  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId,
    suite,
    binding,
    configPath,
    status: "current",
    backup,
    warnings: replacementWarnings(currentState, options)
  };
}

export function syncHookHubSuiteToEnabledProjects(database: AppDatabase, suiteId: string, options: Pick<HookApplyOptions, "gitCommand" | "config"> = {}) {
  const suite = database.getHookHubSuite(suiteId);
  if (!suite) throw new Error("HookHub suite 不存在");
  const updated: HookHubApplyResult[] = [];
  const skipped = [];

  for (const binding of database.listProjectHookBindingsForSuite(suiteId)) {
    const storedProject = database.getProject(binding.projectId);
    if (!storedProject) {
      skipped.push(skipFromBinding(binding, "missing", "项目不存在"));
      continue;
    }
    const project = scopeProject(storedProject, binding.targetRootPath);
    const state = projectHookToolState(project, binding.toolId, binding, suite);
    if (state.status !== "outdated") {
      skipped.push(skipFromBinding(binding, state.status, state.reason ?? "不是可自动同步状态"));
      continue;
    }
    updated.push(applyHookHubSuiteToProject(database, project, binding.toolId, suiteId, { mode: "overwrite", ...options }));
  }

  return { suiteId, projectId: null, updated, skipped };
}

export function syncProjectHooksFromHookHub(database: AppDatabase, project: Project, options: Pick<HookApplyOptions, "gitCommand" | "config"> = {}) {
  const state = listProjectHookState(database, project, "", options.config);
  const updated: HookHubApplyResult[] = [];
  const skipped = [];

  for (const tool of state.tools) {
    if (!isHookHubSupportedToolId(tool.toolId) || !tool.binding) continue;
    if (tool.status !== "outdated" && tool.status !== "missing") {
      if (tool.status !== "current") skipped.push({ projectId: project.id, targetRootPath: project.rootPath, toolId: tool.toolId, status: tool.status, reason: tool.reason ?? "跳过" });
      continue;
    }
    updated.push(applyHookHubSuiteToProject(database, project, tool.toolId, tool.binding.suiteId, { mode: "overwrite", ...options }));
  }

  return { suiteId: null, projectId: project.id, updated, skipped };
}

export function syncProjectHookToolFromHookHub(database: AppDatabase, project: Project, toolId: HookHubSupportedToolId, options: Pick<HookApplyOptions, "gitCommand" | "config"> = {}) {
  ensureProjectHookWritebackSupported(toolId);
  const binding = database.getProjectHookBinding(project.id, project.rootPath, toolId);
  if (!binding) throw new Error("当前工具没有 HookHub binding");
  const state = projectHookToolState(project, toolId, binding, database.getHookHubSuite(binding.suiteId));
  if (state.status !== "outdated" && state.status !== "missing") throw new Error("当前状态不能自动同步");
  return applyHookHubSuiteToProject(database, project, toolId, binding.suiteId, { mode: "overwrite", ...options });
}

export function isHookHubSupportedToolId(value: unknown): value is HookHubSupportedToolId {
  return value === "claude" || value === "codex" || value === "qwen" || value === "qoder" || value === "kimi" || value === "codebuddy";
}

function isProjectHookWritebackToolId(value: unknown): value is Exclude<HookHubSupportedToolId, "kimi"> {
  return projectWritebackToolIds.includes(value as Exclude<HookHubSupportedToolId, "kimi">);
}

export function convertHookPayloadForTool(payload: unknown, sourceToolId: HookHubSupportedToolId, targetToolId: HookHubSupportedToolId): unknown | null {
  if (sourceToolId === targetToolId) return payload;
  if (sourceToolId === "claude" && ["codex", "qwen", "qoder"].includes(targetToolId)) return convertClaudeHookPayloadToSimpleTool(payload);
  if (sourceToolId === "claude" && targetToolId === "kimi") return convertClaudeHookPayloadToKimi(payload);
  if (sourceToolId === "claude" && targetToolId === "codebuddy") return payload;
  if (sourceToolId === "codebuddy" && targetToolId === "claude") return payload;
  if (sourceToolId === "codebuddy" && ["codex", "qwen", "qoder"].includes(targetToolId)) return convertClaudeHookPayloadToSimpleTool(payload);
  if (sourceToolId === "codebuddy" && targetToolId === "kimi") return convertClaudeHookPayloadToKimi(payload);
  if (["codex", "qwen", "qoder"].includes(sourceToolId) && targetToolId === "kimi") return convertSimpleHookPayloadToKimi(payload);
  if (sourceToolId === "kimi" && ["codex", "qwen", "qoder"].includes(targetToolId)) return convertKimiHookPayloadToSimpleTool(payload);
  return null;
}

function normalizeSuiteInput(
  input: HookHubSuiteInput,
  suiteId: string,
  existing: HookHubSuite | null = null
): Omit<HookHubSuite, "toolIds" | "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string } {
  return {
    suiteId,
    name: normalizeRequiredName(input.name),
    description: nullableTrim(input.description),
    riskNotes: nullableTrim(input.riskNotes),
    requiredEnv: uniqueStrings(input.requiredEnv ?? []),
    payloads: normalizePayloads(input.payloads ?? {}),
    ...(existing ? { createdAt: existing.createdAt } : {})
  };
}

function normalizeRequiredName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("suite name is required");
  return trimmed;
}

function nullableTrim(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizePayloads(input: Partial<Record<HookHubSupportedToolId, unknown>>): Partial<Record<HookHubSupportedToolId, unknown>> {
  const payloads: Partial<Record<HookHubSupportedToolId, unknown>> = {};
  for (const toolId of supportedToolIds) {
    if (Object.prototype.hasOwnProperty.call(input, toolId) && input[toolId] !== undefined) payloads[toolId] = input[toolId];
  }
  return payloads;
}

function suiteInputWithPayload(
  input: { name: string; description?: string | null; riskNotes?: string | null; requiredEnv?: string[] },
  toolId: HookHubSupportedToolId,
  hooks: unknown
): HookHubSuiteInput {
  return {
    name: input.name,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.riskNotes !== undefined ? { riskNotes: input.riskNotes } : {}),
    ...(input.requiredEnv !== undefined ? { requiredEnv: input.requiredEnv } : {}),
    payloads: { [toolId]: hooks }
  };
}

function convertClaudeHookPayloadToSimpleTool(payload: unknown): unknown | null {
  if (!isRecord(payload)) return null;
  const converted: Record<string, unknown[]> = {};
  for (const [eventName, rules] of Object.entries(payload)) {
    if (!Array.isArray(rules)) continue;
    const targetEvent = simpleHookEventName(eventName);
    const commands: unknown[] = [];
    for (const rule of rules) {
      if (!isRecord(rule)) continue;
      const matcher = typeof rule.matcher === "string" && rule.matcher.trim() ? rule.matcher.trim() : null;
      const hooks = Array.isArray(rule.hooks) ? rule.hooks : [];
      for (const hook of hooks) {
        if (!isRecord(hook)) continue;
        const command = typeof hook.command === "string" && hook.command.trim() ? hook.command.trim() : null;
        if (!command) continue;
        commands.push({
          ...(matcher ? { matcher } : {}),
          command,
          ...(typeof hook.timeout === "number" ? { timeout: hook.timeout } : {}),
          ...(typeof hook.async === "boolean" ? { async: hook.async } : {})
        });
      }
    }
    if (commands.length > 0) converted[targetEvent] = [...(converted[targetEvent] ?? []), ...commands];
  }
  return Object.keys(converted).length > 0 ? converted : null;
}

function convertClaudeHookPayloadToKimi(payload: unknown): unknown | null {
  const simple = convertClaudeHookPayloadToSimpleTool(payload);
  return simple ? convertSimpleHookPayloadToKimi(simple) : null;
}

function convertSimpleHookPayloadToKimi(payload: unknown): unknown | null {
  const rules = normalizeKimiHookRules(payload);
  return rules.length > 0 ? rules : null;
}

function convertKimiHookPayloadToSimpleTool(payload: unknown): unknown | null {
  const rules = normalizeKimiHookRules(payload);
  if (rules.length === 0) return null;
  const converted: Record<string, unknown[]> = {};
  for (const rule of rules) {
    const event = simpleHookEventName(String(rule.event ?? ""));
    const command = typeof rule.command === "string" ? rule.command.trim() : "";
    if (!event || !command) continue;
    converted[event] = [
      ...(converted[event] ?? []),
      {
        ...(typeof rule.matcher === "string" && rule.matcher.trim() ? { matcher: rule.matcher.trim() } : {}),
        command,
        ...(typeof rule.timeout === "number" ? { timeout: rule.timeout } : {})
      }
    ];
  }
  return Object.keys(converted).length > 0 ? converted : null;
}
function simpleHookEventName(eventName: string): string {
  const known: Record<string, string> = {
    PreToolUse: "pre",
    PostToolUse: "post",
    SessionStart: "session_start",
    Stop: "stop",
    Notification: "notification",
    UserPromptSubmit: "user_prompt_submit",
    SubagentStop: "subagent_stop"
  };
  return known[eventName] ?? eventName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function ensureUniqueSuiteName(database: AppDatabase, name: string, suiteId: string | null = null): void {
  const existing = database.getHookHubSuiteByName(name);
  if (existing && existing.suiteId !== suiteId) throw new Error("HookHub suite name 已存在");
}

function projectHookToolState(project: Project, toolId: HookHubSupportedToolId, binding: ProjectHookBinding | null, suite: HookHubSuite | null): ProjectHookToolState {
  const read = readProjectHooks(project, toolId, binding?.configPath ?? null);
  const resolvedSuite = suite ?? (binding ? null : null);
  const currentSuite = resolvedSuite ?? null;
  const payload = currentSuite?.payloads[toolId];
  let status: HookHubProjectStatus = "missing";
  let reason: string | null = null;

  if (read.error) {
    status = "invalid";
    reason = read.error;
  } else if (binding) {
    if (!read.hasHooks) {
      status = "missing";
      reason = "binding 仍存在，但项目 hooks section 已缺失";
    } else if (!currentSuite || payload === undefined) {
      status = "missing";
      reason = "binding 指向的 suite 或工具 payload 已不存在";
    } else {
      const currentFingerprint = hooksFingerprint(read.hooks);
      const suiteFingerprint = hooksFingerprint(payload);
      if (currentFingerprint !== binding.appliedFingerprint) {
        status = "drifted";
        reason = "项目 hooks 和上次应用内容不一致";
      } else if (suiteFingerprint !== binding.appliedFingerprint) {
        status = "outdated";
        reason = "HookHub suite 已更新";
      } else {
        status = "current";
      }
    }
  } else if (read.hasHooks) {
    status = "unmanaged";
    reason = "项目存在未接管 hooks";
  } else {
    status = "missing";
    reason = "未配置 hooks";
  }

  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId,
    label: read.label,
    supported: true,
    configPath: read.configPath,
    scope: "project",
    status,
    hooks: read.hooks,
    hooksSummary: hooksSummary(read.hooks),
    reason,
    error: read.error,
    binding,
    suite: currentSuite,
    discovery: []
  };
}

function discoveryOnlyToolState(project: Project, toolId: Exclude<HookHubDiscoveryToolId, HookHubSupportedToolId>): ProjectHookToolState {
  const discovery = toolId === "opencode" ? discoverOpenCodeHooks(project.rootPath) : discoverCopilotHooks(project.rootPath);
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId,
    label: toolId === "opencode" ? "OpenCode" : "Copilot",
    supported: false,
    configPath: null,
    scope: null,
    status: "unsupported",
    hooks: null,
    hooksSummary: discovery.length ? discovery.join("；") : "未发现配置",
    reason:
      toolId === "opencode"
        ? "OpenCode hooks 是 plugin 文件和 opencode.json plugin 列表，MVP 仅发现不写入"
        : "Copilot CLI、repo hook file 和 cloud agent sandbox 差异较大，MVP 仅发现不写入",
    error: null,
    binding: null,
    suite: null,
    discovery
  };
}

function unsupportedHookToolState(project: Project, toolTarget: SessionProjectToolTarget): ProjectHookToolState {
  const reason =
    toolTarget.toolId === "kimi"
      ? "Kimi Code 官方文档目前只支持用户级 config.toml，未提供项目级 hook 配置；HookHub 不写入用户级配置"
      : "尚未支持";
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId: toolTarget.toolId,
    label: toolLabel(toolTarget.toolId),
    supported: false,
    configPath: null,
    scope: null,
    status: "unsupported",
    hooks: null,
    hooksSummary: "尚未支持",
    reason,
    error: null,
    binding: null,
    suite: null,
    discovery: []
  };
}

function isDiscoveryOnlyHookToolId(toolId: ToolId): toolId is Exclude<HookHubDiscoveryToolId, HookHubSupportedToolId> {
  return toolId === "opencode" || toolId === "copilot";
}

function toolLabel(toolId: ToolId): string {
  if (toolId === "qwen") return "Qwen";
  if (toolId === "qoder") return "Qoder";
  if (toolId === "opencode") return "OpenCode";
  if (toolId === "codebuddy") return "CodeBuddy Code";
  if (toolId === "deepcode") return "Deep Code";
  if (toolId === "reasonix") return "Reasonix";
  return `${toolId.charAt(0).toUpperCase()}${toolId.slice(1)}`;
}

function readProjectHooks(project: Project, toolId: HookHubSupportedToolId, preferredConfigPath: string | null): HookReadResult {
  const configPath = preferredConfigPath && fs.existsSync(preferredConfigPath) ? preferredConfigPath : chooseConfigPath(project.rootPath, toolId);
  if (toolId === "kimi") {
    const container = readKimiHookContainer(configPath);
    return {
      toolId,
      label: adapterLabels[toolId],
      configPath,
      scope: "project",
      hooks: container.hooks,
      hasHooks: !isEmptyHooks(container.hooks),
      error: container.error
    };
  }
  const container = readJsonContainer(configPath);
  if (container.error) {
    return { toolId, label: adapterLabels[toolId], configPath, scope: "project", hooks: null, hasHooks: false, error: container.error };
  }
  const hooks = extractHooksPayload(toolId, container.value);
  return {
    toolId,
    label: adapterLabels[toolId],
    configPath,
    scope: "project",
    hooks,
    hasHooks: !isEmptyHooks(hooks),
    error: null
  };
}

function chooseConfigPath(rootPath: string, toolId: HookHubSupportedToolId): string {
  const candidates = hookConfigCandidates(rootPath, toolId);
  const withHooks = candidates.find((candidate) => {
    if (toolId === "kimi") {
      const container = readKimiHookContainer(candidate);
      return !container.error && !isEmptyHooks(container.hooks);
    }
    const container = readJsonContainer(candidate);
    return !container.error && !isEmptyHooks(extractHooksPayload(toolId, container.value));
  });
  if (withHooks) return withHooks;
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? hookConfigPath(rootPath, toolId);
}

function hookConfigPath(rootPath: string, toolId: HookHubSupportedToolId): string {
  if (toolId === "codex") return path.join(rootPath, ".codex", "hooks.json");
  if (toolId === "claude") return path.join(rootPath, ".claude", "settings.json");
  if (toolId === "qwen") return path.join(rootPath, ".qwen", "settings.json");
  if (toolId === "kimi") return path.join(rootPath, ".kimi-code", "config.toml");
  if (toolId === "codebuddy") return path.join(rootPath, ".codebuddy", "settings.json");
  return path.join(rootPath, ".qoder", "settings.json");
}

function hookConfigCandidates(rootPath: string, toolId: HookHubSupportedToolId): string[] {
  if (toolId === "codex" || toolId === "kimi") return [hookConfigPath(rootPath, toolId)];
  const dir = toolId === "claude" ? ".claude" : toolId === "qwen" ? ".qwen" : toolId === "codebuddy" ? ".codebuddy" : ".qoder";
  return [path.join(rootPath, dir, "settings.local.json"), path.join(rootPath, dir, "settings.json")];
}

function readJsonContainer(configPath: string): JsonContainer {
  if (!fs.existsSync(configPath)) return { path: configPath, exists: false, value: {}, error: null };
  try {
    return { path: configPath, exists: true, value: parseJsonConfigText(fs.readFileSync(configPath, "utf8")), error: null };
  } catch (error) {
    return { path: configPath, exists: true, value: null, error: error instanceof Error ? error.message : "JSON 解析失败" };
  }
}

function readKimiHookContainer(configPath: string): { path: string; exists: boolean; hooks: unknown; error: string | null } {
  if (!fs.existsSync(configPath)) return { path: configPath, exists: false, hooks: [], error: null };
  try {
    return { path: configPath, exists: true, hooks: parseKimiHookRules(fs.readFileSync(configPath, "utf8")), error: null };
  } catch (error) {
    return { path: configPath, exists: true, hooks: null, error: error instanceof Error ? error.message : "Kimi hooks TOML 解析失败" };
  }
}

function parseKimiHookRules(input: string): Record<string, unknown>[] {
  const rules: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | null = null;

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[[hooks]]") {
      if (current) rules.push(current);
      current = {};
      continue;
    }
    if (!current) continue;
    if (line.startsWith("[")) {
      if (current) rules.push(current);
      current = null;
      continue;
    }
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!match?.[1]) continue;
    current[match[1]] = parseKimiTomlScalar(match[2] ?? "");
  }

  if (current) rules.push(current);
  return normalizeKimiHookRules(rules);
}

function serializeKimiHooksConfig(existing: string, hooks: unknown): string {
  const base = removeKimiHookBlocks(existing).trimEnd();
  const rules = normalizeKimiHookRules(hooks);
  const hookText = rules.map(kimiHookRuleToml).join("\n\n");
  const next = [base, hookText].filter((part) => part.trim()).join("\n\n");
  return next.trimEnd() ? `${next.trimEnd()}\n` : "";
}

function removeKimiHookBlocks(input: string): string {
  const output: string[] = [];
  let skippingHook = false;
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "[[hooks]]") {
      skippingHook = true;
      continue;
    }
    if (skippingHook && trimmed.startsWith("[")) {
      if (trimmed === "[[hooks]]") continue;
      skippingHook = false;
    }
    if (!skippingHook) output.push(line);
  }
  return output.join("\n");
}

function kimiHookRuleToml(rule: Record<string, unknown>): string {
  const lines = ["[[hooks]]"];
  lines.push(`event = ${kimiTomlValue(String(rule.event ?? ""))}`);
  if (typeof rule.matcher === "string" && rule.matcher.trim()) lines.push(`matcher = ${kimiTomlValue(rule.matcher.trim())}`);
  lines.push(`command = ${kimiTomlValue(String(rule.command ?? ""))}`);
  if (typeof rule.timeout === "number" && Number.isFinite(rule.timeout)) lines.push(`timeout = ${Math.max(1, Math.floor(rule.timeout))}`);
  return lines.join("\n");
}

function normalizeKimiHookRules(hooks: unknown): Record<string, unknown>[] {
  const rules: Record<string, unknown>[] = [];
  if (Array.isArray(hooks)) {
    for (const item of hooks) pushKimiHookRule(rules, null, item);
  } else if (isRecord(hooks)) {
    for (const [event, value] of Object.entries(hooks)) {
      if (Array.isArray(value)) {
        for (const item of value) pushKimiHookRule(rules, event, item);
      } else {
        pushKimiHookRule(rules, event, value);
      }
    }
  }
  return rules;
}

function pushKimiHookRule(output: Record<string, unknown>[], eventHint: string | null, value: unknown): void {
  if (typeof value === "string") {
    const event = kimiHookEventName(eventHint ?? "Stop");
    if (value.trim()) output.push({ event, command: value.trim() });
    return;
  }
  if (!isRecord(value)) return;
  const event = kimiHookEventName(stringValue(value.event) ?? eventHint ?? "Stop");
  const directCommand = stringValue(value.command);
  if (directCommand) {
    output.push(kimiHookRule(event, value, directCommand));
    return;
  }
  const nestedHooks = Array.isArray(value.hooks) ? value.hooks : [];
  for (const hook of nestedHooks) {
    if (!isRecord(hook)) continue;
    const command = stringValue(hook.command);
    if (command) output.push(kimiHookRule(event, { ...value, timeout: hook.timeout }, command));
  }
}

function kimiHookRule(event: string, source: Record<string, unknown>, command: string): Record<string, unknown> {
  return {
    event,
    ...(typeof source.matcher === "string" && source.matcher.trim() ? { matcher: source.matcher.trim() } : {}),
    command,
    ...(typeof source.timeout === "number" ? { timeout: source.timeout } : {})
  };
}

function kimiHookEventName(eventName: string): string {
  const known: Record<string, string> = {
    pre: "PreToolUse",
    post: "PostToolUse",
    stop: "Stop",
    session_start: "SessionStart",
    user_prompt_submit: "UserPromptSubmit",
    notification: "Notification",
    subagent_stop: "SubagentStop",
    pre_compact: "PreCompact",
    post_compact: "PostCompact"
  };
  return known[eventName] ?? eventName;
}

function parseKimiTomlScalar(value: string): unknown {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return trimmed.startsWith('"') ? JSON.parse(trimmed) : trimmed.slice(1, -1);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : trimmed;
}

function kimiTomlValue(value: string): string {
  return JSON.stringify(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function parseJsonConfigText(input: string): unknown {
  return JSON.parse(stripJsonComments(input));
}

function stripJsonComments(input: string): string {
  return input.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
}

function extractHooksPayload(toolId: HookHubSupportedToolId, value: unknown): unknown | null {
  if (!isRecord(value)) return null;
  if (Object.prototype.hasOwnProperty.call(value, "hooks")) return value.hooks;
  if (toolId === "codex" && Object.keys(value).length > 0) return value;
  return null;
}

function writeHooksSection(toolId: HookHubSupportedToolId, configPath: string, hooks: unknown): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (toolId === "kimi") {
    const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
    fs.writeFileSync(configPath, serializeKimiHooksConfig(existing, hooks), "utf8");
    return;
  }
  const container = readJsonContainer(configPath);
  if (container.error) throw new Error(container.error);
  const base = isRecord(container.value) ? { ...container.value } : {};
  if (toolId === "codex" && !Object.prototype.hasOwnProperty.call(base, "hooks") && Object.keys(base).length === 0) {
    fs.writeFileSync(configPath, `${stableJson(hooks, 2)}\n`, "utf8");
    return;
  }
  base.hooks = hooks;
  fs.writeFileSync(configPath, `${stableJson(base, 2)}\n`, "utf8");
}

function ensureProjectToolEnabled(database: AppDatabase, project: Project, toolId: HookHubSupportedToolId, config?: AppConfig): void {
  ensureProjectHookWritebackSupported(toolId);
  const target = listProjectToolTargets(database, project, config).find((item) => item.toolId === toolId);
  if (!target?.enabled) throw new Error("该工具未在项目中启用");
}

function ensureProjectHookWritebackSupported(toolId: HookHubSupportedToolId): void {
  if (!isProjectHookWritebackToolId(toolId)) {
    throw new Error("Kimi Code 官方文档目前没有项目级 hook 配置机制，HookHub 不写入用户级 config.toml");
  }
}

function ensureReplacementMode(database: AppDatabase, currentState: ProjectHookToolState, suite: HookHubSuite, options: HookApplyOptions): void {
  if (currentState.status === "unmanaged" && !options.mode) {
    throw new Error("unmanaged hooks 需要选择覆盖、上传后覆盖或取消");
  }
  if (currentState.status === "drifted" && currentState.binding?.suiteId !== suite.suiteId && !options.mode) {
    throw new Error("drifted hooks 需要选择覆盖、写回原 suite、另存为新 suite 或取消");
  }
  if (currentState.status === "drifted" && options.mode === "update-bound-suite-then-overwrite" && !currentState.binding) {
    throw new Error("当前工具没有可写回的原 suite");
  }
  if (
    (options.mode === "upload-then-overwrite" || options.mode === "save-as-new-suite-then-overwrite") &&
    !currentState.hooks
  ) {
    throw new Error("当前工具没有可保存的 hooks section");
  }
  if (options.mode === "update-bound-suite-then-overwrite" && currentState.binding && !database.getHookHubSuite(currentState.binding.suiteId)) {
    throw new Error("原 suite 不存在，无法写回");
  }
}

function preserveCurrentHooksIfRequested(database: AppDatabase, currentState: ProjectHookToolState, options: HookApplyOptions): void {
  if (!isHookHubSupportedToolId(currentState.toolId) || isEmptyHooks(currentState.hooks)) return;
  if (options.mode === "upload-then-overwrite" || options.mode === "save-as-new-suite-then-overwrite") {
    createHookHubSuite(
      database,
      suiteInputWithPayload(
        {
          name: options.preserveName ?? `${currentState.toolId} hooks ${new Date().toISOString()}`,
          ...(options.description !== undefined ? { description: options.description } : {}),
          ...(options.riskNotes !== undefined ? { riskNotes: options.riskNotes } : {}),
          ...(options.requiredEnv !== undefined ? { requiredEnv: options.requiredEnv } : {})
        },
        currentState.toolId,
        currentState.hooks
      )
    );
  }
  if (options.mode === "update-bound-suite-then-overwrite" && currentState.binding) {
    const original = database.getHookHubSuite(currentState.binding.suiteId);
    if (!original) throw new Error("原 suite 不存在，无法写回");
    updateHookHubSuite(database, original.suiteId, {
      payloads: { ...original.payloads, [currentState.toolId]: currentState.hooks }
    });
  }
}

function replacementWarnings(currentState: ProjectHookToolState, options: HookApplyOptions): string[] {
  const warnings: string[] = [];
  if (currentState.status === "unmanaged") warnings.push("已覆盖未接管 hooks");
  if (currentState.status === "drifted") warnings.push("已覆盖 drifted hooks");
  if (options.mode === "upload-then-overwrite" || options.mode === "save-as-new-suite-then-overwrite") warnings.push("覆盖前已另存当前 hooks");
  if (options.mode === "update-bound-suite-then-overwrite") warnings.push("覆盖前已写回原 suite");
  return warnings;
}

function protectBeforeReplacement(
  projectRoot: string,
  configPath: string,
  toolId: HookHubSupportedToolId,
  options: Pick<HookApplyOptions, "gitCommand"> = {}
): HookHubBackupResult {
  if (!fs.existsSync(configPath)) {
    return { mode: "missing", backupPath: null, metadataPath: null, commit: null, message: "目标配置文件不存在，无需备份" };
  }
  const gitCommand = options.gitCommand ?? "git";
  const gitRoot = commandAvailable(gitCommand) ? gitOutput(projectRoot, ["rev-parse", "--show-toplevel"], gitCommand, false) : null;
  if (gitRoot && isPathInsideOrEqual(gitRoot, configPath)) {
    const tracked = gitExit(projectRoot, ["ls-files", "--error-unmatch", "--", configPath], gitCommand) === 0;
    if (tracked) {
      const dirty = Boolean(gitOutput(projectRoot, ["status", "--porcelain", "--", configPath], gitCommand, false));
      if (!dirty) return { mode: "git-clean", backupPath: null, metadataPath: null, commit: null, message: "目标配置由 Git 管理且无未提交内容" };
      gitOutput(projectRoot, ["add", "--", configPath], gitCommand);
      gitOutput(
        projectRoot,
        ["-c", "user.name=HookHub", "-c", "user.email=hookhub@example.local", "commit", "-m", `chore: HookHub 覆盖前备份 ${path.basename(configPath)}`, "--", configPath],
        gitCommand
      );
      return {
        mode: "git-commit",
        backupPath: null,
        metadataPath: null,
        commit: gitOutput(projectRoot, ["rev-parse", "HEAD"], gitCommand, false),
        message: "目标配置覆盖前已 commit"
      };
    }
  }
  return writeLocalBackup(projectRoot, configPath, toolId);
}

function writeLocalBackup(projectRoot: string, configPath: string, toolId: HookHubSupportedToolId): HookHubBackupResult {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(projectRoot, ".hookhub", "backups", `${stamp}-${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(backupRoot, { recursive: true });
  const relative = path.relative(projectRoot, configPath);
  const backupPath = path.join(backupRoot, relative && !relative.startsWith("..") ? relative : path.basename(configPath));
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(configPath, backupPath);
  const metadataPath = path.join(backupRoot, "metadata.json");
  fs.writeFileSync(
    metadataPath,
    `${stableJson(
      {
        originalPath: displayPath(configPath),
        backupPath,
        toolId,
        operation: "replace-hooks-section",
        createdAt: nowIso()
      },
      2
    )}\n`,
    "utf8"
  );
  return { mode: "local-backup", backupPath, metadataPath, commit: null, message: "目标配置覆盖前已写入本地备份" };
}

function hooksFingerprint(hooks: unknown): string {
  return crypto.createHash("sha256").update(stableJson(hooks)).digest("hex");
}

function stableJson(value: unknown, space = 0): string {
  return JSON.stringify(sortJsonValue(value), null, space);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJsonValue(value[key])]));
}

function hooksSummary(hooks: unknown): string {
  if (isEmptyHooks(hooks)) return "无 hooks";
  if (Array.isArray(hooks)) return `${hooks.length} 条 hooks`;
  if (isRecord(hooks)) {
    const keys = Object.keys(hooks);
    return keys.length ? `${keys.length} 个事件：${keys.slice(0, 4).join(" / ")}` : "空 hooks";
  }
  return typeof hooks;
}

function isEmptyHooks(hooks: unknown): boolean {
  if (hooks === null || hooks === undefined) return true;
  if (Array.isArray(hooks)) return hooks.length === 0;
  if (isRecord(hooks)) return Object.keys(hooks).length === 0;
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseHookHubSuiteDocument(input: string): HookHubExportDocument {
  const parsed = parseJsonConfigText(input);
  if (isRecord(parsed) && parsed.format === "hookhub-suite-v1" && isRecord(parsed.suite)) {
    return { format: "hookhub-suite-v1", suite: parsed.suite as unknown as HookHubSuite };
  }
  if (isRecord(parsed) && typeof parsed.name === "string") {
    return { format: "hookhub-suite-v1", suite: parsed as unknown as HookHubSuite };
  }
  throw new Error("只支持 HookHub 导出的 suite JSON");
}

function discoverOpenCodeHooks(rootPath: string): string[] {
  const entries: string[] = [];
  const pluginDir = path.join(rootPath, ".opencode", "plugins");
  if (fs.existsSync(pluginDir)) {
    const files = fs.readdirSync(pluginDir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
    if (files.length) entries.push(`plugins: ${files.join(", ")}`);
  }
  const configPath = path.join(rootPath, "opencode.json");
  const config = readJsonContainer(configPath);
  if (!config.error && isRecord(config.value) && Array.isArray(config.value.plugin)) entries.push(`opencode.json plugin: ${config.value.plugin.join(", ")}`);
  return entries;
}

function discoverCopilotHooks(rootPath: string): string[] {
  const hooksDir = path.join(rootPath, ".github", "hooks");
  if (!fs.existsSync(hooksDir)) return [];
  return fs
    .readdirSync(hooksDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(".github", "hooks", entry.name));
}

function skipFromBinding(binding: ProjectHookBinding, status: HookHubProjectStatus, reason: string) {
  return { projectId: binding.projectId, targetRootPath: binding.targetRootPath, toolId: binding.toolId, status, reason };
}

function scopeProject(project: Project, targetRootPath: string): Project {
  return {
    ...project,
    rootPath: displayPath(targetRootPath),
    normalizedRootPath: normalizeFsPath(targetRootPath),
    includeSubdirectories: false
  };
}

function commandAvailable(command: string): boolean {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

function gitExit(cwd: string, args: string[], gitCommand: string): number | null {
  return spawnSync(gitCommand, args, { cwd, encoding: "utf8" }).status;
}

function gitOutput(cwd: string, args: string[], gitCommand: string, required = true): string | null {
  const output = spawnSync(gitCommand, args, { cwd, encoding: "utf8" });
  if (output.status !== 0) {
    if (!required) return null;
    throw new Error((output.stderr || output.stdout || "git command failed").trim());
  }
  return output.stdout.trim();
}
