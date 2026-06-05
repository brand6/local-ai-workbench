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

export type CliHubCliKind = "project-tool" | "function" | "dependency" | "custom";
export type CliHubSourceType = "builtin" | "custom";
export type CliHubSourceState = "builtin" | "local-path" | "install-command";
export type CliHubProvider = "npm" | "github-release" | "winget" | "choco" | "scoop" | "installer-command" | "local-path";
export type CliHubProviderConfidence = "high" | "low";
export type CliHubAvailabilityState = "unknown" | "available" | "unavailable";
export type CliHubVersionState = "unknown" | "detected" | "failed";
export type CliHubUpdateStatus = "unknown" | "up-to-date" | "update-available";
export type CliHubOperationKind = "install" | "update-check" | "update" | "discovery";
export type CliHubOperationStatus = "success" | "failed";

export interface CliHubProviderRef {
  provider: CliHubProvider;
  packageId: string | null;
  confidence: CliHubProviderConfidence;
  reason: string;
}

export interface CliHubChannel {
  channelId: string;
  provider: Exclude<CliHubProvider, "local-path">;
  label: string;
  packageId: string | null;
  installCommand: string[] | null;
  updateCommand: string[] | null;
  checkCommand: string[] | null;
  appManaged: boolean;
  metadata: Record<string, string>;
  builtin: boolean;
}

export interface CliHubOperationResult {
  kind: CliHubOperationKind;
  status: CliHubOperationStatus;
  provider: CliHubProvider | null;
  startedAt: string;
  completedAt: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  message: string;
}

export interface CliHubCli {
  cliId: string;
  displayName: string;
  kind: CliHubCliKind;
  sourceType: CliHubSourceType;
  sourceState: CliHubSourceState;
  commandNames: string[];
  localPath: string | null;
  channels: CliHubChannel[];
  availabilityState: CliHubAvailabilityState;
  resolvedPaths: string[];
  version: string | null;
  versionState: CliHubVersionState;
  versionError: string | null;
  discoveredAt: string | null;
  currentProvider: CliHubProviderRef | null;
  providerCandidates: CliHubProviderRef[];
  updateStatus: CliHubUpdateStatus;
  updateCheckedAt: string | null;
  updateError: string | null;
  recentOperation: CliHubOperationResult | null;
  createdAt: string;
  updatedAt: string;
}

export interface CliHubRunningOperation {
  kind: CliHubOperationKind;
  cliId: string;
  cliDisplayName: string;
  startedAt: string;
}

export interface CliHubList {
  clis: CliHubCli[];
  operation: CliHubRunningOperation | null;
}

export interface CliHubCustomLocalPathInput {
  displayName?: string | null;
  commandName?: string | null;
  executablePath: string;
}

