import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AppConfig,
  PluginHubComponentRef,
  PluginHubCustomPluginInput,
  PluginHubDeleteFailure,
  PluginHubImportResult,
  PluginHubList,
  PluginHubPlugin,
  PluginHubPluginDeletePreview,
  PluginHubPrivateFile,
  PluginHubSource,
  PluginHubSourceDeleteMode,
  PluginHubSourceDeletePreview,
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
import { normalizeFsPath } from "../core/pathUtils.js";
import { nowIso } from "../core/time.js";
import type { AppDatabase } from "../storage/database.js";
import { ensureSkillHub } from "../skillhub/skillhub.js";
import { createDirectoryLink, linkPointsTo, pathExists, removeDirectoryLink } from "../skillhub/links.js";
import { listProjectToolTargets } from "../skillhub/projectSkills.js";

interface DiscoveredPlugin {
  name: string;
  displayName: string;
  description: string | null;
  directory: string;
  sourceRelativePath: string;
  skills: DiscoveredPluginSkill[];
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

interface ApplyOptions {
  conflictMode?: "overwrite" | "skip" | null;
}

interface SkillInstallPlan {
  ref: PluginHubComponentRef;
  skill: SkillHubSkill;
  linkPath: string;
}

interface PrivateInstallPlan {
  file: PluginHubPrivateFile;
  targetPath: string;
}

const PLUGINHUB_SKILL_SOURCE_TYPE: SkillHubSource["type"] = "local";

export function listPluginHub(database: AppDatabase): PluginHubList {
  const plugins = database.listPluginHubPlugins();
  return {
    sources: database.listPluginHubSources(),
    plugins,
    sourcePlugins: plugins.filter((plugin) => plugin.kind === "source"),
    customPlugins: plugins.filter((plugin) => plugin.kind === "custom"),
    skills: database.listSkillHubSkills()
  };
}

export function importPluginHubLocalSource(
  database: AppDatabase,
  config: AppConfig,
  dataDir: string,
  inputPath: string
): PluginHubImportResult {
  const sourcePath = path.resolve(inputPath);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    throw new Error("Plugin 导入路径必须是已存在的目录");
  }

  const discovered = discoverPluginSource(sourcePath);
  if (discovered.plugins.length === 0) {
    throw new Error("未找到可导入的 plugin");
  }

  const existing = database.getPluginHubSourceByResolvedPath(sourcePath);
  const sourceId = existing?.id ?? stableId("pluginhub-source", normalizeFsPath(sourcePath));
  const source = database.upsertPluginHubSource({
    id: sourceId,
    kind: discovered.kind,
    label: path.basename(sourcePath) || sourcePath,
    inputPath: sourcePath,
    resolvedPath: sourcePath,
    pluginCount: discovered.plugins.length,
    componentCount: unique(discovered.plugins.flatMap((plugin) => plugin.skills.map((skill) => skill.sourceRelativePath))).length,
    privateFileCount: discovered.plugins.reduce((count, plugin) => count + plugin.privateFiles.length, 0)
  });
  const skillSource = upsertPluginSkillSource(database, source);
  const resolvedSkillHub = ensureSkillHub(config, dataDir);
  const importedSkills: SkillHubSkill[] = [];
  const plugins: PluginHubPlugin[] = [];

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
        harnessSupport: pluginHarnessSupport()
      })
    );
  }

  return { source, plugins, importedSkills, skipped: discovered.skipped };
}

export function createCustomPlugin(database: AppDatabase, dataDir: string, input: PluginHubCustomPluginInput): PluginHubPlugin {
  return upsertCustomPlugin(database, dataDir, crypto.randomUUID(), input);
}

export function updateCustomPlugin(database: AppDatabase, dataDir: string, pluginId: string, input: PluginHubCustomPluginInput): PluginHubPlugin {
  const existing = database.getPluginHubPlugin(pluginId);
  if (!existing || existing.kind !== "custom") throw new Error("Custom plugin not found");
  return upsertCustomPlugin(database, dataDir, pluginId, input, existing);
}

export function listProjectPluginState(database: AppDatabase, project: Project): ProjectPluginState {
  const bindings = database
    .listProjectPluginBindings(project.id)
    .filter((binding) => normalizeFsPath(binding.targetRootPath) === normalizeFsPath(project.rootPath));
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    plugins: database.listPluginHubPlugins(),
    bindings,
    syncRequiredPluginIds: bindings.filter((binding) => binding.plugin && topologyHash(binding.plugin) !== binding.topologyHash).map((binding) => binding.pluginId)
  };
}

