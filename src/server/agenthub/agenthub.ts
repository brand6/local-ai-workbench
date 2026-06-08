import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentHubAgent,
  AgentHubApplyConflictMode,
  AgentHubConfig,
  AgentHubConversionPreview,
  AgentHubImportConflict,
  AgentHubImportConflictResolution,
  AgentHubImportResult,
  AgentHubImportSkipped,
  AgentHubProjection,
  AgentHubSource,
  AgentHubSourceFormat,
  AgentHubToolId,
  AgentHubTruthRole,
  AgentHubTargetStatus,
  LocalOpenResponse,
  Project,
  ProjectAgentApplyResult,
  ProjectAgentDisableResult,
  ProjectAgentState,
  ProjectAgentSyncResult,
  ProjectAgentTarget,
  ProjectAgentTargetState,
  ProjectLocalAgent,
  ProjectLocalAgentMigrationResult,
  ProjectLocalAgentMigrationTarget,
  ProjectLocalFileBackup,
  ProjectToolTarget
} from "../../shared/types.js";
import { agentHubToolIds, isAgentHubToolId } from "../../shared/types.js";
import { openLocalPath } from "../core/localFilesystem.js";
import { backupProjectLocalTarget } from "../core/projectBackups.js";
import { displayPath, isPathInsideOrEqual, normalizeFsPath } from "../core/pathUtils.js";
import { nowIso } from "../core/time.js";
import type { AppDatabase } from "../storage/database.js";
import { listProjectToolTargets } from "../skillhub/projectSkills.js";

interface AgentHubAdapter {
  toolId: AgentHubToolId;
  label: string;
  sourceFormat: AgentHubSourceFormat;
  truthRole: AgentHubTruthRole;
  extension: string;
  targetPath(rootPath: string, slug: string): string;
  matches(filePath: string): boolean;
  parse(filePath: string, text: string): ParsedNativeAgent;
  render(agent: AgentHubAgent, targetRootPath: string): RenderedAgent;
}

interface ParsedNativeAgent {
  projection: AgentHubProjection;
  nativeMetadata: Record<string, unknown>;
}

interface RenderedAgent {
  content: string;
  preservedNativeFields: string[];
  ignoredNativeFields: string[];
}

interface DiscoveredAgent {
  sourcePath: string;
  sourceRelativePath: string | null;
  category: string | null;
  parsed: ParsedNativeAgent;
  contentHash: string;
}

interface ImportOptions {
  conflictResolutions?: AgentHubImportConflictResolution[];
  overwriteConflicts?: boolean;
}

interface AgentHubListOptions {
  seedDefaultSources?: boolean;
}

interface PluginHubAgentRoot {
  rootPath: string;
  sourceRelativePrefix: string;
}

interface PluginHubAgentImportInput {
  sourceId: string;
  label: string;
  inputPath: string | null;
  resolvedPath: string | null;
  roots: PluginHubAgentRoot[];
}

export interface PluginHubAgentImportResult extends AgentHubImportResult {
  agents: AgentHubAgent[];
}

export interface RenderAgentForToolResult {
  agent: AgentHubAgent;
  toolId: AgentHubToolId;
  content: string;
  preservedNativeFields: string[];
  ignoredNativeFields: string[];
}

interface ApplyOptions {
  conflictMode?: AgentHubApplyConflictMode | null;
}

interface DisableOptions {
  mode?: "keep-file" | "delete-with-backup" | null;
}

interface MigrationOptions {
  conflictResolution?: AgentHubImportConflictResolution | null;
}

const BUILTIN_AGENCY_SOURCE_ID = "agency-agents";
const BUILTIN_AGENCY_SEEDED_SETTING = "agenthub.builtin.agency-agents.seeded.v1";
const DIRECT_MIGRATION_SOURCE_ID = "project-local-agents";

interface BuiltInAgencySnapshot {
  sourcePath: string;
  agentCount: number;
  contentHash: string;
}

let builtInAgencySnapshotCache: BuiltInAgencySnapshot | null = null;

const adapters: Record<AgentHubToolId, AgentHubAdapter> = {
  claude: markdownAdapter({
    toolId: "claude",
    label: "Claude",
    truthRole: "subagent",
    extension: ".md",
    targetDir: [".claude", "agents"],
    sameToolFields: ["name", "description", "tools", "model"]
  }),
  opencode: markdownAdapter({
    toolId: "opencode",
    label: "OpenCode",
    truthRole: "subagent",
    extension: ".md",
    targetDir: [".opencode", "agents"],
    sameToolFields: ["description", "mode", "color"]
  }),
  qwen: markdownAdapter({
    toolId: "qwen",
    label: "Qwen",
    truthRole: "subagent",
    extension: ".md",
    targetDir: [".qwen", "agents"],
    sameToolFields: ["name", "description", "tools"]
  }),
  cursor: cursorAdapter(),
  codex: codexAdapter()
};

export function resolveAgentHubConfig(dataDir: string): AgentHubConfig {
  const rootDir = path.join(dataDir, "agenthub");
  return { rootDir, libraryDir: path.join(rootDir, "library") };
}

export function ensureAgentHub(dataDir: string): AgentHubConfig {
  const config = resolveAgentHubConfig(dataDir);
  fs.mkdirSync(config.libraryDir, { recursive: true });
  return config;
}

export function listAgentHub(database: AppDatabase, dataDir: string, query = "", options: AgentHubListOptions = {}) {
  const config = ensureAgentHub(dataDir);
  if (options.seedDefaultSources ?? true) seedDefaultAgentHubSources(database, dataDir);
  return {
    config,
    sources: database.listAgentHubSources(),
    agents: database.listAgentHubAgents(query)
  };
}

export function refreshAgentHubDiscovery(database: AppDatabase, dataDir: string, query = "") {
  seedDefaultAgentHubSources(database, dataDir);
  return listAgentHub(database, dataDir, query, { seedDefaultSources: false });
}

export function seedDefaultAgentHubSources(database: AppDatabase, dataDir: string): void {
  const sourcePath = resolveBundledPath("builtin-agents", "agency-agents");
  const source = database.getAgentHubSource(BUILTIN_AGENCY_SOURCE_ID);
  if (source) {
    const snapshot = readBuiltInAgencySnapshot(sourcePath);
    if (snapshot && isBuiltInAgencySourceCurrent(source, snapshot)) {
      if (!database.getSetting(BUILTIN_AGENCY_SEEDED_SETTING, false)) database.setSetting(BUILTIN_AGENCY_SEEDED_SETTING, true);
      return;
    }
  }
  const result = importBuiltInAgencyAgents(database, dataDir);
  if (result.imported.length || result.updated.length || database.getAgentHubSource(BUILTIN_AGENCY_SOURCE_ID)) {
    database.setSetting(BUILTIN_AGENCY_SEEDED_SETTING, true);
  }
}

