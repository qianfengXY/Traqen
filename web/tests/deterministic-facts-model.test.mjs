import assert from "node:assert/strict";
import test from "node:test";
import { evidenceHref, readEvidenceLocation, evidenceReference, ReadFence, requestPresentation } from "../app/deterministic-facts/model.ts";
import * as model from "../app/deterministic-facts/model.ts";

const graphVersionId = "a".repeat(64), recordId = "b".repeat(64);
const traversalDefaults = { relationFilters: { query: "", predicate: "", source: "", target: "", path: "" }, relationScrollTop: 0,
  graphRootId: null, graphViewport: { zoom: 1, x: 0, y: 0 }, gapFilters: { query: "", code: "", origin: "", materialType: "", status: "" }, gapScrollTop: 0, expandedDirectory: [] };

test("F002 deep links preserve exact references, three distinct versions and a safe return context", () => {
  const context = { workspaceId: "workspace/one", graphVersionId, kind: "FACT", recordId, tab: "objects", line: 8,
    sourceVersionId: "c".repeat(64), businessGraphRevisionId: "business-revision-7",
    returnTo: { page: "graph", workspaceId: "workspace/one", objectId: "answer-2", graphRevisionId: "business-revision-7", scrollTop: 120, focusId: "answer-2" },
    apiToken: "MUST_NOT_PERSIST", sourceBytes: "MUST_NOT_PERSIST" };
  const href = evidenceHref(context);
  assert.equal(href.includes("MUST_NOT_PERSIST"), false);
  const { apiToken, sourceBytes, ...safeContext } = context;
  assert.deepEqual(readEvidenceLocation(href.split("?")[1]), safeContext);
  assert.equal(apiToken, sourceBytes);
  const ref = evidenceReference("workspace/one", graphVersionId, "FACT", recordId);
  assert.deepEqual(JSON.parse(ref), { workspaceId: "workspace/one", graphVersionId, factId: recordId });
  assert.deepEqual(JSON.parse(evidenceReference("w", graphVersionId, "MATERIAL", recordId)), { workspaceId: "w", graphVersionId, materialId: recordId });
});

test("F002 rejects incomplete, cross-kind or external return references instead of silently choosing latest", () => {
  assert.throws(() => evidenceReference("w", "", "FACT", recordId));
  assert.throws(() => evidenceHref({ workspaceId: "w", graphVersionId, kind: "FACT", recordId: "not-an-id", tab: "objects" }));
  assert.throws(() => evidenceHref({ workspaceId: "w", graphVersionId, tab: "objects", returnTo: { page: "https://attacker.test", workspaceId: "w" } }));
  assert.throws(() => readEvidenceLocation(`page=evidence&workspace=w&record=${recordId}&kind=FACT`));
});

test("F002 permission/version fences retire late reads and never reuse an aborted signal", () => {
  const fence = new ReadFence();
  const first = fence.begin("w:version1:member1");
  const second = fence.begin("w:version2:member1");
  assert.equal(first.signal.aborted, true);
  assert.equal(fence.accepts(first), false);
  assert.equal(fence.accepts(second), true);
  fence.clear();
  assert.equal(second.signal.aborted, true);
  assert.equal(fence.accepts(second), false);
  const third = fence.begin("w:version2:member1");
  assert.equal(third.signal.aborted, false);
});

test("F002 request status is separate from four outcomes and cannot turn task completion into success", () => {
  assert.equal(requestPresentation({ status: "QUEUED", outcome: null }).outcomeLabel, "尚无取证结果");
  assert.equal(requestPresentation({ status: "FAILED", outcome: null }).outcomeLabel, "尚无取证结果");
  assert.equal(requestPresentation({ status: "COMPLETED", outcome: "LIMITATION" }).outcomeLabel, "限制或未知");
  assert.equal(requestPresentation({ status: "COMPLETED", outcome: "REJECTED" }).outcomeLabel, "越权或版本不符");
  assert.equal(requestPresentation({ status: "COMPLETED", outcome: "NEW_VERSION" }).outcomeLabel, "独立新事实集");
  assert.equal(requestPresentation({ status: "COMPLETED", outcome: "EXISTING_EVIDENCE" }).outcomeLabel, "复用已有证据");
});

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), values };
}

