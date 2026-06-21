import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppConfig,
  AgentHubAgent,
  AgentHubToolId,
  HookHubSupportedToolId,
  McpHubServer,
  McpHubTargetToolId,
  PluginHubComponentRef,
  PluginHubCustomPluginInput,
  PluginHubDeleteFailure,
  PluginHubImportResult,
  PluginHubList,
  PluginHubHarnessSupport,
  PluginHubPlugin,
  PluginHubPluginDeletePreview,
  PluginHubPrivateFile,
  PluginHubPrivateFileRole,
  PluginHubSource,
  PluginHubSourceDeleteMode,
  PluginHubSourceDeletePreview,
  LocalOpenResponse,
  Project,
  ProjectLocalFileBackup,
  ProjectPluginApplyResult,
  ProjectPluginBinding,
  ProjectPluginComponentOwnership,
  ProjectPluginPreflightItem,
  ProjectPluginPrivateFileOwnership,
  ProjectPluginState,
  ProjectSkillTarget,
  ProjectToolTarget,
  SkillHubSkill,
  SkillHubSource,
  ToolId
} from "../../shared/types.js";
import { isAgentHubToolId, isMcpHubTargetToolId, isToolId } from "../../shared/types.js";
import { openLocalPath } from "../core/localFilesystem.js";
import { normalizeFsPath } from "../core/pathUtils.js";
import { nowIso } from "../core/time.js";
import type { AppDatabase } from "../storage/database.js";
import { applyProjectAgentTarget, conversionPreview, importPluginHubAgentRoots, isLocalImportAgentCandidate, renderAgentForTool } from "../agenthub/agenthub.js";
import { convertHookPayloadForTool, isHookHubSupportedToolId } from "../hookhub/hookhub.js";
import { ensureSkillHub, parseGitHubInput } from "../skillhub/skillhub.js";
import { createDirectoryLink, linkPointsTo, pathExists, removeDirectoryLink } from "../skillhub/links.js";
import { listProjectToolTargets } from "../skillhub/projectSkills.js";
import { applyProjectMcpServer, disableProjectMcpServer, importMcpHubJson, listMcpHub } from "../mcphub/mcphub.js";

type SessionProjectToolTarget = ProjectToolTarget & { toolId: ToolId };
type PluginMcpTargetToolId = Extract<McpHubTargetToolId, ToolId>;
type NativePluginToolId = Extract<ToolId, "claude" | "codex" | "qwen">;

interface DiscoveredPlugin {
  name: string;
  displayName: string;
  description: string | null;
  directory: string;
  sourceRelativePath: string;
  skills: DiscoveredPluginSkill[];
  agentRoot: DiscoveredPluginAgentRoot | null;
  mcpDocuments: DiscoveredPluginMcpDocument[];
  privateFiles: DiscoveredPrivateFile[];
}

interface DiscoverPluginOptions {
  preserveSourceRootInPackage?: boolean;
}

interface PluginFileRoutes {
  skills: DiscoveredPluginSkill[];
  agentRoot: DiscoveredPluginAgentRoot | null;
  mcpDocuments: DiscoveredPluginMcpDocument[];
  privateFiles: DiscoveredPrivateFile[];
}

interface DiscoveredPluginSkill {
  directory: string;
  folderName: string;
  skillName: string | null;
  description: string | null;
  sourceRelativePath: string;
  contentHash: string;
}

interface DiscoveredPrivateFile {
  filePath: string;
  sourceRelativePath: string;
  targetRelativePath: string;
  contentHash: string;
}

interface DiscoveredPluginAgentRoot {
  rootPath: string;
  sourceRelativePrefix: string;
}

interface DiscoveredPluginMcpDocument {
  sourceRelativePath: string;
  input: string;
}

interface DiscoveredPluginManifestFallback {
  name: string | null;
  displayName: string | null;
  description: string | null;
}

interface DiscoveredMarketplacePlugin {
  directory: string;
  sourceRelativePath: string;
  manifestFallback: DiscoveredPluginManifestFallback;
}

type PluginPackagePathPlugin = Pick<PluginHubPlugin, "name" | "privateFiles"> & {
  source?: PluginHubSource | null;
};

interface ApplyOptions {
  conflictMode?: "overwrite" | "skip" | null;
  config?: AppConfig | undefined;
}

interface PluginHubImportOptions {
  sourceId?: string;
  sourceLabel?: string;
  inputPath?: string;
  type?: PluginHubSource["type"];
  repoKey?: string | null;
  owner?: string | null;
  repo?: string | null;
  branch?: string | null;
  input?: string;
  sourcePath?: string | null;
  currentRevision?: string | null;
  checkoutPath?: string | null;
}

interface PluginHubGitHubImportOptions {
  fixturePath?: string;
}

interface PluginHubListOptions {
  seedDefaultSources?: boolean;
}

interface BuiltInPluginSource {
  sourceId: string;
  folderName: string;
  label: string;
  seedSettingKey?: string;
}

interface SkillInstallPlan {
  ref: PluginHubComponentRef;
  skill: SkillHubSkill;
  linkPath: string;
}

interface PrivateInstallPlan {
  file: PluginHubPrivateFile;
  targetPath: string;
  previousOwnership: ProjectPluginPrivateFileOwnership | null;
}

interface AgentInstallPlan {
  ref: PluginHubComponentRef;
  agent: AgentHubAgent;
  toolId: AgentHubToolId;
  targetPath: string;
}

interface McpInstallPlan {
  ref: PluginHubComponentRef;
  server: McpHubServer;
  toolId: PluginMcpTargetToolId;
  configPath: string;
}

interface NativePackageInstallPlan {
  toolId: NativePluginToolId;
  ownerId: string;
  pluginName: string;
  packageRoot: string;
  marketplacePath: string;
  settingsPath: string | null;
  marketplaceName: string;
  previousPackageRoot: string | null;
  previousOwnership: ProjectPluginPrivateFileOwnership | null;
}

interface NativeHookInstallPlan {
  toolId: ToolId;
  ownerId: string;
  configPath: string;
  hooks: unknown;
  previousFingerprint: string | null;
}

const PLUGINHUB_SKILL_SOURCE_TYPE: SkillHubSource["type"] = "plugin";
const DEFAULT_PLUGINHUB_SEEDED_SETTING = "pluginhub.default-sources.seeded.v1";
const SUPERPOWERS_RUNTIME_PRIVATE_FILES_SEEDED_SETTING = "pluginhub.default-source.superpowers.runtime-private-files.seeded.v1";
const CAVEMAN_SEEDED_SETTING = "pluginhub.default-source.caveman.seeded.v1";
const BUILT_IN_PLUGIN_SOURCES: BuiltInPluginSource[] = [
  {
    sourceId: "pluginhub-source-superpowers",
    folderName: "superpowers",
    label: "obra/superpowers",
    seedSettingKey: SUPERPOWERS_RUNTIME_PRIVATE_FILES_SEEDED_SETTING
  },
  {
    sourceId: "pluginhub-source-caveman",
    folderName: "caveman",
    label: "JuliusBrussee/caveman",
    seedSettingKey: CAVEMAN_SEEDED_SETTING
  }
];

export function listPluginHub(database: AppDatabase, config?: AppConfig, dataDir?: string, options: PluginHubListOptions = {}): PluginHubList {
  if ((options.seedDefaultSources ?? true) && config && dataDir) seedDefaultPluginHubSources(database, config, dataDir);
  const plugins = database.listPluginHubPlugins().map(withResolvedPluginHarnessSupport);
  return {
    sources: database.listPluginHubSources(),
    plugins,
    sourcePlugins: plugins.filter((plugin) => plugin.kind === "source"),
    customPlugins: plugins.filter((plugin) => plugin.kind === "custom"),
    skills: database.listSkillHubSkills(),
    agents: database.listAgentHubAgents(),
    mcpServers: listMcpHub(database).servers,
    hookSuites: database.listHookHubSuites()
  };
}

export function refreshPluginHubDiscovery(database: AppDatabase, config: AppConfig, dataDir: string): PluginHubList {
  seedDefaultPluginHubSources(database, config, dataDir);
  return listPluginHub(database, config, dataDir, { seedDefaultSources: false });
}

export function importPluginHubLocalSource(
  database: AppDatabase,
  config: AppConfig,
  dataDir: string,
  inputPath: string
): PluginHubImportResult {
  return importPluginHubSource(database, config, dataDir, inputPath, {
    type: "local",
    input: inputPath,
    inputPath,
    sourcePath: null,
    repoKey: null,
    owner: null,
    repo: null,
    branch: null,
    currentRevision: null,
    checkoutPath: null
  });
}

export function importPluginHubGitHubSource(
  database: AppDatabase,
  config: AppConfig,
  dataDir: string,
  input: string,
  options: PluginHubGitHubImportOptions = {}
): PluginHubImportResult {
  const parsed = parseGitHubInput(input);
  const existing = database.getPluginHubSourceByRepoKey(parsed.repoKey);
  const sourceId = existing?.id ?? stableId("pluginhub-source-github", parsed.repoKey);
  const checkoutPath = existing?.checkoutPath ?? path.join(dataDir, "pluginhub", "sources", sourceId, "checkout");
  materializeGitHubCheckout(parsed, checkoutPath, options.fixturePath);
  const revision = gitOutput(["-C", checkoutPath, "rev-parse", "HEAD"]);
  const branch = parsed.branch ?? (gitOutput(["-C", checkoutPath, "rev-parse", "--abbrev-ref", "HEAD"], false) || null);
  const scanRoot = parsed.inputPath ? path.join(checkoutPath, parsed.inputPath) : checkoutPath;
  if (!fs.existsSync(scanRoot) || !fs.statSync(scanRoot).isDirectory()) {
    throw new Error(`GitHub Plugin source path not found: ${parsed.inputPath ?? "."}`);
  }

  return importPluginHubSource(database, config, dataDir, scanRoot, {
    sourceId,
    sourceLabel: pluginHubGitHubLabel(parsed.owner, parsed.repo, parsed.inputPath),
    type: "github",
    repoKey: parsed.repoKey,
    owner: parsed.owner,
    repo: parsed.repo,
    branch,
    input,
    inputPath: input,
    sourcePath: parsed.inputPath,
    currentRevision: revision,
    checkoutPath
  });
}

export function updatePluginHubGitHubSource(database: AppDatabase, config: AppConfig, dataDir: string, sourceId: string): PluginHubImportResult {
  const source = database.getPluginHubSource(sourceId);
  if (!source || source.type !== "github" || !source.checkoutPath || !source.repoKey || !source.owner || !source.repo) {
    throw new Error("GitHub Plugin source not found");
  }
  updateGitHubCheckout(source);
  const revision = gitOutput(["-C", source.checkoutPath, "rev-parse", "HEAD"], false);
  const scanRoot = source.sourcePath ? path.join(source.checkoutPath, source.sourcePath) : source.checkoutPath;
  if (!fs.existsSync(scanRoot) || !fs.statSync(scanRoot).isDirectory()) {
    throw new Error(`GitHub Plugin source path not found: ${source.sourcePath ?? "."}`);
  }

  return importPluginHubSource(database, config, dataDir, scanRoot, {
    sourceId: source.id,
    sourceLabel: source.label,
    type: "github",
    repoKey: source.repoKey,
    owner: source.owner,
    repo: source.repo,
    branch: source.branch,
    input: source.input,
    inputPath: source.inputPath,
    sourcePath: source.sourcePath,
    currentRevision: revision ?? source.currentRevision,
    checkoutPath: source.checkoutPath
  });
}

export function seedDefaultPluginHubSources(database: AppDatabase, config: AppConfig, dataDir: string): void {
  const legacyDefaultsSeeded = database.getSetting(DEFAULT_PLUGINHUB_SEEDED_SETTING, false);
  for (const source of BUILT_IN_PLUGIN_SOURCES) {
    const settingKey = source.seedSettingKey ?? DEFAULT_PLUGINHUB_SEEDED_SETTING;
    if ((source.seedSettingKey ? database.getSetting(settingKey, false) : legacyDefaultsSeeded)) continue;
    if (seedBuiltInPluginSource(database, config, dataDir, source)) {
      database.setSetting(settingKey, true);
    }
  }
}

function seedBuiltInPluginSource(database: AppDatabase, config: AppConfig, dataDir: string, source: BuiltInPluginSource): boolean {
  const sourcePath = resolveBundledPath("builtin-plugins", source.folderName);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) return false;
  const result = importPluginHubSource(database, config, dataDir, sourcePath, {
    sourceId: source.sourceId,
    sourceLabel: source.label,
    inputPath: `builtin-plugins/${source.folderName}`,
    input: `builtin-plugins/${source.folderName}`,
    type: "local",
    sourcePath: null
  });
  return result.plugins.length > 0 || Boolean(database.getPluginHubSource(source.sourceId));
}

function importPluginHubSource(
  database: AppDatabase,
  config: AppConfig,
  dataDir: string,
  inputPath: string,
  options: PluginHubImportOptions = {}
): PluginHubImportResult {
  const inputSourcePath = path.resolve(inputPath);
  if (!fs.existsSync(inputSourcePath) || !fs.statSync(inputSourcePath).isDirectory()) {
    throw new Error("Plugin 导入路径必须是已存在的目录");
  }

  const sourceType = options.type ?? "local";
  const existingById = options.sourceId ? database.getPluginHubSource(options.sourceId) : null;
  const localSourceId = stableId("pluginhub-source", normalizeFsPath(inputSourcePath));
  const existing = existingById ?? (sourceType === "local" ? database.getPluginHubSource(options.sourceId ?? localSourceId) : database.getPluginHubSourceByResolvedPath(inputSourcePath));
  const sourceId = existing?.id ?? options.sourceId ?? localSourceId;
  const previousSourcePlugins = database.listPluginHubPluginsForSource(sourceId);
  const previousSourceSkills = database.listSkillHubSkillsForSource(sourceId);
  const sourcePath = sourceType === "local" ? materializePluginHubLocalSource(dataDir, sourceId, inputSourcePath) : inputSourcePath;
  const discovered = discoverPluginSource(sourcePath, path.basename(inputSourcePath) || "plugin");
  if (discovered.plugins.length === 0) {
    throw new Error("未找到可导入的 plugin");
  }

  const source = database.upsertPluginHubSource({
    id: sourceId,
    type: sourceType,
    kind: discovered.kind,
    label: options.sourceLabel ?? (path.basename(inputSourcePath) || inputSourcePath),
    repoKey: options.repoKey ?? null,
    owner: options.owner ?? null,
    repo: options.repo ?? null,
    branch: options.branch ?? null,
    input: options.input ?? options.inputPath ?? inputSourcePath,
    inputPath: options.inputPath ?? inputSourcePath,
    sourcePath: options.sourcePath ?? null,
    resolvedPath: sourcePath,
    currentRevision: options.currentRevision ?? null,
    checkoutPath: options.checkoutPath ?? null,
    pluginCount: discovered.plugins.length,
    componentCount: discoveredComponentCount(discovered.plugins),
    privateFileCount: discovered.plugins.reduce((count, plugin) => count + plugin.privateFiles.length, 0)
  });
  const skillSource = upsertPluginSkillSource(database, source);
  const resolvedSkillHub = ensureSkillHub(config, dataDir);
  const importedSkills: SkillHubSkill[] = [];
  const plugins: PluginHubPlugin[] = [];
  const agentImport = importDiscoveredPluginAgents(database, dataDir, source, discovered.plugins, discovered.skipped);
  const agentsBySourceRelativePath = new Map(agentImport.agents.map((agent) => [agent.sourceRelativePath, agent]));
  const mcpServersByPluginSourcePath = importDiscoveredPluginMcp(database, discovered.plugins, discovered.skipped);

  for (const plugin of discovered.plugins) {
    const componentRefs: PluginHubComponentRef[] = [];
    for (const skill of plugin.skills) {
      const libraryRelativePath = normalizeRelativePath(path.join("pluginhub", source.id, skill.sourceRelativePath));
      const libraryPath = safeJoin(resolvedSkillHub.libraryDir, libraryRelativePath);
      replaceDirectory(skill.directory, libraryPath);
      const existingSkill = database.getSkillHubSkillByLibraryRelativePath(libraryRelativePath);
      const storedSkill = database.upsertSkillHubSkill({
        id: existingSkill?.id ?? stableId("pluginhub-skill", source.id, skill.sourceRelativePath),
        sourceId: skillSource.id,
        sourceType: skillSource.type,
        folderName: skill.folderName,
        skillName: skill.skillName,
        description: skill.description,
        libraryRelativePath,
        libraryPath,
        sourceRelativePath: skill.sourceRelativePath,
        contentHash: skill.contentHash
      });
      importedSkills.push(storedSkill);
      componentRefs.push({ type: "skill", componentId: storedSkill.id, required: false });
    }
    if (plugin.agentRoot) {
      const prefix = normalizeRelativePath(plugin.agentRoot.sourceRelativePrefix);
      const agents = [...agentsBySourceRelativePath.values()].filter((agent) => agent.sourceRelativePath?.startsWith(`${prefix}/`));
      for (const agent of agents) componentRefs.push({ type: "agent", componentId: agent.id, required: false });
    }
    for (const server of mcpServersByPluginSourcePath.get(plugin.sourceRelativePath) ?? []) {
      componentRefs.push({ type: "mcp", componentId: server.serverId, required: false });
    }

    const pluginId = stableId("pluginhub-plugin", source.id, plugin.name);
    const privateFiles = plugin.privateFiles.map((file) => privateFileFromDiscovery(pluginId, file));
    plugins.push(
      database.upsertPluginHubPlugin({
        id: pluginId,
        kind: "source",
        sourceId: source.id,
        name: plugin.name,
        displayName: plugin.displayName,
        description: plugin.description,
        componentRefs,
        privateFiles,
        harnessSupport: pluginHarnessSupport({ name: plugin.name, componentRefs, privateFiles, source })
      })
    );
  }

  pruneStalePluginHubSourceRecords(database, previousSourcePlugins, previousSourceSkills, plugins, importedSkills, discovered.skipped);

  return { source, plugins, importedSkills, skipped: discovered.skipped };
}

