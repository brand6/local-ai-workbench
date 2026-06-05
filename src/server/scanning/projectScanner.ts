import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ScanCandidate, ToolId } from "../../shared/types.js";
import { candidateSortKey, displayPath, isPathInsideOrEqual, isStrictChildPath, normalizeFsPath } from "../core/pathUtils.js";
import { AppDatabase } from "../storage/database.js";

interface CandidateAccumulator {
  path: string;
  tools: Set<ToolId>;
  counts: Partial<Record<ToolId, number>>;
}

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".turbo",
  "target",
  "vendor",
  "AppData",
  "Windows",
  "Program Files",
  "Program Files (x86)"
]);

const AI_TRACE_NAMES: Array<{ name: string; tool: ToolId }> = [
  { name: ".codex", tool: "codex" },
  { name: "AGENTS.md", tool: "codex" },
  { name: ".claude", tool: "claude" },
  { name: "CLAUDE.md", tool: "claude" },
  { name: ".opencode", tool: "opencode" },
  { name: "OPENCODE.md", tool: "opencode" },
  { name: ".kilo", tool: "kilo" },
  { name: ".kilocode", tool: "kilo" },
  { name: "KILO.md", tool: "kilo" },
  { name: ".qwen", tool: "qwen" },
  { name: "QWEN.md", tool: "qwen" },
  { name: ".qoder", tool: "qoder" },
  { name: "QODER.md", tool: "qoder" },
  { name: "copilot-instructions.md", tool: "copilot" },
  { name: ".cursor", tool: "cursor" },
  { name: ".cursorrules", tool: "cursor" },
  { name: "mcp_config.json", tool: "antigravity" }
];

export interface ProjectScanRequest {
  scope: "directory" | "drive" | "all-fixed";
  roots?: string[];
}

export interface ConfirmScanOptions {
  includeEmptyCandidates?: boolean;
}

export function scanProjectCandidates(database: AppDatabase, request: ProjectScanRequest): { scanRunId: string; candidates: ScanCandidate[] } {
  const roots = resolveScanRoots(request);
  const scanRun = database.createScanRun(request.scope, roots);
  const candidates = buildCandidates(database, scanRun.id, roots);
  const warningCount = database.countParserWarningsForRun(scanRun.id);
  database.completeScanRun(scanRun.id, { indexedCount: candidates.length, skippedCount: 0, warningCount });
  return { scanRunId: scanRun.id, candidates };
}

export function confirmScanCandidates(database: AppDatabase, scanRunId: string, candidateIds: string[], options: ConfirmScanOptions = {}) {
  const candidates = database
    .listScanCandidates(scanRunId)
    .filter((candidate) => candidateIds.includes(candidate.id))
    .filter((candidate) => options.includeEmptyCandidates || totalSessionCount(candidate) > 0)
    .sort((a, b) => candidateSortKey(a.path) - candidateSortKey(b.path));

  return candidates.map((candidate) => database.addProject(candidate.path).project);
}

function totalSessionCount(candidate: ScanCandidate): number {
  return Object.values(candidate.sessionCounts).reduce((total, count) => total + (count ?? 0), 0);
}

function resolveScanRoots(request: ProjectScanRequest): string[] {
  if (request.scope === "all-fixed") {
    return process.platform === "win32" ? windowsDriveRoots() : [os.homedir()];
  }
  return (request.roots ?? []).map(displayPath);
}

function windowsDriveRoots(): string[] {
  const roots: string[] = [];
  for (let code = 65; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    if (fs.existsSync(root)) roots.push(root);
  }
  return roots;
}

function buildCandidates(database: AppDatabase, scanRunId: string, roots: string[]): ScanCandidate[] {
  const discovered = new Map<string, CandidateAccumulator>();
  const sessions = database.listSessions();

  for (const session of sessions) {
    if (!session.normalizedCwd) continue;
    for (const root of roots) {
      if (!isPathInsideOrEqual(root, session.normalizedCwd)) continue;
      const entry = ensure(discovered, session.originalCwd ?? session.normalizedCwd);
      entry.tools.add(session.toolId);
      entry.counts[session.toolId] = (entry.counts[session.toolId] ?? 0) + 1;
    }
  }

  for (const root of roots) {
    for (const tracePath of traceCandidates(root)) {
      const entry = ensure(discovered, tracePath.path);
      entry.tools.add(tracePath.tool);
    }
  }

  const raw = [...discovered.values()].filter((entry) => entry.tools.size > 0);
  const candidates = raw
    .map((entry) => {
      const normalized = normalizeFsPath(entry.path);
      const childCandidates = raw
        .filter((other) => isStrictChildPath(normalized, other.path))
        .map((other) => other.path)
        .sort();
      return database.insertScanCandidate({
        scanRunId,
        path: displayPath(entry.path),
        normalizedPath: normalized,
        detectedTools: [...entry.tools].sort(),
        sessionCounts: entry.counts,
        childCandidates
      });
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  return candidates;
}

function ensure(
  map: Map<string, CandidateAccumulator>,
  candidatePath: string
) {
  const normalized = normalizeFsPath(candidatePath);
  const existing = map.get(normalized);
  if (existing) return existing;
  const entry: CandidateAccumulator = { path: candidatePath, tools: new Set<ToolId>(), counts: {} };
  map.set(normalized, entry);
  return entry;
}

function traceCandidates(root: string): Array<{ path: string; tool: ToolId }> {
  const results: Array<{ path: string; tool: ToolId }> = [];
  const stack: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || current.depth > 5) continue;
    for (const entry of safeReadDir(current.directory)) {
      if (entry.isDirectory() && shouldDescend(entry.name)) {
        stack.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 });
      }

      const trace = AI_TRACE_NAMES.find((item) => item.name.toLowerCase() === entry.name.toLowerCase());
      if (trace) {
        if (trace.name === "mcp_config.json" && path.basename(current.directory).toLowerCase() !== ".agents") continue;
        if (trace.name === "mcp.json" && path.basename(current.directory).toLowerCase() !== ".vscode") continue;
        const traceRoot =
          (trace.name === "copilot-instructions.md" && path.basename(current.directory) === ".github") ||
          trace.name === "mcp_config.json" ||
          trace.name === "mcp.json"
            ? path.dirname(current.directory)
            : current.directory;
        results.push({ path: traceRoot, tool: trace.tool });
      }
    }
  }

  return results;
}

function shouldDescend(name: string): boolean {
  return !IGNORE_DIRS.has(name) && !name.startsWith("$");
}

function safeReadDir(directory: string): fs.Dirent[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}
