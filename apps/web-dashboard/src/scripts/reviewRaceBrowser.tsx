import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReviewPage } from "../pages/ReviewPage.js";
import { ObjectsPage } from "../pages/ObjectsPage.js";
import { LanguageSwitch, LocaleProvider } from "../i18n/Locale.js";

type Pending = { path: string; body?: Record<string, unknown>; resolve: (value: unknown) => void };
const pending: Pending[] = [];
const nativeFetch = window.fetch.bind(window);
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const item = (objectId: string) => ({ objectId, objectType: "fact", title: objectId, status: "trusted", dueAt: "2026-01-01T00:00:00Z", lastReviewedAt: "", repetitions: 0, intervalDays: 1, easeFactor: 2.5, contentChangedSinceLastReview: false, legacyWarning: null, overdueDays: 1 });
const queue = { ok: true, generatedAt: "now", evaluatedAt: "now", due: [item("fact.A"), item("fact.B")], upcoming: [], counts: { due: 2, overdue: 2, upcoming: 0, legacyWarning: 0, contentChanged: 0, orphaned: 0 }, source: {} };
const history = (id: string) => ({ ok: true, objectId: id, objectExists: true, events: [{ type: "review_rating", id: `rating-${id}`, objectId: id, rating: 4 }], count: 1 });
const answer = (id: string) => ({ ok: true, schemaVersion: "0.8-beta", objectId: id, objectType: "fact", body: `answer-${id}`, sections: [], metadata: {}, fileRevisionSha256: "a".repeat(64), objectContentSha256: "b".repeat(64), dataRootFingerprint: "test" });
const objectContract = {
  ok: true, schemaVersion: "0.8-beta", types: [{ type: "fact", editableFields: ["title", "content", "summary", "source", "anchors", "status"], requiredFields: ["title", "content"], statusEnum: ["parsed"], fieldTypes: {}, srsEligible: true, immutableFields: ["id", "type"], supportedSupplementarySections: [],
    objectId: { minLength: 3, maxLength: 64, pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$", humanReadablePattern: "lowercase object ID", example: "fact.example", prefixRequirement: "must_start_with_type_dot" },
  }],
};
const objectDetail = (id: string) => ({ ok: true, schemaVersion: "0.8-beta", object: { id, type: "fact", status: "parsed", title: id, summary: "", content: `content-${id}`, source: [], anchors: [] }, location: `objects/fact/${id}.yaml`, fileRevisionSha256: "a".repeat(64), objectContentSha256: "b".repeat(64), srsEligible: true, contentChangedSinceLastReview: false, reviewSummary: null, editableFields: ["title", "content", "summary", "source", "anchors", "status"], immutableFields: ["id", "type"], additionalFields: [], dataRootFingerprint: "test" });
const objectList = { ok: true, schemaVersion: "0.8-beta", generatedAt: "now", count: 2, totalCount: 2, filters: {}, source: {}, dataRootFingerprint: "test", items: ["fact.a", "fact.b"].map((id) => ({ ...objectDetail(id), id, type: "fact", title: id, summary: "", status: "parsed", updatedAt: "2026-01-01T00:00:00Z" })) };
const preflight = (id: string) => ({ ...answer(id), reviewEventCount: 0, objectReferences: [], publishReferences: [], taskReferences: [], reminderReferences: [], digestReferences: [], tombstoneExists: false, blockers: [], warnings: [], referenceCoverage: [], canDelete: true });
const json = (payload: unknown) => new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.includes("/review/queue")) return json(queue);
  if (path === "/api/pkos/object-types") return json(objectContract);
  if (path.startsWith("/api/pkos/objects?") && !init?.body) return json(objectList);
  return new Promise<Response>((resolve) => pending.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined, resolve: (value) => resolve(json(value)) }));
};

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === text || ((node.className.includes("queue-button") || node.className.includes("object-list-item")) && node.textContent?.startsWith(text)));
  check(found, `button not found: ${text}`);
  return found;
}
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
async function click(text: string) { await act(async () => button(text).click()); await settle(); }
async function reply(path: string, payload: unknown, newest = false) {
  const index = newest ? pending.map((request) => request.path).lastIndexOf(path) : pending.findIndex((request) => request.path === path);
  check(index >= 0, `pending request not found: ${path}`);
  const [request] = pending.splice(index, 1);
  await act(async () => request.resolve(payload));
  await settle();
}
async function mount(objects = false): Promise<Root> {
  pending.length = 0;
  const root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<LocaleProvider initialLocale="en"><LanguageSwitch />{objects ? <ObjectsPage /> : <ReviewPage />}</LocaleProvider>));
  for (let i = 0; i < 30 && !(objects ? document.querySelector(".object-list-item") : pending.some((request) => request.path.endsWith("fact.A/history"))); i += 1) await settle();
  return root;
}
const tests: Array<[string, () => Promise<void>]> = [
  ["locale switch translates review controls without changing selection", async () => {
    await reply("/api/pkos/review/items/fact.A/history", history("fact.A"));
    await click("中文");
    check(document.documentElement.lang === "zh-CN", "Chinese document language was not applied");
    check(!button("显示答案").disabled, "Chinese reveal action is missing");
    check(document.querySelector(".review-card h3")?.textContent === "fact.A", "locale switch changed the selected object");
    await click("EN");
    check(!button("Show answer").disabled, "English reveal action was not restored");
    check(!button("Undo last rating").disabled, "locale switch reset the loaded history");
  }],
  ["selection disables Undo until matching history loads", async () => {
    await reply("/api/pkos/review/items/fact.A/history", history("fact.A"));
    check(!button("Undo last rating").disabled, "A undo should be ready");
    await click("fact.B");
    check(button("Undo last rating").disabled, "B can undo A's rating while B history is pending");
    await click("Undo last rating");
    check(!pending.some((request) => request.body), "stale correction was submitted");
    await reply("/api/pkos/review/items/fact.B/history", history("fact.B"));
    await click("Undo last rating");
    check(pending.find((request) => request.body)?.body?.targetEventId === "rating-fact.B", "Undo did not target B");
  }],
  ["late history and answer responses cannot replace B's data", async () => {
    await click("Show answer");
    await click("fact.B");
    await reply("/api/pkos/review/items/fact.B/history", history("fact.B"));
    await click("Show answer");
    await reply("/api/pkos/objects/fact.B/render", answer("fact.B"));
    await reply("/api/pkos/review/items/fact.A/history", history("fact.A"));
    await reply("/api/pkos/objects/fact.A/render", answer("fact.A"));
    check(document.querySelector(".review-content")?.textContent === "answer-fact.B", "A answer replaced B answer");
    await click("Undo last rating");
    check(pending.find((request) => request.body)?.body?.targetEventId === "rating-fact.B", "late A history enabled wrong Undo");
  }],
  ["late A answer cannot enable B grading before B answer loads", async () => {
    await click("Show answer");
    await click("fact.B");
    await reply("/api/pkos/objects/fact.A/render", answer("fact.A"));
    check([...document.querySelectorAll<HTMLButtonElement>(".rating-row button")].every((node) => node.disabled), "A answer enabled grading B");
    check(button("Submit rating").disabled, "submit enabled before B answer");
  }],
  ["returning to A still ignores responses from its previous selection", async () => {
    await click("fact.B");
    await click("fact.A");
    const latest = history("fact.A");
    latest.events[0].id = "rating-A-new";
    await reply("/api/pkos/review/items/fact.A/history", latest, true);
    await reply("/api/pkos/review/items/fact.A/history", history("fact.A"));
    await click("Undo last rating");
    check(pending.find((request) => request.body)?.body?.targetEventId === "rating-A-new", "old A response replaced the new selection's history");
  }],
  ["late rating completion cannot replace B's request state", async () => {
    await click("Show answer");
    await reply("/api/pkos/objects/fact.A/render", answer("fact.A"));
    await act(async () => document.querySelectorAll<HTMLButtonElement>(".rating-row button")[3].click());
    await click("Submit rating");
    const requestId = pending.find((request) => request.body)?.body?.requestId;
    check(requestId, "rating did not submit");
    await click("fact.B");
    await reply("/api/pkos/review/ratings", { ok: true, requestId, replayed: false, result: { status: "written", operation: "pkos.review.rating" } });
    check(document.querySelector(".attempt-row .badge")?.textContent === "draft", "A completion replaced B request state");
    check(!pending.some((request) => request.path === "/api/pkos/review/items/fact.A"), "A completion continued stale follow-up reads");
  }],
  ["late correction completion cannot replace B's request state", async () => {
    await reply("/api/pkos/review/items/fact.A/history", history("fact.A"));
    await click("Undo last rating");
    const requestId = pending.find((request) => request.body)?.body?.requestId;
    check(requestId, "correction did not submit");
    await click("fact.B");
    await reply("/api/pkos/review/corrections", { ok: true, requestId, replayed: false, result: { status: "written", operation: "pkos.review.correction" } });
    check(!document.body.textContent?.includes("correction: written"), "A correction replaced B state");
    await reply("/api/pkos/review/items/fact.B/history", history("fact.B"));
    await click("Undo last rating");
    check(pending.find((request) => request.body)?.body?.targetEventId === "rating-fact.B", "B reused A correction payload");
  }],
];

