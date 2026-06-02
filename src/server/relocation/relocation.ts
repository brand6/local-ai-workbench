import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AppConfig,
  RelocationBackup,
  RelocationChange,
  RelocationPreview,
  RelocationResult,
  SessionEntry,
  ToolId
} from "../../shared/types.js";
import { displayPath, isPathInsideOrEqual, isStrictChildPath, normalizeFsPath, rebasePath } from "../core/pathUtils.js";
import { nowIso } from "../core/time.js";
import { refreshSessionFiles } from "../scanning/sessionScanner.js";
import type { AppDatabase } from "../storage/database.js";

const TOP_LEVEL_CWD_KEYS = new Set([
  "cwd",
  "current_working_directory",
  "workingDirectory",
  "working_dir",
  "projectRoot",
  "workspaceRoot"
]);

const NESTED_SESSION_CWD_PATHS = [
  ["session_meta", "payload", "cwd"],
  ["sessionMeta", "cwd"],
  ["workspace", "cwd"],
  ["workspace", "root"]
];

interface SourceFilePlan {
  toolId: ToolId;
  sourceFile: string;
  targetFile: string;
}

interface RewriteResult {
  content: string | null;
  changedFieldCount: number;
}

interface ConfirmRelocationOptions {
  projectFilesMoved?: boolean;
}

class PreserveMoveTargetError extends Error {
  readonly preserveMoveTarget = true;
}

export function previewRelocation(database: AppDatabase, oldRoot: string, newRoot: string): RelocationPreview {
  const oldDisplay = displayPath(oldRoot);
  const newDisplay = displayPath(newRoot);
  const warnings = validateRoots(oldDisplay, newDisplay);
  const changes = database
    .listSessions()
    .filter((session): session is SessionEntry & { originalCwd: string; normalizedCwd: string } => {
      return Boolean(session.originalCwd && session.normalizedCwd && isPathInsideOrEqual(oldDisplay, session.normalizedCwd));
    })
    .map((session) => ({
      sessionId: session.id,
      toolId: session.toolId,
      nativeSessionId: session.nativeSessionId,
      title: session.title,
      sourceFile: session.sourceFile,
      oldCwd: session.originalCwd,
      newCwd: rebasePath(session.originalCwd, oldDisplay, newDisplay) ?? session.originalCwd
    }))
    .filter((change) => normalizeFsPath(change.oldCwd) !== normalizeFsPath(change.newCwd));

  const sourceFiles = [...new Set(changes.map((change) => change.sourceFile))].sort();
  return {
    oldRoot: oldDisplay,
    newRoot: newDisplay,
    affectedSessionCount: changes.length,
    affectedFileCount: sourceFiles.length,
    changes,
    sourceFiles,
    projectChanges: database.previewRelocatedProjects(oldDisplay, newDisplay),
    warnings
  };
}

export function confirmRelocation(
  database: AppDatabase,
  config: AppConfig,
  dataDir: string,
  oldRoot: string,
  newRoot: string,
  options: ConfirmRelocationOptions = {}
): RelocationResult {
  const preview = previewRelocation(database, oldRoot, newRoot);
  const sourceFilePlans = planSourceFiles(preview.changes, preview.oldRoot, preview.newRoot, options);
  const backupDir = path.join(dataDir, "backups", "relocations", safeTimestamp(nowIso()));
  const backups: RelocationBackup[] = [];
  const changedFiles: string[] = [];
  const relocatedFiles: SourceFilePlan[] = [];
  let appliedProjectRelocations: ReturnType<AppDatabase["relocateProjectRoots"]> = [];
  let changedFieldCount = 0;

  try {
    validateSourceFilePlans(sourceFilePlans);
    fs.mkdirSync(backupDir, { recursive: true });
    for (const plan of sourceFilePlans) {
      backupSourceFile(plan.sourceFile, backupDir, backups);

      const rewrite = rewriteSessionCwdFields(plan, preview.oldRoot, preview.newRoot);
      const moved = normalizeFsPath(plan.sourceFile) !== normalizeFsPath(plan.targetFile);
      if (rewrite.changedFieldCount > 0 || moved) {
        writeRelocatedSourceFile(plan, rewrite, moved, relocatedFiles);
        changedFiles.push(plan.targetFile);
        changedFieldCount += rewrite.changedFieldCount;
      }
    }

    appliedProjectRelocations = database.relocateProjectRoots(preview.projectChanges);
    const refreshResult = refreshSessionFiles(
      database,
      sourceFilePlans.map((plan) => ({ toolId: plan.toolId, sourceFile: plan.targetFile }))
    );
    return {
      ...preview,
      changedFileCount: changedFiles.length,
      changedFieldCount,
      backups,
      refreshResult,
      projectMerges: database.projectMergesFromRelocations(appliedProjectRelocations)
    };
  } catch (error) {
    removeRelocatedFiles(relocatedFiles);
    restoreBackups(backups);
    database.rollbackProjectRelocations(appliedProjectRelocations);
    throw error;
  }
}

