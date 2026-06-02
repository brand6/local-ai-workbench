import fs from "node:fs";
import path from "node:path";
import type { ParserWarning, ResumeStatus, SessionEntry, ToolId } from "../../shared/types.js";
import { normalizeFsPath } from "../core/pathUtils.js";
import { maxIso, nowIso, toIso } from "../core/time.js";

interface ParseContext {
  toolId: ToolId;
  parserVersion: string;
  sourceFormat: string;
  sourceFile: string;
  scanRunId: string | null;
}

interface ParsedValue {
  session: SessionEntry | null;
  warnings: Array<Omit<ParserWarning, "id" | "createdAt">>;
  skipped: boolean;
}

export function parseSessionFile(context: ParseContext): ParsedValue {
  const warnings: Array<Omit<ParserWarning, "id" | "createdAt">> = [];

  if (context.toolId === "claude" && isClaudeMetadataFile(context.sourceFile)) {
    return { session: null, warnings, skipped: true };
  }
  if (context.toolId === "claude" && isClaudeToolResultFile(context.sourceFile)) {
    return { session: null, warnings, skipped: true };
  }
  if (context.toolId === "copilot" && isCopilotMetadataFile(context.sourceFile)) {
    return { session: null, warnings, skipped: true };
  }
  if (context.toolId === "qwen" && isQwenMetadataFile(context.sourceFile)) {
    return { session: null, warnings, skipped: true };
  }

  const stat = fs.statSync(context.sourceFile);
  const content = fs.readFileSync(context.sourceFile, "utf8");
  const events: unknown[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      warnings.push({
        scanRunId: context.scanRunId,
        toolId: context.toolId,
        sourceFile: context.sourceFile,
        errorType: "malformed-jsonl",
        message: error instanceof Error ? error.message : "Malformed JSONL line",
        line: index + 1
      });
    }
  }

  if (events.length === 0) {
    warnings.push({
      scanRunId: context.scanRunId,
      toolId: context.toolId,
      sourceFile: context.sourceFile,
      errorType: "empty-session",
      message: "No readable session events were found",
      line: null
    });
    return { session: null, warnings, skipped: true };
  }

  if (context.toolId === "claude" && isClaudeSidechainOnly(events)) {
    return { session: null, warnings, skipped: true };
  }

  const nativeSessionId = extractSessionId(events, context.sourceFile, context.toolId);
  const cwd = findSessionCwd(events);
  const normalizedCwd = cwd ? normalizeFsPath(cwd) : null;
  const summary = findSessionSummary(events) ?? usefulSummary(findFirstString(events, ["summary", "synopsis"]));
  let title = findSessionTitle(events) ?? titleFromSummary(summary) ?? firstUserText(events) ?? firstCommandText(events);
  if (!title) {
    title = firstUserText(events) ?? `未命名会话 ${path.basename(context.sourceFile)}`;
    warnings.push({
      scanRunId: context.scanRunId,
      toolId: context.toolId,
      sourceFile: context.sourceFile,
      errorType: "missing-title",
      message: "Session title was missing; a fallback title was used",
      line: null
    });
  }

  if (!nativeSessionId) {
    warnings.push({
      scanRunId: context.scanRunId,
      toolId: context.toolId,
      sourceFile: context.sourceFile,
      errorType: "missing-session-id",
      message: "Session id was missing; resume is disabled",
      line: null
    });
  }

  if (!cwd) {
    warnings.push({
      scanRunId: context.scanRunId,
      toolId: context.toolId,
      sourceFile: context.sourceFile,
      errorType: "missing-cwd",
      message: "Session cwd was missing; resume is disabled",
      line: null
    });
  }

  const updatedAt =
    maxIso(events.flatMap((event) => findAllTimestamps(event))) ?? stat.mtime.toISOString();

  let resumeStatus: ResumeStatus = !nativeSessionId ? "missing_session_id" : !cwd ? "missing_cwd" : fs.existsSync(cwd) ? "ready" : "cwd_missing";
  if (resumeStatus === "ready" && context.toolId === "qwen" && cwd && !isQwenSourceStoredForCwd(context.sourceFile, cwd)) {
    resumeStatus = "source_mismatch";
    warnings.push({
      scanRunId: context.scanRunId,
      toolId: context.toolId,
      sourceFile: context.sourceFile,
      errorType: "qwen-project-source-mismatch",
      message: "Qwen session source is stored under a different project directory; resume is disabled",
      line: null
    });
  }
  const id = stableSessionId(context.toolId, nativeSessionId, context.sourceFile);
  const session: SessionEntry = {
    id,
    toolId: context.toolId,
    nativeSessionId,
    title: title.slice(0, 180),
    summary: summary?.slice(0, 2000) ?? null,
    originalCwd: cwd,
    normalizedCwd,
    updatedAt,
    sourceFile: context.sourceFile,
    sourceFormat: context.sourceFormat,
    parserVersion: context.parserVersion,
    resumeStatus,
    indexedAt: nowIso()
  };

  return { session, warnings, skipped: false };
}

