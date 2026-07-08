import type { DesktopBridge } from "../preload/DesktopBridge.js";

declare global {
  interface Window {
    pkosDesktop: DesktopBridge;
  }
}

export {};