export function relocateManagedProject(
  database: AppDatabase,
  config: AppConfig,
  dataDir: string,
  projectId: string,
  newRoot: string
): RelocationResult {
  const project = database.getProject(projectId);
  if (!project) throw new Error("project-not-found");

  const oldRoot = displayPath(project.rootPath);
  const targetRoot = displayPath(newRoot);
  const rollbackMove = moveProjectDirectory(oldRoot, targetRoot);
  try {
    return confirmRelocation(database, config, dataDir, oldRoot, targetRoot, { projectFilesMoved: true });
  } catch (error) {
    rollbackMove();
    throw error;
  }
}

function planSourceFiles(
  changes: RelocationChange[],
  oldRoot: string,
  newRoot: string,
  options: ConfirmRelocationOptions
): SourceFilePlan[] {
  const plans = new Map<string, SourceFilePlan>();
  for (const change of changes) {
    const sourceFile = currentSourceFile(change, oldRoot, newRoot, options);
    const targetFile = relocatedSourceFile(change) ?? sourceFile;
    const existing = plans.get(sourceFile);
    if (existing && normalizeFsPath(existing.targetFile) !== normalizeFsPath(targetFile)) {
      throw new Error(`Conflicting relocation targets for source file: ${sourceFile}`);
    }
    plans.set(sourceFile, { toolId: change.toolId, sourceFile, targetFile });
  }
  return [...plans.values()].sort((a, b) => a.sourceFile.localeCompare(b.sourceFile));
}

function currentSourceFile(
  change: RelocationChange,
  oldRoot: string,
  newRoot: string,
  options: ConfirmRelocationOptions
): string {
  if (!options.projectFilesMoved) return change.sourceFile;
  return rebasePath(change.sourceFile, oldRoot, newRoot) ?? change.sourceFile;
}

function moveProjectDirectory(sourceRoot: string, targetRoot: string): () => void {
  validateProjectDirectoryMove(sourceRoot, targetRoot);
  const targetExisted = fs.existsSync(targetRoot);

  try {
    if (targetExisted) {
      moveDirectoryIntoExistingEmptyTarget(sourceRoot, targetRoot);
    } else {
      moveDirectory(sourceRoot, targetRoot);
    }
  } catch (error) {
    if (!shouldPreserveMoveTarget(error)) {
      cleanupFailedMoveTarget(targetRoot, targetExisted);
    }
    throw error;
  }

  return () => {
    if (!fs.existsSync(targetRoot)) return;
    if (fs.existsSync(sourceRoot)) {
      throw new Error(`Cannot roll back project move because source path exists: ${sourceRoot}`);
    }
    moveDirectory(targetRoot, sourceRoot);
    if (targetExisted && !fs.existsSync(targetRoot)) {
      fs.mkdirSync(targetRoot, { recursive: true });
    }
  };
}