export interface CliHubCustomInstallCommandInput {
  displayName?: string | null;
  commandName?: string | null;
  installCommand: string;
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

export type ProjectLocalSkillType = "skillhub" | "local";
export type ProjectLocalSkillMigrationMode = "overwrite-skillhub" | "link-existing";
export type ProjectLocalSkillMigrationAction = "migrated" | "overwrote-skillhub" | "linked-existing" | "needs-confirmation";
export type ProjectLocalSkillMigrationTarget =
  | { type: "existing-source"; sourceId: string }
  | { type: "new-source"; path: string; label?: string | null };

export interface ProjectLocalSkill {
  projectId: string;
  toolId: ToolId;
  type: ProjectLocalSkillType;
  folderName: string;
  skillName: string | null;
  description: string | null;
  skillPath: string;
  skillHubSkill: SkillHubSkill | null;
  migratable: boolean;
  reason: string | null;
}

export interface ProjectLocalSkillsState {
  projectId: string;
  toolTargets: ProjectToolTarget[];
  migrationSources: SkillHubSource[];
  skills: ProjectLocalSkill[];
}

export interface ProjectLocalSkillMigrationResult {
  projectId: string;
  localSkill: ProjectLocalSkill;
  skill: SkillHubSkill | null;
  linkedTarget: ProjectSkillTarget | null;
  conflictSkills: SkillHubSkill[];
  requiresConfirmation: boolean;
  action: ProjectLocalSkillMigrationAction;
}

export type McpHubTransport = "stdio" | "http";
export type McpHubTargetToolId = Extract<ToolId, "claude" | "codex" | "opencode">;

export interface McpHubServer {
  serverId: string;
  name: string | null;
  description: string | null;
  transport: McpHubTransport;
  command: string | null;
  args: string[];
  url: string | null;
  headers: Record<string, string>;
  env: Record<string, string>;
  requiredEnv: string[];
  builtin?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface McpHubList {
  servers: McpHubServer[];
}

export interface McpHubImportFailure {
  serverId: string | null;
  reason: string;
}

export interface McpHubImportResult {
  added: McpHubServer[];
  updated: McpHubServer[];
  patched: McpHubServer[];
  failed: McpHubImportFailure[];
}

export interface ProjectMcpBinding {
  projectId: string;
  targetRootPath: string;
  toolId: McpHubTargetToolId;
  serverId: string;
  appliedServerId: string;
  appliedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type ProjectLocalMcpStatus = "managed" | "unmanaged" | "invalid";

export interface ProjectLocalMcpEntry {
  projectId: string;
  targetRootPath: string;
  toolId: McpHubTargetToolId;
  serverId: string;
  filePath: string;
  status: ProjectLocalMcpStatus;
  server: McpHubServer | null;
  reason: string | null;
}

export interface ProjectMcpTarget {
  toolId: McpHubTargetToolId;
  label: string;
  enabled: boolean;
  inferred: boolean;
  supported: boolean;
  configPath: string;
  reason: string | null;
  updatedAt: string;
}

export interface ProjectMcpState {
  projectId: string;
  targetRootPath: string;
  targets: ProjectMcpTarget[];
  servers: McpHubServer[];
  bindings: ProjectMcpBinding[];
  localEntries: ProjectLocalMcpEntry[];
}

export interface ProjectMcpApplyResult {
  projectId: string;
  targetRootPath: string;
  toolId: McpHubTargetToolId;
  server: McpHubServer;
  binding: ProjectMcpBinding;
  configPath: string;
  warnings: string[];
}

export interface ProjectMcpDisableResult {
  projectId: string;
  targetRootPath: string;
  toolId: McpHubTargetToolId;
  serverId: string;
  removedBinding: boolean;
  modified: boolean;
  configPath: string;
  reason: string | null;
}

export interface McpHubCleanupReport {
  serverId: string;
  deleted: boolean;
  bindingsRemoved: ProjectMcpBinding[];
  modifiedFiles: string[];
  skippedMissingFiles: string[];
  failures: Array<{ path: string; reason: string }>;
}

export type ProjectLocalMcpMigrationMode = "link-existing" | "overwrite-mcphub";
export type ProjectLocalMcpMigrationAction = "migrated" | "linked-existing" | "overwrote-mcphub" | "needs-confirmation";

export interface ProjectLocalMcpMigrationResult {
  projectId: string;
  targetRootPath: string;
  serverId: string;
  action: ProjectLocalMcpMigrationAction;
  server: McpHubServer | null;
  bindings: ProjectMcpBinding[];
  conflictTargets: McpHubTargetToolId[];
  requiresConfirmation: boolean;
  message: string | null;
}

export type HookHubSupportedToolId = Extract<ToolId, "claude" | "codex" | "qwen" | "qoder">;
export type HookHubDiscoveryToolId = Extract<ToolId, "claude" | "codex" | "qwen" | "qoder" | "opencode" | "copilot">;
export type HookHubProjectStatus = "current" | "outdated" | "drifted" | "missing" | "unmanaged" | "invalid" | "unsupported";
export type HookHubScope = "project";
export type HookHubApplyMode = "overwrite" | "upload-then-overwrite" | "update-bound-suite-then-overwrite" | "save-as-new-suite-then-overwrite";
export type HookHubImportConflictMode = "overwrite" | "rename" | "cancel";

export interface HookHubSuite {
  suiteId: string;
  name: string;
  description: string | null;
  riskNotes: string | null;
  requiredEnv: string[];
  payloads: Partial<Record<HookHubSupportedToolId, unknown>>;
  toolIds: HookHubSupportedToolId[];
  createdAt: string;
  updatedAt: string;
}

export interface HookHubList {
  suites: HookHubSuite[];
}

export interface HookHubSuiteInput {
  name: string;
  description?: string | null;
  riskNotes?: string | null;
  requiredEnv?: string[];
  payloads?: Partial<Record<HookHubSupportedToolId, unknown>>;
}

export interface ProjectHookBinding {
  projectId: string;
  targetRootPath: string;
  toolId: HookHubSupportedToolId;
  suiteId: string;
  configPath: string;
  scope: HookHubScope;
  appliedFingerprint: string;
  appliedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectHookToolState {
  projectId: string;
  targetRootPath: string;
  toolId: HookHubDiscoveryToolId;
  label: string;
  supported: boolean;
  configPath: string | null;
  scope: HookHubScope | null;
  status: HookHubProjectStatus;
  hooks: unknown | null;
  hooksSummary: string;
  reason: string | null;
  error: string | null;
  binding: ProjectHookBinding | null;
  suite: HookHubSuite | null;
  discovery: string[];
}

export interface ProjectHookState {
  projectId: string;
  targetRootPath: string;
  tools: ProjectHookToolState[];
  suites: HookHubSuite[];
}

export interface ProjectHookBindingRemovalResult {
  projectId: string;
  targetRootPath: string;
  toolId: HookHubSupportedToolId;
  removed: boolean;
  state: ProjectHookToolState;
}

export interface HookHubBackupResult {
  mode: "git-clean" | "git-commit" | "local-backup" | "missing";
  backupPath: string | null;
  metadataPath: string | null;
  commit: string | null;
  message: string;
}

export interface HookHubApplyResult {
  projectId: string;
  targetRootPath: string;
  toolId: HookHubSupportedToolId;
  suite: HookHubSuite;
  binding: ProjectHookBinding;
  configPath: string;
  status: HookHubProjectStatus;
  backup: HookHubBackupResult;
  warnings: string[];
}

export interface HookHubShareResult {
  suite: HookHubSuite;
  sourceToolId: HookHubSupportedToolId;
  sourceConfigPath: string;
}

export interface HookHubSyncSkipped {
  projectId: string;
  targetRootPath: string;
  toolId: HookHubSupportedToolId;
  status: HookHubProjectStatus;
  reason: string;
}

export interface HookHubSyncResult {
  suiteId: string | null;
  projectId: string | null;
  updated: HookHubApplyResult[];
  skipped: HookHubSyncSkipped[];
}

export interface HookHubExportDocument {
  format: "hookhub-suite-v1";
  suite: HookHubSuite;
}

export interface HookHubImportResult {
  action: "created" | "overwritten" | "renamed" | "needs-confirmation" | "cancelled";
  suite: HookHubSuite | null;
  conflict: HookHubSuite | null;
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
  failures: ProjectSkillLinkFailure[];
}

export type SkillHubOpenTarget = "document" | "folder";

export interface LocalOpenResponse {
  opened: boolean;
  path: string;
}

export type RuleFileName = "AGENTS.md" | "CLAUDE.md";
export type RuleSyncDirection = "agents-to-claude" | "claude-to-agents";
export type RuleCreateSource = "sync" | "template";

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

export interface RuleCreatePreview {
  projectId: string;
  projectRoot: string;
  file: RuleFileName;
  path: string;
  source: RuleCreateSource;
  sourceFile: RuleFileName | null;
  content: string;
  message: string;
}

export interface RuleCreateResult {
  projectId: string;
  projectRoot: string;
  file: RuleFileName;
  path: string;
  action: "created";
  message: string;
  status: RuleSyncStatus;
}

export type RuleTemplateResult = RuleCreateResult;

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
