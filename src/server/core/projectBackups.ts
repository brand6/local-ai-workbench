import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ProjectLocalFileBackup } from "../../shared/types.js";
import { nowIso } from "./time.js";

export function backupProjectLocalTarget(
  projectRoot: string,
  targetPath: string,
  hub: string,
  targetResourceType: ProjectLocalFileBackup["targetResourceType"]
): ProjectLocalFileBackup | null {
  if (!fs.existsSync(targetPath)) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(projectRoot, ".local-ai-workbench", "backups", hub.toLowerCase(), `${timestamp}-${crypto.randomUUID().slice(0, 8)}`);
  const relative = path.relative(projectRoot, targetPath);
  const backupPath = safeJoin(backupRoot, relative && !relative.startsWith("..") ? relative : path.basename(targetPath));
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.cpSync(targetPath, backupPath, { recursive: true, force: true, dereference: false });
  const metadataPath = `${backupPath}.metadata.json`;
  const backup: ProjectLocalFileBackup = {
    originalPath: targetPath,
    backupPath,
    metadataPath,
    hub,
    targetResourceType,
    createdAt: nowIso()
  };
  fs.writeFileSync(metadataPath, `${JSON.stringify(backup, null, 2)}\n`, "utf8");
  return backup;
}

function safeJoin(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath);
  const resolvedRoot = path.resolve(root);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Refusing backup path outside root: ${relativePath}`);
  }
  return target;
}