function validateProjectDirectoryMove(sourceRoot: string, targetRoot: string): void {
  if (normalizeFsPath(sourceRoot) === normalizeFsPath(targetRoot)) {
    throw new Error("project-relocation-target-same-as-source");
  }
  if (isStrictChildPath(sourceRoot, targetRoot)) {
    throw new Error("project-relocation-target-inside-source");
  }
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`project-source-path-missing: ${sourceRoot}`);
  }
  if (!fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`project-source-is-not-directory: ${sourceRoot}`);
  }

  const targetParent = path.dirname(targetRoot);
  if (!fs.existsSync(targetParent) || !fs.statSync(targetParent).isDirectory()) {
    throw new Error(`project-relocation-parent-missing: ${targetParent}`);
  }
  if (!fs.existsSync(targetRoot)) return;
  if (!fs.statSync(targetRoot).isDirectory()) {
    throw new Error(`project-relocation-target-is-not-directory: ${targetRoot}`);
  }
  if (fs.readdirSync(targetRoot).length > 0) {
    throw new Error(`project-relocation-target-not-empty: ${targetRoot}`);
  }
}

function moveDirectoryIntoExistingEmptyTarget(sourceRoot: string, targetRoot: string): void {
  fs.cpSync(sourceRoot, targetRoot, { recursive: true, errorOnExist: false, force: false });
  try {
    fs.rmSync(sourceRoot, { recursive: true, force: false });
  } catch (error) {
    throw preserveMoveTargetError(error, sourceRoot, targetRoot);
  }
}

function moveDirectory(sourceRoot: string, targetRoot: string): void {
  try {
    fs.renameSync(sourceRoot, targetRoot);
    return;
  } catch (error) {
    if (!isCrossDeviceRenameError(error)) throw error;
  }

  fs.cpSync(sourceRoot, targetRoot, { recursive: true, errorOnExist: true });
  try {
    fs.rmSync(sourceRoot, { recursive: true, force: false });
  } catch (error) {
    throw preserveMoveTargetError(error, sourceRoot, targetRoot);
  }
}

function preserveMoveTargetError(error: unknown, sourceRoot: string, targetRoot: string): PreserveMoveTargetError {
  return new PreserveMoveTargetError(
    `Project files were copied to ${targetRoot}, but removing the original path failed: ${sourceRoot}`,
    { cause: error }
  );
}

function shouldPreserveMoveTarget(error: unknown): boolean {
  return error instanceof PreserveMoveTargetError && error.preserveMoveTarget;
}

function cleanupFailedMoveTarget(targetRoot: string, targetExisted: boolean): void {
  if (fs.existsSync(targetRoot)) {
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
  if (targetExisted) {
    fs.mkdirSync(targetRoot, { recursive: true });
  }
}

function isCrossDeviceRenameError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EXDEV";
}

function relocatedSourceFile(change: RelocationChange): string | null {
  if (change.toolId === "claude") {
    const parsed = parseClaudeProjectSourceFile(change.sourceFile);
    if (!parsed) return null;
    const newSegment = encodeClaudeProjectPath(change.newCwd);
    if (parsed.projectSegment === newSegment) return null;
    return path.join(parsed.projectsRoot, newSegment, parsed.relativePath);
  }

  if (change.toolId === "qwen") {
    const parsed = parseQwenProjectSourceFile(change.sourceFile);
    if (!parsed) return null;
    const newSegment = encodeQwenProjectPath(change.newCwd);
    if (parsed.projectSegment === newSegment) return null;
    return path.join(parsed.projectsRoot, newSegment, parsed.relativePath);
  }

  return null;
}

function parseClaudeProjectSourceFile(sourceFile: string): { projectsRoot: string; projectSegment: string; relativePath: string } | null {
  const match = path.normalize(sourceFile).match(/^(.*[\\/]\.claude[\\/]projects)[\\/]([^\\/]+)[\\/](.+)$/);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return {
    projectsRoot: match[1],
    projectSegment: match[2],
    relativePath: match[3]
  };
}

function encodeClaudeProjectPath(input: string): string {
  return path.resolve(input).replace(/[:\\/]/g, "-");
}

function parseQwenProjectSourceFile(sourceFile: string): { projectsRoot: string; projectSegment: string; relativePath: string } | null {
  const match = path.normalize(sourceFile).match(/^(.*[\\/]\.qwen[\\/]projects)[\\/]([^\\/]+)[\\/](.+)$/);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return {
    projectsRoot: match[1],
    projectSegment: match[2],
    relativePath: match[3]
  };
}

function encodeQwenProjectPath(input: string): string {
  const normalized = process.platform === "win32" ? input.toLowerCase() : input;
  return normalized.replace(/[^a-zA-Z0-9]/g, "-");
}

