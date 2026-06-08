import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppConfig,
  AgentHubAgent,
  AgentHubList,
  CliHubList,
  HookHubSuite,
  PluginHubList,
  Project,
  ProjectAgentApplyResult,
  ProjectAgentState,
  ProjectDetail,
  ProjectHookBinding,
  ProjectHookState,
  ProjectLocalAgentMigrationResult,
  ProjectLocalSkillsState,
  ProjectPluginState,
  ProjectRepairCandidate,
  ProjectToolTarget,
  RefreshResult,
  RelocationResult,
  ScanCandidate,
  SkillHubSkill,
  SkillHubSource,
  SkillHubSourceUpdatePreview,
  ToolId,
  ToolStatus
} from "../src/shared/types.js";
import { App, GlobalNotice, HomePage, ProjectDetailView } from "../src/client/main.js";

const clientMock = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  eventsUrl: vi.fn(),
  projects: vi.fn(),
  detail: vi.fn(),
  detailSummary: vi.fn(),
  tools: vi.fn(),
  warnings: vi.fn(),
  setDataDir: vi.fn(),
  config: vi.fn(),
  updateConfig: vi.fn(),
  skillhub: vi.fn(),
  importLocalSkill: vi.fn(),
  importGitHubSkill: vi.fn(),
  checkSkillHubUpdates: vi.fn(),
  applySkillHubUpdate: vi.fn(),
  previewDeleteSkillHubSkill: vi.fn(),
  deleteSkillHubSkill: vi.fn(),
  openSkillHubSkill: vi.fn(),
  agenthub: vi.fn(),
  refreshAgentHubDiscovery: vi.fn(),
  importBuiltInAgencyAgents: vi.fn(),
  importLocalAgents: vi.fn(),
  openAgentHubAgent: vi.fn(),
  reparseAgentHubAgent: vi.fn(),
  deleteAgentHubAgent: vi.fn(),
  deleteAgentHubSource: vi.fn(),
  clihub: vi.fn(),
  refreshCliHubDiscovery: vi.fn(),
  addCliHubLocalPath: vi.fn(),
  addCliHubInstallCommand: vi.fn(),
  addCliHubChannel: vi.fn(),
  installCliHubCli: vi.fn(),
  checkCliHubUpdates: vi.fn(),
  checkCliHubUpdate: vi.fn(),
  updateCliHubCli: vi.fn(),
  launchCliHubUpdate: vi.fn(),
  mcphub: vi.fn(),
  importMcpHubJson: vi.fn(),
  deleteMcpHubServer: vi.fn(),
  hookhub: vi.fn(),
  createHookHubSuite: vi.fn(),
  updateHookHubSuite: vi.fn(),
  deleteHookHubSuite: vi.fn(),
  exportHookHubSuite: vi.fn(),
  syncHookHubSuite: vi.fn(),
  importHookHubSuite: vi.fn(),
  importNativeHooks: vi.fn(),
  pluginhub: vi.fn(),
  refreshPluginHubDiscovery: vi.fn(),
  importLocalPlugin: vi.fn(),
  importGitHubPlugin: vi.fn(),
  updatePluginHubSource: vi.fn(),
  createCustomPlugin: vi.fn(),
  updateCustomPlugin: vi.fn(),
  previewDeletePluginHubSource: vi.fn(),
  deletePluginHubSource: vi.fn(),
  previewDeletePluginHubPlugin: vi.fn(),
  openPluginHubPrivateFile: vi.fn(),
  deletePluginHubPlugin: vi.fn(),
  projectToolTargets: vi.fn(),
  updateProjectToolTargets: vi.fn(),
  projectSkillTargets: vi.fn(),
  updateProjectSkillTargets: vi.fn(),
  projectLocalSkills: vi.fn(),
  migrateProjectLocalSkill: vi.fn(),
  projectAgents: vi.fn(),
  projectLocalAgents: vi.fn(),
  applyProjectAgent: vi.fn(),
  syncProjectAgent: vi.fn(),
  syncProjectAgents: vi.fn(),
  disableProjectAgent: vi.fn(),
  migrateProjectLocalAgent: vi.fn(),
  projectPlugins: vi.fn(),
  installProjectPlugin: vi.fn(),
  syncProjectPlugin: vi.fn(),
  uninstallProjectPlugin: vi.fn(),
  projectMcp: vi.fn(),
  applyProjectMcp: vi.fn(),
  disableProjectMcp: vi.fn(),
  migrateProjectLocalMcp: vi.fn(),
  projectHooks: vi.fn(),
  writeProjectHooks: vi.fn(),
  shareProjectHooks: vi.fn(),
  applyHookHubSuite: vi.fn(),
  syncProjectHookTool: vi.fn(),
  syncProjectHooks: vi.fn(),
  ruleSyncStatus: vi.fn(),
  applyRuleSync: vi.fn(),
  commitRuleSync: vi.fn(),
  prepareRuleFileCreate: vi.fn(),
  createRuleFile: vi.fn(),
  createRuleTemplateFile: vi.fn(),
  openRuleFile: vi.fn(),
  drives: vi.fn(),
  pickDirectory: vi.fn(),
  createDirectory: vi.fn(),
  startScan: vi.fn(),
  addProject: vi.fn(),
  removeProject: vi.fn(),
  deleteSession: vi.fn(),
  resume: vi.fn(),
  refreshProject: vi.fn(),
  refreshSessions: vi.fn(),
  confirmCandidates: vi.fn(),
  relocateProject: vi.fn(),
  repairCandidates: vi.fn(),
  repairProject: vi.fn()
}));