function journal(storage, overrides = {}) {
  assert.equal(typeof model.OperationJournal, "function", "the UI needs a persistent, identity-bound journal before sending a mutation");
  return new model.OperationJournal(storage, { workspaceId: "w", actorId: "member-1", baseVersionId: graphVersionId, namespace: "request", ...overrides });
}

const pendingRequest = { operationId: "original-request", path: "/requests", purpose: "取证", body: {
  operationId: "original-request", investigationId: "investigation-1", baseVersionId: graphVersionId, requestKind: "LOOKUP", question: "Where?",
  materialRefs: [recordId], factRefs: [], requestedCapabilities: [] } };

test("F002 restores draft and unknown operation only within the exact member/version context", () => {
  const storage = memoryStorage(), first = journal(storage);
  first.saveDraft({ investigationId: "investigation-1", question: "Where?", apiToken: "DO_NOT_STORE", sourceBytes: "DO_NOT_STORE" });
  first.begin(pendingRequest);
  const encoded = storage.getItem(first.storageKey);
  assert.equal(encoded.includes("DO_NOT_STORE"), false, "journal stores only editable input and permitted metadata, never credentials or displayed bytes");
  const restored = journal(storage).read();
  assert.deepEqual(restored.draft, { investigationId: "investigation-1", question: "Where?" });
  assert.deepEqual(restored.pending, pendingRequest);
  assert.equal(journal(storage, { actorId: "member-2" }).read().pending, null);
  assert.equal(journal(storage, { baseVersionId: "c".repeat(64) }).read().pending, null);
  assert.equal(journal(storage, { targetRef: `FACT:${recordId}` }).read().pending, null);
  assert.deepEqual(journal(storage, { workRef: "another-session-contribution" }).read().draft, {}, "different originating work cannot inherit another contribution's input");
  assert.throws(() => first.begin({ ...pendingRequest, operationId: "duplicate" }), /未确认|pending/i);
});

test("F002 cannot dispatch when journal persistence failed or retained metadata is corrupt", () => {
  const storage = memoryStorage(), first = journal(storage);
  storage.setItem = () => { throw new Error("storage unavailable"); };
  assert.throws(() => first.begin(pendingRequest), /storage unavailable/);
  assert.equal(first.read().pending, null);
  const corrupt = memoryStorage(), second = journal(corrupt);
  corrupt.setItem(second.storageKey, "{invalid");
  assert.throws(() => second.read(), /恢复|corrupt|JSON/i, "a damaged unknown-operation record cannot become permission to submit again");
});

test("F002 operation reconciliation requires matching receipt and preserves unknown input", () => {
  const storage = memoryStorage(), first = journal(storage);
  first.saveDraft({ investigationId: "investigation-1", question: "Where?" }); first.begin(pendingRequest);
  assert.equal(first.resolve({ operationId: "other-operation", results: [{ kind: "REQUEST", value: { id: "r", operationId: "original-request", baseVersionId: graphVersionId } }] }), false);
  assert.equal(first.resolve({ operationId: "original-request", results: [] }), false);
  assert.equal(first.resolve({ operationId: "original-request", results: [{ kind: "REQUEST", value: { id: "r", operationId: "original-request", baseVersionId: "c".repeat(64) } }] }), false);
  assert.deepEqual(first.read().pending, pendingRequest);
  assert.equal(first.resolve({ operationId: "original-request", results: [{ kind: "REQUEST", value: { id: "r", operationId: "original-request", investigationId: "investigation-1", baseVersionId: graphVersionId } }] }), true);
  assert.equal(first.read().pending, null);
  assert.equal(first.read().draft.question, "Where?", "receipt reconciliation is not authority to discard the user's input");
});

