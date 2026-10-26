import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as runtime from "../src/deterministic-facts/runtime.js";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { verifyPublication } from "../src/deterministic-facts/verification.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { createFactId } from "../src/deterministic-facts/identity.js";

const componentId = "a".repeat(64), bundleId = "b".repeat(64), workspaceId = "workspace";
function material(path, text, component = componentId) {
  const bytes = Buffer.from(text);
  return { componentId: component, pathBytes: Buffer.from(path).toString("base64url"), mediaType: "text/plain", bytes,
    contentDigest: createHash("sha256").update(bytes).digest("hex") };
}
const profile = () => runtime.technicalF002Profile?.() ?? runtime.boundedF002Profile();
const compile = materials => {
  const result = compileDeterministicFacts({ workspaceId, bundleId, profile: profile(), materials });
  verifyPublication({ workspaceId, bundleId, scopeId: "d".repeat(64), profile: profile(), records: canonicalRecords(result) });
  return result;
};
const edges = (result, predicate) => result.facts.filter(fact => fact.predicate === predicate);
const target = (result, fact) => result.objects.find(object => object.objectId === fact.targetId);

test("F002 technical profile parses real TypeScript syntax and joins conditional arguments to lexical declarations", () => {
  const code = `// 😀\r\nexport function submit(id: string) {\r\n const enabled = process.env.SUBMIT_ENABLED;\r\n if (enabled) { return db.query("SELECT id FROM orders WHERE id=$1", [id]); }\r\n return null;\r\n}`;
  const result = compile([material("src/service.ts", code)]);
  assert.ok(result.objects.some(object => object.kind === "LOGIC_FUNCTION" && object.name === "submit"), "TS must not remain FORMAT_UNSUPPORTED");
  assert.ok(edges(result, "withinBranch").length > 0, "calls/returns need a source-bound branch context");
  assert.ok(edges(result, "readsBinding").some(fact => target(result, fact)?.name === "id"));
  assert.ok(edges(result, "readsBinding").some(fact => target(result, fact)?.name === "enabled"));
  assert.ok(edges(result, "embedsSql").some(fact => target(result, fact)?.kind === "SQL_STATEMENT"));
  assert.ok(edges(result, "readsTable").some(fact => target(result, fact)?.name === "orders"));
  const condition = result.objects.find(object => object.kind === "LOGIC_CONDITION");
  assert.equal(Buffer.from(code).subarray(condition.anchor.byteStart, condition.anchor.byteEnd).toString(), "(enabled)");
  assert.ok(result.facts.filter(fact => fact.basis === "DERIVED" && fact.ruleRef.id === "f002-program-logic").every(fact => fact.premiseFactIds.length > 0));
  assert.deepEqual(compile([material("src/service.ts", code)]), result);
});

test("F002 binding analysis distinguishes nested shadowing and does not invent targets for member/dynamic calls", () => {
  const result = compile([material("src/shadow.ts", `function target(x: string) { return x; }
function outer(value: string) { if(value) { const value = 'inner'; target(value); } target(value); }
function dynamic(fn: unknown, key: string) { registry[key](fn); }`)]);
  const reads = edges(result, "readsBinding").filter(fact => target(result, fact)?.name === "value");
  assert.equal(new Set(reads.map(fact => fact.targetId)).size, 2, "inner const and outer parameter are distinct bindings");
  assert.ok(result.gaps.some(gap => gap.code === "CALL_TARGET_NOT_RESOLVED"));
  assert.equal(edges(result, "callsDeclaration").some(fact => target(result, fact)?.name === "registry"), false);
});

test("F002 static SQL and explicit config reads link only same-component unique declarations", () => {
  const sources = [material("app.ts", `function submit(id: string) { if(process.env.SUBMIT_ENABLED) return db.query('UPDATE orders SET state=$1 WHERE id=$2', [id]); }`),
    material("app.properties", "SUBMIT_ENABLED=true\n"), material("schema.sql", "CREATE TABLE orders (id TEXT PRIMARY KEY, state TEXT);"),
    material("other.properties", "SUBMIT_ENABLED=false\n", "c".repeat(64))];
  const result = compile(sources);
  assert.equal(edges(result, "matchesConfigKey").length, 1);
  assert.equal(edges(result, "matchesSqlTable").length, 1);
  assert.ok(edges(result, "writesTable").some(fact => target(result, fact)?.name === "orders"));
  const ambiguous = compile([...sources, material("duplicate.properties", "SUBMIT_ENABLED=false")]);
  assert.equal(edges(ambiguous, "matchesConfigKey").length, 0);
  assert.ok(ambiguous.gaps.some(gap => gap.code === "CONFIG_DECLARATION_AMBIGUOUS"));
});