vi.mock("../src/client/api.js", () => ({ client: clientMock }));

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMock.bootstrap.mockResolvedValue({
      initialized: true,
      dataDir: "C:\\tmp\\local-ai-workbench",
      defaultDataDir: "C:\\tmp\\local-ai-workbench",
      overriddenByArg: true
    });
    clientMock.eventsUrl.mockReturnValue("/api/events?token=test");
    clientMock.projects.mockResolvedValue([]);
    clientMock.detail.mockResolvedValue(detailFixture(projectFixture("E:\\old")));
    clientMock.detailSummary.mockImplementation((projectId: string, search: string) =>
      clientMock.detail(projectId, search).then((detail: ProjectDetail) => detailWithoutSessionRows(detail))
    );
    clientMock.tools.mockResolvedValue([]);
    clientMock.warnings.mockResolvedValue([]);
    clientMock.config.mockResolvedValue(appConfigFixture());
    clientMock.updateConfig.mockImplementation((config: Partial<Pick<AppConfig, "terminal" | "skillhub">>) =>
      Promise.resolve(appConfigFixture(config.terminal?.mode ?? "new-window", config.skillhub?.rootDir))
    );
    clientMock.skillhub.mockResolvedValue({
      config: { rootDir: "C:\\tmp\\local-ai-workbench\\skillhub", libraryDir: "C:\\tmp\\local-ai-workbench\\skillhub\\library" },
      sources: [],
      skills: []
    });
    clientMock.checkSkillHubUpdates.mockResolvedValue({ previews: [] });
    clientMock.openSkillHubSkill.mockResolvedValue({ opened: true, path: "C:\\tmp\\local-ai-workbench\\skillhub\\library\\review\\SKILL.md" });
    clientMock.agenthub.mockResolvedValue(agentHubListFixture());
    clientMock.refreshAgentHubDiscovery.mockResolvedValue(agentHubListFixture());
    clientMock.importBuiltInAgencyAgents.mockResolvedValue({ source: agentHubSourceFixture(), imported: [], updated: [], skipped: [], conflicts: [], requiresConfirmation: false });
    clientMock.importLocalAgents.mockResolvedValue({ source: agentHubSourceFixture(), imported: [], updated: [], skipped: [], conflicts: [], requiresConfirmation: false });
    clientMock.openAgentHubAgent.mockResolvedValue({ opened: true, path: "C:\\tmp\\local-ai-workbench\\agenthub\\library\\agency-agents\\engineering\\code-reviewer.md" });
    clientMock.reparseAgentHubAgent.mockResolvedValue(agentHubAgentFixture());
    clientMock.deleteAgentHubAgent.mockResolvedValue({ agent: agentHubAgentFixture(), targetsDeleted: [] });
    clientMock.deleteAgentHubSource.mockResolvedValue({ sourceId: "agency-agents", agentsDeleted: [] });
    clientMock.clihub.mockResolvedValue(cliHubListFixture());
    clientMock.refreshCliHubDiscovery.mockResolvedValue(cliHubListFixture());
    clientMock.addCliHubLocalPath.mockResolvedValue(cliHubListFixture().clis[0]);
    clientMock.addCliHubInstallCommand.mockResolvedValue(cliHubListFixture().clis[1]);
    clientMock.addCliHubChannel.mockResolvedValue(cliHubListFixture().clis[0]);
    clientMock.installCliHubCli.mockResolvedValue(cliHubListFixture().clis[0]);
    clientMock.checkCliHubUpdates.mockResolvedValue(cliHubListFixture("update-available"));
    clientMock.checkCliHubUpdate.mockResolvedValue(cliHubListFixture("update-available"));
    clientMock.updateCliHubCli.mockResolvedValue(cliHubListFixture().clis[0]);
    clientMock.launchCliHubUpdate.mockResolvedValue({
      launched: true,
      command: { command: "npm", args: ["update", "-g", "@openai/codex"], cwd: "C:\\tmp\\local-ai-workbench" },
      host: "powershell",
      reason: null
    });
    clientMock.mcphub.mockResolvedValue({
      servers: [
        {
          serverId: "context7",
          name: "context7",
          description: "Context7 docs",
          transport: "stdio",
          command: "npx",
          args: ["-y", "@upstash/context7-mcp"],
          url: null,
          headers: {},
          env: {},
          requiredEnv: [],
          builtin: true,
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z"
        },
        {
          serverId: "playwright",
          name: "playwright",
          description: "Playwright",
          transport: "stdio",
          command: "npx",
          args: ["-y", "@playwright/mcp@latest"],
          url: null,
          headers: {},
          env: {},
          requiredEnv: [],
          builtin: true,
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z"
        }
      ]
    });
    clientMock.importMcpHubJson.mockResolvedValue({ added: [], updated: [], patched: [], failed: [] });
    clientMock.deleteMcpHubServer.mockResolvedValue({
      serverId: "context7",
      deleted: true,
      bindingsRemoved: [],
      modifiedFiles: [],
      skippedMissingFiles: [],
      failures: []
    });
    clientMock.hookhub.mockResolvedValue({ suites: [hookHubSuiteFixture()] });
    clientMock.createHookHubSuite.mockResolvedValue(hookHubSuiteFixture());
    clientMock.updateHookHubSuite.mockResolvedValue(hookHubSuiteFixture());
    clientMock.deleteHookHubSuite.mockResolvedValue({ suiteId: "suite-1", deleted: true });
    clientMock.exportHookHubSuite.mockResolvedValue({ format: "hookhub-suite-v1", suite: hookHubSuiteFixture() });
    clientMock.syncHookHubSuite.mockResolvedValue({ suiteId: "suite-1", projectId: null, updated: [], skipped: [] });
    clientMock.importHookHubSuite.mockResolvedValue({ action: "created", suite: hookHubSuiteFixture(), conflict: null });
    clientMock.importNativeHooks.mockResolvedValue({ action: "created", suite: hookHubSuiteFixture(), conflict: null });
    clientMock.pluginhub.mockResolvedValue(pluginHubListFixture());
    clientMock.refreshPluginHubDiscovery.mockResolvedValue(pluginHubListFixture());
    clientMock.importLocalPlugin.mockResolvedValue({ source: pluginHubSourceFixture(), plugins: [pluginHubPluginFixture()], importedSkills: [], skipped: [] });
    clientMock.importGitHubPlugin.mockResolvedValue({ source: pluginHubSourceFixture(), plugins: [pluginHubPluginFixture()], importedSkills: [], skipped: [] });
    clientMock.updatePluginHubSource.mockResolvedValue({ source: pluginHubSourceFixture(), plugins: [pluginHubPluginFixture()], importedSkills: [], skipped: [] });
    clientMock.createCustomPlugin.mockResolvedValue(pluginHubPluginFixture({ id: "plugin-custom", kind: "custom", sourceId: null }));
    clientMock.previewDeletePluginHubSource.mockResolvedValue({
      source: pluginHubSourceFixture(),
      sourcePlugins: [pluginHubPluginFixture()],
      sourceComponents: [],
      customPlugins: [],
      projectBindings: [],
      failures: []
    });
    clientMock.deletePluginHubSource.mockResolvedValue({
      source: pluginHubSourceFixture(),
      sourcePlugins: [pluginHubPluginFixture()],
      sourceComponents: [],
      customPlugins: [],
      projectBindings: [],
      failures: []
    });
    clientMock.previewDeletePluginHubPlugin.mockResolvedValue({ plugin: pluginHubPluginFixture(), projectBindings: [], failures: [] });
    clientMock.openPluginHubPrivateFile.mockResolvedValue({ opened: true, path: "C:\\tmp\\plugin.json" });
    clientMock.deletePluginHubPlugin.mockResolvedValue({ plugin: pluginHubPluginFixture(), projectBindings: [], failures: [] });
    clientMock.projectToolTargets.mockResolvedValue([]);
    clientMock.projectSkillTargets.mockResolvedValue({ projectId: "project-1", toolTargets: [], skillTargets: [], skills: [] });
    clientMock.projectLocalSkills.mockResolvedValue({ projectId: "project-1", toolTargets: [], migrationSources: [], skills: [] });
    clientMock.projectAgents.mockResolvedValue(projectAgentStateFixture(projectFixture("E:\\old")));
    clientMock.projectLocalAgents.mockResolvedValue(projectAgentStateFixture(projectFixture("E:\\old")));
    clientMock.applyProjectAgent.mockResolvedValue(projectAgentApplyResultFixture(projectFixture("E:\\old")));
    clientMock.syncProjectAgent.mockResolvedValue(projectAgentApplyResultFixture(projectFixture("E:\\old")));
    clientMock.syncProjectAgents.mockResolvedValue({ projectId: "project-1", targetRootPath: "E:\\old", updated: [], skipped: [] });
    clientMock.disableProjectAgent.mockResolvedValue({ ...projectAgentDisableResultFixture(projectFixture("E:\\old")), deletedFile: false });
    clientMock.migrateProjectLocalAgent.mockResolvedValue(projectLocalAgentMigrationResultFixture(projectFixture("E:\\old")));
    clientMock.projectPlugins.mockResolvedValue(projectPluginStateFixture(projectFixture("E:\\old")));
    clientMock.installProjectPlugin.mockResolvedValue(projectPluginApplyResultFixture(projectFixture("E:\\old")));
    clientMock.syncProjectPlugin.mockResolvedValue(projectPluginApplyResultFixture(projectFixture("E:\\old")));
    clientMock.uninstallProjectPlugin.mockResolvedValue({ ...projectPluginApplyResultFixture(projectFixture("E:\\old")), binding: null, message: "Plugin 已从项目卸载" });
    clientMock.projectMcp.mockResolvedValue({ projectId: "project-1", targetRootPath: "E:\\old", targets: [], servers: [], bindings: [], localEntries: [] });
    clientMock.projectHooks.mockResolvedValue(projectHookStateFixture(projectFixture("E:\\old")));
    clientMock.writeProjectHooks.mockResolvedValue({ projectId: "project-1", targetRootPath: "E:\\old", toolId: "claude", status: "drifted" });
    clientMock.shareProjectHooks.mockResolvedValue({ suite: hookHubSuiteFixture(), sourceToolId: "claude", sourceConfigPath: "E:\\old\\.claude\\settings.json" });
    clientMock.applyHookHubSuite.mockResolvedValue({
      projectId: "project-1",
      targetRootPath: "E:\\old",
      toolId: "claude",
      suite: hookHubSuiteFixture(),
      binding: projectHookBindingFixture(projectFixture("E:\\old")),
      configPath: "E:\\old\\.claude\\settings.json",
      status: "current",
      backup: { mode: "missing", backupPath: null, metadataPath: null, commit: null, message: "目标配置文件不存在，无需备份" },
      warnings: []
    });
    clientMock.syncProjectHookTool.mockResolvedValue({
      projectId: "project-1",
      targetRootPath: "E:\\old",
      toolId: "claude",
      suite: hookHubSuiteFixture(),
      binding: projectHookBindingFixture(projectFixture("E:\\old")),
      configPath: "E:\\old\\.claude\\settings.json",
      status: "current",
      backup: { mode: "missing", backupPath: null, metadataPath: null, commit: null, message: "目标配置文件不存在，无需备份" },
      warnings: []
    });
    clientMock.syncProjectHooks.mockResolvedValue({ suiteId: null, projectId: "project-1", updated: [], skipped: [] });
    clientMock.applyProjectMcp.mockResolvedValue({
      projectId: "project-1",
      targetRootPath: "E:\\old",
      toolId: "claude",
      server: {
        serverId: "context7",
        name: "context7",
        description: "Context7 docs",
        transport: "stdio",
        command: "npx",
        args: [],
        url: null,
        headers: {},
        env: {},
        requiredEnv: [],
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z"
      },
      binding: {
        projectId: "project-1",
        targetRootPath: "E:\\old",
        toolId: "claude",
        serverId: "context7",
        appliedServerId: "context7",
        appliedAt: "2026-06-01T00:00:00Z",
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z"
      },
      configPath: "E:\\old\\.mcp.json",
      warnings: []
    });
    clientMock.disableProjectMcp.mockResolvedValue({
      projectId: "project-1",
      targetRootPath: "E:\\old",
      toolId: "claude",
      serverId: "context7",
      removedBinding: true,
      modified: true,
      configPath: "E:\\old\\.mcp.json",
      reason: null
    });
    clientMock.migrateProjectLocalMcp.mockResolvedValue({
      projectId: "project-1",
      targetRootPath: "E:\\old",
      serverId: "context7",
      action: "migrated",
      server: null,
      bindings: [],
      conflictTargets: [],
      requiresConfirmation: false,
      message: null
    });
    clientMock.updateProjectToolTargets.mockResolvedValue([]);
    clientMock.updateProjectSkillTargets.mockResolvedValue({
      projectId: "project-1",
      skillId: "skill-1",
      targets: [],
      removed: [],
      conflicts: [],
      failures: [],
      requiresConfirmation: false
    });
    clientMock.migrateProjectLocalSkill.mockResolvedValue({
      projectId: "project-1",
      localSkill: null,
      skill: null,
      linkedTarget: null,
      conflictSkills: [],
      requiresConfirmation: false,
      action: "migrated"
    });
    clientMock.ruleSyncStatus.mockResolvedValue(ruleSyncStatusFixture(projectFixture("E:\\old")));
    clientMock.applyRuleSync.mockResolvedValue({
      projectId: "project-1",
      projectRoot: "E:\\old",
      direction: "agents-to-claude",
      sourceFile: "AGENTS.md",
      targetFile: "CLAUDE.md",
      action: "noop",
      backupCommit: null,
      message: "两个规则文件内容一致",
      status: ruleSyncStatusFixture(projectFixture("E:\\old"))
    });
    clientMock.commitRuleSync.mockResolvedValue({
      projectId: "project-1",
      projectRoot: "E:\\old",
      direction: "claude-to-agents",
      targetFile: "AGENTS.md",
      action: "committed",
      backupCommit: "abc123",
      message: "目标规则文件已 commit",
      status: ruleSyncStatusFixture(projectFixture("E:\\old"))
    });
    clientMock.createRuleTemplateFile.mockResolvedValue({
      projectId: "project-1",
      projectRoot: "E:\\old",
      file: "CLAUDE.md",
      path: "E:\\old\\CLAUDE.md",
      action: "created",
      message: "已创建 CLAUDE.md 规则模板",
      status: ruleSyncStatusFixture(projectFixture("E:\\old"))
    });
    clientMock.prepareRuleFileCreate.mockResolvedValue({
      projectId: "project-1",
      projectRoot: "E:\\old",
      file: "CLAUDE.md",
      path: "E:\\old\\CLAUDE.md",
      source: "template",
      sourceFile: null,
      content: "# CLAUDE.md\n\n默认模板\n",
      message: "将使用默认模板创建 CLAUDE.md"
    });
    clientMock.createRuleFile.mockResolvedValue({
      projectId: "project-1",
      projectRoot: "E:\\old",
      file: "CLAUDE.md",
      path: "E:\\old\\CLAUDE.md",
      action: "created",
      message: "已创建 CLAUDE.md",
      status: ruleSyncStatusFixture(projectFixture("E:\\old"))
    });
    clientMock.openRuleFile.mockResolvedValue({ opened: true, path: "E:\\old\\CLAUDE.md" });
    clientMock.repairCandidates.mockResolvedValue([]);
    clientMock.drives.mockResolvedValue([{ root: "E:\\", label: "E:\\" }]);
    clientMock.pickDirectory.mockResolvedValue({ path: "E:\\picked", cancelled: false });
    clientMock.createDirectory.mockResolvedValue({ path: "E:\\picked\\demo-project" });
    clientMock.setDataDir.mockResolvedValue({
      initialized: true,
      dataDir: "C:\\tmp\\local-ai-workbench-next",
      defaultDataDir: "C:\\tmp\\local-ai-workbench",
      overriddenByArg: true
    });
    clientMock.startScan.mockResolvedValue({ scanRunId: "scan-1", candidates: [] });
    clientMock.addProject.mockResolvedValue({ project: projectFixture("E:\\old"), mergedIntoParent: false, removedChildren: [] });
    clientMock.removeProject.mockResolvedValue({ removed: true });
    clientMock.deleteSession.mockResolvedValue({
      deleted: true,
      sessionId: "claude:1",
      sourceFile: "C:\\Users\\brand\\.claude\\projects\\E--new-ai-game\\1.jsonl",
      sourceFormat: "claude-jsonl",
      deletedSourceFile: true,
      deletedNativeSession: true,
      removedIndexCount: 1
    });
    clientMock.refreshProject.mockResolvedValue(refreshResultFixture());
    clientMock.refreshSessions.mockResolvedValue(refreshResultFixture());
    clientMock.confirmCandidates.mockResolvedValue([]);
    clientMock.resume.mockResolvedValue({
      launched: true,
      command: { command: "qwen", args: ["--resume", "session-1"], cwd: "E:\\old" },
      host: "direct",
      reason: null
    });
    clientMock.relocateProject.mockResolvedValue(emptyRelocationResult("E:\\old", "E:\\picked"));
  });

  it("renders the Chinese empty state", () => {
    render(
      <HomePage
        projects={[]}
        busy={false}
        scanResult={null}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onAddScanCandidate={vi.fn()}
        onCloseScanResults={vi.fn()}
      />
    );

    expect(screen.getByText("还没有项目")).toBeInTheDocument();
    expect(screen.queryByText("工作区")).not.toBeInTheDocument();
    expect(screen.queryByText("项目总览")).not.toBeInTheDocument();
    expect(screen.queryByText("子项目")).not.toBeInTheDocument();
    expect(screen.queryByText("添加项目")).not.toBeInTheDocument();
    expect(screen.queryByText("扫描项目")).not.toBeInTheDocument();
  });

  it("renders home stats in the topbar and project actions in the command bar", async () => {
    const projects = [
      { ...projectFixture("E:\\repo-a"), id: "project-a", sessionCount: 3 },
      { ...projectFixture("E:\\repo-b"), id: "project-b", sessionCount: 2 }
    ];
    clientMock.projects.mockResolvedValue(projects);

    const { container } = render(<App />);

    await screen.findByText("repo-a");

    const topbar = container.querySelector(".topbar") as HTMLElement;
    const topbarLinks = [...topbar.querySelectorAll(".topbar-link")].map((button) => button.textContent?.trim());
    const stats = within(topbar).getByLabelText("项目统计");
    expect(topbarLinks).toEqual(["CliHub", "PluginHub", "SkillHub", "AgentHub", "McpHub", "HookHub"]);
    expect(within(topbar).queryByText("项目总览")).not.toBeInTheDocument();
    expect(within(stats).getByText("项目")).toBeInTheDocument();
    expect(within(stats).getByText("2")).toBeInTheDocument();
    expect(within(stats).getByText("会话")).toBeInTheDocument();
    expect(within(stats).getByText("5")).toBeInTheDocument();
    expect(within(topbar).queryByRole("button", { name: "新建项目" })).not.toBeInTheDocument();

    const commandBar = screen.getByRole("region", { name: "项目操作" });
    expect(within(commandBar).getByRole("button", { name: "新建项目" })).toBeInTheDocument();
    expect(within(commandBar).getByText("添加项目")).toBeInTheDocument();
    expect(within(commandBar).getByRole("button", { name: "选择文件夹" })).toBeInTheDocument();
    expect(within(commandBar).getByText("扫描项目")).toBeInTheDocument();
    expect(within(commandBar).getByRole("button", { name: "扫描" })).toBeInTheDocument();
  });

  it("renders global feedback as one floating toast", () => {
    const { container } = render(<GlobalNotice message="项目已添加" busyMessage="CliHub 正在检查更新" />);

    const viewport = container.querySelector(".toast-viewport");
    const toasts = container.querySelectorAll(".toast-notice");

    expect(viewport).toBeInTheDocument();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toHaveTextContent("CliHub 正在检查更新");
    expect(screen.queryByText("项目已添加")).not.toBeInTheDocument();
    expect(container.querySelector(".notice")).not.toBeInTheDocument();
  });

  it("dismisses global feedback after 10 seconds", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<GlobalNotice message="项目已添加" />);

      expect(container.querySelector(".toast-notice")).toHaveTextContent("项目已添加");

      act(() => {
        vi.advanceTimersByTime(10000);
      });

      expect(container.querySelector(".toast-notice")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens SkillHub from the topbar", async () => {
    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "SkillHub" }));

    expect(await screen.findByRole("heading", { name: "SkillHub" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "技能分发中心" })).not.toBeInTheDocument();
    expect(clientMock.skillhub).toHaveBeenCalledWith("");
    expect(screen.getByText("还没有技能")).toBeInTheDocument();
    expect(clientMock.skillhub).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(await screen.findByText("还没有项目")).toBeInTheDocument();
  });

  it("opens AgentHub from the topbar with source grouping and search", async () => {
    const filteredAgentHub = {
      ...agentHubListFixture(),
      agents: [agentHubAgentFixture({ id: "agent-2", slug: "ui-critic", name: "UI Critic", category: "design" })]
    };
    clientMock.agenthub.mockImplementation((query = "") => Promise.resolve(query === "design" ? filteredAgentHub : agentHubListFixture()));
    clientMock.refreshAgentHubDiscovery.mockImplementation((query = "") => Promise.resolve(query === "design" ? filteredAgentHub : agentHubListFixture()));

    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "AgentHub" }));

    expect(await screen.findByRole("heading", { name: "AgentHub" })).toBeInTheDocument();
    expect(clientMock.agenthub).toHaveBeenCalledWith("");
    expect(clientMock.refreshAgentHubDiscovery).toHaveBeenCalledWith("");
    expect(screen.getByRole("region", { name: "Agent 导入" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "AgentHub 来源" })).toBeInTheDocument();
    expect(screen.getByText("agency-agents")).toBeInTheDocument();
    expect(screen.getByText("1 个 Agent")).toBeInTheDocument();

    fireEvent.click(screen.getByText("agency-agents").closest("summary") as HTMLElement);
    expect(screen.getByText("Code Reviewer")).toBeInTheDocument();
    expect(screen.getByText("code-reviewer")).toBeInTheDocument();
    expect(screen.getAllByText("claude").length).toBeGreaterThan(0);
    expect(screen.getAllByText("subagent").length).toBeGreaterThan(0);
    const agentDetails = screen.getByText("Code Reviewer").closest("details") as HTMLDetailsElement;
    fireEvent.click(within(agentDetails).getByText("Code Reviewer"));
    expect(within(agentDetails).getByRole("button", { name: "打开" })).toBeInTheDocument();
    expect(within(agentDetails).getByRole("button", { name: "目录" })).toBeInTheDocument();
    expect(within(agentDetails).getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(within(agentDetails).queryByRole("button", { name: "重新解析" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("名称、描述、slug、source、truth tool、路径或分类"), { target: { value: "design" } });
    await waitFor(() => expect(clientMock.agenthub).toHaveBeenLastCalledWith("design"));
    await waitFor(() => expect(clientMock.refreshAgentHubDiscovery).toHaveBeenLastCalledWith("design"));
    expect(await screen.findByText("UI Critic")).toBeInTheDocument();
  });

  it("deletes an AgentHub agent from the row action", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "AgentHub" }));

    expect(await screen.findByRole("heading", { name: "AgentHub" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("agency-agents").closest("summary") as HTMLElement);
    const agentDetails = screen.getByText("Code Reviewer").closest("details") as HTMLDetailsElement;
    fireEvent.click(within(agentDetails).getByText("Code Reviewer"));
    fireEvent.click(within(agentDetails).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(clientMock.deleteAgentHubAgent).toHaveBeenCalledWith("agent-1"));
    expect(await screen.findByText("AgentHub Agent 已删除")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("opens PluginHub from the topbar and imports local plugins", async () => {
    clientMock.pickDirectory.mockResolvedValue({ path: "C:\\tmp\\wshobson-agents", cancelled: false });
    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "PluginHub" }));

    expect(await screen.findByRole("heading", { name: "PluginHub" })).toBeInTheDocument();
    expect(clientMock.pluginhub).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("region", { name: "Sources" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Plugins" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Custom Plugins" })).toBeInTheDocument();
    expect(screen.getByText("python-development")).toBeInTheDocument();

    const customRegion = screen.getByRole("region", { name: "Custom Plugins" });
    fireEvent.click(within(customRegion).getByText("custom-review"));
    fireEvent.click(within(customRegion).getByRole("button", { name: "编辑 plugin" }));
    const editDialog = await screen.findByRole("dialog", { name: "编辑 Plugin" });
    fireEvent.change(within(editDialog).getByLabelText("描述"), { target: { value: "Updated custom" } });
    fireEvent.click(within(editDialog).getByRole("button", { name: "编辑 Plugin" }));
    await waitFor(() => expect(clientMock.updateCustomPlugin).toHaveBeenCalled());
    expect(clientMock.updateCustomPlugin.mock.calls[0]?.[0]).toBe("plugin-custom");
    expect(clientMock.updateCustomPlugin.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ name: "custom-review", description: "Updated custom" }));
    expect(clientMock.updateCustomPlugin.mock.calls[0]?.[1]).not.toHaveProperty("privateFiles");
    fireEvent.click(within(editDialog).getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "添加 Plugin" }));
    const dialog = await screen.findByRole("dialog", { name: "添加 Plugin" });
    fireEvent.click(within(dialog).getByRole("button", { name: "选择目录" }));
    await waitFor(() => expect(within(dialog).getByLabelText("本地 Plugin source")).toHaveValue("C:\\tmp\\wshobson-agents"));
    fireEvent.click(within(dialog).getByRole("button", { name: "导入本地 Plugin" }));

    await waitFor(() => expect(clientMock.importLocalPlugin).toHaveBeenCalledWith("C:\\tmp\\wshobson-agents"));
  });

  it("creates custom PluginHub plugins from grouped skill, agent, MCP, and hook components", async () => {
    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "PluginHub" }));

    expect(await screen.findByRole("heading", { name: "PluginHub" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创建 Plugin" }));
    const dialog = await screen.findByRole("dialog", { name: "创建 Plugin" });
    fireEvent.change(within(dialog).getByLabelText("plugin name"), { target: { value: "full-stack-pack" } });

    const picker = within(dialog).getByRole("region", { name: "组件选择" });
    for (const groupName of ["Skills", "Agents", "MCP Servers", "Hook Suites"]) {
      fireEvent.click(within(picker).getByText(groupName).closest("summary") as HTMLElement);
    }
    expect(within(picker).getByText("review").closest(".skillhub-skill-row")).toBeInTheDocument();
    expect(within(picker).getByText("Code Reviewer").closest(".agenthub-agent-row")).toBeInTheDocument();
    expect(within(picker).getByText("context7").closest(".mcphub-server-card")).toBeInTheDocument();
    expect(within(picker).getByText("提交前检查").closest(".hookhub-suite-card")).toBeInTheDocument();
    fireEvent.click(within(picker).getByLabelText("选择 review"));
    fireEvent.click(within(picker).getByLabelText("选择 Code Reviewer"));
    fireEvent.click(within(picker).getByLabelText("选择 context7"));
    fireEvent.click(within(picker).getByLabelText("选择 提交前检查"));
    fireEvent.click(within(picker).getByLabelText("Code Reviewer required"));
    expect(within(picker).getByText("4 selected")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "创建 Plugin" }));

    await waitFor(() => expect(clientMock.createCustomPlugin).toHaveBeenCalled());
    expect(clientMock.createCustomPlugin.mock.calls[0]?.[0]).toEqual({
      name: "full-stack-pack",
      description: "",
      componentRefs: [
        { type: "skill", componentId: "skill-1", required: false },
        { type: "agent", componentId: "agent-1", required: true },
        { type: "mcp", componentId: "context7", required: false },
        { type: "hook", componentId: "suite-1", required: false }
      ],
      privateFiles: []
    });
  });

  it("renders PluginHub plugin contents by hub category and reuses hub open actions", async () => {
    const list = pluginHubListFixture();
    const plugin = pluginHubPluginFixture({
      source: list.sources[0],
      componentRefs: [
        { type: "skill", componentId: "skill-1", required: false },
        { type: "agent", componentId: "agent-1", required: false },
        { type: "mcp", componentId: "context7", required: false },
        { type: "hook", componentId: "suite-1", required: false }
      ]
    });
    list.plugins = [plugin];
    list.sourcePlugins = [plugin];
    list.customPlugins = [];
    clientMock.pluginhub.mockResolvedValue(list);
    clientMock.refreshPluginHubDiscovery.mockResolvedValue(list);
    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "PluginHub" }));
    expect(await screen.findByRole("heading", { name: "PluginHub" })).toBeInTheDocument();
    const pluginsRegion = screen.getByRole("region", { name: "Plugins" });
    fireEvent.click(within(pluginsRegion).getByText("python-development").closest("summary") as HTMLElement);

    const skillsGroup = within(pluginsRegion).getByText("Skills").closest("details") as HTMLElement;
    fireEvent.click(within(skillsGroup).getByText("Skills").closest("summary") as HTMLElement);
    fireEvent.click(within(skillsGroup).getByText("review").closest("summary") as HTMLElement);
    fireEvent.click(within(skillsGroup).getByRole("button", { name: "打开" }));
    await waitFor(() => expect(clientMock.openSkillHubSkill).toHaveBeenCalledWith("skill-1", "document"));

    const agentsGroup = within(pluginsRegion).getByText("Agents").closest("details") as HTMLElement;
    fireEvent.click(within(agentsGroup).getByText("Agents").closest("summary") as HTMLElement);
    fireEvent.click(within(agentsGroup).getByText("Code Reviewer").closest("summary") as HTMLElement);
    fireEvent.click(within(agentsGroup).getByRole("button", { name: "打开" }));
    await waitFor(() => expect(clientMock.openAgentHubAgent).toHaveBeenCalledWith("agent-1", "document"));

    const mcpGroup = within(pluginsRegion).getByText("MCP Servers").closest("details") as HTMLElement;
    fireEvent.click(within(mcpGroup).getByText("MCP Servers").closest("summary") as HTMLElement);
    fireEvent.click(within(mcpGroup).getByText("context7").closest("summary") as HTMLElement);
    expect(within(mcpGroup).getByText("Context7 docs")).toBeInTheDocument();

    const privateFilesGroup = within(pluginsRegion).getByText("Private Files").closest("details") as HTMLElement;
    fireEvent.click(within(privateFilesGroup).getByText("Private Files").closest("summary") as HTMLElement);
    fireEvent.click(within(privateFilesGroup).getByText("plugins/python-development/.codex-plugin/plugin.json").closest("summary") as HTMLElement);
    fireEvent.click(within(privateFilesGroup).getByRole("button", { name: "打开文件" }));
    await waitFor(() => expect(clientMock.openPluginHubPrivateFile).toHaveBeenCalledWith("plugin-1", "private-1", "document"));
  });

  it("hides empty PluginHub plugin content categories", async () => {
    const list = pluginHubListFixture();
    const plugin = pluginHubPluginFixture({
      source: list.sources[0],
      componentRefs: [{ type: "skill", componentId: "skill-1", required: false }],
      privateFiles: []
    });
    list.plugins = [plugin];
    list.sourcePlugins = [plugin];
    list.customPlugins = [];
    clientMock.pluginhub.mockResolvedValue(list);
    clientMock.refreshPluginHubDiscovery.mockResolvedValue(list);
    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "PluginHub" }));
    expect(await screen.findByRole("heading", { name: "PluginHub" })).toBeInTheDocument();
    const pluginsRegion = screen.getByRole("region", { name: "Plugins" });
    fireEvent.click(within(pluginsRegion).getByText("python-development").closest("summary") as HTMLElement);

    expect(within(pluginsRegion).getByText("Skills")).toBeInTheDocument();
    expect(within(pluginsRegion).queryByText("Agents")).not.toBeInTheDocument();
    expect(within(pluginsRegion).queryByText("MCP Servers")).not.toBeInTheDocument();
    expect(within(pluginsRegion).queryByText("Hook Suites")).not.toBeInTheDocument();
    expect(within(pluginsRegion).queryByText("Private Files")).not.toBeInTheDocument();
  });

  it("opens CliHub from the topbar and supports custom CLI actions", async () => {
    const cliHubFixture = cliHubListFixture();
    cliHubFixture.clis[1] = { ...cliHubFixture.clis[1], availabilityState: "unavailable" };
    clientMock.refreshCliHubDiscovery.mockResolvedValue(cliHubFixture);

    const { container } = render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "CliHub" }));

    expect(await screen.findByRole("heading", { name: "CliHub" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "项目工具 CLI" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检测已安装Cli" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "刷新发现" })).not.toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(clientMock.refreshCliHubDiscovery).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "卸载" })).not.toBeInTheDocument();

    const codexRow = screen.getByText("Codex").closest("details") as HTMLElement;
    const codexSummary = within(codexRow).getByText("Codex").closest("summary") as HTMLElement;
    expect(codexSummary).not.toHaveTextContent("项目工具");
    expect(codexSummary).not.toHaveTextContent("内置");
    expect(codexSummary).not.toHaveTextContent("可用");
    expect(codexSummary).not.toHaveTextContent("未发现");
    expect(codexSummary).not.toHaveTextContent("更新未知");
    expect(codexSummary).not.toHaveTextContent("已是最新");
    expect(codexSummary).not.toHaveTextContent("可更新");
    expect(within(codexRow).queryByText("npm: @openai/codex")).not.toBeInTheDocument();
    expect(within(codexRow).queryByRole("button", { name: "添加渠道" })).not.toBeInTheDocument();
    expect(within(codexRow).queryByRole("button", { name: "更新" })).not.toBeInTheDocument();

    const ghRow = screen.getByText("GitHub CLI").closest("details") as HTMLElement;
    const ghSummary = within(ghRow).getByText("GitHub CLI").closest("summary") as HTMLElement;
    expect(ghSummary).toHaveTextContent("不可用");

    const nodeRow = screen.getByText("Node.js").closest("details") as HTMLElement;
    const nodeSummary = within(nodeRow).getByText("Node.js").closest("summary") as HTMLElement;
    expect(nodeSummary).not.toHaveTextContent("未发现");

    const customPanel = screen.getByRole("region", { name: "CliHub 自定义 CLI" });
    fireEvent.click(within(customPanel).getByText("添加自定义 CLI"));
    fireEvent.change(within(customPanel).getByLabelText("本地可执行文件路径"), { target: { value: "C:\\Tools\\internal.exe" } });
    fireEvent.click(within(customPanel).getByRole("button", { name: "添加本地 CLI" }));
    await waitFor(() => expect(clientMock.addCliHubLocalPath).toHaveBeenCalledWith("C:\\Tools\\internal.exe", "", ""));

    fireEvent.click(within(codexRow).getByRole("button", { name: "检查更新" }));
    await waitFor(() => expect(clientMock.checkCliHubUpdate).toHaveBeenCalledWith("codex"));
    await waitFor(() => expect(codexSummary).toHaveTextContent("可更新"));
    expect(within(codexRow).getByRole("button", { name: "更新" })).toBeInTheDocument();
    expect(container.querySelector(".toast-notice")).toHaveTextContent("CliHub 检查完成：Codex 可更新");

    fireEvent.click(within(codexRow).getByRole("button", { name: "更新" }));
    await waitFor(() => expect(clientMock.launchCliHubUpdate).toHaveBeenCalledWith("codex"));
    expect(clientMock.updateCliHubCli).not.toHaveBeenCalled();
    await waitFor(() => expect(container.querySelector(".toast-notice")).toHaveTextContent("已打开 CLI 更新终端：npm update -g @openai/codex"));
  });

  it("renders cached CliHub rows while the first discovery refresh is still running", async () => {
    let resolveRefresh: ((value: CliHubList) => void) | null = null;
    clientMock.clihub.mockResolvedValue(cliHubListFixture());
    clientMock.refreshCliHubDiscovery.mockReturnValue(
      new Promise<CliHubList>((resolve) => {
        resolveRefresh = resolve;
      })
    );

    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "CliHub" }));

    await waitFor(() => expect(clientMock.clihub).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Codex")).toBeInTheDocument();
    expect(clientMock.refreshCliHubDiscovery).toHaveBeenCalledTimes(1);

    resolveRefresh?.(cliHubListFixture("up-to-date"));
    await waitFor(() => expect(screen.getByText("Codex")).toBeInTheDocument());
  });

  it("renders cached PluginHub rows while the first discovery refresh is still running", async () => {
    let resolveRefresh: ((value: PluginHubList) => void) | null = null;
    clientMock.pluginhub.mockResolvedValue(pluginHubListFixture());
    clientMock.refreshPluginHubDiscovery.mockReturnValue(
      new Promise<PluginHubList>((resolve) => {
        resolveRefresh = resolve;
      })
    );

    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "PluginHub" }));

    await waitFor(() => expect(clientMock.pluginhub).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("python-development")).toBeInTheDocument();
    expect(clientMock.refreshPluginHubDiscovery).toHaveBeenCalledTimes(1);

    resolveRefresh?.(pluginHubListFixture());
    await waitFor(() => expect(screen.getByText("python-development")).toBeInTheDocument());
  });

  it("refreshes a CliHub row after installing a CLI channel", async () => {
    const unavailable = cliHubListFixture();
    unavailable.clis[0] = {
      ...unavailable.clis[0],
      availabilityState: "unavailable",
      resolvedPaths: [],
      version: null,
      versionState: "unknown",
      currentProvider: null
    };
    const installed = cliHubListFixture();
    installed.clis[0] = {
      ...installed.clis[0],
      version: "codex 2.0.0"
    };
    clientMock.refreshCliHubDiscovery.mockResolvedValueOnce(unavailable).mockResolvedValueOnce(installed);
    clientMock.clihub.mockResolvedValue(unavailable);
    clientMock.installCliHubCli.mockResolvedValue(installed.clis[0]);

    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "CliHub" }));
    const codexRow = await screen.findByText("Codex").then((node) => node.closest("details") as HTMLElement);
    const codexSummary = within(codexRow).getByText("Codex").closest("summary") as HTMLElement;
    await waitFor(() => expect(codexSummary).toHaveTextContent("不可用"));

    fireEvent.click(within(codexRow).getByRole("button", { name: "安装" }));

    await waitFor(() => expect(clientMock.installCliHubCli).toHaveBeenCalledWith("codex", "codex:npm"));
    await waitFor(() => expect(clientMock.refreshCliHubDiscovery).toHaveBeenCalledWith("codex"));
    await waitFor(() => expect(codexSummary).toHaveTextContent("codex 2.0.0"));
    expect(codexSummary).not.toHaveTextContent("不可用");
  });

  it("shows CliHub running operations only in the global toast", async () => {
    clientMock.refreshCliHubDiscovery.mockResolvedValue({
      ...cliHubListFixture(),
      operation: {
        kind: "update-check",
        cliId: "claude",
        cliDisplayName: "Claude Code",
        startedAt: "2026-06-01T00:00:00Z"
      }
    });

    const { container } = render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "CliHub" }));

    expect(await screen.findByRole("status")).toHaveTextContent("CliHub 正在检查更新：Claude Code");
    expect(container.querySelector(".toast-notice")).toHaveTextContent("CliHub 正在检查更新：Claude Code");
    expect(container.querySelector(".clihub-page .notice.inline")).not.toBeInTheDocument();
  });

  it("reloads CliHub rows when a terminal update completion event arrives", async () => {
    const listeners = new Map<string, EventListenerOrEventListenerObject>();
    class MockEventSource {
      onerror: ((event: Event) => void) | null = null;

      constructor(readonly url: string) {}

      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        listeners.set(type, listener);
      }

      close() {}
    }
    vi.stubGlobal("EventSource", MockEventSource);
    clientMock.refreshCliHubDiscovery.mockResolvedValue(cliHubListFixture("update-available"));
    clientMock.clihub.mockResolvedValue(cliHubListFixture("up-to-date"));

    try {
      render(<App />);

      await screen.findByText("还没有项目");
      fireEvent.click(screen.getByRole("button", { name: "CliHub" }));
      const codexRow = await screen.findByText("Codex").then((node) => node.closest("details") as HTMLElement);
      const codexSummary = within(codexRow).getByText("Codex").closest("summary") as HTMLElement;
      await waitFor(() => expect(codexSummary).toHaveTextContent("可更新"));
      clientMock.clihub.mockClear();

      const listener = listeners.get("clihub:changed");
      expect(listener).toBeTruthy();
      const event = new Event("clihub:changed");
      if (typeof listener === "function") {
        listener(event);
      } else {
        listener?.handleEvent(event);
      }

      await waitFor(() => expect(clientMock.clihub).toHaveBeenCalledTimes(1));
      await waitFor(() => {
        const currentRow = screen.getByText("Codex").closest("details") as HTMLElement;
        const currentSummary = within(currentRow).getByText("Codex").closest("summary") as HTMLElement;
        expect(currentSummary).not.toHaveTextContent("可更新");
        expect(within(currentRow).queryByRole("button", { name: "更新" })).not.toBeInTheDocument();
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens McpHub from the topbar", async () => {
    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "McpHub" }));

    expect(await screen.findByRole("heading", { name: "McpHub" })).toBeInTheDocument();
    expect(clientMock.mcphub).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("region", { name: "McpHub JSON 导入" })).toBeInTheDocument();
    expect(screen.getByText("context7")).toBeInTheDocument();
    expect(screen.queryByText("还没有 MCP server")).not.toBeInTheDocument();
  });

  it("opens HookHub from the topbar", async () => {
    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "HookHub" }));

    expect(await screen.findByRole("heading", { name: "HookHub" })).toBeInTheDocument();
    expect(clientMock.hookhub).toHaveBeenCalledWith("");
    expect(clientMock.hookhub).toHaveBeenCalledTimes(1);
    const operations = screen.getByRole("region", { name: "HookHub 操作" });
    expect(within(operations).getByRole("button", { name: "创建 suite" })).toBeInTheDocument();
    expect(within(operations).getByRole("button", { name: "导入 suite JSON" })).toBeInTheDocument();
    expect(within(operations).getByRole("button", { name: "导入原生 hooks" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "HookHub suite 创建" })).not.toBeInTheDocument();
    expect(screen.getByText("提交前检查")).toBeInTheDocument();

    const suiteList = screen.getByRole("region", { name: "HookHub suite 列表" });
    const suiteCard = within(suiteList).getByText("提交前检查").closest(".hookhub-suite-card") as HTMLElement;
    fireEvent.click(within(suiteCard).getByRole("button", { name: "导出" }));
    await waitFor(() => expect(clientMock.exportHookHubSuite).toHaveBeenCalledWith("suite-1"));
    expect(await screen.findByRole("dialog", { name: "提交前检查 导出 JSON" })).toBeInTheDocument();
  });

  it("creates a HookHub suite from JSON input", async () => {
    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "HookHub" }));

    const operations = await screen.findByRole("region", { name: "HookHub 操作" });
    fireEvent.click(within(operations).getByRole("button", { name: "创建 suite" }));

    const dialog = await screen.findByRole("dialog", { name: "创建 HookHub suite" });
    fireEvent.click(within(dialog).getByRole("button", { name: "JSON" }));
    fireEvent.change(within(dialog).getByLabelText("suite JSON"), {
      target: {
        value: '{"name":"JSON suite","requiredEnv":["CI_TOKEN"],"payloads":{"claude":{"PreToolUse":[]}}}'
      }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建 suite" }));

    await waitFor(() =>
      expect(clientMock.createHookHubSuite).toHaveBeenCalledWith({
        name: "JSON suite",
        description: null,
        riskNotes: null,
        requiredEnv: ["CI_TOKEN"],
        payloads: { claude: { PreToolUse: [] } }
      })
    );
  });

  it("creates a HookHub suite from structured tool and hook selections", async () => {
    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "HookHub" }));

    const operations = await screen.findByRole("region", { name: "HookHub 操作" });
    fireEvent.click(within(operations).getByRole("button", { name: "创建 suite" }));

    const dialog = await screen.findByRole("dialog", { name: "创建 HookHub suite" });
    expect(within(dialog).getByLabelText("工具")).toHaveValue("claude");
    expect(within(dialog).getByLabelText("可配置 hook")).toHaveValue("PreToolUse");
    expect(within(dialog).getByText("工具调用前 PreToolUse")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("工具"), { target: { value: "qwen" } });
    expect(within(dialog).getByLabelText("可配置 hook")).toHaveValue("pre");
    expect(within(dialog).queryByText("工具调用前 PreToolUse")).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("suite name"), { target: { value: "Qwen multi check" } });
    fireEvent.change(within(dialog).getByLabelText("可配置 hook"), { target: { value: "post" } });
    fireEvent.change(within(dialog).getByLabelText("命令"), { target: { value: "npm test" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加 hook" }));

    const hookSelectors = within(dialog).getAllByLabelText("可配置 hook");
    const commandInputs = within(dialog).getAllByLabelText("命令");
    expect(hookSelectors).toHaveLength(2);
    expect(commandInputs).toHaveLength(2);
    expect(hookSelectors[1]).toHaveValue("pre");
    fireEvent.change(commandInputs[1], { target: { value: "npm run lint" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建 suite" }));

    await waitFor(() =>
      expect(clientMock.createHookHubSuite).toHaveBeenCalledWith({
        name: "Qwen multi check",
        description: "",
        riskNotes: "",
        requiredEnv: [],
        payloads: {
          qwen: {
            post: [{ command: "npm test" }],
            pre: [{ command: "npm run lint" }]
          }
        }
      })
    );
  });

  it("separates SkillHub import/search and groups skills by source", async () => {
    const localSource = skillHubSourceFixture("source-local", "local-source", "local");
    const githubSource = skillHubSourceFixture("source-github", "owner/repo", "github");
    const pluginSource = skillHubSourceFixture("source-plugin", "team-plugin", "plugin");
    clientMock.skillhub.mockResolvedValue({
      config: { rootDir: "C:\\tmp\\local-ai-workbench\\skillhub", libraryDir: "C:\\tmp\\local-ai-workbench\\skillhub\\library" },
      sources: [localSource, githubSource, pluginSource],
      skills: [
        skillHubSkillFixture(localSource, "skill-1", "review", "Review code"),
        skillHubSkillFixture(githubSource, "skill-2", "triage", "Triage issues"),
        skillHubSkillFixture(pluginSource, "skill-3", "plugin-review", "Plugin review")
      ]
    });

    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "SkillHub" }));

    const importPanel = await screen.findByRole("region", { name: "技能导入" });
    expect(within(importPanel).getByLabelText("本地技能路径")).toBeInTheDocument();
    expect(within(importPanel).getByLabelText("GitHub 来源")).toBeInTheDocument();
    expect(within(importPanel).getByRole("button", { name: "导入本地技能" })).toBeInTheDocument();
    expect(within(importPanel).getByRole("button", { name: "导入GitHub技能" })).toBeInTheDocument();
    expect(within(importPanel).queryByLabelText("搜索技能")).not.toBeInTheDocument();

    const searchPanel = screen.getByRole("region", { name: "搜索技能" });
    expect(within(searchPanel).getByLabelText("搜索技能")).toBeInTheDocument();

    const sourceList = screen.getByRole("region", { name: "技能来源" });
    expect(within(sourceList).getByText("local-source")).toBeInTheDocument();
    expect(within(sourceList).getByText("owner/repo")).toBeInTheDocument();
    expect(within(sourceList).getByText("team-plugin")).toBeInTheDocument();

    const sourceDetails = sourceList.querySelector("details.skillhub-source-group") as HTMLDetailsElement;
    expect(sourceDetails.open).toBe(false);
    fireEvent.click(within(sourceDetails).getByText("local-source"));
    expect(sourceDetails.open).toBe(true);

    const skillDetails = sourceDetails.querySelector("details.skillhub-skill-row") as HTMLDetailsElement;
    expect(skillDetails.open).toBe(false);
    fireEvent.click(within(skillDetails).getByText("review"));
    expect(skillDetails.open).toBe(true);
    expect(within(skillDetails).getByText("Review code")).toBeVisible();

    fireEvent.click(within(skillDetails).getByRole("button", { name: "打开" }));
    await waitFor(() => expect(clientMock.openSkillHubSkill).toHaveBeenCalledWith("skill-1", "document"));

    fireEvent.click(within(skillDetails).getByRole("button", { name: "目录" }));
    await waitFor(() => expect(clientMock.openSkillHubSkill).toHaveBeenCalledWith("skill-1", "folder"));
    expect(within(skillDetails).getByRole("button", { name: "删除" })).toBeInTheDocument();

    const pluginSourceDetails = within(sourceList).getByText("team-plugin").closest("details") as HTMLDetailsElement;
    fireEvent.click(within(pluginSourceDetails).getByText("team-plugin"));
    const pluginSkillDetails = within(pluginSourceDetails).getByText("plugin-review").closest("details") as HTMLDetailsElement;
    fireEvent.click(within(pluginSkillDetails).getByText("plugin-review"));
    expect(within(pluginSkillDetails).getByRole("button", { name: "打开" })).toBeInTheDocument();
    expect(within(pluginSkillDetails).getByRole("button", { name: "目录" })).toBeInTheDocument();
    expect(within(pluginSkillDetails).queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });

  it("moves SkillHub update checks into the topbar and shows source-level update previews", async () => {
    const githubSource = skillHubSourceFixture("source-github", "owner/repo", "github");
    const updatePreview = skillHubUpdatePreviewFixture(githubSource);
    clientMock.skillhub.mockResolvedValue({
      config: { rootDir: "C:\\tmp\\local-ai-workbench\\skillhub", libraryDir: "C:\\tmp\\local-ai-workbench\\skillhub\\library" },
      sources: [githubSource],
      skills: [skillHubSkillFixture(githubSource, "skill-2", "triage", "Triage issues")]
    });
    clientMock.checkSkillHubUpdates.mockResolvedValue({ previews: [updatePreview] });
    clientMock.applySkillHubUpdate.mockResolvedValue(updatePreview);
    const { container } = render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "SkillHub" }));

    await screen.findByRole("heading", { name: "SkillHub" });
    const topbarActions = container.querySelector(".topbar-actions") as HTMLElement;
    expect(within(topbarActions).queryByRole("button", { name: "刷新索引" })).not.toBeInTheDocument();
    const checkButton = within(topbarActions).getByRole("button", { name: "检查更新" });
    const settingsButton = within(topbarActions).getByRole("button", { name: "设置" });
    expect(checkButton.compareDocumentPosition(settingsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(checkButton);

    await waitFor(() => expect(clientMock.checkSkillHubUpdates).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "SkillHub 更新" })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "更新" }));
    const dialog = await screen.findByRole("dialog", { name: "owner/repo 更新预览" });
    expect(within(dialog).getByText("triage")).toBeInTheDocument();
    expect(within(dialog).getByText("变更")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "应用更新" }));

    await waitFor(() => expect(clientMock.applySkillHubUpdate).toHaveBeenCalledWith("source-github", false));
  });

  it("shows child-count markers for cached projects", () => {
    const projects: Project[] = [
      {
        id: "project-1",
        rootPath: "E:\\repo",
        normalizedRootPath: "e:\\repo",
        includeSubdirectories: true,
        sessionOnly: true,
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z",
        childGroupCount: 2,
        sessionCount: 5
      }
    ];

    render(
      <HomePage
        projects={projects}
        busy={false}
        scanResult={null}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onAddScanCandidate={vi.fn()}
        onCloseScanResults={vi.fn()}
      />
    );

    expect(screen.getByText("2 个子目录")).toBeInTheDocument();
    expect(screen.getByText("仅会话")).toBeInTheDocument();
    expect(screen.getByText("5 个会话")).toBeInTheDocument();
    expect(screen.queryByText("仅根目录")).not.toBeInTheDocument();
    expect(screen.queryByText("包含子目录")).not.toBeInTheDocument();
  });

  it("shows scan progress before the scan request resolves", async () => {
    let resolveScan: (value: { scanRunId: string; candidates: [] }) => void = () => {};
    clientMock.startScan.mockReturnValue(
      new Promise((resolve) => {
        resolveScan = resolve;
      })
    );

    const { container } = render(<App />);

    await screen.findByText("还没有项目");
    await waitFor(() => expect(screen.getByRole("button", { name: "扫描" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "扫描" }));

    expect(await screen.findByRole("status")).toHaveTextContent("正在扫描：E:\\");
    expect(container.querySelector(".toast-notice")).toHaveTextContent("正在扫描：E:\\");
    expect(container.querySelector(".inline-status")).not.toBeInTheDocument();

    resolveScan({ scanRunId: "scan-1", candidates: [] });
    expect(await screen.findByText("扫描完成：未发现候选")).toBeInTheDocument();
  });

  it("opens settings instead of showing the working directory in the topbar", async () => {
    clientMock.pickDirectory.mockResolvedValueOnce({ path: "C:\\tmp\\local-ai-workbench-next", cancelled: false });
    render(<App />);

    await screen.findByText("还没有项目");
    expect(screen.queryByText("C:\\tmp\\local-ai-workbench")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    const dialog = screen.getByRole("dialog", { name: "应用设置" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("当前工作目录")).toBeInTheDocument();
    expect(screen.getAllByText("C:\\tmp\\local-ai-workbench").length).toBeGreaterThan(0);

    expect(within(dialog).queryByText("设置")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("新的工作目录")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "保存工作目录" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "更换工作目录" }));

    await waitFor(() => expect(clientMock.setDataDir).toHaveBeenCalledWith("C:\\tmp\\local-ai-workbench-next"));
    expect(await screen.findByText("工作目录已更新")).toBeInTheDocument();
  });

  it("updates the terminal window mode from settings", async () => {
    clientMock.config.mockResolvedValue(appConfigFixture("new-window"));
    clientMock.updateConfig.mockResolvedValue(appConfigFixture("per-project"));

    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    const dialog = screen.getByRole("dialog", { name: "应用设置" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "同项目一个窗口" }));

    expect(clientMock.updateConfig).toHaveBeenCalledWith({ terminal: { mode: "per-project" } });
    expect(await screen.findByText("窗口打开方式已更新")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "保存窗口方式" })).not.toBeInTheDocument();
  });

  it("does not show the legacy agents CLI settings", async () => {
    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    const dialog = screen.getByRole("dialog", { name: "应用设置" });
    expect(within(dialog).queryByText("多 agents 同步")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("当前 agents CLI 目录")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "前往下载" })).not.toBeInTheDocument();
  });

  it("opens a folder picker before adding a project", async () => {
    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByText("选择文件夹"));

    expect(clientMock.pickDirectory).toHaveBeenCalled();
    expect(await screen.findByText("项目已添加")).toBeInTheDocument();
    expect(clientMock.addProject).toHaveBeenCalledWith("E:\\picked");
  });

  it("creates a project from the new project dialog", async () => {
    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));

    const dialog = screen.getByRole("dialog", { name: "新建项目" });
    expect(within(dialog).getByLabelText("项目名称")).toBeInTheDocument();
    expect(within(dialog).getByText("父级目录")).toBeInTheDocument();
    expect(within(dialog).getByText("创建位置")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "创建项目" })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("项目名称"), { target: { value: "demo-project" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "选择目录" }));

    await waitFor(() => expect(clientMock.pickDirectory).toHaveBeenCalled());
    expect(within(dialog).getByText("E:\\picked\\demo-project")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "创建项目" }));

    await waitFor(() => expect(clientMock.createDirectory).toHaveBeenCalledWith("E:\\picked", "demo-project"));
    expect(clientMock.addProject).toHaveBeenCalledWith("E:\\picked\\demo-project");
    expect(await screen.findByText("项目已创建并添加")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "新建项目" })).not.toBeInTheDocument();
  });

  it("only offers installed CLI tools when creating a project", async () => {
    clientMock.tools.mockResolvedValue([
      toolStatusFixture("codex"),
      {
        ...toolStatusFixture("qwen"),
        available: false,
        reason: "未找到命令：qwen"
      }
    ]);

    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));

    const dialog = screen.getByRole("dialog", { name: "新建项目" });
    expect(within(dialog).getAllByText("codex").length).toBeGreaterThan(0);
    expect(within(dialog).queryAllByText("qwen")).toHaveLength(0);
  });

  it("leaves CLI tools unselected by default when creating a project", async () => {
    clientMock.tools.mockResolvedValue([
      toolStatusFixture("codex"),
      {
        ...toolStatusFixture("opencode"),
        command: "C:\\Users\\brand\\AppData\\Roaming\\npm\\opencode.cmd --very-long-command-preview"
      }
    ]);

    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));

    const dialog = screen.getByRole("dialog", { name: "新建项目" });
    const toolList = within(dialog).getByRole("group", { name: "项目工具 CLI" });
    expect(toolList).toHaveClass("new-project-tool-list");
    expect(within(toolList).getByRole("checkbox", { name: /codex/i })).not.toBeChecked();
    expect(within(toolList).getByRole("checkbox", { name: /opencode/i })).not.toBeChecked();

    fireEvent.change(within(dialog).getByLabelText("项目名称"), { target: { value: "demo-project" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "选择目录" }));

    await waitFor(() => expect(clientMock.pickDirectory).toHaveBeenCalled());
    fireEvent.click(within(dialog).getByRole("button", { name: "创建项目" }));

    await waitFor(() => expect(clientMock.createDirectory).toHaveBeenCalledWith("E:\\picked", "demo-project"));
    expect(clientMock.addProject.mock.calls.at(-1)).toEqual(["E:\\picked\\demo-project"]);
  });

  it("scans the selected drive without confirming candidates", async () => {
    clientMock.drives.mockResolvedValue([
      { root: "E:\\", label: "E:\\" },
      { root: "D:\\", label: "D:\\" }
    ]);

    render(<App />);

    await screen.findByText("还没有项目");

    fireEvent.change(screen.getByLabelText("扫描磁盘"), { target: { value: "D:\\" } });
    fireEvent.click(screen.getByText("扫描"));

    expect(clientMock.startScan).toHaveBeenCalledWith(["D:\\"], "drive");
    expect(await screen.findByText("扫描完成：未发现候选")).toBeInTheDocument();
  });

  it("shows scanned candidates in a dialog and adds only the chosen project", async () => {
    const candidate = candidateFixture("E:\\workspace\\repo");
    clientMock.startScan.mockResolvedValue({ scanRunId: "scan-1", candidates: [candidate] });
    clientMock.confirmCandidates.mockResolvedValue([projectFixture(candidate.path)]);

    render(<App />);

    await screen.findByText("还没有项目");
    await waitFor(() => expect(screen.getByRole("button", { name: "扫描" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "扫描" }));

    expect(await screen.findByRole("dialog", { name: "发现的项目" })).toBeInTheDocument();
    expect(clientMock.startScan).toHaveBeenCalledWith(["E:\\"], "drive");
    expect(clientMock.confirmCandidates).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    expect(clientMock.confirmCandidates).toHaveBeenCalledWith("scan-1", [candidate.id], true);
    expect(await screen.findByText("项目已添加")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已添加" })).toBeDisabled();
  });

  it("does not show relocation controls on the home page", () => {
    render(
      <HomePage
        projects={[]}
        busy={false}
        scanResult={null}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onAddScanCandidate={vi.fn()}
        onCloseScanResults={vi.fn()}
      />
    );

    expect(screen.queryByText("当前项目根目录")).not.toBeInTheDocument();
    expect(screen.queryByText("预览迁移")).not.toBeInTheDocument();
  });

  it("starts project relocation from project detail through a folder picker action", () => {
    const onRelocateProject = vi.fn();
    const project = projectFixture("E:\\old");

    render(
      <ProjectDetailView
        project={project}
        detail={detailFixture(project)}
        tools={[]}
        query=""
        warnings={[]}
        busy={false}
        setQuery={vi.fn()}
        onLaunch={vi.fn()}
        onResume={vi.fn()}
        onDeleteSession={vi.fn()}
        repairCandidates={[]}
        onRepairProject={vi.fn()}
        onRelocateProject={onRelocateProject}
      />
    );

    expect(screen.getByText("当前项目根目录")).toBeInTheDocument();
    expect(screen.getAllByText("E:\\old").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("新项目根目录")).not.toBeInTheDocument();
    expect(screen.queryByText("预览迁移")).not.toBeInTheDocument();
    expect(screen.queryByText("确认码")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "选择新位置并迁移" }));
    expect(onRelocateProject).toHaveBeenCalled();
  });

  it("renders project tool targets above the detail filters as compact checkboxes", () => {
    const project = projectFixture("E:\\old");
    const onUpdateProjectTools = vi.fn();
    const onRefreshRuleSync = vi.fn();
    const onApplyRuleSync = vi.fn();

    render(
      <ProjectDetailView
        project={project}
        detail={detailFixture(project)}
        tools={[]}
        projectToolTargets={[
          projectToolTargetFixture(project, "codex", true),
          projectToolTargetFixture(project, "opencode", false)
        ]}
        query=""
        warnings={[]}
        busy={false}
        setQuery={vi.fn()}
        onLaunch={vi.fn()}
        onResume={vi.fn()}
        onDeleteSession={vi.fn()}
        repairCandidates={[]}
        onRepairProject={vi.fn()}
        onRelocateProject={vi.fn()}
        onUpdateProjectTools={onUpdateProjectTools}
        ruleSyncStatus={ruleSyncStatusFixture(project)}
        onRefreshRuleSync={onRefreshRuleSync}
        onApplyRuleSync={onApplyRuleSync}
      />
    );

    const targetSection = screen.getByRole("region", { name: "项目使用工具" });
    expect(within(targetSection).getByText("项目使用工具")).toBeInTheDocument();
    expect(screen.queryByText("目标工具")).not.toBeInTheDocument();

    fireEvent.click(within(targetSection).getByRole("checkbox", { name: "opencode" }));
    expect(onUpdateProjectTools).toHaveBeenCalledWith(["codex", "opencode"]);

    const ruleSyncSection = screen.getByRole("region", { name: "规则同步" });
    expect(ruleSyncSection.compareDocumentPosition(targetSection) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    const agentsRow = within(ruleSyncSection).getByRole("article", { name: "AGENTS.md 规则文件" });
    const claudeRow = within(ruleSyncSection).getByRole("article", { name: "CLAUDE.md 规则文件" });
    expect(within(agentsRow).getByText("AGENTS.md")).toBeInTheDocument();
    expect(within(claudeRow).getByText("CLAUDE.md")).toBeInTheDocument();
    expect(within(ruleSyncSection).getAllByText("文件存在")).toHaveLength(2);
    expect(within(ruleSyncSection).getAllByText("无未提交内容")).toHaveLength(2);
    expect(within(agentsRow).getByText(/2026/)).toBeInTheDocument();
    expect(within(ruleSyncSection).queryByText(project.rootPath)).not.toBeInTheDocument();

    fireEvent.click(within(ruleSyncSection).getByRole("button", { name: "刷新规则" }));
    expect(onRefreshRuleSync).toHaveBeenCalled();

    fireEvent.click(within(claudeRow).getByRole("button", { name: "同步" }));
    expect(onApplyRuleSync).toHaveBeenCalledWith("agents-to-claude");
  });

  it("only shows installed CLI tools in project configuration", () => {
    const project = projectFixture("E:\\old");

    render(
      <ProjectDetailView
        project={project}
        detail={detailFixture(project)}
        tools={[
          toolStatusFixture("codex"),
          {
            ...toolStatusFixture("qwen"),
            available: false,
            reason: "未找到命令：qwen"
          }
        ]}
        projectToolTargets={[
          projectToolTargetFixture(project, "codex", true),
          projectToolTargetFixture(project, "qwen", true)
        ]}
        query=""
        warnings={[]}
        busy={false}
        setQuery={vi.fn()}
        onLaunch={vi.fn()}
        onResume={vi.fn()}
        onDeleteSession={vi.fn()}
        repairCandidates={[]}
        onRepairProject={vi.fn()}
        onRelocateProject={vi.fn()}
      />
    );

    const targetSection = screen.getByRole("region", { name: "项目使用工具" });
    expect(within(targetSection).getByRole("checkbox", { name: "codex" })).toBeInTheDocument();
    expect(within(targetSection).queryByRole("checkbox", { name: "qwen" })).not.toBeInTheDocument();
  });

  it("hides unavailable CLI tools from the new session picker", () => {
    const project = projectFixture("E:\\old");
    const onLaunch = vi.fn();

    render(
      <ProjectDetailView
        project={project}
        detail={detailFixture(project)}
        tools={[
          toolStatusFixture("codex"),
          {
            ...toolStatusFixture("qwen"),
            available: false,
            reason: "未找到命令：qwen"
          }
        ]}
        projectToolTargets={[projectToolTargetFixture(project, "codex", true), projectToolTargetFixture(project, "qwen", true)]}
        query=""
        warnings={[]}
        busy={false}
        setQuery={vi.fn()}
        onLaunch={onLaunch}
        onResume={vi.fn()}
        onDeleteSession={vi.fn()}
        repairCandidates={[]}
        onRepairProject={vi.fn()}
        onRelocateProject={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "新会话" }));
    expect(screen.getByRole("button", { name: "codex" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "qwen" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "codex" }));
    expect(onLaunch).toHaveBeenCalledWith("codex", project.rootPath);
  });

  it("only shows project enabled tools in the new session picker", () => {
    const project = projectFixture("E:\\old");
    const onLaunch = vi.fn();

    render(
      <ProjectDetailView
        project={project}
        detail={detailFixture(project)}
        tools={[toolStatusFixture("codex"), toolStatusFixture("qwen")]}
        projectToolTargets={[
          projectToolTargetFixture(project, "codex", true),
          projectToolTargetFixture(project, "qwen", false)
        ]}
        query=""
        warnings={[]}
        busy={false}
        setQuery={vi.fn()}
        onLaunch={onLaunch}
        onResume={vi.fn()}
        onDeleteSession={vi.fn()}
        repairCandidates={[]}
        onRepairProject={vi.fn()}
        onRelocateProject={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "新会话" }));
    expect(screen.getByRole("button", { name: "codex" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "qwen" })).not.toBeInTheDocument();
  });

  it("keeps project tool target editing out of the skill panel and only shows enabled tools inside a skill", async () => {
    const project = projectFixture("E:\\old");
    const localSource = skillHubSourceFixture("source-1", "local-source", "local");
    const toolTargets = [
      projectToolTargetFixture(project, "codex", true),
      projectToolTargetFixture(project, "opencode", true),
      projectToolTargetFixture(project, "qwen", false)
    ];
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));
    clientMock.projectToolTargets.mockResolvedValue(toolTargets);
    clientMock.projectSkillTargets.mockResolvedValue({
      projectId: project.id,
      toolTargets,
      skillTargets: [
        {
          projectId: project.id,
          toolId: "codex",
          skillId: "skill-1",
          linkPath: `${project.rootPath}\\.codex\\skills\\review`,
          targetPath: "C:\\tmp\\local-ai-workbench\\skillhub\\library\\review",
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z"
        }
      ],
      skills: [
        {
          id: "skill-1",
          sourceId: "source-1",
          sourceType: "local",
          folderName: "review",
          skillName: "Review",
          description: "Review code",
          libraryRelativePath: "local/review",
          libraryPath: "C:\\tmp\\local-ai-workbench\\skillhub\\library\\local\\review",
          sourceRelativePath: "review",
          contentHash: "hash",
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z",
          source: localSource
        }
      ]
    });

    render(<App />);

    await screen.findByText("old");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByText("当前项目根目录");
    fireEvent.click(screen.getByRole("button", { name: "技能" }));

    const panel = await screen.findByRole("complementary", { name: "项目技能管理" });
    expect(within(panel).queryByText("目标工具")).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("tab", { name: "SkillHub技能" }));
    await within(panel).findByText("local-source");

    const sourceDetails = panel.querySelector("details.project-skill-source-group") as HTMLDetailsElement;
    expect(sourceDetails).not.toBeNull();
    expect(within(sourceDetails).getByText("local-source")).toBeInTheDocument();
    expect(within(sourceDetails).getByText("1 个技能")).toBeInTheDocument();
    expect(within(sourceDetails).queryByText("local/review")).not.toBeInTheDocument();
    fireEvent.click(sourceDetails.querySelector("summary") as HTMLElement);

    const skillSummary = sourceDetails.querySelector("details.skill-target-row summary") as HTMLElement;
    fireEvent.click(skillSummary);

    expect(within(panel).getByRole("checkbox", { name: "codex" })).toBeInTheDocument();
    expect(within(panel).getByRole("checkbox", { name: "opencode" })).toBeInTheDocument();
    expect(within(panel).queryByRole("checkbox", { name: "qwen" })).not.toBeInTheDocument();
  });

  it("opens the project local skill panel and lets a local skill use an existing SkillHub link", async () => {
    const project = projectFixture("E:\\old");
    const source = skillHubSourceFixture("source-1", "skills", "local");
    const existingSkill = skillHubSkillFixture(source, "skill-1", "review", "SkillHub review");
    const initialLocalSkills: ProjectLocalSkillsState = {
      projectId: project.id,
      toolTargets: [projectToolTargetFixture(project, "codex", true)],
      migrationSources: [source],
      skills: [
        {
          projectId: project.id,
          toolId: "codex",
          type: "skillhub",
          folderName: "triage",
          skillName: "Triage",
          description: "SkillHub triage",
          skillPath: `${project.rootPath}\\.codex\\skills\\triage`,
          skillHubSkill: skillHubSkillFixture(source, "skill-2", "triage", "SkillHub triage"),
          migratable: false,
          reason: null
        },
        {
          projectId: project.id,
          toolId: "codex",
          type: "local",
          folderName: "review",
          skillName: "Review",
          description: "Local review",
          skillPath: `${project.rootPath}\\.codex\\skills\\review`,
          skillHubSkill: null,
          migratable: true,
          reason: null
        }
      ]
    };
    const migratedLocalSkills: ProjectLocalSkillsState = {
      ...initialLocalSkills,
      skills: [
        initialLocalSkills.skills[0],
        {
          ...initialLocalSkills.skills[1],
          type: "skillhub",
          description: "SkillHub review",
          skillHubSkill: existingSkill,
          migratable: false
        }
      ]
    };
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));
    clientMock.projectToolTargets.mockResolvedValue([projectToolTargetFixture(project, "codex", true)]);
    clientMock.projectLocalSkills.mockResolvedValueOnce(initialLocalSkills).mockResolvedValueOnce(migratedLocalSkills);
    clientMock.migrateProjectLocalSkill
      .mockResolvedValueOnce({
        projectId: project.id,
        localSkill: initialLocalSkills.skills[1],
        skill: null,
        linkedTarget: null,
        conflictSkills: [existingSkill],
        requiresConfirmation: true,
        action: "needs-confirmation"
      })
      .mockResolvedValueOnce({
        projectId: project.id,
        localSkill: initialLocalSkills.skills[1],
        skill: existingSkill,
        linkedTarget: null,
        conflictSkills: [existingSkill],
        requiresConfirmation: false,
        action: "linked-existing"
      });
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("2");

    render(<App />);

    await screen.findByText("old");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByText("当前项目根目录");
    expect(screen.getByRole("button", { name: "技能" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "技能" }));

    const panel = await screen.findByRole("complementary", { name: "项目技能管理" });
    fireEvent.click(within(panel).getByRole("tab", { name: "本地技能" }));
    expect(within(panel).getByRole("region", { name: "SkillHub 技能" })).toBeInTheDocument();
    const localSection = within(panel).getByRole("region", { name: "Local 技能" });
    expect(localSection).toBeInTheDocument();
    fireEvent.click(within(localSection).getByRole("button", { name: "迁移到SkillHub" }));
    const startButton = within(localSection).getByRole("button", { name: "开始迁移" });
    expect(startButton).toBeDisabled();
    fireEvent.click(within(localSection).getByRole("checkbox", { name: "选择 review" }));
    expect(startButton).not.toBeDisabled();
    fireEvent.click(startButton);

    const dialog = await screen.findByRole("dialog", { name: "迁移技能" });
    fireEvent.change(within(dialog).getByLabelText("迁移目录"), { target: { value: source.id } });
    fireEvent.click(within(dialog).getByRole("button", { name: "开始迁移" }));

    await waitFor(() => expect(prompt).toHaveBeenCalled());
    await waitFor(() =>
      expect(clientMock.migrateProjectLocalSkill).toHaveBeenLastCalledWith(project.id, "codex", "review", "link-existing", project.rootPath, {
        type: "existing-source",
        sourceId: source.id
      })
    );
    expect(await screen.findByText("本地技能已换成 SkillHub link")).toBeInTheDocument();
  });

  it("opens project skills on local data only and can cancel a SkillHub skill from the local tab", async () => {
    const project = projectFixture("E:\\old");
    const source = skillHubSourceFixture("source-1", "skills", "local");
    const skill = skillHubSkillFixture(source, "skill-1", "triage", "SkillHub triage");
    const initialLocalSkills: ProjectLocalSkillsState = {
      projectId: project.id,
      toolTargets: [projectToolTargetFixture(project, "codex", true)],
      migrationSources: [source],
      skills: [
        {
          projectId: project.id,
          toolId: "codex",
          type: "skillhub",
          folderName: "triage",
          skillName: "Triage",
          description: "SkillHub triage",
          skillPath: `${project.rootPath}\\.codex\\skills\\triage`,
          skillHubSkill: skill,
          pluginBinding: null,
          plugin: null,
          migratable: false,
          reason: null
        }
      ]
    };
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));
    clientMock.projectToolTargets.mockResolvedValue([projectToolTargetFixture(project, "codex", true)]);
    clientMock.projectLocalSkills.mockResolvedValueOnce(initialLocalSkills).mockResolvedValueOnce({ ...initialLocalSkills, skills: [] });
    clientMock.updateProjectSkillTargets.mockResolvedValue({
      projectId: project.id,
      skillId: skill.id,
      targets: [],
      removed: [],
      conflicts: [],
      failures: [],
      requiresConfirmation: false
    });

    render(<App />);

    await screen.findByText("old");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByText("当前项目根目录");
    fireEvent.click(screen.getByRole("button", { name: "技能" }));

    const panel = await screen.findByRole("complementary", { name: "项目技能管理" });
    const skillHubSection = within(panel).getByRole("region", { name: "SkillHub 技能" });
    expect(await within(skillHubSection).findByText("triage")).toBeInTheDocument();
    expect(clientMock.projectSkillTargets).not.toHaveBeenCalled();

    fireEvent.click(within(skillHubSection).getByRole("checkbox", { name: "取消 triage" }));

    await waitFor(() => expect(clientMock.updateProjectSkillTargets).toHaveBeenCalledWith(project.id, skill.id, [], false, project.rootPath));
    expect(await within(panel).findByText("没有发现项目技能")).toBeInTheDocument();
    expect(clientMock.projectSkillTargets).not.toHaveBeenCalled();
  });

  it("opens the project Plugin panel and installs a complete plugin", async () => {
    const project = projectFixture("E:\\old");
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));
    clientMock.projectPlugins.mockResolvedValue(projectPluginStateFixture(project));

    render(<App />);

    await screen.findByText("old");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByText("当前项目根目录");
    fireEvent.click(screen.getByRole("button", { name: "Plugin" }));

    const panel = await screen.findByRole("complementary", { name: "项目 Plugin 管理" });
    expect(clientMock.projectPlugins).toHaveBeenCalledWith(project.id, project.rootPath);
    expect(within(panel).getByRole("region", { name: "安装 Plugin" })).toBeInTheDocument();
    expect(within(panel).getByRole("region", { name: "已安装 Plugin" })).toBeInTheDocument();
    expect(within(panel).getAllByText("python-development").length).toBeGreaterThan(0);
    expect(within(panel).getByRole("radio", { name: "codex" })).toBeChecked();
    expect(within(panel).queryByRole("radio", { name: "qwen" })).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "安装" }));

    await waitFor(() => expect(clientMock.installProjectPlugin).toHaveBeenCalledWith(project.id, "plugin-1", "codex", project.rootPath, null));
    expect(await screen.findByText("项目 Plugin 已安装")).toBeInTheDocument();
  });

  it("shows plugin-owned skills as readonly and groups them in the local Plugin section", async () => {
    const project = projectFixture("E:\\old");
    const source = skillHubSourceFixture("source-local", "local-source", "local");
    const skill = skillHubSkillFixture(source, "skill-1", "review", "Review code");
    const pluginState = projectPluginStateFixture(project);
    const pluginBinding = pluginState.bindings[0];
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));
    clientMock.projectSkillTargets.mockResolvedValue({
      projectId: project.id,
      toolTargets: [projectToolTargetFixture(project, "codex", true)],
      skillTargets: [
        {
          projectId: project.id,
          toolId: "codex",
          skillId: skill.id,
          linkPath: `${project.rootPath}\\.codex\\skills\\review`,
          targetPath: skill.libraryPath,
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z"
        }
      ],
      skills: [skill]
    });
    clientMock.projectLocalSkills.mockResolvedValue({
      projectId: project.id,
      toolTargets: [projectToolTargetFixture(project, "codex", true)],
      migrationSources: [],
      skills: [
        {
          projectId: project.id,
          toolId: "codex",
          type: "plugin",
          folderName: "review",
          skillName: "review",
          description: "Review code",
          skillPath: `${project.rootPath}\\.codex\\skills\\review`,
          skillHubSkill: skill,
          pluginBinding,
          plugin: pluginBinding.plugin,
          migratable: false,
          reason: "该技能由项目 Plugin 管理，请从 Plugin 入口卸载或同步"
        }
      ]
    } satisfies ProjectLocalSkillsState);

    render(<App />);

    await screen.findByText("old");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByText("当前项目根目录");
    fireEvent.click(screen.getByRole("button", { name: "技能" }));

    const panel = await screen.findByRole("complementary", { name: "项目技能管理" });
    expect(within(panel).queryByRole("tab", { name: "Plugin" })).not.toBeInTheDocument();
    const pluginSection = within(panel).getByRole("region", { name: "Plugin 技能" });
    expect(within(pluginSection).getByText("review")).toBeInTheDocument();
    expect(within(pluginSection).getByText("python-development")).toBeInTheDocument();
    expect(within(pluginSection).getAllByText("Plugin").length).toBeGreaterThan(0);

    fireEvent.click(within(panel).getByRole("tab", { name: "SkillHub技能" }));
    const skillRow = (await within(panel).findByText("review")).closest("details") as HTMLElement;
    expect(within(skillRow).getByText("Plugin managed")).toBeInTheDocument();
    for (const checkbox of within(skillRow).getAllByRole("checkbox")) {
      expect(checkbox).toBeDisabled();
    }
    expect(within(skillRow).getByText("该技能由项目 Plugin 管理，请从 Plugin 入口卸载或同步。")).toBeInTheDocument();
  });

  it("lets a project local skill migrate into a new local source directory", async () => {
    const project = projectFixture("E:\\old");
    const newSource = skillHubSourceFixture("source-new", "team-source", "local");
    const migratedSkill = skillHubSkillFixture(newSource, "skill-new", "review", "Local review");
    const initialLocalSkills: ProjectLocalSkillsState = {
      projectId: project.id,
      toolTargets: [projectToolTargetFixture(project, "codex", true)],
      migrationSources: [],
      skills: [
        {
          projectId: project.id,
          toolId: "codex",
          type: "local",
          folderName: "review",
          skillName: "Review",
          description: "Local review",
          skillPath: `${project.rootPath}\\.codex\\skills\\review`,
          skillHubSkill: null,
          migratable: true,
          reason: null
        }
      ]
    };
    const migratedLocalSkills: ProjectLocalSkillsState = {
      ...initialLocalSkills,
      migrationSources: [newSource],
      skills: [
        {
          ...initialLocalSkills.skills[0],
          type: "skillhub",
          skillHubSkill: migratedSkill,
          migratable: false
        }
      ]
    };
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));
    clientMock.projectToolTargets.mockResolvedValue([projectToolTargetFixture(project, "codex", true)]);
    clientMock.projectLocalSkills.mockResolvedValueOnce(initialLocalSkills).mockResolvedValueOnce(migratedLocalSkills);
    clientMock.pickDirectory.mockResolvedValueOnce({ path: "E:\\SkillSources\\team-source", cancelled: false });
    clientMock.migrateProjectLocalSkill.mockResolvedValueOnce({
      projectId: project.id,
      localSkill: initialLocalSkills.skills[0],
      skill: migratedSkill,
      linkedTarget: null,
      conflictSkills: [],
      requiresConfirmation: false,
      action: "migrated"
    });

    render(<App />);

    await screen.findByText("old");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByText("当前项目根目录");
    fireEvent.click(screen.getByRole("button", { name: "技能" }));

    const panel = await screen.findByRole("complementary", { name: "项目技能管理" });
    fireEvent.click(within(panel).getByRole("tab", { name: "本地技能" }));
    const localSection = within(panel).getByRole("region", { name: "Local 技能" });
    fireEvent.click(within(localSection).getByRole("button", { name: "迁移到SkillHub" }));
    const startButton = within(localSection).getByRole("button", { name: "开始迁移" });
    fireEvent.click(within(localSection).getByRole("checkbox", { name: "选择 review" }));
    expect(startButton).not.toBeDisabled();
    fireEvent.click(startButton);

    const dialog = await screen.findByRole("dialog", { name: "迁移技能" });
    fireEvent.change(within(dialog).getByLabelText("迁移目录"), { target: { value: "__new-local-source__" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "选择目录" }));
    await waitFor(() => expect(within(dialog).getByLabelText("新 source 目录")).toHaveValue("E:\\SkillSources\\team-source"));
    fireEvent.click(within(dialog).getByRole("button", { name: "开始迁移" }));

    await waitFor(() =>
      expect(clientMock.migrateProjectLocalSkill).toHaveBeenLastCalledWith(project.id, "codex", "review", null, project.rootPath, {
        type: "new-source",
        path: "E:\\SkillSources\\team-source"
      })
    );
    expect(await screen.findByText("本地技能已迁移到 SkillHub")).toBeInTheDocument();
  });

  it("clears stale local skill rows while reopening the project skill panel refreshes from disk", async () => {
    const project = projectFixture("E:\\old");
    const initialLocalSkills: ProjectLocalSkillsState = {
      projectId: project.id,
      toolTargets: [projectToolTargetFixture(project, "codex", true)],
      migrationSources: [],
      skills: [
        {
          projectId: project.id,
          toolId: "codex",
          type: "local",
          folderName: "review",
          skillName: "Review",
          description: "Local review",
          skillPath: `${project.rootPath}\\.codex\\skills\\review`,
          skillHubSkill: null,
          migratable: true,
          reason: null
        }
      ]
    };
    const refreshedLocalSkills: ProjectLocalSkillsState = {
      ...initialLocalSkills,
      skills: []
    };
    let resolveRefresh!: (state: ProjectLocalSkillsState) => void;
    const refreshPromise = new Promise<ProjectLocalSkillsState>((resolve) => {
      resolveRefresh = resolve;
    });
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));
    clientMock.projectToolTargets.mockResolvedValue([projectToolTargetFixture(project, "codex", true)]);
    clientMock.projectLocalSkills.mockResolvedValueOnce(initialLocalSkills).mockReturnValueOnce(refreshPromise);

    render(<App />);

    await screen.findByText("old");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByText("当前项目根目录");
    fireEvent.click(screen.getByRole("button", { name: "技能" }));

    const panel = await screen.findByRole("complementary", { name: "项目技能管理" });
    fireEvent.click(within(panel).getByRole("tab", { name: "本地技能" }));
    expect(await within(panel).findByText("review")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "技能" }));

    await waitFor(() => expect(within(panel).getByText("正在读取本地技能...")).toBeInTheDocument());
    expect(within(panel).queryByText("review")).not.toBeInTheDocument();

    resolveRefresh(refreshedLocalSkills);

    expect(await within(panel).findByText("没有发现项目技能")).toBeInTheDocument();
    await waitFor(() => expect(clientMock.projectLocalSkills).toHaveBeenLastCalledWith(project.id, project.rootPath));
  });

  it("opens project skill management for the selected child session group", async () => {
    const project = projectFixture("E:\\repo");
    const childRoot = "E:\\repo\\packages\\app";
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailWithChildGroup(project, childRoot));

    render(<App />);

    await screen.findByText("repo");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    const childHeading = await screen.findByRole("heading", { name: "packages\\app" });
    const childGroup = childHeading.closest(".session-group") as HTMLElement;

    fireEvent.click(within(childGroup).getByRole("button", { name: "技能" }));
    await waitFor(() => expect(clientMock.projectLocalSkills).toHaveBeenLastCalledWith(project.id, childRoot));
    const skillPanel = await screen.findByRole("complementary", { name: "项目技能管理" });
    fireEvent.click(within(skillPanel).getByRole("tab", { name: "SkillHub技能" }));
    await waitFor(() => expect(clientMock.projectSkillTargets).toHaveBeenLastCalledWith(project.id, childRoot));

    fireEvent.click(within(childGroup).getByRole("button", { name: "MCP" }));
    await waitFor(() => expect(clientMock.projectMcp).toHaveBeenLastCalledWith(project.id, childRoot));

    fireEvent.click(within(childGroup).getByRole("button", { name: "Hooks" }));
    await waitFor(() => expect(clientMock.projectHooks).toHaveBeenLastCalledWith(project.id, childRoot));
    const panel = await screen.findByRole("complementary", { name: "项目 Hooks 管理" });
    expect(within(panel).getByText("Claude Code")).toBeInTheDocument();
    expect(within(panel).getByText("current")).toBeInTheDocument();
    expect(within(panel).getByText("OpenCode")).toBeInTheDocument();
  });

  it("opens project Agent panel for a child group and handles apply conflicts and local migration", async () => {
    const project = projectFixture("E:\\repo");
    const childRoot = "E:\\repo\\packages\\app";
    const state = projectAgentStateFixture(project, childRoot);
    const localAgent = state.localAgents[0];
    const conflictResult = projectAgentApplyResultFixture(project, childRoot, { requiresConfirmation: true, conflicts: [localAgent] });
    const appliedResult = projectAgentApplyResultFixture(project, childRoot);
    const migratedResult = projectLocalAgentMigrationResultFixture(project, childRoot);
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailWithChildGroup(project, childRoot));
    clientMock.projectAgents.mockResolvedValue(state);
    clientMock.projectLocalAgents.mockResolvedValue({ ...state, agents: [], targets: [] });
    clientMock.applyProjectAgent.mockResolvedValueOnce(conflictResult).mockResolvedValueOnce(appliedResult);
    clientMock.migrateProjectLocalAgent.mockResolvedValue(migratedResult);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);

    await screen.findByText("repo");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    const childHeading = await screen.findByRole("heading", { name: "packages\\app" });
    const childGroup = childHeading.closest(".session-group") as HTMLElement;
    fireEvent.click(within(childGroup).getByRole("button", { name: "Agent" }));

    const panel = await screen.findByRole("complementary", { name: "项目 Agent 管理" });
    await waitFor(() => expect(clientMock.projectLocalAgents).toHaveBeenLastCalledWith(project.id, childRoot));
    expect(within(panel).getByText(childRoot)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("tab", { name: "AgentHub Agent" }));
    await waitFor(() => expect(clientMock.projectAgents).toHaveBeenLastCalledWith(project.id, childRoot));
    fireEvent.click(within(panel).getByText("agency-agents").closest("summary") as HTMLElement);
    fireEvent.click(within(panel).getByText("Code Reviewer").closest("summary") as HTMLElement);
    expect(within(panel).getByRole("checkbox", { name: /codex/ })).toBeInTheDocument();
    expect(within(panel).queryByRole("checkbox", { name: /qwen/ })).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("checkbox", { name: /codex/ }));

    await waitFor(() => expect(clientMock.applyProjectAgent).toHaveBeenNthCalledWith(1, project.id, "agent-1", "codex", childRoot, null));
    await waitFor(() => expect(clientMock.applyProjectAgent).toHaveBeenNthCalledWith(2, project.id, "agent-1", "codex", childRoot, "migrate-then-overwrite"));
    expect(confirm).toHaveBeenCalledWith("目标路径已有 unmanaged Agent。确定先迁移当前文件再覆盖？取消则仅覆盖前备份。");

    fireEvent.click(within(panel).getByRole("tab", { name: "本地 Agent" }));
    fireEvent.click(within(panel).getByRole("button", { name: "迁移到 AgentHub" }));

    await waitFor(() =>
      expect(clientMock.migrateProjectLocalAgent).toHaveBeenCalledWith(project.id, "codex", localAgent.outputPath, { type: "existing-source", sourceId: "project-local-agents" }, childRoot)
    );
    expect(await screen.findByText("本地 Agent 已迁移到 AgentHub")).toBeInTheDocument();
  });

  it("opens project Agents on local data only and can cancel a managed AgentHub agent from the local tab", async () => {
    const project = projectFixture("E:\\old");
    const state = projectAgentStateFixture(project);
    const binding = projectAgentBindingFixture(project);
    const managedLocalState: ProjectAgentState = {
      ...state,
      agents: [],
      targets: [],
      localAgents: [
        {
          ...projectLocalAgentFixture(project),
          type: "managed",
          outputPath: binding.outputPath,
          slug: binding.agent?.slug ?? "code-reviewer",
          name: binding.agent?.name ?? "Code Reviewer",
          description: binding.agent?.description ?? "Review code",
          status: "current",
          binding,
          agent: binding.agent,
          migratable: false,
          reason: "该文件已由 AgentHub 管理"
        }
      ]
    };
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));
    clientMock.projectToolTargets.mockResolvedValue([projectToolTargetFixture(project, "codex", true)]);
    clientMock.projectLocalAgents.mockResolvedValueOnce(managedLocalState).mockResolvedValueOnce({ ...managedLocalState, localAgents: [] });
    clientMock.disableProjectAgent.mockResolvedValue({ ...projectAgentDisableResultFixture(project), binding, deletedFile: true });

    render(<App />);

    await screen.findByText("old");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByText("当前项目根目录");
    fireEvent.click(screen.getByRole("button", { name: "Agent" }));

    const panel = await screen.findByRole("complementary", { name: "项目 Agent 管理" });
    expect(await within(panel).findByText("Code Reviewer")).toBeInTheDocument();
    expect(clientMock.projectAgents).not.toHaveBeenCalled();

    fireEvent.click(within(panel).getByRole("checkbox", { name: "取消 Code Reviewer" }));

    await waitFor(() => expect(clientMock.disableProjectAgent).toHaveBeenCalledWith(project.id, binding.id, project.rootPath, null));
    expect(await within(panel).findByText("没有发现本地 Agent")).toBeInTheDocument();
    expect(clientMock.projectAgents).not.toHaveBeenCalled();
  });

  it("applies a McpHub server from the project MCP panel", async () => {
    const project = projectFixture("E:\\old");
    const server = {
      serverId: "context7",
      name: "context7",
      description: "Context7 docs",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      url: null,
      headers: {},
      env: {},
      requiredEnv: [],
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z"
    };
    const initialProjectMcp = {
      projectId: project.id,
      targetRootPath: project.rootPath,
      targets: [
        {
          toolId: "claude",
          label: "Claude Code",
          enabled: true,
          inferred: true,
          supported: true,
          configPath: `${project.rootPath}\\.mcp.json`,
          reason: null,
          updatedAt: "2026-06-01T00:00:00Z"
        }
      ],
      servers: [server],
      bindings: [],
      localEntries: []
    };
    const appliedProjectMcp = {
      ...initialProjectMcp,
      bindings: [
        {
          projectId: project.id,
          targetRootPath: project.rootPath,
          toolId: "claude",
          serverId: "context7",
          appliedServerId: "context7",
          appliedAt: "2026-06-01T00:00:00Z",
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z"
        }
      ]
    };
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));
    clientMock.projectMcp.mockResolvedValueOnce(initialProjectMcp).mockResolvedValueOnce(appliedProjectMcp);

    render(<App />);

    await screen.findByText("old");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByText("当前项目根目录");
    fireEvent.click(screen.getByRole("button", { name: "MCP" }));

    const panel = await screen.findByRole("complementary", { name: "项目 MCP 管理" });
    fireEvent.click(within(panel).getByRole("button", { name: "McpHub MCP" }));
    const serverRow = within(panel).getByText("context7").closest("details");
    expect(serverRow).not.toHaveAttribute("open");
    fireEvent.click(within(serverRow as HTMLElement).getByText("context7"));
    expect(serverRow).toHaveAttribute("open");
    fireEvent.click(within(panel).getByRole("checkbox", { name: "claude" }));

    await waitFor(() => expect(clientMock.applyProjectMcp).toHaveBeenCalledWith(project.id, "context7", "claude", project.rootPath));
    expect(await screen.findByText("MCP 已应用到项目")).toBeInTheDocument();
  });

  it("applies a McpHub server to all target tools from the row checkbox", async () => {
    const project = projectFixture("E:\\old");
    const server = {
      serverId: "context7",
      name: "context7",
      description: "Context7 docs",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      url: null,
      headers: {},
      env: {},
      requiredEnv: [],
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z"
    };
    const targets = [
      {
        toolId: "claude",
        label: "Claude Code",
        enabled: true,
        inferred: true,
        supported: true,
        configPath: `${project.rootPath}\\.mcp.json`,
        reason: null,
        updatedAt: "2026-06-01T00:00:00Z"
      },
      {
        toolId: "codex",
        label: "Codex",
        enabled: true,
        inferred: true,
        supported: true,
        configPath: `${project.rootPath}\\.codex\\config.toml`,
        reason: null,
        updatedAt: "2026-06-01T00:00:00Z"
      },
      {
        toolId: "qwen",
        label: "Qwen",
        enabled: true,
        inferred: false,
        supported: false,
        configPath: "",
        reason: "尚未支持",
        updatedAt: "2026-06-01T00:00:00Z"
      }
    ];
    const initialProjectMcp = {
      projectId: project.id,
      targetRootPath: project.rootPath,
      targets,
      servers: [server],
      bindings: [],
      localEntries: []
    };
    const appliedProjectMcp = {
      ...initialProjectMcp,
      bindings: targets.filter((target) => target.supported).map((target) => ({
        projectId: project.id,
        targetRootPath: project.rootPath,
        toolId: target.toolId,
        serverId: "context7",
        appliedServerId: "context7",
        appliedAt: "2026-06-01T00:00:00Z",
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z"
      }))
    };
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));
    clientMock.projectMcp.mockResolvedValueOnce(initialProjectMcp).mockResolvedValueOnce(appliedProjectMcp);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);

    render(<App />);

    await screen.findByText("old");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByText("当前项目根目录");
    fireEvent.click(screen.getByRole("button", { name: "MCP" }));

    const panel = await screen.findByRole("complementary", { name: "项目 MCP 管理" });
    fireEvent.click(within(panel).getByRole("button", { name: "McpHub MCP" }));
    fireEvent.click(within(panel).getByRole("checkbox", { name: "选择 context7 全部工具" }));

    await waitFor(() => expect(clientMock.applyProjectMcp).toHaveBeenCalledTimes(2));
    expect(clientMock.applyProjectMcp).toHaveBeenCalledWith(project.id, "context7", "claude", project.rootPath);
    expect(clientMock.applyProjectMcp).toHaveBeenCalledWith(project.id, "context7", "codex", project.rootPath);
    expect(clientMock.applyProjectMcp).not.toHaveBeenCalledWith(project.id, "context7", "qwen", project.rootPath);
    const qwenCheckbox = within(panel).getByRole("checkbox", { name: "qwen" });
    expect(qwenCheckbox).toBeDisabled();
    fireEvent.click(qwenCheckbox.closest("label") as HTMLElement);
    expect(alertSpy).toHaveBeenCalledWith("尚未支持");
    alertSpy.mockRestore();
    expect(await screen.findByText("MCP 已应用到 2 个工具")).toBeInTheDocument();
  });

  it("shows merge repair candidates for missing cwd projects", () => {
    const onRepairProject = vi.fn();
    const project = projectFixture("E:\\old");
    const candidate: ProjectRepairCandidate = {
      projectId: "project-new",
      rootPath: "E:\\ai-games\\Knight Academy",
      score: 52,
      reasons: ["目标路径存在", "关键词重叠：骑士", "2 个已索引会话"],
      sessionCount: 2
    };

    render(
      <ProjectDetailView
        project={project}
        detail={detailFixture(project)}
        tools={[]}
        query=""
        warnings={[
          {
            id: "warning-1",
            scanRunId: "scan-1",
            toolId: "claude",
            sourceFile: "C:\\Users\\brand\\.claude\\projects\\E--old\\session.jsonl",
            errorType: "missing-cwd",
            message: "Session cwd was missing; resume is disabled",
            line: null,
            createdAt: "2026-06-01T00:00:00Z"
          }
        ]}
        repairCandidates={[candidate]}
        busy={false}
        setQuery={vi.fn()}
        onLaunch={vi.fn()}
        onResume={vi.fn()}
        onDeleteSession={vi.fn()}
        onRepairProject={onRepairProject}
        onRelocateProject={vi.fn()}
      />
    );

    expect(screen.getByRole("region", { name: "修复缺失 cwd" })).toBeInTheDocument();
    expect(screen.getByText("E:\\ai-games\\Knight Academy")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "一键修复" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "合并到此项目" }));
    expect(onRepairProject).toHaveBeenCalledWith("project-new");
  });

  it("shows repair hints when cwd is missing but parser warnings are empty", () => {
    const project = { ...projectFixture("E:\\ai-game-space"), sessionCount: 1 };
    const candidate: ProjectRepairCandidate = {
      projectId: "project-new",
      rootPath: "E:\\new-ai-game-space",
      score: 80,
      reasons: ["目标路径存在", "目录名匹配"],
      sessionCount: 1
    };

    render(
      <ProjectDetailView
        project={project}
        detail={detailWithSession(project)}
        tools={[]}
        query=""
        warnings={[]}
        repairCandidates={[candidate]}
        busy={false}
        setQuery={vi.fn()}
        onLaunch={vi.fn()}
        onResume={vi.fn()}
        onDeleteSession={vi.fn()}
        onRepairProject={vi.fn()}
        onRelocateProject={vi.fn()}
      />
    );

    expect(screen.getByRole("region", { name: "修复缺失 cwd" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "修复提示" })).toBeInTheDocument();
    expect(screen.getByText("历史 cwd 不存在：E:\\ai-game-space")).toBeInTheDocument();
  });

  it("offers a repair-and-resume action for Qwen source path mismatches", () => {
    const project = { ...projectFixture("E:\\ai-working-space\\old-project"), sessionCount: 1 };
    const onResume = vi.fn();

    render(
      <ProjectDetailView
        project={project}
        detail={detailWithQwenSourceMismatch(project)}
        tools={[]}
        query=""
        warnings={[]}
        repairCandidates={[]}
        busy={false}
        setQuery={vi.fn()}
        onLaunch={vi.fn()}
        onResume={onResume}
        onDeleteSession={vi.fn()}
        onRepairProject={vi.fn()}
        onRelocateProject={vi.fn()}
      />
    );

    expect(screen.getByRole("region", { name: "修复提示" })).toBeInTheDocument();
    expect(screen.getByText("会话存储目录与 cwd 不匹配")).toBeInTheDocument();
    expect(screen.getByText("会话文件仍在旧工具项目目录；点击“修复并恢复”会先移动这条记录再打开终端")).toBeInTheDocument();

    const repairButton = screen.getByRole("button", { name: "修复并恢复" });
    expect(repairButton).not.toBeDisabled();
    fireEvent.click(repairButton);
    expect(onResume).toHaveBeenCalledWith("qwen:e83d984f-d610-4eae-bff9-8273372bea97");
  });

  it("refreshes project detail after repairing and resuming a Qwen source mismatch", async () => {
    const project = { ...projectFixture("E:\\ai-working-space\\old-project"), sessionCount: 1 };
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detailSummary.mockResolvedValue(detailWithoutSessionRows(detailWithQwenSourceMismatch(project)));
    clientMock.detail
      .mockResolvedValueOnce(detailWithQwenSourceMismatch(project))
      .mockResolvedValue(detailWithQwenReady(project));

    render(<App />);

    await screen.findByText("old-project");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    const repairButton = await screen.findByRole("button", { name: "修复并恢复" });
    fireEvent.click(repairButton);

    await waitFor(() => expect(clientMock.resume).toHaveBeenCalledWith("qwen:e83d984f-d610-4eae-bff9-8273372bea97"));
    await waitFor(() => expect(clientMock.detail).toHaveBeenLastCalledWith(project.id, ""));
    expect(await screen.findByText("已打开恢复终端：qwen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "修复并恢复" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复" })).not.toBeDisabled();
  });

  it("keeps project warnings scoped during automatic session reloads", async () => {
    const project = { ...projectFixture("E:\\tool-butler"), id: "project-tool-butler", sessionCount: 1 };
    const listeners = new Map<string, EventListenerOrEventListenerObject>();

    class MockEventSource {
      onerror: ((event: Event) => void) | null = null;

      constructor(readonly url: string) {}

      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        listeners.set(type, listener);
      }

      close() {}
    }

    vi.stubGlobal("EventSource", MockEventSource);
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));
    clientMock.warnings.mockResolvedValue([]);

    try {
      render(<App />);

      await screen.findByText("tool-butler");
      fireEvent.click(screen.getByRole("button", { name: "打开" }));
      await screen.findByText("当前项目根目录");
      clientMock.projects.mockClear();
      clientMock.warnings.mockClear();

      const listener = listeners.get("sessions:changed");
      expect(listener).toBeTruthy();
      const event = new Event("sessions:changed");
      if (typeof listener === "function") {
        listener(event);
      } else {
        listener?.handleEvent(event);
      }

      await waitFor(() => expect(clientMock.projects).toHaveBeenCalledTimes(1));
      expect(clientMock.warnings.mock.calls).toEqual([[project.id]]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("clears stale detail filters when opening a project from the overview", async () => {
    const oldProject = { ...projectFixture("E:\\old"), id: "project-old" };
    const newProject = { ...projectFixture("E:\\new-ai-game"), id: "project-new", sessionCount: 3 };
    clientMock.projects.mockResolvedValue([oldProject, newProject]);
    clientMock.detail.mockImplementation((projectId: string) =>
      Promise.resolve(detailFixture(projectId === newProject.id ? newProject : oldProject))
    );

    render(<App />);

    await screen.findByText("new-ai-game");
    fireEvent.click(screen.getAllByRole("button", { name: "打开" })[0]);
    await screen.findByText("当前项目根目录");
    fireEvent.change(screen.getByLabelText("筛选标题和摘要"), { target: { value: "不会匹配" } });
    await waitFor(() => expect(clientMock.detail).toHaveBeenLastCalledWith(oldProject.id, "不会匹配"));

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    fireEvent.click(screen.getAllByRole("button", { name: "打开" })[1]);

    await waitFor(() => expect(clientMock.detail).toHaveBeenLastCalledWith(newProject.id, ""));
    expect(clientMock.detail).not.toHaveBeenCalledWith(newProject.id, "不会匹配");
  });

  it("renders only the project name in the topbar detail title", async () => {
    const project = { ...projectFixture("E:\\new-ai-game"), sessionCount: 3 };
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));

    const { container } = render(<App />);

    await screen.findByText("new-ai-game");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByText("当前项目根目录");

    const topbar = container.querySelector(".topbar") as HTMLElement;
    expect(within(topbar).getByRole("heading", { name: "new-ai-game" })).toBeInTheDocument();
    expect(within(topbar).queryByText("项目详情")).not.toBeInTheDocument();
    expect(within(topbar).queryByText("E:\\new-ai-game")).not.toBeInTheDocument();
    expect(within(topbar).getByRole("button", { name: "返回" })).toBeInTheDocument();
    expect(within(topbar).getByRole("checkbox", { name: "子目录" })).toBeInTheDocument();
    expect(within(topbar).getByRole("button", { name: "刷新项目" })).toBeInTheDocument();
    expect(within(topbar).getByRole("button", { name: "设置" })).toBeInTheDocument();
    expect(within(topbar).queryByRole("button", { name: "规则同步" })).not.toBeInTheDocument();
    expect(within(topbar).queryByRole("button", { name: "刷新索引" })).not.toBeInTheDocument();
    expect(within(topbar).queryByRole("button", { name: "技能" })).not.toBeInTheDocument();
    expect(within(topbar).queryByRole("button", { name: "MCP" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "技能" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "MCP" })).toBeInTheDocument();
    expect(container.querySelector(".detail-head")).toBeNull();
  });

  it("places project refresh immediately before settings in project detail", async () => {
    const project = { ...projectFixture("E:\\new-ai-game"), sessionCount: 3 };
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));

    const { container } = render(<App />);

    await screen.findByText("new-ai-game");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByText("当前项目根目录");

    const topbarActions = container.querySelector(".topbar-actions") as HTMLElement;
    const buttons = within(topbarActions).getAllByRole("button").map((button) => button.textContent);
    expect(buttons.slice(-2)).toEqual(["刷新项目", "设置"]);
  });

  it("confirms rule sync with target status explanations before applying", async () => {
    const project = { ...projectFixture("E:\\new-ai-game"), sessionCount: 3 };
    const status = ruleSyncStatusFixture(project);
    status.files["AGENTS.md"].gitManaged = false;
    status.files["AGENTS.md"].dirty = null;
    const committedStatus = ruleSyncStatusFixture(project);
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));
    clientMock.ruleSyncStatus.mockResolvedValue(status);
    clientMock.commitRuleSync.mockResolvedValue({
      projectId: project.id,
      projectRoot: project.rootPath,
      direction: "claude-to-agents",
      targetFile: "AGENTS.md",
      action: "committed",
      backupCommit: "abc123",
      message: "目标规则文件已 commit",
      status: committedStatus
    });
    clientMock.applyRuleSync.mockResolvedValue({
      projectId: project.id,
      projectRoot: project.rootPath,
      direction: "claude-to-agents",
      sourceFile: "CLAUDE.md",
      targetFile: "AGENTS.md",
      action: "overwritten",
      backupCommit: "abc123",
      message: "目标规则文件已覆盖",
      status
    });

    render(<App />);

    await screen.findByText("new-ai-game");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByText("当前项目根目录");

    const ruleSyncSection = screen.getByRole("region", { name: "规则同步" });
    const agentsRow = await within(ruleSyncSection).findByRole("article", { name: "AGENTS.md 规则文件" });
    const syncToAgents = within(agentsRow).getByRole("button", { name: "同步" });

    fireEvent.click(syncToAgents);

    const dialog = await screen.findByRole("dialog", { name: "同步到AGENTS.md" });
    expect(within(dialog).getByText("将CLAUDE.md的内容同步到AGENTS.md")).toBeInTheDocument();
    expect(within(dialog).getByText("目标文件状态")).toBeInTheDocument();
    expect(within(dialog).getByText("文件存在")).toBeInTheDocument();
    expect(within(dialog).getByText("无版本管理")).toBeInTheDocument();
    expect(within(dialog).queryByText("来源")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("存在 / 缺失")).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: "取消" })).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: "commit" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "同步" })).toBeInTheDocument();
    expect(within(dialog).queryByText(project.rootPath)).not.toBeInTheDocument();
    expect(clientMock.applyRuleSync).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "commit" }));
    await waitFor(() => expect(clientMock.commitRuleSync).toHaveBeenCalledWith(project.id, "claude-to-agents"));
    expect(clientMock.applyRuleSync).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "同步" }));
    await waitFor(() => expect(clientMock.applyRuleSync).toHaveBeenCalledWith(project.id, "claude-to-agents"));
  });

  it("creates the CLAUDE.md template from an editable preview and then shows view", async () => {
    const project = { ...projectFixture("E:\\new-ai-game"), sessionCount: 3 };
    const emptyStatus = ruleSyncStatusWithoutFiles(project);
    const createdStatus = ruleSyncStatusWithOnlyClaude(project);
    const editedContent = "# CLAUDE.md\n\n编辑后的规则\n";
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));
    clientMock.ruleSyncStatus.mockResolvedValue(emptyStatus);
    clientMock.prepareRuleFileCreate.mockResolvedValue({
      projectId: project.id,
      projectRoot: project.rootPath,
      file: "CLAUDE.md",
      path: `${project.rootPath}\\CLAUDE.md`,
      source: "template",
      sourceFile: null,
      content: "# CLAUDE.md\n\n默认模板\n",
      message: "将使用默认模板创建 CLAUDE.md"
    });
    clientMock.createRuleFile.mockResolvedValue({
      projectId: project.id,
      projectRoot: project.rootPath,
      file: "CLAUDE.md",
      path: `${project.rootPath}\\CLAUDE.md`,
      action: "created",
      message: "已创建 CLAUDE.md",
      status: createdStatus
    });

    render(<App />);

    await screen.findByText("new-ai-game");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await screen.findByText("当前项目根目录");

    const ruleSyncSection = screen.getByRole("region", { name: "规则同步" });
    expect(await within(ruleSyncSection).findByText("未发现规则文件")).toBeInTheDocument();
    const initialClaudeRow = within(ruleSyncSection).getByRole("article", { name: "CLAUDE.md 规则文件" });
    expect(within(initialClaudeRow).getByRole("button", { name: "创建" })).toBeInTheDocument();
    expect(within(ruleSyncSection).queryByRole("button", { name: "同步" })).not.toBeInTheDocument();

    fireEvent.click(within(initialClaudeRow).getByRole("button", { name: "创建" }));

    const dialog = await screen.findByRole("dialog", { name: "创建CLAUDE.md" });
    await waitFor(() => expect(clientMock.prepareRuleFileCreate).toHaveBeenCalledWith(project.id, "CLAUDE.md", "template"));
    expect(within(dialog).getByRole("radio", { name: /默认模板/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /从AGENTS.md同步/ })).toBeDisabled();
    const editor = within(dialog).getByRole("textbox", { name: "CLAUDE.md 预览内容" });
    expect(editor).toHaveValue("# CLAUDE.md\n\n默认模板\n");

    fireEvent.change(editor, { target: { value: editedContent } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

    await waitFor(() => expect(clientMock.createRuleFile).toHaveBeenCalledWith(project.id, "CLAUDE.md", editedContent));
    expect(within(ruleSyncSection).queryByRole("button", { name: "查看规则" })).not.toBeInTheDocument();

    const claudeRow = await within(ruleSyncSection).findByRole("article", { name: "CLAUDE.md 规则文件" });
    const viewButton = await within(claudeRow).findByRole("button", { name: "查看" });
    fireEvent.click(viewButton);
    await waitFor(() => expect(clientMock.openRuleFile).toHaveBeenCalledWith(project.id, "CLAUDE.md"));
  });

  it("keeps refresh index in the home command bar outside project detail", async () => {
    const { container } = render(<App />);

    await screen.findByText("还没有项目");

    const topbarActions = container.querySelector(".topbar-actions") as HTMLElement;
    expect(within(topbarActions).queryByRole("button", { name: "刷新索引" })).not.toBeInTheDocument();
    expect(within(topbarActions).getByRole("button", { name: "设置" })).toBeInTheDocument();

    const commandBar = screen.getByRole("region", { name: "项目操作" });
    expect(within(commandBar).getByRole("button", { name: "刷新索引" })).toBeInTheDocument();
  });

  it("clears project detail notices when returning to the overview", async () => {
    const oldProject = { ...projectFixture("E:\\old"), id: "project-old" };
    const newProject = { ...projectFixture("E:\\new-ai-game"), id: "project-new", sessionCount: 3 };
    clientMock.projects.mockResolvedValue([oldProject, newProject]);
    clientMock.detail.mockImplementation((projectId: string) =>
      Promise.resolve(detailFixture(projectId === newProject.id ? newProject : oldProject))
    );
    clientMock.refreshProject.mockResolvedValue(refreshResultFixture(2, 1, 0));

    render(<App />);

    await screen.findByText("new-ai-game");
    fireEvent.click(screen.getAllByRole("button", { name: "打开" })[0]);
    await screen.findByText("当前项目根目录");
    fireEvent.click(screen.getByRole("button", { name: "刷新项目" }));

    expect(await screen.findByText("项目刷新完成：2 条，会话跳过 1 条，警告 0 条")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新项目" })).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.queryByText("项目刷新完成：2 条，会话跳过 1 条，警告 0 条")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "打开" })[1]);
    await waitFor(() => expect(clientMock.detail).toHaveBeenLastCalledWith(newProject.id, ""));
    expect(screen.queryByText("项目刷新完成：2 条，会话跳过 1 条，警告 0 条")).not.toBeInTheDocument();
  });

  it("does not carry an overview removal notice into another project detail", async () => {
    const oldProject = { ...projectFixture("E:\\old"), id: "project-old" };
    const newProject = { ...projectFixture("E:\\new-ai-game"), id: "project-new", sessionCount: 3 };
    clientMock.projects.mockResolvedValue([oldProject, newProject]);
    clientMock.detail.mockResolvedValue(detailFixture(newProject));

    render(<App />);

    await screen.findByText("new-ai-game");
    fireEvent.click(screen.getAllByRole("button", { name: "移除" })[0]);

    expect(await screen.findByText("项目已从管理器移除，原始文件未删除")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新索引" })).not.toBeDisabled());

    fireEvent.click(screen.getAllByRole("button", { name: "打开" })[1]);
    await waitFor(() => expect(clientMock.detail).toHaveBeenLastCalledWith(newProject.id, ""));
    expect(screen.queryByText("项目已从管理器移除，原始文件未删除")).not.toBeInTheDocument();
  });

  it("refreshes only the selected tool indexes from the topbar", async () => {
    clientMock.tools.mockResolvedValue([toolStatusFixture("codex"), toolStatusFixture("opencode")]);
    clientMock.refreshSessions.mockResolvedValue(refreshResultFixture(2, 0, 0, 1));

    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "刷新索引" }));

    const dialog = await screen.findByRole("dialog", { name: "刷新索引" });
    const header = dialog.querySelector("header") as HTMLElement;
    expect(within(header).getByRole("radiogroup", { name: "刷新方式" })).toBeInTheDocument();
    expect(within(dialog).queryByText("索引")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "增量" })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /codex/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: "开始刷新" }));

    await waitFor(() => expect(clientMock.refreshSessions).toHaveBeenCalledWith(["opencode"], "incremental"));
    expect(await screen.findByText("增量索引完成：2 条，会话跳过 0 条，警告 0 条，自动加入 1 个项目")).toBeInTheDocument();
  });

  it("can run a full index refresh from the topbar dialog", async () => {
    clientMock.tools.mockResolvedValue([toolStatusFixture("codex"), toolStatusFixture("opencode")]);
    clientMock.refreshSessions.mockResolvedValue(refreshResultFixture(3, 0, 0, 0));

    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "刷新索引" }));

    const dialog = await screen.findByRole("dialog", { name: "刷新索引" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "全量" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "开始刷新" }));

    await waitFor(() => expect(clientMock.refreshSessions).toHaveBeenCalledWith(["codex", "opencode"], "full"));
    expect(await screen.findByText("全量索引完成：3 条，会话跳过 0 条，警告 0 条")).toBeInTheDocument();
  });

  it("still renders project sessions when repair candidates fail to load", async () => {
    const project = { ...projectFixture("E:\\new-ai-game"), sessionCount: 3 };
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailWithSession(project));
    clientMock.repairCandidates.mockRejectedValue(new SyntaxError("Unexpected token '<'"));

    render(<App />);

    await screen.findByText("new-ai-game");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    expect(await screen.findByText("开罗小游戏，主题是骑士对决")).toBeInTheDocument();
    expect(screen.getByText("3 个会话")).toBeInTheDocument();
  });

  it("shows project detail summary before full session details finish loading", async () => {
    const project = { ...projectFixture("E:\\new-ai-game"), sessionCount: 3 };
    let resolveDetail!: (value: ProjectDetail) => void;
    const fullDetail = new Promise<ProjectDetail>((resolve) => {
      resolveDetail = resolve;
    });
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detailSummary.mockResolvedValue(detailSummaryWithSessionCounts(project));
    clientMock.detail.mockReturnValue(fullDetail);
    clientMock.repairCandidates.mockResolvedValue([]);

    render(<App />);

    await screen.findByText("new-ai-game");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    expect(await screen.findByText("会话详情加载中...")).toBeInTheDocument();
    expect(screen.getByText("3 个会话")).toBeInTheDocument();
    expect(screen.queryByText("开罗小游戏，主题是骑士对决")).not.toBeInTheDocument();

    await act(async () => {
      resolveDetail(detailWithSession(project));
    });
    expect(await screen.findByText("开罗小游戏，主题是骑士对决")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("会话详情加载中...")).not.toBeInTheDocument());
  });

  it("deletes a session from project detail after confirmation and refreshes detail", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const project = { ...projectFixture("E:\\new-ai-game"), sessionCount: 1 };
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailWithSession(project));

    render(<App />);

    await screen.findByText("new-ai-game");
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    expect(await screen.findByText("开罗小游戏，主题是骑士对决")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(clientMock.deleteSession).toHaveBeenCalledWith("claude:1"));
    expect(confirmSpy).toHaveBeenCalled();
    expect(await screen.findByText("会话已删除，原始记录已移除")).toBeInTheDocument();
    expect(clientMock.projects).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(clientMock.detail).toHaveBeenLastCalledWith(project.id, ""));
    confirmSpy.mockRestore();
  });

  it("renders tool groups collapsed until clicked", () => {
    const project = { ...projectFixture("E:\\new-ai-game"), sessionCount: 3 };
    const { container } = render(
      <ProjectDetailView
        project={project}
        detail={detailWithSession(project)}
        tools={[]}
        query=""
        warnings={[]}
        repairCandidates={[]}
        busy={false}
        setQuery={vi.fn()}
        onLaunch={vi.fn()}
        onResume={vi.fn()}
        onDeleteSession={vi.fn()}
        onRepairProject={vi.fn()}
        onRelocateProject={vi.fn()}
      />
    );

    const toolGroup = container.querySelector("details.tool-group") as HTMLDetailsElement | null;
    const summary = toolGroup?.querySelector("summary");
    expect(toolGroup).not.toBeNull();
    expect(toolGroup?.open).toBe(false);

    fireEvent.click(summary as HTMLElement);
    expect(toolGroup?.open).toBe(true);
  });

  it("shows immediate feedback while project relocation is still running", async () => {
    const project = projectFixture("E:\\old");
    clientMock.projects.mockResolvedValue([project]);
    clientMock.detail.mockResolvedValue(detailFixture(project));
    clientMock.pickDirectory.mockResolvedValueOnce({ path: "E:\\new", cancelled: false });
    clientMock.relocateProject.mockReturnValue(new Promise(() => {}));

    render(<App />);

    await screen.findByText("old");
    fireEvent.click(screen.getByText("打开"));
    await screen.findByText("当前项目根目录");

    fireEvent.click(screen.getByRole("button", { name: "选择新位置并迁移" }));

    expect(clientMock.pickDirectory).toHaveBeenCalled();
    expect(await screen.findByText("正在移动项目并刷新会话路径...")).toBeInTheDocument();
    expect(screen.getByText("迁移中...")).toBeInTheDocument();
  });

});

