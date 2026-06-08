import React, { useEffect, useMemo, useState } from "react";
import type {
  McpHubImportResult,
  McpHubList,
  McpHubServer,
  McpHubTargetToolId,
  ProjectLocalMcpEntry,
  ProjectMcpApplyResult,
  ProjectMcpState
} from "../shared/types.js";
import { isMcpHubTargetToolId } from "../shared/types.js";

export function McpHubPage({
  mcphub,
  busy,
  lastImport,
  onImportJson,
  onDeleteServer
}: {
  mcphub: McpHubList | null;
  busy: boolean;
  lastImport: McpHubImportResult | null;
  onImportJson: (input: string) => void;
  onDeleteServer: (serverId: string) => void;
}) {
  const [jsonInput, setJsonInput] = useState("");

  return (
    <section className="content mcphub-page">
      <details className="toolbar-panel compact hub-import-panel mcphub-import-panel" role="region" aria-label="McpHub JSON 导入">
        <summary>
          <span className="hub-import-title">JSON 导入</span>
          <span className="metric-pill">mcpServers</span>
        </summary>
        <div className="hub-import-body mcphub-import-body">
          <label className="field wide">
            MCP JSON
            <textarea
              value={jsonInput}
              onChange={(event) => setJsonInput(event.target.value)}
              placeholder='粘贴 {"mcpServers": {"context7": {"command": "npx", "args": ["-y", "@upstash/context7-mcp"]}}}'
            />
          </label>
          <div className="inline-actions">
            <button className="primary" type="button" disabled={busy || !jsonInput.trim()} onClick={() => onImportJson(jsonInput)}>
              导入JSON
            </button>
          </div>
          {lastImport ? <McpHubImportSummary result={lastImport} /> : null}
        </div>
      </details>

      {!mcphub ? (
        <div className="empty-state">
          <h2>正在读取 McpHub</h2>
        </div>
      ) : mcphub.servers.length === 0 ? (
        <div className="empty-state">
          <h2>还没有 MCP server</h2>
          <p>导入 JSON 后，会显示在这里。</p>
        </div>
      ) : (
        <section className="mcphub-server-list" aria-label="McpHub server 列表">
          {mcphub.servers.map((server) => (
            <McpHubServerCard key={server.serverId} server={server} busy={busy} onDelete={onDeleteServer} />
          ))}
        </section>
      )}
    </section>
  );
}