export function installProjectPlugin(
  database: AppDatabase,
  project: Project,
  pluginId: string,
  toolId: ToolId,
  options: ApplyOptions = {}
): ProjectPluginApplyResult {
  const plugin = database.getPluginHubPlugin(pluginId);
  if (!plugin) throw new Error("PluginHub plugin not found");
  const toolTarget = projectToolTarget(database, project, toolId);
  if (!toolTarget?.enabled) {
    throw new Error("该工具未在项目中启用");
  }
  if (!toolTarget.supported) {
    throw new Error(toolTarget.reason ?? "该工具暂不支持项目 plugin 安装");
  }

  return applyProjectPlugin(database, project, plugin, toolTarget, options);
}

export function syncProjectPluginBinding(database: AppDatabase, project: Project, bindingId: string, options: ApplyOptions = {}): ProjectPluginApplyResult {
  const binding = database.listProjectPluginBindings(project.id).find((item) => item.id === bindingId);
  if (!binding?.plugin) throw new Error("Project plugin binding not found");
  const toolTarget = projectToolTarget(database, project, binding.toolId);
  if (!toolTarget?.enabled || !toolTarget.supported) {
    throw new Error(toolTarget?.reason ?? "该工具暂不支持项目 plugin 同步");
  }
  return applyProjectPlugin(database, project, binding.plugin, toolTarget, options);
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
  const componentIds = new Set(sourceComponents.map((skill) => skill.id));
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

  failures.push(...removeSourceComponentTargets(database, preview.sourceComponents));
  if (failures.length > 0) {
    return { ...preview, failures };
  }

  if (mode === "delete-custom-plugins") {
    for (const plugin of preview.customPlugins) {
      removeCustomPluginPrivateMaterial(plugin);
      database.deletePluginHubPlugin(plugin.id);
    }
  } else {
    const removedComponentIds = new Set(preview.sourceComponents.map((skill) => skill.id));
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
  database.deletePluginHubPluginsForSource(sourceId);
  database.deletePluginHubSource(sourceId);
  database.deleteSkillHubSource(sourceId);

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

function applyProjectPlugin(
  database: AppDatabase,
  project: Project,
  plugin: PluginHubPlugin,
  toolTarget: ProjectToolTarget,
  options: ApplyOptions
): ProjectPluginApplyResult {
  const existingBinding = database.getProjectPluginBinding(project.id, project.rootPath, toolTarget.toolId, plugin.id);
  const skillPlans = skillInstallPlans(database, plugin, toolTarget);
  const privatePlans = privateInstallPlans(project, plugin);
  const preview = previewProjectPluginPreflight(database, project, toolTarget, existingBinding, skillPlans, privatePlans);
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

    const samePrivate = privateConflict?.privateFileId === plan.file.id;
    const localConflict = !samePrivate && pathExists(plan.targetPath);
    if (localConflict && options.conflictMode !== "overwrite") {
      preflight.push({
        targetPath: plan.targetPath,
        targetResourceType: "private-file",
        existingOwnerType: "local",
        overwriteReason: "plugin-private 文件目标路径已有本地文件",
        backupRequired: true,
        required: true,
        componentId: null,
        privateFileId: plan.file.id
      });
      if (options.conflictMode === "skip") blocked = true;
      privateFileOwnership.push(privateOwnershipItem(plan, toolTarget.toolId, "blocked", "plugin-private 文件必须覆盖或保持阻止"));
      continue;
    }

    if (localConflict) backups.push(backupLocalTarget(project.rootPath, plan.targetPath, "PluginHub", "private-file"));
    materializePrivateFile(plan.file.contentPath, plan.targetPath);
    privateFileOwnership.push(privateOwnershipItem(plan, toolTarget.toolId, "managed", null));
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
    privateFileCount: privateFileOwnership.filter((item) => item.ownerState === "managed").length,
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
  toolTarget: ProjectToolTarget,
  existingBinding: ProjectPluginBinding | null,
  skillPlans: SkillInstallPlan[],
  privatePlans: PrivateInstallPlan[]
): { preflight: ProjectPluginPreflightItem[]; blocked: boolean } {
  const preflight: ProjectPluginPreflightItem[] = [];
  let blocked = false;
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
    if (!privateConflict && pathExists(plan.targetPath)) {
      preflight.push({
        targetPath: plan.targetPath,
        targetResourceType: "private-file",
        existingOwnerType: "local",
        overwriteReason: "plugin-private 文件目标路径已有本地文件",
        backupRequired: true,
        required: true,
        componentId: null,
        privateFileId: plan.file.id
      });
    }
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
            required: file.required ?? true
          };
        });

  return database.upsertPluginHubPlugin({
    id: pluginId,
    kind: "custom",
    sourceId: null,
    name,
    displayName: input.displayName?.trim() || existing?.displayName || name,
    description: input.description ?? existing?.description ?? null,
    componentRefs: sanitizeComponentRefs(input.componentRefs ?? existing?.componentRefs ?? []),
    privateFiles,
    harnessSupport: pluginHarnessSupport()
  });
}