function pruneStalePluginHubSourceRecords(
  database: AppDatabase,
  previousPlugins: PluginHubPlugin[],
  previousSkills: SkillHubSkill[],
  currentPlugins: PluginHubPlugin[],
  currentSkills: SkillHubSkill[],
  skipped: PluginHubImportResult["skipped"]
): void {
  const currentPluginIds = new Set(currentPlugins.map((plugin) => plugin.id));
  for (const plugin of previousPlugins) {
    if (currentPluginIds.has(plugin.id)) continue;
    const deleted = deletePluginHubPlugin(database, plugin.id);
    if (deleted.failures.length > 0) {
      skipped.push(...deleted.failures.map((failure) => ({ path: failure.path, reason: `stale plugin ${plugin.name} cleanup failed: ${failure.reason}` })));
    }
  }

  const currentSkillIds = new Set(currentSkills.map((skill) => skill.id));
  const livePluginComponentIds = new Set(
    database
      .listPluginHubPlugins()
      .flatMap((plugin) => plugin.componentRefs.map((ref) => ref.componentId))
  );
  const liveBindingComponentIds = new Set(
    database
      .listProjectPluginBindings()
      .flatMap((binding) => binding.componentOwnership.map((owner) => owner.componentId))
  );
  for (const skill of previousSkills) {
    if (currentSkillIds.has(skill.id)) continue;
    if (livePluginComponentIds.has(skill.id) || liveBindingComponentIds.has(skill.id)) continue;
    const targets = database.listProjectSkillTargetsForSkill(skill.id);
    if (targets.length > 0) {
      skipped.push({ path: skill.libraryPath, reason: `stale skill ${skill.folderName} still has project targets` });
      continue;
    }
    fs.rmSync(skill.libraryPath, { recursive: true, force: true });
    database.deleteSkillHubSkill(skill.id);
  }
}

export function createCustomPlugin(database: AppDatabase, dataDir: string, input: PluginHubCustomPluginInput): PluginHubPlugin {
  return upsertCustomPlugin(database, dataDir, crypto.randomUUID(), input);
}

export function updateCustomPlugin(database: AppDatabase, dataDir: string, pluginId: string, input: PluginHubCustomPluginInput): PluginHubPlugin {
  const existing = database.getPluginHubPlugin(pluginId);
  if (!existing || existing.kind !== "custom") throw new Error("Custom plugin not found");
  return upsertCustomPlugin(database, dataDir, pluginId, input, existing);
}

export function listProjectPluginState(database: AppDatabase, project: Project, config?: AppConfig, dataDir?: string): ProjectPluginState {
  if (config && dataDir) seedDefaultPluginHubSources(database, config, dataDir);
  const bindings = database
    .listProjectPluginBindings(project.id)
    .filter((binding) => normalizeFsPath(binding.targetRootPath) === normalizeFsPath(project.rootPath));
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolTargets: listProjectToolTargets(database, project, config).filter((target): target is SessionProjectToolTarget => target.enabled && isToolId(target.toolId)),
    plugins: database.listPluginHubPlugins().map(withResolvedPluginHarnessSupport),
    bindings,
    syncRequiredPluginIds: bindings.filter((binding) => binding.plugin && topologyHash(binding.plugin) !== binding.topologyHash).map((binding) => binding.pluginId)
  };
}

export function installProjectPlugin(
  database: AppDatabase,
  project: Project,
  pluginId: string,
  toolId: ToolId,
  dataDirOrOptions: string | ApplyOptions = {},
  maybeOptions: ApplyOptions = {}
): ProjectPluginApplyResult {
  const dataDir = typeof dataDirOrOptions === "string" ? dataDirOrOptions : null;
  const options = typeof dataDirOrOptions === "string" ? maybeOptions : dataDirOrOptions;
  const plugin = database.getPluginHubPlugin(pluginId);
  if (!plugin) throw new Error("PluginHub plugin not found");
  const toolTarget = projectToolTarget(database, project, toolId, options.config);
  if (!toolTarget?.enabled) {
    throw new Error("该工具未在项目中启用");
  }
  if (!toolTarget.supported) {
    throw new Error(toolTarget.reason ?? "该工具暂不支持项目 plugin 安装");
  }
  if (!canInstallPluginForTool(plugin, toolId)) {
    const support = pluginToolSupport(plugin, toolId);
    throw new Error(support === "planned" ? "该 Plugin 的目标工具适配尚未实现" : "该 Plugin 不支持安装到目标工具");
  }

  return applyProjectPlugin(database, dataDir, project, plugin, toolTarget, options);
}

export function syncProjectPluginBinding(
  database: AppDatabase,
  project: Project,
  bindingId: string,
  dataDirOrOptions: string | ApplyOptions = {},
  maybeOptions: ApplyOptions = {}
): ProjectPluginApplyResult {
  const dataDir = typeof dataDirOrOptions === "string" ? dataDirOrOptions : null;
  const options = typeof dataDirOrOptions === "string" ? maybeOptions : dataDirOrOptions;
  const binding = database.listProjectPluginBindings(project.id).find((item) => item.id === bindingId);
  if (!binding?.plugin) throw new Error("Project plugin binding not found");
  const toolTarget = projectToolTarget(database, project, binding.toolId, options.config);
  if (!toolTarget?.enabled || !toolTarget.supported) {
    throw new Error(toolTarget?.reason ?? "该工具暂不支持项目 plugin 同步");
  }
  if (!canInstallPluginForTool(binding.plugin, binding.toolId)) {
    const support = pluginToolSupport(binding.plugin, binding.toolId);
    throw new Error(support === "planned" ? "该 Plugin 的目标工具适配尚未实现" : "该 Plugin 不支持同步到目标工具");
  }
  return applyProjectPlugin(database, dataDir, project, binding.plugin, toolTarget, options);
}

export function uninstallProjectPluginBinding(database: AppDatabase, project: Project, bindingId: string): ProjectPluginApplyResult {
  const binding = database.listProjectPluginBindings(project.id).find((item) => item.id === bindingId);
  if (!binding) throw new Error("Project plugin binding not found");
  const failures = releaseRemovedOwnership(database, binding, null);
  if (failures.length > 0) {
    return {
      projectId: project.id,
      binding,
      preflight: [],
      backups: [],
      blocked: true,
      requiresConfirmation: false,
      message: `Plugin 卸载失败：${failures.map((failure) => failure.path).join(", ")}`
    };
  }
  database.deleteProjectPluginBinding(binding.id);
  return {
    projectId: project.id,
    binding: null,
    preflight: [],
    backups: [],
    blocked: false,
    requiresConfirmation: false,
    message: "Plugin 已从项目卸载"
  };
}

export function previewDeletePluginHubSource(database: AppDatabase, sourceId: string): PluginHubSourceDeletePreview {
  const source = database.getPluginHubSource(sourceId);
  if (!source) throw new Error("PluginHub source not found");
  const sourcePlugins = database.listPluginHubPluginsForSource(source.id);
  const sourceComponents = database.listSkillHubSkillsForSource(source.id);
  const sourceAgents = database.listAgentHubAgentsForSource(source.id);
  const componentIds = new Set([...sourceComponents.map((skill) => skill.id), ...sourceAgents.map((agent) => agent.id)]);
  const customPlugins = database
    .listCustomPluginHubPlugins()
    .filter((plugin) => plugin.componentRefs.some((ref) => componentIds.has(ref.componentId)));
  const affectedPluginIds = new Set([...sourcePlugins, ...customPlugins].map((plugin) => plugin.id));
  const projectBindings = database.listProjectPluginBindings().filter((binding) => affectedPluginIds.has(binding.pluginId));
  return { source, sourcePlugins, sourceComponents, customPlugins, projectBindings, failures: [] };
}

export function deletePluginHubSource(
  database: AppDatabase,
  sourceId: string,
  mode: PluginHubSourceDeleteMode
): PluginHubSourceDeletePreview {
  const preview = previewDeletePluginHubSource(database, sourceId);
  if (preview.customPlugins.length > 0 && !mode) {
    throw new Error("删除 source 前必须选择 custom plugin 引用处理方式");
  }

  const failures: PluginHubDeleteFailure[] = [];
  for (const binding of preview.projectBindings) {
    const bindingFailures = releaseRemovedOwnership(database, binding, null);
    if (bindingFailures.length > 0) {
      failures.push(...bindingFailures);
    } else {
      database.deleteProjectPluginBinding(binding.id);
    }
  }

  const sourceAgents = database.listAgentHubAgentsForSource(sourceId);
  failures.push(...removeSourceComponentTargets(database, preview.sourceComponents));
  failures.push(...removeSourceAgentTargets(database, sourceAgents));
  if (failures.length > 0) {
    return { ...preview, failures };
  }

  if (mode === "delete-custom-plugins") {
    for (const plugin of preview.customPlugins) {
      removeCustomPluginPrivateMaterial(plugin);
      database.deletePluginHubPlugin(plugin.id);
    }
  } else {
    const removedComponentIds = new Set([...preview.sourceComponents.map((skill) => skill.id), ...sourceAgents.map((agent) => agent.id)]);
    for (const plugin of preview.customPlugins) {
      database.upsertPluginHubPlugin({
        ...plugin,
        componentRefs: plugin.componentRefs.filter((ref) => !removedComponentIds.has(ref.componentId))
      });
    }
  }

  for (const skill of preview.sourceComponents) {
    fs.rmSync(skill.libraryPath, { recursive: true, force: true });
    database.deleteSkillHubSkill(skill.id);
  }
  for (const agent of sourceAgents) {
    fs.rmSync(agent.nativePath, { force: true });
    database.deleteAgentHubAgent(agent.id);
  }
  database.deleteAgentHubSource(sourceId);
  database.deletePluginHubPluginsForSource(sourceId);
  database.deletePluginHubSource(sourceId);
  database.deleteSkillHubSource(sourceId);
  removePluginHubSourceMaterial(preview.source);

  return { ...preview, failures: [] };
}

export function previewDeletePluginHubPlugin(database: AppDatabase, pluginId: string): PluginHubPluginDeletePreview {
  const plugin = database.getPluginHubPlugin(pluginId);
  if (!plugin) throw new Error("PluginHub plugin not found");
  return { plugin, projectBindings: database.listProjectPluginBindingsForPlugin(pluginId), failures: [] };
}

export function deletePluginHubPlugin(database: AppDatabase, pluginId: string): PluginHubPluginDeletePreview {
  const preview = previewDeletePluginHubPlugin(database, pluginId);
  const failures: PluginHubDeleteFailure[] = [];
  for (const binding of preview.projectBindings) {
    const bindingFailures = releaseRemovedOwnership(database, binding, null);
    if (bindingFailures.length > 0) {
      failures.push(...bindingFailures);
    } else {
      database.deleteProjectPluginBinding(binding.id);
    }
  }
  if (failures.length > 0) {
    return { ...preview, failures };
  }
  removeCustomPluginPrivateMaterial(preview.plugin);
  database.deletePluginHubPlugin(pluginId);
  return preview;
}

export function openPluginHubPrivateFile(database: AppDatabase, pluginId: string, fileId: string, target: "document" | "folder"): LocalOpenResponse {
  const plugin = database.getPluginHubPlugin(pluginId);
  if (!plugin) throw new Error("PluginHub plugin not found");
  const file = plugin.privateFiles.find((item) => item.id === fileId);
  if (!file) throw new Error("PluginHub private file not found");
  return openLocalPath(target === "document" ? file.contentPath : path.dirname(file.contentPath));
}

