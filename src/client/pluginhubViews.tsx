import { useMemo, useState } from "react";
import { toolIds } from "../shared/types.js";
import type {
  PluginHubCustomPluginInput,
  PluginHubList,
  PluginHubPlugin,
  ProjectPluginApplyResult,
  ProjectPluginState,
  SkillHubSkill,
  ToolId
} from "../shared/types.js";

export function PluginHubPage({
  pluginhub,
  busy,
  onPickLocalPath,
  onImportLocal,
  onCreateCustom,
  onUpdateCustom,
  onDeleteSource,
  onDeletePlugin
}: {
  pluginhub: PluginHubList | null;
  busy: boolean;
  onPickLocalPath: () => Promise<string | null>;
  onImportLocal: (inputPath: string) => void;
  onCreateCustom: (input: PluginHubCustomPluginInput) => void;
  onUpdateCustom: (pluginId: string, input: PluginHubCustomPluginInput) => void;
  onDeleteSource: (sourceId: string) => void;
  onDeletePlugin: (pluginId: string) => void;
}) {
  const [dialog, setDialog] = useState<"import" | "create" | null>(null);
  const [editingPlugin, setEditingPlugin] = useState<PluginHubPlugin | null>(null);

  return (
    <section className="content pluginhub-page">
      {dialog === "import" ? (
        <PluginHubImportDialog busy={busy} onClose={() => setDialog(null)} onPickLocalPath={onPickLocalPath} onImportLocal={onImportLocal} />
      ) : null}
      {dialog === "create" ? (
        <PluginHubCustomDialog
          busy={busy}
          skills={pluginhub?.skills ?? []}
          onClose={() => setDialog(null)}
          onSubmitCustom={onCreateCustom}
        />
      ) : null}
      {editingPlugin ? (
        <PluginHubCustomDialog
          busy={busy}
          plugin={editingPlugin}
          skills={pluginhub?.skills ?? []}
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
                      <span className="metric-pill">{source.kind}</span>
                      <span className="metric-pill">{source.pluginCount} plugins</span>
                    </summary>
                    <div className="pluginhub-row-body">
                      <small>{source.inputPath}</small>
                      <div className="tool-chip-list">
                        <span className="metric-pill">{source.componentCount} components</span>
                        <span className="metric-pill">{source.privateFileCount} private files</span>
                      </div>
                      <button className="danger" type="button" disabled={busy} onClick={() => onDeleteSource(source.id)}>
                        删除 source
                      </button>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>

          <PluginListSection title="Plugins" plugins={pluginhub.sourcePlugins} busy={busy} onDeletePlugin={onDeletePlugin} />
          <PluginListSection
            title="Custom Plugins"
            plugins={pluginhub.customPlugins}
            busy={busy}
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
  const [pluginId, setPluginId] = useState("");
  const [toolId, setToolId] = useState<ToolId>("codex");
  const plugins = state?.plugins ?? [];
  const selectedPluginId = pluginId || plugins[0]?.id || "";

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

      {!state ? (
        <div className="muted">正在读取项目 Plugin...</div>
      ) : (
        <>
          <section className="project-plugin-install" aria-label="安装 Plugin">
            <div className="section-title compact">
              <h3>安装 Plugin</h3>
            </div>
            <div className="project-plugin-install-controls">
              <label className="field">
                Plugin
                <select value={selectedPluginId} disabled={busy || plugins.length === 0} onChange={(event) => setPluginId(event.target.value)}>
                  {plugins.map((plugin) => (
                    <option key={plugin.id} value={plugin.id}>
                      {plugin.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                工具
                <select value={toolId} disabled={busy} onChange={(event) => setToolId(event.target.value as ToolId)}>
                  {toolIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary" type="button" disabled={busy || !selectedPluginId} onClick={() => onInstall(selectedPluginId, toolId)}>
                安装
              </button>
            </div>
          </section>

          {lastResult?.preflight.length ? (
            <div className="inline-warning" role="alert">
              {lastResult.message}：{lastResult.preflight.map((item) => item.targetPath).join("；")}
            </div>
          ) : null}

          <section className="project-plugin-bindings" aria-label="已安装 Plugin">
            <div className="section-title compact">
              <h3>已安装</h3>
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
        </>
      )}
    </aside>
  );
}

function PluginListSection({
  title,
  plugins,
  busy,
  onDeletePlugin,
  onEditPlugin
}: {
  title: string;
  plugins: PluginHubPlugin[];
  busy: boolean;
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
            <details className="pluginhub-row" key={plugin.id}>
              <summary>
                <span className="pluginhub-row-title">{plugin.displayName}</span>
                <span className="metric-pill">{plugin.kind}</span>
                <span className="metric-pill">{plugin.componentRefs.length} components</span>
              </summary>
              <div className="pluginhub-row-body">
                {plugin.description ? <p>{plugin.description}</p> : null}
                <small>{plugin.source?.label ?? "custom plugin"}</small>
                <div className="tool-chip-list">
                  <span className="metric-pill">{plugin.privateFiles.length} private files</span>
                  {Object.entries(plugin.harnessSupport).map(([toolId, support]) => (
                    <span className="metric-pill" key={`${plugin.id}:${toolId}`}>
                      {toolId}: {support}
                    </span>
                  ))}
                </div>
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
          ))}
        </div>
      )}
    </section>
  );
}

function PluginHubImportDialog({
  busy,
  onClose,
  onPickLocalPath,
  onImportLocal
}: {
  busy: boolean;
  onClose: () => void;
  onPickLocalPath: () => Promise<string | null>;
  onImportLocal: (inputPath: string) => void;
}) {
  const [inputPath, setInputPath] = useState("");

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
          本地 plugin source
          <input value={inputPath} disabled={busy} onChange={(event) => setInputPath(event.target.value)} placeholder="选择 plugin library 或单个 plugin 目录" />
        </label>
        <div className="settings-actions">
          <button className="secondary" type="button" onClick={() => void pickPath()} disabled={busy}>
            选择目录
          </button>
          <button className="primary" type="button" disabled={busy || !inputPath.trim()} onClick={() => onImportLocal(inputPath.trim())}>
            导入
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
  onClose,
  onSubmitCustom
}: {
  busy: boolean;
  plugin?: PluginHubPlugin;
  skills: SkillHubSkill[];
  onClose: () => void;
  onSubmitCustom: (input: PluginHubCustomPluginInput) => void;
}) {
  const [name, setName] = useState(plugin?.name ?? "");
  const [description, setDescription] = useState(plugin?.description ?? "");
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(plugin?.componentRefs.filter((ref) => ref.type === "skill").map((ref) => ref.componentId) ?? []);
  const [requiredSkillIds, setRequiredSkillIds] = useState<string[]>(
    plugin?.componentRefs.filter((ref) => ref.type === "skill" && ref.required).map((ref) => ref.componentId) ?? []
  );
  const [privatePath, setPrivatePath] = useState("");
  const [privateContent, setPrivateContent] = useState("");
  const selectedSkills = useMemo(() => skills.filter((skill) => selectedSkillIds.includes(skill.id)), [selectedSkillIds, skills]);

  function toggleSkill(skillId: string, checked: boolean) {
    setSelectedSkillIds((current) => (checked ? [...new Set([...current, skillId])] : current.filter((id) => id !== skillId)));
    if (!checked) setRequiredSkillIds((current) => current.filter((id) => id !== skillId));
  }

  function submit() {
    const input: PluginHubCustomPluginInput = {
      name,
      description,
      componentRefs: selectedSkills.map((skill) => ({ type: "skill", componentId: skill.id, required: requiredSkillIds.includes(skill.id) }))
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
        <section className="pluginhub-skill-picker" aria-label="组件选择">
          <div className="section-title compact">
            <h3>Skills</h3>
            <span className="metric-pill">{selectedSkillIds.length} selected</span>
          </div>
          {skills.length === 0 ? (
            <div className="empty-state compact">还没有可引用 SkillHub 技能</div>
          ) : (
            <div className="pluginhub-skill-picker-list">
              {skills.map((skill) => (
                <label className="pluginhub-skill-option" key={skill.id}>
                  <input
                    type="checkbox"
                    checked={selectedSkillIds.includes(skill.id)}
                    disabled={busy}
                    onChange={(event) => toggleSkill(skill.id, event.target.checked)}
                  />
                  <span>{skill.folderName}</span>
                  <input
                    type="checkbox"
                    aria-label={`${skill.folderName} required`}
                    checked={requiredSkillIds.includes(skill.id)}
                    disabled={busy || !selectedSkillIds.includes(skill.id)}
                    onChange={(event) =>
                      setRequiredSkillIds((current) =>
                        event.target.checked ? [...new Set([...current, skill.id])] : current.filter((id) => id !== skill.id)
                      )
                    }
                  />
                  <small>required</small>
                </label>
              ))}
            </div>
          )}
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