test("F002 Java conditions, SQL dynamics, parse failures, and sensitive values stay evidence-honest", () => {
  const result = compile([material("Service.java", `class Service { void submit(String id) { if (id != null) { db.execute("DELETE FROM orders WHERE id=?", id); } } }`),
    material("dynamic.ts", "function run(table: string) { return db.query(`SELECT * FROM ${table}`); }"),
    material("broken.ts", "export function {"), material("secret.ts", `function f() { return db.query("SELECT secret FROM vault WHERE secret='PRIVATE_SENTINEL'"); }`)]);
  assert.ok(edges(result, "withinBranch").length);
  assert.ok(edges(result, "writesTable").some(fact => target(result, fact)?.name === "orders"));
  assert.ok(result.gaps.some(gap => gap.code === "DYNAMIC_SQL_UNSUPPORTED"));
  assert.ok(result.gaps.some(gap => gap.code === "PROGRAM_PARSE_FAILED"));
  assert.equal(JSON.stringify(result).includes("PRIVATE_SENTINEL"), false);
  assert.ok(edges(result, "readsTable").some(fact => target(result, fact)?.name === "vault"), "the private string check exercises parsed SQL, not a parse failure");
  assert.equal(result.facts.some(fact => /executed|verifiedExecution|businessRule/.test(fact.predicate)), false);
});

test("F002 TypeScript imports resolve fixed same-component exports, preserve tests, and refuse mutation or ambiguous modules", () => {
  const files = [material("src/service.ts", "export function save(id: string) { return id; }"),
    material("src/use.ts", "import {save as persist} from './service.js'; export function submit(id: string){return persist(id);}"),
    material("test/use.test.ts", "import test from 'node:test'; import assert from 'node:assert/strict'; import {submit} from '../src/use.js'; test('contract', () => { assert.equal(submit('id'), 'id'); });"),
    material("src/mutate.ts", "function original() {} function other() {} original=other; original();")];
  const result = compile(files);
  assert.ok(edges(result, "callsDeclaration").some(fact => target(result, fact)?.name === "save"));
  assert.ok(edges(result, "callsDeclaration").some(fact => target(result, fact)?.name === "submit"));
  assert.ok(edges(result, "declaredTestBody").length, "a declared test body must be navigable, without claiming execution");
  assert.ok(edges(result, "declaredAssertion").length);
  assert.equal(edges(result, "callsDeclaration").some(fact => target(result, fact)?.name === "original"), false);
  const ambiguous = compile([...files, material("src/service.js", "export function save(id){return id;}")]);
  assert.ok(ambiguous.gaps.some(gap => gap.code === "MODULE_TARGET_AMBIGUOUS"));
});

test("F002 technical output passes the production publication verifier while old profiles retain their output", () => {
  const input = [material("logic.js", "function f(value) { if(value) return g(value); } function g(x) { return x; }")];
  const result = compile(input);
  assert.ok(edges(result, "withinBranch").length);
  assert.doesNotThrow(() => verifyPublication({ workspaceId, bundleId, scopeId: "d".repeat(64), profile: profile(), records: canonicalRecords(result) }));
  const old = compileDeterministicFacts({ workspaceId, bundleId, profile: runtime.boundedF002Profile(), materials: input });
  assert.equal(edges(old, "withinBranch").length, 0);
  assert.equal(runtime.boundedF002Profile().extractionLimits.programLogic, undefined);
});

test("F002 unsupported destructuring and catch bindings never fall through to unrelated outer functions", () => {
  const result = compile([material("shadow.ts", `function target() {}
function parameter({target}: {target: Function}) { target(); }
function local(value: unknown) { const {target} = value; target(); }
function caught() { try { throw 1; } catch(target) { target(); } }`)]);
  assert.equal(edges(result, "callsDeclaration").length, 0);
  assert.ok(result.gaps.some(gap => gap.code === "PARAMETER_PATTERN_UNSUPPORTED"));
});

