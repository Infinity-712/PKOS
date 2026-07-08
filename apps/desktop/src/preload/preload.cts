import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "./DesktopBridge.js";

const bridge: DesktopBridge = {
  getAppInfo: () => ipcRenderer.invoke("pkos:get-app-info") as Promise<{ version: string; platform: string }>,
  openDashboard: () => ipcRenderer.invoke("pkos:open-dashboard") as Promise<{ opened: boolean }>,
};

contextBridge.exposeInMainWorld("pkosDesktop", bridge);
