import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { technicalF002Profile } from "../src/deterministic-facts/runtime.js";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { verifyPublication } from "../src/deterministic-facts/verification.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { createFactId, createProfileConfigDigest, createProfileId } from "../src/deterministic-facts/identity.js";

const workspaceId = "workspace", bundleId = "b".repeat(64), componentId = "a".repeat(64);
const material = (path, text, component = componentId) => {
  const bytes = Buffer.from(text);
  return { componentId: component, pathBytes: Buffer.from(path).toString("base64url"), bytes, mediaType: "text/plain", contentDigest: createHash("sha256").update(bytes).digest("hex") };
};
const compile = (materials, profile = technicalF002Profile()) => compileDeterministicFacts({ workspaceId, bundleId, profile, materials });
const verify = (result, profile = technicalF002Profile()) => verifyPublication({ workspaceId, bundleId, profile, scopeId: "d".repeat(64), records: canonicalRecords(result) });
const target = (result, fact) => result.objects.find(object => object.objectId === fact.targetId);

// Rehash the changed fact and all dependent premises, so a rejected forgery is
// actually caught by independent technical checks, not by an invalid checksum.
function changeFacts(result, patches) {
  const byId = new Map(result.facts.map(fact => [fact.factId, fact])), changed = new Map();
  const rewrite = id => {
    if (changed.has(id)) return changed.get(id);
    const original = byId.get(id), fact = { ...original, ...(patches.get(id) ?? {}) };
    fact.premiseFactIds = fact.premiseFactIds.map(id => rewrite(id).factId);
    fact.factId = createFactId({ subjectId: fact.subjectId, predicate: fact.predicate, ...(fact.targetId ? { targetId: fact.targetId } : { typedValue: fact.value }),
      basis: fact.basis, ruleRef: fact.ruleRef, evidenceIds: fact.evidenceIds, premiseFactIds: fact.premiseFactIds });
    changed.set(id, fact); return fact;
  };
  return { ...result, facts: result.facts.map(fact => rewrite(fact.factId)) };
}

for (const [path, code, functionName] of [
  ["arrow.js", "const audit = (value) => value; audit(1);", "anonymous"],
  ["expression.js", "const audit = function internal(value) { return value; }; audit(1);", "internal"],
  ["same-name.js", "const audit = function audit() { return 1; }; audit();", "audit"],
  ["typed.ts", "const audit = (value: string): string => value; audit('fixed');", "anonymous"],
]) test(`F002 ${path} publishes the direct initializer binding without requiring the function's own name`, () => {
  const result = compile([material(path, code)]);
  assert.doesNotThrow(() => verify(result));
  const call = result.facts.find(fact => fact.predicate === "callsDeclaration" && target(result, fact)?.name === functionName);
  assert.ok(call);
  const premise = result.facts.find(fact => call.premiseFactIds.includes(fact.factId) && fact.predicate === "bindingFunction");
  assert.ok(premise, "a direct binding→function proof, not merely three syntaxKind facts");
  assert.equal(premise.targetId, call.targetId);
  assert.equal(result.objects.find(object => object.objectId === premise.subjectId).name, "audit");
});

test("F002 declaration names, named-expression recursion and shadowed initializers retain their exact binding", () => {
  const code = "function audit() { return 0; } function outer(){ const audit = function inner(){ return inner(); }; return audit(); } audit();";
  const result = compile([material("shadow.js", code)]); verify(result);
  const calls = result.facts.filter(fact => fact.predicate === "callsDeclaration");
  assert.equal(calls.length, 3);
  assert.equal(calls.filter(call => target(result, call).name === "inner").length, 2);
  assert.equal(calls.filter(call => target(result, call).name === "audit").length, 1);
  for (const call of calls) assert.ok(call.premiseFactIds.some(id => result.facts.find(fact => fact.factId === id)?.predicate === "bindingFunction"));
});

test("F002 reassignment, catch/parameter shadowing and non-direct initializers remain unresolved", () => {
  const code = "const audit = ()=>1; function a(audit){ return audit(); } function b(){try {throw 1;} catch(audit){audit();}} let changed=()=>1; changed=()=>2; changed(); const alias=audit; alias(); const conditional=true ? ()=>1 : ()=>2; conditional();";
  const result = compile([material("unknown.js", code)]); verify(result);
  assert.equal(result.facts.filter(fact => fact.predicate === "callsDeclaration").length, 0);
  assert.ok(result.gaps.some(gap => gap.code === "CALL_TARGET_NOT_RESOLVED"));
});