function removeCustomPluginPrivateMaterial(plugin: PluginHubPlugin): void {
  if (plugin.kind !== "custom") return;
  const roots = new Set(plugin.privateFiles.map((file) => customPluginMaterialRoot(file.contentPath)).filter((root): root is string => Boolean(root)));
  for (const root of roots) {
    removeAnyPath(root);
  }
}

function customPluginMaterialRoot(contentPath: string): string | null {
  const resolved = path.resolve(contentPath);
  const marker = `${path.sep}private${path.sep}`;
  const index = resolved.lastIndexOf(marker);
  return index >= 0 ? resolved.slice(0, index) : null;
}

function discoverPluginSource(sourcePath: string): {
  kind: PluginHubSource["kind"];
  plugins: DiscoveredPlugin[];
  skipped: Array<{ path: string; reason: string }>;
} {
  const pluginsRoot = path.join(sourcePath, "plugins");
  const skipped: Array<{ path: string; reason: string }> = [];
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

  if (hasPluginContent(sourcePath)) {
    return { kind: "single-plugin", plugins: [discoverPlugin(sourcePath, path.basename(sourcePath) || "plugin")], skipped };
  }

  skipped.push({ path: sourcePath, reason: "未找到 plugins/、skills/ 或 plugin manifest" });
  return { kind: "library", plugins: [], skipped };
}

