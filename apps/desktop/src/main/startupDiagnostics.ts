import { app, BrowserWindow, type WebContents } from "electron";

type DiagnosticValue = string | number | boolean | null | undefined;
type DiagnosticFields = Record<string, DiagnosticValue>;

let processHandlersInstalled = false;
let appHandlersInstalled = false;

export function logStartupEvent(event: string, fields: DiagnosticFields = {}): void {
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...fields,
  };
  console.log(`[pkos-desktop] ${JSON.stringify(payload)}`);
}

export function logStartupError(event: string, error: unknown, fields: DiagnosticFields = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "Error";
  logStartupEvent(event, { ...fields, errorName: name, errorMessage: message });
}

export function installProcessDiagnostics(): void {
  if (processHandlersInstalled) {
    return;
  }
  processHandlersInstalled = true;
  process.on("uncaughtException", (error) => {
    logStartupError("uncaught_exception", error);
  });
  process.on("unhandledRejection", (reason) => {
    logStartupError("unhandled_rejection", reason);
  });
}

export function installAppDiagnostics(): void {
  if (appHandlersInstalled) {
    return;
  }
  appHandlersInstalled = true;
  app.on("browser-window-created", (_event, window) => {
    logStartupEvent("browser_window_created", {
      windowId: window.id,
      windowCount: BrowserWindow.getAllWindows().length,
      isVisible: window.isVisible(),
      isDestroyed: window.isDestroyed(),
    });
  });
  app.on("child-process-gone", (_event, details) => {
    logStartupEvent("child-process-gone", {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  app.on("render-process-gone", (_event, webContents, details) => {
    logStartupEvent("render_process_gone", {
      webContentsId: webContents.id,
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
}

export function environmentDiagnostics(devUrl: string | null): DiagnosticFields {
  return {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    processType: process.type,
    defaultApp: Boolean(process.defaultApp),
    appReady: app.isReady(),
    electronRunAsNode: Boolean(process.env.ELECTRON_RUN_AS_NODE),
    desktopDevUrlPresent: Boolean(process.env.PKOS_DESKTOP_DEV_SERVER_URL),
    desktopDevUrl: devUrl,
  };
}

export function safeUrlForDiagnostics(value: string): string {
  if (value.startsWith("file://")) {
    return "file://app-renderer";
  }
  if (value.startsWith("pkos-desktop://app/")) {
    return "pkos-desktop://app";
  }
  if (value.startsWith("http://127.0.0.1:5174")) {
    return "http://127.0.0.1:5174";
  }
  if (value.startsWith("data:")) {
    return "data://startup-error";
  }
  return "blocked-or-unknown";
}

export function installWebContentsDiagnostics(webContents: WebContents): void {
  webContents.on("render-process-gone", (_event, details) => {
    logStartupEvent("render_process_gone", {
      webContentsId: webContents.id,
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  webContents.on("preload-error", (_event, preloadPath, error) => {
    logStartupError("preload_error", error, {
      webContentsId: webContents.id,
      preloadPath,
    });
  });
}
