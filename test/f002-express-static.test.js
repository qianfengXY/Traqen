import assert from "node:assert/strict";
import test from "node:test";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";
import { createFactId } from "../src/deterministic-facts/identity.js";
import { standardF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";

const workspaceId = "workspace", bundleId = "b".repeat(64);
const profile = limits => ({ id: "c".repeat(64), version: "2", ruleVersions: ["javascript@2"], extractionLimits: { javascriptBindings: "lexical-bindings-v1", expressStatic: "top-level-literals-v1", ...limits } });
const compile = (source, limits) => compileDeterministicFacts({ workspaceId, bundleId, profile: profile(limits), materials: [{ componentId: "a".repeat(64), pathBytes: Buffer.from("routes.js").toString("base64url"), bytes: Buffer.from(source), mediaType: "text/javascript" }] });
const prefix = "import express from 'express'; const app = express(); const router = express.Router(); function handler() {} ";
const effective = r => r.facts.filter(f => f.predicate === "effectivePath");

test("F002 static Express profile is opt-in without changing historical route output", () => {
  assert.equal(standardF002Profile().extractionLimits.expressStatic, undefined);
  assert.equal(structuredF002Profile().extractionLimits.expressStatic, "top-level-literals-v1");
});

test("F002 static Express application routes and handlers list actual declaration premises", () => {
  const result = compile(prefix + "app.get('/health', handler);");
  assert.deepEqual(effective(result).map(f => f.value.value), ["/health"]);
  const route = result.objects.find(o => o.kind === "ROUTE"); assert.ok(route);
  assert.equal(result.objects.find(o => o.objectId === route.parentId).kind, "EXPRESS_ROUTER");
  const binding = result.facts.find(f => f.predicate === "handlesRoute"); assert.ok(binding); assert.ok(binding.premiseFactIds.length >= 3);
  normalizeCanonicalRecords(canonicalRecords(result), { workspaceId, bundleId, profile: profile() });
});

test("F002 static Express nested literal mount paths retain each mount and original route declaration", () => {
  const result = compile(prefix + "const child = express.Router(); app.use('/api', router); router.use('/v1', child); child.post('/orders/:id', handler);");
  assert.deepEqual(effective(result).map(f => f.value.value), ["/api/v1/orders/:id"]);
  assert.equal(result.facts.filter(f => f.predicate === "mountsRouter").length, 2);
  const route = result.objects.find(o => o.kind === "ROUTE"); assert.equal(route.name, "POST /orders/:id");
  assert.ok(result.facts.some(f => f.subjectId === route.objectId && f.predicate === "path" && f.value.value === "/orders/:id"));
  assert.ok(effective(result)[0].premiseFactIds.filter(id => result.facts.find(f => f.factId === id)?.predicate === "mountsRouter").length === 2);
  normalizeCanonicalRecords(canonicalRecords(result), { workspaceId, bundleId, profile: profile() });
});

test("F002 static Express multiple explicit mounts retain separate conditioned paths rather than first-match selection", () => {
  const result = compile(prefix + "app.use('/one', router); app.use('/two', router); router.get('/item', handler);");
  assert.deepEqual(effective(result).map(f => f.value.value).sort(), ["/one/item", "/two/item"]);
  assert.notDeepEqual(effective(result)[0].premiseFactIds, effective(result)[1].premiseFactIds);
});

test("F002 unmounted routers retain path declarations but cannot invent an application-root path", () => {
  const result = compile(prefix + "router.get('/item', handler);"); assert.equal(effective(result).length, 0);
  assert.ok(result.objects.some(o => o.kind === "ROUTE")); assert.ok(result.gaps.some(g => g.code === "EXPRESS_ROUTER_NOT_MOUNTED"));
});

test("F002 static Express imports must be actual factory bindings rather than lookalike get or Router properties", () => {
  for (const source of ["const express = pretend; const app=express(); app.get('/x', handler);", "import other from 'other'; const app=other(); app.get('/x', handler);", "import express from 'express'; express=other; const app=express(); app.get('/x', handler);"]) {
    const result = compile(source); assert.equal(result.objects.some(o => o.kind === "ROUTE"), false); assert.equal(effective(result).length, 0);
  }
});

test("F002 static Express receiver initialization and mutation cannot be hidden by route spelling", () => {
  for (const suffix of ["router=other; router.get('/x', handler); app.use('/base', router);", "app.get('/x', handler); app=other;"]) {
    const result = compile(prefix + suffix); assert.equal(effective(result).length, 0); assert.ok(result.gaps.some(g => g.code === "EXPRESS_BINDING_MUTABLE"));
  }
  const early = compile("import express from 'express'; app.get('/x', handler); const app=express(); function handler() {}");
  assert.equal(effective(early).length, 0); assert.ok(early.gaps.some(g => g.code === "EXPRESS_INITIALIZATION_UNPROVEN"));
});

test("F002 conditional and nested setup cannot pretend to be unconditional static mounts", () => {
  for (const suffix of ["if (flag) app.use('/base',router); router.get('/x',handler);", "function setup(router) { router.get('/fake',handler); } app.use('/base',router);"]) {
    const result = compile(prefix + suffix); assert.equal(effective(result).length, 0); assert.ok(result.gaps.some(g => g.code === "EXPRESS_SETUP_SCOPE_UNSUPPORTED"));
  }
});

test("F002 dynamic paths complex middleware options and patterns remain explicit restrictions", () => {
  for (const suffix of ["app.use(base,router); router.get('/x',handler);", "app.use('/base',middleware,router); router.get('/x',handler);", "app.get('/x',middleware,handler);", "app.get('/ab?cd',handler);", "const configured=express.Router({mergeParams:true}); app.use('/base',configured);"]) {
    const result = compile(prefix + suffix); assert.equal(effective(result).length, 0); assert.ok(result.gaps.some(g => g.code.startsWith("EXPRESS_") && g.code.includes("UNSUPPORTED")), suffix);
  }
});

test("F002 mount cycles and deterministic expansion budgets cannot publish a partial inferred path set", () => {
  const cycle = compile(prefix + "const child=express.Router(); app.use('/a',router); router.use('/b',child); child.use('/c',router); child.get('/x',handler);");
  assert.equal(effective(cycle).length, 0); assert.ok(cycle.gaps.some(g => g.code === "EXPRESS_MOUNT_CYCLE"));
  const bounded = compile(prefix + "app.use('/one',router); app.use('/two',router); router.get('/x',handler);", { maxExpressPaths: 1 });
  assert.equal(effective(bounded).length, 0); assert.ok(bounded.gaps.some(g => g.code === "EXPRESS_EXPANSION_LIMIT"));
});

test("F002 unresolved or written handlers do not gain a certain handlesRoute relation", () => {
  for (const suffix of ["app.get('/x', unknown);", "handler=unknown; app.get('/x',handler);"]) {
    const result = compile(prefix + suffix); assert.equal(result.facts.some(f => f.predicate === "handlesRoute"), false); assert.ok(result.gaps.some(g => g.code === "EXPRESS_HANDLER_UNRESOLVED"));
  }
});

test("F002 publication independently rejects a forged mounted path with recomputed identity", () => {
  const result = compile(prefix + "app.use('/api',router); router.get('/x',handler);"); assert.equal(effective(result).length, 1);
  const records = canonicalRecords(result).map(r => { if (r.kind !== "FACT" || r.payload.predicate !== "effectivePath") return r; const p = { ...r.payload, value: { datatype: "string", value: "/invented" } }; const id = createFactId({ subjectId: p.subjectId, predicate: p.predicate, typedValue: p.value, basis: p.basis, evidenceIds: p.evidenceIds, ruleRef: p.ruleRef, premiseFactIds: p.premiseFactIds }); return { ...r, id, payload: { ...p, factId: id } }; });
  assert.throws(() => normalizeCanonicalRecords(records, { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_PREMISE_REQUIRED" });
});

test("F002 overwritten Express receiver methods or factories cannot be treated as original bindings", () => {
  for (const suffix of ["app.get=other; app.get('/x',handler);", "router.use=other; app.use('/a',router); router.get('/x',handler);"]) {
    const result = compile(prefix + suffix); assert.equal(effective(result).length, 0); assert.ok(result.gaps.some(g => g.code === "EXPRESS_RECEIVER_MUTATION_UNSUPPORTED"));
  }
  const factory = compile("import express from 'express'; express.Router=other; const app=express(); const router=express.Router(); function handler(){} app.use('/a',router); router.get('/x',handler);");
  assert.equal(effective(factory).length, 0); assert.ok(factory.gaps.some(g => g.code === "EXPRESS_FACTORY_MUTATION_UNSUPPORTED"));
});

test("F002 router aliases and unknown receiver escapes cannot silently conceal mutable setup", () => {
  for (const suffix of ["const alias=router; alias.get=other; app.use('/a',router); router.get('/x',handler);", "configure(router); app.use('/a',router); router.get('/x',handler);"]) {
    const result = compile(prefix + suffix); assert.equal(effective(result).length, 0); assert.ok(result.gaps.some(g => g.code === "EXPRESS_RECEIVER_ESCAPE_UNSUPPORTED"));
  }
});

test("F002 delete and nested argument or return escapes remain explicit unsupported mutable setup", () => {
  for (const suffix of ["delete app.get; app.get('/x',handler);", "configure({value:router}); app.use('/a',router); router.get('/x',handler);", "function expose(){return [router];} app.use('/a',router); router.get('/x',handler);"]) {
    const result = compile(prefix + suffix); assert.equal(effective(result).length, 0); assert.ok(result.gaps.some(g => ["EXPRESS_RECEIVER_MUTATION_UNSUPPORTED", "EXPRESS_RECEIVER_ESCAPE_UNSUPPORTED"].includes(g.code)), suffix);
  }
});

test("F002 escaped Express factory objects cannot be presumed to retain their constructors", () => {
  for (const before of ["configure(express);", "const alias=express; alias.Router=other;"]) {
    const result = compile("import express from 'express'; " + before + " const app=express(); const router=express.Router(); function handler(){} app.use('/a',router); router.get('/x',handler);");
    assert.equal(effective(result).length, 0); assert.ok(result.gaps.some(g => g.code === "EXPRESS_FACTORY_ESCAPE_UNSUPPORTED"));
  }
});

test("F002 publication rejects unknown router declaration categories rather than treating them as a factory", () => {
  const result = compile(prefix);
  const records = canonicalRecords(result).map(r => { if (r.kind !== "FACT" || r.payload.predicate !== "routerKind") return r; const p = { ...r.payload, value: { datatype: "string", value: "guessed-framework" } }; const id = createFactId({ subjectId: p.subjectId, predicate: p.predicate, typedValue: p.value, basis: p.basis, evidenceIds: p.evidenceIds, ruleRef: p.ruleRef, premiseFactIds: p.premiseFactIds }); return { ...r, id, payload: { ...p, factId: id } }; });
  assert.throws(() => normalizeCanonicalRecords(records, { workspaceId, bundleId, profile: profile() }), { code: "F002_RECORD_VOCABULARY_INVALID" });
});