test("F002 publication rejects a call retargeted to an unrelated anonymous function despite rehashed syntax premises", () => {
  const result = compile([material("forged.js", "const audit=()=>1; const other=()=>2; audit();")]); verify(result);
  const call = result.facts.find(fact => fact.predicate === "callsDeclaration"), original = target(result, call);
  const other = result.objects.find(object => object.kind === "LOGIC_FUNCTION" && object.objectId !== original.objectId);
  const syntax = object => result.facts.find(fact => fact.subjectId === object.objectId && fact.predicate === "syntaxKind").factId;
  const forged = changeFacts(result, new Map([[call.factId, { targetId: other.objectId,
    premiseFactIds: call.premiseFactIds.map(id => id === syntax(original) ? syntax(other) : id) }]]));
  assert.throws(() => verify(forged), { code: "F002_TECHNICAL_PREMISE_INVALID" });
});

test("F002 independently rejects forged binding→nested-function and cross-component initializer proofs", () => {
  const result = compile([material("nested.js", "const audit=()=>()=>1; audit();"), material("foreign.js", "const other=()=>2;", "e".repeat(64))]); verify(result);
  const call = result.facts.find(fact => fact.predicate === "callsDeclaration"), original = target(result, call);
  const binding = result.facts.find(fact => fact.predicate === "bindingFunction" && call.premiseFactIds.includes(fact.factId));
  assert.ok(binding);
  const syntax = object => result.facts.find(fact => fact.subjectId === object.objectId && fact.predicate === "syntaxKind").factId;
  const targets = result.objects.filter(object => object.kind === "LOGIC_FUNCTION" && object.objectId !== original.objectId);
  assert.equal(targets.length, 2);
  for (const other of targets) {
    const patchedPremises = ids => ids.map(id => id === syntax(original) ? syntax(other) : id);
    const forged = changeFacts(result, new Map([[binding.factId, { targetId: other.objectId, premiseFactIds: patchedPremises(binding.premiseFactIds) }],
      [call.factId, { targetId: other.objectId, premiseFactIds: patchedPremises(call.premiseFactIds) }]]));
    assert.throws(() => verify(forged), { code: "F002_TECHNICAL_PREMISE_INVALID" });
  }
});

test("F002 a same-named unrelated declaration or a missing binding proof cannot launder an initializer call", () => {
  const result = compile([material("same-name-forgery.js", "const audit=()=>1; function separate(){ function audit(){} return audit; } audit();")]); verify(result);
  const call = result.facts.find(fact => fact.predicate === "callsDeclaration"), original = target(result, call);
  const other = result.objects.find(object => object.kind === "LOGIC_FUNCTION" && object.name === "audit");
  const syntax = object => result.facts.find(fact => fact.subjectId === object.objectId && fact.predicate === "syntaxKind").factId;
  const forged = changeFacts(result, new Map([[call.factId, { targetId: other.objectId,
    premiseFactIds: call.premiseFactIds.map(id => id === syntax(original) ? syntax(other) : id) }]]));
  assert.throws(() => verify(forged), { code: "F002_TECHNICAL_PREMISE_INVALID" });
  const missing = changeFacts(result, new Map([[call.factId, { premiseFactIds: call.premiseFactIds.filter(id => !result.facts.some(fact => fact.factId === id && fact.predicate === "bindingFunction")) }]]));
  assert.throws(() => verify(missing), { code: "F002_TECHNICAL_PREMISE_INVALID" });
});

test("F002 publication resolves a call's nearest unique scope instead of borrowing another valid homonymous binding proof", () => {
  const result = compile([material("scope-forgery.js", "const audit=()=>1; function separate(){const audit=()=>2; audit();} audit();")]); verify(result);
  const objects = new Map(result.objects.map(object => [object.objectId, object]));
  const calls = result.facts.filter(fact => fact.predicate === "callsDeclaration")
    .sort((left, right) => objects.get(left.subjectId).anchor.byteStart - objects.get(right.subjectId).anchor.byteStart);
  assert.equal(calls.length, 2);
  for (const [call, other] of [[calls[0], calls[1]], [calls[1], calls[0]]]) {
    const syntax = result.facts.find(fact => fact.subjectId === call.subjectId && fact.predicate === "syntaxKind").factId;
    const premises = [syntax, ...other.premiseFactIds.filter(id => result.facts.find(fact => fact.factId === id).subjectId !== other.subjectId)];
    const forged = changeFacts(result, new Map([[call.factId, { targetId: other.targetId, premiseFactIds: premises }]]));
    assert.throws(() => verify(forged), { code: "F002_TECHNICAL_PREMISE_INVALID" });
  }
});

