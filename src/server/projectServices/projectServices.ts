import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Project, ProjectService, ProjectServiceList, ProjectServiceStartResult, ProjectServiceStopResult } from "../../shared/types.js";
import { displayPath, isPathInsideOrEqual, normalizeFsPath, relativeLabel } from "../core/pathUtils.js";
import { nowIso } from "../core/time.js";
import type { AppDatabase } from "../storage/database.js";

interface ProjectServiceTarget {
  targetRootPath: string;
  targetLabel: string;
}

interface PackageJson {
  name?: unknown;
  packageManager?: unknown;
  scripts?: unknown;
  workspaces?: unknown;
}

interface RunningProjectService {
  serviceId: string;
  child: ChildProcess | null;
  pid: number | null;
  startedAt: string;
  stoppedAt: string | null;
  exitCode: number | null;
  stoppedByUser: boolean;
}

export class ProjectServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400
  ) {
    super(message);
  }
}

export class ProjectServiceRuntime {
  private readonly processes = new Map<string, RunningProjectService>();

  list(database: AppDatabase): ProjectServiceList {
    return { services: discoverProjectServices(database).map((service) => this.withRuntimeStatus(service)) };
  }

  start(database: AppDatabase, serviceId: string, options: { dryRun?: boolean } = {}): ProjectServiceStartResult {
    const service = findProjectService(database, serviceId);
    const existing = this.processes.get(serviceId);
    if (existing && this.isRunning(existing)) {
      return { service: this.withRuntimeStatus(service), alreadyRunning: true, startedAt: existing.startedAt };
    }

    const startedAt = nowIso();
    if (options.dryRun) {
      this.processes.set(serviceId, {
        serviceId,
        child: null,
        pid: null,
        startedAt,
        stoppedAt: null,
        exitCode: null,
        stoppedByUser: false
      });
      return { service: this.withRuntimeStatus(service), alreadyRunning: false, startedAt };
    }

    const child = spawn(service.commandText, {
      cwd: service.cwd,
      shell: true,
      detached: process.platform !== "win32",
      stdio: "ignore",
      windowsHide: true
    });
    const running: RunningProjectService = {
      serviceId,
      child,
      pid: child.pid ?? null,
      startedAt,
      stoppedAt: null,
      exitCode: null,
      stoppedByUser: false
    };
    child.once("exit", (code) => {
      running.exitCode = code ?? null;
      running.stoppedAt = running.stoppedAt ?? nowIso();
    });
    child.once("error", () => {
      running.exitCode = 1;
      running.stoppedAt = running.stoppedAt ?? nowIso();
    });
    child.unref();
    this.processes.set(serviceId, running);

    return { service: this.withRuntimeStatus(service), alreadyRunning: false, startedAt };
  }

  stop(database: AppDatabase, serviceId: string): ProjectServiceStopResult {
    const service = findProjectService(database, serviceId);
    const existing = this.processes.get(serviceId);
    const stoppedAt = nowIso();
    if (!existing || !this.isRunning(existing)) {
      return { service: this.withRuntimeStatus(service), stoppedAt };
    }

    existing.stoppedByUser = true;
    existing.stoppedAt = stoppedAt;
    stopChildProcess(existing.child, existing.pid);
    return { service: this.withRuntimeStatus(service), stoppedAt };
  }

  stopAll(): void {
    for (const running of this.processes.values()) {
      if (!this.isRunning(running)) continue;
      running.stoppedByUser = true;
      running.stoppedAt = nowIso();
      stopChildProcess(running.child, running.pid);
    }
  }

  private withRuntimeStatus(service: ProjectService): ProjectService {
    const running = this.processes.get(service.serviceId);
    if (!running) return service;
    if (this.isRunning(running)) {
      return {
        ...service,
        status: "running",
        pid: running.pid,
        startedAt: running.startedAt,
        stoppedAt: null,
        exitCode: null
      };
    }
    return {
      ...service,
      status: running.stoppedByUser ? "stopped" : "exited",
      pid: running.pid,
      startedAt: running.startedAt,
      stoppedAt: running.stoppedAt,
      exitCode: running.exitCode
    };
  }

  private isRunning(service: RunningProjectService): boolean {
    if (!service.child) return !service.stoppedByUser && service.stoppedAt === null;
    return !service.stoppedByUser && service.child.exitCode === null && !service.child.killed && service.stoppedAt === null;
  }
}

const startScriptPriority = ["dev", "start", "serve", "preview"];
const maxWorkspaceTargetsPerProject = 120;