async function loadObject(id: string) {
  await click(id);
  await reply(`/api/pkos/objects/${id}`, objectDetail(id));
  await reply(`/api/pkos/objects/${id}/render`, answer(id));
}
async function fill(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  check(input, `input not found: ${selector}`);
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function prepareDelete(id: string) {
  await click("Run delete preflight");
  await reply(`/api/pkos/objects/${id}/delete-preflight`, preflight(id));
  await fill(".delete-box input", id);
  await fill(".delete-box textarea", "test deletion");
}
function assertSelectedB() {
  check(document.querySelector(".object-list-item.active")?.textContent?.startsWith("fact.b"), "B lost its selected highlight");
  check(document.querySelector(".object-detail dd")?.textContent === "fact.b", "A detail replaced B");
  check(document.querySelector(".object-detail .review-content")?.textContent === "answer-fact.b", "A render replaced B");
}
const objectTests: typeof tests = [
  ["Objects: collapsed creation preserves drafts and delays pristine errors", async () => {
    const create = document.querySelector<HTMLDetailsElement>(".object-create");
    check(create && !create.open, "creation is not collapsed by default");
    const input = create.querySelector<HTMLInputElement>("input");
    check(input && input.value === "", "collapsed creation form is not mounted");
    check(input.getAttribute("aria-invalid") === "false", "pristine ID is marked invalid");
    check(!create.querySelector(".id-inline-error, .id-length-counter.warn"), "pristine ID shows a warning");
    check(button("Create object").disabled, "empty ID can submit");
    await act(async () => create.querySelector("summary")!.click());
    await fill(".object-create input", "f");
    check(input.getAttribute("aria-invalid") === "true", "invalid typed ID is not marked invalid");
    check(create.querySelector(".id-inline-error"), "invalid typed ID has no warning");
    check(button("Create object").disabled, "invalid typed ID can submit");
    await act(async () => create.querySelector("summary")!.click());
    check(!create.open, "creation did not collapse");
    await act(async () => create.querySelector("summary")!.click());
    check(create.querySelector<HTMLInputElement>("input")?.value === "f", "collapsing creation lost its draft");
    await loadObject("fact.a");
    const technical = document.querySelector<HTMLDetailsElement>(".object-technical");
    check(technical && !technical.open && technical.querySelector(".readonly-json"), "technical metadata is not collapsed and mounted");
    check(!button("Run delete preflight").closest("details"), "delete controls were hidden inside a disclosure");
  }],
  ["Objects: locale switch preserves edits and raw object identifiers", async () => {
    await loadObject("fact.a");
    await fill(".object-detail .form-panel input", "An untranslated user title");
    await click("中文");
    check(!button("保存更改").disabled, "Chinese save action is missing");
    check(document.querySelector<HTMLInputElement>(".object-detail .form-panel input")?.value === "An untranslated user title", "locale switch modified the draft");
    check(document.querySelector(".object-detail dd")?.textContent === "fact.a", "locale switch translated the raw object ID");
    await click("EN");
    check(!button("Save changes").disabled, "English save action was not restored");
  }],
  ["Objects: switching clears edit/render/delete state before B loads", async () => {
    await loadObject("fact.a");
    await fill(".object-detail .form-panel input", "edited A");
    await prepareDelete("fact.a");
    check(!button("Permanent delete").disabled, "A delete should be enabled before switching");
    const oldSave = button("Save changes");
    const oldDelete = button("Permanent delete");
    await act(async () => {
      button("fact.b").click();
      oldSave.click();
      oldDelete.click();
    });
    await settle();
    check(!pending.some((request) => request.body), "an old A handler submitted a write after selection changed");
    check(!document.querySelector(".object-detail input"), "A editor remains active while B loads");
    check(!document.querySelector(".delete-box"), "A deletion controls remain active while B loads");
    check(!document.querySelector(".object-detail .review-content")?.textContent, "A render remains visible while B loads");
    check(![...document.querySelectorAll<HTMLButtonElement>(".object-detail button")].some((node) => !node.disabled), "A save/delete can be submitted while B loads");
    await reply("/api/pkos/objects/fact.b", objectDetail("fact.b"));
    check(document.querySelector<HTMLInputElement>(".object-detail .form-panel input")?.value === "fact.b", "A edit patch leaked to B");
  }],
  ["Objects: late A detail cannot replace B or launch stale render", async () => {
    await click("fact.a");
    await loadObject("fact.b");
    await reply("/api/pkos/objects/fact.a", objectDetail("fact.a"));
    assertSelectedB();
    check(!pending.some((request) => request.path === "/api/pkos/objects/fact.a/render"), "stale A detail launched a render request");
  }],
  ["Objects: late A render cannot replace B", async () => {
    await click("fact.a");
    await reply("/api/pkos/objects/fact.a", objectDetail("fact.a"));
    await loadObject("fact.b");
    await reply("/api/pkos/objects/fact.a/render", answer("fact.a"));
    assertSelectedB();
  }],
  ["Objects: late A preflight cannot authorize B deletion", async () => {
    await loadObject("fact.a");
    await click("Run delete preflight");
    await loadObject("fact.b");
    await reply("/api/pkos/objects/fact.a/delete-preflight", preflight("fact.a"));
    check(!document.querySelector(".delete-box"), "A preflight enabled deletion controls for B");
    assertSelectedB();
  }],
  ["Objects: mismatched server detail cannot become an editable selection", async () => {
    await click("fact.b");
    await reply("/api/pkos/objects/fact.b", objectDetail("fact.a"));
    check(!document.querySelector(".object-detail input"), "mismatched detail was editable");
  }],
  ["Objects: returning to A rejects its earlier detail request", async () => {
    await click("fact.a");
    await loadObject("fact.b");
    await click("fact.a");
    const latest = objectDetail("fact.a");
    latest.object.title = "latest A";
    await reply("/api/pkos/objects/fact.a", latest, true);
    await reply("/api/pkos/objects/fact.a/render", answer("fact.a"));
    await reply("/api/pkos/objects/fact.a", objectDetail("fact.a"));
    check(document.querySelector<HTMLInputElement>(".object-detail .form-panel input")?.value === "latest A", "earlier A detail replaced its new selection");
  }],
  ["Objects: preflight must match both selected ID and revision", async () => {
    await loadObject("fact.b");
    await click("Run delete preflight");
    await reply("/api/pkos/objects/fact.b/delete-preflight", preflight("fact.a"));
    check(!document.querySelector(".delete-box"), "mismatched preflight ID enabled delete");
    await click("Run delete preflight");
    await reply("/api/pkos/objects/fact.b/delete-preflight", { ...preflight("fact.b"), fileRevisionSha256: "c".repeat(64) });
    check(!document.querySelector(".delete-box"), "mismatched preflight revision enabled delete");
  }],
  ["Objects: a stale update completion cannot switch back to A", async () => {
    await loadObject("fact.a");
    await fill(".object-detail .form-panel input", "updated A");
    await click("Save changes");
    const requestId = pending.find((request) => request.body)?.body?.requestId;
    check(requestId, "A update was not submitted");
    await loadObject("fact.b");
    await reply("/api/pkos/objects/fact.a", { ok: true, requestId, replayed: false, result: { status: "written", operation: "pkos.object.update" } });
    assertSelectedB();
    check(document.querySelector(".object-detail .attempt-row .badge")?.textContent === "draft", "A completion changed B's request state");
    check(!pending.some((request) => request.path === "/api/pkos/objects/fact.a"), "A update launched stale detail reload");
  }],
  ["Objects: a stale delete completion cannot clear B", async () => {
    await loadObject("fact.a");
    await prepareDelete("fact.a");
    await click("Permanent delete");
    const requestId = pending.find((request) => request.body)?.body?.requestId;
    check(requestId, "A delete was not submitted");
    await loadObject("fact.b");
    await reply("/api/pkos/objects/fact.a/delete", { ok: true, requestId, replayed: false, result: { status: "written", operation: "pkos.object.delete" } });
    assertSelectedB();
  }],
  ["Objects: a stale create completion cannot change selection", async () => {
    await loadObject("fact.a");
    await act(async () => document.querySelector<HTMLElement>(".object-create > summary")!.click());
    await fill(".objects-page > .panel:nth-child(2) input", "fact.created");
    await fill(".objects-page > .panel:nth-child(2) label:nth-of-type(4) input", "Created title");
    await fill(".objects-page > .panel:nth-child(2) textarea[rows='6']", "Created content");
    check(!button("Create object").disabled, "create form was not valid");
    await click("Create object");
    const requestId = pending.find((request) => request.body)?.body?.requestId;
    check(requestId, "create was not submitted");
    await loadObject("fact.b");
    await reply("/api/pkos/objects", { ok: true, requestId, replayed: false, result: { status: "written", operation: "pkos.object.create" } });
    assertSelectedB();
    check(!pending.some((request) => request.path === "/api/pkos/objects/fact.created"), "stale create launched a detail load");
  }],
  ["Objects: selected update still refreshes and loads its new detail", async () => {
    await loadObject("fact.a");
    await fill(".object-detail .form-panel input", "updated A");
    await click("Save changes");
    const requestId = pending.find((request) => request.body)?.body?.requestId;
    await reply("/api/pkos/objects/fact.a", { ok: true, requestId, replayed: false, result: { status: "written", operation: "pkos.object.update" } });
    const updated = objectDetail("fact.a");
    updated.object.title = "updated A";
    await reply("/api/pkos/objects/fact.a", updated);
    await reply("/api/pkos/objects/fact.a/render", answer("fact.a"));
    check(document.querySelector<HTMLInputElement>(".object-detail .form-panel input")?.value === "updated A", "selected update did not reload successfully");
  }],
];

const results: Array<{ name: string; ok: boolean; error?: string }> = [];
for (const [name, run] of [...tests, ...objectTests]) {
  const root = await mount(name.startsWith("Objects:"));
  try { await run(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error: String(error) }); }
  finally { await act(async () => root.unmount()); }
}
await nativeFetch("/result", { method: "POST", body: JSON.stringify(results) });