function isClaudeMetadataFile(sourceFile: string): boolean {
  return path.basename(sourceFile).toLowerCase().endsWith(".meta.json");
}

function isClaudeToolResultFile(sourceFile: string): boolean {
  const parts = path.normalize(sourceFile).split(/[\\/]+/);
  return path.extname(sourceFile).toLowerCase() === ".json" && parts.some((part) => part.toLowerCase() === "tool-results");
}

function isCopilotMetadataFile(sourceFile: string): boolean {
  return path.basename(sourceFile).toLowerCase() === "vscode.metadata.json";
}

function isQwenMetadataFile(sourceFile: string): boolean {
  const basename = path.basename(sourceFile).toLowerCase();
  return basename === "extract-cursor.json" || basename === "meta.json";
}

function isQwenSourceStoredForCwd(sourceFile: string, cwd: string): boolean {
  const parts = path.normalize(sourceFile).split(/[\\/]+/);
  for (let index = 0; index < parts.length - 2; index += 1) {
    if (parts[index]?.toLowerCase() !== "projects") continue;
    if (parts[index + 2]?.toLowerCase() !== "chats") continue;
    return parts[index + 1] === qwenProjectId(cwd);
  }
  return true;
}

function qwenProjectId(cwd: string): string {
  const normalized = process.platform === "win32" ? cwd.toLowerCase() : cwd;
  return normalized.replace(/[^a-zA-Z0-9]/g, "-");
}

function stableSessionId(toolId: ToolId, nativeSessionId: string | null, sourceFile: string): string {
  return `${toolId}:${nativeSessionId ?? normalizeFsPath(sourceFile)}`;
}

function extractSessionId(events: unknown[], sourceFile: string, toolId: ToolId): string | null {
  for (const event of events) {
    const sessionMetaId =
      getPathString(event, ["session_meta", "payload", "id"]) ??
      getSessionMetaPayloadString(event, "id") ??
      getPathString(event, ["sessionMeta", "id"]);
    if (sessionMetaId) return sessionMetaId;
  }

  const keys = sessionIdKeys(toolId);
  return findFirstString(events, keys) ?? inferIdFromFilename(sourceFile);
}

function sessionIdKeys(toolId: ToolId): string[] {
  if (toolId === "claude") return ["sessionId", "session_id", "conversationId"];
  if (toolId === "qwen") return ["session_id", "sessionId", "conversation_id", "conversationId", "id", "uuid"];
  if (toolId === "opencode") return ["sessionID", "sessionId", "session_id", "conversationId", "id"];
  if (toolId === "qoder") return ["sessionId", "session_id", "conversationId", "id"];
  if (toolId === "copilot") return ["sessionId", "session_id", "conversationId", "id"];
  return ["session_id", "sessionId", "conversation_id", "conversationId"];
}

function inferIdFromFilename(sourceFile: string): string | null {
  const basename = path.basename(sourceFile, path.extname(sourceFile));
  return /^[a-zA-Z0-9_-]{8,}$/.test(basename) ? basename : null;
}

function isClaudeSidechainOnly(events: unknown[]): boolean {
  let sawSidechain = false;
  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    const value = (event as Record<string, unknown>).isSidechain;
    if (value === false) return false;
    if (value === true) sawSidechain = true;
  }
  return sawSidechain;
}

function findFirstString(value: unknown, keys: string[]): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstString(item, keys);
      if (found) return found;
    }
    return null;
  }

  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const direct = record[key];
    if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();
  }

  for (const child of Object.values(record)) {
    const found = findFirstString(child, keys);
    if (found) return found;
  }

  return null;
}

function findSessionTitle(events: unknown[]): string | null {
  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    const record = event as Record<string, unknown>;
    const title = directString(record, "title") ?? directString(record, "conversationTitle");
    if (title) return title;

    const eventKind = directString(record, "type")?.toLowerCase();
    const eventRole = directString(record, "role")?.toLowerCase() ?? getPathString(record, ["message", "role"])?.toLowerCase();
    if (!eventKind?.includes("tool") && eventRole !== "assistant") {
      const name = directString(record, "name");
      if (name) return name;
    }
  }

  return null;
}

function findSessionSummary(events: unknown[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    const record = event as Record<string, unknown>;
    const type = directString(record, "type")?.toLowerCase();
    const subtype = directString(record, "subtype")?.toLowerCase();
    if (type !== "summary" && !subtype?.includes("summary")) continue;
    const content = directString(record, "content") ?? directString(record, "summary");
    if (content) return compactText(content);
  }

  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    const record = event as Record<string, unknown>;
    const summary = directString(record, "summary") ?? directString(record, "synopsis");
    if (summary) return compactText(summary);
  }

  return null;
}

function titleFromSummary(summary: string | null): string | null {
  if (!summary) return null;
  return compactText(summary).slice(0, 80);
}

