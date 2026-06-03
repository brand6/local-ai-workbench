export type ToolId = "codex" | "claude" | "opencode" | "qwen" | "qoder" | "copilot";
export type RefreshMode = "incremental" | "full";
export const terminalModes = ["new-window", "per-tool", "per-project"] as const;
export type TerminalMode = (typeof terminalModes)[number];

export function isTerminalMode(value: unknown): value is TerminalMode {
  return terminalModes.includes(value as TerminalMode);
}

export type ResumeStatus =
  | "ready"
  | "missing_session_id"
  | "missing_cwd"
  | "cwd_missing"
  | "source_mismatch"
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
  terminal: { mode: TerminalMode };
  skillhub: { rootDir: string };
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

export type SkillHubSourceType = "local" | "github";

export interface SkillHubConfig {
  rootDir: string;
  libraryDir: string;
}

export interface SkillHubSource {
  id: string;
  type: SkillHubSourceType;
  label: string;
  repoKey: string | null;
  owner: string | null;
  repo: string | null;
  branch: string | null;
  input: string;
  inputPath: string | null;
  resolvedPath: string | null;
  currentRevision: string | null;
  checkoutPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillHubSkill {
  id: string;
  sourceId: string;
  sourceType: SkillHubSourceType;
  folderName: string;
  skillName: string | null;
  description: string | null;
  libraryRelativePath: string;
  libraryPath: string;
  sourceRelativePath: string | null;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  source: SkillHubSource | null;
}

export interface SkillHubList {
  config: SkillHubConfig;
  skills: SkillHubSkill[];
  sources: SkillHubSource[];
}

export interface SkillHubImportSkipped {
  path: string;
  reason: string;
}

export interface SkillHubImportConflict {
  existingSkill: SkillHubSkill;
  incoming: {
    folderName: string;
    libraryRelativePath: string;
    sourceRelativePath: string | null;
    path: string;
  };
}

export interface SkillHubImportResult {
  source: SkillHubSource;
  imported: SkillHubSkill[];
  updated: SkillHubSkill[];
  skipped: SkillHubImportSkipped[];
  conflicts: SkillHubImportConflict[];
  requiresConfirmation: boolean;
}

export interface ProjectToolTarget {
  projectId: string;
  toolId: ToolId;
  enabled: boolean;
  inferred: boolean;
  supported: boolean;
  skillDirectory: string | null;
  reason: string | null;
  updatedAt: string;
}

export interface ProjectSkillTarget {
  projectId: string;
  toolId: ToolId;
  skillId: string;
  linkPath: string;
  targetPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSkillConflict {
  toolId: ToolId;
  linkPath: string;
  existingSkill: SkillHubSkill | null;
  requestedSkill: SkillHubSkill;
}

export interface ProjectSkillLinkFailure {
  projectId: string;
  toolId: ToolId;
  skillId: string;
  linkPath: string;
  targetPath: string;
  reason: string;
}

export interface ProjectSkillTargetsState {
  projectId: string;
  toolTargets: ProjectToolTarget[];
  skillTargets: ProjectSkillTarget[];
  skills: SkillHubSkill[];
}

export interface ProjectSkillUpdateResult {
  projectId: string;
  skillId: string;
  targets: ProjectSkillTarget[];
  removed: ProjectSkillTarget[];
  conflicts: ProjectSkillConflict[];
  failures: ProjectSkillLinkFailure[];
  requiresConfirmation: boolean;
}

export type SkillHubUpdateKind = "added" | "changed" | "deleted" | "moved";

export interface SkillHubUpdateItem {
  kind: SkillHubUpdateKind;
  skillId: string | null;
  folderName: string;
  skillName: string | null;
  libraryRelativePath: string;
  previousSourceRelativePath: string | null;
  nextSourceRelativePath: string | null;
  destructive: boolean;
  affectedTargets: ProjectSkillTarget[];
}

export interface SkillHubSourceUpdatePreview {
  source: SkillHubSource;
  items: SkillHubUpdateItem[];
  hasUpdates: boolean;
  destructive: boolean;
  checkedAt: string;
}

export interface SkillHubUpdateCheckResult {
  previews: SkillHubSourceUpdatePreview[];
}

export interface SkillHubDeletePreview {
  skill: SkillHubSkill;
  affectedTargets: ProjectSkillTarget[];
  brokenTargets: ProjectSkillTarget[];
}

export type SkillHubOpenTarget = "document" | "folder";

export interface LocalOpenResponse {
  opened: boolean;
  path: string;
}

export type RuleFileName = "AGENTS.md" | "CLAUDE.md";
export type RuleSyncDirection = "agents-to-claude" | "claude-to-agents";

export interface RuleFileStatus {
  file: RuleFileName;
  path: string;
  exists: boolean;
  mtime: string | null;
  gitManaged: boolean | null;
  dirty: boolean | null;
}

export interface RuleSyncStatus {
  projectId: string;
  projectRoot: string;
  gitAvailable: boolean;
  gitRoot: string | null;
  files: Record<RuleFileName, RuleFileStatus>;
  directions: Record<RuleSyncDirection, { enabled: boolean; reason: string | null }>;
}

export interface RuleSyncResult {
  projectId: string;
  projectRoot: string;
  direction: RuleSyncDirection;
  sourceFile: RuleFileName;
  targetFile: RuleFileName;
  action: "written" | "overwritten" | "noop" | "needs-confirmation";
  backupCommit: string | null;
  message: string;
  status: RuleSyncStatus;
}

export interface RuleSyncCommitResult {
  projectId: string;
  projectRoot: string;
  direction: RuleSyncDirection;
  targetFile: RuleFileName;
  action: "committed" | "noop";
  backupCommit: string | null;
  message: string;
  status: RuleSyncStatus;
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

export interface DirectoryCreateResponse {
  path: string;
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
  projectRootPath?: string;
}

export interface ResumeRequest {
  sessionId: string;
}

export interface DeleteSessionResult {
  deleted: boolean;
  sessionId: string;
  sourceFile: string;
  sourceFormat: string;
  deletedSourceFile: boolean;
  deletedNativeSession: boolean;
  removedIndexCount: number;
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
  removedSessionCount?: number;
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
