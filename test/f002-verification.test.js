import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { createFactId, createProfileId } from "../src/deterministic-facts/identity.js";
import { verifyPublication } from "../src/deterministic-facts/verification.js";

const workspaceId = "workspace";
const bundleId = "b".repeat(64);
const componentId = "a".repeat(64);
const profileInput = { version: "1", schemaVersion: 1, capabilityIds: ["javascript"], ruleVersions: ["javascript@1"], canonicalizationVersion: "1", extractionLimits: { maxBytes: 1024, maxRecords: 100 }, redactionPolicyRevision: "policy-v1" };
const profile = { ...profileInput, id: createProfileId(profileInput), startable: true };

function records() {
  const bytes = Buffer.from("export function cancel() {}\n", "utf8");
  const compiled = compileDeterministicFacts({ workspaceId, bundleId, profile, materials: [{ componentId,
    pathBytes: Buffer.from("src/cancel.js").toString("base64url"), bytes, contentDigest: createHash("sha256").update(bytes).digest("hex"), mediaType: "text/javascript" }] });
  return [
    ...compiled.materials.map((payload) => ({ kind: "MATERIAL", id: payload.materialId, payload })),
    ...compiled.objects.map((payload) => ({ kind: "OBJECT", id: payload.objectId, payload })),
    ...compiled.evidence.map((payload) => ({ kind: "EVIDENCE", id: payload.evidenceId, payload })),
    ...compiled.facts.map((payload) => ({ kind: "FACT", id: payload.factId, payload })),
    ...compiled.gaps.map((payload) => ({ kind: "GAP", id: payload.gapId, payload })),
  ];
}

function setFactIdentity(record) {
  const payload = record.payload;
  record.id = payload.factId = createFactId({ subjectId: payload.subjectId, predicate: payload.predicate,
    ...(payload.kind === "RELATION" ? { targetId: payload.targetId } : { typedValue: payload.value }),
    basis: payload.basis, evidenceIds: payload.evidenceIds, ruleRef: payload.ruleRef, premiseFactIds: payload.premiseFactIds });
  return record;
}

test("F002 publication accepts only identity-bound records with closed evidence references", () => {
  const valid = records();
  assert.doesNotThrow(() => verifyPublication({ workspaceId, bundleId, scopeId: "scope", profile, records: valid }));

  const invented = structuredClone(valid);
  invented.find((record) => record.kind === "FACT").id = "not-a-hash";
  assert.throws(() => verifyPublication({ workspaceId, bundleId, scopeId: "scope", profile, records: invented }), { code: "F002_RECORD_ID_INVALID" });

  const noEvidence = structuredClone(valid);
  const fact = noEvidence.find((record) => record.kind === "FACT");
  fact.payload.evidenceIds = [];
  fact.id = fact.payload.factId = createFactId({ subjectId: fact.payload.subjectId, predicate: fact.payload.predicate, typedValue: fact.payload.value,
    basis: fact.payload.basis, evidenceIds: [], ruleRef: fact.payload.ruleRef, premiseFactIds: fact.payload.premiseFactIds });
  assert.throws(() => verifyPublication({ workspaceId, bundleId, scopeId: "scope", profile, records: noEvidence }), { code: "F002_RECORD_EVIDENCE_REQUIRED" });
});

test("F002 publication rejects self-consistent facts outside the fixed vocabulary and installed rules", () => {
  for (const delta of [
    { predicate: "inventedBusinessTruth", code: "F002_RECORD_VOCABULARY_INVALID" },
    { basis: "GUESSED", code: "F002_RECORD_VOCABULARY_INVALID" },
    { ruleRef: { id: "f002-javascript", version: "999" }, code: "F002_RECORD_RULE_INVALID" },
  ]) {
    const invalid = records();
    const fact = invalid.find((record) => record.kind === "FACT");
    const payload = { ...fact.payload, ...delta };
    fact.payload = payload;
    setFactIdentity(fact);
    assert.throws(() => verifyPublication({ workspaceId, bundleId, scopeId: "scope", profile, records: invalid }), { code: delta.code });
  }
});

test("F002 publication validates predicate object domain/range and rejects premise cycles before identity closure", () => {
  const invalidDomain = records();
  const functions = invalidDomain.filter((record) => record.kind === "OBJECT" && record.payload.kind === "FUNCTION");
  const materialRoot = invalidDomain.find((record) => record.kind === "OBJECT" && record.payload.kind === "MATERIAL");
  const sourceFact = invalidDomain.find((record) => record.kind === "FACT");
  assert.equal(functions.length >= 1, true);
  const staticCall = { kind: "FACT", id: "", payload: {
    factId: "", kind: "RELATION", subjectId: materialRoot.id, predicate: "staticCalls", targetId: functions[0].id,
    basis: "DERIVED", evidenceIds: sourceFact.payload.evidenceIds, ruleRef: sourceFact.payload.ruleRef, premiseFactIds: [],
  } };
  setFactIdentity(staticCall);
  invalidDomain.push(staticCall);
  assert.throws(() => verifyPublication({ workspaceId, bundleId, scopeId: "scope", profile, records: invalidDomain }), { code: "F002_RECORD_VOCABULARY_INVALID" });

  const cyclic = records();
  const template = cyclic.find((record) => record.kind === "FACT");
  const firstId = "a".repeat(64), secondId = "b".repeat(64);
  for (const [id, premiseFactIds] of [[firstId, [secondId]], [secondId, [firstId]]]) cyclic.push({ kind: "FACT", id, payload: {
    ...template.payload, factId: id, premiseFactIds,
  } });
  assert.throws(() => verifyPublication({ workspaceId, bundleId, scopeId: "scope", profile, records: cyclic }), { code: "F002_RECORD_PREMISE_CYCLE" });
});

test("F002 publication validates the actual typed property value without rejecting an empty string", () => {
  for (const value of [{ datatype: "string", value: 42 }, { datatype: "string" }]) {
    const invalid = records();
    const fact = invalid.find((record) => record.kind === "FACT");
    fact.payload = { ...fact.payload, value };
    setFactIdentity(fact);
    assert.throws(() => verifyPublication({ workspaceId, bundleId, scopeId: "scope", profile, records: invalid }), { code: "F002_RECORD_VALUE_INVALID" });
  }

  const valid = records();
  const fact = valid.find((record) => record.kind === "FACT");
  fact.payload = { ...fact.payload, value: { datatype: "string", value: "" } };
  setFactIdentity(fact);
  assert.doesNotThrow(() => verifyPublication({ workspaceId, bundleId, scopeId: "scope", profile, records: valid }));
});