function validateSourceFilePlans(plans: SourceFilePlan[]): void {
  const destinations = new Map<string, string>();
  for (const plan of plans) {
    const source = normalizeFsPath(plan.sourceFile);
    const target = normalizeFsPath(plan.targetFile);
    const existingSource = destinations.get(target);
    if (existingSource && normalizeFsPath(existingSource) !== source) {
      throw new Error(`Multiple source files would relocate to the same target: ${plan.targetFile}`);
    }
    destinations.set(target, plan.sourceFile);
    if (source !== target && fs.existsSync(plan.targetFile)) {
      throw new Error(`Relocation target source file already exists: ${plan.targetFile}`);
    }
  }
}

function writeRelocatedSourceFile(
  plan: SourceFilePlan,
  rewrite: RewriteResult,
  moved: boolean,
  relocatedFiles: SourceFilePlan[]
): void {
  if (!moved) {
    if (rewrite.content === null) return;
    fs.writeFileSync(plan.sourceFile, rewrite.content, "utf8");
    return;
  }

  fs.mkdirSync(path.dirname(plan.targetFile), { recursive: true });
  relocatedFiles.push(plan);
  if (rewrite.changedFieldCount > 0) {
    if (rewrite.content === null) {
      fs.renameSync(plan.sourceFile, plan.targetFile);
      return;
    }
    fs.writeFileSync(plan.targetFile, rewrite.content, "utf8");
    fs.unlinkSync(plan.sourceFile);
    return;
  }
  fs.renameSync(plan.sourceFile, plan.targetFile);
}

function validateRoots(oldRoot: string, newRoot: string): string[] {
  const warnings: string[] = [];
  if (normalizeFsPath(oldRoot) === normalizeFsPath(newRoot)) {
    warnings.push("oldRoot and newRoot resolve to the same path");
  }
  if (!fs.existsSync(newRoot)) {
    warnings.push(`newRoot does not exist: ${newRoot}`);
  }
  return warnings;
}

function rewriteSessionCwdFields(plan: SourceFilePlan, oldRoot: string, newRoot: string): RewriteResult {
  if (plan.toolId === "opencode" && path.basename(plan.sourceFile).toLowerCase() === "opencode.db") {
    return rewriteOpencodeDatabaseCwdFields(plan.sourceFile, oldRoot, newRoot);
  }

  const original = fs.readFileSync(plan.sourceFile, "utf8");
  const hadTrailingNewline = /\r?\n$/.test(original);
  const lines = original.split(/\r?\n/);
  if (hadTrailingNewline) lines.pop();

  let changedFieldCount = 0;
  const rewritten = lines.map((line) => {
    if (!line.trim()) return line;
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return line;
    const record = parsed as Record<string, unknown>;
    const directChanges = rewriteDirectCwdFields(record, oldRoot, newRoot);
    const nestedChanges = rewriteNestedCwdFields(record, oldRoot, newRoot);
    const sessionMetaChanges = rewriteSessionMetaPayloadCwd(record, oldRoot, newRoot);
    const lineChangeCount = directChanges + nestedChanges + sessionMetaChanges;
    changedFieldCount += lineChangeCount;
    return lineChangeCount > 0 ? JSON.stringify(record) : line;
  });

  return {
    content: `${rewritten.join("\n")}${hadTrailingNewline ? "\n" : ""}`,
    changedFieldCount
  };
}