test("F002 a non-function parameter still shadows an outer initializer at the independent publication boundary", () => {
  const result = compile([material("parameter-forgery.js", "const audit=()=>1; function shadow(audit){audit();} audit();")]); verify(result);
  const call = result.facts.find(fact => fact.predicate === "callsDeclaration");
  const unknown = result.objects.filter(object => object.kind === "LOGIC_CALL" && object.name === "audit")
    .sort((left, right) => left.anchor.byteStart - right.anchor.byteStart)[0];
  const syntax = result.facts.find(fact => fact.subjectId === unknown.objectId && fact.predicate === "syntaxKind");
  const forged = { ...call, subjectId: unknown.objectId, evidenceIds: syntax.evidenceIds,
    premiseFactIds: [syntax.factId, ...call.premiseFactIds.filter(id => result.facts.find(fact => fact.factId === id).subjectId !== call.subjectId)] };
  forged.factId = createFactId({ subjectId: forged.subjectId, predicate: forged.predicate, targetId: forged.targetId,
    basis: forged.basis, ruleRef: forged.ruleRef, evidenceIds: forged.evidenceIds, premiseFactIds: forged.premiseFactIds });
  assert.throws(() => verify({ ...result, facts: [...result.facts, forged] }), { code: "F002_TECHNICAL_PREMISE_INVALID" });
});

test("F002 new binding proofs have a new profile identity while retained technical-v4 output stays byte-identical", () => {
  const current = technicalF002Profile(), legacy = structuredClone(current);
  delete legacy.extractionLimits.functionBindings;
  delete legacy.extractionLimits.functionInitialization;
  legacy.configDigest = createProfileConfigDigest(legacy); legacy.id = createProfileId(legacy);
  assert.equal(legacy.id, "9d4281951b7475eb833824c25c505eab8d42dd200a6405ca290e559f8e40a020");
  assert.notEqual(current.id, legacy.id);
  const output = compile([material("legacy.js", "const same = function same(){ return 1; }; same();")], legacy);
  verify(output, legacy);
  assert.equal(output.facts.some(fact => fact.predicate === "bindingFunction"), false);
  assert.equal(createHash("sha256").update(JSON.stringify(canonicalRecords(output))).digest("hex"), "88c1856cf4209ad2be119d9b69b417a6ed08887d731113e0b2533a2ea18d0cd4");
});

for (const source of ["f(); const f=()=>1;", "f(); let f=function named(){return 1};", "f(); var f=()=>1;",
  "function outer(){ f(); const f=()=>1; }", "const f=()=>0; { f(); const f=()=>1; }"])
  test(`F002 an immediate call before its nearest initializer stays unresolved: ${source}`, () => {
    const result = compile([material("before.ts", source)]);
    assert.equal(result.facts.filter(fact => fact.predicate === "callsDeclaration").length, 0);
    assert.ok(result.gaps.some(gap => gap.code === "CALL_TARGET_BEFORE_INITIALIZATION"));
    assert.doesNotThrow(() => verify(result), "one unresolved call must not block the normal complete publication");
  });

test("F002 declaration hoisting, completed local initializers and recursive bodies keep their nearest target", () => {
  for (const source of ["f(); function f(){return 1}", "const f=()=>1; f();", "let f=function named(){return 1}; f();",
    "var f=()=>1; f();", "const f=()=>f();", "const f=function self(){return self()};",
    "function outer(){const f=()=>1; if(true){f();}}"] ) {
    const result = compile([material("after.ts", source)]); verify(result);
    assert.equal(result.facts.filter(fact => fact.predicate === "callsDeclaration").length, 1, source);
  }
});

test("F002 deferred, callback and conditional initialization timing is unknown, not inferred from byte order", () => {
  for (const source of ["function invoke(){f()} const f=()=>1; invoke();", "const f=()=>1; function invoke(){f()} invoke();",
    "const callback=()=>f(); const f=()=>1; callback();", "if(false){var f=()=>1;} f();",
    "if(false) var f=()=>1; f();", "for(var f=()=>1;false;){} f();"]) {
    const result = compile([material("timing.ts", source)]); verify(result);
    const calls = result.facts.filter(fact => fact.predicate === "callsDeclaration");
    assert.equal(calls.some(call => result.objects.find(object => object.objectId === call.subjectId).name === "f"), false, source);
    assert.ok(result.gaps.some(gap => gap.code === "CALL_INITIALIZATION_ORDER_UNRESOLVED"), source);
    assert.equal(result.gaps.some(gap => gap.code === "CALL_TARGET_BEFORE_INITIALIZATION"), false, source);
  }
});

