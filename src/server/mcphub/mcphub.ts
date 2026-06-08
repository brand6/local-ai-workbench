import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  McpHubCleanupReport,
  McpHubImportFailure,
  McpHubImportResult,
  McpHubList,
  McpHubServer,
  McpHubTargetToolId,
  Project,
  ProjectLocalMcpEntry,
  ProjectLocalMcpMigrationMode,
  ProjectLocalMcpMigrationResult,
  ProjectMcpApplyResult,
  ProjectMcpBinding,
  ProjectMcpDisableResult,
  ProjectMcpState,
  ProjectMcpTarget,
  ProjectToolTarget,
  ToolId
} from "../../shared/types.js";
import { isMcpHubTargetToolId } from "../../shared/types.js";
import { nowIso } from "../core/time.js";
import type { AppDatabase } from "../storage/database.js";
import { listProjectToolTargets } from "../skillhub/projectSkills.js";

interface ServerCandidate {
  serverId: string;
  patch: ServerPatch;
  complete: boolean;
}

const mcpTargetSortOrder: McpHubTargetToolId[] = ["claude", "codex", "opencode", "cursor", "antigravity"];

interface ExtractedServerCandidates {
  candidates: ServerCandidate[];
  failed: McpHubImportFailure[];
}

interface ServerPatch {
  name?: string | null;
  description?: string | null;
  transport?: McpHubServer["transport"];
  command?: string | null;
  args?: string[];
  url?: string | null;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  requiredEnv?: string[];
}

type JsonRecord = Record<string, unknown>;
type PersistableMcpHubServer = Omit<McpHubServer, "createdAt" | "updatedAt" | "builtin">;

const builtInMcpServers: PersistableMcpHubServer[] = loadBuiltInMcpServers();

export function listMcpHub(database: AppDatabase): McpHubList {
  ensureBuiltInMcpHubServers(database);
  return {
    servers: withBuiltInFlags(database.listMcpHubServers())
  };
}

export function ensureBuiltInMcpHubServers(database: AppDatabase): void {
  for (const server of builtInMcpServers) {
    if (!database.getMcpHubServer(server.serverId)) {
      database.upsertMcpHubServer(server);
    }
  }
}

export function importMcpHubJson(database: AppDatabase, input: string): McpHubImportResult {
  const result: McpHubImportResult = { added: [], updated: [], patched: [], failed: [] };
  let parsed: unknown;
  try {
    parsed = parseLooseJson(input);
  } catch (error) {
    return {
      ...result,
      failed: [{ serverId: null, reason: error instanceof Error ? error.message : "JSON 解析失败" }]
    };
  }

  const { candidates, failed } = extractServerCandidates(parsed);
  result.failed.push(...failed);
  if (candidates.length === 0) {
    if (result.failed.length === 0) result.failed.push({ serverId: null, reason: "未找到可导入的 MCP server" });
    return result;
  }

  for (const candidate of candidates) {
    try {
      const existing = database.getMcpHubServer(candidate.serverId);
      if (!existing && !candidate.complete) {
        result.failed.push({ serverId: candidate.serverId, reason: missingRequiredReason(candidate.patch) });
        continue;
      }

      if (!existing) {
        result.added.push(database.upsertMcpHubServer(serverFromPatch(candidate.serverId, candidate.patch)));
        continue;
      }

      if (candidate.complete) {
        result.updated.push(database.upsertMcpHubServer(serverFromPatch(candidate.serverId, candidate.patch, existing)));
      } else {
        result.patched.push(database.upsertMcpHubServer(patchServer(existing, candidate.patch)));
      }
    } catch (error) {
      result.failed.push({
        serverId: candidate.serverId,
        reason: error instanceof Error ? error.message : "导入失败"
      });
    }
  }

  return result;
}

export function listProjectMcpState(database: AppDatabase, project: Project): ProjectMcpState {
  ensureBuiltInMcpHubServers(database);
  const toolTargets = listProjectToolTargets(database, project);
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    targets: mcpTargetsForRoot(project.rootPath, toolTargets),
    servers: withBuiltInFlags(database.listMcpHubServers()),
    bindings: database.listProjectMcpBindings(project.id, project.rootPath),
    localEntries: discoverProjectLocalMcp(database, project)
  };
}

