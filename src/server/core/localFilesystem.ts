import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DirectoryPickResponse, LocalOpenResponse, ScanDrive } from "../../shared/types.js";
import { displayPath, isStrictChildPath } from "./pathUtils.js";

export interface OpenLocalPathCommand {
  executable: string;
  args: string[];
}

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

  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-STA", "-Command", buildWindowsDirectoryPickerScript()], {
      encoding: "utf8",
      windowsHide: true
    }).trim();
    return output ? { path: output, cancelled: false } : { path: null, cancelled: true };
  } catch (error) {
    throw new Error("目录选择器启动失败", { cause: error });
  }
}

export function createDirectory(parentPath: string, directoryName: string): string {
  const parent = displayPath(parentPath);
  const name = directoryName.trim();
  if (!isValidDirectoryName(name)) {
    throw new Error("项目名称不能包含路径分隔符或 Windows 保留字符");
  }
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error("项目目录不存在");
  }

  const target = displayPath(path.join(parent, name));
  if (!isStrictChildPath(parent, target)) {
    throw new Error("项目目录必须位于选择的目录下");
  }

  fs.mkdirSync(target);
  return target;
}

export function openLocalPath(targetPath: string): LocalOpenResponse {
  const target = displayPath(targetPath);
  if (!fs.existsSync(target)) {
    throw new Error("路径不存在");
  }

  const command = buildOpenLocalPathCommand(target);
  const child = spawn(command.executable, command.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.once("error", () => undefined);
  child.unref();
  return { opened: true, path: target };
}

export function buildOpenLocalPathCommand(targetPath: string, platform: NodeJS.Platform = process.platform): OpenLocalPathCommand {
  const target = displayPath(targetPath);
  if (platform === "win32") {
    return { executable: "cmd.exe", args: ["/c", "start", "", target] };
  }
  if (platform === "darwin") {
    return { executable: "open", args: [target] };
  }
  return { executable: "xdg-open", args: [target] };
}

export function buildWindowsDirectoryPickerScript(): string {
  return [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "",
    "[Flags]",
    "public enum GrmFileOpenOptions : uint {",
    "  FOS_PICKFOLDERS = 0x00000020,",
    "  FOS_FORCEFILESYSTEM = 0x00000040,",
    "  FOS_PATHMUSTEXIST = 0x00000800",
    "}",
    "",
    "public enum GrmShellItemDisplayName : uint {",
    "  SIGDN_FILESYSPATH = 0x80058000",
    "}",
    "",
    "[ComImport]",
    "[Guid(\"43826D1E-E718-42EE-BC55-A1E261C37BFE\")]",
    "[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]",
    "public interface GrmShellItem {",
    "  void BindToHandler(IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid bhid, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IntPtr ppv);",
    "  void GetParent(out GrmShellItem ppsi);",
    "  void GetDisplayName(GrmShellItemDisplayName sigdnName, out IntPtr ppszName);",
    "  void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);",
    "  void Compare(GrmShellItem psi, uint hint, out int piOrder);",
    "}",
    "",
    "[ComImport]",
    "[Guid(\"42F85136-DB7E-439C-85F1-E4075D135FC8\")]",
    "[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]",
    "public interface GrmFileDialog {",
    "  [PreserveSig] int Show(IntPtr hwndOwner);",
    "  void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);",
    "  void SetFileTypeIndex(uint iFileType);",
    "  void GetFileTypeIndex(out uint piFileType);",
    "  void Advise(IntPtr pfde, out uint pdwCookie);",
    "  void Unadvise(uint dwCookie);",
    "  void SetOptions(GrmFileOpenOptions fos);",
    "  void GetOptions(out GrmFileOpenOptions pfos);",
    "  void SetDefaultFolder(GrmShellItem psi);",
    "  void SetFolder(GrmShellItem psi);",
    "  void GetFolder(out GrmShellItem ppsi);",
    "  void GetCurrentSelection(out GrmShellItem ppsi);",
    "  void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);",
    "  void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);",
    "  void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);",
    "  void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);",
    "  void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);",
    "  void GetResult(out GrmShellItem ppsi);",
    "  void AddPlace(GrmShellItem psi, uint fdap);",
    "  void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);",
    "  void Close(int hr);",
    "  void SetClientGuid(ref Guid guid);",
    "  void ClearClientData();",
    "  void SetFilter(IntPtr pFilter);",
    "}",
    "public static class GrmFolderPicker {",
    "  private static readonly Guid FileOpenDialogClsid = new Guid(\"DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7\");",
    "  private const int HRESULT_CANCELLED = unchecked((int)0x800704C7);",
    "",
    "  [DllImport(\"user32.dll\")]",
    "  public static extern IntPtr GetForegroundWindow();",
    "",
    "  public static void ValidateDialogInterop() {",
    "    GrmFileDialog dialog = CreateDialog();",
    "    try {",
    "      GrmFileOpenOptions options;",
    "      dialog.GetOptions(out options);",
    "    } finally {",
    "      if (dialog != null) Marshal.ReleaseComObject(dialog);",
    "    }",
    "  }",
    "",
    "  public static string PickFolder(IntPtr ownerHandle, string title) {",
    "    GrmFileDialog dialog = CreateDialog();",
    "    GrmFileOpenOptions options;",
    "    dialog.GetOptions(out options);",
    "    dialog.SetOptions(options | GrmFileOpenOptions.FOS_PICKFOLDERS | GrmFileOpenOptions.FOS_FORCEFILESYSTEM | GrmFileOpenOptions.FOS_PATHMUSTEXIST);",
    "    dialog.SetTitle(title);",
    "",
    "    int hr = dialog.Show(ownerHandle);",
    "    if (hr == HRESULT_CANCELLED) return null;",
    "    if (hr != 0) Marshal.ThrowExceptionForHR(hr);",
    "",
    "    GrmShellItem item;",
    "    dialog.GetResult(out item);",
    "    IntPtr pathPointer;",
    "    item.GetDisplayName(GrmShellItemDisplayName.SIGDN_FILESYSPATH, out pathPointer);",
    "    try {",
    "      return Marshal.PtrToStringUni(pathPointer);",
    "    } finally {",
    "      if (pathPointer != IntPtr.Zero) Marshal.FreeCoTaskMem(pathPointer);",
    "      if (item != null) Marshal.ReleaseComObject(item);",
    "      Marshal.ReleaseComObject(dialog);",
    "    }",
    "  }",
    "",
    "  private static GrmFileDialog CreateDialog() {",
    "    Type dialogType = Type.GetTypeFromCLSID(FileOpenDialogClsid);",
    "    object dialog = Activator.CreateInstance(dialogType);",
    "    return (GrmFileDialog)dialog;",
    "  }",
    "}",
    "'@ | Out-Null",
    "$ownerHandle = [GrmFolderPicker]::GetForegroundWindow()",
    "$selectedPath = [GrmFolderPicker]::PickFolder($ownerHandle, '选择文件夹')",
    "if ($selectedPath) { $selectedPath }"
  ].join("\n");
}

function windowsDriveRoots(): string[] {
  const roots: string[] = [];
  for (let code = 65; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    if (fs.existsSync(root)) roots.push(root);
  }
  return roots;
}

function isValidDirectoryName(name: string): boolean {
  return name.length > 0 && name !== "." && name !== ".." && !/[<>:"/\\|?*\u0000-\u001f]/.test(name);
}