function projectFixture(rootPath: string): Project {
  return {
    id: "project-1",
    rootPath,
    normalizedRootPath: rootPath.toLowerCase(),
    includeSubdirectories: true,
    sessionOnly: false,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    childGroupCount: 0,
    sessionCount: 0
  };
}

function detailFixture(project: Project): ProjectDetail {
  return {
    project,
    groups: [
      {
        key: project.normalizedRootPath,
        label: "old（根目录）",
        fullPath: project.rootPath,
        isRoot: true,
        latestActivity: null,
        sessionCount: 0,
        tools: []
      }
    ]
  };
}

function detailWithChildGroup(project: Project, childRoot: string): ProjectDetail {
  return {
    project,
    groups: [
      {
        key: project.normalizedRootPath,
        label: "repo（根目录）",
        fullPath: project.rootPath,
        isRoot: true,
        latestActivity: null,
        sessionCount: 0,
        tools: []
      },
      {
        key: childRoot.toLowerCase(),
        label: "packages\\app",
        fullPath: childRoot,
        isRoot: false,
        latestActivity: null,
        sessionCount: 0,
        tools: []
      }
    ]
  };
}

function detailWithSession(project: Project): ProjectDetail {
  return {
    project,
    groups: [
      {
        key: project.normalizedRootPath,
        label: "new-ai-game（根目录）",
        fullPath: project.rootPath,
        isRoot: true,
        latestActivity: "2026-06-01T00:00:00Z",
        sessionCount: 3,
        tools: [
          {
            toolId: "claude",
            sessionCount: 3,
            latestActivity: "2026-06-01T00:00:00Z",
            sessions: [
              {
                id: "claude:1",
                toolId: "claude",
                nativeSessionId: "1",
                title: "开罗小游戏，主题是骑士对决",
                summary: null,
                originalCwd: project.rootPath,
                normalizedCwd: project.normalizedRootPath,
                updatedAt: "2026-06-01T00:00:00Z",
                sourceFile: "C:\\Users\\brand\\.claude\\projects\\E--new-ai-game\\1.jsonl",
                sourceFormat: "claude-jsonl",
                parserVersion: "test",
                resumeStatus: "cwd_missing",
                indexedAt: "2026-06-01T00:00:00Z"
              }
            ]
          }
        ]
      }
    ]
  };
}