export function applyProjectMcpServer(
  database: AppDatabase,
  project: Project,
  toolId: McpHubTargetToolId,
  serverId: string
): ProjectMcpApplyResult {
  ensureBuiltInMcpHubServers(database);
  const server = database.getMcpHubServer(serverId);
  if (!server) throw new Error("McpHub server 不存在");
  const toolTarget = listProjectToolTargets(database, project).find((target) => target.toolId === toolId);
  if (!toolTarget?.enabled) throw new Error("该工具未在项目中启用");
  const target = mcpTargetForRoot(project.rootPath, toolId);
  if (!target.supported) throw new Error(target.reason ?? "该工具暂不支持项目 MCP");
  const rendered = renderServerForTarget(server, project.rootPath, toolId);
  writeRenderedConfig(target.configPath, toolId, server.serverId, rendered);
  const timestamp = nowIso();
  const binding = database.upsertProjectMcpBinding({
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId,
    serverId: server.serverId,
    appliedServerId: server.serverId,
    appliedAt: timestamp
  });

  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId,
    server: withBuiltInFlag(server),
    binding,
    configPath: target.configPath,
    warnings: missingRequiredEnvWarnings(server)
  };
}

export function disableProjectMcpServer(
  database: AppDatabase,
  project: Project,
  toolId: McpHubTargetToolId,
  serverId: string
): ProjectMcpDisableResult {
  const target = mcpTargetForRoot(project.rootPath, toolId);
  const binding = database.getProjectMcpBinding(project.id, project.rootPath, toolId, serverId);
  if (!binding) {
    return {
      projectId: project.id,
      targetRootPath: project.rootPath,
      toolId,
      serverId,
      removedBinding: false,
      modified: false,
      configPath: target.configPath,
      reason: "没有 McpHub ownership 记录，未修改本地配置"
    };
  }

  const removal = removeRenderedConfigEntry(target.configPath, toolId, serverId);
  database.deleteProjectMcpBinding(project.id, project.rootPath, toolId, serverId);
  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    toolId,
    serverId,
    removedBinding: true,
    modified: removal.modified,
    configPath: target.configPath,
    reason: removal.reason
  };
}

export function deleteMcpHubServer(database: AppDatabase, serverId: string): McpHubCleanupReport {
  if (isBuiltInMcpHubServer(serverId)) throw new Error("内置 MCP server 不能删除");
  const bindings = database.listProjectMcpBindingsForServer(serverId);
  const removedBindings: typeof bindings = [];
  const modifiedFiles = new Set<string>();
  const skippedMissingFiles = new Set<string>();
  const failures: Array<{ path: string; reason: string }> = [];

  for (const binding of bindings) {
    const configPath = mcpTargetForRoot(binding.targetRootPath, binding.toolId).configPath;
    try {
      const removal = removeRenderedConfigEntry(configPath, binding.toolId, binding.serverId);
      if (removal.modified) modifiedFiles.add(configPath);
      if (removal.missing) skippedMissingFiles.add(configPath);
      database.deleteProjectMcpBinding(binding.projectId, binding.targetRootPath, binding.toolId, binding.serverId);
      removedBindings.push(binding);
    } catch (error) {
      failures.push({ path: configPath, reason: error instanceof Error ? error.message : "清理失败" });
    }
  }

  const deleted = failures.length === 0 ? database.deleteMcpHubServer(serverId) : false;
  return {
    serverId,
    deleted,
    bindingsRemoved: removedBindings,
    modifiedFiles: [...modifiedFiles],
    skippedMissingFiles: [...skippedMissingFiles],
    failures
  };
}

export function migrateProjectLocalMcp(
  database: AppDatabase,
  project: Project,
  serverId: string,
  mode: ProjectLocalMcpMigrationMode | null = null
): ProjectLocalMcpMigrationResult {
  const entries = discoverProjectLocalMcp(database, project).filter(
    (entry): entry is ProjectLocalMcpEntry & { server: McpHubServer } =>
      entry.serverId === serverId && entry.status === "unmanaged" && Boolean(entry.server)
  );
  if (entries.length === 0) throw new Error("未找到可迁移的本地 MCP");

  const first = entries[0]?.server;
  if (!first) throw new Error("未找到可迁移的本地 MCP");
  const conflicts = entries.filter((entry) => !serversEquivalent(first, entry.server)).map((entry) => entry.toolId);
  if (conflicts.length > 0) {
    return {
      projectId: project.id,
      targetRootPath: project.rootPath,
      serverId,
      action: "needs-confirmation",
      server: null,
      bindings: [],
      conflictTargets: [...new Set(conflicts)],
      requiresConfirmation: false,
      message: "同名 MCP 在多个目标文件中的规范化配置不同，已阻止迁移"
    };
  }

  const existing = database.getMcpHubServer(serverId);
  if (existing && !serversEquivalent(existing, first) && !mode) {
    return {
      projectId: project.id,
      targetRootPath: project.rootPath,
      serverId,
      action: "needs-confirmation",
      server: existing,
      bindings: [],
      conflictTargets: entries.map((entry) => entry.toolId),
      requiresConfirmation: true,
      message: "McpHub 已有同名 server，需选择关联现有定义或覆盖中心定义"
    };
  }

  let server = existing;
  let action: ProjectLocalMcpMigrationResult["action"] = "linked-existing";
  if (!server) {
    server = database.upsertMcpHubServer(withoutTimestamps(first));
    action = "migrated";
  } else if (existing && !serversEquivalent(existing, first) && mode === "overwrite-mcphub") {
    server = database.upsertMcpHubServer(serverFromPatch(serverId, serverToPatch(first), existing));
    action = "overwrote-mcphub";
  }

  const timestamp = nowIso();
  const bindings = entries.map((entry) =>
    database.upsertProjectMcpBinding({
      projectId: project.id,
      targetRootPath: project.rootPath,
      toolId: entry.toolId,
      serverId,
      appliedServerId: serverId,
      appliedAt: timestamp
    })
  );

  return {
    projectId: project.id,
    targetRootPath: project.rootPath,
    serverId,
    action,
    server,
    bindings,
    conflictTargets: [],
    requiresConfirmation: false,
    message: null
  };
}

