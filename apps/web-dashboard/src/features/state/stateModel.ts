export type StateTimelineFilters = {
  energy: string;
  mood: string;
  mode: string;
  limit: string;
  note?: string;
};

export function buildStateTimelineQuery(filters: StateTimelineFilters): string {
  const params = new URLSearchParams();
  const energy = filters.energy.trim();
  const mood = filters.mood.trim();
  const mode = filters.mode.trim();
  const limit = filters.limit.trim();
  if (energy) {
    params.set("energy", energy);
  }
  if (mood) {
    params.set("mood", mood);
  }
  if (mode) {
    params.set("mode", mode);
  }
  if (limit) {
    params.set("limit", limit);
  }
  return params.toString();
}

export function currentStateEmptyText(): string {
  return "尚无状态快照。";
}

export function currentStateSourceText(): string {
  return "当前状态来自最近一次显式状态快照。";
}

export function stateStaleText(stale: boolean): string | null {
  return stale ? "该状态记录已超过 freshness 窗口，不一定代表现在。" : null;
}

export function stateBoundaryText(): string {
  return "状态历史是 append-only 用户自述轨迹，不是诊断记录。";
}

export function hasStateTimelineMutationAction(action: string): boolean {
  return action !== "edit" && action !== "delete" ? false : false;
}
