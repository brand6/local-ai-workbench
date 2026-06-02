import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import type { DirectoryPickResponse, ScanDrive } from "../../shared/types.js";

export function listScanDrives(): ScanDrive[] {
  if (process.platform === "win32") {
    return windowsDriveRoots().map((root) => ({ root, label: root }));
  }
  const home = os.homedir();
  return [{ root: home, label: home }];
}

export function pickDirectory(): DirectoryPickResponse {
  if (process.platform !== "win32") {
    return { path: null, cancelled: true };
  }

  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = '选择文件夹'",
    "$dialog.ShowNewFolderButton = $true",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }"
  ].join("; ");

  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
      encoding: "utf8",
      windowsHide: false
    }).trim();
    return output ? { path: output, cancelled: false } : { path: null, cancelled: true };
  } catch (error) {
    throw new Error("目录选择器启动失败", { cause: error });
  }
}

function windowsDriveRoots(): string[] {
  const roots: string[] = [];
  for (let code = 65; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    if (fs.existsSync(root)) roots.push(root);
  }
  return roots;
}