export function ProjectMcpPanel({
  state,
  busy,
  lastApply,
  onClose,
  onUpdateServerTools,
  onMigrate
}: {
  state: ProjectMcpState | null;
  busy: boolean;
  lastApply: ProjectMcpApplyResult | null;
  onClose: () => void;
  onUpdateServerTools: (serverId: string, toolIds: McpHubTargetToolId[]) => void;
  onMigrate: (serverId: string) => void;
}) {
  const [tab, setTab] = useState<"local" | "hub">("local");
  const groupedLocal = useMemo(() => groupLocalEntries(state?.localEntries ?? []), [state]);
  const enabledTargets = useMemo(() => state?.targets.filter((target) => target.enabled) ?? [], [state]);

  return (
    <aside className="side-panel project-mcp-panel" aria-label="项目 MCP 管理">
      <header>
        <div>
          <span className="eyebrow">McpHub</span>
          <h2>项目 MCP</h2>
        </div>
        <button className="secondary" type="button" onClick={onClose} disabled={busy}>
          关闭
        </button>
      </header>

      {!state ? (
        <div className="muted">正在读取项目 MCP...</div>
      ) : (
        <>
          <p className="path-line">{state.targetRootPath}</p>
          <div className="segmented-tabs" role="tablist" aria-label="MCP 面板">
            <button className={tab === "local" ? "active" : ""} type="button" onClick={() => setTab("local")}>
              本地 MCP
            </button>
            <button className={tab === "hub" ? "active" : ""} type="button" onClick={() => setTab("hub")}>
              McpHub MCP
            </button>
          </div>

          {lastApply?.warnings.length ? (
            <div className="inline-warning" role="alert">
              {lastApply.warnings.join("；")}
            </div>
          ) : null}

          {tab === "local" ? (
            groupedLocal.length === 0 ? (
              <div className="empty-state compact">没有发现本地 MCP</div>
            ) : (
              <div className="project-local-mcp-list">
                {groupedLocal.map((group) => (
                  <article className="project-local-mcp-row" key={group.serverId}>
                    <div>
                      <div className="project-local-skill-title">
                        <strong>{group.serverId}</strong>
                        <span className="metric-pill">{group.entries.length} 个目标</span>
                        <span className="metric-pill">{group.entries.some((entry) => entry.status === "managed") ? "McpHub" : "Local"}</span>
                      </div>
                      <p>{localMcpSummary(group.entries)}</p>
                      <small>{group.entries.map((entry) => `${entry.toolId}: ${entry.filePath}`).join("；")}</small>
                    </div>
                    {group.entries.some((entry) => entry.status === "unmanaged") ? (
                      <button className="primary" type="button" disabled={busy} onClick={() => onMigrate(group.serverId)}>
                        迁移到McpHub
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            )
          ) : (
            <div className="project-mcphub-list">
              {state.servers.length === 0 ? (
                <div className="empty-state compact">McpHub 中心库为空</div>
              ) : (
                state.servers.map((server) => {
                  const active = new Set(state.bindings.filter((binding) => binding.serverId === server.serverId).map((binding) => binding.toolId));
                  return (
                    <ProjectMcpHubServerRow
                      key={server.serverId}
                      server={server}
                      targets={enabledTargets}
                      activeToolIds={active}
                      busy={busy}
                      onUpdateServerTools={onUpdateServerTools}
                    />
                  );
                })
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function ProjectMcpHubServerRow({
  server,
  targets,
  activeToolIds,
  busy,
  onUpdateServerTools
}: {
  server: McpHubServer;
  targets: ProjectMcpState["targets"];
  activeToolIds: Set<McpHubTargetToolId>;
  busy: boolean;
  onUpdateServerTools: (serverId: string, toolIds: McpHubTargetToolId[]) => void;
}) {
  const supportedToolIds = targets.filter((target) => target.supported && isMcpHubTargetToolId(target.toolId)).map((target) => target.toolId as McpHubTargetToolId);
  const activeTargetIds = targets.filter((target) => isMcpHubTargetToolId(target.toolId) && activeToolIds.has(target.toolId)).map((target) => target.toolId as McpHubTargetToolId);
  const checked = supportedToolIds.length > 0 && supportedToolIds.every((toolId) => activeToolIds.has(toolId));
  const indeterminate = supportedToolIds.some((toolId) => activeToolIds.has(toolId)) && !checked;

  return (
    <details className="project-mcphub-row">
      <summary>
        <IndeterminateCheckbox
          ariaLabel={`选择 ${server.serverId} 全部工具`}
          checked={checked}
          indeterminate={indeterminate}
          disabled={busy || supportedToolIds.length === 0}
          onChange={(next) => onUpdateServerTools(server.serverId, next ? supportedToolIds : [])}
        />
        <span className="skillhub-source-main">
          <span className="skillhub-skill-title">{server.serverId}</span>
          <span className="metric-pill">{server.transport}</span>
        </span>
      </summary>
      <div className="skillhub-skill-body project-mcphub-body">
        <p>{server.description ?? server.name ?? "无描述"}</p>
        <div className="tool-chip-list" aria-label={`${server.serverId} 可配置工具`}>
          {targets.length === 0 ? <div className="empty-state compact">还没有可配置工具</div> : null}
          {targets.map((target) => {
            const supportedToolId = isMcpHubTargetToolId(target.toolId) ? target.toolId : null;
            const checked = supportedToolId ? activeToolIds.has(supportedToolId) : false;
            return (
              <label
                className="tool-target-chip"
                key={`${server.serverId}:${target.toolId}`}
                title={target.supported ? target.configPath : "尚未支持"}
                onClick={(event) => {
                  if (!busy && !target.supported) {
                    event.preventDefault();
                    window.alert("尚未支持");
                  }
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy || !target.supported || !supportedToolId}
                  onChange={(event) => {
                    if (!supportedToolId) return;
                    const next = event.target.checked
                      ? uniqueMcpTargetToolIds([...activeTargetIds, supportedToolId])
                      : activeTargetIds.filter((toolId) => toolId !== supportedToolId);
                    onUpdateServerTools(server.serverId, next);
                  }}
                />
                <span>{target.toolId}</span>
              </label>
            );
          })}
        </div>
        {server.requiredEnv.length ? <small>requiredEnv: {server.requiredEnv.join(", ")}</small> : null}
      </div>
    </details>
  );
}

export function McpHubServerCard({
  server,
  busy,
  onDelete,
  summaryPrefix,
  summaryExtra,
  className
}: {
  server: McpHubServer;
  busy: boolean;
  onDelete?: (serverId: string) => void;
  summaryPrefix?: React.ReactNode;
  summaryExtra?: React.ReactNode;
  className?: string;
}) {
  return (
    <details className={["mcphub-server-card", className].filter(Boolean).join(" ")}>
      <summary>
        <span className="skillhub-source-main">
          {summaryPrefix}
          <span className="skillhub-source-title">{server.serverId}</span>
          <span className="metric-pill">{server.transport}</span>
          {server.builtin ? <span className="metric-pill">内置</span> : null}
        </span>
        <span className="skillhub-source-actions">
          <span className="metric-pill strong">{formatTime(server.updatedAt)}</span>
          {summaryExtra}
        </span>
      </summary>
      <div className="skillhub-skill-body">
        <p>{server.description ?? server.name ?? "无描述"}</p>
        <div className="project-meta">
          {server.command ? <span>command: {server.command}</span> : null}
          {server.url ? <span>url: {server.url}</span> : null}
          {server.requiredEnv.length ? <span>requiredEnv: {server.requiredEnv.join(", ")}</span> : null}
        </div>
        <pre className="json-preview">{JSON.stringify(serverJson(server), null, 2)}</pre>
        {!server.builtin && onDelete ? (
          <div className="card-actions">
            <button className="danger" type="button" disabled={busy} onClick={() => onDelete(server.serverId)}>
              删除
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function McpHubImportSummary({ result }: { result: McpHubImportResult }) {
  return (
    <div className="project-meta mcphub-import-summary" role="status">
      <span>新增 {result.added.length}</span>
      <span>更新 {result.updated.length}</span>
      <span>Patch {result.patched.length}</span>
      <span>失败 {result.failed.length}</span>
      {result.failed.length ? <span>{result.failed.map((failure) => `${failure.serverId ?? "unknown"}: ${failure.reason}`).join("；")}</span> : null}
    </div>
  );
}

function groupLocalEntries(entries: ProjectLocalMcpEntry[]): Array<{ serverId: string; entries: ProjectLocalMcpEntry[] }> {
  const groups = new Map<string, ProjectLocalMcpEntry[]>();
  for (const entry of entries) {
    groups.set(entry.serverId, [...(groups.get(entry.serverId) ?? []), entry]);
  }
  return [...groups.entries()].map(([serverId, groupEntries]) => ({ serverId, entries: groupEntries }));
}

function localMcpSummary(entries: ProjectLocalMcpEntry[]): string {
  const invalid = entries.filter((entry) => entry.status === "invalid");
  if (invalid.length) return invalid.map((entry) => `${entry.toolId}: ${entry.reason ?? "无效配置"}`).join("；");
  return entries
    .map((entry) => `${entry.toolId}: ${entry.server?.transport ?? entry.status}${entry.status === "managed" ? "，已接管" : ""}`)
    .join("；");
}

function serverJson(server: McpHubServer): Record<string, unknown> {
  return {
    serverId: server.serverId,
    name: server.name,
    description: server.description,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    headers: server.headers,
    env: server.env,
    requiredEnv: server.requiredEnv
  };
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function IndeterminateCheckbox({
  ariaLabel,
  checked,
  indeterminate,
  disabled,
  onChange
}: {
  ariaLabel: string;
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = React.useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      aria-label={ariaLabel}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

function uniqueMcpTargetToolIds(toolIds: McpHubTargetToolId[]): McpHubTargetToolId[] {
  return [...new Set(toolIds)];
}
