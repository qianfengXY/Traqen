import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createF002Runtime, technicalF002Profile } from "../src/deterministic-facts/runtime.js";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { verifyPublication } from "../src/deterministic-facts/verification.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { isolatedPostgres } from "./support/source-truth-postgres.js";
import { owner } from "./support/source-truth-database.js";
import { SourceTruthRepository } from "../src/source-truth/repository.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";
import { SourceCandidateService } from "../src/source-truth/candidate-service.js";

// Same 24 exact Git blobs as the independent pilot, not a replacement toy
// source and not the coordinator's live/owned pilot database or blob store.
const manifest = JSON.parse(readFileSync(new URL("./fixtures/f002/fixed-pilot-materials.json", import.meta.url)));
const files = manifest.files.map(([entryPath, expected]) => {
  const content = execFileSync("git", ["show", `${manifest.baseline}:${entryPath}`], { cwd: new URL("../", import.meta.url) });
  const digest = createHash("sha256").update(content).digest("hex");
  assert.equal(digest, expected, entryPath);
  return { entryPath, content, digest };
});
assert.equal(files.length, 24); assert.equal(files.reduce((size, file) => size + file.content.length, 0), 403345);
const directoryPaths = ["src", "src/auth", "src/source-truth", "docs", "docs/design",
  "docs/design/F001-workspace-source-truth", "docs/design/F008-unified-login-space-permissions", "test"];

test("F002 every fixed pilot source and the complete 24-source compilation pass the production publication boundary", () => {
  const profile = technicalF002Profile(), workspaceId = "workspace", bundleId = "b".repeat(64), componentId = "a".repeat(64);
  const materials = files.map(file => ({ componentId, pathBytes: Buffer.from(file.entryPath).toString("base64url"), mediaType: "text/plain", bytes: file.content, contentDigest: file.digest }));
  const check = inputs => {
    const result = compileDeterministicFacts({ workspaceId, bundleId, profile, materials: inputs });
    verifyPublication({ workspaceId, bundleId, profile, scopeId: "d".repeat(64), records: canonicalRecords(result) });
    return result;
  };
  for (const material of materials) assert.doesNotThrow(() => check([material]), Buffer.from(material.pathBytes, "base64url").toString());
  const combined = check(materials);
  assert.equal(combined.materials.length, 24);
  assert.ok(combined.facts.some(fact => fact.predicate === "bindingFunction"));
});

