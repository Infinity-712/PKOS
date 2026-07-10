import { BrowserWindow, session, type Event } from "electron";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { desktopAppEntryUrl, isAllowedNavigationUrl, normalizedDevUrl, safeCspHeaders } from "./securityPolicy.js";
import { installWebContentsDiagnostics, logStartupError, logStartupEvent, safeUrlForDiagnostics } from "./startupDiagnostics.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
let sessionPolicyInstalled = false;

type WindowStartupState = {
  rendererLoaded: boolean;
  loadFailed: boolean;
  preloadFailed: boolean;
};

const startupStates = new WeakMap<BrowserWindow, WindowStartupState>();

export type MainWindowOptions = {
  connectivityProbe?: boolean;
  chatHistoryConnectivityProbe?: boolean;
  onConnectivityProbeMessage?: (message: string) => void;
};

export async function createMainWindow(options: MainWindowOptions = {}): Promise<BrowserWindow> {
  const preload = resolve(currentDir, "../preload/preload.cjs");
  const rendererIndex = resolve(currentDir, "../renderer/index.html");
  const devUrl = normalizedDevUrl(process.env.PKOS_DESKTOP_DEV_SERVER_URL);
  const preloadExists = existsSync(preload);
  const rendererExists = existsSync(rendererIndex);
  logStartupEvent("create_window_started", {
    currentDir,
    preloadPath: preload,
    preloadExists,
    rendererIndexPath: rendererIndex,
    rendererIndexExists: rendererExists,
    desktopDevUrlPresent: Boolean(process.env.PKOS_DESKTOP_DEV_SERVER_URL),
    desktopDevUrl: devUrl,
  });
  if (!preloadExists) {
    throw new Error(`preload file missing: ${preload}`);
  }
  if (!devUrl && !rendererExists) {
    throw new Error(`renderer index missing: ${rendererIndex}`);
  }

  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    title: "PKOS Desktop",
    show: false,
    center: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  startupStates.set(win, {
    rendererLoaded: false,
    loadFailed: false,
    preloadFailed: false,
  });
  logStartupEvent("browser_window_created", {
    windowId: win.id,
    windowCount: BrowserWindow.getAllWindows().length,
    isVisible: win.isVisible(),
    isDestroyed: win.isDestroyed(),
  });

  installWindowSecurityPolicy(win);
  installWebContentsDiagnostics(win.webContents);
  installWindowLifecycleDiagnostics(win);
  if (options.onConnectivityProbeMessage) {
    win.webContents.on("console-message", (event) => {
      const details = event as Event & { message?: string };
      if (typeof details.message === "string") {
        options.onConnectivityProbeMessage?.(details.message);
      }
    });
  }

  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      logStartupEvent("window_show_fallback", {
        windowId: win.id,
        isDestroyed: win.isDestroyed(),
        isVisible: win.isVisible(),
      });
      showWindow(win, "fallback");
    }
  }, 3000);

  if (devUrl) {
    await loadRenderer(win, "url", devUrl);
  } else {
    const entryUrl = options.chatHistoryConnectivityProbe
      ? `${desktopAppEntryUrl}?pkos-chat-history-connectivity-probe=1`
      : options.connectivityProbe
        ? `${desktopAppEntryUrl}?pkos-connectivity-probe=1`
        : desktopAppEntryUrl;
    await loadRenderer(win, "url", entryUrl);
  }
  return win;
}

export function installSessionSecurityPolicy(): void {
  if (sessionPolicyInstalled) {
    logStartupEvent("session_security_policy_already_installed");
    return;
  }
  sessionPolicyInstalled = true;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        ...safeCspHeaders(),
      },
    });
  });
  logStartupEvent("session_security_policy_installed");
}

export function installWindowSecurityPolicy(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, targetUrl) => {
    const devUrl = normalizedDevUrl(process.env.PKOS_DESKTOP_DEV_SERVER_URL);
    if (!isAllowedNavigationUrl(targetUrl, devUrl)) {
      logStartupEvent("navigation_blocked", {
        windowId: win.id,
        targetUrl: safeUrlForDiagnostics(targetUrl),
      });
      event.preventDefault();
    }
  });
}

export function getWindowStartupState(win: BrowserWindow): WindowStartupState {
  return startupStates.get(win) ?? {
    rendererLoaded: false,
    loadFailed: false,
    preloadFailed: false,
  };
}

async function loadRenderer(win: BrowserWindow, mode: "url", target: string): Promise<void> {
  logStartupEvent("renderer_load_started", {
    windowId: win.id,
    mode,
    target: safeUrlForDiagnostics(target),
  });
  try {
    await win.loadURL(target);
    const state = getMutableState(win);
    state.rendererLoaded = true;
    logStartupEvent("renderer_load_succeeded", {
      windowId: win.id,
      isVisible: win.isVisible(),
      url: safeUrlForDiagnostics(win.webContents.getURL()),
    });
    showWindow(win, "load_succeeded");
  } catch (error) {
    const state = getMutableState(win);
    state.loadFailed = true;
    logStartupError("renderer_load_failed", error, {
      windowId: win.id,
      mode,
      target: safeUrlForDiagnostics(target),
    });
    showStartupErrorWindow(win);
  }
}

function installWindowLifecycleDiagnostics(win: BrowserWindow): void {
  win.once("ready-to-show", () => {
    logStartupEvent("ready_to_show", {
      windowId: win.id,
      isVisible: win.isVisible(),
      isDestroyed: win.isDestroyed(),
    });
    showWindow(win, "ready_to_show");
  });
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    const state = getMutableState(win);
    state.loadFailed = true;
    logStartupEvent("renderer_load_failed", {
      windowId: win.id,
      errorCode,
      errorDescription,
      url: safeUrlForDiagnostics(validatedURL),
    });
    showStartupErrorWindow(win);
  });
  win.webContents.on("preload-error", () => {
    const state = getMutableState(win);
    state.preloadFailed = true;
  });
  win.on("closed", () => {
    logStartupEvent("window_closed", {
      windowId: win.id,
      windowCount: BrowserWindow.getAllWindows().length,
    });
  });
}

function showWindow(win: BrowserWindow, reason: string): void {
  if (win.isDestroyed()) {
    return;
  }
  win.center();
  win.show();
  win.focus();
  logStartupEvent("window_shown", {
    windowId: win.id,
    reason,
    isVisible: win.isVisible(),
    isDestroyed: win.isDestroyed(),
    boundsWidth: win.getBounds().width,
    boundsHeight: win.getBounds().height,
  });
}

function showStartupErrorWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return;
  }
  win.setTitle("PKOS Desktop Startup Error");
  showWindow(win, "startup_error");
}

function getMutableState(win: BrowserWindow): WindowStartupState {
  const existing = getWindowStartupState(win);
  startupStates.set(win, existing);
  return existing;
}
