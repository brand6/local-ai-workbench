import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOpenLocalPathCommand, buildWindowsDirectoryPickerScript } from "../src/server/core/localFilesystem.js";

describe("local filesystem helpers", () => {
  it("builds local path open commands without shell interpolation from callers", () => {
    expect(buildOpenLocalPathCommand("C:\\tmp\\SkillHub\\review\\SKILL.md", "win32")).toEqual({
      executable: "cmd.exe",
      args: ["/c", "start", "", "C:\\tmp\\SkillHub\\review\\SKILL.md"]
    });
    const nativePath = path.resolve("tmp", "skillhub", "review");
    expect(buildOpenLocalPathCommand(nativePath, "darwin")).toEqual({
      executable: "open",
      args: [nativePath]
    });
    expect(buildOpenLocalPathCommand(nativePath, "linux")).toEqual({
      executable: "xdg-open",
      args: [nativePath]
    });
  });

  it("opens the Windows folder picker owned by the foreground window", () => {
    const script = buildWindowsDirectoryPickerScript();

    expect(script).toContain("FOS_PICKFOLDERS");
    expect(script).toContain("public static extern IntPtr GetForegroundWindow()");
    expect(script).toContain("$ownerHandle = [GrmFolderPicker]::GetForegroundWindow()");
    expect(script).toContain("[GrmFolderPicker]::PickFolder($ownerHandle, '选择文件夹')");
    expect(script).toContain("dialog.Show(ownerHandle)");
  });

  it("generates parseable PowerShell", () => {
    if (process.platform !== "win32") return;

    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; $script = [Console]::In.ReadToEnd(); [scriptblock]::Create($script) | Out-Null"
      ],
      { input: buildWindowsDirectoryPickerScript(), encoding: "utf8" }
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it("compiles the native window helper", () => {
    if (process.platform !== "win32") return;

    const script = buildWindowsDirectoryPickerScript();
    const lines = script.split("\n");
    const addTypeEnd = lines.findIndex((line) => line.startsWith("'@"));
    const helperScript = [
      ...lines.slice(0, addTypeEnd + 1),
      "[GrmFolderPicker]::GetForegroundWindow() | Out-Null",
      "[GrmFolderPicker]::ValidateDialogInterop()"
    ].join("\n");

    const result = spawnSync("powershell.exe", ["-NoProfile", "-STA", "-Command", helperScript], {
      encoding: "utf8"
    });

    expect(result.status, result.stderr).toBe(0);
  });
});
