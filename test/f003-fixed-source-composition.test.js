import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createF002Runtime, technicalF002Profile } from "../src/deterministic-facts/runtime.js";
import { InvestigationService } from "../src/business-knowledge/investigation-service.js";
import { InvestigationWorker } from "../src/business-knowledge/worker.js";
import { SourceTruthRepository } from "../src/source-truth/repository.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";
import { SourceCandidateService } from "../src/source-truth/candidate-service.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { canonicalEncode } from "../src/source-truth/identity.js";
import { investigationFixture } from "./support/f003-investigation-fixture.js";
import { isolatedPostgres } from "./support/source-truth-postgres.js";
import { owner } from "./support/source-truth-database.js";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const profileId = "6fedd46325aa1b9af809f65c19892d0c572599461f2cd7647fdd09e3e4f2d695";
const manifest = JSON.parse(readFileSync(new URL("./fixtures/f002/fixed-pilot-materials.json", import.meta.url)));
const files = manifest.files.map(([entryPath, expected]) => {
  const content = execFileSync("git", ["show", `${manifest.baseline}:${entryPath}`], { cwd: new URL("../", import.meta.url) });
  assert.equal(digest(content), expected, entryPath);
  return { entryPath, content };
});
const directoryPaths = ["src", "src/auth", "src/source-truth", "docs", "docs/design",
  "docs/design/F001-workspace-source-truth", "docs/design/F008-unified-login-space-permissions", "test"];