test("F002 cancellation reconciliation matches cancellation key, not creation or terminal state", () => {
  const first = journal(memoryStorage());
  first.begin({ operationId: "original-cancel", path: "/requests/r/cancel", purpose: "取消取证", body: { operationId: "original-cancel", revision: 3 } });
  const response = cancelOperationId => ({ operationId: "original-cancel", results: [{ kind: "REQUEST", value: { id: "r", operationId: "original-request", cancelOperationId, baseVersionId: graphVersionId, status: "CANCELLED" } }] });
  assert.equal(first.resolve(response("somebody-elses-cancel")), false);
  assert.notEqual(first.read().pending, null);
  assert.equal(first.resolve(response("original-cancel")), true);
});

test("F002 scope reconciliation uses the exact immutable operation receipt, not current diagnostic", () => {
  const first = journal(memoryStorage(), { namespace: "delivery" });
  first.begin({ operationId: "original-retry", path: "/runs/run-1/retry", purpose: "范围重试", body: { operationId: "original-retry", scopeId: recordId, revision: 3 } });
  const receipt = { operationId: "original-retry", runId: "run-1", scopeId: recordId, eventType: "SCOPE_RETRY_QUEUED" };
  assert.equal(first.resolve({ operationId: "original-retry", results: [{ kind: "SCOPE_OPERATION", value: { ...receipt, scopeId: "c".repeat(64) } }] }), false);
  assert.equal(first.resolve({ operationId: "original-retry", results: [{ kind: "SCOPE_OPERATION", value: receipt }] }), true);
});

test("F002 view metadata survives tab/refresh without persisting credentials or display content", () => {
  assert.equal(typeof model.rememberEvidenceView, "function", "view recovery needs a bounded metadata store");
  assert.equal(typeof model.restoreEvidenceView, "function");
  const storage = memoryStorage(), context = { workspaceId: "w", actorId: "member-1", graphVersionId, authorized: true };
  model.rememberEvidenceView(storage, context, { query: "orders", directoryScrollTop: 123, readingLine: 401,
    sourceBytes: "NEVER_PERSIST", apiToken: "NEVER_PERSIST", returnedFacts: "NEVER_PERSIST" });
  assert.equal([...storage.values.values()].some(value => value.includes("NEVER_PERSIST")), false);
  assert.deepEqual(model.restoreEvidenceView(storage, context), { query: "orders", materialPathQuery: "", materialType: "", processingStatus: "", directoryScrollTop: 123, readingLine: 401, readingLineEnd: 401, readingWindowLine: 401, inspectorOpen: true, inspectorScrollTop: 0, ...traversalDefaults });
});

test("F002 cannot restore view metadata before current authorization or across identity/version", () => {
  assert.equal(typeof model.rememberEvidenceView, "function");
  const storage = memoryStorage(), context = { workspaceId: "w", actorId: "member-1", graphVersionId, authorized: true };
  model.rememberEvidenceView(storage, context, { query: "orders", directoryScrollTop: 123, readingLine: 401 });
  const empty = { query: "", materialPathQuery: "", materialType: "", processingStatus: "", directoryScrollTop: 0, readingLine: 1, readingLineEnd: 1, readingWindowLine: 1, inspectorOpen: true, inspectorScrollTop: 0, ...traversalDefaults };
  assert.deepEqual(model.restoreEvidenceView(storage, { ...context, authorized: false }), empty);
  assert.deepEqual(model.restoreEvidenceView(storage, { ...context, actorId: "member-2" }), empty);
  assert.deepEqual(model.restoreEvidenceView(storage, { ...context, graphVersionId: "c".repeat(64) }), empty);
  assert.throws(() => model.rememberEvidenceView(storage, context, { query: "orders", directoryScrollTop: Infinity, readingLine: 401 }));
  model.rememberEvidenceView(storage, { ...context, recordId }, { query: "orders", directoryScrollTop: 123, readingLine: 401 });
  assert.equal(model.restoreEvidenceView(storage, { ...context, recordId: "d".repeat(64) }).readingLine, 1, "another material cannot inherit the previous material's line anchor");
  const inaccessible = { getItem: () => { throw new Error("unauthorized metadata read"); } };
  assert.deepEqual(model.restoreEvidenceView(inaccessible, { ...context, authorized: false }), empty);
});

