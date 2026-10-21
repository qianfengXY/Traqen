import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as model from "../app/deterministic-facts/model.ts";

const base = "a".repeat(64), next = "b".repeat(64), fact = "c".repeat(64), material = "d".repeat(64), source = "e".repeat(64);
const context = { workspaceId: "w", graphVersionId: base, sourceVersionId: source, tab: "objects", kind: "MATERIAL", recordId: material, line: 17, lineEnd: 20, windowLine: 1,
  graphRootId: fact, relationReturn: { factId: fact, rootId: fact, scrollTop: 40 }, businessGraphRevisionId: "business-7",
  returnTo: { page: "graph", workspaceId: "w", objectId: "answer-2", graphRevisionId: "business-7", scrollTop: 200, focusId: "answer-2" } };
const receipt = (outcome, result, status = "COMPLETED") => ({ id: "request-1", operationId: "operation-1", investigationId: "investigation-1", baseVersionId: base, revision: 2, status, outcome, result, createdAt: "2026-10-14T00:00:00Z" });
function project(request, location = context) {
  assert.equal(typeof model.requestResultNavigation, "function", "authorized results need typed fixed-reference inspection actions, not a JSON-only dead end");
  return model.requestResultNavigation(request, location);
}
const parse = href => model.readEvidenceLocation(new URL(href, "http://localhost").search);

test("existing evidence links retain the result's exact base and return identity without stale source ranges", () => {
  const result = project(receipt("EXISTING_EVIDENCE", { baseVersionId: base, factRefs: [fact], materialRefs: [material] }));
  assert.equal(result.error, null); assert.equal(result.links.length, 2);
  assert.deepEqual(result.links.map(link => [parse(link.href).kind, parse(link.href).recordId]), [["FACT", fact], ["MATERIAL", material]]);
  for (const link of result.links) {
    const target = parse(link.href);
    assert.equal(target.graphVersionId, base); assert.equal(target.sourceVersionId, source);
    assert.deepEqual(target.returnTo, context.returnTo); assert.equal(target.businessGraphRevisionId, "business-7");
    for (const key of ["line", "lineEnd", "windowLine", "graphRootId", "relationReturn"]) assert.equal(target[key], undefined);
  }
  assert.match(result.explanation, /已有|业务|结论/);
});

test("new fact set inspection is explicit and cannot reuse the old record or announce upstream adoption", () => {
  const input = receipt("NEW_VERSION", { baseVersionId: base, graphVersionId: next, addedRefs: [{ kind: "FACT", id: fact }, { kind: "GAP", id: material }], correctedRefs: [] });
  const result = project(input);
  assert.equal(result.links.length, 3); assert.equal(result.error, null);
  const target = parse(result.links[0].href);
  assert.equal(target.graphVersionId, next); assert.equal(target.recordId, undefined); assert.equal(target.sourceVersionId, undefined);
  assert.deepEqual(target.returnTo, context.returnTo); assert.equal(target.businessGraphRevisionId, "business-7");
  assert.match(result.explanation, /原调查|采用|基准/);
  assert.equal(context.graphVersionId, base); assert.equal(input.baseVersionId, base);
  assert.deepEqual(result.links.slice(1).map(link => [parse(link.href).kind, parse(link.href).recordId]), [["FACT", fact], ["GAP", material]]);
});

test("limitations and rejection explain their boundary instead of manufacturing evidence or accepted versions", () => {
  for (const outcome of ["LIMITATION", "REJECTED"]) {
    const result = project(receipt(outcome, { code: "F002_CONSUMER_REJECTED", graphVersionId: next, factRefs: [fact] }));
    assert.deepEqual(result.links, []); assert.equal(result.error, null); assert.ok(result.explanation);
  }
});

test("pending failed unknown malformed and cross-baseline receipts cannot yield result links", () => {
  for (const status of ["QUEUED", "RUNNING", "FAILED", "CANCELLED"]) assert.deepEqual(project(receipt("NEW_VERSION", { graphVersionId: next }, status)).links, []);
  const invalid = [receipt("UNRECOGNIZED", {}), receipt("NEW_VERSION", { graphVersionId: "latest" }), receipt("NEW_VERSION", { graphVersionId: next, addedRefs: [{ kind: "FACT", id: "bad" }] }),
    receipt("EXISTING_EVIDENCE", { baseVersionId: next, factRefs: [fact], materialRefs: [] }), receipt("EXISTING_EVIDENCE", { baseVersionId: base, factRefs: ["bad"], materialRefs: [] }),
    { ...receipt("NEW_VERSION", { graphVersionId: next }), baseVersionId: next }, receipt("NEW_VERSION", null)];
  for (const input of invalid) { const result = project(input); assert.deepEqual(result.links, []); assert.ok(result.error); }
});

test("actual RequestPanel renders typed result actions without mounting a new consumer or auto-adopting them", async () => {
  const source = await readFile(new URL("../app/deterministic-facts/request-panel.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("requestResultNavigation("));
  assert.ok(source.includes("resultNavigation.links.map("));
  assert.ok(source.includes("href={link.href}"));
  assert.equal(source.includes("window.location ="), false);
});

test("large result projections remain bounded deduplicated and explicit about undisplayed references", () => {
  const refs = Array.from({ length: 205 }, (_, index) => ({ kind: "FACT", id: index.toString(16).padStart(64, "0") }));
  const result = project(receipt("NEW_VERSION", { graphVersionId: next, addedRefs: [...refs, refs[0]], correctedRefs: [refs[1]] }));
  assert.equal(result.error, null); assert.equal(result.links.length, 201); assert.match(result.explanation, /205.*200/);
  assert.equal(new Set(result.links.map(link => link.href)).size, result.links.length);
  const malformed = project(receipt("NEW_VERSION", { graphVersionId: next, addedRefs: [{ kind: "https://attacker.test", id: fact }] }));
  assert.deepEqual(malformed.links, []); assert.ok(malformed.error);
});

test("browser request checks run only after page fixture metadata and connected reader exist", async () => {
  const runner = await readFile(new URL("../../test/support/f002-interface-browser.mjs", import.meta.url), "utf8");
  const call = runner.indexOf("await verifyRequestResultNavigation(");
  assert.ok(call > runner.indexOf("page = await context.newPage()"));
  assert.ok(call > runner.indexOf("const meta = await metadata()"));
  assert.ok(call > runner.indexOf("await connect()"));
  assert.equal((runner.match(/await verifyRequestResultNavigation\(/g) ?? []).length, 1);
});

test("request display has its own current-access observation instead of relying only on Workspace polling", async () => {
  const source = await readFile(new URL("../app/deterministic-facts/request-panel.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("observeRequestAccess("), "a shown receipt must be re-read through its own authorizeRead contract");
  assert.ok(source.includes(".close()"), "request observation must retire reads when selection or member changes");
});