function discoverProjectLocalMcp(database: AppDatabase, project: Project): ProjectLocalMcpEntry[] {
  const bindings = new Map(
    database
      .listProjectMcpBindings(project.id, project.rootPath)
      .map((binding) => [`${binding.toolId}:${binding.serverId}`, binding])
  );
  const entries: ProjectLocalMcpEntry[] = [];

  for (const target of mcpTargetsForRoot(project.rootPath, listProjectToolTargets(database, project))) {
    if (!target.supported || !isMcpHubTargetToolId(target.toolId)) continue;
    const toolId = target.toolId;
    if (!fs.existsSync(target.configPath)) continue;
    try {
      const discovered = readLocalConfig(toolId, target.configPath);
      for (const item of discovered) {
        if (item.server) {
          entries.push({
            projectId: project.id,
            targetRootPath: project.rootPath,
            toolId,
            serverId: item.server.serverId,
            filePath: target.configPath,
            status: bindings.has(`${toolId}:${item.server.serverId}`) ? "managed" : "unmanaged",
            server: item.server,
            reason: null
          });
        } else {
          entries.push({
            projectId: project.id,
            targetRootPath: project.rootPath,
            toolId,
            serverId: item.serverId,
            filePath: target.configPath,
            status: "invalid",
            server: null,
            reason: item.reason
          });
        }
      }
    } catch (error) {
      entries.push({
        projectId: project.id,
        targetRootPath: project.rootPath,
        toolId,
        serverId: `invalid:${toolId}`,
        filePath: target.configPath,
        status: "invalid",
        server: null,
        reason: error instanceof Error ? error.message : "读取本地 MCP 失败"
      });
    }
  }

  return entries.sort((left, right) => left.toolId.localeCompare(right.toolId) || left.serverId.localeCompare(right.serverId));
}

function readLocalConfig(
  toolId: McpHubTargetToolId,
  configPath: string
): Array<{ serverId: string; server: McpHubServer | null; reason: string | null }> {
  if (toolId === "codex") return readCodexConfig(configPath);
  return readJsonServerMap(configPath, jsonServerMapKey(toolId), toolId);
}

function readJsonServerMap(
  configPath: string,
  key: "mcpServers" | "mcp" | "servers",
  source: McpHubTargetToolId
): Array<{ serverId: string; server: McpHubServer | null; reason: string | null }> {
  const root = parseLooseJson(fs.readFileSync(configPath, "utf8"));
  if (!isRecord(root) || !isRecord(root[key])) return [];
  return Object.entries(root[key]).map(([serverId, value]) => localItemFromFragment(serverId, value, source));
}

function readCodexConfig(configPath: string): Array<{ serverId: string; server: McpHubServer | null; reason: string | null }> {
  const sections = parseCodexMcpSections(fs.readFileSync(configPath, "utf8"));
  return sections.map((section) => localItemFromFragment(section.serverId, section.value, "codex"));
}

function localItemFromFragment(
  serverId: string,
  value: unknown,
  source: McpHubTargetToolId
): { serverId: string; server: McpHubServer | null; reason: string | null } {
  try {
    const candidate = candidateFromEntry(serverId, value, source);
    if (!candidate.complete) return { serverId, server: null, reason: missingRequiredReason(candidate.patch) };
    return { serverId, server: withEmptyTimestamps(serverFromPatch(serverId, candidate.patch)), reason: null };
  } catch (error) {
    return { serverId, server: null, reason: error instanceof Error ? error.message : "MCP entry 无法识别" };
  }
}

