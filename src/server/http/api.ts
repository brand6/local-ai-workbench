import fs from "node:fs";
import express, { type Express, type Request, type Response } from "express";
import { isTerminalMode, type AppConfig, type RefreshMode, type RefreshResult, type RuleSyncDirection, type SkillHubOpenTarget, type ToolId } from "../../shared/types.js";
import { adapterFor, listToolStatuses, sessionSourcesForAdapter, toolAdapters } from "../tools/adapters.js";
import { refreshAllSessions, refreshProjectSessions, refreshSessionFiles } from "../scanning/sessionScanner.js";
import { deleteSession as deleteIndexedSession } from "../scanning/sessionDeletion.js";
import { confirmScanCandidates, scanProjectCandidates } from "../scanning/projectScanner.js";
import { launchInTerminal, terminalWindowTarget } from "../launch/terminal.js";
import { confirmRelocation, previewRelocation, relocateManagedProject } from "../relocation/relocation.js";
import { confirmProjectRepair, listProjectRepairCandidates } from "../repair/projectRepair.js";
import { repairQwenSourcePathForSession } from "../repair/qwenSourceRepair.js";
import { createDirectory, listScanDrives, pickDirectory } from "../core/localFilesystem.js";
import { isStrictChildPath } from "../core/pathUtils.js";
import {
  applyGitHubSourceUpdate,
  checkGitHubUpdates,
  deleteSkillHubSkill,
  importGitHubSource,
  importLocalSkills,
  listSkillHub,
  openSkillHubSkill,
  previewDeleteSkillHubSkill
} from "../skillhub/skillhub.js";
import { applyRuleSync, commitRuleSyncTarget, getRuleSyncStatus } from "../skillhub/ruleSync.js";
import { listProjectSkillTargetsState, listProjectToolTargets, setProjectSkillTargets, updateProjectToolTargets } from "../skillhub/projectSkills.js";
import type { AppContext } from "../appContext.js";
import type { SessionIndexRunResult } from "../scanning/sessionIndexService.js";

