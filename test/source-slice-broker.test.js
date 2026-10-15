import assert from "node:assert/strict";
import test from "node:test";

import { createSourceSlice, createSourceSliceRequest } from "../src/domain/index.js";
import { SourceSliceBroker } from "../src/application/source-slice-broker.js";
import { createDirectSourceAnalysisAdapter } from "../src/analysis/skill-adapters.js";

function request(overrides = {}) {
  return createSourceSliceRequest({
    projectId: "P", snapshotManifestId: "S", analysisRunId: "R", workUnitId: "W", artifactId: "A",
    range: { startByte: 0, endByte: null }, maxBytes: 65536, maxTokens: 12000, policyDigest: "POLICY", ...overrides,
  });
}

const authorized = { serviceIdentity: "worker", projectId: "P", analysisRunId: "R", workUnitArtifactIds: ["A"] };

// Independent oracle: enumerate Unicode characters, rather than inspecting UTF-8
// continuation bytes as the broker may do. Never include a partial character.
function wholeCharactersInRange(content, startByte, endByte) {
  let offset = 0;
  let selected = "";
  for (const character of content) {
    const next = offset + Buffer.byteLength(character);
    if (offset >= startByte && next <= endByte) selected += character;
    offset = next;
  }
  return selected;
}

test("SourceSlice preserves only whole UTF-8 characters at every selector and budget boundary", async () => {
  for (const content of ["中", "🙂", "A中🙂éZ", "\uFEFFé\uFFFD𐐷Z"]) {
    const bytes = Buffer.from(content);
    const broker = new SourceSliceBroker({ artifactResolver: async () => ({ disposition: "INCLUDED", content }) });
    for (let startByte = 0; startByte < bytes.length; startByte += 1) {
      for (let endByte = startByte + 1; endByte <= bytes.length; endByte += 1) {
        for (let maxBytes = 1; maxBytes <= endByte - startByte + 1; maxBytes += 1) {
          const selectedRequest = request({ range: { startByte, endByte }, maxBytes });
          const slice = await broker.read(selectedRequest, authorized);
          const cappedEnd = Math.min(endByte, startByte + maxBytes);
          const expected = wholeCharactersInRange(content, startByte, cappedEnd);
          const context = JSON.stringify({ content, startByte, endByte, maxBytes });
          assert.equal(slice.artifactSlices[0].redactedText, expected, context);
          assert.deepEqual(slice.artifactSlices[0].range, { startByte, endByte: cappedEnd }, context);
          assert.ok(Buffer.byteLength(expected) <= maxBytes, context);
          const truncated = cappedEnd < endByte || cappedEnd < bytes.length
            || Buffer.byteLength(expected) < cappedEnd - startByte;
          assert.equal(slice.truncated, truncated, context);
          assert.equal(slice.status, truncated ? "TRUNCATED" : "COMPLETE", context);
        }
      }
    }
  }
});

test("SourceSlice keeps the 64 KiB cap when it bisects a Chinese character", async () => {
  const content = `${"a".repeat(65_534)}中tail`;
  const audits = [];
  const broker = new SourceSliceBroker({
    artifactResolver: async () => ({ disposition: "INCLUDED", content }),
    auditSink: async (slice) => { audits.push(slice); },
  });
  const slice = await broker.read(request(), authorized);
  assert.equal(slice.artifactSlices[0].redactedText, "a".repeat(65_534));
  assert.equal(slice.status, "TRUNCATED");
  assert.equal(slice.truncated, true);
  assert.equal(audits.length, 1);
  assert.equal(audits[0], slice);
  assert.equal(slice.diagnostics[0].code, "SOURCE_SLICE_TRUNCATED");
});

test("SourceSlice safely reapplies the byte cap after redaction expands text", async () => {
  const content = "token=x 中🙂Z";
  const redacted = "[REDACTED:token] 中🙂Z";
  const broker = new SourceSliceBroker({ artifactResolver: async () => ({ disposition: "INCLUDED", content }) });
  for (let maxBytes = Buffer.byteLength(content); maxBytes <= Buffer.byteLength(redacted) + 1; maxBytes += 1) {
    const slice = await broker.read(request({ maxBytes }), authorized);
    assert.equal(slice.artifactSlices[0].redactedText, wholeCharactersInRange(redacted, 0, maxBytes));
    assert.ok(Buffer.byteLength(slice.artifactSlices[0].redactedText) <= maxBytes);
    assert.equal(slice.status, "REDACTED");
    assert.equal(slice.truncated, Buffer.byteLength(redacted) > maxBytes);
    assert.equal(slice.redactions.length, 1);
    assert.doesNotMatch(slice.artifactSlices[0].redactedText, /token=x|\uFFFD/);
  }
});

test("SourceSlice shares one byte budget across selectors without charging discarded partial characters", async () => {
  const artifacts = { A: "中", B: "é", C: "Z" };
  const broker = new SourceSliceBroker({
    artifactResolver: async (_project, _snapshot, artifactId) => ({ disposition: "INCLUDED", content: artifacts[artifactId] }),
  });
  const selectedRequest = request({ maxBytes: 2, selectors: ["A", "B", "C"].map((artifactId) => ({ artifactId })) });
  const slice = await broker.read(selectedRequest, { ...authorized, workUnitArtifactIds: ["A", "B", "C"] });
  assert.deepEqual(slice.artifactSlices.map(({ artifactId, redactedText }) => [artifactId, redactedText]), [["A", ""], ["B", "é"]]);
  assert.equal(slice.artifactSlices.reduce((total, { redactedText }) => total + Buffer.byteLength(redactedText), 0), 2);
  assert.equal(slice.status, "TRUNCATED");
  assert.equal(slice.truncated, true);
  assert.ok(slice.omittedReasons.includes("SOURCE_SLICE_BUDGET_EXCEEDED"));
});

