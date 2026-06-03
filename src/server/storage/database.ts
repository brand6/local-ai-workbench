import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ParserWarning,
  Project,
  ProjectSkillTarget,
  ProjectToolTarget,
  RelocationProjectMerge,
  RelocationProjectChange,
  ScanCandidate,
  ScanRun,
  SessionEntry,
  SkillHubSkill,
  SkillHubSource,
  SkillHubSourceType,
  ToolId
} from "../../shared/types.js";
import { json, parseJson } from "../core/json.js";
import { candidateSortKey, isPathInsideOrEqual, isStrictChildPath, normalizeFsPath, rebasePath, relativeLabel } from "../core/pathUtils.js";
import { nowIso } from "../core/time.js";

type Row = Record<string, unknown>;

export interface AppDatabaseOptions {
  busyTimeoutMs?: number;
}

export interface AppliedProjectRelocation {
  projectId: string;
  oldRootPath: string;
  newRootPath: string;
  mode: "updated" | "merged";
  targetProjectId: string | null;
  sourceProject: Project;
  targetProjectBefore: Project | null;
}

export class AppDatabase {
  private db: DatabaseSync;

  constructor(private readonly dataDir: string, options: AppDatabaseOptions = {}) {
    const busyTimeoutMs = options.busyTimeoutMs ?? 5000;
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "index.sqlite"));
    try {
      this.db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec("PRAGMA foreign_keys = ON;");
      this.migrate();
      this.normalizeProjectHierarchy();
    } catch (error) {
      this.db.close();
      if (isSqliteLockedError(error)) {
        throw new Error(
          `Database is locked: ${path.join(dataDir, "index.sqlite")}. ` +
            "Another github-repo-manager process is probably using this data directory. " +
            "Stop the existing process or start with --data-dir <different-directory>.",
          { cause: error }
        );
      }
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_metadata (
        tool_id TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        parser_version TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        normalized_root_path TEXT NOT NULL UNIQUE,
        include_subdirectories INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        tool_id TEXT NOT NULL,
        native_session_id TEXT,
        title TEXT NOT NULL,
        summary TEXT,
        original_cwd TEXT,
        normalized_cwd TEXT,
        updated_at TEXT NOT NULL,
        source_file TEXT NOT NULL,
        source_format TEXT NOT NULL,
        parser_version TEXT NOT NULL,
        resume_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(normalized_cwd);
      CREATE INDEX IF NOT EXISTS idx_sessions_tool ON sessions(tool_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);

      CREATE TABLE IF NOT EXISTS scan_runs (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        roots_json TEXT NOT NULL,
        status TEXT NOT NULL,
        indexed_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS scan_candidates (
        id TEXT PRIMARY KEY,
        scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        normalized_path TEXT NOT NULL,
        detected_tools_json TEXT NOT NULL,
        session_counts_json TEXT NOT NULL,
        child_candidates_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scan_candidates_run ON scan_candidates(scan_run_id);
      CREATE INDEX IF NOT EXISTS idx_scan_candidates_path ON scan_candidates(normalized_path);

      CREATE TABLE IF NOT EXISTS parser_warnings (
        id TEXT PRIMARY KEY,
        scan_run_id TEXT,
        tool_id TEXT,
        source_file TEXT,
        error_type TEXT NOT NULL,
        message TEXT NOT NULL,
        line INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skillhub_sources (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        repo_key TEXT,
        owner TEXT,
        repo TEXT,
        branch TEXT,
        input TEXT NOT NULL,
        input_path TEXT,
        resolved_path TEXT,
        current_revision TEXT,
        checkout_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_skillhub_sources_repo_key
        ON skillhub_sources(repo_key)
        WHERE repo_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS skillhub_skills (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES skillhub_sources(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        folder_name TEXT NOT NULL,
        skill_name TEXT,
        description TEXT,
        library_relative_path TEXT NOT NULL UNIQUE,
        library_path TEXT NOT NULL,
        source_relative_path TEXT,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_skillhub_skills_source ON skillhub_skills(source_id);
      CREATE INDEX IF NOT EXISTS idx_skillhub_skills_folder ON skillhub_skills(folder_name);

      CREATE TABLE IF NOT EXISTS project_tool_targets (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        tool_id TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        inferred INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, tool_id)
      );

      CREATE TABLE IF NOT EXISTS project_skill_targets (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        tool_id TEXT NOT NULL,
        skill_id TEXT NOT NULL REFERENCES skillhub_skills(id) ON DELETE CASCADE,
        link_path TEXT NOT NULL,
        target_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, tool_id, skill_id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_project_skill_targets_link
        ON project_skill_targets(project_id, tool_id, link_path);

      CREATE INDEX IF NOT EXISTS idx_project_skill_targets_skill
        ON project_skill_targets(skill_id);
    `);

    this.db.prepare("INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)").run("schema_version", "1");
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare("INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)")
      .run(key, json(value), nowIso());
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = ?").get(key);
    return parseJson(String(row?.value_json ?? ""), fallback);
  }

  listProjects(): Project[] {
    const rows = this.db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all();
    const sessions = this.listSessions();
    return rows
      .map((row) => {
        const project = this.projectFromRow(row, sessions);
        return {
          project,
          latestSessionAt: latestSessionActivityForProject(project.normalizedRootPath, sessions)
        };
      })
      .sort((a, b) => {
        return (
          compareNullableIsoDescNullsLast(a.latestSessionAt, b.latestSessionAt) ||
          compareIsoDesc(a.project.updatedAt, b.project.updatedAt) ||
          a.project.rootPath.localeCompare(b.project.rootPath)
        );
      })
      .map((entry) => entry.project);
  }

  listSkillHubSources(): SkillHubSource[] {
    return this.db
      .prepare("SELECT * FROM skillhub_sources ORDER BY type ASC, label ASC, updated_at DESC")
      .all()
      .map((row) => this.skillHubSourceFromRow(row));
  }

  getSkillHubSource(id: string): SkillHubSource | null {
    const row = this.db.prepare("SELECT * FROM skillhub_sources WHERE id = ?").get(id);
    return row ? this.skillHubSourceFromRow(row) : null;
  }

  getSkillHubSourceByRepoKey(repoKey: string): SkillHubSource | null {
    const row = this.db.prepare("SELECT * FROM skillhub_sources WHERE repo_key = ?").get(repoKey);
    return row ? this.skillHubSourceFromRow(row) : null;
  }

  upsertSkillHubSource(input: Omit<SkillHubSource, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): SkillHubSource {
    const existing = this.getSkillHubSource(input.id);
    const timestamp = nowIso();
    const createdAt = input.createdAt ?? existing?.createdAt ?? timestamp;
    const updatedAt = input.updatedAt ?? timestamp;
    this.db
      .prepare(
        `INSERT INTO skillhub_sources (
          id, type, label, repo_key, owner, repo, branch, input, input_path, resolved_path,
          current_revision, checkout_path, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          label = excluded.label,
          repo_key = excluded.repo_key,
          owner = excluded.owner,
          repo = excluded.repo,
          branch = excluded.branch,
          input = excluded.input,
          input_path = excluded.input_path,
          resolved_path = excluded.resolved_path,
          current_revision = excluded.current_revision,
          checkout_path = excluded.checkout_path,
          updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.type,
        input.label,
        input.repoKey,
        input.owner,
        input.repo,
        input.branch,
        input.input,
        input.inputPath,
        input.resolvedPath,
        input.currentRevision,
        input.checkoutPath,
        createdAt,
        updatedAt
      );
    const source = this.getSkillHubSource(input.id);
    if (!source) throw new Error("Failed to upsert SkillHub source");
    return source;
  }

  listSkillHubSkills(query = ""): SkillHubSkill[] {
    const sources = new Map(this.listSkillHubSources().map((source) => [source.id, source]));
    const normalizedQuery = query.trim().toLowerCase();
    return this.db
      .prepare("SELECT * FROM skillhub_skills ORDER BY library_relative_path ASC")
      .all()
      .map((row) => this.skillHubSkillFromRow(row, sources))
      .filter((skill) => {
        if (!normalizedQuery) return true;
        return [
          skill.folderName,
          skill.skillName ?? "",
          skill.description ?? "",
          skill.libraryRelativePath,
          skill.source?.label ?? "",
          skill.source?.repoKey ?? ""
        ]
          .join("\n")
          .toLowerCase()
          .includes(normalizedQuery);
      });
  }

  listSkillHubSkillsForSource(sourceId: string): SkillHubSkill[] {
    const sources = new Map(this.listSkillHubSources().map((source) => [source.id, source]));
    return this.db
      .prepare("SELECT * FROM skillhub_skills WHERE source_id = ? ORDER BY library_relative_path ASC")
      .all(sourceId)
      .map((row) => this.skillHubSkillFromRow(row, sources));
  }

  getSkillHubSkill(id: string): SkillHubSkill | null {
    const sources = new Map(this.listSkillHubSources().map((source) => [source.id, source]));
    const row = this.db.prepare("SELECT * FROM skillhub_skills WHERE id = ?").get(id);
    return row ? this.skillHubSkillFromRow(row, sources) : null;
  }

  getSkillHubSkillByLibraryRelativePath(libraryRelativePath: string): SkillHubSkill | null {
    const sources = new Map(this.listSkillHubSources().map((source) => [source.id, source]));
    const row = this.db.prepare("SELECT * FROM skillhub_skills WHERE library_relative_path = ?").get(libraryRelativePath);
    return row ? this.skillHubSkillFromRow(row, sources) : null;
  }

  upsertSkillHubSkill(input: Omit<SkillHubSkill, "source" | "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): SkillHubSkill {
    const existing = this.getSkillHubSkill(input.id);
    const timestamp = nowIso();
    const createdAt = input.createdAt ?? existing?.createdAt ?? timestamp;
    const updatedAt = input.updatedAt ?? timestamp;
    this.db
      .prepare(
        `INSERT INTO skillhub_skills (
          id, source_id, source_type, folder_name, skill_name, description, library_relative_path,
          library_path, source_relative_path, content_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source_id = excluded.source_id,
          source_type = excluded.source_type,
          folder_name = excluded.folder_name,
          skill_name = excluded.skill_name,
          description = excluded.description,
          library_relative_path = excluded.library_relative_path,
          library_path = excluded.library_path,
          source_relative_path = excluded.source_relative_path,
          content_hash = excluded.content_hash,
          updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.sourceId,
        input.sourceType,
        input.folderName,
        input.skillName,
        input.description,
        input.libraryRelativePath,
        input.libraryPath,
        input.sourceRelativePath,
        input.contentHash,
        createdAt,
        updatedAt
      );
    const skill = this.getSkillHubSkill(input.id);
    if (!skill) throw new Error("Failed to upsert SkillHub skill");
    return skill;
  }

  deleteSkillHubSkill(skillId: string): boolean {
    const result = this.db.prepare("DELETE FROM skillhub_skills WHERE id = ?").run(skillId);
    return Number(result.changes) > 0;
  }

  listStoredProjectToolTargets(projectId: string): Array<Pick<ProjectToolTarget, "projectId" | "toolId" | "enabled" | "inferred" | "updatedAt">> {
    return this.db
      .prepare("SELECT * FROM project_tool_targets WHERE project_id = ? ORDER BY tool_id ASC")
      .all(projectId)
      .map((row) => ({
        projectId: String(row.project_id),
        toolId: String(row.tool_id) as ToolId,
        enabled: Boolean(row.enabled),
        inferred: Boolean(row.inferred),
        updatedAt: String(row.updated_at)
      }));
  }

  upsertProjectToolTarget(projectId: string, toolId: ToolId, enabled: boolean, inferred: boolean): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO project_tool_targets (project_id, tool_id, enabled, inferred, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(projectId, toolId, enabled ? 1 : 0, inferred ? 1 : 0, nowIso());
  }

  replaceProjectToolTargets(projectId: string, toolIds: ToolId[]): void {
    const selected = new Set(toolIds);
    this.db.exec("BEGIN;");
    try {
      for (const toolId of ["codex", "claude", "opencode", "qwen", "qoder", "copilot"] satisfies ToolId[]) {
        this.upsertProjectToolTarget(projectId, toolId, selected.has(toolId), false);
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  listProjectSkillTargets(projectId?: string): ProjectSkillTarget[] {
    const rows = projectId
      ? this.db.prepare("SELECT * FROM project_skill_targets WHERE project_id = ? ORDER BY tool_id ASC, link_path ASC").all(projectId)
      : this.db.prepare("SELECT * FROM project_skill_targets ORDER BY project_id ASC, tool_id ASC, link_path ASC").all();
    return rows.map((row) => this.projectSkillTargetFromRow(row));
  }

  listProjectSkillTargetsForSkill(skillId: string): ProjectSkillTarget[] {
    return this.db
      .prepare("SELECT * FROM project_skill_targets WHERE skill_id = ? ORDER BY project_id ASC, tool_id ASC")
      .all(skillId)
      .map((row) => this.projectSkillTargetFromRow(row));
  }

  getProjectSkillTargetByLinkPath(projectId: string, toolId: ToolId, linkPath: string): ProjectSkillTarget | null {
    const row = this.db
      .prepare("SELECT * FROM project_skill_targets WHERE project_id = ? AND tool_id = ? AND link_path = ?")
      .get(projectId, toolId, linkPath);
    return row ? this.projectSkillTargetFromRow(row) : null;
  }

  upsertProjectSkillTarget(input: Omit<ProjectSkillTarget, "createdAt" | "updatedAt">): ProjectSkillTarget {
    const existing = this.db
      .prepare("SELECT created_at FROM project_skill_targets WHERE project_id = ? AND tool_id = ? AND skill_id = ?")
      .get(input.projectId, input.toolId, input.skillId);
    const timestamp = nowIso();
    const createdAt = String(existing?.created_at ?? timestamp);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO project_skill_targets (
          project_id, tool_id, skill_id, link_path, target_path, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(input.projectId, input.toolId, input.skillId, input.linkPath, input.targetPath, createdAt, timestamp);
    const stored = this.db
      .prepare("SELECT * FROM project_skill_targets WHERE project_id = ? AND tool_id = ? AND skill_id = ?")
      .get(input.projectId, input.toolId, input.skillId);
    if (!stored) throw new Error("Failed to upsert project skill target");
    return this.projectSkillTargetFromRow(stored);
  }

  deleteProjectSkillTarget(projectId: string, toolId: ToolId, skillId: string): ProjectSkillTarget | null {
    const row = this.db
      .prepare("SELECT * FROM project_skill_targets WHERE project_id = ? AND tool_id = ? AND skill_id = ?")
      .get(projectId, toolId, skillId);
    if (!row) return null;
    this.db
      .prepare("DELETE FROM project_skill_targets WHERE project_id = ? AND tool_id = ? AND skill_id = ?")
      .run(projectId, toolId, skillId);
    return this.projectSkillTargetFromRow(row);
  }

  deleteProjectSkillTargetByLinkPath(projectId: string, toolId: ToolId, linkPath: string): ProjectSkillTarget | null {
    const row = this.db
      .prepare("SELECT * FROM project_skill_targets WHERE project_id = ? AND tool_id = ? AND link_path = ?")
      .get(projectId, toolId, linkPath);
    if (!row) return null;
    this.db
      .prepare("DELETE FROM project_skill_targets WHERE project_id = ? AND tool_id = ? AND link_path = ?")
      .run(projectId, toolId, linkPath);
    return this.projectSkillTargetFromRow(row);
  }

  deleteProjectSkillTargetsForSkill(skillId: string): ProjectSkillTarget[] {
    const targets = this.listProjectSkillTargetsForSkill(skillId);
    this.db.prepare("DELETE FROM project_skill_targets WHERE skill_id = ?").run(skillId);
    return targets;
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return row ? this.projectFromRow(row) : null;
  }

  getProjectByNormalizedPath(normalizedPath: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE normalized_root_path = ?").get(normalizedPath);
    return row ? this.projectFromRow(row) : null;
  }

  addProject(rootPath: string, includeSubdirectories = false): { project: Project; mergedIntoParent: boolean; removedChildren: Project[] } {
    const normalized = normalizeFsPath(rootPath);
    const existing = this.getProjectByNormalizedPath(normalized);
    if (existing) {
      return { project: existing, mergedIntoParent: false, removedChildren: [] };
    }

    const projects = this.listProjects();
    const parent = projects
      .filter((project) => isStrictChildPath(project.normalizedRootPath, normalized))
      .sort((a, b) => candidateSortKey(b.normalizedRootPath) - candidateSortKey(a.normalizedRootPath))[0];

    if (parent) {
      this.updateProject(parent.id, { includeSubdirectories: true });
      const updatedParent = this.getProject(parent.id);
      if (!updatedParent) throw new Error("Parent project disappeared during update");
      return { project: updatedParent, mergedIntoParent: true, removedChildren: [] };
    }

    const children = projects.filter((project) => isStrictChildPath(normalized, project.normalizedRootPath));
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO projects (id, root_path, normalized_root_path, include_subdirectories, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, rootPath, normalized, includeSubdirectories || children.length > 0 ? 1 : 0, timestamp, timestamp);

    for (const child of children) {
      this.db.prepare("DELETE FROM projects WHERE id = ?").run(child.id);
    }

    const project = this.getProject(id);
    if (!project) throw new Error("Failed to create project");
    return { project, mergedIntoParent: false, removedChildren: children };
  }

  updateProject(id: string, fields: { includeSubdirectories?: boolean }): Project | null {
    const project = this.getProject(id);
    if (!project) return null;
    const include = fields.includeSubdirectories ?? project.includeSubdirectories;
    this.db
      .prepare("UPDATE projects SET include_subdirectories = ?, updated_at = ? WHERE id = ?")
      .run(include ? 1 : 0, nowIso(), id);
    return this.getProject(id);
  }

  removeProject(id: string): boolean {
    const result = this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    return result.changes > 0;
  }

  addSessionProjectsForTools(toolIds: ToolId[] = []): number {
    const selectedTools = toolIds.length > 0 ? new Set<ToolId>(toolIds) : null;
    const sessionProjects = new Map<string, string>();

    for (const session of this.listSessions()) {
      if (!session.originalCwd || !session.normalizedCwd) continue;
      if (selectedTools && !selectedTools.has(session.toolId)) continue;
      if (!sessionProjects.has(session.normalizedCwd)) {
        sessionProjects.set(session.normalizedCwd, session.originalCwd);
      }
    }

    let addedCount = 0;
    const candidates = [...sessionProjects.entries()].sort((a, b) => {
      return candidateSortKey(a[0]) - candidateSortKey(b[0]) || a[0].localeCompare(b[0]);
    });

    for (const [normalizedCwd, originalCwd] of candidates) {
      if (this.getProjectByNormalizedPath(normalizedCwd)) continue;
      const result = this.addProject(originalCwd);
      if (result.mergedIntoParent || result.project.normalizedRootPath === normalizedCwd) {
        addedCount += 1;
      }
    }

    return addedCount;
  }

  previewRelocatedProjects(oldRoot: string, newRoot: string): RelocationProjectChange[] {
    return this.listProjects()
      .map((project) => {
        const newRootPath = rebaseProjectPath(project.rootPath, oldRoot, newRoot);
        if (!newRootPath) return null;
        return { projectId: project.id, oldRootPath: project.rootPath, newRootPath };
      })
      .filter((change): change is RelocationProjectChange => Boolean(change));
  }

  relocateProjectRoots(changes: RelocationProjectChange[]): AppliedProjectRelocation[] {
    const timestamp = nowIso();
    const applied: AppliedProjectRelocation[] = [];
    for (const change of changes) {
      const sourceProject = this.getProject(change.projectId);
      if (!sourceProject) continue;
      const targetNormalized = normalizeFsPath(change.newRootPath);
      const targetProject = this.getProjectByNormalizedPath(targetNormalized);
      const containingTargetProject = targetProject
        ? null
        : this.listProjects()
            .filter((project) => project.id !== sourceProject.id)
            .filter((project) => isStrictChildPath(project.normalizedRootPath, targetNormalized))
            .sort((a, b) => candidateSortKey(b.normalizedRootPath) - candidateSortKey(a.normalizedRootPath))[0];

      if (targetProject && targetProject.id !== sourceProject.id) {
        this.db
          .prepare("UPDATE projects SET include_subdirectories = ?, updated_at = ? WHERE id = ?")
          .run(sourceProject.includeSubdirectories || targetProject.includeSubdirectories ? 1 : 0, timestamp, targetProject.id);
        this.db.prepare("DELETE FROM projects WHERE id = ?").run(sourceProject.id);
        applied.push({
          projectId: sourceProject.id,
          oldRootPath: change.oldRootPath,
          newRootPath: change.newRootPath,
          mode: "merged",
          targetProjectId: targetProject.id,
          sourceProject,
          targetProjectBefore: targetProject
        });
        continue;
      }

      if (containingTargetProject) {
        this.db.prepare("UPDATE projects SET include_subdirectories = ?, updated_at = ? WHERE id = ?").run(1, timestamp, containingTargetProject.id);
        this.db.prepare("DELETE FROM projects WHERE id = ?").run(sourceProject.id);
        applied.push({
          projectId: sourceProject.id,
          oldRootPath: change.oldRootPath,
          newRootPath: change.newRootPath,
          mode: "merged",
          targetProjectId: containingTargetProject.id,
          sourceProject,
          targetProjectBefore: containingTargetProject
        });
        continue;
      }

      this.db
        .prepare("UPDATE projects SET root_path = ?, normalized_root_path = ?, updated_at = ? WHERE id = ?")
        .run(change.newRootPath, targetNormalized, timestamp, change.projectId);
      applied.push({
        projectId: sourceProject.id,
        oldRootPath: change.oldRootPath,
        newRootPath: change.newRootPath,
        mode: "updated",
        targetProjectId: null,
        sourceProject,
        targetProjectBefore: null
      });
    }
    return applied;
  }

  rollbackProjectRelocations(applied: AppliedProjectRelocation[]): void {
    for (const relocation of [...applied].reverse()) {
      if (relocation.mode === "updated") {
        this.restoreProject(relocation.sourceProject);
        continue;
      }

      if (relocation.targetProjectBefore) {
        this.restoreProject(relocation.targetProjectBefore);
      }
      this.restoreProject(relocation.sourceProject);
    }
  }

  projectMergesFromRelocations(applied: AppliedProjectRelocation[]): RelocationProjectMerge[] {
    return applied
      .filter((relocation): relocation is AppliedProjectRelocation & { targetProjectId: string } => {
        return relocation.mode === "merged" && Boolean(relocation.targetProjectId);
      })
      .map((relocation) => ({
        sourceProjectId: relocation.projectId,
        targetProjectId: relocation.targetProjectId,
        targetRootPath: relocation.newRootPath
      }));
  }

  upsertSession(entry: SessionEntry): void {
    const existing = this.db.prepare("SELECT created_at FROM sessions WHERE id = ?").get(entry.id);
    const createdAt = String(existing?.created_at ?? nowIso());
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sessions (
          id, tool_id, native_session_id, title, summary, original_cwd, normalized_cwd, updated_at,
          source_file, source_format, parser_version, resume_status, created_at, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.toolId,
        entry.nativeSessionId,
        entry.title,
        entry.summary,
        entry.originalCwd,
        entry.normalizedCwd,
        entry.updatedAt,
        entry.sourceFile,
        entry.sourceFormat,
        entry.parserVersion,
        entry.resumeStatus,
        createdAt,
        entry.indexedAt
      );
  }

  deleteSessionsBySourceFile(toolId: ToolId, sourceFile: string, keepSessionId: string | null = null): number {
    const result = keepSessionId
      ? this.db
          .prepare("DELETE FROM sessions WHERE tool_id = ? AND source_file = ? AND id != ?")
          .run(toolId, sourceFile, keepSessionId)
      : this.db.prepare("DELETE FROM sessions WHERE tool_id = ? AND source_file = ?").run(toolId, sourceFile);
    return Number(result.changes);
  }

  listSessions(): SessionEntry[] {
    return this.db
      .prepare("SELECT * FROM sessions ORDER BY updated_at DESC")
      .all()
      .map((row) => this.sessionFromRow(row));
  }

  getSession(id: string): SessionEntry | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    return row ? this.sessionFromRow(row) : null;
  }

  deleteSession(id: string): number {
    const result = this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return Number(result.changes);
  }

  listSessionsForProject(project: Project, query = ""): SessionEntry[] {
    const normalizedQuery = query.trim().toLowerCase();
    return this.listSessions().filter((session) => {
      if (!session.normalizedCwd) return false;
      const inRoot = session.normalizedCwd === project.normalizedRootPath;
      const inChild = project.includeSubdirectories && isStrictChildPath(project.normalizedRootPath, session.normalizedCwd);
      if (!inRoot && !inChild) return false;
      if (!normalizedQuery) return true;
      return `${session.title}\n${session.summary ?? ""}`.toLowerCase().includes(normalizedQuery);
    });
  }

  createProjectDetail(projectId: string, query = "") {
    const project = this.getProject(projectId);
    if (!project) return null;
    const sessions = this.listSessionsForProject(project, query);
    const groups = new Map<string, SessionEntry[]>();

    for (const session of sessions) {
      if (!session.normalizedCwd) continue;
      const key = session.normalizedCwd === project.normalizedRootPath ? project.normalizedRootPath : session.normalizedCwd;
      groups.set(key, [...(groups.get(key) ?? []), session]);
    }

    const rootSessions = groups.get(project.normalizedRootPath) ?? [];
    groups.delete(project.normalizedRootPath);

    const childGroups = [...groups.entries()]
      .map(([key, groupSessions]) => this.detailGroup(project.rootPath, key, groupSessions, false))
      .sort((a, b) => compareNullableIsoDesc(a.latestActivity, b.latestActivity));

    return {
      project,
      groups: [
        this.detailGroup(project.rootPath, project.normalizedRootPath, rootSessions, true),
        ...childGroups
      ]
    };
  }

  createScanRun(scope: string, roots: string[]): ScanRun {
    const timestamp = nowIso();
    const run: ScanRun = {
      id: crypto.randomUUID(),
      scope,
      roots,
      status: "running",
      indexedCount: 0,
      skippedCount: 0,
      warningCount: 0,
      startedAt: timestamp,
      finishedAt: null
    };
    this.db
      .prepare(
        `INSERT INTO scan_runs (id, scope, roots_json, status, indexed_count, skipped_count, warning_count, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(run.id, run.scope, json(run.roots), run.status, 0, 0, 0, run.startedAt, null);
    return run;
  }

  completeScanRun(id: string, counts: { indexedCount: number; skippedCount: number; warningCount: number; status?: ScanRun["status"] }): ScanRun {
    this.db
      .prepare(
        `UPDATE scan_runs
         SET status = ?, indexed_count = ?, skipped_count = ?, warning_count = ?, finished_at = ?
         WHERE id = ?`
      )
      .run(counts.status ?? "completed", counts.indexedCount, counts.skippedCount, counts.warningCount, nowIso(), id);
    const run = this.getScanRun(id);
    if (!run) throw new Error("Scan run disappeared during update");
    return run;
  }

  getScanRun(id: string): ScanRun | null {
    const row = this.db.prepare("SELECT * FROM scan_runs WHERE id = ?").get(id);
    return row ? this.scanRunFromRow(row) : null;
  }

  listScanCandidates(scanRunId: string): ScanCandidate[] {
    return this.db
      .prepare("SELECT * FROM scan_candidates WHERE scan_run_id = ? ORDER BY path ASC")
      .all(scanRunId)
      .map((row) => this.candidateFromRow(row));
  }

  insertScanCandidate(candidate: Omit<ScanCandidate, "id" | "createdAt">): ScanCandidate {
    const createdAt = nowIso();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO scan_candidates (
          id, scan_run_id, path, normalized_path, detected_tools_json, session_counts_json, child_candidates_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        candidate.scanRunId,
        candidate.path,
        candidate.normalizedPath,
        json(candidate.detectedTools),
        json(candidate.sessionCounts),
        json(candidate.childCandidates),
        createdAt
      );
    return { ...candidate, id, createdAt };
  }

  addParserWarning(warning: Omit<ParserWarning, "id" | "createdAt">): ParserWarning {
    const createdAt = nowIso();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO parser_warnings (id, scan_run_id, tool_id, source_file, error_type, message, line, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, warning.scanRunId, warning.toolId, warning.sourceFile, warning.errorType, warning.message, warning.line, createdAt);
    return { ...warning, id, createdAt };
  }

  deleteParserWarningsBySourceFile(toolId: ToolId, sourceFile: string): number {
    const result = this.db
      .prepare("DELETE FROM parser_warnings WHERE tool_id = ? AND source_file = ?")
      .run(toolId, sourceFile);
    return Number(result.changes);
  }

  listParserWarnings(): ParserWarning[] {
    return this.db
      .prepare("SELECT * FROM parser_warnings ORDER BY created_at DESC")
      .all()
      .map((row) => this.warningFromRow(row));
  }

  listParserWarningsForProject(project: Project): ParserWarning[] {
    const projectSessionSources = new Set(
      this.listSessionsForProject(project).map((session) => normalizeFsPath(session.sourceFile))
    );
    const encodedClaudeProjectPath = encodeClaudeProjectPath(project.rootPath);
    return this.listParserWarnings().filter((warning) => {
      if (warning.sourceFile && projectSessionSources.has(normalizeFsPath(warning.sourceFile))) return true;
      if (warning.toolId !== "claude" || !warning.sourceFile) return false;
      return claudeProjectPathSegment(warning.sourceFile) === encodedClaudeProjectPath;
    });
  }

  countParserWarningsForRun(scanRunId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM parser_warnings WHERE scan_run_id = ?").get(scanRunId);
    return Number(row?.count ?? 0);
  }

  private projectFromRow(row: Row, sessions = this.listSessions()): Project {
    const rootPath = String(row.root_path);
    const normalizedRootPath = String(row.normalized_root_path);
    const sessionCount = sessions.filter((session) => session.normalizedCwd && isPathInsideOrEqual(normalizedRootPath, session.normalizedCwd)).length;
    const childGroupCount = new Set(
      sessions
        .filter((session) => session.normalizedCwd && isStrictChildPath(normalizedRootPath, session.normalizedCwd))
        .map((session) => session.normalizedCwd)
    ).size;

    return {
      id: String(row.id),
      rootPath,
      normalizedRootPath,
      includeSubdirectories: Boolean(row.include_subdirectories),
      sessionOnly: !fs.existsSync(rootPath),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      childGroupCount,
      sessionCount
    };
  }

  private sessionFromRow(row: Row): SessionEntry {
    return {
      id: String(row.id),
      toolId: String(row.tool_id) as ToolId,
      nativeSessionId: row.native_session_id === null ? null : String(row.native_session_id),
      title: String(row.title),
      summary: row.summary === null ? null : String(row.summary),
      originalCwd: row.original_cwd === null ? null : String(row.original_cwd),
      normalizedCwd: row.normalized_cwd === null ? null : String(row.normalized_cwd),
      updatedAt: String(row.updated_at),
      sourceFile: String(row.source_file),
      sourceFormat: String(row.source_format),
      parserVersion: String(row.parser_version),
      resumeStatus: String(row.resume_status) as SessionEntry["resumeStatus"],
      indexedAt: String(row.indexed_at)
    };
  }

  private scanRunFromRow(row: Row): ScanRun {
    return {
      id: String(row.id),
      scope: String(row.scope),
      roots: parseJson<string[]>(String(row.roots_json), []),
      status: String(row.status) as ScanRun["status"],
      indexedCount: Number(row.indexed_count),
      skippedCount: Number(row.skipped_count),
      warningCount: Number(row.warning_count),
      startedAt: String(row.started_at),
      finishedAt: row.finished_at === null ? null : String(row.finished_at)
    };
  }

  private candidateFromRow(row: Row): ScanCandidate {
    return {
      id: String(row.id),
      scanRunId: String(row.scan_run_id),
      path: String(row.path),
      normalizedPath: String(row.normalized_path),
      detectedTools: parseJson<ToolId[]>(String(row.detected_tools_json), []),
      sessionCounts: parseJson<Partial<Record<ToolId, number>>>(String(row.session_counts_json), {}),
      childCandidates: parseJson<string[]>(String(row.child_candidates_json), []),
      createdAt: String(row.created_at)
    };
  }

  private warningFromRow(row: Row): ParserWarning {
    return {
      id: String(row.id),
      scanRunId: row.scan_run_id === null ? null : String(row.scan_run_id),
      toolId: row.tool_id === null ? null : (String(row.tool_id) as ToolId),
      sourceFile: row.source_file === null ? null : String(row.source_file),
      errorType: String(row.error_type),
      message: String(row.message),
      line: row.line === null ? null : Number(row.line),
      createdAt: String(row.created_at)
    };
  }

  private skillHubSourceFromRow(row: Row): SkillHubSource {
    return {
      id: String(row.id),
      type: String(row.type) as SkillHubSourceType,
      label: String(row.label),
      repoKey: row.repo_key === null ? null : String(row.repo_key),
      owner: row.owner === null ? null : String(row.owner),
      repo: row.repo === null ? null : String(row.repo),
      branch: row.branch === null ? null : String(row.branch),
      input: String(row.input),
      inputPath: row.input_path === null ? null : String(row.input_path),
      resolvedPath: row.resolved_path === null ? null : String(row.resolved_path),
      currentRevision: row.current_revision === null ? null : String(row.current_revision),
      checkoutPath: row.checkout_path === null ? null : String(row.checkout_path),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private skillHubSkillFromRow(row: Row, sources: Map<string, SkillHubSource>): SkillHubSkill {
    const sourceId = String(row.source_id);
    return {
      id: String(row.id),
      sourceId,
      sourceType: String(row.source_type) as SkillHubSourceType,
      folderName: String(row.folder_name),
      skillName: row.skill_name === null ? null : String(row.skill_name),
      description: row.description === null ? null : String(row.description),
      libraryRelativePath: String(row.library_relative_path),
      libraryPath: String(row.library_path),
      sourceRelativePath: row.source_relative_path === null ? null : String(row.source_relative_path),
      contentHash: String(row.content_hash),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      source: sources.get(sourceId) ?? null
    };
  }

  private projectSkillTargetFromRow(row: Row): ProjectSkillTarget {
    return {
      projectId: String(row.project_id),
      toolId: String(row.tool_id) as ToolId,
      skillId: String(row.skill_id),
      linkPath: String(row.link_path),
      targetPath: String(row.target_path),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private normalizeProjectHierarchy(): void {
    const projects = this.db
      .prepare("SELECT id, normalized_root_path FROM projects ORDER BY normalized_root_path")
      .all()
      .map((row) => ({
        id: String(row.id),
        normalizedRootPath: String(row.normalized_root_path)
      }));

    const projectIdsToRemove = new Set<string>();
    const parentIdsToInclude = new Set<string>();

    for (const project of projects) {
      const parent = projects
        .filter((candidate) => candidate.id !== project.id && isStrictChildPath(candidate.normalizedRootPath, project.normalizedRootPath))
        .sort((a, b) => candidateSortKey(a.normalizedRootPath) - candidateSortKey(b.normalizedRootPath))[0];
      if (!parent) continue;

      projectIdsToRemove.add(project.id);
      parentIdsToInclude.add(parent.id);
    }

    if (projectIdsToRemove.size === 0) return;

    this.db.exec("BEGIN;");
    try {
      const timestamp = nowIso();
      const updateParent = this.db.prepare("UPDATE projects SET include_subdirectories = 1, updated_at = ? WHERE id = ?");
      for (const parentId of parentIdsToInclude) {
        if (!projectIdsToRemove.has(parentId)) updateParent.run(timestamp, parentId);
      }

      const removeProject = this.db.prepare("DELETE FROM projects WHERE id = ?");
      for (const projectId of projectIdsToRemove) {
        removeProject.run(projectId);
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  private restoreProject(project: Project): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO projects (
          id, root_path, normalized_root_path, include_subdirectories, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        project.id,
        project.rootPath,
        project.normalizedRootPath,
        project.includeSubdirectories ? 1 : 0,
        project.createdAt,
        project.updatedAt
      );
  }

  private detailGroup(rootPath: string, normalizedPath: string, sessions: SessionEntry[], isRoot: boolean) {
    const display = sessions.find((session) => session.normalizedCwd === normalizedPath)?.originalCwd ?? normalizedPath;
    const byTool = new Map<ToolId, SessionEntry[]>();
    for (const session of sessions) {
      byTool.set(session.toolId, [...(byTool.get(session.toolId) ?? []), session]);
    }

    const tools = [...byTool.entries()]
      .map(([toolId, toolSessions]) => {
        const sortedSessions = toolSessions.sort((a, b) => compareIsoDesc(a.updatedAt, b.updatedAt));
        return {
          toolId,
          sessionCount: sortedSessions.length,
          latestActivity: sortedSessions[0]?.updatedAt ?? null,
          sessions: sortedSessions
        };
      })
      .sort((a, b) => b.sessionCount - a.sessionCount || compareNullableIsoDesc(a.latestActivity, b.latestActivity));

    const rootLabel = `${path.basename(rootPath) || rootPath}（根目录）`;
    return {
      key: normalizedPath,
      label: isRoot ? rootLabel : relativeLabel(rootPath, display),
      fullPath: display,
      isRoot,
      latestActivity: tools[0]?.latestActivity ?? null,
      sessionCount: sessions.length,
      tools
    };
  }
}

function compareIsoDesc(a: string, b: string): number {
  return Date.parse(b) - Date.parse(a);
}

function compareNullableIsoDesc(a: string | null, b: string | null): number {
  return (b ? Date.parse(b) : 0) - (a ? Date.parse(a) : 0);
}

function compareNullableIsoDescNullsLast(a: string | null, b: string | null): number {
  if (a && b) return compareIsoDesc(a, b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function latestSessionActivityForProject(normalizedRootPath: string, sessions: SessionEntry[]): string | null {
  return sessions.find((session) => session.normalizedCwd && isPathInsideOrEqual(normalizedRootPath, session.normalizedCwd))?.updatedAt ?? null;
}

function encodeClaudeProjectPath(input: string): string {
  return path.resolve(input).replace(/[:\\/]/g, "-");
}

function claudeProjectPathSegment(sourceFile: string): string | null {
  const parts = path.normalize(sourceFile).split(/[\\/]+/);
  const projectsIndex = parts.findIndex((part, index) => part === "projects" && parts[index - 1] === ".claude");
  return projectsIndex >= 0 ? parts[projectsIndex + 1] ?? null : null;
}

function rebaseProjectPath(projectPath: string, oldRoot: string, newRoot: string): string | null {
  return rebasePath(projectPath, oldRoot, newRoot);
}

function isSqliteLockedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const sqliteError = error as Error & { errcode?: unknown; code?: unknown; errstr?: unknown };
  return sqliteError.errcode === 5 || (sqliteError.code === "ERR_SQLITE_ERROR" && sqliteError.errstr === "database is locked");
}
