import fs from "node:fs";
import path from "node:path";
import type {
  AppConfig,
  Project,
  ProjectSkillConflict,
  ProjectSkillLinkFailure,
  ProjectSkillTarget,
  ProjectSkillTargetsState,
  ProjectSkillUpdateResult,
  ProjectToolTarget,
  ToolId
} from "../../shared/types.js";
import { toolIds } from "../../shared/types.js";
import type { AppDatabase } from "../storage/database.js";
import { isPathInsideOrEqual, normalizeFsPath } from "../core/pathUtils.js";
import { projectConfigurableToolStatuses, toolAdapters } from "../tools/adapters.js";
import { createDirectoryLink, linkPointsTo, pathExists, removeDirectoryLink } from "./links.js";

const allToolIds: ToolId[] = [...toolIds];

export function listProjectToolTargets(database: AppDatabase, project: Project, config?: AppConfig): ProjectToolTarget[] {
  ensureProjectToolTargets(database, project, config);
  const stored = new Map(database.listStoredProjectToolTargets(project.id).map((target) => [target.toolId, target]));
  return projectTargetToolIds(config).map((toolId) => {
    const adapterTarget = toolAdapters[toolId].skillTarget(project.rootPath);
    const row = stored.get(toolId);
    return {
      projectId: project.id,
      toolId,
      enabled: row?.enabled ?? false,
      inferred: row?.inferred ?? false,
      supported: adapterTarget.supported,
      skillDirectory: adapterTarget.directory,
      reason: adapterTarget.reason,
      updatedAt: row?.updatedAt ?? new Date(0).toISOString()
    };
  });
}

export function updateProjectToolTargets(database: AppDatabase, project: Project, toolIds: ToolId[], config?: AppConfig): ProjectToolTarget[] {
  database.replaceProjectToolTargets(project.id, uniqueProjectToolIds(toolIds, config));
  return listProjectToolTargets(database, project, config);
}

export function unavailableProjectToolIds(config: AppConfig, toolIds: ToolId[]): ToolId[] {
  const allowed = new Set(projectTargetToolIds(config));
  return uniqueToolIds(toolIds).filter((toolId) => !allowed.has(toolId));
}

export function listProjectSkillTargetsState(database: AppDatabase, project: Project): ProjectSkillTargetsState {
  const toolTargets = listProjectToolTargets(database, project);
  return {
    projectId: project.id,
    toolTargets,
    skillTargets: scopedProjectSkillTargets(database, project.id, toolTargets),
    skills: database.listSkillHubSkills()
  };
}

export function setProjectSkillTargets(
  database: AppDatabase,
  project: Project,
  skillId: string,
  toolIds: ToolId[],
  options: { replaceConflicts?: boolean } = {}
): ProjectSkillUpdateResult {
  const skill = database.getSkillHubSkill(skillId);
  if (!skill) throw new Error("SkillHub skill not found");
  const targetIds = new Set(uniqueToolIds(toolIds));
  const toolTargetList = listProjectToolTargets(database, project);
  const toolTargets = new Map(toolTargetList.map((target) => [target.toolId, target]));
  const currentTargets = scopedProjectSkillTargets(database, project.id, toolTargetList).filter((target) => target.skillId === skillId);
  const removed: ProjectSkillTarget[] = [];
  const targets: ProjectSkillTarget[] = [];
  const conflicts: ProjectSkillConflict[] = [];
  const failures: ProjectSkillLinkFailure[] = [];

  for (const current of currentTargets) {
    if (targetIds.has(current.toolId)) continue;
    const removal = removeDirectoryLink(current.linkPath);
    if (!removal.reason || removal.missing) {
      database.deleteProjectSkillTarget(current.projectId, current.toolId, current.skillId, current.linkPath);
      removed.push(current);
    } else {
      failures.push(failure(current.projectId, current.toolId, current.skillId, current.linkPath, current.targetPath, removal.reason));
    }
  }

  for (const toolId of targetIds) {
    const toolTarget = toolTargets.get(toolId);
    if (!toolTarget?.enabled) {
      failures.push(failure(project.id, toolId, skill.id, "", skill.libraryPath, "该工具未在项目中启用"));
      continue;
    }
    if (!toolTarget.supported || !toolTarget.skillDirectory) {
      failures.push(failure(project.id, toolId, skill.id, "", skill.libraryPath, toolTarget?.reason ?? "该工具暂不支持项目技能目录"));
      continue;
    }

    const linkPath = path.join(toolTarget.skillDirectory, skill.folderName);
    const existingByLink = database.getProjectSkillTargetByLinkPath(project.id, toolId, linkPath);
    if (existingByLink && existingByLink.skillId !== skill.id) {
      const existingSkill = database.getSkillHubSkill(existingByLink.skillId);
      conflicts.push({ toolId, linkPath, existingSkill, requestedSkill: skill });
      if (isPluginOwnedSkillTarget(database, project.id, toolId, linkPath, existingByLink.skillId)) {
        failures.push(failure(project.id, toolId, skill.id, linkPath, skill.libraryPath, "该目标由项目 Plugin 管理，请从 Plugin 入口卸载或同步"));
        continue;
      }
      if (!options.replaceConflicts) continue;
      const removal = removeDirectoryLink(existingByLink.linkPath);
      if (removal.reason && !removal.missing) {
        failures.push(failure(project.id, toolId, skill.id, linkPath, skill.libraryPath, removal.reason));
        continue;
      }
      database.deleteProjectSkillTargetByLinkPath(project.id, toolId, linkPath);
    }

    if (pathExists(linkPath)) {
      if (!linkPointsTo(linkPath, skill.libraryPath)) {
        if (existingByLink && isPluginOwnedSkillTarget(database, project.id, toolId, linkPath, existingByLink.skillId)) {
          failures.push(failure(project.id, toolId, skill.id, linkPath, skill.libraryPath, "该目标由项目 Plugin 管理，请从 Plugin 入口卸载或同步"));
          continue;
        }
        if (!options.replaceConflicts) {
          conflicts.push({ toolId, linkPath, existingSkill: existingByLink ? database.getSkillHubSkill(existingByLink.skillId) : null, requestedSkill: skill });
          continue;
        }
        const removal = removeDirectoryLink(linkPath);
        if (removal.reason && !removal.missing) {
          failures.push(failure(project.id, toolId, skill.id, linkPath, skill.libraryPath, removal.reason));
          continue;
        }
      }
    } else {
      try {
        createDirectoryLink(skill.libraryPath, linkPath);
      } catch (error) {
        failures.push(failure(project.id, toolId, skill.id, linkPath, skill.libraryPath, error instanceof Error ? error.message : "link 创建失败"));
        continue;
      }
    }

    targets.push(
      database.upsertProjectSkillTarget({
        projectId: project.id,
        toolId,
        skillId: skill.id,
        linkPath,
        targetPath: skill.libraryPath
      })
    );
  }

  return {
    projectId: project.id,
    skillId,
    targets,
    removed,
    conflicts,
    failures,
    requiresConfirmation: conflicts.length > 0 && !options.replaceConflicts
  };
}

