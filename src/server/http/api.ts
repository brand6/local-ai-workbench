import fs from "node:fs";
import express, { type Express, type Request, type Response } from "express";
import {
  type AgentHubApplyConflictMode,
  type AgentHubDisableMode,
  type AgentHubImportConflictResolution,
  type AgentHubToolId,
  type HookHubApplyMode,
  type HookHubImportConflictMode,
  type HookHubSuiteInput,
  type HookHubSupportedToolId,
  isMcpHubTargetToolId,
  isTerminalMode,
  isToolId,
  type AppConfig,
  type McpHubTargetToolId,
  type PluginHubComponentRef,
  type PluginHubCustomPluginInput,
  type PluginHubSourceDeleteMode,
  type ProjectLocalMcpMigrationMode,
  type ProjectLocalSkillMigrationMode,
  type ProjectLocalSkillMigrationTarget,
  type ProjectLocalAgentMigrationTarget,
  type RefreshMode,
  type RefreshResult,
  type RuleCreateSource,
  type RuleFileName,
  type RuleSyncDirection,
  type SkillHubOpenTarget,
  type ToolId,
  isAgentHubToolId
} from "../../shared/types.js";
import { adapterFor, listToolStatuses, sessionSourcesForAdapter, toolAdapters } from "../tools/adapters.js";
import { refreshAllSessions, refreshProjectSessions, refreshSessionFiles } from "../scanning/sessionScanner.js";
import { deleteSession as deleteIndexedSession } from "../scanning/sessionDeletion.js";
import { confirmScanCandidates, scanProjectCandidates } from "../scanning/projectScanner.js";
import { launchInTerminal, terminalWindowTarget } from "../launch/terminal.js";
import { confirmRelocation, previewRelocation, relocateManagedProject } from "../relocation/relocation.js";
import { confirmProjectRepair, listProjectRepairCandidates } from "../repair/projectRepair.js";
import { repairQwenSourcePathForSession } from "../repair/qwenSourceRepair.js";
import { createDirectory, listScanDrives } from "../core/localFilesystem.js";
import { displayPath, isPathInsideOrEqual, isStrictChildPath, normalizeFsPath } from "../core/pathUtils.js";
import {
  applyGitHubSourceUpdate,
  checkGitHubUpdates,
  deleteSkillHubSkill,
  importGitHubSource,
  importLocalSkills,
  listSkillHub,
  listProjectLocalSkillsState,
  migrateProjectLocalSkill,
  openSkillHubSkill,
  previewDeleteSkillHubSkill,
  seedDefaultSkillHubSources
} from "../skillhub/skillhub.js";
import {
  addCliHubChannel,
  addCustomInstallCommandCli,
  addCustomLocalPathCli,
  checkCliHubUpdates,
  completeCliHubTerminalUpdate,
  createCliHubUpdateLaunchPlan,
  installCliHubCli,
  listCliHub,
  recordCliHubUpdateTerminalLaunch,
  refreshCliHubDiscovery,
  updateCliHubCli,
  withCliHubUpdateCompletionCallback
} from "../clihub/clihub.js";
import {
  applyProjectMcpServer,
  deleteMcpHubServer,
  disableProjectMcpServer,
  importMcpHubJson,
  listMcpHub,
  listProjectMcpState,
  migrateProjectLocalMcp
} from "../mcphub/mcphub.js";
import {
  applyHookHubSuiteToProject,
  createHookHubSuite,
  deleteHookHubSuite,
  exportHookHubSuite,
  importHookHubSuiteJson,
  importNativeToolHooks,
  isHookHubSupportedToolId,
  listHookHub,
  listProjectHookState,
  removeProjectHookBinding,
  shareProjectHooksToHookHub,
  syncHookHubSuiteToEnabledProjects,
  syncProjectHooksFromHookHub,
  syncProjectHookToolFromHookHub,
  updateHookHubSuite,
  writeProjectHooks
} from "../hookhub/hookhub.js";
import {
  applyProjectAgentTarget,
  deleteAgentHubAgent,
  deleteAgentHubSource,
  disableProjectAgentTarget,
  importBuiltInAgencyAgents,
  importLocalAgentFolder,
  listAgentHub,
  listProjectAgentState,
  listProjectLocalAgentState,
  migrateProjectLocalAgent,
  openAgentHubAgent,
  refreshAgentHubDiscovery,
  reparseAgentHubAgent,
  syncProjectAgents,
  syncProjectAgentTarget
} from "../agenthub/agenthub.js";
import {
  createCustomPlugin,
  deletePluginHubPlugin,
  deletePluginHubSource,
  importPluginHubGitHubSource,
  importPluginHubLocalSource,
  installProjectPlugin,
  listPluginHub,
  listProjectPluginState,
  openPluginHubPrivateFile,
  previewDeletePluginHubPlugin,
  previewDeletePluginHubSource,
  refreshPluginHubDiscovery,
  seedDefaultPluginHubSources,
  syncProjectPluginBinding,
  uninstallProjectPluginBinding,
  updatePluginHubGitHubSource,
  updateCustomPlugin
} from "../pluginhub/pluginhub.js";
import { applyRuleSync, commitRuleSyncTarget, createRuleFile, createRuleTemplateFile, getRuleSyncStatus, openRuleFile, prepareRuleFileCreate } from "../skillhub/ruleSync.js";
import { listProjectSkillTargetsState, listProjectToolTargets, setProjectSkillTargets, unavailableProjectToolIds, updateProjectToolTargets } from "../skillhub/projectSkills.js";
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

  app.post(
    "/api/local-filesystem/pick-directory",
    asyncHandler(async (_request, response) => {
      response.json(await context.pickDirectory());
    })
  );

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

  app.get("/api/agenthub", (request, response) => {
    const dataDir = requireDataDir(context, response);
    if (!dataDir) return;
    response.json(listAgentHub(context.database(), dataDir, String(request.query.query ?? ""), { seedDefaultSources: false }));
  });

  app.post("/api/agenthub/discovery/refresh", (request, response) => {
    const dataDir = requireDataDir(context, response);
    if (!dataDir) return;
    response.json(refreshAgentHubDiscovery(context.database(), dataDir, String(request.body?.query ?? "")));
  });

  app.post("/api/agenthub/import/builtin/agency-agents", (_request, response) => {
    const dataDir = requireDataDir(context, response);
    if (!dataDir) return;
    try {
      response.json(importBuiltInAgencyAgents(context.database(), dataDir));
    } catch (error) {
      response.status(400).json({ error: "agenthub-builtin-import-failed", reason: error instanceof Error ? error.message : "agenthub-builtin-import-failed" });
    }
  });

  app.post("/api/agenthub/import/local", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const inputPath = stringBody(request, "path");
    const sourceTruthTool = agentHubToolIdBody(request, "sourceTruthTool");
    if (!dataDir) return;
    if (!inputPath || !sourceTruthTool) {
      response.status(400).json({ error: "path and sourceTruthTool are required" });
      return;
    }
    try {
      response.json(
        importLocalAgentFolder(context.database(), dataDir, inputPath, sourceTruthTool, {
          conflictResolutions: agentHubConflictResolutionsBody(request)
        })
      );
    } catch (error) {
      response.status(400).json({ error: "agenthub-local-import-failed", reason: error instanceof Error ? error.message : "agenthub-local-import-failed" });
    }
  });

  app.post("/api/agenthub/agents/:id/open", (request, response) => {
    const target = skillHubOpenTargetBody(request);
    if (!target) {
      response.status(400).json({ error: "target must be document or folder" });
      return;
    }
    try {
      response.json(openAgentHubAgent(context.database(), request.params.id, target));
    } catch (error) {
      response.status(404).json({ error: "agenthub-agent-open-failed", reason: error instanceof Error ? error.message : "agenthub-agent-open-failed" });
    }
  });

  app.post("/api/agenthub/agents/:id/reparse", (request, response) => {
    try {
      response.json(reparseAgentHubAgent(context.database(), request.params.id));
    } catch (error) {
      response.status(400).json({ error: "agenthub-agent-reparse-failed", reason: error instanceof Error ? error.message : "agenthub-agent-reparse-failed" });
    }
  });

  app.delete("/api/agenthub/agents/:id", (request, response) => {
    const dataDir = requireDataDir(context, response);
    if (!dataDir) return;
    try {
      response.json(deleteAgentHubAgent(context.database(), dataDir, request.params.id));
    } catch (error) {
      response.status(404).json({ error: "agenthub-agent-delete-failed", reason: error instanceof Error ? error.message : "agenthub-agent-delete-failed" });
    }
  });

  app.delete("/api/agenthub/sources/:id", (request, response) => {
    const dataDir = requireDataDir(context, response);
    if (!dataDir) return;
    try {
      response.json(deleteAgentHubSource(context.database(), dataDir, request.params.id));
    } catch (error) {
      response.status(404).json({ error: "agenthub-source-delete-failed", reason: error instanceof Error ? error.message : "agenthub-source-delete-failed" });
    }
  });

  app.get("/api/clihub", (_request, response) => {
    response.json(listCliHub(context.database(), context.cliHubRuntimeOptions()));
  });

  app.post(
    "/api/clihub/discovery/refresh",
    asyncHandler(async (request, response) => {
      response.json(
        await refreshCliHubDiscovery(context.database(), stringBody(request, "cliId"), context.cliHubRuntimeOptions(), {
          includeDetails: request.body?.includeDetails !== false
        })
      );
    })
  );

  app.post(
    "/api/clihub/custom/local-path",
    asyncHandler(async (request, response) => {
      const executablePath = stringBody(request, "executablePath");
      if (!executablePath) {
        response.status(400).json({ error: "executablePath is required" });
        return;
      }
      try {
        response.status(201).json(
          await addCustomLocalPathCli(
            context.database(),
            {
              executablePath,
              displayName: stringBody(request, "displayName"),
              commandName: stringBody(request, "commandName")
            },
            context.cliHubRuntimeOptions()
          )
        );
      } catch (error) {
        response.status(400).json({ error: "clihub-custom-local-path-failed", reason: error instanceof Error ? error.message : "clihub-custom-local-path-failed" });
      }
    })
  );

  app.post(
    "/api/clihub/custom/install-command",
    asyncHandler(async (request, response) => {
      const installCommand = stringBody(request, "installCommand");
      if (!installCommand) {
        response.status(400).json({ error: "installCommand is required" });
        return;
      }
      try {
        response.status(201).json(
          await addCustomInstallCommandCli(
            context.database(),
            {
              installCommand,
              displayName: stringBody(request, "displayName"),
              commandName: stringBody(request, "commandName")
            },
            context.cliHubRuntimeOptions()
          )
        );
      } catch (error) {
        response.status(400).json({ error: "clihub-custom-install-command-failed", reason: error instanceof Error ? error.message : "clihub-custom-install-command-failed" });
      }
    })
  );

  app.post("/api/clihub/clis/:cliId/channels", (request, response) => {
    const installCommand = stringBody(request, "installCommand");
    const cliId = stringParam(request, "cliId");
    if (!installCommand) {
      response.status(400).json({ error: "installCommand is required" });
      return;
    }
    if (!cliId) {
      response.status(404).json({ error: "clihub-cli-not-found" });
      return;
    }
    try {
      response.status(201).json(addCliHubChannel(context.database(), cliId, installCommand));
    } catch (error) {
      response.status(400).json({ error: "clihub-channel-add-failed", reason: error instanceof Error ? error.message : "clihub-channel-add-failed" });
    }
  });

  app.post(
    "/api/clihub/clis/:cliId/install",
    asyncHandler(async (request, response) => {
      const dataDir = requireDataDir(context, response);
      const cliId = stringParam(request, "cliId");
      if (!dataDir) return;
      if (!cliId) {
        response.status(404).json({ error: "clihub-cli-not-found" });
        return;
      }
      try {
        response.json(
          await installCliHubCli(context.database(), dataDir, cliId, stringBody(request, "channelId"), context.cliHubRuntimeOptions())
        );
      } catch (error) {
        response.status(400).json({ error: "clihub-install-failed", reason: error instanceof Error ? error.message : "clihub-install-failed" });
      }
    })
  );

  app.post(
    "/api/clihub/clis/:cliId/check-updates",
    asyncHandler(async (request, response) => {
      const cliId = stringParam(request, "cliId");
      if (!cliId) {
        response.status(404).json({ error: "clihub-cli-not-found" });
        return;
      }
      try {
        response.json(await checkCliHubUpdates(context.database(), cliId, context.cliHubRuntimeOptions()));
      } catch (error) {
        response.status(400).json({ error: "clihub-update-check-failed", reason: error instanceof Error ? error.message : "clihub-update-check-failed" });
      }
    })
  );

  app.post(
    "/api/clihub/updates/check",
    asyncHandler(async (_request, response) => {
      try {
        response.json(await checkCliHubUpdates(context.database(), null, context.cliHubRuntimeOptions()));
      } catch (error) {
        response.status(400).json({ error: "clihub-update-check-failed", reason: error instanceof Error ? error.message : "clihub-update-check-failed" });
      }
    })
  );

  app.post(
    "/api/clihub/clis/:cliId/update",
    asyncHandler(async (request, response) => {
      const cliId = stringParam(request, "cliId");
      if (!cliId) {
        response.status(404).json({ error: "clihub-cli-not-found" });
        return;
      }
      try {
        response.json(await updateCliHubCli(context.database(), cliId, context.cliHubRuntimeOptions()));
      } catch (error) {
        response.status(400).json({ error: "clihub-update-failed", reason: error instanceof Error ? error.message : "clihub-update-failed" });
      }
    })
  );

  app.post("/api/clihub/clis/:cliId/update-terminal", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const cliId = stringParam(request, "cliId");
    if (!dataDir) return;
    if (!cliId) {
      response.status(404).json({ error: "clihub-cli-not-found" });
      return;
    }
    try {
      const plan = createCliHubUpdateLaunchPlan(context.database(), cliId, dataDir);
      const launchPlan = withCliHubUpdateCompletionCallback(plan, {
        url: `${request.protocol}://${request.get("host")}/api/clihub/clis/${encodeURIComponent(cliId)}/update-terminal/complete`,
        token: context.token
      });
      const launch = launchInTerminal(launchPlan.command, {
        dryRun: Boolean(request.body?.dryRun),
        windowTarget: "new"
      });
      recordCliHubUpdateTerminalLaunch(context.database(), plan, launch);
      response.json({ ...launch, command: plan.command });
    } catch (error) {
      response.status(400).json({ error: "clihub-update-terminal-failed", reason: error instanceof Error ? error.message : "clihub-update-terminal-failed" });
    }
  });

  app.post(
    "/api/clihub/clis/:cliId/update-terminal/complete",
    asyncHandler(async (request, response) => {
      const cliId = stringParam(request, "cliId");
      if (!cliId) {
        response.status(404).json({ error: "clihub-cli-not-found" });
        return;
      }
      try {
        const result = await completeCliHubTerminalUpdate(context.database(), cliId, terminalUpdateCompletionBody(request), context.cliHubRuntimeOptions());
        context.eventHub().emit({
          type: "clihub:changed",
          at: new Date().toISOString(),
          cliId
        });
        response.json(result);
      } catch (error) {
        response.status(400).json({ error: "clihub-update-terminal-complete-failed", reason: error instanceof Error ? error.message : "clihub-update-terminal-complete-failed" });
      }
    })
  );

  app.get("/api/mcphub", (_request, response) => {
    response.json(listMcpHub(context.database()));
  });

  app.post("/api/mcphub/import", (request, response) => {
    const input = stringBody(request, "input");
    if (!input) {
      response.status(400).json({ error: "input is required" });
      return;
    }
    response.json(importMcpHubJson(context.database(), input));
  });

  app.delete("/api/mcphub/servers/:serverId", (request, response) => {
    try {
      response.json(deleteMcpHubServer(context.database(), request.params.serverId));
    } catch (error) {
      response.status(400).json({ error: "mcphub-delete-failed", reason: error instanceof Error ? error.message : "mcphub-delete-failed" });
    }
  });

  app.get("/api/hookhub", (request, response) => {
    response.json(listHookHub(context.database(), String(request.query.query ?? "")));
  });

  app.post("/api/hookhub/suites", (request, response) => {
    const input = hookHubSuiteInputBody(request);
    if (!input) {
      response.status(400).json({ error: "name is required" });
      return;
    }
    try {
      response.status(201).json(createHookHubSuite(context.database(), input));
    } catch (error) {
      response.status(400).json({ error: "hookhub-suite-create-failed", reason: error instanceof Error ? error.message : "hookhub-suite-create-failed" });
    }
  });

  app.put("/api/hookhub/suites/:suiteId", (request, response) => {
    try {
      response.json(updateHookHubSuite(context.database(), request.params.suiteId, hookHubPartialSuiteInputBody(request)));
    } catch (error) {
      response.status(400).json({ error: "hookhub-suite-update-failed", reason: error instanceof Error ? error.message : "hookhub-suite-update-failed" });
    }
  });

  app.delete("/api/hookhub/suites/:suiteId", (request, response) => {
    try {
      response.json(deleteHookHubSuite(context.database(), request.params.suiteId));
    } catch (error) {
      response.status(400).json({ error: "hookhub-suite-delete-failed", reason: error instanceof Error ? error.message : "hookhub-suite-delete-failed" });
    }
  });

  app.get("/api/hookhub/suites/:suiteId/export", (request, response) => {
    try {
      response.json(exportHookHubSuite(context.database(), request.params.suiteId));
    } catch (error) {
      response.status(404).json({ error: "hookhub-suite-export-failed", reason: error instanceof Error ? error.message : "hookhub-suite-export-failed" });
    }
  });

  app.post("/api/hookhub/suites/:suiteId/sync", (request, response) => {
    try {
      response.json(syncHookHubSuiteToEnabledProjects(context.database(), request.params.suiteId));
    } catch (error) {
      response.status(400).json({ error: "hookhub-suite-sync-failed", reason: error instanceof Error ? error.message : "hookhub-suite-sync-failed" });
    }
  });

  app.post("/api/hookhub/import/suite", (request, response) => {
    const input = stringBody(request, "input");
    if (!input) {
      response.status(400).json({ error: "input is required" });
      return;
    }
    try {
      response.json(
        importHookHubSuiteJson(context.database(), input, {
          conflictMode: hookHubImportConflictModeBody(request),
          renameName: stringBody(request, "renameName")
        })
      );
    } catch (error) {
      response.status(400).json({ error: "hookhub-suite-import-failed", reason: error instanceof Error ? error.message : "hookhub-suite-import-failed" });
    }
  });

  app.post("/api/hookhub/import/native", (request, response) => {
    const toolId = hookHubSupportedToolIdBody(request);
    const input = stringBody(request, "input");
    const suiteInput = hookHubSuiteInputBody(request);
    if (!toolId || !input || !suiteInput) {
      response.status(400).json({ error: "toolId, input, and name are required" });
      return;
    }
    try {
      response.json(importNativeToolHooks(context.database(), { ...suiteInput, toolId, input }));
    } catch (error) {
      response.status(400).json({ error: "hookhub-native-import-failed", reason: error instanceof Error ? error.message : "hookhub-native-import-failed" });
    }
  });

  app.get("/api/pluginhub", (_request, response) => {
    const dataDir = requireDataDir(context, response);
    if (!dataDir) return;
    response.json(listPluginHub(context.database(), context.config(), dataDir, { seedDefaultSources: false }));
  });

  app.post("/api/pluginhub/discovery/refresh", (_request, response) => {
    const dataDir = requireDataDir(context, response);
    if (!dataDir) return;
    response.json(refreshPluginHubDiscovery(context.database(), context.config(), dataDir));
  });

  app.post("/api/pluginhub/import/local", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const inputPath = stringBody(request, "path");
    if (!dataDir) return;
    if (!inputPath) {
      response.status(400).json({ error: "path is required" });
      return;
    }
    try {
      response.json(importPluginHubLocalSource(context.database(), context.config(), dataDir, inputPath));
    } catch (error) {
      response.status(400).json({ error: "pluginhub-local-import-failed", reason: error instanceof Error ? error.message : "pluginhub-local-import-failed" });
    }
  });

  app.post("/api/pluginhub/import/github", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const input = stringBody(request, "input");
    if (!dataDir) return;
    if (!input) {
      response.status(400).json({ error: "input is required" });
      return;
    }
    try {
      response.json(
        importPluginHubGitHubSource(context.database(), context.config(), dataDir, input, {
          fixturePath: typeof request.body?.fixturePath === "string" ? request.body.fixturePath : undefined
        })
      );
    } catch (error) {
      response.status(400).json({ error: "pluginhub-github-import-failed", reason: error instanceof Error ? error.message : "pluginhub-github-import-failed" });
    }
  });

  app.post("/api/pluginhub/sources/:sourceId/update", (request, response) => {
    const dataDir = requireDataDir(context, response);
    if (!dataDir) return;
    try {
      response.json(updatePluginHubGitHubSource(context.database(), context.config(), dataDir, request.params.sourceId));
    } catch (error) {
      response.status(400).json({ error: "pluginhub-source-update-failed", reason: error instanceof Error ? error.message : "pluginhub-source-update-failed" });
    }
  });

  app.post("/api/pluginhub/custom", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const input = pluginHubCustomPluginInputBody(request);
    if (!dataDir) return;
    if (!input) {
      response.status(400).json({ error: "name is required" });
      return;
    }
    try {
      response.status(201).json(createCustomPlugin(context.database(), dataDir, input));
    } catch (error) {
      response.status(400).json({ error: "pluginhub-custom-create-failed", reason: error instanceof Error ? error.message : "pluginhub-custom-create-failed" });
    }
  });

  app.put("/api/pluginhub/custom/:pluginId", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const input = pluginHubCustomPluginInputBody(request);
    if (!dataDir) return;
    if (!input) {
      response.status(400).json({ error: "name is required" });
      return;
    }
    try {
      response.json(updateCustomPlugin(context.database(), dataDir, request.params.pluginId, input));
    } catch (error) {
      response.status(400).json({ error: "pluginhub-custom-update-failed", reason: error instanceof Error ? error.message : "pluginhub-custom-update-failed" });
    }
  });

  app.get("/api/pluginhub/sources/:sourceId/delete-preview", (request, response) => {
    try {
      response.json(previewDeletePluginHubSource(context.database(), request.params.sourceId));
    } catch (error) {
      response.status(404).json({ error: "pluginhub-source-delete-preview-failed", reason: error instanceof Error ? error.message : "pluginhub-source-delete-preview-failed" });
    }
  });

  app.delete("/api/pluginhub/sources/:sourceId", (request, response) => {
    const mode = pluginHubSourceDeleteModeBody(request);
    if (!mode) {
      response.status(400).json({ error: "mode must be delete-custom-plugins or remove-custom-components" });
      return;
    }
    try {
      response.json(deletePluginHubSource(context.database(), request.params.sourceId, mode));
    } catch (error) {
      response.status(400).json({ error: "pluginhub-source-delete-failed", reason: error instanceof Error ? error.message : "pluginhub-source-delete-failed" });
    }
  });

  app.get("/api/pluginhub/plugins/:pluginId/delete-preview", (request, response) => {
    try {
      response.json(previewDeletePluginHubPlugin(context.database(), request.params.pluginId));
    } catch (error) {
      response.status(404).json({ error: "pluginhub-plugin-delete-preview-failed", reason: error instanceof Error ? error.message : "pluginhub-plugin-delete-preview-failed" });
    }
  });

  app.post("/api/pluginhub/plugins/:pluginId/private-files/:fileId/open", (request, response) => {
    const target = skillHubOpenTargetBody(request);
    if (!target) {
      response.status(400).json({ error: "target must be document or folder" });
      return;
    }
    try {
      response.json(openPluginHubPrivateFile(context.database(), request.params.pluginId, request.params.fileId, target));
    } catch (error) {
      response.status(404).json({ error: "pluginhub-private-file-open-failed", reason: error instanceof Error ? error.message : "pluginhub-private-file-open-failed" });
    }
  });

  app.delete("/api/pluginhub/plugins/:pluginId", (request, response) => {
    try {
      response.json(deletePluginHubPlugin(context.database(), request.params.pluginId));
    } catch (error) {
      response.status(400).json({ error: "pluginhub-plugin-delete-failed", reason: error instanceof Error ? error.message : "pluginhub-plugin-delete-failed" });
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
    const unavailableToolIds = toolIds ? unavailableProjectToolIds(context.config(), toolIds) : [];
    if (unavailableToolIds.length > 0) {
      response.status(409).json({
        error: "tool-unavailable",
        toolIds: unavailableToolIds,
        reason: `只支持本机已安装的 CLI：${unavailableToolIds.join(", ")}`
      });
      return;
    }
    const result = context.database().addProject(rootPath, includeSubdirectories);
    if (toolIds) {
      updateProjectToolTargets(context.database(), result.project, toolIds, context.config());
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
    const detail = context.database().createProjectDetail(request.params.id, String(request.query.query ?? ""), {
      includeSessions: request.query.includeSessions !== "false"
    });
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
    response.json(listProjectToolTargets(context.database(), project, context.config()));
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
    const unavailableToolIds = unavailableProjectToolIds(context.config(), toolIds);
    if (unavailableToolIds.length > 0) {
      response.status(409).json({
        error: "tool-unavailable",
        toolIds: unavailableToolIds,
        reason: `只支持本机已安装的 CLI：${unavailableToolIds.join(", ")}`
      });
      return;
    }
    response.json(updateProjectToolTargets(context.database(), project, toolIds, context.config()));
  });

  app.get("/api/projects/:id/skill-targets", (request, response) => {
    const dataDir = requireDataDir(context, response);
    if (!dataDir) return;
    seedDefaultSkillHubSources(context.database(), context.config(), dataDir);
    const project = projectSkillScopeFromRequest(context, request, response);
    if (!project) {
      return;
    }
    response.json(listProjectSkillTargetsState(context.database(), project));
  });

  app.get("/api/projects/:id/local-skills", (request, response) => {
    const dataDir = requireDataDir(context, response);
    if (!dataDir) return;
    seedDefaultSkillHubSources(context.database(), context.config(), dataDir);
    const project = projectSkillScopeFromRequest(context, request, response);
    if (!project) {
      return;
    }
    response.json(listProjectLocalSkillsState(context.database(), project));
  });

  app.post("/api/projects/:id/local-skills/migrate", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const project = projectSkillScopeFromRequest(context, request, response);
    const toolId = toolIdBody(request);
    const folderName = stringBody(request, "folderName");
    const mode = localSkillMigrationModeBody(request);
    const target = localSkillMigrationTargetBody(request);
    if (!dataDir) return;
    if (!project) {
      return;
    }
    if (!toolId || !folderName || mode === undefined || target === undefined) {
      response.status(400).json({ error: "toolId, folderName, valid mode, and valid target are required" });
      return;
    }
    try {
      response.json(migrateProjectLocalSkill(context.database(), context.config(), dataDir, project, toolId, folderName, mode, target));
    } catch (error) {
      response.status(400).json({ error: "project-local-skill-migration-failed", reason: error instanceof Error ? error.message : "project-local-skill-migration-failed" });
    }
  });

  app.get("/api/projects/:id/plugins", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const project = projectSkillScopeFromRequest(context, request, response);
    if (!dataDir) return;
    if (!project) return;
    response.json(listProjectPluginState(context.database(), project, context.config(), dataDir));
  });

  app.put("/api/projects/:id/plugins/:pluginId", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const project = projectSkillScopeFromRequest(context, request, response);
    const toolId = toolIdBody(request);
    if (!dataDir) return;
    if (!project) return;
    if (!toolId) {
      response.status(400).json({ error: "toolId is required" });
      return;
    }
    try {
      seedDefaultPluginHubSources(context.database(), context.config(), dataDir);
      response.json(installProjectPlugin(context.database(), project, request.params.pluginId, toolId, dataDir, { conflictMode: pluginHubConflictModeBody(request) }));
    } catch (error) {
      response.status(400).json({ error: "project-plugin-install-failed", reason: error instanceof Error ? error.message : "project-plugin-install-failed" });
    }
  });

  app.post("/api/projects/:id/plugin-bindings/:bindingId/sync", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const project = projectSkillScopeFromRequest(context, request, response);
    if (!dataDir) return;
    if (!project) return;
    try {
      seedDefaultPluginHubSources(context.database(), context.config(), dataDir);
      response.json(syncProjectPluginBinding(context.database(), project, request.params.bindingId, dataDir, { conflictMode: pluginHubConflictModeBody(request) }));
    } catch (error) {
      response.status(400).json({ error: "project-plugin-sync-failed", reason: error instanceof Error ? error.message : "project-plugin-sync-failed" });
    }
  });

  app.delete("/api/projects/:id/plugin-bindings/:bindingId", (request, response) => {
    const project = projectSkillScopeFromRequest(context, request, response);
    if (!project) return;
    try {
      response.json(uninstallProjectPluginBinding(context.database(), project, request.params.bindingId));
    } catch (error) {
      response.status(400).json({ error: "project-plugin-uninstall-failed", reason: error instanceof Error ? error.message : "project-plugin-uninstall-failed" });
    }
  });

  app.get("/api/projects/:id/mcp", (request, response) => {
    const project = projectSkillScopeFromRequest(context, request, response);
    if (!project) return;
    response.json(listProjectMcpState(context.database(), project));
  });

  app.put("/api/projects/:id/mcp-bindings/:serverId/:toolId", (request, response) => {
    const project = projectSkillScopeFromRequest(context, request, response);
    const toolId = mcpHubTargetToolIdParam(request);
    if (!project) return;
    if (!toolId) {
      response.status(400).json({ error: "toolId must be claude, codex, or opencode" });
      return;
    }
    try {
      response.json(applyProjectMcpServer(context.database(), project, toolId, request.params.serverId));
    } catch (error) {
      response.status(400).json({ error: "project-mcp-apply-failed", reason: error instanceof Error ? error.message : "project-mcp-apply-failed" });
    }
  });

  app.delete("/api/projects/:id/mcp-bindings/:serverId/:toolId", (request, response) => {
    const project = projectSkillScopeFromRequest(context, request, response);
    const toolId = mcpHubTargetToolIdParam(request);
    if (!project) return;
    if (!toolId) {
      response.status(400).json({ error: "toolId must be claude, codex, or opencode" });
      return;
    }
    try {
      response.json(disableProjectMcpServer(context.database(), project, toolId, request.params.serverId));
    } catch (error) {
      response.status(400).json({ error: "project-mcp-disable-failed", reason: error instanceof Error ? error.message : "project-mcp-disable-failed" });
    }
  });

  app.post("/api/projects/:id/local-mcp/migrate", (request, response) => {
    const project = projectSkillScopeFromRequest(context, request, response);
    const serverId = stringBody(request, "serverId");
    const mode = localMcpMigrationModeBody(request);
    if (!project) return;
    if (!serverId || mode === undefined) {
      response.status(400).json({ error: "serverId and valid mode are required" });
      return;
    }
    try {
      response.json(migrateProjectLocalMcp(context.database(), project, serverId, mode));
    } catch (error) {
      response.status(400).json({ error: "project-local-mcp-migration-failed", reason: error instanceof Error ? error.message : "project-local-mcp-migration-failed" });
    }
  });

  app.get("/api/projects/:id/hooks", (request, response) => {
    const project = projectSkillScopeFromRequest(context, request, response);
    if (!project) return;
    response.json(listProjectHookState(context.database(), project, String(request.query.query ?? "")));
  });

  app.post("/api/projects/:id/hooks/sync", (request, response) => {
    const project = projectSkillScopeFromRequest(context, request, response);
    if (!project) return;
    try {
      response.json(syncProjectHooksFromHookHub(context.database(), project));
    } catch (error) {
      response.status(400).json({ error: "project-hooks-sync-failed", reason: error instanceof Error ? error.message : "project-hooks-sync-failed" });
    }
  });

  app.put("/api/projects/:id/hooks/:toolId", (request, response) => {
    const project = projectSkillScopeFromRequest(context, request, response);
    const toolId = hookHubSupportedToolIdParam(request);
    if (!project) return;
    if (!toolId || request.body?.hooks === undefined) {
      response.status(400).json({ error: "toolId must be claude, codex, qwen, or qoder; hooks is required" });
      return;
    }
    try {
      response.json(writeProjectHooks(context.database(), project, toolId, request.body.hooks, hookHubPartialSuiteInputBody(request)));
    } catch (error) {
      response.status(400).json({ error: "project-hooks-write-failed", reason: error instanceof Error ? error.message : "project-hooks-write-failed" });
    }
  });

  app.post("/api/projects/:id/hooks/:toolId/share", (request, response) => {
    const project = projectSkillScopeFromRequest(context, request, response);
    const toolId = hookHubSupportedToolIdParam(request);
    const input = hookHubSuiteInputBody(request);
    if (!project) return;
    if (!toolId || !input) {
      response.status(400).json({ error: "toolId and name are required" });
      return;
    }
    try {
      response.json(shareProjectHooksToHookHub(context.database(), project, toolId, input));
    } catch (error) {
      response.status(400).json({ error: "project-hooks-share-failed", reason: error instanceof Error ? error.message : "project-hooks-share-failed" });
    }
  });

  app.delete("/api/projects/:id/hooks/:toolId/binding", (request, response) => {
    const project = projectSkillScopeFromRequest(context, request, response);
    const toolId = hookHubSupportedToolIdParam(request);
    if (!project) return;
    if (!toolId) {
      response.status(400).json({ error: "toolId must be claude, codex, qwen, or qoder" });
      return;
    }
    try {
      response.json(removeProjectHookBinding(context.database(), project, toolId));
    } catch (error) {
      response.status(400).json({ error: "project-hook-binding-remove-failed", reason: error instanceof Error ? error.message : "project-hook-binding-remove-failed" });
    }
  });

  app.post("/api/projects/:id/hooks/:toolId/sync", (request, response) => {
    const project = projectSkillScopeFromRequest(context, request, response);
    const toolId = hookHubSupportedToolIdParam(request);
    if (!project) return;
    if (!toolId) {
      response.status(400).json({ error: "toolId must be claude, codex, qwen, or qoder" });
      return;
    }
    try {
      response.json(syncProjectHookToolFromHookHub(context.database(), project, toolId));
    } catch (error) {
      response.status(400).json({ error: "project-hook-sync-failed", reason: error instanceof Error ? error.message : "project-hook-sync-failed" });
    }
  });

  app.put("/api/projects/:id/hooks/:toolId/apply/:suiteId", (request, response) => {
    const project = projectSkillScopeFromRequest(context, request, response);
    const toolId = hookHubSupportedToolIdParam(request);
    if (!project) return;
    if (!toolId) {
      response.status(400).json({ error: "toolId must be claude, codex, qwen, or qoder" });
      return;
    }
    try {
      response.json(
        applyHookHubSuiteToProject(context.database(), project, toolId, request.params.suiteId, {
          mode: hookHubApplyModeBody(request),
          preserveName: stringBody(request, "preserveName"),
          description: stringBody(request, "description"),
          riskNotes: stringBody(request, "riskNotes"),
          requiredEnv: stringArrayBody(request, "requiredEnv")
        })
      );
    } catch (error) {
      response.status(400).json({ error: "project-hook-apply-failed", reason: error instanceof Error ? error.message : "project-hook-apply-failed" });
    }
  });

  app.get("/api/projects/:id/agents", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const project = projectSkillScopeFromRequest(context, request, response);
    if (!dataDir || !project) return;
    response.json(listProjectAgentState(context.database(), dataDir, project, String(request.query.query ?? "")));
  });

  app.get("/api/projects/:id/local-agents", (request, response) => {
    const project = projectSkillScopeFromRequest(context, request, response);
    if (!project) return;
    response.json(listProjectLocalAgentState(context.database(), project));
  });

  app.post("/api/projects/:id/agents/sync", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const project = projectSkillScopeFromRequest(context, request, response);
    if (!dataDir || !project) return;
    try {
      response.json(syncProjectAgents(context.database(), dataDir, project));
    } catch (error) {
      response.status(400).json({ error: "project-agent-sync-all-failed", reason: error instanceof Error ? error.message : "project-agent-sync-all-failed" });
    }
  });

  app.put("/api/projects/:id/agent-targets/:agentId/:toolId", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const project = projectSkillScopeFromRequest(context, request, response);
    const toolId = agentHubToolIdParam(request, "toolId");
    if (!dataDir || !project) return;
    if (!toolId) {
      response.status(400).json({ error: "toolId must be claude, codex, opencode, cursor, or qwen" });
      return;
    }
    try {
      response.json(
        applyProjectAgentTarget(context.database(), dataDir, project, request.params.agentId, toolId, {
          conflictMode: agentHubApplyConflictModeBody(request)
        })
      );
    } catch (error) {
      response.status(400).json({ error: "project-agent-apply-failed", reason: error instanceof Error ? error.message : "project-agent-apply-failed" });
    }
  });

  app.post("/api/projects/:id/agent-bindings/:bindingId/sync", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const project = projectSkillScopeFromRequest(context, request, response);
    if (!dataDir || !project) return;
    try {
      response.json(syncProjectAgentTarget(context.database(), dataDir, project, request.params.bindingId));
    } catch (error) {
      response.status(400).json({ error: "project-agent-sync-failed", reason: error instanceof Error ? error.message : "project-agent-sync-failed" });
    }
  });

  app.delete("/api/projects/:id/agent-bindings/:bindingId", (request, response) => {
    const project = projectSkillScopeFromRequest(context, request, response);
    if (!project) return;
    try {
      response.json(disableProjectAgentTarget(context.database(), project, request.params.bindingId, { mode: agentHubDisableModeBody(request) }));
    } catch (error) {
      response.status(400).json({ error: "project-agent-disable-failed", reason: error instanceof Error ? error.message : "project-agent-disable-failed" });
    }
  });

  app.post("/api/projects/:id/local-agents/migrate", (request, response) => {
    const dataDir = requireDataDir(context, response);
    const project = projectSkillScopeFromRequest(context, request, response);
    const toolId = agentHubToolIdBody(request, "toolId");
    const outputPath = stringBody(request, "outputPath");
    const target = localAgentMigrationTargetBody(request);
    if (!dataDir || !project) return;
    if (!toolId || !outputPath || target === undefined) {
      response.status(400).json({ error: "toolId, outputPath, and valid target are required" });
      return;
    }
    try {
      response.json(
        migrateProjectLocalAgent(context.database(), dataDir, project, toolId, outputPath, target, {
          conflictResolution: agentHubConflictResolutionBody(request)
        })
      );
    } catch (error) {
      response.status(400).json({ error: "project-local-agent-migration-failed", reason: error instanceof Error ? error.message : "project-local-agent-migration-failed" });
    }
  });

  app.put("/api/projects/:id/skill-targets/:skillId", (request, response) => {
    const dataDir = requireDataDir(context, response);
    if (!dataDir) return;
    seedDefaultSkillHubSources(context.database(), context.config(), dataDir);
    const project = projectSkillScopeFromRequest(context, request, response);
    if (!project) {
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

  app.post("/api/projects/:id/rule-sync/create-preview", (request, response) => {
    const project = context.database().getProject(request.params.id);
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    const file = ruleFileNameBody(request);
    const source = ruleCreateSourceBody(request);
    if (!file || !source) {
      response.status(400).json({ error: "file must be AGENTS.md or CLAUDE.md and source must be sync or template" });
      return;
    }
    try {
      response.json(prepareRuleFileCreate(project, file, source));
    } catch (error) {
      response.status(400).json({ error: "rule-create-preview-failed", reason: error instanceof Error ? error.message : "rule-create-preview-failed" });
    }
  });

  app.post("/api/projects/:id/rule-sync/create", (request, response) => {
    const project = context.database().getProject(request.params.id);
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    const file = ruleFileNameBody(request);
    const content = rawStringBody(request, "content");
    if (!file || content === null) {
      response.status(400).json({ error: "file must be AGENTS.md or CLAUDE.md and content is required" });
      return;
    }
    try {
      response.json(createRuleFile(project, file, content));
    } catch (error) {
      response.status(400).json({ error: "rule-create-failed", reason: error instanceof Error ? error.message : "rule-create-failed" });
    }
  });

  app.post("/api/projects/:id/rule-sync/template", (request, response) => {
    const project = context.database().getProject(request.params.id);
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    try {
      response.json(createRuleTemplateFile(project));
    } catch (error) {
      response.status(400).json({ error: "rule-template-create-failed", reason: error instanceof Error ? error.message : "rule-template-create-failed" });
    }
  });

  app.post("/api/projects/:id/rule-sync/open", (request, response) => {
    const project = context.database().getProject(request.params.id);
    if (!project) {
      response.status(404).json({ error: "project-not-found" });
      return;
    }
    const file = ruleFileNameBody(request);
    if (!file) {
      response.status(400).json({ error: "file must be AGENTS.md or CLAUDE.md" });
      return;
    }
    try {
      response.json(openRuleFile(project, file));
    } catch (error) {
      response.status(400).json({ error: "rule-file-open-failed", reason: error instanceof Error ? error.message : "rule-file-open-failed" });
    }
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

function stringParam(request: Request, key: string): string | null {
  const value = request.params[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function terminalUpdateCompletionBody(request: Request): { exitCode: number | null; stdout: string | null; stderr: string | null } {
  const exitCode = typeof request.body?.exitCode === "number" && Number.isFinite(request.body.exitCode) ? Math.trunc(request.body.exitCode) : null;
  return {
    exitCode,
    stdout: rawStringBody(request, "stdout"),
    stderr: rawStringBody(request, "stderr")
  };
}

function rawStringBody(request: Request, key: string): string | null {
  const value = request.body?.[key];
  return typeof value === "string" ? value : null;
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

function toolIdBody(request: Request): ToolId | null {
  return isToolId(request.body?.toolId) ? request.body.toolId : null;
}

function hookHubSupportedToolIdBody(request: Request): HookHubSupportedToolId | null {
  return isHookHubSupportedToolId(request.body?.toolId) ? request.body.toolId : null;
}

function mcpHubTargetToolIdParam(request: Request): McpHubTargetToolId | null {
  return isMcpHubTargetToolId(request.params.toolId) ? request.params.toolId : null;
}

function hookHubSupportedToolIdParam(request: Request): HookHubSupportedToolId | null {
  return isHookHubSupportedToolId(request.params.toolId) ? request.params.toolId : null;
}

function agentHubToolIdBody(request: Request, key: string): AgentHubToolId | null {
  return isAgentHubToolId(request.body?.[key]) ? request.body[key] : null;
}

function agentHubToolIdParam(request: Request, key: string): AgentHubToolId | null {
  return isAgentHubToolId(request.params[key]) ? request.params[key] : null;
}

function agentHubApplyConflictModeBody(request: Request): AgentHubApplyConflictMode | null {
  const value = request.body?.conflictMode;
  return value === "overwrite" || value === "migrate-then-overwrite" || value === "replace-managed" ? value : null;
}

function agentHubDisableModeBody(request: Request): AgentHubDisableMode | null {
  const bodyValue = request.body?.mode;
  const queryValue = request.query.mode;
  const value = typeof bodyValue === "string" ? bodyValue : typeof queryValue === "string" ? queryValue : null;
  return value === "keep-file" || value === "delete-with-backup" ? value : null;
}

function agentHubConflictResolutionBody(request: Request): AgentHubImportConflictResolution | null {
  const value = request.body?.conflictResolution;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const slug = typeof record.slug === "string" ? record.slug.trim() : "";
  const action = record.action;
  if (!slug || (action !== "overwrite" && action !== "rename" && action !== "skip")) return null;
  return {
    slug,
    action,
    renameSlug: typeof record.renameSlug === "string" ? record.renameSlug.trim() : null
  };
}

function agentHubConflictResolutionsBody(request: Request): AgentHubImportConflictResolution[] {
  const values = Array.isArray(request.body?.conflictResolutions) ? request.body.conflictResolutions : [];
  return values.flatMap((value: unknown) => {
    const fakeRequest = { body: { conflictResolution: value } } as Request;
    const parsed = agentHubConflictResolutionBody(fakeRequest);
    return parsed ? [parsed] : [];
  });
}

function hookHubApplyModeBody(request: Request): HookHubApplyMode | null {
  const value = request.body?.mode;
  return value === "overwrite" ||
    value === "upload-then-overwrite" ||
    value === "update-bound-suite-then-overwrite" ||
    value === "save-as-new-suite-then-overwrite"
    ? value
    : null;
}

function hookHubImportConflictModeBody(request: Request): HookHubImportConflictMode | null {
  const value = request.body?.conflictMode;
  return value === "overwrite" || value === "rename" || value === "cancel" ? value : null;
}

function hookHubSuiteInputBody(request: Request): HookHubSuiteInput | null {
  const name = stringBody(request, "name");
  if (!name) return null;
  const payloads = hookHubPayloadsBody(request);
  return {
    name,
    description: stringBody(request, "description"),
    riskNotes: stringBody(request, "riskNotes"),
    requiredEnv: stringArrayBody(request, "requiredEnv"),
    ...(Object.keys(payloads).length ? { payloads } : {})
  };
}

function hookHubPartialSuiteInputBody(request: Request): Partial<HookHubSuiteInput> {
  const payloads = hookHubPayloadsBody(request);
  return {
    ...(typeof request.body?.name === "string" ? { name: request.body.name } : {}),
    ...(request.body?.description !== undefined ? { description: typeof request.body.description === "string" ? request.body.description : null } : {}),
    ...(request.body?.riskNotes !== undefined ? { riskNotes: typeof request.body.riskNotes === "string" ? request.body.riskNotes : null } : {}),
    ...(request.body?.requiredEnv !== undefined ? { requiredEnv: stringArrayBody(request, "requiredEnv") } : {}),
    ...(request.body?.payloads !== undefined ? { payloads } : {})
  };
}

function hookHubPayloadsBody(request: Request): Partial<Record<HookHubSupportedToolId, unknown>> {
  const value = request.body?.payloads;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const payloads: HookHubSuiteInput["payloads"] = {};
  for (const toolId of ["claude", "codex", "qwen", "qoder"] satisfies HookHubSupportedToolId[]) {
    if (Object.prototype.hasOwnProperty.call(value, toolId)) payloads[toolId] = value[toolId];
  }
  return payloads;
}

function pluginHubCustomPluginInputBody(request: Request): PluginHubCustomPluginInput | null {
  const name = stringBody(request, "name");
  if (!name) return null;
  const privateFileInputs: unknown[] = Array.isArray(request.body?.privateFiles) ? request.body.privateFiles : [];
  return {
    name,
    displayName: stringBody(request, "displayName"),
    description: stringBody(request, "description"),
    componentRefs: pluginHubComponentRefsBody(request),
    privateFiles: privateFileInputs
      .filter((item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .flatMap((item) => {
        const sourceRelativePath = typeof item.sourceRelativePath === "string" ? item.sourceRelativePath.trim() : "";
        const content = typeof item.content === "string" ? item.content : "";
        if (!sourceRelativePath) return [];
        return [
          {
            sourceRelativePath,
            targetRelativePath: typeof item.targetRelativePath === "string" ? item.targetRelativePath.trim() : null,
            content,
            required: typeof item.required === "boolean" ? item.required : true
          }
        ];
      })
  };
}

function pluginHubComponentRefsBody(request: Request): PluginHubComponentRef[] {
  const value = request.body?.componentRefs;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const type = record.type;
    const componentId = typeof record.componentId === "string" ? record.componentId.trim() : "";
    if ((type !== "skill" && type !== "agent" && type !== "mcp" && type !== "hook") || !componentId) return [];
    return [{ type, componentId, required: Boolean(record.required) }];
  });
}

function pluginHubConflictModeBody(request: Request): "overwrite" | "skip" | null {
  const value = request.body?.conflictMode;
  return value === "overwrite" || value === "skip" ? value : null;
}

function pluginHubSourceDeleteModeBody(request: Request): PluginHubSourceDeleteMode | null {
  const bodyValue = request.body?.mode;
  const queryValue = request.query.mode;
  const value = typeof bodyValue === "string" ? bodyValue : typeof queryValue === "string" ? queryValue : null;
  return value === "delete-custom-plugins" || value === "remove-custom-components" ? value : null;
}

function stringArrayBody(request: Request, key: string): string[] {
  const value = request.body?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item: unknown): item is string => typeof item === "string");
}

function localMcpMigrationModeBody(request: Request): ProjectLocalMcpMigrationMode | null | undefined {
  if (request.body?.mode === undefined || request.body?.mode === null) return null;
  if (request.body.mode === "link-existing" || request.body.mode === "overwrite-mcphub") return request.body.mode;
  return undefined;
}

function localSkillMigrationModeBody(request: Request): ProjectLocalSkillMigrationMode | null | undefined {
  if (request.body?.mode === undefined || request.body?.mode === null) return null;
  if (request.body.mode === "overwrite-skillhub" || request.body.mode === "link-existing") return request.body.mode;
  return undefined;
}

function localSkillMigrationTargetBody(request: Request): ProjectLocalSkillMigrationTarget | null | undefined {
  const target = request.body?.target;
  if (target === undefined || target === null) return null;
  if (typeof target !== "object" || Array.isArray(target)) return undefined;

  if (target.type === "existing-source") {
    const sourceId = typeof target.sourceId === "string" ? target.sourceId.trim() : "";
    return sourceId ? { type: "existing-source", sourceId } : undefined;
  }

  if (target.type === "new-source") {
    const targetPath = typeof target.path === "string" ? target.path.trim() : "";
    const label = typeof target.label === "string" && target.label.trim() ? target.label.trim() : null;
    return targetPath ? { type: "new-source", path: targetPath, label } : undefined;
  }

  return undefined;
}

function projectSkillScopeFromRequest(context: AppContext, request: Request, response: Response) {
  const projectId = request.params.id;
  if (!projectId || Array.isArray(projectId)) {
    response.status(404).json({ error: "project-not-found" });
    return null;
  }
  const project = context.database().getProject(projectId);
  if (!project) {
    response.status(404).json({ error: "project-not-found" });
    return null;
  }

  const targetRootPath = targetRootPathFromRequest(request);
  if (!targetRootPath) return project;

  const normalizedTargetRoot = normalizeFsPath(targetRootPath);
  if (!isPathInsideOrEqual(project.normalizedRootPath, normalizedTargetRoot)) {
    response.status(400).json({ error: "targetRootPath-outside-project" });
    return null;
  }

  if (normalizedTargetRoot !== project.normalizedRootPath && !project.includeSubdirectories) {
    response.status(400).json({ error: "targetRootPath-requires-subdirectories" });
    return null;
  }

  return {
    ...project,
    rootPath: displayPath(targetRootPath),
    normalizedRootPath: normalizedTargetRoot,
    includeSubdirectories: false
  };
}

function targetRootPathFromRequest(request: Request): string | null {
  const bodyValue = typeof request.body?.targetRootPath === "string" ? request.body.targetRootPath : null;
  const queryValue = typeof request.query.targetRootPath === "string" ? request.query.targetRootPath : null;
  const value = (bodyValue ?? queryValue)?.trim();
  return value ? value : null;
}

function refreshModeBody(request: Request): RefreshMode | null {
  if (request.body?.mode === undefined) return "full";
  return request.body.mode === "incremental" || request.body.mode === "full" ? request.body.mode : null;
}

function ruleSyncDirectionBody(request: Request): RuleSyncDirection | null {
  return request.body?.direction === "agents-to-claude" || request.body?.direction === "claude-to-agents" ? request.body.direction : null;
}

function localAgentMigrationTargetBody(request: Request): ProjectLocalAgentMigrationTarget | undefined {
  const target = request.body?.target;
  if (!target || typeof target !== "object" || Array.isArray(target)) return undefined;
  if (target.type === "existing-source") {
    const sourceId = typeof target.sourceId === "string" ? target.sourceId.trim() : "";
    return sourceId ? { type: "existing-source", sourceId } : undefined;
  }
  if (target.type === "new-source") {
    const label = typeof target.label === "string" && target.label.trim() ? target.label.trim() : "project-local-agents";
    const inputPath = typeof target.path === "string" && target.path.trim() ? target.path.trim() : null;
    return { type: "new-source", label, path: inputPath };
  }
  return undefined;
}

function ruleFileNameBody(request: Request): RuleFileName | null {
  return request.body?.file === "AGENTS.md" || request.body?.file === "CLAUDE.md" ? request.body.file : null;
}

function ruleCreateSourceBody(request: Request): RuleCreateSource | null {
  return request.body?.source === "sync" || request.body?.source === "template" ? request.body.source : null;
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
