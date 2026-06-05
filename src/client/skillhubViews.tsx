import React, { useEffect, useMemo, useState } from "react";
import type {
  ProjectSkillTargetsState,
  ProjectSkillUpdateResult,
  ProjectLocalSkill,
  ProjectLocalSkillMigrationTarget,
  ProjectLocalSkillsState,
  RuleSyncDirection,
  RuleSyncStatus,
  SkillHubList,
  SkillHubOpenTarget,
  SkillHubSourceUpdatePreview,
  ToolId
} from "../shared/types.js";

type SkillHubSkill = SkillHubList["skills"][number];
type SkillHubSource = SkillHubList["sources"][number];

const DIRECT_SKILLS_SOURCE_ID = "skills";
const NEW_LOCAL_SOURCE_VALUE = "__new-local-source__";

interface SkillHubSourceSummary {
  id: string;
  type: SkillHubSource["type"];
  label: string;
}

interface SkillHubSourceGroup {
  source: SkillHubSourceSummary;
  skills: SkillHubSkill[];
}

interface MigrationSourceOption {
  id: string;
  label: string;
  path: string | null;
}

type ProjectSkillsTab = "skillhub" | "local" | "plugin";

interface ProjectLocalSkillMigrationItem {
  toolId: ToolId;
  folderName: string;
}

