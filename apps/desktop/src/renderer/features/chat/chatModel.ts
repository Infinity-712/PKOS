import type { HealthResponse } from "@pkos/agent-client";

export type SendState = {
  active: boolean;
  statusText: string;
};

export type BackendStatus = {
  connected: boolean;
  label: string;
};

export function startSend(current: SendState): SendState {
  if (current.active) {
    return current;
  }
  return { active: true, statusText: "receiving stream" };
}

export function finishSend(current: SendState): SendState {
  return { ...current, active: false, statusText: current.statusText || "idle" };
}

export function abortSend(_current: SendState): SendState {
  return {
    active: false,
    statusText: "已停止接收流；后端状态请以运行记录为准。",
  };
}

export function backendStatusFromHealth(health: HealthResponse | null): BackendStatus {
  if (health?.ok) {
    return { connected: true, label: "connected" };
  }
  return { connected: false, label: "disconnected" };
}

export function currentStateText(item: { stale: boolean } | null): string {
  if (!item) {
    return "尚无状态快照。";
  }
  if (item.stale) {
    return "该状态记录可能已经过期。";
  }
  return "来自最近一次显式状态快照";
}
