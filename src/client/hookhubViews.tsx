import React, { useEffect, useMemo, useState } from "react";
import type {
  HookHubApplyMode,
  HookHubExportDocument,
  HookHubImportConflictMode,
  HookHubList,
  HookHubProjectStatus,
  HookHubSuite,
  HookHubSuiteInput,
  HookHubSupportedToolId,
  ProjectHookState,
  ProjectHookToolState
} from "../shared/types.js";

const supportedToolIds: HookHubSupportedToolId[] = ["claude", "codex", "qwen", "qoder"];

export function HookHubPage({
  hookhub,
  query,
  busy,
  onQueryChange,
  onCreateSuite,
  onUpdateSuite,
  onDeleteSuite,
  onExportSuite,
  onImportSuite,
  onImportNative,
  onSyncSuite
}: {
  hookhub: HookHubList | null;
  query: string;
  busy: boolean;
  onQueryChange: (query: string) => void;
  onCreateSuite: (input: HookHubSuiteInput) => void;
  onUpdateSuite: (suiteId: string, input: HookHubSuiteInput) => void;
  onDeleteSuite: (suiteId: string) => void;
  onExportSuite: (suiteId: string) => Promise<HookHubExportDocument>;
  onImportSuite: (input: string, mode?: HookHubImportConflictMode | null, renameName?: string | null) => void;
  onImportNative: (toolId: HookHubSupportedToolId, input: string, suite: HookHubSuiteInput) => void;
  onSyncSuite: (suiteId: string) => void;
}) {
  const [dialog, setDialog] = useState<"create" | "import-suite" | "import-native" | null>(null);

  return (
    <section className="content hookhub-page">
      {dialog === "create" ? <CreateHookHubSuiteDialog busy={busy} onClose={() => setDialog(null)} onCreateSuite={onCreateSuite} /> : null}
      {dialog === "import-suite" ? (
        <ImportHookHubSuiteDialog busy={busy} onClose={() => setDialog(null)} onImportSuite={onImportSuite} />
      ) : null}
      {dialog === "import-native" ? (
        <ImportNativeHooksDialog busy={busy} onClose={() => setDialog(null)} onImportNative={onImportNative} />
      ) : null}

      <section className="toolbar-panel compact hookhub-toolbar-panel" aria-label="HookHub 操作">
        <label className="field wide hookhub-search-field">
          搜索 suite
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="name / description / tool / env / risk" />
        </label>
        <div className="inline-actions hookhub-toolbar-actions">
          <button className="primary" type="button" disabled={busy} onClick={() => setDialog("create")}>
            创建 suite
          </button>
          <button className="secondary" type="button" disabled={busy} onClick={() => setDialog("import-suite")}>
            导入 suite JSON
          </button>
          <button className="secondary" type="button" disabled={busy} onClick={() => setDialog("import-native")}>
            导入原生 hooks
          </button>
        </div>
      </section>

      {!hookhub ? (
        <div className="empty-state">
          <h2>正在读取 HookHub</h2>
        </div>
      ) : hookhub.suites.length === 0 ? (
        <div className="empty-state">
          <h2>还没有 HookHub suite</h2>
        </div>
      ) : (
        <section className="hookhub-suite-list" aria-label="HookHub suite 列表">
          {hookhub.suites.map((suite) => (
            <HookHubSuiteCard
              key={suite.suiteId}
              suite={suite}
              busy={busy}
              onUpdate={onUpdateSuite}
              onDelete={onDeleteSuite}
              onExport={() => onExportSuite(suite.suiteId)}
              onSync={onSyncSuite}
            />
          ))}
        </section>
      )}
    </section>
  );
}