function detailSummaryWithSessionCounts(project: Project): ProjectDetail {
  return detailWithoutSessionRows(detailWithSession(project));
}

function detailWithoutSessionRows(detail: ProjectDetail): ProjectDetail {
  return {
    ...detail,
    groups: detail.groups.map((group) => ({
      ...group,
      tools: group.tools.map((tool) => ({
        ...tool,
        sessions: []
      }))
    }))
  };
}

function detailWithQwenSourceMismatch(project: Project): ProjectDetail {
  return {
    project,
    groups: [
      {
        key: project.normalizedRootPath,
        label: "old-project（根目录）",
        fullPath: project.rootPath,
        isRoot: true,
        latestActivity: "2026-05-14T00:57:44Z",
        sessionCount: 1,
        tools: [
          {
            toolId: "qwen",
            sessionCount: 1,
            latestActivity: "2026-05-14T00:57:44Z",
            sessions: [
              {
                id: "qwen:e83d984f-d610-4eae-bff9-8273372bea97",
                toolId: "qwen",
                nativeSessionId: "e83d984f-d610-4eae-bff9-8273372bea97",
                title: "qwen code和qoder的区别是什么？",
                summary: null,
                originalCwd: project.rootPath,
                normalizedCwd: project.normalizedRootPath,
                updatedAt: "2026-05-14T00:57:44Z",
                sourceFile: "C:\\Users\\brand\\.qwen\\projects\\d--work-project\\chats\\e83d984f-d610-4eae-bff9-8273372bea97.jsonl",
                sourceFormat: "qwen-json",
                parserVersion: "test",
                resumeStatus: "source_mismatch",
                indexedAt: "2026-06-02T01:00:00Z"
              }
            ]
          }
        ]
      }
    ]
  };
}

