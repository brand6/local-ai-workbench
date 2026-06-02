import fs from "node:fs";
import path from "node:path";

export function testDir(name: string): string {
  const directory = path.resolve(".test-tmp", `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export function cleanup(directory: string): void {
  fs.rmSync(directory, { recursive: true, force: true });
}
