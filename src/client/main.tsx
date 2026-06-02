import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { agentsIntegrationNames, terminalModes } from "../shared/types.js";
import type {
  AgentsCommandResult,
  AgentsConfigSyncStatus,
  AgentsIntegrationName,
  AppConfig,
  BootstrapState,
  ParserWarning,
  Project,
  ProjectDetail,
  ProjectDetailGroup,
  ProjectRepairCandidate,
  ScanCandidate,
  ScanDrive,
  TerminalMode,
  ToolId,
  ToolStatus
} from "../shared/types.js";
import { client } from "./api.js";
import "./styles.css";

interface ScanResultState {
  scanRunId: string;
  root: string;
  candidates: ScanCandidate[];
  addedCandidateIds: string[];
}

interface RepairSignal {
  id: string;
  label: string;
  toolId: string | null;
  source: string;
  message: string;
}

function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [warnings, setWarnings] = useState<ParserWarning[]>([]);
  const [repairCandidates, setRepairCandidates] = useState<ProjectRepairCandidate[]>([]);
  const [agentsStatuses, setAgentsStatuses] = useState<Record<string, AgentsConfigSyncStatus>>({});
  const [lastAgentsResults, setLastAgentsResults] = useState<Record<string, AgentsCommandResult | null>>({});
  const [drives, setDrives] = useState<ScanDrive[]>([]);
  const [scanResult, setScanResult] = useState<ScanResultState | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [scanStatus, setScanStatus] = useState("");
  const [selectedDriveRoot, setSelectedDriveRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    setDetail(null);
    setWarnings([]);
    setRepairCandidates([]);
    setAgentsStatuses({});
    setLastAgentsResults({});
    void loadDetail(selectedProjectId, query);
  }, [selectedProjectId, query]);

  useEffect(() => {
    if (selectedDriveRoot && drives.some((drive) => drive.root === selectedDriveRoot)) return;
    setSelectedDriveRoot(drives[0]?.root ?? "");
  }, [drives, selectedDriveRoot]);

  async function initialize() {
    const state = await client.bootstrap();
    setBootstrap(state);
    if (state.initialized) {
      await loadHome();
    }
  }

  async function loadHome() {
    const [projectList, toolList, warningList, driveList, appConfig] = await Promise.all([
      client.projects(),
      client.tools(),
      client.warnings(),
      client.drives(),
      client.config()
    ]);
    setProjects(projectList);
    setTools(toolList);
    setWarnings(warningList);
    setDrives(driveList);
    setConfig(appConfig);
  }

  async function loadDetail(projectId: string, search: string) {
    const [projectDetail, warningList] = await Promise.all([
      client.detail(projectId, search),
      client.warnings(projectId)
    ]);
    const repairList = await client.repairCandidates(projectId).catch(() => []);
    setDetail(projectDetail);
    setWarnings(warningList);
    setRepairCandidates(repairList);
    await loadAgentsStatuses(projectId, projectDetail.groups);
  }

  async function loadAgentsStatuses(projectId: string, groups: ProjectDetailGroup[]) {
    const entries = await Promise.all(
      groups.map(async (group) => {
        const status = await client.agentsStatus(projectId, group.fullPath).catch((error) => agentsStatusError(projectId, group.fullPath, error));
        return [group.fullPath, status] as const;
      })
    );
    setAgentsStatuses(Object.fromEntries(entries));
  }

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  if (!bootstrap) {
    return <Shell message="正在加载..." />;
  }

  if (!bootstrap.initialized) {
    return (
      <SetupScreen
        bootstrap={bootstrap}
        onDone={setBootstrapAndLoad}
        busy={busy}
        runAction={runAction}
        onPickDirectory={pickDirectory}
      />
    );
  }

  async function setBootstrapAndLoad(state: BootstrapState) {
    setBootstrap(state);
    await loadHome();
  }

  function clearProjectViewState() {
    setDetail(null);
    setWarnings([]);
    setRepairCandidates([]);
    setAgentsStatuses({});
    setLastAgentsResults({});
  }

  function returnHome() {
    setSelectedProjectId(null);
    setMessage("");
    clearProjectViewState();
  }

  function openProject(projectId: string) {
    setMessage("");
    setQuery("");
    clearProjectViewState();
    setSelectedProjectId(projectId);
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const totalSessions = projects.reduce((sum, project) => sum + project.sessionCount, 0);
  const projectActions = selectedProject ? (
    <div className="topbar-project-actions">
      <label className="toggle">
        <input
          type="checkbox"
          checked={selectedProject.includeSubdirectories}
          onChange={(event) => void runAction(() => toggleInclude(selectedProject.id, event.target.checked))}
        />
        子目录
      </label>
      <button className="primary" type="button" disabled={busy} onClick={() => void runAction(() => refreshProject(selectedProject.id))}>
        刷新项目
      </button>
    </div>
  ) : (
    <div className="home-actions topbar-home-actions" aria-label="项目操作">
      <div className="home-action-group">
        <span className="action-label">添加项目</span>
        <button className="primary" type="button" disabled={busy} onClick={() => void runAction(pickAndAddProject)}>
          选择文件夹
        </button>
      </div>
      <div className="home-action-group scan-action">
        <span className="action-label">扫描项目</span>
        <select
          className="drive-select"
          aria-label="扫描磁盘"
          value={selectedDriveRoot}
          onChange={(event) => setSelectedDriveRoot(event.target.value)}
        >
          {drives.map((drive) => (
            <option key={drive.root} value={drive.root}>
              {drive.label}
            </option>
          ))}
        </select>
        <button
          className="secondary"
          type="button"
          disabled={busy || !selectedDriveRoot}
          onClick={() => void runAction(() => scanRoot(selectedDriveRoot))}
        >
          {scanStatus ? "扫描中..." : "扫描"}
        </button>
      </div>
    </div>
  );

  return (
    <main className="app">
      <header className={`topbar${selectedProject ? " topbar-project-mode" : ""}`}>
        <button
          className="brand"
          type="button"
          onClick={returnHome}
        >
          <span className="brand-mark" aria-hidden="true">
            AI
          </span>
          <span>本地 AI 项目</span>
        </button>
        {selectedProject ? (
          <div className="topbar-project-context">
            <button className="secondary" type="button" onClick={returnHome}>
              返回
            </button>
            <div className="topbar-project-title">
              <h1>{lastSegment(selectedProject.rootPath)}</h1>
            </div>
          </div>
        ) : (
          <div className="topbar-home-context">
            <div className="summary-strip topbar-summary-strip" aria-label="项目统计">
              <StatTile label="项目" value={projects.length} />
              <StatTile label="会话" value={totalSessions} />
            </div>
          </div>
        )}
        <div className="topbar-actions">
          {projectActions}
          <button className="secondary" type="button" onClick={() => setSettingsOpen(true)} disabled={busy}>
            设置
          </button>
          <button className="secondary" type="button" onClick={() => setRefreshDialogOpen(true)} disabled={busy}>
            刷新索引
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <SettingsDialog
          bootstrap={bootstrap}
          config={config}
          busy={busy}
          onClose={() => setSettingsOpen(false)}
          onSaveDataDir={(dataDir) => void runAction(() => updateWorkingDirectory(dataDir))}
          onSaveTerminalMode={(mode) => void runAction(() => updateTerminalMode(mode))}
          onSaveAgentsCliPath={(cliPath) => void runAction(() => updateAgentsCliPath(cliPath))}
          onPickDirectory={pickDirectory}
        />
      ) : null}

      {refreshDialogOpen ? (
        <RefreshIndexDialog
          tools={tools}
          busy={busy}
          onClose={() => setRefreshDialogOpen(false)}
          onRefresh={(toolIds) => void runAction(() => refreshSessions(toolIds))}
        />
      ) : null}

      {message ? (
        <div className="notice" role="status" aria-live="polite">
          {message}
        </div>
      ) : null}

      {selectedProject ? (
        <ProjectDetailView
          project={selectedProject}
          detail={detail}
          tools={tools}
          query={query}
          warnings={warnings}
          repairCandidates={repairCandidates}
          agentsStatuses={agentsStatuses}
          lastAgentsResults={lastAgentsResults}
          busy={busy}
          setQuery={setQuery}
          onLaunch={(toolId, cwd) => void runAction(() => launchNew(toolId, cwd, selectedProject.rootPath))}
          onResume={(sessionId) => void runAction(() => resumeSession(sessionId))}
          onDeleteSession={(sessionId) => void runAction(() => deleteSession(sessionId))}
          onRepairProject={(targetProjectId, targetRootPath) => void runAction(() => repairProject(selectedProject.id, targetProjectId, targetRootPath))}
          onRelocateProject={() => void runAction(() => relocateProject(selectedProject.id))}
          onRefreshAgents={(rootPath) => void runAction(() => refreshAgents(selectedProject.id, rootPath))}
          onInitializeAgents={(rootPath) => void runAction(() => initializeAgents(selectedProject.id, rootPath))}
          onCheckAgentsSync={(rootPath) => void runAction(() => checkAgentsSync(selectedProject.id, rootPath))}
          onApplyAgentsSync={(rootPath) => void runAction(() => applyAgentsSync(selectedProject.id, rootPath))}
          onUpdateAgentsIntegrations={(rootPath, enabledIntegrations) => void runAction(() => updateAgentsIntegrations(selectedProject.id, rootPath, enabledIntegrations))}
        />
      ) : (
        <HomePage
          projects={projects}
          busy={busy}
          scanStatus={scanStatus}
          scanResult={scanResult}
          onOpen={openProject}
          onRemove={(id) => void runAction(() => removeProject(id))}
          onAddScanCandidate={(candidateId) => void runAction(() => addScanCandidate(candidateId))}
          onCloseScanResults={() => setScanResult(null)}
        />
      )}
    </main>
  );

  async function refreshSessions(toolIds: ToolId[]) {
    setRefreshDialogOpen(false);
    const result = await client.refreshSessions(toolIds);
    const addedText = result.addedProjectCount ? `，自动加入 ${result.addedProjectCount} 个项目` : "";
    setMessage(`索引完成：${result.indexedCount} 条，会话跳过 ${result.skippedCount} 条，警告 ${result.warningCount} 条${addedText}`);
    await loadHome();
    if (selectedProjectId) await loadDetail(selectedProjectId, query);
  }

  async function pickDirectory(): Promise<string | null> {
    const result = await client.pickDirectory();
    return result.path;
  }

  async function updateWorkingDirectory(dataDir: string) {
    setMessage("正在切换工作目录...");
    const state = await client.setDataDir(dataDir);
    setBootstrap(state);
    setSelectedProjectId(null);
    setDetail(null);
    setWarnings([]);
    setRepairCandidates([]);
    setSettingsOpen(false);
    await loadHome();
    setMessage("工作目录已更新");
  }

  async function updateTerminalMode(mode: TerminalMode) {
    const nextConfig = await client.updateConfig({ terminal: { mode } });
    setConfig(nextConfig);
    setMessage("窗口打开方式已更新");
  }

  async function updateAgentsCliPath(cliPath: string) {
    const nextConfig = await client.updateConfig({ agents: { cliPath } });
    setConfig(nextConfig);
    setMessage(cliPath ? "agents CLI 路径已更新" : "多 agents 同步已关闭");
  }

  async function refreshProject(projectId: string) {
    const result = await client.refreshProject(projectId);
    setMessage(`项目刷新完成：${result.indexedCount} 条，会话跳过 ${result.skippedCount} 条，警告 ${result.warningCount} 条`);
    await loadHome();
    await loadDetail(projectId, query);
  }

  async function refreshAgents(projectId: string, rootPath: string) {
    const status = await client.agentsStatus(projectId, rootPath);
    setAgentsStatusForRoot(rootPath, status);
    setLastAgentsResultForRoot(rootPath, null);
    setMessage(`agents 状态已刷新：${lastSegment(rootPath)}`);
  }

  async function initializeAgents(projectId: string, rootPath: string) {
    const result = await client.initAgents(projectId, rootPath);
    setAgentsStatusForRoot(rootPath, result.status);
    setLastAgentsResultForRoot(rootPath, result);
    setMessage(result.changed.length > 0 ? `agents 配置已初始化：${result.changed.length} 个变更项` : "agents 配置已初始化");
  }

  async function checkAgentsSync(projectId: string, rootPath: string) {
    const result = await client.syncAgents(projectId, true, rootPath);
    setAgentsStatusForRoot(rootPath, result.status);
    setLastAgentsResultForRoot(rootPath, result);
    setMessage(result.changed.length > 0 ? `agents 检查完成：${result.changed.length} 个待同步项` : "agents 检查完成：无需同步");
  }

  async function applyAgentsSync(projectId: string, rootPath: string) {
    const confirmed = window.confirm("执行 agents sync 会写入项目内工具配置，并可能按启用集成更新全局工具配置。确定继续？");
    if (!confirmed) {
      setMessage("已取消 agents 同步");
      return;
    }
    const result = await client.syncAgents(projectId, false, rootPath);
    setAgentsStatusForRoot(rootPath, result.status);
    setLastAgentsResultForRoot(rootPath, result);
    setMessage(result.changed.length > 0 ? `agents 同步完成：更新 ${result.changed.length} 个项目` : "agents 同步完成：没有变更");
  }

  async function updateAgentsIntegrations(projectId: string, rootPath: string, enabledIntegrations: AgentsIntegrationName[]) {
    const confirmed = window.confirm("保存 agents 工具选择会立即同步配置。确定继续？");
    if (!confirmed) {
      setMessage("已取消 agents 工具选择更新");
      return;
    }
    const result = await client.updateAgentsIntegrations(projectId, enabledIntegrations, rootPath);
    setAgentsStatusForRoot(rootPath, result.status);
    setLastAgentsResultForRoot(rootPath, result);
    setMessage("agents 工具选择已保存并同步");
  }

  function setAgentsStatusForRoot(rootPath: string, status: AgentsConfigSyncStatus) {
    setAgentsStatuses((current) => ({ ...current, [rootPath]: status }));
  }

  function setLastAgentsResultForRoot(rootPath: string, result: AgentsCommandResult | null) {
    setLastAgentsResults((current) => ({ ...current, [rootPath]: result }));
  }

  async function addProject(rootPath: string) {
    await client.addProject(rootPath);
    await loadHome();
    setMessage("项目已添加");
  }

  async function pickAndAddProject() {
    setMessage("正在选择项目目录...");
    const selected = await client.pickDirectory();
    if (!selected.path) {
      setMessage("已取消选择项目目录");
      return;
    }
    await addProject(selected.path);
  }

  async function removeProject(id: string) {
    await client.removeProject(id);
    await loadHome();
    setMessage("项目已从管理器移除，原始文件未删除");
  }

  async function toggleInclude(id: string, include: boolean) {
    await client.updateProject(id, include);
    await loadHome();
    await loadDetail(id, query);
  }

  async function scanRoot(root: string) {
    setScanResult(null);
    setScanStatus(`正在扫描：${root}`);
    try {
      const result = await client.startScan([root], "drive");
      await loadHome();
      if (result.candidates.length > 0) {
        setScanResult({ scanRunId: result.scanRunId, root, candidates: result.candidates, addedCandidateIds: [] });
        setMessage(`扫描完成：发现 ${result.candidates.length} 个候选`);
      } else {
        setMessage("扫描完成：未发现候选");
      }
    } finally {
      setScanStatus("");
    }
  }

  async function addScanCandidate(candidateId: string) {
    if (!scanResult) return;
    const confirmed = await client.confirmCandidates(scanResult.scanRunId, [candidateId], true);
    await loadHome();
    setScanResult((current) => {
      if (!current || current.scanRunId !== scanResult.scanRunId) return current;
      return {
        ...current,
        addedCandidateIds: current.addedCandidateIds.includes(candidateId)
          ? current.addedCandidateIds
          : [...current.addedCandidateIds, candidateId]
      };
    });
    setMessage(confirmed.length > 0 ? "项目已添加" : "候选未添加，可能已在工作区");
  }

  async function launchNew(toolId: ToolId, cwd: string, projectRootPath: string) {
    const result = await client.launchNew(toolId, cwd, projectRootPath);
    setMessage(result.launched ? `已打开终端：${result.command.command}` : result.reason ?? "启动失败");
  }

  async function resumeSession(sessionId: string) {
    const result = await client.resume(sessionId);
    setMessage(result.launched ? `已打开恢复终端：${result.command.command}` : result.reason ?? "恢复失败");
    if (result.launched && selectedProjectId) {
      await loadHome();
      await loadDetail(selectedProjectId, query);
    }
  }

  async function deleteSession(sessionId: string) {
    const confirmed = window.confirm("确定删除这个会话？这会删除原始会话记录，无法从该工具恢复。");
    if (!confirmed) {
      setMessage("已取消删除会话");
      return;
    }

    const result = await client.deleteSession(sessionId);
    setMessage(result.deletedNativeSession ? "会话已删除，原始记录已移除" : "会话索引已删除，原始记录已不存在");
    await loadHome();
    if (selectedProjectId) await loadDetail(selectedProjectId, query);
  }

  async function relocateProject(projectId: string) {
    setMessage("正在选择新项目文件夹...");
    const selected = await client.pickDirectory();
    if (!selected.path) {
      setMessage("已取消项目迁移");
      return;
    }

    setMessage("正在移动项目并刷新会话路径...");
    const result = await client.relocateProject(projectId, selected.path);
    setMessage(`项目迁移完成：移动到 ${result.newRoot}，写回 ${result.changedFileCount} 个文件，修改 ${result.changedFieldCount} 个 cwd 字段`);
    const mergedTarget = result.projectMerges.find((merge) => merge.sourceProjectId === selectedProjectId)?.targetProjectId ?? selectedProjectId;
    await loadHome();
    if (mergedTarget) {
      setSelectedProjectId(mergedTarget);
      await loadDetail(mergedTarget, query);
    }
  }

  async function repairProject(projectId: string, targetProjectId: string, targetRootPath?: string) {
    setMessage("正在修复缺失 cwd 并合并项目...");
    const result = await client.repairProject(projectId, targetProjectId, targetRootPath);
    setMessage(
      `修复完成：合并到 ${result.targetRootPath}，写回 ${result.relocation.changedFileCount} 个文件，修改 ${result.relocation.changedFieldCount} 个 cwd 字段`
    );
    await loadHome();
    setSelectedProjectId(result.targetProjectId);
    await loadDetail(result.targetProjectId, query);
  }
}

