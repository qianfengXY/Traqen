import assert from "node:assert/strict";
import test from "node:test";
import * as model from "../app/deterministic-facts/model.ts";

const id = char => char.repeat(64);
const context = { workspaceId: "workspace", graphVersionId: id("a"), sourceVersionId: id("b"), kind: "FACT", recordId: id("c"), tab: "relations" };
const subject = { kind: "OBJECT", id: id("d"), role: "subject", payload: { kind: "FUNCTION", name: "cancel", materialId: id("e") } };
const target = { kind: "OBJECT", id: id("f"), role: "target", payload: { kind: "FUNCTION", name: "save", materialId: id("e") } };
const evidence = { kind: "EVIDENCE", id: id("1"), role: "evidence", payload: { materialId: id("e"), contentDigest: id("2"),
  anchor: { kind: "TEXT", byteStart: 57, byteEnd: 92, lineStart: 3, lineEnd: 3, columnStart: 3, columnEnd: 35 } } };
const detail = () => ({ record: { kind: "FACT", id: id("c"), payload: { kind: "RELATION", predicate: "staticCalls", subjectId: subject.id, targetId: target.id,
  basis: "DERIVED", evidenceIds: [evidence.id], premiseFactIds: [id("3"), id("4")], ruleRef: { id: "f002-javascript", version: "2" }, ignoredSecret: "DO_NOT_PROJECT" } }, references: [subject, target, evidence,
  { kind: "FACT", id: id("3"), role: "premise", payload: { kind: "PROPERTY", predicate: "name", subjectId: target.id, value: { datatype: "string", value: "save" } } }] });
const manifest = () => ({ graphVersionId: id("a"), bundleId: id("b"), profileId: id("5"), scopeId: id("6"),
  scope: { status: "SEALED", selections: [{ kind: "COMPONENT", componentId: id("7") }] }, rules: { profileId: id("5"), ruleVersions: ["javascript@2"] },
  vocabulary: { predicates: [{ predicate: "staticCalls", meaning: "静态且词法可解析的直接调用；不证明实际执行。" }], prohibitions: ["没有事实或 Gap 不等于完备。"] } });
function explain(overrides = {}) {
  assert.equal(typeof model.explainEvidenceRecord, "function", "the Inspector needs a metadata-only shared explanation model");
  return model.explainEvidenceRecord({ context, detail: detail(), manifest: manifest(), gapPage: { items: [], nextCursor: null }, coverage: null, ...overrides });
}

test("F002 Inspector explains a typed relation from the actual subject target and version-bound vocabulary", () => {
  const result = explain();
  assert.equal(result.formLabel, "关系事实"); assert.equal(result.basisLabel, "规则派生 · DERIVED");
  assert.match(result.statement, /cancel.*staticCalls.*save/);
  assert.equal(result.meaning, manifest().vocabulary.predicates[0].meaning);
  assert.equal(result.scopeId, id("6")); assert.equal(result.sourceVersionId, id("b"));
  assert.equal(JSON.stringify(result).includes("DO_NOT_PROJECT"), false, "the presentation must not traverse arbitrary payload fields");
});

test("F002 Inspector preserves rule identity and distinguishes loaded missing and absent premises", () => {
  const result = explain();
  assert.deepEqual(result.rule, { id: "f002-javascript", version: "2", declared: true });
  assert.deepEqual(result.premiseIds, [id("3"), id("4")]); assert.deepEqual(result.loadedPremiseIds, [id("3")]); assert.deepEqual(result.missingPremiseIds, [id("4")]);
  const absent = detail(); absent.record.payload.premiseFactIds = []; absent.references = absent.references.filter(ref => ref.role !== "premise");
  assert.match(explain({ detail: absent }).premiseNotice, /未列出.*不表示|未列出.*不能/);
});

test("F002 Inspector describes physical source anchors without inventing byte-to-line or image-region coordinates", () => {
  const result = explain();
  assert.match(result.locations[0].description, /第 3.*UTF-8.*57.*92/);
  const image = detail(); image.references = [{ ...evidence, payload: { ...evidence.payload, anchor: { kind: "IMAGE", digest: id("2"), width: 3, height: 2 } } }];
  assert.match(explain({ detail: image }).locations[0].description, /3.*2/);
  assert.equal(explain({ detail: image }).locations[0].description.includes("第 1 行"), false);
});

