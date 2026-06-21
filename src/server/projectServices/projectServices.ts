import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Project, ProjectService, ProjectServiceList, ProjectServiceStartResult, ProjectServiceStopResult } from "../../shared/types.js";
import { commandAvailable } from "../core/commandAvailability.js";
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
  commandText: string;
  cwd: string;
  exitStatusPath: string | null;
}

interface PersistedProjectServiceProcess {
  serviceId: string;
  pid: number;
  startedAt: string;
  commandText: string;
  cwd: string;
}

interface ProjectServiceExitStatus {
  exitCode: number | null;
  stoppedAt: string | null;
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
    this.hydrate(database);
    this.writeRuntimeRegistry(database);
    return { services: discoverProjectServices(database).map((service) => this.withRuntimeStatus(service)) };
  }

  start(database: AppDatabase, serviceId: string, options: { dryRun?: boolean } = {}): ProjectServiceStartResult {
    this.hydrate(database);
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
        stoppedByUser: false,
        commandText: service.commandText,
        cwd: service.cwd,
        exitStatusPath: null
      });
      return { service: this.withRuntimeStatus(service), alreadyRunning: false, startedAt };
    }

    const running = launchProjectServiceProcess(database, service, serviceId, startedAt);
    const child = running.child;
    const registryPath = runtimeRegistryPath(database);
    child?.once("exit", (code) => {
      running.exitCode = code ?? null;
      running.stoppedAt = running.stoppedAt ?? nowIso();
      writeRuntimeRegistryPath(registryPath, this.persistedRecords());
    });
    child?.once("error", () => {
      running.exitCode = 1;
      running.stoppedAt = running.stoppedAt ?? nowIso();
      writeRuntimeRegistryPath(registryPath, this.persistedRecords());
    });
    child?.unref();
    this.processes.set(serviceId, running);
    this.writeRuntimeRegistry(database);

    return { service: this.withRuntimeStatus(service), alreadyRunning: false, startedAt };
  }

  stop(database: AppDatabase, serviceId: string): ProjectServiceStopResult {
    this.hydrate(database);
    const service = findProjectService(database, serviceId);
    const existing = this.processes.get(serviceId);
    const stoppedAt = nowIso();
    if (existing) this.refreshExitState(existing);
    if (!existing || !this.isRunning(existing)) {
      return { service: this.withRuntimeStatus(service), stoppedAt };
    }

    existing.stoppedByUser = true;
    existing.stoppedAt = stoppedAt;
    stopChildProcess(existing.child, existing.pid);
    this.writeRuntimeRegistry(database);
    return { service: this.withRuntimeStatus(service), stoppedAt };
  }

  stopAll(database?: AppDatabase): void {
    for (const running of this.processes.values()) {
      this.refreshExitState(running);
      if (!this.isRunning(running)) continue;
      running.stoppedByUser = true;
      running.stoppedAt = nowIso();
      stopChildProcess(running.child, running.pid);
    }
    if (database) this.writeRuntimeRegistry(database);
  }

  private withRuntimeStatus(service: ProjectService): ProjectService {
    const running = this.processes.get(service.serviceId);
    if (!running) return service;
    this.refreshExitState(running);
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

  private hydrate(database: AppDatabase): void {
    for (const record of readRuntimeRegistry(database)) {
      if (!isProcessAlive(record.pid) || this.processes.has(record.serviceId)) continue;
      this.processes.set(record.serviceId, {
        serviceId: record.serviceId,
        child: null,
        pid: record.pid,
        startedAt: record.startedAt,
        stoppedAt: null,
        exitCode: null,
        stoppedByUser: false,
        commandText: record.commandText,
        cwd: record.cwd,
        exitStatusPath: serviceExitStatusPath(database, record.serviceId)
      });
    }
  }

  private writeRuntimeRegistry(database: AppDatabase): void {
    writeRuntimeRegistryPath(runtimeRegistryPath(database), this.persistedRecords());
  }

  private persistedRecords(): PersistedProjectServiceProcess[] {
    return [...this.processes.values()].flatMap((running) => {
      this.refreshExitState(running);
      if (!this.isRunning(running) || !running.pid || !isProcessAlive(running.pid)) return [];
      return [
        {
          serviceId: running.serviceId,
          pid: running.pid,
          startedAt: running.startedAt,
          commandText: running.commandText,
          cwd: running.cwd
        }
      ];
    });
  }

  private refreshExitState(service: RunningProjectService): void {
    if (service.stoppedByUser || service.stoppedAt !== null || service.child || service.pid === null) return;
    if (isProcessAlive(service.pid)) return;
    const status = service.exitStatusPath ? readExitStatus(service.exitStatusPath) : null;
    service.exitCode = status?.exitCode ?? service.exitCode;
    service.stoppedAt = status?.stoppedAt ?? service.stoppedAt ?? nowIso();
  }

  private isRunning(service: RunningProjectService): boolean {
    if (service.stoppedByUser || service.stoppedAt !== null) return false;
    if (!service.child) return service.pid === null || isProcessAlive(service.pid);
    return service.child.exitCode === null && !service.child.killed;
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
  const packageServices = packageJson ? packageServicesForTarget(project, target, packageJsonPath, packageJson) : [];
  return packageServices.length > 0 ? packageServices : launcherServicesForTarget(project, target);
}

function packageServicesForTarget(project: Project, target: ProjectServiceTarget, packageJsonPath: string, packageJson: PackageJson): ProjectService[] {
  const scripts = packageScripts(packageJson);
  const scriptNames = startScriptNames(scripts);
  if (scriptNames.length === 0) return [];

  const packageManager = packageManagerForTarget(target.targetRootPath, packageJson);
  return scriptNames.map((scriptName) => {
    const args = ["run", scriptName];
    const commandText = formatCommandLine([packageManager, ...args]);
    const packageName = typeof packageJson.name === "string" && packageJson.name.trim() ? packageJson.name.trim() : null;
    return projectService({
      serviceId: serviceId(project.id, target.targetRootPath, scriptName, packageJsonPath),
      project,
      target,
      packageName,
      packageJsonPath,
      scriptName,
      scriptCommand: scripts[scriptName] ?? "",
      packageManager,
      command: packageManager,
      args,
      commandText
    });
  });
}

function launcherServicesForTarget(project: Project, target: ProjectServiceTarget): ProjectService[] {
  return ["start.bat", "start.cmd"].flatMap((fileName) => {
    const launcherPath = path.join(target.targetRootPath, fileName);
    if (!fs.existsSync(launcherPath)) return [];
    const extension = path.extname(fileName).slice(1);
    const packageManager = extension === "cmd" ? "cmd" : "bat";
    return [
      projectService({
        serviceId: serviceId(project.id, target.targetRootPath, fileName, launcherPath),
        project,
        target,
        packageName: null,
        packageJsonPath: launcherPath,
        scriptName: fileName,
        scriptCommand: launcherCommandPreview(launcherPath),
        packageManager,
        command: "cmd.exe",
        args: ["/c", fileName],
        commandText: fileName
      })
    ];
  });
}

function projectService(input: {
  serviceId: string;
  project: Project;
  target: ProjectServiceTarget;
  packageName: string | null;
  packageJsonPath: string;
  scriptName: string;
  scriptCommand: string;
  packageManager: ProjectService["packageManager"];
  command: string;
  args: string[];
  commandText: string;
}): ProjectService {
  return {
    serviceId: input.serviceId,
    projectId: input.project.id,
    projectLabel: rootProjectLabel(input.project),
    projectRootPath: input.project.rootPath,
    targetRootPath: input.target.targetRootPath,
    targetLabel: input.target.targetLabel,
    packageName: input.packageName,
    packageJsonPath: input.packageJsonPath,
    scriptName: input.scriptName,
    scriptCommand: input.scriptCommand,
    packageManager: input.packageManager,
    command: input.command,
    args: input.args,
    commandText: input.commandText,
    cwd: input.target.targetRootPath,
    status: "stopped",
    pid: null,
    startedAt: null,
    stoppedAt: null,
    exitCode: null
  };
}

function launcherCommandPreview(launcherPath: string): string {
  try {
    const lines = fs.readFileSync(launcherPath, "utf8").split(/\r?\n/);
    const command = lines.map((line) => line.trim()).find((line) => line && !line.startsWith("@echo") && !line.toLowerCase().startsWith("cd ") && line.toLowerCase() !== "pause");
    return command ?? path.basename(launcherPath);
  } catch {
    return path.basename(launcherPath);
  }
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
  const scriptNames = Object.keys(scripts).filter(isStartScriptName);
  const visibleScripts = scriptNames.includes("dev") ? scriptNames.filter((scriptName) => !isScriptFamily(scriptName, "start")) : scriptNames;
  return visibleScripts.sort((left, right) => scriptRank(left) - scriptRank(right) || left.localeCompare(right));
}

function isScriptFamily(scriptName: string, family: string): boolean {
  return scriptName === family || scriptName.startsWith(`${family}:`);
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

const pidPollIntervalMs = 100;
const pidPollTimeoutMs = 3000;

function launchProjectServiceProcess(database: AppDatabase, service: ProjectService, serviceId: string, startedAt: string): RunningProjectService {
  if (process.platform === "win32" && commandAvailable("wt.exe")) {
    return launchProjectServiceInWindowsTerminal(database, service, serviceId, startedAt);
  }

  const child = spawn(service.commandText, {
    cwd: service.cwd,
    shell: true,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  return {
    serviceId,
    child,
    pid: child.pid ?? null,
    startedAt,
    stoppedAt: null,
    exitCode: null,
    stoppedByUser: false,
    commandText: service.commandText,
    cwd: service.cwd,
    exitStatusPath: null
  };
}

function projectServiceWindowTarget(): string {
  return process.env.WT_SESSION ? "0" : "last";
}

function launchProjectServiceInWindowsTerminal(database: AppDatabase, service: ProjectService, serviceId: string, startedAt: string): RunningProjectService {
  const pidFilePath = servicePidPath(database, serviceId);
  const exitStatusPath = serviceExitStatusPath(database, serviceId);
  removeFileIfExists(pidFilePath);
  removeFileIfExists(exitStatusPath);

  const launcher = spawn(
    "wt.exe",
    [
      "-w",
      projectServiceWindowTarget(),
      "new-tab",
      "--title",
      projectServiceTabTitle(service),
      "-d",
      service.cwd,
      "powershell.exe",
      "-NoExit",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodePowerShellCommand(projectServiceTerminalScript(service, pidFilePath, exitStatusPath))
    ],
    {
      cwd: service.cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: false
    }
  );
  launcher.unref();

  const pid = waitForPidFile(pidFilePath, pidPollTimeoutMs);
  if (!pid) {
    throw new ProjectServiceError("已请求 Windows Terminal 打开页签，但未能确认服务进程 PID", "project-service-pid-not-confirmed", 500);
  }

  return {
    serviceId,
    child: null,
    pid,
    startedAt,
    stoppedAt: null,
    exitCode: null,
    stoppedByUser: false,
    commandText: service.commandText,
    cwd: service.cwd,
    exitStatusPath
  };
}

function projectServiceTerminalScript(service: ProjectService, pidFilePath: string, exitStatusPath: string): string {
  const title = projectServiceTabTitle(service);
  return [
    "$ErrorActionPreference = 'Stop'",
    `try { $host.UI.RawUI.WindowTitle = ${quotePowerShell(title)} } catch { }`,
    `Set-Location -LiteralPath ${quotePowerShell(service.cwd)}`,
    `Remove-Item -LiteralPath ${quotePowerShell(pidFilePath)} -Force -ErrorAction SilentlyContinue`,
    `Remove-Item -LiteralPath ${quotePowerShell(exitStatusPath)} -Force -ErrorAction SilentlyContinue`,
    `Write-Host ${quotePowerShell(`[github-repo-manager] 启动 ${service.commandText}`)}`,
    "try {",
    `  $process = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d','/s','/c',${quotePowerShell(service.commandText)}) -WorkingDirectory ${quotePowerShell(service.cwd)} -NoNewWindow -PassThru`,
    `  Set-Content -LiteralPath ${quotePowerShell(pidFilePath)} -Value $process.Id -Encoding ascii`,
    "  $process.WaitForExit()",
    "  $exitCode = $process.ExitCode",
    "} catch {",
    "  $exitCode = 1",
    "  Write-Host ('[github-repo-manager] 服务启动失败：' + $_.Exception.Message)",
    "}",
    "if ($null -eq $exitCode) { $exitCode = 0 }",
    "$payload = @{ exitCode = $exitCode; stoppedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress",
    `Set-Content -LiteralPath ${quotePowerShell(exitStatusPath)} -Value $payload -Encoding utf8`,
    "Write-Host ('[github-repo-manager] 服务已退出，退出码 ' + $exitCode)"
  ].join("\r\n");
}

function projectServiceTabTitle(service: ProjectService): string {
  return `${service.projectLabel} ${service.scriptName}`.slice(0, 80);
}

function servicePidPath(database: AppDatabase, serviceId: string): string {
  return path.join(database.dataDirectory(), `project-service-${shortHash(serviceId)}.pid`);
}

function serviceExitStatusPath(database: AppDatabase, serviceId: string): string {
  return path.join(database.dataDirectory(), `project-service-${shortHash(serviceId)}.exit.json`);
}

function waitForPidFile(filePath: string, timeoutMs: number): number | null {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const pid = readPidFile(filePath);
    if (pid) return pid;
    sleepSync(Math.min(pidPollIntervalMs, Math.max(1, deadline - Date.now())));
  }
  return readPidFile(filePath);
}

function readPidFile(filePath: string): number | null {
  try {
    const pid = Number(fs.readFileSync(filePath, "utf8").trim());
    return Number.isFinite(pid) && pid > 0 ? Math.trunc(pid) : null;
  } catch {
    return null;
  }
}

function readExitStatus(filePath: string): ProjectServiceExitStatus | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const exitCode = typeof record.exitCode === "number" && Number.isFinite(record.exitCode) ? Math.trunc(record.exitCode) : null;
    const stoppedAt = typeof record.stoppedAt === "string" ? record.stoppedAt : null;
    return { exitCode, stoppedAt };
  } catch {
    return null;
  }
}

function removeFileIfExists(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Runtime marker cleanup is best-effort.
  }
}