function detailWithQwenReady(project: Project): ProjectDetail {
  const detail = detailWithQwenSourceMismatch(project);
  const session = detail.groups[0].tools[0].sessions[0];
  return {
    ...detail,
    groups: [
      {
        ...detail.groups[0],
        tools: [
          {
            ...detail.groups[0].tools[0],
            sessions: [
              {
                ...session,
                sourceFile: "C:\\Users\\brand\\.qwen\\projects\\e--ai-working-space-old-project\\chats\\e83d984f-d610-4eae-bff9-8273372bea97.jsonl",
                resumeStatus: "ready"
              }
            ]
          }
        ]
      }
    ]
  };
}

function candidateFixture(candidatePath: string): ScanCandidate {
  return {
    id: "candidate-1",
    scanRunId: "scan-1",
    path: candidatePath,
    normalizedPath: candidatePath.toLowerCase(),
    detectedTools: ["codex"],
    sessionCounts: { codex: 2 },
    childCandidates: [],
    createdAt: "2026-06-01T00:00:00Z"
  };
}

function refreshResultFixture(indexedCount = 0, skippedCount = 0, warningCount = 0, addedProjectCount = 0): RefreshResult {
  return {
    scanRun: {
      id: "scan-1",
      scope: "sessions",
      roots: [],
      status: "completed",
      indexedCount,
      skippedCount,
      warningCount,
      startedAt: "2026-06-01T00:00:00Z",
      finishedAt: "2026-06-01T00:00:00Z"
    },
    indexedCount,
    skippedCount,
    warningCount,
    addedProjectCount
  };
}