export function importBuiltInAgencyAgents(database: AppDatabase, dataDir: string): AgentHubImportResult {
  const config = ensureAgentHub(dataDir);
  const sourcePath = resolveBundledPath("builtin-agents", "agency-agents");
  const snapshot = readBuiltInAgencySnapshot(sourcePath);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    const source = database.upsertAgentHubSource({
      id: BUILTIN_AGENCY_SOURCE_ID,
      type: "builtin",
      label: "msitarzewski/agency-agents",
      inputPath: "builtin-agents/agency-agents",
      resolvedPath: null,
      sourceTruthTool: "claude",
      importedAt: nowIso(),
      metadata: { missingPackagedSnapshot: true }
    });
    return emptyImportResult(source);
  }

  const source = database.upsertAgentHubSource({
    id: BUILTIN_AGENCY_SOURCE_ID,
    type: "builtin",
    label: "msitarzewski/agency-agents",
    inputPath: "builtin-agents/agency-agents",
    resolvedPath: sourcePath,
    sourceTruthTool: "claude",
    importedAt: nowIso(),
    metadata: {
      packaged: true,
      packagedAgentCount: snapshot?.agentCount ?? null,
      packagedSnapshotHash: snapshot?.contentHash ?? null
    }
  });
  const { discoveries, skipped } = discoverAgentFiles(sourcePath, "claude", { builtinAgency: true });
  const result = commitDiscoveredAgents(database, config.libraryDir, source, discoveries, skipped, { overwriteConflicts: true });
  pruneStaleSourceAgents(database, source.id, new Set(discoveries.map((discovery) => discovery.sourceRelativePath).filter(isString)));
  return result;
}

export function deleteAgentHubSource(database: AppDatabase, dataDir: string, sourceId: string): { source: AgentHubSource; agentsDeleted: AgentHubAgent[]; targetsDeleted: ProjectAgentTarget[] } {
  ensureAgentHub(dataDir);
  const source = database.getAgentHubSource(sourceId);
  if (!source) throw new Error("AgentHub source 不存在");
  const agentsDeleted = database.listAgentHubAgentsForSource(sourceId);
  const targetsDeleted = agentsDeleted.flatMap((agent) => database.listProjectAgentTargetsForAgent(agent.id));
  const librarySourceRoot = path.join(resolveAgentHubConfig(dataDir).libraryDir, sourceId);
  database.deleteAgentHubSource(sourceId);
  fs.rmSync(librarySourceRoot, { recursive: true, force: true });
  return { source, agentsDeleted, targetsDeleted };
}

export function deleteAgentHubAgent(database: AppDatabase, dataDir: string, agentId: string): { agent: AgentHubAgent; targetsDeleted: ProjectAgentTarget[] } {
  const config = ensureAgentHub(dataDir);
  const agent = requireAgent(database, agentId);
  if (!isPathInsideOrEqual(config.libraryDir, agent.nativePath)) {
    throw new Error("AgentHub agent 文件不在 library 中，拒绝删除");
  }
  const targetsDeleted = database.listProjectAgentTargetsForAgent(agent.id);
  fs.rmSync(agent.nativePath, { force: true });
  database.deleteProjectAgentTargetsForAgent(agent.id);
  database.deleteAgentHubAgent(agent.id);
  return { agent, targetsDeleted };
}

export function importLocalAgentFolder(
  database: AppDatabase,
  dataDir: string,
  inputPath: string,
  sourceTruthTool: AgentHubToolId,
  options: ImportOptions = {}
): AgentHubImportResult {
  if (!isAgentHubToolId(sourceTruthTool)) throw new Error("不支持的 AgentHub truth tool");
  const config = ensureAgentHub(dataDir);
  const sourcePath = displayPath(inputPath);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) {
    throw new Error("AgentHub 导入路径必须是已存在的目录");
  }

  const existing = database.getAgentHubSourceByResolvedPath(sourcePath, sourceTruthTool);
  const source = database.upsertAgentHubSource({
    id: existing?.id ?? crypto.randomUUID(),
    type: "local-import",
    label: existing?.label ?? (path.basename(sourcePath) || sourcePath),
    inputPath: sourcePath,
    resolvedPath: sourcePath,
    sourceTruthTool,
    importedAt: nowIso(),
    metadata: { detachedImport: true }
  });
  const { discoveries, skipped } = discoverAgentFiles(sourcePath, sourceTruthTool);
  return commitDiscoveredAgents(database, config.libraryDir, source, discoveries, skipped, options);
}

export function importPluginHubAgentRoots(database: AppDatabase, dataDir: string, input: PluginHubAgentImportInput): PluginHubAgentImportResult {
  const config = ensureAgentHub(dataDir);
  const source = database.upsertAgentHubSource({
    id: input.sourceId,
    type: "local-import",
    label: input.label,
    inputPath: input.inputPath,
    resolvedPath: input.resolvedPath,
    sourceTruthTool: "claude",
    importedAt: nowIso(),
    metadata: { pluginhubSource: true }
  });
  const discoveries: DiscoveredAgent[] = [];
  const skipped: AgentHubImportSkipped[] = [];

  for (const root of input.roots) {
    if (!fs.existsSync(root.rootPath) || !fs.statSync(root.rootPath).isDirectory()) continue;
    const discovered = discoverAgentFiles(root.rootPath, "claude");
    skipped.push(...discovered.skipped);
    discoveries.push(
      ...discovered.discoveries.map((discovery) => ({
        ...discovery,
        sourceRelativePath: normalizeRelativePath(path.join(root.sourceRelativePrefix, discovery.sourceRelativePath ?? path.basename(discovery.sourcePath)))
      }))
    );
  }

  const result = commitDiscoveredAgents(database, config.libraryDir, source, discoveries, skipped, { overwriteConflicts: true });
  const keepPaths = new Set(discoveries.map((discovery) => discovery.sourceRelativePath).filter(isString));
  pruneStaleSourceAgents(database, source.id, keepPaths);
  return { ...result, agents: database.listAgentHubAgentsForSource(source.id) };
}

