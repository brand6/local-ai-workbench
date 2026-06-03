import type {
  AppConfig,
  BootstrapState,
  DeleteSessionResult,
  DirectoryCreateResponse,
  DirectoryPickResponse,
  LaunchResponse,
  ParserWarning,
  Project,
  ProjectDetail,
  ProjectRepairCandidate,
  ProjectSkillTargetsState,
  ProjectSkillUpdateResult,
  ProjectToolTarget,
  RefreshMode,
  ProjectRepairResult,
  RefreshResult,
  RelocationPreview,
  RelocationResult,
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
  refreshProject: (id: string) => apiPost<RefreshResult>(`/api/projects/${id}/refresh`),
  projectToolTargets: (id: string) => apiGet<ProjectToolTarget[]>(`/api/projects/${id}/tool-targets`),
  updateProjectToolTargets: (id: string, toolIds: string[]) => apiPatch<ProjectToolTarget[]>(`/api/projects/${id}/tool-targets`, { toolIds }),
  projectSkillTargets: (id: string) => apiGet<ProjectSkillTargetsState>(`/api/projects/${id}/skill-targets`),
  updateProjectSkillTargets: (id: string, skillId: string, toolIds: string[], replaceConflicts = false) =>
    apiPut<ProjectSkillUpdateResult>(`/api/projects/${id}/skill-targets/${encodeURIComponent(skillId)}`, { toolIds, replaceConflicts }),
  ruleSyncStatus: (id: string) => apiGet<RuleSyncStatus>(`/api/projects/${id}/rule-sync/status`),
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