function toolStatusFixture(toolId: ToolId): ToolStatus {
  return {
    toolId,
    command: toolId,
    available: true,
    supported: true,
    visibleInProjectUi: true,
    capabilities: {
      launchNew: true,
      scanHistory: true,
      resume: true
    },
    reason: null,
    sessionSources: [`C:\\sessions\\${toolId}`]
  };
}

function cliHubListFixture(updateStatus: CliHubList["clis"][number]["updateStatus"] = "unknown"): CliHubList {
  return {
    operation: null,
    clis: [
      {
        cliId: "codex",
        displayName: "Codex",
        kind: "project-tool",
        sourceType: "builtin",
        sourceState: "builtin",
        commandNames: ["codex"],
        localPath: null,
        channels: [
          {
            channelId: "codex:npm",
            provider: "npm",
            label: "npm: @openai/codex",
            packageId: "@openai/codex",
            installCommand: ["npm", "install", "-g", "@openai/codex"],
            updateCommand: null,
            checkCommand: null,
            appManaged: false,
            metadata: {},
            builtin: true
          }
        ],
        availabilityState: "available",
        resolvedPaths: ["C:\\Users\\brand\\AppData\\Roaming\\npm\\codex.cmd"],
        version: "codex 1.2.3",
        versionState: "detected",
        versionError: null,
        discoveredAt: "2026-06-01T00:00:00Z",
        currentProvider: { provider: "npm", packageId: "@openai/codex", confidence: "high", reason: "npm" },
        providerCandidates: [],
        updateStatus,
        updateCheckedAt: updateStatus === "unknown" ? null : "2026-06-01T00:00:00Z",
        updateError: null,
        recentOperation: null,
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z"
      },
      {
        cliId: "gh",
        displayName: "GitHub CLI",
        kind: "function",
        sourceType: "builtin",
        sourceState: "builtin",
        commandNames: ["gh"],
        localPath: null,
        channels: [],
        availabilityState: "unknown",
        resolvedPaths: [],
        version: null,
        versionState: "unknown",
        versionError: null,
        discoveredAt: null,
        currentProvider: null,
        providerCandidates: [],
        updateStatus: "unknown",
        updateCheckedAt: null,
        updateError: null,
        recentOperation: null,
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z"
      },
      {
        cliId: "node",
        displayName: "Node.js",
        kind: "dependency",
        sourceType: "builtin",
        sourceState: "builtin",
        commandNames: ["node"],
        localPath: null,
        channels: [],
        availabilityState: "unknown",
        resolvedPaths: [],
        version: null,
        versionState: "unknown",
        versionError: null,
        discoveredAt: null,
        currentProvider: null,
        providerCandidates: [],
        updateStatus: "unknown",
        updateCheckedAt: null,
        updateError: null,
        recentOperation: null,
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z"
      }
    ]
  };
}

