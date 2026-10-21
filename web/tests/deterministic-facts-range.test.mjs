import assert from "node:assert/strict";
import test from "node:test";
import * as model from "../app/deterministic-facts/model.ts";
import * as reader from "../app/deterministic-facts/text-window.ts";

const graphVersionId = "a".repeat(64), recordId = "b".repeat(64);
const location = { workspaceId: "w", graphVersionId, kind: "MATERIAL", recordId, tab: "objects", line: 195, lineEnd: 205, windowLine: 201 };
const identity = { workspaceId: "w", actorId: "member", graphVersionId, recordId, recordKind: "MATERIAL", authorized: true };
const storage = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };

test("F002 physical ranges are bounded and ordered without silently replacing their endpoints", () => {
  assert.equal(typeof reader.boundedTextRange, "function");
  assert.deepEqual(reader.boundedTextRange(195, 205), { startLine: 195, endLine: 205 });
  assert.deepEqual(reader.boundedTextRange(401), { startLine: 401, endLine: 401 });
  for (const [start, end] of [[0, 1], [2, 1], [1, 10_000_001], [1.5, 2], [1, NaN]]) assert.throws(() => reader.boundedTextRange(start, end), /行|范围/);
});

test("F002 range deep links retain their exact selection and independent bounded page cursor", () => {
  assert.deepEqual(model.readEvidenceLocation(model.evidenceHref(location).split("?")[1]), location);
  const legacy = { ...location }; delete legacy.lineEnd; delete legacy.windowLine;
  assert.deepEqual(model.readEvidenceLocation(model.evidenceHref(legacy).split("?")[1]), legacy);
});

test("F002 malformed range links fail closed rather than selecting a different range", () => {
  for (const patch of [{ lineEnd: 194 }, { lineEnd: 0 }, { line: undefined }, { windowLine: 0 }, { windowLine: 1.5 }]) {
    assert.throws(() => model.evidenceHref({ ...location, ...patch }), /行|范围/);
  }
  for (const suffix of ["lineEnd=1", "line=3&lineEnd=2", "line=1&lineEnd=1e3", "line=1&windowLine=-1"]) {
    assert.throws(() => model.readEvidenceLocation(`workspace=w&tab=objects&factset=${graphVersionId}&kind=MATERIAL&record=${recordId}&${suffix}`), /行|范围/);
  }
});

test("F002 selected ranges span bounded physical-line windows without changing the selected endpoints", () => {
  const bytes = Buffer.from(Array.from({ length: 450 }, (_, index) => `line${index + 1}`).join("\r\n"));
  const selection = { startLine: 195, endLine: 205 };
  const first = model.controlledTextWindow(bytes, 195, 200, selection), second = model.controlledTextWindow(bytes, 201, 200, selection);
  assert.equal(first.selectionPresent, true); assert.equal(second.selectionPresent, true);
  assert.deepEqual(first.rows.filter(row => row.selected).map(row => row.line), [195, 196, 197, 198, 199, 200]);
  assert.deepEqual(second.rows.filter(row => row.selected).map(row => row.line), [201, 202, 203, 204, 205]);
  assert.equal(first.rows.length, 200); assert.equal(second.rows.length, 200);
  assert.deepEqual(selection, { startLine: 195, endLine: 205 });
});

test("F002 unavailable range endings remain unavailable without rendering an apparently valid partial selection", () => {
  const page = model.controlledTextWindow(Buffer.from("one\rtwo\nthree"), 1, 200, { startLine: 1, endLine: 4 });
  assert.equal(page.selectionPresent, false); assert.deepEqual(page.rows, []);
  assert.throws(() => model.controlledTextWindow(Buffer.from("one"), 1, 200, { startLine: 2, endLine: 1 }), /行|范围/);
});

test("F002 range and page metadata restore only after exact member version and typed-record authorization", () => {
  const saved = storage();
  model.rememberEvidenceView(saved, identity, { query: "", directoryScrollTop: 0, readingLine: 195, readingLineEnd: 205, readingWindowLine: 201, raw: "NEVER_STORE" });
  const restored = model.restoreEvidenceView(saved, identity);
  assert.deepEqual([restored.readingLine, restored.readingLineEnd, restored.readingWindowLine], [195, 205, 201]);
  assert.equal([...saved.values.values()].some(value => value.includes("NEVER_STORE")), false);
  for (const patch of [{ actorId: "other" }, { graphVersionId: "c".repeat(64) }, { recordKind: "OBJECT" }, { recordId: "d".repeat(64) }]) {
    const other = model.restoreEvidenceView(saved, { ...identity, ...patch });
    assert.deepEqual([other.readingLine, other.readingLineEnd, other.readingWindowLine], [1, 1, 1]);
  }
  assert.equal(model.restoreEvidenceView({ getItem: () => { throw new Error("unauthorized read"); } }, { ...identity, authorized: false }).readingLineEnd, 1);
});

test("F002 corrupt range metadata is rejected and safe legacy single-line preferences remain readable", () => {
  const saved = storage(), base = { query: "", directoryScrollTop: 0, readingLine: 195 };
  for (const patch of [{ readingLineEnd: 194 }, { readingLineEnd: null }, { readingWindowLine: 0 }, { readingWindowLine: 1.5 }]) {
    assert.throws(() => model.rememberEvidenceView(saved, identity, { ...base, ...patch }), /行|范围|阅读/);
  }
  model.rememberEvidenceView(saved, identity, base);
  const key = [...saved.values.keys()][0];
  saved.setItem(key, JSON.stringify({ schemaVersion: 1, ...base, recordId, recordKind: "MATERIAL" }));
  const restored = model.restoreEvidenceView(saved, identity);
  assert.deepEqual([restored.readingLine, restored.readingLineEnd, restored.readingWindowLine], [195, 195, 195]);
});
