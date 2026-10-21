import assert from "node:assert/strict";
import test from "node:test";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";
import { standardF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";
import { F002RuleRegistry } from "../src/deterministic-facts/rules.js";
import { canonicalDigest, createFactId } from "../src/deterministic-facts/identity.js";

const workspaceId = "workspace", bundleId = "b".repeat(64), componentId = "a".repeat(64);
const profile = limits => ({ id: "c".repeat(64), version: "2", ruleVersions: ["json@2", "junit-xml@2"], extractionLimits: { testReports: "literal-reports-v1", ...limits } });
const registry = new F002RuleRegistry({ ruleVersions: ["json@2", "junit-xml@2"] });
const compile = (text, json = false, limits) => compileDeterministicFacts({ workspaceId, bundleId, profile: profile(limits), ruleRegistry: registry,
  materials: [{ componentId, pathBytes: Buffer.from(json ? "report.json" : "junit.xml").toString("base64url"), mediaType: json ? "application/json" : "application/xml", bytes: Buffer.from(text) }] });
const results = r => r.objects.filter(o => o.kind === "TEST_RESULT");
const prop = (r, o, p) => r.facts.find(f => f.subjectId === o.objectId && f.predicate === p);
const valid = (r, limits) => normalizeCanonicalRecords(canonicalRecords(r), { workspaceId, bundleId, profile: profile(limits) });
const codes = r => r.gaps.map(g => g.code);
const xml = '<testsuite name="suite"><testcase name="read😀" id="external-case" sourceBundleId="' + bundleId + '" command="node --test" environment="isolated" producer="untrusted-reporter" testedVersion="revision-1"/></testsuite>';

test("F002 report profile preserves old rules while configuring bounded static reports", () => {
  assert.equal(standardF002Profile().extractionLimits.testReports, undefined);
  assert.ok(standardF002Profile().ruleVersions.includes("junit-xml@1"));
  assert.equal(structuredF002Profile().extractionLimits.testReports, "literal-reports-v1");
  assert.ok(structuredF002Profile().ruleVersions.includes("junit-xml@2"));
});

test("F002 XML reports expose explicit opaque identity and binding claims without granting execution trust", () => {
  const r = compile(xml), o = results(r)[0]; assert.ok(o);
  for (const [p, value] of [["reportTestId", "external-case"], ["reportSourceBundleId", bundleId], ["reportCommand", "node --test"], ["reportEnvironment", "isolated"], ["reportProducer", "untrusted-reporter"], ["reportTestedVersion", "revision-1"]]) assert.equal(prop(r, o, p)?.value.value, value);
  assert.equal(prop(r, o, "reportsResult")?.value.value, "PASS"); assert.equal(prop(r, o, "reportsResult")?.basis, "DERIVED");
  assert.equal(prop(r, o, "reportsResult")?.premiseFactIds.length, 2);
  assert.ok(codes(r).includes("EXECUTION_BINDING_MISSING")); assert.equal(r.facts.some(f => f.predicate === "refersTo"), false); valid(r);
});

test("F002 XML syntax hierarchy comments and CDATA never fabricate test or failure elements", () => {
  const r = compile('<testsuites><testsuite name="s"><!-- <testcase name="fake"/> --><testcase name="real"><system-out><![CDATA[<failure/><testcase name="fake"/>]]></system-out></testcase></testsuite></testsuites>');
  assert.deepEqual(results(r).map(o => o.name), ["real"]); assert.equal(prop(r, results(r)[0], "reportsResult")?.value.value, "PASS");
  const suites = r.objects.filter(o => o.kind === "JUNIT_SUITE" && o.name === "s"); assert.equal(suites.length, 1); assert.equal(results(r)[0].parentId, suites[0].objectId); valid(r);
});

test("F002 XML attributes decode only predefined and valid numeric references with exact UTF8 CRLF ranges", () => {
  const text = '<testsuite name="s">\r\n <testcase name = "根&#x1F600; &amp; &quot;" id="a&gt;b">\r\n  <failure/>\r\n </testcase>\r\n</testsuite>', r = compile(text), o = results(r)[0];
  assert.equal(o?.name, '根😀 & "'); assert.equal(prop(r, o, "reportTestId")?.value.value, "a>b");
  assert.equal(prop(r, o, "reportsResult")?.value.value, "FAIL");
  const a = r.evidence.find(e => prop(r, o, "testName").evidenceIds.includes(e.evidenceId)).anchor;
  assert.equal(a.lineStart, 2); assert.equal(Buffer.from(text).subarray(a.byteStart, a.byteEnd).toString(), '根&#x1F600; &amp; &quot;'); valid(r);
});

test("F002 malformed XML is rejected atomically rather than salvaging regex test matches", () => {
  for (const text of ['<testsuite><testcase name="x"/></wrong>', '<testsuite><testcase name="x" name="y"/></testsuite>', '<testsuite><testcase name=x/></testsuite>', '<testsuite><testcase name="x"/></testsuite>tail', '<testsuite><testcase name="x"/></testsuite><testsuite/>', '<testsuite><testcase name="&#0;"/></testsuite>', '<testsuite><testcase name="&bogus;"/></testsuite>']) {
    const r = compile(text); assert.equal(results(r).length, 0, text); assert.ok(codes(r).includes("JUNIT_XML_PARSE_FAILED"), text);
  }
});

test("F002 actual DTD entity declarations and processing instructions are never evaluated", () => {
  for (const text of ['<!DOCTYPE testsuite SYSTEM "https://invalid.example/x"><testsuite/>', '<!DOCTYPE testsuite [<!ENTITY x "value">]><testsuite/>']) {
    const r = compile(text); assert.equal(r.facts.length, 0); assert.ok(codes(r).includes("JUNIT_XML_UNSAFE"));
  }
  assert.ok(codes(compile('<?fetch url="https://invalid.example/x"?><testsuite/>')).includes("JUNIT_XML_UNSUPPORTED"));
});

test("F002 report unsupported root namespace and misplaced testcase never acquire JUnit identity", () => {
  for (const text of ['<arbitrary><testcase name="x"/></arbitrary>', '<testsuite xmlns="urn:other"><testcase name="x"/></testsuite>', '<testsuite><wrapper><testcase name="x"/></wrapper></testsuite>']) {
    const r = compile(text); assert.equal(results(r).length, 0, text); assert.ok(codes(r).includes("JUNIT_XML_UNSUPPORTED"));
  }
});

test("F002 conflicting result markers and status attributes stay ambiguous rather than inventing PASS", () => {
  for (const child of ['<failure/><skipped/>', '<error/><failure/>']) {
    const r = compile('<testsuite><testcase name="x">' + child + '</testcase></testsuite>');
    assert.equal(prop(r, results(r)[0], "reportsResult"), undefined); assert.ok(codes(r).includes("REPORT_RESULT_AMBIGUOUS")); valid(r);
  }
  const r = compile('<testsuite><testcase name="x" status="disabled"/></testsuite>');
  assert.equal(prop(r, results(r)[0], "reportsResult"), undefined); assert.ok(codes(r).includes("REPORT_RESULT_AMBIGUOUS"));
});

test("F002 XML report limits leave no partial successful result set", () => {
  const text = '<testsuite><testcase name="a"/><testcase name="b"/></testsuite>';
  for (const limits of [{ maxReportCases: 1 }, { maxXmlNodes: 2 }, { maxXmlDepth: 1 }]) {
    const r = compile(text, false, limits); assert.equal(r.facts.length, 0); assert.ok(codes(r).includes("JUNIT_XML_LIMIT"));
  }
});

test("F002 JSON report fields retain exact pointers and contradictory binding stays explicitly unconfirmed", () => {
  const text = JSON.stringify({ tests: [{ name: "read😀", status: "PASS", testId: "opaque", sourceBundleId: "d".repeat(64), command: "node --test", environment: "isolated", producer: "self", testedVersion: "v1" }] }), r = compile(text, true), o = results(r)[0];
  assert.equal(prop(r, o, "reportTestId")?.value.value, "opaque");
  const fact = prop(r, o, "reportCommand"), anchor = r.evidence.find(e => fact.evidenceIds.includes(e.evidenceId)).anchor;
  assert.equal(anchor.pointer, "/tests/0/command"); assert.ok(codes(r).includes("REPORT_SOURCE_BINDING_MISMATCH"));
  assert.ok(codes(r).includes("EXECUTION_BINDING_MISSING")); assert.equal(prop(r, o, "reportsResult").basis, "DECLARED"); valid(r);
});

test("F002 report-sensitive titles and metadata are retired from the searchable canonical output", () => {
  for (const json of [false, true]) {
    const text = json ? '{"tests":[{"name":"password=SECRET_SENTINEL","status":"PASS"},{"name":"safe","status":"PASS","command":"token=SECOND_SENTINEL"}]}' : '<testsuite><testcase name="password=SECRET_SENTINEL"/><testcase name="safe" command="token=SECOND_SENTINEL"/></testsuite>';
    const r = compile(text, json), serialized = JSON.stringify(canonicalRecords(r));
    assert.equal(serialized.includes("SECRET_SENTINEL"), false); assert.equal(serialized.includes("SECOND_SENTINEL"), false);
    assert.ok(codes(r).includes("REPORT_FIELD_RESTRICTED"));
  }
});

test("F002 JSON report metadata never coerces arrays objects booleans or unsupported result spellings", () => {
  const r = compile('{"tests":[{"name":"x","status":"maybe","testId":false,"command":["node"],"sourceBundleId":{},"producer":"p"}]}', true), o = results(r)[0];
  assert.equal(prop(r, o, "reportsResult"), undefined); assert.equal(prop(r, o, "reportTestId"), undefined);
  assert.ok(codes(r).includes("REPORT_FIELD_INVALID")); assert.ok(codes(r).includes("REPORT_RESULT_AMBIGUOUS")); valid(r);
});

test("F002 publication rejects XML result rewriting even after the attacker recomputes its content identity", () => {
  const r = compile(xml), records = canonicalRecords(r).map(record => {
    if (record.kind !== "FACT" || record.payload.predicate !== "reportsResult") return record;
    const p = { ...record.payload, value: { datatype: "string", value: "FAIL" } }, id = createFactId({ subjectId: p.subjectId, predicate: p.predicate, typedValue: p.value, basis: p.basis, evidenceIds: p.evidenceIds, ruleRef: p.ruleRef, premiseFactIds: p.premiseFactIds });
    return { ...record, id, payload: { ...p, factId: id } };
  });
  assert.throws(() => normalizeCanonicalRecords(records, { workspaceId, bundleId, profile: profile() }), /报告|结果|前提/);
});

test("F002 publication requires execution-binding limitation even when every report identity claim is present", () => {
  const r = compile(xml); assert.throws(() => normalizeCanonicalRecords(canonicalRecords(r).filter(record => record.kind !== "GAP"), { workspaceId, bundleId, profile: profile() }), /报告|执行|限制/);
});

test("F002 JSON partial report cases cannot leak restricted titles or statuses through generic nodes", () => {
  const r = compile('{"tests":[{"name":"password=HIDDEN_NAME"},{"name":"safe","status":"token=HIDDEN_STATUS"},{"name":"partial","status":false}]}', true);
  const bytes = JSON.stringify(canonicalRecords(r)); assert.equal(bytes.includes("HIDDEN_NAME"), false); assert.equal(bytes.includes("HIDDEN_STATUS"), false);
  assert.equal(results(r).length, 2); assert.ok(results(r).every(o => !prop(r, o, "reportsResult"))); valid(r);
});

test("F002 ambiguous report limitation cannot be borrowed from a different case", () => {
  const r = compile('<testsuite><testcase name="ambiguous" status="disabled"/><testcase name="normal"/></testsuite>');
  const normal = results(r).find(o => o.name === "normal"), result = prop(r, normal, "reportsResult");
  assert.throws(() => normalizeCanonicalRecords(canonicalRecords(r).filter(record => record.id !== result.factId), { workspaceId, bundleId, profile: profile() }), /报告|歧义/);
});

test("F002 report node field and case budgets also constrain JSON projection", () => {
  const r = compile('{"tests":[{"name":"one","status":"PASS"},{"name":"two","status":"PASS"}]}', true, { maxReportCases: 1 });
  assert.equal(r.facts.length, 0); assert.ok(codes(r).includes("REPORT_CASE_LIMIT"));
  const limited = compile('<testsuite><testcase name="too long"/></testsuite>', false, { maxReportFieldBytes: 3 });
  assert.equal(results(limited).length, 0); assert.ok(codes(limited).includes("REPORT_FIELD_LIMIT"));
});

test("F002 XML declaration spelling is case-sensitive and logs are never indexed as report claims", () => {
  assert.ok(codes(compile('<?XML version="1.0"?><testsuite/>')).includes("JUNIT_XML_UNSUPPORTED"));
  const r = compile('<?xml version="1.0" encoding="UTF-8"?><testsuite><testcase name="safe"><system-out>token=NOT_INDEXED</system-out></testcase></testsuite>');
  assert.equal(JSON.stringify(canonicalRecords(r)).includes("NOT_INDEXED"), false); valid(r);
});

test("F002 legacy JUnit regex profile remains separately replayable", () => {
  const input = { workspaceId, bundleId, profile: { id: "c".repeat(64), version: "1", ruleVersions: ["junit-xml@1"] },
    materials: [{ componentId, pathBytes: Buffer.from("junit.xml").toString("base64url"), mediaType: "application/xml", bytes: Buffer.from('<testsuite><testcase name="x"/><testcase name="y"><failure/></testcase></testsuite>') }] };
  const r = compileDeterministicFacts(input);
  assert.deepEqual(results(r).map(o => prop(r, o, "reportsResult").value.value).sort(), ["FAIL", "PASS"]);
  assert.equal(r.facts.some(f => f.ruleRef.version !== "1"), false);
  assert.equal(canonicalDigest("FACT_SET_RECORDS", { records: canonicalRecords(r) }), "d2b7ce8abb2807fdcd0823d658e2ec7031cfaedfbd3f3915acf96fe5c7973dac");
});

test("F002 reports publish alongside unrelated null-anchor limitations", () => {
  const r = compileDeterministicFacts({ workspaceId, bundleId, profile: profile(), ruleRegistry: registry, materials: [
    { componentId, pathBytes: Buffer.from("junit.xml").toString("base64url"), mediaType: "application/xml", bytes: Buffer.from(xml) },
    { componentId, pathBytes: Buffer.from("other.pdf").toString("base64url"), mediaType: "application/octet-stream", bytes: Buffer.from("not supported") },
  ] });
  assert.ok(r.gaps.some(g => g.anchor === null)); valid(r);
});