function extractServerCandidates(parsed: unknown): ExtractedServerCandidates {
  if (Array.isArray(parsed)) {
    return parsed.reduce<ExtractedServerCandidates>(
      (combined, item) => {
        const extracted = extractServerCandidates(item);
        combined.candidates.push(...extracted.candidates);
        combined.failed.push(...extracted.failed);
        return combined;
      },
      { candidates: [], failed: [] }
    );
  }
  if (!isRecord(parsed)) return { candidates: [], failed: [] };

  const candidates: ServerCandidate[] = [];
  const failed: McpHubImportFailure[] = [];
  for (const key of ["mcpServers", "servers", "mcp"] as const) {
    const value = parsed[key];
    if (isRecord(value)) {
      for (const [serverId, fragment] of Object.entries(value)) {
        appendCandidate(candidates, failed, serverId, fragment, key === "mcp" ? "opencode" : "claude");
      }
    }
  }
  if (candidates.length > 0 || failed.length > 0) return { candidates, failed };

  if (looksLikeServer(parsed)) {
    const serverId = stringField(parsed, "serverId") ?? stringField(parsed, "id");
    if (!serverId) return { candidates: [], failed: [] };
    appendCandidate(candidates, failed, serverId, parsed, "claude");
    return { candidates, failed };
  }

  if (Object.values(parsed).every((value) => isRecord(value) && looksLikeServer(value))) {
    for (const [serverId, fragment] of Object.entries(parsed)) {
      appendCandidate(candidates, failed, serverId, fragment, "claude");
    }
  }
  return { candidates, failed };
}

function appendCandidate(
  candidates: ServerCandidate[],
  failed: McpHubImportFailure[],
  serverId: string,
  fragment: unknown,
  source: McpHubTargetToolId
): void {
  try {
    candidates.push(candidateFromEntry(serverId, fragment, source));
  } catch (error) {
    failed.push({ serverId, reason: error instanceof Error ? error.message : "MCP entry 无法识别" });
  }
}

function candidateFromEntry(serverId: string, fragment: unknown, source: McpHubTargetToolId): ServerCandidate {
  if (!isRecord(fragment)) throw new Error("MCP entry 必须是对象");
  const normalizedServerId = normalizeServerId(serverId);
  const explicitTransport = stringField(fragment, "transport") ?? stringField(fragment, "type");
  if (explicitTransport === "sse") throw new Error("MVP 不支持 sse transport");

  const commandValue = fragment.command;
  const hasCommand = typeof commandValue === "string" || isStringArray(commandValue);
  const urlValue = stringField(fragment, "url") ?? stringField(fragment, "httpUrl") ?? stringField(fragment, "serverUrl");
  const hasUrl = typeof urlValue === "string";
  let transport = transportFromValue(explicitTransport);
  if (!transport && (explicitTransport === "local" || explicitTransport === "remote")) {
    transport = explicitTransport === "local" ? "stdio" : "http";
  }
  if (!transport && hasCommand) transport = "stdio";
  if (!transport && hasUrl) transport = "http";

  const patch: ServerPatch = {};
  const name = stringField(fragment, "name");
  const description = stringField(fragment, "description");
  if (name !== null) patch.name = name;
  if (description !== null) patch.description = description;
  if (transport) patch.transport = transport;

  if (typeof commandValue === "string") {
    patch.command = commandValue;
  } else if (isStringArray(commandValue)) {
    patch.command = commandValue[0] ?? null;
    patch.args = commandValue.slice(1);
  }

  if (isStringArray(fragment.args)) patch.args = fragment.args;
  if (urlValue) patch.url = urlValue;

  const headers = stringRecordField(fragment, "headers");
  const env = stringRecordField(fragment, source === "opencode" ? "environment" : "env") ?? stringRecordField(fragment, "env");
  const requiredEnv = stringArrayField(fragment, "requiredEnv") ?? stringArrayField(fragment, "required_env");
  if (headers) patch.headers = headers;
  if (env) patch.env = env;
  if (requiredEnv) patch.requiredEnv = uniqueStrings(requiredEnv);

  const effectiveTransport = patch.transport;
  const complete = effectiveTransport === "stdio" ? Boolean(patch.command) : effectiveTransport === "http" ? Boolean(patch.url) : false;
  return { serverId: normalizedServerId, patch, complete };
}

function serverFromPatch(serverId: string, patch: ServerPatch, existing?: McpHubServer): Omit<McpHubServer, "createdAt" | "updatedAt"> {
  const transport = patch.transport ?? existing?.transport;
  if (transport !== "stdio" && transport !== "http") throw new Error("缺少 transport");
  const command = patch.command ?? (transport === "stdio" ? existing?.command ?? null : null);
  const url = patch.url ?? (transport === "http" ? existing?.url ?? null : null);
  if (transport === "stdio" && !command) throw new Error("stdio MCP 缺少 command");
  if (transport === "http" && !url) throw new Error("http MCP 缺少 url");
  return {
    serverId,
    name: patch.name !== undefined ? patch.name : existing?.name ?? serverId,
    description: patch.description !== undefined ? patch.description : existing?.description ?? null,
    transport,
    command: transport === "stdio" ? command : null,
    args: transport === "stdio" ? patch.args ?? [] : [],
    url: transport === "http" ? url : null,
    headers: transport === "http" ? patch.headers ?? {} : {},
    env: patch.env ?? {},
    requiredEnv: patch.requiredEnv ?? []
  };
}

