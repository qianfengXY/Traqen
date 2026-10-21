import assert from "node:assert/strict";
import test from "node:test";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { createFactId } from "../src/deterministic-facts/identity.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";
import { standardF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";

const workspaceId = "workspace", bundleId = "b".repeat(64), spring = "org.springframework.web.bind.annotation.";
const profile = limits => ({ id: "c".repeat(64), version: "2", ruleVersions: ["java@2"], extractionLimits: { javaSyntax: "ast-declarations-v1", springMappings: "ast-literals-v1", ...limits } });
const compile = (text, limits) => compileDeterministicFacts({ workspaceId, bundleId, profile: profile(limits), materials: [{ componentId: "a".repeat(64), pathBytes: Buffer.from("Controller.java").toString("base64url"), mediaType: "text/x-java", bytes: Buffer.from(text) }] });
const imports = ["RestController", "RequestMapping", "GetMapping", "PostMapping", "RequestMethod"].map(n => `import ${spring}${n};`).join("\r\n");
const source = (base, method, extra = "") => `${imports}\r\n@RestController ${base} class Example ${extra} { ${method} String run() { return "😀"; } }\r\n`;
const routeProps = (r, predicate) => r.facts.filter(f => f.predicate === predicate && r.objects.find(o => o.objectId === f.subjectId)?.kind === "ROUTE");
const paths = r => routeProps(r, "path").map(f => f.value.value).sort();
const changedFacts = (r, change) => {
  const records = canonicalRecords(r), rebuilt = new Map(), facts = new Map(records.filter(r => r.kind === "FACT").map(r => [r.id, r]));
  const rebuild = record => {
    if (rebuilt.has(record.id)) return rebuilt.get(record.id);
    const p = change({ ...record.payload });
    p.premiseFactIds = p.premiseFactIds.map(id => rebuild(facts.get(id)).id);
    const id = createFactId({ subjectId: p.subjectId, predicate: p.predicate, ...(p.kind === "RELATION" ? { targetId: p.targetId } : { typedValue: p.value }), basis: p.basis, evidenceIds: p.evidenceIds, ruleRef: p.ruleRef, premiseFactIds: p.premiseFactIds });
    const result = { ...record, id, payload: { ...p, factId: id } }; rebuilt.set(record.id, result); return result;
  };
  return records.map(record => record.kind === "FACT" ? rebuild(record) : record);
};

test("F002 Spring mapping profile is opt-in and preserves historical extraction configuration", () => {
  assert.equal(standardF002Profile().extractionLimits.springMappings, undefined);
  assert.equal(structuredF002Profile().extractionLimits.springMappings, "ast-literals-v1");
});

test("F002 Spring literal class and method mappings retain annotation identities and actual derivation premises", () => {
  const r = compile(source('@RequestMapping("/api")', '@GetMapping("/orders/{id}")'));
  assert.deepEqual(paths(r), ["/api/orders/{id}"]); assert.deepEqual(routeProps(r, "httpMethod").map(f => f.value.value), ["GET"]);
  const route = r.objects.find(o => o.kind === "ROUTE"); assert.equal(route.name, "GET /api/orders/{id}");
  assert.equal(r.objects.find(o => o.objectId === route.parentId).kind, "JAVA_ANNOTATION");
  for (const f of [...routeProps(r, "path"), ...r.facts.filter(f => f.predicate === "handlesRoute")]) {
    assert.equal(f.basis, "DERIVED"); assert.ok(f.premiseFactIds.length >= 4); assert.ok(f.premiseFactIds.every(id => r.facts.some(p => p.factId === id)));
  }
  normalizeCanonicalRecords(canonicalRecords(r), { workspaceId, bundleId, profile: profile() });
});

test("F002 Spring path arrays preserve all combinations as conditioned Facts on one mapping declaration", () => {
  const r = compile(source('@RequestMapping(path={"/api","/v1"})', '@GetMapping(value={"/orders","/people"})'));
  assert.deepEqual(paths(r), ["/api/orders", "/api/people", "/v1/orders", "/v1/people"]);
  assert.equal(r.objects.filter(o => o.kind === "ROUTE").length, 1, "one syntax declaration must not collide into fabricated route identities");
  assert.equal(new Set(routeProps(r, "path").map(f => JSON.stringify(f.premiseFactIds))).size, 4);
  normalizeCanonicalRecords(canonicalRecords(r), { workspaceId, bundleId, profile: profile() });
});

test("F002 Spring explicit RequestMethod arrays are bound to the imported enum and kept separate", () => {
  const r = compile(source('', '@RequestMapping(path="/item",method={RequestMethod.GET,RequestMethod.POST})'));
  assert.deepEqual([...new Set(routeProps(r, "httpMethod").map(f => f.value.value))].sort(), ["GET", "POST"]);
  assert.equal(routeProps(r, "path").length, 2, "same path with different method premises retains both declarations");
  normalizeCanonicalRecords(canonicalRecords(r), { workspaceId, bundleId, profile: profile() });
});

test("F002 Spring default paths and unrestricted method conditions remain explicit rule defaults rather than literal declarations", () => {
  const r = compile(source('@RequestMapping("/api")', '@PostMapping'));
  assert.deepEqual(paths(r), ["/api"]); assert.deepEqual(routeProps(r, "httpMethod").map(f => f.value.value), ["POST"]);
  assert.ok(r.facts.some(f => f.predicate === "mappingDefaultPath" && f.value.value === true));
  const any = compile(source('', '@RequestMapping("/item")'));
  assert.deepEqual(routeProps(any, "httpMethod").map(f => f.value.value), ["ANY"]);
  assert.ok(any.facts.some(f => f.predicate === "mappingDefaultMethod" && f.value.value === true));
  for (const compiled of [r, any]) normalizeCanonicalRecords(canonicalRecords(compiled), { workspaceId, bundleId, profile: profile() });
});

test("F002 Spring fully-qualified annotations do not need a guessed wildcard or unrelated import", () => {
  const r = compile(`@${spring}RestController @${spring}RequestMapping("/api") class Example { @${spring}GetMapping("/x") void run(){} }`);
  assert.deepEqual(paths(r), ["/api/x"]);
  normalizeCanonicalRecords(canonicalRecords(r), { workspaceId, bundleId, profile: profile() });
});

test("F002 Spring annotation names require exact framework binding and a controller declaration", () => {
  for (const text of [
    'import other.RestController; import other.GetMapping; @RestController class Example { @GetMapping("/x") void run(){} }',
    'import org.springframework.web.bind.annotation.GetMapping; class Example { @GetMapping("/x") void run(){} }',
    `${imports} @interface GetMapping {} @RestController class Example { @GetMapping("/x") void run(){} }`,
    'import org.springframework.web.bind.annotation.*; @RestController class Example { @GetMapping("/x") void run(){} }',
  ]) { const r = compile(text); assert.deepEqual(paths(r), []); assert.ok(r.gaps.some(g => g.code.startsWith("SPRING_"))); }
});

test("F002 Spring aliases duplicate mappings and extra matching conditions cannot silently become unconditional paths", () => {
  for (const method of ['@GetMapping(value="/a",path="/b")', '@GetMapping("/a") @PostMapping("/b")', '@GetMapping(path="/x",headers="secret")', '@GetMapping(path="/x",produces="application/json")']) {
    const r = compile(source('', method)); assert.deepEqual(paths(r), []); assert.ok(r.gaps.some(g => /SPRING_(?:MAPPING|CONDITION|ALIAS)/.test(g.code)));
  }
});

test("F002 Spring constants interpolation wildcard and regex patterns remain explicit unsupported syntax", () => {
  for (const method of ['@GetMapping(PATH)', '@GetMapping("${base}/x")', '@GetMapping("/a/**")', '@GetMapping("/{id:[0-9]+}")']) {
    const r = compile(source('', method)); assert.deepEqual(paths(r), []); assert.ok(r.gaps.some(g => g.code.startsWith("SPRING_")));
  }
});

test("F002 Spring inherited or local controller scopes do not manufacture inherited runtime mappings", () => {
  const r = compile(source('@RequestMapping("/api")', '@GetMapping("/x")', 'extends Parent')); assert.deepEqual(paths(r), []);
  assert.ok(r.gaps.some(g => g.code === "SPRING_CONTROLLER_SCOPE_UNSUPPORTED"));
});

test("F002 Spring fixed expansion budgets preserve declarations without a partial derived path set", () => {
  const r = compile(source('@RequestMapping({"/one","/two"})', '@GetMapping({"/a","/b"})'), { maxSpringPaths: 2 });
  assert.deepEqual(paths(r), []); assert.ok(r.gaps.some(g => g.code === "SPRING_MAPPING_LIMIT"));
  assert.ok(r.objects.some(o => o.kind === "JAVA_ANNOTATION"));
});

test("F002 Spring publication independently rejects a fabricated joined path even after identity recomputation", () => {
  const r = compile(source('@RequestMapping("/api")', '@GetMapping("/x")')); assert.equal(routeProps(r, "path").length, 1);
  const records = canonicalRecords(r).map(record => {
    if (record.kind !== "FACT" || record.payload.predicate !== "path" || !routeProps(r, "path").some(f => f.factId === record.id)) return record;
    const p = { ...record.payload, value: { datatype: "string", value: "/fake" } };
    const id = createFactId({ subjectId: p.subjectId, predicate: p.predicate, typedValue: p.value, basis: p.basis, evidenceIds: p.evidenceIds, ruleRef: p.ruleRef, premiseFactIds: p.premiseFactIds });
    return { ...record, id, payload: { ...p, factId: id } };
  });
  assert.throws(() => normalizeCanonicalRecords(records, { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_PREMISE_REQUIRED" });
});

test("F002 Spring publication rejects a forged annotation binding with all dependent identities recomputed", () => {
  const r = compile(source('', '@GetMapping("/x")'));
  const records = changedFacts(r, p => p.predicate === "annotationType" && p.value.value === spring + "GetMapping" ? { ...p, value: { datatype: "string", value: spring + "PostMapping" } } : p);
  assert.throws(() => normalizeCanonicalRecords(records, { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_PREMISE_REQUIRED" });
});

test("F002 Spring publication rejects a method condition unsupported by its shortcut annotation", () => {
  const r = compile(source('', '@GetMapping("/x")'));
  const records = changedFacts(r, p => p.predicate === "mappingMethod" ? { ...p, value: { datatype: "string", value: "PUT" } } : p);
  assert.throws(() => normalizeCanonicalRecords(records, { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_PREMISE_REQUIRED" });
});

test("F002 Spring publication cannot retarget a route handler to another unannotated method", () => {
  const r = compile(source('', '@GetMapping("/x")').replace('return "😀"; } }', 'return "😀"; } void other(){} }'));
  const other = r.objects.find(o => o.kind === "JAVA_METHOD" && o.name === "Example#other"); assert.ok(other);
  assert.notEqual(r.facts.find(f => f.predicate === "handlesRoute").subjectId, other.objectId);
  const records = changedFacts(r, p => p.predicate === "handlesRoute" ? { ...p, subjectId: other.objectId } : p);
  assert.throws(() => normalizeCanonicalRecords(records, { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_PREMISE_REQUIRED" });
});

test("F002 configured Spring mapping arguments are interpreted without leaving a contradictory generic argument Gap", () => {
  const r = compile(source('@RequestMapping("/api")', '@GetMapping("/x")'));
  assert.equal(r.gaps.some(g => ["JAVA_ANNOTATION_ARGUMENTS_NOT_INTERPRETED", "SPRING_MAPPING_NOT_CONFIGURED"].includes(g.code)), false);
});

test("F002 Spring publication enforces the fixed per-material expansion budget independently", () => {
  const r = compile(source('@RequestMapping({"/a","/b"})', '@GetMapping({"/x","/y"})'));
  assert.equal(paths(r).length, 4);
  assert.throws(() => normalizeCanonicalRecords(canonicalRecords(r), { workspaceId, bundleId, profile: profile({ maxSpringPaths: 2 }) }), { code: "F002_RECORD_PREMISE_REQUIRED" });
});