test("SourceSlice rejects scope and Fact violations before reading Unicode content", async () => {
  let reads = 0;
  const audits = [];
  const broker = new SourceSliceBroker({
    artifactResolver: async () => { reads += 1; return { disposition: "INCLUDED", content: "中🙂" }; },
    auditSink: async (slice) => { audits.push(slice); },
  });
  for (const invalid of [null, { ...authorized, projectId: "FOREIGN" }, { ...authorized, analysisRunId: "FOREIGN" },
    { ...authorized, workUnitArtifactIds: [] }, { ...authorized, serviceIdentity: "" }]) {
    const slice = await broker.read(request({ maxBytes: 1 }), invalid);
    assert.equal(slice.status, "REJECTED");
    assert.equal(slice.diagnostics[0].code, "SOURCE_SLICE_SCOPE_VIOLATION");
  }
  const slice = await broker.read(request({ maxBytes: 1, allowedFactIds: ["FOREIGN-FACT"] }), authorized);
  assert.equal(slice.status, "REJECTED");
  assert.equal(slice.diagnostics[0].code, "FACT_NOT_IN_WORK_UNIT");
  assert.equal(reads, 0);
  assert.equal(audits.length, 6);
});

test("SourceSlice retains strict domain budgets rather than accepting over-budget UTF-8", () => {
  const selectedRequest = request({ maxBytes: 1_000_000, maxTokens: 1_000_000 });
  assert.equal(selectedRequest.maxBytes, 65_536);
  assert.equal(selectedRequest.maxTokens, 12_000);
  assert.throws(() => createSourceSlice(request({ maxBytes: 1 }), {
    status: "TRUNCATED", artifactSlices: [{ redactedText: "中" }],
  }), /SourceSlice exceeds request byte budget/);
});

test("SourceSlice Broker authorizes Artifact IDs, redacts secrets, and never accepts paths", async () => {
  const broker = new SourceSliceBroker({
    artifactResolver: async () => ({ disposition: "INCLUDED", content: "const apiKey = 'raw-secret';\nexport default true;" }),
  });
  const authorized = { serviceIdentity: "worker", projectId: "P", analysisRunId: "R", workUnitArtifactIds: ["A"] };
  const slice = await broker.read(request(), authorized);
  assert.equal(slice.status, "REDACTED");
  assert.doesNotMatch(slice.artifactSlices[0].redactedText, /raw-secret/);
  const rejected = await broker.read(request(), null);
  assert.equal(rejected.status, "REJECTED");
  assert.throws(() => request({ path: "/etc/passwd" }), /cannot contain path/);
});

test("a Direct-source Skill recovers an entry point with no scanner FactBundle", async () => {
  const broker = new SourceSliceBroker({
    artifactResolver: async () => ({ disposition: "INCLUDED", content: "export function deliberatelyMissedEntryPoint() {}" }),
  });
  const adapter = createDirectSourceAnalysisAdapter({
    id: "direct-reader",
    version: "1",
    async execute(input) {
      assert.equal(input.optionalFacts, null);
      assert.match(input.sourceSlices[0].content, /deliberatelyMissedEntryPoint/);
      return {
        candidateFeatures: [{
          id: "MISSED-ENTRY",
          sourceSliceIds: [input.sourceSlices[0].id],
          proposal: { name: "Missed entry point" },
        }],
      };
    },
  }, broker);
  const result = await adapter.analyze({
    projectId: "P", snapshotManifestId: "S", analysisRunId: "R", workUnitId: "W",
    sourceSliceRequests: [request()],
    authorization: { serviceIdentity: "worker", projectId: "P", analysisRunId: "R", workUnitArtifactIds: ["A"] },
    routeDecision: { selected: [{ modelCapabilityProfileId: "M", skillId: "direct-reader", skillVersion: "1" }] },
    confidenceCap: "LOW",
  });
  assert.equal(result.candidateFeatures[0].id, "MISSED-ENTRY");
  assert.equal(result.candidateFeatures[0].sourceSliceIds.length, 1);
});

test("a Direct-source Skill rejects foreign SourceSlice evidence before reconciliation", async () => {
  const broker = new SourceSliceBroker({
    artifactResolver: async () => ({ disposition: "INCLUDED", relativePath: "src/a.js", contentDigest: "sha256:a", content: "export function allowed() {}" }),
  });
  const adapter = createDirectSourceAnalysisAdapter({
    id: "direct-reader",
    version: "1",
    async execute() {
      return { candidateFeatures: [{ id: "C-FOREIGN", sourceSliceIds: ["SLICE-FOREIGN"], proposal: { name: "foreign" } }] };
    },
  }, broker);
  const result = await adapter.analyze({
    projectId: "P", snapshotManifestId: "S", analysisRunId: "R", workUnitId: "W",
    sourceSliceRequests: [request()],
    authorization: { serviceIdentity: "worker", projectId: "P", analysisRunId: "R", workUnitArtifactIds: ["A"] },
    routeDecision: { selected: [{ modelCapabilityProfileId: "M", skillId: "direct-reader", skillVersion: "1" }] },
  });
  assert.equal(result.candidateFeatures.length, 0);
  assert.equal(result.gaps[0].code, "CANDIDATE_EVIDENCE_SCOPE_VIOLATION");
});