test("F002 code reader bounds rendered lines while retaining the exact physical line anchor", () => {
  assert.equal(typeof model.controlledTextWindow, "function", "the reader must not create a DOM row for every line in an 8 MiB material");
  const bytes = Buffer.from(Array.from({ length: 450 }, (_, index) => `line ${index + 1}`).join("\r\n"));
  const page = model.controlledTextWindow(bytes, 401, 200);
  assert.equal(page.totalLines, 450);
  assert.equal(page.startLine, 401);
  assert.equal(page.endLine, 450);
  assert.equal(page.previousLine, 201);
  assert.equal(page.nextLine, null);
  assert.equal(page.anchorPresent, true);
  assert.deepEqual(page.rows[0], { line: 401, text: "line 401", selected: true });
  assert.equal(page.rows.length, 50);
  assert.equal(bytes.toString().includes("line 1\r\n"), true, "paging does not mutate the approved byte buffer");
  const manyLines = model.controlledTextWindow(Buffer.from("x\n".repeat(100_000)), 99_901);
  assert.equal(manyLines.rows.length <= 200, true);
  assert.equal(manyLines.rows[0].line, 99_801);
});

test("F002 unavailable source line stays unavailable instead of silently selecting another range", () => {
  assert.equal(typeof model.controlledTextWindow, "function");
  const page = model.controlledTextWindow(Buffer.from("one\rtwo\nthree"), 999, 200);
  assert.equal(page.totalLines, 3);
  assert.equal(page.anchorPresent, false);
  assert.deepEqual(page.rows, []);
  assert.throws(() => model.controlledTextWindow(Buffer.from("text"), 0, 200));
  assert.throws(() => model.controlledTextWindow(Buffer.from("text"), 1, 10000));
});

test("F002 return navigation preserves exact entry/focus/position without redirect or version substitution", () => {
  assert.equal(typeof model.evidenceReturnHref, "function", "a generated return URL must have a matching typed consumer");
  assert.equal(typeof model.readEvidenceReturnLocation, "function");
  const back = { page: "graph", workspaceId: "w", objectId: "answer-2", graphRevisionId: "business-revision-7", section: "answer", scrollTop: 120, focusId: "answer-2" };
  const href = model.evidenceReturnHref({ workspaceId: "w", graphVersionId, tab: "objects", returnTo: { ...back, apiToken: "NEVER_PERSIST" } });
  assert.equal(href.includes("NEVER_PERSIST"), false);
  assert.deepEqual(model.readEvidenceReturnLocation(new URL(href, "http://localhost").search, "w"), back);
  assert.throws(() => model.readEvidenceReturnLocation(new URL(href, "http://localhost").search, "different-workspace"));
  assert.equal(model.evidenceReturnHref({ workspaceId: "w", graphVersionId, tab: "objects" }), null);
  assert.throws(() => model.evidenceReturnHref({ workspaceId: "w", graphVersionId, tab: "objects", returnTo: { page: "https://outside.test", workspaceId: "w" } }));
  assert.equal(model.readEvidenceReturnLocation("?page=graph&workspace=w", "w"), null);
  assert.throws(() => model.readEvidenceReturnLocation("?evidenceReturn=1&page=graph&workspace=w&scrollTop=NaN", "w"));
});

test("unsealed navigation round-trips explicit source/run/scope/revision without a formal factset", () => {
 const preview={runId:"owned-run",scopeId:"c".repeat(64),revision:3};
 const context={workspaceId:"workspace",tab:"relations",step:3,runId:preview.runId,preview,sourceVersionId:"b".repeat(64),kind:"FACT",recordId:"a".repeat(64)};
 const href=evidenceHref(context);assert.equal(new URL(href,"http://localhost").searchParams.has("factset"),false);
 assert.deepEqual(readEvidenceLocation(href.split("?")[1]),context);
 assert.throws(()=>evidenceHref({...context,graphVersionId:"d".repeat(64)}),/未封存/);
 assert.throws(()=>evidenceHref({...context,sourceVersionId:undefined}),/未封存/);
});