export function openAgentHubAgent(database: AppDatabase, agentId: string, target: "document" | "folder"): LocalOpenResponse {
  const agent = database.getAgentHubAgent(agentId);
  if (!agent) throw new Error("AgentHub agent 不存在");
  return openLocalPath(target === "document" ? agent.nativePath : path.dirname(agent.nativePath));
}

export function reparseAgentHubAgent(database: AppDatabase, agentId: string): AgentHubAgent {
  const agent = requireAgent(database, agentId);
  if (!fs.existsSync(agent.nativePath)) throw new Error("AgentHub agent 原生文件不存在");
  const adapter = adapters[agent.sourceTruthTool];
  const parsed = adapter.parse(agent.nativePath, fs.readFileSync(agent.nativePath, "utf8"));
  return database.upsertAgentHubAgent({
    ...agent,
    name: parsed.projection.name || agent.name,
    description: parsed.projection.description,
    projection: { ...parsed.projection, slugCandidate: agent.slug },
    nativeMetadata: parsed.nativeMetadata,
    contentHash: hashFile(agent.nativePath)
  });
}

export function listProjectAgentState(database: AppDatabase, dataDir: string, project: Project, query = ""): ProjectAgentState {
  seedDefaultAgentHubSources(database, dataDir);
  const toolTargets = listAgentToolTargets(database, project);
  const agents = database.listAgentHubAgents(query);
  const targets = agents.flatMap((agent) =>
    toolTargets.map((toolTarget) =>
      isAgentHubToolId(toolTarget.toolId) && toolTarget.supported
        ? projectAgentTargetState(database, project, agent, toolTarget.toolId)
        : unsupportedProjectAgentTargetState(project, agent, toolTarget)
    )
  );
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolTargets,
    sources: database.listAgentHubSources(),
    agents,
    targets,
    localAgents: listProjectLocalAgents(database, project)
  };
}

export function listProjectLocalAgentState(database: AppDatabase, project: Project): ProjectAgentState {
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolTargets: listAgentToolTargets(database, project),
    sources: database.listAgentHubSources().filter((source) => source.type === "local-import"),
    agents: [],
    targets: [],
    localAgents: listProjectLocalAgents(database, project)
  };
}

export function applyProjectAgentTarget(
  database: AppDatabase,
  dataDir: string,
  project: Project,
  agentId: string,
  toolId: AgentHubToolId,
  options: ApplyOptions = {}
): ProjectAgentApplyResult {
  seedDefaultAgentHubSources(database, dataDir);
  ensureAgentToolEnabled(database, project, toolId);
  const agent = requireAgent(database, agentId);
  const preview = conversionPreview(agent, toolId, project.rootPath, "create");
  const existingBinding = database.getProjectAgentTargetByOutputPath(project.id, project.rootPath, toolId, preview.targetPath);
  const replacedBindings: ProjectAgentTarget[] = [];
  const backups: ProjectLocalFileBackup[] = [];

  if (existingBinding && existingBinding.agentId !== agent.id) {
    replacedBindings.push(existingBinding);
    if (options.conflictMode !== "replace-managed") {
      return {
        projectId: project.id,
        targetRootPath: project.rootPath,
        toolId,
        agent,
        binding: null,
        state: null,
        preview: { ...preview, action: "replace-managed" },
        conflicts: [],
        replacedBindings,
        backups,
        requiresConfirmation: true,
        action: "needs-confirmation"
      };
    }
  }

  const currentState = existingBinding?.agentId === agent.id ? projectAgentTargetState(database, project, agent, toolId) : null;
  if (currentState?.status === "drifted" && options.conflictMode !== "overwrite") {
    return {
      projectId: project.id,
      targetRootPath: project.rootPath,
      toolId,
      agent,
      binding: existingBinding,
      state: currentState,
      preview: { ...preview, action: "overwrite" },
      conflicts: [],
      replacedBindings,
      backups,
      requiresConfirmation: true,
      action: "needs-confirmation"
    };
  }

  if (!existingBinding && fs.existsSync(preview.targetPath)) {
    const conflict = localAgentForPath(database, project, toolId, preview.targetPath);
    if (options.conflictMode === "migrate-then-overwrite") {
      migrateProjectLocalAgent(database, dataDir, project, toolId, preview.targetPath, {
        type: "existing-source",
        sourceId: DIRECT_MIGRATION_SOURCE_ID
      });
    } else if (options.conflictMode !== "overwrite") {
      return {
        projectId: project.id,
        targetRootPath: project.rootPath,
        toolId,
        agent,
        binding: null,
        state: null,
        preview: { ...preview, action: "overwrite" },
        conflicts: [conflict],
        replacedBindings,
        backups,
        requiresConfirmation: true,
        action: "needs-confirmation"
      };
    }
  }

  if (fs.existsSync(preview.targetPath)) {
    const backup = backupProjectLocalTarget(project.rootPath, preview.targetPath, "AgentHub", "agent");
    if (backup) backups.push(backup);
  }

  fs.mkdirSync(path.dirname(preview.targetPath), { recursive: true });
  fs.writeFileSync(preview.targetPath, renderAgent(agent, toolId, project.rootPath).content, "utf8");
  const outputHash = hashText(fs.readFileSync(preview.targetPath, "utf8"));
  const binding = database.upsertProjectAgentTarget({
    ...(existingBinding ? { id: existingBinding.id } : {}),
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId,
    agentId: agent.id,
    outputPath: preview.targetPath,
    appliedSourceHash: agent.contentHash,
    appliedOutputHash: outputHash,
    appliedAt: nowIso()
  });

  const state = projectAgentTargetState(database, project, agent, toolId);
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId,
    agent,
    binding,
    state,
    preview: { ...preview, outputHash, action: existingBinding ? "overwrite" : "create" },
    conflicts: [],
    replacedBindings,
    backups,
    requiresConfirmation: false,
    action: "applied"
  };
}

export function syncProjectAgentTarget(database: AppDatabase, dataDir: string, project: Project, bindingId: string): ProjectAgentApplyResult {
  const binding = database.getProjectAgentTarget(bindingId);
  if (!binding || binding.projectId !== project.id || normalizeFsPath(binding.targetRootPath) !== normalizeFsPath(project.rootPath)) {
    throw new Error("AgentHub target binding 不存在");
  }
  const agent = binding.agent ?? requireAgent(database, binding.agentId);
  const state = projectAgentTargetState(database, project, agent, binding.toolId);
  if (state.status !== "outdated") throw new Error("只有 outdated AgentHub target 可以同步");
  return applyProjectAgentTarget(database, dataDir, project, agent.id, binding.toolId, { conflictMode: "overwrite" });
}

