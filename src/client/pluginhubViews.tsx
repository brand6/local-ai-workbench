import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { isToolId } from "../shared/types.js";
import type {
  AgentHubAgent,
  HookHubSuite,
  McpHubServer,
  PluginHubComponentRef,
  PluginHubComponentType,
  PluginHubCustomPluginInput,
  PluginHubHarnessSupport,
  PluginHubList,
  PluginHubPlugin,
  PluginHubSource,
  ProjectPluginApplyResult,
  ProjectPluginState,
  ProjectToolTarget,
  SkillHubOpenTarget,
  SkillHubSkill,
  ToolId
} from "../shared/types.js";
import { AgentHubAgentRow, groupAgentHubAgents } from "./agenthubViews.js";
import { HookHubSuiteCard } from "./hookhubViews.js";
import { McpHubServerCard } from "./mcphubViews.js";
import { SkillHubSkillRow, groupSkillHubSkills } from "./skillhubViews.js";

type ProjectPluginsTab = "hub" | "local";

type SessionProjectToolTarget = ProjectToolTarget & { toolId: ToolId };

const EMPTY_PROJECT_PLUGINS: PluginHubPlugin[] = [];
const EMPTY_PROJECT_TOOL_TARGETS: SessionProjectToolTarget[] = [];

export function PluginHubPage({
  pluginhub,
  busy,
  onPickLocalPath,
  onImportLocal,
  onImportGitHub,
  onCreateCustom,
  onUpdateCustom,
  onUpdateSource,
  onOpenSkill,
  onOpenAgent,
  onOpenPrivateFile,
  onDeleteSource,
  onDeletePlugin
}: {
  pluginhub: PluginHubList | null;
  busy: boolean;
  onPickLocalPath: () => Promise<string | null>;
  onImportLocal: (inputPath: string) => void;
  onImportGitHub: (input: string) => void;
  onCreateCustom: (input: PluginHubCustomPluginInput) => void;
  onUpdateCustom: (pluginId: string, input: PluginHubCustomPluginInput) => void;
  onUpdateSource: (sourceId: string) => void;
  onOpenSkill: (skillId: string, target: SkillHubOpenTarget) => void;
  onOpenAgent: (agentId: string, target: SkillHubOpenTarget) => void;
  onOpenPrivateFile: (pluginId: string, fileId: string, target: SkillHubOpenTarget) => void;
  onDeleteSource: (sourceId: string) => void;
  onDeletePlugin: (pluginId: string) => void;
}) {
  const [dialog, setDialog] = useState<"import" | "create" | null>(null);
  const [editingPlugin, setEditingPlugin] = useState<PluginHubPlugin | null>(null);

  return (
    <section className="content pluginhub-page">
      {dialog === "import" ? (
        <PluginHubImportDialog
          busy={busy}
          onClose={() => setDialog(null)}
          onPickLocalPath={onPickLocalPath}
          onImportLocal={onImportLocal}
          onImportGitHub={onImportGitHub}
        />
      ) : null}
      {dialog === "create" ? (
        <PluginHubCustomDialog
          busy={busy}
          skills={pluginhub?.skills ?? []}
          agents={pluginhub?.agents ?? []}
          mcpServers={pluginhub?.mcpServers ?? []}
          hookSuites={pluginhub?.hookSuites ?? []}
          onClose={() => setDialog(null)}
          onSubmitCustom={onCreateCustom}
        />
      ) : null}
      {editingPlugin ? (
        <PluginHubCustomDialog
          busy={busy}
          plugin={editingPlugin}
          skills={pluginhub?.skills ?? []}
          agents={pluginhub?.agents ?? []}
          mcpServers={pluginhub?.mcpServers ?? []}
          hookSuites={pluginhub?.hookSuites ?? []}
          onClose={() => setEditingPlugin(null)}
          onSubmitCustom={(input) => onUpdateCustom(editingPlugin.id, input)}
        />
      ) : null}

      <section className="toolbar-panel compact pluginhub-toolbar-panel" aria-label="PluginHub 操作">
        <div className="toolbar">
          <button className="primary" type="button" disabled={busy} onClick={() => setDialog("import")}>
            添加 Plugin
          </button>
          <button className="secondary" type="button" disabled={busy} onClick={() => setDialog("create")}>
            创建 Plugin
          </button>
        </div>
      </section>

      {!pluginhub ? (
        <section className="empty-state">
          <h2>正在读取 PluginHub</h2>
        </section>
      ) : (
        <>
          <section className="toolbar-panel compact pluginhub-section" aria-label="Sources">
            <div className="section-title compact">
              <h2>Sources</h2>
              <span className="metric-pill strong">{pluginhub.sources.length} 个 source</span>
            </div>
            {pluginhub.sources.length === 0 ? (
              <div className="empty-state compact">还没有 Plugin source</div>
            ) : (
              <div className="pluginhub-list">
                {pluginhub.sources.map((source) => (
                  <details className="pluginhub-row" key={source.id}>
                    <summary>
                      <span className="pluginhub-row-title">{source.label}</span>
                      <span className="metric-pill">{source.type}</span>
                      <span className="metric-pill">{source.kind}</span>
                      <span className="metric-pill">{source.pluginCount} plugins</span>
                    </summary>
                    <div className="pluginhub-row-body">
                      <small>{source.inputPath}</small>
                      <div className="tool-chip-list">
                        <span className="metric-pill">{source.componentCount} components</span>
                        <span className="metric-pill">{source.privateFileCount} private files</span>
                      </div>
                      <div className="row-actions">
                        {source.type === "github" ? (
                          <button className="primary" type="button" disabled={busy} onClick={() => onUpdateSource(source.id)}>
                            更新
                          </button>
                        ) : null}
                        <button className="danger" type="button" disabled={busy} onClick={() => onDeleteSource(source.id)}>
                          删除 source
                        </button>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>

          <SourcePluginListSection
            title="Plugins"
            plugins={pluginhub.sourcePlugins}
            pluginhub={pluginhub}
            busy={busy}
            onOpenSkill={onOpenSkill}
            onOpenAgent={onOpenAgent}
            onOpenPrivateFile={onOpenPrivateFile}
            onDeletePlugin={onDeletePlugin}
          />
          <PluginListSection
            title="Custom Plugins"
            plugins={pluginhub.customPlugins}
            pluginhub={pluginhub}
            busy={busy}
            onOpenSkill={onOpenSkill}
            onOpenAgent={onOpenAgent}
            onOpenPrivateFile={onOpenPrivateFile}
            onDeletePlugin={onDeletePlugin}
            onEditPlugin={setEditingPlugin}
          />
        </>
      )}
    </section>
  );
}

export function ProjectPluginsPanel({
  state,
  busy,
  lastResult,
  onClose,
  onInstall,
  onSync,
  onUninstall
}: {
  state: ProjectPluginState | null;
  busy: boolean;
  lastResult: ProjectPluginApplyResult | null;
  onClose: () => void;
  onInstall: (pluginId: string, toolId: ToolId) => void;
  onSync: (bindingId: string) => void;
  onUninstall: (bindingId: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<ProjectPluginsTab>("local");

  function selectTab(tab: ProjectPluginsTab) {
    setActiveTab(tab);
  }

  return (
    <aside className="side-panel project-plugins-panel" aria-label="项目 Plugin 管理">
      <header>
        <div>
          <span className="eyebrow">项目 Plugin</span>
          <h2>Plugin</h2>
        </div>
        <button className="secondary" type="button" onClick={onClose} disabled={busy}>
          关闭
        </button>
      </header>

      {state ? <p className="path-line">{state.targetRootPath}</p> : null}
      <div className="segmented-tabs project-plugin-tabs" role="tablist" aria-label="Plugin 类型">
        <button className={activeTab === "hub" ? "active" : ""} type="button" role="tab" aria-selected={activeTab === "hub"} onClick={() => selectTab("hub")}>
          Hub Plugin
        </button>
        <button className={activeTab === "local" ? "active" : ""} type="button" role="tab" aria-selected={activeTab === "local"} onClick={() => selectTab("local")}>
          本地 Plugin
        </button>
      </div>

      {activeTab === "hub" ? (
        <ProjectPluginHubTab state={state} busy={busy} onInstall={onInstall} />
      ) : (
        <ProjectPluginLocalTab state={state} busy={busy} lastResult={lastResult} onSync={onSync} onUninstall={onUninstall} />
      )}
    </aside>
  );
}

function ProjectPluginHubTab({
  state,
  busy,
  onInstall
}: {
  state: ProjectPluginState | null;
  busy: boolean;
  onInstall: (pluginId: string, toolId: ToolId) => void;
}) {
  const [preferredToolId, setPreferredToolId] = useState<ToolId>("codex");
  const plugins = state?.plugins ?? EMPTY_PROJECT_PLUGINS;
  const [query, setQuery] = useState("");
  const projectToolTargets = useMemo(
    () =>
      (state?.toolTargets ?? EMPTY_PROJECT_TOOL_TARGETS).filter(
        (target): target is SessionProjectToolTarget => isToolId(target.toolId)
      ),
    [state]
  );
  const filteredPlugins = useMemo(() => filterProjectPlugins(plugins, query), [plugins, query]);
  const sourceGroups = useMemo(() => groupProjectPluginsBySource(filteredPlugins), [filteredPlugins]);
  const selectedToolId = projectToolTargets.some((target) => target.toolId === preferredToolId)
    ? preferredToolId
    : projectToolTargets[0]?.toolId ?? preferredToolId;

  if (!state) return <div className="muted">正在读取项目 Plugin...</div>;

  return (
    <div className="project-plugin-tab-panel" role="tabpanel">
      <label className="field wide">
        搜索 Plugin
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选 Hub Plugin" />
      </label>
      {sourceGroups.length === 0 ? (
        <div className="empty-state compact">没有可用 Plugin</div>
      ) : (
        <section className="project-plugin-hub-list" aria-label="Hub Plugin">
          {sourceGroups.map((group) => (
            <details className="project-plugin-source-group skillhub-source-group" key={group.key}>
              <summary>
                <span className="skillhub-source-main">
                  <span className="skillhub-source-title">{group.label}</span>
                  {group.source ? <span className="metric-pill">{group.source.type}</span> : <span className="metric-pill">{group.kindLabel}</span>}
                  {group.source ? <span className="metric-pill">{group.source.kind}</span> : null}
                </span>
                <span className="skillhub-source-actions">
                  <span className="metric-pill strong">{group.plugins.length} 个 Plugin</span>
                </span>
              </summary>
              <div className="project-plugin-source-body">
                {group.source ? <small className="path-line">{group.source.inputPath}</small> : null}
                <div className="pluginhub-list pluginhub-nested-plugin-list">
                  {group.plugins.map((plugin) => (
                    <ProjectPluginHubPluginRow
                      key={plugin.id}
                      plugin={plugin}
                      bindings={state.bindings}
                      syncRequiredPluginIds={state.syncRequiredPluginIds}
                      projectToolTargets={projectToolTargets}
                      toolId={selectedToolId}
                      busy={busy}
                      onSelectTool={setPreferredToolId}
                      onInstall={onInstall}
                    />
                  ))}
                </div>
              </div>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}

function ProjectPluginHubPluginRow({
  plugin,
  bindings,
  syncRequiredPluginIds,
  projectToolTargets,
  toolId,
  busy,
  onSelectTool,
  onInstall
}: {
  plugin: PluginHubPlugin;
  bindings: ProjectPluginState["bindings"];
  syncRequiredPluginIds: string[];
  projectToolTargets: SessionProjectToolTarget[];
  toolId: ToolId;
  busy: boolean;
  onSelectTool: (toolId: ToolId) => void;
  onInstall: (pluginId: string, toolId: ToolId) => void;
}) {
  const selectedToolTarget = projectToolTargets.find((target) => target.toolId === toolId) ?? null;
  const selectedToolInstallable = Boolean(selectedToolTarget?.supported && pluginToolInstallable(plugin, toolId));
  const installedBindings = bindings.filter((binding) => binding.pluginId === plugin.id);
  const radioName = `project-plugin-tool:${plugin.id}`;

  return (
    <details className="pluginhub-row">
      <summary>
        <span className="pluginhub-row-title">{plugin.displayName}</span>
        <span className="metric-pill">{plugin.kind}</span>
        <span className="metric-pill">{plugin.componentRefs.length} components</span>
        <span className="metric-pill">{plugin.privateFiles.length} files</span>
        {installedBindings.length > 0 ? <span className="metric-pill strong">已安装 {installedBindings.length}</span> : null}
        {syncRequiredPluginIds.includes(plugin.id) ? <span className="metric-pill warning">需要同步</span> : null}
      </summary>
      <div className="pluginhub-row-body">
        {plugin.description ? <p>{plugin.description}</p> : null}
        <div className="tool-chip-list">
          {projectToolTargets.length === 0 ? <div className="empty-state compact">还没有项目使用工具</div> : null}
          {projectToolTargets.map((target) => (
            <ProjectPluginToolChip
              key={`${plugin.id}:${target.toolId}`}
              name={radioName}
              target={target}
              checked={toolId === target.toolId}
              busy={busy}
              pluginSupport={pluginToolSupport(plugin, target.toolId)}
              onSelect={onSelectTool}
            />
          ))}
        </div>
        <div className="row-actions">
          <button className="primary" type="button" disabled={busy || !selectedToolInstallable} onClick={() => onInstall(plugin.id, toolId)}>
            安装
          </button>
        </div>
      </div>
    </details>
  );
}

function ProjectPluginLocalTab({
  state,
  busy,
  lastResult,
  onSync,
  onUninstall
}: {
  state: ProjectPluginState | null;
  busy: boolean;
  lastResult: ProjectPluginApplyResult | null;
  onSync: (bindingId: string) => void;
  onUninstall: (bindingId: string) => void;
}) {
  if (!state) return <div className="muted">正在读取项目 Plugin...</div>;

  return (
    <div className="project-plugin-tab-panel" role="tabpanel">
      {lastResult?.preflight.length ? (
        <div className="inline-warning" role="alert">
          {lastResult.message}：{lastResult.preflight.map((item) => item.targetPath).join("；")}
        </div>
      ) : null}

      <section className="project-plugin-bindings" aria-label="本地 Plugin">
        <div className="section-title compact">
          <h3>本地安装</h3>
          <span className="metric-pill strong">{state.bindings.length} 个 binding</span>
        </div>
        {state.bindings.length === 0 ? (
          <div className="empty-state compact">还没有安装 Plugin</div>
        ) : (
          <div className="pluginhub-list">
            {state.bindings.map((binding) => (
              <details className="pluginhub-row" key={binding.id}>
                <summary>
                  <span className="pluginhub-row-title">{binding.plugin?.displayName ?? binding.pluginId}</span>
                  <span className="metric-pill">{binding.toolId}</span>
                  <span className="metric-pill">
                    {binding.managedComponentCount}/{binding.managedComponentCount + binding.existingComponentCount} managed
                  </span>
                  {state.syncRequiredPluginIds.includes(binding.pluginId) ? <span className="metric-pill warning">需要同步</span> : null}
                </summary>
                <div className="pluginhub-row-body">
                  <small>{binding.targetRootPath}</small>
                  <div className="tool-chip-list">
                    <span className="metric-pill">{binding.privateFileCount} private files</span>
                    <span className="metric-pill">{binding.existingComponentCount} using existing</span>
                  </div>
                  <div className="row-actions">
                    <button className="secondary" type="button" disabled={busy} onClick={() => onSync(binding.id)}>
                      同步
                    </button>
                    <button className="danger" type="button" disabled={busy} onClick={() => onUninstall(binding.id)}>
                      卸载
                    </button>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

type ProjectPluginSourceGroup = {
  key: string;
  label: string;
  kindLabel: string;
  source: PluginHubSource | null;
  plugins: PluginHubPlugin[];
};

function filterProjectPlugins(plugins: PluginHubPlugin[], query: string): PluginHubPlugin[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return plugins;
  return plugins.filter((plugin) =>
    [plugin.displayName, plugin.name, plugin.description ?? "", plugin.kind, plugin.source?.label ?? "", plugin.source?.inputPath ?? "", plugin.sourceId ?? ""]
      .join("\n")
      .toLowerCase()
      .includes(normalized)
  );
}

function groupProjectPluginsBySource(plugins: PluginHubPlugin[]): ProjectPluginSourceGroup[] {
  const groups = new Map<string, ProjectPluginSourceGroup>();
  const customPlugins: PluginHubPlugin[] = [];

  for (const plugin of plugins) {
    if (plugin.kind === "custom" || !plugin.sourceId) {
      customPlugins.push(plugin);
      continue;
    }
    const source = plugin.source;
    const key = source?.id ?? `missing-source:${plugin.sourceId}`;
    const current = groups.get(key) ?? {
      key,
      label: source?.label ?? plugin.sourceId,
      kindLabel: source ? source.kind : "missing source",
      source,
      plugins: []
    };
    current.plugins.push(plugin);
    groups.set(key, current);
  }

  const sourceGroups = [...groups.values()];
  if (customPlugins.length > 0) {
    sourceGroups.push({
      key: "custom-plugins",
      label: "Custom Plugins",
      kindLabel: "custom",
      source: null,
      plugins: customPlugins
    });
  }
  return sourceGroups;
}

function ProjectPluginToolChip({
  name = "project-plugin-tool",
  target,
  checked,
  busy,
  pluginSupport,
  onSelect
}: {
  name?: string;
  target: SessionProjectToolTarget;
  checked: boolean;
  busy: boolean;
  pluginSupport: PluginHubHarnessSupport;
  onSelect: (toolId: ToolId) => void;
}) {
  const disabled = busy || !target.supported || !isPluginHarnessInstallable(pluginSupport);
  const title = pluginToolChipTitle(target, pluginSupport);
  return (
    <label
      className="tool-target-chip"
      title={title}
      onClick={(event) => {
        if (!busy && disabled) {
          event.preventDefault();
          window.alert(title);
        }
      }}
    >
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={() => onSelect(target.toolId)} />
      <span>{target.toolId}</span>
    </label>
  );
}

function pluginToolSupport(plugin: PluginHubPlugin | null, toolId: ToolId): PluginHubHarnessSupport {
  return plugin?.harnessSupport[toolId] ?? "unsupported";
}

function pluginToolInstallable(plugin: PluginHubPlugin | null, toolId: ToolId): boolean {
  return isPluginHarnessInstallable(pluginToolSupport(plugin, toolId));
}

function isPluginHarnessInstallable(support: PluginHubHarnessSupport): boolean {
  return support === "native" || support === "component-only";
}

function pluginToolChipTitle(target: SessionProjectToolTarget, support: PluginHubHarnessSupport): string {
  if (!target.supported) return target.reason ?? "项目未支持该工具";
  if (support === "planned") return "该 Plugin 的目标工具适配尚未实现";
  if (support === "unsupported") return "该 Plugin 不支持安装到该工具";
  if (support === "component-only") return target.skillDirectory ?? "通过组件 Hub 安装";
  return target.skillDirectory ?? "原生 Plugin package";
}

type SourcePluginGroup = {
  source: PluginHubSource | null;
  plugins: PluginHubPlugin[];
};

function SourcePluginListSection({
  title,
  plugins,
  pluginhub,
  busy,
  onOpenSkill,
  onOpenAgent,
  onOpenPrivateFile,
  onDeletePlugin
}: {
  title: string;
  plugins: PluginHubPlugin[];
  pluginhub: PluginHubList;
  busy: boolean;
  onOpenSkill: (skillId: string, target: SkillHubOpenTarget) => void;
  onOpenAgent: (agentId: string, target: SkillHubOpenTarget) => void;
  onOpenPrivateFile: (pluginId: string, fileId: string, target: SkillHubOpenTarget) => void;
  onDeletePlugin: (pluginId: string) => void;
}) {
  const groups = groupPluginsBySource(pluginhub.sources, plugins);

  return (
    <section className="toolbar-panel compact pluginhub-section" aria-label={title}>
      <div className="section-title compact">
        <h2>{title}</h2>
        <span className="metric-pill strong">{plugins.length} 个 plugin</span>
      </div>
      {groups.length === 0 ? (
        <div className="empty-state compact">还没有 {title}</div>
      ) : (
        <div className="pluginhub-list">
          {groups.map((group) => (
            <details className="pluginhub-row pluginhub-source-plugin-group" key={sourcePluginGroupKey(group)}>
              <summary>
                <span className="pluginhub-row-title">{group.source?.label ?? "未知 source"}</span>
                {group.source ? <span className="metric-pill">{group.source.type}</span> : <span className="metric-pill warning">missing source</span>}
                {group.source ? <span className="metric-pill">{group.source.kind}</span> : null}
                <span className="metric-pill">{group.plugins.length} plugins</span>
              </summary>
              <div className="pluginhub-row-body pluginhub-source-plugin-body">
                {group.source ? <small>{group.source.inputPath}</small> : <small>这些 plugin 的 source 记录已缺失</small>}
                <div className="tool-chip-list">
                  {group.source ? <span className="metric-pill">{group.source.componentCount} components</span> : null}
                  {group.source ? <span className="metric-pill">{group.source.privateFileCount} private files</span> : null}
                </div>
                <div className="pluginhub-list pluginhub-nested-plugin-list">
                  {group.plugins.map((plugin) => (
                    <PluginHubPluginRow
                      key={plugin.id}
                      plugin={plugin}
                      pluginhub={pluginhub}
                      busy={busy}
                      showSourceLabel={false}
                      onOpenSkill={onOpenSkill}
                      onOpenAgent={onOpenAgent}
                      onOpenPrivateFile={onOpenPrivateFile}
                      onDeletePlugin={onDeletePlugin}
                    />
                  ))}
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function PluginListSection({
  title,
  plugins,
  pluginhub,
  busy,
  onOpenSkill,
  onOpenAgent,
  onOpenPrivateFile,
  onDeletePlugin,
  onEditPlugin
}: {
  title: string;
  plugins: PluginHubPlugin[];
  pluginhub: PluginHubList;
  busy: boolean;
  onOpenSkill: (skillId: string, target: SkillHubOpenTarget) => void;
  onOpenAgent: (agentId: string, target: SkillHubOpenTarget) => void;
  onOpenPrivateFile: (pluginId: string, fileId: string, target: SkillHubOpenTarget) => void;
  onDeletePlugin: (pluginId: string) => void;
  onEditPlugin?: (plugin: PluginHubPlugin) => void;
}) {
  return (
    <section className="toolbar-panel compact pluginhub-section" aria-label={title}>
      <div className="section-title compact">
        <h2>{title}</h2>
        <span className="metric-pill strong">{plugins.length} 个 plugin</span>
      </div>
      {plugins.length === 0 ? (
        <div className="empty-state compact">还没有 {title}</div>
      ) : (
        <div className="pluginhub-list">
          {plugins.map((plugin) => (
            <PluginHubPluginRow
              key={plugin.id}
              plugin={plugin}
              pluginhub={pluginhub}
              busy={busy}
              showSourceLabel
              onOpenSkill={onOpenSkill}
              onOpenAgent={onOpenAgent}
              onOpenPrivateFile={onOpenPrivateFile}
              onDeletePlugin={onDeletePlugin}
              {...(onEditPlugin ? { onEditPlugin } : {})}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PluginHubPluginRow({
  plugin,
  pluginhub,
  busy,
  showSourceLabel,
  onOpenSkill,
  onOpenAgent,
  onOpenPrivateFile,
  onDeletePlugin,
  onEditPlugin
}: {
  plugin: PluginHubPlugin;
  pluginhub: PluginHubList;
  busy: boolean;
  showSourceLabel: boolean;
  onOpenSkill: (skillId: string, target: SkillHubOpenTarget) => void;
  onOpenAgent: (agentId: string, target: SkillHubOpenTarget) => void;
  onOpenPrivateFile: (pluginId: string, fileId: string, target: SkillHubOpenTarget) => void;
  onDeletePlugin: (pluginId: string) => void;
  onEditPlugin?: (plugin: PluginHubPlugin) => void;
}) {
  return (
    <details className="pluginhub-row" key={plugin.id}>
      <summary>
        <span className="pluginhub-row-title">{plugin.displayName}</span>
        <span className="metric-pill">{plugin.kind}</span>
        <span className="metric-pill">{plugin.componentRefs.length} components</span>
        <span className="metric-pill">{plugin.privateFiles.length} files</span>
      </summary>
      <div className="pluginhub-row-body">
        {plugin.description ? <p>{plugin.description}</p> : null}
        {showSourceLabel ? <small>{plugin.source?.label ?? "custom plugin"}</small> : null}
        <div className="tool-chip-list">
          <span className="metric-pill">{plugin.privateFiles.length} private files</span>
          {Object.entries(plugin.harnessSupport).map(([toolId, support]) => (
            <span className="metric-pill" key={`${plugin.id}:${toolId}`}>
              {toolId}: {support}
            </span>
          ))}
        </div>
        <PluginHubPluginContents
          plugin={plugin}
          pluginhub={pluginhub}
          busy={busy}
          onOpenSkill={onOpenSkill}
          onOpenAgent={onOpenAgent}
          onOpenPrivateFile={onOpenPrivateFile}
        />
        <div className="row-actions">
          {onEditPlugin ? (
            <button className="secondary" type="button" disabled={busy} onClick={() => onEditPlugin(plugin)}>
              编辑 plugin
            </button>
          ) : null}
          <button className="danger" type="button" disabled={busy} onClick={() => onDeletePlugin(plugin.id)}>
            删除 plugin
          </button>
        </div>
      </div>
    </details>
  );
}

function PluginHubPluginContents({
  plugin,
  pluginhub,
  busy,
  onOpenSkill,
  onOpenAgent,
  onOpenPrivateFile
}: {
  plugin: PluginHubPlugin;
  pluginhub: PluginHubList;
  busy: boolean;
  onOpenSkill: (skillId: string, target: SkillHubOpenTarget) => void;
  onOpenAgent: (agentId: string, target: SkillHubOpenTarget) => void;
  onOpenPrivateFile: (pluginId: string, fileId: string, target: SkillHubOpenTarget) => void;
}) {
  const skillsById = useMemo(() => new Map(pluginhub.skills.map((skill) => [skill.id, skill])), [pluginhub.skills]);
  const agentsById = useMemo(() => new Map(pluginhub.agents.map((agent) => [agent.id, agent])), [pluginhub.agents]);
  const mcpServersById = useMemo(() => new Map(pluginhub.mcpServers.map((server) => [server.serverId, server])), [pluginhub.mcpServers]);
  const hookSuitesById = useMemo(() => new Map(pluginhub.hookSuites.map((suite) => [suite.suiteId, suite])), [pluginhub.hookSuites]);
  const refsByType = useMemo(() => groupPluginComponentRefs(plugin.componentRefs), [plugin.componentRefs]);
  const skills = refsByType.skill.map((ref) => ({ ref, item: skillsById.get(ref.componentId) }));
  const agents = refsByType.agent.map((ref) => ({ ref, item: agentsById.get(ref.componentId) }));
  const mcpServers = refsByType.mcp.map((ref) => ({ ref, item: mcpServersById.get(ref.componentId) }));
  const hookSuites = refsByType.hook.map((ref) => ({ ref, item: hookSuitesById.get(ref.componentId) }));

  return (
    <section className="pluginhub-content-groups" aria-label={`${plugin.displayName} 内容`}>
      {skills.length > 0 ? (
        <PluginHubContentGroup label="Skills" count={skills.length}>
        {skills.map(({ ref, item }) =>
          item ? (
            <SkillHubSkillRow key={componentRefKey(ref)} skill={item} busy={busy} onOpenSkill={onOpenSkill} />
          ) : (
            <MissingPluginComponentRow key={componentRefKey(ref)} ref={ref} />
          )
        )}
        </PluginHubContentGroup>
      ) : null}
      {agents.length > 0 ? (
        <PluginHubContentGroup label="Agents" count={agents.length}>
        {agents.map(({ ref, item }) =>
          item ? (
            <AgentHubAgentRow key={componentRefKey(ref)} agent={item} busy={busy} onOpenAgent={onOpenAgent} />
          ) : (
            <MissingPluginComponentRow key={componentRefKey(ref)} ref={ref} />
          )
        )}
        </PluginHubContentGroup>
      ) : null}
      {mcpServers.length > 0 ? (
        <PluginHubContentGroup label="MCP Servers" count={mcpServers.length}>
        {mcpServers.map(({ ref, item }) =>
          item ? (
            <McpHubServerCard key={componentRefKey(ref)} server={item} busy={busy} />
          ) : (
            <MissingPluginComponentRow key={componentRefKey(ref)} ref={ref} />
          )
        )}
        </PluginHubContentGroup>
      ) : null}
      {hookSuites.length > 0 ? (
        <PluginHubContentGroup label="Hook Suites" count={hookSuites.length}>
        {hookSuites.map(({ ref, item }) =>
          item ? <HookHubSuiteCard key={componentRefKey(ref)} suite={item} busy={busy} /> : <MissingPluginComponentRow key={componentRefKey(ref)} ref={ref} />
        )}
        </PluginHubContentGroup>
      ) : null}
      {plugin.privateFiles.length > 0 ? (
        <PluginHubContentGroup label="Private Files" count={plugin.privateFiles.length}>
        {plugin.privateFiles.map((file) => (
          <details className="pluginhub-private-file-row" key={file.id}>
            <summary>
              <span className="pluginhub-row-title">{file.sourceRelativePath}</span>
              <span className="metric-pill">{file.required ? "required" : "optional"}</span>
            </summary>
            <div className="pluginhub-private-file-body">
              <div className="project-meta">
                <span>source: {file.contentPath}</span>
                <span>target: {file.targetRelativePath}</span>
              </div>
              <div className="card-actions">
                <button className="secondary" type="button" disabled={busy} onClick={() => onOpenPrivateFile(plugin.id, file.id, "document")}>
                  打开文件
                </button>
                <button className="secondary" type="button" disabled={busy} onClick={() => onOpenPrivateFile(plugin.id, file.id, "folder")}>
                  打开目录
                </button>
              </div>
            </div>
          </details>
        ))}
        </PluginHubContentGroup>
      ) : null}
    </section>
  );
}

function PluginHubContentGroup({
  label,
  count,
  children
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="pluginhub-content-group">
      <summary>
        <span className="pluginhub-row-title">{label}</span>
        <span className="metric-pill strong">{count}</span>
      </summary>
      <div className="pluginhub-content-group-body">{children}</div>
    </details>
  );
}

function MissingPluginComponentRow({
  ref,
  summaryPrefix,
  summaryExtra
}: {
  ref: PluginHubComponentRef;
  summaryPrefix?: ReactNode;
  summaryExtra?: ReactNode;
}) {
  return (
    <article className="pluginhub-missing-component-row">
      {summaryPrefix}
      <strong>{ref.componentId}</strong>
      <span className="metric-pill warning">missing {ref.type}</span>
      {ref.required && !summaryExtra ? <span className="metric-pill">required</span> : null}
      {summaryExtra}
    </article>
  );
}

function groupPluginComponentRefs(componentRefs: PluginHubComponentRef[]): Record<PluginHubComponentType, PluginHubComponentRef[]> {
  return {
    skill: componentRefs.filter((ref) => ref.type === "skill"),
    agent: componentRefs.filter((ref) => ref.type === "agent"),
    mcp: componentRefs.filter((ref) => ref.type === "mcp"),
    hook: componentRefs.filter((ref) => ref.type === "hook")
  };
}

function groupPluginsBySource(sources: PluginHubSource[], plugins: PluginHubPlugin[]): SourcePluginGroup[] {
  const pluginsBySourceId = new Map<string, PluginHubPlugin[]>();
  const missingSourcePlugins: PluginHubPlugin[] = [];

  for (const plugin of plugins) {
    if (!plugin.sourceId) {
      missingSourcePlugins.push(plugin);
      continue;
    }
    pluginsBySourceId.set(plugin.sourceId, [...(pluginsBySourceId.get(plugin.sourceId) ?? []), plugin]);
  }

  const groups: SourcePluginGroup[] = [];
  const knownSourceIds = new Set(sources.map((source) => source.id));

  for (const source of sources) {
    const sourcePlugins = pluginsBySourceId.get(source.id) ?? [];
    if (sourcePlugins.length > 0) groups.push({ source, plugins: sourcePlugins });
  }

  for (const [sourceId, sourcePlugins] of pluginsBySourceId.entries()) {
    if (knownSourceIds.has(sourceId)) continue;
    groups.push({ source: sourcePlugins[0]?.source ?? null, plugins: sourcePlugins });
  }

  if (missingSourcePlugins.length > 0) groups.push({ source: null, plugins: missingSourcePlugins });

  return groups;
}

function sourcePluginGroupKey(group: SourcePluginGroup): string {
  return group.source?.id ?? `missing-source:${group.plugins.map((plugin) => plugin.id).join(":")}`;
}

function PluginHubImportDialog({
  busy,
  onClose,
  onPickLocalPath,
  onImportLocal,
  onImportGitHub
}: {
  busy: boolean;
  onClose: () => void;
  onPickLocalPath: () => Promise<string | null>;
  onImportLocal: (inputPath: string) => void;
  onImportGitHub: (input: string) => void;
}) {
  const [inputPath, setInputPath] = useState("");
  const [githubInput, setGithubInput] = useState("");

  async function pickPath() {
    const selected = await onPickLocalPath();
    if (selected) setInputPath(selected);
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="pluginhub-import-title">
        <header>
          <div>
            <span className="eyebrow">PluginHub</span>
            <h2 id="pluginhub-import-title">添加 Plugin</h2>
          </div>
          <button className="secondary" type="button" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </header>
        <label className="field wide">
          本地 Plugin source
          <input value={inputPath} disabled={busy} onChange={(event) => setInputPath(event.target.value)} placeholder="选择 plugin library 或单个 plugin 目录" />
        </label>
        <div className="settings-actions">
          <button className="secondary" type="button" onClick={() => void pickPath()} disabled={busy}>
            选择目录
          </button>
          <button className="primary" type="button" disabled={busy || !inputPath.trim()} onClick={() => onImportLocal(inputPath.trim())}>
            导入本地 Plugin
          </button>
        </div>
        <label className="field wide">
          GitHub 来源
          <input value={githubInput} disabled={busy} onChange={(event) => setGithubInput(event.target.value)} placeholder="owner/repo、URL、tree URL 或 SSH URL" />
        </label>
        <div className="settings-actions">
          <button className="primary" type="button" disabled={busy || !githubInput.trim()} onClick={() => onImportGitHub(githubInput.trim())}>
            导入GitHub Plugin
          </button>
        </div>
      </section>
    </div>
  );
}

function PluginHubCustomDialog({
  busy,
  plugin,
  skills,
  agents,
  mcpServers,
  hookSuites,
  onClose,
  onSubmitCustom
}: {
  busy: boolean;
  plugin?: PluginHubPlugin;
  skills: SkillHubSkill[];
  agents: AgentHubAgent[];
  mcpServers: McpHubServer[];
  hookSuites: HookHubSuite[];
  onClose: () => void;
  onSubmitCustom: (input: PluginHubCustomPluginInput) => void;
}) {
  const [name, setName] = useState(plugin?.name ?? "");
  const [description, setDescription] = useState(plugin?.description ?? "");
  const [selectedComponentKeys, setSelectedComponentKeys] = useState<string[]>(plugin?.componentRefs.map(componentRefKey) ?? []);
  const [requiredComponentKeys, setRequiredComponentKeys] = useState<string[]>(
    plugin?.componentRefs.filter((ref) => ref.required).map(componentRefKey) ?? []
  );
  const [privatePath, setPrivatePath] = useState("");
  const [privateContent, setPrivateContent] = useState("");
  const skillComponents = useMemo(() => skills.map(skillComponentCandidate), [skills]);
  const agentComponents = useMemo(() => agents.map(agentComponentCandidate), [agents]);
  const mcpComponents = useMemo(() => mcpServers.map(mcpComponentCandidate), [mcpServers]);
  const hookComponents = useMemo(() => hookSuites.map(hookComponentCandidate), [hookSuites]);
  const availableComponents = useMemo(
    () => [...skillComponents, ...agentComponents, ...mcpComponents, ...hookComponents],
    [agentComponents, hookComponents, mcpComponents, skillComponents]
  );
  const availableComponentKeys = useMemo(() => new Set(availableComponents.map(componentRefKey)), [availableComponents]);
  const missingComponents = useMemo(
    () => (plugin?.componentRefs ?? []).filter((ref) => !availableComponentKeys.has(componentRefKey(ref))).map(missingComponentCandidate),
    [availableComponentKeys, plugin?.componentRefs]
  );
  const allComponents = useMemo(() => [...availableComponents, ...missingComponents], [availableComponents, missingComponents]);
  const selectedComponents = useMemo(() => allComponents.filter((component) => selectedComponentKeys.includes(componentRefKey(component))), [allComponents, selectedComponentKeys]);
  const selectedKeySet = useMemo(() => new Set(selectedComponentKeys), [selectedComponentKeys]);
  const requiredKeySet = useMemo(() => new Set(requiredComponentKeys), [requiredComponentKeys]);
  const skillGroups = useMemo(() => groupSkillHubSkills(skills), [skills]);
  const agentGroups = useMemo(() => groupAgentHubAgents(agents), [agents]);

  function toggleComponent(component: PluginHubComponentCandidate, checked: boolean) {
    const key = componentRefKey(component);
    setSelectedComponentKeys((current) => (checked ? [...new Set([...current, key])] : current.filter((id) => id !== key)));
    if (!checked) setRequiredComponentKeys((current) => current.filter((id) => id !== key));
  }

  function submit() {
    const input: PluginHubCustomPluginInput = {
      name,
      description,
      componentRefs: selectedComponents.map((component) => ({
        type: component.type,
        componentId: component.componentId,
        required: requiredComponentKeys.includes(componentRefKey(component))
      }))
    };
    if (privatePath.trim()) {
      input.privateFiles = [{ sourceRelativePath: privatePath.trim(), content: privateContent, required: true }];
    } else if (!plugin) {
      input.privateFiles = [];
    }
    onSubmitCustom(input);
  }

  const title = plugin ? "编辑 Plugin" : "创建 Plugin";

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog pluginhub-custom-dialog" role="dialog" aria-modal="true" aria-labelledby="pluginhub-custom-title">
        <header>
          <div>
            <span className="eyebrow">PluginHub</span>
            <h2 id="pluginhub-custom-title">{title}</h2>
          </div>
          <button className="secondary" type="button" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </header>
        <label className="field wide">
          plugin name
          <input value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field wide">
          描述
          <input value={description} disabled={busy} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <section className="pluginhub-component-picker" aria-label="组件选择">
          <div className="section-title compact">
            <h3>组件</h3>
            <span className="metric-pill">{selectedComponentKeys.length} selected</span>
          </div>
          <div className="pluginhub-component-picker-list">
            <PluginHubPickerTypeGroup
              label="Skills"
              count={skillComponents.length}
              selectedCount={componentSelectedCount(skillComponents, selectedKeySet)}
              emptyLabel="还没有可引用 SkillHub 技能"
            >
              <section className="skillhub-source-list pluginhub-picker-nested-list" aria-label="SkillHub 来源">
                {skillGroups.map((group) => {
                  const groupComponents = group.skills.map(skillComponentCandidate);
                  return (
                    <details className="skillhub-source-group pluginhub-picker-source-group" key={group.source.id} open={componentSelectedCount(groupComponents, selectedKeySet) > 0}>
                      <summary>
                        <span className="skillhub-source-main">
                          <span className="skillhub-source-title">{group.source.label}</span>
                          <span className="metric-pill">{group.source.type}</span>
                        </span>
                        <span className="skillhub-source-actions">
                          <span className="metric-pill strong">{group.skills.length} 个技能</span>
                        </span>
                      </summary>
                      <div className="skillhub-skill-list">
                        {group.skills.map((skill) => (
                          <PluginHubComponentPickerRow
                            key={componentRefKey({ type: "skill", componentId: skill.id })}
                            component={skillComponentCandidate(skill)}
                            busy={busy}
                            selected={selectedKeySet.has(componentRefKey({ type: "skill", componentId: skill.id }))}
                            required={requiredKeySet.has(componentRefKey({ type: "skill", componentId: skill.id }))}
                            onToggle={toggleComponent}
                            onRequiredChange={setRequiredComponentKeys}
                          />
                        ))}
                      </div>
                    </details>
                  );
                })}
              </section>
            </PluginHubPickerTypeGroup>
            <PluginHubPickerTypeGroup
              label="Agents"
              count={agentComponents.length}
              selectedCount={componentSelectedCount(agentComponents, selectedKeySet)}
              emptyLabel="还没有可引用 AgentHub agent"
            >
              <section className="skillhub-source-list agenthub-source-list pluginhub-picker-nested-list" aria-label="AgentHub 来源">
                {agentGroups.map((group) => {
                  const groupComponents = group.agents.map(agentComponentCandidate);
                  return (
                    <details className="skillhub-source-group pluginhub-picker-source-group" key={group.source.id} open={componentSelectedCount(groupComponents, selectedKeySet) > 0}>
                      <summary>
                        <span className="skillhub-source-main">
                          <span className="skillhub-source-title">{group.source.label}</span>
                          <span className="metric-pill">{group.source.type}</span>
                          <span className="metric-pill">{group.source.sourceTruthTool}</span>
                        </span>
                        <span className="skillhub-source-actions">
                          <span className="metric-pill strong">{group.agents.length} 个 Agent</span>
                        </span>
                      </summary>
                      <div className="skillhub-skill-list">
                        {group.agents.map((agent) => (
                          <PluginHubComponentPickerRow
                            key={componentRefKey({ type: "agent", componentId: agent.id })}
                            component={agentComponentCandidate(agent)}
                            busy={busy}
                            selected={selectedKeySet.has(componentRefKey({ type: "agent", componentId: agent.id }))}
                            required={requiredKeySet.has(componentRefKey({ type: "agent", componentId: agent.id }))}
                            onToggle={toggleComponent}
                            onRequiredChange={setRequiredComponentKeys}
                          />
                        ))}
                      </div>
                    </details>
                  );
                })}
              </section>
            </PluginHubPickerTypeGroup>
            <PluginHubPickerTypeGroup
              label="MCP Servers"
              count={mcpComponents.length}
              selectedCount={componentSelectedCount(mcpComponents, selectedKeySet)}
              emptyLabel="还没有可引用 McpHub server"
            >
              <section className="mcphub-server-list pluginhub-picker-nested-list" aria-label="McpHub server 列表">
                {mcpServers.map((server) => (
                  <PluginHubComponentPickerRow
                    key={componentRefKey({ type: "mcp", componentId: server.serverId })}
                    component={mcpComponentCandidate(server)}
                    busy={busy}
                    selected={selectedKeySet.has(componentRefKey({ type: "mcp", componentId: server.serverId }))}
                    required={requiredKeySet.has(componentRefKey({ type: "mcp", componentId: server.serverId }))}
                    onToggle={toggleComponent}
                    onRequiredChange={setRequiredComponentKeys}
                  />
                ))}
              </section>
            </PluginHubPickerTypeGroup>
            <PluginHubPickerTypeGroup
              label="Hook Suites"
              count={hookComponents.length}
              selectedCount={componentSelectedCount(hookComponents, selectedKeySet)}
              emptyLabel="还没有可引用 HookHub suite"
            >
              <section className="hookhub-suite-list pluginhub-picker-nested-list" aria-label="HookHub suite 列表">
                {hookSuites.map((suite) => (
                  <PluginHubComponentPickerRow
                    key={componentRefKey({ type: "hook", componentId: suite.suiteId })}
                    component={hookComponentCandidate(suite)}
                    busy={busy}
                    selected={selectedKeySet.has(componentRefKey({ type: "hook", componentId: suite.suiteId }))}
                    required={requiredKeySet.has(componentRefKey({ type: "hook", componentId: suite.suiteId }))}
                    onToggle={toggleComponent}
                    onRequiredChange={setRequiredComponentKeys}
                  />
                ))}
              </section>
            </PluginHubPickerTypeGroup>
            {missingComponents.length > 0 ? (
              <PluginHubPickerTypeGroup
                label="未找到的组件"
                count={missingComponents.length}
                selectedCount={componentSelectedCount(missingComponents, selectedKeySet)}
                emptyLabel="没有未找到的组件引用"
              >
                <section className="pluginhub-picker-nested-list" aria-label="未找到的组件">
                  {missingComponents.map((component) => (
                    <PluginHubComponentPickerRow
                      key={componentRefKey(component)}
                      component={component}
                      busy={busy}
                      selected={selectedKeySet.has(componentRefKey(component))}
                      required={requiredKeySet.has(componentRefKey(component))}
                      onToggle={toggleComponent}
                      onRequiredChange={setRequiredComponentKeys}
                    />
                  ))}
                </section>
              </PluginHubPickerTypeGroup>
            ) : null}
          </div>
        </section>
        <label className="field wide">
          private file path
          <input value={privatePath} disabled={busy} onChange={(event) => setPrivatePath(event.target.value)} placeholder={plugin ? "留空保留现有 private files" : "README.md"} />
        </label>
        <label className="field wide">
          private file content
          <textarea value={privateContent} disabled={busy} onChange={(event) => setPrivateContent(event.target.value)} />
        </label>
        <div className="settings-actions">
          <button className="primary" type="button" disabled={busy || !name.trim()} onClick={submit}>
            {title}
          </button>
        </div>
      </section>
    </div>
  );
}

type PluginHubComponentCandidate =
  | { type: "skill"; componentId: string; skill: SkillHubSkill }
  | { type: "agent"; componentId: string; agent: AgentHubAgent }
  | { type: "mcp"; componentId: string; server: McpHubServer }
  | { type: "hook"; componentId: string; suite: HookHubSuite }
  | (PluginHubComponentRef & { missing: true });

function PluginHubPickerTypeGroup({
  label,
  count,
  selectedCount,
  emptyLabel,
  children
}: {
  label: string;
  count: number;
  selectedCount: number;
  emptyLabel: string;
  children: ReactNode;
}) {
  return (
    <details className="pluginhub-component-group" open={selectedCount > 0}>
      <summary>
        <span className="pluginhub-row-title">{label}</span>
        <span className="metric-pill">{count} items</span>
        {selectedCount > 0 ? <span className="metric-pill strong">{selectedCount} selected</span> : null}
      </summary>
      <div className="pluginhub-component-group-body">{count === 0 ? <div className="empty-state compact">{emptyLabel}</div> : children}</div>
    </details>
  );
}

function PluginHubComponentPickerRow({
  component,
  busy,
  selected,
  required,
  onToggle,
  onRequiredChange
}: {
  component: PluginHubComponentCandidate;
  busy: boolean;
  selected: boolean;
  required: boolean;
  onToggle: (component: PluginHubComponentCandidate, checked: boolean) => void;
  onRequiredChange: Dispatch<SetStateAction<string[]>>;
}) {
  const title = componentTitle(component);
  const key = componentRefKey(component);
  const summaryPrefix = <PluginHubComponentSelectControl title={title} checked={selected} disabled={busy} onChange={(checked) => onToggle(component, checked)} />;
  const summaryExtra = (
    <PluginHubRequiredControl
      title={title}
      checked={required}
      disabled={busy || !selected}
      onChange={(checked) => onRequiredChange((current) => (checked ? [...new Set([...current, key])] : current.filter((id) => id !== key)))}
    />
  );

  if ("missing" in component) {
    return <MissingPluginComponentRow ref={component} summaryPrefix={summaryPrefix} summaryExtra={summaryExtra} />;
  }

  switch (component.type) {
    case "skill":
      return <SkillHubSkillRow skill={component.skill} busy={busy} summaryPrefix={summaryPrefix} summaryExtra={summaryExtra} className="pluginhub-selectable-hub-row" />;
    case "agent":
      return <AgentHubAgentRow agent={component.agent} busy={busy} summaryPrefix={summaryPrefix} summaryExtra={summaryExtra} className="pluginhub-selectable-hub-row" />;
    case "mcp":
      return <McpHubServerCard server={component.server} busy={busy} summaryPrefix={summaryPrefix} summaryExtra={summaryExtra} className="pluginhub-selectable-hub-row" />;
    case "hook":
      return <HookHubSuiteCard suite={component.suite} busy={busy} summaryPrefix={summaryPrefix} summaryExtra={summaryExtra} className="pluginhub-selectable-hub-row" />;
  }
}

function PluginHubComponentSelectControl({
  title,
  checked,
  disabled,
  onChange
}: {
  title: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="pluginhub-component-select-control" onClick={(event) => event.stopPropagation()}>
      <input type="checkbox" aria-label={`选择 ${title}`} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function PluginHubRequiredControl({
  title,
  checked,
  disabled,
  onChange
}: {
  title: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="pluginhub-required-toggle" onClick={(event) => event.stopPropagation()}>
      <input type="checkbox" aria-label={`${title} required`} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <small>required</small>
    </label>
  );
}

function skillComponentCandidate(skill: SkillHubSkill): PluginHubComponentCandidate {
  return { type: "skill", componentId: skill.id, skill };
}

function agentComponentCandidate(agent: AgentHubAgent): PluginHubComponentCandidate {
  return { type: "agent", componentId: agent.id, agent };
}

function mcpComponentCandidate(server: McpHubServer): PluginHubComponentCandidate {
  return { type: "mcp", componentId: server.serverId, server };
}

function hookComponentCandidate(suite: HookHubSuite): PluginHubComponentCandidate {
  return { type: "hook", componentId: suite.suiteId, suite };
}

function missingComponentCandidate(ref: PluginHubComponentRef): PluginHubComponentCandidate {
  return { ...ref, missing: true };
}

function componentSelectedCount(components: PluginHubComponentCandidate[], selectedKeys: Set<string>): number {
  return components.filter((component) => selectedKeys.has(componentRefKey(component))).length;
}

function componentTitle(component: PluginHubComponentCandidate): string {
  if ("missing" in component) return `${component.type}:${component.componentId}`;
  switch (component.type) {
    case "skill":
      return component.skill.folderName;
    case "agent":
      return component.agent.name || component.agent.slug;
    case "mcp":
      return component.server.serverId;
    case "hook":
      return component.suite.name;
  }
}

function componentRefKey(ref: Pick<PluginHubComponentRef, "type" | "componentId">): string {
  return `${ref.type}:${ref.componentId}`;
}