export function SkillHubPage({
  skillHub,
  query,
  updatePreviews,
  busy,
  onQueryChange,
  onPickLocalPath,
  onImportLocal,
  onImportGitHub,
  onOpenSkill,
  onDeleteSkill,
  onApplyUpdate
}: {
  skillHub: SkillHubList | null;
  query: string;
  updatePreviews: SkillHubSourceUpdatePreview[];
  busy: boolean;
  onQueryChange: (query: string) => void;
  onPickLocalPath: () => Promise<string | null>;
  onImportLocal: (path: string) => void;
  onImportGitHub: (input: string) => void;
  onOpenSkill: (skillId: string, target: SkillHubOpenTarget) => void;
  onDeleteSkill: (skillId: string) => void;
  onApplyUpdate: (preview: SkillHubSourceUpdatePreview) => void;
}) {
  const [localPath, setLocalPath] = useState("");
  const [githubInput, setGithubInput] = useState("");
  const [selectedUpdatePreview, setSelectedUpdatePreview] = useState<SkillHubSourceUpdatePreview | null>(null);
  const sourceGroups = useMemo(() => groupSkillHubSkills(skillHub), [skillHub]);
  const updatePreviewBySourceId = useMemo(() => {
    const previews = new Map<string, SkillHubSourceUpdatePreview>();
    for (const preview of updatePreviews) {
      if (preview.hasUpdates) previews.set(preview.source.id, preview);
    }
    return previews;
  }, [updatePreviews]);
  const emptyTitle = query.trim() ? "没有匹配技能" : "还没有技能";
  const emptyDescription = query.trim() ? "调整搜索条件后再试。" : "从本地目录或 GitHub source 导入技能后，会显示在这里。";

  async function pickLocalPath() {
    const selected = await onPickLocalPath();
    if (selected) setLocalPath(selected);
  }

  return (
    <section className="content skillhub-page">
      {selectedUpdatePreview ? (
        <SkillHubUpdatePreviewDialog
          preview={selectedUpdatePreview}
          busy={busy}
          onClose={() => setSelectedUpdatePreview(null)}
          onApplyUpdate={(preview) => {
            setSelectedUpdatePreview(null);
            onApplyUpdate(preview);
          }}
        />
      ) : null}

      <section className="toolbar-panel compact skillhub-search-panel" aria-label="搜索技能">
        <label className="field wide">
          搜索技能
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="文件夹、名称、描述、路径或来源" />
        </label>
      </section>

      <details className="toolbar-panel compact hub-import-panel skillhub-import-panel" role="region" aria-label="技能导入">
        <summary>
          <span className="hub-import-title">技能导入</span>
          <span className="metric-pill">本地 / GitHub</span>
        </summary>
        <div className="hub-import-body skillhub-import-grid">
          <label className="field wide">
            本地技能路径
            <input value={localPath} onChange={(event) => setLocalPath(event.target.value)} placeholder="选择单个技能、skills 目录或父目录" />
          </label>
          <div className="inline-actions">
            <button className="secondary" type="button" disabled={busy} onClick={() => void pickLocalPath()}>
              选择文件夹
            </button>
            <button className="primary" type="button" disabled={busy || !localPath.trim()} onClick={() => onImportLocal(localPath.trim())}>
              导入本地技能
            </button>
          </div>
          <label className="field wide">
            GitHub 来源
            <input value={githubInput} onChange={(event) => setGithubInput(event.target.value)} placeholder="owner/repo、URL、tree URL 或 SSH URL" />
          </label>
          <div className="inline-actions">
            <button className="primary" type="button" disabled={busy || !githubInput.trim()} onClick={() => onImportGitHub(githubInput.trim())}>
              导入GitHub技能
            </button>
          </div>
        </div>
      </details>

      {!skillHub ? (
        <div className="empty-state">
          <h2>正在读取技能</h2>
        </div>
      ) : sourceGroups.length === 0 ? (
        <div className="empty-state">
          <h2>{emptyTitle}</h2>
          <p>{emptyDescription}</p>
        </div>
      ) : (
        <section className="skillhub-source-list" aria-label="技能来源">
          {sourceGroups.map((group) => {
            const updatePreview = updatePreviewBySourceId.get(group.source.id);
            return (
              <details className="skillhub-source-group" key={group.source.id}>
                <summary>
                  <span className="skillhub-source-main">
                    <span className="skillhub-source-title">{group.source.label}</span>
                    <span className="metric-pill">{group.source.type}</span>
                  </span>
                  <span className="skillhub-source-actions">
                    {updatePreview ? (
                      <button
                        className="primary"
                        type="button"
                        disabled={busy}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setSelectedUpdatePreview(updatePreview);
                        }}
                      >
                        更新
                      </button>
                    ) : null}
                    <span className="metric-pill strong">{group.skills.length} 个技能</span>
                  </span>
                </summary>
                <div className="skillhub-skill-list">
                  {group.skills.map((skill) => (
                    <details className="skillhub-skill-row" key={skill.id}>
                      <summary>
                        <span className="skillhub-skill-title">{skill.folderName}</span>
                        {skill.skillName && skill.skillName !== skill.folderName ? <small>{skill.skillName}</small> : null}
                      </summary>
                      <div className="skillhub-skill-body">
                        <p>{skill.description ?? "无描述"}</p>
                        <div className="card-actions">
                          <button className="secondary" type="button" disabled={busy} onClick={() => onOpenSkill(skill.id, "document")}>
                            阅读
                          </button>
                          <button className="secondary" type="button" disabled={busy} onClick={() => onOpenSkill(skill.id, "folder")}>
                            管理
                          </button>
                          <button className="danger" type="button" disabled={busy} onClick={() => onDeleteSkill(skill.id)}>
                            删除
                          </button>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            );
          })}
        </section>
      )}
    </section>
  );
}

function groupSkillHubSkills(skillHub: SkillHubList | null): SkillHubSourceGroup[];
function groupSkillHubSkills(skills: SkillHubSkill[], sources?: SkillHubSource[]): SkillHubSourceGroup[];
function groupSkillHubSkills(skillHubOrSkills: SkillHubList | SkillHubSkill[] | null, sourceList: SkillHubSource[] = []): SkillHubSourceGroup[] {
  if (!skillHubOrSkills) return [];
  const skills = Array.isArray(skillHubOrSkills) ? skillHubOrSkills : skillHubOrSkills.skills;
  const skillHubSources = Array.isArray(skillHubOrSkills) ? sourceList : skillHubOrSkills.sources;
  const sources = new Map(skillHubSources.map((source) => [source.id, source]));
  const groups = new Map<string, SkillHubSourceGroup>();
  for (const source of skillHubSources) {
    groups.set(source.id, { source: skillHubSourceSummary(source), skills: [] });
  }
  for (const skill of skills) {
    const source = skill.source ?? sources.get(skill.sourceId);
    const summary = source
      ? skillHubSourceSummary(source)
      : { id: skill.sourceId, type: skill.sourceType, label: skill.source?.label ?? skill.sourceId };
    let group = groups.get(summary.id);
    if (!group) {
      group = { source: summary, skills: [] };
      groups.set(summary.id, group);
    }
    group.skills.push(skill);
  }
  return [...groups.values()].filter((group) => group.skills.length > 0);
}

function skillHubSourceSummary(source: SkillHubSource): SkillHubSourceSummary {
  return {
    id: source.id,
    type: source.type,
    label: source.label
  };
}

export function ProjectSkillsPanel({
  skillState,
  localSkillState,
  busy,
  lastResult,
  onClose,
  onUpdateSkill,
  onPickDirectory,
  onMigrateLocalSkills
}: {
  skillState: ProjectSkillTargetsState | null;
  localSkillState: ProjectLocalSkillsState | null;
  busy: boolean;
  lastResult: ProjectSkillUpdateResult | null;
  onClose: () => void;
  onUpdateSkill: (skillId: string, toolIds: ToolId[]) => void;
  onPickDirectory: () => Promise<string | null>;
  onMigrateLocalSkills: (skills: ProjectLocalSkillMigrationItem[], target: ProjectLocalSkillMigrationTarget) => void;
}) {
  const [activeTab, setActiveTab] = useState<ProjectSkillsTab>("skillhub");

  return (
    <aside className="side-panel project-skills-panel" aria-label="项目技能管理">
      <header>
        <div>
          <span className="eyebrow">项目技能</span>
          <h2>技能</h2>
        </div>
        <button className="secondary" type="button" onClick={onClose} disabled={busy}>
          关闭
        </button>
      </header>

      <div className="segmented-tabs project-skill-tabs" role="tablist" aria-label="技能类型">
        <button
          className={activeTab === "skillhub" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={activeTab === "skillhub"}
          onClick={() => setActiveTab("skillhub")}
        >
          SkillHub技能
        </button>
        <button
          className={activeTab === "local" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={activeTab === "local"}
          onClick={() => setActiveTab("local")}
        >
          本地技能
        </button>
        <button
          className={activeTab === "plugin" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={activeTab === "plugin"}
          onClick={() => setActiveTab("plugin")}
        >
          Plugin
        </button>
      </div>

      {activeTab === "skillhub" ? (
        <ProjectSkillTabContent state={skillState} localSkillState={localSkillState} busy={busy} lastResult={lastResult} onUpdateSkill={onUpdateSkill} />
      ) : activeTab === "local" ? (
        <ProjectLocalSkillTabContent
          state={localSkillState}
          busy={busy}
          onPickDirectory={onPickDirectory}
          onMigrateLocalSkills={onMigrateLocalSkills}
        />
      ) : (
        <ProjectPluginSkillTabContent state={localSkillState} />
      )}
    </aside>
  );
}

function ProjectSkillTabContent({
  state,
  localSkillState,
  busy,
  lastResult,
  onUpdateSkill
}: {
  state: ProjectSkillTargetsState | null;
  localSkillState: ProjectLocalSkillsState | null;
  busy: boolean;
  lastResult: ProjectSkillUpdateResult | null;
  onUpdateSkill: (skillId: string, toolIds: ToolId[]) => void;
}) {
  const [query, setQuery] = useState("");
  const enabledToolTargets = useMemo(() => state?.toolTargets.filter((target) => target.enabled) ?? [], [state]);
  const pluginOwnedSkillIds = useMemo(
    () => new Set((localSkillState?.skills ?? []).filter((skill) => skill.type === "plugin" && skill.skillHubSkill).map((skill) => skill.skillHubSkill?.id as string)),
    [localSkillState]
  );
  const filteredSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (state?.skills ?? []).filter((skill) => {
      if (!normalized) return true;
      return [skill.folderName, skill.skillName ?? "", skill.description ?? "", skill.libraryRelativePath, skill.source?.label ?? ""]
        .join("\n")
        .toLowerCase()
        .includes(normalized);
    });
  }, [query, state]);
  const sourceGroups = useMemo(() => groupSkillHubSkills(filteredSkills), [filteredSkills]);

  return (
    <div className="project-skill-tab-panel" role="tabpanel">
      {!state ? (
        <div className="muted">正在读取项目技能...</div>
      ) : (
        <>
          <label className="field wide">
            搜索技能
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选 SkillHub 技能" />
          </label>

          {lastResult?.failures.length ? (
            <div className="inline-warning" role="alert">
              {lastResult.failures.map((failure) => `${failure.toolId}: ${failure.reason}`).join("；")}
            </div>
          ) : null}

          <div className="project-skill-list">
            {sourceGroups.length === 0 ? (
              <div className="empty-state compact">没有可用技能</div>
            ) : (
              sourceGroups.map((group) => (
                <details className="project-skill-source-group skillhub-source-group" key={group.source.id}>
                  <summary>
                    <span className="skillhub-source-main">
                      <span className="skillhub-source-title">{group.source.label}</span>
                      <span className="metric-pill">{group.source.type}</span>
                    </span>
                    <span className="skillhub-source-actions">
                      <span className="metric-pill strong">{group.skills.length} 个技能</span>
                    </span>
                  </summary>
                  <div className="project-skill-source-body">
                    {group.skills.map((skill) => {
                      const active = state.skillTargets.filter((target) => target.skillId === skill.id).map((target) => target.toolId);
                      const supportedEnabled = enabledToolTargets.filter((target) => target.supported).map((target) => target.toolId);
                      const checked = supportedEnabled.length > 0 && supportedEnabled.every((toolId) => active.includes(toolId));
                      const indeterminate = supportedEnabled.some((toolId) => active.includes(toolId)) && !checked;
                      const pluginOwned = pluginOwnedSkillIds.has(skill.id);
                      return (
                        <details className="skill-target-row" key={skill.id}>
                          <summary>
                            <IndeterminateCheckbox
                              checked={checked}
                              indeterminate={indeterminate}
                              disabled={busy || supportedEnabled.length === 0 || pluginOwned}
                              onChange={(next) => onUpdateSkill(skill.id, next ? supportedEnabled : [])}
                            />
                            <span>{skill.folderName}</span>
                            {pluginOwned ? <span className="metric-pill warning">Plugin managed</span> : null}
                          </summary>
                          <p>{skill.description ?? skill.skillName ?? "无描述"}</p>
                          {pluginOwned ? <div className="inline-warning">该技能由项目 Plugin 管理，请从 Plugin 入口卸载或同步。</div> : null}
                          <div className="tool-chip-list">
                            {enabledToolTargets.length === 0 ? <div className="empty-state compact">还没有项目使用工具</div> : null}
                            {enabledToolTargets.map((target) => (
                              <label className="tool-target-chip" key={`${skill.id}:${target.toolId}`} title={target.reason ?? target.skillDirectory ?? target.toolId}>
                                <input
                                  type="checkbox"
                                  checked={active.includes(target.toolId)}
                                  disabled={busy || !target.supported || pluginOwned}
                                  onChange={(event) => {
                                    const next = event.target.checked
                                      ? [...active, target.toolId]
                                      : active.filter((toolId) => toolId !== target.toolId);
                                    onUpdateSkill(skill.id, uniqueToolIds(next));
                                  }}
                                />
                                <span>{target.toolId}</span>
                              </label>
                            ))}
                          </div>
                        </details>
                      );
                    })}
                  </div>
                </details>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ProjectLocalSkillTabContent({
  state,
  busy,
  onPickDirectory,
  onMigrateLocalSkills
}: {
  state: ProjectLocalSkillsState | null;
  busy: boolean;
  onPickDirectory: () => Promise<string | null>;
  onMigrateLocalSkills: (skills: ProjectLocalSkillMigrationItem[], target: ProjectLocalSkillMigrationTarget) => void;
}) {
  const skillHubSkills = useMemo(() => state?.skills.filter((skill) => skill.type === "skillhub") ?? [], [state]);
  const localSkills = useMemo(() => state?.skills.filter((skill) => skill.type === "local") ?? [], [state]);
  const migrationSources = useMemo(() => localSkillMigrationSourceOptions(state?.migrationSources ?? []), [state]);
  const [migrationMode, setMigrationMode] = useState(false);
  const [selectedSkillKeys, setSelectedSkillKeys] = useState<string[]>([]);
  const [migrationDialogOpen, setMigrationDialogOpen] = useState(false);
  const selectedLocalSkills = useMemo(
    () => localSkills.filter((skill) => selectedSkillKeys.includes(localSkillKey(skill))),
    [localSkills, selectedSkillKeys]
  );

  useEffect(() => {
    setSelectedSkillKeys((current) =>
      current.filter((key) => localSkills.some((skill) => skill.migratable && localSkillKey(skill) === key))
    );
  }, [localSkills]);

  function cancelMigrationMode() {
    setMigrationMode(false);
    setMigrationDialogOpen(false);
    setSelectedSkillKeys([]);
  }

  function toggleLocalSkill(skill: ProjectLocalSkill, checked: boolean) {
    const key = localSkillKey(skill);
    setSelectedSkillKeys((current) => (checked ? [...new Set([...current, key])] : current.filter((item) => item !== key)));
  }

  function startMigration(target: ProjectLocalSkillMigrationTarget) {
    const migrationItems = selectedLocalSkills.map((skill) => ({ toolId: skill.toolId, folderName: skill.folderName }));
    setMigrationDialogOpen(false);
    setMigrationMode(false);
    setSelectedSkillKeys([]);
    onMigrateLocalSkills(migrationItems, target);
  }

  return (
    <div className="project-local-skill-tab-panel" role="tabpanel">
      {migrationDialogOpen ? (
        <ProjectLocalSkillMigrationDialog
          skills={selectedLocalSkills}
          migrationSources={migrationSources}
          busy={busy}
          onPickDirectory={onPickDirectory}
          onCancel={() => setMigrationDialogOpen(false)}
          onMigrate={startMigration}
        />
      ) : null}

      {!state ? (
        <div className="muted">正在读取本地技能...</div>
      ) : state.skills.length === 0 ? (
        <div className="empty-state compact">没有发现项目技能</div>
      ) : (
        <div className="project-local-skill-list">
          <ProjectLocalSkillGroup
            title="SkillHub"
            skills={skillHubSkills}
            busy={busy}
            selectedSkillKeys={selectedSkillKeys}
            migrationMode={false}
            onToggleSkill={toggleLocalSkill}
          />
          <ProjectLocalSkillGroup
            title="Local"
            skills={localSkills}
            busy={busy}
            selectedSkillKeys={selectedSkillKeys}
            migrationMode={migrationMode}
            onToggleSkill={toggleLocalSkill}
            headerActions={
              <div className="project-local-skill-group-actions">
                <button
                  className="primary"
                  type="button"
                  disabled={busy || (migrationMode && selectedLocalSkills.length === 0)}
                  onClick={() => {
                    if (!migrationMode) {
                      setMigrationMode(true);
                      return;
                    }
                    setMigrationDialogOpen(true);
                  }}
                >
                  {migrationMode ? "开始迁移" : "迁移到SkillHub"}
                </button>
                {migrationMode ? (
                  <button className="secondary" type="button" disabled={busy} onClick={cancelMigrationMode}>
                    取消迁移
                  </button>
                ) : null}
              </div>
            }
          />
        </div>
      )}
    </div>
  );
}

function ProjectPluginSkillTabContent({ state }: { state: ProjectLocalSkillsState | null }) {
  const pluginSkills = useMemo(() => state?.skills.filter((skill) => skill.type === "plugin") ?? [], [state]);
  const groups = useMemo(() => {
    const byPlugin = new Map<string, { label: string; skills: ProjectLocalSkill[] }>();
    for (const skill of pluginSkills) {
      const pluginId = skill.plugin?.id ?? "unknown";
      const label = skill.plugin?.displayName ?? "Unknown Plugin";
      const current = byPlugin.get(pluginId) ?? { label, skills: [] };
      current.skills.push(skill);
      byPlugin.set(pluginId, current);
    }
    return [...byPlugin.entries()].map(([id, group]) => ({ id, ...group }));
  }, [pluginSkills]);

  return (
    <div className="project-plugin-skill-tab-panel" role="tabpanel">
      {!state ? (
        <div className="muted">正在读取 Plugin 技能...</div>
      ) : groups.length === 0 ? (
        <div className="empty-state compact">还没有 Plugin 技能</div>
      ) : (
        <div className="project-local-skill-list">
          {groups.map((group) => (
            <ProjectLocalSkillGroup
              key={group.id}
              title={group.label}
              skills={group.skills}
              busy={true}
              selectedSkillKeys={[]}
              migrationMode={false}
              onToggleSkill={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectLocalSkillGroup({
  title,
  skills,
  busy,
  migrationMode,
  selectedSkillKeys,
  headerActions,
  onToggleSkill
}: {
  title: string;
  skills: ProjectLocalSkill[];
  busy: boolean;
  migrationMode: boolean;
  selectedSkillKeys: string[];
  headerActions?: React.ReactNode;
  onToggleSkill: (skill: ProjectLocalSkill, checked: boolean) => void;
}) {
  return (
    <section className="project-local-skill-group" aria-label={`${title} 技能`}>
      <div className="section-title compact project-local-skill-group-title">
        <div className="project-local-skill-group-heading">
          <h3>{title}</h3>
          <span className="metric-pill strong">{skills.length} 个技能</span>
        </div>
        {headerActions}
      </div>
      {skills.length === 0 ? (
        <div className="empty-state compact">没有{title}技能</div>
      ) : (
        <div className="project-local-skill-group-list">
          {skills.map((skill) => (
            <ProjectLocalSkillRow
              key={`${skill.type}:${skill.toolId}:${skill.folderName}`}
              skill={skill}
              busy={busy}
              selected={selectedSkillKeys.includes(localSkillKey(skill))}
              migrationMode={migrationMode}
              onToggleSkill={onToggleSkill}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectLocalSkillRow({
  skill,
  busy,
  selected,
  migrationMode,
  onToggleSkill
}: {
  skill: ProjectLocalSkill;
  busy: boolean;
  selected: boolean;
  migrationMode: boolean;
  onToggleSkill: (skill: ProjectLocalSkill, checked: boolean) => void;
}) {
  return (
    <details className="project-local-skill-row skillhub-skill-row">
      <summary>
        {migrationMode && skill.type === "local" ? (
          <input
            aria-label={`选择 ${skill.folderName}`}
            type="checkbox"
            checked={selected}
            disabled={busy || !skill.migratable}
            title={skill.reason ?? undefined}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onToggleSkill(skill, event.target.checked)}
          />
        ) : null}
        <span className="skillhub-skill-title">{skill.folderName}</span>
        {skill.skillName && skill.skillName !== skill.folderName ? <small>{skill.skillName}</small> : null}
      </summary>
      <div className="skillhub-skill-body">
        <p>{skill.description ?? skill.skillName ?? "无描述"}</p>
        <div className="project-local-skill-title">
          <span className="metric-pill">{skill.toolId}</span>
          <span className="metric-pill">{skill.type === "plugin" ? "Plugin" : skill.type === "skillhub" ? "SkillHub" : "Local"}</span>
        </div>
        <small>{skill.skillHubSkill?.libraryRelativePath ?? skill.skillPath}</small>
        {!skill.migratable && skill.reason ? <div className="inline-warning">{skill.reason}</div> : null}
      </div>
    </details>
  );
}

function ProjectLocalSkillMigrationDialog({
  skills,
  migrationSources,
  busy,
  onPickDirectory,
  onCancel,
  onMigrate
}: {
  skills: ProjectLocalSkill[];
  migrationSources: MigrationSourceOption[];
  busy: boolean;
  onPickDirectory: () => Promise<string | null>;
  onCancel: () => void;
  onMigrate: (target: ProjectLocalSkillMigrationTarget) => void;
}) {
  const defaultSourceId = migrationSources[0]?.id ?? DIRECT_SKILLS_SOURCE_ID;
  const [targetValue, setTargetValue] = useState(defaultSourceId);
  const [newSourcePath, setNewSourcePath] = useState("");

  useEffect(() => {
    if (targetValue === NEW_LOCAL_SOURCE_VALUE) return;
    if (!migrationSources.some((source) => source.id === targetValue)) setTargetValue(defaultSourceId);
  }, [defaultSourceId, migrationSources, targetValue]);

  async function pickNewSourcePath() {
    const selected = await onPickDirectory();
    if (selected) setNewSourcePath(selected);
  }

  const selectedSource = migrationSources.find((source) => source.id === targetValue) ?? null;
  const newSourceSelected = targetValue === NEW_LOCAL_SOURCE_VALUE;
  const target: ProjectLocalSkillMigrationTarget = newSourceSelected
    ? { type: "new-source", path: newSourcePath.trim() }
    : { type: "existing-source", sourceId: targetValue || DIRECT_SKILLS_SOURCE_ID };
  const startDisabled = busy || skills.length === 0 || (newSourceSelected && !newSourcePath.trim());

  return (
    <div className="settings-backdrop" role="presentation">
      <section
        className="settings-dialog project-local-skill-migration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-local-skill-migration-title"
      >
        <header>
          <div>
            <span className="eyebrow">SkillHub</span>
            <h2 id="project-local-skill-migration-title">迁移技能</h2>
          </div>
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            取消
          </button>
        </header>

        <div className="project-local-skill-migration-summary">
          <strong>{skills.length} 个本地技能</strong>
          <div className="project-local-skill-migration-list">
            {skills.map((skill) => (
              <span className="metric-pill" key={localSkillKey(skill)}>
                {skill.folderName}
              </span>
            ))}
          </div>
        </div>

        <label className="field wide">
          迁移目录
          <select value={targetValue} onChange={(event) => setTargetValue(event.target.value)} disabled={busy}>
            {migrationSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
            <option value={NEW_LOCAL_SOURCE_VALUE}>新建 source 目录</option>
          </select>
        </label>

        {newSourceSelected ? (
          <div className="project-local-skill-new-source">
            <input
              aria-label="新 source 目录"
              value={newSourcePath}
              onChange={(event) => setNewSourcePath(event.target.value)}
              placeholder="选择或输入新 source 目录"
              disabled={busy}
            />
            <button className="secondary" type="button" onClick={() => void pickNewSourcePath()} disabled={busy}>
              选择目录
            </button>
          </div>
        ) : selectedSource?.path ? (
          <small className="path-line">{selectedSource.path}</small>
        ) : null}

        <div className="settings-actions">
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            取消迁移
          </button>
          <button className="primary" type="button" disabled={startDisabled} onClick={() => onMigrate(target)}>
            开始迁移
          </button>
        </div>
      </section>
    </div>
  );
}

function localSkillKey(skill: Pick<ProjectLocalSkill, "toolId" | "folderName">): string {
  return `${skill.toolId}:${skill.folderName}`;
}

function localSkillMigrationSourceOptions(sources: SkillHubSource[]): MigrationSourceOption[] {
  const options: MigrationSourceOption[] = sources
    .filter((source) => source.type === "local")
    .map((source) => ({
      id: source.id,
      label: source.label || source.id,
      path: source.resolvedPath ?? source.input ?? null
    }));

  if (!options.some((source) => source.id === DIRECT_SKILLS_SOURCE_ID)) {
    options.unshift({ id: DIRECT_SKILLS_SOURCE_ID, label: DIRECT_SKILLS_SOURCE_ID, path: null });
  }

  return options;
}

export function RuleSyncDialog({
  status,
  busy,
  onClose,
  onRefresh,
  onApply
}: {
  status: RuleSyncStatus | null;
  busy: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onApply: (direction: RuleSyncDirection) => void;
}) {
  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog rule-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="rule-sync-title">
        <header>
          <div>
            <span className="eyebrow">规则同步</span>
            <h2 id="rule-sync-title">AGENTS.md / CLAUDE.md</h2>
          </div>
          <button className="secondary" type="button" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </header>
        {!status ? (
          <div className="muted">正在读取规则文件状态...</div>
        ) : (
          <>
            <div className="rule-file-grid">
              {Object.values(status.files).map((file) => (
                <article className="rule-file-card" key={file.file}>
                  <h3>{file.file}</h3>
                  <p>{file.path}</p>
                  <div className="project-meta">
                    <span>{file.exists ? "存在" : "不存在"}</span>
                    <span>{file.gitManaged === null ? "未检测 Git" : file.gitManaged ? "Git 管理" : "未跟踪"}</span>
                    <span>{file.dirty ? "有未提交内容" : "无未提交内容"}</span>
                  </div>
                </article>
              ))}
            </div>
            <div className="settings-actions">
              <button className="secondary" type="button" disabled={busy} onClick={onRefresh}>
                刷新状态
              </button>
              <button
                className="primary"
                type="button"
                disabled={busy || !status.directions["agents-to-claude"].enabled}
                title={status.directions["agents-to-claude"].reason ?? undefined}
                onClick={() => onApply("agents-to-claude")}
              >
                {"AGENTS.md -> CLAUDE.md"}
              </button>
              <button
                className="primary"
                type="button"
                disabled={busy || !status.directions["claude-to-agents"].enabled}
                title={status.directions["claude-to-agents"].reason ?? undefined}
                onClick={() => onApply("claude-to-agents")}
              >
                {"CLAUDE.md -> AGENTS.md"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function SkillHubUpdatePreviewDialog({
  preview,
  busy,
  onClose,
  onApplyUpdate
}: {
  preview: SkillHubSourceUpdatePreview;
  busy: boolean;
  onClose: () => void;
  onApplyUpdate: (preview: SkillHubSourceUpdatePreview) => void;
}) {
  return (
    <div className="settings-backdrop" role="presentation">
      <section
        className="settings-dialog skillhub-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skillhub-update-preview-title"
      >
        <header>
          <div>
            <span className="eyebrow">SkillHub 更新</span>
            <h2 id="skillhub-update-preview-title">{preview.source.label} 更新预览</h2>
          </div>
          <button className="secondary" type="button" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </header>
        <div className="skillhub-update-list">
          {preview.items.map((item, index) => (
            <article className="skillhub-update-item" key={`${preview.source.id}:${index}`}>
              <div>
                <strong>{item.folderName}</strong>
                <p>{item.libraryRelativePath}</p>
              </div>
              <span className="metric-pill">{updateKindLabel(item.kind)}</span>
              {item.destructive ? <span className="metric-pill danger">影响 {item.affectedTargets.length} 个 link</span> : null}
            </article>
          ))}
        </div>
        <div className="settings-actions">
          <button className="secondary" type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="primary" type="button" disabled={busy || !preview.hasUpdates} onClick={() => onApplyUpdate(preview)}>
            应用更新
          </button>
        </div>
      </section>
    </div>
  );
}

function updateKindLabel(kind: SkillHubSourceUpdatePreview["items"][number]["kind"]): string {
  switch (kind) {
    case "added":
      return "新增";
    case "changed":
      return "变更";
    case "deleted":
      return "删除";
    case "moved":
      return "移动";
  }
}

function IndeterminateCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = React.useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />;
}

function uniqueToolIds(toolIds: ToolId[]): ToolId[] {
  return [...new Set(toolIds)];
}
