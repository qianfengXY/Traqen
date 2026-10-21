import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { OperationJournal } from "../app/deterministic-facts/operations.ts";

const input = await import("../app/deterministic-facts/request-input.ts").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const base = "a".repeat(64), material = "b".repeat(64), fact = "c".repeat(64);
const context = { workspaceId: "w", tab: "objects", graphVersionId: base, kind: "MATERIAL", recordId: material };
const draft = { investigationId: "investigation-1", question: "核查显式声明，不改写事实。", requestKind: "SUSPECTED_OMISSION", requestedCapabilities: ["properties"] };
function build(patch = {}, location = context, capabilities = ["inventory", "properties"]) {
  assert.equal(typeof input.buildEvidenceRequestInput, "function", "request forms must project explicit purpose and capabilities into the existing contract");
  return input.buildEvidenceRequestInput(location, { ...draft, ...patch }, capabilities);
}
const storage = () => { const rows = new Map(); return { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value) }; };
const journalContext = { workspaceId: "w", actorId: "owner", baseVersionId: base, targetRef: `MATERIAL:${material}`, namespace: "request" };

test("three request purposes are explicit suspicions and retain the exact frozen target", () => {
  for (const requestKind of ["TARGETED_EVIDENCE", "SUSPECTED_OMISSION", "SUSPECTED_ERROR"]) {
    const body = build({ requestKind });
    assert.equal(body.requestKind, requestKind); assert.equal(body.baseVersionId, base);
    assert.deepEqual(body.materialRefs, [material]); assert.deepEqual(body.factRefs, []);
    assert.equal(body.question, draft.question); assert.equal(body.investigationId, draft.investigationId);
    for (const key of ["budget", "allowedCapabilities", "sourceBytes", "records", "accepted", "graphVersionId"]) assert.equal(body[key], undefined);
  }
});

test("a Fact target remains a Fact reference and never inherits a previous material", () => {
  const body = build({}, { ...context, kind: "FACT", recordId: fact });
  assert.deepEqual(body.factRefs, [fact]); assert.deepEqual(body.materialRefs, []);
});

test("missing fields unsupported purpose or unfixed targets fail before dispatch without changing inputs", () => {
  assert.equal(typeof input.buildEvidenceRequestInput, "function", "negative checks require an implemented input boundary, not an import failure");
  for (const patch of [{ investigationId: "" }, { question: "  \n " }, { requestKind: "CONFIRMED_CORRECTION" }]) assert.throws(() => build(patch));
  for (const location of [{ ...context, graphVersionId: "latest" }, { ...context, recordId: "short" }, { ...context, kind: "OBJECT" }]) assert.throws(() => build({}, location));
  assert.equal(draft.question, "核查显式声明，不改写事实。"); assert.equal(context.graphVersionId, base);
});

test("request input failures identify the exact editable field or frozen coordinate without changing the draft", () => {
  const cases = [
    ["investigationId", { investigationId: "" }, context],
    ["question", { question: " \n " }, context],
    ["baseVersionId", {}, { ...context, graphVersionId: "latest" }],
    ["target", {}, { ...context, kind: "OBJECT" }],
    ["requestKind", { requestKind: "CONFIRMED_CORRECTION" }, context],
    ["requestedCapabilities", { requestedCapabilities: ["not-installed"] }, context],
  ];
  for (const [field, patch, location] of cases) {
    const before = JSON.stringify({ draft, patch, location });
    assert.throws(() => build(patch, location), error => {
      assert.equal(error.field, field, "a generic caption cannot associate validation with the failing control");
      assert.equal(error.name, "RequestInputError"); assert.ok(error.message.length > 0);
      return true;
    });
    assert.equal(JSON.stringify({ draft, patch, location }), before);
  }
});

test("only an explicit missing-version rejection is assigned to the frozen baseline, never generic or authorization faults", () => {
  assert.equal(typeof input.requestRejectionField, "function");
  assert.equal(input.requestRejectionField("F002_VERSION_NOT_FOUND", 404), "baseVersionId");
  for (const [code, status] of [["F002_REQUEST_INVALID", 422], ["F002_CONSUMER_REJECTED", 403], ["F002_VERSION_NOT_FOUND", 403], ["F002_HTTP_ERROR", 404], ["F002_NETWORK_UNCONFIRMED", 0]]) {
    assert.equal(input.requestRejectionField(code, status), null);
  }
});

test("installed capability choices are bounded and do not claim investigation authorization", () => {
  assert.deepEqual(build({ requestedCapabilities: ["properties", "inventory", "properties"] }).requestedCapabilities, ["inventory", "properties"]);
  assert.deepEqual(build({ requestedCapabilities: [] }).requestedCapabilities, []);
  assert.throws(() => build({ requestedCapabilities: ["missing-capability"] }), /能力/);
  assert.throws(() => build({ requestedCapabilities: Array(65).fill("properties") }), /能力/);
});

test("request kind and capability draft restore only in the same authorized journal context", () => {
  const store = storage(), journal = new OperationJournal(store, journalContext);
  journal.saveDraft(draft);
  assert.deepEqual(new OperationJournal(store, journalContext).read().draft, draft);
  for (const patch of [{ actorId: "reader" }, { baseVersionId: "d".repeat(64) }, { targetRef: `FACT:${fact}` }]) {
    assert.deepEqual(new OperationJournal(store, { ...journalContext, ...patch }).read().draft, {});
  }
});

test("corrupt request options fail closed while older drafts keep the old default purpose", () => {
  for (const patch of [{ requestKind: "CONFIRMED_CORRECTION" }, { requestedCapabilities: [""] }, { requestedCapabilities: Array(65).fill("properties") }]) {
    assert.throws(() => new OperationJournal(storage(), journalContext).saveDraft({ ...draft, ...patch }));
  }
  const old = { investigationId: draft.investigationId, question: draft.question };
  const journal = new OperationJournal(storage(), journalContext); journal.saveDraft(old);
  assert.deepEqual(journal.read().draft, old);
  assert.equal(build({ ...old, requestKind: undefined, requestedCapabilities: undefined }).requestKind, "TARGETED_EVIDENCE");
});

test("actual form uses purpose capability and durable draft controls rather than hard-coded empty requests", async () => {
  const component = await readFile(new URL("../app/deterministic-facts/request-panel.tsx", import.meta.url), "utf8");
  assert.ok(component.includes("buildEvidenceRequestInput("));
  assert.ok(component.includes('aria-label="取证请求类型"')); assert.ok(component.includes('aria-label="请求的已安装能力"'));
  assert.equal(component.includes('requestKind: "TARGETED_EVIDENCE", question'), false);
  assert.ok(component.includes("body: { operationId, ...requestInput.value! }"), "the payload must consume the projected capability selection; an explicit clear-draft button is allowed");
  assert.ok(component.includes("saveDraft({ requestKind:")); assert.ok(component.includes("saveDraft({ requestedCapabilities:"));
});

test("form browser mode enters its own checks only after the actual connected fixture", async () => {
  const runner = await readFile(new URL("../../test/support/f002-interface-browser.mjs", import.meta.url), "utf8");
  const call = runner.indexOf("await verifyRequestForm(");
  assert.ok(call > runner.indexOf("page = await context.newPage()"));
  assert.ok(call > runner.indexOf("const meta = await metadata()"));
  assert.ok(call > runner.indexOf("await connect()"));
  assert.equal((runner.match(/await verifyRequestForm\(/g) ?? []).length, 1);
  assert.ok(runner.includes('else if (mode === "--request-form")'));
});
