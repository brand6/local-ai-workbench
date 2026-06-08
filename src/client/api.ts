import type {
  AgentHubApplyConflictMode,
  AgentHubDisableMode,
  AgentHubImportConflictResolution,
  AgentHubImportResult,
  AgentHubList,
  AgentHubToolId,
  AppConfig,
  BootstrapState,
  CliHubCli,
  CliHubList,
  DeleteSessionResult,
  DirectoryCreateResponse,
  DirectoryPickResponse,
  HookHubApplyMode,
  HookHubApplyResult,
  HookHubExportDocument,
  HookHubImportConflictMode,
  HookHubImportResult,
  HookHubList,
  HookHubShareResult,
  HookHubSuite,
  HookHubSuiteInput,
  HookHubSupportedToolId,
  HookHubSyncResult,
  LaunchResponse,
  McpHubCleanupReport,
  McpHubImportResult,
  McpHubList,
  McpHubTargetToolId,
  ParserWarning,
  PluginHubCustomPluginInput,
  PluginHubImportResult,
  PluginHubList,
  PluginHubPlugin,
  PluginHubPluginDeletePreview,
  PluginHubSourceDeleteMode,
  PluginHubSourceDeletePreview,
  Project,
  ProjectHookBindingRemovalResult,
  ProjectDetail,
  ProjectHookState,
  ProjectHookToolState,
  ProjectLocalMcpMigrationMode,
  ProjectLocalAgentMigrationTarget,
  ProjectLocalAgentMigrationResult,
  ProjectLocalMcpMigrationResult,
  ProjectLocalSkillMigrationMode,
  ProjectLocalSkillMigrationTarget,
  ProjectLocalSkillMigrationResult,
  ProjectLocalSkillsState,
  ProjectMcpApplyResult,
  ProjectMcpDisableResult,
  ProjectMcpState,
  ProjectAgentApplyResult,
  ProjectAgentDisableResult,
  ProjectAgentState,
  ProjectAgentSyncResult,
  ProjectPluginApplyResult,
  ProjectPluginState,
  ProjectRepairCandidate,
  ProjectSkillTargetsState,
  ProjectSkillUpdateResult,
  ProjectToolTarget,
  RefreshMode,
  ProjectRepairResult,
  RefreshResult,
  RelocationPreview,
  RelocationResult,
  RuleCreatePreview,
  RuleCreateResult,
  RuleCreateSource,
  RuleSyncDirection,
  RuleSyncCommitResult,
  RuleSyncResult,
  RuleSyncStatus,
  ScanCandidate,
  ScanDrive,
  LocalOpenResponse,
  SkillHubDeletePreview,
  SkillHubImportResult,
  SkillHubList,
  SkillHubOpenTarget,
  SkillHubSourceUpdatePreview,
  SkillHubUpdateCheckResult,
  ToolStatus
} from "../shared/types.js";

function localApiToken(): string {
  return window.__LOCAL_API_TOKEN__ ?? "";
}

function apiHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return { ...headers, "x-local-api-token": localApiToken() };
}

export async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: apiHeaders() });
  return handle<T>(response);
}

export async function apiPost<T>(url: string, body: unknown = {}): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: apiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body)
  });
  return handle<T>(response);
}

export async function apiPatch<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: apiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body)
  });
  return handle<T>(response);
}

export async function apiPut<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PUT",
    headers: apiHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body)
  });
  return handle<T>(response);
}

export async function apiDelete<T>(url: string): Promise<T> {
  const response = await fetch(url, { method: "DELETE", headers: apiHeaders() });
  return handle<T>(response);
}

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.reason ?? payload.error ?? response.statusText);
  }
  return (await response.json()) as T;
}

