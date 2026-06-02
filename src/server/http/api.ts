import express, { type Express, type Request, type Response } from "express";
import type { ToolId } from "../../shared/types.js";
import { adapterFor, listToolStatuses } from "../tools/adapters.js";
import { refreshAllSessions, refreshProjectSessions } from "../scanning/sessionScanner.js";
import { confirmScanCandidates, scanProjectCandidates } from "../scanning/projectScanner.js";
import { launchInTerminal } from "../launch/terminal.js";
import { confirmRelocation, previewRelocation, relocateManagedProject } from "../relocation/relocation.js";
import { confirmProjectRepair, listProjectRepairCandidates } from "../repair/projectRepair.js";
import { listScanDrives, pickDirectory } from "../core/localFilesystem.js";
import type { AppContext } from "../appContext.js";

export function installApi(app: Express, context: AppContext): void {
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", (request, response, next) => {
    const token = request.header("x-local-api-token");
    if (token !== context.token) {
      response.status(401).json({ error: "invalid-local-token" });
      return;
    }
    next();
  });

  app.get("/api/bootstrap", (_request, response) => {
    response.json(context.bootstrapState());
  });

  app.post("/api/bootstrap/data-dir", (request, response) => {
    const dataDir = stringBody(request, "dataDir");
    if (!dataDir) {
      response.status(400).json({ error: "dataDir is required" });
      return;
    }
    response.json(context.setDataDir(dataDir));
  });

  app.get("/api/local-filesystem/drives", (_request, response) => {
    response.json(listScanDrives());
  });

  app.post("/api/local-filesystem/pick-directory", (_request, response) => {
    response.json(pickDirectory());
  });

  app.use("/api", (_request, response, next) => {
    if (!context.bootstrapState().initialized) {
      response.status(409).json({ error: "data-dir-not-initialized" });
      return;
    }
    next();
  });

  app.get("/api/projects", (_request, response) => {
    response.json(context.database().listProjects());
  });

  app.post("/api/projects", (request, response) => {
    const rootPath = stringBody(request, "rootPath");
    if (!rootPath) {
      response.status(400).json({ error: "rootPath is required" });
      return;
    }
    const includeSubdirectories = Boolean(request.body?.includeSubdirectories);
    response.status(201).json(context.database().addProject(rootPath, includeSubdirectories));
  });

  app.patch("/api/projects/:id", (request, response) => {
    const project = context.database().updateProject(request.params.id, {
      includeSubdirectories:
        typeof request.body?.includeSubdirectories === "boolean" ? request.body.includeSubdirectories : undefined
    });
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    response.json(project);
  });

  app.delete("/api/projects/:id", (request, response) => {
    response.json({ removed: context.database().removeProject(request.params.id) });
  });

  app.get("/api/projects/:id/detail", (request, response) => {
    const detail = context.database().createProjectDetail(request.params.id, String(request.query.query ?? ""));
    if (!detail) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    response.json(detail);
  });

  app.post("/api/projects/:id/refresh", (request, response) => {
    const project = context.database().getProject(request.params.id);
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    response.json(refreshProjectSessions(context.database(), project));
  });

  app.get("/api/projects/:id/repair-candidates", (request, response) => {
    const project = context.database().getProject(request.params.id);
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    response.json(listProjectRepairCandidates(context.database(), request.params.id));
  });

  app.post("/api/projects/:id/repair", (request, response) => {
    const project = context.database().getProject(request.params.id);
    const targetProjectId = stringBody(request, "targetProjectId");
    const targetRootPath = stringBody(request, "targetRootPath");
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    if (!targetProjectId) {
      response.status(400).json({ error: "targetProjectId is required" });
      return;
    }
    const dataDir = context.bootstrapState().dataDir;
    if (!dataDir) {
      response.status(409).json({ error: "data-dir-not-initialized" });
      return;
    }
    response.json(confirmProjectRepair(context.database(), context.config(), dataDir, project.id, targetProjectId, targetRootPath));
  });

  app.post("/api/projects/:id/relocate", (request, response) => {
    const project = context.database().getProject(request.params.id);
    const newRoot = stringBody(request, "newRoot");
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    if (!newRoot) {
      response.status(400).json({ error: "newRoot is required" });
      return;
    }
    const dataDir = context.bootstrapState().dataDir;
    if (!dataDir) {
      response.status(409).json({ error: "data-dir-not-initialized" });
      return;
    }

    try {
      response.json(relocateManagedProject(context.database(), context.config(), dataDir, project.id, newRoot));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "project-relocation-failed" });
    }
  });

  app.get("/api/tools/status", (_request, response) => {
    response.json(listToolStatuses(context.config()));
  });

  app.post("/api/sessions/refresh", (request, response) => {
    const toolIds = toolIdsBody(request);
    if (toolIds === null) {
      response.status(400).json({ error: "toolIds must be an array of supported tool ids" });
      return;
    }
    response.json(
      refreshAllSessions(
        context.database(),
        context.config(),
        toolIds ? { toolIds, autoAddProjects: true } : { autoAddProjects: true }
      )
    );
  });

  app.post("/api/relocations/preview", (request, response) => {
    const oldRoot = stringBody(request, "oldRoot");
    const newRoot = stringBody(request, "newRoot");
    if (!oldRoot || !newRoot) {
      response.status(400).json({ error: "oldRoot and newRoot are required" });
      return;
    }
    response.json(previewRelocation(context.database(), oldRoot, newRoot));
  });

  app.post("/api/relocations/confirm", (request, response) => {
    const oldRoot = stringBody(request, "oldRoot");
    const newRoot = stringBody(request, "newRoot");
    if (!oldRoot || !newRoot) {
      response.status(400).json({ error: "oldRoot and newRoot are required" });
      return;
    }
    if (request.body?.confirmation !== "RELOCATE") {
      response.status(400).json({ error: "relocation-confirmation-required" });
      return;
    }
    const dataDir = context.bootstrapState().dataDir;
    if (!dataDir) {
      response.status(409).json({ error: "data-dir-not-initialized" });
      return;
    }
    response.json(confirmRelocation(context.database(), context.config(), dataDir, oldRoot, newRoot));
  });

  app.post("/api/scan-runs", (request, response) => {
    const scope = request.body?.scope === "drive" || request.body?.scope === "all-fixed" ? request.body.scope : "directory";
    const roots = Array.isArray(request.body?.roots) ? request.body.roots.filter((item: unknown) => typeof item === "string") : [];
    refreshAllSessions(context.database(), context.config());
    response.status(201).json(scanProjectCandidates(context.database(), { scope, roots }));
  });

  app.get("/api/scan-runs/:id/candidates", (request, response) => {
    response.json(context.database().listScanCandidates(request.params.id));
  });

  app.post("/api/scan-runs/:id/confirm", (request, response) => {
    const candidateIds = Array.isArray(request.body?.candidateIds)
      ? request.body.candidateIds.filter((item: unknown) => typeof item === "string")
      : [];
    response.json(
      confirmScanCandidates(context.database(), request.params.id, candidateIds, {
        includeEmptyCandidates: Boolean(request.body?.includeEmptyCandidates)
      })
    );
  });

  app.post("/api/launch/new", (request, response) => {
    const toolId = request.body?.toolId as ToolId;
    const cwd = stringBody(request, "cwd");
    if (!isToolId(toolId) || !cwd) {
      response.status(400).json({ error: "toolId and cwd are required" });
      return;
    }
    const status = adapterFor(toolId).detect(context.config());
    if (!status.available) {
      response.status(409).json({ error: "tool-unavailable", reason: status.reason });
      return;
    }
    const command = adapterFor(toolId).buildNewSessionCommand(context.config(), cwd);
    response.json(launchInTerminal(command, { dryRun: Boolean(request.body?.dryRun) }));
  });

  app.post("/api/launch/resume", (request, response) => {
    const sessionId = stringBody(request, "sessionId");
    if (!sessionId) {
      response.status(400).json({ error: "sessionId is required" });
      return;
    }
    const session = context.database().getSession(sessionId);
    if (!session) {
      response.status(404).json({ error: "session-not-found" });
      return;
    }
    const status = adapterFor(session.toolId).detect(context.config());
    if (!status.available) {
      response.status(409).json({ error: "tool-unavailable", reason: status.reason });
      return;
    }
    const command = adapterFor(session.toolId).buildResumeCommand(context.config(), session);
    response.json(launchInTerminal(command, { dryRun: Boolean(request.body?.dryRun) }));
  });

  app.get("/api/parser-warnings", (request, response) => {
    const projectId = typeof request.query.projectId === "string" ? request.query.projectId : null;
    if (!projectId) {
      response.json(context.database().listParserWarnings());
      return;
    }

    const project = context.database().getProject(projectId);
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    response.json(context.database().listParserWarningsForProject(project));
  });
}

export function asyncHandler(fn: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: (error?: unknown) => void) => {
    fn(request, response).catch(next);
  };
}

function stringBody(request: Request, key: string): string | null {
  const value = request.body?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isToolId(value: unknown): value is ToolId {
  return value === "codex" || value === "claude" || value === "opencode" || value === "qwen" || value === "qoder" || value === "copilot";
}

function toolIdsBody(request: Request): ToolId[] | undefined | null {
  if (request.body?.toolIds === undefined) return undefined;
  if (!Array.isArray(request.body.toolIds)) return null;
  const toolIds: ToolId[] = [];
  for (const item of request.body.toolIds) {
    if (!isToolId(item)) return null;
    if (!toolIds.includes(item)) toolIds.push(item);
  }
  return toolIds;
}