function CreateHookHubSuiteDialog({
  busy,
  onClose,
  onCreateSuite
}: {
  busy: boolean;
  onClose: () => void;
  onCreateSuite: (input: HookHubSuiteInput) => void;
}) {
  const [mode, setMode] = useState<"structured" | "json">("structured");
  const [structuredDraft, setStructuredDraft] = useState<StructuredHookDraft>(() => emptyStructuredHookDraft());
  const [jsonInput, setJsonInput] = useState("");
  const [error, setError] = useState("");

  function submitStructured(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = structuredHookDraftInput(structuredDraft, setError);
    if (!parsed) return;
    onCreateSuite(parsed);
    onClose();
  }

  function submitJson(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = suiteInputFromJsonText(jsonInput, setError);
    if (!parsed) return;
    onCreateSuite(parsed);
    onClose();
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog hookhub-dialog" role="dialog" aria-modal="true" aria-labelledby="hookhub-create-title">
        <header>
          <div>
            <span className="eyebrow">HookHub</span>
            <h2 id="hookhub-create-title">创建 HookHub suite</h2>
          </div>
          <button className="secondary" type="button" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </header>
        <div className="segmented-tabs" role="tablist" aria-label="创建方式">
          <button className={mode === "structured" ? "active" : ""} type="button" onClick={() => setMode("structured")}>
            结构化
          </button>
          <button className={mode === "json" ? "active" : ""} type="button" onClick={() => setMode("json")}>
            JSON
          </button>
        </div>
        {mode === "structured" ? (
          <StructuredHookSuiteForm draft={structuredDraft} busy={busy} onChange={setStructuredDraft} onSubmit={submitStructured} />
        ) : (
          <form className="hookhub-suite-form" onSubmit={submitJson}>
            <label className="field wide">
              suite JSON
              <textarea
                value={jsonInput}
                disabled={busy}
                onChange={(event) => setJsonInput(event.target.value)}
                placeholder='{"name":"提交前检查","payloads":{"claude":{"PreToolUse":[]}}}'
              />
            </label>
            <div className="inline-actions">
              <button className="primary" type="submit" disabled={busy || !jsonInput.trim()}>
                创建 suite
              </button>
            </div>
          </form>
        )}
        {error ? <div className="field-error">{error}</div> : null}
      </section>
    </div>
  );
}

function ImportHookHubSuiteDialog({
  busy,
  onClose,
  onImportSuite
}: {
  busy: boolean;
  onClose: () => void;
  onImportSuite: (input: string, mode?: HookHubImportConflictMode | null, renameName?: string | null) => void;
}) {
  const [suiteImport, setSuiteImport] = useState("");

  function importSuite(mode?: HookHubImportConflictMode | null, renameName?: string | null) {
    if (!suiteImport.trim()) return;
    onImportSuite(suiteImport, mode, renameName);
    onClose();
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog hookhub-dialog" role="dialog" aria-modal="true" aria-labelledby="hookhub-import-suite-title">
        <header>
          <div>
            <span className="eyebrow">HookHub</span>
            <h2 id="hookhub-import-suite-title">导入 HookHub suite</h2>
          </div>
          <button className="secondary" type="button" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </header>
        <label className="field wide">
          HookHub suite JSON
          <textarea
            value={suiteImport}
            disabled={busy}
            onChange={(event) => setSuiteImport(event.target.value)}
            placeholder='{"format":"hookhub-suite-v1","suite":...}'
          />
        </label>
        <div className="inline-actions">
          <button className="primary" type="button" disabled={busy || !suiteImport.trim()} onClick={() => importSuite()}>
            导入
          </button>
          <button className="secondary" type="button" disabled={busy || !suiteImport.trim()} onClick={() => importSuite("overwrite")}>
            覆盖同名
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy || !suiteImport.trim()}
            onClick={() => {
              const name = window.prompt("重命名后的 suite name", "");
              if (name) importSuite("rename", name);
            }}
          >
            重命名导入
          </button>
        </div>
      </section>
    </div>
  );
}