function applyProjectPlugin(
  database: AppDatabase,
  dataDir: string | null,
  project: Project,
  plugin: PluginHubPlugin,
  toolTarget: SessionProjectToolTarget,
  options: ApplyOptions
): ProjectPluginApplyResult {
  const existingBinding = database.getProjectPluginBinding(project.id, project.rootPath, toolTarget.toolId, plugin.id);
  const nativePackagePlans = nativePackageInstallPlans(project, plugin, toolTarget, existingBinding);
  const nativePackageMode = nativePackagePlans.length > 0;
  const skillPlans = nativePackageMode ? [] : skillInstallPlans(database, plugin, toolTarget);
  const privatePlans = nativePackageMode ? [] : privateInstallPlans(project, plugin, toolTarget, existingBinding);
  const nativeHookPlans = nativePackageMode && toolTarget.toolId !== "codex" ? [] : nativeHookInstallPlans(database, project, plugin, toolTarget, existingBinding);
  const mcpPlans = nativePackageMode ? [] : mcpInstallPlans(database, project, plugin, toolTarget);
  const agentPlans = nativePackageMode && toolTarget.toolId !== "codex" ? [] : agentInstallPlans(database, project, plugin, toolTarget);
  const preview = previewProjectPluginPreflight(
    database,
    project,
    toolTarget,
    existingBinding,
    skillPlans,
    privatePlans,
    nativeHookPlans,
    nativePackagePlans,
    mcpPlans,
    agentPlans
  );
  if (preview.preflight.length > 0 && !options.conflictMode) {
    return {
      projectId: project.id,
      binding: null,
      preflight: preview.preflight,
      backups: [],
      blocked: preview.blocked,
      requiresConfirmation: !preview.blocked,
      message: preview.blocked ? "Plugin 安装被 required 组件或 private-file 冲突阻止" : "Plugin 安装需要确认覆盖"
    };
  }
  const preflight: ProjectPluginPreflightItem[] = [];
  const backups: ProjectLocalFileBackup[] = [];
  const componentOwnership: ProjectPluginComponentOwnership[] = [];
  const privateFileOwnership: ProjectPluginPrivateFileOwnership[] = [];
  let blocked = false;

  for (const plan of nativePackagePlans) {
    const privateConflict = findPrivateTargetOwner(database, project.id, toolTarget.toolId, plan.packageRoot, existingBinding?.id ?? null);
    const samePackage = normalizeFsPath(plan.previousPackageRoot ?? "") === normalizeFsPath(plan.packageRoot);
    if (privateConflict && privateConflict.privateFileId !== plan.ownerId) {
      preflight.push({
        targetPath: plan.packageRoot,
        targetResourceType: "native-plugin",
        existingOwnerType: "plugin-private",
        overwriteReason: "目标原生 plugin package 已由其他 PluginHub plugin 占用",
        backupRequired: false,
        required: true,
        componentId: null,
        privateFileId: plan.ownerId
      });
      blocked = true;
      privateFileOwnership.push(nativePackageOwnershipItem(plan, "blocked", "目标原生 plugin package 已由其他 PluginHub plugin 占用"));
      continue;
    }

    const localConflict = !samePackage && !privateConflict && pathExists(plan.packageRoot);
    const driftedPackage = samePackage && plan.previousOwnership !== null && !managedNativePackageMatches(plan.previousOwnership);
    if ((localConflict || driftedPackage) && options.conflictMode !== "overwrite") {
      preflight.push({
        targetPath: plan.packageRoot,
        targetResourceType: "native-plugin",
        existingOwnerType: "local",
        overwriteReason: driftedPackage ? "PluginHub 管理的原生 plugin package 已被本地修改" : "目标原生 plugin package 路径已有本地内容",
        backupRequired: true,
        required: true,
        componentId: null,
        privateFileId: plan.ownerId
      });
      if (options.conflictMode === "skip") blocked = true;
      privateFileOwnership.push(nativePackageOwnershipItem(plan, "blocked", "原生 plugin package 必须覆盖或保持阻止"));
      continue;
    }

    if (localConflict || driftedPackage) backups.push(backupLocalTarget(project.rootPath, plan.packageRoot, "PluginHub", "native-plugin"));
    materializeNativePluginPackage(database, project, plugin, plan);
    privateFileOwnership.push(nativePackageOwnershipItem(plan, "managed", nativePackageOwnershipReason(plan, hashExistingPath(plan.packageRoot))));
    componentOwnership.push(...nativePackageComponentOwnership(database, plugin, plan));
  }

  for (const plan of skillPlans) {
    const existingByLink = database.getProjectSkillTargetByLinkPath(project.id, toolTarget.toolId, plan.linkPath);
    const sameComponent = existingByLink?.skillId === plan.skill.id || (pathExists(plan.linkPath) && linkPointsTo(plan.linkPath, plan.skill.libraryPath));
    if (sameComponent) {
      if (!pathExists(plan.linkPath)) createDirectoryLink(plan.skill.libraryPath, plan.linkPath);
      database.upsertProjectSkillTarget({
        projectId: project.id,
        toolId: toolTarget.toolId,
        skillId: plan.skill.id,
        linkPath: plan.linkPath,
        targetPath: plan.skill.libraryPath
      });
      componentOwnership.push(componentOwnershipItem(plan, toolTarget.toolId, "managed", null));
      continue;
    }

    if (existingByLink || pathExists(plan.linkPath)) {
      const localConflict = !existingByLink;
      preflight.push({
        targetPath: plan.linkPath,
        targetResourceType: "skill",
        existingOwnerType: existingByLink ? "different-component" : "local",
        overwriteReason: existingByLink ? "目标路径已由其他 SkillHub 组件占用" : "目标路径已有本地文件",
        backupRequired: localConflict,
        required: plan.ref.required,
        componentId: plan.skill.id,
        privateFileId: null
      });
      if (options.conflictMode === "overwrite") {
        if (localConflict) backups.push(backupLocalTarget(project.rootPath, plan.linkPath, "PluginHub", "skill"));
        replaceWithSkillLink(database, project.id, toolTarget.toolId, plan.skill, plan.linkPath);
        componentOwnership.push(componentOwnershipItem(plan, toolTarget.toolId, "managed", null));
      } else {
        if (plan.ref.required && options.conflictMode === "skip") blocked = true;
        componentOwnership.push(componentOwnershipItem(plan, toolTarget.toolId, "existing", existingByLink ? "沿用项目中已有 SkillHub 组件" : "沿用项目本地文件"));
      }
      continue;
    }

    createDirectoryLink(plan.skill.libraryPath, plan.linkPath);
    database.upsertProjectSkillTarget({
      projectId: project.id,
      toolId: toolTarget.toolId,
      skillId: plan.skill.id,
      linkPath: plan.linkPath,
      targetPath: plan.skill.libraryPath
    });
    componentOwnership.push(componentOwnershipItem(plan, toolTarget.toolId, "managed", null));
  }

  for (const plan of privatePlans) {
    const privateConflict = findPrivateTargetOwner(database, project.id, toolTarget.toolId, plan.targetPath, existingBinding?.id ?? null);
    if (privateConflict && privateConflict.privateFileId !== plan.file.id) {
      preflight.push({
        targetPath: plan.targetPath,
        targetResourceType: "private-file",
        existingOwnerType: "plugin-private",
        overwriteReason: "目标路径已由其他 plugin-private 文件占用",
        backupRequired: false,
        required: true,
        componentId: null,
        privateFileId: plan.file.id
      });
      blocked = true;
      privateFileOwnership.push(privateOwnershipItem(plan, toolTarget.toolId, "blocked", "目标路径已由其他 plugin-private 文件占用"));
      continue;
    }

    const samePrivate = plan.previousOwnership !== null || privateConflict?.privateFileId === plan.file.id;
    const localConflict = !samePrivate && pathExists(plan.targetPath);
    const driftedPrivate = plan.previousOwnership !== null && !managedPrivateFileMatches(plan.previousOwnership);
    if ((localConflict || driftedPrivate) && options.conflictMode !== "overwrite") {
      preflight.push({
        targetPath: plan.targetPath,
        targetResourceType: "private-file",
        existingOwnerType: "local",
        overwriteReason: driftedPrivate ? "PluginHub 管理的 plugin-private 文件已被本地修改" : "plugin-private 文件目标路径已有本地文件",
        backupRequired: true,
        required: true,
        componentId: null,
        privateFileId: plan.file.id
      });
      if (options.conflictMode === "skip") blocked = true;
      privateFileOwnership.push(privateOwnershipItem(plan, toolTarget.toolId, "blocked", "plugin-private 文件必须覆盖或保持阻止"));
      continue;
    }

    if (localConflict || driftedPrivate) backups.push(backupLocalTarget(project.rootPath, plan.targetPath, "PluginHub", "private-file"));
    materializePrivateFile(plan.file.contentPath, plan.targetPath);
    privateFileOwnership.push(privateOwnershipItem(plan, toolTarget.toolId, "managed", privateFileOwnershipReason(plan)));
  }

  for (const plan of nativeHookPlans) {
    const current = readPluginHookConfig(plan.toolId, plan.configPath);
    const currentFingerprint = hooksFingerprint(current.hooks);
    const currentOwned = plan.previousFingerprint !== null && currentFingerprint === plan.previousFingerprint;
    const sameHooks = currentFingerprint === hooksFingerprint(plan.hooks);
    const hasLocalHooks = !isEmptyHooks(current.hooks) && !currentOwned && !sameHooks;
    const needsOverwrite = Boolean(current.error) || hasLocalHooks;

    if (needsOverwrite && options.conflictMode !== "overwrite") {
      preflight.push({
        targetPath: plan.configPath,
        targetResourceType: "hook",
        existingOwnerType: "local",
        overwriteReason: current.error ? `目标工具 hooks 配置 JSON 解析失败：${current.error}` : "目标工具已有未接管 hooks section",
        backupRequired: true,
        required: true,
        componentId: null,
        privateFileId: plan.ownerId
      });
      if (options.conflictMode === "skip") blocked = true;
      privateFileOwnership.push(hookOwnershipItem(plan, "blocked", "plugin-native hooks 必须覆盖或保持阻止"));
      componentOwnership.push(...hookComponentOwnershipItems(database, plugin, plan, toolTarget.toolId, "existing", "plugin-native hooks 未覆盖"));
      continue;
    }

    if (needsOverwrite) backups.push(backupLocalTarget(project.rootPath, plan.configPath, "PluginHub", "hook"));
    writePluginHooksSection(toolTarget.toolId, plan.configPath, plan.hooks);
    privateFileOwnership.push(hookOwnershipItem(plan, "managed", hooksFingerprint(plan.hooks)));
    componentOwnership.push(...hookComponentOwnershipItems(database, plugin, plan, toolTarget.toolId, "managed", null));
  }

  for (const plan of mcpPlans) {
    const existingBindingForServer = database.getProjectMcpBinding(project.id, project.rootPath, plan.toolId, plan.server.serverId);
    const localEntry = existingBindingForServer ? null : readPluginMcpConfigEntry(plan.configPath, plan.toolId, plan.server.serverId);
    if (localEntry && options.conflictMode !== "overwrite") {
      preflight.push({
        targetPath: plan.configPath,
        targetResourceType: "mcp",
        existingOwnerType: "local",
        overwriteReason: "目标工具已有未接管 MCP entry",
        backupRequired: true,
        required: plan.ref.required,
        componentId: plan.server.serverId,
        privateFileId: null
      });
      if (plan.ref.required && options.conflictMode === "skip") blocked = true;
      componentOwnership.push(mcpOwnershipItem(plan, "existing", "沿用项目本地 MCP entry", plan.configPath));
      continue;
    }
    if (localEntry) {
      backups.push(backupLocalTarget(project.rootPath, plan.configPath, "PluginHub", "mcp"));
      removePluginMcpConfigEntry(plan.configPath, plan.toolId, plan.server.serverId);
    }
    const applied = applyProjectMcpServer(database, project, plan.toolId, plan.server.serverId, options.config);
    componentOwnership.push(mcpOwnershipItem(plan, "managed", null, applied.configPath));
  }

  for (const plan of agentPlans) {
    const existingBindingForAgent = database.getProjectAgentTargetByOutputPath(project.id, project.rootPath, plan.toolId, plan.targetPath);
    const sameAgent = existingBindingForAgent?.agentId === plan.agent.id;
    const localConflict = !existingBindingForAgent && pathExists(plan.targetPath);
    const managedConflict = existingBindingForAgent && !sameAgent;
    if ((localConflict || managedConflict) && options.conflictMode !== "overwrite") {
      preflight.push({
        targetPath: plan.targetPath,
        targetResourceType: "agent",
        existingOwnerType: managedConflict ? "different-component" : "local",
        overwriteReason: managedConflict ? "目标路径已由其他 AgentHub agent 占用" : "目标路径已有本地 agent 文件",
        backupRequired: localConflict,
        required: plan.ref.required,
        componentId: plan.agent.id,
        privateFileId: null
      });
      if (plan.ref.required && options.conflictMode === "skip") blocked = true;
      componentOwnership.push(agentOwnershipItem(plan, managedConflict ? "existing" : "existing", managedConflict ? "沿用项目中已有 AgentHub agent" : "沿用项目本地 agent 文件"));
      continue;
    }
    if (!dataDir) throw new Error("PluginHub 安装 AgentHub agent 需要 dataDir");
    const applied = applyAgentPlan(database, dataDir, project, plan, options);
    backups.push(...applied.backups);
    if (applied.requiresConfirmation || !applied.binding) {
      preflight.push({
        targetPath: plan.targetPath,
        targetResourceType: "agent",
        existingOwnerType: applied.replacedBindings.length > 0 ? "different-component" : "local",
        overwriteReason: applied.replacedBindings.length > 0 ? "目标路径已由其他 AgentHub agent 占用" : "目标路径已有本地 agent 文件",
        backupRequired: applied.conflicts.length > 0,
        required: plan.ref.required,
        componentId: plan.agent.id,
        privateFileId: null
      });
      if (plan.ref.required) blocked = true;
      componentOwnership.push(agentOwnershipItem(plan, "existing", "AgentHub agent 未覆盖"));
      continue;
    }
    componentOwnership.push(agentOwnershipItem(plan, "managed", null));
  }

  const requiresConfirmation = preflight.length > 0 && !options.conflictMode;
  if (requiresConfirmation || blocked) {
    return {
      projectId: project.id,
      binding: null,
      preflight,
      backups,
      blocked,
      requiresConfirmation,
      message: blocked ? "Plugin 安装被 required 组件或 private-file 冲突阻止" : "Plugin 安装需要确认覆盖"
    };
  }

  const timestamp = nowIso();
  const nextBinding = database.upsertProjectPluginBinding({
    ...(existingBinding ? { id: existingBinding.id } : {}),
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId: toolTarget.toolId,
    pluginId: plugin.id,
    managedComponentCount: componentOwnership.filter((item) => item.ownerState === "managed").length,
    existingComponentCount: componentOwnership.filter((item) => item.ownerState === "existing").length,
    privateFileCount: privateFileOwnership.filter((item) => item.ownerState === "managed" && item.kind !== "hook").length,
    topologyHash: topologyHash(plugin),
    componentOwnership,
    privateFileOwnership,
    installedAt: existingBinding?.installedAt ?? timestamp
  });
  if (existingBinding) releaseRemovedOwnership(database, existingBinding, nextBinding);
  return {
    projectId: project.id,
    binding: nextBinding,
    preflight,
    backups,
    blocked: false,
    requiresConfirmation: false,
    message: `Plugin 已安装：${nextBinding.managedComponentCount}/${componentOwnership.length} components managed`
  };
}

function previewProjectPluginPreflight(
  database: AppDatabase,
  project: Project,
  toolTarget: SessionProjectToolTarget,
  existingBinding: ProjectPluginBinding | null,
  skillPlans: SkillInstallPlan[],
  privatePlans: PrivateInstallPlan[],
  nativeHookPlans: NativeHookInstallPlan[],
  nativePackagePlans: NativePackageInstallPlan[],
  mcpPlans: McpInstallPlan[],
  agentPlans: AgentInstallPlan[]
): { preflight: ProjectPluginPreflightItem[]; blocked: boolean } {
  const preflight: ProjectPluginPreflightItem[] = [];
  let blocked = false;
  for (const plan of nativePackagePlans) {
    const privateConflict = findPrivateTargetOwner(database, project.id, toolTarget.toolId, plan.packageRoot, existingBinding?.id ?? null);
    const samePackage = normalizeFsPath(plan.previousPackageRoot ?? "") === normalizeFsPath(plan.packageRoot);
    if (privateConflict && privateConflict.privateFileId !== plan.ownerId) {
      preflight.push({
        targetPath: plan.packageRoot,
        targetResourceType: "native-plugin",
        existingOwnerType: "plugin-private",
        overwriteReason: "目标原生 plugin package 已由其他 PluginHub plugin 占用",
        backupRequired: false,
        required: true,
        componentId: null,
        privateFileId: plan.ownerId
      });
      blocked = true;
      continue;
    }
    const driftedPackage = samePackage && plan.previousOwnership !== null && !managedNativePackageMatches(plan.previousOwnership);
    if ((!privateConflict && !samePackage && pathExists(plan.packageRoot)) || driftedPackage) {
      preflight.push({
        targetPath: plan.packageRoot,
        targetResourceType: "native-plugin",
        existingOwnerType: "local",
        overwriteReason: driftedPackage ? "PluginHub 管理的原生 plugin package 已被本地修改" : "目标原生 plugin package 路径已有本地内容",
        backupRequired: true,
        required: true,
        componentId: null,
        privateFileId: plan.ownerId
      });
    }
  }

  for (const plan of skillPlans) {
    const existingByLink = database.getProjectSkillTargetByLinkPath(project.id, toolTarget.toolId, plan.linkPath);
    const sameComponent = existingByLink?.skillId === plan.skill.id || (pathExists(plan.linkPath) && linkPointsTo(plan.linkPath, plan.skill.libraryPath));
    if (sameComponent || (!existingByLink && !pathExists(plan.linkPath))) continue;
    preflight.push({
      targetPath: plan.linkPath,
      targetResourceType: "skill",
      existingOwnerType: existingByLink ? "different-component" : "local",
      overwriteReason: existingByLink ? "目标路径已由其他 SkillHub 组件占用" : "目标路径已有本地文件",
      backupRequired: !existingByLink,
      required: plan.ref.required,
      componentId: plan.skill.id,
      privateFileId: null
    });
  }

  for (const plan of privatePlans) {
    const privateConflict = findPrivateTargetOwner(database, project.id, toolTarget.toolId, plan.targetPath, existingBinding?.id ?? null);
    if (privateConflict && privateConflict.privateFileId !== plan.file.id) {
      preflight.push({
        targetPath: plan.targetPath,
        targetResourceType: "private-file",
        existingOwnerType: "plugin-private",
        overwriteReason: "目标路径已由其他 plugin-private 文件占用",
        backupRequired: false,
        required: true,
        componentId: null,
        privateFileId: plan.file.id
      });
      blocked = true;
      continue;
    }
    const samePrivate = plan.previousOwnership !== null || privateConflict?.privateFileId === plan.file.id;
    const driftedPrivate = plan.previousOwnership !== null && !managedPrivateFileMatches(plan.previousOwnership);
    if ((!samePrivate && !privateConflict && pathExists(plan.targetPath)) || driftedPrivate) {
      preflight.push({
        targetPath: plan.targetPath,
        targetResourceType: "private-file",
        existingOwnerType: "local",
        overwriteReason: driftedPrivate ? "PluginHub 管理的 plugin-private 文件已被本地修改" : "plugin-private 文件目标路径已有本地文件",
        backupRequired: true,
        required: true,
        componentId: null,
        privateFileId: plan.file.id
      });
    }
  }

  for (const plan of nativeHookPlans) {
    const current = readPluginHookConfig(plan.toolId, plan.configPath);
    const currentFingerprint = hooksFingerprint(current.hooks);
    const currentOwned = plan.previousFingerprint !== null && currentFingerprint === plan.previousFingerprint;
    const sameHooks = currentFingerprint === hooksFingerprint(plan.hooks);
    if (!current.error && (isEmptyHooks(current.hooks) || currentOwned || sameHooks)) continue;
    preflight.push({
      targetPath: plan.configPath,
      targetResourceType: "hook",
      existingOwnerType: "local",
      overwriteReason: current.error ? `目标工具 hooks 配置 JSON 解析失败：${current.error}` : "目标工具已有未接管 hooks section",
      backupRequired: true,
      required: true,
      componentId: null,
      privateFileId: plan.ownerId
    });
  }

  for (const plan of mcpPlans) {
    const existingBindingForServer = database.getProjectMcpBinding(project.id, project.rootPath, plan.toolId, plan.server.serverId);
    if (existingBindingForServer) continue;
    const existingConfigEntry = readPluginMcpConfigEntry(plan.configPath, plan.toolId, plan.server.serverId);
    if (!existingConfigEntry) continue;
    preflight.push({
      targetPath: plan.configPath,
      targetResourceType: "mcp",
      existingOwnerType: "local",
      overwriteReason: "目标工具已有未接管 MCP entry",
      backupRequired: true,
      required: plan.ref.required,
      componentId: plan.server.serverId,
      privateFileId: null
    });
  }

  for (const plan of agentPlans) {
    const existingByPath = database.getProjectAgentTargetByOutputPath(project.id, project.rootPath, plan.toolId, plan.targetPath);
    const sameComponent = existingByPath?.agentId === plan.agent.id;
    if (sameComponent || (!existingByPath && !pathExists(plan.targetPath))) continue;
    preflight.push({
      targetPath: plan.targetPath,
      targetResourceType: "agent",
      existingOwnerType: existingByPath ? "different-component" : "local",
      overwriteReason: existingByPath ? "目标路径已由其他 AgentHub agent 占用" : "目标路径已有本地 agent 文件",
      backupRequired: !existingByPath,
      required: plan.ref.required,
      componentId: plan.agent.id,
      privateFileId: null
    });
  }

  return { preflight, blocked };
}

function upsertCustomPlugin(
  database: AppDatabase,
  dataDir: string,
  pluginId: string,
  input: PluginHubCustomPluginInput,
  existing?: PluginHubPlugin
): PluginHubPlugin {
  const name = safeName(input.name || existing?.name || "");
  if (!name) throw new Error("Plugin name is required");
  const privateRoot = path.join(dataDir, "pluginhub", "custom", pluginId, "private");
  if (input.privateFiles !== undefined) {
    fs.rmSync(privateRoot, { recursive: true, force: true });
  }
  const privateFiles =
    input.privateFiles === undefined && existing
      ? existing.privateFiles
      : (input.privateFiles ?? []).map((file) => {
          const sourceRelativePath = normalizeRelativePath(file.sourceRelativePath);
          const contentPath = safeJoin(privateRoot, sourceRelativePath);
          fs.mkdirSync(path.dirname(contentPath), { recursive: true });
          fs.writeFileSync(contentPath, file.content, "utf8");
          const targetRelativePath = normalizeRelativePath(file.targetRelativePath || path.join(".agents", "plugins", name, sourceRelativePath));
          return {
            id: stableId("pluginhub-private", pluginId, sourceRelativePath),
            pluginId,
            sourceRelativePath,
            targetRelativePath,
            contentPath,
            contentHash: hashFile(contentPath),
            required: file.required ?? true,
            role: classifyPluginPrivateFile(sourceRelativePath)
          };
        });
  const componentRefs = sanitizeComponentRefs(input.componentRefs ?? existing?.componentRefs ?? []);

  return database.upsertPluginHubPlugin({
    id: pluginId,
    kind: "custom",
    sourceId: null,
    name,
    displayName: input.displayName?.trim() || existing?.displayName || name,
    description: input.description ?? existing?.description ?? null,
    componentRefs,
    privateFiles,
    harnessSupport: pluginHarnessSupport({ name, componentRefs, privateFiles })
  });
}

function removeCustomPluginPrivateMaterial(plugin: PluginHubPlugin): void {
  if (plugin.kind !== "custom") return;
  const roots = new Set(plugin.privateFiles.map((file) => customPluginMaterialRoot(file.contentPath)).filter((root): root is string => Boolean(root)));
  for (const root of roots) {
    removeAnyPath(root);
  }
}

function removePluginHubSourceMaterial(source: PluginHubSource): void {
  const roots = new Set(
    [source.resolvedPath, source.checkoutPath].map((item) => (item ? pluginHubSourceMaterialRoot(item, source.id) : null)).filter((root): root is string => Boolean(root))
  );
  for (const root of roots) removeAnyPath(root);
}

function pluginHubSourceMaterialRoot(contentPath: string, sourceId: string): string | null {
  const resolved = path.resolve(contentPath);
  const marker = `${path.sep}pluginhub${path.sep}sources${path.sep}${sourceId}`;
  const index = resolved.toLowerCase().indexOf(marker.toLowerCase());
  if (index < 0) return null;
  return resolved.slice(0, index + marker.length);
}

function customPluginMaterialRoot(contentPath: string): string | null {
  const resolved = path.resolve(contentPath);
  const marker = `${path.sep}private${path.sep}`;
  const index = resolved.lastIndexOf(marker);
  return index >= 0 ? resolved.slice(0, index) : null;
}

