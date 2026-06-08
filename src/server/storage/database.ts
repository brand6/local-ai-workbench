import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentHubAgent,
  AgentHubSource,
  AgentHubToolId,
  CliHubCli,
  HookHubSupportedToolId,
  HookHubSuite,
  McpHubServer,
  McpHubTargetToolId,
  ParserWarning,
  PluginHubPlugin,
  PluginHubSource,
  Project,
  ProjectAgentTarget,
  ProjectHookBinding,
  ProjectMcpBinding,
  ProjectPluginBinding,
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
import { toolIds as allToolIds } from "../../shared/types.js";
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
            "Another Local AI Workbench process is probably using this data directory. " +
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

      CREATE TABLE IF NOT EXISTS clihub_clis (
        cli_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_state TEXT NOT NULL,
        command_names_json TEXT NOT NULL,
        local_path TEXT,
        channels_json TEXT NOT NULL,
        availability_state TEXT NOT NULL,
        resolved_paths_json TEXT NOT NULL,
        version TEXT,
        version_state TEXT NOT NULL,
        version_error TEXT,
        discovered_at TEXT,
        current_provider_json TEXT,
        provider_candidates_json TEXT NOT NULL,
        update_status TEXT NOT NULL,
        update_checked_at TEXT,
        update_error TEXT,
        recent_operation_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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

      CREATE TABLE IF NOT EXISTS agenthub_sources (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        input_path TEXT,
        resolved_path TEXT,
        source_truth_tool TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_agenthub_sources_resolved_truth
        ON agenthub_sources(resolved_path, source_truth_tool)
        WHERE resolved_path IS NOT NULL;

      CREATE TABLE IF NOT EXISTS agenthub_agents (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES agenthub_sources(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        source_truth_tool TEXT NOT NULL,
        truth_role TEXT NOT NULL,
        source_format TEXT NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        native_path TEXT NOT NULL UNIQUE,
        library_relative_path TEXT NOT NULL UNIQUE,
        source_relative_path TEXT,
        category TEXT,
        projection_json TEXT NOT NULL,
        native_metadata_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_id, slug)
      );

      CREATE INDEX IF NOT EXISTS idx_agenthub_agents_source ON agenthub_agents(source_id);
      CREATE INDEX IF NOT EXISTS idx_agenthub_agents_slug ON agenthub_agents(slug);

      CREATE TABLE IF NOT EXISTS pluginhub_sources (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'local',
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        repo_key TEXT,
        owner TEXT,
        repo TEXT,
        branch TEXT,
        input TEXT,
        input_path TEXT NOT NULL,
        source_path TEXT,
        resolved_path TEXT NOT NULL,
        current_revision TEXT,
        checkout_path TEXT,
        plugin_count INTEGER NOT NULL,
        component_count INTEGER NOT NULL,
        private_file_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_pluginhub_sources_resolved_path
        ON pluginhub_sources(resolved_path);

      CREATE TABLE IF NOT EXISTS pluginhub_plugins (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        source_id TEXT REFERENCES pluginhub_sources(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        component_refs_json TEXT NOT NULL,
        private_files_json TEXT NOT NULL,
        harness_support_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pluginhub_plugins_source
        ON pluginhub_plugins(source_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_pluginhub_source_plugin_name
        ON pluginhub_plugins(source_id, name)
        WHERE source_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_pluginhub_custom_plugin_name
        ON pluginhub_plugins(name)
        WHERE source_id IS NULL;

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
        PRIMARY KEY (project_id, tool_id, skill_id, link_path)
      );

      CREATE TABLE IF NOT EXISTS project_plugin_bindings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        target_root_path TEXT NOT NULL,
        normalized_target_root_path TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL REFERENCES pluginhub_plugins(id) ON DELETE CASCADE,
        managed_component_count INTEGER NOT NULL,
        existing_component_count INTEGER NOT NULL,
        private_file_count INTEGER NOT NULL,
        topology_hash TEXT NOT NULL,
        component_ownership_json TEXT NOT NULL,
        private_file_ownership_json TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, normalized_target_root_path, tool_id, plugin_id)
      );

      CREATE INDEX IF NOT EXISTS idx_project_plugin_bindings_project
        ON project_plugin_bindings(project_id, normalized_target_root_path, tool_id);

      CREATE INDEX IF NOT EXISTS idx_project_plugin_bindings_plugin
        ON project_plugin_bindings(plugin_id);

      CREATE TABLE IF NOT EXISTS mcphub_servers (
        server_id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        transport TEXT NOT NULL,
        command TEXT,
        args_json TEXT NOT NULL,
        url TEXT,
        headers_json TEXT NOT NULL,
        env_json TEXT NOT NULL,
        required_env_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_mcp_bindings (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        target_root_path TEXT NOT NULL,
        normalized_target_root_path TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        server_id TEXT NOT NULL,
        applied_server_id TEXT NOT NULL REFERENCES mcphub_servers(server_id) ON DELETE CASCADE,
        applied_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, normalized_target_root_path, tool_id, server_id)
      );

      CREATE TABLE IF NOT EXISTS hookhub_suites (
        suite_id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        risk_notes TEXT,
        required_env_json TEXT NOT NULL,
        payloads_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_hook_bindings (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        target_root_path TEXT NOT NULL,
        normalized_target_root_path TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        suite_id TEXT NOT NULL REFERENCES hookhub_suites(suite_id) ON DELETE CASCADE,
        config_path TEXT NOT NULL,
        scope TEXT NOT NULL,
        applied_fingerprint TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, normalized_target_root_path, tool_id)
      );

      CREATE TABLE IF NOT EXISTS project_agent_targets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        target_root_path TEXT NOT NULL,
        normalized_target_root_path TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        agent_id TEXT NOT NULL REFERENCES agenthub_agents(id) ON DELETE CASCADE,
        output_path TEXT NOT NULL,
        normalized_output_path TEXT NOT NULL,
        applied_source_hash TEXT NOT NULL,
        applied_output_hash TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, normalized_target_root_path, tool_id, normalized_output_path)
      );
    `);

    this.ensureProjectSkillTargetsLinkPathKey();

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_project_skill_targets_link
        ON project_skill_targets(project_id, tool_id, link_path);

      CREATE INDEX IF NOT EXISTS idx_project_skill_targets_skill
        ON project_skill_targets(skill_id);

      CREATE INDEX IF NOT EXISTS idx_project_mcp_bindings_server
        ON project_mcp_bindings(applied_server_id);

      CREATE INDEX IF NOT EXISTS idx_project_hook_bindings_suite
        ON project_hook_bindings(suite_id);

      CREATE INDEX IF NOT EXISTS idx_project_agent_targets_agent
        ON project_agent_targets(agent_id);

      CREATE INDEX IF NOT EXISTS idx_project_agent_targets_project
        ON project_agent_targets(project_id, normalized_target_root_path, tool_id);
    `);

    this.db.prepare("INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)").run("schema_version", "1");
    this.ensureColumn("pluginhub_sources", "type", "TEXT NOT NULL DEFAULT 'local'");
    this.ensureColumn("pluginhub_sources", "repo_key", "TEXT");
    this.ensureColumn("pluginhub_sources", "owner", "TEXT");
    this.ensureColumn("pluginhub_sources", "repo", "TEXT");
    this.ensureColumn("pluginhub_sources", "branch", "TEXT");
    this.ensureColumn("pluginhub_sources", "input", "TEXT");
    this.ensureColumn("pluginhub_sources", "source_path", "TEXT");
    this.ensureColumn("pluginhub_sources", "current_revision", "TEXT");
    this.ensureColumn("pluginhub_sources", "checkout_path", "TEXT");
    this.db.prepare("UPDATE pluginhub_sources SET type = 'local' WHERE type IS NULL").run();
    this.db.prepare("UPDATE pluginhub_sources SET input = input_path WHERE input IS NULL OR input = ''").run();
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pluginhub_sources_repo_key
        ON pluginhub_sources(repo_key)
        WHERE repo_key IS NOT NULL;
    `);
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (columns.some((column) => String((column as Row).name) === columnName)) return;
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  private ensureProjectSkillTargetsLinkPathKey(): void {
    const columns = this.db.prepare("PRAGMA table_info(project_skill_targets)").all();
    const linkPath = columns.find((column) => String(column.name) === "link_path");
    if (linkPath && Number(linkPath.pk) > 0) return;

    this.db.exec("PRAGMA foreign_keys = OFF;");
    try {
      this.db.exec(`
        BEGIN;

        ALTER TABLE project_skill_targets RENAME TO project_skill_targets_old;

        CREATE TABLE project_skill_targets (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          tool_id TEXT NOT NULL,
          skill_id TEXT NOT NULL REFERENCES skillhub_skills(id) ON DELETE CASCADE,
          link_path TEXT NOT NULL,
          target_path TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (project_id, tool_id, skill_id, link_path)
        );

        INSERT OR IGNORE INTO project_skill_targets (
          project_id, tool_id, skill_id, link_path, target_path, created_at, updated_at
        )
        SELECT project_id, tool_id, skill_id, link_path, target_path, created_at, updated_at
        FROM project_skill_targets_old;

        DROP TABLE project_skill_targets_old;

        COMMIT;
      `);
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    } finally {
      this.db.exec("PRAGMA foreign_keys = ON;");
    }
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

  listCliHubClis(): CliHubCli[] {
    return this.db
      .prepare(
        `SELECT * FROM clihub_clis
         ORDER BY
           CASE kind
             WHEN 'project-tool' THEN 0
             WHEN 'function' THEN 1
             WHEN 'dependency' THEN 2
             ELSE 3
           END,
           display_name ASC`
      )
      .all()
      .map((row) => this.cliHubCliFromRow(row));
  }

  getCliHubCli(cliId: string): CliHubCli | null {
    const row = this.db.prepare("SELECT * FROM clihub_clis WHERE cli_id = ?").get(cliId);
    return row ? this.cliHubCliFromRow(row) : null;
  }

  deleteStaleBuiltInCliHubClis(activeCliIds: string[]): number {
    if (activeCliIds.length === 0) return 0;
    const placeholders = activeCliIds.map(() => "?").join(", ");
    const result = this.db
      .prepare(`DELETE FROM clihub_clis WHERE source_type = 'builtin' AND cli_id NOT IN (${placeholders})`)
      .run(...activeCliIds);
    return Number(result.changes);
  }

  upsertCliHubCli(input: Omit<CliHubCli, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): CliHubCli {
    const existing = this.getCliHubCli(input.cliId);
    const timestamp = nowIso();
    const createdAt = input.createdAt ?? existing?.createdAt ?? timestamp;
    const updatedAt = input.updatedAt ?? timestamp;
    this.db
      .prepare(
        `INSERT INTO clihub_clis (
          cli_id, display_name, kind, source_type, source_state, command_names_json,
          local_path, channels_json, availability_state, resolved_paths_json, version,
          version_state, version_error, discovered_at, current_provider_json,
          provider_candidates_json, update_status, update_checked_at, update_error,
          recent_operation_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cli_id) DO UPDATE SET
          display_name = excluded.display_name,
          kind = excluded.kind,
          source_type = excluded.source_type,
          source_state = excluded.source_state,
          command_names_json = excluded.command_names_json,
          local_path = excluded.local_path,
          channels_json = excluded.channels_json,
          availability_state = excluded.availability_state,
          resolved_paths_json = excluded.resolved_paths_json,
          version = excluded.version,
          version_state = excluded.version_state,
          version_error = excluded.version_error,
          discovered_at = excluded.discovered_at,
          current_provider_json = excluded.current_provider_json,
          provider_candidates_json = excluded.provider_candidates_json,
          update_status = excluded.update_status,
          update_checked_at = excluded.update_checked_at,
          update_error = excluded.update_error,
          recent_operation_json = excluded.recent_operation_json,
          updated_at = excluded.updated_at`
      )
      .run(
        input.cliId,
        input.displayName,
        input.kind,
        input.sourceType,
        input.sourceState,
        json(input.commandNames),
        input.localPath,
        json(input.channels),
        input.availabilityState,
        json(input.resolvedPaths),
        input.version,
        input.versionState,
        input.versionError,
        input.discoveredAt,
        input.currentProvider ? json(input.currentProvider) : null,
        json(input.providerCandidates),
        input.updateStatus,
        input.updateCheckedAt,
        input.updateError,
        input.recentOperation ? json(input.recentOperation) : null,
        createdAt,
        updatedAt
      );
    const cli = this.getCliHubCli(input.cliId);
    if (!cli) throw new Error("Failed to upsert CliHub CLI");
    return cli;
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

  deleteSkillHubSource(sourceId: string): boolean {
    const result = this.db.prepare("DELETE FROM skillhub_sources WHERE id = ?").run(sourceId);
    return Number(result.changes) > 0;
  }

  listAgentHubSources(): AgentHubSource[] {
    return this.db
      .prepare("SELECT * FROM agenthub_sources ORDER BY type ASC, label ASC, updated_at DESC")
      .all()
      .map((row) => this.agentHubSourceFromRow(row));
  }

  getAgentHubSource(sourceId: string): AgentHubSource | null {
    const row = this.db.prepare("SELECT * FROM agenthub_sources WHERE id = ?").get(sourceId);
    return row ? this.agentHubSourceFromRow(row) : null;
  }

  getAgentHubSourceByResolvedPath(resolvedPath: string, sourceTruthTool: AgentHubToolId): AgentHubSource | null {
    const row = this.db
      .prepare("SELECT * FROM agenthub_sources WHERE resolved_path = ? AND source_truth_tool = ?")
      .get(normalizeFsPath(resolvedPath), sourceTruthTool);
    return row ? this.agentHubSourceFromRow(row) : null;
  }

  upsertAgentHubSource(input: Omit<AgentHubSource, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): AgentHubSource {
    const existing = this.getAgentHubSource(input.id);
    const timestamp = nowIso();
    const createdAt = input.createdAt ?? existing?.createdAt ?? timestamp;
    const updatedAt = input.updatedAt ?? timestamp;
    this.db
      .prepare(
        `INSERT INTO agenthub_sources (
          id, type, label, input_path, resolved_path, source_truth_tool,
          imported_at, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          label = excluded.label,
          input_path = excluded.input_path,
          resolved_path = excluded.resolved_path,
          source_truth_tool = excluded.source_truth_tool,
          imported_at = excluded.imported_at,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.type,
        input.label,
        input.inputPath,
        input.resolvedPath ? normalizeFsPath(input.resolvedPath) : null,
        input.sourceTruthTool,
        input.importedAt,
        json(input.metadata),
        createdAt,
        updatedAt
      );
    const source = this.getAgentHubSource(input.id);
    if (!source) throw new Error("Failed to upsert AgentHub source");
    return source;
  }

  deleteAgentHubSource(sourceId: string): boolean {
    const result = this.db.prepare("DELETE FROM agenthub_sources WHERE id = ?").run(sourceId);
    return Number(result.changes) > 0;
  }

  listAgentHubAgents(query = ""): AgentHubAgent[] {
    const sources = new Map(this.listAgentHubSources().map((source) => [source.id, source]));
    const normalizedQuery = query.trim().toLowerCase();
    return this.db
      .prepare("SELECT * FROM agenthub_agents ORDER BY source_id ASC, category ASC, name ASC, slug ASC")
      .all()
      .map((row) => this.agentHubAgentFromRow(row, sources))
      .filter((agent) => {
        if (!normalizedQuery) return true;
        return [
          agent.name,
          agent.description ?? "",
          agent.slug,
          agent.source?.label ?? "",
          agent.sourceTruthTool,
          agent.truthRole,
          agent.nativePath,
          agent.sourceRelativePath ?? "",
          agent.category ?? ""
        ]
          .join("\n")
          .toLowerCase()
          .includes(normalizedQuery);
      });
  }

  listAgentHubAgentsForSource(sourceId: string): AgentHubAgent[] {
    const sources = new Map(this.listAgentHubSources().map((source) => [source.id, source]));
    return this.db
      .prepare("SELECT * FROM agenthub_agents WHERE source_id = ? ORDER BY category ASC, name ASC, slug ASC")
      .all(sourceId)
      .map((row) => this.agentHubAgentFromRow(row, sources));
  }

  getAgentHubAgent(agentId: string): AgentHubAgent | null {
    const sources = new Map(this.listAgentHubSources().map((source) => [source.id, source]));
    const row = this.db.prepare("SELECT * FROM agenthub_agents WHERE id = ?").get(agentId);
    return row ? this.agentHubAgentFromRow(row, sources) : null;
  }

  getAgentHubAgentBySourceSlug(sourceId: string, slug: string): AgentHubAgent | null {
    const sources = new Map(this.listAgentHubSources().map((source) => [source.id, source]));
    const row = this.db.prepare("SELECT * FROM agenthub_agents WHERE source_id = ? AND slug = ?").get(sourceId, slug);
    return row ? this.agentHubAgentFromRow(row, sources) : null;
  }

  upsertAgentHubAgent(input: Omit<AgentHubAgent, "source" | "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): AgentHubAgent {
    const existing = this.getAgentHubAgent(input.id);
    const timestamp = nowIso();
    const createdAt = input.createdAt ?? existing?.createdAt ?? timestamp;
    const updatedAt = input.updatedAt ?? timestamp;
    this.db
      .prepare(
        `INSERT INTO agenthub_agents (
          id, source_id, source_type, source_truth_tool, truth_role, source_format,
          slug, name, description, native_path, library_relative_path,
          source_relative_path, category, projection_json, native_metadata_json,
          content_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source_id = excluded.source_id,
          source_type = excluded.source_type,
          source_truth_tool = excluded.source_truth_tool,
          truth_role = excluded.truth_role,
          source_format = excluded.source_format,
          slug = excluded.slug,
          name = excluded.name,
          description = excluded.description,
          native_path = excluded.native_path,
          library_relative_path = excluded.library_relative_path,
          source_relative_path = excluded.source_relative_path,
          category = excluded.category,
          projection_json = excluded.projection_json,
          native_metadata_json = excluded.native_metadata_json,
          content_hash = excluded.content_hash,
          updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.sourceId,
        input.sourceType,
        input.sourceTruthTool,
        input.truthRole,
        input.sourceFormat,
        input.slug,
        input.name,
        input.description,
        input.nativePath,
        input.libraryRelativePath,
        input.sourceRelativePath,
        input.category,
        json(input.projection),
        json(input.nativeMetadata),
        input.contentHash,
        createdAt,
        updatedAt
      );
    const agent = this.getAgentHubAgent(input.id);
    if (!agent) throw new Error("Failed to upsert AgentHub agent");
    return agent;
  }

  deleteAgentHubAgent(agentId: string): boolean {
    const result = this.db.prepare("DELETE FROM agenthub_agents WHERE id = ?").run(agentId);
    return Number(result.changes) > 0;
  }

  listPluginHubSources(): PluginHubSource[] {
    return this.db
      .prepare("SELECT * FROM pluginhub_sources ORDER BY label ASC")
      .all()
      .map((row) => this.pluginHubSourceFromRow(row));
  }

  getPluginHubSource(sourceId: string): PluginHubSource | null {
    const row = this.db.prepare("SELECT * FROM pluginhub_sources WHERE id = ?").get(sourceId);
    return row ? this.pluginHubSourceFromRow(row) : null;
  }

  getPluginHubSourceByResolvedPath(resolvedPath: string): PluginHubSource | null {
    const row = this.db.prepare("SELECT * FROM pluginhub_sources WHERE resolved_path = ?").get(normalizeFsPath(resolvedPath));
    return row ? this.pluginHubSourceFromRow(row) : null;
  }

  getPluginHubSourceByRepoKey(repoKey: string): PluginHubSource | null {
    const row = this.db.prepare("SELECT * FROM pluginhub_sources WHERE repo_key = ?").get(repoKey);
    return row ? this.pluginHubSourceFromRow(row) : null;
  }

  upsertPluginHubSource(input: Omit<PluginHubSource, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): PluginHubSource {
    const existing = this.getPluginHubSource(input.id);
    const timestamp = nowIso();
    const createdAt = input.createdAt ?? existing?.createdAt ?? timestamp;
    const updatedAt = input.updatedAt ?? timestamp;
    this.db
      .prepare(
        `INSERT INTO pluginhub_sources (
          id, type, kind, label, repo_key, owner, repo, branch, input, input_path,
          source_path, resolved_path, current_revision, checkout_path, plugin_count,
          component_count, private_file_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          kind = excluded.kind,
          label = excluded.label,
          repo_key = excluded.repo_key,
          owner = excluded.owner,
          repo = excluded.repo,
          branch = excluded.branch,
          input = excluded.input,
          input_path = excluded.input_path,
          source_path = excluded.source_path,
          resolved_path = excluded.resolved_path,
          current_revision = excluded.current_revision,
          checkout_path = excluded.checkout_path,
          plugin_count = excluded.plugin_count,
          component_count = excluded.component_count,
          private_file_count = excluded.private_file_count,
          updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.type,
        input.kind,
        input.label,
        input.repoKey,
        input.owner,
        input.repo,
        input.branch,
        input.input,
        input.inputPath,
        input.sourcePath,
        normalizeFsPath(input.resolvedPath),
        input.currentRevision,
        input.checkoutPath,
        input.pluginCount,
        input.componentCount,
        input.privateFileCount,
        createdAt,
        updatedAt
      );
    const source = this.getPluginHubSource(input.id);
    if (!source) throw new Error("Failed to upsert PluginHub source");
    return source;
  }

  deletePluginHubSource(sourceId: string): boolean {
    const result = this.db.prepare("DELETE FROM pluginhub_sources WHERE id = ?").run(sourceId);
    return Number(result.changes) > 0;
  }

  listPluginHubPlugins(): PluginHubPlugin[] {
    const sources = new Map(this.listPluginHubSources().map((source) => [source.id, source]));
    return this.db
      .prepare("SELECT * FROM pluginhub_plugins ORDER BY kind DESC, display_name ASC")
      .all()
      .map((row) => this.pluginHubPluginFromRow(row, sources));
  }

  listPluginHubPluginsForSource(sourceId: string): PluginHubPlugin[] {
    const sources = new Map(this.listPluginHubSources().map((source) => [source.id, source]));
    return this.db
      .prepare("SELECT * FROM pluginhub_plugins WHERE source_id = ? ORDER BY display_name ASC")
      .all(sourceId)
      .map((row) => this.pluginHubPluginFromRow(row, sources));
  }

  listCustomPluginHubPlugins(): PluginHubPlugin[] {
    const sources = new Map(this.listPluginHubSources().map((source) => [source.id, source]));
    return this.db
      .prepare("SELECT * FROM pluginhub_plugins WHERE kind = 'custom' ORDER BY display_name ASC")
      .all()
      .map((row) => this.pluginHubPluginFromRow(row, sources));
  }

  getPluginHubPlugin(pluginId: string): PluginHubPlugin | null {
    const sources = new Map(this.listPluginHubSources().map((source) => [source.id, source]));
    const row = this.db.prepare("SELECT * FROM pluginhub_plugins WHERE id = ?").get(pluginId);
    return row ? this.pluginHubPluginFromRow(row, sources) : null;
  }

  upsertPluginHubPlugin(input: Omit<PluginHubPlugin, "source" | "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): PluginHubPlugin {
    const existing = this.getPluginHubPlugin(input.id);
    const timestamp = nowIso();
    const createdAt = input.createdAt ?? existing?.createdAt ?? timestamp;
    const updatedAt = input.updatedAt ?? timestamp;
    this.db
      .prepare(
        `INSERT INTO pluginhub_plugins (
          id, kind, source_id, name, display_name, description, component_refs_json,
          private_files_json, harness_support_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          source_id = excluded.source_id,
          name = excluded.name,
          display_name = excluded.display_name,
          description = excluded.description,
          component_refs_json = excluded.component_refs_json,
          private_files_json = excluded.private_files_json,
          harness_support_json = excluded.harness_support_json,
          updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.kind,
        input.sourceId,
        input.name,
        input.displayName,
        input.description,
        json(input.componentRefs),
        json(input.privateFiles),
        json(input.harnessSupport),
        createdAt,
        updatedAt
      );
    const plugin = this.getPluginHubPlugin(input.id);
    if (!plugin) throw new Error("Failed to upsert PluginHub plugin");
    return plugin;
  }

  deletePluginHubPlugin(pluginId: string): boolean {
    const result = this.db.prepare("DELETE FROM pluginhub_plugins WHERE id = ?").run(pluginId);
    return Number(result.changes) > 0;
  }

  deletePluginHubPluginsForSource(sourceId: string): PluginHubPlugin[] {
    const plugins = this.listPluginHubPluginsForSource(sourceId);
    this.db.prepare("DELETE FROM pluginhub_plugins WHERE source_id = ?").run(sourceId);
    return plugins;
  }

  listProjectPluginBindings(projectId?: string): ProjectPluginBinding[] {
    const plugins = new Map(this.listPluginHubPlugins().map((plugin) => [plugin.id, plugin]));
    const rows = projectId
      ? this.db.prepare("SELECT * FROM project_plugin_bindings WHERE project_id = ? ORDER BY updated_at DESC").all(projectId)
      : this.db.prepare("SELECT * FROM project_plugin_bindings ORDER BY project_id ASC, updated_at DESC").all();
    return rows.map((row) => this.projectPluginBindingFromRow(row, plugins));
  }

  listProjectPluginBindingsForPlugin(pluginId: string): ProjectPluginBinding[] {
    const plugins = new Map(this.listPluginHubPlugins().map((plugin) => [plugin.id, plugin]));
    return this.db
      .prepare("SELECT * FROM project_plugin_bindings WHERE plugin_id = ? ORDER BY project_id ASC, tool_id ASC")
      .all(pluginId)
      .map((row) => this.projectPluginBindingFromRow(row, plugins));
  }

  getProjectPluginBinding(projectId: string, targetRootPath: string, toolId: ToolId, pluginId: string): ProjectPluginBinding | null {
    const plugins = new Map(this.listPluginHubPlugins().map((plugin) => [plugin.id, plugin]));
    const row = this.db
      .prepare(
        `SELECT * FROM project_plugin_bindings
         WHERE project_id = ? AND normalized_target_root_path = ? AND tool_id = ? AND plugin_id = ?`
      )
      .get(projectId, normalizeFsPath(targetRootPath), toolId, pluginId);
    return row ? this.projectPluginBindingFromRow(row, plugins) : null;
  }

  upsertProjectPluginBinding(
    input: Omit<ProjectPluginBinding, "id" | "plugin" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: string; updatedAt?: string }
  ): ProjectPluginBinding {
    const normalizedTargetRootPath = normalizeFsPath(input.targetRootPath);
    const existing = input.id
      ? this.db.prepare("SELECT id, created_at FROM project_plugin_bindings WHERE id = ?").get(input.id)
      : this.db
          .prepare(
            `SELECT id, created_at FROM project_plugin_bindings
             WHERE project_id = ? AND normalized_target_root_path = ? AND tool_id = ? AND plugin_id = ?`
          )
          .get(input.projectId, normalizedTargetRootPath, input.toolId, input.pluginId);
    const timestamp = nowIso();
    const id = String(existing?.id ?? input.id ?? crypto.randomUUID());
    const createdAt = String(input.createdAt ?? existing?.created_at ?? timestamp);
    const updatedAt = input.updatedAt ?? timestamp;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO project_plugin_bindings (
          id, project_id, target_root_path, normalized_target_root_path, tool_id, plugin_id,
          managed_component_count, existing_component_count, private_file_count, topology_hash,
          component_ownership_json, private_file_ownership_json, installed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.targetRootPath,
        normalizedTargetRootPath,
        input.toolId,
        input.pluginId,
        input.managedComponentCount,
        input.existingComponentCount,
        input.privateFileCount,
        input.topologyHash,
        json(input.componentOwnership),
        json(input.privateFileOwnership),
        input.installedAt,
        createdAt,
        updatedAt
      );
    const binding = this.db.prepare("SELECT * FROM project_plugin_bindings WHERE id = ?").get(id);
    if (!binding) throw new Error("Failed to upsert project PluginHub binding");
    const plugins = new Map(this.listPluginHubPlugins().map((plugin) => [plugin.id, plugin]));
    return this.projectPluginBindingFromRow(binding, plugins);
  }

  deleteProjectPluginBinding(bindingId: string): ProjectPluginBinding | null {
    const plugins = new Map(this.listPluginHubPlugins().map((plugin) => [plugin.id, plugin]));
    const row = this.db.prepare("SELECT * FROM project_plugin_bindings WHERE id = ?").get(bindingId);
    if (!row) return null;
    this.db.prepare("DELETE FROM project_plugin_bindings WHERE id = ?").run(bindingId);
    return this.projectPluginBindingFromRow(row, plugins);
  }

  deleteProjectPluginBindingsForPlugin(pluginId: string): ProjectPluginBinding[] {
    const bindings = this.listProjectPluginBindingsForPlugin(pluginId);
    this.db.prepare("DELETE FROM project_plugin_bindings WHERE plugin_id = ?").run(pluginId);
    return bindings;
  }

  listMcpHubServers(): McpHubServer[] {
    return this.db
      .prepare("SELECT * FROM mcphub_servers ORDER BY server_id ASC")
      .all()
      .map((row) => this.mcpHubServerFromRow(row));
  }

  getMcpHubServer(serverId: string): McpHubServer | null {
    const row = this.db.prepare("SELECT * FROM mcphub_servers WHERE server_id = ?").get(serverId);
    return row ? this.mcpHubServerFromRow(row) : null;
  }

  upsertMcpHubServer(input: Omit<McpHubServer, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): McpHubServer {
    const existing = this.getMcpHubServer(input.serverId);
    const timestamp = nowIso();
    const createdAt = input.createdAt ?? existing?.createdAt ?? timestamp;
    const updatedAt = input.updatedAt ?? timestamp;
    this.db
      .prepare(
        `INSERT INTO mcphub_servers (
          server_id, name, description, transport, command, args_json, url, headers_json,
          env_json, required_env_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(server_id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          transport = excluded.transport,
          command = excluded.command,
          args_json = excluded.args_json,
          url = excluded.url,
          headers_json = excluded.headers_json,
          env_json = excluded.env_json,
          required_env_json = excluded.required_env_json,
          updated_at = excluded.updated_at`
      )
      .run(
        input.serverId,
        input.name,
        input.description,
        input.transport,
        input.command,
        json(input.args),
        input.url,
        json(input.headers),
        json(input.env),
        json(input.requiredEnv),
        createdAt,
        updatedAt
      );
    const server = this.getMcpHubServer(input.serverId);
    if (!server) throw new Error("Failed to upsert McpHub server");
    return server;
  }

  deleteMcpHubServer(serverId: string): boolean {
    const result = this.db.prepare("DELETE FROM mcphub_servers WHERE server_id = ?").run(serverId);
    return Number(result.changes) > 0;
  }

  listHookHubSuites(query = ""): HookHubSuite[] {
    const normalizedQuery = query.trim().toLowerCase();
    return this.db
      .prepare("SELECT * FROM hookhub_suites ORDER BY name ASC")
      .all()
      .map((row) => this.hookHubSuiteFromRow(row))
      .filter((suite) => {
        if (!normalizedQuery) return true;
        return [
          suite.suiteId,
          suite.name,
          suite.description ?? "",
          suite.riskNotes ?? "",
          suite.requiredEnv.join(" "),
          suite.toolIds.join(" ")
        ]
          .join("\n")
          .toLowerCase()
          .includes(normalizedQuery);
      });
  }

  getHookHubSuite(suiteId: string): HookHubSuite | null {
    const row = this.db.prepare("SELECT * FROM hookhub_suites WHERE suite_id = ?").get(suiteId);
    return row ? this.hookHubSuiteFromRow(row) : null;
  }

  getHookHubSuiteByName(name: string): HookHubSuite | null {
    const row = this.db.prepare("SELECT * FROM hookhub_suites WHERE lower(name) = lower(?)").get(name);
    return row ? this.hookHubSuiteFromRow(row) : null;
  }

  upsertHookHubSuite(input: Omit<HookHubSuite, "toolIds" | "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): HookHubSuite {
    const existing = this.getHookHubSuite(input.suiteId);
    const timestamp = nowIso();
    const createdAt = input.createdAt ?? existing?.createdAt ?? timestamp;
    const updatedAt = input.updatedAt ?? timestamp;
    this.db
      .prepare(
        `INSERT INTO hookhub_suites (
          suite_id, name, description, risk_notes, required_env_json, payloads_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(suite_id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          risk_notes = excluded.risk_notes,
          required_env_json = excluded.required_env_json,
          payloads_json = excluded.payloads_json,
          updated_at = excluded.updated_at`
      )
      .run(
        input.suiteId,
        input.name,
        input.description,
        input.riskNotes,
        json(input.requiredEnv),
        json(input.payloads),
        createdAt,
        updatedAt
      );
    const suite = this.getHookHubSuite(input.suiteId);
    if (!suite) throw new Error("Failed to upsert HookHub suite");
    return suite;
  }

  deleteHookHubSuite(suiteId: string): boolean {
    const result = this.db.prepare("DELETE FROM hookhub_suites WHERE suite_id = ?").run(suiteId);
    return Number(result.changes) > 0;
  }

  listProjectHookBindings(projectId?: string, targetRootPath?: string): ProjectHookBinding[] {
    if (projectId && targetRootPath) {
      return this.db
        .prepare(
          `SELECT * FROM project_hook_bindings
           WHERE project_id = ? AND normalized_target_root_path = ?
           ORDER BY tool_id ASC`
        )
        .all(projectId, normalizeFsPath(targetRootPath))
        .map((row) => this.projectHookBindingFromRow(row));
    }
    if (projectId) {
      return this.db
        .prepare("SELECT * FROM project_hook_bindings WHERE project_id = ? ORDER BY normalized_target_root_path ASC, tool_id ASC")
        .all(projectId)
        .map((row) => this.projectHookBindingFromRow(row));
    }
    return this.db
      .prepare("SELECT * FROM project_hook_bindings ORDER BY project_id ASC, normalized_target_root_path ASC, tool_id ASC")
      .all()
      .map((row) => this.projectHookBindingFromRow(row));
  }

  listProjectHookBindingsForSuite(suiteId: string): ProjectHookBinding[] {
    return this.db
      .prepare("SELECT * FROM project_hook_bindings WHERE suite_id = ? ORDER BY project_id ASC, normalized_target_root_path ASC, tool_id ASC")
      .all(suiteId)
      .map((row) => this.projectHookBindingFromRow(row));
  }

  getProjectHookBinding(projectId: string, targetRootPath: string, toolId: HookHubSupportedToolId): ProjectHookBinding | null {
    const row = this.db
      .prepare(
        `SELECT * FROM project_hook_bindings
         WHERE project_id = ? AND normalized_target_root_path = ? AND tool_id = ?`
      )
      .get(projectId, normalizeFsPath(targetRootPath), toolId);
    return row ? this.projectHookBindingFromRow(row) : null;
  }

  upsertProjectHookBinding(input: Omit<ProjectHookBinding, "createdAt" | "updatedAt">): ProjectHookBinding {
    const normalizedTargetRootPath = normalizeFsPath(input.targetRootPath);
    const existing = this.db
      .prepare(
        `SELECT created_at FROM project_hook_bindings
         WHERE project_id = ? AND normalized_target_root_path = ? AND tool_id = ?`
      )
      .get(input.projectId, normalizedTargetRootPath, input.toolId);
    const timestamp = nowIso();
    const createdAt = String(existing?.created_at ?? timestamp);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO project_hook_bindings (
          project_id, target_root_path, normalized_target_root_path, tool_id, suite_id,
          config_path, scope, applied_fingerprint, applied_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.projectId,
        input.targetRootPath,
        normalizedTargetRootPath,
        input.toolId,
        input.suiteId,
        input.configPath,
        input.scope,
        input.appliedFingerprint,
        input.appliedAt,
        createdAt,
        timestamp
      );
    const stored = this.getProjectHookBinding(input.projectId, input.targetRootPath, input.toolId);
    if (!stored) throw new Error("Failed to upsert project hook binding");
    return stored;
  }

  deleteProjectHookBinding(projectId: string, targetRootPath: string, toolId: HookHubSupportedToolId): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM project_hook_bindings
         WHERE project_id = ? AND normalized_target_root_path = ? AND tool_id = ?`
      )
      .run(projectId, normalizeFsPath(targetRootPath), toolId);
    return Number(result.changes) > 0;
  }

  listProjectAgentTargets(projectId?: string, targetRootPath?: string): ProjectAgentTarget[] {
    const agents = new Map(this.listAgentHubAgents().map((agent) => [agent.id, agent]));
    if (projectId && targetRootPath) {
      return this.db
        .prepare(
          `SELECT * FROM project_agent_targets
           WHERE project_id = ? AND normalized_target_root_path = ?
           ORDER BY tool_id ASC, output_path ASC`
        )
        .all(projectId, normalizeFsPath(targetRootPath))
        .map((row) => this.projectAgentTargetFromRow(row, agents));
    }
    if (projectId) {
      return this.db
        .prepare("SELECT * FROM project_agent_targets WHERE project_id = ? ORDER BY normalized_target_root_path ASC, tool_id ASC, output_path ASC")
        .all(projectId)
        .map((row) => this.projectAgentTargetFromRow(row, agents));
    }
    return this.db
      .prepare("SELECT * FROM project_agent_targets ORDER BY project_id ASC, normalized_target_root_path ASC, tool_id ASC, output_path ASC")
      .all()
      .map((row) => this.projectAgentTargetFromRow(row, agents));
  }

  listProjectAgentTargetsForAgent(agentId: string): ProjectAgentTarget[] {
    const agents = new Map(this.listAgentHubAgents().map((agent) => [agent.id, agent]));
    return this.db
      .prepare("SELECT * FROM project_agent_targets WHERE agent_id = ? ORDER BY project_id ASC, normalized_target_root_path ASC, tool_id ASC")
      .all(agentId)
      .map((row) => this.projectAgentTargetFromRow(row, agents));
  }

  getProjectAgentTarget(bindingId: string): ProjectAgentTarget | null {
    const agents = new Map(this.listAgentHubAgents().map((agent) => [agent.id, agent]));
    const row = this.db.prepare("SELECT * FROM project_agent_targets WHERE id = ?").get(bindingId);
    return row ? this.projectAgentTargetFromRow(row, agents) : null;
  }

  getProjectAgentTargetByOutputPath(projectId: string, targetRootPath: string, toolId: AgentHubToolId, outputPath: string): ProjectAgentTarget | null {
    const agents = new Map(this.listAgentHubAgents().map((agent) => [agent.id, agent]));
    const row = this.db
      .prepare(
        `SELECT * FROM project_agent_targets
         WHERE project_id = ? AND normalized_target_root_path = ? AND tool_id = ? AND normalized_output_path = ?`
      )
      .get(projectId, normalizeFsPath(targetRootPath), toolId, normalizeFsPath(outputPath));
    return row ? this.projectAgentTargetFromRow(row, agents) : null;
  }

  upsertProjectAgentTarget(
    input: Omit<ProjectAgentTarget, "id" | "agent" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: string; updatedAt?: string }
  ): ProjectAgentTarget {
    const normalizedTargetRootPath = normalizeFsPath(input.targetRootPath);
    const normalizedOutputPath = normalizeFsPath(input.outputPath);
    const existing = input.id
      ? this.db.prepare("SELECT id, created_at FROM project_agent_targets WHERE id = ?").get(input.id)
      : this.db
          .prepare(
            `SELECT id, created_at FROM project_agent_targets
             WHERE project_id = ? AND normalized_target_root_path = ? AND tool_id = ? AND normalized_output_path = ?`
          )
          .get(input.projectId, normalizedTargetRootPath, input.toolId, normalizedOutputPath);
    const timestamp = nowIso();
    const id = String(existing?.id ?? input.id ?? crypto.randomUUID());
    const createdAt = String(input.createdAt ?? existing?.created_at ?? timestamp);
    const updatedAt = input.updatedAt ?? timestamp;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO project_agent_targets (
          id, project_id, target_root_path, normalized_target_root_path, tool_id,
          agent_id, output_path, normalized_output_path, applied_source_hash,
          applied_output_hash, applied_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.targetRootPath,
        normalizedTargetRootPath,
        input.toolId,
        input.agentId,
        input.outputPath,
        normalizedOutputPath,
        input.appliedSourceHash,
        input.appliedOutputHash,
        input.appliedAt,
        createdAt,
        updatedAt
      );
    const binding = this.getProjectAgentTarget(id);
    if (!binding) throw new Error("Failed to upsert project AgentHub target");
    return binding;
  }

  deleteProjectAgentTarget(bindingId: string): ProjectAgentTarget | null {
    const binding = this.getProjectAgentTarget(bindingId);
    if (!binding) return null;
    this.db.prepare("DELETE FROM project_agent_targets WHERE id = ?").run(bindingId);
    return binding;
  }

  deleteProjectAgentTargetsForAgent(agentId: string): ProjectAgentTarget[] {
    const targets = this.listProjectAgentTargetsForAgent(agentId);
    this.db.prepare("DELETE FROM project_agent_targets WHERE agent_id = ?").run(agentId);
    return targets;
  }

  listProjectMcpBindings(projectId?: string, targetRootPath?: string): ProjectMcpBinding[] {
    if (projectId && targetRootPath) {
      return this.db
        .prepare(
          `SELECT * FROM project_mcp_bindings
           WHERE project_id = ? AND normalized_target_root_path = ?
           ORDER BY tool_id ASC, server_id ASC`
        )
        .all(projectId, normalizeFsPath(targetRootPath))
        .map((row) => this.projectMcpBindingFromRow(row));
    }
    if (projectId) {
      return this.db
        .prepare("SELECT * FROM project_mcp_bindings WHERE project_id = ? ORDER BY normalized_target_root_path ASC, tool_id ASC, server_id ASC")
        .all(projectId)
        .map((row) => this.projectMcpBindingFromRow(row));
    }
    return this.db
      .prepare("SELECT * FROM project_mcp_bindings ORDER BY project_id ASC, normalized_target_root_path ASC, tool_id ASC, server_id ASC")
      .all()
      .map((row) => this.projectMcpBindingFromRow(row));
  }

  listProjectMcpBindingsForServer(serverId: string): ProjectMcpBinding[] {
    return this.db
      .prepare("SELECT * FROM project_mcp_bindings WHERE applied_server_id = ? ORDER BY project_id ASC, tool_id ASC")
      .all(serverId)
      .map((row) => this.projectMcpBindingFromRow(row));
  }

  getProjectMcpBinding(projectId: string, targetRootPath: string, toolId: McpHubTargetToolId, serverId: string): ProjectMcpBinding | null {
    const row = this.db
      .prepare(
        `SELECT * FROM project_mcp_bindings
         WHERE project_id = ? AND normalized_target_root_path = ? AND tool_id = ? AND server_id = ?`
      )
      .get(projectId, normalizeFsPath(targetRootPath), toolId, serverId);
    return row ? this.projectMcpBindingFromRow(row) : null;
  }

  upsertProjectMcpBinding(input: Omit<ProjectMcpBinding, "createdAt" | "updatedAt">): ProjectMcpBinding {
    const normalizedTargetRootPath = normalizeFsPath(input.targetRootPath);
    const existing = this.db
      .prepare(
        `SELECT created_at FROM project_mcp_bindings
         WHERE project_id = ? AND normalized_target_root_path = ? AND tool_id = ? AND server_id = ?`
      )
      .get(input.projectId, normalizedTargetRootPath, input.toolId, input.serverId);
    const timestamp = nowIso();
    const createdAt = String(existing?.created_at ?? timestamp);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO project_mcp_bindings (
          project_id, target_root_path, normalized_target_root_path, tool_id, server_id,
          applied_server_id, applied_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.projectId,
        input.targetRootPath,
        normalizedTargetRootPath,
        input.toolId,
        input.serverId,
        input.appliedServerId,
        input.appliedAt,
        createdAt,
        timestamp
      );
    const stored = this.getProjectMcpBinding(input.projectId, input.targetRootPath, input.toolId, input.serverId);
    if (!stored) throw new Error("Failed to upsert project MCP binding");
    return stored;
  }

  deleteProjectMcpBinding(projectId: string, targetRootPath: string, toolId: McpHubTargetToolId, serverId: string): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM project_mcp_bindings
         WHERE project_id = ? AND normalized_target_root_path = ? AND tool_id = ? AND server_id = ?`
      )
      .run(projectId, normalizeFsPath(targetRootPath), toolId, serverId);
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
      for (const toolId of allToolIds) {
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
      .prepare("SELECT created_at FROM project_skill_targets WHERE project_id = ? AND tool_id = ? AND skill_id = ? AND link_path = ?")
      .get(input.projectId, input.toolId, input.skillId, input.linkPath);
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
      .prepare("SELECT * FROM project_skill_targets WHERE project_id = ? AND tool_id = ? AND skill_id = ? AND link_path = ?")
      .get(input.projectId, input.toolId, input.skillId, input.linkPath);
    if (!stored) throw new Error("Failed to upsert project skill target");
    return this.projectSkillTargetFromRow(stored);
  }

  deleteProjectSkillTarget(projectId: string, toolId: ToolId, skillId: string, linkPath?: string): ProjectSkillTarget | null {
    const row = linkPath
      ? this.db
          .prepare("SELECT * FROM project_skill_targets WHERE project_id = ? AND tool_id = ? AND skill_id = ? AND link_path = ?")
          .get(projectId, toolId, skillId, linkPath)
      : this.db
          .prepare("SELECT * FROM project_skill_targets WHERE project_id = ? AND tool_id = ? AND skill_id = ?")
          .get(projectId, toolId, skillId);
    if (!row) return null;
    if (linkPath) {
      this.db
        .prepare("DELETE FROM project_skill_targets WHERE project_id = ? AND tool_id = ? AND skill_id = ? AND link_path = ?")
        .run(projectId, toolId, skillId, linkPath);
    } else {
      this.db
        .prepare("DELETE FROM project_skill_targets WHERE project_id = ? AND tool_id = ? AND skill_id = ?")
        .run(projectId, toolId, skillId);
    }
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

  createProjectDetail(projectId: string, query = "", options: { includeSessions?: boolean } = {}) {
    const project = this.getProject(projectId);
    if (!project) return null;
    const includeSessions = options.includeSessions ?? true;
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
      .map(([key, groupSessions]) => this.detailGroup(project.rootPath, key, groupSessions, false, { includeSessions }))
      .sort((a, b) => compareNullableIsoDesc(a.latestActivity, b.latestActivity));

    return {
      project,
      groups: [
        this.detailGroup(project.rootPath, project.normalizedRootPath, rootSessions, true, { includeSessions }),
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

  private agentHubSourceFromRow(row: Row): AgentHubSource {
    return {
      id: String(row.id),
      type: String(row.type) as AgentHubSource["type"],
      label: String(row.label),
      inputPath: row.input_path === null ? null : String(row.input_path),
      resolvedPath: row.resolved_path === null ? null : String(row.resolved_path),
      sourceTruthTool: String(row.source_truth_tool) as AgentHubToolId,
      importedAt: String(row.imported_at),
      metadata: parseJson<Record<string, unknown>>(String(row.metadata_json), {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private agentHubAgentFromRow(row: Row, sources: Map<string, AgentHubSource>): AgentHubAgent {
    const sourceId = String(row.source_id);
    return {
      id: String(row.id),
      sourceId,
      sourceType: String(row.source_type) as AgentHubAgent["sourceType"],
      sourceTruthTool: String(row.source_truth_tool) as AgentHubToolId,
      truthRole: String(row.truth_role) as AgentHubAgent["truthRole"],
      sourceFormat: String(row.source_format) as AgentHubAgent["sourceFormat"],
      slug: String(row.slug),
      name: String(row.name),
      description: row.description === null ? null : String(row.description),
      nativePath: String(row.native_path),
      libraryRelativePath: String(row.library_relative_path),
      sourceRelativePath: row.source_relative_path === null ? null : String(row.source_relative_path),
      category: row.category === null ? null : String(row.category),
      projection: parseJson<AgentHubAgent["projection"]>(String(row.projection_json), {
        name: String(row.name),
        description: row.description === null ? null : String(row.description),
        body: "",
        slugCandidate: String(row.slug),
        parseWarnings: []
      }),
      nativeMetadata: parseJson<Record<string, unknown>>(String(row.native_metadata_json), {}),
      contentHash: String(row.content_hash),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      source: sources.get(sourceId) ?? null
    };
  }

  private pluginHubSourceFromRow(row: Row): PluginHubSource {
    const inputPath = String(row.input_path);
    return {
      id: String(row.id),
      type: (row.type === "github" ? "github" : "local") as PluginHubSource["type"],
      kind: String(row.kind) as PluginHubSource["kind"],
      label: String(row.label),
      repoKey: row.repo_key === null || row.repo_key === undefined ? null : String(row.repo_key),
      owner: row.owner === null || row.owner === undefined ? null : String(row.owner),
      repo: row.repo === null || row.repo === undefined ? null : String(row.repo),
      branch: row.branch === null || row.branch === undefined ? null : String(row.branch),
      input: row.input === null || row.input === undefined ? inputPath : String(row.input),
      inputPath,
      sourcePath: row.source_path === null || row.source_path === undefined ? null : String(row.source_path),
      resolvedPath: String(row.resolved_path),
      currentRevision: row.current_revision === null || row.current_revision === undefined ? null : String(row.current_revision),
      checkoutPath: row.checkout_path === null || row.checkout_path === undefined ? null : String(row.checkout_path),
      pluginCount: Number(row.plugin_count),
      componentCount: Number(row.component_count),
      privateFileCount: Number(row.private_file_count),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private pluginHubPluginFromRow(row: Row, sources: Map<string, PluginHubSource>): PluginHubPlugin {
    const sourceId = row.source_id === null ? null : String(row.source_id);
    return {
      id: String(row.id),
      kind: String(row.kind) as PluginHubPlugin["kind"],
      sourceId,
      name: String(row.name),
      displayName: String(row.display_name),
      description: row.description === null ? null : String(row.description),
      componentRefs: parseJson<PluginHubPlugin["componentRefs"]>(String(row.component_refs_json), []),
      privateFiles: parseJson<PluginHubPlugin["privateFiles"]>(String(row.private_files_json), []),
      harnessSupport: parseJson<PluginHubPlugin["harnessSupport"]>(String(row.harness_support_json), {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      source: sourceId ? sources.get(sourceId) ?? null : null
    };
  }

  private projectPluginBindingFromRow(row: Row, plugins: Map<string, PluginHubPlugin>): ProjectPluginBinding {
    const pluginId = String(row.plugin_id);
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      targetRootPath: String(row.target_root_path),
      toolId: String(row.tool_id) as ToolId,
      pluginId,
      managedComponentCount: Number(row.managed_component_count),
      existingComponentCount: Number(row.existing_component_count),
      privateFileCount: Number(row.private_file_count),
      topologyHash: String(row.topology_hash),
      componentOwnership: parseJson<ProjectPluginBinding["componentOwnership"]>(String(row.component_ownership_json), []),
      privateFileOwnership: parseJson<ProjectPluginBinding["privateFileOwnership"]>(String(row.private_file_ownership_json), []),
      installedAt: String(row.installed_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      plugin: plugins.get(pluginId) ?? null
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

  private cliHubCliFromRow(row: Row): CliHubCli {
    return {
      cliId: String(row.cli_id),
      displayName: String(row.display_name),
      kind: String(row.kind) as CliHubCli["kind"],
      sourceType: String(row.source_type) as CliHubCli["sourceType"],
      sourceState: String(row.source_state) as CliHubCli["sourceState"],
      commandNames: parseJson<string[]>(String(row.command_names_json), []),
      localPath: row.local_path === null ? null : String(row.local_path),
      channels: parseJson<CliHubCli["channels"]>(String(row.channels_json), []),
      availabilityState: String(row.availability_state) as CliHubCli["availabilityState"],
      resolvedPaths: parseJson<string[]>(String(row.resolved_paths_json), []),
      version: row.version === null ? null : String(row.version),
      versionState: String(row.version_state) as CliHubCli["versionState"],
      versionError: row.version_error === null ? null : String(row.version_error),
      discoveredAt: row.discovered_at === null ? null : String(row.discovered_at),
      currentProvider:
        row.current_provider_json === null ? null : parseJson<CliHubCli["currentProvider"]>(String(row.current_provider_json), null),
      providerCandidates: parseJson<CliHubCli["providerCandidates"]>(String(row.provider_candidates_json), []),
      updateStatus: String(row.update_status) as CliHubCli["updateStatus"],
      updateCheckedAt: row.update_checked_at === null ? null : String(row.update_checked_at),
      updateError: row.update_error === null ? null : String(row.update_error),
      recentOperation:
        row.recent_operation_json === null ? null : parseJson<CliHubCli["recentOperation"]>(String(row.recent_operation_json), null),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mcpHubServerFromRow(row: Row): McpHubServer {
    return {
      serverId: String(row.server_id),
      name: row.name === null ? null : String(row.name),
      description: row.description === null ? null : String(row.description),
      transport: String(row.transport) as McpHubServer["transport"],
      command: row.command === null ? null : String(row.command),
      args: parseJson<string[]>(String(row.args_json), []),
      url: row.url === null ? null : String(row.url),
      headers: parseJson<Record<string, string>>(String(row.headers_json), {}),
      env: parseJson<Record<string, string>>(String(row.env_json), {}),
      requiredEnv: parseJson<string[]>(String(row.required_env_json), []),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private hookHubSuiteFromRow(row: Row): HookHubSuite {
    const payloads = parseJson<Partial<Record<HookHubSupportedToolId, unknown>>>(String(row.payloads_json), {});
    const toolIds = (Object.keys(payloads) as HookHubSupportedToolId[]).filter((toolId) => isHookHubSupportedToolId(toolId));
    return {
      suiteId: String(row.suite_id),
      name: String(row.name),
      description: row.description === null ? null : String(row.description),
      riskNotes: row.risk_notes === null ? null : String(row.risk_notes),
      requiredEnv: parseJson<string[]>(String(row.required_env_json), []),
      payloads,
      toolIds,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
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

  private projectHookBindingFromRow(row: Row): ProjectHookBinding {
    return {
      projectId: String(row.project_id),
      targetRootPath: String(row.target_root_path),
      toolId: String(row.tool_id) as HookHubSupportedToolId,
      suiteId: String(row.suite_id),
      configPath: String(row.config_path),
      scope: "project",
      appliedFingerprint: String(row.applied_fingerprint),
      appliedAt: String(row.applied_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private projectAgentTargetFromRow(row: Row, agents: Map<string, AgentHubAgent>): ProjectAgentTarget {
    const agentId = String(row.agent_id);
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      targetRootPath: String(row.target_root_path),
      toolId: String(row.tool_id) as AgentHubToolId,
      agentId,
      outputPath: String(row.output_path),
      appliedSourceHash: String(row.applied_source_hash),
      appliedOutputHash: String(row.applied_output_hash),
      appliedAt: String(row.applied_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      agent: agents.get(agentId) ?? null
    };
  }

  private projectMcpBindingFromRow(row: Row): ProjectMcpBinding {
    return {
      projectId: String(row.project_id),
      targetRootPath: String(row.target_root_path),
      toolId: String(row.tool_id) as McpHubTargetToolId,
      serverId: String(row.server_id),
      appliedServerId: String(row.applied_server_id),
      appliedAt: String(row.applied_at),
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

  private detailGroup(rootPath: string, normalizedPath: string, sessions: SessionEntry[], isRoot: boolean, options: { includeSessions?: boolean } = {}) {
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
          sessions: options.includeSessions === false ? [] : sortedSessions
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

function isHookHubSupportedToolId(value: string): value is HookHubSupportedToolId {
  return value === "claude" || value === "codex" || value === "qwen" || value === "qoder";
}
