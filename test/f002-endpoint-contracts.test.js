import assert from "node:assert/strict";
import test from "node:test";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";
import { createFactId } from "../src/deterministic-facts/identity.js";
import { standardF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";
import { vocabularyFor } from "../src/deterministic-facts/vocabulary.js";
import { readFileSync } from "node:fs";

const workspaceId = "workspace", bundleId = "b".repeat(64), componentId = "a".repeat(64);
const profile = limits => ({ ...structuredF002Profile(), id: "c".repeat(64), extractionLimits: { ...structuredF002Profile().extractionLimits, endpointContracts: "component-path-shape-v1", ...limits } });
const material = (path, text, component = componentId) => ({ componentId: component, pathBytes: Buffer.from(path).toString("base64url"), bytes: Buffer.from(text), mediaType: "application/octet-stream" });
const spec = (path = "/api/orders/{id}", method = "get", file = "api.json", component = componentId) => material(file, JSON.stringify({ openapi: "3.0.3", paths: { [path]: { [method]: { responses: { "200": { description: "declared" } } } } } }), component);
const js = (path = "/api/orders/:id", extra = "", file = "routes.js", component = componentId) => material(file, `import express from 'express';\r\nconst app=express();\r\nfunction handler(){}\r\napp.get('${path}',handler);\r\n${extra}`, component);
const compile = (materials = [spec(), js()], limits) => compileDeterministicFacts({ workspaceId, bundleId, profile: profile(limits), materials });
const matches = r => r.facts.filter(f => f.predicate === "matchesEndpointContract");
const valid = (r, limits) => normalizeCanonicalRecords(canonicalRecords(r), { workspaceId, bundleId, profile: profile(limits) });
const codes = r => r.gaps.map(g => g.code);

test("F002 endpoint contract matching is fixed-profile opt-in and never backfilled into retained standard rules", () => {
  assert.equal(standardF002Profile().extractionLimits.endpointContracts, undefined);
  assert.equal(structuredF002Profile().extractionLimits.endpointContracts, "component-path-shape-v1");
  assert.equal(matches(compile(undefined, { endpointContracts: undefined })).length, 0);
});

test("F002 unique same-component OpenAPI Express path-shape match retains four actual source premises", () => {
  const r = compile(), matched = matches(r); assert.equal(matched.length, 1);
  const f = matched[0], source = r.objects.find(o => o.objectId === f.subjectId), target = r.objects.find(o => o.objectId === f.targetId);
  assert.equal(source.kind, "OPENAPI_OPERATION"); assert.equal(target.kind, "ROUTE"); assert.equal(target.name, "GET /api/orders/:id");
  assert.equal(f.basis, "DERIVED"); assert.equal(f.premiseFactIds.length, 4);
  const premises = f.premiseFactIds.map(id => r.facts.find(p => p.factId === id));
  assert.equal(premises.filter(p => p.subjectId === source.objectId).length, 2); assert.equal(premises.filter(p => p.subjectId === target.objectId).length, 2);
  assert.ok(premises.some(p => p.predicate === "effectivePath")); valid(r);
});

test("F002 Spring contract matching uses composed route path rather than annotation name similarity", () => {
  const java = material("Controller.java", 'import org.springframework.web.bind.annotation.RestController;\r\nimport org.springframework.web.bind.annotation.RequestMapping;\r\nimport org.springframework.web.bind.annotation.GetMapping;\r\n@RestController\r\n@RequestMapping("/api")\r\nclass Orders {\r\n @GetMapping("/orders/{id}")\r\n String read(){return "x";}\r\n}\r\n');
  const r = compile([spec(), java]); assert.equal(matches(r).length, 1); assert.equal(matches(r)[0].premiseFactIds.length, 4); valid(r);
});

test("F002 cross-component identical declarations never grant a contract relation", () => {
  const r = compile([spec(), js(undefined, "", "routes.js", "d".repeat(64))]); assert.equal(matches(r).length, 0); assert.ok(codes(r).includes("ENDPOINT_CONTRACT_TARGET_UNRESOLVED"));
});

test("F002 method case-sensitive paths and trailing slash are not guessed equivalent", () => {
  for (const contract of [spec(undefined, "post"), spec("/api/Orders/{id}"), spec("/api/orders/{id}/")]) {
    const r = compile([contract, js()]); assert.equal(matches(r).length, 0); assert.ok(codes(r).includes("ENDPOINT_CONTRACT_TARGET_UNRESOLVED"));
  }
});

test("F002 duplicate supported route occurrences preserve bounded candidate identities without a first-target edge", () => {
  const r = compile([spec(), js(undefined, "app.get('/api/orders/:id',handler);\r\n")]); assert.equal(matches(r).length, 0);
  const gap = r.gaps.find(g => g.code === "ENDPOINT_CONTRACT_AMBIGUOUS"); assert.ok(gap); assert.equal(gap.reason.candidateObjectIds.length, 2);
  assert.ok(gap.reason.candidateObjectIds.every(id => r.objects.some(o => o.objectId === id && o.kind === "ROUTE"))); valid(r);
});

test("F002 duplicate contract declarations cannot pretend a code declaration binds one authoritative API document", () => {
  const r = compile([spec(), spec(undefined, "get", "other-api.json"), js()]); assert.equal(matches(r).length, 0); assert.equal(r.gaps.filter(g => g.code === "ENDPOINT_CONTRACT_AMBIGUOUS").length, 2);
});

test("F002 unmounted router relative declaration is not an application-root contract path", () => {
  const r = compile([spec("/orders/{id}"), material("router.js", "import express from 'express';const router=express.Router();function handler(){}router.get('/orders/:id',handler);")]);
  assert.equal(matches(r).length, 0); assert.ok(codes(r).includes("ENDPOINT_CONTRACT_TARGET_UNRESOLVED"));
});

test("F002 path normalization is positional and does not decode routes or infer regex patterns", () => {
  const r = compile([spec("/api/orders/{orderId}"), js()]); assert.equal(matches(r).length, 1); valid(r);
  for (const path of ["/api//orders/{id}", "/api/../orders/{id}", "/api/orders/{id:[0-9]+}", "/api/orders/%69d", "/api/orders/*"]) {
    const r = compile([spec(path), js()]); assert.equal(matches(r).length, 0); assert.ok(codes(r).includes("ENDPOINT_CONTRACT_PATH_UNSUPPORTED"), path);
  }
});

test("F002 conditioned paths from two different Express applications retain ambiguity even when the target object is the same", () => {
  const r = compile([spec(), material("routers.js", "import express from 'express';const app=express();const second=express();const router=express.Router();function handler(){}router.get('/orders/:id',handler);app.use('/api',router);second.use('/api',router);")]);
  assert.equal(matches(r).length, 0); assert.ok(codes(r).includes("ENDPOINT_CONTRACT_AMBIGUOUS"));
});

test("F002 fixed endpoint declaration budgets do not publish a partial successful match set", () => {
  const r = compile(undefined, { maxEndpointDeclarations: 1 }); assert.equal(matches(r).length, 0); assert.ok(codes(r).includes("ENDPOINT_CONTRACT_LIMIT"));
});

test("F002 endpoint contract vocabulary explicitly refuses deployment reachability or business-equivalence claims", () => {
  const r = compile(), v = vocabularyFor({ profile: profile(), records: canonicalRecords(r) });
  const word = v.predicates.find(p => p.predicate === "matchesEndpointContract"); assert.ok(word); assert.match(word.meaning, /组件/); assert.match(word.meaning, /不证明/);
});

test("F002 endpoint publication rejects identity-rehashed cross-method retargeting", () => {
  const r = compile([spec(), js(undefined, "app.post('/api/orders/:id',handler);\r\n")]), f = matches(r)[0]; assert.ok(f);
  const wrong = r.objects.find(o => o.kind === "ROUTE" && o.name.startsWith("POST")); assert.ok(wrong);
  const records = canonicalRecords(r).map(record => {
    if (record.id !== f.factId) return record;
    const p = { ...record.payload, targetId: wrong.objectId }, id = createFactId({ subjectId: p.subjectId, predicate: p.predicate, targetId: p.targetId, basis: p.basis, evidenceIds: p.evidenceIds, ruleRef: p.ruleRef, premiseFactIds: p.premiseFactIds });
    return { ...record, id, payload: { ...p, factId: id } };
  });
  assert.throws(() => normalizeCanonicalRecords(records, { workspaceId, bundleId, profile: profile() }), /合同|端点|前提/);
});

test("F002 OpenAPI server URL and local directory are not inferred application or base-path bindings", () => {
  const input = material("same-dir-api.json", JSON.stringify({ openapi: "3.0.3", servers: [{ url: "https://invalid.example/api" }], paths: { "/orders/{id}": { get: {} } } }));
  const r = compile([input, js()]); assert.equal(matches(r).length, 0); assert.ok(codes(r).includes("ENDPOINT_CONTRACT_TARGET_UNRESOLVED"));
});

test("F002 contract match output is independent of material processing order", () => {
  const inputs = [spec(), js()], a = compile(inputs), b = compile([...inputs].reverse()); assert.equal(matches(a).length, 1);
  assert.deepEqual(canonicalRecords(a), canonicalRecords(b));
});

test("F002 endpoint publication rejects ambiguity even with a correctly rehashed four-premise candidate edge", () => {
  const r = compile([spec(), js(undefined, "app.get('/api/orders/:id',handler);\r\n")]);
  const source = r.objects.find(o => o.kind === "OPENAPI_OPERATION"), target = r.objects.find(o => o.kind === "ROUTE"), property = (o, p) => r.facts.find(f => f.subjectId === o.objectId && f.predicate === p);
  const p = { kind: "RELATION", subjectId: source.objectId, predicate: "matchesEndpointContract", targetId: target.objectId, basis: "DERIVED", evidenceIds: property(source, "path").evidenceIds, ruleRef: { id: "f002-json", version: "2" },
    premiseFactIds: [property(source, "path").factId, property(source, "httpMethod").factId, property(target, "effectivePath").factId, property(target, "httpMethod").factId] };
  const id = createFactId({ subjectId: p.subjectId, predicate: p.predicate, targetId: p.targetId, basis: p.basis, evidenceIds: p.evidenceIds, ruleRef: p.ruleRef, premiseFactIds: p.premiseFactIds });
  assert.throws(() => normalizeCanonicalRecords([...canonicalRecords(r), { kind: "FACT", id, payload: { ...p, factId: id } }], { workspaceId, bundleId, profile: profile() }), /合同|候选/);
});

test("F002 new contract browser verification runs after actual page authentication and selection", () => {
  const s = readFileSync(new URL("./support/f002-structure-browser.mjs", import.meta.url), "utf8");
  assert.ok(s.indexOf("await verifyContractBrowser();") > s.indexOf("await page.goto(`${web}${href}`); await authenticate();"));
  assert.ok(s.indexOf("await verifyContractBrowser();") > s.indexOf('const button = page.locator(`[data-directory-object="${selected.id}"] > button`)'));
});