test("F002 no-Fact material explanation does not manufacture a Fact rule or completed extraction", () => {
  const material = { kind: "MATERIAL", id: id("e"), payload: { kind: "PROPERTIES", displayPath: "app.properties", rootObjectId: id("d"), contentAvailable: true } };
  const result = explain({ detail: { record: material, references: [] }, context: { ...context, kind: "MATERIAL", recordId: material.id } });
  assert.equal(result.formLabel, "材料记录"); assert.equal(result.rule, null); assert.match(result.statement, /材料.*不要求.*Fact/);
  assert.match(result.processingNotice, /尚未确认|未载入/);
  assert.deepEqual(result.processing, []);
});

test("F002 Inspector rejects stale manifest semantics and keeps missing metadata explicitly unconfirmed", () => {
  const stale = manifest(); stale.graphVersionId = id("9"); stale.vocabulary.predicates[0].meaning = "STALE_SEMANTICS";
  const result = explain({ manifest: stale });
  assert.equal(result.meaning, null); assert.equal(result.scopeId, null); assert.equal(result.rule.declared, false);
  assert.match(result.contextNotice, /不一致|未确认/); assert.equal(JSON.stringify(result).includes("STALE_SEMANTICS"), false);
  const missing = explain({ manifest: null, gapPage: null }); assert.match(missing.contextNotice, /未载入|未确认/); assert.match(missing.gapNotice, /未载入|未确认/);
});

test("F002 Inspector only associates actual object or material Gaps and discloses partial pages", () => {
  const gaps = [
    { kind: "GAP", id: id("8"), payload: { materialId: id("e"), objectId: subject.id, origin: "F002", capability: "express", code: "EXPRESS_ROUTE_DYNAMIC" } },
    { kind: "GAP", id: id("9"), payload: { materialId: id("e"), origin: "F001", capability: "source", code: "GIT_LFS_EXTERNAL", reason: { sourceGapId: id("0"), category: "INHERITED_SOURCE_GAP" } } },
    { kind: "GAP", id: id("0"), payload: { materialId: id("9"), origin: "F002", code: "UNRELATED" } },
  ];
  const result = explain({ gapPage: { items: gaps, nextCursor: "next-page" } });
  assert.deepEqual(result.relatedGaps.map(item => item.id), [id("8"), id("9")]);
  assert.equal(result.relatedGaps[0].relation, "对象关联"); assert.equal(result.relatedGaps[1].relation, "同材料限制");
  assert.match(result.gapNotice, /当前页|当前加载页/); assert.ok(result.limits.some(text => /Gap.*不|不.*Gap/.test(text)));
});

test("F002 Gap explanation separates inherited source origin actual cause and non-mutating next steps", () => {
  const record = { kind: "GAP", id: id("8"), payload: { materialId: id("e"), origin: "F001", code: "GIT_LFS_EXTERNAL", capability: "source",
    reason: { category: "INHERITED_SOURCE_GAP", sourceGapId: id("9"), affectedScope: "external-content" } } };
  const result = explain({ detail: { record, references: [] }, context: { ...context, kind: "GAP", recordId: record.id } });
  assert.equal(result.gap.originLabel, "F001 继承限制"); assert.equal(result.gap.sourceGapId, id("9")); assert.equal(result.gap.code, "GIT_LFS_EXTERNAL");
  assert.match(result.gap.nextStep, /F001|来源快照/); assert.match(result.gap.notice, /不是.*F002|不.*F002/);
});

test("F002 report PASS and unknown basis never become execution verification or assumed declaration", () => {
  const value = detail(); value.record.payload = { kind: "PROPERTY", subjectId: subject.id, predicate: "reportsResult", value: { datatype: "string", value: "PASS" }, basis: "DECLARED", evidenceIds: [evidence.id], premiseFactIds: [], ruleRef: { id: "f002-json", version: "1" } };
  const result = explain({ detail: value }); assert.match(result.statement, /PASS/); assert.ok(result.limits.some(text => /不.*(执行|通过)|未.*执行/.test(text)));
  value.record.payload.basis = "UNRECOGNIZED";
  assert.equal(explain({ detail: value }).basisLabel, "依据类别未确认");
});

