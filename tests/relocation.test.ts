import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AppContext } from "../src/server/appContext.js";
import { createHttpApp } from "../src/server/http/app.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;
let context: AppContext | null = null;

afterEach(() => {
  context?.close();
  context = null;
  if (directory) cleanup(directory);
  directory = null;
});

describe("project relocation", () => {
  it("previews and confirms cwd-only writeback with backups and index rebuild", async () => {
    directory = testDir("relocation");
    const oldRoot = path.join(directory, "old-repo");
    const newRoot = path.join(directory, "new-repo");
    const sessionSource = path.join(directory, "sessions");
    fs.mkdirSync(oldRoot, { recursive: true });
    fs.mkdirSync(newRoot, { recursive: true });
    fs.mkdirSync(sessionSource, { recursive: true });
    const sourceFile = path.join(sessionSource, "codex-session.jsonl");
    fs.writeFileSync(
      sourceFile,
      [
        JSON.stringify({
          type: "session_meta",
          payload: { id: "codex-relocate-1", cwd: oldRoot },
          title: "迁移会话",
          timestamp: "2026-06-01T01:00:00Z"
        }),
        JSON.stringify({
          role: "user",
          content: `message mentions ${oldRoot}`,
          tool_input: { cwd: oldRoot },
          timestamp: "2026-06-01T02:00:00Z"
        })
      ].join("\n")
    );

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [sessionSource];
    context.config().tools.claude.sessionSources = [path.join(directory, "missing-claude-sessions")];
    context.config().tools.opencode.sessionSources = [path.join(directory, "missing-opencode-sessions")];
    context.config().tools.qwen.sessionSources = [path.join(directory, "missing-qwen-sessions")];
    context.config().tools.qoder.sessionSources = [path.join(directory, "missing-qoder-sessions")];
    context.config().tools.copilot.sessionSources = [path.join(directory, "missing-copilot-sessions")];
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const project = context.database().addProject(oldRoot, true).project;

    await request(app).post("/api/sessions/refresh").set("x-local-api-token", context.token).expect(200);

    const preview = await request(app)
      .post("/api/relocations/preview")
      .set("x-local-api-token", context.token)
      .send({ oldRoot, newRoot })
      .expect(200);

    expect(preview.body).toMatchObject({
      oldRoot,
      newRoot,
      affectedSessionCount: 1,
      affectedFileCount: 1,
      changes: [{ oldCwd: oldRoot, newCwd: newRoot }]
    });

    const rejected = await request(app)
      .post("/api/relocations/confirm")
      .set("x-local-api-token", context.token)
      .send({ oldRoot, newRoot })
      .expect(400);
    expect(rejected.body.error).toBe("relocation-confirmation-required");

    const confirmed = await request(app)
      .post("/api/relocations/confirm")
      .set("x-local-api-token", context.token)
      .send({ oldRoot, newRoot, confirmation: "RELOCATE" })
      .expect(200);

    expect(confirmed.body).toMatchObject({
      affectedSessionCount: 1,
      affectedFileCount: 1,
      changedFileCount: 1,
      changedFieldCount: 1,
      refreshResult: {
        scanRun: {
          scope: "relocation",
          roots: [sourceFile]
        },
        indexedCount: 1
      }
    });
    expect(confirmed.body.backups[0].originalFile).toBe(sourceFile);
    expect(fs.existsSync(confirmed.body.backups[0].backupFile)).toBe(true);

    const lines = fs.readFileSync(sourceFile, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    expect(lines[0].payload.cwd).toBe(newRoot);
    expect(lines[1].content).toBe(`message mentions ${oldRoot}`);
    expect(lines[1].tool_input.cwd).toBe(oldRoot);

    const projects = await request(app).get("/api/projects").set("x-local-api-token", context.token).expect(200);
    expect(projects.body[0]).toMatchObject({ id: project.id, rootPath: newRoot, sessionCount: 1 });

    const detail = await request(app)
      .get(`/api/projects/${project.id}/detail`)
      .set("x-local-api-token", context.token)
      .expect(200);
    expect(detail.body.project.rootPath).toBe(newRoot);
    expect(detail.body.groups[0].fullPath).toBe(newRoot);
    expect(detail.body.groups[0].tools[0].sessions[0].originalCwd).toBe(newRoot);
  });

  it("moves Claude project-scoped source files to the relocated project path", async () => {
    directory = testDir("relocation-claude-source");
    const oldRoot = path.join(directory, "old-repo");
    const newRoot = path.join(directory, "new-repo");
    const claudeProjects = path.join(directory, ".claude", "projects");
    const sessionDirectory = "6d9d729f-a642-46f1-b215-085a80d0c4db";
    const oldClaudeSubagents = path.join(claudeProjects, encodeClaudeProjectPath(oldRoot), sessionDirectory, "subagents");
    const newSourceFile = path.join(claudeProjects, encodeClaudeProjectPath(newRoot), sessionDirectory, "subagents", "agent-1.jsonl");
    const sourceFile = path.join(oldClaudeSubagents, "agent-1.jsonl");
    fs.mkdirSync(oldRoot, { recursive: true });
    fs.mkdirSync(newRoot, { recursive: true });
    fs.mkdirSync(oldClaudeSubagents, { recursive: true });
    fs.writeFileSync(
      sourceFile,
      JSON.stringify({
        sessionId: "claude-relocate-1",
        cwd: oldRoot,
        title: "迁移 Claude 会话",
        timestamp: "2026-06-01T01:00:00Z"
      })
    );

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [path.join(directory, "missing-codex-sessions")];
    context.config().tools.claude.sessionSources = [claudeProjects];
    context.config().tools.opencode.sessionSources = [path.join(directory, "missing-opencode-sessions")];
    context.config().tools.qwen.sessionSources = [path.join(directory, "missing-qwen-sessions")];
    context.config().tools.qoder.sessionSources = [path.join(directory, "missing-qoder-sessions")];
    context.config().tools.copilot.sessionSources = [path.join(directory, "missing-copilot-sessions")];
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const project = context.database().addProject(oldRoot, true).project;

    await request(app).post("/api/sessions/refresh").set("x-local-api-token", context.token).expect(200);

    const confirmed = await request(app)
      .post("/api/relocations/confirm")
      .set("x-local-api-token", context.token)
      .send({ oldRoot, newRoot, confirmation: "RELOCATE" })
      .expect(200);

    expect(confirmed.body.refreshResult.scanRun.roots).toEqual([newSourceFile]);
    expect(fs.existsSync(sourceFile)).toBe(false);
    expect(fs.existsSync(newSourceFile)).toBe(true);

    const line = JSON.parse(fs.readFileSync(newSourceFile, "utf8"));
    expect(line.cwd).toBe(newRoot);

    const detail = await request(app)
      .get(`/api/projects/${project.id}/detail`)
      .set("x-local-api-token", context.token)
      .expect(200);
    const session = detail.body.groups[0].tools[0].sessions[0];
    expect(session.originalCwd).toBe(newRoot);
    expect(session.sourceFile).toBe(newSourceFile);
  });

  it("moves Qwen project-scoped source files to the relocated project path", async () => {
    directory = testDir("relocation-qwen-source");
    const oldRoot = path.join(directory, "old-project");
    const newRoot = path.join(directory, "new-project");
    const qwenProjects = path.join(directory, ".qwen", "projects");
    const nativeSessionId = "e83d984f-d610-4eae-bff9-8273372bea97";
    const sourceFile = path.join(qwenProjects, encodeQwenProjectPath(oldRoot), "chats", `${nativeSessionId}.jsonl`);
    const newSourceFile = path.join(qwenProjects, encodeQwenProjectPath(newRoot), "chats", `${nativeSessionId}.jsonl`);
    fs.mkdirSync(oldRoot, { recursive: true });
    fs.mkdirSync(newRoot, { recursive: true });
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(
      sourceFile,
      JSON.stringify({
        sessionId: nativeSessionId,
        cwd: oldRoot,
        type: "user",
        message: { role: "user", parts: [{ text: "继续 Qwen 会话" }] },
        timestamp: "2026-06-01T01:00:00Z"
      })
    );

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [path.join(directory, "missing-codex-sessions")];
    context.config().tools.claude.sessionSources = [path.join(directory, "missing-claude-sessions")];
    context.config().tools.opencode.sessionSources = [path.join(directory, "missing-opencode-sessions")];
    context.config().tools.qwen.sessionSources = [qwenProjects];
    context.config().tools.qoder.sessionSources = [path.join(directory, "missing-qoder-sessions")];
    context.config().tools.copilot.sessionSources = [path.join(directory, "missing-copilot-sessions")];
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const project = context.database().addProject(oldRoot, true).project;

    await request(app).post("/api/sessions/refresh").set("x-local-api-token", context.token).expect(200);

    const confirmed = await request(app)
      .post("/api/relocations/confirm")
      .set("x-local-api-token", context.token)
      .send({ oldRoot, newRoot, confirmation: "RELOCATE" })
      .expect(200);

    expect(confirmed.body.refreshResult.scanRun.roots).toEqual([newSourceFile]);
    expect(fs.existsSync(sourceFile)).toBe(false);
    expect(fs.existsSync(newSourceFile)).toBe(true);

    const line = JSON.parse(fs.readFileSync(newSourceFile, "utf8"));
    expect(line.cwd).toBe(newRoot);

    const detail = await request(app)
      .get(`/api/projects/${project.id}/detail`)
      .set("x-local-api-token", context.token)
      .expect(200);
    const session = detail.body.groups[0].tools[0].sessions[0];
    expect(session.originalCwd).toBe(newRoot);
    expect(session.sourceFile).toBe(newSourceFile);
    expect(session.resumeStatus).toBe("ready");
  });

  it("merges the source project when relocation targets an existing managed project", async () => {
    directory = testDir("relocation-existing-target");
    const oldRoot = path.join(directory, "old-repo");
    const newRoot = path.join(directory, "new-repo");
    const sessionSource = path.join(directory, "sessions");
    fs.mkdirSync(newRoot, { recursive: true });
    fs.mkdirSync(sessionSource, { recursive: true });
    const sourceFile = path.join(sessionSource, "codex-session.jsonl");
    fs.writeFileSync(
      sourceFile,
      JSON.stringify({
        session_meta: { payload: { id: "codex-relocate-merge-1" } },
        cwd: oldRoot,
        title: "迁移到已有项目",
        timestamp: "2026-06-01T01:00:00Z"
      })
    );

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [sessionSource];
    context.config().tools.claude.sessionSources = [path.join(directory, "missing-claude-sessions")];
    context.config().tools.opencode.sessionSources = [path.join(directory, "missing-opencode-sessions")];
    context.config().tools.qwen.sessionSources = [path.join(directory, "missing-qwen-sessions")];
    context.config().tools.qoder.sessionSources = [path.join(directory, "missing-qoder-sessions")];
    context.config().tools.copilot.sessionSources = [path.join(directory, "missing-copilot-sessions")];
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const sourceProject = context.database().addProject(oldRoot, true).project;
    const targetProject = context.database().addProject(newRoot, false).project;

    await request(app).post("/api/sessions/refresh").set("x-local-api-token", context.token).expect(200);

    const confirmed = await request(app)
      .post("/api/relocations/confirm")
      .set("x-local-api-token", context.token)
      .send({ oldRoot, newRoot, confirmation: "RELOCATE" })
      .expect(200);

    expect(confirmed.body.projectMerges).toEqual([
      {
        sourceProjectId: sourceProject.id,
        targetProjectId: targetProject.id,
        targetRootPath: newRoot
      }
    ]);

    const projects = await request(app).get("/api/projects").set("x-local-api-token", context.token).expect(200);
    expect(projects.body.map((project: { id: string }) => project.id)).toEqual([targetProject.id]);
    expect(projects.body[0]).toMatchObject({ rootPath: newRoot, includeSubdirectories: true, sessionCount: 1 });
  });

  it("repairs stale Claude source file paths from an earlier relocation", async () => {
    directory = testDir("relocation-claude-stale-source");
    const previousRoot = path.join(directory, "previous-repo");
    const currentRoot = path.join(directory, "current-repo");
    const nextRoot = path.join(directory, "next-repo");
    const claudeProjects = path.join(directory, ".claude", "projects");
    const sessionDirectory = "6d9d729f-a642-46f1-b215-085a80d0c4db";
    const staleSubagents = path.join(claudeProjects, encodeClaudeProjectPath(previousRoot), sessionDirectory, "subagents");
    const staleSourceFile = path.join(staleSubagents, "agent-1.jsonl");
    const nextSourceFile = path.join(claudeProjects, encodeClaudeProjectPath(nextRoot), sessionDirectory, "subagents", "agent-1.jsonl");
    fs.mkdirSync(currentRoot, { recursive: true });
    fs.mkdirSync(nextRoot, { recursive: true });
    fs.mkdirSync(staleSubagents, { recursive: true });
    fs.writeFileSync(
      staleSourceFile,
      JSON.stringify({
        sessionId: "claude-relocate-stale-1",
        cwd: currentRoot,
        title: "二次迁移 Claude 会话",
        timestamp: "2026-06-01T01:00:00Z"
      })
    );

    context = new AppContext(directory);
    context.config().tools.codex.sessionSources = [path.join(directory, "missing-codex-sessions")];
    context.config().tools.claude.sessionSources = [claudeProjects];
    context.config().tools.opencode.sessionSources = [path.join(directory, "missing-opencode-sessions")];
    context.config().tools.qwen.sessionSources = [path.join(directory, "missing-qwen-sessions")];
    context.config().tools.qoder.sessionSources = [path.join(directory, "missing-qoder-sessions")];
    context.config().tools.copilot.sessionSources = [path.join(directory, "missing-copilot-sessions")];
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    const project = context.database().addProject(currentRoot, true).project;

    await request(app).post("/api/sessions/refresh").set("x-local-api-token", context.token).expect(200);

    const before = await request(app)
      .get(`/api/projects/${project.id}/detail`)
      .set("x-local-api-token", context.token)
      .expect(200);
    expect(before.body.groups[0].tools[0].sessions[0].sourceFile).toBe(staleSourceFile);

    const confirmed = await request(app)
      .post("/api/relocations/confirm")
      .set("x-local-api-token", context.token)
      .send({ oldRoot: currentRoot, newRoot: nextRoot, confirmation: "RELOCATE" })
      .expect(200);

    expect(confirmed.body.refreshResult.scanRun.roots).toEqual([nextSourceFile]);
    expect(fs.existsSync(staleSourceFile)).toBe(false);
    expect(fs.existsSync(nextSourceFile)).toBe(true);

    const line = JSON.parse(fs.readFileSync(nextSourceFile, "utf8"));
    expect(line.cwd).toBe(nextRoot);

    const detail = await request(app)
      .get(`/api/projects/${project.id}/detail`)
      .set("x-local-api-token", context.token)
      .expect(200);
    const session = detail.body.groups[0].tools[0].sessions[0];
    expect(session.originalCwd).toBe(nextRoot);
    expect(session.sourceFile).toBe(nextSourceFile);
  });
});

function encodeClaudeProjectPath(input: string): string {
  return path.resolve(input).replace(/[:\\/]/g, "-");
}

function encodeQwenProjectPath(input: string): string {
  return path.resolve(input).toLowerCase().replace(/[^a-zA-Z0-9]/g, "-");
}