function projectToolTargetFixture(project: Project, toolId: ToolId, enabled: boolean, overrides: Partial<ProjectToolTarget> = {}): ProjectToolTarget {
  return {
    projectId: project.id,
    toolId,
    enabled,
    inferred: false,
    supported: true,
    skillDirectory: `${project.rootPath}\\.${toolId}\\skills`,
    reason: null,
    updatedAt: "2026-06-01T00:00:00Z",
    ...overrides
  };
}

function agentHubSourceFixture(): AgentHubList["sources"][number] {
  return {
    id: "agency-agents",
    type: "builtin",
    label: "agency-agents",
    inputPath: null,
    resolvedPath: "C:\\tmp\\local-ai-workbench\\builtin-agents\\agency-agents",
    sourceTruthTool: "claude",
    importedAt: "2026-06-01T00:00:00Z",
    metadata: {},
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z"
  };
}

function agentHubAgentFixture(overrides: Partial<AgentHubAgent> = {}): AgentHubAgent {
  const source = overrides.source ?? agentHubSourceFixture();
  const slug = overrides.slug ?? "code-reviewer";
  const name = overrides.name ?? "Code Reviewer";
  return {
    id: overrides.id ?? "agent-1",
    sourceId: overrides.sourceId ?? source.id,
    sourceType: overrides.sourceType ?? source.type,
    sourceTruthTool: overrides.sourceTruthTool ?? "claude",
    truthRole: overrides.truthRole ?? "subagent",
    sourceFormat: overrides.sourceFormat ?? "markdown",
    slug,
    name,
    description: overrides.description ?? "Review code changes",
    nativePath: overrides.nativePath ?? `C:\\tmp\\local-ai-workbench\\agenthub\\library\\agency-agents\\engineering\\${slug}.md`,
    libraryRelativePath: overrides.libraryRelativePath ?? `agency-agents\\engineering\\${slug}.md`,
    sourceRelativePath: overrides.sourceRelativePath ?? `engineering\\${slug}.md`,
    category: overrides.category ?? "engineering",
    projection: overrides.projection ?? {
      name,
      description: "Review code changes",
      body: "Review the current patch.",
      slugCandidate: slug,
      parseWarnings: []
    },
    nativeMetadata: overrides.nativeMetadata ?? { tools: ["Read"] },
    contentHash: overrides.contentHash ?? `${slug}-hash`,
    createdAt: overrides.createdAt ?? "2026-06-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-06-01T00:00:00Z",
    source
  };
}

