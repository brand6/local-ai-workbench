import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  BootstrapState,
  ParserWarning,
  Project,
  ProjectDetail,
  ProjectDetailGroup,
  ProjectRepairCandidate,
  ScanCandidate,
  ScanDrive,
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [warnings, setWarnings] = useState<ParserWarning[]>([]);
  const [repairCandidates, setRepairCandidates] = useState<ProjectRepairCandidate[]>([]);
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
    const [projectList, toolList, warningList, driveList] = await Promise.all([
      client.projects(),
      client.tools(),
      client.warnings(),
      client.drives()
    ]);
    setProjects(projectList);
    setTools(toolList);
    setWarnings(warningList);
    setDrives(driveList);
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
          busy={busy}
          onClose={() => setSettingsOpen(false)}
          onSave={(dataDir) => void runAction(() => updateWorkingDirectory(dataDir))}
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
          busy={busy}
          setQuery={setQuery}
          onLaunch={(toolId, cwd) => void runAction(() => launchNew(toolId, cwd))}
          onResume={(sessionId) => void runAction(() => resumeSession(sessionId))}
          onRepairProject={(targetProjectId, targetRootPath) => void runAction(() => repairProject(selectedProject.id, targetProjectId, targetRootPath))}
          onRelocateProject={() => void runAction(() => relocateProject(selectedProject.id))}
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

  async function refreshProject(projectId: string) {
    const result = await client.refreshProject(projectId);
    setMessage(`项目刷新完成：${result.indexedCount} 条，会话跳过 ${result.skippedCount} 条，警告 ${result.warningCount} 条`);
    await loadHome();
    await loadDetail(projectId, query);
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

  async function launchNew(toolId: ToolId, cwd: string) {
    const result = await client.launchNew(toolId, cwd);
    setMessage(result.launched ? `已打开终端：${result.command.command}` : result.reason ?? "启动失败");
  }

  async function resumeSession(sessionId: string) {
    const result = await client.resume(sessionId);
    setMessage(result.launched ? `已打开恢复终端：${result.command.command}` : result.reason ?? "恢复失败");
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
  busy,
  onClose,
  onSave,
  onPickDirectory
}: {
  bootstrap: BootstrapState;
  busy: boolean;
  onClose: () => void;
  onSave: (dataDir: string) => void;
  onPickDirectory: () => Promise<string | null>;
}) {
  const [dataDir, setDataDir] = useState(bootstrap.dataDir ?? bootstrap.defaultDataDir);
  const trimmed = dataDir.trim();
  const unchanged = trimmed === (bootstrap.dataDir ?? "");

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header>
          <div>
            <span className="eyebrow">设置</span>
            <h2 id="settings-title">管理工作目录</h2>
          </div>
          <button className="secondary" type="button" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </header>
        <div className="setting-section">
          <div className="field current-root">
            <span>当前工作目录</span>
            <code>{bootstrap.dataDir ?? "未设置"}</code>
          </div>
          <DirectoryChooser
            label="新的工作目录"
            value={dataDir}
            disabled={busy}
            onChange={setDataDir}
            onPickDirectory={onPickDirectory}
          />
          <div className="settings-actions">
            <button className="secondary" type="button" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button className="primary" type="button" disabled={busy || trimmed.length === 0 || unchanged} onClick={() => onSave(trimmed)}>
              保存工作目录
            </button>
          </div>
        </div>
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
      <div className="field current-root directory-value">
        <span>{label}</span>
        <code aria-live="polite">{value.trim() || "尚未选择"}</code>
      </div>
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
  busy,
  setQuery,
  onLaunch,
  onResume,
  onRepairProject,
  onRelocateProject
}: {
  project: Project;
  detail: ProjectDetail | null;
  tools: ToolStatus[];
  query: string;
  warnings: ParserWarning[];
  repairCandidates: ProjectRepairCandidate[];
  busy: boolean;
  setQuery: (query: string) => void;
  onLaunch: (toolId: ToolId, cwd: string) => void;
  onResume: (sessionId: string) => void;
  onRepairProject: (targetProjectId: string, targetRootPath?: string) => void;
  onRelocateProject: () => void;
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
        <>
          <RepairPanel candidates={repairCandidates} busy={busy} onRepairProject={onRepairProject} />
          <RepairSignalPanel signals={repairSignals} />
        </>
      ) : null}

      {(detail?.groups ?? []).map((group) => (
        <SessionGroup key={group.key} group={group} tools={projectTools} toolMap={toolMap} onLaunch={onLaunch} onResume={onResume} />
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
        if (session.resumeStatus !== "cwd_missing" && session.resumeStatus !== "missing_cwd") continue;
        signals.push({
          id: `session:${session.id}`,
          label: resumeReason(session.resumeStatus),
          toolId: session.toolId,
          source: session.sourceFile,
          message:
            session.resumeStatus === "cwd_missing"
              ? `历史 cwd 不存在：${session.originalCwd ?? "缺失"}`
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

function SessionGroup({
  group,
  tools,
  toolMap,
  onLaunch,
  onResume
}: {
  group: ProjectDetailGroup;
  tools: ToolStatus[];
  toolMap: Map<string, ToolStatus>;
  onLaunch: (toolId: ToolId, cwd: string) => void;
  onResume: (sessionId: string) => void;
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
                  <button
                    className="primary"
                    type="button"
                    disabled={session.resumeStatus !== "ready"}
                    title={resumeReason(session.resumeStatus)}
                    onClick={() => onResume(session.id)}
                  >
                    恢复
                  </button>
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
  if (status === "tool_unavailable") return "CLI 不可用";
  return "不可恢复";
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<App />);
}

export { App, HomePage, ProjectDetailView, SetupScreen };