export function syncProjectAgents(database: AppDatabase, dataDir: string, project: Project): ProjectAgentSyncResult {
  const updated: ProjectAgentApplyResult[] = [];
  const skipped: ProjectAgentSyncResult["skipped"] = [];
  for (const binding of database.listProjectAgentTargets(project.id, project.rootPath)) {
    const agent = binding.agent ?? database.getAgentHubAgent(binding.agentId);
    if (!agent) {
      skipped.push(skipFromBinding(binding, "missing", "中心 AgentHub agent 不存在"));
      continue;
    }
    const state = projectAgentTargetState(database, project, agent, binding.toolId);
    if (state.status !== "outdated") {
      if (state.status !== "current") skipped.push(skipFromBinding(binding, state.status, state.reason ?? "不是可批量同步状态"));
      continue;
    }
    updated.push(applyProjectAgentTarget(database, dataDir, project, agent.id, binding.toolId, { conflictMode: "overwrite" }));
  }
  return { projectId: project.id, targetRootPath: project.rootPath, updated, skipped };
}

export function disableProjectAgentTarget(
  database: AppDatabase,
  project: Project,
  bindingId: string,
  options: DisableOptions = {}
): ProjectAgentDisableResult {
  const binding = database.getProjectAgentTarget(bindingId);
  if (!binding || binding.projectId !== project.id || normalizeFsPath(binding.targetRootPath) !== normalizeFsPath(project.rootPath)) {
    throw new Error("AgentHub target binding 不存在");
  }
  const agent = binding.agent ?? requireAgent(database, binding.agentId);
  const state = projectAgentTargetState(database, project, agent, binding.toolId);
  const backups: ProjectLocalFileBackup[] = [];
  if (state.status === "drifted" && !options.mode) {
    return {
      projectId: project.id,
      targetRootPath: project.rootPath,
      binding,
      removed: false,
      deletedFile: false,
      backups,
      requiresConfirmation: true,
      status: state.status
    };
  }

  let deletedFile = false;
  if (state.status === "current" || state.status === "outdated" || options.mode === "delete-with-backup") {
    if (fs.existsSync(binding.outputPath)) {
      if (state.status === "drifted") {
        const backup = backupProjectLocalTarget(project.rootPath, binding.outputPath, "AgentHub", "agent");
        if (backup) backups.push(backup);
      }
      fs.unlinkSync(binding.outputPath);
      deletedFile = true;
    }
  }
  database.deleteProjectAgentTarget(binding.id);
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    binding,
    removed: true,
    deletedFile,
    backups,
    requiresConfirmation: false,
    status: state.status
  };
}

export function listProjectLocalAgents(database: AppDatabase, project: Project): ProjectLocalAgent[] {
  const items: ProjectLocalAgent[] = [];
  for (const toolId of agentHubToolIds) {
    const adapter = adapters[toolId];
    for (const filePath of localAgentFileCandidates(project.rootPath, toolId)) {
      const binding = database.getProjectAgentTargetByOutputPath(project.id, project.rootPath, toolId, filePath);
      try {
        const text = fs.readFileSync(filePath, "utf8");
        const parsed = adapter.parse(filePath, text);
        const agent = binding?.agent ?? (binding ? database.getAgentHubAgent(binding.agentId) : null);
        const status = binding && agent ? projectAgentTargetState(database, project, agent, toolId).status : "unmanaged";
        items.push({
          id: `${toolId}:${normalizeFsPath(filePath)}`,
          projectId: project.id,
          targetRootPath: project.rootPath,
          toolId,
          type: binding ? "managed" : "unmanaged",
          outputPath: filePath,
          slug: safeSlug(parsed.projection.slugCandidate || path.basename(filePath, path.extname(filePath))),
          name: parsed.projection.name,
          description: parsed.projection.description,
          status,
          binding,
          agent,
          migratable: !binding,
          reason: binding ? "该文件已由 AgentHub 管理" : null
        });
      } catch (error) {
        items.push({
          id: `${toolId}:${normalizeFsPath(filePath)}`,
          projectId: project.id,
          targetRootPath: project.rootPath,
          toolId,
          type: "invalid",
          outputPath: filePath,
          slug: path.basename(filePath, path.extname(filePath)),
          name: null,
          description: null,
          status: "invalid",
          binding,
          agent: binding?.agent ?? null,
          migratable: false,
          reason: error instanceof Error ? error.message : "Agent 文件无法解析"
        });
      }
    }
  }
  return items.sort((left, right) => left.toolId.localeCompare(right.toolId) || left.outputPath.localeCompare(right.outputPath));
}

export function migrateProjectLocalAgent(
  database: AppDatabase,
  dataDir: string,
  project: Project,
  toolId: AgentHubToolId,
  outputPath: string,
  target: ProjectLocalAgentMigrationTarget,
  options: MigrationOptions = {}
): ProjectLocalAgentMigrationResult {
  const localAgent = localAgentForPath(database, project, toolId, outputPath);
  if (localAgent.type !== "unmanaged") throw new Error("只有 unmanaged project agent 可以迁移");
  const config = ensureAgentHub(dataDir);
  const adapter = adapters[toolId];
  const filePath = displayPath(outputPath);
  const parsed = adapter.parse(filePath, fs.readFileSync(filePath, "utf8"));
  const source = resolveMigrationSource(database, target, toolId, filePath);
  const result = commitDiscoveredAgents(
    database,
    config.libraryDir,
    source,
    [
      {
        sourcePath: filePath,
        sourceRelativePath: normalizeRelativePath(path.relative(project.rootPath, filePath)),
        category: null,
        parsed,
        contentHash: hashFile(filePath)
      }
    ],
    [],
    options.conflictResolution ? { conflictResolutions: [options.conflictResolution] } : {}
  );
  if (result.requiresConfirmation) {
    return {
      projectId: project.id,
      targetRootPath: project.rootPath,
      localAgent,
      source,
      agent: null,
      binding: null,
      conflicts: result.conflicts,
      requiresConfirmation: true,
      action: "needs-confirmation"
    };
  }
  const agent = result.imported[0] ?? result.updated[0] ?? database.getAgentHubAgentBySourceSlug(source.id, localAgent.slug);
  if (!agent) throw new Error("项目 Agent 迁移失败");
  const outputHash = hashFile(filePath);
  const binding = database.upsertProjectAgentTarget({
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId,
    agentId: agent.id,
    outputPath: filePath,
    appliedSourceHash: agent.contentHash,
    appliedOutputHash: outputHash,
    appliedAt: nowIso()
  });
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    localAgent,
    source,
    agent,
    binding,
    conflicts: [],
    requiresConfirmation: false,
    action: result.updated.length ? "overwritten" : result.imported[0]?.slug === localAgent.slug ? "migrated" : "renamed"
  };
}

