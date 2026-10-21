import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalDigest,
  createFactId,
  createGraphVersionId,
  createProfileConfigDigest,
  createProfileId,
  createScopeId,
  normalizeScope,
} from "../src/deterministic-facts/identity.js";

const workspaceId = "workspace-a";
const bundleId = "a".repeat(64);
const componentA = "b".repeat(64);
const componentB = "c".repeat(64);
const profileId = "d".repeat(64);

test("F002 identities exclude runtime observations and retain Workspace/component boundaries", () => {
  const basis = {
    subjectId: "subject-1", predicate: "declares", typedValue: { datatype: "string", value: "cancel" },
    evidenceIds: ["evidence-2", "evidence-1"], ruleRef: { id: "js", version: "1" }, premiseFactIds: [],
  };
  assert.equal(createFactId({ ...basis, observedAt: "2026-09-17T00:00:00.000Z" }), createFactId({ ...basis, observedAt: "2030-01-01T00:00:00.000Z" }));

  const first = createScopeId({ workspaceId, bundleId, profileId, selections: [{ kind: "ENTRY", componentId: componentA, pathBytes: "c3JjL2NhbmNlbC5qcw" }] });
  assert.notEqual(first, createScopeId({ workspaceId: "workspace-b", bundleId, profileId, selections: [{ kind: "ENTRY", componentId: componentA, pathBytes: "c3JjL2NhbmNlbC5qcw" }] }));
  assert.notEqual(first, createScopeId({ workspaceId, bundleId, profileId, selections: [{ kind: "ENTRY", componentId: componentB, pathBytes: "c3JjL2NhbmNlbC5qcw" }] }));
});

test("F002 scopes canonicalize duplicate and covered selections without merging components or path prefixes", () => {
  const normalized = normalizeScope([
    { kind: "ENTRY", componentId: componentA, pathBytes: "c3JjL2Zvbw" },
    { kind: "DIRECTORY", componentId: componentA, pathBytes: "c3Jj" },
    { kind: "ENTRY", componentId: componentA, pathBytes: "c3JjL2Zvbw" },
    { kind: "ENTRY", componentId: componentB, pathBytes: "c3JjL2Zvbw" },
  ]);
  assert.deepEqual(normalized, [
    { kind: "DIRECTORY", componentId: componentA, pathBytes: "c3Jj" },
    { kind: "ENTRY", componentId: componentB, pathBytes: "c3JjL2Zvbw" },
  ]);

  const src = createScopeId({ workspaceId, bundleId, profileId, selections: [{ kind: "DIRECTORY", componentId: componentA, pathBytes: "c3Jj" }] });
  const srcOld = createScopeId({ workspaceId, bundleId, profileId, selections: [{ kind: "DIRECTORY", componentId: componentA, pathBytes: "c3JjLW9sZA" }] });
  assert.notEqual(src, srcOld);
});

test("F002 profile and graph version identities do not hash their own identifiers or display metadata", () => {
  const profile = {
    version: "1", schemaVersion: 1, capabilityIds: ["java", "javascript"], ruleVersions: ["java@1", "js@1"],
    canonicalizationVersion: "1", extractionLimits: { maxBytes: 1024 }, redactionPolicyRevision: "policy-1",
  };
  const id = createProfileId({ ...profile, name: "Standard", startable: true });
  assert.equal(id, createProfileId({ ...profile, name: "Renamed", startable: false }));
  const configDigest = createProfileConfigDigest(profile);
  assert.equal(id, createProfileId({ ...profile, configDigest }));
  assert.throws(() => createProfileId({ ...profile, configDigest: "f".repeat(64) }), /configDigest/);

  const graph = createGraphVersionId({ workspaceId, bundleId, scopeId: "scope-1", schemaVersion: 1, ruleConfig: { id: "v1" }, records: [{ kind: "FACT", id: "f2" }, { kind: "FACT", id: "f1" }] });
  assert.equal(graph, createGraphVersionId({ workspaceId, bundleId, scopeId: "scope-1", schemaVersion: 1, ruleConfig: { id: "v1" }, records: [{ kind: "FACT", id: "f1" }, { kind: "FACT", id: "f2" }], publicationBindingId: "not-part-of-canonical-output" }));
});

test("F002 identity set ordering uses UTF-8 bytes rather than host locale collation", () => {
  const input = {
    workspaceId: "workspace", bundleId: "c".repeat(64), scopeId: "scope", schemaVersion: 1,
    ruleConfig: { rule: "v1" }, records: [{ kind: "FACT", id: "é" }, { kind: "FACT", id: "z" }],
  };
  assert.equal(
    createGraphVersionId(input),
    canonicalDigest("GRAPH_VERSION", { ...input, records: [{ kind: "FACT", id: "z" }, { kind: "FACT", id: "é" }] }),
  );
});