function patchServer(existing: McpHubServer, patch: ServerPatch): Omit<McpHubServer, "createdAt" | "updatedAt"> {
  const transport = patch.transport ?? existing.transport;
  return {
    serverId: existing.serverId,
    name: patch.name !== undefined ? patch.name : existing.name,
    description: patch.description !== undefined ? patch.description : existing.description,
    transport,
    command: patch.command !== undefined ? patch.command : transport === "stdio" ? existing.command : null,
    args: patch.args ?? (transport === "stdio" ? existing.args : []),
    url: patch.url !== undefined ? patch.url : transport === "http" ? existing.url : null,
    headers: patch.headers ? { ...existing.headers, ...patch.headers } : transport === "http" ? existing.headers : {},
    env: patch.env ? { ...existing.env, ...patch.env } : existing.env,
    requiredEnv: patch.requiredEnv ? uniqueStrings([...existing.requiredEnv, ...patch.requiredEnv]) : existing.requiredEnv
  };
}

function serverToPatch(server: McpHubServer): ServerPatch {
  return {
    name: server.name,
    description: server.description,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    headers: server.headers,
    env: server.env,
    requiredEnv: server.requiredEnv
  };
}

function renderServerForTarget(server: McpHubServer, targetRootPath: string, toolId: McpHubTargetToolId): unknown {
  const rendered = renderCoreServer(server, targetRootPath);
  if (toolId === "claude") {
    if (rendered.transport === "stdio") return compactObject({ command: rendered.command, args: rendered.args, env: rendered.env });
    return compactObject({ url: rendered.url, headers: rendered.headers });
  }
  if (toolId === "codex") {
    if (rendered.transport === "stdio") return compactObject({ command: rendered.command, args: rendered.args, env: rendered.env });
    return compactObject({ url: rendered.url, headers: rendered.headers });
  }
  if (toolId === "cursor") {
    if (rendered.transport === "stdio") {
      return compactObject({ type: "stdio", command: rendered.command, args: rendered.args, env: rendered.env });
    }
    return compactObject({ type: "http", url: rendered.url, headers: rendered.headers });
  }
  if (toolId === "antigravity") {
    if (rendered.transport === "stdio") return compactObject({ command: rendered.command, args: rendered.args, env: rendered.env });
    return compactObject({ serverUrl: rendered.url, headers: rendered.headers });
  }
  if (rendered.transport === "stdio") {
    return compactObject({
      type: "local",
      command: [rendered.command, ...rendered.args],
      environment: rendered.env
    });
  }
  return compactObject({ type: "remote", url: rendered.url, headers: rendered.headers });
}

function renderCoreServer(server: McpHubServer, targetRootPath: string): McpHubServer {
  const expand = (value: string | null): string | null => (value === null ? null : value.replaceAll("${PROJECT_ROOT}", targetRootPath));
  return {
    ...server,
    command: expand(server.command),
    args: server.args.map((arg) => expand(arg) ?? ""),
    url: expand(server.url),
    headers: mapStringValues(server.headers, (value) => expand(value) ?? ""),
    env: mapStringValues(server.env, (value) => expand(value) ?? "")
  };
}

function writeRenderedConfig(configPath: string, toolId: McpHubTargetToolId, serverId: string, rendered: unknown): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (toolId !== "codex") {
    const key = jsonServerMapKey(toolId);
    const root = readJsonObjectFile(configPath);
    const serverMap = isRecord(root[key]) ? { ...root[key] } : {};
    serverMap[serverId] = rendered;
    writeJsonObjectFile(configPath, { ...root, [key]: serverMap });
    return;
  }
  writeCodexMcpSection(configPath, serverId, rendered);
}

function removeRenderedConfigEntry(configPath: string, toolId: McpHubTargetToolId, serverId: string): { modified: boolean; missing: boolean; reason: string | null } {
  if (!fs.existsSync(configPath)) return { modified: false, missing: true, reason: "配置文件不存在" };
  if (toolId !== "codex") {
    const key = jsonServerMapKey(toolId);
    const root = readJsonObjectFile(configPath);
    if (!isRecord(root[key]) || !(serverId in root[key])) return { modified: false, missing: false, reason: "entry 已不存在" };
    const serverMap = { ...root[key] };
    delete serverMap[serverId];
    writeJsonObjectFile(configPath, { ...root, [key]: serverMap });
    return { modified: true, missing: false, reason: null };
  }
  return removeCodexMcpSection(configPath, serverId);
}

