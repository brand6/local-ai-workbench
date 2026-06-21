import path from "node:path";
import type {
  AppConfig,
  NonCliProjectConfigTargetId,
  ProjectConfigTargetId,
  ProjectResourceDirectoryPreference,
  ToolId
} from "../../shared/types.js";
import { isProjectConfigTargetId, isToolId, nonCliProjectConfigTargetIds, projectConfigTargetIds } from "../../shared/types.js";
import {
  projectConfigurableToolStatuses,
  projectSkillDirectoryOptions,
  toolAdapters,
  type ProjectSkillDirectoryOption
} from "../tools/adapters.js";
import type { SkillTargetOptions, ToolAdapter } from "../tools/toolAdapter.js";

interface ProjectConfigTargetSkillTarget {
  supported: boolean;
  directory: string | null;
  reason: string | null;
}

const nonCliProjectConfigTargetDirectories: Record<NonCliProjectConfigTargetId, string> = {
  zcode: ".zcode",
  workbuddy: ".workbuddy",
  "trae-solo": ".trae"
};

const nonCliProjectConfigTargetSkillDirectories: Partial<Record<NonCliProjectConfigTargetId, string>> = {
  zcode: ".zcode",
  "trae-solo": ".trae"
};

const nonCliProjectConfigTargetSkillUnsupportedReasons: Partial<Record<NonCliProjectConfigTargetId, string>> = {
  workbuddy: "WorkBuddy 官方文档仅说明通过界面上传技能包，未提供项目技能目录"
};

const projectTraceMap: Partial<Record<ProjectConfigTargetId, string[]>> = {
  codex: [".codex", "AGENTS.md"],
  claude: [".claude", "CLAUDE.md"],
  cline: [".cline", ".clinerules/skills"],
  opencode: [".opencode", "OPENCODE.md"],
  kilo: [".kilo", ".kilocode", "KILO.md"],
  qwen: [".qwen", "QWEN.md"],
  kimi: [".kimi-code"],
  qoder: [".qoder", "QODER.md"],
  codebuddy: [".codebuddy"],
  copilot: [".github/copilot-instructions.md", ".github/skills"],
  cursor: [".cursor", ".cursorrules"],
  antigravity: [".agents/mcp_config.json"],
  trae: [".traecli"],
  deepcode: [],
  reasonix: [],
  zcode: [".zcode"],
  workbuddy: [".workbuddy"],
  "trae-solo": [".trae"]
};

const projectConfigTargetLabels: Partial<Record<ProjectConfigTargetId, string>> = {
  qwen: "Qwen",
  kimi: "Kimi Code",
  qoder: "Qoder",
  opencode: "OpenCode",
  codebuddy: "CodeBuddy Code",
  deepcode: "Deep Code",
  reasonix: "Reasonix",
  trae: "TRAE CLI",
  zcode: "ZCode",
  workbuddy: "WorkBuddy",
  "trae-solo": "Trae Solo"
};

export function projectConfigTargetIdsForConfig(config?: AppConfig): ProjectConfigTargetId[] {
  if (!config) return [...projectConfigTargetIds];
  return uniqueProjectConfigTargetIds([
    ...projectConfigurableToolStatuses(config).map((tool) => tool.toolId),
    ...nonCliProjectConfigTargetIds
  ]);
}

export function projectConfigTargetSkillTarget(
  targetId: ProjectConfigTargetId,
  projectRoot: string,
  options: SkillTargetOptions = {}
): ProjectConfigTargetSkillTarget {
  if (isNonCliProjectConfigTargetId(targetId)) {
    const directoryName = nonCliProjectConfigTargetSkillDirectories[targetId];
    if (!directoryName) {
      return {
        supported: false,
        directory: null,
        reason: nonCliProjectConfigTargetSkillUnsupportedReasons[targetId] ?? "该目标暂不支持项目技能目录"
      };
    }
    return { supported: true, directory: path.join(projectRoot, directoryName, "skills"), reason: null };
  }
  if (isToolId(targetId)) {
    const adapter = (toolAdapters as Partial<Record<ToolId, ToolAdapter>>)[targetId];
    if (adapter) return adapter.skillTarget(projectRoot, options);
    const directoryOptions = projectSkillDirectoryOptions(targetId, projectRoot);
    if (directoryOptions.length > 0) {
      const preferredKind = options.directoryPreference ?? "private";
      const target = directoryOptions.find((item) => item.kind === preferredKind) ?? directoryOptions[0]!;
      return { supported: true, directory: target.directory, reason: null };
    }
  }
  return { supported: false, directory: null, reason: `${projectConfigTargetLabel(targetId)} 暂未提供项目技能目录 adapter` };
}

export function projectConfigTargetSkillDirectoryOptions(
  targetId: ProjectConfigTargetId,
  projectRoot: string,
  _preference?: ProjectResourceDirectoryPreference
): ProjectSkillDirectoryOption[] {
  if (isNonCliProjectConfigTargetId(targetId)) {
    const directoryName = nonCliProjectConfigTargetSkillDirectories[targetId];
    if (!directoryName) return [];
    return [{ kind: "private", directory: path.join(projectRoot, directoryName, "skills") }];
  }
  return projectSkillDirectoryOptions(targetId, projectRoot);
}

export function projectConfigTargetTraceEntries(): Array<[ProjectConfigTargetId, string[]]> {
  return projectConfigTargetIds.map((targetId) => [targetId, projectTraceMap[targetId] ?? []]);
}

export function projectConfigTargetLabel(targetId: ProjectConfigTargetId): string {
  return projectConfigTargetLabels[targetId] ?? `${targetId.charAt(0).toUpperCase()}${targetId.slice(1)}`;
}

export function uniqueProjectConfigTargetIds(targetIds: string[]): ProjectConfigTargetId[] {
  const unique: ProjectConfigTargetId[] = [];
  for (const targetId of targetIds) {
    if (!isProjectConfigTargetId(targetId)) continue;
    if (!unique.includes(targetId)) unique.push(targetId);
  }
  return unique;
}

export function isSessionProjectConfigTargetId(targetId: ProjectConfigTargetId): targetId is ToolId {
  return isToolId(targetId);
}

function isNonCliProjectConfigTargetId(targetId: ProjectConfigTargetId): targetId is NonCliProjectConfigTargetId {
  return (nonCliProjectConfigTargetIds as readonly ProjectConfigTargetId[]).includes(targetId);
}