function scopedProjectSkillTargets(database: AppDatabase, projectId: string, toolTargets: ProjectToolTarget[]): ProjectSkillTarget[] {
  const skillDirectories = toolTargets
    .filter((target) => target.supported && target.skillDirectory)
    .map((target) => target.skillDirectory as string);
  if (skillDirectories.length === 0) return [];
  return database.listProjectSkillTargets(projectId).filter((target) =>
    skillDirectories.some((skillDirectory) => isPathInsideOrEqual(skillDirectory, target.linkPath))
  );
}

function isPluginOwnedSkillTarget(database: AppDatabase, projectId: string, toolId: ToolId, linkPath: string, skillId: string): boolean {
  return database.listProjectPluginBindings(projectId).some((binding) =>
    binding.componentOwnership.some(
      (owner) =>
        owner.ownerState === "managed" &&
        owner.type === "skill" &&
        owner.toolId === toolId &&
        owner.componentId === skillId &&
        normalizeFsPath(owner.linkPath ?? owner.targetPath) === normalizeFsPath(linkPath)
    )
  );
}

export function ensureProjectToolTargets(database: AppDatabase, project: Project, config?: AppConfig): void {
  const stored = new Map(database.listStoredProjectToolTargets(project.id).map((target) => [target.toolId, target]));
  const inferred = inferProjectToolIds(database, project);
  for (const toolId of projectTargetToolIds(config)) {
    const existing = stored.get(toolId);
    const enabled = inferred.has(toolId);
    if (existing && !existing.inferred) continue;
    if (existing && existing.enabled === enabled) continue;
    database.upsertProjectToolTarget(project.id, toolId, enabled, true);
  }
}

function inferProjectToolIds(database: AppDatabase, project: Project): Set<ToolId> {
  const inferred = new Set<ToolId>();
  for (const session of database.listSessionsForProject(project)) {
    inferred.add(session.toolId);
  }
  for (const [toolId, traces] of Object.entries(projectTraceMap) as Array<[ToolId, string[]]>) {
    if (traces.some((trace) => fs.existsSync(path.join(project.rootPath, trace)))) {
      inferred.add(toolId);
    }
  }
  return inferred;
}

const projectTraceMap: Record<ToolId, string[]> = {
  codex: [".codex", "AGENTS.md"],
  claude: [".claude", "CLAUDE.md"],
  cline: [],
  opencode: [".opencode", "OPENCODE.md"],
  kilo: [".kilo", ".kilocode", "KILO.md"],
  qwen: [".qwen", "QWEN.md"],
  kimi: [],
  qoder: [".qoder", "QODER.md"],
  codebuddy: [],
  copilot: [".github/copilot-instructions.md"],
  cursor: [".cursor", ".cursorrules"],
  antigravity: [".agents/mcp_config.json"],
  deepcode: [],
  reasonix: []
};

function uniqueToolIds(toolIds: ToolId[]): ToolId[] {
  const allowed = new Set<ToolId>(allToolIds);
  return [...new Set(toolIds.filter((toolId) => allowed.has(toolId)))];
}

function uniqueProjectToolIds(toolIds: ToolId[], config?: AppConfig): ToolId[] {
  const allowed = new Set(projectTargetToolIds(config));
  return uniqueToolIds(toolIds).filter((toolId) => allowed.has(toolId));
}

function projectTargetToolIds(config?: AppConfig): ToolId[] {
  if (!config) return allToolIds;
  return projectConfigurableToolStatuses(config).map((tool) => tool.toolId);
}

function failure(projectId: string, toolId: ToolId, skillId: string, linkPath: string, targetPath: string, reason: string): ProjectSkillLinkFailure {
  return { projectId, toolId, skillId, linkPath, targetPath, reason };
}