test("F002 publication independently rejects a rehashed pre-initialization call borrowing the later valid proof", () => {
  const result = compile([material("forged-order.ts", "f(); const f=()=>1; f();")]); verify(result);
  const valid = result.facts.find(fact => fact.predicate === "callsDeclaration");
  const before = result.objects.filter(object => object.kind === "LOGIC_CALL" && object.name === "f").sort((a,b) => a.anchor.byteStart-b.anchor.byteStart)[0];
  const syntax = result.facts.find(fact => fact.subjectId === before.objectId && fact.predicate === "syntaxKind");
  const forged = { ...valid, subjectId: before.objectId, evidenceIds: syntax.evidenceIds,
    premiseFactIds: [syntax.factId, ...valid.premiseFactIds.filter(id => result.facts.find(fact => fact.factId === id).subjectId !== valid.subjectId)] };
  forged.factId = createFactId({subjectId:forged.subjectId,predicate:forged.predicate,targetId:forged.targetId,basis:forged.basis,
    ruleRef:forged.ruleRef,evidenceIds:forged.evidenceIds,premiseFactIds:forged.premiseFactIds});
  assert.throws(() => verify({ ...result, facts:[...result.facts,forged] }), {code:"F002_TECHNICAL_PREMISE_INVALID"});
});

test("F002 a deferred call cannot borrow another execution context's completed initialization premise", () => {
  const result = compile([material("context.ts", "const f=()=>1; function invoke(){f()} f();")]); verify(result);
  const call = result.facts.find(fact => fact.predicate === "callsDeclaration");
  const deferred = result.objects.filter(object => object.kind === "LOGIC_CALL" && object.name === "f").sort((a,b) => a.anchor.byteStart-b.anchor.byteStart)[0];
  const syntax = result.facts.find(fact => fact.subjectId === deferred.objectId && fact.predicate === "syntaxKind");
  const forged = { ...call, subjectId: deferred.objectId, evidenceIds: syntax.evidenceIds,
    premiseFactIds: [syntax.factId, ...call.premiseFactIds.filter(id => result.facts.find(fact => fact.factId === id).subjectId !== call.subjectId)] };
  forged.factId = createFactId({subjectId:forged.subjectId,predicate:forged.predicate,targetId:forged.targetId,basis:forged.basis,
    ruleRef:forged.ruleRef,evidenceIds:forged.evidenceIds,premiseFactIds:forged.premiseFactIds});
  assert.throws(() => verify({ ...result, facts:[...result.facts,forged] }), {code:"F002_TECHNICAL_PREMISE_INVALID"});
});

test("F002 an imported initializer has unknown module timing, while an exported declaration retains its target", () => {
  const inputs = [material("source.ts", "const f=()=>1; export {f}; export function declared(){return 1}"),
    material("use.ts", "import {f,declared} from './source.js'; f(); declared();")];
  const result = compile(inputs); verify(result);
  const calls = result.facts.filter(fact => fact.predicate === "callsDeclaration");
  assert.equal(calls.length, 1);
  assert.equal(target(result, calls[0]).name, "declared");
  assert.ok(result.gaps.some(gap => gap.code === "CALL_INITIALIZATION_ORDER_UNRESOLVED"));
  const retained = structuredClone(technicalF002Profile()); delete retained.extractionLimits.functionInitialization;
  retained.configDigest = createProfileConfigDigest(retained); retained.id = createProfileId(retained);
  const prior = compile(inputs, retained); verify(prior, retained);
  assert.equal(prior.facts.filter(fact => fact.predicate === "callsDeclaration").length, 2);
  assert.throws(() => verify(prior), {code:"F002_TECHNICAL_PREMISE_INVALID"});
});

test("F002 retained initializer-proof profile recompiles byte-identically without retroactively applying new timing", () => {
  const retained = structuredClone(technicalF002Profile()); delete retained.extractionLimits.functionInitialization;
  retained.configDigest = createProfileConfigDigest(retained); retained.id = createProfileId(retained);
  assert.equal(retained.id, "38971afb12db2c954ffb995503fb7f7f5d360309994938ccc0554dcf5e06e098");
  assert.notEqual(retained.id, technicalF002Profile().id);
  const result = compile([material("retained.ts", "f(); const f=()=>f(); function invoke(){f()} invoke();")], retained);
  verify(result, retained);
  assert.equal(result.facts.filter(fact => fact.predicate === "callsDeclaration").length, 4);
  assert.equal(createHash("sha256").update(JSON.stringify(canonicalRecords(result))).digest("hex"), "bb34cdfccea74765b41479867524653810e967e026e16d38774ea3aa42ae4281");
});