export function conversionPreview(agent: AgentHubAgent, targetToolId: AgentHubToolId, targetRootPath: string, action: AgentHubConversionPreview["action"]): AgentHubConversionPreview {
  const rendered = renderAgent(agent, targetToolId, targetRootPath);
  const targetPath = adapters[targetToolId].targetPath(targetRootPath, agent.slug);
  return {
    agentId: agent.id,
    targetToolId,
    targetPath,
    action,
    sourceTruthTool: agent.sourceTruthTool,
    truthRole: agent.truthRole,
    renderedSummary: summarizeRendered(agent, rendered.content),
    preservedNativeFields: rendered.preservedNativeFields,
    ignoredNativeFields: rendered.ignoredNativeFields,
    outputHash: hashText(rendered.content)
  };
}

export function renderAgentForTool(database: AppDatabase, agentId: string, targetToolId: AgentHubToolId, targetRootPath: string): RenderAgentForToolResult {
  const agent = requireAgent(database, agentId);
  const rendered = renderAgent(agent, targetToolId, targetRootPath);
  return {
    agent,
    toolId: targetToolId,
    content: rendered.content,
    preservedNativeFields: rendered.preservedNativeFields,
    ignoredNativeFields: rendered.ignoredNativeFields
  };
}

function projectAgentTargetState(database: AppDatabase, project: Project, agent: AgentHubAgent, toolId: AgentHubToolId): ProjectAgentTargetState {
  try {
    const preview = conversionPreview(agent, toolId, project.rootPath, "sync");
    const binding = database.getProjectAgentTargetByOutputPath(project.id, project.rootPath, toolId, preview.targetPath);
    if (binding && binding.agentId !== agent.id) {
      return {
        projectId: project.id,
        targetRootPath: project.rootPath,
        toolId,
        agent,
        binding: null,
        outputPath: preview.targetPath,
        status: "unmanaged",
        preview,
        reason: "同路径已由另一个 AgentHub agent 管理",
        error: null
      };
    }
    if (!binding) {
      return {
        projectId: project.id,
        targetRootPath: project.rootPath,
        toolId,
        agent,
        binding: null,
        outputPath: preview.targetPath,
        status: fs.existsSync(preview.targetPath) ? "unmanaged" : "missing",
        preview,
        reason: fs.existsSync(preview.targetPath) ? "项目存在未接管 agent 文件" : "未启用",
        error: null
      };
    }
    if (!fs.existsSync(binding.outputPath)) {
      return stateFromBinding(project, toolId, agent, binding, preview, "missing", "binding 仍存在，但项目文件已缺失");
    }
    const currentOutputHash = hashFile(binding.outputPath);
    if (currentOutputHash !== binding.appliedOutputHash) {
      return stateFromBinding(project, toolId, agent, binding, preview, "drifted", "项目文件和上次 AgentHub 生成内容不一致");
    }
    if (agent.contentHash !== binding.appliedSourceHash || preview.outputHash !== binding.appliedOutputHash) {
      return stateFromBinding(project, toolId, agent, binding, preview, "outdated", "中心 AgentHub agent 已更新");
    }
    return stateFromBinding(project, toolId, agent, binding, preview, "current", null);
  } catch (error) {
    const outputPath = adapters[toolId].targetPath(project.rootPath, agent.slug);
    return {
      projectId: project.id,
      targetRootPath: project.rootPath,
      toolId,
      agent,
      binding: database.getProjectAgentTargetByOutputPath(project.id, project.rootPath, toolId, outputPath),
      outputPath,
      status: "invalid",
      preview: null,
      reason: null,
      error: error instanceof Error ? error.message : "AgentHub 转换失败"
    };
  }
}

function stateFromBinding(
  project: Project,
  toolId: AgentHubToolId,
  agent: AgentHubAgent,
  binding: ProjectAgentTarget,
  preview: AgentHubConversionPreview,
  status: AgentHubTargetStatus,
  reason: string | null
): ProjectAgentTargetState {
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId,
    agent,
    binding,
    outputPath: binding.outputPath,
    status,
    preview,
    reason,
    error: null
  };
}

function resolveMigrationSource(database: AppDatabase, target: ProjectLocalAgentMigrationTarget, toolId: AgentHubToolId, filePath: string): AgentHubSource {
  if (target.type === "existing-source") {
    if (target.sourceId === DIRECT_MIGRATION_SOURCE_ID) {
      return database.upsertAgentHubSource({
        id: DIRECT_MIGRATION_SOURCE_ID,
        type: "local-import",
        label: "project-local-agents",
        inputPath: null,
        resolvedPath: null,
        sourceTruthTool: toolId,
        importedAt: nowIso(),
        metadata: { migrationSource: true }
      });
    }
    const source = database.getAgentHubSource(target.sourceId);
    if (!source) throw new Error("AgentHub migration source 不存在");
    if (source.type !== "local-import") throw new Error("项目本地 Agent 只能迁移到 local-import source");
    return source;
  }
  return database.upsertAgentHubSource({
    id: crypto.randomUUID(),
    type: "local-import",
    label: target.label || path.basename(path.dirname(filePath)) || "project-local-agents",
    inputPath: target.path ?? filePath,
    resolvedPath: null,
    sourceTruthTool: toolId,
    importedAt: nowIso(),
    metadata: { migrationSource: true, originalPath: filePath }
  });
}

