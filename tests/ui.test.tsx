import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Project,
  ProjectDetail,
  ProjectRepairCandidate,
  RefreshResult,
  RelocationResult,
  ScanCandidate,
  ToolId,
  ToolStatus
} from "../src/shared/types.js";
import { App, HomePage, ProjectDetailView } from "../src/client/main.js";

const clientMock = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  projects: vi.fn(),
  detail: vi.fn(),
  tools: vi.fn(),
  warnings: vi.fn(),
  setDataDir: vi.fn(),
  drives: vi.fn(),
  pickDirectory: vi.fn(),
  startScan: vi.fn(),
  addProject: vi.fn(),
  removeProject: vi.fn(),
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
    clientMock.projects.mockResolvedValue([]);
    clientMock.detail.mockResolvedValue(detailFixture(projectFixture("E:\\old")));
    clientMock.tools.mockResolvedValue([]);
    clientMock.warnings.mockResolvedValue([]);
    clientMock.repairCandidates.mockResolvedValue([]);
    clientMock.drives.mockResolvedValue([{ root: "E:\\", label: "E:\\" }]);
    clientMock.pickDirectory.mockResolvedValue({ path: "E:\\picked", cancelled: false });
    clientMock.setDataDir.mockResolvedValue({
      initialized: true,
      dataDir: "C:\\tmp\\github-repo-manager-next",
      defaultDataDir: "C:\\tmp\\github-repo-manager",
      overriddenByArg: true
    });
    clientMock.startScan.mockResolvedValue({ scanRunId: "scan-1", candidates: [] });
    clientMock.addProject.mockResolvedValue({ project: projectFixture("E:\\old"), mergedIntoParent: false, removedChildren: [] });
    clientMock.removeProject.mockResolvedValue({ removed: true });
    clientMock.refreshProject.mockResolvedValue(refreshResultFixture());
    clientMock.refreshSessions.mockResolvedValue(refreshResultFixture());
    clientMock.confirmCandidates.mockResolvedValue([]);
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
    expect(within(topbar).getByText("添加项目")).toBeInTheDocument();
    expect(within(topbar).getByRole("button", { name: "选择文件夹" })).toBeInTheDocument();
    expect(within(topbar).getByText("扫描项目")).toBeInTheDocument();
    expect(within(topbar).getByRole("button", { name: "扫描" })).toBeInTheDocument();
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

    const dialog = screen.getByRole("dialog", { name: "管理工作目录" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("当前工作目录")).toBeInTheDocument();
    expect(screen.getAllByText("C:\\tmp\\github-repo-manager").length).toBeGreaterThan(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "选择文件夹" }));
    expect(await screen.findByText("C:\\tmp\\github-repo-manager-next")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存工作目录" }));

    expect(clientMock.setDataDir).toHaveBeenCalledWith("C:\\tmp\\github-repo-manager-next");
    expect(await screen.findByText("工作目录已更新")).toBeInTheDocument();
  });

  it("opens a folder picker before adding a project", async () => {
    render(<App />);

    await screen.findByText("还没有项目");
    fireEvent.click(screen.getByText("选择文件夹"));

    expect(clientMock.pickDirectory).toHaveBeenCalled();
    expect(await screen.findByText("项目已添加")).toBeInTheDocument();
    expect(clientMock.addProject).toHaveBeenCalledWith("E:\\picked");
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
        onRepairProject={vi.fn()}
        onRelocateProject={vi.fn()}
      />
    );

    expect(screen.getByRole("region", { name: "修复缺失 cwd" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "修复提示" })).toBeInTheDocument();
    expect(screen.getByText("历史 cwd 不存在：E:\\ai-game-space")).toBeInTheDocument();
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
    expect(container.querySelector(".detail-head")).toBeNull();
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
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /codex/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: "开始刷新" }));

    await waitFor(() => expect(clientMock.refreshSessions).toHaveBeenCalledWith(["opencode"]));
    expect(await screen.findByText("索引完成：2 条，会话跳过 0 条，警告 0 条，自动加入 1 个项目")).toBeInTheDocument();
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