function discoverPluginSource(
  sourcePath: string,
  sourceIdentityName = path.basename(sourcePath) || "plugin"
): {
  kind: PluginHubSource["kind"];
  plugins: DiscoveredPlugin[];
  skipped: Array<{ path: string; reason: string }>;
} {
  const pluginsRoot = path.join(sourcePath, "plugins");
  const skipped: Array<{ path: string; reason: string }> = [];
  if (!fs.existsSync(pluginsRoot) && hasPluginContent(sourcePath)) {
    return {
      kind: "single-plugin",
      plugins: [
        discoverPlugin(sourcePath, sourceIdentityName, { name: sourceIdentityName, displayName: sourceIdentityName, description: null }, {
          preserveSourceRootInPackage: !hasNativePluginManifest(sourcePath)
        })
      ],
      skipped
    };
  }

  const marketplacePlugins = discoverMarketplacePlugins(sourcePath, skipped);
  if (marketplacePlugins.length > 0) {
    const plugins = marketplacePlugins.map((plugin) => discoverPlugin(plugin.directory, plugin.sourceRelativePath, plugin.manifestFallback));
    return { kind: "library", plugins, skipped };
  }

  if (fs.existsSync(pluginsRoot) && fs.statSync(pluginsRoot).isDirectory()) {
    const plugins = fs
      .readdirSync(pluginsRoot, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(pluginsRoot, entry.name))
      .filter(hasPluginContent)
      .map((directory) => discoverPlugin(directory, normalizeRelativePath(path.relative(sourcePath, directory))));
    if (plugins.length === 0) skipped.push({ path: pluginsRoot, reason: "plugins/ 下未找到可导入 plugin" });
    return { kind: "library", plugins, skipped };
  }

  skipped.push({ path: sourcePath, reason: "未找到 plugins/、skills/ 或 plugin manifest" });
  return { kind: "library", plugins: [], skipped };
}

function discoverMarketplacePlugins(sourcePath: string, skipped: Array<{ path: string; reason: string }>): DiscoveredMarketplacePlugin[] {
  const plugins: DiscoveredMarketplacePlugin[] = [];
  const seen = new Set<string>();
  for (const marketplacePath of marketplaceManifestPaths(sourcePath)) {
    if (!fs.existsSync(marketplacePath) || !fs.statSync(marketplacePath).isFile()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(marketplacePath, "utf8"));
    } catch {
      skipped.push({ path: marketplacePath, reason: "marketplace manifest JSON 解析失败" });
      continue;
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.plugins)) {
      skipped.push({ path: marketplacePath, reason: "marketplace manifest 缺少 plugins 列表" });
      continue;
    }
    for (const entry of parsed.plugins) {
      if (!isRecord(entry)) continue;
      const rawSource = marketplacePluginSourcePath(entry);
      const entryName = stringValue(entry.name);
      if (!rawSource) {
        skipped.push({ path: marketplacePath, reason: `${entryName ?? "plugin"} 缺少 source 路径` });
        continue;
      }
      let directory: string;
      try {
        directory = safeJoin(sourcePath, rawSource);
      } catch (error) {
        skipped.push({ path: marketplacePath, reason: error instanceof Error ? error.message : `${entryName ?? rawSource} source 路径无效` });
        continue;
      }
      if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
        skipped.push({ path: normalizeRelativePath(path.join(path.relative(sourcePath, marketplacePath), rawSource)), reason: "marketplace plugin source path not found" });
        continue;
      }
      if (!hasPluginContent(directory)) {
        skipped.push({ path: normalizeRelativePath(path.relative(sourcePath, directory)), reason: "marketplace plugin source 缺少 plugin content" });
        continue;
      }
      const key = normalizeFsPath(directory);
      if (seen.has(key)) continue;
      seen.add(key);
      plugins.push({
        directory,
        sourceRelativePath: normalizeRelativePath(path.relative(sourcePath, directory)),
        manifestFallback: marketplacePluginManifestFallback(entry)
      });
    }
  }
  return plugins;
}

function marketplaceManifestPaths(sourcePath: string): string[] {
  return [
    path.join(sourcePath, ".claude-plugin", "marketplace.json"),
    path.join(sourcePath, ".agents", "plugins", "marketplace.json"),
    path.join(sourcePath, ".cursor-plugin", "marketplace.json")
  ];
}

function marketplacePluginSourcePath(entry: Record<string, unknown>): string | null {
  const source = entry.source;
  if (typeof source === "string" && source.trim()) return source.trim();
  if (isRecord(source)) {
    const localPath = stringValue(source.path);
    if (localPath) return localPath.trim();
  }
  return stringValue(entry.path)?.trim() ?? null;
}

function marketplacePluginManifestFallback(entry: Record<string, unknown>): DiscoveredPluginManifestFallback {
  const interfaceInfo = isRecord(entry.interface) ? entry.interface : {};
  return {
    name: stringValue(entry.name),
    displayName: stringValue(entry.displayName) ?? stringValue(interfaceInfo.displayName) ?? stringValue(entry.title),
    description: stringValue(entry.description) ?? stringValue(interfaceInfo.longDescription) ?? stringValue(interfaceInfo.shortDescription)
  };
}

function discoverPlugin(
  pluginDir: string,
  sourceRelativePath: string,
  manifestFallback: DiscoveredPluginManifestFallback = { name: null, displayName: null, description: null },
  options: DiscoverPluginOptions = {}
): DiscoveredPlugin {
  const manifest = readPluginManifest(pluginDir);
  const rawName = manifest.name ?? manifestFallback.name ?? path.basename(pluginDir);
  const name = safeName(rawName) || safeName(path.basename(pluginDir)) || "plugin";
  const displayName = manifest.displayName ?? manifestFallback.displayName ?? manifest.name ?? manifestFallback.name ?? path.basename(pluginDir);
  const routes = routePluginFiles(pluginDir, sourceRelativePath, name, options);
  return {
    name,
    displayName,
    description: manifest.description ?? manifestFallback.description,
    directory: pluginDir,
    sourceRelativePath,
    skills: routes.skills,
    agentRoot: routes.agentRoot,
    mcpDocuments: routes.mcpDocuments,
    privateFiles: routes.privateFiles
  };
}

function routePluginFiles(pluginDir: string, pluginSourceRelativePath: string, pluginName: string, options: DiscoverPluginOptions): PluginFileRoutes {
  const skills = discoverPluginSkills(pluginDir, pluginSourceRelativePath);
  const agentRoot = discoverPluginAgentRoot(pluginDir, pluginSourceRelativePath);
  const mcpDocuments = discoverPluginMcpDocuments(pluginDir, pluginSourceRelativePath);
  const routedComponentFiles = routedPluginComponentFiles(pluginDir, pluginSourceRelativePath, skills, agentRoot, mcpDocuments);
  return {
    skills,
    agentRoot,
    mcpDocuments,
    privateFiles: discoverPrivateFiles(pluginDir, pluginSourceRelativePath, pluginName, options, routedComponentFiles)
  };
}

function discoverPluginSkills(pluginDir: string, pluginSourceRelativePath: string): DiscoveredPluginSkill[] {
  const skillsRoot = path.join(pluginDir, "skills");
  if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) return [];
  const skills: DiscoveredPluginSkill[] = [];

  function visit(directory: string): void {
    if (hasSkillMarker(directory)) {
      const relative = normalizeRelativePath(path.relative(pluginDir, directory));
      const metadata = readSkillMetadata(path.join(directory, "SKILL.md"));
      skills.push({
        directory,
        folderName: path.basename(directory),
        skillName: metadata.name,
        description: metadata.description,
        sourceRelativePath: normalizeRelativePath(path.join(pluginSourceRelativePath, relative)),
        contentHash: hashDirectory(directory)
      });
      return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory()) visit(path.join(directory, entry.name));
    }
  }

  visit(skillsRoot);
  return skills;
}

function discoverPluginAgentRoot(pluginDir: string, pluginSourceRelativePath: string): DiscoveredPluginAgentRoot | null {
  const agentsRoot = path.join(pluginDir, "agents");
  if (!fs.existsSync(agentsRoot) || !fs.statSync(agentsRoot).isDirectory()) return null;
  return {
    rootPath: agentsRoot,
    sourceRelativePrefix: normalizeRelativePath(path.join(pluginSourceRelativePath, "agents"))
  };
}

function discoverPluginMcpDocuments(pluginDir: string, pluginSourceRelativePath: string): DiscoveredPluginMcpDocument[] {
  const documents: DiscoveredPluginMcpDocument[] = [];
  for (const relativePath of [".mcp.json", "mcp.json"]) {
    const filePath = path.join(pluginDir, relativePath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      documents.push({
        sourceRelativePath: normalizeRelativePath(path.join(pluginSourceRelativePath, relativePath)),
        input: fs.readFileSync(filePath, "utf8")
      });
    }
  }

  for (const manifestPath of [path.join(pluginDir, ".codex-plugin", "plugin.json"), path.join(pluginDir, ".claude-plugin", "plugin.json"), path.join(pluginDir, "qwen-extension.json")]) {
    if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      const mcpServers = parsed.mcpServers;
      if (typeof mcpServers === "string") {
        const configPath = safeJoin(pluginDir, mcpServers);
        if (fs.existsSync(configPath) && fs.statSync(configPath).isFile()) {
          documents.push({
            sourceRelativePath: normalizeRelativePath(path.join(pluginSourceRelativePath, normalizeRelativePath(path.relative(pluginDir, configPath)))),
            input: fs.readFileSync(configPath, "utf8")
          });
        }
      } else if (isRecord(mcpServers)) {
        documents.push({
          sourceRelativePath: normalizeRelativePath(path.join(pluginSourceRelativePath, normalizeRelativePath(path.relative(pluginDir, manifestPath)), "mcpServers")),
          input: stableJson({ mcpServers })
        });
      }
    } catch {
      continue;
    }
  }

  const seen = new Set<string>();
  return documents.filter((document) => {
    if (seen.has(document.sourceRelativePath)) return false;
    seen.add(document.sourceRelativePath);
    return true;
  });
}

function discoverPrivateFiles(
  pluginDir: string,
  pluginSourceRelativePath: string,
  pluginName: string,
  options: DiscoverPluginOptions = {},
  routedComponentFiles: Set<string> = new Set()
): DiscoveredPrivateFile[] {
  const files: DiscoveredPrivateFile[] = [];
  for (const file of listFiles(pluginDir)) {
    const relativeFromPlugin = normalizeRelativePath(path.relative(pluginDir, file));
    if (routedComponentFiles.has(relativeFromPlugin)) continue;
    if (!options.preserveSourceRootInPackage && (relativeFromPlugin === "SKILL.md" || relativeFromPlugin.startsWith("skills/"))) continue;
    if (isRepositoryMaintenanceFile(relativeFromPlugin)) continue;
    const sourceRelativePath = normalizeRelativePath(path.join(pluginSourceRelativePath, relativeFromPlugin));
    const targetPackagePath = options.preserveSourceRootInPackage ? sourceRelativePath : relativeFromPlugin;
    files.push({
      filePath: file,
      sourceRelativePath,
      targetRelativePath: normalizeRelativePath(path.join(".agents", "plugins", pluginName, targetPackagePath)),
      contentHash: hashFile(file)
    });
  }
  return files;
}

function routedPluginComponentFiles(
  pluginDir: string,
  pluginSourceRelativePath: string,
  skills: DiscoveredPluginSkill[],
  agentRoot: DiscoveredPluginAgentRoot | null,
  mcpDocuments: DiscoveredPluginMcpDocument[]
): Set<string> {
  const routed = new Set<string>();
  for (const skill of skills) {
    for (const file of listFiles(skill.directory)) routed.add(normalizeRelativePath(path.relative(pluginDir, file)));
  }
  if (agentRoot) {
    for (const file of listFiles(agentRoot.rootPath)) {
      const relativeFromAgentRoot = normalizeRelativePath(path.relative(agentRoot.rootPath, file));
      const relativeFromPlugin = normalizeRelativePath(path.relative(pluginDir, file));
      if (isPluginAgentComponentFile(agentRoot.rootPath, relativeFromAgentRoot, file)) routed.add(relativeFromPlugin);
    }
  }
  for (const document of mcpDocuments) {
    const relativeFromPlugin = relativeToPluginSource(pluginSourceRelativePath, document.sourceRelativePath);
    if (relativeFromPlugin) routed.add(relativeFromPlugin);
  }
  return routed;
}

function isPluginAgentComponentFile(agentsRoot: string, relativeFromAgentRoot: string, filePath: string): boolean {
  if (path.extname(relativeFromAgentRoot).toLowerCase() !== ".md") return false;
  try {
    return isLocalImportAgentCandidate(relativeFromAgentRoot, "claude", fs.readFileSync(filePath, "utf8"), agentsRoot);
  } catch {
    return false;
  }
}

function relativeToPluginSource(pluginSourceRelativePath: string, sourceRelativePath: string): string | null {
  const normalizedSource = normalizeRelativePath(sourceRelativePath);
  const normalizedPlugin = normalizeRelativePath(pluginSourceRelativePath);
  if (normalizedSource === normalizedPlugin) return "";
  const prefix = `${normalizedPlugin}/`;
  return normalizedSource.startsWith(prefix) ? normalizedSource.slice(prefix.length) : null;
}

function isRepositoryMaintenanceFile(relativePath: string): boolean {
  if (relativePath.startsWith(".github/")) return true;
  if (relativePath.startsWith("tests/")) return true;
  if (relativePath.startsWith("docs/")) return true;
  if (relativePath === ".gitattributes" || relativePath === ".gitignore" || relativePath === ".version-bump.json") return true;
  if (relativePath === "AGENTS.md" || relativePath === "CLAUDE.md" || relativePath === "CODE_OF_CONDUCT.md") return true;
  if (relativePath === "README.md" || relativePath === "RELEASE-NOTES.md" || relativePath === "LICENSE") return true;
  if (relativePath === "scripts/bump-version.sh" || relativePath === "scripts/sync-to-codex-plugin.sh") return true;
  return false;
}

function privateFileFromDiscovery(pluginId: string, file: DiscoveredPrivateFile): PluginHubPrivateFile {
  return {
    id: stableId("pluginhub-private", pluginId, file.sourceRelativePath),
    pluginId,
    sourceRelativePath: file.sourceRelativePath,
    targetRelativePath: file.targetRelativePath,
    contentPath: file.filePath,
    contentHash: file.contentHash,
    required: true,
    role: classifyPluginPrivateFile(file.sourceRelativePath)
  };
}

function classifyPluginPrivateFile(sourceRelativePath: string): PluginHubPrivateFileRole {
  const normalized = normalizeRelativePath(sourceRelativePath);
  if (
    normalized.includes("/.codex-plugin/") ||
    normalized.includes("/.claude-plugin/") ||
    normalized.includes("/.cursor-plugin/") ||
    normalized.includes("/.opencode/") ||
    normalized === "qwen-extension.json" ||
    normalized.endsWith("/qwen-extension.json")
  ) {
    return "native-manifest";
  }
  if (normalized.includes("/commands/")) return "native-command";
  if (normalized.includes("/hooks/")) return "native-hook";
  if (normalized.includes("/src/") || normalized.includes("/bin/")) return "native-support";
  return "private-file";
}

function discoveredComponentCount(plugins: DiscoveredPlugin[]): number {
  const keys = new Set<string>();
  for (const plugin of plugins) {
    for (const skill of plugin.skills) keys.add(`skill:${skill.sourceRelativePath}`);
    if (plugin.agentRoot) {
      for (const file of listFiles(plugin.agentRoot.rootPath).filter((item) => path.extname(item).toLowerCase() === ".md")) {
        keys.add(`agent:${normalizeRelativePath(path.join(plugin.agentRoot.sourceRelativePrefix, path.relative(plugin.agentRoot.rootPath, file)))}`);
      }
    }
    for (const document of plugin.mcpDocuments) keys.add(`mcp:${plugin.sourceRelativePath}:${document.sourceRelativePath}`);
  }
  return keys.size;
}

function importDiscoveredPluginAgents(
  database: AppDatabase,
  dataDir: string,
  source: PluginHubSource,
  plugins: DiscoveredPlugin[],
  skipped: Array<{ path: string; reason: string }>
): { agents: AgentHubAgent[] } {
  const roots = plugins.flatMap((plugin) => (plugin.agentRoot ? [plugin.agentRoot] : []));
  if (roots.length === 0) return { agents: [] };
  const result = importPluginHubAgentRoots(database, dataDir, {
    sourceId: source.id,
    label: source.label,
    inputPath: source.inputPath,
    resolvedPath: source.resolvedPath,
    roots
  });
  skipped.push(...result.skipped);
  return result;
}

function importDiscoveredPluginMcp(
  database: AppDatabase,
  plugins: DiscoveredPlugin[],
  skipped: Array<{ path: string; reason: string }>
): Map<string, McpHubServer[]> {
  const serversByPlugin = new Map<string, McpHubServer[]>();
  for (const plugin of plugins) {
    const servers: McpHubServer[] = [];
    for (const document of plugin.mcpDocuments) {
      const result = importMcpHubJson(database, document.input);
      servers.push(...result.added, ...result.updated, ...result.patched);
      for (const failure of result.failed) {
        skipped.push({
          path: document.sourceRelativePath,
          reason: failure.serverId ? `${failure.serverId}: ${failure.reason}` : failure.reason
        });
      }
    }
    if (servers.length > 0) {
      const uniqueServers = [...new Map(servers.map((server) => [server.serverId, server])).values()];
      serversByPlugin.set(plugin.sourceRelativePath, uniqueServers);
    }
  }
  return serversByPlugin;
}

function skillInstallPlans(database: AppDatabase, plugin: PluginHubPlugin, toolTarget: SessionProjectToolTarget): SkillInstallPlan[] {
  if (!toolTarget.skillDirectory) return [];
  return plugin.componentRefs.flatMap((ref) => {
    if (ref.type !== "skill") return [];
    const skill = database.getSkillHubSkill(ref.componentId);
    if (!skill) return [];
    return [{ ref, skill, linkPath: path.join(toolTarget.skillDirectory as string, skill.folderName) }];
  });
}

function privateInstallPlans(project: Project, plugin: PluginHubPlugin, toolTarget: SessionProjectToolTarget, existingBinding: ProjectPluginBinding | null): PrivateInstallPlan[] {
  return plugin.privateFiles.filter((file) => toolTarget.toolId !== "kimi" || isKimiProjectPrivateFile(file)).map((file) => ({
    file,
    targetPath: safeJoin(project.rootPath, file.targetRelativePath),
    previousOwnership:
      existingBinding?.privateFileOwnership.find(
        (item) => item.kind === "private-file" && item.privateFileId === file.id && normalizeFsPath(item.targetPath) === normalizeFsPath(safeJoin(project.rootPath, file.targetRelativePath))
      ) ?? null
  }));
}

function agentInstallPlans(database: AppDatabase, project: Project, plugin: PluginHubPlugin, toolTarget: SessionProjectToolTarget): AgentInstallPlan[] {
  if (!isAgentHubToolId(toolTarget.toolId)) return [];
  const toolId = toolTarget.toolId;
  return plugin.componentRefs.flatMap((ref) => {
    if (ref.type !== "agent") return [];
    const agent = database.getAgentHubAgent(ref.componentId);
    if (!agent) return [];
    const preview = conversionPreview(agent, toolId, project.rootPath, "create");
    return [{ ref, agent, toolId, targetPath: preview.targetPath }];
  });
}