function Shell({ message }: { message: string }) {
  return (
    <main className="app">
      <section className="empty-state">{message}</section>
    </main>
  );
}

function RefreshIndexDialog({
  tools,
  busy,
  onClose,
  onRefresh
}: {
  tools: ToolStatus[];
  busy: boolean;
  onClose: () => void;
  onRefresh: (toolIds: ToolId[]) => void;
}) {
  const refreshableTools = useMemo(
    () => tools.filter((tool) => tool.visibleInProjectUi && tool.capabilities.scanHistory),
    [tools]
  );
  const [selectedToolIds, setSelectedToolIds] = useState<ToolId[]>(() => refreshableTools.map((tool) => tool.toolId));

  useEffect(() => {
    setSelectedToolIds(refreshableTools.map((tool) => tool.toolId));
  }, [refreshableTools]);

  function toggleTool(toolId: ToolId, checked: boolean) {
    setSelectedToolIds((current) => {
      if (checked) return current.includes(toolId) ? current : [...current, toolId];
      return current.filter((id) => id !== toolId);
    });
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog refresh-dialog" role="dialog" aria-modal="true" aria-labelledby="refresh-index-title">
        <header>
          <div>
            <span className="eyebrow">索引</span>
            <h2 id="refresh-index-title">刷新索引</h2>
          </div>
          <button className="secondary" type="button" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </header>
        <div className="tool-refresh-list">
          {refreshableTools.map((tool) => (
            <label className="tool-refresh-row" key={tool.toolId}>
              <input
                type="checkbox"
                checked={selectedToolIds.includes(tool.toolId)}
                onChange={(event) => toggleTool(tool.toolId, event.target.checked)}
              />
              <span>{tool.toolId}</span>
              <small>{tool.sessionSources.length} 个来源</small>
            </label>
          ))}
        </div>
        <div className="settings-actions">
          <button className="secondary" type="button" disabled={busy} onClick={() => setSelectedToolIds(refreshableTools.map((tool) => tool.toolId))}>
            全选
          </button>
          <button className="secondary" type="button" disabled={busy} onClick={() => setSelectedToolIds([])}>
            清空
          </button>
          <button
            className="primary"
            type="button"
            disabled={busy || selectedToolIds.length === 0}
            onClick={() => onRefresh(selectedToolIds)}
          >
            开始刷新
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsDialog({
  bootstrap,
  config,
  busy,
  onClose,
  onSaveDataDir,
  onSaveTerminalMode,
  onSaveAgentsCliPath,
  onPickDirectory
}: {
  bootstrap: BootstrapState;
  config: AppConfig | null;
  busy: boolean;
  onClose: () => void;
  onSaveDataDir: (dataDir: string) => void;
  onSaveTerminalMode: (mode: TerminalMode) => void;
  onSaveAgentsCliPath: (cliPath: string) => void;
  onPickDirectory: () => Promise<string | null>;
}) {
  const [terminalMode, setTerminalMode] = useState<TerminalMode>(config?.terminal.mode ?? "new-window");
  const [pickingTarget, setPickingTarget] = useState<"data-dir" | "agents" | null>(null);
  const [pickError, setPickError] = useState("");

  useEffect(() => {
    setTerminalMode(config?.terminal.mode ?? "new-window");
  }, [config?.terminal.mode]);

  async function chooseDirectory(target: "data-dir" | "agents") {
    setPickingTarget(target);
    setPickError("");
    try {
      const selected = await onPickDirectory();
      const trimmed = selected?.trim() ?? "";
      if (!trimmed) return;
      if (target === "data-dir") {
        onSaveDataDir(trimmed);
      } else {
        onSaveAgentsCliPath(trimmed);
      }
    } catch (error) {
      setPickError(error instanceof Error ? error.message : "目录选择失败");
    } finally {
      setPickingTarget(null);
    }
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header>
          <div>
            <h2 id="settings-title">应用设置</h2>
          </div>
          <button className="secondary" type="button" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </header>
        <div className="setting-section">
          <h3>工作目录</h3>
          <div className="field current-root">
            <span>当前工作目录</span>
            <code>{bootstrap.dataDir ?? "未设置"}</code>
          </div>
          <div className="settings-actions">
            <button
              className="primary"
              type="button"
              disabled={busy || pickingTarget !== null}
              onClick={() => void chooseDirectory("data-dir")}
            >
              {pickingTarget === "data-dir" ? "选择中..." : "更换工作目录"}
            </button>
          </div>
        </div>
        <div className="setting-section">
          <h3>窗口打开方式</h3>
          <div className="terminal-mode-options" role="radiogroup" aria-label="窗口打开方式">
            {terminalModes.map((mode) => (
              <label className="terminal-mode-option" key={mode}>
                <input
                  type="radio"
                  name="terminal-mode"
                  value={mode}
                  checked={terminalMode === mode}
                  disabled={busy || !config}
                  onChange={() => {
                    setTerminalMode(mode);
                    if (mode !== (config?.terminal.mode ?? "new-window")) {
                      onSaveTerminalMode(mode);
                    }
                  }}
                />
                <span>{terminalModeLabel(mode)}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="setting-section">
          <h3>多 agents 同步</h3>
          <div className="field current-root">
            <span>当前 agents CLI 目录</span>
            <code>{config?.agents.cliPath || "未启用"}</code>
          </div>
          <div className="settings-actions">
            <button
              className="primary"
              type="button"
              disabled={busy || !config || pickingTarget !== null}
              onClick={() => void chooseDirectory("agents")}
            >
              {pickingTarget === "agents" ? "选择中..." : "选择项目目录"}
            </button>
          </div>
        </div>
        {pickError ? (
          <div className="field-error" role="alert">
            {pickError}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function DirectoryChooser({
  label,
  value,
  disabled,
  onChange,
  onPickDirectory
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (path: string) => void;
  onPickDirectory: () => Promise<string | null>;
}) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");

  async function chooseDirectory() {
    setPicking(true);
    setError("");
    try {
      const selected = await onPickDirectory();
      if (selected) onChange(selected);
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : "目录选择失败");
    } finally {
      setPicking(false);
    }
  }

  return (
    <div className="directory-chooser">
      <label className="field current-root directory-value">
        <span>{label}</span>
        <input type="text" value={value} disabled={disabled || picking} onChange={(event) => onChange(event.target.value)} placeholder="输入路径或使用文件夹选择" />
        <code aria-live="polite">{value.trim() || "尚未选择"}</code>
      </label>
      <button className="secondary" type="button" disabled={disabled || picking} onClick={() => void chooseDirectory()}>
        {picking ? "选择中..." : "选择文件夹"}
      </button>
      {error ? (
        <div className="field-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function SetupScreen({
  bootstrap,
  onDone,
  busy,
  runAction,
  onPickDirectory
}: {
  bootstrap: BootstrapState;
  onDone: (state: BootstrapState) => Promise<void>;
  busy: boolean;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onPickDirectory: () => Promise<string | null>;
}) {
  const [dataDir, setDataDir] = useState(bootstrap.defaultDataDir);
  const trimmed = dataDir.trim();

  return (
    <main className="setup">
      <section className="setup-panel">
        <div className="setup-brand">
          <span className="brand-mark" aria-hidden="true">
            AI
          </span>
          <span>本地 AI 项目</span>
        </div>
        <h1>选择管理器工作目录</h1>
        <p>索引、配置和扫描结果会保存在这个目录。Codex 和 Claude 的原始会话文件不会被修改。</p>
        <DirectoryChooser
          label="工作目录"
          value={dataDir}
          disabled={busy}
          onChange={setDataDir}
          onPickDirectory={onPickDirectory}
        />
        <button
          className="primary"
          type="button"
          disabled={busy || trimmed.length === 0}
          onClick={() => void runAction(async () => onDone(await client.setDataDir(trimmed)))}
        >
          开始使用
        </button>
      </section>
    </main>
  );
}

function HomePage({
  projects,
  busy,
  scanStatus,
  scanResult,
  onOpen,
  onRemove,
  onAddScanCandidate,
  onCloseScanResults
}: {
  projects: Project[];
  busy: boolean;
  scanStatus: string;
  scanResult: ScanResultState | null;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onAddScanCandidate: (candidateId: string) => void;
  onCloseScanResults: () => void;
}) {
  return (
    <section className="content">
      {scanStatus ? (
        <div className="inline-status" role="status" aria-live="polite">
          {scanStatus}
        </div>
      ) : null}

      {scanResult ? (
        <ScanResultsDialog
          scanResult={scanResult}
          busy={busy}
          onAdd={onAddScanCandidate}
          onClose={onCloseScanResults}
        />
      ) : null}

      {projects.length === 0 ? (
        <div className="empty-state">
          <h2>还没有项目</h2>
          <p>添加已知项目目录，或扫描一个磁盘来发现已有 AI 会话。</p>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((project) => (
            <article className="project-card" key={project.id}>
              <div className="project-card-main">
                <div className="project-title-row">
                  <h2>{lastSegment(project.rootPath)}</h2>
                  <span className="metric-pill strong">{project.sessionCount} 个会话</span>
                </div>
                <p>{project.rootPath}</p>
              </div>
              <div className="project-meta">
                {project.sessionOnly ? <span className="session-only-pill">仅会话</span> : null}
                {project.childGroupCount > 0 ? <span>{project.childGroupCount} 个子目录</span> : null}
              </div>
              <div className="card-actions">
                <button className="primary" type="button" onClick={() => onOpen(project.id)}>
                  打开
                </button>
                <button type="button" className="danger" onClick={() => onRemove(project.id)}>
                  移除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ScanResultsDialog({
  scanResult,
  busy,
  onAdd,
  onClose
}: {
  scanResult: ScanResultState;
  busy: boolean;
  onAdd: (candidateId: string) => void;
  onClose: () => void;
}) {
  const addedIds = new Set(scanResult.addedCandidateIds);

  return (
    <div className="settings-backdrop scan-backdrop" role="presentation">
      <section className="scan-dialog" role="dialog" aria-modal="true" aria-labelledby="scan-results-title">
        <header>
          <div>
            <span className="eyebrow">扫描结果</span>
            <h2 id="scan-results-title">发现的项目</h2>
            <p>{scanResult.root}</p>
          </div>
          <button className="secondary" type="button" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </header>
        <div className="scan-summary" aria-label="扫描结果统计">
          <StatTile label="候选" value={scanResult.candidates.length} />
          <StatTile label="已添加" value={scanResult.addedCandidateIds.length} />
        </div>
        <div className="scan-candidate-list">
          {scanResult.candidates.map((candidate) => {
            const added = addedIds.has(candidate.id);
            const sessionCount = totalCandidateSessions(candidate);
            return (
              <article className="scan-candidate-row" key={candidate.id}>
                <div className="scan-candidate-main">
                  <h3>{lastSegment(candidate.path)}</h3>
                  <p>{candidate.path}</p>
                  <div className="project-meta">
                    <span>{candidate.detectedTools.join(" / ")}</span>
                    <span>{sessionCount} 个会话</span>
                    {candidate.childCandidates.length > 0 ? <span>{candidate.childCandidates.length} 个子候选</span> : null}
                  </div>
                </div>
                <button className="primary" type="button" disabled={busy || added} onClick={() => onAdd(candidate.id)}>
                  {added ? "已添加" : "添加"}
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProjectDetailView({
  project,
  detail,
  tools,
  query,
  warnings,
  repairCandidates,
  agentsStatuses,
  lastAgentsResults,
  busy,
  setQuery,
  onLaunch,
  onResume,
  onDeleteSession,
  onRepairProject,
  onRelocateProject,
  onRefreshAgents,
  onInitializeAgents,
  onCheckAgentsSync,
  onApplyAgentsSync,
  onUpdateAgentsIntegrations
}: {
  project: Project;
  detail: ProjectDetail | null;
  tools: ToolStatus[];
  query: string;
  warnings: ParserWarning[];
  repairCandidates: ProjectRepairCandidate[];
  agentsStatuses: Record<string, AgentsConfigSyncStatus>;
  lastAgentsResults: Record<string, AgentsCommandResult | null>;
  busy: boolean;
  setQuery: (query: string) => void;
  onLaunch: (toolId: ToolId, cwd: string) => void;
  onResume: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRepairProject: (targetProjectId: string, targetRootPath?: string) => void;
  onRelocateProject: () => void;
  onRefreshAgents: (rootPath: string) => void;
  onInitializeAgents: (rootPath: string) => void;
  onCheckAgentsSync: (rootPath: string) => void;
  onApplyAgentsSync: (rootPath: string) => void;
  onUpdateAgentsIntegrations: (rootPath: string, enabledIntegrations: AgentsIntegrationName[]) => void;
}) {
  const toolMap = useMemo(() => new Map(tools.map((tool) => [tool.toolId, tool])), [tools]);
  const projectTools = useMemo(
    () => tools.filter((tool) => tool.visibleInProjectUi && tool.supported),
    [tools]
  );
  const repairSignals = useMemo(
    () => buildRepairSignals(project, detail, warnings, repairCandidates),
    [detail, project, repairCandidates, warnings]
  );
  return (
    <section className="content">
      <div className="toolbar-panel compact">
        <div className="toolbar">
          <label className="field wide">
            筛选标题和摘要
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词" />
          </label>
        </div>
      </div>

      <div className="toolbar-panel">
        <div className="toolbar">
          <div className="field current-root">
            <span>当前项目根目录</span>
            <code>{project.rootPath}</code>
          </div>
          <button
            className="danger"
            type="button"
            disabled={busy}
            onClick={onRelocateProject}
          >
            {busy ? "迁移中..." : "选择新位置并迁移"}
          </button>
        </div>
      </div>

      {repairCandidates.length > 0 ? (
        <RepairPanel candidates={repairCandidates} busy={busy} onRepairProject={onRepairProject} />
      ) : null}

      <RepairSignalPanel signals={repairSignals} />

      {(detail?.groups ?? []).map((group) => (
        <SessionGroup
          key={group.key}
          group={group}
          tools={projectTools}
          toolMap={toolMap}
          agentsStatus={agentsStatuses[group.fullPath] ?? null}
          lastAgentsResult={lastAgentsResults[group.fullPath] ?? null}
          busy={busy}
          onLaunch={onLaunch}
          onResume={onResume}
          onDeleteSession={onDeleteSession}
          onRefreshAgents={onRefreshAgents}
          onInitializeAgents={onInitializeAgents}
          onCheckAgentsSync={onCheckAgentsSync}
          onApplyAgentsSync={onApplyAgentsSync}
          onUpdateAgentsIntegrations={onUpdateAgentsIntegrations}
        />
      ))}

      <WarningPanel warnings={warnings} />
    </section>
  );
}

function buildRepairSignals(
  project: Project,
  detail: ProjectDetail | null,
  warnings: ParserWarning[],
  repairCandidates: ProjectRepairCandidate[]
): RepairSignal[] {
  const signals: RepairSignal[] = [];

  for (const warning of warnings) {
    if (warning.errorType !== "missing-cwd") continue;
    signals.push({
      id: `warning:${warning.id}`,
      label: warning.errorType,
      toolId: warning.toolId,
      source: warning.sourceFile ?? "unknown source",
      message: warning.message
    });
  }

  for (const group of detail?.groups ?? []) {
    for (const tool of group.tools) {
      for (const session of tool.sessions) {
        if (
          session.resumeStatus !== "cwd_missing" &&
          session.resumeStatus !== "missing_cwd" &&
          session.resumeStatus !== "source_mismatch"
        ) {
          continue;
        }
        signals.push({
          id: `session:${session.id}`,
          label: resumeReason(session.resumeStatus),
          toolId: session.toolId,
          source: session.sourceFile,
          message:
            session.resumeStatus === "cwd_missing"
              ? `历史 cwd 不存在：${session.originalCwd ?? "缺失"}`
              : session.resumeStatus === "source_mismatch"
                ? "会话文件仍在旧工具项目目录；点击“修复并恢复”会先移动这条记录再打开终端"
              : "历史 cwd 缺失，无法直接恢复会话"
        });
      }
    }
  }

  if (signals.length === 0 && repairCandidates.length > 0) {
    signals.push({
      id: `project:${project.id}:repair`,
      label: "检测到可修复项目",
      toolId: null,
      source: project.rootPath,
      message: "项目可能已迁移，历史 cwd 指向旧位置；请确认候选项目路径后合并。"
    });
  }

  return signals;
}

function RepairPanel({
  candidates,
  busy,
  onRepairProject
}: {
  candidates: ProjectRepairCandidate[];
  busy: boolean;
  onRepairProject: (targetProjectId: string, targetRootPath?: string) => void;
}) {
  return (
    <section className="repair-panel" aria-label="修复缺失 cwd">
      <div className="section-title">
        <h2>修复缺失 cwd</h2>
        <span className="metric-pill">{candidates.length} 个候选</span>
      </div>
      <div className="repair-list">
        {candidates.map((candidate) => (
          <article className="repair-candidate" key={`${candidate.projectId}:${candidate.rootPath}`}>
            <div>
              <strong>{lastSegment(candidate.rootPath)}</strong>
              <p>{candidate.rootPath}</p>
              <span>{candidate.reasons.join("；")}</span>
            </div>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() =>
                candidate.targetRootPath
                  ? onRepairProject(candidate.projectId, candidate.targetRootPath)
                  : onRepairProject(candidate.projectId)
              }
            >
              合并到此项目
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function AgentsSyncPanel({
  rootLabel,
  status,
  lastResult,
  busy,
  onRefresh,
  onInitialize,
  onCheckSync,
  onApplySync,
  onUpdateIntegrations
}: {
  rootLabel: string;
  status: AgentsConfigSyncStatus | null;
  lastResult: AgentsCommandResult | null;
  busy: boolean;
  onRefresh: () => void;
  onInitialize: () => void;
  onCheckSync: () => void;
  onApplySync: () => void;
  onUpdateIntegrations: (enabledIntegrations: AgentsIntegrationName[]) => void;
}) {
  const enabled = status?.status?.enabledIntegrations ?? [];
  const [draft, setDraft] = useState<AgentsIntegrationName[]>(enabled);

  useEffect(() => {
    setDraft(enabled);
  }, [enabled.join("|")]);

  const changed = !sameStringSet(draft, enabled);
  const files = Object.entries(status?.status?.files ?? {});
  const visibleFiles = files.slice(0, 8);
  const commandOutput = lastResult ? [lastResult.stdout, lastResult.stderr].filter(Boolean).join("\n").trim() : "";

  function toggleIntegration(name: AgentsIntegrationName, checked: boolean) {
    setDraft((current) => {
      if (checked) return current.includes(name) ? current : [...current, name];
      return current.filter((item) => item !== name);
    });
  }

  return (
    <section className="agents-panel" aria-label={`多 agents 配置同步：${rootLabel}`}>
      <div className="section-title">
        <div>
          <span className="eyebrow">agents</span>
          <h2>多 agents 配置同步</h2>
          <p className="section-subtitle">{rootLabel}</p>
        </div>
        <div className="agents-actions">
          <button className="secondary" type="button" disabled={busy} onClick={onRefresh}>
            刷新状态
          </button>
          {status?.initialized ? (
            <>
              <button className="secondary" type="button" disabled={busy} onClick={onCheckSync}>
                检查同步
              </button>
              <button className="primary" type="button" disabled={busy} onClick={onApplySync}>
                执行同步
              </button>
            </>
          ) : null}
        </div>
      </div>

      {!status ? (
        <div className="muted">正在读取 agents 状态...</div>
      ) : (
        <>
          <div className="agents-summary">
            <StatTile label="启用工具" value={enabled.length} />
            <StatTile label="MCP" value={status.status?.mcp.configured ?? 0} />
            <StatTile label="本地覆盖" value={status.status?.mcp.localOverrides ?? 0} />
          </div>

          <div className="agents-meta">
            <div className="field current-root">
              <span>配置文件</span>
              <code>{status.configPath}</code>
            </div>
            <div className="field current-root">
              <span>CLI</span>
              <code>{status.command}</code>
            </div>
          </div>

          {!status.available ? (
            <div className="agents-warning" role="alert">
              {status.error ?? "未找到 agents CLI"}
            </div>
          ) : !status.initialized ? (
            <div className="agents-empty">
              <p>此项目还没有 `.agents/agents.json`。初始化后可以选择要同步的工具，并由 `agents sync` 生成各工具配置。</p>
              <button className="primary" type="button" disabled={busy} onClick={onInitialize}>
                初始化 agents 配置
              </button>
            </div>
          ) : (
            <>
              {status.error ? (
                <div className="agents-warning" role="alert">
                  {status.error}
                </div>
              ) : null}

              <div className="agents-integration-grid" aria-label="agents 集成工具">
                {agentsIntegrationNames.map((name) => (
                  <label className="agents-integration-option" key={name}>
                    <input
                      type="checkbox"
                      checked={draft.includes(name)}
                      onChange={(event) => toggleIntegration(name, event.target.checked)}
                      disabled={busy}
                    />
                    <span>{agentsIntegrationLabel(name)}</span>
                  </label>
                ))}
              </div>

              <div className="agents-actions inline">
                <button
                  className="secondary"
                  type="button"
                  disabled={busy || !changed}
                  onClick={() => setDraft(enabled)}
                >
                  还原选择
                </button>
                <button
                  className="primary"
                  type="button"
                  disabled={busy || !changed}
                  onClick={() => onUpdateIntegrations(draft)}
                >
                  保存工具选择并同步
                </button>
              </div>

              {status.status?.selectedMcpServers.length ? (
                <div className="agents-mcp-list">
                  {status.status.selectedMcpServers.map((server) => (
                    <span key={server}>{server}</span>
                  ))}
                </div>
              ) : null}

              {visibleFiles.length > 0 ? (
                <div className="agents-file-list" aria-label="agents 文件状态">
                  {visibleFiles.map(([file, exists]) => (
                    <span className={exists ? "ok" : "missing"} key={file}>
                      {exists ? "已生成" : "缺失"} {file}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          )}

          {commandOutput ? (
            <details className="agents-output">
              <summary>最近一次命令输出</summary>
              <pre>{commandOutput}</pre>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

function RepairSignalPanel({ signals }: { signals: RepairSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <section className="warnings repair-signals" aria-label="修复提示">
      <div className="section-title">
        <h2>修复提示</h2>
        <span className="metric-pill">{signals.length}</span>
      </div>
      {signals.slice(0, 20).map((signal) => (
        <article key={signal.id}>
          <strong>{signal.label}</strong>
          <span>{signal.toolId ?? "unknown"}</span>
          <span>{signal.source}</span>
          <p>{signal.message}</p>
        </article>
      ))}
    </section>
  );
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function agentsIntegrationLabel(name: AgentsIntegrationName): string {
  const labels: Record<AgentsIntegrationName, string> = {
    codex: "Codex",
    claude: "Claude Code",
    claude_desktop: "Claude Desktop",
    gemini: "Gemini CLI",
    copilot_vscode: "Copilot VS Code",
    copilot_cli: "Copilot CLI",
    cursor: "Cursor",
    antigravity: "Antigravity",
    windsurf: "Windsurf",
    opencode: "OpenCode",
    junie: "Junie"
  };
  return labels[name];
}

function SessionGroup({
  group,
  tools,
  toolMap,
  agentsStatus,
  lastAgentsResult,
  busy,
  onLaunch,
  onResume,
  onDeleteSession,
  onRefreshAgents,
  onInitializeAgents,
  onCheckAgentsSync,
  onApplyAgentsSync,
  onUpdateAgentsIntegrations
}: {
  group: ProjectDetailGroup;
  tools: ToolStatus[];
  toolMap: Map<string, ToolStatus>;
  agentsStatus: AgentsConfigSyncStatus | null;
  lastAgentsResult: AgentsCommandResult | null;
  busy: boolean;
  onLaunch: (toolId: ToolId, cwd: string) => void;
  onResume: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRefreshAgents: (rootPath: string) => void;
  onInitializeAgents: (rootPath: string) => void;
  onCheckAgentsSync: (rootPath: string) => void;
  onApplyAgentsSync: (rootPath: string) => void;
  onUpdateAgentsIntegrations: (rootPath: string, enabledIntegrations: AgentsIntegrationName[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <section className="session-group">
      <header>
        <div>
          <span className="eyebrow">目录</span>
          <h2>{group.label}</h2>
          <p className="path-line">{group.fullPath}</p>
        </div>
        <div className="group-actions">
          <span className="metric-pill strong">{group.sessionCount} 个会话</span>
          <button className="primary" type="button" onClick={() => setPickerOpen((open) => !open)}>
            新会话
          </button>
        </div>
      </header>

      {pickerOpen ? (
        <div className="tool-picker">
          {tools.map((status) => {
            const toolId = status.toolId;
            return (
              <button
                type="button"
                key={toolId}
                disabled={!status.available}
                title={status.reason ?? status.command}
                onClick={() => onLaunch(toolId, group.fullPath)}
                className="secondary"
              >
                {toolId}
              </button>
            );
          })}
        </div>
      ) : null}

      <AgentsSyncPanel
        rootLabel={group.label}
        status={agentsStatus}
        lastResult={lastAgentsResult}
        busy={busy}
        onRefresh={() => onRefreshAgents(group.fullPath)}
        onInitialize={() => onInitializeAgents(group.fullPath)}
        onCheckSync={() => onCheckAgentsSync(group.fullPath)}
        onApplySync={() => onApplyAgentsSync(group.fullPath)}
        onUpdateIntegrations={(enabledIntegrations) => onUpdateAgentsIntegrations(group.fullPath, enabledIntegrations)}
      />

      {group.tools.length === 0 ? (
        <div className="muted">这个目录还没有索引到会话。</div>
      ) : (
        group.tools.map((tool) => (
          <details className="tool-group" key={tool.toolId}>
            <summary>
              <span>{tool.toolId}</span>
              <span>{tool.sessionCount}</span>
            </summary>
            <div className="tool-session-list">
              {tool.sessions.map((session) => (
                <details className="session-card" key={session.id}>
                  <summary>
                    <span className="session-title">{session.title}</span>
                    <time>{formatTime(session.updatedAt)}</time>
                  </summary>
                  {session.summary ? <p className="summary">{session.summary}</p> : null}
                  <dl className="session-meta">
                    <dt>tool</dt>
                    <dd>{session.toolId}</dd>
                    <dt>session id</dt>
                    <dd>{session.nativeSessionId ?? "缺失"}</dd>
                    <dt>cwd</dt>
                    <dd>{session.originalCwd ?? "缺失"}</dd>
                    <dt>source file</dt>
                    <dd>{session.sourceFile}</dd>
                    <dt>resume status</dt>
                    <dd>{session.resumeStatus}</dd>
                  </dl>
                  <div className="session-actions">
                    <button
                      className="primary"
                      type="button"
                      disabled={!canResumeSession(session.resumeStatus)}
                      title={resumeReason(session.resumeStatus)}
                      onClick={() => onResume(session.id)}
                    >
                      {resumeActionLabel(session.resumeStatus)}
                    </button>
                    <button className="danger" type="button" onClick={() => onDeleteSession(session.id)}>
                      删除
                    </button>
                  </div>
                </details>
              ))}
            </div>
          </details>
        ))
      )}
    </section>
  );
}

function WarningPanel({ warnings }: { warnings: ParserWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <section className="warnings">
      <div className="section-title">
        <h2>解析警告</h2>
        <span className="metric-pill">{warnings.length}</span>
      </div>
      {warnings.slice(0, 20).map((warning) => (
        <article key={warning.id}>
          <strong>{warning.errorType}</strong>
          <span>{warning.toolId ?? "unknown"}</span>
          <span>{warning.sourceFile ?? "unknown source"}</span>
          <p>{warning.message}</p>
        </article>
      ))}
    </section>
  );
}

function lastSegment(input: string): string {
  const normalized = input.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]+/);
  return parts[parts.length - 1] || input;
}

function agentsStatusError(projectId: string, rootPath: string, error: unknown): AgentsConfigSyncStatus {
  const normalized = rootPath.replace(/[\\/]+$/, "");
  return {
    projectId,
    projectRoot: rootPath,
    available: false,
    initialized: false,
    command: "agents",
    configPath: `${normalized}\\.agents\\agents.json`,
    status: null,
    error: error instanceof Error ? error.message : "agents 状态读取失败"
  };
}

function totalCandidateSessions(candidate: ScanCandidate): number {
  return Object.values(candidate.sessionCounts).reduce((total, count) => total + (count ?? 0), 0);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function resumeReason(status: string): string {
  if (status === "ready") return "恢复会话";
  if (status === "missing_session_id") return "缺少会话 id";
  if (status === "missing_cwd") return "缺少历史 cwd";
  if (status === "cwd_missing") return "历史 cwd 不存在";
  if (status === "source_mismatch") return "会话存储目录与 cwd 不匹配";
  if (status === "tool_unavailable") return "CLI 不可用";
  return "不可恢复";
}

function canResumeSession(status: string): boolean {
  return status === "ready" || status === "source_mismatch";
}

function resumeActionLabel(status: string): string {
  return status === "source_mismatch" ? "修复并恢复" : "恢复";
}

function terminalModeLabel(mode: TerminalMode): string {
  if (mode === "per-project") return "同项目一个窗口";
  if (mode === "per-tool") return "同工具一个窗口";
  return "每次新窗口";
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<App />);
}

export { App, HomePage, ProjectDetailView, SetupScreen };
