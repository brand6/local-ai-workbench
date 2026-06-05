import { useMemo, useState } from "react";
import type { CliHubChannel, CliHubCli, CliHubList } from "../shared/types.js";

export function CliHubPage({
  clihub,
  busy,
  onRefresh,
  onCheckAll,
  onCheckOne,
  onInstall,
  onUpdate,
  onAddLocal,
  onAddInstallCommand,
  onAddChannel
}: {
  clihub: CliHubList | null;
  busy: boolean;
  onRefresh: (cliId?: string) => void;
  onCheckAll: () => void;
  onCheckOne: (cliId: string) => void;
  onInstall: (cliId: string, channelId: string) => void;
  onUpdate: (cliId: string) => void;
  onAddLocal: (input: { executablePath: string; displayName?: string; commandName?: string }) => void;
  onAddInstallCommand: (input: { installCommand: string; displayName?: string; commandName?: string }) => void;
  onAddChannel: (cliId: string, installCommand: string) => void;
}) {
  const groups = useMemo(() => groupCliRows(clihub?.clis ?? []), [clihub]);

  return (
    <section className="content clihub-page">
      <section className="toolbar-panel compact clihub-actions-panel" aria-label="CliHub 操作">
        <div className="home-actions">
          <button className="primary" type="button" disabled={busy} onClick={() => onRefresh()}>
            检测已安装Cli
          </button>
          <button className="secondary" type="button" disabled={busy} onClick={onCheckAll}>
            检查全部更新
          </button>
        </div>
      </section>

      <CustomCliPanel busy={busy} onAddLocal={onAddLocal} onAddInstallCommand={onAddInstallCommand} />

      {!clihub ? (
        <div className="empty-state">
          <h2>正在读取 CliHub</h2>
        </div>
      ) : (
        <div className="clihub-group-list">
          {groups.map((group) => (
            <section className="clihub-group" key={group.kind} aria-label={groupLabel(group.kind)}>
              <header className="section-heading">
                <h2>{groupLabel(group.kind)}</h2>
                <span className="metric-pill">{group.clis.length}</span>
              </header>
              <div className="clihub-cli-list">
                {group.clis.map((cli) => (
                  <CliHubCliRow
                    key={cli.cliId}
                    cli={cli}
                    busy={busy}
                    onCheckOne={onCheckOne}
                    onInstall={onInstall}
                    onUpdate={onUpdate}
                    onAddChannel={onAddChannel}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function CustomCliPanel({
  busy,
  onAddLocal,
  onAddInstallCommand
}: {
  busy: boolean;
  onAddLocal: (input: { executablePath: string; displayName?: string; commandName?: string }) => void;
  onAddInstallCommand: (input: { installCommand: string; displayName?: string; commandName?: string }) => void;
}) {
  const [mode, setMode] = useState<"local" | "command">("local");
  const [displayName, setDisplayName] = useState("");
  const [commandName, setCommandName] = useState("");
  const [executablePath, setExecutablePath] = useState("");
  const [installCommand, setInstallCommand] = useState("");

  return (
    <details className="toolbar-panel compact clihub-custom-panel" role="region" aria-label="CliHub 自定义 CLI">
      <summary>
        <span className="hub-import-title">添加自定义 CLI</span>
        <span className="metric-pill">{mode === "local" ? "local-path" : "install-command"}</span>
      </summary>
      <div className="hub-import-body clihub-custom-body">
        <div className="segmented-tabs" role="tablist" aria-label="自定义 CLI 来源">
          <button className={mode === "local" ? "active" : ""} type="button" onClick={() => setMode("local")}>
            本地路径
          </button>
          <button className={mode === "command" ? "active" : ""} type="button" onClick={() => setMode("command")}>
            安装命令
          </button>
        </div>
        <div className="clihub-custom-grid">
          <label className="field">
            显示名称
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="可选" />
          </label>
          <label className="field">
            command
            <input value={commandName} onChange={(event) => setCommandName(event.target.value)} placeholder="可选" />
          </label>
          {mode === "local" ? (
            <label className="field wide">
              本地可执行文件路径
              <input value={executablePath} onChange={(event) => setExecutablePath(event.target.value)} placeholder="C:\\Tools\\example.exe" />
            </label>
          ) : (
            <label className="field wide">
              安装命令
              <input value={installCommand} onChange={(event) => setInstallCommand(event.target.value)} placeholder="npm install -g example-cli" />
            </label>
          )}
        </div>
        <div className="inline-actions">
          {mode === "local" ? (
            <button
              className="primary"
              type="button"
              disabled={busy || !executablePath.trim()}
              onClick={() => onAddLocal(compactInput({ executablePath, displayName, commandName }))}
            >
              添加本地 CLI
            </button>
          ) : (
            <button
              className="primary"
              type="button"
              disabled={busy || !installCommand.trim()}
              onClick={() => onAddInstallCommand(compactInput({ installCommand, displayName, commandName }))}
            >
              添加安装命令
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

function CliHubCliRow({
  cli,
  busy,
  onCheckOne,
  onInstall,
  onUpdate,
  onAddChannel
}: {
  cli: CliHubCli;
  busy: boolean;
  onCheckOne: (cliId: string) => void;
  onInstall: (cliId: string, channelId: string) => void;
  onUpdate: (cliId: string) => void;
  onAddChannel: (cliId: string, installCommand: string) => void;
}) {
  const [channelInput, setChannelInput] = useState("");
  const isInstalled = cli.availabilityState === "available";
  const canUpdate = Boolean(
    cli.updateStatus === "update-available" &&
      cli.currentProvider &&
      cli.currentProvider.confidence === "high" &&
      cli.currentProvider.provider !== "local-path"
  );
  const updateStatusLabel = updateLabel(cli.updateStatus);
  return (
    <details className="clihub-cli-row">
      <summary>
        <span className="skillhub-source-main">
          <span className="skillhub-source-title">{cli.displayName}</span>
          <span className="metric-pill">{cli.commandNames.join(", ")}</span>
          <span className={`metric-pill ${cli.availabilityState === "unavailable" ? "danger" : ""}`}>{availabilityLabel(cli.availabilityState)}</span>
          <span className="metric-pill">{versionLabel(cli)}</span>
          {updateStatusLabel ? <span className="metric-pill">{updateStatusLabel}</span> : null}
        </span>
      </summary>
      <div className="skillhub-skill-body clihub-cli-body">
        <div className="project-meta">
          <span>cliId: {cli.cliId}</span>
          <span>source: {sourceLabel(cli.sourceState)}</span>
          <span>provider: {providerLabel(cli)}</span>
        </div>
        {cli.resolvedPaths.length ? <small>paths: {cli.resolvedPaths.join("；")}</small> : <small>paths: 未发现</small>}
        {cli.versionError ? <small>version: {cli.versionError}</small> : null}
        {cli.providerCandidates.length ? <small>provider candidates: {cli.providerCandidates.map((candidate) => `${candidate.provider}:${candidate.packageId ?? "unknown"}`).join("；")}</small> : null}
        {cli.recentOperation && cli.recentOperation.kind !== "update-check" ? <OperationResult result={cli.recentOperation} /> : null}
        <div className="card-actions clihub-row-actions">
          <button className="secondary" type="button" disabled={busy} onClick={() => onCheckOne(cli.cliId)}>
            检查更新
          </button>
          {canUpdate ? (
            <button className="primary" type="button" disabled={busy} onClick={() => onUpdate(cli.cliId)}>
              更新
            </button>
          ) : null}
        </div>
        {!isInstalled && cli.channels.length ? (
          <div className="clihub-channel-list" aria-label={`${cli.displayName} 安装渠道`}>
            {cli.channels.map((channel) => (
              <CliHubChannelRow key={channel.channelId} cli={cli} channel={channel} busy={busy} onInstall={onInstall} />
            ))}
          </div>
        ) : !isInstalled ? (
          <div className="empty-state compact">没有可用安装渠道</div>
        ) : null}
        {!isInstalled && cli.sourceType === "builtin" ? (
          <div className="clihub-add-channel">
            <label className="field wide">
              追加安装渠道
              <input value={channelInput} onChange={(event) => setChannelInput(event.target.value)} placeholder="winget install --id Vendor.Tool" />
            </label>
            <button
              className="secondary"
              type="button"
              disabled={busy || !channelInput.trim()}
              onClick={() => {
                onAddChannel(cli.cliId, channelInput);
                setChannelInput("");
              }}
            >
              添加渠道
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function CliHubChannelRow({
  cli,
  channel,
  busy,
  onInstall
}: {
  cli: CliHubCli;
  channel: CliHubChannel;
  busy: boolean;
  onInstall: (cliId: string, channelId: string) => void;
}) {
  const installDisabled = busy || cli.availabilityState === "available" || !channel.installCommand;
  return (
    <div className="clihub-channel-row">
      <div>
        <strong>{channel.label}</strong>
        <small>{channel.installCommand ? channel.installCommand.join(" ") : "无安装命令"}</small>
      </div>
      <button className="primary" type="button" disabled={installDisabled} onClick={() => onInstall(cli.cliId, channel.channelId)}>
        安装
      </button>
    </div>
  );
}

function OperationResult({ result }: { result: CliHubCli["recentOperation"] }) {
  if (!result) return null;
  return (
    <div className={`inline-warning ${result.status === "success" ? "success" : ""}`} role="status">
      {operationLabel(result.kind)}：{result.message}
      {result.exitCode !== null ? `，exit ${result.exitCode}` : ""}
    </div>
  );
}

function groupCliRows(clis: CliHubCli[]): Array<{ kind: CliHubCli["kind"]; clis: CliHubCli[] }> {
  const order: CliHubCli["kind"][] = ["project-tool", "function", "dependency", "custom"];
  return order.map((kind) => ({ kind, clis: clis.filter((cli) => cli.kind === kind) })).filter((group) => group.clis.length > 0);
}

function groupLabel(kind: CliHubCli["kind"]): string {
  if (kind === "project-tool") return "项目工具 CLI";
  if (kind === "function") return "功能 CLI";
  if (kind === "dependency") return "依赖 CLI";
  return "自定义 CLI";
}

function sourceLabel(source: CliHubCli["sourceState"]): string {
  if (source === "builtin") return "内置";
  if (source === "local-path") return "local-path";
  return "install-command";
}

function availabilityLabel(state: CliHubCli["availabilityState"]): string {
  if (state === "available") return "可用";
  if (state === "unavailable") return "不可用";
  return "未发现";
}

function versionLabel(cli: CliHubCli): string {
  if (cli.version) return cli.version;
  if (cli.versionState === "failed") return "版本未知";
  return "版本未检查";
}

function updateLabel(status: CliHubCli["updateStatus"]): string | null {
  if (status === "update-available") return "可更新";
  return null;
}

function providerLabel(cli: CliHubCli): string {
  if (cli.currentProvider) return `${cli.currentProvider.provider}${cli.currentProvider.packageId ? `:${cli.currentProvider.packageId}` : ""}`;
  if (cli.providerCandidates.length) return "需要确认";
  return "unknown";
}

function operationLabel(kind: string): string {
  if (kind === "install") return "安装";
  if (kind === "update-check") return "检查更新";
  if (kind === "update") return "更新";
  return "刷新发现";
}

function compactInput<T extends Record<string, string>>(input: T): T {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value.trim()])) as T;
}