function usefulSummary(summary: string | null): string | null {
  if (!summary) return null;
  const compact = compactText(summary);
  return compact.toLowerCase() === "auto" ? null : compact;
}

function directString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getPathString(value: unknown, segments: string[]): string | null {
  let current = value;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" && current.trim().length > 0 ? current.trim() : null;
}

function getSessionMetaPayloadString(event: unknown, key: string): string | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const record = event as Record<string, unknown>;
  if (directString(record, "type")?.toLowerCase() !== "session_meta") return null;
  return getPathString(record, ["payload", key]);
}

function findSessionCwd(events: unknown[]): string | null {
  const directKeys = ["cwd", "current_working_directory", "workingDirectory", "working_dir", "projectRoot", "workspaceRoot"];
  const nestedPaths = [
    ["session_meta", "payload", "cwd"],
    ["sessionMeta", "cwd"],
    ["workspace", "cwd"],
    ["workspace", "root"]
  ];

  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    const record = event as Record<string, unknown>;
    const sessionMetaCwd = getSessionMetaPayloadString(record, "cwd");
    if (sessionMetaCwd) return sessionMetaCwd;
    for (const key of directKeys) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
    }
    for (const segments of nestedPaths) {
      const value = getPathString(record, segments);
      if (value) return value;
    }
  }

  return null;
}

function firstUserText(events: unknown[]): string | null {
  for (const event of events) {
    const text = extractTextFromUserEvent(event, { allowCommand: false });
    if (text) return text.slice(0, 80);
  }
  return null;
}

function firstCommandText(events: unknown[]): string | null {
  for (const event of events) {
    const text = extractTextFromUserEvent(event, { allowCommand: true });
    if (text) return text.slice(0, 80);
  }
  return null;
}

function extractTextFromUserEvent(event: unknown, options: { allowCommand: boolean }): string | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  if (record.isMeta === true) return null;
  const codexContent = codexUserMessageContent(record);
  if (codexContent) return titleCandidateFromContent(codexContent, options);
  const role = directString(record, "type") ?? getPathString(record, ["message", "role"]) ?? directString(record, "role");
  if (role && !["user", "human"].includes(role.toLowerCase())) return null;
  const content = userMessageContent(record);
  if (!content) return null;
  return titleCandidateFromContent(content, options);
}

function titleCandidateFromContent(content: string, options: { allowCommand: boolean }): string | null {
  if (isContextOnlyUserMessage(content)) return null;
  const command = parseCommand(content);
  if (command.found) return options.allowCommand ? command.title : null;
  if (content.includes("<local-command-caveat>")) return null;
  return compactText(content);
}

function codexUserMessageContent(record: Record<string, unknown>): string | null {
  const eventType = directString(record, "type")?.toLowerCase();
  const payload = record.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const payloadRecord = payload as Record<string, unknown>;

  if (eventType === "response_item") {
    const payloadType = directString(payloadRecord, "type")?.toLowerCase();
    const payloadRole = directString(payloadRecord, "role")?.toLowerCase();
    if (payloadType !== "message" || payloadRole !== "user") return null;
    return textContent(payloadRecord.content);
  }

  if (eventType === "event_msg" && directString(payloadRecord, "type")?.toLowerCase() === "user_message") {
    return directString(payloadRecord, "message") ?? textContent(payloadRecord.content);
  }

  return null;
}

function isContextOnlyUserMessage(content: string): boolean {
  const trimmed = content.trimStart();
  return trimmed.startsWith("# AGENTS.md instructions ") || trimmed.includes("<environment_context>");
}

function userMessageContent(record: Record<string, unknown>): string | null {
  const message = record.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const messageRecord = message as Record<string, unknown>;
    const content = messageRecord.content;
    const extracted = textContent(content);
    if (extracted) return extracted;
    const parts = messageRecord.parts;
    const partsExtracted = textContent(parts);
    if (partsExtracted) return partsExtracted;
  }
  return textContent(record.content);
}

function textContent(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (!Array.isArray(value)) return null;
  const parts: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (record.type === "tool_result") continue;
    const text = directString(record, "text") ?? directString(record, "content");
    if (text) parts.push(text);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function parseCommand(content: string): { found: boolean; title: string | null } {
  const name = content.match(/<command-name>(.*?)<\/command-name>/s)?.[1]?.trim();
  if (!name) return { found: false, title: null };
  if (name === "/clear") return { found: true, title: null };
  const args = content.match(/<command-args>(.*?)<\/command-args>/s)?.[1]?.trim();
  return { found: true, title: compactText([name, args].filter(Boolean).join(" ")) };
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function findAllTimestamps(value: unknown): string[] {
  const keys = new Set(["timestamp", "created_at", "createdAt", "updated_at", "updatedAt", "time"]);
  const results: string[] = [];

  function visit(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (keys.has(key)) {
        const iso = toIso(child);
        if (iso) results.push(iso);
      }
      if (child && typeof child === "object") visit(child);
    }
  }

  visit(value);
  return results;
}