function agentHubListFixture(): AgentHubList {
  const source = agentHubSourceFixture();
  return {
    config: {
      rootDir: "C:\\tmp\\local-ai-workbench\\agenthub",
      libraryDir: "C:\\tmp\\local-ai-workbench\\agenthub\\library"
    },
    sources: [source],
    agents: [agentHubAgentFixture({ source })]
  };
}

function projectAgentStateFixture(project: Project, targetRootPath = project.rootPath): ProjectAgentState {
  const scopedProject = { ...project, rootPath: targetRootPath, normalizedRootPath: targetRootPath.toLowerCase() };
  const agent = agentHubAgentFixture();
  const preview = agentHubPreviewFixture(agent, "codex", targetRootPath, "create");
  const localAgent = projectLocalAgentFixture(project, targetRootPath);
  return {
    projectId: project.id,
    targetRootPath,
    toolTargets: [projectToolTargetFixture(scopedProject, "codex", true)],
    sources: [agentHubSourceFixture()],
    agents: [agent],
    targets: [
      {
        projectId: project.id,
        targetRootPath,
        toolId: "codex",
        agent,
        binding: null,
        outputPath: preview.targetPath,
        status: "missing",
        preview,
        reason: "未启用",
        error: null
      }
    ],
    localAgents: [localAgent]
  };
}

function projectLocalAgentFixture(project: Project, targetRootPath = project.rootPath): ProjectAgentState["localAgents"][number] {
  return {
    id: `codex:${targetRootPath.toLowerCase()}\\.codex\\agents\\local-reviewer.toml`,
    projectId: project.id,
    targetRootPath,
    toolId: "codex",
    type: "unmanaged",
    outputPath: `${targetRootPath}\\.codex\\agents\\local-reviewer.toml`,
    slug: "local-reviewer",
    name: "Local Reviewer",
    description: "Local review agent",
    status: "unmanaged",
    binding: null,
    agent: null,
    migratable: true,
    reason: null
  };
}

function projectAgentBindingFixture(project: Project, targetRootPath = project.rootPath) {
  const agent = agentHubAgentFixture();
  return {
    id: "binding-1",
    projectId: project.id,
    targetRootPath,
    toolId: "codex" as const,
    agentId: agent.id,
    outputPath: `${targetRootPath}\\.codex\\agents\\${agent.slug}.toml`,
    appliedSourceHash: agent.contentHash,
    appliedOutputHash: "output-hash",
    appliedAt: "2026-06-01T00:00:00Z",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    agent
  };
}

function agentHubPreviewFixture(agent: AgentHubAgent, targetToolId: "codex", targetRootPath: string, action: "create" | "overwrite" | "sync" | "replace-managed") {
  return {
    agentId: agent.id,
    targetToolId,
    targetPath: `${targetRootPath}\\.codex\\agents\\${agent.slug}.toml`,
    action,
    sourceTruthTool: agent.sourceTruthTool,
    truthRole: agent.truthRole,
    renderedSummary: `${agent.name} -> ${targetToolId}`,
    preservedNativeFields: [],
    ignoredNativeFields: [],
    outputHash: "output-hash"
  };
}

function projectAgentApplyResultFixture(
  project: Project,
  targetRootPath = project.rootPath,
  overrides: Partial<Pick<ProjectAgentApplyResult, "requiresConfirmation" | "conflicts" | "replacedBindings" | "backups" | "action">> = {}
): ProjectAgentApplyResult {
  const agent = agentHubAgentFixture();
  const binding = projectAgentBindingFixture(project, targetRootPath);
  const preview = agentHubPreviewFixture(agent, "codex", targetRootPath, overrides.requiresConfirmation ? "overwrite" : "create");
  return {
    projectId: project.id,
    targetRootPath,
    toolId: "codex",
    agent,
    binding: overrides.requiresConfirmation ? null : binding,
    state: overrides.requiresConfirmation
      ? null
      : {
          projectId: project.id,
          targetRootPath,
          toolId: "codex",
          agent,
          binding,
          outputPath: binding.outputPath,
          status: "current",
          preview,
          reason: null,
          error: null
        },
    preview,
    conflicts: overrides.conflicts ?? [],
    replacedBindings: overrides.replacedBindings ?? [],
    backups: overrides.backups ?? [],
    requiresConfirmation: overrides.requiresConfirmation ?? false,
    action: overrides.action ?? (overrides.requiresConfirmation ? "needs-confirmation" : "applied")
  };
}

function projectAgentDisableResultFixture(project: Project, targetRootPath = project.rootPath) {
  return {
    projectId: project.id,
    targetRootPath,
    binding: projectAgentBindingFixture(project, targetRootPath),
    removed: true,
    deletedFile: true,
    backups: [],
    requiresConfirmation: false,
    status: "current" as const
  };
}

function projectLocalAgentMigrationResultFixture(project: Project, targetRootPath = project.rootPath): ProjectLocalAgentMigrationResult {
  const source = agentHubSourceFixture();
  const agent = agentHubAgentFixture({ source, slug: "local-reviewer", name: "Local Reviewer" });
  return {
    projectId: project.id,
    targetRootPath,
    localAgent: projectLocalAgentFixture(project, targetRootPath),
    source,
    agent,
    binding: {
      ...projectAgentBindingFixture(project, targetRootPath),
      agentId: agent.id,
      outputPath: `${targetRootPath}\\.codex\\agents\\local-reviewer.toml`,
      agent
    },
    conflicts: [],
    requiresConfirmation: false,
    action: "migrated"
  };
}

function hookHubSuiteFixture(): HookHubSuite {
  return {
    suiteId: "suite-1",
    name: "提交前检查",
    description: "运行项目检查",
    riskNotes: "命令 hooks 会执行本地检查",
    requiredEnv: ["CI_TOKEN"],
    payloads: {
      claude: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "npm test" }] }] }
    },
    toolIds: ["claude"],
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z"
  };
}

function projectHookBindingFixture(project: Project): ProjectHookBinding {
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId: "claude",
    suiteId: "suite-1",
    configPath: `${project.rootPath}\\.claude\\settings.json`,
    scope: "project",
    appliedFingerprint: "fingerprint",
    appliedAt: "2026-06-01T00:00:00Z",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z"
  };
}

function projectHookStateFixture(project: Project): ProjectHookState {
  const suite = hookHubSuiteFixture();
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    suites: [suite],
    tools: [
      {
        projectId: project.id,
        targetRootPath: project.rootPath,
        toolId: "claude",
        label: "Claude Code",
        supported: true,
        configPath: `${project.rootPath}\\.claude\\settings.json`,
        scope: "project",
        status: "current",
        hooks: suite.payloads.claude ?? null,
        hooksSummary: "1 个事件：PreToolUse",
        reason: null,
        error: null,
        binding: projectHookBindingFixture(project),
        suite,
        discovery: []
      },
      {
        projectId: project.id,
        targetRootPath: project.rootPath,
        toolId: "codex",
        label: "Codex",
        supported: true,
        configPath: `${project.rootPath}\\.codex\\hooks.json`,
        scope: "project",
        status: "missing",
        hooks: null,
        hooksSummary: "无 hooks",
        reason: "未配置 hooks",
        error: null,
        binding: null,
        suite: null,
        discovery: []
      },
      {
        projectId: project.id,
        targetRootPath: project.rootPath,
        toolId: "opencode",
        label: "OpenCode",
        supported: false,
        configPath: null,
        scope: null,
        status: "unsupported",
        hooks: null,
        hooksSummary: "plugins: audit.ts",
        reason: "OpenCode hooks 是 plugin 文件和 opencode.json plugin 列表，MVP 仅发现不写入",
        error: null,
        binding: null,
        suite: null,
        discovery: ["plugins: audit.ts"]
      }
    ]
  };
}

function pluginHubSourceFixture(): PluginHubList["sources"][number] {
  return {
    id: "source-1",
    kind: "library",
    label: "wshobson-agents",
    inputPath: "C:\\tmp\\wshobson-agents",
    resolvedPath: "c:\\tmp\\wshobson-agents",
    pluginCount: 1,
    componentCount: 1,
    privateFileCount: 1,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z"
  };
}

function pluginHubPluginFixture(overrides: Partial<PluginHubList["plugins"][number]> = {}): PluginHubList["plugins"][number] {
  const source = pluginHubSourceFixture();
  return {
    id: "plugin-1",
    kind: "source",
    sourceId: source.id,
    name: "python-development",
    displayName: "python-development",
    description: "Python workflow plugin",
    componentRefs: [{ type: "skill", componentId: "skill-1", required: false }],
    privateFiles: [
      {
        id: "private-1",
        pluginId: "plugin-1",
        sourceRelativePath: "plugins/python-development/.codex-plugin/plugin.json",
        targetRelativePath: ".agents/plugins/python-development/.codex-plugin/plugin.json",
        contentPath: "C:\\tmp\\plugin.json",
        contentHash: "private-hash",
        required: true
      }
    ],
    harnessSupport: { codex: "native", claude: "planned" },
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    source,
    ...overrides
  };
}

function pluginHubListFixture(): PluginHubList {
  const source = pluginHubSourceFixture();
  const sourcePlugin = pluginHubPluginFixture({ source });
  const skillSource = skillHubSourceFixture(source.id, source.label, "local");
  const customPlugin = pluginHubPluginFixture({
    id: "plugin-custom",
    kind: "custom",
    sourceId: null,
    name: "custom-review",
    displayName: "custom-review",
    source: null
  });
  return {
    sources: [source],
    plugins: [sourcePlugin, customPlugin],
    sourcePlugins: [sourcePlugin],
    customPlugins: [customPlugin],
    skills: [skillHubSkillFixture(skillSource, "skill-1", "review", "Review skill")],
    agents: [agentHubAgentFixture()],
    mcpServers: [
      {
        serverId: "context7",
        name: "context7",
        description: "Context7 docs",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        url: null,
        headers: {},
        env: {},
        requiredEnv: [],
        builtin: true,
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z"
      }
    ],
    hookSuites: [hookHubSuiteFixture()]
  };
}

function projectPluginStateFixture(project: Project): ProjectPluginState {
  const plugin = pluginHubPluginFixture();
  const binding = {
    id: "binding-1",
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId: "codex" as const,
    pluginId: plugin.id,
    managedComponentCount: 1,
    existingComponentCount: 0,
    privateFileCount: 1,
    topologyHash: "topology-hash",
    componentOwnership: [
      {
        type: "skill" as const,
        componentId: "skill-1",
        toolId: "codex" as const,
        targetPath: "C:\\tmp\\local-ai-workbench\\skillhub\\library\\source\\review",
        linkPath: `${project.rootPath}\\.codex\\skills\\review`,
        ownerState: "managed" as const,
        required: false,
        reason: null
      }
    ],
    privateFileOwnership: [
      {
        privateFileId: "private-1",
        toolId: "codex" as const,
        targetPath: `${project.rootPath}\\.agents\\plugins\\python-development\\.codex-plugin\\plugin.json`,
        ownerState: "managed" as const,
        reason: null
      }
    ],
    installedAt: "2026-06-01T00:00:00Z",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    plugin
  };
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolTargets: [projectToolTargetFixture(project, "codex", true)],
    plugins: pluginHubListFixture().plugins,
    bindings: [binding],
    syncRequiredPluginIds: []
  };
}

function projectPluginApplyResultFixture(project: Project) {
  return {
    projectId: project.id,
    binding: projectPluginStateFixture(project).bindings[0],
    preflight: [],
    backups: [],
    blocked: false,
    requiresConfirmation: false,
    message: "Plugin 已安装"
  };
}

function skillHubSourceFixture(id: string, label: string, type: SkillHubSource["type"]): SkillHubSource {
  return {
    id,
    type,
    label,
    repoKey: type === "github" ? label : null,
    owner: type === "github" ? label.split("/")[0] : null,
    repo: type === "github" ? label.split("/")[1] ?? null : null,
    branch: null,
    input: label,
    inputPath: null,
    resolvedPath: type === "local" ? `C:\\tmp\\${label}` : null,
    currentRevision: null,
    checkoutPath: type === "github" ? `C:\\tmp\\checkout\\${id}` : null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z"
  };
}

function skillHubSkillFixture(source: SkillHubSource, id: string, folderName: string, description: string): SkillHubSkill {
  return {
    id,
    sourceId: source.id,
    sourceType: source.type,
    folderName,
    skillName: folderName,
    description,
    libraryRelativePath: `${source.id}/${folderName}`,
    libraryPath: `C:\\tmp\\local-ai-workbench\\skillhub\\library\\${source.id}\\${folderName}`,
    sourceRelativePath: folderName,
    contentHash: `${id}-hash`,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    source
  };
}

function skillHubUpdatePreviewFixture(source: SkillHubSource): SkillHubSourceUpdatePreview {
  return {
    source,
    items: [
      {
        kind: "changed",
        skillId: "skill-2",
        folderName: "triage",
        skillName: "triage",
        libraryRelativePath: `${source.id}/triage`,
        previousSourceRelativePath: "triage",
        nextSourceRelativePath: "triage",
        destructive: false,
        affectedTargets: []
      }
    ],
    hasUpdates: true,
    destructive: false,
    checkedAt: "2026-06-01T00:00:00Z"
  };
}

function appConfigFixture(mode: AppConfig["terminal"]["mode"] = "new-window", skillHubRoot = "C:\\tmp\\local-ai-workbench\\skillhub"): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex" },
      claude: { command: "claude" },
      cline: { command: "cline" },
      opencode: { command: "opencode" },
      kilo: { command: "kilo" },
      qwen: { command: "qwen" },
      deepcode: { command: "deepcode" },
      kimi: { command: "kimi" },
      qoder: { command: "qodercli" },
      codebuddy: { command: "codebuddy" },
      copilot: { command: "copilot" },
      cursor: { command: "cursor-agent" },
      antigravity: { command: "agy" },
      reasonix: { command: "reasonix" }
    },
    terminal: { mode },
    skillhub: { rootDir: skillHubRoot }
  };
}

function ruleSyncStatusFixture(project: Project) {
  return {
    projectId: project.id,
    projectRoot: project.rootPath,
    gitAvailable: true,
    gitRoot: project.rootPath,
    files: {
      "AGENTS.md": {
        file: "AGENTS.md",
        path: `${project.rootPath}\\AGENTS.md`,
        exists: true,
        mtime: "2026-06-01T00:00:00Z",
        gitManaged: true,
        dirty: false
      },
      "CLAUDE.md": {
        file: "CLAUDE.md",
        path: `${project.rootPath}\\CLAUDE.md`,
        exists: true,
        mtime: "2026-06-01T00:00:00Z",
        gitManaged: true,
        dirty: false
      }
    },
    directions: {
      "agents-to-claude": { enabled: true, reason: null },
      "claude-to-agents": { enabled: true, reason: null }
    }
  };
}

function ruleSyncStatusWithoutFiles(project: Project) {
  const status = ruleSyncStatusFixture(project);
  status.files["AGENTS.md"].exists = false;
  status.files["AGENTS.md"].mtime = null;
  status.files["AGENTS.md"].gitManaged = null;
  status.files["AGENTS.md"].dirty = null;
  status.files["CLAUDE.md"].exists = false;
  status.files["CLAUDE.md"].mtime = null;
  status.files["CLAUDE.md"].gitManaged = null;
  status.files["CLAUDE.md"].dirty = null;
  status.directions["agents-to-claude"] = { enabled: false, reason: "AGENTS.md 不存在" };
  status.directions["claude-to-agents"] = { enabled: false, reason: "CLAUDE.md 不存在" };
  return status;
}

function ruleSyncStatusWithOnlyClaude(project: Project) {
  const status = ruleSyncStatusFixture(project);
  status.files["AGENTS.md"].exists = false;
  status.files["AGENTS.md"].mtime = null;
  status.files["AGENTS.md"].gitManaged = null;
  status.files["AGENTS.md"].dirty = null;
  status.directions["agents-to-claude"] = { enabled: false, reason: "AGENTS.md 不存在" };
  status.directions["claude-to-agents"] = { enabled: true, reason: null };
  return status;
}

function emptyRelocationResult(oldRoot: string, newRoot: string): RelocationResult {
  return {
    oldRoot,
    newRoot,
    affectedSessionCount: 0,
    affectedFileCount: 0,
    sourceFiles: [],
    changes: [],
    projectChanges: [],
    warnings: [],
    changedFileCount: 0,
    changedFieldCount: 0,
    backups: [],
    projectMerges: [],
    refreshResult: refreshResultFixture()
  };
}
