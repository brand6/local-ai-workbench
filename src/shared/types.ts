export type ToolId = "codex" | "claude" | "opencode" | "qwen" | "qoder" | "copilot";

export type ResumeStatus =
  | "ready"
  | "missing_session_id"
  | "missing_cwd"
  | "cwd_missing"
  | "tool_unavailable"
  | "unknown";

export interface BootstrapState {
  initialized: boolean;
  dataDir: string | null;
  defaultDataDir: string;
  overriddenByArg: boolean;
}

export interface AppConfig {
  version: 1;
  tools: Record<ToolId, { command: string; sessionSources?: string[] }>;
  terminal: { mode: "new-window" | "per-tool" | "per-project" };
}

export interface Project {
  id: string;
  rootPath: string;
  normalizedRootPath: string;
  includeSubdirectories: boolean;
  sessionOnly: boolean;
  createdAt: string;
  updatedAt: string;
  childGroupCount: number;
  sessionCount: number;
}

export interface SessionEntry {
  id: string;
  toolId: ToolId;
  nativeSessionId: string | null;
  title: string;
  summary: string | null;
  originalCwd: string | null;
  normalizedCwd: string | null;
  updatedAt: string;
  sourceFile: string;
  sourceFormat: string;
  parserVersion: string;
  resumeStatus: ResumeStatus;
  indexedAt: string;
}

export interface ToolStatus {
  toolId: ToolId;
  command: string;
  available: boolean;
  supported: boolean;
  visibleInProjectUi: boolean;
  capabilities: {
    launchNew: boolean;
    scanHistory: boolean;
    resume: boolean;
  };
  reason: string | null;
  sessionSources: string[];
}

export interface ParserWarning {
  id: string;
  scanRunId: string | null;
  toolId: ToolId | null;
  sourceFile: string | null;
  errorType: string;
  message: string;
  line: number | null;
  createdAt: string;
}

export interface ScanRun {
  id: string;
  scope: string;
  roots: string[];
  status: "running" | "completed" | "failed";
  indexedCount: number;
  skippedCount: number;
  warningCount: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface ScanCandidate {
  id: string;
  scanRunId: string;
  path: string;
  normalizedPath: string;
  detectedTools: ToolId[];
  sessionCounts: Partial<Record<ToolId, number>>;
  childCandidates: string[];
  createdAt: string;
}

export interface ScanDrive {
  root: string;
  label: string;
}

export interface DirectoryPickResponse {
  path: string | null;
  cancelled: boolean;
}

export interface ProjectDetailGroup {
  key: string;
  label: string;
  fullPath: string;
  isRoot: boolean;
  latestActivity: string | null;
  sessionCount: number;
  tools: ProjectDetailToolGroup[];
}

export interface ProjectDetailToolGroup {
  toolId: ToolId;
  sessionCount: number;
  latestActivity: string | null;
  sessions: SessionEntry[];
}

export interface ProjectDetail {
  project: Project;
  groups: ProjectDetailGroup[];
}

export interface LaunchCommand {
  command: string;
  args: string[];
  cwd: string;
}

export interface LaunchRequest {
  toolId: ToolId;
  cwd: string;
}

export interface ResumeRequest {
  sessionId: string;
}

export interface LaunchResponse {
  launched: boolean;
  command: LaunchCommand;
  host: "windows-terminal" | "powershell" | "direct";
  reason: string | null;
}

export interface RefreshResult {
  scanRun: ScanRun;
  indexedCount: number;
  skippedCount: number;
  warningCount: number;
  addedProjectCount?: number;
}

export interface RelocationChange {
  sessionId: string;
  toolId: ToolId;
  nativeSessionId: string | null;
  title: string;
  sourceFile: string;
  oldCwd: string;
  newCwd: string;
}

export interface RelocationProjectChange {
  projectId: string;
  oldRootPath: string;
  newRootPath: string;
}

export interface RelocationProjectMerge {
  sourceProjectId: string;
  targetProjectId: string;
  targetRootPath: string;
}

export interface RelocationBackup {
  originalFile: string;
  backupFile: string;
}

export interface RelocationPreview {
  oldRoot: string;
  newRoot: string;
  affectedSessionCount: number;
  affectedFileCount: number;
  changes: RelocationChange[];
  sourceFiles: string[];
  projectChanges: RelocationProjectChange[];
  warnings: string[];
}

export interface RelocationResult extends RelocationPreview {
  changedFileCount: number;
  changedFieldCount: number;
  backups: RelocationBackup[];
  refreshResult: RefreshResult;
  projectMerges: RelocationProjectMerge[];
}

export interface ProjectRepairCandidate {
  projectId: string;
  rootPath: string;
  targetRootPath?: string;
  score: number;
  reasons: string[];
  sessionCount: number;
}

export interface ProjectRepairResult {
  sourceProjectId: string;
  targetProjectId: string;
  targetRootPath: string;
  relocation: RelocationResult;
}