// The original 24 real Git blobs are held fixed. Native PostgreSQL, F001
// admission/bytes, F002 automatic publication and F003 workers are actual.
// F006/profile and model responses are EXPLICIT test doubles: this proves
// composition/restart mechanisms, never business quality or physical restore.
test("F003 same-24-source composition explicitly adopts the approved F002 profile and resumes bounded inputs after native restart", { timeout: 900000 }, async t => {
  assert.equal(files.length, 24);
  assert.equal(files.reduce((n, f) => n + f.content.length, 0), 403345);
  assert.equal(technicalF002Profile().id, profileId);
  const cluster = await isolatedPostgres(t);
  let databaseName;
  const f = await investigationFixture(t, { database: async () => {
    const db = await cluster.createDatabase(); databaseName = db.name; return db;
  }, entryPath: files[0].entryPath, content: files[0].content, additionalFiles: files.slice(1), directoryPaths });
  let service = f.service;
  const request = { ...f.request, operationId: "fixed-source-raw-only",
    budget: { ...f.request.budget, maxReadBytes: 512 * 1024, maxModelCalls: 12 } };
  const rawOnly = await service.start(owner, "workspace", request);
  assert.deepEqual(rawOnly.adoptedVersionIds, []);
  const technical = await createF002Runtime({ sourceRuntime: { pool: f.db,
    services: { repository: f.repository, admission: f.sourceAdmission },
    configuration: { members: [{ ...owner, tokenDigest: "a".repeat(64) }], origins: [] } }, cursorSecret: "f003-fixed-source-isolated" });
  t.after(() => technical.close());
  const technicalRun = await technical.services.admission.start(owner, "workspace", {
    operationId: "fixed-source-technical", reference: f.reference, profile: technicalF002Profile(),
    scopes: [{ selections: [{ kind: "COMPONENT", componentId: f.request.scope.componentIds[0] }] }] });
  await technical.services.executor.enqueue(technicalRun);
  const scope = await technical.services.repository.getScope(owner, "workspace", technicalRun.id, technicalRun.scopes[0].scopeId);
  assert.equal(scope.status, "SEALED", JSON.stringify(scope));
  const published = await technical.services.queries.manifest(owner, "workspace", scope.graphVersionId);
  assert.equal(published.profileId, profileId);
  assert.equal(published.bundleId, f.reference.bundleId);
  // Publishing a new technical version cannot change a pre-existing raw-only
  // investigation. Adoption is a separate, persisted, server-verified action.
  assert.deepEqual((await service.get(owner, "workspace", rawOnly.id)).adoptedVersionIds, []);
  const run = await service.start(owner, "workspace", { ...request, operationId: "fixed-source-explicit-adoption", technicalVersionId: scope.graphVersionId });
  assert.deepEqual(run.adoptedVersionIds, [scope.graphVersionId]);
  const calls = [], fragments = [], technicalDigests = [],factDigests=new Map();
  let interruptVerification = true;
  const invokeModel = async c => {
    const reservation = await service.reserveModelCall(owner, "workspace", c.investigationId, c), i = c.input, context = i.technicalEvidence;
    calls.push(i.stage ?? i.phase);
    technicalDigests.push(digest(canonicalEncode(context)));
    assert.deepEqual(context.versionIds, [scope.graphVersionId]);
    assert.equal(context.sourceBundleId, f.reference.bundleId);
    assert.ok(Buffer.byteLength(JSON.stringify(i))<=128*1024);
    assert.ok(Buffer.byteLength(JSON.stringify(context)) <= 32 * 1024);
    if(i.phase==='PLAN') {
      assert.equal(context.authority,'ROUTING_NOT_EVIDENCE');assert.deepEqual(context.records,[]);assert.deepEqual(context.allowedFactIds,[]);
    } else if(context.truncated) assert.ok(context.limitations.some(l=>l.status==='UNKNOWN'));
    const objects = new Map(context.objects.map(o => [o.objectId, o]));
    const evidence = new Map(context.evidence.map(e => [e.evidenceId, e]));
    const materials = new Map(context.materials.map(m => [m.materialId, m]));
    const facts = new Set(context.records.map(p => p.id));
    for (const fact of context.records) {
      const h=digest(canonicalEncode(fact.record));assert.equal(factDigests.get(fact.id)??h,h);factDigests.set(fact.id,h);
      assert.equal(fact.versionId, scope.graphVersionId);
      for (const id of [fact.record.subjectId, fact.record.targetId].filter(Boolean)) {
        const object = objects.get(id);
        assert.ok(object && materials.has(object.materialId));
        assert.equal(object.versionId, scope.graphVersionId);
      }
      for (const id of fact.record.evidenceIds) assert.ok(evidence.get(id)?.anchor && materials.has(evidence.get(id).materialId));
      for (const id of fact.record.premiseFactIds) assert.ok(facts.has(id));
    }
    for (const m of context.materials) assert.equal(m.sourceMaterial.bundleId, f.reference.bundleId);
    if (i.materials) assert.ok(i.materials.reduce((n, m) => n + Buffer.byteLength(m.text), 0) <= 64 * 1024);
    let result;
    if (i.phase === "PLAN") result = { assignments: [{ slotId: "child-1", obligations: ["核查本任务原文条件、反例与未供应前提（机制替身）"], objective: "固定材料的授权、冻结读取和撤权边界；测试替身不提供语义结论", materialKeys: i.inventory.map(m => m.key) }] };
    else if (i.phase === "INVESTIGATE") {
      fragments.push(...i.materials);
      result = { candidates: i.materials.map((m, index) => {
        const line = m.text.split(/\r?\n/).findIndex(text => text.trim().length > 0);
        return { key: `observation-${index}`, kind: "RULE", name: "机制测试观察（非业务质量结果）",
          statement: "该片段需要独立语义核查", scope: "仅收到的行段", uncertainties: ["模型是测试替身，未判断业务含义"],
          evidence: [{ materialId: m.id, startLine: m.startLine + line, endLine: m.startLine + line, quote: m.text.split(/\r?\n/)[line] }] };
      }), relations: [], requestedMaterialKeys: [] };
    } else if (i.stage === "CONSOLIDATE_PROPOSALS") result = { mergeSuggestions: [], conflictGroups: [] };
    else {
      assert.equal(i.stage, "EVIDENCE_VERIFICATION");
      assert.ok(i.evidenceContext);
      if (interruptVerification) {
        interruptVerification = false;
        throw Object.assign(new Error("isolated restart after consumed verification call"), { code: "TEST_MODEL_UNAVAILABLE" });
      }
      result = { reviews: [...i.candidates, ...i.relations].map(p => ({ key: p.key, support: "UNKNOWN",
        rationale: "mechanism fixture, not a model quality verdict", premises: [], unresolvedConflicts: [] })) };
    }
    return { result, reservationId: reservation.id };
  };
  await assert.rejects(new InvestigationWorker({ investigations: service, invokeModel }).run(owner, "workspace", run.id, { workerId: "before-restart" }), { code: "TEST_MODEL_UNAVAILABLE" });
  const failed = await service.get(owner, "workspace", run.id), checkpoints = await service.checkpoints(owner, "workspace", run.id);
  assert.equal(failed.state, "FAILED");
  assert.equal(failed.usage.readBytes, 403345);
  const childCalls = calls.filter(phase => phase === "INVESTIGATE").length;
  // Directory enumeration order can pack whole files differently. The
  // invariant is the byte bound and exact coverage, not an arbitrary batch
  // count taken from a differently ordered offline projection.
  assert.ok(childCalls >= Math.ceil(403345 / (64 * 1024)));
  assert.equal(failed.usage.modelCalls, childCalls + 3);
  for (const file of files) {
    const parts = fragments.filter(m => Buffer.from(m.sourceMaterial.pathBytes, "base64url").toString() === file.entryPath).sort((a, b) => a.byteStart - b.byteStart);
    assert.ok(parts.length > 0, file.entryPath);
    assert.equal(parts[0].byteStart, 0);
    assert.equal(parts.at(-1).byteEnd, file.content.length);
    for (let i = 1; i < parts.length; i++) assert.equal(parts[i].byteStart, parts[i - 1].byteEnd);
    assert.deepEqual(Buffer.from(parts.map(p => p.text).join("")), file.content, file.entryPath);
  }
  await technical.close();
  await cluster.restart();
  const sources = new SourceTruthRepository(cluster.pool(databaseName));
  const candidates = new SourceCandidateService(sources, new SourceMaterialRepository(sources), f.blobs);
  service = new InvestigationService({ sources, sourceAdmission: new SourceAdmissionService(sources, candidates), profiles: f.profiles });
  const recovered = await service.get(owner, "workspace", run.id);
  assert.deepEqual(recovered.usage, failed.usage);
  assert.deepEqual(recovered.adoptedVersionIds, [scope.graphVersionId]);
  assert.deepEqual(recovered.sourceInput, failed.sourceInput);
  assert.deepEqual(await service.checkpoints(owner, "workspace", run.id), checkpoints);
  await service.control(owner, "workspace", run.id, { action: "RESUME", expectedRevision: recovered.revision });
  await new InvestigationWorker({ investigations: service, invokeModel }).run(owner, "workspace", run.id, { workerId: "after-restart" });
  const complete = await service.get(owner, "workspace", run.id), graph = await service.graph(owner, "workspace", run.id);
  assert.equal(complete.usage.readBytes, failed.usage.readBytes);
  assert.equal(complete.usage.modelCalls, failed.usage.modelCalls + 1);
  assert.equal(calls.filter(phase => phase === "PLAN").length, 1);
  assert.equal(calls.filter(phase => phase === "INVESTIGATE").length, childCalls);
  assert.equal(calls.filter(phase => phase === "CONSOLIDATE_PROPOSALS").length, 1);
  assert.ok(factDigests.size>0,'actual adopted closed technical payloads must reach the workers, not just routing hashes');
  assert.equal(graph.materials.length, 24);
  assert.equal(graph.candidates.filter(p => p.state === "ANALYSIS_ACCEPTED").length, 0);
  assert.equal(graph.process.at(-1).pendingTasks.length, 0);
  assert.equal(graph.coverage.filter(m => m.modelInput.status === "FULLY_SUPPLIED").length, 24);
  assert.equal(graph.coverage.filter(m => m.businessStatus === "ASSOCIATED").length, 0);
  assert.deepEqual(graph.adoptedVersionIds, [scope.graphVersionId]);
  console.log(JSON.stringify({ scope: "MECHANISM_ONLY_FIXED_24_NATIVE_RESTART", baseline: manifest.baseline, profileId,
    bundleId: f.reference.bundleId, technicalVersionId: scope.graphVersionId, investigationId: run.id,
    graphDigest: graph.digest, files: files.length, rawBytes: 403345, childCalls, callsBefore: failed.usage.modelCalls,
    callsAfter: complete.usage.modelCalls, readBytesAfter: complete.usage.readBytes, technicalContextDigest: technicalDigests[0],
    businessQuality: "NOT_MEASURED_TEST_DOUBLES", protectedRecovery: "NOT_MEASURED" }));
});