function discoverPlugin(pluginDir: string, sourceRelativePath: string): DiscoveredPlugin {
  const manifest = readPluginManifest(pluginDir);
  const name = safeName(manifest.name || path.basename(pluginDir));
  const displayName = manifest.displayName || manifest.name || path.basename(pluginDir);
  return {
    name,
    displayName,
    description: manifest.description,
    directory: pluginDir,
    sourceRelativePath,
    skills: discoverPluginSkills(pluginDir, sourceRelativePath),
    privateFiles: discoverPrivateFiles(pluginDir, sourceRelativePath, name)
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

function discoverPrivateFiles(pluginDir: string, pluginSourceRelativePath: string, pluginName: string): DiscoveredPrivateFile[] {
  const files: DiscoveredPrivateFile[] = [];
  for (const file of listFiles(pluginDir)) {
    const relativeFromPlugin = normalizeRelativePath(path.relative(pluginDir, file));
    if (relativeFromPlugin === "SKILL.md" || relativeFromPlugin.startsWith("skills/")) continue;
    const sourceRelativePath = normalizeRelativePath(path.join(pluginSourceRelativePath, relativeFromPlugin));
    files.push({
      filePath: file,
      sourceRelativePath,
      targetRelativePath: normalizeRelativePath(path.join(".agents", "plugins", pluginName, relativeFromPlugin)),
      contentHash: hashFile(file)
    });
  }
  return files;
}

function privateFileFromDiscovery(pluginId: string, file: DiscoveredPrivateFile): PluginHubPrivateFile {
  return {
    id: stableId("pluginhub-private", pluginId, file.sourceRelativePath),
    pluginId,
    sourceRelativePath: file.sourceRelativePath,
    targetRelativePath: file.targetRelativePath,
    contentPath: file.filePath,
    contentHash: file.contentHash,
    required: true
  };
}

function skillInstallPlans(database: AppDatabase, plugin: PluginHubPlugin, toolTarget: ProjectToolTarget): SkillInstallPlan[] {
  if (!toolTarget.skillDirectory) return [];
  return plugin.componentRefs.flatMap((ref) => {
    if (ref.type !== "skill") return [];
    const skill = database.getSkillHubSkill(ref.componentId);
    if (!skill) return [];
    return [{ ref, skill, linkPath: path.join(toolTarget.skillDirectory as string, skill.folderName) }];
  });
}

function privateInstallPlans(project: Project, plugin: PluginHubPlugin): PrivateInstallPlan[] {
  return plugin.privateFiles.map((file) => ({
    file,
    targetPath: safeJoin(project.rootPath, file.targetRelativePath)
  }));
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
  for (const component of previous.componentOwnership.filter((item) => item.ownerState === "managed")) {
    if (nextComponents.has(componentOwnerKey(component))) continue;
    if (otherComponentOwners(database, previous.id, previous.projectId, component).length > 0) continue;
    const removal = removeDirectoryLink(component.linkPath);
    if (!removal.reason || removal.missing) {
      database.deleteProjectSkillTarget(previous.projectId, component.toolId, component.componentId, component.linkPath);
    } else {
      failures.push({ path: component.linkPath, reason: removal.reason });
    }
  }

  const nextPrivateFiles = new Set((next?.privateFileOwnership ?? []).filter((item) => item.ownerState === "managed").map(privateOwnerKey));
  for (const file of previous.privateFileOwnership.filter((item) => item.ownerState === "managed")) {
    if (nextPrivateFiles.has(privateOwnerKey(file))) continue;
    if (otherPrivateOwners(database, previous.id, previous.projectId, file).length > 0) continue;
    try {
      removeAnyPath(file.targetPath);
    } catch (error) {
      failures.push({ path: file.targetPath, reason: error instanceof Error ? error.message : "private file 删除失败" });
    }
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
    ownerState,
    reason
  };
}

function componentOwnerKey(owner: ProjectPluginComponentOwnership): string {
  return [owner.toolId, owner.type, owner.componentId, normalizeFsPath(owner.linkPath)].join("\0");
}

function privateOwnerKey(owner: ProjectPluginPrivateFileOwnership): string {
  return [owner.toolId, owner.privateFileId, normalizeFsPath(owner.targetPath)].join("\0");
}

function backupLocalTarget(projectRoot: string, targetPath: string, hub: string, targetResourceType: "skill" | "private-file"): ProjectLocalFileBackup {
  const timestamp = nowIso().replace(/[:.]/g, "-");
  const relative = normalizeRelativePath(path.relative(projectRoot, targetPath));
  const backupRoot = path.join(projectRoot, ".github-repo-manager", "backups", "pluginhub", timestamp);
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
    input: source.inputPath,
    inputPath: null,
    resolvedPath: source.resolvedPath,
    currentRevision: null,
    checkoutPath: null
  });
}

function projectToolTarget(database: AppDatabase, project: Project, toolId: ToolId): ProjectToolTarget | null {
  return listProjectToolTargets(database, project).find((target) => target.toolId === toolId) ?? null;
}

function pluginHarnessSupport(): PluginHubPlugin["harnessSupport"] {
  return {
    codex: "native",
    claude: "planned",
    cursor: "planned",
    opencode: "planned",
    copilot: "planned"
  };
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
    fs.existsSync(path.join(directory, ".codex-plugin", "plugin.json")) ||
    fs.existsSync(path.join(directory, ".claude-plugin", "plugin.json")) ||
    fs.existsSync(path.join(directory, "skills")) ||
    fs.existsSync(path.join(directory, "agents")) ||
    fs.existsSync(path.join(directory, "commands"))
  );
}

function readPluginManifest(directory: string): { name: string | null; displayName: string | null; description: string | null } {
  const candidates = [path.join(directory, ".codex-plugin", "plugin.json"), path.join(directory, ".claude-plugin", "plugin.json")];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as Record<string, unknown>;
      return {
        name: typeof parsed.name === "string" ? parsed.name : null,
        displayName: typeof parsed.displayName === "string" ? parsed.displayName : typeof parsed.title === "string" ? parsed.title : null,
        description: typeof parsed.description === "string" ? parsed.description : null
      };
    } catch {
      return { name: null, displayName: null, description: null };
    }
  }
  return { name: null, displayName: null, description: null };
}

function readSkillMetadata(skillFile: string): { name: string | null; description: string | null } {
  const text = fs.readFileSync(skillFile, "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  const descriptionLine = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
  return {
    name: name ? stripYamlQuotes(name) : null,
    description: descriptionLine ? stripYamlQuotes(descriptionLine) : null
  };
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