function mcpInstallPlans(database: AppDatabase, project: Project, plugin: PluginHubPlugin, toolTarget: SessionProjectToolTarget): McpInstallPlan[] {
  if (!isPluginMcpTargetToolId(toolTarget.toolId)) return [];
  const toolId = toolTarget.toolId;
  return plugin.componentRefs.flatMap((ref) => {
    if (ref.type !== "mcp") return [];
    const server = database.getMcpHubServer(ref.componentId);
    if (!server) return [];
    return [{ ref, server, toolId, configPath: pluginMcpConfigPath(project.rootPath, toolId) }];
  });
}

function nativePackageInstallPlans(
  project: Project,
  plugin: PluginHubPlugin,
  toolTarget: SessionProjectToolTarget,
  existingBinding: ProjectPluginBinding | null
): NativePackageInstallPlan[] {
  if (toolTarget.toolId !== "claude" && toolTarget.toolId !== "codex") return [];
  const toolId = toolTarget.toolId;
  const pluginName = safeName(plugin.name);
  const ownerId = stableId("pluginhub-native-plugin", plugin.id, toolId);
  const previous = existingBinding?.privateFileOwnership.find((item) => item.kind === "native-plugin" && item.privateFileId === ownerId) ?? null;
  const packageRoot = nativePluginPackageRoot(project.rootPath, toolId, pluginName);
  return [
    {
      toolId,
      ownerId,
      pluginName,
      packageRoot,
      marketplacePath: nativePluginMarketplacePath(project.rootPath, toolId),
      settingsPath: toolId === "claude" ? path.join(project.rootPath, ".claude", "settings.json") : null,
      marketplaceName: "pluginhub",
      previousPackageRoot: previous?.targetPath ?? null,
      previousOwnership: previous
    }
  ];
}

function nativePluginPackageRoot(projectRoot: string, toolId: NativePluginToolId, pluginName: string): string {
  if (toolId === "claude") return path.join(projectRoot, ".pluginhub", "claude-marketplace", "plugins", pluginName);
  if (toolId === "codex") return path.join(projectRoot, "plugins", pluginName);
  return path.join(projectRoot, ".qwen", "extensions", pluginName);
}

function nativePluginMarketplacePath(projectRoot: string, toolId: "claude" | "codex"): string {
  if (toolId === "claude") return path.join(projectRoot, ".pluginhub", "claude-marketplace", ".claude-plugin", "marketplace.json");
  return path.join(projectRoot, ".agents", "plugins", "marketplace.json");
}

function materializeNativePluginPackage(database: AppDatabase, project: Project, plugin: PluginHubPlugin, plan: NativePackageInstallPlan): void {
  removeAnyPath(plan.packageRoot);
  fs.mkdirSync(plan.packageRoot, { recursive: true });
  copyPluginPackageFilesToNativePackage(plugin, plan);
  copyPluginSkillsToNativePackage(database, plugin, plan);
  copyPluginAgentsToNativePackage(database, project, plugin, plan);
  writePluginMcpToNativePackage(database, plugin, plan);
  writePluginHooksToNativePackage(database, plugin, plan);
  ensureNativePluginManifest(plugin, plan);
  if (plan.toolId !== "qwen") upsertNativePluginMarketplace(plugin, plan);
  if (plan.toolId === "claude") upsertClaudeProjectPluginSettings(plan);
}

function copyPluginPackageFilesToNativePackage(plugin: PluginHubPlugin, plan: NativePackageInstallPlan): void {
  const selection = nativePackageFileSelection(plugin, plan.toolId);
  for (const file of plugin.privateFiles) {
    const relativePath = pluginPackageRelativePath(plugin, file.sourceRelativePath);
    if (!isSelectedNativePackageFile(relativePath, selection)) continue;
    materializePrivateFile(file.contentPath, safeJoin(plan.packageRoot, relativePath));
  }
}

interface NativePackageFileSelection {
  exact: Set<string>;
  prefixes: Set<string>;
}

function nativePackageFileSelection(plugin: PluginPackagePathPlugin, toolId: NativePluginToolId): NativePackageFileSelection {
  const selection: NativePackageFileSelection = { exact: new Set(), prefixes: new Set() };
  addNativePackagePrefix(selection, "assets/");

  if (toolId === "claude") {
    const manifestPath = ".claude-plugin/plugin.json";
    addNativePackagePrefix(selection, ".claude-plugin/");
    addManifestReferences(plugin, selection, manifestPath);
    addNativePackagePrefix(selection, "commands/");
    addNativePackagePrefix(selection, "hooks/");
    addToolRootReferences(plugin, selection, "CLAUDE_PLUGIN_ROOT");
    return selection;
  }

  if (toolId === "qwen") {
    const manifestPath = "qwen-extension.json";
    addNativePackageReference(selection, manifestPath);
    addManifestReferences(plugin, selection, manifestPath);
    addNativePackagePrefix(selection, "commands/");
    if (nativeHookPayloadForTool(null, plugin, "qwen") !== null) addNativePackagePrefix(selection, "hooks/");
    addToolRootReferences(plugin, selection, "CLAUDE_PLUGIN_ROOT");
    addToolRootReferences(plugin, selection, "CODEX_PLUGIN_ROOT");
    addToolRootReferences(plugin, selection, "QWEN_EXTENSION_ROOT");
    addToolRootReferences(plugin, selection, "extensionPath");
    return selection;
  }

  const manifestPath = ".codex-plugin/plugin.json";
  addNativePackagePrefix(selection, ".codex-plugin/");
  addManifestReferences(plugin, selection, manifestPath);
  if (hasCompatibleDefaultBundledHooks(plugin, "codex")) addNativePackagePrefix(selection, "hooks/");
  addToolRootReferences(plugin, selection, "CLAUDE_PLUGIN_ROOT");
  addToolRootReferences(plugin, selection, "CODEX_PLUGIN_ROOT");
  return selection;
}
function isSelectedNativePackageFile(relativePath: string, selection: NativePackageFileSelection): boolean {
  if (relativePath.startsWith("skills/")) return false;
  if (selection.exact.has(relativePath)) return true;
  for (const prefix of selection.prefixes) {
    if (relativePath.startsWith(prefix)) return true;
  }
  return isNeutralNativePackagePrivateFile(relativePath);
}

function isNeutralNativePackagePrivateFile(relativePath: string): boolean {
  if (relativePath.startsWith(".claude-plugin/")) return false;
  if (relativePath.startsWith(".codex-plugin/")) return false;
  if (relativePath.startsWith(".cursor-plugin/")) return false;
  if (relativePath.startsWith(".opencode/")) return false;
  if (relativePath.startsWith(".kimi-code/")) return false;
  if (relativePath === "qwen-extension.json") return false;
  if (relativePath.startsWith("agents/")) return false;
  if (relativePath.startsWith("commands/")) return false;
  if (relativePath.startsWith("hooks/")) return false;
  if (relativePath.startsWith("src/")) return false;
  if (relativePath.startsWith("bin/")) return false;
  if (relativePath === ".mcp.json" || relativePath === "mcp.json" || relativePath === "settings.json") return false;
  if (relativePath === "GEMINI.md" || relativePath === "gemini-extension.json") return false;
  return true;
}

function addManifestReferences(plugin: PluginPackagePathPlugin, selection: NativePackageFileSelection, manifestPath: string): void {
  const manifest = plugin.privateFiles.find((file) => pluginPackageRelativePath(plugin, file.sourceRelativePath) === manifestPath);
  if (!manifest) return;
  try {
    collectPackagePathReferences(JSON.parse(fs.readFileSync(manifest.contentPath, "utf8"))).forEach((reference) => addNativePackageReference(selection, reference));
  } catch {
    return;
  }
}

function collectPackagePathReferences(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = normalizePackageReference(value);
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectPackagePathReferences(item));
  if (isRecord(value)) return Object.values(value).flatMap((item) => collectPackagePathReferences(item));
  return [];
}

function addToolRootReferences(
  plugin: PluginPackagePathPlugin,
  selection: NativePackageFileSelection,
  rootVariable: "CLAUDE_PLUGIN_ROOT" | "CODEX_PLUGIN_ROOT" | "QWEN_EXTENSION_ROOT" | "extensionPath"
): void {
  const pattern = new RegExp(`\\$\\{${rootVariable}\\}/([A-Za-z0-9._/-]+)`, "g");
  for (const file of plugin.privateFiles) {
    const relativePath = pluginPackageRelativePath(plugin, file.sourceRelativePath);
    if (!relativePath.endsWith(".json") && !relativePath.endsWith(".toml") && !relativePath.endsWith(".md")) continue;
    const content = readTextIfPossible(file.contentPath);
    if (!content) continue;
    for (const match of content.matchAll(pattern)) {
      const rawReference = match[1];
      if (!rawReference) continue;
      const reference = normalizePackageReference(rawReference);
      if (reference) addNativePackageReference(selection, reference, { includeDirectoryForSupportCode: true });
    }
  }
}

function hasCompatibleDefaultBundledHooks(plugin: PluginPackagePathPlugin, toolId: "codex"): boolean {
  const hooksFile = plugin.privateFiles.find((file) => pluginPackageRelativePath(plugin, file.sourceRelativePath) === "hooks/hooks.json");
  if (!hooksFile) return false;
  const hooksConfig = readTextIfPossible(hooksFile.contentPath);
  if (!hooksConfig) return false;
  if (toolId === "codex" && (hooksConfig.includes("CLAUDE_PLUGIN_ROOT") || hooksConfig.includes("CURSOR_PLUGIN_ROOT"))) return false;
  return Boolean(plugin.privateFiles.some((file) => pluginPackageRelativePath(plugin, file.sourceRelativePath) === ".codex-plugin/plugin.json"));
}

function addNativePackageReference(
  selection: NativePackageFileSelection,
  reference: string,
  options: { includeDirectoryForSupportCode?: boolean } = {}
): void {
  const normalized = normalizePackageReference(reference);
  if (!normalized || normalized === "skills" || normalized.startsWith("skills/")) return;
  if (normalized.endsWith("/")) {
    addNativePackagePrefix(selection, normalized);
    return;
  }
  selection.exact.add(normalized);
  if (options.includeDirectoryForSupportCode && (normalized.startsWith("src/") || normalized.startsWith("bin/"))) {
    addNativePackagePrefix(selection, `${path.posix.dirname(normalized)}/`);
  }
}

function addNativePackagePrefix(selection: NativePackageFileSelection, prefix: string): void {
  const normalized = normalizePackageReference(prefix);
  if (!normalized || normalized === "skills" || normalized.startsWith("skills/")) return;
  selection.prefixes.add(normalized.endsWith("/") ? normalized : `${normalized}/`);
}