// This is two complete real-source operations (publication and recompilation),
// not a parser-unit deadline. Product parser/record/lease budgets stay unchanged.
test("F002 actual native-PG F001 freeze of the same 24 blobs automatically publishes and replays MATCH", { timeout: 900000 }, async t => {
  const cluster = await isolatedPostgres(t);
  let databaseName;
  const source = await candidateFixture(t, { database: async () => { const result = await cluster.createDatabase(); databaseName = result.name; return result; }, entryPath: files[0].entryPath, content: files[0].content,
    additionalFiles: files.slice(1), directoryPaths });
  const prepared = await source.candidates.prepare(source.context);
  await source.advance("RECONCILING", "REVIEW_REQUIRED");
  const publisher = new SourcePublicationService(source.repository, source.candidates);
  const confirmation = await publisher.confirm(owner, source.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId });
  const frozen = await publisher.seal(owner, source.context, { confirmationId: confirmation.id, clientToken: "fixed-pilot-source" });
  const runtime = await createF002Runtime({ sourceRuntime: { pool: source.db,
    services: { repository: source.repository, admission: new SourceAdmissionService(source.repository, source.candidates) },
    configuration: { members: [{ ...owner, tokenDigest: "a".repeat(64) }], origins: [] } }, cursorSecret: "fixed-pilot-owned-cursor" });
  t.after(() => runtime.close());
  const reference = { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id };
  const inventory = await runtime.services.admission.sourceAdmission.inventory(owner, "workspace", reference);
  assert.equal(inventory.nextCursor, null);
  const verified = inventory.items.filter(item => item.disposition?.disposition === "VERIFIED");
  assert.equal(verified.length, 24);
  for (const file of files) assert.equal(verified.find(item => Buffer.from(item.entry.pathBytes, "base64url").toString() === file.entryPath)?.disposition.digest, file.digest);
  const componentId = verified[0].componentId;
  const run = await runtime.services.admission.start(owner, "workspace", { operationId: "fixed-pilot-technical", reference, profile: technicalF002Profile(),
    scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  await runtime.services.executor.enqueue(run);
  const scope = await runtime.services.repository.getScope(owner, "workspace", run.id, run.scopes[0].scopeId);
  assert.equal(scope.status, "SEALED", JSON.stringify(scope));
  const rows = (await source.db.query("SELECT kind,id,payload FROM f002_record WHERE graph_version_id=$1", [scope.graphVersionId])).rows;
  // MATERIAL is the complete selected inventory, including metadata-only
  // directories. Never drop those eight entries to make a file count pass.
  const materials = rows.filter(row => row.kind === "MATERIAL");
  const location = item => `${item.componentId}:${item.pathBytes}`;
  const byLocation = new Map(materials.map(row => [location(row.payload), row]));
  assert.equal(materials.length, 32);
  assert.equal(byLocation.size, 32);
  assert.deepEqual([...byLocation.keys()].sort(), inventory.items.map(item => location({ componentId: item.componentId, pathBytes: item.entry.pathBytes })).sort());
  assert.equal(materials.filter(row => row.payload.contentAvailable).length, 24);
  for (const file of files) {
    const row = byLocation.get(location({ componentId, pathBytes: Buffer.from(file.entryPath).toString("base64url") }));
    assert.equal(row.payload.contentAvailable, true, file.entryPath);
    assert.equal(row.payload.contentDigest, file.digest, file.entryPath);
  }
  const directories = inventory.items.filter(item => item.entry.kind === "DIRECTORY");
  assert.deepEqual(directories.map(item => Buffer.from(item.entry.pathBytes, "base64url").toString()).sort(), [...directoryPaths].sort());
  assert.equal(materials.filter(row => !row.payload.contentAvailable).length, 8);
  for (const directory of directories) {
    assert.equal(directory.disposition.disposition, "METADATA");
    const row = byLocation.get(location({ componentId: directory.componentId, pathBytes: directory.entry.pathBytes }));
    assert.equal(row.payload.contentAvailable, false);
    assert.equal(row.payload.contentDigest, null);
    assert.equal(row.payload.unavailableCode, "DIRECTORY_RECORDED");
    assert.ok(rows.some(gap => gap.kind === "GAP" && gap.payload.materialId === row.id && gap.payload.code === "DIRECTORY_RECORDED"));
  }
  const objects = new Map(rows.filter(row => row.kind === "OBJECT").map(row => [row.id, row.payload]));
  const reading = rows.find(row => row.kind === "MATERIAL" && row.payload.pathBytes === Buffer.from("src/source-truth/material-reading.js").toString("base64url"));
  const audit = rows.filter(row => row.kind === "FACT" && row.payload.predicate === "callsDeclaration"
    && objects.get(row.payload.subjectId).materialId === reading.id && objects.get(row.payload.subjectId).name === "audit");
  assert.equal(audit.length, 3);
  assert.ok(audit.every(row => objects.get(row.payload.targetId).name === "anonymous"));
  const original = await runtime.services.materials.read(owner, "workspace", scope.graphVersionId, reading.id);
  assert.equal(original.originalDigest, files.find(file => file.entryPath === "src/source-truth/material-reading.js").digest);
  assert.equal(original.redacted, false);
  assert.equal(createHash("sha256").update(original.bytes).digest("hex"), original.originalDigest);
  const replay = await runtime.services.replays.replay(owner, "workspace", scope.graphVersionId);
  assert.equal(replay.status, "MATCH", JSON.stringify(replay));
  const sealed = await runtime.services.repository.getScope(owner, "workspace", run.id, scope.scopeId);
  assert.equal(sealed.graphVersionId, scope.graphVersionId);
  await runtime.close();
  await cluster.restart();
  const restartedPool = cluster.pool(databaseName);
  const restartedSource = new SourceTruthRepository(restartedPool);
  const restartedCandidates = new SourceCandidateService(restartedSource, new SourceMaterialRepository(restartedSource), source.blobs);
  const restarted = await createF002Runtime({ sourceRuntime: { pool: restartedPool,
    services: { repository: restartedSource, admission: new SourceAdmissionService(restartedSource, restartedCandidates) },
    configuration: { members: [{ ...owner, tokenDigest: "a".repeat(64) }], origins: [] } }, cursorSecret: "fixed-pilot-owned-cursor" });
  t.after(() => restarted.close());
  const restored = await restarted.services.repository.getScope(owner, "workspace", run.id, scope.scopeId);
  assert.equal(restored.status, "SEALED");
  assert.equal(restored.graphVersionId, scope.graphVersionId);
  const restoredOriginal = await restarted.services.materials.read(owner, "workspace", scope.graphVersionId, reading.id);
  assert.deepEqual(restoredOriginal.bytes, original.bytes);
  assert.equal(restoredOriginal.originalDigest, original.originalDigest);
  const restoredRecord = await restarted.services.queries.record(owner, "workspace", scope.graphVersionId, "FACT", audit[0].id);
  assert.equal(restoredRecord.record.id, audit[0].id);
  assert.equal(Number((await restartedPool.query("SELECT count(*) AS count FROM f002_record WHERE graph_version_id=$1", [scope.graphVersionId])).rows[0].count), rows.length);
  console.log(JSON.stringify({ scope: "ISOLATED_FIXED_24_REAL_SOURCE_NATIVE_PG", baseline: manifest.baseline, files: files.length, bytes: 403345,
    bundleId: reference.bundleId, profileId: technicalF002Profile().id, graphVersionId: scope.graphVersionId, records: rows.length,
    materials: materials.length, verifiedFiles: verified.length, metadataDirectories: directories.length,
    auditCalls: audit.length, status: scope.status, replay: replay.status, nativePgRestart: true, restartedExactRecord: audit[0].id,
    originalDigest: original.originalDigest }));
});
