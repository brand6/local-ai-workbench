import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppConfig,
  Project,
  ProjectDetail,
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
import { App, HomePage, ProjectDetailView } from "../src/client/main.js";

const clientMock = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  eventsUrl: vi.fn(),
  projects: vi.fn(),
  detail: vi.fn(),
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
  projectToolTargets: vi.fn(),
  updateProjectToolTargets: vi.fn(),
  projectSkillTargets: vi.fn(),
  updateProjectSkillTargets: vi.fn(),
  ruleSyncStatus: vi.fn(),
  applyRuleSync: vi.fn(),
  commitRuleSync: vi.fn(),
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
      dataDir: "C:\\tmp\\github-repo-manager",
      defaultDataDir: "C:\\tmp\\github-repo-manager",
      overriddenByArg: true
    });
    clientMock.eventsUrl.mockReturnValue("/api/events?token=test");
    clientMock.projects.mockResolvedValue([]);
    clientMock.detail.mockResolvedValue(detailFixture(projectFixture("E:\\old")));
    clientMock.tools.mockResolvedValue([]);
    clientMock.warnings.mockResolvedValue([]);
    clientMock.config.mockResolvedValue(appConfigFixture());
    clientMock.updateConfig.mockImplementation((config: Partial<Pick<AppConfig, "terminal" | "skillhub">>) =>
      Promise.resolve(appConfigFixture(config.terminal?.mode ?? "new-window", config.skillhub?.rootDir))
    );
    clientMock.skillhub.mockResolvedValue({
      config: { rootDir: "C:\\tmp\\github-repo-manager\\skillhub", libraryDir: "C:\\tmp\\github-repo-manager\\skillhub\\library" },
      sources: [],
      skills: []
    });
    clientMock.checkSkillHubUpdates.mockResolvedValue({ previews: [] });
    clientMock.openSkillHubSkill.mockResolvedValue({ opened: true, path: "C:\\tmp\\github-repo-manager\\skillhub\\library\\review\\SKILL.md" });
    clientMock.projectToolTargets.mockResolvedValue([]);
    clientMock.projectSkillTargets.mockResolvedValue({ projectId: "project-1", toolTargets: [], skillTargets: [], skills: [] });
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
    clientMock.repairCandidates.mockResolvedValue([]);
    clientMock.drives.mockResolvedValue([{ root: "E:\\", label: "E:\\" }]);
    clientMock.pickDirectory.mockResolvedValue({ path: "E:\\picked", cancelled: false });
    clientMock.createDirectory.mockResolvedValue({ path: "E:\\picked\\demo-project" });
    clientMock.setDataDir.mockResolvedValue({
      initialized: true,
      dataDir: "C:\\tmp\\github-repo-manager-next",
      defaultDataDir: "C:\\tmp\\github-repo-manager",
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
        scanStatus=""
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

  it("renders home stats and project actions in the topbar without the overview label", async () => {
    const projects = [
      { ...projectFixture("E:\\repo-a"), id: "project-a", sessionCount: 3 },
      { ...projectFixture("E:\\repo-b"), id: "project-b", sessionCount: 2 }
    ];
    clientMock.projects.mockResolvedValue(projects);

    const { container } = render(<App />);

    await screen.findByText("repo-a");

    const topbar = container.querySelector(".topbar") as HTMLElement;
    const stats = within(topbar).getByLabelText("项目统计");
    expect(within(topbar).queryByText("项目总览")).not.toBeInTheDocument();
    expect(within(stats).getByText("项目")).toBeInTheDocument();
    expect(within(stats).getByText("2")).toBeInTheDocument();
    expect(within(stats).getByText("会话")).toBeInTheDocument();
    expect(within(stats).getByText("5")).toBeInTheDocument();
    expect(within(topbar).getByRole("button", { name: "新建项目" })).toBeInTheDocument();
    expect(within(topbar).getByText("添加项目")).toBeInTheDocument();
    expect(within(topbar).getByRole("button", { name: "选择文件夹" })).toBeInTheDocument();
    expect(within(topbar).getByText("扫描项目")).toBeInTheDocument();
    expect(within(topbar).getByRole("button", { name: "扫描" })).toBeInTheDocument();
  });

  it("opens SkillHub from the topbar", async () => {
    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByRole("button", { name: "SkillHub" }));

    expect(await screen.findByRole("heading", { name: "SkillHub" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "技能分发中心" })).not.toBeInTheDocument();
    expect(clientMock.skillhub).toHaveBeenCalledWith("");
    expect(screen.getByText("还没有技能")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(await screen.findByText("还没有项目")).toBeInTheDocument();
  });

  it("separates SkillHub import/search and groups skills by source", async () => {
    const localSource = skillHubSourceFixture("source-local", "local-source", "local");
    const githubSource = skillHubSourceFixture("source-github", "owner/repo", "github");
    clientMock.skillhub.mockResolvedValue({
      config: { rootDir: "C:\\tmp\\github-repo-manager\\skillhub", libraryDir: "C:\\tmp\\github-repo-manager\\skillhub\\library" },
      sources: [localSource, githubSource],
      skills: [
        skillHubSkillFixture(localSource, "skill-1", "review", "Review code"),
        skillHubSkillFixture(githubSource, "skill-2", "triage", "Triage issues")
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

    const sourceDetails = sourceList.querySelector("details.skillhub-source-group") as HTMLDetailsElement;
    expect(sourceDetails.open).toBe(false);
    fireEvent.click(within(sourceDetails).getByText("local-source"));
    expect(sourceDetails.open).toBe(true);

    const skillDetails = sourceDetails.querySelector("details.skillhub-skill-row") as HTMLDetailsElement;
    expect(skillDetails.open).toBe(false);
    fireEvent.click(within(skillDetails).getByText("review"));
    expect(skillDetails.open).toBe(true);
    expect(within(skillDetails).getByText("Review code")).toBeVisible();

    fireEvent.click(within(skillDetails).getByRole("button", { name: "阅读" }));
    await waitFor(() => expect(clientMock.openSkillHubSkill).toHaveBeenCalledWith("skill-1", "document"));

    fireEvent.click(within(skillDetails).getByRole("button", { name: "管理" }));
    await waitFor(() => expect(clientMock.openSkillHubSkill).toHaveBeenCalledWith("skill-1", "folder"));
    expect(within(skillDetails).getByRole("button", { name: "删除" })).toBeInTheDocument();
  });

  it("moves SkillHub update checks into the topbar and shows source-level update previews", async () => {
    const githubSource = skillHubSourceFixture("source-github", "owner/repo", "github");
    const updatePreview = skillHubUpdatePreviewFixture(githubSource);
    clientMock.skillhub.mockResolvedValue({
      config: { rootDir: "C:\\tmp\\github-repo-manager\\skillhub", libraryDir: "C:\\tmp\\github-repo-manager\\skillhub\\library" },
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
        scanStatus=""
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

  it("surfaces scan progress while a scan is running", () => {
    render(
      <HomePage
        projects={[]}
        busy={true}
        scanStatus={"正在扫描：E:\\workspace"}
        scanResult={null}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onAddScanCandidate={vi.fn()}
        onCloseScanResults={vi.fn()}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在扫描：E:\\workspace");
  });

  it("shows scan progress before the scan request resolves", async () => {
    let resolveScan: (value: { scanRunId: string; candidates: [] }) => void = () => {};
    clientMock.startScan.mockReturnValue(
      new Promise((resolve) => {
        resolveScan = resolve;
      })
    );

    render(<App />);

    await screen.findByText("还没有项目");
    await waitFor(() => expect(screen.getByRole("button", { name: "扫描" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "扫描" }));

    expect(await screen.findByRole("status")).toHaveTextContent("正在扫描：E:\\");

    resolveScan({ scanRunId: "scan-1", candidates: [] });
    expect(await screen.findByText("扫描完成：未发现候选")).toBeInTheDocument();
  });

  it("opens settings instead of showing the working directory in the topbar", async () => {
    clientMock.pickDirectory.mockResolvedValueOnce({ path: "C:\\tmp\\github-repo-manager-next", cancelled: false });
    render(<App />);

    await screen.findByText("还没有项目");
    expect(screen.queryByText("C:\\tmp\\github-repo-manager")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    const dialog = screen.getByRole("dialog", { name: "应用设置" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("当前工作目录")).toBeInTheDocument();
    expect(screen.getAllByText("C:\\tmp\\github-repo-manager").length).toBeGreaterThan(0);

    expect(within(dialog).queryByText("设置")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("新的工作目录")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "保存工作目录" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "更换工作目录" }));

    await waitFor(() => expect(clientMock.setDataDir).toHaveBeenCalledWith("C:\\tmp\\github-repo-manager-next"));
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
        scanStatus=""
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
          targetPath: "C:\\tmp\\github-repo-manager\\skillhub\\library\\review",
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
          libraryPath: "C:\\tmp\\github-repo-manager\\skillhub\\library\\local\\review",
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

  it("places refresh index before settings outside project detail", async () => {
    const { container } = render(<App />);

    await screen.findByText("还没有项目");

    const topbarActions = container.querySelector(".topbar-actions") as HTMLElement;
    const refreshButton = within(topbarActions).getByRole("button", { name: "刷新索引" });
    const settingsButton = within(topbarActions).getByRole("button", { name: "设置" });
    expect(refreshButton.compareDocumentPosition(settingsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

function projectToolTargetFixture(project: Project, toolId: ToolId, enabled: boolean): ProjectToolTarget {
  return {
    projectId: project.id,
    toolId,
    enabled,
    inferred: false,
    supported: true,
    skillDirectory: `${project.rootPath}\\.${toolId}\\skills`,
    reason: null,
    updatedAt: "2026-06-01T00:00:00Z"
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
    libraryPath: `C:\\tmp\\github-repo-manager\\skillhub\\library\\${source.id}\\${folderName}`,
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

function appConfigFixture(mode: AppConfig["terminal"]["mode"] = "new-window", skillHubRoot = "C:\\tmp\\github-repo-manager\\skillhub"): AppConfig {
  return {
    version: 1,
    tools: {
      codex: { command: "codex" },
      claude: { command: "claude" },
      opencode: { command: "opencode" },
      qwen: { command: "qwen" },
      qoder: { command: "qodercli" },
      copilot: { command: "copilot" }
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
