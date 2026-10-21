// Synthetic browser-only fixtures. No request is forwarded to a real service.
const now = "2026-09-26T08:30:00.000Z";
const sha = "a".repeat(64);
const sessions = [
  { id: "preview-a", title: "慢慢找回自己的节奏", status: "active", created_at: now, updated_at: now },
  { id: "preview-b", title: "一个关于阅读的想法", status: "active", created_at: now, updated_at: now },
];
function chatMessage(id, role, content, generationId = null) { return { id, role, content, generationId, status: "completed", createdAt: now, updatedAt: now }; }
const histories = {
  "preview-a": [chatMessage("a1", "user", "今天想把节奏放慢一点，把最近零散的想法整理一下。"), chatMessage("a2", "assistant", "那就慢慢来，不用一下子整理好所有事。\n\n最近有没有一个想法，让你觉得值得留下？我们可以先从那里开始。")],
  "preview-b": [chatMessage("b1", "user", "读书的时候，怎样让笔记真正留在自己的思考里？"), chatMessage("b2", "assistant", "先留下一句真正触动你的话，再用自己的语言回应它。\n\n不必急着写得完整。你对它的疑问，也是一种很好的笔记。")],
};
const provider = { provider: "dry-run", selection: { profileId: "preview", providerId: "preview", providerDisplayName: "本地预览", protocol: "dry-run", modelId: "synthetic", modelDisplayName: "Synthetic", reasoningPreset: "off", external: false }, connection: { state: "dry_run", lastAttemptAt: null, lastSuccessAt: null, lastErrorCode: null }, consentRequired: false, configured: true, capabilities: { streaming: true, textGeneration: true, toolCallingEnabled: false, reasoningPresets: ["off"] }, model: "synthetic", dataEgress: "none", toolsEnabled: false, readOnly: true };
const state = { id: "state.preview", source: "desktop", energy: "medium", mood: "calm", body: "normal", context: "home", mode: "normal", risk: {}, note: "留一点时间，整理思绪。", createdAt: now, stale: false };
const action = { requestId: "request.preview", actionName: "inbox_append", payloadSha256: sha, storedStatus: "running", effectiveStatus: "indeterminate", createdAt: now, updatedAt: now, stale: true };
const objects = [
  { id: "fact.spaced.repetition", type: "fact", title: "间隔重复：让记忆有时间生长", summary: "在逐渐拉长的间隔中重新提取知识。", status: "parsed" },
  { id: "skill.reflective.reading", type: "skill", title: "阅读之后，写下自己的回应", summary: "从复述走向独立理解。", status: "challenged" },
  { id: "claim.attention", type: "claim", title: "注意力是一种可以主动分配的资源", summary: "为深度工作保留完整的时间。", status: "parsed" },
  { id: "creative.saturday", type: "creative", title: "周六，给自己的一封短信", summary: "允许慢下来，也允许重新开始。", status: "draft" },
];
const detail = (item) => ({ ok: true, schemaVersion: "0.8-beta", object: { ...item, content: item.summary, source: [], anchors: [] }, location: `objects/${item.type}/${item.id}.yaml`, fileRevisionSha256: sha, objectContentSha256: sha, srsEligible: item.type !== "creative", contentChangedSinceLastReview: false, reviewSummary: null, editableFields: ["title", "content", "summary", "source", "anchors", "status"], immutableFields: ["id", "type"], additionalFields: [], dataRootFingerprint: "synthetic" });
const reviewItems = objects.slice(0, 2).map((item) => ({ objectId: item.id, objectType: item.type, title: item.title, status: "trusted", dueAt: now, lastReviewedAt: "2026-09-23T08:00:00Z", repetitions: 2, intervalDays: 3, easeFactor: 2.5, contentChangedSinceLastReview: false, legacyWarning: null, overdueDays: 0 }));
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
window.__previewRequests = [];
window.__previewUnexpected = [];
window.pkosDesktop = { openDashboard: async () => { window.location.href = "/"; } };
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url ?? String(input), window.location.href);
  const path = url.pathname;
  const method = init.method ?? "GET";
  const body = init.body ? JSON.parse(String(init.body)) : {};
  window.__previewRequests.push({ path, method });
  if (path === "/api/chat/sessions" && method === "POST") {
    const session = { ...sessions[0], id: `preview-${sessions.length + 1}`, title: body.title || "新对话" };
    sessions.unshift(session); histories[session.id] = []; return json({ ok: true, session });
  }
  if (path === "/api/chat/send" && method === "POST") {
    const sessionId = body.sessionId;
    const generationId = `preview-generation-${Date.now()}`;
    const content = "我在。这是一条本地预览回复，不会调用真实模型，也不会写入你的知识库。";
    histories[sessionId].push(chatMessage(`u-${generationId}`, "user", body.message));
    return new Response(new ReadableStream({ async start(controller) {
      const encoder = new TextEncoder();
      const emit = (type, payload) => controller.enqueue(encoder.encode(`${JSON.stringify({ id: `${generationId}-${type}`, ts: now, type, severity: "info", sessionId, generationId, payload })}\n`));
      emit("generation_started", {});
      for (const delta of content.match(/.{1,5}/gu)) { await new Promise((done) => setTimeout(done, 70)); emit("content_delta", { delta }); }
      histories[sessionId].push(chatMessage(`a-${generationId}`, "assistant", content, generationId));
      emit("generation_completed", {}); controller.close();
    } }), { headers: { "Content-Type": "application/x-ndjson" } });
  }
  if (method !== "GET") return json({ ok: false, error: { code: "preview_read_only", message: "只读设计预览：没有写入真实数据。 / Read-only design preview." } }, 403);
  if (path === "/health") return json({ ok: true, service: "pkos-agent-server", mode: "preview", runtimeFingerprint: "synthetic-preview", serviceBuildFingerprint: "a".repeat(12), apiContractVersion: "0.8-beta", databaseCompatible: true });
  if (path === "/api/runtime-info") return json({ service: { name: "pkos-agent-server", version: "0.8-beta", apiContractVersion: "0.8-beta", buildFingerprint: "a".repeat(12), sourceRevision: "synthetic", dirty: false, capabilities: [], manifestFingerprint: "b".repeat(12) }, profileName: "preview", runtimeFingerprint: "synthetic-preview", dataRoot: { label: "合成数据", fingerprint: "synthetic" }, database: { exists: true, schemaVersion: 1, requiredSchemaVersion: 1, compatible: true }, process: { startedAt: now, pid: 0 }, provider: { profileId: "preview", modelId: "synthetic", reasoningPreset: "off", keyConfigured: false } });
  if (path === "/api/chat/provider-status") return json(provider);
  if (path === "/api/chat/provider-profiles") return json({ items: [{ profileId: "preview", providerId: "preview", displayName: "本地预览", protocol: "dry-run", enabled: true, external: false, keyConfigured: false, models: [{ modelId: "synthetic", displayName: "Synthetic", reasoningPresets: ["off"], defaultReasoningPreset: "off", reasoningFixed: true }] }] });
  if (path === "/api/chat/sessions") return json({ ok: true, sessions });
  if (/\/api\/chat\/sessions\/[^/]+\/messages$/.test(path)) { const id = path.split("/")[4]; return json({ sessionId: id, items: histories[id] ?? [], nextBefore: null }); }
  if (path === "/api/pkos/state-timeline") return json({ current: state, items: [state], count: 1, filters: {} });
  if (path === "/api/runtime/reminder-notifications") return json({ ok: true, generatedAt: now, evaluatedAt: now, count: 0, notifications: [] });
  if (path === "/api/pkos/object-types") return json({ ok: true, schemaVersion: "0.8-beta", types: ["fact", "skill", "claim", "creative"].map((type) => ({ type, editableFields: ["title", "content", "summary", "source", "anchors", "status"], requiredFields: ["title", "content"], statusEnum: type === "creative" ? ["draft", "revised", "archived"] : ["raw", "parsed", "challenged", "trusted", "deprecated"], fieldTypes: {}, srsEligible: type !== "creative", immutableFields: ["id", "type"], supportedSupplementarySections: [], objectId: { minLength: 3, maxLength: 64, pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$", humanReadablePattern: "lowercase object ID", example: `${type}.example`, prefixRequirement: "must_start_with_type_dot" } })) });
  if (path === "/api/pkos/objects") { const items = objects.filter((item) => !url.searchParams.get("type") || item.type === url.searchParams.get("type")); return json({ ok: true, schemaVersion: "0.8-beta", generatedAt: now, count: items.length, totalCount: items.length, filters: {}, source: {}, dataRootFingerprint: "synthetic", items: items.map((item) => ({ ...detail(item), ...item, updatedAt: now })) }); }
  if (path.startsWith("/api/pkos/objects/")) { const id = decodeURIComponent(path.split("/")[4]); const item = objects.find((entry) => entry.id === id); if (item) return json(path.endsWith("/render") ? { ok: true, schemaVersion: "0.8-beta", objectId: item.id, objectType: item.type, body: item.summary, sections: [], metadata: {}, fileRevisionSha256: sha, objectContentSha256: sha, dataRootFingerprint: "synthetic" } : detail(item)); }
  if (path === "/api/pkos/review/queue") return json({ ok: true, generatedAt: now, evaluatedAt: now, due: reviewItems, upcoming: [], counts: { due: 2, overdue: 0, upcoming: 0, legacyWarning: 0, contentChanged: 0, orphaned: 0 }, source: {} });
  if (/\/review\/items\/[^/]+\/history$/.test(path)) return json({ ok: true, objectId: decodeURIComponent(path.split("/")[5]), objectExists: true, events: [], count: 0 });
  if (path === "/api/pkos/inbox-review") return json({ items: [{ id: "inbox.preview", captureType: "idea", content: "如果每周留一点空白，是否能更认真地回看自己走过的路？", source: "desktop", tags: ["回顾", "灵感"], createdAt: now, effectiveStatus: "unprocessed", latestAction: null }], count: 1, generatedAt: now, filters: {} });
  if (path === "/api/pkos/tasks") return json({ ok: true, items: [{ id: "task.preview", title: "整理本周阅读笔记", description: "选一条值得留下的想法。", status: "todo", priority: "normal", source: "human", tags: ["阅读"], dueAt: now, createdAt: now, createdBy: "human", latestActionId: null, latestActionAt: null, latestReason: null, notesCount: 0, latestNoteAt: null }], count: 1, generatedAt: now, filters: {}, source: {} });
  if (path === "/api/pkos/reminders") return json({ ok: true, items: [{ id: "reminder.preview", title: "留一点时间，回看这一周", description: "周末的轻量回顾。", remindAt: now, taskId: null, source: "human", status: "scheduled", createdAt: now, createdBy: "human", latestActionId: null, latestActionAt: null, latestReason: null }], count: 1, generatedAt: now, filters: {}, source: {} });
  if (path === "/api/actions/requests") return json({ ok: true, requests: [action] });
  if (path === "/api/actions/requests/request.preview") return json({ ok: true, request: action });
  if (path === "/api/audit/events") return json({ items: [{ id: "audit.preview", ts: now, type: "generation_completed", severity: "info", payloadSummary: {} }], nextBefore: null });
  window.__previewUnexpected.push({ path, method });
  return json({ ok: false, error: { code: "preview_unmocked", message: "Unmocked preview request blocked" } }, 404);
};
