import assert from "node:assert/strict";
import test from "node:test";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";
import { createFactId } from "../src/deterministic-facts/identity.js";
import { standardF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";

const workspaceId = "workspace", bundleId = "b".repeat(64);
const profile = limits => ({ id: "c".repeat(64), version: "2", ruleVersions: ["markdown@2", "image-metadata@1"],
  extractionLimits: { documentSyntax: "static-document-v1", ...limits } });
const material = (entryPath, text, componentId = "a".repeat(64), mediaType = "text/plain") => ({ componentId,
  pathBytes: Buffer.from(entryPath).toString("base64url"), bytes: Buffer.from(text), mediaType });
const compile = (materials, limits) => compileDeterministicFacts({ workspaceId, bundleId, profile: profile(limits), materials });
const edge = (result, predicate, from, to) => result.facts.find(f => f.predicate === predicate && f.subjectId === from.objectId && f.targetId === to.objectId);
const textValue = (result, object) => result.facts.find(f => f.subjectId === object.objectId && f.predicate === "literalValue");

test("F002 document syntax is explicit while historical profiles do not acquire new document objects", () => {
  assert.equal(standardF002Profile().extractionLimits.documentSyntax, undefined);
  assert.equal(structuredF002Profile().extractionLimits.documentSyntax, "static-document-v1");
  const historic = profile(); delete historic.extractionLimits.documentSyntax;
  const result = compileDeterministicFacts({ workspaceId, bundleId, profile: historic, materials: [material("a.md", "# Title\nparagraph\n")] });
  assert.equal(result.objects.some(o => o.kind === "DOCUMENT_PARAGRAPH"), false);
});

test("F002 document paragraphs preserve raw multiline UTF8 CRLF text and exact declared section parents", () => {
  const source = "  # 根 ###\r\n\r\n  原文😀 第一行\r\n第二行\r\n\r\n## 子\r\nthird\r\n";
  const result = compile([material("a.md", source)]), sections = result.objects.filter(o => o.kind === "DOCUMENT_SECTION"), paragraphs = result.objects.filter(o => o.kind === "DOCUMENT_PARAGRAPH");
  assert.deepEqual(sections.map(o => o.name).sort(), ["子", "根"]); assert.equal(paragraphs.length, 2);
  const paragraph = paragraphs.find(o => o.anchor.lineStart === 3), parent = sections.find(o => o.name === "根");
  assert.equal(paragraph.parentId, parent.objectId); assert.ok(edge(result, "contains", parent, paragraph));
  assert.equal(textValue(result, paragraph).value.value, "  原文😀 第一行\r\n第二行");
  assert.equal(paragraph.anchor.lineEnd, 4); assert.equal(Buffer.from(source).subarray(paragraph.anchor.byteStart, paragraph.anchor.byteEnd).toString(), textValue(result, paragraph).value.value);
  normalizeCanonicalRecords(canonicalRecords(result), { workspaceId, bundleId, profile: profile() });
});

test("F002 plain UTF8 text has paragraphs without manufacturing Markdown headings or links", () => {
  const result = compile([material("note.txt", "# literal heading\n[x](a.md)\n\nnext\n")]);
  assert.equal(result.materials[0].kind, "MARKDOWN");
  assert.equal(result.objects.filter(o => o.kind === "DOCUMENT_PARAGRAPH").length, 2);
  assert.equal(result.objects.some(o => ["DOCUMENT_SECTION", "DOCUMENT_LINK", "DOCUMENT_IMAGE"].includes(o.kind)), false);
});

test("F002 document code fences indented code and inline code never manufacture links or headings", () => {
  const result = compile([material("a.md", "# Root\n~~~md\n# fake\n![fake](image.png)\n~~~\n\n    [fake](a.md)\n\n`[fake](a.md)` and \\[fake](a.md)\n")]);
  assert.equal(result.objects.filter(o => o.kind === "DOCUMENT_SECTION").length, 1);
  assert.equal(result.objects.some(o => ["DOCUMENT_IMAGE", "DOCUMENT_LINK"].includes(o.kind)), false);
  assert.equal(result.facts.some(f => f.predicate === "refersTo"), false);
});

test("F002 document image references are exact occurrences bound only to admitted same-component material", () => {
  const result = compile([material("doc.md", "# Root\n\n![图😀](image.png)\n"), material("image.png", Buffer.from([0, 1, 2]), "a".repeat(64), "application/octet-stream"), material("image.png", "other", "d".repeat(64))]);
  const image = result.objects.find(o => o.kind === "DOCUMENT_IMAGE"); assert.ok(image); assert.equal(image.name, "图😀");
  const target = result.materials.find(m => m.displayPath === "image.png" && m.componentId === "a".repeat(64));
  const reference = result.facts.find(f => f.subjectId === image.objectId && f.predicate === "refersTo");
  assert.equal(reference.targetId, target.rootObjectId); assert.equal(reference.basis, "DERIVED"); assert.ok(reference.premiseFactIds.length > 0);
  assert.ok(reference.premiseFactIds.every(id => result.facts.some(f => f.factId === id && f.basis === "DECLARED")));
  normalizeCanonicalRecords(canonicalRecords(result), { workspaceId, bundleId, profile: profile() });
});

test("F002 document chapter fragments resolve to exact section objects with checkable declaration premises", () => {
  const result = compile([material("a.md", "[chapter](guide.md#target-section)\n"), material("guide.md", "# Target Section\ncontent\n")]);
  const section = result.objects.find(o => o.kind === "DOCUMENT_SECTION" && o.name === "Target Section"), link = result.objects.find(o => o.kind === "DOCUMENT_LINK");
  assert.ok(section); assert.ok(link, "explicit link occurrence must be its own declared object");
  const reference = edge(result, "refersTo", link, section); assert.ok(reference); assert.equal(reference.basis, "DERIVED"); assert.ok(reference.premiseFactIds.length >= 2);
  assert.ok(reference.premiseFactIds.some(id => result.facts.find(f => f.factId === id)?.subjectId === section.objectId));
  normalizeCanonicalRecords(canonicalRecords(result), { workspaceId, bundleId, profile: profile() });
});

test("F002 document duplicate heading fragments are ambiguity rather than a guessed first target", () => {
  const result = compile([material("a.md", "[chapter](#duplicate)\n\n# Duplicate\n# Duplicate\n")]);
  assert.equal(result.facts.some(f => f.predicate === "refersTo"), false); assert.ok(result.gaps.some(g => g.code === "DOCUMENT_FRAGMENT_AMBIGUOUS"));
});

test("F002 document percent-decoded paths cannot escape a component or manufacture external reads", () => {
  const result = compile([material("docs/a.md", "[a](%2Fetc/passwd)\n[b](%2E%2E/%2E%2E/out.md)\n[c](https://example.invalid/a)\n[d](../missing.md)\n[e](bad%ZZ.md)\n"), material("out.md", "not linked", "d".repeat(64))]);
  assert.equal(result.facts.some(f => f.predicate === "refersTo"), false);
  for (const code of ["DOCUMENT_LINK_OUT_OF_SCOPE", "DOCUMENT_LINK_UNRESOLVED", "DOCUMENT_LINK_INVALID"]) assert.ok(result.gaps.some(g => g.code === code), code);
});

test("F002 document reference-style links raw HTML and nested destinations remain explicit limited syntax", () => {
  const result = compile([material("a.md", "[ref][id]\n\n[id]: hidden.md\n\n<div>![fake](a.md)</div>\n\n[nested](folder(a).md)\n")]);
  assert.equal(result.facts.some(f => f.predicate === "refersTo"), false); assert.ok(result.gaps.some(g => g.code.startsWith("DOCUMENT_") && g.code.includes("UNSUPPORTED")));
});

test("F002 document sensitive configuration-shaped text never enters paragraph names values or search metadata", () => {
  const result = compile([material("a.md", "# Safe\n\nAPI_TOKEN=FIRST_DOCUMENT_SENTINEL\nSECOND_DOCUMENT_SENTINEL\n\nsafe text\n")]);
  const records = JSON.stringify(canonicalRecords(result)); for (const value of ["FIRST_DOCUMENT_SENTINEL", "SECOND_DOCUMENT_SENTINEL"]) assert.equal(records.includes(value), false);
  assert.ok(result.gaps.some(g => g.code === "DOCUMENT_TEXT_RESTRICTED"));
  assert.equal(result.objects.filter(o => o.kind === "DOCUMENT_PARAGRAPH").length, 1);
});

test("F002 document privacy retains escaped sensitive spellings without using display refusal as sensitivity", () => {
  for (const key of ['"pass\\u0077ord"', '"pass\\x77ord"', '"pass\\U00000077ord"', "pass\\u0077ord", "api\\_key", "pass\\\n  word"]) {
    const result = compile([material("a.md", `# Public\n\n${key}=FIRST_ENCODED_SENTINEL\nSECOND_ENCODED_SENTINEL\n\nordinary paragraph\n`)]);
    const records = JSON.stringify(canonicalRecords(result));
    assert.equal(records.includes("FIRST_ENCODED_SENTINEL"), false, key);
    assert.equal(records.includes("SECOND_ENCODED_SENTINEL"), false, key);
    assert.ok(result.gaps.some(gap => gap.code === "DOCUMENT_TEXT_RESTRICTED"), key);
    assert.equal(result.objects.filter(object => object.kind === "DOCUMENT_PARAGRAPH").length, 1, key);
  }
});

test("F002 document fixed object and paragraph-byte budgets never publish a truncated successful extraction", () => {
  for (const [source, limits] of [["# Title\n\npara\n", { maxDocumentObjects: 1 }], ["# Title\n\nlong paragraph\n", { maxDocumentParagraphBytes: 3 }]]) {
    const result = compile([material("a.md", source)], limits); assert.equal(result.facts.length, 0); assert.equal(result.objects.length, 1);
    assert.ok(result.gaps.some(g => g.code === "DOCUMENT_STRUCTURE_LIMIT"));
  }
});

const changeReference = (records, patch) => records.map(record => {
  if (record.kind !== "FACT" || record.payload.predicate !== "refersTo") return record;
  const payload = { ...record.payload, ...patch };
  const id = createFactId({ subjectId: payload.subjectId, predicate: payload.predicate, targetId: payload.targetId, basis: payload.basis,
    evidenceIds: payload.evidenceIds, ruleRef: payload.ruleRef, premiseFactIds: payload.premiseFactIds });
  return { ...record, id, payload: { ...payload, factId: id } };
});

test("F002 document publication requires the target chapter declaration as a premise", () => {
  const result = compile([material("a.md", "[chapter](guide.md#target)\n"), material("guide.md", "# Target\n"), material("guide.md", "# Target\n", "d".repeat(64))]);
  const records = canonicalRecords(result), reference = result.facts.find(f => f.predicate === "refersTo"); assert.ok(reference);
  const pathOnly = reference.premiseFactIds.filter(id => result.facts.find(f => f.factId === id)?.predicate === "path");
  assert.throws(() => normalizeCanonicalRecords(changeReference(records, { premiseFactIds: pathOnly }), { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_PREMISE_REQUIRED" });
});

test("F002 document publication rejects self-consistent cross-component chapter substitution", () => {
  const result = compile([material("a.md", "[chapter](guide.md#target)\n"), material("guide.md", "# Target\n"), material("guide.md", "# Target\n", "d".repeat(64))]);
  const records = canonicalRecords(result);
  const foreign = result.objects.find(o => o.kind === "DOCUMENT_SECTION" && result.materials.find(m => m.materialId === o.materialId)?.componentId === "d".repeat(64));
  assert.throws(() => normalizeCanonicalRecords(changeReference(records, { targetId: foreign.objectId }), { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_REFERENCE_INVALID" });
});

test("F002 restricted headings cannot silently assign following text to a previous section", () => {
  const result = compile([material("a.md", "# Safe\n\nvisible\n\n# API_TOKEN FIRST_HEADING_SENTINEL\nSECOND_HEADING_SENTINEL\n## child\nTHIRD_HEADING_SENTINEL\n# Public\nlast\n")]);
  const serialized = JSON.stringify(canonicalRecords(result));
  for (const marker of ["FIRST_HEADING_SENTINEL", "SECOND_HEADING_SENTINEL", "THIRD_HEADING_SENTINEL"]) assert.equal(serialized.includes(marker), false);
  assert.equal(result.objects.filter(o => o.kind === "DOCUMENT_PARAGRAPH").length, 2);
});
