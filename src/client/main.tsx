import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { terminalModes } from "../shared/types.js";
import type {
  AppConfig,
  BootstrapState,
  ParserWarning,
  Project,
  ProjectDetail,
  ProjectDetailGroup,
  ProjectRepairCandidate,
  ProjectSkillTargetsState,
  ProjectSkillUpdateResult,
  ProjectToolTarget,
  RefreshMode,
  RuleSyncDirection,
  RuleSyncStatus,
  ScanCandidate,
  ScanDrive,
  SkillHubList,
  SkillHubOpenTarget,
  SkillHubSourceUpdatePreview,
  SkillHubUpdateCheckResult,
  TerminalMode,
  ToolId,
  ToolStatus
} from "../shared/types.js";
import { client } from "./api.js";
import { ProjectSkillPanel, SkillHubPage } from "./skillhubViews.js";
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
  const [projectToolTargets, setProjectToolTargets] = useState<ProjectToolTarget[]>([]);
  const [drives, setDrives] = useState<ScanDrive[]>([]);
  const [scanResult, setScanResult] = useState<ScanResultState | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [scanStatus, setScanStatus] = useState("");
  const [selectedDriveRoot, setSelectedDriveRoot] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);
  const [view, setView] = useState<"home" | "skillhub">("home");
  const [skillHub, setSkillHub] = useState<SkillHubList | null>(null);
  const [skillHubQuery, setSkillHubQuery] = useState("");
  const [skillHubUpdates, setSkillHubUpdates] = useState<SkillHubUpdateCheckResult | null>(null);
  const [projectSkillPanelOpen, setProjectSkillPanelOpen] = useState(false);
  const [projectSkillState, setProjectSkillState] = useState<ProjectSkillTargetsState | null>(null);
  const [lastProjectSkillResult, setLastProjectSkillResult] = useState<ProjectSkillUpdateResult | null>(null);
  const [ruleSyncStatus, setRuleSyncStatus] = useState<RuleSyncStatus | null>(null);
  const [pendingRuleSyncDirection, setPendingRuleSyncDirection] = useState<RuleSyncDirection | null>(null);
  const selectedProjectIdRef = useRef<string | null>(null);
  const queryRef = useRef("");
  const selectedDriveRootRef = useRef("");
  const autoReloadInFlightRef = useRef(false);
  const autoReloadQueuedRef = useRef(false);
  const busy = busyAction !== null;

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    if (!bootstrap?.initialized || typeof EventSource === "undefined") return;

    let reloadTimer: number | null = null;
    const events = new EventSource(client.eventsUrl());
    const scheduleReload = () => {
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => {
        reloadTimer = null;
        void reloadFromSessionEvent();
      }, 200);
    };

    events.addEventListener("sessions:changed", scheduleReload);
    events.onerror = () => {
      // EventSource reconnects automatically; keep the UI quiet during transient local restarts.
    };

    return () => {
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      events.close();
    };
  }, [bootstrap?.initialized]);

  useEffect(() => {
    if (!selectedProjectId) return;
    setDetail(null);
    setWarnings([]);
    setRepairCandidates([]);
    setProjectToolTargets([]);
    void loadDetail(selectedProjectId, query);
  }, [selectedProjectId, query]);

  useEffect(() => {
    if (!selectedProjectId) return;
    setRuleSyncStatus(null);
    void loadRuleSyncStatus(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (selectedDriveRoot && drives.some((drive) => drive.root === selectedDriveRoot)) return;
    const next = drives[0]?.root ?? "";
    selectedDriveRootRef.current = next;
    setSelectedDriveRoot(next);
  }, [drives, selectedDriveRoot]);

  useEffect(() => {
    if (view !== "skillhub" || !bootstrap?.initialized) return;
    void loadSkillHub(skillHubQuery);
  }, [view, skillHubQuery, bootstrap?.initialized]);

  async function initialize() {
    const state = await client.bootstrap();
    setBootstrap(state);
    if (state.initialized) {
      await loadHome();
    }
  }

  async function loadHome() {
    const [projectList, toolList, driveList, appConfig] = await Promise.all([
      client.projects(),
      client.tools(),
      client.drives(),
      client.config()
    ]);
    setProjects(projectList);
    setTools(toolList);
    setDrives(driveList);
    setConfig(appConfig);
  }

  async function loadSkillHub(search = skillHubQuery) {
    setSkillHub(await client.skillhub(search));
  }

  async function loadDetail(projectId: string, search: string) {
    const [projectDetail, warningList, toolTargets] = await Promise.all([
      client.detail(projectId, search),
      client.warnings(projectId),
      client.projectToolTargets(projectId)
    ]);
    const repairList = await client.repairCandidates(projectId).catch(() => []);
    setDetail(projectDetail);
    setWarnings(warningList);
    setProjectToolTargets(toolTargets);
    setRepairCandidates(repairList);
  }

  async function loadRuleSyncStatus(projectId: string) {
    const status = await client.ruleSyncStatus(projectId).catch(() => null);
    if (selectedProjectIdRef.current === projectId) setRuleSyncStatus(status);
  }

  async function reloadFromSessionEvent() {
    if (autoReloadInFlightRef.current) {
      autoReloadQueuedRef.current = true;
      return;
    }

    autoReloadInFlightRef.current = true;
    try {
      await loadHome();
      const projectId = selectedProjectIdRef.current;
      if (projectId) {
        await loadDetail(projectId, queryRef.current);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "自动更新会话失败");
    } finally {
      autoReloadInFlightRef.current = false;
      if (autoReloadQueuedRef.current) {
        autoReloadQueuedRef.current = false;
        void reloadFromSessionEvent();
      }
    }
  }

  async function runAction(action: () => Promise<void>, actionName = "action") {
    setBusyAction(actionName);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusyAction(null);
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
    setProjectToolTargets([]);
    setProjectSkillPanelOpen(false);
    setProjectSkillState(null);
    setLastProjectSkillResult(null);
    setRuleSyncStatus(null);
    setPendingRuleSyncDirection(null);
  }

  function returnHome() {
    setView("home");
    setSelectedProjectId(null);
    setMessage("");
    clearProjectViewState();
  }

  function openProject(projectId: string) {
    setView("home");
    setMessage("");
    setQuery("");
    clearProjectViewState();
    setSelectedProjectId(projectId);
  }

  function openSkillHub() {
    setSelectedProjectId(null);
    setMessage("");
    clearProjectViewState();
    setView("skillhub");
    void loadSkillHub();
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const totalSessions = projects.reduce((sum, project) => sum + project.sessionCount, 0);
  const showingSkillHub = view === "skillhub" && !selectedProject;
  const projectActions = selectedProject ? (
    <div className="topbar-project-actions">
      <button className="secondary" type="button" disabled={busy} onClick={() => void runAction(() => openProjectSkillPanel(selectedProject.id))}>
        技能
      </button>
    </div>
  ) : showingSkillHub ? null : (
    <div className="home-actions topbar-home-actions" aria-label="项目操作">
      <button className="primary" type="button" disabled={busy} onClick={() => setNewProjectDialogOpen(true)}>
        新建项目
      </button>
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
          onChange={(event) => {
            selectedDriveRootRef.current = event.target.value;
            setSelectedDriveRoot(event.target.value);
          }}
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
          onClick={() => void runAction(() => scanRoot(selectedDriveRootRef.current || selectedDriveRoot))}
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
        <button className={`topbar-link${view === "skillhub" ? " active" : ""}`} type="button" onClick={openSkillHub}>
          SkillHub
        </button>
        {selectedProject ? (
          <div className="topbar-project-context">
            <button className="secondary" type="button" onClick={returnHome}>
              返回
            </button>
            <div className="topbar-project-title">
              <h1>{lastSegment(selectedProject.rootPath)}</h1>
              <label className="toggle project-subdirectory-toggle">
                <input
                  type="checkbox"
                  checked={selectedProject.includeSubdirectories}
                  onChange={(event) => void runAction(() => toggleInclude(selectedProject.id, event.target.checked))}
                />
                子目录
              </label>
            </div>
          </div>
        ) : showingSkillHub ? (
          <div className="topbar-project-context">
            <button className="secondary" type="button" onClick={returnHome}>
              返回
            </button>
            <div className="topbar-project-title">
              <h1>SkillHub</h1>
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
          {showingSkillHub ? (
            <button className="secondary" type="button" onClick={() => void runAction(checkSkillHubUpdates)} disabled={busy}>
              检查更新
            </button>
          ) : !selectedProject ? (
            <button className="secondary" type="button" onClick={() => setRefreshDialogOpen(true)} disabled={busy}>
              刷新索引
            </button>
          ) : null}
          {selectedProject ? (
            <button className="primary" type="button" disabled={busy} onClick={() => void runAction(() => refreshProject(selectedProject.id))}>
              刷新项目
            </button>
          ) : null}
          <button className="secondary" type="button" onClick={() => setSettingsOpen(true)} disabled={busy}>
            设置
          </button>
        </div>
      </header>

      {newProjectDialogOpen ? (
        <NewProjectDialog
          tools={tools}
          busy={busy}
          onClose={() => setNewProjectDialogOpen(false)}
          onPickDirectory={pickDirectory}
          onCreate={(projectName, parentPath, toolIds) => void runAction(() => createNewProject(projectName, parentPath, toolIds))}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsDialog
          bootstrap={bootstrap}
          config={config}
          busy={busy}
          onClose={() => setSettingsOpen(false)}
          onSaveDataDir={(dataDir) => void runAction(() => updateWorkingDirectory(dataDir))}
          onSaveTerminalMode={(mode) => void runAction(() => updateTerminalMode(mode))}
          onSaveSkillHubRoot={(rootDir) => void runAction(() => updateSkillHubRoot(rootDir))}
          onPickDirectory={pickDirectory}
        />
      ) : null}

      {refreshDialogOpen ? (
        <RefreshIndexDialog
          tools={tools}
          busy={busy}
          onClose={() => setRefreshDialogOpen(false)}
          onRefresh={(toolIds, mode) => void runAction(() => refreshSessions(toolIds, mode))}
        />
      ) : null}

      {pendingRuleSyncDirection && ruleSyncStatus ? (
        <RuleSyncConfirmDialog
          status={ruleSyncStatus}
          direction={pendingRuleSyncDirection}
          busy={busy}
          onCancel={() => setPendingRuleSyncDirection(null)}
          onCommit={() => {
            const direction = pendingRuleSyncDirection;
            void runAction(() => commitRuleSyncDirection(direction));
          }}
          onConfirm={() => {
            const direction = pendingRuleSyncDirection;
            const confirmedStatus = ruleSyncStatus;
            setPendingRuleSyncDirection(null);
            void runAction(() => applyRuleSyncDirection(direction, confirmedStatus));
          }}
        />
      ) : null}

      {projectSkillPanelOpen ? (
        <ProjectSkillPanel
          state={projectSkillState}
          busy={busy}
          lastResult={lastProjectSkillResult}
          onClose={() => setProjectSkillPanelOpen(false)}
          onUpdateSkill={(skillId, toolIds) => void runAction(() => saveProjectSkillTargets(skillId, toolIds))}
        />
      ) : null}

      {message ? (
        <div className="notice" role="status" aria-live="polite">
          {message}
        </div>
      ) : null}

      {showingSkillHub ? (
        <SkillHubPage
          skillHub={skillHub}
          query={skillHubQuery}
          updatePreviews={skillHubUpdates?.previews ?? []}
          busy={busy}
          onQueryChange={setSkillHubQuery}
          onPickLocalPath={pickDirectory}
          onImportLocal={(inputPath) => void runAction(() => importLocalSkill(inputPath))}
          onImportGitHub={(input) => void runAction(() => importGitHubSkill(input))}
          onOpenSkill={(skillId, target) => void runAction(() => openSkillHubSkill(skillId, target))}
          onDeleteSkill={(skillId) => void runAction(() => deleteSkill(skillId))}
          onApplyUpdate={(preview) => void runAction(() => applySkillHubUpdate(preview))}
        />
      ) : selectedProject ? (
        <ProjectDetailView
          project={selectedProject}
          detail={detail}
          tools={tools}
          projectToolTargets={projectToolTargets}
          query={query}
          warnings={warnings}
          repairCandidates={repairCandidates}
          ruleSyncStatus={ruleSyncStatus}
          busy={busy}
          setQuery={setQuery}
          onLaunch={(toolId, cwd) => void runAction(() => launchNew(toolId, cwd, selectedProject.rootPath))}
          onResume={(sessionId) => void runAction(() => resumeSession(sessionId))}
          onDeleteSession={(sessionId) => void runAction(() => deleteSession(sessionId))}
          onRepairProject={(targetProjectId, targetRootPath) => void runAction(() => repairProject(selectedProject.id, targetProjectId, targetRootPath))}
          onRelocateProject={() => void runAction(() => relocateProject(selectedProject.id), "relocate")}
          relocating={busyAction === "relocate"}
          onUpdateProjectTools={(toolIds) => void runAction(() => saveProjectToolTargets(toolIds))}
          onRefreshRuleSync={() => void runAction(() => refreshRuleSyncStatus())}
          onApplyRuleSync={(direction) => setPendingRuleSyncDirection(direction)}
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

  async function refreshSessions(toolIds: ToolId[], mode: RefreshMode) {
    setRefreshDialogOpen(false);
    const result = await client.refreshSessions(toolIds, mode);
    const addedText = result.addedProjectCount ? `，自动加入 ${result.addedProjectCount} 个项目` : "";
    const removedText = result.removedSessionCount ? `，移除 ${result.removedSessionCount} 条` : "";
    const modeText = mode === "full" ? "全量索引" : "增量索引";
    setMessage(`${modeText}完成：${result.indexedCount} 条，会话跳过 ${result.skippedCount} 条，警告 ${result.warningCount} 条${removedText}${addedText}`);
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

  async function updateSkillHubRoot(rootDir: string) {
    const nextConfig = await client.updateConfig({ skillhub: { rootDir } });
    setConfig(nextConfig);
    setSkillHubUpdates(null);
    if (view === "skillhub") await loadSkillHub();
    setMessage("SkillHub 目录已更新");
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

  async function createNewProject(projectName: string, parentPath: string, toolIds: ToolId[]) {
    setMessage("正在创建项目...");
    const created = await client.createDirectory(parentPath, projectName);
    if (toolIds.length > 0) {
      await client.addProject(created.path, false, toolIds);
    } else {
      await client.addProject(created.path);
    }
    await loadHome();
    setNewProjectDialogOpen(false);
    setMessage("项目已创建并添加");
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

  async function importLocalSkill(inputPath: string) {
    const result = await client.importLocalSkill(inputPath);
    if (result.requiresConfirmation) {
      const confirmed = window.confirm(`检测到 ${result.conflicts.length} 个同路径技能变更，是否覆盖 SkillHub library 中的已有内容？`);
      if (!confirmed) {
        setMessage("已取消本地技能覆盖");
        return;
      }
      await client.importLocalSkill(inputPath, true);
    }
    setSkillHubUpdates(null);
    await loadSkillHub();
    setMessage(`本地导入完成：新增 ${result.imported.length} 个，跳过 ${result.skipped.length} 个`);
  }

  async function importGitHubSkill(input: string) {
    const result = await client.importGitHubSkill(input);
    if (result.requiresConfirmation) {
      const confirmed = window.confirm(`检测到 ${result.conflicts.length} 个 GitHub 技能变更，是否覆盖同一 source namespace 下的已有内容？`);
      if (!confirmed) {
        setMessage("已取消 GitHub 技能覆盖");
        return;
      }
      await client.importGitHubSkill(input, true);
    }
    setSkillHubUpdates(null);
    await loadSkillHub();
    setMessage(`GitHub 导入完成：新增 ${result.imported.length} 个，更新 ${result.updated.length} 个`);
  }

  async function deleteSkill(skillId: string) {
    const preview = await client.previewDeleteSkillHubSkill(skillId);
    const confirmed = window.confirm(
      `确定删除 ${preview.skill.folderName}？将先移除 ${preview.affectedTargets.length} 个项目 link，再删除 SkillHub library 内容。`
    );
    if (!confirmed) {
      setMessage("已取消删除技能");
      return;
    }
    await client.deleteSkillHubSkill(skillId);
    setSkillHubUpdates(null);
    await loadSkillHub();
    if (projectSkillPanelOpen && selectedProjectId) {
      setProjectSkillState(await client.projectSkillTargets(selectedProjectId));
    }
    setMessage("SkillHub 技能已删除");
  }

  async function openSkillHubSkill(skillId: string, target: SkillHubOpenTarget) {
    await client.openSkillHubSkill(skillId, target);
    setMessage(target === "document" ? "已打开 SKILL.md" : "已打开技能文件夹");
  }

  async function checkSkillHubUpdates() {
    const result = await client.checkSkillHubUpdates();
    setSkillHubUpdates(result);
    const count = result.previews.filter((preview) => preview.hasUpdates).length;
    if (result.previews.length === 0) {
      setMessage("检查完成：没有 GitHub source 可检查");
    } else {
      setMessage(count > 0 ? `检查完成：${count} 个 GitHub source 有更新` : "检查完成：没有更新");
    }
  }

  async function applySkillHubUpdate(preview: SkillHubSourceUpdatePreview) {
    const confirmed = !preview.destructive || window.confirm("此更新会删除已分发技能的项目 link。确定继续？");
    if (!confirmed) {
      setMessage("已取消 SkillHub 更新");
      return;
    }
    await client.applySkillHubUpdate(preview.source.id, preview.destructive);
    await loadSkillHub();
    await checkSkillHubUpdates();
    setMessage("GitHub source 更新已应用");
  }

  async function openProjectSkillPanel(projectId: string) {
    setProjectSkillPanelOpen(true);
    setLastProjectSkillResult(null);
    setProjectSkillState(await client.projectSkillTargets(projectId));
  }

  async function saveProjectToolTargets(toolIds: ToolId[]) {
    if (!selectedProjectId) return;
    await client.updateProjectToolTargets(selectedProjectId, toolIds);
    setProjectToolTargets(await client.projectToolTargets(selectedProjectId));
    if (projectSkillPanelOpen) {
      setProjectSkillState(await client.projectSkillTargets(selectedProjectId));
    }
    setMessage("项目使用工具已更新");
  }

  async function saveProjectSkillTargets(skillId: string, toolIds: ToolId[]) {
    if (!selectedProjectId) return;
    let result = await client.updateProjectSkillTargets(selectedProjectId, skillId, toolIds);
    if (result.requiresConfirmation) {
      const confirmed = window.confirm("项目使用工具中已有同名技能 link，是否替换为当前 SkillHub 技能？");
      if (confirmed) {
        result = await client.updateProjectSkillTargets(selectedProjectId, skillId, toolIds, true);
      }
    }
    setLastProjectSkillResult(result);
    setProjectSkillState(await client.projectSkillTargets(selectedProjectId));
    if (result.failures.length > 0) {
      setMessage(`技能 link 更新完成，但有 ${result.failures.length} 个失败项`);
    } else if (result.requiresConfirmation) {
      setMessage("已取消替换同名技能 link");
    } else {
      setMessage("项目技能已更新");
    }
  }

  async function refreshRuleSyncStatus() {
    if (!selectedProjectId) return;
    const status = await client.ruleSyncStatus(selectedProjectId);
    setRuleSyncStatus(status);
    setMessage("规则文件状态已刷新");
  }

  async function applyRuleSyncDirection(direction: RuleSyncDirection, confirmedStatus: RuleSyncStatus | null = ruleSyncStatus) {
    if (!selectedProjectId) return;
    const options = confirmedStatus ? confirmedRuleSyncOptions(confirmedStatus) : {};
    let result = hasRuleSyncConfirmationOptions(options)
      ? await client.applyRuleSync(selectedProjectId, direction, options)
      : await client.applyRuleSync(selectedProjectId, direction);
    if (result.action === "needs-confirmation") {
      const confirmed = window.confirm(result.message);
      if (!confirmed) {
        setMessage("已取消规则同步");
        return;
      }
      result = await client.applyRuleSync(selectedProjectId, direction, {
        confirmGitInit: result.status.gitAvailable && !result.status.gitRoot,
        confirmDirectOverwrite: !result.status.gitAvailable
      });
    }
    setRuleSyncStatus(result.status);
    setMessage(result.message);
  }

  async function commitRuleSyncDirection(direction: RuleSyncDirection) {
    if (!selectedProjectId) return;
    const result = await client.commitRuleSync(selectedProjectId, direction);
    setRuleSyncStatus(result.status);
    setMessage(result.message);
  }
}

function confirmedRuleSyncOptions(status: RuleSyncStatus): { confirmDirectOverwrite?: boolean } {
  const options: { confirmDirectOverwrite?: boolean } = {};
  if (!status.gitAvailable) options.confirmDirectOverwrite = true;
  return options;
}

function hasRuleSyncConfirmationOptions(options: { confirmDirectOverwrite?: boolean }): boolean {
  return Boolean(options.confirmDirectOverwrite);
}

function Shell({ message }: { message: string }) {
  return (
    <main className="app">
      <section className="empty-state">{message}</section>
    </main>
  );
}

function NewProjectDialog({
  tools = [],
  busy,
  onClose,
  onPickDirectory,
  onCreate
}: {
  tools?: ToolStatus[];
  busy: boolean;
  onClose: () => void;
  onPickDirectory: () => Promise<string | null>;
  onCreate: (projectName: string, parentPath: string, toolIds: ToolId[]) => void;
}) {
  const [projectName, setProjectName] = useState("");
  const [parentPath, setParentPath] = useState("");
  const selectableTools = useMemo(() => tools.filter((tool) => tool.visibleInProjectUi && tool.supported), [tools]);
  const [selectedToolIds, setSelectedToolIds] = useState<ToolId[]>([]);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState("");
  const trimmedName = projectName.trim();
  const trimmedParentPath = parentPath.trim();
  const projectPathPreview = trimmedParentPath && trimmedName ? joinDisplayPath(trimmedParentPath, trimmedName) : "";

  useEffect(() => {
    setSelectedToolIds(selectableTools.map((tool) => tool.toolId));
  }, [selectableTools]);

  async function chooseProjectDirectory() {
    setPicking(true);
    setPickError("");
    try {
      const selected = await onPickDirectory();
      if (selected) setParentPath(selected);
    } catch (error) {
      setPickError(error instanceof Error ? error.message : "目录选择失败");
    } finally {
      setPicking(false);
    }
  }

  function submitProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || picking || !trimmedName || !trimmedParentPath) return;
    onCreate(trimmedName, trimmedParentPath, selectedToolIds);
  }

  function toggleTool(toolId: ToolId, checked: boolean) {
    setSelectedToolIds((current) => {
      if (checked) return current.includes(toolId) ? current : [...current, toolId];
      return current.filter((id) => id !== toolId);
    });
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog new-project-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <header>
          <h2 id="new-project-title">新建项目</h2>
        </header>
        <form className="new-project-form" onSubmit={submitProject}>
          <div className="setting-section new-project-fields">
            <label className="field wide new-project-name">
              <span>项目名称</span>
              <input
                type="text"
                value={projectName}
                disabled={busy}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="输入项目名称"
                autoFocus
              />
            </label>
            <div className="directory-chooser new-project-directory">
              <label className="field current-root directory-value">
                <span>父级目录</span>
                <code aria-live="polite">{trimmedParentPath || "尚未选择"}</code>
              </label>
              <button className="secondary" type="button" disabled={busy || picking} onClick={() => void chooseProjectDirectory()}>
                {picking ? "选择中..." : "选择目录"}
              </button>
            </div>
            <div className="field current-root new-project-preview">
              <span>创建位置</span>
              <code aria-live="polite">{projectPathPreview || "待生成"}</code>
            </div>
            <div className="tool-refresh-list compact" aria-label="新项目 agent tools">
              {selectableTools.map((tool) => (
                <label className="tool-refresh-row" key={tool.toolId}>
                  <input
                    type="checkbox"
                    checked={selectedToolIds.includes(tool.toolId)}
                    disabled={busy}
                    onChange={(event) => toggleTool(tool.toolId, event.target.checked)}
                  />
                  <span>{tool.toolId}</span>
                  <small>{tool.command}</small>
                </label>
              ))}
            </div>
          </div>
          {pickError ? (
            <div className="field-error" role="alert">
              {pickError}
            </div>
          ) : null}
          <div className="settings-actions new-project-actions">
            <button className="secondary" type="button" onClick={onClose} disabled={busy || picking}>
              取消
            </button>
            <button className="primary" type="submit" disabled={busy || picking || !trimmedName || !trimmedParentPath}>
              创建项目
            </button>
          </div>
        </form>
      </section>
    </div>
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
  onRefresh: (toolIds: ToolId[], mode: RefreshMode) => void;
}) {
  const refreshableTools = useMemo(
    () => tools.filter((tool) => tool.visibleInProjectUi && tool.capabilities.scanHistory),
    [tools]
  );
  const [selectedToolIds, setSelectedToolIds] = useState<ToolId[]>(() => refreshableTools.map((tool) => tool.toolId));
  const [refreshMode, setRefreshMode] = useState<RefreshMode>("incremental");

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
          <div className="refresh-dialog-title-row">
            <h2 id="refresh-index-title">刷新索引</h2>
            <div className="refresh-mode-options" role="radiogroup" aria-label="刷新方式">
              <label className="refresh-mode-option">
                <input
                  type="radio"
                  name="refresh-mode"
                  value="incremental"
                  checked={refreshMode === "incremental"}
                  onChange={() => setRefreshMode("incremental")}
                />
                <span>增量</span>
              </label>
              <label className="refresh-mode-option">
                <input
                  type="radio"
                  name="refresh-mode"
                  value="full"
                  checked={refreshMode === "full"}
                  onChange={() => setRefreshMode("full")}
                />
                <span>全量</span>
              </label>
            </div>
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
            onClick={() => onRefresh(selectedToolIds, refreshMode)}
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
  onSaveSkillHubRoot,
  onPickDirectory
}: {
  bootstrap: BootstrapState;
  config: AppConfig | null;
  busy: boolean;
  onClose: () => void;
  onSaveDataDir: (dataDir: string) => void;
  onSaveTerminalMode: (mode: TerminalMode) => void;
  onSaveSkillHubRoot: (rootDir: string) => void;
  onPickDirectory: () => Promise<string | null>;
}) {
  const [terminalMode, setTerminalMode] = useState<TerminalMode>(config?.terminal.mode ?? "new-window");
  const [pickingTarget, setPickingTarget] = useState<"data-dir" | "skillhub" | null>(null);
  const [pickError, setPickError] = useState("");

  useEffect(() => {
    setTerminalMode(config?.terminal.mode ?? "new-window");
  }, [config?.terminal.mode]);

  async function chooseDirectory(target: "data-dir" | "skillhub") {
    setPickingTarget(target);
    setPickError("");
    try {
      const selected = await onPickDirectory();
      const trimmed = selected?.trim() ?? "";
      if (!trimmed) return;
      if (target === "data-dir") {
        onSaveDataDir(trimmed);
      } else {
        onSaveSkillHubRoot(trimmed);
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
          <h3>SkillHub</h3>
          <div className="field current-root">
            <span>当前 SkillHub 目录</span>
            <code>{config?.skillhub?.rootDir || "未设置"}</code>
          </div>
          <div className="settings-actions">
            <button
              className="primary"
              type="button"
              disabled={busy || !config || pickingTarget !== null}
              onClick={() => void chooseDirectory("skillhub")}
            >
              {pickingTarget === "skillhub" ? "选择中..." : "选择 SkillHub 目录"}
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

function RuleSyncConfirmDialog({
  status,
  direction,
  busy,
  onCancel,
  onCommit,
  onConfirm
}: {
  status: RuleSyncStatus;
  direction: RuleSyncDirection;
  busy: boolean;
  onCancel: () => void;
  onCommit: () => void;
  onConfirm: () => void;
}) {
  const { sourceFile, targetFile } = ruleSyncFileNames(direction);
  const target = status.files[targetFile];
  const protectionNote = ruleSyncProtectionNote(status, target);
  const canCommit = canCommitRuleSyncTarget(status, target);

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog rule-sync-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="rule-sync-confirm-title">
        <header>
          <div>
            <span className="eyebrow">确认规则同步</span>
            <h2 id="rule-sync-confirm-title">同步到{targetFile}</h2>
          </div>
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            取消
          </button>
        </header>

        <div className="rule-sync-confirm-summary">
          <strong>将{sourceFile}的内容同步到{targetFile}</strong>
          <p>{protectionNote}</p>
        </div>

        <article className="rule-sync-confirm-target">
          <span className="field-label">目标文件状态</span>
          <RuleFileStatus file={target} />
        </article>

        <div className="settings-actions">
          {canCommit ? (
            <button className="secondary" type="button" onClick={onCommit} disabled={busy}>
              commit
            </button>
          ) : null}
          <button className="primary" type="button" onClick={onConfirm} disabled={busy}>
            同步
          </button>
        </div>
      </section>
    </div>
  );
}

function ProjectDetailView({
  project,
  detail,
  tools,
  projectToolTargets = [],
  query,
  warnings,
  repairCandidates,
  ruleSyncStatus,
  busy,
  relocating = false,
  setQuery,
  onLaunch,
  onResume,
  onDeleteSession,
  onRepairProject,
  onRelocateProject,
  onUpdateProjectTools = () => {},
  onRefreshRuleSync = () => {},
  onApplyRuleSync = () => {}
}: {
  project: Project;
  detail: ProjectDetail | null;
  tools: ToolStatus[];
  projectToolTargets?: ProjectToolTarget[];
  query: string;
  warnings: ParserWarning[];
  repairCandidates: ProjectRepairCandidate[];
  ruleSyncStatus?: RuleSyncStatus | null;
  busy: boolean;
  relocating?: boolean;
  setQuery: (query: string) => void;
  onLaunch: (toolId: ToolId, cwd: string) => void;
  onResume: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRepairProject: (targetProjectId: string, targetRootPath?: string) => void;
  onRelocateProject: () => void;
  onUpdateProjectTools?: (toolIds: ToolId[]) => void;
  onRefreshRuleSync?: () => void;
  onApplyRuleSync?: (direction: RuleSyncDirection) => void;
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
      <div className="toolbar-panel compact detail-controls">
        <ProjectToolTargetSelector
          targets={projectToolTargets}
          busy={busy}
          onUpdate={onUpdateProjectTools}
        />
        <ProjectRuleSyncPanel
          status={ruleSyncStatus ?? null}
          busy={busy}
          onRefresh={onRefreshRuleSync}
          onApply={onApplyRuleSync}
        />
        <div className="toolbar detail-controls-toolbar">
          <label className="field wide detail-filter">
            筛选标题和摘要
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词" />
          </label>
          <div className="detail-relocation">
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
              {relocating ? "迁移中..." : "选择新位置并迁移"}
            </button>
          </div>
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
          busy={busy}
          onLaunch={onLaunch}
          onResume={onResume}
          onDeleteSession={onDeleteSession}
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

function ProjectToolTargetSelector({
  targets,
  busy,
  onUpdate
}: {
  targets: ProjectToolTarget[];
  busy: boolean;
  onUpdate: (toolIds: ToolId[]) => void;
}) {
  const enabledToolIds = targets.filter((target) => target.enabled).map((target) => target.toolId);

  if (targets.length === 0) return null;

  function toggleTool(toolId: ToolId, enabled: boolean) {
    const next = enabled ? [...enabledToolIds, toolId] : enabledToolIds.filter((id) => id !== toolId);
    onUpdate(uniqueToolIds(next));
  }

  return (
    <section className="project-tool-targets" aria-label="项目使用工具">
      <span className="field-label">项目使用工具</span>
      <div className="tool-chip-list">
        {targets.map((target) => (
          <label className="tool-target-chip" key={target.toolId} title={target.reason ?? target.skillDirectory ?? target.toolId}>
            <input
              type="checkbox"
              checked={target.enabled}
              disabled={busy || (!target.supported && !target.enabled)}
              onChange={(event) => toggleTool(target.toolId, event.target.checked)}
            />
            <span>{target.toolId}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function ProjectRuleSyncPanel({
  status,
  busy,
  onRefresh,
  onApply
}: {
  status: RuleSyncStatus | null;
  busy: boolean;
  onRefresh: () => void;
  onApply: (direction: RuleSyncDirection) => void;
}) {
  const agentsFile = status?.files["AGENTS.md"] ?? null;
  const claudeFile = status?.files["CLAUDE.md"] ?? null;
  const agentsToClaude = status?.directions["agents-to-claude"];
  const claudeToAgents = status?.directions["claude-to-agents"];

  return (
    <section className="project-rule-sync" aria-label="规则同步">
      <div className="rule-sync-header">
        <span className="field-label">规则同步</span>
        <button className="secondary" type="button" disabled={busy} onClick={onRefresh}>
          刷新规则
        </button>
      </div>
      {status ? (
        <div className="rule-sync-file-list">
          {agentsFile ? (
            <RuleFileRow
              file={agentsFile}
              busy={busy}
              direction="claude-to-agents"
              directionStatus={claudeToAgents}
              onApply={onApply}
            />
          ) : null}
          {claudeFile ? (
            <RuleFileRow
              file={claudeFile}
              busy={busy}
              direction="agents-to-claude"
              directionStatus={agentsToClaude}
              onApply={onApply}
            />
          ) : null}
        </div>
      ) : (
        <span className="muted compact">正在读取规则文件状态...</span>
      )}
    </section>
  );
}

function RuleFileRow({
  file,
  busy,
  direction,
  directionStatus,
  onApply
}: {
  file: RuleSyncStatus["files"][keyof RuleSyncStatus["files"]];
  busy: boolean;
  direction: RuleSyncDirection;
  directionStatus: RuleSyncStatus["directions"][RuleSyncDirection] | undefined;
  onApply: (direction: RuleSyncDirection) => void;
}) {
  return (
    <article className="rule-file-row" aria-label={`${file.file} 规则文件`}>
      <RuleFileStatus file={file} />
      <div className="rule-file-row-actions">
        {file.exists && file.mtime ? <time dateTime={file.mtime}>{formatTime(file.mtime)}</time> : null}
        <button
          className="secondary"
          type="button"
          disabled={busy || !directionStatus?.enabled}
          title={directionStatus?.reason ?? undefined}
          onClick={() => onApply(direction)}
        >
          同步
        </button>
      </div>
    </article>
  );
}

function RuleFileStatus({ file }: { file: RuleSyncStatus["files"][keyof RuleSyncStatus["files"]] }) {
  return (
    <div className="rule-file-status">
      <strong>{file.file}</strong>
      <span>{file.exists ? "文件存在" : "文件缺失"}</span>
      <span>{ruleFileDirtyLabel(file)}</span>
    </div>
  );
}

function ruleFileDirtyLabel(file: RuleSyncStatus["files"][keyof RuleSyncStatus["files"]]): string {
  if (file.gitManaged !== true || file.dirty === null) return "无版本管理";
  return file.dirty ? "有未提交内容" : "无未提交内容";
}

function ruleSyncFileNames(direction: RuleSyncDirection): { sourceFile: "AGENTS.md" | "CLAUDE.md"; targetFile: "AGENTS.md" | "CLAUDE.md" } {
  return direction === "agents-to-claude"
    ? { sourceFile: "AGENTS.md", targetFile: "CLAUDE.md" }
    : { sourceFile: "CLAUDE.md", targetFile: "AGENTS.md" };
}

function ruleSyncProtectionNote(status: RuleSyncStatus, target: RuleSyncStatus["files"][keyof RuleSyncStatus["files"]]): string {
  if (!target.exists) return "目标文件当前缺失，确认后会创建目标文件。";
  if (status.gitRoot && target.gitManaged && target.dirty) return "目标文件有未提交内容；可以先 commit 备份，也可以直接同步覆盖。";
  if (status.gitRoot && target.gitManaged) return "目标文件由 Git 管理且当前无未提交内容；同步会直接覆盖目标文件。";
  if (status.gitRoot && target.gitManaged === false) return "目标文件存在但未被 Git 跟踪；可以先 commit 纳入 Git 备份，也可以直接同步覆盖。";
  if (status.gitAvailable && !status.gitRoot) return "本机有 Git，但项目还没有 Git 仓库；commit 会自动初始化 Git 并备份目标文件。";
  return "Git 不可用或状态不可检测，确认后会直接覆盖目标文件，无法自动备份。";
}

function canCommitRuleSyncTarget(status: RuleSyncStatus, target: RuleSyncStatus["files"][keyof RuleSyncStatus["files"]]): boolean {
  if (!target.exists || !status.gitAvailable) return false;
  if (!status.gitRoot) return true;
  if (target.gitManaged !== true) return true;
  return target.dirty === true;
}

function uniqueToolIds(toolIds: ToolId[]): ToolId[] {
  return Array.from(new Set(toolIds));
}

function SessionGroup({
  group,
  tools,
  toolMap,
  busy,
  onLaunch,
  onResume,
  onDeleteSession
}: {
  group: ProjectDetailGroup;
  tools: ToolStatus[];
  toolMap: Map<string, ToolStatus>;
  busy: boolean;
  onLaunch: (toolId: ToolId, cwd: string) => void;
  onResume: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
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

function joinDisplayPath(parentPath: string, childName: string): string {
  const trimmedParent = parentPath.replace(/[\\/]+$/, "");
  const separator = parentPath.includes("/") && !parentPath.includes("\\") ? "/" : "\\";
  return `${trimmedParent}${separator}${childName}`;
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
