import type {
  BootstrapState,
  DirectoryPickResponse,
  LaunchResponse,
  ParserWarning,
  Project,
  ProjectDetail,
  ProjectRepairCandidate,
  ProjectRepairResult,
  RefreshResult,
  RelocationPreview,
  RelocationResult,
  ScanCandidate,
  ScanDrive,
  ToolStatus
} from "../shared/types.js";

const token = window.__LOCAL_API_TOKEN__ ?? "";

export async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { "x-local-api-token": token } });
  return handle<T>(response);
}

export async function apiPost<T>(url: string, body: unknown = {}): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-local-api-token": token },
    body: JSON.stringify(body)
  });
  return handle<T>(response);
}

export async function apiPatch<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-local-api-token": token },
    body: JSON.stringify(body)
  });
  return handle<T>(response);
}

export async function apiDelete<T>(url: string): Promise<T> {
  const response = await fetch(url, { method: "DELETE", headers: { "x-local-api-token": token } });
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
  projects: () => apiGet<Project[]>("/api/projects"),
  drives: () => apiGet<ScanDrive[]>("/api/local-filesystem/drives"),
  pickDirectory: () => apiPost<DirectoryPickResponse>("/api/local-filesystem/pick-directory"),
  addProject: (rootPath: string, includeSubdirectories = false) =>
    apiPost<{ project: Project; mergedIntoParent: boolean; removedChildren: Project[] }>("/api/projects", {
      rootPath,
      includeSubdirectories
    }),
  updateProject: (id: string, includeSubdirectories: boolean) =>
    apiPatch<Project>(`/api/projects/${id}`, { includeSubdirectories }),
  removeProject: (id: string) => apiDelete<{ removed: boolean }>(`/api/projects/${id}`),
  detail: (id: string, query: string) => apiGet<ProjectDetail>(`/api/projects/${id}/detail?query=${encodeURIComponent(query)}`),
  refreshProject: (id: string) => apiPost<RefreshResult>(`/api/projects/${id}/refresh`),
  repairCandidates: (id: string) => apiGet<ProjectRepairCandidate[]>(`/api/projects/${id}/repair-candidates`),
  repairProject: (id: string, targetProjectId: string, targetRootPath?: string) =>
    apiPost<ProjectRepairResult>(`/api/projects/${id}/repair`, { targetProjectId, targetRootPath }),
  relocateProject: (id: string, newRoot: string) => apiPost<RelocationResult>(`/api/projects/${id}/relocate`, { newRoot }),
  refreshSessions: (toolIds?: string[]) => apiPost<RefreshResult>("/api/sessions/refresh", toolIds?.length ? { toolIds } : {}),
  tools: () => apiGet<ToolStatus[]>("/api/tools/status"),
  startScan: (roots: string[], scope: "directory" | "drive" | "all-fixed" = "directory") =>
    apiPost<{ scanRunId: string; candidates: ScanCandidate[] }>("/api/scan-runs", { scope, roots }),
  confirmCandidates: (scanRunId: string, candidateIds: string[], includeEmptyCandidates = false) =>
    apiPost<Project[]>(`/api/scan-runs/${scanRunId}/confirm`, { candidateIds, includeEmptyCandidates }),
  launchNew: (toolId: string, cwd: string) => apiPost<LaunchResponse>("/api/launch/new", { toolId, cwd }),
  resume: (sessionId: string) => apiPost<LaunchResponse>("/api/launch/resume", { sessionId }),
  previewRelocation: (oldRoot: string, newRoot: string) =>
    apiPost<RelocationPreview>("/api/relocations/preview", { oldRoot, newRoot }),
  confirmRelocation: (oldRoot: string, newRoot: string, confirmation: string) =>
    apiPost<RelocationResult>("/api/relocations/confirm", { oldRoot, newRoot, confirmation }),
  warnings: (projectId?: string) =>
    apiGet<ParserWarning[]>(projectId ? `/api/parser-warnings?projectId=${encodeURIComponent(projectId)}` : "/api/parser-warnings")
};