export const client = {
  bootstrap: () => apiGet<BootstrapState>("/api/bootstrap"),
  setDataDir: (dataDir: string) => apiPost<BootstrapState>("/api/bootstrap/data-dir", { dataDir }),
  eventsUrl: () => `/api/events?token=${encodeURIComponent(localApiToken())}`,
  config: () => apiGet<AppConfig>("/api/config"),
  updateConfig: (config: Partial<Pick<AppConfig, "terminal" | "skillhub">>) => apiPatch<AppConfig>("/api/config", config),
  skillhub: (query = "") => apiGet<SkillHubList>(`/api/skillhub${query ? `?query=${encodeURIComponent(query)}` : ""}`),
  importLocalSkill: (path: string, overwrite = false) =>
    apiPost<SkillHubImportResult>("/api/skillhub/import/local", { path, overwrite }),
  importGitHubSkill: (input: string, overwrite = false) =>
    apiPost<SkillHubImportResult>("/api/skillhub/import/github", { input, overwrite }),
  checkSkillHubUpdates: () => apiGet<SkillHubUpdateCheckResult>("/api/skillhub/updates"),
  applySkillHubUpdate: (sourceId: string, confirmDestructive = false) =>
    apiPost<SkillHubSourceUpdatePreview>(`/api/skillhub/sources/${encodeURIComponent(sourceId)}/update`, { confirmDestructive }),
  previewDeleteSkillHubSkill: (skillId: string) =>
    apiGet<SkillHubDeletePreview>(`/api/skillhub/skills/${encodeURIComponent(skillId)}/delete-preview`),
  deleteSkillHubSkill: (skillId: string) => apiDelete<SkillHubDeletePreview>(`/api/skillhub/skills/${encodeURIComponent(skillId)}`),
  openSkillHubSkill: (skillId: string, target: SkillHubOpenTarget) =>
    apiPost<LocalOpenResponse>(`/api/skillhub/skills/${encodeURIComponent(skillId)}/open`, { target }),
  agenthub: (query = "") => apiGet<AgentHubList>(`/api/agenthub${query ? `?query=${encodeURIComponent(query)}` : ""}`),
  refreshAgentHubDiscovery: (query = "") => apiPost<AgentHubList>("/api/agenthub/discovery/refresh", { query }),
  importBuiltInAgencyAgents: () => apiPost<AgentHubImportResult>("/api/agenthub/import/builtin/agency-agents"),
  importLocalAgents: (path: string, sourceTruthTool: AgentHubToolId, conflictResolutions: AgentHubImportConflictResolution[] = []) =>
    apiPost<AgentHubImportResult>("/api/agenthub/import/local", { path, sourceTruthTool, conflictResolutions }),
  openAgentHubAgent: (agentId: string, target: SkillHubOpenTarget) =>
    apiPost<LocalOpenResponse>(`/api/agenthub/agents/${encodeURIComponent(agentId)}/open`, { target }),
  reparseAgentHubAgent: (agentId: string) => apiPost(`/api/agenthub/agents/${encodeURIComponent(agentId)}/reparse`),
  deleteAgentHubAgent: (agentId: string) => apiDelete(`/api/agenthub/agents/${encodeURIComponent(agentId)}`),
  deleteAgentHubSource: (sourceId: string) => apiDelete(`/api/agenthub/sources/${encodeURIComponent(sourceId)}`),
  clihub: () => apiGet<CliHubList>("/api/clihub"),
  refreshCliHubDiscovery: (cliId?: string, includeDetails = true) => apiPost<CliHubList>("/api/clihub/discovery/refresh", { ...(cliId ? { cliId } : {}), includeDetails }),
  addCliHubLocalPath: (executablePath: string, displayName?: string, commandName?: string) =>
    apiPost<CliHubCli>("/api/clihub/custom/local-path", { executablePath, displayName, commandName }),
  addCliHubInstallCommand: (installCommand: string, displayName?: string, commandName?: string) =>
    apiPost<CliHubCli>("/api/clihub/custom/install-command", { installCommand, displayName, commandName }),
  addCliHubChannel: (cliId: string, installCommand: string) =>
    apiPost<CliHubCli>(`/api/clihub/clis/${encodeURIComponent(cliId)}/channels`, { installCommand }),
  installCliHubCli: (cliId: string, channelId?: string) =>
    apiPost<CliHubCli>(`/api/clihub/clis/${encodeURIComponent(cliId)}/install`, { ...(channelId ? { channelId } : {}) }),
  checkCliHubUpdates: () => apiPost<CliHubList>("/api/clihub/updates/check"),
  checkCliHubUpdate: (cliId: string) => apiPost<CliHubList>(`/api/clihub/clis/${encodeURIComponent(cliId)}/check-updates`),
  updateCliHubCli: (cliId: string) => apiPost<CliHubCli>(`/api/clihub/clis/${encodeURIComponent(cliId)}/update`),
  launchCliHubUpdate: (cliId: string) => apiPost<LaunchResponse>(`/api/clihub/clis/${encodeURIComponent(cliId)}/update-terminal`),
  mcphub: () => apiGet<McpHubList>("/api/mcphub"),
  importMcpHubJson: (input: string) => apiPost<McpHubImportResult>("/api/mcphub/import", { input }),
  deleteMcpHubServer: (serverId: string) => apiDelete<McpHubCleanupReport>(`/api/mcphub/servers/${encodeURIComponent(serverId)}`),
  hookhub: (query = "") => apiGet<HookHubList>(`/api/hookhub${query ? `?query=${encodeURIComponent(query)}` : ""}`),
  createHookHubSuite: (input: HookHubSuiteInput) => apiPost<HookHubSuite>("/api/hookhub/suites", input),
  updateHookHubSuite: (suiteId: string, input: Partial<HookHubSuiteInput>) =>
    apiPut<HookHubSuite>(`/api/hookhub/suites/${encodeURIComponent(suiteId)}`, input),
  deleteHookHubSuite: (suiteId: string) =>
    apiDelete<{ suiteId: string; deleted: boolean }>(`/api/hookhub/suites/${encodeURIComponent(suiteId)}`),
  exportHookHubSuite: (suiteId: string) =>
    apiGet<HookHubExportDocument>(`/api/hookhub/suites/${encodeURIComponent(suiteId)}/export`),
  syncHookHubSuite: (suiteId: string) =>
    apiPost<HookHubSyncResult>(`/api/hookhub/suites/${encodeURIComponent(suiteId)}/sync`),
  importHookHubSuite: (input: string, conflictMode?: HookHubImportConflictMode | null, renameName?: string | null) =>
    apiPost<HookHubImportResult>("/api/hookhub/import/suite", { input, conflictMode, renameName }),
  importNativeHooks: (toolId: HookHubSupportedToolId, input: string, suite: HookHubSuiteInput) =>
    apiPost<HookHubImportResult>("/api/hookhub/import/native", { ...suite, toolId, input }),
  pluginhub: () => apiGet<PluginHubList>("/api/pluginhub"),
  refreshPluginHubDiscovery: () => apiPost<PluginHubList>("/api/pluginhub/discovery/refresh", {}),
  importLocalPlugin: (path: string) => apiPost<PluginHubImportResult>("/api/pluginhub/import/local", { path }),
  importGitHubPlugin: (input: string) => apiPost<PluginHubImportResult>("/api/pluginhub/import/github", { input }),
  updatePluginHubSource: (sourceId: string) => apiPost<PluginHubImportResult>(`/api/pluginhub/sources/${encodeURIComponent(sourceId)}/update`, {}),
  createCustomPlugin: (input: PluginHubCustomPluginInput) => apiPost<PluginHubPlugin>("/api/pluginhub/custom", input),
  updateCustomPlugin: (pluginId: string, input: PluginHubCustomPluginInput) =>
    apiPut<PluginHubPlugin>(`/api/pluginhub/custom/${encodeURIComponent(pluginId)}`, input),
  previewDeletePluginHubSource: (sourceId: string) =>
    apiGet<PluginHubSourceDeletePreview>(`/api/pluginhub/sources/${encodeURIComponent(sourceId)}/delete-preview`),
  deletePluginHubSource: (sourceId: string, mode: PluginHubSourceDeleteMode) =>
    apiDelete<PluginHubSourceDeletePreview>(`/api/pluginhub/sources/${encodeURIComponent(sourceId)}?mode=${encodeURIComponent(mode)}`),
  previewDeletePluginHubPlugin: (pluginId: string) =>
    apiGet<PluginHubPluginDeletePreview>(`/api/pluginhub/plugins/${encodeURIComponent(pluginId)}/delete-preview`),
  openPluginHubPrivateFile: (pluginId: string, fileId: string, target: SkillHubOpenTarget) =>
    apiPost<LocalOpenResponse>(`/api/pluginhub/plugins/${encodeURIComponent(pluginId)}/private-files/${encodeURIComponent(fileId)}/open`, { target }),
  deletePluginHubPlugin: (pluginId: string) => apiDelete<PluginHubPluginDeletePreview>(`/api/pluginhub/plugins/${encodeURIComponent(pluginId)}`),
  projects: () => apiGet<Project[]>("/api/projects"),
  drives: () => apiGet<ScanDrive[]>("/api/local-filesystem/drives"),
  pickDirectory: () => apiPost<DirectoryPickResponse>("/api/local-filesystem/pick-directory"),
  createDirectory: (parentPath: string, directoryName: string) =>
    apiPost<DirectoryCreateResponse>("/api/local-filesystem/create-directory", { parentPath, directoryName }),
  addProject: (rootPath: string, includeSubdirectories = false, toolIds?: string[]) =>
    apiPost<{ project: Project; mergedIntoParent: boolean; removedChildren: Project[] }>("/api/projects", {
      rootPath,
      includeSubdirectories,
      ...(toolIds ? { toolIds } : {})
    }),
  updateProject: (id: string, includeSubdirectories: boolean) =>
    apiPatch<Project>(`/api/projects/${id}`, { includeSubdirectories }),
  removeProject: (id: string) => apiDelete<{ removed: boolean }>(`/api/projects/${id}`),
  detail: (id: string, query: string) => apiGet<ProjectDetail>(`/api/projects/${id}/detail?query=${encodeURIComponent(query)}`),
  detailSummary: (id: string, query: string) => apiGet<ProjectDetail>(`/api/projects/${id}/detail?query=${encodeURIComponent(query)}&includeSessions=false`),
  refreshProject: (id: string) => apiPost<RefreshResult>(`/api/projects/${id}/refresh`),
  projectToolTargets: (id: string) => apiGet<ProjectToolTarget[]>(`/api/projects/${id}/tool-targets`),
  updateProjectToolTargets: (id: string, toolIds: string[]) => apiPatch<ProjectToolTarget[]>(`/api/projects/${id}/tool-targets`, { toolIds }),
  projectSkillTargets: (id: string, targetRootPath?: string) =>
    apiGet<ProjectSkillTargetsState>(`/api/projects/${id}/skill-targets${projectTargetQuery(targetRootPath)}`),
  updateProjectSkillTargets: (id: string, skillId: string, toolIds: string[], replaceConflicts = false, targetRootPath?: string) =>
    apiPut<ProjectSkillUpdateResult>(`/api/projects/${id}/skill-targets/${encodeURIComponent(skillId)}`, {
      toolIds,
      replaceConflicts,
      ...(targetRootPath ? { targetRootPath } : {})
    }),
  projectLocalSkills: (id: string, targetRootPath?: string) =>
    apiGet<ProjectLocalSkillsState>(`/api/projects/${id}/local-skills${projectTargetQuery(targetRootPath)}`),
  migrateProjectLocalSkill: (
    id: string,
    toolId: string,
    folderName: string,
    mode: ProjectLocalSkillMigrationMode | null = null,
    targetRootPath?: string,
    target?: ProjectLocalSkillMigrationTarget | null
  ) =>
    apiPost<ProjectLocalSkillMigrationResult>(`/api/projects/${id}/local-skills/migrate`, {
      toolId,
      folderName,
      mode,
      ...(targetRootPath ? { targetRootPath } : {}),
      ...(target ? { target } : {})
    }),
  projectAgents: (id: string, targetRootPath?: string, query = "") =>
    apiGet<ProjectAgentState>(`/api/projects/${id}/agents${projectTargetQuery(targetRootPath, query)}`),
  projectLocalAgents: (id: string, targetRootPath?: string) =>
    apiGet<ProjectAgentState>(`/api/projects/${id}/local-agents${projectTargetQuery(targetRootPath)}`),
  applyProjectAgent: (id: string, agentId: string, toolId: AgentHubToolId, targetRootPath?: string, conflictMode?: AgentHubApplyConflictMode | null) =>
    apiPut<ProjectAgentApplyResult>(`/api/projects/${id}/agent-targets/${encodeURIComponent(agentId)}/${encodeURIComponent(toolId)}`, {
      conflictMode,
      ...(targetRootPath ? { targetRootPath } : {})
    }),
  syncProjectAgent: (id: string, bindingId: string, targetRootPath?: string) =>
    apiPost<ProjectAgentApplyResult>(`/api/projects/${id}/agent-bindings/${encodeURIComponent(bindingId)}/sync`, {
      ...(targetRootPath ? { targetRootPath } : {})
    }),
  syncProjectAgents: (id: string, targetRootPath?: string) =>
    apiPost<ProjectAgentSyncResult>(`/api/projects/${id}/agents/sync`, {
      ...(targetRootPath ? { targetRootPath } : {})
    }),
  disableProjectAgent: (id: string, bindingId: string, targetRootPath?: string, mode?: AgentHubDisableMode | null) => {
    const params = new URLSearchParams();
    if (targetRootPath) params.set("targetRootPath", targetRootPath);
    if (mode) params.set("mode", mode);
    const query = params.toString();
    return apiDelete<ProjectAgentDisableResult>(`/api/projects/${id}/agent-bindings/${encodeURIComponent(bindingId)}${query ? `?${query}` : ""}`);
  },
  migrateProjectLocalAgent: (
    id: string,
    toolId: AgentHubToolId,
    outputPath: string,
    target: ProjectLocalAgentMigrationTarget,
    targetRootPath?: string,
    conflictResolution?: AgentHubImportConflictResolution | null
  ) =>
    apiPost<ProjectLocalAgentMigrationResult>(`/api/projects/${id}/local-agents/migrate`, {
      toolId,
      outputPath,
      target,
      conflictResolution,
      ...(targetRootPath ? { targetRootPath } : {})
    }),
  projectPlugins: (id: string, targetRootPath?: string) =>
    apiGet<ProjectPluginState>(`/api/projects/${id}/plugins${projectTargetQuery(targetRootPath)}`),
  installProjectPlugin: (id: string, pluginId: string, toolId: string, targetRootPath?: string, conflictMode?: "overwrite" | "skip" | null) =>
    apiPut<ProjectPluginApplyResult>(`/api/projects/${id}/plugins/${encodeURIComponent(pluginId)}`, {
      toolId,
      conflictMode,
      ...(targetRootPath ? { targetRootPath } : {})
    }),
  syncProjectPlugin: (id: string, bindingId: string, targetRootPath?: string, conflictMode?: "overwrite" | "skip" | null) =>
    apiPost<ProjectPluginApplyResult>(`/api/projects/${id}/plugin-bindings/${encodeURIComponent(bindingId)}/sync`, {
      conflictMode,
      ...(targetRootPath ? { targetRootPath } : {})
    }),
  uninstallProjectPlugin: (id: string, bindingId: string, targetRootPath?: string) =>
    apiDelete<ProjectPluginApplyResult>(`/api/projects/${id}/plugin-bindings/${encodeURIComponent(bindingId)}${projectTargetQuery(targetRootPath)}`),
  projectMcp: (id: string, targetRootPath?: string) =>
    apiGet<ProjectMcpState>(`/api/projects/${id}/mcp${projectTargetQuery(targetRootPath)}`),
  applyProjectMcp: (id: string, serverId: string, toolId: McpHubTargetToolId, targetRootPath?: string) =>
    apiPut<ProjectMcpApplyResult>(`/api/projects/${id}/mcp-bindings/${encodeURIComponent(serverId)}/${encodeURIComponent(toolId)}`, {
      ...(targetRootPath ? { targetRootPath } : {})
    }),
  disableProjectMcp: (id: string, serverId: string, toolId: McpHubTargetToolId, targetRootPath?: string) =>
    apiDelete<ProjectMcpDisableResult>(
      `/api/projects/${id}/mcp-bindings/${encodeURIComponent(serverId)}/${encodeURIComponent(toolId)}${projectTargetQuery(targetRootPath)}`
    ),
  migrateProjectLocalMcp: (id: string, serverId: string, mode: ProjectLocalMcpMigrationMode | null = null, targetRootPath?: string) =>
    apiPost<ProjectLocalMcpMigrationResult>(`/api/projects/${id}/local-mcp/migrate`, {
      serverId,
      mode,
      ...(targetRootPath ? { targetRootPath } : {})
    }),
  projectHooks: (id: string, targetRootPath?: string, query = "") =>
    apiGet<ProjectHookState>(`/api/projects/${id}/hooks${projectTargetQuery(targetRootPath, query)}`),
  writeProjectHooks: (id: string, toolId: HookHubSupportedToolId, hooks: unknown, input: Partial<HookHubSuiteInput> = {}, targetRootPath?: string) =>
    apiPut<HookHubApplyResult | ProjectHookToolState>(`/api/projects/${id}/hooks/${encodeURIComponent(toolId)}`, {
      hooks,
      ...input,
      ...(targetRootPath ? { targetRootPath } : {})
    }),
  shareProjectHooks: (id: string, toolId: HookHubSupportedToolId, input: HookHubSuiteInput, targetRootPath?: string) =>
    apiPost<HookHubShareResult>(`/api/projects/${id}/hooks/${encodeURIComponent(toolId)}/share`, {
      ...input,
      ...(targetRootPath ? { targetRootPath } : {})
    }),
  applyHookHubSuite: (
    id: string,
    toolId: HookHubSupportedToolId,
    suiteId: string,
    targetRootPath?: string,
    options: { mode?: HookHubApplyMode | null; preserveName?: string | null; description?: string | null; riskNotes?: string | null; requiredEnv?: string[] } = {}
  ) =>
    apiPut<HookHubApplyResult>(`/api/projects/${id}/hooks/${encodeURIComponent(toolId)}/apply/${encodeURIComponent(suiteId)}`, {
      ...options,
      ...(targetRootPath ? { targetRootPath } : {})
    }),
  syncProjectHookTool: (id: string, toolId: HookHubSupportedToolId, targetRootPath?: string) =>
    apiPost<HookHubApplyResult>(`/api/projects/${id}/hooks/${encodeURIComponent(toolId)}/sync`, {
      ...(targetRootPath ? { targetRootPath } : {})
    }),
  removeProjectHookBinding: (id: string, toolId: HookHubSupportedToolId, targetRootPath?: string) =>
    apiDelete<ProjectHookBindingRemovalResult>(`/api/projects/${id}/hooks/${encodeURIComponent(toolId)}/binding${projectTargetQuery(targetRootPath)}`),
  syncProjectHooks: (id: string, targetRootPath?: string) =>
    apiPost<HookHubSyncResult>(`/api/projects/${id}/hooks/sync`, {
      ...(targetRootPath ? { targetRootPath } : {})
    }),
  ruleSyncStatus: (id: string) => apiGet<RuleSyncStatus>(`/api/projects/${id}/rule-sync/status`),
  prepareRuleFileCreate: (id: string, file: RuleSyncStatus["files"][keyof RuleSyncStatus["files"]]["file"], source: RuleCreateSource) =>
    apiPost<RuleCreatePreview>(`/api/projects/${id}/rule-sync/create-preview`, { file, source }),
  createRuleFile: (id: string, file: RuleSyncStatus["files"][keyof RuleSyncStatus["files"]]["file"], content: string) =>
    apiPost<RuleCreateResult>(`/api/projects/${id}/rule-sync/create`, { file, content }),
  createRuleTemplateFile: (id: string) => apiPost<RuleCreateResult>(`/api/projects/${id}/rule-sync/template`),
  openRuleFile: (id: string, file: RuleSyncStatus["files"][keyof RuleSyncStatus["files"]]["file"]) =>
    apiPost<LocalOpenResponse>(`/api/projects/${id}/rule-sync/open`, { file }),
  applyRuleSync: (id: string, direction: RuleSyncDirection, options: { confirmGitInit?: boolean; confirmDirectOverwrite?: boolean } = {}) =>
    apiPost<RuleSyncResult>(`/api/projects/${id}/rule-sync/apply`, { direction, ...options }),
  commitRuleSync: (id: string, direction: RuleSyncDirection) =>
    apiPost<RuleSyncCommitResult>(`/api/projects/${id}/rule-sync/commit`, { direction }),
  repairCandidates: (id: string) => apiGet<ProjectRepairCandidate[]>(`/api/projects/${id}/repair-candidates`),
  repairProject: (id: string, targetProjectId: string, targetRootPath?: string) =>
    apiPost<ProjectRepairResult>(`/api/projects/${id}/repair`, { targetProjectId, targetRootPath }),
  relocateProject: (id: string, newRoot: string) => apiPost<RelocationResult>(`/api/projects/${id}/relocate`, { newRoot }),
  refreshSessions: (toolIds?: string[], mode: RefreshMode = "incremental") =>
    apiPost<RefreshResult>("/api/sessions/refresh", { mode, ...(toolIds?.length ? { toolIds } : {}) }),
  deleteSession: (sessionId: string) => apiDelete<DeleteSessionResult>(`/api/sessions/${encodeURIComponent(sessionId)}`),
  tools: () => apiGet<ToolStatus[]>("/api/tools/status"),
  startScan: (roots: string[], scope: "directory" | "drive" | "all-fixed" = "directory") =>
    apiPost<{ scanRunId: string; candidates: ScanCandidate[] }>("/api/scan-runs", { scope, roots }),
  confirmCandidates: (scanRunId: string, candidateIds: string[], includeEmptyCandidates = false) =>
    apiPost<Project[]>(`/api/scan-runs/${scanRunId}/confirm`, { candidateIds, includeEmptyCandidates }),
  launchNew: (toolId: string, cwd: string, projectRootPath?: string) => apiPost<LaunchResponse>("/api/launch/new", { toolId, cwd, projectRootPath }),
  resume: (sessionId: string) => apiPost<LaunchResponse>("/api/launch/resume", { sessionId }),
  previewRelocation: (oldRoot: string, newRoot: string) =>
    apiPost<RelocationPreview>("/api/relocations/preview", { oldRoot, newRoot }),
  confirmRelocation: (oldRoot: string, newRoot: string, confirmation: string) =>
    apiPost<RelocationResult>("/api/relocations/confirm", { oldRoot, newRoot, confirmation }),
  warnings: (projectId?: string) =>
    apiGet<ParserWarning[]>(projectId ? `/api/parser-warnings?projectId=${encodeURIComponent(projectId)}` : "/api/parser-warnings")
};

function projectTargetQuery(targetRootPath?: string, query?: string): string {
  const params = new URLSearchParams();
  if (targetRootPath) params.set("targetRootPath", targetRootPath);
  if (query) params.set("query", query);
  const text = params.toString();
  return text ? `?${text}` : "";
}
