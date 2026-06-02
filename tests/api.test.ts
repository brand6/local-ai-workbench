import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AppContext } from "../src/server/appContext.js";
import { createHttpApp } from "../src/server/http/app.js";
import { cleanup, testDir } from "./helpers.js";
import { createOpencodeDb } from "./opencodeDb.js";

let directory: string | null = null;
let context: AppContext | null = null;

afterEach(() => {
  context?.close();
  context = null;
  if (directory) cleanup(directory);
  directory = null;
});

describe("API", () => {
  it("rejects calls without the startup token", async () => {
    directory = testDir("api-token");
    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    await request(app).get("/api/projects").expect(401);
  });

  it("adds projects and returns grouped detail", async () => {
    directory = testDir("api-projects");
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot);
    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    const added = await request(app)
      .post("/api/projects")
      .set("x-local-api-token", context.token)
      .send({ rootPath: projectRoot })
      .expect(201);

    const projectId = added.body.project.id as string;
    const list = await request(app).get("/api/projects").set("x-local-api-token", context.token).expect(200);
    expect(list.body).toHaveLength(1);

    const detail = await request(app)
      .get(`/api/projects/${projectId}/detail`)
      .set("x-local-api-token", context.token)
      .expect(200);
    expect(detail.body.groups[0].isRoot).toBe(true);
  });

  it("injects the local API token into the production index", async () => {
    directory = testDir("api-index-token");
    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false });

    const response = await request(app).get("/").expect(200);
    expect(response.text).toContain("window.__LOCAL_API_TOKEN__");
    expect(response.text).toContain(context.token);
  });

  it("allows local filesystem helpers before the data directory is initialized", async () => {
    directory = testDir("api-local-filesystem-bootstrap");
    const previousAppData = process.env.APPDATA;
    const previousLocalAppData = process.env.LOCALAPPDATA;
    process.env.APPDATA = path.join(directory, "roaming");
    process.env.LOCALAPPDATA = path.join(directory, "local");
    try {
      context = new AppContext(null);
      const app = await createHttpApp(context, { dev: false, serveClient: false });

      expect(context.bootstrapState().initialized).toBe(false);
      await request(app).get("/api/local-filesystem/drives").set("x-local-api-token", context.token).expect(200);
      await request(app).get("/api/projects").set("x-local-api-token", context.token).expect(409);
    } finally {
      process.env.APPDATA = previousAppData;
      process.env.LOCALAPPDATA = previousLocalAppData;
    }
  });

  it("refreshes sessions before scanning project candidates", async () => {
    directory = testDir("api-scan-refresh");
    const projectRoot = path.join(directory, "repo");
    const traceOnlyRoot = path.join(directory, "trace-only");
    const sessionSource = path.join(directory, "sessions");
    fs.mkdirSync(path.join(projectRoot, ".codex"), { recursive: true });
    fs.mkdirSync(path.join(traceOnlyRoot, ".codex"), { recursive: true });
    fs.mkdirSync(sessionSource, { recursive: true });
    fs.writeFileSync(
      path.join(sessionSource, "codex-session.jsonl"),
      JSON.stringify({
        session_meta: { payload: { id: "codex-scan-1", cwd: projectRoot } },
        title: "扫描到的会话",
        timestamp: "2026-06-01T01:00:00Z"
      })
    );

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [sessionSource];
    context.config().tools.claude.sessionSources = [path.join(directory, "missing-claude-sessions")];
    pointMvpBToolsAtMissingSources(context, directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    const scan = await request(app)
      .post("/api/scan-runs")
      .set("x-local-api-token", context.token)
      .send({ roots: [directory] })
      .expect(201);

    expect(scan.body.candidates).toHaveLength(2);
    expect(scan.body.candidates.some((candidate: { path: string; sessionCounts: { codex?: number } }) => {
      return candidate.path === projectRoot && candidate.sessionCounts.codex === 1;
    })).toBe(true);

    const confirmed = await request(app)
      .post(`/api/scan-runs/${scan.body.scanRunId}/confirm`)
      .set("x-local-api-token", context.token)
      .send({ candidateIds: scan.body.candidates.map((candidate: { id: string }) => candidate.id) })
      .expect(200);
    expect(confirmed.body).toHaveLength(1);
    expect(confirmed.body[0].rootPath).toBe(projectRoot);

    const projects = await request(app).get("/api/projects").set("x-local-api-token", context.token).expect(200);
    expect(projects.body).toHaveLength(1);
    expect(projects.body[0].sessionCount).toBe(1);
  });

  it("refreshes selected tool indexes and adds session-only projects", async () => {
    directory = testDir("api-refresh-selected-tools-session-projects");
    const codexRoot = path.join(directory, "codex-repo");
    const oldOpencodeRoot = path.join(directory, "old", "opencode-game-studios");
    const codexSource = path.join(directory, "codex-sessions");
    const opencodeDb = path.join(directory, "opencode", "opencode.db");
    fs.mkdirSync(codexSource, { recursive: true });
    fs.writeFileSync(
      path.join(codexSource, "codex-session.jsonl"),
      JSON.stringify({
        session_meta: { payload: { id: "codex-filtered-out", cwd: codexRoot } },
        title: "不应被本次刷新索引",
        timestamp: "2026-06-01T01:00:00Z"
      })
    );
    createOpencodeDb(opencodeDb, [
      {
        id: "ses_opencode_old_1",
        directory: oldOpencodeRoot,
        title: "旧 OpenCode 项目会话 1",
        timeUpdated: 1780000001000
      },
      {
        id: "ses_opencode_old_2",
        directory: oldOpencodeRoot,
        title: "旧 OpenCode 项目会话 2",
        timeUpdated: 1780000002000
      }
    ]);

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [codexSource];
    context.config().tools.claude.sessionSources = [path.join(directory, "missing-claude-sessions")];
    context.config().tools.opencode.sessionSources = [opencodeDb];
    context.config().tools.qwen.sessionSources = [path.join(directory, "missing-qwen-sessions")];
    context.config().tools.qoder.sessionSources = [path.join(directory, "missing-qoder-sessions")];
    context.config().tools.copilot.sessionSources = [path.join(directory, "missing-copilot-sessions")];
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    const refreshed = await request(app)
      .post("/api/sessions/refresh")
      .set("x-local-api-token", context.token)
      .send({ toolIds: ["opencode"] })
      .expect(200);

    expect(refreshed.body).toMatchObject({ indexedCount: 2, addedProjectCount: 1 });
    expect(context.database().listSessions().map((session) => session.toolId)).toEqual(["opencode", "opencode"]);

    const projects = await request(app).get("/api/projects").set("x-local-api-token", context.token).expect(200);
    expect(projects.body).toHaveLength(1);
    expect(projects.body[0]).toMatchObject({
      rootPath: oldOpencodeRoot,
      sessionOnly: true,
      sessionCount: 2
    });
    expect(projects.body.map((project: { rootPath: string }) => project.rootPath)).not.toContain(codexRoot);
  });

  it("can confirm zero-session scan candidates when requested", async () => {
    directory = testDir("api-scan-include-empty");
    const traceOnlyRoot = path.join(directory, "trace-only");
    fs.mkdirSync(path.join(traceOnlyRoot, ".codex"), { recursive: true });

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [path.join(directory, "missing-codex-sessions")];
    context.config().tools.claude.sessionSources = [path.join(directory, "missing-claude-sessions")];
    pointMvpBToolsAtMissingSources(context, directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    const scan = await request(app)
      .post("/api/scan-runs")
      .set("x-local-api-token", context.token)
      .send({ roots: [directory] })
      .expect(201);

    expect(scan.body.candidates).toHaveLength(1);
    expect(scan.body.candidates[0].path).toBe(traceOnlyRoot);

    const confirmed = await request(app)
      .post(`/api/scan-runs/${scan.body.scanRunId}/confirm`)
      .set("x-local-api-token", context.token)
      .send({
        candidateIds: scan.body.candidates.map((candidate: { id: string }) => candidate.id),
        includeEmptyCandidates: true
      })
      .expect(200);

    expect(confirmed.body).toHaveLength(1);
    expect(confirmed.body[0].rootPath).toBe(traceOnlyRoot);
    expect(confirmed.body[0].sessionCount).toBe(0);
  });

  it("filters parser warnings to the selected project", async () => {
    directory = testDir("api-project-warnings");
    const projectRoot = path.join(directory, "github-repo-manager");
    const otherRoot = path.join(directory, "ai-game-space");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(otherRoot, { recursive: true });

    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const project = context.database().addProject(projectRoot, true).project;
    context.database().addParserWarning({
      scanRunId: "scan-1",
      toolId: "claude",
      sourceFile: claudeProjectSource(directory, projectRoot, "own.meta.json"),
      errorType: "missing-cwd",
      message: "current project warning",
      line: null
    });
    context.database().addParserWarning({
      scanRunId: "scan-1",
      toolId: "claude",
      sourceFile: claudeProjectSource(directory, otherRoot, "other.meta.json"),
      errorType: "missing-cwd",
      message: "other project warning",
      line: null
    });

    const filtered = await request(app)
      .get(`/api/parser-warnings?projectId=${project.id}`)
      .set("x-local-api-token", context.token)
      .expect(200);

    expect(filtered.body.map((warning: { message: string }) => warning.message)).toEqual(["current project warning"]);
  });

  it("repairs a missing-cwd project by merging it into an existing target project", async () => {
    directory = testDir("api-project-repair");
    const oldRoot = path.join(directory, "old-knights");
    const newRoot = path.join(directory, "new-knights");
    const unrelatedRoot = path.join(directory, "ai-working-space");
    const sessionSource = path.join(directory, "sessions");
    fs.mkdirSync(newRoot, { recursive: true });
    fs.mkdirSync(unrelatedRoot, { recursive: true });
    fs.mkdirSync(sessionSource, { recursive: true });
    fs.writeFileSync(
      path.join(sessionSource, "old.jsonl"),
      JSON.stringify({
        session_meta: { payload: { id: "old-knights-1" } },
        cwd: oldRoot,
        title: "骑士对决旧项目",
        timestamp: "2026-06-01T01:00:00Z"
      })
    );
    fs.writeFileSync(
      path.join(sessionSource, "new.jsonl"),
      JSON.stringify({
        session_meta: { payload: { id: "new-knights-1" } },
        cwd: newRoot,
        title: "骑士对决新项目",
        timestamp: "2026-06-01T02:00:00Z"
      })
    );
    fs.writeFileSync(
      path.join(sessionSource, "unrelated.jsonl"),
      JSON.stringify({
        session_meta: { payload: { id: "unrelated-1" } },
        cwd: unrelatedRoot,
        title: "[Request interrupted by user]",
        timestamp: "2026-06-01T03:00:00Z"
      })
    );

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [sessionSource];
    context.config().tools.claude.sessionSources = [path.join(directory, "missing-claude-sessions")];
    pointMvpBToolsAtMissingSources(context, directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const sourceProject = context.database().addProject(oldRoot, true).project;
    const targetProject = context.database().addProject(newRoot, false).project;
    const unrelatedProject = context.database().addProject(unrelatedRoot, false).project;
    await request(app).post("/api/sessions/refresh").set("x-local-api-token", context.token).expect(200);

    const candidates = await request(app)
      .get(`/api/projects/${sourceProject.id}/repair-candidates`)
      .set("x-local-api-token", context.token)
      .expect(200);
    expect(candidates.body[0]).toMatchObject({ projectId: targetProject.id, rootPath: newRoot });
    expect(candidates.body.map((candidate: { projectId: string }) => candidate.projectId)).not.toContain(unrelatedProject.id);

    const repaired = await request(app)
      .post(`/api/projects/${sourceProject.id}/repair`)
      .set("x-local-api-token", context.token)
      .send({ targetProjectId: targetProject.id })
      .expect(200);

    expect(repaired.body).toMatchObject({
      sourceProjectId: sourceProject.id,
      targetProjectId: targetProject.id,
      relocation: {
        changedFileCount: 1,
        projectMerges: [{ sourceProjectId: sourceProject.id, targetProjectId: targetProject.id }]
      }
    });

    const projects = await request(app).get("/api/projects").set("x-local-api-token", context.token).expect(200);
    expect(projects.body.map((project: { id: string }) => project.id)).toEqual(expect.arrayContaining([targetProject.id, unrelatedProject.id]));
    expect(projects.body.map((project: { id: string }) => project.id)).not.toContain(sourceProject.id);
    expect(projects.body.find((project: { id: string }) => project.id === targetProject.id)).toMatchObject({
      rootPath: newRoot,
      sessionCount: 2
    });
  });

  it("relocates a managed project by moving files and rebasing session paths", async () => {
    directory = testDir("api-project-relocate");
    const oldRoot = path.join(directory, "old-repo");
    const newRoot = path.join(directory, "new-repo");
    const sessionSource = path.join(oldRoot, ".codex", "sessions");
    const oldSourceFile = path.join(sessionSource, "codex-session.jsonl");
    const newSourceFile = path.join(newRoot, ".codex", "sessions", "codex-session.jsonl");
    fs.mkdirSync(sessionSource, { recursive: true });
    fs.mkdirSync(newRoot, { recursive: true });
    fs.writeFileSync(path.join(oldRoot, "README.md"), "# old repo\n");
    fs.writeFileSync(
      oldSourceFile,
      JSON.stringify({
        session_meta: { payload: { id: "codex-relocate-project-1", cwd: oldRoot } },
        title: "迁移项目会话",
        timestamp: "2026-06-01T01:00:00Z"
      })
    );

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [sessionSource];
    context.config().tools.claude.sessionSources = [path.join(directory, "missing-claude-sessions")];
    pointMvpBToolsAtMissingSources(context, directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const project = context.database().addProject(oldRoot, true).project;

    await request(app).post("/api/sessions/refresh").set("x-local-api-token", context.token).expect(200);

    const relocated = await request(app)
      .post(`/api/projects/${project.id}/relocate`)
      .set("x-local-api-token", context.token)
      .send({ newRoot })
      .expect(200);

    expect(relocated.body).toMatchObject({
      oldRoot,
      newRoot,
      changedFileCount: 1,
      changedFieldCount: 1,
      refreshResult: {
        scanRun: {
          roots: [newSourceFile]
        },
        indexedCount: 1
      }
    });
    expect(fs.existsSync(oldRoot)).toBe(false);
    expect(fs.existsSync(path.join(newRoot, "README.md"))).toBe(true);
    expect(fs.existsSync(oldSourceFile)).toBe(false);
    expect(fs.existsSync(newSourceFile)).toBe(true);

    const line = JSON.parse(fs.readFileSync(newSourceFile, "utf8"));
    expect(line.session_meta.payload.cwd).toBe(newRoot);

    const detail = await request(app)
      .get(`/api/projects/${project.id}/detail`)
      .set("x-local-api-token", context.token)
      .expect(200);
    expect(detail.body.project.rootPath).toBe(newRoot);
    expect(detail.body.groups[0].tools[0].sessions[0]).toMatchObject({
      originalCwd: newRoot,
      sourceFile: newSourceFile
    });
  });

  it("matches likely relocated project names from missing-cwd session titles", async () => {
    directory = testDir("api-project-repair-name-match");
    const oldRoot = path.join(directory, "new-ai-game");
    const knightRoot = path.join(directory, "Knight Academy");
    const unrelatedRoot = path.join(directory, "san-guo-game");
    const sessionSource = path.join(directory, "sessions");
    fs.mkdirSync(knightRoot, { recursive: true });
    fs.mkdirSync(unrelatedRoot, { recursive: true });
    fs.mkdirSync(sessionSource, { recursive: true });
    fs.writeFileSync(
      path.join(sessionSource, "old.jsonl"),
      JSON.stringify({
        session_meta: { payload: { id: "new-ai-game-1" } },
        cwd: oldRoot,
        title: "/brainstorm 开罗小游戏，主题是骑士对决",
        timestamp: "2026-06-01T01:00:00Z"
      })
    );
    fs.writeFileSync(
      path.join(sessionSource, "unrelated.jsonl"),
      JSON.stringify({
        session_meta: { payload: { id: "unrelated-1" } },
        cwd: unrelatedRoot,
        title: "人物是皮影戏风格的话适合做什么玩法",
        timestamp: "2026-06-01T02:00:00Z"
      })
    );

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [sessionSource];
    context.config().tools.claude.sessionSources = [path.join(directory, "missing-claude-sessions")];
    pointMvpBToolsAtMissingSources(context, directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const sourceProject = context.database().addProject(oldRoot, false).project;
    const knightProject = context.database().addProject(knightRoot, true).project;
    const unrelatedProject = context.database().addProject(unrelatedRoot, false).project;
    await request(app).post("/api/sessions/refresh").set("x-local-api-token", context.token).expect(200);

    const candidates = await request(app)
      .get(`/api/projects/${sourceProject.id}/repair-candidates`)
      .set("x-local-api-token", context.token)
      .expect(200);

    expect(candidates.body[0]).toMatchObject({ projectId: knightProject.id, rootPath: knightRoot });
    expect(candidates.body[0].reasons.join("；")).toContain("项目名关键词匹配");
    expect(candidates.body.map((candidate: { projectId: string }) => candidate.projectId)).not.toContain(unrelatedProject.id);
  });

  it("matches relocated projects from root metadata when the target has no indexed sessions", async () => {
    directory = testDir("api-project-repair-root-metadata");
    const oldRoot = path.join(directory, "old", "ai-game-space");
    const finalChargeRoot = path.join(directory, "new", "final-charge");
    const unrelatedRoot = path.join(directory, "new", "unrelated-project");
    const sessionSource = path.join(directory, "sessions");
    fs.mkdirSync(finalChargeRoot, { recursive: true });
    fs.mkdirSync(unrelatedRoot, { recursive: true });
    fs.mkdirSync(sessionSource, { recursive: true });
    fs.writeFileSync(path.join(finalChargeRoot, "README.md"), "# 冲锋决 (Charge Duel)\n\n皮影戏风格的 Roguelite 策略对决游戏。\n");
    fs.writeFileSync(path.join(unrelatedRoot, "README.md"), "# unrelated project\n\nA generic tool project.\n");
    fs.writeFileSync(
      path.join(sessionSource, "codex-session.jsonl"),
      JSON.stringify({
        session_meta: { payload: { id: "codex-final-charge-1", cwd: oldRoot } },
        title: "任务：生成“冲锋决”游戏 16:9 横版封面图",
        timestamp: "2026-06-01T01:00:00Z"
      })
    );

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [sessionSource];
    context.config().tools.claude.sessionSources = [path.join(directory, "missing-claude-sessions")];
    pointMvpBToolsAtMissingSources(context, directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const sourceProject = context.database().addProject(oldRoot, false).project;
    const finalChargeProject = context.database().addProject(finalChargeRoot, true).project;
    const unrelatedProject = context.database().addProject(unrelatedRoot, true).project;
    await request(app).post("/api/sessions/refresh").set("x-local-api-token", context.token).expect(200);

    const candidates = await request(app)
      .get(`/api/projects/${sourceProject.id}/repair-candidates`)
      .set("x-local-api-token", context.token)
      .expect(200);

    expect(candidates.body[0]).toMatchObject({ projectId: finalChargeProject.id, rootPath: finalChargeRoot });
    expect(candidates.body[0].reasons.join("；")).toContain("内容关键词匹配");
    expect(candidates.body.map((candidate: { projectId: string }) => candidate.projectId)).not.toContain(unrelatedProject.id);
  });

  it("repairs relocated OpenCode SQLite sessions into the migrated project", async () => {
    directory = testDir("api-opencode-sqlite-repair");
    const oldRoot = path.join(directory, "old", "opencode-game-studios");
    const newRoot = path.join(directory, "new", "opencode-game-studios");
    const opencodeDb = path.join(directory, "opencode", "opencode.db");
    fs.mkdirSync(newRoot, { recursive: true });
    createOpencodeDb(opencodeDb, [
      {
        id: "ses_opencode_repair_1",
        directory: oldRoot,
        title: "项目 AI 文档体系初始化",
        timeUpdated: 1780000001000
      },
      {
        id: "ses_opencode_repair_2",
        directory: oldRoot,
        title: "技能文档一致性分析",
        timeUpdated: 1780000002000
      }
    ]);

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [path.join(directory, "missing-codex-sessions")];
    context.config().tools.claude.sessionSources = [path.join(directory, "missing-claude-sessions")];
    context.config().tools.opencode.sessionSources = [opencodeDb];
    context.config().tools.qwen.sessionSources = [path.join(directory, "missing-qwen-sessions")];
    context.config().tools.qoder.sessionSources = [path.join(directory, "missing-qoder-sessions")];
    context.config().tools.copilot.sessionSources = [path.join(directory, "missing-copilot-sessions")];
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const sourceProject = context.database().addProject(oldRoot, false).project;
    const targetProject = context.database().addProject(newRoot, true).project;
    await request(app).post("/api/sessions/refresh").set("x-local-api-token", context.token).expect(200);

    const candidates = await request(app)
      .get(`/api/projects/${sourceProject.id}/repair-candidates`)
      .set("x-local-api-token", context.token)
      .expect(200);
    expect(candidates.body[0]).toMatchObject({ projectId: targetProject.id, rootPath: newRoot });

    const repaired = await request(app)
      .post(`/api/projects/${sourceProject.id}/repair`)
      .set("x-local-api-token", context.token)
      .send({ targetProjectId: targetProject.id })
      .expect(200);
    expect(repaired.body).toMatchObject({
      sourceProjectId: sourceProject.id,
      targetProjectId: targetProject.id,
      relocation: {
        changedFileCount: 1,
        changedFieldCount: 2,
        projectMerges: [{ sourceProjectId: sourceProject.id, targetProjectId: targetProject.id }]
      }
    });

    const projects = await request(app).get("/api/projects").set("x-local-api-token", context.token).expect(200);
    expect(projects.body.map((project: { id: string }) => project.id)).toEqual([targetProject.id]);
    expect(projects.body[0]).toMatchObject({ rootPath: newRoot, sessionCount: 2 });

    const detail = await request(app)
      .get(`/api/projects/${targetProject.id}/detail`)
      .set("x-local-api-token", context.token)
      .expect(200);
    expect(detail.body.groups[0].tools[0]).toMatchObject({ toolId: "opencode", sessionCount: 2 });
    expect(detail.body.groups[0].tools[0].sessions[0]).toMatchObject({
      originalCwd: newRoot,
      sourceFile: opencodeDb,
      sourceFormat: "opencode-sqlite"
    });
  });

  it("does not let generic tool workflow terms crowd out a same-name repair target", async () => {
    directory = testDir("api-opencode-repair-generic-noise");
    const oldRoot = path.join(directory, "old", "opencode-game-studios");
    const newRoot = path.join(directory, "github", "opencode-game-studios");
    const opencodeDb = path.join(directory, "opencode", "opencode.db");
    fs.mkdirSync(newRoot, { recursive: true });
    const noisyRoots = Array.from({ length: 9 }, (_, index) => path.join(directory, "noise", `generic-project-${index}`));
    for (const noisyRoot of noisyRoots) {
      fs.mkdirSync(noisyRoot, { recursive: true });
      fs.writeFileSync(
        path.join(noisyRoot, "README.md"),
        [
          "# Generic workflow notes",
          "skill writing-skills writing skills command format install installation init structure subagent explore research superpowers",
          "项目初始化 创建目录结构和规范文档 自动修复 探索 内容 架构 配置 技能文档一致性分析"
        ].join("\n")
      );
    }
    createOpencodeDb(opencodeDb, [
      {
        id: "ses_opencode_noise_1",
        directory: oldRoot,
        title: "项目 AI 文档体系初始化",
        timeUpdated: 1780000001000
      },
      {
        id: "ses_opencode_noise_2",
        directory: oldRoot,
        title: "项目初始化 —— 创建目录结构和规范文档 (@build subagent)",
        timeUpdated: 1780000002000
      },
      {
        id: "ses_opencode_noise_3",
        directory: oldRoot,
        title: "AI技能自动修复子Agent方案",
        timeUpdated: 1780000003000
      },
      {
        id: "ses_opencode_noise_4",
        directory: oldRoot,
        title: "Explore OpenCode skill system (@explore subagent)",
        timeUpdated: 1780000004000
      }
    ]);

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [path.join(directory, "missing-codex-sessions")];
    context.config().tools.claude.sessionSources = [path.join(directory, "missing-claude-sessions")];
    context.config().tools.opencode.sessionSources = [opencodeDb];
    context.config().tools.qwen.sessionSources = [path.join(directory, "missing-qwen-sessions")];
    context.config().tools.qoder.sessionSources = [path.join(directory, "missing-qoder-sessions")];
    context.config().tools.copilot.sessionSources = [path.join(directory, "missing-copilot-sessions")];
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const sourceProject = context.database().addProject(oldRoot, false).project;
    const targetProject = context.database().addProject(newRoot, true).project;
    for (const noisyRoot of noisyRoots) {
      context.database().addProject(noisyRoot, true);
    }
    await request(app).post("/api/sessions/refresh").set("x-local-api-token", context.token).expect(200);

    const candidates = await request(app)
      .get(`/api/projects/${sourceProject.id}/repair-candidates`)
      .set("x-local-api-token", context.token)
      .expect(200);

    expect(candidates.body[0]).toMatchObject({ projectId: targetProject.id, rootPath: newRoot });
    expect(candidates.body.map((candidate: { rootPath: string }) => candidate.rootPath)).not.toEqual(expect.arrayContaining(noisyRoots));
  });

  it("matches repair targets from project-relative file paths recorded in session tool calls", async () => {
    directory = testDir("api-project-repair-file-path-match");
    const oldRoot = path.join(directory, "old", "empty-worktree");
    const targetRoot = path.join(directory, "new", "opencode-plugin-pack");
    const unrelatedRoot = path.join(directory, "new", "unrelated-tooling");
    const opencodeDb = path.join(directory, "opencode", "opencode.db");
    fs.mkdirSync(path.join(targetRoot, ".opencode", "commands"), { recursive: true });
    fs.mkdirSync(unrelatedRoot, { recursive: true });
    fs.writeFileSync(path.join(targetRoot, "opencode.json"), "{}");
    fs.writeFileSync(path.join(targetRoot, ".opencode", "commands", "init.md"), "# init\n");
    fs.writeFileSync(path.join(unrelatedRoot, "opencode.json"), "{}");
    createOpencodeDb(opencodeDb, [
      {
        id: "ses_opencode_files_1",
        directory: oldRoot,
        title: "配置初始化",
        parts: [
          {
            type: "tool",
            tool: "write",
            state: { input: { filePath: path.join(oldRoot, "opencode.json"), content: "{}" } }
          },
          {
            type: "tool",
            tool: "write",
            state: { input: { filePath: path.join(oldRoot, ".opencode", "commands", "init.md"), content: "# init\n" } }
          }
        ],
        timeUpdated: 1780000001000
      }
    ]);

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [path.join(directory, "missing-codex-sessions")];
    context.config().tools.claude.sessionSources = [path.join(directory, "missing-claude-sessions")];
    context.config().tools.opencode.sessionSources = [opencodeDb];
    context.config().tools.qwen.sessionSources = [path.join(directory, "missing-qwen-sessions")];
    context.config().tools.qoder.sessionSources = [path.join(directory, "missing-qoder-sessions")];
    context.config().tools.copilot.sessionSources = [path.join(directory, "missing-copilot-sessions")];
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const sourceProject = context.database().addProject(oldRoot, false).project;
    const targetProject = context.database().addProject(targetRoot, true).project;
    const unrelatedProject = context.database().addProject(unrelatedRoot, true).project;
    await request(app).post("/api/sessions/refresh").set("x-local-api-token", context.token).expect(200);

    const candidates = await request(app)
      .get(`/api/projects/${sourceProject.id}/repair-candidates`)
      .set("x-local-api-token", context.token)
      .expect(200);

    expect(candidates.body[0]).toMatchObject({ projectId: targetProject.id, rootPath: targetRoot });
    expect(candidates.body[0].reasons.join("；")).toContain("项目内相对路径匹配");
    expect(candidates.body.find((candidate: { projectId: string }) => candidate.projectId === unrelatedProject.id)?.reasons.join("；")).toContain(
      "文件名匹配"
    );
  });

  it("repairs missing cwd sessions into an indexed child cwd under a managed parent project", async () => {
    directory = testDir("api-project-repair-child-cwd");
    const oldRoot = path.join(directory, "old", "ai-working-space", "lark");
    const parentRoot = path.join(directory, "new", "ai-working-space");
    const childRoot = path.join(parentRoot, "lark");
    const siblingRoot = path.join(parentRoot, "unity");
    const opencodeDb = path.join(directory, "opencode", "opencode.db");
    fs.mkdirSync(childRoot, { recursive: true });
    fs.mkdirSync(siblingRoot, { recursive: true });
    createOpencodeDb(opencodeDb, [
      {
        id: "ses_old_lark",
        directory: oldRoot,
        title: "MainTask.xlsx lark 表格验算",
        timeUpdated: 1780000001000
      },
      {
        id: "ses_new_lark",
        directory: childRoot,
        title: "飞书 lark 数据整理",
        timeUpdated: 1780000002000
      },
      {
        id: "ses_unity",
        directory: siblingRoot,
        title: "Unity 技能分析",
        timeUpdated: 1780000003000
      }
    ]);

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [path.join(directory, "missing-codex-sessions")];
    context.config().tools.claude.sessionSources = [path.join(directory, "missing-claude-sessions")];
    context.config().tools.opencode.sessionSources = [opencodeDb];
    context.config().tools.qwen.sessionSources = [path.join(directory, "missing-qwen-sessions")];
    context.config().tools.qoder.sessionSources = [path.join(directory, "missing-qoder-sessions")];
    context.config().tools.copilot.sessionSources = [path.join(directory, "missing-copilot-sessions")];
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const sourceProject = context.database().addProject(oldRoot, false).project;
    const parentProject = context.database().addProject(parentRoot, true).project;
    await request(app).post("/api/sessions/refresh").set("x-local-api-token", context.token).expect(200);

    const candidates = await request(app)
      .get(`/api/projects/${sourceProject.id}/repair-candidates`)
      .set("x-local-api-token", context.token)
      .expect(200);
    expect(candidates.body[0]).toMatchObject({
      projectId: parentProject.id,
      rootPath: childRoot,
      targetRootPath: childRoot
    });
    expect(candidates.body[0].reasons.join("；")).toContain("父项目子目录");

    const repaired = await request(app)
      .post(`/api/projects/${sourceProject.id}/repair`)
      .set("x-local-api-token", context.token)
      .send({ targetProjectId: parentProject.id, targetRootPath: childRoot })
      .expect(200);
    expect(repaired.body).toMatchObject({
      sourceProjectId: sourceProject.id,
      targetProjectId: parentProject.id,
      targetRootPath: childRoot,
      relocation: {
        changedFileCount: 1,
        changedFieldCount: 1,
        projectMerges: [{ sourceProjectId: sourceProject.id, targetProjectId: parentProject.id, targetRootPath: childRoot }]
      }
    });

    const projects = await request(app).get("/api/projects").set("x-local-api-token", context.token).expect(200);
    expect(projects.body.map((project: { id: string }) => project.id)).toEqual([parentProject.id]);

    const detail = await request(app)
      .get(`/api/projects/${parentProject.id}/detail`)
      .set("x-local-api-token", context.token)
      .expect(200);
    const childGroup = detail.body.groups.find((group: { fullPath: string }) => group.fullPath === childRoot);
    expect(childGroup).toMatchObject({ sessionCount: 2 });
  });
});

function claudeProjectSource(root: string, cwd: string, fileName: string): string {
  return path.join(root, ".claude", "projects", cwd.replace(/[:\\/]/g, "-"), "subagents", fileName);
}

function pointMvpBToolsAtMissingSources(appContext: AppContext, root: string): void {
  appContext.config().tools.opencode.sessionSources = [path.join(root, "missing-opencode-sessions")];
  appContext.config().tools.qwen.sessionSources = [path.join(root, "missing-qwen-sessions")];
  appContext.config().tools.qoder.sessionSources = [path.join(root, "missing-qoder-sessions")];
  appContext.config().tools.copilot.sessionSources = [path.join(root, "missing-copilot-sessions")];
}