function commitDiscoveredAgents(
  database: AppDatabase,
  libraryDir: string,
  source: AgentHubSource,
  discoveries: DiscoveredAgent[],
  skipped: AgentHubImportSkipped[],
  options: ImportOptions
): AgentHubImportResult {
  const imported: AgentHubAgent[] = [];
  const updated: AgentHubAgent[] = [];
  const conflicts: AgentHubImportConflict[] = [];
  const resolutions = new Map((options.conflictResolutions ?? []).map((resolution) => [resolution.slug, resolution]));

  for (const discovery of discoveries) {
    const baseSlug = safeSlug(discovery.parsed.projection.slugCandidate || path.basename(discovery.sourcePath, path.extname(discovery.sourcePath)));
    const existing = database.getAgentHubAgentBySourceSlug(source.id, baseSlug);
    const resolution = resolutions.get(baseSlug);
    if (existing && existing.contentHash === discovery.contentHash) {
      skipped.push({ path: discovery.sourcePath, reason: "同 slug 且内容未变化，已跳过" });
      continue;
    }
    if (existing && !resolution && !options.overwriteConflicts) {
      conflicts.push({ slug: baseSlug, incomingPath: discovery.sourcePath, existingAgent: existing, incomingHash: discovery.contentHash });
      continue;
    }
    if (existing && resolution?.action === "skip") {
      skipped.push({ path: discovery.sourcePath, reason: "用户选择跳过冲突" });
      continue;
    }

    const slug = existing && resolution?.action === "rename" ? uniqueSourceSlug(database, source.id, safeSlug(resolution.renameSlug || baseSlug)) : baseSlug;
    const targetAgent = existing && resolution?.action !== "rename" ? existing : null;
    const libraryRelativePath = targetAgent?.libraryRelativePath ?? agentLibraryRelativePath(source.id, discovery.category, slug, adapters[source.sourceTruthTool].extension);
    const nativePath = safeLibraryPath(libraryDir, libraryRelativePath);
    fs.mkdirSync(path.dirname(nativePath), { recursive: true });
    fs.copyFileSync(discovery.sourcePath, nativePath);

    const projection = { ...discovery.parsed.projection, slugCandidate: slug };
    const agent = database.upsertAgentHubAgent({
      id: targetAgent?.id ?? crypto.randomUUID(),
      sourceId: source.id,
      sourceType: source.type,
      sourceTruthTool: source.sourceTruthTool,
      truthRole: adapters[source.sourceTruthTool].truthRole,
      sourceFormat: adapters[source.sourceTruthTool].sourceFormat,
      slug,
      name: projection.name || slug,
      description: projection.description,
      nativePath,
      libraryRelativePath,
      sourceRelativePath: discovery.sourceRelativePath,
      category: discovery.category,
      projection,
      nativeMetadata: discovery.parsed.nativeMetadata,
      contentHash: discovery.contentHash,
      ...(targetAgent ? { createdAt: targetAgent.createdAt } : {})
    });
    if (targetAgent) updated.push(agent);
    else imported.push(agent);
  }

  return { source, imported, updated, skipped, conflicts, requiresConfirmation: conflicts.length > 0 };
}

function pruneStaleSourceAgents(database: AppDatabase, sourceId: string, keepRelativePaths: Set<string>): void {
  for (const agent of database.listAgentHubAgentsForSource(sourceId)) {
    if (agent.sourceRelativePath && keepRelativePaths.has(agent.sourceRelativePath)) continue;
    database.deleteAgentHubAgent(agent.id);
    fs.rmSync(agent.nativePath, { force: true });
  }
}

function discoverAgentFiles(root: string, sourceTruthTool: AgentHubToolId, options: { builtinAgency?: boolean } = {}): { discoveries: DiscoveredAgent[]; skipped: AgentHubImportSkipped[] } {
  const adapter = adapters[sourceTruthTool];
  const rootPath = displayPath(root);
  const discoveries: DiscoveredAgent[] = [];
  const skipped: AgentHubImportSkipped[] = [];

  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (options.builtinAgency && entry.name.startsWith(".")) continue;
        if (options.builtinAgency && ["examples", "integrations", "scripts", "docs"].includes(entry.name.toLowerCase())) continue;
        visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = normalizeRelativePath(path.relative(rootPath, fullPath));
      if (options.builtinAgency && shouldSkipBuiltInAgencyFile(relativePath)) {
        skipped.push({ path: fullPath, reason: "不是 agency-agents agent 文件" });
        continue;
      }
      if (!adapter.matches(fullPath)) {
        skipped.push({ path: fullPath, reason: `不匹配 ${sourceTruthTool} agent 文件格式` });
        continue;
      }
      try {
        const parsed = adapter.parse(fullPath, fs.readFileSync(fullPath, "utf8"));
        discoveries.push({
          sourcePath: fullPath,
          sourceRelativePath: relativePath,
          category: categoryFromRelativePath(relativePath),
          parsed,
          contentHash: hashFile(fullPath)
        });
      } catch (error) {
        skipped.push({ path: fullPath, reason: error instanceof Error ? error.message : "Agent 文件解析失败" });
      }
    }
  }

  visit(rootPath);
  return { discoveries, skipped };
}

function readBuiltInAgencySnapshot(sourcePath: string): BuiltInAgencySnapshot | null {
  const rootPath = displayPath(sourcePath);
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) return null;
  if (builtInAgencySnapshotCache?.sourcePath === rootPath) return builtInAgencySnapshotCache;
  const hash = crypto.createHash("sha256");
  const paths = listBuiltInAgencyAgentPaths(rootPath);
  for (const relativePath of paths) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(rootPath, relativePath)));
    hash.update("\0");
  }
  builtInAgencySnapshotCache = {
    sourcePath: rootPath,
    agentCount: paths.length,
    contentHash: hash.digest("hex")
  };
  return builtInAgencySnapshotCache;
}

function listBuiltInAgencyAgentPaths(rootPath: string): string[] {
  const output: string[] = [];

  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || ["examples", "integrations", "scripts", "docs"].includes(entry.name.toLowerCase())) continue;
        visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = normalizeRelativePath(path.relative(rootPath, fullPath));
      if (shouldSkipBuiltInAgencyFile(relativePath)) continue;
      output.push(relativePath);
    }
  }

  visit(rootPath);
  return output.sort();
}

function isBuiltInAgencySourceCurrent(source: AgentHubSource, snapshot: BuiltInAgencySnapshot): boolean {
  return source.metadata.packagedAgentCount === snapshot.agentCount && source.metadata.packagedSnapshotHash === snapshot.contentHash;
}

function shouldSkipBuiltInAgencyFile(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  if (!lower.endsWith(".md")) return true;
  if (lower === "readme.md" || lower.endsWith("/readme.md")) return true;
  if (lower.startsWith("examples/") || lower.startsWith("integrations/") || lower.startsWith("scripts/") || lower.startsWith("docs/")) return true;
  return lower.split("/").length < 2;
}