export function listProjectServices(database: AppDatabase): ProjectServiceList {
  return { services: discoverProjectServices(database) };
}

function discoverProjectServices(database: AppDatabase): ProjectService[] {
  const services: ProjectService[] = [];
  for (const project of database.listProjects()) {
    for (const target of listProjectServiceTargets(database, project)) {
      services.push(...servicesForTarget(project, target));
    }
  }
  return services.sort(compareProjectServices);
}

function findProjectService(database: AppDatabase, serviceId: string): ProjectService {
  const service = discoverProjectServices(database).find((candidate) => candidate.serviceId === serviceId);
  if (!service) throw new ProjectServiceError("可启动项目不存在或脚本已变化", "project-service-not-found", 404);
  return service;
}

function listProjectServiceTargets(database: AppDatabase, project: Project): ProjectServiceTarget[] {
  const targets = new Map<string, ProjectServiceTarget>();
  const addTarget = (targetRootPath: string, targetLabel: string) => {
    const display = displayPath(targetRootPath);
    const normalized = normalizeFsPath(display);
    if (!isPathInsideOrEqual(project.normalizedRootPath, normalized)) return;
    if (targets.has(normalized)) return;
    targets.set(normalized, { targetRootPath: display, targetLabel });
  };

  addTarget(project.rootPath, rootProjectLabel(project));
  const detail = database.createProjectDetail(project.id, "", { includeSessions: false });
  for (const group of detail?.groups ?? []) {
    addTarget(group.fullPath, group.isRoot ? rootProjectLabel(project) : group.label);
  }

  const workspaceTargets = [...targets.values()].flatMap((target) => workspacePackageTargets(project, target));
  for (const target of workspaceTargets) addTarget(target.targetRootPath, target.targetLabel);

  return [...targets.values()].sort((left, right) => left.targetRootPath.localeCompare(right.targetRootPath));
}

function workspacePackageTargets(project: Project, target: ProjectServiceTarget): ProjectServiceTarget[] {
  const packageJson = readPackageJson(path.join(target.targetRootPath, "package.json"));
  if (!packageJson) return [];
  const patterns = workspacePatterns(packageJson);
  if (patterns.length === 0) return [];

  const roots: ProjectServiceTarget[] = [];
  for (const workspaceRoot of expandWorkspacePatterns(target.targetRootPath, patterns)) {
    if (roots.length >= maxWorkspaceTargetsPerProject) break;
    if (!fs.existsSync(path.join(workspaceRoot, "package.json"))) continue;
    const label = relativeLabel(project.rootPath, workspaceRoot);
    roots.push({ targetRootPath: workspaceRoot, targetLabel: label || target.targetLabel });
  }
  return roots;
}

function servicesForTarget(project: Project, target: ProjectServiceTarget): ProjectService[] {
  const packageJsonPath = path.join(target.targetRootPath, "package.json");
  const packageJson = readPackageJson(packageJsonPath);
  if (!packageJson) return [];

  const scripts = packageScripts(packageJson);
  const scriptNames = startScriptNames(scripts);
  if (scriptNames.length === 0) return [];

  const packageManager = packageManagerForTarget(target.targetRootPath, packageJson);
  return scriptNames.map((scriptName) => {
    const args = ["run", scriptName];
    const commandText = formatCommandLine([packageManager, ...args]);
    const packageName = typeof packageJson.name === "string" && packageJson.name.trim() ? packageJson.name.trim() : null;
    return {
      serviceId: serviceId(project.id, target.targetRootPath, scriptName, packageJsonPath),
      projectId: project.id,
      projectLabel: rootProjectLabel(project),
      projectRootPath: project.rootPath,
      targetRootPath: target.targetRootPath,
      targetLabel: target.targetLabel,
      packageName,
      packageJsonPath,
      scriptName,
      scriptCommand: scripts[scriptName] ?? "",
      packageManager,
      command: packageManager,
      args,
      commandText,
      cwd: target.targetRootPath,
      status: "stopped",
      pid: null,
      startedAt: null,
      stoppedAt: null,
      exitCode: null
    } satisfies ProjectService;
  });
}

function readPackageJson(packageJsonPath: string): PackageJson | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as PackageJson;
  } catch {
    return null;
  }
}

function packageScripts(packageJson: PackageJson): Record<string, string> {
  if (!packageJson.scripts || typeof packageJson.scripts !== "object" || Array.isArray(packageJson.scripts)) return {};
  const scripts: Record<string, string> = {};
  for (const [key, value] of Object.entries(packageJson.scripts as Record<string, unknown>)) {
    if (typeof value === "string") scripts[key] = value;
  }
  return scripts;
}

