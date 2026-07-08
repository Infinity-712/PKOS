export type DesktopAppInfo = {
  version: string;
  platform: string;
};

export type OpenDashboardResult = {
  opened: boolean;
};

export type DesktopBridge = {
  getAppInfo(): Promise<DesktopAppInfo>;
  openDashboard(): Promise<OpenDashboardResult>;
};