function jsonServerMapKey(toolId: Exclude<McpHubTargetToolId, "codex">): "mcpServers" | "mcp" {
  if (toolId === "opencode") return "mcp";
  return "mcpServers";
}

function readJsonObjectFile(configPath: string): JsonRecord {
  if (!fs.existsSync(configPath)) return {};
  const parsed = parseLooseJson(fs.readFileSync(configPath, "utf8"));
  if (!isRecord(parsed)) throw new Error("配置文件根节点不是对象");
  return parsed;
}

function writeJsonObjectFile(configPath: string, value: JsonRecord): void {
  fs.writeFileSync(configPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeCodexMcpSection(configPath: string, serverId: string, rendered: unknown): void {
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const withoutSection = removeCodexSectionText(existing, serverId);
  const section = codexSectionText(serverId, rendered);
  const separator = withoutSection.trim().length > 0 ? "\n\n" : "";
  fs.writeFileSync(configPath, `${withoutSection.trimEnd()}${separator}${section}\n`, "utf8");
}

function removeCodexMcpSection(configPath: string, serverId: string): { modified: boolean; missing: boolean; reason: string | null } {
  const existing = fs.readFileSync(configPath, "utf8");
  const next = removeCodexSectionText(existing, serverId);
  if (next === existing) return { modified: false, missing: false, reason: "entry 已不存在" };
  fs.writeFileSync(configPath, next.trimEnd() ? `${next.trimEnd()}\n` : "", "utf8");
  return { modified: true, missing: false, reason: null };
}

function removeCodexSectionText(input: string, serverId: string): string {
  const lines = input.split(/\r?\n/);
  const output: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const header = parseCodexHeader(line);
    if (header) {
      skipping = header === serverId;
    }
    if (!skipping) output.push(line);
  }
  return output.join("\n");
}

function codexSectionText(serverId: string, rendered: unknown): string {
  if (!isRecord(rendered)) throw new Error("Codex rendered MCP entry 必须是对象");
  const lines = [`[mcp_servers.${tomlKey(serverId)}]`];
  for (const [key, value] of Object.entries(rendered)) {
    lines.push(`${key} = ${tomlValue(value)}`);
  }
  return lines.join("\n");
}

function parseCodexMcpSections(input: string): Array<{ serverId: string; value: JsonRecord }> {
  const sections: Array<{ serverId: string; value: JsonRecord }> = [];
  let current: { serverId: string; lines: string[] } | null = null;
  for (const line of input.split(/\r?\n/)) {
    const header = parseCodexHeader(line);
    if (header) {
      if (current) sections.push({ serverId: current.serverId, value: parseTomlAssignments(current.lines) });
      current = { serverId: header, lines: [] };
      continue;
    }
    if (/^\s*\[/.test(line)) {
      if (current) sections.push({ serverId: current.serverId, value: parseTomlAssignments(current.lines) });
      current = null;
      continue;
    }
    current?.lines.push(line);
  }
  if (current) sections.push({ serverId: current.serverId, value: parseTomlAssignments(current.lines) });
  return sections;
}

function parseCodexHeader(line: string): string | null {
  const match = line.match(/^\s*\[mcp_servers\.((?:"(?:\\"|[^"])+")|[A-Za-z0-9_-]+)\]\s*$/);
  if (!match) return null;
  const raw = match[1];
  if (!raw) return null;
  return raw.startsWith("\"") ? JSON.parse(raw) : raw;
}

function parseTomlAssignments(lines: string[]): JsonRecord {
  const value: JsonRecord = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    value[key] = parseTomlValue(trimmed.slice(index + 1).trim());
  }
  return value;
}

function parseTomlValue(input: string): unknown {
  const trimmed = input.replace(/\s+#.*$/, "").trim();
  if (trimmed.startsWith("\"")) return JSON.parse(trimmed);
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  if (trimmed.startsWith("{")) {
    const jsonish = trimmed.replace(/([A-Za-z0-9_-]+)\s*=/g, "\"$1\":").replace(/=/g, ":");
    return JSON.parse(jsonish);
  }
  return trimmed;
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function tomlValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(String(item))).join(", ")}]`;
  if (isRecord(value)) {
    const entries = Object.entries(value).map(([key, item]) => `${tomlKey(key)} = ${JSON.stringify(String(item))}`);
    return `{ ${entries.join(", ")} }`;
  }
  return JSON.stringify(String(value));
}

function mcpTargetsForRoot(rootPath: string, toolTargets: ProjectToolTarget[] = []): ProjectMcpTarget[] {
  return toolTargets
    .filter((target) => target.enabled)
    .map((target) => projectMcpTargetForRoot(rootPath, target))
    .sort((left, right) => mcpToolSortKey(left.toolId).localeCompare(mcpToolSortKey(right.toolId)));
}

function mcpToolSortKey(toolId: ToolId): string {
  const index = mcpTargetSortOrder.findIndex((item) => item === toolId);
  return `${index === -1 ? 999 : index}:${toolId}`;
}

function mcpTargetForRoot(rootPath: string, toolId: McpHubTargetToolId, toolTarget?: ProjectToolTarget): ProjectMcpTarget {
  const base = {
    enabled: toolTarget?.enabled ?? false,
    inferred: toolTarget?.inferred ?? false,
    updatedAt: toolTarget?.updatedAt ?? new Date(0).toISOString()
  };
  switch (toolId) {
    case "claude":
      return { ...base, toolId, label: "Claude Code", supported: true, configPath: path.join(rootPath, ".mcp.json"), reason: null };
    case "codex":
      return { ...base, toolId, label: "Codex", supported: true, configPath: path.join(rootPath, ".codex", "config.toml"), reason: null };
    case "opencode":
      return { ...base, toolId, label: "OpenCode", supported: true, configPath: path.join(rootPath, "opencode.json"), reason: null };
    case "cursor":
      return { ...base, toolId, label: "Cursor", supported: true, configPath: path.join(rootPath, ".cursor", "mcp.json"), reason: null };
    case "antigravity":
      return { ...base, toolId, label: "Antigravity", supported: true, configPath: path.join(rootPath, ".agents", "mcp_config.json"), reason: null };
  }
  const exhaustive: never = toolId;
  return { ...base, toolId: exhaustive, label: exhaustive, supported: false, configPath: rootPath, reason: "未知 MCP 目标" };
}

function projectMcpTargetForRoot(rootPath: string, toolTarget: ProjectToolTarget): ProjectMcpTarget {
  if (isMcpHubTargetToolId(toolTarget.toolId)) return mcpTargetForRoot(rootPath, toolTarget.toolId, toolTarget);
  return {
    toolId: toolTarget.toolId,
    label: toolLabel(toolTarget.toolId),
    enabled: toolTarget.enabled,
    inferred: toolTarget.inferred,
    supported: false,
    configPath: "",
    reason: "尚未支持",
    updatedAt: toolTarget.updatedAt
  };
}

function toolLabel(toolId: ToolId): string {
  if (toolId === "qwen") return "Qwen";
  if (toolId === "qoder") return "Qoder";
  if (toolId === "opencode") return "OpenCode";
  if (toolId === "codebuddy") return "CodeBuddy Code";
  if (toolId === "deepcode") return "Deep Code";
  if (toolId === "reasonix") return "Reasonix";
  return `${toolId.charAt(0).toUpperCase()}${toolId.slice(1)}`;
}

function parseLooseJson(input: string): unknown {
  const candidates = repairJsonCandidates(input);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next repair candidate.
    }
  }
  throw new Error("JSON 解析失败");
}

function repairJsonCandidates(input: string): string[] {
  const trimmed = input.trim();
  const fenced = trimmed.match(/```(?:json|jsonc|javascript)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const proseSlice = sliceJsonLike(fenced ?? trimmed);
  const base = [trimmed, fenced, proseSlice].filter((value): value is string => Boolean(value && value.trim()));
  const repaired = base.map((value) => balanceBrackets(stripTrailingCommas(stripJsonComments(value))));
  return uniqueStrings([...base, ...repaired]);
}

