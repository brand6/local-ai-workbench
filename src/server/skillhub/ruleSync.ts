import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type {
  Project,
  RuleFileName,
  RuleFileStatus,
  RuleSyncCommitResult,
  RuleSyncDirection,
  RuleSyncResult,
  RuleSyncStatus
} from "../../shared/types.js";

interface RuleSyncOptions {
  confirmGitInit?: boolean;
  confirmDirectOverwrite?: boolean;
  gitCommand?: string;
}

const ruleFiles: RuleFileName[] = ["AGENTS.md", "CLAUDE.md"];

export function getRuleSyncStatus(project: Project, options: Pick<RuleSyncOptions, "gitCommand"> = {}): RuleSyncStatus {
  const gitCommand = options.gitCommand ?? "git";
  const gitAvailable = commandAvailable(gitCommand);
  const gitRoot = gitAvailable ? gitOutput(project.rootPath, ["rev-parse", "--show-toplevel"], gitCommand, false) : null;
  const files = Object.fromEntries(ruleFiles.map((file) => [file, ruleFileStatus(project.rootPath, file, gitRoot, gitCommand)])) as Record<
    RuleFileName,
    RuleFileStatus
  >;
  return {
    projectId: project.id,
    projectRoot: project.rootPath,
    gitAvailable,
    gitRoot,
    files,
    directions: {
      "agents-to-claude": {
        enabled: files["AGENTS.md"].exists,
        reason: files["AGENTS.md"].exists ? null : "AGENTS.md 不存在"
      },
      "claude-to-agents": {
        enabled: files["CLAUDE.md"].exists,
        reason: files["CLAUDE.md"].exists ? null : "CLAUDE.md 不存在"
      }
    }
  };
}

export function applyRuleSync(project: Project, direction: RuleSyncDirection, options: RuleSyncOptions = {}): RuleSyncResult {
  const status = getRuleSyncStatus(project, options);
  const sourceFile: RuleFileName = direction === "agents-to-claude" ? "AGENTS.md" : "CLAUDE.md";
  const targetFile: RuleFileName = direction === "agents-to-claude" ? "CLAUDE.md" : "AGENTS.md";
  const source = status.files[sourceFile];
  const target = status.files[targetFile];
  if (!source.exists) throw new Error(`${sourceFile} 不存在`);
  const sourceContent = fs.readFileSync(source.path, "utf8");

  if (!target.exists) {
    fs.writeFileSync(target.path, sourceContent, "utf8");
    return result(project, direction, sourceFile, targetFile, "written", null, "目标规则文件已创建", options);
  }

  const targetContent = fs.readFileSync(target.path, "utf8");
  if (targetContent === sourceContent) {
    return result(project, direction, sourceFile, targetFile, "noop", null, "两个规则文件内容一致", options);
  }

  if (!status.gitAvailable && !options.confirmDirectOverwrite) {
    return result(project, direction, sourceFile, targetFile, "needs-confirmation", null, "git 不可用，需要确认直接覆盖", options);
  }

  fs.writeFileSync(target.path, sourceContent, "utf8");
  return result(project, direction, sourceFile, targetFile, "overwritten", null, "目标规则文件已直接覆盖", options);
}

export function commitRuleSyncTarget(project: Project, direction: RuleSyncDirection, options: RuleSyncOptions = {}): RuleSyncCommitResult {
  const status = getRuleSyncStatus(project, options);
  const targetFile: RuleFileName = direction === "agents-to-claude" ? "CLAUDE.md" : "AGENTS.md";
  const target = status.files[targetFile];
  const gitCommand = options.gitCommand ?? "git";

  if (!target.exists) {
    return commitResult(project, direction, targetFile, "noop", null, "目标规则文件不存在，无需 commit", options);
  }
  if (!status.gitAvailable) {
    return commitResult(project, direction, targetFile, "noop", null, "git 不可用，无法 commit", options);
  }
  if (status.gitRoot && target.gitManaged && !target.dirty) {
    return commitResult(project, direction, targetFile, "noop", null, "目标规则文件没有未提交内容", options);
  }

  if (!status.gitRoot) {
    gitOutput(project.rootPath, ["init"], gitCommand);
  }

  const backupCommit = commitOnlyRuleFile(project.rootPath, target.path, targetFile, gitCommand);
  return commitResult(project, direction, targetFile, "committed", backupCommit, "目标规则文件已 commit", options);
}

function ruleFileStatus(projectRoot: string, file: RuleFileName, gitRoot: string | null, gitCommand: string): RuleFileStatus {
  const filePath = path.join(projectRoot, file);
  const exists = fs.existsSync(filePath);
  const stat = exists ? fs.statSync(filePath) : null;
  const gitManaged = gitRoot ? gitExit(projectRoot, ["ls-files", "--error-unmatch", "--", filePath], gitCommand) === 0 : null;
  const dirty = gitRoot && gitManaged ? Boolean(gitOutput(projectRoot, ["status", "--porcelain", "--", filePath], gitCommand, false)) : null;
  return {
    file,
    path: filePath,
    exists,
    mtime: stat ? stat.mtime.toISOString() : null,
    gitManaged,
    dirty
  };
}

function commitOnlyRuleFile(projectRoot: string, filePath: string, file: RuleFileName, gitCommand: string): string | null {
  gitOutput(projectRoot, ["add", "--", filePath], gitCommand);
  gitOutput(projectRoot, ["commit", "-m", `chore: 同步规则前备份 ${file}`, "--", filePath], gitCommand);
  return currentHead(projectRoot, gitCommand);
}

function currentHead(projectRoot: string, gitCommand: string): string | null {
  return gitOutput(projectRoot, ["rev-parse", "HEAD"], gitCommand, false);
}

function result(
  project: Project,
  direction: RuleSyncDirection,
  sourceFile: RuleFileName,
  targetFile: RuleFileName,
  action: RuleSyncResult["action"],
  backupCommit: string | null,
  message: string,
  options: Pick<RuleSyncOptions, "gitCommand">
): RuleSyncResult {
  return {
    projectId: project.id,
    projectRoot: project.rootPath,
    direction,
    sourceFile,
    targetFile,
    action,
    backupCommit,
    message,
    status: getRuleSyncStatus(project, options)
  };
}

function commitResult(
  project: Project,
  direction: RuleSyncDirection,
  targetFile: RuleFileName,
  action: RuleSyncCommitResult["action"],
  backupCommit: string | null,
  message: string,
  options: Pick<RuleSyncOptions, "gitCommand">
): RuleSyncCommitResult {
  return {
    projectId: project.id,
    projectRoot: project.rootPath,
    direction,
    targetFile,
    action,
    backupCommit,
    message,
    status: getRuleSyncStatus(project, options)
  };
}

function commandAvailable(command: string): boolean {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

function gitExit(cwd: string, args: string[], gitCommand: string): number | null {
  const output = spawnSync(gitCommand, args, { cwd, encoding: "utf8" });
  return output.status;
}

function gitOutput(cwd: string, args: string[], gitCommand: string, required = true): string | null {
  const output = spawnSync(gitCommand, args, { cwd, encoding: "utf8" });
  if (output.status !== 0) {
    if (!required) return null;
    throw new Error((output.stderr || output.stdout || "git command failed").trim());
  }
  return output.stdout.trim();
}