function listAgentToolTargets(database: AppDatabase, project: Project): ProjectToolTarget[] {
  return listProjectToolTargets(database, project)
    .filter((target) => target.enabled)
    .map((target) => {
      if (!isAgentHubToolId(target.toolId)) {
        return {
          ...target,
          supported: false,
          skillDirectory: null,
          reason: "尚未支持"
        };
      }
      return {
        ...target,
        supported: true,
        skillDirectory: path.dirname(adapters[target.toolId].targetPath(project.rootPath, "_agenthub")),
        reason: null,
      };
    });
}

function ensureAgentToolEnabled(database: AppDatabase, project: Project, toolId: AgentHubToolId): void {
  const target = listAgentToolTargets(database, project).find((item) => item.toolId === toolId);
  if (!target?.enabled) throw new Error("该工具未在项目中启用");
  if (!target.supported) throw new Error(target.reason ?? "尚未支持");
}

function unsupportedProjectAgentTargetState(project: Project, agent: AgentHubAgent, toolTarget: ProjectToolTarget): ProjectAgentTargetState {
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId: toolTarget.toolId,
    agent,
    binding: null,
    outputPath: "",
    status: "unsupported",
    preview: null,
    reason: toolTarget.reason ?? "尚未支持",
    error: null
  };
}

function requireAgent(database: AppDatabase, agentId: string): AgentHubAgent {
  const agent = database.getAgentHubAgent(agentId);
  if (!agent) throw new Error("AgentHub agent 不存在");
  return agent;
}

function renderAgent(agent: AgentHubAgent, targetToolId: AgentHubToolId, targetRootPath: string): RenderedAgent {
  void targetRootPath;
  const adapter = adapters[targetToolId];
  return adapter.render(agent, targetRootPath);
}

function localAgentForPath(database: AppDatabase, project: Project, toolId: AgentHubToolId, outputPath: string): ProjectLocalAgent {
  const filePath = displayPath(outputPath);
  const adapter = adapters[toolId];
  const binding = database.getProjectAgentTargetByOutputPath(project.id, project.rootPath, toolId, filePath);
  try {
    const parsed = adapter.parse(filePath, fs.readFileSync(filePath, "utf8"));
    return {
      id: `${toolId}:${normalizeFsPath(filePath)}`,
      projectId: project.id,
      targetRootPath: project.rootPath,
      toolId,
      type: binding ? "managed" : "unmanaged",
      outputPath: filePath,
      slug: safeSlug(parsed.projection.slugCandidate || path.basename(filePath, path.extname(filePath))),
      name: parsed.projection.name,
      description: parsed.projection.description,
      status: binding ? "current" : "unmanaged",
      binding,
      agent: binding?.agent ?? null,
      migratable: !binding,
      reason: binding ? "该文件已由 AgentHub 管理" : null
    };
  } catch (error) {
    return {
      id: `${toolId}:${normalizeFsPath(filePath)}`,
      projectId: project.id,
      targetRootPath: project.rootPath,
      toolId,
      type: "invalid",
      outputPath: filePath,
      slug: path.basename(filePath, path.extname(filePath)),
      name: null,
      description: null,
      status: "invalid",
      binding,
      agent: binding?.agent ?? null,
      migratable: false,
      reason: error instanceof Error ? error.message : "Agent 文件无法解析"
    };
  }
}

function localAgentFileCandidates(rootPath: string, toolId: AgentHubToolId): string[] {
  const directory =
    toolId === "claude"
      ? path.join(rootPath, ".claude", "agents")
      : toolId === "codex"
        ? path.join(rootPath, ".codex", "agents")
        : toolId === "cursor"
          ? path.join(rootPath, ".cursor", "rules")
          : toolId === "opencode"
            ? path.join(rootPath, ".opencode", "agents")
            : path.join(rootPath, ".qwen", "agents");
  if (!fs.existsSync(directory)) return [];
  const adapter = adapters[toolId];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directory, entry.name))
    .filter((filePath) => adapter.matches(filePath))
    .sort((left, right) => left.localeCompare(right));
}

function skipFromBinding(binding: ProjectAgentTarget, status: AgentHubTargetStatus, reason: string): ProjectAgentSyncResult["skipped"][number] {
  return {
    projectId: binding.projectId,
    targetRootPath: binding.targetRootPath,
    toolId: binding.toolId,
    agentId: binding.agentId,
    status,
    reason
  };
}

function markdownAdapter(input: {
  toolId: AgentHubToolId;
  label: string;
  truthRole: AgentHubTruthRole;
  extension: ".md";
  targetDir: string[];
  sameToolFields: string[];
}): AgentHubAdapter {
  return {
    toolId: input.toolId,
    label: input.label,
    sourceFormat: "markdown",
    truthRole: input.truthRole,
    extension: input.extension,
    targetPath: (rootPath, slug) => path.join(rootPath, ...input.targetDir, `${slug}.md`),
    matches: (filePath) => path.extname(filePath).toLowerCase() === ".md",
    parse: (filePath, text) => parseMarkdownAgent(filePath, text),
    render: (agent) => {
      if (agent.sourceTruthTool === input.toolId && fs.existsSync(agent.nativePath)) {
        return {
          content: fs.readFileSync(agent.nativePath, "utf8"),
          preservedNativeFields: Object.keys(agent.nativeMetadata).filter((key) => input.sameToolFields.includes(key)),
          ignoredNativeFields: []
        };
      }
      const metadata: Record<string, unknown> = {
        name: agent.name,
        ...(agent.description ? { description: agent.description } : {})
      };
      return {
        content: renderMarkdownAgent(metadata, agent.projection.body),
        preservedNativeFields: [],
        ignoredNativeFields: Object.keys(agent.nativeMetadata)
      };
    }
  };
}

function cursorAdapter(): AgentHubAdapter {
  return {
    toolId: "cursor",
    label: "Cursor",
    sourceFormat: "mdc",
    truthRole: "rule",
    extension: ".mdc",
    targetPath: (rootPath, slug) => path.join(rootPath, ".cursor", "rules", `${slug}.mdc`),
    matches: (filePath) => path.extname(filePath).toLowerCase() === ".mdc",
    parse: (filePath, text) => parseMarkdownAgent(filePath, text),
    render: (agent) => {
      if (agent.sourceTruthTool === "cursor" && fs.existsSync(agent.nativePath)) {
        return { content: fs.readFileSync(agent.nativePath, "utf8"), preservedNativeFields: Object.keys(agent.nativeMetadata), ignoredNativeFields: [] };
      }
      return {
        content: renderMarkdownAgent({ description: agent.description ?? agent.name, alwaysApply: false }, agent.projection.body),
        preservedNativeFields: [],
        ignoredNativeFields: Object.keys(agent.nativeMetadata)
      };
    }
  };
}