test("F002 Inspector does not project another scope's processing or untyped object values", () => {
  const coverage = { scopeId: id("9"), items: [{ materialId: id("e"), capabilityId: "javascript", status: "DONE" }] };
  assert.deepEqual(explain({ coverage }).processing, []);
  const stale = manifest(); stale.graphVersionId = id("9"); coverage.scopeId = id("6");
  assert.deepEqual(explain({ coverage, manifest: stale }).processing, [], "a mismatched manifest cannot lend its scope identity to displayed processing");
  const value = detail(); value.record.payload.kind = "PROPERTY"; value.record.payload.value = { datatype: "string", value: { secret: "DO_NOT_PROJECT" } };
  const result = explain({ detail: value }); assert.match(result.statement, /不一致|未确认/); assert.equal(JSON.stringify(result).includes("DO_NOT_PROJECT"), false);
});

test("F002 Inspector retains the declared integer scalar type without treating a fractional value as an integer", () => {
  const value = detail(); value.record.payload.kind = "PROPERTY"; value.record.payload.value = { datatype: "integer", value: 55 };
  assert.match(explain({ detail: value }).statement, /55（integer）/);
  value.record.payload.value.value = 55.5;
  assert.match(explain({ detail: value }).statement, /不一致|未确认/);
});

test("F002 object and Gap anchors use only the exact material reference's content digest", () => {
  const record = { kind: "OBJECT", id: id("d"), payload: { kind: "FUNCTION", name: "cancel", materialId: id("e"), anchor: evidence.payload.anchor } };
  const reference = { kind: "MATERIAL", id: id("e"), role: "material", payload: { contentDigest: id("2") } };
  const input = { detail: { record, references: [reference] }, context: { ...context, kind: "OBJECT", recordId: record.id } };
  assert.equal(explain(input).locations[0].contentDigest, id("2"));
  record.kind = "GAP"; input.context.kind = "GAP";
  assert.equal(explain(input).locations[0].contentDigest, id("2"));
  reference.id = id("9"); assert.equal(explain(input).locations[0].contentDigest, null, "a different material's digest is not an anchor binding");
});

test("F002 JSON pointer evidence explains both the structural pointer and original physical text range", () => {
  const input = detail(); input.references = [{ ...evidence, payload: { ...evidence.payload,
    anchor: { kind: "JSON_POINTER", pointer: "/根😀/a~1b", textRange: evidence.payload.anchor } } }];
  assert.match(explain({ detail: input }).locations[0].description, /JSON Pointer.*根😀.*第 3.*UTF-8.*57.*92/);
});

test("F002 JSON null literal remains typed null rather than unknown or missing", () => {
  const input = detail(); input.record.payload.kind = "PROPERTY"; input.record.payload.value = { datatype: "null", value: null };
  assert.match(explain({ detail: input }).statement, /null（null）/);
  input.record.payload.value.value = "null"; assert.match(explain({ detail: input }).statement, /不一致|未确认/);
});

test("F002 source reading consumes only valid physical ranges declared by TEXT or JSON_POINTER", () => {
  assert.equal(typeof model.sourceAnchorTextRange, "function");
  const anchor = { kind: "JSON_POINTER", pointer: "/x~1y", textRange: evidence.payload.anchor };
  assert.deepEqual(model.sourceAnchorTextRange(anchor), evidence.payload.anchor);
  assert.equal(model.sourceAnchorTextRange({ ...anchor, pointer: "/x~2y" }), null);
  assert.equal(model.sourceAnchorTextRange({ ...anchor, textRange: { kind: "TEXT", lineStart: 3, lineEnd: 1 } }), null);
  assert.equal(model.sourceAnchorTextRange({ kind: "IMAGE", lineStart: 3, lineEnd: 3 }), null);
});

test("F002 mounted path explanation retains the exact route subject predicate and string value together", () => {
  const input = detail();
  input.record.payload.kind = "PROPERTY"; input.record.payload.predicate = "effectivePath";
  input.record.payload.value = { datatype: "string", value: "/api/orders/:id" };
  input.references[0] = { ...subject, payload: { ...subject.payload, kind: "ROUTE", name: "GET /orders/:id" } };
  const statement = explain({ detail: input }).statement;
  assert.equal(statement, 'GET /orders/:id · effectivePath = "/api/orders/:id"（string）');
  assert.notEqual(statement, '"/api/orders/:id"（string）', "the value is not a standalone Inspector element");
});