function sliceJsonLike(input: string): string | null {
  const firstObject = input.indexOf("{");
  const firstArray = input.indexOf("[");
  const start =
    firstObject < 0 ? firstArray : firstArray < 0 ? firstObject : Math.min(firstObject, firstArray);
  if (start < 0) return null;
  const lastObject = input.lastIndexOf("}");
  const lastArray = input.lastIndexOf("]");
  const end = Math.max(lastObject, lastArray);
  return end >= start ? input.slice(start, end + 1) : input.slice(start);
}

function stripJsonComments(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function stripTrailingCommas(input: string): string {
  return input.replace(/,\s*([}\]])/g, "$1");
}

function balanceBrackets(input: string): string {
  const stack: string[] = [];
  for (const char of input) {
    if (char === "{") stack.push("}");
    if (char === "[") stack.push("]");
    if ((char === "}" || char === "]") && stack[stack.length - 1] === char) stack.pop();
  }
  return `${input}${stack.reverse().join("")}`;
}

function looksLikeServer(value: JsonRecord): boolean {
  return ["command", "url", "httpUrl", "serverUrl", "transport", "type", "args", "env", "environment", "requiredEnv"].some((key) => key in value);
}

function missingRequiredReason(patch: ServerPatch): string {
  if (!patch.transport) return "缺少 transport、command 或 url";
  if (patch.transport === "stdio") return "stdio MCP 缺少 command";
  if (patch.transport === "http") return "http MCP 缺少 url";
  return "MCP 定义不完整";
}