function ImportNativeHooksDialog({
  busy,
  onClose,
  onImportNative
}: {
  busy: boolean;
  onClose: () => void;
  onImportNative: (toolId: HookHubSupportedToolId, input: string, suite: HookHubSuiteInput) => void;
}) {
  const [nativeImport, setNativeImport] = useState("");
  const [nativeToolId, setNativeToolId] = useState<HookHubSupportedToolId>("claude");
  const [nativeName, setNativeName] = useState("");

  function importNative(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nativeName.trim() || !nativeImport.trim()) return;
    onImportNative(nativeToolId, nativeImport, {
      name: nativeName,
      payloads: {}
    });
    onClose();
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog hookhub-dialog" role="dialog" aria-modal="true" aria-labelledby="hookhub-import-native-title">
        <header>
          <div>
            <span className="eyebrow">HookHub</span>
            <h2 id="hookhub-import-native-title">导入原生 hooks</h2>
          </div>
          <button className="secondary" type="button" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </header>
        <form className="hookhub-suite-form" onSubmit={importNative}>
          <div className="hookhub-form-grid">
            <label className="field">
              原生工具
              <select value={nativeToolId} disabled={busy} onChange={(event) => setNativeToolId(event.target.value as HookHubSupportedToolId)}>
                {supportedToolIds.map((toolId) => (
                  <option value={toolId} key={toolId}>
                    {toolId}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              suite name
              <input value={nativeName} disabled={busy} onChange={(event) => setNativeName(event.target.value)} />
            </label>
          </div>
          <label className="field wide">
            原生配置 JSON
            <textarea value={nativeImport} disabled={busy} onChange={(event) => setNativeImport(event.target.value)} />
          </label>
          <div className="inline-actions">
            <button className="primary" type="submit" disabled={busy || !nativeName.trim() || !nativeImport.trim()}>
              导入原生 hooks
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ProjectHooksPanel({
  state,
  busy,
  onClose,
  onWriteHooks,
  onShareHooks,
  onApplySuite,
  onSyncTool,
  onRemoveBinding,
  onSyncAll
}: {
  state: ProjectHookState | null;
  busy: boolean;
  onClose: () => void;
  onWriteHooks: (toolId: HookHubSupportedToolId, hooks: unknown, input?: Partial<HookHubSuiteInput>) => void;
  onShareHooks: (toolId: HookHubSupportedToolId, input: HookHubSuiteInput) => void;
  onApplySuite: (toolId: HookHubSupportedToolId, suiteId: string, options?: ApplyPromptResult) => void;
  onSyncTool: (toolId: HookHubSupportedToolId) => void;
  onRemoveBinding: (toolId: HookHubSupportedToolId) => void;
  onSyncAll: () => void;
}) {
  return (
    <aside className="side-panel project-hooks-panel" aria-label="项目 Hooks 管理">
      <header>
        <div>
          <span className="eyebrow">HookHub</span>
          <h2>项目 Hooks</h2>
        </div>
        <button className="secondary" type="button" onClick={onClose} disabled={busy}>
          关闭
        </button>
      </header>

      {!state ? (
        <div className="muted">正在读取项目 hooks...</div>
      ) : (
        <>
          <p className="path-line">{state.targetRootPath}</p>
          <div className="inline-actions">
            <button className="secondary" type="button" disabled={busy} onClick={onSyncAll}>
              更新当前目录所有不一致 hooks
            </button>
          </div>
          <div className="project-hook-tool-list">
            {state.tools.map((tool) => (
              <ProjectHookToolRow
                key={tool.toolId}
                tool={tool}
                suites={state.suites}
                busy={busy}
                onWriteHooks={onWriteHooks}
                onShareHooks={onShareHooks}
                onApplySuite={onApplySuite}
                onSyncTool={onSyncTool}
                onRemoveBinding={onRemoveBinding}
              />
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

export function HookHubSuiteCard({
  suite,
  busy,
  onUpdate,
  onDelete,
  onExport,
  onSync,
  summaryPrefix,
  summaryExtra,
  className
}: {
  suite: HookHubSuite;
  busy: boolean;
  onUpdate?: (suiteId: string, input: HookHubSuiteInput) => void;
  onDelete?: (suiteId: string) => void;
  onExport?: () => Promise<HookHubExportDocument>;
  onSync?: (suiteId: string) => void;
  summaryPrefix?: React.ReactNode;
  summaryExtra?: React.ReactNode;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SuiteDraft>(() => suiteDraftFromSuite(suite));
  const [exportText, setExportText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editing) setDraft(suiteDraftFromSuite(suite));
  }, [editing, suite]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = suiteDraftInput(draft, setError);
    if (parsed && onUpdate) {
      onUpdate(suite.suiteId, parsed);
      setEditing(false);
    }
  }

  return (
    <>
      {exportText ? <HookHubExportDialog suiteName={suite.name} exportText={exportText} onClose={() => setExportText("")} /> : null}
      <details className={["hookhub-suite-card", className].filter(Boolean).join(" ")}>
        <summary>
          <span className="skillhub-source-main">
            {summaryPrefix}
            <span className="skillhub-source-title">{suite.name}</span>
            <span className="metric-pill">{suite.toolIds.length} tools</span>
            {suite.requiredEnv.length ? <span className="metric-pill">env {suite.requiredEnv.length}</span> : null}
          </span>
          <span className="skillhub-source-actions hookhub-suite-summary-actions">
            <span className="metric-pill strong">{formatTime(suite.updatedAt)}</span>
            {summaryExtra}
            {onExport ? (
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void onExport().then((document) => setExportText(JSON.stringify(document, null, 2)));
                }}
              >
                导出
              </button>
            ) : null}
          </span>
        </summary>
        <div className="skillhub-skill-body hookhub-suite-body">
          {editing && onUpdate ? (
            <SuiteDraftForm draft={draft} busy={busy} submitLabel="保存 suite" onChange={setDraft} onSubmit={submit} />
          ) : (
            <>
              <p>{suite.description ?? "无描述"}</p>
              {suite.riskNotes ? <div className="inline-warning">{suite.riskNotes}</div> : null}
              <div className="project-meta">
                <span>suiteId: {suite.suiteId}</span>
                {suite.requiredEnv.length ? <span>requiredEnv: {suite.requiredEnv.join(", ")}</span> : null}
              </div>
              <pre className="json-preview">{JSON.stringify(suite.payloads, null, 2)}</pre>
            </>
          )}
          {error ? <div className="field-error">{error}</div> : null}
          {onUpdate || onSync || onDelete ? (
            <div className="card-actions">
              {onUpdate ? (
                <button className="secondary" type="button" disabled={busy} onClick={() => setEditing((value) => !value)}>
                  {editing ? "取消编辑" : "编辑"}
                </button>
              ) : null}
              {onSync ? (
                <button className="secondary" type="button" disabled={busy} onClick={() => onSync(suite.suiteId)}>
                  同步到所有已启用项目
                </button>
              ) : null}
              {onDelete ? (
                <button className="danger" type="button" disabled={busy} onClick={() => onDelete(suite.suiteId)}>
                  删除
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </details>
    </>
  );
}

function HookHubExportDialog({
  suiteName,
  exportText,
  onClose
}: {
  suiteName: string;
  exportText: string;
  onClose: () => void;
}) {
  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog hookhub-dialog" role="dialog" aria-modal="true" aria-labelledby="hookhub-export-title">
        <header>
          <div>
            <span className="eyebrow">HookHub</span>
            <h2 id="hookhub-export-title">{suiteName} 导出 JSON</h2>
          </div>
          <button className="secondary" type="button" onClick={onClose}>
            关闭
          </button>
        </header>
        <label className="field wide">
          导出 JSON
          <textarea readOnly value={exportText} />
        </label>
      </section>
    </div>
  );
}

function ProjectHookToolRow({
  tool,
  suites,
  busy,
  onWriteHooks,
  onShareHooks,
  onApplySuite,
  onSyncTool,
  onRemoveBinding
}: {
  tool: ProjectHookToolState;
  suites: HookHubSuite[];
  busy: boolean;
  onWriteHooks: (toolId: HookHubSupportedToolId, hooks: unknown, input?: Partial<HookHubSuiteInput>) => void;
  onShareHooks: (toolId: HookHubSupportedToolId, input: HookHubSuiteInput) => void;
  onApplySuite: (toolId: HookHubSupportedToolId, suiteId: string, options?: ApplyPromptResult) => void;
  onSyncTool: (toolId: HookHubSupportedToolId) => void;
  onRemoveBinding: (toolId: HookHubSupportedToolId) => void;
}) {
  const supportedToolId = isHookHubSupportedToolId(tool.toolId) ? tool.toolId : null;
  const [hooksJson, setHooksJson] = useState(() => JSON.stringify(tool.hooks ?? {}, null, 2));
  const [suiteId, setSuiteId] = useState("");
  const compatibleSuites = useMemo(
    () => (supportedToolId ? suites.filter((suite) => suite.payloads[supportedToolId] !== undefined) : []),
    [supportedToolId, suites]
  );

  useEffect(() => {
    setHooksJson(JSON.stringify(tool.hooks ?? {}, null, 2));
    setSuiteId(compatibleSuites[0]?.suiteId ?? "");
  }, [compatibleSuites, tool.hooks]);

  function parseHooks(): unknown | null {
    try {
      return JSON.parse(hooksJson);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "hooks JSON 解析失败");
      return null;
    }
  }

  if (!supportedToolId) {
    return (
      <article
        className="project-hook-tool-row unsupported"
        role="button"
        tabIndex={0}
        title="尚未支持"
        onClick={() => window.alert("尚未支持")}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") window.alert("尚未支持");
        }}
      >
        <div className="project-hook-tool-main">
          <strong>{tool.label}</strong>
          <span className={statusClass(tool.status)}>{statusLabel(tool.status)}</span>
          <p>{tool.reason}</p>
          {tool.discovery.length ? <small>{tool.discovery.join("；")}</small> : null}
        </div>
      </article>
    );
  }

  return (
    <details className="project-hook-tool-row">
      <summary>
        <span className="project-hook-tool-main">
          <strong>{tool.label}</strong>
          <span className={statusClass(tool.status)}>{statusLabel(tool.status)}</span>
          <span>{tool.hooksSummary}</span>
        </span>
      </summary>
      <div className="project-hook-tool-body">
        <div className="project-meta">
          {tool.configPath ? <span>{tool.configPath}</span> : null}
          {tool.suite ? <span>suite: {tool.suite.name}</span> : null}
          {tool.reason ? <span>{tool.reason}</span> : null}
          {tool.error ? <span>{tool.error}</span> : null}
        </div>
        <label className="field wide">
          hooks JSON
          <textarea value={hooksJson} disabled={busy || tool.status === "invalid"} onChange={(event) => setHooksJson(event.target.value)} />
        </label>
        <div className="inline-actions">
          <button
            className="secondary"
            type="button"
            disabled={busy || tool.status === "invalid"}
            onClick={() => {
              const parsed = parseHooks();
              if (parsed !== null) onWriteHooks(supportedToolId, parsed);
            }}
          >
            保存到项目
          </button>
          <button
            className="primary"
            type="button"
            disabled={busy || tool.status === "invalid"}
            onClick={() => {
              const parsed = parseHooks();
              const name = window.prompt("新 suite name", "");
              if (parsed !== null && name) onWriteHooks(supportedToolId, parsed, { name });
            }}
          >
            新建 suite 并应用
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy || tool.status === "invalid" || tool.status === "missing"}
            onClick={() => {
              const name = window.prompt("上传到 HookHub 的 suite name", "");
              if (name) onShareHooks(supportedToolId, { name, payloads: {} });
            }}
          >
            {tool.status === "drifted" ? "另存为新 suite" : "上传到 HookHub"}
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy || tool.status !== "drifted" || !tool.binding}
            onClick={() => {
              if (tool.binding && window.confirm("用当前项目 hooks 覆盖原 HookHub suite？")) {
                onApplySuite(supportedToolId, tool.binding.suiteId, { mode: "update-bound-suite-then-overwrite" });
              }
            }}
          >
            覆盖原 suite
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy || (tool.status !== "outdated" && tool.status !== "missing")}
            onClick={() => onSyncTool(supportedToolId)}
          >
            从 HookHub 同步
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy || tool.status !== "missing" || !tool.binding}
            onClick={() => {
              if (window.confirm("移除当前 missing hooks 的 HookHub binding？项目文件不会被修改。")) onRemoveBinding(supportedToolId);
            }}
          >
            移除 binding
          </button>
        </div>
        <div className="hookhub-apply-row">
          <label className="field">
            应用 suite
            <select value={suiteId} disabled={busy || compatibleSuites.length === 0} onChange={(event) => setSuiteId(event.target.value)}>
              {compatibleSuites.map((suite) => (
                <option value={suite.suiteId} key={suite.suiteId}>
                  {suite.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            type="button"
            disabled={busy || !suiteId}
            onClick={() => {
              const options = chooseApplyOptions(tool);
              if (options !== null) onApplySuite(supportedToolId, suiteId, options);
            }}
          >
            应用
          </button>
        </div>
      </div>
    </details>
  );
}

interface SuiteDraft {
  name: string;
  description: string;
  riskNotes: string;
  requiredEnv: string;
  payloads: Record<HookHubSupportedToolId, string>;
}

interface StructuredHookDraft {
  name: string;
  description: string;
  riskNotes: string;
  requiredEnv: string;
  toolId: HookHubSupportedToolId;
  hooks: StructuredHookRuleDraft[];
}

interface StructuredHookRuleDraft {
  hookId: string;
  matcher: string;
  command: string;
}

interface HookTemplate {
  id: string;
  label: string;
  matcher: boolean;
}

const structuredHookTemplates: Record<HookHubSupportedToolId, HookTemplate[]> = {
  claude: [
    { id: "PreToolUse", label: "工具调用前 PreToolUse", matcher: true },
    { id: "PostToolUse", label: "工具调用后 PostToolUse", matcher: true },
    { id: "UserPromptSubmit", label: "提交提示词 UserPromptSubmit", matcher: false },
    { id: "Notification", label: "通知 Notification", matcher: false },
    { id: "Stop", label: "响应结束 Stop", matcher: false },
    { id: "SubagentStop", label: "子代理停止 SubagentStop", matcher: false },
    { id: "SessionStart", label: "会话开始 SessionStart", matcher: false },
    { id: "PreCompact", label: "压缩前 PreCompact", matcher: false }
  ],
  codex: [
    { id: "pre", label: "执行前 pre", matcher: false },
    { id: "post", label: "执行后 post", matcher: false },
    { id: "stop", label: "响应结束 stop", matcher: false }
  ],
  qwen: [
    { id: "pre", label: "执行前 pre", matcher: false },
    { id: "post", label: "执行后 post", matcher: false },
    { id: "stop", label: "响应结束 stop", matcher: false }
  ],
  qoder: [
    { id: "pre", label: "执行前 pre", matcher: false },
    { id: "post", label: "执行后 post", matcher: false },
    { id: "stop", label: "响应结束 stop", matcher: false }
  ]
};

function StructuredHookSuiteForm({
  draft,
  busy,
  onChange,
  onSubmit
}: {
  draft: StructuredHookDraft;
  busy: boolean;
  onChange: (draft: StructuredHookDraft) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const hookTemplates = structuredHookTemplates[draft.toolId];
  const hasCommand = draft.hooks.some((hook) => hook.command.trim());

  function selectTool(toolId: HookHubSupportedToolId) {
    onChange({
      ...draft,
      toolId,
      hooks: [emptyStructuredHookRuleDraft(toolId)]
    });
  }

  function selectHook(index: number, hookId: string) {
    const current = draft.hooks[index];
    if (!current) return;
    const hook = hookTemplates.find((item) => item.id === hookId) ?? firstStructuredHookTemplate(draft.toolId);
    updateHook(index, { hookId, matcher: hook.matcher ? current.matcher || defaultStructuredMatcher(draft.toolId, hook) : "" });
  }

  function updateHook(index: number, next: Partial<StructuredHookRuleDraft>) {
    onChange({
      ...draft,
      hooks: draft.hooks.map((hook, currentIndex) => (currentIndex === index ? { ...hook, ...next } : hook))
    });
  }

  function addHook() {
    onChange({
      ...draft,
      hooks: [...draft.hooks, emptyStructuredHookRuleDraft(draft.toolId)]
    });
  }

  function removeHook(index: number) {
    if (draft.hooks.length <= 1) return;
    onChange({
      ...draft,
      hooks: draft.hooks.filter((_, currentIndex) => currentIndex !== index)
    });
  }

  return (
    <form className="hookhub-suite-form" onSubmit={onSubmit}>
      <div className="hookhub-form-grid">
        <label className="field">
          suite name
          <input value={draft.name} disabled={busy} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
        </label>
        <label className="field">
          工具
          <select value={draft.toolId} disabled={busy} onChange={(event) => selectTool(event.target.value as HookHubSupportedToolId)}>
            {supportedToolIds.map((toolId) => (
              <option value={toolId} key={toolId}>
                {toolId}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          requiredEnv
          <input
            value={draft.requiredEnv}
            disabled={busy}
            onChange={(event) => onChange({ ...draft, requiredEnv: event.target.value })}
            placeholder="TOKEN_A, TOKEN_B"
          />
        </label>
        <label className="field wide">
          description
          <input value={draft.description} disabled={busy} onChange={(event) => onChange({ ...draft, description: event.target.value })} />
        </label>
        <label className="field wide">
          risk notes
          <input value={draft.riskNotes} disabled={busy} onChange={(event) => onChange({ ...draft, riskNotes: event.target.value })} />
        </label>
      </div>
      <div className="hookhub-structured-hook-list">
        {draft.hooks.map((hookDraft, index) => {
          const selectedHook = hookTemplates.find((hook) => hook.id === hookDraft.hookId) ?? firstStructuredHookTemplate(draft.toolId);
          return (
            <div className="hookhub-structured-hook-row" key={index}>
              <label className="field">
                可配置 hook
                <select value={hookDraft.hookId} disabled={busy} onChange={(event) => selectHook(index, event.target.value)}>
                  {hookTemplates.map((hook) => (
                    <option value={hook.id} key={hook.id}>
                      {hook.label}
                    </option>
                  ))}
                </select>
              </label>
              {selectedHook.matcher ? (
                <label className="field">
                  matcher
                  <input value={hookDraft.matcher} disabled={busy} onChange={(event) => updateHook(index, { matcher: event.target.value })} placeholder="Bash" />
                </label>
              ) : null}
              <label className={selectedHook.matcher ? "field" : "field wide"}>
                命令
                <input value={hookDraft.command} disabled={busy} onChange={(event) => updateHook(index, { command: event.target.value })} placeholder="npm test" />
              </label>
              <button className="secondary" type="button" disabled={busy || draft.hooks.length <= 1} onClick={() => removeHook(index)}>
                移除
              </button>
            </div>
          );
        })}
      </div>
      <div className="inline-actions">
        <button className="secondary" type="button" disabled={busy} onClick={addHook}>
          添加 hook
        </button>
        <button className="primary" type="submit" disabled={busy || !draft.name.trim() || !hasCommand}>
          创建 suite
        </button>
      </div>
    </form>
  );
}

function SuiteDraftForm({
  draft,
  busy,
  submitLabel,
  onChange,
  onSubmit
}: {
  draft: SuiteDraft;
  busy: boolean;
  submitLabel: string;
  onChange: (draft: SuiteDraft) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="hookhub-suite-form" onSubmit={onSubmit}>
      <div className="hookhub-form-grid">
        <label className="field">
          suite name
          <input value={draft.name} disabled={busy} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
        </label>
        <label className="field">
          requiredEnv
          <input value={draft.requiredEnv} disabled={busy} onChange={(event) => onChange({ ...draft, requiredEnv: event.target.value })} placeholder="TOKEN_A, TOKEN_B" />
        </label>
        <label className="field wide">
          description
          <input value={draft.description} disabled={busy} onChange={(event) => onChange({ ...draft, description: event.target.value })} />
        </label>
        <label className="field wide">
          risk notes
          <input value={draft.riskNotes} disabled={busy} onChange={(event) => onChange({ ...draft, riskNotes: event.target.value })} />
        </label>
      </div>
      <div className="hookhub-payload-grid">
        {supportedToolIds.map((toolId) => (
          <label className="field wide" key={toolId}>
            {toolId} hooks
            <textarea
              value={draft.payloads[toolId]}
              disabled={busy}
              onChange={(event) => onChange({ ...draft, payloads: { ...draft.payloads, [toolId]: event.target.value } })}
              placeholder="{}"
            />
          </label>
        ))}
      </div>
      <div className="inline-actions">
        <button className="primary" type="submit" disabled={busy || !draft.name.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

interface ApplyPromptResult {
  mode?: HookHubApplyMode | null;
  preserveName?: string | null;
}

function chooseApplyOptions(tool: ProjectHookToolState): ApplyPromptResult | null {
  if (tool.status === "unmanaged") {
    const choice = window.prompt("当前是 unmanaged hooks：输入 1 覆盖，2 上传当前 hooks 后覆盖，3 取消", "3");
    if (choice === "1") return { mode: "overwrite" };
    if (choice === "2") {
      const preserveName = window.prompt("保存当前 hooks 的 suite name", "");
      return preserveName ? { mode: "upload-then-overwrite", preserveName } : null;
    }
    return null;
  }
  if (tool.status === "drifted") {
    const choice = window.prompt("当前是 drifted hooks：输入 1 覆盖，2 写回原 suite 后覆盖，3 另存为新 suite 后覆盖，4 取消", "4");
    if (choice === "1") return { mode: "overwrite" };
    if (choice === "2") return { mode: "update-bound-suite-then-overwrite" };
    if (choice === "3") {
      const preserveName = window.prompt("另存当前 hooks 的 suite name", "");
      return preserveName ? { mode: "save-as-new-suite-then-overwrite", preserveName } : null;
    }
    return null;
  }
  return { mode: "overwrite" };
}

function suiteDraftInput(draft: SuiteDraft, setError: (error: string) => void): HookHubSuiteInput | null {
  const payloads: HookHubSuiteInput["payloads"] = {};
  try {
    for (const toolId of supportedToolIds) {
      const text = draft.payloads[toolId].trim();
      if (text) payloads[toolId] = JSON.parse(text);
    }
  } catch (error) {
    setError(error instanceof Error ? error.message : "payload JSON 解析失败");
    return null;
  }
  setError("");
  return {
    name: draft.name,
    description: draft.description,
    riskNotes: draft.riskNotes,
    requiredEnv: draft.requiredEnv.split(",").map((item) => item.trim()).filter(Boolean),
    payloads
  };
}

function structuredHookDraftInput(draft: StructuredHookDraft, setError: (error: string) => void): HookHubSuiteInput | null {
  const hooks = draft.hooks
    .map((hook) => ({
      hook,
      template: structuredHookTemplates[draft.toolId].find((item) => item.id === hook.hookId) ?? null,
      command: hook.command.trim()
    }))
    .filter((hook) => hook.command);
  if (!hooks.length) {
    setError("至少需要配置一个 hook 命令");
    return null;
  }
  if (hooks.some((hook) => !hook.template)) {
    setError("请选择可配置 hook");
    return null;
  }
  setError("");
  return {
    name: draft.name,
    description: draft.description,
    riskNotes: draft.riskNotes,
    requiredEnv: draft.requiredEnv.split(",").map((item) => item.trim()).filter(Boolean),
    payloads: {
      [draft.toolId]: structuredHookPayload(
        draft.toolId,
        hooks.map((hook) => ({
          template: hook.template as HookTemplate,
          matcher: hook.hook.matcher,
          command: hook.command
        }))
      )
    }
  };
}

function structuredHookPayload(
  toolId: HookHubSupportedToolId,
  hooks: Array<{ template: HookTemplate; matcher: string; command: string }>
): Record<string, unknown[]> {
  const payload: Record<string, unknown[]> = {};
  for (const hook of hooks) {
    const entry =
      toolId === "claude"
        ? {
            ...(hook.template.matcher && hook.matcher.trim() ? { matcher: hook.matcher.trim() } : {}),
            hooks: [{ type: "command", command: hook.command }]
          }
        : { command: hook.command };
    payload[hook.template.id] = [...(payload[hook.template.id] ?? []), entry];
  }
  return payload;
}

function firstStructuredHookTemplate(toolId: HookHubSupportedToolId): HookTemplate {
  const first = structuredHookTemplates[toolId][0];
  if (!first) throw new Error("HookHub structured hook templates missing");
  return first;
}

function emptyStructuredHookRuleDraft(toolId: HookHubSupportedToolId): StructuredHookRuleDraft {
  const hook = firstStructuredHookTemplate(toolId);
  return {
    hookId: hook.id,
    matcher: defaultStructuredMatcher(toolId, hook),
    command: ""
  };
}

function defaultStructuredMatcher(toolId: HookHubSupportedToolId, hook: HookTemplate): string {
  return toolId === "claude" && hook.matcher ? "Bash" : "";
}

function suiteInputFromJsonText(input: string, setError: (error: string) => void): HookHubSuiteInput | null {
  try {
    const parsed = JSON.parse(input);
    const candidate = isRecord(parsed) && isRecord(parsed.suite) ? parsed.suite : parsed;
    if (!isRecord(candidate)) throw new Error("suite JSON 必须是对象");
    if (typeof candidate.name !== "string" || !candidate.name.trim()) throw new Error("suite JSON 需要 name");
    const payloadSource = isRecord(candidate.payloads) ? candidate.payloads : {};
    const payloads: HookHubSuiteInput["payloads"] = {};
    for (const toolId of supportedToolIds) {
      if (Object.prototype.hasOwnProperty.call(payloadSource, toolId)) payloads[toolId] = payloadSource[toolId];
    }
    setError("");
    return {
      name: candidate.name,
      description: optionalString(candidate.description),
      riskNotes: optionalString(candidate.riskNotes),
      requiredEnv: requiredEnvInput(candidate.requiredEnv),
      payloads
    };
  } catch (error) {
    setError(error instanceof Error ? error.message : "suite JSON 解析失败");
    return null;
  }
}

function emptyStructuredHookDraft(): StructuredHookDraft {
  return {
    name: "",
    description: "",
    riskNotes: "",
    requiredEnv: "",
    toolId: "claude",
    hooks: [emptyStructuredHookRuleDraft("claude")]
  };
}

function emptySuiteDraft(): SuiteDraft {
  return {
    name: "",
    description: "",
    riskNotes: "",
    requiredEnv: "",
    payloads: { claude: "", codex: "", qwen: "", qoder: "" }
  };
}

function suiteDraftFromSuite(suite: HookHubSuite): SuiteDraft {
  return {
    name: suite.name,
    description: suite.description ?? "",
    riskNotes: suite.riskNotes ?? "",
    requiredEnv: suite.requiredEnv.join(", "),
    payloads: Object.fromEntries(
      supportedToolIds.map((toolId) => [toolId, suite.payloads[toolId] === undefined ? "" : JSON.stringify(suite.payloads[toolId], null, 2)])
    ) as Record<HookHubSupportedToolId, string>
  };
}

function isHookHubSupportedToolId(value: string): value is HookHubSupportedToolId {
  return value === "claude" || value === "codex" || value === "qwen" || value === "qoder";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredEnvInput(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function statusLabel(status: HookHubProjectStatus): string {
  const labels: Record<HookHubProjectStatus, string> = {
    current: "current",
    outdated: "outdated",
    drifted: "drifted",
    missing: "missing",
    unmanaged: "unmanaged",
    invalid: "invalid",
    unsupported: "unsupported"
  };
  return labels[status];
}

function statusClass(status: HookHubProjectStatus): string {
  return `metric-pill hook-status hook-status-${status}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