function rewriteOpencodeDatabaseCwdFields(sourceFile: string, oldRoot: string, newRoot: string): RewriteResult {
  const db = new DatabaseSync(sourceFile);
  let changedFieldCount = 0;

  db.exec("BEGIN;");
  try {
    const sessionRows = db.prepare("SELECT id, directory FROM session").all();
    const updateSession = db.prepare("UPDATE session SET directory = ? WHERE id = ?");
    for (const row of sessionRows) {
      const id = stringValue(row.id);
      const current = stringValue(row.directory);
      if (!id || !current) continue;
      const next = rebasePath(current, oldRoot, newRoot);
      if (!next || normalizeFsPath(next) === normalizeFsPath(current)) continue;
      updateSession.run(next, id);
      changedFieldCount += 1;
    }

    const projectRows = db.prepare("SELECT id, worktree FROM project").all();
    const updateProject = db.prepare("UPDATE project SET worktree = ? WHERE id = ?");
    for (const row of projectRows) {
      const id = stringValue(row.id);
      const current = stringValue(row.worktree);
      if (!id || !current || current === "/") continue;
      const next = rebasePath(current, oldRoot, newRoot);
      if (!next || normalizeFsPath(next) === normalizeFsPath(current)) continue;
      updateProject.run(next, id);
      changedFieldCount += 1;
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  } finally {
    db.close();
  }

  return { content: null, changedFieldCount };
}

function rewriteDirectCwdFields(record: Record<string, unknown>, oldRoot: string, newRoot: string): number {
  let count = 0;
  for (const key of TOP_LEVEL_CWD_KEYS) {
    const current = record[key];
    if (typeof current !== "string") continue;
    const next = rebasePath(current, oldRoot, newRoot);
    if (!next || normalizeFsPath(next) === normalizeFsPath(current)) continue;
    record[key] = next;
    count += 1;
  }
  return count;
}

function rewriteNestedCwdFields(record: Record<string, unknown>, oldRoot: string, newRoot: string): number {
  let count = 0;
  for (const pathSegments of NESTED_SESSION_CWD_PATHS) {
    const parent = getParent(record, pathSegments);
    if (!parent) continue;
    const key = pathSegments[pathSegments.length - 1];
    if (!key) continue;
    const current = parent[key];
    if (typeof current !== "string") continue;
    const next = rebasePath(current, oldRoot, newRoot);
    if (!next || normalizeFsPath(next) === normalizeFsPath(current)) continue;
    parent[key] = next;
    count += 1;
  }
  return count;
}

function rewriteSessionMetaPayloadCwd(record: Record<string, unknown>, oldRoot: string, newRoot: string): number {
  if (typeof record.type !== "string" || record.type.toLowerCase() !== "session_meta") return 0;
  const payload = record.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return 0;
  const payloadRecord = payload as Record<string, unknown>;
  const current = payloadRecord.cwd;
  if (typeof current !== "string") return 0;
  const next = rebasePath(current, oldRoot, newRoot);
  if (!next || normalizeFsPath(next) === normalizeFsPath(current)) return 0;
  payloadRecord.cwd = next;
  return 1;
}

function getParent(record: Record<string, unknown>, pathSegments: string[]): Record<string, unknown> | null {
  let current: unknown = record;
  for (const segment of pathSegments.slice(0, -1)) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function backupPath(backupDir: string, sourceFile: string, index: number): string {
  const hash = crypto.createHash("sha256").update(sourceFile).digest("hex").slice(0, 12);
  return path.join(backupDir, `${String(index + 1).padStart(3, "0")}-${hash}-${path.basename(sourceFile)}`);
}

function backupSourceFile(sourceFile: string, backupDir: string, backups: RelocationBackup[]): void {
  for (const file of sourceFilesToBackup(sourceFile)) {
    const backupFile = backupPath(backupDir, file, backups.length);
    fs.copyFileSync(file, backupFile);
    backups.push({ originalFile: file, backupFile });
  }
}

function sourceFilesToBackup(sourceFile: string): string[] {
  const files = [sourceFile];
  if (path.basename(sourceFile).toLowerCase() !== "opencode.db") return files;
  for (const sidecar of [`${sourceFile}-wal`, `${sourceFile}-shm`]) {
    if (fs.existsSync(sidecar)) files.push(sidecar);
  }
  return files;
}

function restoreBackups(backups: RelocationBackup[]): void {
  for (const backup of backups) {
    if (fs.existsSync(backup.backupFile)) {
      fs.copyFileSync(backup.backupFile, backup.originalFile);
    }
  }
}

function removeRelocatedFiles(plans: SourceFilePlan[]): void {
  const seen = new Set<string>();
  for (const plan of plans) {
    const target = normalizeFsPath(plan.targetFile);
    if (seen.has(target) || normalizeFsPath(plan.sourceFile) === target) continue;
    seen.add(target);
    fs.rmSync(plan.targetFile, { force: true });
  }
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}