test("F002 SQL modifiers and keywords never become fabricated table identifiers", () => {
  for (const sql of ["CREATE TABLE IF NOT EXISTS orders (id TEXT);", "CREATE TEMP TABLE orders (id TEXT);", 'CREATE TABLE "IF" (id TEXT);']) {
    const result = compile([material("schema.sql", sql)]);
    assert.ok(edges(result, "declaresSqlTable").some(fact => target(result, fact)?.name === (sql.includes('"IF"') ? "IF" : "orders")));
  }
  for (const sql of ["CREATE TABLE IF MAYBE orders (id TEXT);", "UPDATE ONLY orders SET id=1", "SELECT id FROM ONLY orders", "SELECT FROM orders", "INSERT INTO IF VALUES (1)", "CREATE TABLE orders LIKE other"]) {
    const result = compile([material("unsupported.sql", sql)]);
    assert.equal(result.objects.some(object => object.kind === "SQL_TABLE"), false, sql);
    assert.ok(result.gaps.some(gap => gap.code === "SQL_STATEMENT_UNSUPPORTED"), sql);
  }
});

test("F002 publication independently rejects a rehashed technical edge to a different component", () => {
  const result = compile([material("app.ts", "function f(){return process.env.FEATURE_FLAG;}"),
    material("config.properties", "FEATURE_FLAG=true"), material("other.properties", "FEATURE_FLAG=false", "e".repeat(64))]);
  const match = edges(result, "matchesConfigKey")[0]; assert.ok(match);
  const otherMaterial = result.materials.find(item => item.componentId === "e".repeat(64));
  const other = result.objects.find(object => object.materialId === otherMaterial.materialId && object.kind === "CONFIG_KEY");
  const changed = { ...match, targetId: other.objectId };
  changed.factId = createFactId({ subjectId: changed.subjectId, predicate: changed.predicate, targetId: changed.targetId, basis: changed.basis,
    evidenceIds: changed.evidenceIds, ruleRef: changed.ruleRef, premiseFactIds: changed.premiseFactIds });
  const records = canonicalRecords(result).map(record => record.id === match.factId ? { kind: "FACT", id: changed.factId, payload: changed } : record);
  assert.throws(() => verifyPublication({ workspaceId, bundleId, scopeId: "d".repeat(64), profile: profile(), records }), { code: "F002_TECHNICAL_PREMISE_INVALID" });
});

test("F002 an uncertain lexical scope cannot manufacture a global process.env read", () => {
  const result = compile([material("config-shadow.ts", "function f({process}: unknown) { return process.env.ENABLED; }"), material("app.properties", "ENABLED=true")]);
  assert.equal(result.objects.some(object => object.kind === "CONFIG_READ"), false);
  assert.equal(edges(result, "matchesConfigKey").length, 0);
});

test("F002 writes are not configuration reads and lookalike/mutated assert methods are not test assertions", () => {
  const result = compile([material("writes.ts", "process.env.ENABLED='yes';"),
    material("assert.test.ts", "import test from 'node:test'; import assert from 'node:assert/strict'; test('x',()=>{assert.setup();}); assert.equal=()=>{}; test('y',()=>{assert.equal(1,1);});")]);
  assert.equal(result.objects.some(object => object.kind === "CONFIG_READ"), false);
  assert.equal(edges(result, "declaredAssertion").length, 0);
});

test("F002 dynamic lexical environments cannot resolve an uncertain identifier to an outer function", () => {
  const withScope = compile([material("with.js", "function target() {} function f(context) { with(context) { return target(); } return target(); }")]);
  assert.equal(edges(withScope, "callsDeclaration").length, 1, "only the call outside with has a proven lexical target");
  assert.ok(withScope.gaps.some(gap => gap.code === "DYNAMIC_LEXICAL_SCOPE_UNRESOLVED"));
  const directEval = compile([material("eval.js", "function target() {} function f() { eval('var target = replacement'); return target(); }")]);
  assert.equal(edges(directEval, "callsDeclaration").length, 0);
  assert.ok(directEval.gaps.some(gap => gap.code === "DYNAMIC_LEXICAL_SCOPE_UNRESOLVED"));
});
