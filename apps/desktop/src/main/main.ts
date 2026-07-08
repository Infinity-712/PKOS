import { BrowserWindow, app, ipcMain, shell } from "electron";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMainWindow, getWindowStartupState, installSessionSecurityPolicy } from "./createWindow.js";
import { installDesktopAppSchemeHandler, registerDesktopAppScheme } from "./appScheme.js";
import {
  dashboardUrl,
  isAllowedExternalUrl,
  normalizedDevUrl,
} from "./securityPolicy.js";
import {
  environmentDiagnostics,
  installAppDiagnostics,
  installProcessDiagnostics,
  logStartupError,
  logStartupEvent,
} from "./startupDiagnostics.js";

let mainWindow: BrowserWindow | null = null;
const probeMode = process.argv.includes("--pkos-window-probe");
const connectivityProbeMode = process.argv.includes("--pkos-connectivity-probe");
const probeUserDataDir = probeMode || connectivityProbeMode ? mkdtempSync(join(tmpdir(), "pkos-desktop-probe-")) : null;

registerDesktopAppScheme();
if (probeUserDataDir) {
  app.setPath("userData", probeUserDataDir);
}
installProcessDiagnostics();
logStartupEvent("main_module_loaded", environmentDiagnostics(normalizedDevUrl(process.env.PKOS_DESKTOP_DEV_SERVER_URL)));

ipcMain.handle("pkos:get-app-info", () => ({
  version: app.getVersion(),
  platform: process.platform,
}));

ipcMain.handle("pkos:open-dashboard", async () => {
  if (!isAllowedExternalUrl(dashboardUrl)) {
    return { opened: false };
  }

  await shell.openExternal(dashboardUrl);
  return { opened: true };
});

async function ensureMainWindow(options: { connectivityProbe?: boolean; onConnectivityProbeMessage?: (message: string) => void } = {}): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = await createMainWindow({
    connectivityProbe: options.connectivityProbe,
    onConnectivityProbeMessage: options.onConnectivityProbeMessage,
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function bootstrap(): Promise<void> {
  logStartupEvent("app_when_ready_waiting", environmentDiagnostics(normalizedDevUrl(process.env.PKOS_DESKTOP_DEV_SERVER_URL)));
  await app.whenReady();
  logStartupEvent("app_ready", environmentDiagnostics(normalizedDevUrl(process.env.PKOS_DESKTOP_DEV_SERVER_URL)));
  installAppDiagnostics();
  installDesktopAppSchemeHandler();
  installSessionSecurityPolicy();
  if (connectivityProbeMode) {
    await runConnectivityProbe();
    return;
  }
  await ensureMainWindow();
  if (probeMode) {
    await runWindowProbe();
  }
}

void bootstrap().catch((error) => {
  logStartupError("startup_failed", error);
  app.exit(1);
});

app.on("activate", () => {
  void ensureMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  if (probeUserDataDir) {
    rmSync(probeUserDataDir, { recursive: true, force: true });
  }
});

async function runWindowProbe(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    logStartupEvent("window_probe_failed", { reason: "missing_window" });
    app.exit(1);
    return;
  }
  const state = getWindowStartupState(mainWindow);
  const ok =
    BrowserWindow.getAllWindows().length >= 1 &&
    !mainWindow.isDestroyed() &&
    state.rendererLoaded &&
    !state.loadFailed &&
    !state.preloadFailed;
  if (!ok) {
    logStartupEvent("window_probe_failed", {
      reason: "window_state_invalid",
      windowCount: BrowserWindow.getAllWindows().length,
      isDestroyed: mainWindow.isDestroyed(),
      isVisible: mainWindow.isVisible(),
      rendererLoaded: state.rendererLoaded,
      loadFailed: state.loadFailed,
      preloadFailed: state.preloadFailed,
    });
    app.exit(1);
    return;
  }
  logStartupEvent("window_probe_ok", {
    windowId: mainWindow.id,
    windowCount: BrowserWindow.getAllWindows().length,
    isVisible: mainWindow.isVisible(),
  });
  console.log("DESKTOP_WINDOW_PROBE_OK");
  mainWindow.close();
  app.exit(0);
}

async function runConnectivityProbe(): Promise<void> {
  const result = createConnectivityProbeResult();
  await ensureMainWindow({
    connectivityProbe: true,
    onConnectivityProbeMessage: result.onConsoleMessage,
  });
  try {
    await result.done;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
    app.exit(0);
  } catch (error) {
    logStartupError("connectivity_probe_failed", error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
    app.exit(1);
  }
}

function createConnectivityProbeResult(): { done: Promise<void>; onConsoleMessage: (message: string) => void } {
  let settled = false;
  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectDone(new Error("connectivity_probe_timeout"));
    }
  }, 10000);

  return {
    done,
    onConsoleMessage(message: string) {
      if (settled) {
        return;
      }
      if (message.startsWith("DESKTOP_CONNECTIVITY_PROBE_OK")) {
        settled = true;
        clearTimeout(timeout);
        console.log(message);
        resolveDone();
      } else if (message.startsWith("DESKTOP_CONNECTIVITY_PROBE_FAILED")) {
        settled = true;
        clearTimeout(timeout);
        console.log(message);
        rejectDone(new Error("renderer_connectivity_probe_failed"));
      }
    },
  };
}