function sleepSync(milliseconds: number): void {
  if (milliseconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
const runtimeRegistryFileName = "project-services-runtime.json";

function runtimeRegistryPath(database: AppDatabase): string {
  return path.join(database.dataDirectory(), runtimeRegistryFileName);
}

function readRuntimeRegistry(database: AppDatabase): PersistedProjectServiceProcess[] {
  const filePath = runtimeRegistryPath(database);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const services = (parsed as { services?: unknown }).services;
    if (!Array.isArray(services)) return [];
    return services.flatMap((entry): PersistedProjectServiceProcess[] => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const record = entry as Record<string, unknown>;
      const serviceId = typeof record.serviceId === "string" ? record.serviceId : "";
      const pid = typeof record.pid === "number" && Number.isFinite(record.pid) ? Math.trunc(record.pid) : 0;
      const startedAt = typeof record.startedAt === "string" ? record.startedAt : "";
      const commandText = typeof record.commandText === "string" ? record.commandText : "";
      const cwd = typeof record.cwd === "string" ? record.cwd : "";
      return serviceId && pid > 0 && startedAt && commandText && cwd ? [{ serviceId, pid, startedAt, commandText, cwd }] : [];
    });
  } catch {
    return [];
  }
}

function writeRuntimeRegistryPath(filePath: string, services: PersistedProjectServiceProcess[]): void {
  try {
    if (services.length === 0) {
      fs.rmSync(filePath, { force: true });
      return;
    }
    fs.writeFileSync(filePath, JSON.stringify({ services }, null, 2));
  } catch {
    // Best-effort runtime state only; the process can still be controlled in memory.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "EPERM");
  }
}
function stopChildProcess(child: ChildProcess | null, pid: number | null): void {
  if (!pid) {
    child?.kill();
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child?.kill("SIGTERM");
  }
}