function codexAdapter(): AgentHubAdapter {
  return {
    toolId: "codex",
    label: "Codex",
    sourceFormat: "toml",
    truthRole: "custom-agent",
    extension: ".toml",
    targetPath: (rootPath, slug) => path.join(rootPath, ".codex", "agents", `${slug}.toml`),
    matches: (filePath) => path.extname(filePath).toLowerCase() === ".toml",
    parse: (filePath, text) => parseCodexAgent(filePath, text),
    render: (agent) => {
      if (agent.sourceTruthTool === "codex" && fs.existsSync(agent.nativePath)) {
        return { content: fs.readFileSync(agent.nativePath, "utf8"), preservedNativeFields: Object.keys(agent.nativeMetadata), ignoredNativeFields: [] };
      }
      return {
        content: renderToml({
          name: agent.name,
          description: agent.description ?? "",
          instructions: agent.projection.body
        }),
        preservedNativeFields: [],
        ignoredNativeFields: Object.keys(agent.nativeMetadata)
      };
    }
  };
}

function parseMarkdownAgent(filePath: string, text: string): ParsedNativeAgent {
  const { metadata, body } = parseFrontmatter(text);
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? null;
  const name = stringMetadata(metadata, "name") ?? stringMetadata(metadata, "title") ?? heading ?? titleFromFilename(filePath);
  const description = stringMetadata(metadata, "description") ?? null;
  return {
    projection: {
      name,
      description,
      body: stripLeadingHeading(body).trim(),
      slugCandidate: safeSlug(stringMetadata(metadata, "slug") ?? path.basename(filePath, path.extname(filePath)) ?? name),
      parseWarnings: []
    },
    nativeMetadata: metadata
  };
}

function parseCodexAgent(filePath: string, text: string): ParsedNativeAgent {
  const metadata = parseToml(text);
  const name = stringMetadata(metadata, "name") ?? stringMetadata(metadata, "title") ?? titleFromFilename(filePath);
  const description = stringMetadata(metadata, "description") ?? null;
  const body =
    stringMetadata(metadata, "instructions") ??
    stringMetadata(metadata, "developer_instructions") ??
    stringMetadata(metadata, "developer") ??
    stringMetadata(metadata, "prompt") ??
    "";
  if (!body.trim() && !description) throw new Error("Codex agent 缺少 instructions 或 description");
  return {
    projection: {
      name,
      description,
      body: body.trim(),
      slugCandidate: safeSlug(stringMetadata(metadata, "slug") ?? path.basename(filePath, ".toml") ?? name),
      parseWarnings: []
    },
    nativeMetadata: metadata
  };
}

function parseFrontmatter(text: string): { metadata: Record<string, unknown>; body: string } {
  const normalized = text.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(normalized);
  if (!match) return { metadata: {}, body: normalized };
  return { metadata: parseYamlBlock(match[1] ?? ""), body: match[2] ?? "" };
}

function parseYamlBlock(input: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const line of input.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1];
    if (!key) continue;
    metadata[key] = parseScalar(match[2] ?? "");
  }
  return metadata;
}

function renderMarkdownAgent(metadata: Record<string, unknown>, body: string): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined || value === "") continue;
    lines.push(`${key}: ${renderYamlScalar(value)}`);
  }
  lines.push("---", "", body.trim(), "");
  return lines.join("\n");
}

function parseToml(input: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const triple = /([A-Za-z0-9_-]+)\s*=\s*"""([\s\S]*?)"""/g;
  let text = input;
  for (const match of text.matchAll(triple)) {
    const key = match[1];
    if (!key) continue;
    metadata[key] = match[2] ?? "";
  }
  text = text.replace(triple, "");
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1];
    if (!key) continue;
    metadata[key] = parseScalar(match[2] ?? "");
  }
  return metadata;
}

function renderToml(metadata: Record<string, string>): string {
  return [
    `name = ${JSON.stringify(metadata.name)}`,
    `description = ${JSON.stringify(metadata.description)}`,
    "instructions = \"\"\"",
    (metadata.instructions ?? "").replace(/"""/g, '\\"\\"\\"').trim(),
    "\"\"\"",
    ""
  ].join("\n");
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return trimmed;
}

function renderYamlScalar(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(String(item))).join(", ")}]`;
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(String(value));
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stripLeadingHeading(body: string): string {
  return body.replace(/^#\s+.+\r?\n+/, "");
}

function safeSlug(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "agent";
}

function uniqueSourceSlug(database: AppDatabase, sourceId: string, desiredSlug: string): string {
  let slug = desiredSlug;
  let index = 2;
  while (database.getAgentHubAgentBySourceSlug(sourceId, slug)) {
    slug = `${desiredSlug}-${index}`;
    index += 1;
  }
  return slug;
}

function agentLibraryRelativePath(sourceId: string, category: string | null, slug: string, extension: string): string {
  return normalizeRelativePath(path.join(sourceId, category ?? "_uncategorized", `${slug}${extension}`));
}

function safeLibraryPath(libraryDir: string, relativePath: string): string {
  const fullPath = path.resolve(libraryDir, relativePath);
  const root = path.resolve(libraryDir);
  if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) throw new Error(`Refusing AgentHub path outside library: ${relativePath}`);
  return fullPath;
}

function categoryFromRelativePath(relativePath: string): string | null {
  const first = normalizeRelativePath(relativePath).split("/").filter(Boolean)[0];
  return first && !first.includes(".") ? first : null;
}

function titleFromFilename(filePath: string): string {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function summarizeRendered(agent: AgentHubAgent, content: string): string {
  const body = content.replace(/^---[\s\S]*?---\s*/, "").trim();
  const firstLine = body.split(/\r?\n/).find((line) => line.trim())?.trim() ?? agent.description ?? agent.name;
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}

function hashFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function normalizeRelativePath(input: string): string {
  return input.split(/[\\/]+/).filter(Boolean).join("/");
}

function isString(value: string | null): value is string {
  return typeof value === "string";
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

function emptyImportResult(source: AgentHubSource): AgentHubImportResult {
  return { source, imported: [], updated: [], skipped: [], conflicts: [], requiresConfirmation: false };
}