function transportFromValue(value: string | null): McpHubServer["transport"] | null {
  if (value === "stdio" || value === "http") return value;
  if (value && value !== "local" && value !== "remote") throw new Error(`MVP 不支持 ${value} transport`);
  return null;
}

function normalizeServerId(value: string): string {
  const serverId = value.trim();
  if (!serverId) throw new Error("serverId 不能为空");
  if (serverId.includes("/") || serverId.includes("\\") || serverId.includes("\0")) throw new Error("serverId 不能包含路径分隔符");
  return serverId;
}

function missingRequiredEnvWarnings(server: McpHubServer): string[] {
  return server.requiredEnv.filter((name) => !process.env[name]).map((name) => `缺少环境变量：${name}`);
}

function serversEquivalent(left: McpHubServer, right: McpHubServer): boolean {
  return JSON.stringify(canonicalServer(left)) === JSON.stringify(canonicalServer(right));
}

function withBuiltInFlags(servers: McpHubServer[]): McpHubServer[] {
  return servers.map((server) => withBuiltInFlag(server));
}

function withBuiltInFlag(server: McpHubServer): McpHubServer {
  return { ...server, builtin: isBuiltInMcpHubServer(server.serverId) };
}

function isBuiltInMcpHubServer(serverId: string): boolean {
  return builtInMcpServers.some((server) => server.serverId === serverId);
}

function canonicalServer(server: McpHubServer): unknown {
  return {
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    headers: sortRecord(server.headers),
    env: sortRecord(server.env),
    requiredEnv: [...server.requiredEnv].sort()
  };
}

function withoutTimestamps(server: McpHubServer): Omit<McpHubServer, "createdAt" | "updatedAt"> {
  return {
    serverId: server.serverId,
    name: server.name,
    description: server.description,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    headers: server.headers,
    env: server.env,
    requiredEnv: server.requiredEnv
  };
}

function withEmptyTimestamps(server: Omit<McpHubServer, "createdAt" | "updatedAt">): McpHubServer {
  return { ...server, createdAt: "", updatedAt: "" };
}

function compactObject(value: JsonRecord): JsonRecord {
  const output: JsonRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === undefined) continue;
    if (Array.isArray(item) && item.length === 0) continue;
    if (isRecord(item) && Object.keys(item).length === 0) continue;
    output[key] = item;
  }
  return output;
}

function mapStringValues(input: Record<string, string>, fn: (value: string) => string): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, fn(value)]));
}

function sortRecord(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

function stringField(record: JsonRecord, key: string): string | null {
  return typeof record[key] === "string" ? String(record[key]) : null;
}

function stringRecordField(record: JsonRecord, key: string): Record<string, string> | null {
  const value = record[key];
  if (!isRecord(value)) return null;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, String(entryValue)]));
}

function stringArrayField(record: JsonRecord, key: string): string[] | null {
  return isStringArray(record[key]) ? record[key] : null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))];
}

function loadBuiltInMcpServers(): PersistableMcpHubServer[] {
  const root = resolveBundledPath("builtin-mcps");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const server = readBuiltInMcpServer(path.join(root, entry.name));
      return server ? [server] : [];
    });
}

function readBuiltInMcpServer(filePath: string): PersistableMcpHubServer | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!isRecord(parsed)) return null;
    const serverId = stringField(parsed, "serverId");
    const transport = transportFromValue(stringField(parsed, "transport"));
    const command = stringField(parsed, "command");
    const url = stringField(parsed, "url");
    if (!serverId || !transport) return null;
    if (transport === "stdio" && !command) return null;
    if (transport === "http" && !url) return null;
    return {
      serverId: normalizeServerId(serverId),
      name: stringField(parsed, "name") ?? serverId,
      description: stringField(parsed, "description") ?? "",
      transport,
      command,
      args: stringArrayField(parsed, "args") ?? [],
      url,
      headers: stringRecordField(parsed, "headers") ?? {},
      env: stringRecordField(parsed, "env") ?? {},
      requiredEnv: stringArrayField(parsed, "requiredEnv") ?? []
    };
  } catch {
    return null;
  }
}

function resolveBundledPath(...segments: string[]): string {
  const roots = bundledRootCandidates();
  const existing = roots.map((root) => path.join(root, ...segments)).find((candidate) => fs.existsSync(candidate));
  return existing ?? path.join(roots[0] ?? process.cwd(), ...segments);
}

function bundledRootCandidates(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return uniquePaths([
    process.cwd(),
    path.resolve(moduleDir, "../../.."),
    path.resolve(moduleDir, "../../../..")
  ]);
}

function uniquePaths(values: string[]): string[] {
  return [...new Set(values.map((value) => path.resolve(value)))];
}