function startScriptNames(scripts: Record<string, string>): string[] {
  return Object.keys(scripts)
    .filter(isStartScriptName)
    .sort((left, right) => scriptRank(left) - scriptRank(right) || left.localeCompare(right));
}

function isStartScriptName(scriptName: string): boolean {
  return startScriptPriority.some((prefix) => scriptName === prefix || scriptName.startsWith(`${prefix}:`));
}

function scriptRank(scriptName: string): number {
  const exactIndex = startScriptPriority.indexOf(scriptName);
  if (exactIndex >= 0) return exactIndex * 100;
  const prefixIndex = startScriptPriority.findIndex((prefix) => scriptName.startsWith(`${prefix}:`));
  return prefixIndex >= 0 ? prefixIndex * 100 + 50 : 9999;
}

function packageManagerForTarget(targetRootPath: string, packageJson: PackageJson): ProjectService["packageManager"] {
  if (typeof packageJson.packageManager === "string") {
    const manager = packageJson.packageManager.split("@")[0] ?? "";
    if (isPackageManager(manager)) return manager;
  }
  if (fs.existsSync(path.join(targetRootPath, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(targetRootPath, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(targetRootPath, "bun.lockb")) || fs.existsSync(path.join(targetRootPath, "bun.lock"))) return "bun";
  return "npm";
}

function isPackageManager(value: string): value is ProjectService["packageManager"] {
  return value === "npm" || value === "pnpm" || value === "yarn" || value === "bun";
}

function workspacePatterns(packageJson: PackageJson): string[] {
  const workspaces = packageJson.workspaces;
  if (Array.isArray(workspaces)) return workspaces.filter((entry): entry is string => typeof entry === "string");
  if (workspaces && typeof workspaces === "object" && !Array.isArray(workspaces)) {
    const packages = (workspaces as { packages?: unknown }).packages;
    if (Array.isArray(packages)) return packages.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function expandWorkspacePatterns(rootPath: string, patterns: string[]): string[] {
  const roots = new Map<string, string>();
  for (const pattern of patterns) {
    if (!pattern || pattern.startsWith("!")) continue;
    for (const candidate of expandWorkspacePattern(rootPath, pattern)) {
      if (!isPathInsideOrEqual(rootPath, candidate)) continue;
      roots.set(normalizeFsPath(candidate), displayPath(candidate));
    }
  }
  return [...roots.values()].sort((left, right) => left.localeCompare(right));
}

function expandWorkspacePattern(rootPath: string, pattern: string): string[] {
  const normalizedPattern = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalizedPattern.split("/").filter(Boolean);
  let candidates = [displayPath(rootPath)];

  for (const segment of segments) {
    if (segment === "**") break;
    if (segment === "*") {
      candidates = candidates.flatMap(listChildDirectories).slice(0, maxWorkspaceTargetsPerProject);
      continue;
    }
    if (segment.includes("*")) return [];
    candidates = candidates.map((candidate) => path.join(candidate, segment));
  }

  return candidates.map(displayPath);
}

function listChildDirectories(directory: string): string[] {
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !ignoredDirectoryName(entry.name))
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function ignoredDirectoryName(name: string): boolean {
  return name === "node_modules" || name === ".git" || name === "dist" || name === "build" || name === ".next";
}

function rootProjectLabel(project: Project): string {
  return path.basename(project.rootPath) || project.rootPath;
}

function serviceId(projectId: string, targetRootPath: string, scriptName: string, packageJsonPath: string): string {
  return `pkg:${shortHash([projectId, targetRootPath, scriptName, packageJsonPath].join("\n"))}`;
}

function shortHash(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function compareProjectServices(left: ProjectService, right: ProjectService): number {
  return (
    left.projectLabel.localeCompare(right.projectLabel) ||
    left.targetRootPath.localeCompare(right.targetRootPath) ||
    scriptRank(left.scriptName) - scriptRank(right.scriptName) ||
    left.scriptName.localeCompare(right.scriptName)
  );
}

function formatCommandLine(parts: string[]): string {
  return parts.map((part) => (/\s/.test(part) ? `"${part.replaceAll("\"", "\\\"")}"` : part)).join(" ");
}

function stopChildProcess(child: ChildProcess | null, pid: number | null): void {
  if (!child) return;
  if (!pid) {
    child.kill();
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}