function normalizePackageReference(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  const withoutRoot = trimmed.replace(/^\$\{(?:CLAUDE_PLUGIN_ROOT|CODEX_PLUGIN_ROOT|CURSOR_PLUGIN_ROOT|QWEN_EXTENSION_ROOT|extensionPath)\}\//, "");
  const withoutDot = withoutRoot.startsWith("./") ? withoutRoot.slice(2) : withoutRoot;
  const normalized = normalizeRelativePath(withoutDot);
  if (!normalized || normalized.startsWith("../") || path.isAbsolute(normalized)) return null;
  return normalized;
}

function readTextIfPossible(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function copyPluginSkillsToNativePackage(database: AppDatabase, plugin: PluginHubPlugin, plan: NativePackageInstallPlan): void {
  for (const ref of plugin.componentRefs.filter((item) => item.type === "skill")) {
    const skill = database.getSkillHubSkill(ref.componentId);
    if (!skill) continue;
    replaceDirectory(skill.libraryPath, safeJoin(plan.packageRoot, path.join("skills", skill.folderName)));
    if (shouldPreserveSinglePluginSourceRoot(plugin) && skill.sourceRelativePath) {
      replaceDirectory(skill.libraryPath, safeJoin(plan.packageRoot, skill.sourceRelativePath));
    }
  }
}

function copyPluginAgentsToNativePackage(database: AppDatabase, project: Project, plugin: PluginHubPlugin, plan: NativePackageInstallPlan): void {
  if (plan.toolId !== "claude" && plan.toolId !== "qwen") return;
  for (const ref of plugin.componentRefs.filter((item) => item.type === "agent")) {
    const rendered = renderAgentForTool(database, ref.componentId, plan.toolId, project.rootPath);
    const targetPath = safeJoin(plan.packageRoot, path.join("agents", `${rendered.agent.slug}.md`));
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, rendered.content, "utf8");
    if (shouldPreserveSinglePluginSourceRoot(plugin) && rendered.agent.sourceRelativePath) {
      const sourceRootTargetPath = safeJoin(plan.packageRoot, rendered.agent.sourceRelativePath);
      fs.mkdirSync(path.dirname(sourceRootTargetPath), { recursive: true });
      fs.writeFileSync(sourceRootTargetPath, rendered.content, "utf8");
    }
  }
}

function writePluginMcpToNativePackage(database: AppDatabase, plugin: PluginHubPlugin, plan: NativePackageInstallPlan): void {
  const servers = plugin.componentRefs.flatMap((ref) => {
    if (ref.type !== "mcp") return [];
    const server = database.getMcpHubServer(ref.componentId);
    return server ? [server] : [];
  });
  if (servers.length === 0) return;
  const configPath = nativePackageMcpConfigPath(plan);
  const existing = readJsonObject(configPath);
  const mcpServers = isRecord(existing.mcpServers) ? { ...existing.mcpServers } : {};
  for (const server of servers) {
    mcpServers[server.serverId] = mcpServerPluginPayloadForTool(server, plan.toolId);
  }
  writeJsonObject(configPath, { ...existing, mcpServers });
}

function nativePackageMcpConfigPath(plan: NativePackageInstallPlan): string {
  return plan.toolId === "qwen" ? safeJoin(plan.packageRoot, "qwen-extension.json") : safeJoin(plan.packageRoot, ".mcp.json");
}
function writePluginHooksToNativePackage(database: AppDatabase, plugin: PluginHubPlugin, plan: NativePackageInstallPlan): void {
  if (plan.toolId === "qwen") return;
  if (!isHookHubSupportedToolId(plan.toolId)) return;
  const hooks = plugin.componentRefs.flatMap((ref) => {
    if (ref.type !== "hook") return [];
    const suite = database.getHookHubSuite(ref.componentId);
    const payload = suite?.payloads[plan.toolId as HookHubSupportedToolId];
    return payload === undefined ? [] : [payload];
  });
  if (hooks.length === 0) return;
  const merged = mergeHookPayloads(hooks);
  const hooksPath = safeJoin(plan.packageRoot, path.join("hooks", "hooks.json"));
  writeJsonObject(hooksPath, isRecord(merged) ? merged : { hooks: merged });
}

function ensureNativePluginManifest(plugin: PluginHubPlugin, plan: NativePackageInstallPlan): void {
  if (plan.toolId === "claude") {
    const manifestPath = safeJoin(plan.packageRoot, path.join(".claude-plugin", "plugin.json"));
    const existing = readJsonObject(manifestPath);
    writeJsonObject(manifestPath, {
      ...existing,
      name: plan.pluginName,
      version: stringValue(existing.version) ?? "1.0.0",
      description: stringValue(existing.description) ?? plugin.description ?? plugin.displayName
    });
    return;
  }

  if (plan.toolId === "qwen") {
    const manifestPath = safeJoin(plan.packageRoot, "qwen-extension.json");
    const existing = readJsonObject(manifestPath);
    writeJsonObject(manifestPath, {
      ...existing,
      name: plan.pluginName,
      version: stringValue(existing.version) ?? "1.0.0",
      description: stringValue(existing.description) ?? plugin.description ?? plugin.displayName
    });
    return;
  }

  const manifestPath = safeJoin(plan.packageRoot, path.join(".codex-plugin", "plugin.json"));
  const existing = readJsonObject(manifestPath);
  const next: Record<string, unknown> = {
    ...existing,
    name: plan.pluginName,
    version: stringValue(existing.version) ?? "1.0.0",
    description: stringValue(existing.description) ?? plugin.description ?? plugin.displayName
  };
  if (fs.existsSync(safeJoin(plan.packageRoot, "skills"))) next.skills = stringValue(next.skills) ?? "./skills/";
  if (fs.existsSync(safeJoin(plan.packageRoot, ".mcp.json"))) next.mcpServers = stringValue(next.mcpServers) ?? "./.mcp.json";
  writeJsonObject(manifestPath, next);
}
function upsertNativePluginMarketplace(plugin: PluginHubPlugin, plan: NativePackageInstallPlan): void {
  if (plan.toolId === "claude") {
    const marketplace = readJsonObject(plan.marketplacePath);
    const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins.filter((item) => isRecord(item) && item.name !== plan.pluginName) : [];
    plugins.push({ name: plan.pluginName, source: `./plugins/${plan.pluginName}` });
    writeJsonObject(plan.marketplacePath, {
      ...marketplace,
      name: plan.marketplaceName,
      owner: isRecord(marketplace.owner) ? marketplace.owner : { name: "PluginHub" },
      description: stringValue(marketplace.description) ?? "PluginHub project marketplace",
      plugins
    });
    return;
  }

  const marketplace = readJsonObject(plan.marketplacePath);
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins.filter((item) => isRecord(item) && item.name !== plan.pluginName) : [];
  plugins.push({
    name: plan.pluginName,
    source: { source: "local", path: `./plugins/${plan.pluginName}` },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Productivity"
  });
  writeJsonObject(plan.marketplacePath, {
    name: stringValue(marketplace.name) ?? plan.marketplaceName,
    interface: isRecord(marketplace.interface) ? marketplace.interface : { displayName: "PluginHub" },
    ...marketplace,
    plugins
  });
}

function upsertClaudeProjectPluginSettings(plan: NativePackageInstallPlan): void {
  if (!plan.settingsPath) return;
  const settings = readJsonObject(plan.settingsPath);
  const extraKnownMarketplaces = isRecord(settings.extraKnownMarketplaces) ? { ...settings.extraKnownMarketplaces } : {};
  extraKnownMarketplaces[plan.marketplaceName] = {
    source: {
      source: "directory",
      path: "./.pluginhub/claude-marketplace"
    }
  };
  const enabledPlugins = isRecord(settings.enabledPlugins) ? { ...settings.enabledPlugins } : {};
  enabledPlugins[`${plan.pluginName}@${plan.marketplaceName}`] = true;
  writeJsonObject(plan.settingsPath, { ...settings, extraKnownMarketplaces, enabledPlugins });
}

function mcpServerPluginPayloadForTool(server: McpHubServer, toolId: NativePluginToolId): Record<string, unknown> {
  if (toolId !== "qwen") return mcpServerPluginPayload(server);
  if (server.transport === "http") {
    return {
      ...(server.name ? { name: server.name } : {}),
      ...(server.description ? { description: server.description } : {}),
      ...(server.url ? { httpUrl: server.url } : {}),
      ...(Object.keys(server.headers).length > 0 ? { headers: server.headers } : {}),
      ...(Object.keys(server.env).length > 0 ? { env: server.env } : {})
    };
  }
  return {
    ...(server.name ? { name: server.name } : {}),
    ...(server.description ? { description: server.description } : {}),
    command: server.command,
    args: server.args,
    ...(Object.keys(server.env).length > 0 ? { env: server.env } : {})
  };
}
function mcpServerPluginPayload(server: McpHubServer): Record<string, unknown> {
  if (server.transport === "http") {
    return {
      ...(server.name ? { name: server.name } : {}),
      ...(server.description ? { description: server.description } : {}),
      transport: server.transport,
      ...(server.url ? { url: server.url } : {}),
      ...(Object.keys(server.headers).length > 0 ? { headers: server.headers } : {}),
      ...(Object.keys(server.env).length > 0 ? { env: server.env } : {})
    };
  }
  return {
    ...(server.name ? { name: server.name } : {}),
    ...(server.description ? { description: server.description } : {}),
    transport: server.transport,
    command: server.command,
    args: server.args,
    ...(Object.keys(server.env).length > 0 ? { env: server.env } : {})
  };
}

function mergeHookPayloads(payloads: unknown[]): unknown {
  if (payloads.every(Array.isArray)) return payloads.flat();
  const records = payloads.filter(isRecord);
  if (records.length !== payloads.length) return payloads.length === 1 ? payloads[0] : payloads;
  const merged: Record<string, unknown> = {};
  for (const payload of records) {
    for (const [eventName, value] of Object.entries(payload)) {
      if (Array.isArray(merged[eventName]) && Array.isArray(value)) merged[eventName] = [...merged[eventName], ...value];
      else merged[eventName] = value;
    }
  }
  return merged;
}

function nativeHookInstallPlans(
  database: AppDatabase,
  project: Project,
  plugin: PluginHubPlugin,
  toolTarget: SessionProjectToolTarget,
  existingBinding: ProjectPluginBinding | null
): NativeHookInstallPlan[] {
  const hooks = nativeHooksForTool(database, project, plugin, toolTarget.toolId);
  if (hooks === null) return [];
  const configPath = pluginHookConfigPath(project.rootPath, toolTarget.toolId);
  const ownerId = stableId("pluginhub-hook", plugin.id, toolTarget.toolId, configPath);
  const previous = existingBinding?.privateFileOwnership.find(
    (item) => item.kind === "hook" && item.privateFileId === ownerId && normalizeFsPath(item.targetPath) === normalizeFsPath(configPath)
  );
  return [
    {
      toolId: toolTarget.toolId,
      ownerId,
      configPath,
      hooks,
      previousFingerprint: previous?.reason ?? null
    }
  ];
}

function nativeHooksForTool(database: AppDatabase, project: Project, plugin: PluginHubPlugin, toolId: ToolId): unknown | null {
  if (toolId === "kimi" || !isHookHubSupportedToolId(toolId)) return null;
  const hooks = nativeHookPayloadForTool(database, plugin, toolId);
  if (hooks === null) return null;
  return rewritePluginHookPayload(hooks, pluginHookRuntimeRoot(project.rootPath, plugin.name, toolId));
}

function nativeHookPayloadForTool(database: AppDatabase | null, plugin: PluginHubPlugin | PluginPackagePathPlugin, toolId: ToolId): unknown | null {
  if (!isHookHubSupportedToolId(toolId)) return null;
  const payloads: unknown[] = [];
  const direct = pluginNativeHookPayloadForTool(plugin, toolId);
  if (direct !== null) payloads.push(direct);
  if (database && hasComponentRefs(plugin)) {
    for (const ref of plugin.componentRefs) {
      if (ref.type !== "hook") continue;
      const suite = database.getHookHubSuite(ref.componentId);
      const payload = suite ? hookSuitePayloadForTool(suite.payloads, toolId) : null;
      if (payload !== null) payloads.push(payload);
    }
  }
  return payloads.length === 0 ? null : mergeHookPayloads(payloads);
}

function pluginNativeHookPayloadForTool(plugin: PluginHubPlugin | PluginPackagePathPlugin, toolId: HookHubSupportedToolId): unknown | null {
  if (toolId === "claude" || toolId === "codex") {
    const direct = readPluginNativeHooks(plugin, toolId);
    if (direct !== null) return direct;
  }
  const convertibleSources: Array<"claude" | "codex"> = ["claude", "codex"];
  for (const sourceToolId of convertibleSources) {
    if (sourceToolId === toolId) continue;
    const source = readPluginNativeHooks(plugin, sourceToolId);
    if (source === null) continue;
    return convertHookPayloadForTool(source, sourceToolId, toolId);
  }
  return null;
}

function hookSuitePayloadForTool(payloads: Partial<Record<HookHubSupportedToolId, unknown>>, targetToolId: HookHubSupportedToolId): unknown | null {
  const direct = payloads[targetToolId];
  if (direct !== undefined) return direct;
  const sourceOrder: HookHubSupportedToolId[] = ["claude", "codebuddy", "codex", "qwen", "qoder", "kimi"];
  for (const sourceToolId of sourceOrder) {
    const source = payloads[sourceToolId];
    if (source === undefined) continue;
    return convertHookPayloadForTool(source, sourceToolId, targetToolId);
  }
  return null;
}

function hasComponentRefs(plugin: PluginHubPlugin | PluginPackagePathPlugin): plugin is PluginHubPlugin {
  return Array.isArray((plugin as PluginHubPlugin).componentRefs);
}

function readPluginNativeHooks(plugin: PluginPackagePathPlugin, toolId: "claude" | "codex"): unknown | null {
  const manifest = plugin.privateFiles.find((file) => isPluginNativeManifest(file, toolId === "claude" ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json"));
  if (manifest) {
    try {
      const parsed = JSON.parse(fs.readFileSync(manifest.contentPath, "utf8")) as Record<string, unknown>;
      const hooks = isRecord(parsed.hooks) ? parsed.hooks : null;
      if (hooks && Object.keys(hooks).length > 0) return hooks;
    } catch {
      return null;
    }
  }
  if (toolId === "codex") {
    const hooksFile = plugin.privateFiles.find((file) => pluginPackageRelativePath(plugin, file.sourceRelativePath) === "hooks/hooks.json");
    if (hooksFile) {
      try {
        const parsed = JSON.parse(fs.readFileSync(hooksFile.contentPath, "utf8")) as Record<string, unknown>;
        const hooks = isRecord(parsed.hooks) ? parsed.hooks : parsed;
        if (isRecord(hooks) && Object.keys(hooks).length > 0) return hooks;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function isPluginNativeManifest(file: PluginHubPrivateFile, relativePath: string): boolean {
  const normalized = normalizeRelativePath(file.sourceRelativePath);
  return normalized === relativePath || normalized.endsWith(`/${relativePath}`);
}

function pluginHookRuntimeRoot(projectRoot: string, pluginName: string, toolId: ToolId): string {
  if (toolId === "codex") return nativePluginPackageRoot(projectRoot, "codex", safeName(pluginName));
  if (toolId === "claude") return nativePluginPackageRoot(projectRoot, "claude", safeName(pluginName));
  if (toolId === "qwen") return safeJoin(projectRoot, path.join(".agents", "plugins", safeName(pluginName)));
  return safeJoin(projectRoot, path.join(".agents", "plugins", safeName(pluginName)));
}

function rewritePluginHookPayload(value: unknown, pluginRoot: string): unknown {
  if (typeof value === "string") return value.replace(/\$\{(?:CLAUDE_PLUGIN_ROOT|CODEX_PLUGIN_ROOT|QWEN_EXTENSION_ROOT|extensionPath)\}/g, pluginRoot);
  if (Array.isArray(value)) return value.map((item) => rewritePluginHookPayload(item, pluginRoot));
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) output[key] = rewritePluginHookPayload(item, pluginRoot);
    return output;
  }
  return value;
}

function replaceWithSkillLink(database: AppDatabase, projectId: string, toolId: ToolId, skill: SkillHubSkill, linkPath: string): void {
  const existing = database.getProjectSkillTargetByLinkPath(projectId, toolId, linkPath);
  if (existing) database.deleteProjectSkillTargetByLinkPath(projectId, toolId, linkPath);
  removeAnyPath(linkPath);
  createDirectoryLink(skill.libraryPath, linkPath);
  database.upsertProjectSkillTarget({ projectId, toolId, skillId: skill.id, linkPath, targetPath: skill.libraryPath });
}

function releaseRemovedOwnership(database: AppDatabase, previous: ProjectPluginBinding, next: ProjectPluginBinding | null): PluginHubDeleteFailure[] {
  const failures: PluginHubDeleteFailure[] = [];
  const nextComponents = new Set((next?.componentOwnership ?? []).filter((item) => item.ownerState === "managed").map(componentOwnerKey));
  const nativePackageRoots = previous.privateFileOwnership
    .filter((item) => item.ownerState === "managed" && item.kind === "native-plugin")
    .map((item) => item.targetPath);
  for (const component of previous.componentOwnership.filter((item) => item.ownerState === "managed")) {
    if (nextComponents.has(componentOwnerKey(component))) continue;
    if (nativePackageRoots.some((root) => isSameOrInsidePath(component.targetPath, root))) continue;
    if (otherComponentOwners(database, previous.id, previous.projectId, component).length > 0) continue;
    if (component.type === "skill") {
      if (!component.linkPath) continue;
      const removal = removeDirectoryLink(component.linkPath);
      if (!removal.reason || removal.missing) {
        database.deleteProjectSkillTarget(previous.projectId, component.toolId, component.componentId, component.linkPath);
      } else {
        failures.push({ path: component.linkPath, reason: removal.reason });
      }
      continue;
    }
    if (component.type === "agent" && isAgentHubToolId(component.toolId)) {
      const failure = releasePluginAgentOwnership(database, previous, component);
      if (failure) failures.push(failure);
      continue;
    }
    if (component.type === "mcp" && isMcpHubTargetToolId(component.toolId)) {
      const failure = releasePluginMcpOwnership(database, previous, component);
      if (failure) failures.push(failure);
    }
  }

  const nextPrivateFiles = new Set((next?.privateFileOwnership ?? []).filter((item) => item.ownerState === "managed").map(privateOwnerKey));
  for (const file of previous.privateFileOwnership.filter((item) => item.ownerState === "managed")) {
    if (nextPrivateFiles.has(privateOwnerKey(file))) continue;
    if (otherPrivateOwners(database, previous.id, previous.projectId, file).length > 0) continue;
    if (file.kind === "hook") {
      const removal = releasePluginHookOwnership(file);
      if (removal) failures.push(removal);
      continue;
    }
    if (file.kind === "native-plugin") {
      const removal = releaseNativePluginOwnership(previous, file);
      if (removal) failures.push(removal);
      continue;
    }
    const removal = releasePrivateFileOwnership(file);
    if (removal) failures.push(removal);
  }
  return failures;
}

function removeSourceComponentTargets(database: AppDatabase, skills: SkillHubSkill[]): PluginHubDeleteFailure[] {
  const failures: PluginHubDeleteFailure[] = [];
  for (const skill of skills) {
    for (const target of database.listProjectSkillTargetsForSkill(skill.id)) {
      const removal = removeDirectoryLink(target.linkPath);
      if (!removal.reason || removal.missing) {
        database.deleteProjectSkillTarget(target.projectId, target.toolId, target.skillId, target.linkPath);
      } else {
        failures.push(skillTargetFailure(target, removal.reason));
      }
    }
  }
  return failures;
}

function removeSourceAgentTargets(database: AppDatabase, agents: AgentHubAgent[]): PluginHubDeleteFailure[] {
  const failures: PluginHubDeleteFailure[] = [];
  for (const agent of agents) {
    for (const target of database.listProjectAgentTargetsForAgent(agent.id)) {
      if (fs.existsSync(target.outputPath) && hashFile(target.outputPath) !== target.appliedOutputHash) {
        failures.push({ path: target.outputPath, reason: "目标 AgentHub 输出已被本地修改" });
        continue;
      }
      if (fs.existsSync(target.outputPath)) fs.unlinkSync(target.outputPath);
      database.deleteProjectAgentTarget(target.id);
    }
  }
  return failures;
}

function skillTargetFailure(target: ProjectSkillTarget, reason: string): PluginHubDeleteFailure {
  return { path: target.linkPath, reason };
}

function otherComponentOwners(
  database: AppDatabase,
  bindingId: string,
  projectId: string,
  owner: ProjectPluginComponentOwnership
): ProjectPluginBinding[] {
  return database.listProjectPluginBindings(projectId).filter(
    (binding) =>
      binding.id !== bindingId &&
      binding.componentOwnership.some((item) => item.ownerState === "managed" && componentOwnerKey(item) === componentOwnerKey(owner))
  );
}

function otherPrivateOwners(
  database: AppDatabase,
  bindingId: string,
  projectId: string,
  owner: ProjectPluginPrivateFileOwnership
): ProjectPluginBinding[] {
  return database.listProjectPluginBindings(projectId).filter(
    (binding) =>
      binding.id !== bindingId &&
      binding.privateFileOwnership.some((item) => item.ownerState === "managed" && privateOwnerKey(item) === privateOwnerKey(owner))
  );
}

function findPrivateTargetOwner(
  database: AppDatabase,
  projectId: string,
  toolId: ToolId,
  targetPath: string,
  currentBindingId: string | null
): ProjectPluginPrivateFileOwnership | null {
  for (const binding of database.listProjectPluginBindings(projectId)) {
    if (binding.id === currentBindingId || binding.toolId !== toolId) continue;
    const owner = binding.privateFileOwnership.find((item) => item.ownerState === "managed" && normalizeFsPath(item.targetPath) === normalizeFsPath(targetPath));
    if (owner) return owner;
  }
  return null;
}

function componentOwnershipItem(
  plan: SkillInstallPlan,
  toolId: ToolId,
  ownerState: ProjectPluginComponentOwnership["ownerState"],
  reason: string | null
): ProjectPluginComponentOwnership {
  return {
    type: "skill",
    componentId: plan.skill.id,
    toolId,
    targetPath: plan.skill.libraryPath,
    linkPath: plan.linkPath,
    ownerState,
    required: plan.ref.required,
    reason
  };
}

function agentOwnershipItem(
  plan: AgentInstallPlan,
  ownerState: ProjectPluginComponentOwnership["ownerState"],
  reason: string | null
): ProjectPluginComponentOwnership {
  return {
    type: "agent",
    componentId: plan.agent.id,
    toolId: plan.toolId,
    targetPath: plan.targetPath,
    linkPath: plan.targetPath,
    ownerState,
    required: plan.ref.required,
    reason
  };
}

function hookComponentOwnershipItems(
  database: AppDatabase,
  plugin: PluginHubPlugin,
  plan: NativeHookInstallPlan,
  toolId: ToolId,
  ownerState: ProjectPluginComponentOwnership["ownerState"],
  reason: string | null
): ProjectPluginComponentOwnership[] {
  if (!isHookHubSupportedToolId(toolId)) return [];
  return plugin.componentRefs.flatMap((ref) => {
    if (ref.type !== "hook") return [];
    const suite = database.getHookHubSuite(ref.componentId);
    if (!suite || hookSuitePayloadForTool(suite.payloads, toolId) === null) return [];
    return [
      {
        type: "hook",
        componentId: ref.componentId,
        toolId,
        targetPath: plan.configPath,
        linkPath: plan.configPath,
        ownerState,
        required: ref.required,
        reason
      }
    ];
  });
}

function mcpOwnershipItem(
  plan: McpInstallPlan,
  ownerState: ProjectPluginComponentOwnership["ownerState"],
  reason: string | null,
  configPath: string
): ProjectPluginComponentOwnership {
  return {
    type: "mcp",
    componentId: plan.server.serverId,
    toolId: plan.toolId,
    targetPath: configPath,
    linkPath: configPath,
    ownerState,
    required: plan.ref.required,
    reason
  };
}

function nativePackageComponentOwnership(database: AppDatabase, plugin: PluginHubPlugin, plan: NativePackageInstallPlan): ProjectPluginComponentOwnership[] {
  return plugin.componentRefs.flatMap((ref) => {
    if (plan.toolId === "codex" && ref.type === "agent") return [];
    if (plan.toolId === "qwen" && ref.type === "hook") return [];
    const targetPath = nativePackageComponentTargetPath(database, ref, plan);
    if (!targetPath) return [];
    return [
      {
        type: ref.type,
        componentId: ref.componentId,
        toolId: plan.toolId,
        targetPath,
        linkPath: targetPath,
        ownerState: "managed",
        required: ref.required,
        reason: null
      }
    ];
  });
}

function nativePackageComponentTargetPath(database: AppDatabase, ref: PluginHubComponentRef, plan: NativePackageInstallPlan): string | null {
  if (ref.type === "skill") {
    const skill = database.getSkillHubSkill(ref.componentId);
    return skill ? safeJoin(plan.packageRoot, path.join("skills", skill.folderName)) : null;
  }
  if (ref.type === "agent") {
    const agent = database.getAgentHubAgent(ref.componentId);
    return agent ? safeJoin(plan.packageRoot, path.join("agents", `${agent.slug}.md`)) : null;
  }
  if (ref.type === "mcp") return nativePackageMcpConfigPath(plan);
  if (ref.type === "hook") return safeJoin(plan.packageRoot, path.join("hooks", "hooks.json"));
  return null;
}

function privateOwnershipItem(
  plan: PrivateInstallPlan,
  toolId: ToolId,
  ownerState: ProjectPluginPrivateFileOwnership["ownerState"],
  reason: string | null
): ProjectPluginPrivateFileOwnership {
  return {
    privateFileId: plan.file.id,
    toolId,
    targetPath: plan.targetPath,
    kind: "private-file",
    ownerState,
    reason
  };
}

function privateFileOwnershipReason(plan: PrivateInstallPlan): string {
  return stableJson({
    contentHash: plan.file.contentHash
  });
}

function parsePrivateFileOwnershipReason(reason: string | null): { contentHash: string | null } | null {
  if (!reason) return null;
  try {
    const parsed = JSON.parse(reason);
    if (!isRecord(parsed)) return null;
    return { contentHash: stringValue(parsed.contentHash) };
  } catch {
    return null;
  }
}

function managedPrivateFileMatches(owner: ProjectPluginPrivateFileOwnership): boolean {
  const parsed = parsePrivateFileOwnershipReason(owner.reason);
  if (!parsed?.contentHash || !fs.existsSync(owner.targetPath)) return true;
  return hashExistingPath(owner.targetPath) === parsed.contentHash;
}

function hookOwnershipItem(
  plan: NativeHookInstallPlan,
  ownerState: ProjectPluginPrivateFileOwnership["ownerState"],
  reason: string | null
): ProjectPluginPrivateFileOwnership {
  return {
    privateFileId: plan.ownerId,
    toolId: plan.toolId,
    targetPath: plan.configPath,
    kind: "hook",
    ownerState,
    reason
  };
}

function nativePackageOwnershipItem(
  plan: NativePackageInstallPlan,
  ownerState: ProjectPluginPrivateFileOwnership["ownerState"],
  reason: string | null
): ProjectPluginPrivateFileOwnership {
  return {
    privateFileId: plan.ownerId,
    toolId: plan.toolId,
    targetPath: plan.packageRoot,
    kind: "native-plugin",
    ownerState,
    reason
  };
}

function componentOwnerKey(owner: ProjectPluginComponentOwnership): string {
  return [owner.toolId, owner.type, owner.componentId, normalizeFsPath(owner.linkPath ?? owner.targetPath)].join("\0");
}

function privateOwnerKey(owner: ProjectPluginPrivateFileOwnership): string {
  return [owner.toolId, owner.privateFileId, normalizeFsPath(owner.targetPath)].join("\0");
}

function isSameOrInsidePath(candidatePath: string, rootPath: string): boolean {
  const candidate = normalizeFsPath(candidatePath);
  const root = normalizeFsPath(rootPath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function releasePluginAgentOwnership(
  database: AppDatabase,
  binding: ProjectPluginBinding,
  owner: ProjectPluginComponentOwnership
): PluginHubDeleteFailure | null {
  if (!isAgentHubToolId(owner.toolId)) return null;
  const target = database.getProjectAgentTargetByOutputPath(binding.projectId, binding.targetRootPath, owner.toolId, owner.targetPath);
  if (!target || target.agentId !== owner.componentId) return null;
  if (fs.existsSync(target.outputPath) && hashFile(target.outputPath) !== target.appliedOutputHash) {
    return { path: target.outputPath, reason: "PluginHub 管理的 AgentHub 输出已被本地修改，未自动删除" };
  }
  if (fs.existsSync(target.outputPath)) fs.unlinkSync(target.outputPath);
  database.deleteProjectAgentTarget(target.id);
  return null;
}

function releasePluginMcpOwnership(
  database: AppDatabase,
  binding: ProjectPluginBinding,
  owner: ProjectPluginComponentOwnership
): PluginHubDeleteFailure | null {
  if (!isMcpHubTargetToolId(owner.toolId)) return null;
  try {
    const storedProject = database.getProject(binding.projectId);
    const project = storedProject ? { ...storedProject, rootPath: binding.targetRootPath } : ({ id: binding.projectId, rootPath: binding.targetRootPath } as Project);
    disableProjectMcpServer(database, project, owner.toolId, owner.componentId);
    return null;
  } catch (error) {
    return { path: owner.targetPath, reason: error instanceof Error ? error.message : "PluginHub 管理的 MCP entry 删除失败" };
  }
}

function releasePluginHookOwnership(owner: ProjectPluginPrivateFileOwnership): PluginHubDeleteFailure | null {
  const current = readPluginHookConfig(owner.toolId, owner.targetPath);
  if (hooksFingerprint(current.hooks) !== owner.reason) {
    return { path: owner.targetPath, reason: "plugin-native hooks 已被本地修改，未自动删除" };
  }
  removePluginHooksSection(owner.toolId, owner.targetPath);
  return null;
}

function releasePrivateFileOwnership(owner: ProjectPluginPrivateFileOwnership): PluginHubDeleteFailure | null {
  if (!managedPrivateFileMatches(owner)) {
    return { path: owner.targetPath, reason: "PluginHub 管理的 plugin-private 文件已被本地修改，未自动删除" };
  }
  try {
    removeAnyPath(owner.targetPath);
    return null;
  } catch (error) {
    return { path: owner.targetPath, reason: error instanceof Error ? error.message : "private file 删除失败" };
  }
}

function releaseNativePluginOwnership(binding: ProjectPluginBinding, owner: ProjectPluginPrivateFileOwnership): PluginHubDeleteFailure | null {
  const reason = parseNativePackageOwnershipReason(owner.reason);
  const pluginName = reason?.pluginName ?? binding.plugin?.name ?? path.basename(owner.targetPath);
  try {
    if (!managedNativePackageMatches(owner)) {
      return { path: owner.targetPath, reason: "PluginHub 管理的原生 plugin package 已被本地修改，未自动删除" };
    }
    if (owner.toolId === "claude") {
      removeClaudeProjectPluginSettings(reason?.settingsPath ?? path.join(binding.targetRootPath, ".claude", "settings.json"), pluginName, reason?.marketplaceName ?? "pluginhub");
      removeClaudeMarketplacePlugin(reason?.marketplacePath ?? nativePluginMarketplacePath(binding.targetRootPath, "claude"), pluginName);
    } else if (owner.toolId === "codex") {
      removeCodexMarketplacePlugin(reason?.marketplacePath ?? nativePluginMarketplacePath(binding.targetRootPath, "codex"), pluginName);
    }
    removeAnyPath(owner.targetPath);
    return null;
  } catch (error) {
    return { path: owner.targetPath, reason: error instanceof Error ? error.message : "原生 plugin package 删除失败" };
  }
}

function isPluginMcpTargetToolId(toolId: ToolId): toolId is PluginMcpTargetToolId {
  return isMcpHubTargetToolId(toolId);
}

function pluginMcpConfigPath(projectRoot: string, toolId: PluginMcpTargetToolId): string {
  if (toolId === "claude") return path.join(projectRoot, ".mcp.json");
  if (toolId === "codex") return path.join(projectRoot, ".codex", "config.toml");
  if (toolId === "opencode") return path.join(projectRoot, "opencode.json");
  if (toolId === "codebuddy") return path.join(projectRoot, ".mcp.json");
  if (toolId === "cursor") return path.join(projectRoot, ".cursor", "mcp.json");
  if (toolId === "antigravity") return path.join(projectRoot, ".agents", "mcp_config.json");
  if (toolId === "trae") return path.join(projectRoot, ".trae", "mcp.json");
  if (toolId === "qwen") return path.join(projectRoot, ".qwen", "settings.json");
  return path.join(projectRoot, ".kimi-code", "mcp.json");
}

function readPluginMcpConfigEntry(configPath: string, toolId: McpHubTargetToolId, serverId: string): unknown | null {
  if (!fs.existsSync(configPath) || toolId === "codex") return null;
  const root = readJsonObject(configPath);
  const key = toolId === "opencode" ? "mcp" : "mcpServers";
  const serverMap = root[key];
  if (!isRecord(serverMap) || !(serverId in serverMap)) return null;
  return serverMap[serverId];
}

function removePluginMcpConfigEntry(configPath: string, toolId: McpHubTargetToolId, serverId: string): void {
  if (!fs.existsSync(configPath) || toolId === "codex") return;
  const root = readJsonObject(configPath);
  const key = toolId === "opencode" ? "mcp" : "mcpServers";
  if (!isRecord(root[key]) || !(serverId in root[key])) return;
  const serverMap = { ...root[key] };
  delete serverMap[serverId];
  writeJsonObject(configPath, { ...root, [key]: serverMap });
}

function pluginHookConfigPath(projectRoot: string, toolId: ToolId): string {
  const candidates = pluginHookConfigCandidates(projectRoot, toolId);
  const withHooks = candidates.find((candidate) => !isEmptyHooks(readPluginHookConfig(toolId, candidate).hooks));
  if (withHooks) return withHooks;
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? pluginHookDefaultConfigPath(projectRoot, toolId);
}

function pluginHookConfigCandidates(projectRoot: string, toolId: ToolId): string[] {
  if (toolId === "claude") return [path.join(projectRoot, ".claude", "settings.local.json"), path.join(projectRoot, ".claude", "settings.json")];
  if (toolId === "qwen") return [pluginHookDefaultConfigPath(projectRoot, toolId)];
  if (toolId === "qoder") return [path.join(projectRoot, ".qoder", "settings.local.json"), path.join(projectRoot, ".qoder", "settings.json")];
  if (toolId === "codebuddy") return [path.join(projectRoot, ".codebuddy", "settings.local.json"), path.join(projectRoot, ".codebuddy", "settings.json")];
  if (toolId === "kimi") return [pluginHookDefaultConfigPath(projectRoot, toolId)];
  return [pluginHookDefaultConfigPath(projectRoot, toolId)];
}

function pluginHookDefaultConfigPath(projectRoot: string, toolId: ToolId): string {
  if (toolId === "codex") return path.join(projectRoot, ".codex", "hooks.json");
  if (toolId === "claude") return path.join(projectRoot, ".claude", "settings.json");
  if (toolId === "qwen") return path.join(projectRoot, ".qwen", "settings.json");
  if (toolId === "qoder") return path.join(projectRoot, ".qoder", "settings.json");
  if (toolId === "kimi") return path.join(projectRoot, ".kimi-code", "config.toml");
  if (toolId === "codebuddy") return path.join(projectRoot, ".codebuddy", "settings.json");
  return path.join(projectRoot, ".agents", "plugins", "hooks.json");
}

function readPluginHookConfig(toolId: ToolId, configPath: string): { value: Record<string, unknown>; hooks: unknown | null; error: string | null } {
  if (!fs.existsSync(configPath)) return { value: {}, hooks: null, error: null };
  if (toolId === "kimi") {
    const text = fs.readFileSync(configPath, "utf8");
    return { value: { __kimiConfigText: text }, hooks: parsePluginKimiHookRules(text), error: null };
  }
  try {
    const parsed = JSON.parse(stripJsonComments(fs.readFileSync(configPath, "utf8")));
    const value = isRecord(parsed) ? parsed : {};
    return {
      value,
      hooks: extractPluginHooksPayload(toolId, value),
      error: null
    };
  } catch (error) {
    return { value: {}, hooks: null, error: error instanceof Error ? error.message : "JSON 解析失败" };
  }
}

function extractPluginHooksPayload(toolId: ToolId, value: unknown): unknown | null {
  if (!isRecord(value)) return null;
  if (Object.prototype.hasOwnProperty.call(value, "hooks")) return value.hooks;
  if (toolId === "codex" && Object.keys(value).length > 0) return value;
  return null;
}

function writePluginHooksSection(toolId: ToolId, configPath: string, hooks: unknown): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (toolId === "kimi") {
    const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
    fs.writeFileSync(configPath, serializePluginKimiHooksConfig(existing, hooks), "utf8");
    return;
  }
  const current = readPluginHookConfig(toolId, configPath);
  const base = { ...current.value };
  if (toolId === "codex" && !Object.prototype.hasOwnProperty.call(base, "hooks") && Object.keys(base).length === 0) {
    fs.writeFileSync(configPath, `${stableJson(hooks, 2)}\n`, "utf8");
    return;
  }
  base.hooks = hooks;
  fs.writeFileSync(configPath, `${stableJson(base, 2)}\n`, "utf8");
}

function removePluginHooksSection(toolId: ToolId, configPath: string): void {
  if (!fs.existsSync(configPath)) return;
  if (toolId === "kimi") {
    const next = removePluginKimiHookBlocks(fs.readFileSync(configPath, "utf8")).trimEnd();
    if (next) fs.writeFileSync(configPath, `${next}\n`, "utf8");
    else removeAnyPath(configPath);
    return;
  }
  const current = readPluginHookConfig(toolId, configPath);
  const base = { ...current.value };
  if (toolId === "codex" && !Object.prototype.hasOwnProperty.call(base, "hooks")) {
    removeAnyPath(configPath);
    return;
  }
  delete base.hooks;
  if (Object.keys(base).length === 0) {
    removeAnyPath(configPath);
    return;
  }
  fs.writeFileSync(configPath, `${stableJson(base, 2)}\n`, "utf8");
}

function parsePluginKimiHookRules(input: string): Record<string, unknown>[] {
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
    current[match[1]] = parsePluginKimiTomlScalar(match[2] ?? "");
  }

  if (current) rules.push(current);
  return normalizePluginKimiHookRules(rules);
}

function serializePluginKimiHooksConfig(existing: string, hooks: unknown): string {
  const base = removePluginKimiHookBlocks(existing).trimEnd();
  const rules = normalizePluginKimiHookRules(hooks);
  const hookText = rules.map(pluginKimiHookRuleToml).join("\n\n");
  const next = [base, hookText].filter((part) => part.trim()).join("\n\n");
  return next.trimEnd() ? `${next.trimEnd()}\n` : "";
}

function removePluginKimiHookBlocks(input: string): string {
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

function pluginKimiHookRuleToml(rule: Record<string, unknown>): string {
  const lines = ["[[hooks]]"];
  lines.push(`event = ${pluginKimiTomlValue(String(rule.event ?? ""))}`);
  if (typeof rule.matcher === "string" && rule.matcher.trim()) lines.push(`matcher = ${pluginKimiTomlValue(rule.matcher.trim())}`);
  lines.push(`command = ${pluginKimiTomlValue(String(rule.command ?? ""))}`);
  if (typeof rule.timeout === "number" && Number.isFinite(rule.timeout)) lines.push(`timeout = ${Math.max(1, Math.floor(rule.timeout))}`);
  return lines.join("\n");
}

function normalizePluginKimiHookRules(hooks: unknown): Record<string, unknown>[] {
  const rules: Record<string, unknown>[] = [];
  if (Array.isArray(hooks)) {
    for (const item of hooks) pushPluginKimiHookRule(rules, null, item);
  } else if (isRecord(hooks)) {
    for (const [event, value] of Object.entries(hooks)) {
      if (Array.isArray(value)) {
        for (const item of value) pushPluginKimiHookRule(rules, event, item);
      } else {
        pushPluginKimiHookRule(rules, event, value);
      }
    }
  }
  return rules;
}

function pushPluginKimiHookRule(output: Record<string, unknown>[], eventHint: string | null, value: unknown): void {
  if (typeof value === "string") {
    const event = pluginKimiHookEventName(eventHint ?? "Stop");
    if (value.trim()) output.push({ event, command: value.trim() });
    return;
  }
  if (!isRecord(value)) return;
  const event = pluginKimiHookEventName(stringValue(value.event) ?? eventHint ?? "Stop");
  const directCommand = stringValue(value.command);
  if (directCommand) {
    output.push(pluginKimiHookRule(event, value, directCommand));
    return;
  }
  const nestedHooks = Array.isArray(value.hooks) ? value.hooks : [];
  for (const hook of nestedHooks) {
    if (!isRecord(hook)) continue;
    const command = stringValue(hook.command);
    if (command) output.push(pluginKimiHookRule(event, { ...value, timeout: hook.timeout }, command));
  }
}

function pluginKimiHookRule(event: string, source: Record<string, unknown>, command: string): Record<string, unknown> {
  return {
    event,
    ...(typeof source.matcher === "string" && source.matcher.trim() ? { matcher: source.matcher.trim() } : {}),
    command,
    ...(typeof source.timeout === "number" ? { timeout: source.timeout } : {})
  };
}

function pluginKimiHookEventName(eventName: string): string {
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

function parsePluginKimiTomlScalar(value: string): unknown {
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

function pluginKimiTomlValue(value: string): string {
  return JSON.stringify(value);
}
function isEmptyHooks(hooks: unknown): boolean {
  if (hooks === null || hooks === undefined) return true;
  if (Array.isArray(hooks)) return hooks.length === 0;
  if (isRecord(hooks)) return Object.keys(hooks).length === 0;
  return false;
}

function hooksFingerprint(hooks: unknown): string {
  return crypto.createHash("sha256").update(stableJson(hooks)).digest("hex");
}

function stripJsonComments(input: string): string {
  return input.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
}

function stableJson(value: unknown, space = 0): string {
  return JSON.stringify(sortJsonValue(value), null, space);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) output[key] = sortJsonValue(value[key]);
    return output;
  }
  return value;
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(stripJsonComments(fs.readFileSync(filePath, "utf8")));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonObject(filePath: string, value: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${stableJson(value, 2)}\n`, "utf8");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function pluginPackageRelativePath(plugin: PluginPackagePathPlugin, sourceRelativePath: string): string {
  const normalized = normalizeRelativePath(sourceRelativePath);
  if (shouldPreserveSinglePluginSourceRoot(plugin)) return normalized;
  for (const prefix of [`plugins/${plugin.name}/`, `${plugin.name}/`]) {
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
  }
  for (const marker of [".codex-plugin/", ".claude-plugin/", ".kimi-code/", "skills/", "commands/", "agents/", "hooks/", "bin/", "src/"]) {
    const index = normalized.indexOf(marker);
    if (index >= 0) return normalized.slice(index);
  }
  for (const exact of [".mcp.json", "mcp.json", "settings.json", "qwen-extension.json"]) {
    if (normalized === exact || normalized.endsWith(`/${exact}`)) return exact;
  }
  const parts = normalized.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : normalized;
}

function shouldPreserveSinglePluginSourceRoot(plugin: PluginPackagePathPlugin): boolean {
  return plugin.source?.kind === "single-plugin" && !hasPluginNativeManifestPrivateFiles(plugin);
}

function hasPluginNativeManifestPrivateFiles(plugin: PluginPackagePathPlugin): boolean {
  return plugin.privateFiles.some((file) => {
    const normalized = normalizeRelativePath(file.sourceRelativePath);
    return (
      normalized.endsWith("/.codex-plugin/plugin.json") ||
      normalized.endsWith("/.claude-plugin/plugin.json") ||
      normalized.endsWith("/qwen-extension.json") ||
      normalized === ".codex-plugin/plugin.json" ||
      normalized === ".claude-plugin/plugin.json" ||
      normalized === "qwen-extension.json"
    );
  });
}

function nativePackageOwnershipReason(plan: NativePackageInstallPlan, packageHash: string | null): string {
  return stableJson({
    pluginName: plan.pluginName,
    marketplaceName: plan.marketplaceName,
    packageRoot: plan.packageRoot,
    marketplacePath: plan.marketplacePath,
    settingsPath: plan.settingsPath,
    packageHash
  });
}

function parseNativePackageOwnershipReason(reason: string | null): {
  pluginName: string;
  marketplaceName: string;
  packageRoot: string;
  marketplacePath: string;
  settingsPath: string | null;
  packageHash: string | null;
} | null {
  if (!reason) return null;
  try {
    const parsed = JSON.parse(reason);
    if (!isRecord(parsed)) return null;
    return {
      pluginName: stringValue(parsed.pluginName) ?? "",
      marketplaceName: stringValue(parsed.marketplaceName) ?? "pluginhub",
      packageRoot: stringValue(parsed.packageRoot) ?? "",
      marketplacePath: stringValue(parsed.marketplacePath) ?? "",
      settingsPath: stringValue(parsed.settingsPath),
      packageHash: stringValue(parsed.packageHash)
    };
  } catch {
    return null;
  }
}

function managedNativePackageMatches(owner: ProjectPluginPrivateFileOwnership): boolean {
  const parsed = parseNativePackageOwnershipReason(owner.reason);
  if (!parsed?.packageHash || !fs.existsSync(owner.targetPath)) return true;
  return hashExistingPath(owner.targetPath) === parsed.packageHash;
}

function removeClaudeProjectPluginSettings(settingsPath: string, pluginName: string, marketplaceName: string): void {
  if (!fs.existsSync(settingsPath)) return;
  const settings = readJsonObject(settingsPath);
  const enabledPlugins = isRecord(settings.enabledPlugins) ? { ...settings.enabledPlugins } : {};
  delete enabledPlugins[`${pluginName}@${marketplaceName}`];
  const extraKnownMarketplaces = isRecord(settings.extraKnownMarketplaces) ? { ...settings.extraKnownMarketplaces } : {};
  const hasOtherMarketplacePlugin = Object.entries(enabledPlugins).some(([key, value]) => key.endsWith(`@${marketplaceName}`) && value === true);
  if (!hasOtherMarketplacePlugin) delete extraKnownMarketplaces[marketplaceName];
  const next = { ...settings };
  if (Object.keys(enabledPlugins).length > 0) next.enabledPlugins = enabledPlugins;
  else delete next.enabledPlugins;
  if (Object.keys(extraKnownMarketplaces).length > 0) next.extraKnownMarketplaces = extraKnownMarketplaces;
  else delete next.extraKnownMarketplaces;
  writeJsonObject(settingsPath, next);
}

function removeClaudeMarketplacePlugin(marketplacePath: string, pluginName: string): void {
  removeMarketplacePluginEntry(marketplacePath, pluginName);
}

function removeCodexMarketplacePlugin(marketplacePath: string, pluginName: string): void {
  removeMarketplacePluginEntry(marketplacePath, pluginName);
}

function removeMarketplacePluginEntry(marketplacePath: string, pluginName: string): void {
  if (!fs.existsSync(marketplacePath)) return;
  const marketplace = readJsonObject(marketplacePath);
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins.filter((item) => !(isRecord(item) && item.name === pluginName)) : [];
  if (plugins.length === 0) {
    removeAnyPath(marketplacePath);
    return;
  }
  writeJsonObject(marketplacePath, { ...marketplace, plugins });
}

function applyAgentPlan(
  database: AppDatabase,
  dataDir: string,
  project: Project,
  plan: AgentInstallPlan,
  options: ApplyOptions
): ReturnType<typeof applyProjectAgentTarget> {
  let result = applyProjectAgentTarget(
    database,
    dataDir,
    project,
    plan.agent.id,
    plan.toolId,
    options.conflictMode === "overwrite" ? { conflictMode: "overwrite", config: options.config } : { config: options.config }
  );
  if (result.requiresConfirmation && options.conflictMode === "overwrite" && result.preview.action === "replace-managed") {
    result = applyProjectAgentTarget(database, dataDir, project, plan.agent.id, plan.toolId, { conflictMode: "replace-managed", config: options.config });
  }
  return result;
}

function backupLocalTarget(
  projectRoot: string,
  targetPath: string,
  hub: string,
  targetResourceType: ProjectLocalFileBackup["targetResourceType"]
): ProjectLocalFileBackup {
  const timestamp = nowIso().replace(/[:.]/g, "-");
  const relative = normalizeRelativePath(path.relative(projectRoot, targetPath));
  const backupRoot = path.join(projectRoot, ".local-ai-workbench", "backups", "pluginhub", timestamp);
  const backupPath = safeJoin(backupRoot, relative || path.basename(targetPath));
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  if (fs.existsSync(targetPath)) {
    fs.cpSync(targetPath, backupPath, { recursive: true, force: true, dereference: false });
  }
  const metadataPath = `${backupPath}.metadata.json`;
  const backup = { originalPath: targetPath, backupPath, metadataPath, hub, targetResourceType, createdAt: nowIso() };
  fs.writeFileSync(metadataPath, JSON.stringify(backup, null, 2), "utf8");
  return backup;
}

function materializePrivateFile(sourcePath: string, targetPath: string): void {
  removeAnyPath(targetPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function materializePluginHubLocalSource(dataDir: string, sourceId: string, inputPath: string): string {
  const snapshotPath = path.join(dataDir, "pluginhub", "sources", sourceId, "snapshot");
  if (normalizeFsPath(snapshotPath) === normalizeFsPath(inputPath)) return snapshotPath;
  const snapshotRelativePath = normalizeRelativePath(path.relative(inputPath, snapshotPath));
  removeAnyPath(snapshotPath);
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.cpSync(inputPath, snapshotPath, {
    recursive: true,
    force: true,
    filter: (source) => {
      const relative = normalizeRelativePath(path.relative(inputPath, source));
      if (relative === snapshotRelativePath || relative.startsWith(`${snapshotRelativePath}/`)) return false;
      return relative !== ".git" && !relative.startsWith(".git/") && relative !== "node_modules" && !relative.startsWith("node_modules/");
    }
  });
  return snapshotPath;
}

function removeAnyPath(targetPath: string): void {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function upsertPluginSkillSource(database: AppDatabase, source: PluginHubSource): SkillHubSource {
  return database.upsertSkillHubSource({
    id: source.id,
    type: PLUGINHUB_SKILL_SOURCE_TYPE,
    label: source.label,
    repoKey: null,
    owner: null,
    repo: null,
    branch: null,
    input: source.input,
    inputPath: source.sourcePath,
    resolvedPath: source.resolvedPath,
    currentRevision: source.currentRevision,
    checkoutPath: source.checkoutPath
  });
}

function projectToolTarget(database: AppDatabase, project: Project, toolId: ToolId, config?: AppConfig): SessionProjectToolTarget | null {
  return listProjectToolTargets(database, project, config).find((target): target is SessionProjectToolTarget => isToolId(target.toolId) && target.toolId === toolId) ?? null;
}

function pluginHarnessSupport(plugin: Pick<PluginHubPlugin, "name" | "componentRefs" | "privateFiles"> & { source?: PluginHubSource | null }): PluginHubPlugin["harnessSupport"] {
  return {
    codex: canMaterializeNativePluginPackage(plugin, "codex") ? "native" : "unsupported",
    claude: canMaterializeNativePluginPackage(plugin, "claude") ? "native" : "unsupported",
    qwen: canInstallQwenPluginComponents(plugin) ? "component-only" : "unsupported",
    kimi: canInstallKimiPluginComponents(plugin) ? "component-only" : "unsupported",
    cursor: hasNativePackagePrefix(plugin, ".cursor-plugin/") || hasNativePackagePrefix(plugin, ".claude-plugin/") ? "planned" : "unsupported",
    opencode: hasNativePackagePrefix(plugin, ".opencode/") ? "planned" : canInstallComponentOnlyPlugin(plugin, "opencode") ? "component-only" : "unsupported",
    codebuddy: canInstallComponentOnlyPlugin(plugin, "codebuddy") ? "component-only" : "unsupported",
    copilot: hasNativePackagePrefix(plugin, ".github/") ? "planned" : "unsupported"
  };
}

function withResolvedPluginHarnessSupport(plugin: PluginHubPlugin): PluginHubPlugin {
  return { ...plugin, harnessSupport: pluginHarnessSupport(plugin) };
}

function pluginToolSupport(plugin: PluginHubPlugin, toolId: ToolId): PluginHubHarnessSupport {
  return pluginHarnessSupport(plugin)[toolId] ?? "unsupported";
}

function canInstallPluginForTool(plugin: PluginHubPlugin, toolId: ToolId): boolean {
  const support = pluginToolSupport(plugin, toolId);
  return support === "native" || support === "component-only";
}

function canInstallComponentOnlyPlugin(plugin: Pick<PluginHubPlugin, "name" | "componentRefs" | "privateFiles"> & { source?: PluginHubSource | null }, toolId: ToolId): boolean {
  const supportedRefs = plugin.componentRefs.filter((ref) => isComponentOnlyRefSupported(toolId, ref));
  if (supportedRefs.length === 0) return false;
  return plugin.componentRefs.every((ref) => !ref.required || isComponentOnlyRefSupported(toolId, ref));
}

function isComponentOnlyRefSupported(toolId: ToolId, ref: PluginHubComponentRef): boolean {
  if (ref.type === "skill") return true;
  if (ref.type === "agent") return isAgentHubToolId(toolId);
  if (ref.type === "mcp") return isMcpHubTargetToolId(toolId) && isToolId(toolId);
  if (ref.type === "hook") return toolId !== "kimi" && isHookHubSupportedToolId(toolId);
  return false;
}

function canInstallKimiPluginComponents(plugin: Pick<PluginHubPlugin, "name" | "componentRefs" | "privateFiles"> & { source?: PluginHubSource | null }): boolean {
  return canInstallComponentOnlyPlugin(plugin, "kimi") || plugin.privateFiles.some(isKimiProjectPrivateFile);
}

function canInstallQwenPluginComponents(plugin: Pick<PluginHubPlugin, "name" | "componentRefs" | "privateFiles"> & { source?: PluginHubSource | null }): boolean {
  return canInstallComponentOnlyPlugin(plugin, "qwen") || nativeHookPayloadForTool(null, plugin, "qwen") !== null;
}

function isKimiProjectPrivateFile(file: Pick<PluginHubPrivateFile, "targetRelativePath">): boolean {
  const target = normalizeRelativePath(file.targetRelativePath);
  return target.startsWith(".kimi-code/") && target !== ".kimi-code/config.toml";
}

function canMaterializeNativePluginPackage(plugin: Pick<PluginHubPlugin, "name" | "componentRefs" | "privateFiles"> & { source?: PluginHubSource | null }, toolId: NativePluginToolId): boolean {
  if (plugin.componentRefs.length > 0) return true;
  if (nativeHookPayloadForTool(null, plugin, toolId) !== null) return true;
  const selection = nativePackageFileSelection(plugin, toolId);
  return plugin.privateFiles.some((file) => isSelectedNativePackageFile(pluginPackageRelativePath(plugin, file.sourceRelativePath), selection));
}

function hasNativePackagePrefix(plugin: PluginPackagePathPlugin, prefix: string): boolean {
  return plugin.privateFiles.some((file) => pluginPackageRelativePath(plugin, file.sourceRelativePath).startsWith(prefix));
}

function topologyHash(plugin: PluginHubPlugin): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        componentRefs: plugin.componentRefs,
        privateFiles: plugin.privateFiles.map((file) => ({
          id: file.id,
          sourceRelativePath: file.sourceRelativePath,
          targetRelativePath: file.targetRelativePath,
          contentHash: file.contentHash
        }))
      })
    )
    .digest("hex");
}

function hasPluginContent(directory: string): boolean {
  return (
    hasNativePluginManifest(directory) ||
    fs.existsSync(path.join(directory, "skills")) ||
    fs.existsSync(path.join(directory, "agents")) ||
    fs.existsSync(path.join(directory, "commands")) ||
    fs.existsSync(path.join(directory, ".kimi-code")) ||
    fs.existsSync(path.join(directory, "qwen-extension.json"))
  );
}

function hasNativePluginManifest(directory: string): boolean {
  return (
    fs.existsSync(path.join(directory, ".codex-plugin", "plugin.json")) ||
    fs.existsSync(path.join(directory, ".claude-plugin", "plugin.json")) ||
    fs.existsSync(path.join(directory, "qwen-extension.json"))
  );
}

function readPluginManifest(directory: string): { name: string | null; displayName: string | null; description: string | null } {
  const candidates = [path.join(directory, ".codex-plugin", "plugin.json"), path.join(directory, ".claude-plugin", "plugin.json"), path.join(directory, "qwen-extension.json")];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as Record<string, unknown>;
      const interfaceInfo = isRecord(parsed.interface) ? parsed.interface : {};
      return {
        name: typeof parsed.name === "string" ? parsed.name : null,
        displayName:
          typeof parsed.displayName === "string"
            ? parsed.displayName
            : typeof interfaceInfo.displayName === "string"
              ? interfaceInfo.displayName
              : typeof parsed.title === "string"
                ? parsed.title
                : null,
        description:
          typeof parsed.description === "string"
            ? parsed.description
            : typeof interfaceInfo.longDescription === "string"
              ? interfaceInfo.longDescription
              : typeof interfaceInfo.shortDescription === "string"
                ? interfaceInfo.shortDescription
                : null
      };
    } catch {
      return { name: null, displayName: null, description: null };
    }
  }
  return { name: null, displayName: null, description: null };
}

function readSkillMetadata(skillFile: string): { name: string | null; description: string | null } {
  const text = stripUtf8Bom(fs.readFileSync(skillFile, "utf8"));
  const metadataBlock = skillMetadataBlock(text);
  const name = /^name:\s*(.+)$/m.exec(metadataBlock)?.[1]?.trim() ?? /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  const descriptionValue = /^description:\s*(.+)$/m.exec(metadataBlock)?.[1]?.trim();
  const descriptionLine = descriptionValue && !/^[>|]\s*$/.test(descriptionValue) ? descriptionValue : null;
  const foldedDescription = /^description:\s*[>|]\s*\r?\n((?:\s+.+\r?\n?)+)/m.exec(metadataBlock)?.[1];
  const description = descriptionLine
    ? stripYamlQuotes(descriptionLine)
    : foldedDescription
      ? foldedDescription
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .join(" ")
      : null;
  return {
    name: name ? stripYamlQuotes(name) : null,
    description
  };
}

function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function skillMetadataBlock(text: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  if (frontmatter !== undefined) return frontmatter;

  const lines = text.split(/\r?\n/);
  const metadataLines: string[] = [];
  let collecting = false;
  for (const line of lines) {
    if (!collecting && /^\s*$/.test(line)) continue;
    if (/^(name|description):\s*/.test(line) || (collecting && /^\s+/.test(line))) {
      metadataLines.push(line);
      collecting = true;
      continue;
    }
    break;
  }
  return metadataLines.join("\n");
}

function hasSkillMarker(directory: string): boolean {
  return fs.existsSync(path.join(directory, "SKILL.md")) && fs.statSync(path.join(directory, "SKILL.md")).isFile();
}

function hashDirectory(directory: string): string {
  const hash = crypto.createHash("sha256");
  for (const file of listFiles(directory)) {
    hash.update(normalizeRelativePath(path.relative(directory, file)));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function hashFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hashExistingPath(targetPath: string): string | null {
  if (!fs.existsSync(targetPath)) return null;
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) return hashDirectory(targetPath);
  if (stat.isFile()) return hashFile(targetPath);
  return null;
}

function listFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function replaceDirectory(source: string, target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });
}

function safeJoin(root: string, relativePath: string): string {
  const fullPath = path.resolve(root, relativePath);
  const resolvedRoot = path.resolve(root);
  if (fullPath !== resolvedRoot && !fullPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Refusing PluginHub path outside root: ${relativePath}`);
  }
  return fullPath;
}

function safeName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${crypto.createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeComponentRefs(refs: PluginHubComponentRef[]): PluginHubComponentRef[] {
  const seen = new Set<string>();
  const output: PluginHubComponentRef[] = [];
  for (const ref of refs) {
    if (!["skill", "agent", "mcp", "hook"].includes(ref.type)) continue;
    const key = `${ref.type}:${ref.componentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ type: ref.type, componentId: ref.componentId, required: Boolean(ref.required) });
  }
  return output;
}

function normalizeRelativePath(input: string): string {
  return input.split(/[\\/]+/).filter(Boolean).join("/");
}

function stripYamlQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function pluginHubGitHubLabel(owner: string, repo: string, sourcePath: string | null): string {
  return sourcePath ? `${owner}/${repo}/${sourcePath}` : `${owner}/${repo}`;
}

function materializeGitHubCheckout(parsed: ReturnType<typeof parseGitHubInput>, checkoutPath: string, fixturePath?: string): void {
  fs.mkdirSync(path.dirname(checkoutPath), { recursive: true });
  if (!fs.existsSync(checkoutPath)) {
    const remote = fixturePath ? path.resolve(fixturePath) : parsed.remoteUrl;
    const args = ["clone", remote, checkoutPath];
    if (parsed.branch) args.splice(1, 0, "--branch", parsed.branch);
    gitOutput(args);
    return;
  }
  updateGitHubCheckout({ checkoutPath, branch: parsed.branch });
}

function updateGitHubCheckout(source: Pick<PluginHubSource, "checkoutPath" | "branch">): void {
  if (!source.checkoutPath || !fs.existsSync(path.join(source.checkoutPath, ".git"))) return;
  gitOutput(["-C", source.checkoutPath, "fetch", "--all", "--prune"], false);
  const branch = source.branch && source.branch !== "HEAD" ? source.branch : gitOutput(["-C", source.checkoutPath, "rev-parse", "--abbrev-ref", "HEAD"], false);
  if (branch && branch !== "HEAD") {
    gitOutput(["-C", source.checkoutPath, "reset", "--hard", `origin/${branch}`], false);
  }
}

function gitOutput(args: string[], required = true): string | null {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    if (!required) return null;
    throw new Error((result.stderr || result.stdout || "git command failed").trim());
  }
  return result.stdout.trim();
}

function resolveBundledPath(...segments: string[]): string {
  const roots = bundledRootCandidates();
  const existing = roots.map((root) => path.join(root, ...segments)).find((candidate) => fs.existsSync(candidate));
  return existing ?? path.join(roots[0] ?? process.cwd(), ...segments);
}

function bundledRootCandidates(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return uniquePaths([process.cwd(), path.resolve(moduleDir, "../../.."), path.resolve(moduleDir, "../../../..")]);
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of paths) {
    const normalized = path.resolve(item).toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(item);
  }
  return output;
}
