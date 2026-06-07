import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { terminalModes } from "../shared/types.js";
import type {
  AgentHubApplyConflictMode,
  AgentHubDisableMode,
  AgentHubList,
  AgentHubToolId,
  AppConfig,
  BootstrapState,
  CliHubList,
  HookHubApplyMode,
  HookHubExportDocument,
  HookHubImportConflictMode,
  HookHubList,
  HookHubSuiteInput,
  HookHubSupportedToolId,
  McpHubImportResult,
  McpHubList,
  McpHubTargetToolId,
  ParserWarning,
  PluginHubCustomPluginInput,
  PluginHubList,
  Project,
  ProjectDetail,
  ProjectDetailGroup,
  ProjectAgentApplyResult,
  ProjectAgentState,
  ProjectLocalAgent,
  ProjectLocalAgentMigrationTarget,
  ProjectHookState,
  ProjectLocalMcpMigrationMode,
  ProjectLocalSkillMigrationMode,
  ProjectLocalSkillMigrationResult,
  ProjectLocalSkillMigrationTarget,
  ProjectLocalSkillsState,
  ProjectMcpApplyResult,
  ProjectMcpState,
  ProjectPluginApplyResult,
  ProjectPluginState,
  ProjectRepairCandidate,
  ProjectSkillTargetsState,
  ProjectSkillUpdateResult,
  ProjectToolTarget,
  RefreshMode,
  RuleCreatePreview,
  RuleCreateSource,
  RuleFileName,
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
import { AgentHubPage, ProjectAgentsPanel } from "./agenthubViews.js";
import { CliHubPage } from "./clihubViews.js";
import { HookHubPage, ProjectHooksPanel } from "./hookhubViews.js";
import { McpHubPage, ProjectMcpPanel } from "./mcphubViews.js";
import { PluginHubPage, ProjectPluginsPanel } from "./pluginhubViews.js";
import { ProjectSkillsPanel, SkillHubPage } from "./skillhubViews.js";
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

type AppView = "home" | "skillhub" | "mcphub" | "hookhub" | "clihub" | "pluginhub" | "agenthub";
type HubLoadKey = Exclude<AppView, "home">;

interface HubLoadOptions<T> {
  key: HubLoadKey;
  load: () => Promise<T>;
  setData: (value: T) => void;
  refresh?: (() => Promise<T>) | undefined;
  loadingStatus?: string;
  setStatus?: (value: string) => void;
  errorMessage: string;
  isCurrent?: (() => boolean) | undefined;
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
  const [view, setView] = useState<AppView>("home");
  const [skillHub, setSkillHub] = useState<SkillHubList | null>(null);
  const [skillHubQuery, setSkillHubQuery] = useState("");
  const [skillHubUpdates, setSkillHubUpdates] = useState<SkillHubUpdateCheckResult | null>(null);
  const [agentHub, setAgentHub] = useState<AgentHubList | null>(null);
  const [agentHubQuery, setAgentHubQuery] = useState("");
  const [cliHub, setCliHub] = useState<CliHubList | null>(null);
  const [cliHubStatus, setCliHubStatus] = useState("");
  const [mcpHub, setMcpHub] = useState<McpHubList | null>(null);
  const [lastMcpHubImport, setLastMcpHubImport] = useState<McpHubImportResult | null>(null);
  const [hookHub, setHookHub] = useState<HookHubList | null>(null);
  const [hookHubQuery, setHookHubQuery] = useState("");
  const [pluginHub, setPluginHub] = useState<PluginHubList | null>(null);
  const [pluginHubStatus, setPluginHubStatus] = useState("");
  const [projectSkillPanelOpen, setProjectSkillPanelOpen] = useState(false);
  const [projectSkillState, setProjectSkillState] = useState<ProjectSkillTargetsState | null>(null);
  const [projectSkillTargetRoot, setProjectSkillTargetRoot] = useState<string | null>(null);
  const [lastProjectSkillResult, setLastProjectSkillResult] = useState<ProjectSkillUpdateResult | null>(null);
  const [projectLocalSkillState, setProjectLocalSkillState] = useState<ProjectLocalSkillsState | null>(null);
  const [projectLocalSkillTargetRoot, setProjectLocalSkillTargetRoot] = useState<string | null>(null);
  const [projectMcpPanelOpen, setProjectMcpPanelOpen] = useState(false);
  const [projectMcpState, setProjectMcpState] = useState<ProjectMcpState | null>(null);
  const [projectMcpTargetRoot, setProjectMcpTargetRoot] = useState<string | null>(null);
  const [lastProjectMcpApply, setLastProjectMcpApply] = useState<ProjectMcpApplyResult | null>(null);
  const [projectHooksPanelOpen, setProjectHooksPanelOpen] = useState(false);
  const [projectHookState, setProjectHookState] = useState<ProjectHookState | null>(null);
  const [projectHookTargetRoot, setProjectHookTargetRoot] = useState<string | null>(null);
  const [projectPluginPanelOpen, setProjectPluginPanelOpen] = useState(false);
  const [projectPluginState, setProjectPluginState] = useState<ProjectPluginState | null>(null);
  const [projectPluginTargetRoot, setProjectPluginTargetRoot] = useState<string | null>(null);
  const [lastProjectPluginResult, setLastProjectPluginResult] = useState<ProjectPluginApplyResult | null>(null);
  const [projectAgentPanelOpen, setProjectAgentPanelOpen] = useState(false);
  const [projectAgentState, setProjectAgentState] = useState<ProjectAgentState | null>(null);
  const [projectAgentTargetRoot, setProjectAgentTargetRoot] = useState<string | null>(null);
  const [lastProjectAgentResult, setLastProjectAgentResult] = useState<ProjectAgentApplyResult | null>(null);
  const [ruleSyncStatus, setRuleSyncStatus] = useState<RuleSyncStatus | null>(null);
  const [pendingRuleSyncDirection, setPendingRuleSyncDirection] = useState<RuleSyncDirection | null>(null);
  const [pendingRuleCreateFile, setPendingRuleCreateFile] = useState<RuleFileName | null>(null);
  const [ruleCreateSource, setRuleCreateSource] = useState<RuleCreateSource>("template");
  const [ruleCreatePreview, setRuleCreatePreview] = useState<RuleCreatePreview | null>(null);
  const [ruleCreateContent, setRuleCreateContent] = useState("");
  const [ruleCreateLoading, setRuleCreateLoading] = useState(false);
  const selectedProjectIdRef = useRef<string | null>(null);
  const viewRef = useRef(view);
  const hubLoadSeqRef = useRef<Record<HubLoadKey, number>>({
    skillhub: 0,
    mcphub: 0,
    hookhub: 0,
    clihub: 0,
    pluginhub: 0,
    agenthub: 0
  });
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
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    if (!bootstrap?.initialized || typeof EventSource === "undefined") return;

    let reloadTimer: number | null = null;
    let cliHubReloadTimer: number | null = null;
    const events = new EventSource(client.eventsUrl());
    const scheduleReload = () => {
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => {
        reloadTimer = null;
        void reloadFromSessionEvent();
      }, 200);
    };
    const scheduleCliHubReload = () => {
      if (viewRef.current !== "clihub") return;
      if (cliHubReloadTimer !== null) window.clearTimeout(cliHubReloadTimer);
      cliHubReloadTimer = window.setTimeout(() => {
        cliHubReloadTimer = null;
        void loadCliHub(false);
      }, 200);
    };

    events.addEventListener("sessions:changed", scheduleReload);
    events.addEventListener("clihub:changed", scheduleCliHubReload);
    events.onerror = () => {
      // EventSource reconnects automatically; keep the UI quiet during transient local restarts.
    };

    return () => {
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      if (cliHubReloadTimer !== null) window.clearTimeout(cliHubReloadTimer);
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

  useEffect(() => {
    if (view !== "agenthub" || !bootstrap?.initialized) return;
    void loadAgentHub(agentHubQuery, true);
  }, [view, agentHubQuery, bootstrap?.initialized]);

  useEffect(() => {
    if (view !== "clihub" || !bootstrap?.initialized) return;
    void loadCliHub(true);
  }, [view, bootstrap?.initialized]);

  useEffect(() => {
    if (view !== "mcphub" || !bootstrap?.initialized) return;
    void loadMcpHub();
  }, [view, bootstrap?.initialized]);

  useEffect(() => {
    if (view !== "hookhub" || !bootstrap?.initialized) return;
    void loadHookHub(hookHubQuery);
  }, [view, hookHubQuery, bootstrap?.initialized]);

  useEffect(() => {
    if (view !== "pluginhub" || !bootstrap?.initialized) return;
    void loadPluginHub(true);
  }, [view, bootstrap?.initialized]);

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

  async function loadHub<T>(options: HubLoadOptions<T>) {
    const requestId = ++hubLoadSeqRef.current[options.key];
    const isLatestRequest = () => requestId === hubLoadSeqRef.current[options.key];
    const isLatest = () => isLatestRequest() && (options.isCurrent?.() ?? true);
    try {
      const cached = await options.load();
      if (!isLatest()) return;
      options.setData(cached);
      if (!options.refresh) return;

      if (options.loadingStatus) options.setStatus?.(options.loadingStatus);
      const refreshed = await options.refresh();
      if (isLatest()) options.setData(refreshed);
    } catch (error) {
      if (isLatest()) setMessage(error instanceof Error ? error.message : options.errorMessage);
    } finally {
      if (isLatestRequest() && options.refresh) options.setStatus?.("");
    }
  }

  async function loadSkillHub(search = skillHubQuery) {
    await loadHub({
      key: "skillhub",
      load: () => client.skillhub(search),
      setData: setSkillHub,
      errorMessage: "SkillHub 读取失败"
    });
  }

  async function loadAgentHub(search = agentHubQuery, refreshDiscovery = false) {
    await loadHub({
      key: "agenthub",
      load: () => client.agenthub(search),
      setData: setAgentHub,
      refresh: refreshDiscovery ? () => client.refreshAgentHubDiscovery(search) : undefined,
      loadingStatus: "AgentHub 正在刷新发现",
      errorMessage: "AgentHub 发现刷新失败",
      isCurrent: refreshDiscovery ? () => viewRef.current === "agenthub" : undefined
    });
  }

  async function loadCliHub(refreshDiscovery = false) {
    await loadHub({
      key: "clihub",
      load: () => client.clihub(),
      setData: setCliHub,
      refresh: refreshDiscovery ? () => client.refreshCliHubDiscovery(undefined, false) : undefined,
      loadingStatus: "CliHub 正在刷新发现",
      setStatus: setCliHubStatus,
      errorMessage: "CliHub 发现刷新失败",
      isCurrent: refreshDiscovery ? () => viewRef.current === "clihub" : undefined
    });
  }

  async function loadMcpHub() {
    await loadHub({
      key: "mcphub",
      load: () => client.mcphub(),
      setData: setMcpHub,
      errorMessage: "McpHub 读取失败"
    });
  }

  async function loadHookHub(search = hookHubQuery) {
    await loadHub({
      key: "hookhub",
      load: () => client.hookhub(search),
      setData: setHookHub,
      errorMessage: "HookHub 读取失败"
    });
  }

  async function loadPluginHub(refreshDiscovery = false) {
    await loadHub({
      key: "pluginhub",
      load: () => client.pluginhub(),
      setData: setPluginHub,
      refresh: refreshDiscovery ? () => client.refreshPluginHubDiscovery() : undefined,
      loadingStatus: "PluginHub 正在刷新发现",
      setStatus: setPluginHubStatus,
      errorMessage: "PluginHub 发现刷新失败",
      isCurrent: refreshDiscovery ? () => viewRef.current === "pluginhub" : undefined
    });
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
    setProjectSkillTargetRoot(null);
    setLastProjectSkillResult(null);
    setProjectLocalSkillState(null);
    setProjectLocalSkillTargetRoot(null);
    setProjectMcpPanelOpen(false);
    setProjectMcpState(null);
    setProjectMcpTargetRoot(null);
    setLastProjectMcpApply(null);
    setProjectHooksPanelOpen(false);
    setProjectHookState(null);
    setProjectHookTargetRoot(null);
    setProjectPluginPanelOpen(false);
    setProjectPluginState(null);
    setProjectPluginTargetRoot(null);
    setLastProjectPluginResult(null);
    setProjectAgentPanelOpen(false);
    setProjectAgentState(null);
    setProjectAgentTargetRoot(null);
    setLastProjectAgentResult(null);
    setRuleSyncStatus(null);
    setPendingRuleSyncDirection(null);
    resetRuleCreateDialog();
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
  }

  function openAgentHub() {
    setSelectedProjectId(null);
    setMessage("");
    clearProjectViewState();
    setView("agenthub");
  }

  function openCliHub() {
    setSelectedProjectId(null);
    setMessage("");
    clearProjectViewState();
    setView("clihub");
  }

  function openMcpHub() {
    setSelectedProjectId(null);
    setMessage("");
    clearProjectViewState();
    setView("mcphub");
  }

  function openHookHub() {
    setSelectedProjectId(null);
    setMessage("");
    clearProjectViewState();
    setView("hookhub");
  }

  function openPluginHub() {
    setSelectedProjectId(null);
    setMessage("");
    clearProjectViewState();
    setView("pluginhub");
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const totalSessions = projects.reduce((sum, project) => sum + project.sessionCount, 0);
  const showingSkillHub = view === "skillhub" && !selectedProject;
  const showingAgentHub = view === "agenthub" && !selectedProject;
  const showingCliHub = view === "clihub" && !selectedProject;
  const showingMcpHub = view === "mcphub" && !selectedProject;
  const showingHookHub = view === "hookhub" && !selectedProject;
  const showingPluginHub = view === "pluginhub" && !selectedProject;
  const showingHub = showingSkillHub || showingAgentHub || showingCliHub || showingMcpHub || showingHookHub || showingPluginHub;
  const cliHubOperationStatus = showingCliHub && cliHub?.operation ? cliHubOperationMessage(cliHub.operation) : "";
  const transientStatus = scanStatus || cliHubStatus || cliHubOperationStatus || pluginHubStatus;
  const homeCommandBar = selectedProject || showingHub ? null : (
    <section className="toolbar-panel compact home-command-panel" aria-label="项目操作">
      <div className="home-actions">
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
        <button className="secondary" type="button" onClick={() => setRefreshDialogOpen(true)} disabled={busy}>
          刷新索引
        </button>
      </div>
    </section>
  );
  return (
    <main className="app">
      <header className={`topbar${selectedProject ? " topbar-project-mode" : showingHub ? " topbar-hub-mode" : " topbar-home-mode"}`}>
        <div className="topbar-nav" aria-label="主导航">
          <button
            className="brand"
            type="button"
            onClick={returnHome}
          >
            <span className="brand-mark" aria-hidden="true">
              AI
            </span>
            <span>AI项目管理</span>
          </button>
          <button className={`topbar-link${view === "clihub" ? " active" : ""}`} type="button" onClick={openCliHub}>
            CliHub
          </button>
          <button className={`topbar-link${view === "pluginhub" ? " active" : ""}`} type="button" onClick={openPluginHub}>
            PluginHub
          </button>
          <button className={`topbar-link${view === "skillhub" ? " active" : ""}`} type="button" onClick={openSkillHub}>
            SkillHub
          </button>
          <button className={`topbar-link${view === "agenthub" ? " active" : ""}`} type="button" onClick={openAgentHub}>
            AgentHub
          </button>
          <button className={`topbar-link${view === "mcphub" ? " active" : ""}`} type="button" onClick={openMcpHub}>
            McpHub
          </button>
          <button className={`topbar-link${view === "hookhub" ? " active" : ""}`} type="button" onClick={openHookHub}>
            HookHub
          </button>
        </div>
        <div className="topbar-context">
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
          ) : showingHub ? (
            <div className="topbar-project-context">
              <button className="secondary" type="button" onClick={returnHome}>
                返回
              </button>
              <div className="topbar-project-title">
                <h1>
                  {showingSkillHub
                    ? "SkillHub"
                    : showingAgentHub
                      ? "AgentHub"
                      : showingCliHub
                        ? "CliHub"
                        : showingMcpHub
                          ? "McpHub"
                          : showingPluginHub
                            ? "PluginHub"
                            : "HookHub"}
                </h1>
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
        </div>
        <div className="topbar-actions">
          {showingSkillHub ? (
            <button className="secondary" type="button" onClick={() => void runAction(checkSkillHubUpdates)} disabled={busy}>
              检查更新
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

      {pendingRuleCreateFile && ruleSyncStatus ? (
        <RuleCreateDialog
          status={ruleSyncStatus}
          targetFile={pendingRuleCreateFile}
          source={ruleCreateSource}
          preview={ruleCreatePreview}
          content={ruleCreateContent}
          busy={busy || ruleCreateLoading}
          onCancel={resetRuleCreateDialog}
          onSourceChange={(source) => void runAction(() => loadRuleCreatePreview(pendingRuleCreateFile, source))}
          onContentChange={setRuleCreateContent}
          onConfirm={() => void runAction(createRuleFileFromDraft)}
        />
      ) : null}

      {projectSkillPanelOpen ? (
        <ProjectSkillsPanel
          skillState={projectSkillState}
          localSkillState={projectLocalSkillState}
          busy={busy}
          lastResult={lastProjectSkillResult}
          onClose={() => setProjectSkillPanelOpen(false)}
          onUpdateSkill={(skillId, toolIds) => void runAction(() => saveProjectSkillTargets(skillId, toolIds))}
          onPickDirectory={pickDirectory}
          onMigrateLocalSkills={(skills, target) => void runAction(() => migrateProjectLocalSkills(skills, target))}
        />
      ) : null}

      {projectMcpPanelOpen ? (
        <ProjectMcpPanel
          state={projectMcpState}
          busy={busy}
          lastApply={lastProjectMcpApply}
          onClose={() => setProjectMcpPanelOpen(false)}
          onUpdateServerTools={(serverId, toolIds) => void runAction(() => saveProjectMcpServerTargets(serverId, toolIds))}
          onMigrate={(serverId) => void runAction(() => migrateProjectLocalMcp(serverId))}
        />
      ) : null}

      {projectHooksPanelOpen ? (
        <ProjectHooksPanel
          state={projectHookState}
          busy={busy}
          onClose={() => setProjectHooksPanelOpen(false)}
          onWriteHooks={(toolId, hooks, input) => void runAction(() => writeProjectHooks(toolId, hooks, input))}
          onShareHooks={(toolId, input) => void runAction(() => shareProjectHooks(toolId, input))}
          onApplySuite={(toolId, suiteId, options) => void runAction(() => applyHookHubSuite(toolId, suiteId, options))}
          onSyncTool={(toolId) => void runAction(() => syncProjectHookTool(toolId))}
          onRemoveBinding={(toolId) => void runAction(() => removeProjectHookBinding(toolId))}
          onSyncAll={() => void runAction(syncProjectHooks)}
        />
      ) : null}

      {projectPluginPanelOpen ? (
        <ProjectPluginsPanel
          state={projectPluginState}
          busy={busy}
          lastResult={lastProjectPluginResult}
          onClose={() => setProjectPluginPanelOpen(false)}
          onInstall={(pluginId, toolId) => void runAction(() => installProjectPlugin(pluginId, toolId))}
          onSync={(bindingId) => void runAction(() => syncProjectPlugin(bindingId))}
          onUninstall={(bindingId) => void runAction(() => uninstallProjectPlugin(bindingId))}
        />
      ) : null}

      {projectAgentPanelOpen ? (
        <ProjectAgentsPanel
          state={projectAgentState}
          busy={busy}
          lastApply={lastProjectAgentResult}
          onClose={() => setProjectAgentPanelOpen(false)}
          onApplyAgent={(agentId, toolId, conflictMode) => void runAction(() => applyProjectAgent(agentId, toolId, conflictMode))}
          onSyncBinding={(bindingId) => void runAction(() => syncProjectAgent(bindingId))}
          onDisableBinding={(bindingId, mode) => void runAction(() => disableProjectAgent(bindingId, mode))}
          onSyncAll={() => void runAction(syncProjectAgents)}
          onMigrateLocalAgent={(localAgent, target) => void runAction(() => migrateProjectLocalAgent(localAgent, target))}
        />
      ) : null}

      <GlobalNotice message={message} busyMessage={transientStatus} />

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
      ) : showingAgentHub ? (
        <AgentHubPage
          agentHub={agentHub}
          query={agentHubQuery}
          busy={busy}
          onQueryChange={setAgentHubQuery}
          onPickLocalPath={pickDirectory}
          onImportLocal={(inputPath, truthTool) => void runAction(() => importLocalAgents(inputPath, truthTool))}
          onReimportBuiltin={() => void runAction(reimportBuiltInAgents)}
          onOpenAgent={(agentId, target) => void runAction(() => openAgentHubAgent(agentId, target))}
          onDeleteAgent={(agentId) => void runAction(() => deleteAgentHubAgent(agentId))}
          onDeleteSource={(sourceId) => void runAction(() => deleteAgentHubSource(sourceId))}
        />
      ) : showingCliHub ? (
        <CliHubPage
          clihub={cliHub}
          busy={busy}
          onRefresh={(cliId) => void runAction(() => refreshCliHubDiscovery(cliId), "clihub-refresh")}
          onCheckAll={() => void runAction(checkCliHubUpdates, "clihub-update-check")}
          onCheckOne={(cliId) => void runAction(() => checkCliHubUpdate(cliId), "clihub-update-check")}
          onInstall={(cliId, channelId) => void runAction(() => installCliHubCli(cliId, channelId), "clihub-install")}
          onUpdate={(cliId) => void runAction(() => updateCliHubCli(cliId), "clihub-update")}
          onAddLocal={(input) => void runAction(() => addCliHubLocalPath(input), "clihub-custom")}
          onAddInstallCommand={(input) => void runAction(() => addCliHubInstallCommand(input), "clihub-custom")}
          onAddChannel={(cliId, installCommand) => void runAction(() => addCliHubChannel(cliId, installCommand), "clihub-channel")}
        />
      ) : showingPluginHub ? (
        <PluginHubPage
          pluginhub={pluginHub}
          busy={busy}
          onPickLocalPath={pickDirectory}
          onImportLocal={(inputPath) => void runAction(() => importLocalPlugin(inputPath))}
          onImportGitHub={(input) => void runAction(() => importGitHubPlugin(input))}
          onCreateCustom={(input) => void runAction(() => createCustomPlugin(input))}
          onUpdateCustom={(pluginId, input) => void runAction(() => updateCustomPlugin(pluginId, input))}
          onUpdateSource={(sourceId) => void runAction(() => updatePluginHubSource(sourceId))}
          onOpenSkill={(skillId, target) => void runAction(() => openSkillHubSkill(skillId, target))}
          onOpenAgent={(agentId, target) => void runAction(() => openAgentHubAgent(agentId, target))}
          onOpenPrivateFile={(pluginId, fileId, target) => void runAction(() => openPluginHubPrivateFile(pluginId, fileId, target))}
          onDeleteSource={(sourceId) => void runAction(() => deletePluginHubSource(sourceId))}
          onDeletePlugin={(pluginId) => void runAction(() => deletePluginHubPlugin(pluginId))}
        />
      ) : showingMcpHub ? (
        <McpHubPage
          mcphub={mcpHub}
          busy={busy}
          lastImport={lastMcpHubImport}
          onImportJson={(input) => void runAction(() => importMcpHubJson(input))}
          onDeleteServer={(serverId) => void runAction(() => deleteMcpHubServer(serverId))}
        />
      ) : showingHookHub ? (
        <HookHubPage
          hookhub={hookHub}
          query={hookHubQuery}
          busy={busy}
          onQueryChange={setHookHubQuery}
          onCreateSuite={(input) => void runAction(() => createHookHubSuite(input))}
          onUpdateSuite={(suiteId, input) => void runAction(() => updateHookHubSuite(suiteId, input))}
          onDeleteSuite={(suiteId) => void runAction(() => deleteHookHubSuite(suiteId))}
          onExportSuite={(suiteId) => exportHookHubSuite(suiteId)}
          onImportSuite={(input, mode, renameName) => void runAction(() => importHookHubSuite(input, mode, renameName))}
          onImportNative={(toolId, input, suite) => void runAction(() => importNativeHooks(toolId, input, suite))}
          onSyncSuite={(suiteId) => void runAction(() => syncHookHubSuite(suiteId))}
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
          onCreateRuleFile={(file) => void runAction(() => openRuleCreateDialog(file))}
          onOpenRuleFile={(file) => void runAction(() => openRuleFile(file))}
          onOpenProjectSkills={(targetRootPath) => void runAction(() => openProjectSkillPanel(selectedProject.id, targetRootPath))}
          onOpenProjectAgents={(targetRootPath) => void runAction(() => openProjectAgentPanel(selectedProject.id, targetRootPath))}
          onOpenProjectPlugins={(targetRootPath) => void runAction(() => openProjectPluginPanel(selectedProject.id, targetRootPath))}
          onOpenProjectMcp={(targetRootPath) => void runAction(() => openProjectMcpPanel(selectedProject.id, targetRootPath))}
          onOpenProjectHooks={(targetRootPath) => void runAction(() => openProjectHooksPanel(selectedProject.id, targetRootPath))}
        />
      ) : (
        <HomePage
          projects={projects}
          busy={busy}
          scanResult={scanResult}
          onOpen={openProject}
          onRemove={(id) => void runAction(() => removeProject(id))}
          onAddScanCandidate={(candidateId) => void runAction(() => addScanCandidate(candidateId))}
          onCloseScanResults={() => setScanResult(null)}
          commandBar={homeCommandBar}
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
    if (projectAgentPanelOpen) await refreshProjectAgentPanel();
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

  async function importLocalAgents(inputPath: string, truthTool: AgentHubToolId) {
    const result = await client.importLocalAgents(inputPath, truthTool);
    if (result.requiresConfirmation) {
      const confirmed = window.confirm(`检测到 ${result.conflicts.length} 个同 slug Agent 变更，是否覆盖 AgentHub library 中的已有内容？`);
      if (!confirmed) {
        setMessage("已取消本地 Agent 覆盖");
        return;
      }
      await client.importLocalAgents(
        inputPath,
        truthTool,
        result.conflicts.map((conflict) => ({ slug: conflict.slug, action: "overwrite" }))
      );
    }
    await loadAgentHub();
    setMessage(`AgentHub 导入完成：新增 ${result.imported.length} 个，更新 ${result.updated.length} 个，跳过 ${result.skipped.length} 个`);
  }

  async function reimportBuiltInAgents() {
    const result = await client.importBuiltInAgencyAgents();
    await loadAgentHub();
    setMessage(`agency-agents 导入完成：新增 ${result.imported.length} 个，更新 ${result.updated.length} 个`);
  }

  async function openAgentHubAgent(agentId: string, target: SkillHubOpenTarget) {
    await client.openAgentHubAgent(agentId, target);
    setMessage(target === "document" ? "已打开 Agent 文件" : "已打开 Agent 目录");
  }

  async function reparseAgentHubAgent(agentId: string) {
    await client.reparseAgentHubAgent(agentId);
    await loadAgentHub();
    if (projectAgentPanelOpen && selectedProjectId) {
      setProjectAgentState(await client.projectAgents(selectedProjectId, projectAgentTargetRoot ?? undefined));
    }
    setMessage("AgentHub Agent 已重新解析");
  }

  async function deleteAgentHubAgent(agentId: string) {
    const confirmed = window.confirm("确定删除这个 AgentHub Agent？相关项目 binding 会一起移除。");
    if (!confirmed) {
      setMessage("已取消删除 AgentHub Agent");
      return;
    }
    await client.deleteAgentHubAgent(agentId);
    await loadAgentHub();
    if (projectAgentPanelOpen && selectedProjectId) {
      setProjectAgentState(await client.projectAgents(selectedProjectId, projectAgentTargetRoot ?? undefined));
    }
    setMessage("AgentHub Agent 已删除");
  }

  async function deleteAgentHubSource(sourceId: string) {
    const confirmed = window.confirm("确定删除这个 AgentHub source？相关中心 Agent 和项目 binding 会一起移除。");
    if (!confirmed) {
      setMessage("已取消删除 AgentHub source");
      return;
    }
    await client.deleteAgentHubSource(sourceId);
    await loadAgentHub();
    if (projectAgentPanelOpen && selectedProjectId) {
      setProjectAgentState(await client.projectAgents(selectedProjectId, projectAgentTargetRoot ?? undefined));
    }
    setMessage("AgentHub source 已删除");
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
    const result = await client.deleteSkillHubSkill(skillId);
    setSkillHubUpdates(null);
    await loadSkillHub();
    if (projectSkillPanelOpen && selectedProjectId) {
      setProjectSkillState(await client.projectSkillTargets(selectedProjectId, projectSkillTargetRoot ?? undefined));
    }
    setMessage(result.failures.length ? `SkillHub 技能未删除：${result.failures.length} 个项目 link 清理失败` : "SkillHub 技能已删除");
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

  async function importLocalPlugin(inputPath: string) {
    const result = await client.importLocalPlugin(inputPath);
    await loadPluginHub();
    if (view === "skillhub") await loadSkillHub();
    if (projectPluginPanelOpen) await refreshProjectPluginPanel();
    setMessage(`Plugin 导入完成：${result.plugins.length} 个 plugin，${result.importedSkills.length} 个 skills`);
  }

  async function importGitHubPlugin(input: string) {
    const result = await client.importGitHubPlugin(input);
    await loadPluginHub();
    if (view === "skillhub") await loadSkillHub();
    if (projectPluginPanelOpen) await refreshProjectPluginPanel();
    setMessage(`GitHub Plugin 导入完成：${result.plugins.length} 个 plugin，${result.importedSkills.length} 个 skills`);
  }

  async function updatePluginHubSource(sourceId: string) {
    const result = await client.updatePluginHubSource(sourceId);
    await loadPluginHub();
    if (view === "skillhub") await loadSkillHub();
    if (projectPluginPanelOpen) await refreshProjectPluginPanel();
    setMessage(`GitHub Plugin 已更新：${result.plugins.length} 个 plugin，${result.importedSkills.length} 个 skills`);
  }

  async function createCustomPlugin(input: PluginHubCustomPluginInput) {
    await client.createCustomPlugin(input);
    await loadPluginHub();
    setMessage("Custom Plugin 已创建");
  }

  async function updateCustomPlugin(pluginId: string, input: PluginHubCustomPluginInput) {
    await client.updateCustomPlugin(pluginId, input);
    await loadPluginHub();
    setMessage("Custom Plugin 已更新");
  }

  async function deletePluginHubSource(sourceId: string) {
    const preview = await client.previewDeletePluginHubSource(sourceId);
    const mode = preview.customPlugins.length
      ? window.confirm(`删除 source 会影响 ${preview.customPlugins.length} 个 custom plugin。确定同时移除这些引用？`)
        ? "remove-custom-components"
        : null
      : "remove-custom-components";
    if (!mode) {
      setMessage("已取消删除 Plugin source");
      return;
    }
    const result = await client.deletePluginHubSource(sourceId, mode);
    await loadPluginHub();
    setMessage(`Plugin source 已删除：移除 ${result.sourcePlugins.length} 个 plugin，${result.sourceComponents.length} 个组件`);
  }

  async function deletePluginHubPlugin(pluginId: string) {
    const preview = await client.previewDeletePluginHubPlugin(pluginId);
    const confirmed = window.confirm(`确定删除 Plugin「${preview.plugin.displayName}」？会卸载 ${preview.projectBindings.length} 个项目 binding。`);
    if (!confirmed) {
      setMessage("已取消删除 Plugin");
      return;
    }
    const result = await client.deletePluginHubPlugin(pluginId);
    await loadPluginHub();
    if (projectPluginPanelOpen) await refreshProjectPluginPanel();
    setMessage(`Plugin 已删除：清理 ${result.projectBindings.length} 个项目 binding`);
  }

  async function openPluginHubPrivateFile(pluginId: string, fileId: string, target: SkillHubOpenTarget) {
    await client.openPluginHubPrivateFile(pluginId, fileId, target);
    setMessage(target === "document" ? "已打开 Plugin 文件" : "已打开 Plugin 文件目录");
  }

  async function refreshCliHubDiscovery(cliId?: string) {
    const requestId = ++hubLoadSeqRef.current.clihub;
    setCliHubStatus(cliId ? "CliHub 正在刷新单个 CLI 发现" : "CliHub 正在刷新发现");
    try {
      const result = await client.refreshCliHubDiscovery(cliId);
      if (requestId === hubLoadSeqRef.current.clihub) setCliHub(result);
      setMessage("CliHub 发现已刷新");
    } finally {
      if (requestId === hubLoadSeqRef.current.clihub) setCliHubStatus("");
    }
  }

  async function checkCliHubUpdates() {
    setCliHubStatus("CliHub 正在检查全部更新");
    const result = await client.checkCliHubUpdates();
    setCliHub(result);
    setCliHubStatus("");
    const available = result.clis.filter((cli) => cli.updateStatus === "update-available").length;
    const failed = result.clis.filter((cli) => cli.updateError).length;
    if (available && failed) {
      setMessage(`CliHub 检查完成：${available} 个 CLI 可更新，${failed} 个检查失败`);
    } else if (available) {
      setMessage(`CliHub 检查完成：${available} 个 CLI 可更新`);
    } else if (failed) {
      setMessage(`CliHub 检查完成：${failed} 个 CLI 检查失败`);
    } else {
      setMessage("CliHub 检查完成：没有可更新 CLI");
    }
  }

  async function checkCliHubUpdate(cliId: string) {
    setCliHubStatus("CliHub 正在检查更新");
    const result = await client.checkCliHubUpdate(cliId);
    setCliHub(result);
    setCliHubStatus("");
    const cli = result.clis.find((item) => item.cliId === cliId);
    if (cli?.updateError) {
      setMessage(`CliHub 检查失败：${cli.displayName} ${cli.updateError}`);
    } else if (cli?.updateStatus === "update-available") {
      setMessage(`CliHub 检查完成：${cli.displayName} 可更新`);
    } else if (cli?.updateStatus === "up-to-date") {
      setMessage(`CliHub 检查完成：${cli.displayName} 已是最新`);
    } else {
      setMessage("CliHub 更新检查完成");
    }
  }

  async function installCliHubCli(cliId: string, channelId: string) {
    const requestId = ++hubLoadSeqRef.current.clihub;
    setCliHubStatus("CliHub 正在安装 CLI");
    try {
      const installed = await client.installCliHubCli(cliId, channelId);
      if (requestId === hubLoadSeqRef.current.clihub) setCliHub((current) => replaceCliHubCli(current, installed));
      const refreshed = await client.refreshCliHubDiscovery(cliId);
      if (requestId === hubLoadSeqRef.current.clihub) setCliHub(refreshed);
      setMessage("CliHub CLI 安装完成");
    } finally {
      if (requestId === hubLoadSeqRef.current.clihub) setCliHubStatus("");
    }
  }

  async function updateCliHubCli(cliId: string) {
    setCliHubStatus("CliHub 正在打开更新终端");
    try {
      const result = await client.launchCliHubUpdate(cliId);
      const commandText = [result.command.command, ...result.command.args].join(" ");
      setMessage(result.launched ? `已打开 CLI 更新终端：${commandText}` : result.reason ?? "CLI 更新终端启动失败");
    } finally {
      const latest = await client.clihub().catch(() => null);
      if (latest) setCliHub(latest);
      setCliHubStatus("");
    }
  }

  async function addCliHubLocalPath(input: { executablePath: string; displayName?: string; commandName?: string }) {
    await client.addCliHubLocalPath(input.executablePath, input.displayName, input.commandName);
    await loadCliHub();
    setMessage("自定义本地 CLI 已添加");
  }

  async function addCliHubInstallCommand(input: { installCommand: string; displayName?: string; commandName?: string }) {
    await client.addCliHubInstallCommand(input.installCommand, input.displayName, input.commandName);
    await loadCliHub();
    setMessage("自定义安装命令 CLI 已添加");
  }

  async function addCliHubChannel(cliId: string, installCommand: string) {
    await client.addCliHubChannel(cliId, installCommand);
    await loadCliHub();
    setMessage("CliHub 安装渠道已添加");
  }

  async function importMcpHubJson(input: string) {
    const result = await client.importMcpHubJson(input);
    setLastMcpHubImport(result);
    await loadMcpHub();
    setMessage(`MCP 导入完成：新增 ${result.added.length} 个，更新 ${result.updated.length} 个，Patch ${result.patched.length} 个，失败 ${result.failed.length} 个`);
  }

  async function deleteMcpHubServer(serverId: string) {
    const confirmed = window.confirm(`确定删除 MCP server「${serverId}」？McpHub 只会清理已接管的项目配置。`);
    if (!confirmed) {
      setMessage("已取消删除 MCP server");
      return;
    }
    const result = await client.deleteMcpHubServer(serverId);
    await loadMcpHub();
    if (projectMcpPanelOpen && selectedProjectId) {
      setProjectMcpState(await client.projectMcp(selectedProjectId, projectMcpTargetRoot ?? undefined));
    }
    setMessage(`${result.deleted ? "MCP server 已删除" : "MCP server 未删除"}：清理 ${result.modifiedFiles.length} 个文件，跳过 ${result.skippedMissingFiles.length} 个缺失文件，失败 ${result.failures.length} 个`);
  }

  async function createHookHubSuite(input: HookHubSuiteInput) {
    await client.createHookHubSuite(input);
    await loadHookHub();
    if (projectHooksPanelOpen) await refreshProjectHooksPanel();
    setMessage("HookHub suite 已创建");
  }

  async function updateHookHubSuite(suiteId: string, input: HookHubSuiteInput) {
    await client.updateHookHubSuite(suiteId, input);
    await loadHookHub();
    if (projectHooksPanelOpen) await refreshProjectHooksPanel();
    setMessage("HookHub suite 已更新");
  }

  async function deleteHookHubSuite(suiteId: string) {
    const confirmed = window.confirm("确定删除这个 HookHub suite？项目文件不会被删除，但相关 binding 会移除。");
    if (!confirmed) {
      setMessage("已取消删除 HookHub suite");
      return;
    }
    const result = await client.deleteHookHubSuite(suiteId);
    await loadHookHub();
    if (projectHooksPanelOpen) await refreshProjectHooksPanel();
    setMessage(result.deleted ? "HookHub suite 已删除" : "HookHub suite 不存在");
  }

  async function exportHookHubSuite(suiteId: string): Promise<HookHubExportDocument> {
    const document = await client.exportHookHubSuite(suiteId);
    setMessage("HookHub suite 已导出");
    return document;
  }

  async function importHookHubSuite(input: string, mode?: HookHubImportConflictMode | null, renameName?: string | null) {
    let result = await client.importHookHubSuite(input, mode, renameName);
    if (result.action === "needs-confirmation" && result.conflict) {
      const choice = window.prompt(`HookHub 已有同名 suite「${result.conflict.name}」：输入 1 覆盖，2 重命名导入，3 取消`, "3");
      if (choice === "1") {
        result = await client.importHookHubSuite(input, "overwrite");
      } else if (choice === "2") {
        const nextName = window.prompt("重命名后的 suite name", `${result.conflict.name} copy`);
        if (!nextName) {
          setMessage("已取消导入 HookHub suite");
          return;
        }
        result = await client.importHookHubSuite(input, "rename", nextName);
      } else {
        setMessage("已取消导入 HookHub suite");
        return;
      }
    }
    await loadHookHub();
    setMessage(`HookHub suite 导入完成：${result.action}`);
  }

  async function importNativeHooks(toolId: HookHubSupportedToolId, input: string, suite: HookHubSuiteInput) {
    await client.importNativeHooks(toolId, input, suite);
    await loadHookHub();
    setMessage("原生 hooks 已导入为 HookHub suite");
  }

  async function syncHookHubSuite(suiteId: string) {
    const result = await client.syncHookHubSuite(suiteId);
    await loadHookHub();
    if (projectHooksPanelOpen) await refreshProjectHooksPanel();
    setMessage(`HookHub 同步完成：更新 ${result.updated.length} 个，跳过 ${result.skipped.length} 个`);
  }

  async function openProjectSkillPanel(projectId: string, targetRootPath: string) {
    setProjectSkillPanelOpen(true);
    setProjectSkillTargetRoot(targetRootPath);
    setProjectLocalSkillTargetRoot(targetRootPath);
    setLastProjectSkillResult(null);
    setProjectSkillState(null);
    setProjectLocalSkillState(null);
    const [skillTargets, localSkills] = await Promise.all([
      client.projectSkillTargets(projectId, targetRootPath),
      client.projectLocalSkills(projectId, targetRootPath)
    ]);
    setProjectSkillState(skillTargets);
    setProjectLocalSkillState(localSkills);
  }

  async function openProjectAgentPanel(projectId: string, targetRootPath: string) {
    setProjectAgentPanelOpen(true);
    setProjectAgentTargetRoot(targetRootPath);
    setLastProjectAgentResult(null);
    setProjectAgentState(null);
    setProjectAgentState(await client.projectAgents(projectId, targetRootPath));
  }

  async function refreshProjectAgentPanel() {
    if (!selectedProjectId) return;
    setProjectAgentState(await client.projectAgents(selectedProjectId, projectAgentTargetRoot ?? undefined));
  }

  async function openProjectMcpPanel(projectId: string, targetRootPath: string) {
    setProjectMcpPanelOpen(true);
    setProjectMcpTargetRoot(targetRootPath);
    setLastProjectMcpApply(null);
    setProjectMcpState(await client.projectMcp(projectId, targetRootPath));
  }

  async function openProjectHooksPanel(projectId: string, targetRootPath: string) {
    setProjectHooksPanelOpen(true);
    setProjectHookTargetRoot(targetRootPath);
    setProjectHookState(await client.projectHooks(projectId, targetRootPath));
  }

  async function refreshProjectHooksPanel() {
    if (!selectedProjectId) return;
    setProjectHookState(await client.projectHooks(selectedProjectId, projectHookTargetRoot ?? undefined));
  }

  async function writeProjectHooks(toolId: HookHubSupportedToolId, hooks: unknown, input: Partial<HookHubSuiteInput> = {}) {
    if (!selectedProjectId) return;
    const targetRootPath = projectHookTargetRoot ?? undefined;
    await client.writeProjectHooks(selectedProjectId, toolId, hooks, input, targetRootPath);
    await Promise.all([refreshProjectHooksPanel(), loadHookHub()]);
    setMessage(input.name ? "项目 hooks 已创建 suite 并应用" : "项目 hooks 已保存");
  }

  async function shareProjectHooks(toolId: HookHubSupportedToolId, input: HookHubSuiteInput) {
    if (!selectedProjectId) return;
    const targetRootPath = projectHookTargetRoot ?? undefined;
    await client.shareProjectHooks(selectedProjectId, toolId, input, targetRootPath);
    await Promise.all([refreshProjectHooksPanel(), loadHookHub()]);
    setMessage("项目 hooks 已上传到 HookHub");
  }

  async function applyHookHubSuite(
    toolId: HookHubSupportedToolId,
    suiteId: string,
    options: { mode?: HookHubApplyMode | null; preserveName?: string | null } = {}
  ) {
    if (!selectedProjectId) return;
    const targetRootPath = projectHookTargetRoot ?? undefined;
    const result = await client.applyHookHubSuite(selectedProjectId, toolId, suiteId, targetRootPath, options);
    await refreshProjectHooksPanel();
    await loadHookHub();
    setMessage(result.warnings.length ? `HookHub suite 已应用：${result.warnings.join("；")}` : "HookHub suite 已应用");
  }

  async function syncProjectHookTool(toolId: HookHubSupportedToolId) {
    if (!selectedProjectId) return;
    await client.syncProjectHookTool(selectedProjectId, toolId, projectHookTargetRoot ?? undefined);
    await refreshProjectHooksPanel();
    setMessage("项目 hooks 已从 HookHub 同步");
  }

  async function removeProjectHookBinding(toolId: HookHubSupportedToolId) {
    if (!selectedProjectId) return;
    await client.removeProjectHookBinding(selectedProjectId, toolId, projectHookTargetRoot ?? undefined);
    await refreshProjectHooksPanel();
    setMessage("HookHub binding 已移除");
  }

  async function syncProjectHooks() {
    if (!selectedProjectId) return;
    const result = await client.syncProjectHooks(selectedProjectId, projectHookTargetRoot ?? undefined);
    await refreshProjectHooksPanel();
    setMessage(`项目 hooks 同步完成：更新 ${result.updated.length} 个，跳过 ${result.skipped.length} 个`);
  }

  async function openProjectPluginPanel(projectId: string, targetRootPath: string) {
    setProjectPluginPanelOpen(true);
    setProjectPluginTargetRoot(targetRootPath);
    setLastProjectPluginResult(null);
    setProjectPluginState(await client.projectPlugins(projectId, targetRootPath));
  }

  async function refreshProjectPluginPanel() {
    if (!selectedProjectId) return;
    setProjectPluginState(await client.projectPlugins(selectedProjectId, projectPluginTargetRoot ?? undefined));
  }

  async function installProjectPlugin(pluginId: string, toolId: ToolId) {
    if (!selectedProjectId) return;
    const targetRootPath = projectPluginTargetRoot ?? undefined;
    let result = await client.installProjectPlugin(selectedProjectId, pluginId, toolId, targetRootPath, null);
    if (result.requiresConfirmation) {
      const overwrite = window.confirm(`Plugin 安装需要覆盖 ${result.preflight.length} 个目标。确定覆盖？取消则跳过可选组件。`);
      result = await client.installProjectPlugin(selectedProjectId, pluginId, toolId, targetRootPath, overwrite ? "overwrite" : "skip");
    }
    setLastProjectPluginResult(result);
    await refreshProjectPluginPanel();
    if (projectSkillPanelOpen) {
      setProjectSkillState(await client.projectSkillTargets(selectedProjectId, projectSkillTargetRoot ?? undefined));
      setProjectLocalSkillState(await client.projectLocalSkills(selectedProjectId, projectLocalSkillTargetRoot ?? undefined));
    }
    setMessage(result.blocked ? result.message : result.binding ? "项目 Plugin 已安装" : result.message);
  }

  async function syncProjectPlugin(bindingId: string) {
    if (!selectedProjectId) return;
    const targetRootPath = projectPluginTargetRoot ?? undefined;
    let result = await client.syncProjectPlugin(selectedProjectId, bindingId, targetRootPath, null);
    if (result.requiresConfirmation) {
      const overwrite = window.confirm(`Plugin 同步需要覆盖 ${result.preflight.length} 个目标。确定覆盖？取消则跳过可选组件。`);
      result = await client.syncProjectPlugin(selectedProjectId, bindingId, targetRootPath, overwrite ? "overwrite" : "skip");
    }
    setLastProjectPluginResult(result);
    await refreshProjectPluginPanel();
    if (projectSkillPanelOpen) {
      setProjectSkillState(await client.projectSkillTargets(selectedProjectId, projectSkillTargetRoot ?? undefined));
      setProjectLocalSkillState(await client.projectLocalSkills(selectedProjectId, projectLocalSkillTargetRoot ?? undefined));
    }
    setMessage(result.blocked ? result.message : "项目 Plugin 已同步");
  }

  async function uninstallProjectPlugin(bindingId: string) {
    if (!selectedProjectId) return;
    const confirmed = window.confirm("确定卸载这个项目 Plugin？不会恢复被覆盖的旧文件。");
    if (!confirmed) {
      setMessage("已取消卸载项目 Plugin");
      return;
    }
    const result = await client.uninstallProjectPlugin(selectedProjectId, bindingId, projectPluginTargetRoot ?? undefined);
    setLastProjectPluginResult(result);
    await refreshProjectPluginPanel();
    if (projectSkillPanelOpen) {
      setProjectSkillState(await client.projectSkillTargets(selectedProjectId, projectSkillTargetRoot ?? undefined));
      setProjectLocalSkillState(await client.projectLocalSkills(selectedProjectId, projectLocalSkillTargetRoot ?? undefined));
    }
    setMessage("项目 Plugin 已卸载");
  }

  async function saveProjectMcpServerTargets(serverId: string, toolIds: McpHubTargetToolId[]) {
    if (!selectedProjectId) return;
    const targetRootPath = projectMcpTargetRoot ?? undefined;
    const supportedToolIds = new Set((projectMcpState?.targets ?? []).filter((target) => target.enabled && target.supported).map((target) => target.toolId));
    const requestedToolIds = uniqueMcpTargetToolIds(toolIds.filter((toolId) => supportedToolIds.has(toolId)));
    const currentToolIds = uniqueMcpTargetToolIds(
      (projectMcpState?.bindings ?? []).filter((binding) => binding.serverId === serverId).map((binding) => binding.toolId)
    );
    const requested = new Set(requestedToolIds);
    const current = new Set(currentToolIds);
    const applyToolIds = requestedToolIds.filter((toolId) => !current.has(toolId));
    const disableToolIds = currentToolIds.filter((toolId) => !requested.has(toolId));
    let lastApplyResult: ProjectMcpApplyResult | null = null;
    let warningCount = 0;

    for (const toolId of applyToolIds) {
      const result = await client.applyProjectMcp(selectedProjectId, serverId, toolId, targetRootPath);
      lastApplyResult = result;
      warningCount += result.warnings.length;
    }

    for (const toolId of disableToolIds) {
      await client.disableProjectMcp(selectedProjectId, serverId, toolId, targetRootPath);
    }

    setLastProjectMcpApply(lastApplyResult);
    setProjectMcpState(await client.projectMcp(selectedProjectId, targetRootPath));

    if (applyToolIds.length && disableToolIds.length) {
      setMessage(`MCP 工具选择已更新：添加 ${applyToolIds.length} 个，移除 ${disableToolIds.length} 个`);
    } else if (applyToolIds.length) {
      if (warningCount) {
        setMessage(applyToolIds.length === 1 ? `MCP 已应用，但有 ${warningCount} 个环境变量警告` : `MCP 已应用到 ${applyToolIds.length} 个工具，但有 ${warningCount} 个环境变量警告`);
      } else {
        setMessage(applyToolIds.length === 1 ? "MCP 已应用到项目" : `MCP 已应用到 ${applyToolIds.length} 个工具`);
      }
    } else if (disableToolIds.length) {
      setMessage(disableToolIds.length === 1 ? "MCP 已从项目配置移除" : `MCP 已从 ${disableToolIds.length} 个工具配置移除`);
    } else {
      setMessage("MCP 工具选择未变化");
    }
  }

  async function migrateProjectLocalMcp(serverId: string) {
    if (!selectedProjectId) return;
    const targetRootPath = projectMcpTargetRoot ?? undefined;
    let result = await client.migrateProjectLocalMcp(selectedProjectId, serverId, null, targetRootPath);
    if (result.requiresConfirmation) {
      const mode = chooseLocalMcpMigrationMode(serverId);
      if (!mode) {
        setMessage("已取消本地 MCP 迁移");
        return;
      }
      result = await client.migrateProjectLocalMcp(selectedProjectId, serverId, mode, targetRootPath);
    }
    await loadMcpHub();
    setProjectMcpState(await client.projectMcp(selectedProjectId, targetRootPath));
    if (result.message) {
      setMessage(result.message);
    } else if (result.action === "linked-existing") {
      setMessage("本地 MCP 已关联到 McpHub");
    } else if (result.action === "overwrote-mcphub") {
      setMessage("本地 MCP 已覆盖 McpHub 定义并接管");
    } else {
      setMessage("本地 MCP 已迁移到 McpHub");
    }
  }

  async function migrateProjectLocalSkill(toolId: ToolId, folderName: string, target: ProjectLocalSkillMigrationTarget) {
    if (!selectedProjectId) return;
    const targetRootPath = projectLocalSkillTargetRoot ?? undefined;
    const result = await runProjectLocalSkillMigration(selectedProjectId, targetRootPath, toolId, folderName, target);
    if (!result) {
      setMessage("已取消本地技能迁移");
      return;
    }

    await refreshProjectSkillPanelsAfterMigration(targetRootPath);
    setMessage(projectLocalSkillMigrationMessage(result));
  }

  async function migrateProjectLocalSkills(
    skills: Array<{ toolId: ToolId; folderName: string }>,
    target: ProjectLocalSkillMigrationTarget
  ) {
    if (!selectedProjectId || skills.length === 0) return;
    const projectId = selectedProjectId;
    const targetRootPath = projectLocalSkillTargetRoot ?? undefined;
    const results: ProjectLocalSkillMigrationResult[] = [];

    for (const skill of skills) {
      const result = await runProjectLocalSkillMigration(projectId, targetRootPath, skill.toolId, skill.folderName, target);
      if (!result) break;
      results.push(result);
    }

    await refreshProjectSkillPanelsAfterMigration(targetRootPath);
    if (results.length === 0) {
      setMessage("已取消本地技能迁移");
    } else if (skills.length === 1) {
      setMessage(projectLocalSkillMigrationMessage(results[0]!));
    } else {
      setMessage(`本地技能迁移完成：${results.length}/${skills.length} 个`);
    }
  }

  async function runProjectLocalSkillMigration(
    projectId: string,
    targetRootPath: string | undefined,
    toolId: ToolId,
    folderName: string,
    target: ProjectLocalSkillMigrationTarget
  ): Promise<ProjectLocalSkillMigrationResult | null> {
    let result = await client.migrateProjectLocalSkill(projectId, toolId, folderName, null, targetRootPath, target);
    if (result.requiresConfirmation) {
      const mode = chooseLocalSkillMigrationMode(folderName, result.conflictSkills[0]?.libraryRelativePath ?? result.conflictSkills[0]?.folderName ?? "同名技能");
      if (!mode) {
        return null;
      }
      result = await client.migrateProjectLocalSkill(projectId, toolId, folderName, mode, targetRootPath, target);
    }

    return result;
  }

  async function refreshProjectSkillPanelsAfterMigration(targetRootPath: string | undefined) {
    if (!selectedProjectId) return;
    setSkillHubUpdates(null);
    setProjectLocalSkillState(await client.projectLocalSkills(selectedProjectId, targetRootPath));
    if (projectSkillPanelOpen) {
      setProjectSkillState(await client.projectSkillTargets(selectedProjectId, projectSkillTargetRoot ?? undefined));
    }
    if (view === "skillhub") await loadSkillHub();
  }

  function projectLocalSkillMigrationMessage(result: ProjectLocalSkillMigrationResult) {
    if (result.action === "linked-existing") {
      return "本地技能已换成 SkillHub link";
    }
    if (result.action === "overwrote-skillhub") return "SkillHub 技能已覆盖，本地已转为 link";
    return "本地技能已迁移到 SkillHub";
  }

  async function applyProjectAgent(agentId: string, toolId: AgentHubToolId, conflictMode: AgentHubApplyConflictMode | null = null) {
    if (!selectedProjectId) return;
    const targetRootPath = projectAgentTargetRoot ?? undefined;
    let result = await client.applyProjectAgent(selectedProjectId, agentId, toolId, targetRootPath, conflictMode);
    if (result.requiresConfirmation) {
      let nextMode: AgentHubApplyConflictMode | null = null;
      if (result.conflicts.length) {
        const migrate = window.confirm("目标路径已有 unmanaged Agent。确定先迁移当前文件再覆盖？取消则仅覆盖前备份。");
        nextMode = migrate ? "migrate-then-overwrite" : "overwrite";
      } else if (result.replacedBindings.length) {
        const confirmed = window.confirm("目标路径已由另一个 AgentHub agent 管理，是否替换 binding？");
        nextMode = confirmed ? "replace-managed" : null;
      } else {
        const confirmed = window.confirm("目标文件已 drifted，是否备份后覆盖？");
        nextMode = confirmed ? "overwrite" : null;
      }
      if (!nextMode) {
        setLastProjectAgentResult(result);
        setMessage("已取消 AgentHub 写入");
        return;
      }
      result = await client.applyProjectAgent(selectedProjectId, agentId, toolId, targetRootPath, nextMode);
    }
    setLastProjectAgentResult(result);
    await Promise.all([refreshProjectAgentPanel(), loadAgentHub()]);
    setMessage(result.backups.length ? "项目 Agent 已写入，原文件已备份" : "项目 Agent 已写入");
  }

  async function syncProjectAgent(bindingId: string) {
    if (!selectedProjectId) return;
    const result = await client.syncProjectAgent(selectedProjectId, bindingId, projectAgentTargetRoot ?? undefined);
    setLastProjectAgentResult(result);
    await refreshProjectAgentPanel();
    setMessage("AgentHub target 已同步");
  }

  async function syncProjectAgents() {
    if (!selectedProjectId) return;
    const result = await client.syncProjectAgents(selectedProjectId, projectAgentTargetRoot ?? undefined);
    await refreshProjectAgentPanel();
    setMessage(`AgentHub 同步完成：更新 ${result.updated.length} 个，跳过 ${result.skipped.length} 个`);
  }

  async function disableProjectAgent(bindingId: string, mode: AgentHubDisableMode | null = null) {
    if (!selectedProjectId) return;
    let result = await client.disableProjectAgent(selectedProjectId, bindingId, projectAgentTargetRoot ?? undefined, mode);
    if (result.requiresConfirmation) {
      const keep = window.confirm("项目 Agent 已 drifted。确定保留文件并仅移除 binding？取消则备份后删除文件。");
      result = await client.disableProjectAgent(selectedProjectId, bindingId, projectAgentTargetRoot ?? undefined, keep ? "keep-file" : "delete-with-backup");
    }
    await refreshProjectAgentPanel();
    setMessage(result.deletedFile ? "AgentHub target 已禁用并删除项目文件" : "AgentHub binding 已移除，项目文件保留");
  }

  async function migrateProjectLocalAgent(localAgent: ProjectLocalAgent, target: ProjectLocalAgentMigrationTarget) {
    if (!selectedProjectId) return;
    let result = await client.migrateProjectLocalAgent(selectedProjectId, localAgent.toolId, localAgent.outputPath, target, projectAgentTargetRoot ?? undefined);
    if (result.requiresConfirmation) {
      const confirmed = window.confirm("AgentHub source 中已有同 slug Agent，是否覆盖中心真源？");
      if (!confirmed || !result.conflicts[0]) {
        setMessage("已取消本地 Agent 迁移");
        return;
      }
      result = await client.migrateProjectLocalAgent(
        selectedProjectId,
        localAgent.toolId,
        localAgent.outputPath,
        target,
        projectAgentTargetRoot ?? undefined,
        { slug: result.conflicts[0].slug, action: "overwrite" }
      );
    }
    await Promise.all([refreshProjectAgentPanel(), loadAgentHub()]);
    setMessage(result.action === "overwritten" ? "本地 Agent 已覆盖 AgentHub 并接管" : "本地 Agent 已迁移到 AgentHub");
  }

  async function saveProjectToolTargets(toolIds: ToolId[]) {
    if (!selectedProjectId) return;
    await client.updateProjectToolTargets(selectedProjectId, toolIds);
    setProjectToolTargets(await client.projectToolTargets(selectedProjectId));
    if (projectSkillPanelOpen) {
      setProjectSkillState(await client.projectSkillTargets(selectedProjectId, projectSkillTargetRoot ?? undefined));
      setProjectLocalSkillState(await client.projectLocalSkills(selectedProjectId, projectLocalSkillTargetRoot ?? undefined));
    }
    if (projectMcpPanelOpen) {
      setProjectMcpState(await client.projectMcp(selectedProjectId, projectMcpTargetRoot ?? undefined));
    }
    if (projectHooksPanelOpen) {
      setProjectHookState(await client.projectHooks(selectedProjectId, projectHookTargetRoot ?? undefined));
    }
    if (projectPluginPanelOpen) {
      setProjectPluginState(await client.projectPlugins(selectedProjectId, projectPluginTargetRoot ?? undefined));
    }
    if (projectAgentPanelOpen) {
      setProjectAgentState(await client.projectAgents(selectedProjectId, projectAgentTargetRoot ?? undefined));
    }
    setMessage("项目使用工具已更新");
  }

  async function saveProjectSkillTargets(skillId: string, toolIds: ToolId[]) {
    if (!selectedProjectId) return;
    const targetRootPath = projectSkillTargetRoot ?? undefined;
    let result = await client.updateProjectSkillTargets(selectedProjectId, skillId, toolIds, false, targetRootPath);
    if (result.requiresConfirmation) {
      const confirmed = window.confirm("项目使用工具中已有同名技能 link，是否替换为当前 SkillHub 技能？");
      if (confirmed) {
        result = await client.updateProjectSkillTargets(selectedProjectId, skillId, toolIds, true, targetRootPath);
      }
    }
    setLastProjectSkillResult(result);
    setProjectSkillState(await client.projectSkillTargets(selectedProjectId, targetRootPath));
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

  async function openRuleCreateDialog(file: RuleFileName) {
    if (!selectedProjectId || !ruleSyncStatus) return;
    const source = defaultRuleCreateSource(ruleSyncStatus, file);
    setPendingRuleCreateFile(file);
    setRuleCreateSource(source);
    setRuleCreatePreview(null);
    setRuleCreateContent("");
    await loadRuleCreatePreview(file, source);
  }

  async function loadRuleCreatePreview(file: RuleFileName, source: RuleCreateSource) {
    if (!selectedProjectId) return;
    setRuleCreateLoading(true);
    try {
      const preview = await client.prepareRuleFileCreate(selectedProjectId, file, source);
      setRuleCreateSource(source);
      setRuleCreatePreview(preview);
      setRuleCreateContent(preview.content);
    } finally {
      setRuleCreateLoading(false);
    }
  }

  async function createRuleFileFromDraft() {
    if (!selectedProjectId || !pendingRuleCreateFile) return;
    const result = await client.createRuleFile(selectedProjectId, pendingRuleCreateFile, ruleCreateContent);
    setRuleSyncStatus(result.status);
    resetRuleCreateDialog();
    setMessage(result.message);
  }

  function resetRuleCreateDialog() {
    setPendingRuleCreateFile(null);
    setRuleCreatePreview(null);
    setRuleCreateContent("");
    setRuleCreateLoading(false);
  }

  async function openRuleFile(file: RuleFileName) {
    if (!selectedProjectId) return;
    await client.openRuleFile(selectedProjectId, file);
    setMessage(`已打开 ${file}`);
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

function chooseLocalSkillMigrationMode(folderName: string, existingSkillLabel: string): ProjectLocalSkillMigrationMode | null {
  const choice = window.prompt(
    `SkillHub 已有同名技能「${folderName}」：${existingSkillLabel}\n` +
      "输入 1 覆盖SkillHub（并转为link）\n" +
      "输入 2 本地换成link（删除本地技能）\n" +
      "输入 3 取消",
    "3"
  );
  if (choice === "1") return "overwrite-skillhub";
  if (choice === "2") return "link-existing";
  return null;
}

function chooseLocalMcpMigrationMode(serverId: string): ProjectLocalMcpMigrationMode | null {
  const choice = window.prompt(
    `McpHub 已有同名 MCP server「${serverId}」\n` +
      "输入 1 覆盖 McpHub 定义\n" +
      "输入 2 关联现有 McpHub 定义\n" +
      "输入 3 取消",
    "3"
  );
  if (choice === "1") return "overwrite-mcphub";
  if (choice === "2") return "link-existing";
  return null;
}

function Shell({ message }: { message: string }) {
  return (
    <main className="app">
      <section className="empty-state">{message}</section>
    </main>
  );
}

export function GlobalNotice({ message, busyMessage = "" }: { message: string; busyMessage?: string | null }) {
  const activeMessage = busyMessage?.trim() ? busyMessage.trim() : message.trim();
  const [hiddenMessage, setHiddenMessage] = useState("");

  useEffect(() => {
    if (!activeMessage) {
      setHiddenMessage("");
      return;
    }

    setHiddenMessage("");
    const timer = window.setTimeout(() => setHiddenMessage(activeMessage), 10000);
    return () => window.clearTimeout(timer);
  }, [activeMessage]);

  if (!activeMessage || hiddenMessage === activeMessage) return null;

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="true">
      <div className="toast-notice" role="status">
        {activeMessage}
      </div>
    </div>
  );
}

function cliHubOperationMessage(operation: NonNullable<CliHubList["operation"]>): string {
  return `CliHub 正在${cliHubOperationLabel(operation.kind)}：${operation.cliDisplayName}`;
}

function cliHubOperationLabel(kind: string): string {
  if (kind === "install") return "安装";
  if (kind === "update-check") return "检查更新";
  if (kind === "update") return "更新";
  return "刷新发现";
}

function replaceCliHubCli(current: CliHubList | null, cli: CliHubList["clis"][number]): CliHubList | null {
  if (!current) return current;
  return {
    ...current,
    clis: current.clis.map((item) => (item.cliId === cli.cliId ? cli : item))
  };
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
  const selectableTools = useMemo(() => tools.filter(isLaunchableProjectTool), [tools]);
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
          <span>AI项目管理</span>
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
  scanResult,
  onOpen,
  onRemove,
  onAddScanCandidate,
  onCloseScanResults,
  commandBar
}: {
  projects: Project[];
  busy: boolean;
  scanResult: ScanResultState | null;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onAddScanCandidate: (candidateId: string) => void;
  onCloseScanResults: () => void;
  commandBar?: React.ReactNode;
}) {
  return (
    <section className="content">
      {commandBar}

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

function RuleCreateDialog({
  status,
  targetFile,
  source,
  preview,
  content,
  busy,
  onCancel,
  onSourceChange,
  onContentChange,
  onConfirm
}: {
  status: RuleSyncStatus;
  targetFile: RuleFileName;
  source: RuleCreateSource;
  preview: RuleCreatePreview | null;
  content: string;
  busy: boolean;
  onCancel: () => void;
  onSourceChange: (source: RuleCreateSource) => void;
  onContentChange: (content: string) => void;
  onConfirm: () => void;
}) {
  const sourceFile = oppositeRuleFileName(targetFile);
  const syncAvailable = status.files[sourceFile].exists;
  const canConfirm = Boolean(preview) && content.trim().length > 0 && !busy;

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog rule-create-dialog" role="dialog" aria-modal="true" aria-labelledby="rule-create-title">
        <header>
          <div>
            <span className="eyebrow">创建规则文件</span>
            <h2 id="rule-create-title">创建{targetFile}</h2>
          </div>
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            取消
          </button>
        </header>

        <div className="rule-create-source-options" role="radiogroup" aria-label="创建方式">
          <label className={`rule-create-source-option${source === "sync" ? " active" : ""}${!syncAvailable ? " disabled" : ""}`}>
            <input
              type="radio"
              name="rule-create-source"
              value="sync"
              checked={source === "sync"}
              disabled={busy || !syncAvailable}
              onChange={() => onSourceChange("sync")}
            />
            <span>从{sourceFile}同步</span>
            <small>{syncAvailable ? "复制现有规则内容" : `${sourceFile} 不存在`}</small>
          </label>
          <label className={`rule-create-source-option${source === "template" ? " active" : ""}`}>
            <input
              type="radio"
              name="rule-create-source"
              value="template"
              checked={source === "template"}
              disabled={busy}
              onChange={() => onSourceChange("template")}
            />
            <span>默认模板</span>
            <small>使用内置规则模板作为初稿</small>
          </label>
        </div>

        <label className="rule-create-preview">
          <span className="field-label">预览和编辑</span>
          <textarea
            value={content}
            aria-label={`${targetFile} 预览内容`}
            spellCheck={false}
            disabled={busy || !preview}
            onChange={(event) => onContentChange(event.target.value)}
          />
        </label>

        {preview ? <p className="muted compact">{preview.message}</p> : <p className="muted compact">正在生成预览...</p>}

        <div className="settings-actions">
          <button className="primary" type="button" onClick={onConfirm} disabled={!canConfirm}>
            创建
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
  onApplyRuleSync = () => {},
  onCreateRuleFile = () => {},
  onOpenRuleFile = () => {},
  onOpenProjectSkills = () => {},
  onOpenProjectAgents = () => {},
  onOpenProjectPlugins = () => {},
  onOpenProjectMcp = () => {},
  onOpenProjectHooks = () => {}
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
  onCreateRuleFile?: (file: RuleFileName) => void;
  onOpenRuleFile?: (file: RuleFileName) => void;
  onOpenProjectSkills?: (targetRootPath: string) => void;
  onOpenProjectAgents?: (targetRootPath: string) => void;
  onOpenProjectPlugins?: (targetRootPath: string) => void;
  onOpenProjectMcp?: (targetRootPath: string) => void;
  onOpenProjectHooks?: (targetRootPath: string) => void;
}) {
  const toolMap = useMemo(() => new Map(tools.map((tool) => [tool.toolId, tool])), [tools]);
  const projectTools = useMemo(() => tools.filter(isLaunchableProjectTool), [tools]);
  const repairSignals = useMemo(
    () => buildRepairSignals(project, detail, warnings, repairCandidates),
    [detail, project, repairCandidates, warnings]
  );
  const enabledToolCount = projectToolTargets.filter((target) => target.enabled).length;
  const ruleFileCount = ruleSyncStatus ? Object.values(ruleSyncStatus.files).filter((file) => file.exists).length : null;
  return (
    <section className="content">
      <div className="toolbar-panel compact detail-command-panel">
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

      <details className="toolbar-panel compact detail-management-panel">
        <summary>
          <span className="detail-management-title">项目配置</span>
          <span className="detail-management-summary">
            {projectToolTargets.length > 0 ? <span className="metric-pill">{enabledToolCount}/{projectToolTargets.length} 工具</span> : null}
            {ruleFileCount !== null ? <span className="metric-pill">{ruleFileCount}/2 规则文件</span> : <span className="metric-pill">规则状态读取中</span>}
          </span>
        </summary>
        <div className="detail-management-body">
          <ProjectToolTargetSelector
            targets={projectToolTargets}
            tools={tools}
            busy={busy}
            onUpdate={onUpdateProjectTools}
          />
          <ProjectRuleSyncPanel
            status={ruleSyncStatus ?? null}
            busy={busy}
            onRefresh={onRefreshRuleSync}
            onApply={onApplyRuleSync}
            onCreateFile={onCreateRuleFile}
            onOpenFile={onOpenRuleFile}
          />
        </div>
      </details>

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
          onOpenProjectSkills={onOpenProjectSkills}
          onOpenProjectAgents={onOpenProjectAgents}
          onOpenProjectPlugins={onOpenProjectPlugins}
          onOpenProjectMcp={onOpenProjectMcp}
          onOpenProjectHooks={onOpenProjectHooks}
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
  tools = [],
  busy,
  onUpdate
}: {
  targets: ProjectToolTarget[];
  tools?: ToolStatus[];
  busy: boolean;
  onUpdate: (toolIds: ToolId[]) => void;
}) {
  const visibleTargets = useMemo(() => {
    if (tools.length === 0) return targets;
    const launchableToolIds = new Set(tools.filter(isLaunchableProjectTool).map((tool) => tool.toolId));
    return targets.filter((target) => launchableToolIds.has(target.toolId));
  }, [targets, tools]);
  const enabledToolIds = visibleTargets.filter((target) => target.enabled).map((target) => target.toolId);

  if (visibleTargets.length === 0) return null;

  function toggleTool(toolId: ToolId, enabled: boolean) {
    const next = enabled ? [...enabledToolIds, toolId] : enabledToolIds.filter((id) => id !== toolId);
    onUpdate(uniqueToolIds(next));
  }

  return (
    <section className="project-tool-targets" aria-label="项目使用工具">
      <span className="field-label">项目使用工具</span>
      <div className="tool-chip-list">
        {visibleTargets.map((target) => (
          <label className="tool-target-chip" key={target.toolId} title={target.reason ?? target.skillDirectory ?? target.toolId}>
            <input
              type="checkbox"
              checked={target.enabled}
              disabled={busy}
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
  onApply,
  onCreateFile,
  onOpenFile
}: {
  status: RuleSyncStatus | null;
  busy: boolean;
  onRefresh: () => void;
  onApply: (direction: RuleSyncDirection) => void;
  onCreateFile: (file: RuleFileName) => void;
  onOpenFile: (file: RuleFileName) => void;
}) {
  const agentsFile = status?.files["AGENTS.md"] ?? null;
  const claudeFile = status?.files["CLAUDE.md"] ?? null;
  const agentsToClaude = status?.directions["agents-to-claude"];
  const claudeToAgents = status?.directions["claude-to-agents"];
  const hasRules = Boolean(agentsFile?.exists || claudeFile?.exists);

  return (
    <section className="project-rule-sync" aria-label="规则同步">
      <div className="rule-sync-header">
        <span className="field-label">规则同步</span>
        <div className="rule-sync-header-actions">
          <button className="secondary" type="button" disabled={busy} onClick={onRefresh}>
            刷新规则
          </button>
        </div>
      </div>
      {status ? (
        <>
          {!hasRules ? (
            <div className="empty-state compact rule-sync-empty">
              <h3>未发现规则文件</h3>
              <p>可在 CLAUDE.md 行右侧创建模板作为项目规则入口。</p>
            </div>
          ) : null}
          <div className="rule-sync-file-list">
            {agentsFile ? (
              <RuleFileRow
                file={agentsFile}
                busy={busy}
                direction="claude-to-agents"
                directionStatus={claudeToAgents}
                onApply={onApply}
                onOpenFile={onOpenFile}
                onCreateFile={onCreateFile}
              />
            ) : null}
            {claudeFile ? (
              <RuleFileRow
                file={claudeFile}
                busy={busy}
                direction="agents-to-claude"
                directionStatus={agentsToClaude}
                onApply={onApply}
                onOpenFile={onOpenFile}
                onCreateFile={onCreateFile}
              />
            ) : null}
          </div>
        </>
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
  onApply,
  onOpenFile,
  onCreateFile
}: {
  file: RuleSyncStatus["files"][keyof RuleSyncStatus["files"]];
  busy: boolean;
  direction: RuleSyncDirection;
  directionStatus: RuleSyncStatus["directions"][RuleSyncDirection] | undefined;
  onApply: (direction: RuleSyncDirection) => void;
  onOpenFile: (file: RuleFileName) => void;
  onCreateFile: (file: RuleFileName) => void;
}) {
  return (
    <article className="rule-file-row" aria-label={`${file.file} 规则文件`}>
      <RuleFileStatus file={file} />
      <div className="rule-file-row-actions">
        {file.exists && file.mtime ? <time dateTime={file.mtime}>{formatTime(file.mtime)}</time> : null}
        {file.exists ? (
          <button className="secondary" type="button" disabled={busy} onClick={() => onOpenFile(file.file)}>
            查看
          </button>
        ) : null}
        {!file.exists ? (
          <button className="primary" type="button" disabled={busy} onClick={() => onCreateFile(file.file)}>
            创建
          </button>
        ) : null}
        {file.exists && directionStatus?.enabled ? (
          <button
            className="secondary"
            type="button"
            disabled={busy}
            title={directionStatus.reason ?? undefined}
            onClick={() => onApply(direction)}
          >
            {file.exists ? "同步" : "创建"}
          </button>
        ) : null}
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

function defaultRuleCreateSource(status: RuleSyncStatus, file: RuleFileName): RuleCreateSource {
  return status.files[oppositeRuleFileName(file)].exists ? "sync" : "template";
}

function oppositeRuleFileName(file: RuleFileName): RuleFileName {
  return file === "CLAUDE.md" ? "AGENTS.md" : "CLAUDE.md";
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

function uniqueMcpTargetToolIds(toolIds: McpHubTargetToolId[]): McpHubTargetToolId[] {
  return Array.from(new Set(toolIds));
}

function isLaunchableProjectTool(tool: ToolStatus): boolean {
  return tool.visibleInProjectUi && tool.capabilities.launchNew && tool.available;
}

function SessionGroup({
  group,
  tools,
  toolMap,
  busy,
  onLaunch,
  onResume,
  onDeleteSession,
  onOpenProjectSkills,
  onOpenProjectAgents,
  onOpenProjectPlugins,
  onOpenProjectMcp,
  onOpenProjectHooks
}: {
  group: ProjectDetailGroup;
  tools: ToolStatus[];
  toolMap: Map<string, ToolStatus>;
  busy: boolean;
  onLaunch: (toolId: ToolId, cwd: string) => void;
  onResume: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenProjectSkills: (targetRootPath: string) => void;
  onOpenProjectAgents: (targetRootPath: string) => void;
  onOpenProjectPlugins: (targetRootPath: string) => void;
  onOpenProjectMcp: (targetRootPath: string) => void;
  onOpenProjectHooks: (targetRootPath: string) => void;
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
          <button className="secondary" type="button" disabled={busy} onClick={() => onOpenProjectSkills(group.fullPath)}>
            技能
          </button>
          <button className="secondary" type="button" disabled={busy} onClick={() => onOpenProjectAgents(group.fullPath)}>
            Agent
          </button>
          <button className="secondary" type="button" disabled={busy} onClick={() => onOpenProjectPlugins(group.fullPath)}>
            Plugin
          </button>
          <button className="secondary" type="button" disabled={busy} onClick={() => onOpenProjectMcp(group.fullPath)}>
            MCP
          </button>
          <button className="secondary" type="button" disabled={busy} onClick={() => onOpenProjectHooks(group.fullPath)}>
            Hooks
          </button>
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
