import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { OperationJournal } from "../app/deterministic-facts/operations.ts";
import { buildEvidenceRequestInput } from "../app/deterministic-facts/request-input.ts";
import { DeterministicFactsClient } from "../app/deterministic-facts/client.ts";

const reader = await import("../app/deterministic-facts/request-material.ts").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});

const base = "a".repeat(64), original = "b".repeat(64), replacement = "c".repeat(64);
const context = { workspaceId: "workspace", graphVersionId: base, tab: "objects", kind: "FACT", recordId: original };
const draft = { investigationId: "investigation", question: "Keep this question while correcting its material.", requestKind: "SUSPECTED_ERROR",
  requestedCapabilities: ["properties"], materialTargetId: replacement };
const verified = { workspaceId: context.workspaceId, graphVersionId: base, materialId: replacement };
const build = (proof = verified, location = context, input = draft) => buildEvidenceRequestInput(location, input, ["properties"], proof);

test("reselecting a currently verified material changes only target references, not the fixed baseline or other input", () => {
  const before = JSON.stringify({ context, draft });
  const value = build();
  assert.deepEqual(value.materialRefs, [replacement]); assert.deepEqual(value.factRefs, []);
  assert.equal(value.baseVersionId, base); assert.equal(value.investigationId, draft.investigationId);
  assert.equal(value.question, draft.question); assert.equal(value.requestKind, draft.requestKind);
  assert.deepEqual(value.requestedCapabilities, draft.requestedCapabilities);
  assert.equal(JSON.stringify({ context, draft }), before);
  // A valid replacement can also correct an original non-requestable OBJECT;
  // it never mutates the record being read or silently uses latest.
  assert.deepEqual(build(verified, { ...context, kind: "OBJECT" }).materialRefs, [replacement]);
});

test("saved material locators do not authorize requests without a fresh matching workspace and fixed-version read", () => {
  for (const proof of [null, { ...verified, workspaceId: "another" }, { ...verified, graphVersionId: "d".repeat(64) }, { ...verified, materialId: original }]) {
    assert.throws(() => build(proof), error => error.field === "target");
  }
  for (const materialTargetId of ["", "latest", "../private", "C".repeat(64)]) {
    assert.throws(() => build(verified, context, { ...draft, materialTargetId }), error => error.field === "target");
  }
  assert.throws(() => build(verified, { ...context, graphVersionId: "latest" }), error => error.field === "baseVersionId");
  const restoredOriginal = build(null, context, { ...draft, materialTargetId: undefined });
  assert.deepEqual(restoredOriginal.factRefs, [original]); assert.deepEqual(restoredOriginal.materialRefs, []);
});

test("material reselection persists only a strict locator in the exact member/version/reading draft context", () => {
  const rows = new Map(), storage = { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value) };
  const binding = { workspaceId: context.workspaceId, actorId: "owner", baseVersionId: base, targetRef: `FACT:${original}`, namespace: "request" };
  const journal = new OperationJournal(storage, binding);
  journal.saveDraft({ ...draft, materialRecord: { secret: "not retained" }, verifiedMaterial: verified });
  assert.deepEqual(journal.read().draft, draft);
  const raw = storage.getItem(journal.storageKey); assert.equal(raw.includes("not retained"), false); assert.equal(raw.includes("verifiedMaterial"), false);
  for (const patch of [{ actorId: "reader" }, { baseVersionId: "e".repeat(64) }, { targetRef: `MATERIAL:${original}` }]) {
    assert.deepEqual(new OperationJournal(storage, { ...binding, ...patch }).read().draft, {});
  }
  for (const materialTargetId of ["", "latest", "../private", 1, null]) assert.throws(() => journal.saveDraft({ ...draft, materialTargetId }));
  journal.saveDraft({ ...draft, materialTargetId: undefined });
  assert.equal(journal.read().draft.materialTargetId, undefined); assert.equal(journal.read().draft.question, draft.question);
});

const materialRecord = (id = replacement) => ({ kind: "MATERIAL", id, payload: { materialId: id, displayPath: "config/application.properties" } });
async function withResponse(body, run) {
  const originalFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, ...options }); return Response.json({ schemaVersion: 1, workspaceId: context.workspaceId, ...(typeof body === "function" ? body(calls) : body) }); };
  try { await run(new DeterministicFactsClient("http://127.0.0.1:6225", "owned-unit-token", context.workspaceId), calls); }
  finally { globalThis.fetch = originalFetch; }
}

test("material discovery and individual verification use only current-member GETs of the exact version, never original content", async () => {
  assert.equal(typeof reader.readRequestMaterialPage, "function", "fixed-version discovery must exist before it can authorize a choice");
  assert.equal(typeof reader.readRequestMaterial, "function");
  await withResponse(calls => ({ items: [materialRecord()], nextCursor: calls.length === 1 ? "owned/page+2" : null }), async (client, calls) => {
    assert.deepEqual(await reader.readRequestMaterialPage(client, verified), { items: [{ id: replacement, label: "config/application.properties" }], nextCursor: "owned/page+2" });
    await reader.readRequestMaterialPage(client, verified, "owned/page+2");
    for (const call of calls) { assert.equal(call.method, "GET"); assert.equal(call.cache, "no-store"); assert.equal(call.credentials, "same-origin"); assert.equal(new Headers(call.headers).has("authorization"), false); assert.equal(call.body, undefined); }
    assert.equal(new URL(calls[0].url).pathname.endsWith(`/versions/${base}/materials`), true);
    assert.equal(new URL(calls[0].url).searchParams.get("limit"), "20");
    assert.equal(new URL(calls[1].url).searchParams.get("cursor"), "owned/page+2");
  });
  await withResponse({ record: materialRecord(), references: [] }, async (client, calls) => {
    const result = await reader.readRequestMaterial(client, verified, replacement);
    assert.deepEqual(result, { id: replacement, label: "config/application.properties" });
    assert.equal(new URL(calls[0].url).pathname.endsWith(`/versions/${base}/records/MATERIAL/${replacement}`), true);
    assert.equal(calls.length, 1); assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].url.includes("/content"), false);
  });
});

