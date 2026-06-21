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
  ProjectConfigTargetId
} from "../../shared/types.js";
import type { AppDatabase } from "../storage/database.js";
import { isPathInsideOrEqual, normalizeFsPath } from "../core/pathUtils.js";
import {
  projectConfigTargetIdsForConfig,
  projectConfigTargetSkillDirectoryOptions,
  projectConfigTargetSkillTarget,
  projectConfigTargetTraceEntries,
  uniqueProjectConfigTargetIds as uniqueKnownProjectConfigTargetIds
} from "../projectTargets/projectConfigTargets.js";
import { createDirectoryLink, linkPointsTo, pathExists, removeDirectoryLink } from "./links.js";


interface ProjectSkillDirectoryTarget {
  toolId: ProjectConfigTargetId;
  directory: string;
  normalizedDirectory: string;
  kind: "private" | "public";
  preferred: boolean;
  sharedCandidate: boolean;
}

interface ProjectSkillDirectoryGroup {
  directory: string;
  normalizedDirectory: string;
  toolIds: ProjectConfigTargetId[];
  shared: boolean;
}

export function listProjectToolTargets(database: AppDatabase, project: Project, config?: AppConfig): ProjectToolTarget[] {
  ensureProjectToolTargets(database, project, config);
  const stored = new Map(database.listStoredProjectToolTargets(project.id).map((target) => [target.toolId, target]));
  return projectTargetToolIds(config).map((toolId) => {
    const adapterTarget = projectConfigTargetSkillTarget(
      toolId,
      project.rootPath,
      config ? { directoryPreference: config.projectResources.directoryPreference } : undefined
    );
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

export function updateProjectToolTargets(database: AppDatabase, project: Project, toolIds: ProjectConfigTargetId[], config?: AppConfig): ProjectToolTarget[] {
  database.replaceProjectToolTargets(project.id, uniqueProjectToolIds(toolIds, config));
  return listProjectToolTargets(database, project, config);
}

export function unavailableProjectToolIds(config: AppConfig, toolIds: ProjectConfigTargetId[]): ProjectConfigTargetId[] {
  const allowed = new Set(projectTargetToolIds(config));
  return uniqueToolIds(toolIds).filter((toolId) => !allowed.has(toolId));
}

export function listProjectSkillTargetsState(database: AppDatabase, project: Project, config?: AppConfig): ProjectSkillTargetsState {
  const toolTargets = listProjectToolTargets(database, project, config);
  const directoryTargets = projectSkillDirectoryTargets(project, toolTargets, config);
  return {
    projectId: project.id,
    toolTargets,
    skillTargets: expandSharedProjectSkillTargets(scopedProjectSkillTargets(database, project.id, directoryTargets), directoryTargets),
    skills: database.listSkillHubSkills()
  };
}

export function setProjectSkillTargets(
  database: AppDatabase,
  project: Project,
  skillId: string,
  toolIds: ProjectConfigTargetId[],
  options: { replaceConflicts?: boolean } = {},
  config?: AppConfig
): ProjectSkillUpdateResult {
  const skill = database.getSkillHubSkill(skillId);
  if (!skill) throw new Error("SkillHub skill not found");
  const requestedToolIds = new Set(uniqueToolIds(toolIds));
  const toolTargetList = listProjectToolTargets(database, project, config);
  const toolTargets = new Map(toolTargetList.map((target) => [target.toolId, target]));
  const directoryTargets = projectSkillDirectoryTargets(project, toolTargetList, config);
  const directoryGroups = projectSkillDirectoryGroups(directoryTargets);
  const directoryGroupsByDirectory = new Map(directoryGroups.map((group) => [group.normalizedDirectory, group]));
  const currentTargets = scopedProjectSkillTargets(database, project.id, directoryTargets).filter((target) => target.skillId === skillId);
  const removed: ProjectSkillTarget[] = [];
  const targets: ProjectSkillTarget[] = [];
  const conflicts: ProjectSkillConflict[] = [];
  const failures: ProjectSkillLinkFailure[] = [];
  const validRequestedToolIds = new Set<ProjectConfigTargetId>();

  for (const toolId of requestedToolIds) {
    const toolTarget = toolTargets.get(toolId);
    if (!toolTarget?.enabled) {
      failures.push(failure(project.id, toolId, skill.id, "", skill.libraryPath, "该工具未在项目中启用"));
      continue;
    }
    if (!toolTarget.supported || !toolTarget.skillDirectory) {
      failures.push(failure(project.id, toolId, skill.id, "", skill.libraryPath, toolTarget?.reason ?? "该工具暂不支持项目技能目录"));
      continue;
    }
    validRequestedToolIds.add(toolId);
  }

  const sharedRemovalDirectories = sharedDirectoriesToRemove(currentTargets, directoryGroups, validRequestedToolIds, requestedToolIds.size === 0);
  const desiredTargets = desiredProjectSkillTargets(project, skill.id, skill.folderName, skill.libraryPath, validRequestedToolIds, toolTargets, directoryGroupsByDirectory, sharedRemovalDirectories);
  keepRequestedPrivateTargets(currentTargets, desiredTargets, directoryGroupsByDirectory, validRequestedToolIds, requestedToolIds.size === 0);
  keepPrivateTargetsAfterSharedRemoval(currentTargets, desiredTargets, directoryGroupsByDirectory, sharedRemovalDirectories, requestedToolIds.size === 0);
  removeUndesiredProjectSkillTargets(database, currentTargets, desiredTargets, removed, failures);

  const blockedLinks = new Set<string>();
  for (const desired of desiredTargets.values()) {
    const linkKey = normalizeFsPath(desired.linkPath);
    if (blockedLinks.has(linkKey)) continue;
    const linkConflicts = database
      .listProjectSkillTargets(project.id)
      .filter((target) => normalizeFsPath(target.linkPath) === linkKey && target.skillId !== skill.id);
    if (linkConflicts.length > 0) {
      const existingSkill = database.getSkillHubSkill(linkConflicts[0]!.skillId);
      conflicts.push({ toolId: desired.toolId, linkPath: desired.linkPath, existingSkill, requestedSkill: skill });
      if (linkConflicts.some((target) => isPluginOwnedSkillTarget(database, project.id, target.toolId, desired.linkPath, target.skillId))) {
        failures.push(failure(project.id, desired.toolId, skill.id, desired.linkPath, skill.libraryPath, "该目标由项目 Plugin 管理，请从 Plugin 入口卸载或同步"));
        blockedLinks.add(linkKey);
        continue;
      }
      if (!options.replaceConflicts) {
        blockedLinks.add(linkKey);
        continue;
      }
      const removal = removeDirectoryLink(desired.linkPath);
      if (removal.reason && !removal.missing) {
        failures.push(failure(project.id, desired.toolId, skill.id, desired.linkPath, skill.libraryPath, removal.reason));
        blockedLinks.add(linkKey);
        continue;
      }
      for (const conflict of linkConflicts) {
        database.deleteProjectSkillTarget(conflict.projectId, conflict.toolId, conflict.skillId, conflict.linkPath);
      }
    }

    if (pathExists(desired.linkPath)) {
      if (!linkPointsTo(desired.linkPath, skill.libraryPath)) {
        if (!options.replaceConflicts) {
          conflicts.push({ toolId: desired.toolId, linkPath: desired.linkPath, existingSkill: null, requestedSkill: skill });
          blockedLinks.add(linkKey);
          continue;
        }
        const removal = removeDirectoryLink(desired.linkPath);
        if (removal.reason && !removal.missing) {
          failures.push(failure(project.id, desired.toolId, skill.id, desired.linkPath, skill.libraryPath, removal.reason));
          blockedLinks.add(linkKey);
          continue;
        }
      }
    } else {
      try {
        createDirectoryLink(skill.libraryPath, desired.linkPath);
      } catch (error) {
        failures.push(failure(project.id, desired.toolId, skill.id, desired.linkPath, skill.libraryPath, error instanceof Error ? error.message : "link 创建失败"));
        blockedLinks.add(linkKey);
        continue;
      }
    }

    targets.push(
      database.upsertProjectSkillTarget({
        ...desired
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

function scopedProjectSkillTargets(database: AppDatabase, projectId: string, directoryTargets: ProjectSkillDirectoryTarget[]): ProjectSkillTarget[] {
  const skillDirectories = uniqueStrings(directoryTargets.map((target) => target.directory));
  if (skillDirectories.length === 0) return [];
  return database.listProjectSkillTargets(projectId).filter((target) =>
    skillDirectories.some((skillDirectory) => isPathInsideOrEqual(skillDirectory, target.linkPath))
  );
}

function projectSkillDirectoryTargets(project: Project, toolTargets: ProjectToolTarget[], config?: AppConfig): ProjectSkillDirectoryTarget[] {
  const targets: ProjectSkillDirectoryTarget[] = [];
  const publicGrouping = config?.projectResources.directoryPreference === "public";
  for (const toolTarget of toolTargets) {
    if (!toolTarget.enabled || !toolTarget.supported || !toolTarget.skillDirectory) continue;
    const preferredDirectory = normalizeFsPath(toolTarget.skillDirectory);
    for (const option of projectConfigTargetSkillDirectoryOptions(toolTarget.toolId, project.rootPath, config?.projectResources.directoryPreference)) {
      targets.push({
        toolId: toolTarget.toolId,
        directory: option.directory,
        normalizedDirectory: normalizeFsPath(option.directory),
        kind: option.kind,
        preferred: normalizeFsPath(option.directory) === preferredDirectory,
        sharedCandidate: publicGrouping && option.kind === "public"
      });
    }
  }
  return uniqueDirectoryTargets(targets);
}

function projectSkillDirectoryGroups(directoryTargets: ProjectSkillDirectoryTarget[]): ProjectSkillDirectoryGroup[] {
  const grouped = new Map<string, ProjectSkillDirectoryGroup & { publicCount: number }>();
  for (const target of directoryTargets) {
    const group = grouped.get(target.normalizedDirectory) ?? {
      directory: target.directory,
      normalizedDirectory: target.normalizedDirectory,
      toolIds: [],
      shared: false,
      publicCount: 0
    };
    if (!group.toolIds.includes(target.toolId)) group.toolIds.push(target.toolId);
    if (target.sharedCandidate) group.publicCount += 1;
    grouped.set(target.normalizedDirectory, group);
  }
  return [...grouped.values()].map((group) => ({
    directory: group.directory,
    normalizedDirectory: group.normalizedDirectory,
    toolIds: group.toolIds.sort(),
    shared: group.toolIds.length > 1 && group.publicCount > 0
  }));
}

function expandSharedProjectSkillTargets(storedTargets: ProjectSkillTarget[], directoryTargets: ProjectSkillDirectoryTarget[]): ProjectSkillTarget[] {
  const groupsByDirectory = new Map(projectSkillDirectoryGroups(directoryTargets).map((group) => [group.normalizedDirectory, group]));
  const expanded = new Map(storedTargets.map((target) => [projectSkillTargetKey(target.toolId, target.skillId, target.linkPath), target]));
  for (const target of storedTargets) {
    const group = groupsByDirectory.get(normalizeFsPath(path.dirname(target.linkPath)));
    if (!group?.shared) continue;
    for (const toolId of group.toolIds) {
      const key = projectSkillTargetKey(toolId, target.skillId, target.linkPath);
      if (!expanded.has(key)) expanded.set(key, { ...target, toolId });
    }
  }
  return [...expanded.values()].sort((left, right) => left.toolId.localeCompare(right.toolId) || left.linkPath.localeCompare(right.linkPath));
}

function sharedDirectoriesToRemove(
  currentTargets: ProjectSkillTarget[],
  directoryGroups: ProjectSkillDirectoryGroup[],
  requestedToolIds: Set<ProjectConfigTargetId>,
  clearAll: boolean
): Set<string> {
  const remove = new Set<string>();
  const currentDirectories = new Set(currentTargets.map((target) => normalizeFsPath(path.dirname(target.linkPath))));
  for (const group of directoryGroups) {
    if (!group.shared || !currentDirectories.has(group.normalizedDirectory)) continue;
    const requestedCount = group.toolIds.filter((toolId) => requestedToolIds.has(toolId)).length;
    if (clearAll || requestedCount < group.toolIds.length) remove.add(group.normalizedDirectory);
  }
  return remove;
}

function desiredProjectSkillTargets(
  project: Project,
  skillId: string,
  folderName: string,
  targetPath: string,
  requestedToolIds: Set<ProjectConfigTargetId>,
  toolTargets: Map<ProjectConfigTargetId, ProjectToolTarget>,
  directoryGroupsByDirectory: Map<string, ProjectSkillDirectoryGroup>,
  sharedRemovalDirectories: Set<string>
): Map<string, Omit<ProjectSkillTarget, "createdAt" | "updatedAt">> {
  const desired = new Map<string, Omit<ProjectSkillTarget, "createdAt" | "updatedAt">>();
  for (const toolId of requestedToolIds) {
    const toolTarget = toolTargets.get(toolId);
    if (!toolTarget?.skillDirectory) continue;
    const directory = toolTarget.skillDirectory;
    const directoryKey = normalizeFsPath(directory);
    const group = directoryGroupsByDirectory.get(directoryKey);
    if (group?.shared) {
      if (sharedRemovalDirectories.has(directoryKey)) continue;
      for (const groupToolId of group.toolIds) {
        addDesiredProjectSkillTarget(desired, project.id, groupToolId, skillId, path.join(group.directory, folderName), targetPath);
      }
      continue;
    }
    addDesiredProjectSkillTarget(desired, project.id, toolId, skillId, path.join(directory, folderName), targetPath);
  }
  return desired;
}

function keepPrivateTargetsAfterSharedRemoval(
  currentTargets: ProjectSkillTarget[],
  desiredTargets: Map<string, Omit<ProjectSkillTarget, "createdAt" | "updatedAt">>,
  directoryGroupsByDirectory: Map<string, ProjectSkillDirectoryGroup>,
  sharedRemovalDirectories: Set<string>,
  clearAll: boolean
): void {
  if (clearAll || sharedRemovalDirectories.size === 0) return;
  for (const current of currentTargets) {
    const directoryKey = normalizeFsPath(path.dirname(current.linkPath));
    if (directoryGroupsByDirectory.get(directoryKey)?.shared) continue;
    desiredTargets.set(projectSkillTargetKey(current.toolId, current.skillId, current.linkPath), {
      projectId: current.projectId,
      toolId: current.toolId,
      skillId: current.skillId,
      linkPath: current.linkPath,
      targetPath: current.targetPath
    });
  }
}

function keepRequestedPrivateTargets(
  currentTargets: ProjectSkillTarget[],
  desiredTargets: Map<string, Omit<ProjectSkillTarget, "createdAt" | "updatedAt">>,
  directoryGroupsByDirectory: Map<string, ProjectSkillDirectoryGroup>,
  requestedToolIds: Set<ProjectConfigTargetId>,
  clearAll: boolean
): void {
  if (clearAll) return;
  for (const current of currentTargets) {
    if (!requestedToolIds.has(current.toolId)) continue;
    const directoryKey = normalizeFsPath(path.dirname(current.linkPath));
    if (directoryGroupsByDirectory.get(directoryKey)?.shared) continue;
    desiredTargets.set(projectSkillTargetKey(current.toolId, current.skillId, current.linkPath), {
      projectId: current.projectId,
      toolId: current.toolId,
      skillId: current.skillId,
      linkPath: current.linkPath,
      targetPath: current.targetPath
    });
  }
}

function removeUndesiredProjectSkillTargets(
  database: AppDatabase,
  currentTargets: ProjectSkillTarget[],
  desiredTargets: Map<string, Omit<ProjectSkillTarget, "createdAt" | "updatedAt">>,
  removed: ProjectSkillTarget[],
  failures: ProjectSkillLinkFailure[]
): void {
  const desiredKeys = new Set(desiredTargets.keys());
  const desiredLinkPaths = new Set([...desiredTargets.values()].map((target) => normalizeFsPath(target.linkPath)));
  const rowsByLinkPath = new Map<string, ProjectSkillTarget[]>();
  for (const current of currentTargets) {
    if (desiredKeys.has(projectSkillTargetKey(current.toolId, current.skillId, current.linkPath))) continue;
    const linkKey = normalizeFsPath(current.linkPath);
    rowsByLinkPath.set(linkKey, [...(rowsByLinkPath.get(linkKey) ?? []), current]);
  }

  for (const rows of rowsByLinkPath.values()) {
    const linkPath = rows[0]!.linkPath;
    if (!desiredLinkPaths.has(normalizeFsPath(linkPath))) {
      const removal = removeDirectoryLink(linkPath);
      if (removal.reason && !removal.missing) {
        for (const row of rows) failures.push(failure(row.projectId, row.toolId, row.skillId, row.linkPath, row.targetPath, removal.reason));
        continue;
      }
    }
    for (const row of rows) {
      const deleted = database.deleteProjectSkillTarget(row.projectId, row.toolId, row.skillId, row.linkPath);
      if (deleted) removed.push(deleted);
    }
  }
}

function addDesiredProjectSkillTarget(
  desired: Map<string, Omit<ProjectSkillTarget, "createdAt" | "updatedAt">>,
  projectId: string,
  toolId: ProjectConfigTargetId,
  skillId: string,
  linkPath: string,
  targetPath: string
): void {
  desired.set(projectSkillTargetKey(toolId, skillId, linkPath), { projectId, toolId, skillId, linkPath, targetPath });
}

function uniqueDirectoryTargets(targets: ProjectSkillDirectoryTarget[]): ProjectSkillDirectoryTarget[] {
  const unique = new Map<string, ProjectSkillDirectoryTarget>();
  for (const target of targets) {
    unique.set(`${target.toolId}:${target.normalizedDirectory}`, target);
  }
  return [...unique.values()];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function projectSkillTargetKey(toolId: ProjectConfigTargetId, skillId: string, linkPath: string): string {
  return `${toolId}:${skillId}:${normalizeFsPath(linkPath)}`;
}

function isPluginOwnedSkillTarget(database: AppDatabase, projectId: string, toolId: ProjectConfigTargetId, linkPath: string, skillId: string): boolean {
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

function inferProjectToolIds(database: AppDatabase, project: Project): Set<ProjectConfigTargetId> {
  const inferred = new Set<ProjectConfigTargetId>();
  for (const session of database.listSessionsForProject(project)) {
    inferred.add(session.toolId);
  }
  for (const [toolId, traces] of projectConfigTargetTraceEntries()) {
    if (traces.some((trace) => fs.existsSync(path.join(project.rootPath, trace)))) {
      inferred.add(toolId);
    }
  }
  return inferred;
}


function uniqueToolIds(toolIds: ProjectConfigTargetId[]): ProjectConfigTargetId[] {
  return uniqueKnownProjectConfigTargetIds(toolIds);
}

function uniqueProjectToolIds(toolIds: ProjectConfigTargetId[], config?: AppConfig): ProjectConfigTargetId[] {
  const allowed = new Set(projectTargetToolIds(config));
  return uniqueToolIds(toolIds).filter((toolId) => allowed.has(toolId));
}

function projectTargetToolIds(config?: AppConfig): ProjectConfigTargetId[] {
  return projectConfigTargetIdsForConfig(config);
}

function failure(projectId: string, toolId: ProjectConfigTargetId, skillId: string, linkPath: string, targetPath: string, reason: string): ProjectSkillLinkFailure {
  return { projectId, toolId, skillId, linkPath, targetPath, reason };
}
