import fs from "node:fs";
import path from "node:path";
import type {
  Project,
  ProjectSkillConflict,
  ProjectSkillLinkFailure,
  ProjectSkillTarget,
  ProjectSkillTargetsState,
  ProjectSkillUpdateResult,
  ProjectToolTarget,
  ToolId
} from "../../shared/types.js";
import type { AppDatabase } from "../storage/database.js";
import { toolAdapters } from "../tools/adapters.js";
import { createDirectoryLink, linkPointsTo, pathExists, removeDirectoryLink } from "./links.js";

const allToolIds: ToolId[] = ["codex", "claude", "opencode", "qwen", "qoder", "copilot"];

export function listProjectToolTargets(database: AppDatabase, project: Project): ProjectToolTarget[] {
  ensureProjectToolTargets(database, project);
  const stored = new Map(database.listStoredProjectToolTargets(project.id).map((target) => [target.toolId, target]));
  return allToolIds.map((toolId) => {
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

export function updateProjectToolTargets(database: AppDatabase, project: Project, toolIds: ToolId[]): ProjectToolTarget[] {
  database.replaceProjectToolTargets(project.id, uniqueToolIds(toolIds));
  return listProjectToolTargets(database, project);
}

export function listProjectSkillTargetsState(database: AppDatabase, project: Project): ProjectSkillTargetsState {
  return {
    projectId: project.id,
    toolTargets: listProjectToolTargets(database, project),
    skillTargets: database.listProjectSkillTargets(project.id),
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
  const toolTargets = new Map(listProjectToolTargets(database, project).map((target) => [target.toolId, target]));
  const currentTargets = database.listProjectSkillTargets(project.id).filter((target) => target.skillId === skillId);
  const removed: ProjectSkillTarget[] = [];
  const targets: ProjectSkillTarget[] = [];
  const conflicts: ProjectSkillConflict[] = [];
  const failures: ProjectSkillLinkFailure[] = [];

  for (const current of currentTargets) {
    if (targetIds.has(current.toolId)) continue;
    const removal = removeDirectoryLink(current.linkPath);
    if (!removal.reason || removal.missing) {
      database.deleteProjectSkillTarget(current.projectId, current.toolId, current.skillId);
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

export function ensureProjectToolTargets(database: AppDatabase, project: Project): void {
  const stored = new Set(database.listStoredProjectToolTargets(project.id).map((target) => target.toolId));
  if (stored.size === allToolIds.length) return;
  const inferred = inferProjectToolIds(database, project);
  for (const toolId of allToolIds) {
    if (stored.has(toolId)) continue;
    database.upsertProjectToolTarget(project.id, toolId, inferred.has(toolId), true);
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
  opencode: [".opencode", "OPENCODE.md"],
  qwen: [".qwen", "QWEN.md"],
  qoder: [".qoder", "QODER.md"],
  copilot: [".github/copilot-instructions.md", ".github", ".vscode"]
};

function uniqueToolIds(toolIds: ToolId[]): ToolId[] {
  const allowed = new Set<ToolId>(allToolIds);
  return [...new Set(toolIds.filter((toolId) => allowed.has(toolId)))];
}

function failure(projectId: string, toolId: ToolId, skillId: string, linkPath: string, targetPath: string, reason: string): ProjectSkillLinkFailure {
  return { projectId, toolId, skillId, linkPath, targetPath, reason };
}