test("material discovery rejects cross-workspace, non-material, duplicate, oversized or non-progressing pages instead of showing partial success", async () => {
  assert.equal(typeof reader.readRequestMaterialPage, "function");
  for (const response of [{ workspaceId: "another", items: [materialRecord()], nextCursor: null },
    { items: [{ ...materialRecord(), kind: "FACT" }], nextCursor: null },
    { items: [{ ...materialRecord(), payload: { materialId: original } }], nextCursor: null },
    { items: [materialRecord(), materialRecord()], nextCursor: null },
    { items: Array.from({ length: 21 }, () => materialRecord()), nextCursor: null },
    { items: [], nextCursor: "same" }, { items: [materialRecord()], nextCursor: 42 }]) {
    await withResponse(response, async client => { await assert.rejects(reader.readRequestMaterialPage(client, verified, "same")); });
  }
  await withResponse({ items: [], nextCursor: null }, async client => {
    assert.deepEqual(await reader.readRequestMaterialPage(client, verified), { items: [], nextCursor: null });
  });
});

test("individual material verification refuses mismatched records and an aborted member cannot revive a saved locator", async () => {
  assert.equal(typeof reader.readRequestMaterial, "function");
  for (const response of [{ workspaceId: "another", record: materialRecord() }, { record: materialRecord(original) },
    { record: { ...materialRecord(), kind: "FACT" } }]) await withResponse(response, async client => {
      await assert.rejects(reader.readRequestMaterial(client, verified, replacement));
    });
  await withResponse({ record: materialRecord() }, async (client, calls) => {
    const abort = new AbortController(); abort.abort();
    await assert.rejects(reader.readRequestMaterial(client.withSignal(abort.signal), verified, replacement)); assert.equal(calls.length, 0);
    for (const id of ["latest", "../x"]) await assert.rejects(reader.readRequestMaterial(client, verified, id));
    assert.equal(calls.length, 0);
  });
});

test("a material response arriving after member abort cannot become a verified replacement and403 remains an access failure", async () => {
  const originalFetch = globalThis.fetch, abort = new AbortController();
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  globalThis.fetch = async () => { entered(); await new Promise(resolve => { release = resolve; }); return Response.json({ schemaVersion: 1, workspaceId: context.workspaceId, record: materialRecord() }); };
  try {
    const request = reader.readRequestMaterial(new DeterministicFactsClient("http://127.0.0.1:6225", "owned-unit-token", context.workspaceId, abort.signal), verified, replacement);
    await started; abort.abort(); release(); await assert.rejects(request, error => error.name === "AbortError");
    globalThis.fetch = async () => Response.json({ schemaVersion: 1, error: { code: "F002_WORKSPACE_FORBIDDEN", message: "owned read forbidden" } }, { status: 403 });
    await assert.rejects(reader.readRequestMaterial(new DeterministicFactsClient("http://127.0.0.1:6225", "owned-unit-token", context.workspaceId), verified, replacement), error => error.status === 403 && error.code === "F002_WORKSPACE_FORBIDDEN");
  } finally { globalThis.fetch = originalFetch; }
});

test("the real form consumes only current-client verified replacement and mounts its fixed-version picker near target feedback", async () => {
  const component = await readFile(new URL("../app/deterministic-facts/request-panel.tsx", import.meta.url), "utf8");
  const picker = await readFile(new URL("../app/deterministic-facts/request-material-picker.tsx", import.meta.url), "utf8");
  assert.match(component, /material\?\.client === client && !client\.signal\?\.aborted \? material : null/);
  assert.match(component, /materialId=\{journal\.draft\.materialTargetId\}/); assert.match(component, /onChoose=\{id => saveDraft\(\{ materialTargetId: id \}\)\}/);
  assert.ok(component.indexOf("<RequestMaterialPicker") > component.indexOf('aria-label="当前固定取证目标"'));
  assert.ok(component.indexOf("<RequestMaterialPicker") < component.indexOf("<div className=\"f002-form-grid\"><label>请求类型"));
  assert.match(picker, /onVerified\(null\)/); assert.match(picker, /return \(\) => controller\.abort\(\)/);
  assert.match(picker, /page\?\.client === client && page\.query === query/); assert.match(picker, /selected\?\.client === client/);
  assert.equal(picker.includes('"POST"'), false); assert.equal(picker.includes("navigate("), false);
});

test("material browser verification is explicitly isolated and invoked after real connection and runtime ownership checks", async () => {
  const runner = await readFile(new URL("../../test/support/f002-interface-browser.mjs", import.meta.url), "utf8");
  const call = runner.indexOf("await verifyRequestMaterials(");
  assert.ok(call > runner.indexOf("await connect()")); assert.ok(call > runner.indexOf("report.runtimePreflight ="));
  assert.match(runner, /requestMaterials: mode === "--request-materials"/);
  assert.equal((runner.match(/await verifyRequestMaterials\(/g) ?? []).length, 1);
});
