import os from "node:os";
import path from "node:path";

function stripExtendedPrefix(input: string): string {
  if (input.startsWith("\\\\?\\")) return input.slice(4);
  if (input.startsWith("//?/")) return input.slice(4);
  return input;
}

export function normalizeFsPath(input: string): string {
  const trimmed = stripExtendedPrefix(input.trim());
  const resolved = path.resolve(trimmed);
  let normalized = path.normalize(resolved);

  while (normalized.length > path.parse(normalized).root.length && /[\\/]$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }

  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function displayPath(input: string): string {
  return path.normalize(path.resolve(stripExtendedPrefix(input.trim())));
}

export function isPathInsideOrEqual(parentPath: string, candidatePath: string): boolean {
  const parent = normalizeFsPath(parentPath);
  const candidate = normalizeFsPath(candidatePath);
  if (parent === candidate) return true;

  const relative = path.relative(parent, candidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function isStrictChildPath(parentPath: string, candidatePath: string): boolean {
  const parent = normalizeFsPath(parentPath);
  const candidate = normalizeFsPath(candidatePath);
  return parent !== candidate && isPathInsideOrEqual(parent, candidate);
}

export function relativeLabel(rootPath: string, childPath: string): string {
  const relative = path.relative(displayPath(rootPath), displayPath(childPath));
  return relative.length > 0 ? relative : path.basename(displayPath(rootPath)) || displayPath(rootPath);
}

export function rebasePath(input: string, oldRoot: string, newRoot: string): string | null {
  if (!isPathInsideOrEqual(oldRoot, input)) return null;
  const relative = path.relative(displayPath(oldRoot), displayPath(input));
  return relative.length > 0 ? path.join(displayPath(newRoot), relative) : displayPath(newRoot);
}

export function homePath(...parts: string[]): string {
  return path.join(os.homedir(), ...parts);
}

export function candidateSortKey(input: string): number {
  return normalizeFsPath(input).split(/[\\/]+/).length;
}
