import fs from "node:fs";
import path from "node:path";
import type { SessionEntry } from "../../shared/types.js";
import { normalizeFsPath } from "../core/pathUtils.js";
import { refreshSessionFiles } from "../scanning/sessionScanner.js";
import type { AppDatabase } from "../storage/database.js";

interface QwenSourcePath {
  projectsRoot: string;
  projectSegment: string;
  relativePath: string;
}

export function repairQwenSourcePathForSession(database: AppDatabase, session: SessionEntry): SessionEntry | null {
  if (session.toolId !== "qwen" || !session.originalCwd) return null;
  const targetFile = canonicalQwenSourceFile(session.sourceFile, session.originalCwd);
  if (!targetFile || normalizeFsPath(targetFile) === normalizeFsPath(session.sourceFile)) return null;
  if (!fs.existsSync(session.sourceFile) || fs.existsSync(targetFile)) return null;

  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.renameSync(session.sourceFile, targetFile);

  try {
    database.deleteParserWarningsBySourceFile(session.toolId, session.sourceFile);
    refreshSessionFiles(database, [{ toolId: session.toolId, sourceFile: targetFile }]);
    return database.getSession(session.id);
  } catch (error) {
    if (fs.existsSync(targetFile) && !fs.existsSync(session.sourceFile)) {
      fs.mkdirSync(path.dirname(session.sourceFile), { recursive: true });
      fs.renameSync(targetFile, session.sourceFile);
    }
    throw error;
  }
}

function canonicalQwenSourceFile(sourceFile: string, cwd: string): string | null {
  const parsed = parseQwenProjectSourceFile(sourceFile);
  if (!parsed) return null;
  const projectSegment = encodeQwenProjectPath(cwd);
  if (parsed.projectSegment === projectSegment) return sourceFile;
  return path.join(parsed.projectsRoot, projectSegment, parsed.relativePath);
}

function parseQwenProjectSourceFile(sourceFile: string): QwenSourcePath | null {
  const match = path.normalize(sourceFile).match(/^(.*[\\/]\.qwen[\\/]projects)[\\/]([^\\/]+)[\\/](.+)$/);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return {
    projectsRoot: match[1],
    projectSegment: match[2],
    relativePath: match[3]
  };
}

function encodeQwenProjectPath(input: string): string {
  const normalized = process.platform === "win32" ? input.toLowerCase() : input;
  return normalized.replace(/[^a-zA-Z0-9]/g, "-");
}