export function installApi(app: Express, context: AppContext): void {
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", (request, response, next) => {
    const eventStreamToken = request.path === "/events" && typeof request.query.token === "string" ? request.query.token : null;
    const token = request.header("x-local-api-token") ?? eventStreamToken;
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

  app.get("/api/events", (_request, response) => {
    context.eventHub().addClient(response);
  });

  app.get("/api/config", (_request, response) => {
    response.json(context.config());
  });

  app.post("/api/local-filesystem/create-directory", (request, response) => {
    const parentPath = stringBody(request, "parentPath");
    const directoryName = stringBody(request, "directoryName");
    if (!parentPath || !directoryName) {
      response.status(400).json({ error: "parentPath and directoryName are required" });
      return;
    }
    try {
      response.status(201).json({ path: createDirectory(parentPath, directoryName) });
    } catch (error) {
      response.status(400).json({ error: "directory-create-failed", reason: error instanceof Error ? error.message : "directory-create-failed" });
    }
  });

  app.patch("/api/config", (request, response) => {
    const mode = request.body?.terminal?.mode;
    const skillHubRootDir = typeof request.body?.skillhub?.rootDir === "string" ? request.body.skillhub.rootDir.trim() : null;
    if (mode !== undefined && !isTerminalMode(mode)) {
      response.status(400).json({ error: "terminal.mode must be new-window, per-tool, or per-project" });
      return;
    }
    if (request.body?.skillhub !== undefined && skillHubRootDir === null) {
      response.status(400).json({ error: "skillhub.rootDir must be a string" });
      return;
    }
    const nextConfig: AppConfig = {
      ...context.config(),
      terminal: { mode: isTerminalMode(mode) ? mode : context.config().terminal.mode },
      skillhub: { rootDir: skillHubRootDir ?? context.config().skillhub.rootDir }
    };
    response.json(context.setConfig(nextConfig));
  });

  app.get("/api/skillhub", (request, response) => {
    const dataDir = requireDataDir(context, response);
    if (!dataDir) return;
    response.json(listSkillHub(context.database(), context.config(), dataDir, String(request.query.query ?? "")));
  });

  app.post("/api/skillhub/import/local", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const inputPath = stringBody(request, "path");
    if (!dataDir) return;
    if (!inputPath) {
      response.status(400).json({ error: "path is required" });
      return;
    }
    try {
      response.json(importLocalSkills(context.database(), context.config(), dataDir, inputPath, { overwrite: Boolean(request.body?.overwrite) }));
    } catch (error) {
      response.status(400).json({ error: "skillhub-local-import-failed", reason: error instanceof Error ? error.message : "skillhub-local-import-failed" });
    }
  });

  app.post("/api/skillhub/import/github", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const input = stringBody(request, "input");
    if (!dataDir) return;
    if (!input) {
      response.status(400).json({ error: "input is required" });
      return;
    }
    try {
      response.json(
        importGitHubSource(context.database(), context.config(), dataDir, input, {
          overwrite: Boolean(request.body?.overwrite),
          fixturePath: typeof request.body?.fixturePath === "string" ? request.body.fixturePath : undefined
        })
      );
    } catch (error) {
      response.status(400).json({ error: "skillhub-github-import-failed", reason: error instanceof Error ? error.message : "skillhub-github-import-failed" });
    }
  });

  app.get("/api/skillhub/updates", (_request, response) => {
    const dataDir = requireDataDir(context, response);
    if (!dataDir) return;
    try {
      response.json(checkGitHubUpdates(context.database(), context.config(), dataDir));
    } catch (error) {
      response.status(400).json({ error: "skillhub-update-check-failed", reason: error instanceof Error ? error.message : "skillhub-update-check-failed" });
    }
  });

  app.post("/api/skillhub/sources/:id/update", (request, response) => {
    const dataDir = requireDataDir(context, response);
    if (!dataDir) return;
    try {
      response.json(applyGitHubSourceUpdate(context.database(), context.config(), dataDir, request.params.id, { confirmDestructive: Boolean(request.body?.confirmDestructive) }));
    } catch (error) {
      response.status(400).json({ error: "skillhub-update-apply-failed", reason: error instanceof Error ? error.message : "skillhub-update-apply-failed" });
    }
  });

  app.get("/api/skillhub/skills/:id/delete-preview", (request, response) => {
    try {
      response.json(previewDeleteSkillHubSkill(context.database(), request.params.id));
    } catch (error) {
      response.status(404).json({ error: "skillhub-skill-not-found", reason: error instanceof Error ? error.message : "skillhub-skill-not-found" });
    }
  });

  app.post("/api/skillhub/skills/:id/open", (request, response) => {
    const target = skillHubOpenTargetBody(request);
    if (!target) {
      response.status(400).json({ error: "target must be document or folder" });
      return;
    }
    try {
      response.json(openSkillHubSkill(context.database(), request.params.id, target));
    } catch (error) {
      response.status(404).json({ error: "skillhub-skill-open-failed", reason: error instanceof Error ? error.message : "skillhub-skill-open-failed" });
    }
  });

  app.delete("/api/skillhub/skills/:id", (request, response) => {
    try {
      response.json(deleteSkillHubSkill(context.database(), request.params.id));
    } catch (error) {
      response.status(404).json({ error: "skillhub-skill-delete-failed", reason: error instanceof Error ? error.message : "skillhub-skill-delete-failed" });
    }
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
    const toolIds = toolIdsBody(request);
    if (toolIds === null) {
      response.status(400).json({ error: "toolIds must be an array of supported tool ids" });
      return;
    }
    const result = context.database().addProject(rootPath, includeSubdirectories);
    if (toolIds) {
      updateProjectToolTargets(context.database(), result.project, toolIds);
    }
    response.status(201).json(result);
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

  app.get("/api/projects/:id/tool-targets", (request, response) => {
    const project = context.database().getProject(request.params.id);
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    response.json(listProjectToolTargets(context.database(), project));
  });

  app.patch("/api/projects/:id/tool-targets", (request, response) => {
    const project = context.database().getProject(request.params.id);
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    const toolIds = toolIdsBody(request);
    if (!toolIds) {
      response.status(400).json({ error: "toolIds must be an array of supported tool ids" });
      return;
    }
    response.json(updateProjectToolTargets(context.database(), project, toolIds));
  });

  app.get("/api/projects/:id/skill-targets", (request, response) => {
    const project = context.database().getProject(request.params.id);
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    response.json(listProjectSkillTargetsState(context.database(), project));
  });

  app.put("/api/projects/:id/skill-targets/:skillId", (request, response) => {
    const project = context.database().getProject(request.params.id);
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    const toolIds = toolIdsBody(request);
    if (toolIds === null || toolIds === undefined) {
      response.status(400).json({ error: "toolIds must be an array of supported tool ids" });
      return;
    }
    try {
      response.json(
        setProjectSkillTargets(context.database(), project, request.params.skillId, toolIds, {
          replaceConflicts: Boolean(request.body?.replaceConflicts)
        })
      );
    } catch (error) {
      response.status(400).json({ error: "project-skill-target-update-failed", reason: error instanceof Error ? error.message : "project-skill-target-update-failed" });
    }
  });

  app.get("/api/projects/:id/rule-sync/status", (request, response) => {
    const project = context.database().getProject(request.params.id);
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    response.json(getRuleSyncStatus(project));
  });

  app.post("/api/projects/:id/rule-sync/apply", (request, response) => {
    const project = context.database().getProject(request.params.id);
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    const direction = ruleSyncDirectionBody(request);
    if (!direction) {
      response.status(400).json({ error: "direction must be agents-to-claude or claude-to-agents" });
      return;
    }
    try {
      response.json(
        applyRuleSync(project, direction, {
          confirmGitInit: Boolean(request.body?.confirmGitInit),
          confirmDirectOverwrite: Boolean(request.body?.confirmDirectOverwrite)
        })
      );
    } catch (error) {
      response.status(400).json({ error: "rule-sync-failed", reason: error instanceof Error ? error.message : "rule-sync-failed" });
    }
  });

  app.post("/api/projects/:id/rule-sync/commit", (request, response) => {
    const project = context.database().getProject(request.params.id);
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    const direction = ruleSyncDirectionBody(request);
    if (!direction) {
      response.status(400).json({ error: "direction must be agents-to-claude or claude-to-agents" });
      return;
    }
    try {
      response.json(commitRuleSyncTarget(project, direction));
    } catch (error) {
      response.status(400).json({ error: "rule-sync-commit-failed", reason: error instanceof Error ? error.message : "rule-sync-commit-failed" });
    }
  });

  app.post("/api/projects/:id/refresh", (request, response) => {
    const project = context.database().getProject(request.params.id);
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    response.json(refreshProjectSessions(context.database(), context.config(), project));
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
    const mode = refreshModeBody(request);
    if (mode === null) {
      response.status(400).json({ error: "mode must be incremental or full" });
      return;
    }

    if (mode === "full") {
      const result = refreshAllSessions(
        context.database(),
        context.config(),
        toolIds ? { toolIds, autoAddProjects: true } : { autoAddProjects: true }
      );
      context.sessionIndexer().markSynced(toolIds ?? []);
      response.json(result);
      return;
    }

    const result = context.sessionIndexer().runOnce("manual", toolIds ? { toolIds } : {});
    response.json(refreshResultFromIndexRun(context, result, toolIds));
  });

  app.delete("/api/sessions/:id", (request, response) => {
    try {
      const result = deleteIndexedSession(context.database(), request.params.id);
      if (!result) {
        response.status(404).json({ error: "session-not-found" });
        return;
      }
      response.json(result);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "session-delete-failed" });
    }
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
    context.sessionIndexer().markSynced();
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
    const projectRootPath = stringBody(request, "projectRootPath");
    if (!isToolId(toolId) || !cwd) {
      response.status(400).json({ error: "toolId and cwd are required" });
      return;
    }
    const config = context.config();
    const status = adapterFor(toolId).detect(config);
    if (!status.available) {
      response.status(409).json({ error: "tool-unavailable", reason: status.reason });
      return;
    }
    const command = adapterFor(toolId).buildNewSessionCommand(config, cwd);
    response.json(
      launchInTerminal(command, {
        dryRun: Boolean(request.body?.dryRun),
        windowTarget: terminalWindowTarget(config.terminal.mode, { toolId, cwd, projectRootPath })
      })
    );
  });

  app.post("/api/launch/resume", (request, response) => {
    const sessionId = stringBody(request, "sessionId");
    if (!sessionId) {
      response.status(400).json({ error: "sessionId is required" });
      return;
    }
    let session = context.database().getSession(sessionId);
    if (!session) {
      response.status(404).json({ error: "session-not-found" });
      return;
    }
    if (session.resumeStatus === "ready") {
      if (!fs.existsSync(session.sourceFile)) {
        response.status(409).json({ error: "session-not-resumable", reason: "unknown" });
        return;
      }
      refreshSessionFiles(context.database(), [{ toolId: session.toolId, sourceFile: session.sourceFile }]);
      session = context.database().getSession(sessionId);
      if (!session) {
        response.status(409).json({ error: "session-not-resumable", reason: "unknown" });
        return;
      }
    }
    if (session.resumeStatus === "source_mismatch") {
      session = repairQwenSourcePathForSession(context.database(), session) ?? session;
    }
    if (session.resumeStatus !== "ready") {
      response.status(409).json({ error: "session-not-resumable", reason: session.resumeStatus });
      return;
    }
    const config = context.config();
    const status = adapterFor(session.toolId).detect(config);
    if (!status.available) {
      response.status(409).json({ error: "tool-unavailable", reason: status.reason });
      return;
    }
    const command = adapterFor(session.toolId).buildResumeCommand(config, session);
    response.json(
      launchInTerminal(command, {
        dryRun: Boolean(request.body?.dryRun),
        windowTarget: terminalWindowTarget(config.terminal.mode, {
          toolId: session.toolId,
          cwd: session.originalCwd,
          projectRootPath: projectRootPathForSession(context, session.normalizedCwd)
        })
      })
    );
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

function refreshModeBody(request: Request): RefreshMode | null {
  if (request.body?.mode === undefined) return "full";
  return request.body.mode === "incremental" || request.body.mode === "full" ? request.body.mode : null;
}

function ruleSyncDirectionBody(request: Request): RuleSyncDirection | null {
  return request.body?.direction === "agents-to-claude" || request.body?.direction === "claude-to-agents" ? request.body.direction : null;
}

function skillHubOpenTargetBody(request: Request): SkillHubOpenTarget | null {
  return request.body?.target === "document" || request.body?.target === "folder" ? request.body.target : null;
}

function requireDataDir(context: AppContext, response: Response): string | null {
  const dataDir = context.bootstrapState().dataDir;
  if (!dataDir) {
    response.status(409).json({ error: "data-dir-not-initialized" });
    return null;
  }
  return dataDir;
}

function refreshResultFromIndexRun(
  context: AppContext,
  result: SessionIndexRunResult | null,
  toolIds: ToolId[] | undefined
): RefreshResult {
  const base = result?.refreshResult ?? emptySessionRefreshResult(context, toolIds);
  return {
    ...base,
    addedProjectCount: result?.addedProjectCount ?? 0,
    removedSessionCount: result?.removedSessionCount ?? 0
  };
}

function emptySessionRefreshResult(context: AppContext, toolIds: ToolId[] | undefined): RefreshResult {
  const scanRun = context.database().createScanRun("sessions-incremental", sessionRefreshRoots(context.config(), toolIds));
  const completed = context.database().completeScanRun(scanRun.id, { indexedCount: 0, skippedCount: 0, warningCount: 0 });
  return { scanRun: completed, indexedCount: 0, skippedCount: 0, warningCount: 0 };
}

function sessionRefreshRoots(config: AppConfig, toolIds: ToolId[] | undefined): string[] {
  const selectedTools = toolIds?.length ? new Set<ToolId>(toolIds) : null;
  return Object.values(toolAdapters)
    .filter((adapter) => adapter.capabilities.scanHistory && (!selectedTools || selectedTools.has(adapter.id)))
    .flatMap((adapter) => sessionSourcesForAdapter(adapter, config));
}

function projectRootPathForSession(context: AppContext, normalizedCwd: string | null): string | null {
  if (!normalizedCwd) return null;
  const project = context
    .database()
    .listProjects()
    .filter((candidate) => {
      if (candidate.normalizedRootPath === normalizedCwd) return true;
      return candidate.includeSubdirectories && isStrictChildPath(candidate.normalizedRootPath, normalizedCwd);
    })
    .sort((a, b) => b.normalizedRootPath.length - a.normalizedRootPath.length)[0];
  return project?.rootPath ?? null;
}
