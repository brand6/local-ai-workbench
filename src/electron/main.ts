import { app, BrowserWindow, dialog, shell } from "electron";
import { startHttpServer, type RunningHttpServer } from "../server/runtime.js";
import type { DirectoryPickResponse } from "../shared/types.js";

let runtime: RunningHttpServer | null = null;
let mainWindow: BrowserWindow | null = null;
let quitting = false;

app.setName("Local AI Workbench");

app.whenReady()
  .then(async () => {
    runtime = await startHttpServer({ port: 0, dev: false, dataDir: dataDirArg(), pickDirectory: pickDirectoryInElectron });
    mainWindow = createMainWindow(runtime.url);
  })
  .catch((error) => {
    dialog.showErrorBox("Local AI Workbench 启动失败", error instanceof Error ? error.message : String(error));
    app.quit();
  });

app.on("activate", () => {
  if (!mainWindow && runtime) {
    mainWindow = createMainWindow(runtime.url);
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  stopRuntime().finally(() => app.quit());
});

function createMainWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Local AI Workbench",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    openExternal(targetUrl);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (sameOrigin(targetUrl, url)) return;
    event.preventDefault();
    openExternal(targetUrl);
  });

  window.loadURL(url).catch((error) => {
    dialog.showErrorBox("页面加载失败", error instanceof Error ? error.message : String(error));
  });

  return window;
}

async function stopRuntime(): Promise<void> {
  const current = runtime;
  runtime = null;
  if (current) {
    await current.close();
  }
}

function dataDirArg(): string | null {
  const index = process.argv.indexOf("--data-dir");
  const value = index >= 0 ? process.argv[index + 1] : null;
  return value?.trim() ? value : null;
}

function sameOrigin(targetUrl: string, appUrl: string): boolean {
  try {
    return new URL(targetUrl).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

function openExternal(targetUrl: string): void {
  if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) {
    shell.openExternal(targetUrl).catch(() => undefined);
  }
}

async function pickDirectoryInElectron(): Promise<DirectoryPickResponse> {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, { title: "选择文件夹", properties: ["openDirectory"] })
    : await dialog.showOpenDialog({ title: "选择文件夹", properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) {
    return { path: null, cancelled: true };
  }
  return { path: result.filePaths[0] ?? null, cancelled: false };
}
