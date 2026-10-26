import { createServer } from "node:http";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { investigationFixture } from "./f003-investigation-fixture.js";
import { owner, reader } from "./source-truth-database.js";
import { InvestigationService } from "../../src/business-knowledge/investigation-service.js";
import { InvestigationWorker } from "../../src/business-knowledge/worker.js";
import { createF003Runtime } from "../../src/business-knowledge/runtime.js";
import { PublicationAuthority } from "../../src/business-knowledge/publication-authority.js";
import { canonicalEncode } from "../../src/source-truth/identity.js";
import { TraceabilityApplication } from "../../src/application/traceability-application.js";
import { PostgresTraceabilityStore } from "../../src/storage/postgres/postgres-traceability-store.js";
import { contextualDatabase } from "../../src/auth/database.js";

// Real stores, domain governance, HTTP and publication kernel; explicitly
// synthetic reasoning, reviewer identities, measurement and recovery ports.
// No production data, external model, real quality or protected-media claim.
export async function authorityFixture(t, { database, includeRelation = false, modelExecutor = null, sourceOptions = {}, analysisSupport = 'SUPPORTED' } = {}) {
  const f = await investigationFixture(t, { ...sourceOptions, ...(database ? { database } : {}) });
  let now = Date.parse("2026-10-23T08:00:00Z"), reviewer = { actorId: "owner", actorRole: "business-owner" };
  const clock = () => new Date(now), store = new PostgresTraceabilityStore(contextualDatabase(f.db));
  const application = new TraceabilityApplication({ store, clock, reviewerResolver: () => reviewer,
    runnerKeyResolver: id => id === "isolated-runner" ? "isolated-test-runner-secret" : null,
    reviewPolicyResolver: () => ({ requireDecisionReviewCases: true, allowedFeatureGovernanceRoles: ["business-owner"], allowedTestSpecApproverRoles: ["business-owner"],
      decisionGovernance: { proposerRoles: ["business-owner"], approvalRoles: ["business-owner"], lifecycleRoles: ["business-owner"] } }) });
  await application.appendFeatureVersion("workspace", { id: "order-feature", version: 1, name: "取消订单" });
  const scope = await application.appendClaimScope("workspace", { id: "order-scope", version: 1, scope: { condition: "未支付", environment: "isolated" } });
  const claim = await application.appendClaim("workspace", { id: "cancel-rule", version: 1, featureId: "order-feature", type: "NORMATIVE_REQUIREMENT",
    statement: "用户可取消未支付订单", sourceType: "AI_CANDIDATE", evidenceSupport: "SINGLE_SOURCE", scopeId: scope.id, scopeVersion: scope.version,
    provenance: { source: "isolated-graph-mapping-test-not-a-quality-verdict" } });
  const implementationVersion = { status: "VERIFIED", commitSha: "0".repeat(40), sourceDigest: "d".repeat(64) };
  const investigations = new InvestigationService({ sources: f.repository, sourceAdmission: f.sourceAdmission, profiles: f.profiles, implementationVersion });
  const run = await investigations.start(owner, "workspace", f.request);
  const worker = new InvestigationWorker({ investigations, invokeModel: async c => {
    const reservation = await investigations.reserveModelCall(owner, "workspace", c.investigationId, c), i = c.input;
    const result = i.phase === "PLAN" ? { assignments: [{ slotId: "child-1", obligations: ["核查本任务原文条件、反例与未供应前提（机制替身）"], objective: "mechanism only", materialKeys: i.inventory.map(m => m.key) }] }
      : i.phase === "INVESTIGATE" ? { candidates: [{ key: "cancel", kind: "RULE", name: "取消规则", statement: "用户可取消未支付订单", scope: "仅隔离机制",
        uncertainties: [], evidence: [{ materialId: i.materials[0].id, startLine: 1, endLine: 1, quote: i.materials[0].text }] }],
        relations: includeRelation ? [{ key: "described-by", sourceKey: "cancel", targetKey: i.materials[0].id, predicate: "DESCRIBED_BY", scope: "仅隔离机制",
          evidence: [{ materialId: i.materials[0].id, startLine: 1, endLine: 1, quote: i.materials[0].text }] }] : [] }
        : { reviews: [...i.candidates, ...(i.relations ?? [])].map(p => ({ key: p.key, support: analysisSupport, rationale: "explicit test double", premises: ["isolated fixture"], unresolvedConflicts: [] })) };
    return { result, reservationId: reservation.id };
  } });
  await worker.run(owner, "workspace", run.id, { workerId: "authority-fixture" });
  const graph = await investigations.graph(owner, "workspace", run.id);
  if(modelExecutor) application.createBusinessKnowledgeModelExecutor=modelExecutor; // Explicit test model port only.
  const runtime = await createF003Runtime({ publicationAuthorityFile: null, application,
    sourceRuntime: { pool: f.db, services: { repository: f.repository, admission: f.sourceAdmission },
      configuration: { members: [{ ...owner, tokenDigest: createHash("sha256").update("isolated-owner-token").digest("hex") },
        { ...reader, tokenDigest: createHash("sha256").update("isolated-reader-token").digest("hex") }], origins: [] } } });
  t.after(() => runtime.close());
  const pubs = runtime.services.publications;
  if (runtime.services.authorityBindings) runtime.services.authorityBindings.clock = clock;
  const reportFile = join(await mkdtemp(join(tmpdir(), "traqen-f003-authority-test-")), "mechanism-only-reports.json");
  const issuers = ["isolated-reviewer", "isolated-recovery"].map(id => ({ id, ...generateKeyPairSync("ed25519") }));
  const authority = new PublicationAuthority({ implementationAuthors: ["isolated-author"], artifactFiles: [reportFile], issuers: issuers.map((r, index) => ({
    id: r.id, kind: index ? "RECOVERY" : "QUALITY", publicKey: r.publicKey.export({ type: "spki", format: "pem" }) })) });
  Object.assign(pubs, { authority, implementationResolver: async () => implementationVersion,
    qualityPolicy: { id: "isolated-authority-mechanism-only", minimumDenominators: { inventory: 1, candidateSample: 1 }, thresholds: { candidatePrecision: 1 } },
    backup: { config: { targetId: "isolated-target" }, ready: async () => {}, verify: async () => ({ included: true, waterline: { capturedAt: "2090-01-01T00:00:00Z" } }) } });
  await f.db.query("INSERT INTO source_truth_backup_attempt(id,target_id,requested_by,status,finished_at) VALUES ('authority-test-backup','isolated-target','test-only','COMPLETED',clock_timestamp())");
  await f.db.query("INSERT INTO source_truth_backup_set(id,target_id,payload,completed_at) VALUES ('authority-test-backup','isolated-target','{}',clock_timestamp())");
  await f.db.query("INSERT INTO source_truth_backup_member(backup_id,workspace_id,bundle_id,receipt_id) VALUES ('authority-test-backup','workspace',$1,$2)", [f.reference.bundleId, f.reference.receiptId]);
  async function publishAnalysis(investigationId, graph, {operationId='publish-fixture',expectedHeadVersion=0}={}) {
  const binding = (await pubs.readiness(owner, "workspace", investigationId)).binding;
  await f.db.query(`INSERT INTO source_truth_backup_member(backup_id,workspace_id,bundle_id,receipt_id)
    VALUES ('authority-test-backup','workspace',$1,$2) ON CONFLICT DO NOTHING`,[binding.sourceInput.sourceBundleSnapshotId,binding.sourceInput.receiptId]);
  const payloads = [{ version: 1, kind: "QUALITY", issuerId: issuers[0].id, evidenceClass: "REAL_PROJECT", binding, observedAt: "2026-10-23T07:00:00Z",
    quality: { measurementKind: "INDEPENDENT_REVIEW", truthSetDigest: "e".repeat(64), measurementRefs: ["SYNTHETIC_TEST_ONLY"],
      denominators: { inventory: graph.coverage.length, candidateSample: 1 }, metrics: { candidatePrecision: 1 }, equivalence: { kind: "MEASURED_REPLAY_AND_INCREMENTAL" } } },
  { version: 1, kind: "RECOVERY", issuerId: issuers[1].id, evidenceClass: "REAL_PROJECT", binding, observedAt: "2026-10-23T07:00:00Z",
    recovery: { kind: "REAL_NATIVE_PAIRED_RESTORE", backupId: "authority-test-backup", waterline: "2090-01-01T00:00:00Z",
      restoredGraphDigest: graph.digest, restoreReportDigest: "f".repeat(64), restoreEventId: "SYNTHETIC_TEST_ONLY" } }];
  await writeFile(reportFile, JSON.stringify({ artifacts: payloads.map((payload, index) => ({ issuerId: payload.issuerId, payload,
    signature: sign(null, Buffer.from(canonicalEncode(payload)), issuers[index].privateKey).toString("base64url") })) }), { mode: 0o600 });
  await pubs.importEvidence(owner, "workspace", investigationId);
  return pubs.publish(owner, "workspace", investigationId, { operationId, expectedGraphDigest: graph.digest, expectedHeadVersion });
  }
  const published=await publishAnalysis(run.id,graph);
  const server = createServer(async (req, res) => { if (!await runtime.businessKnowledgeHandler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const closeHttp = async () => {
    await runtime.close();
    if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  };
  t.after(closeHttp);
  const root = `http://127.0.0.1:${server.address().port}/v1/workspaces/workspace/business-knowledge`;
  let decisionNumber = 0;
  async function decide(type, validUntil = null) {
    const id = `case-${++decisionNumber}`;
    reviewer = { actorId: "owner", actorRole: "business-owner" };
    await application.createDecisionReviewCase("workspace", { id, claimId: claim.id, claimVersion: claim.version,
      scopeId: scope.id, scopeVersion: scope.version, risk: "LOW", approvalMode: "SINGLE", expiresAt: "2027-01-01T00:00:00Z",
      proposedDecision: { id: `decision-${decisionNumber}`, type, validUntil, content: "isolated human workflow", evidenceRefs: [] } });
    reviewer = { actorId: "reader", actorRole: "business-owner" };
    return application.appendDecisionReviewEvent("workspace", id, { id: `approve-${decisionNumber}`, action: "APPROVE", rationale: "independent fixture approver" });
  }
  return { ...f, runtime, investigations, application, store, run, graph, scope, claim, published, publishAnalysis, root, decide, closeHttp,
    setTime: value => { now = Date.parse(value); }, clock,
    headers: { authorization: "Bearer isolated-owner-token", "content-type": "application/json" },
    bindingRequest: { operationId: "bind-1", expectedGraphDigest: graph.digest, objectKey: graph.candidates[0].key, expectedVersion: 0,
      rationale: "显式比较原命题及权威版本，不以同名推断", targets: [{ featureId: "order-feature", featureVersion: 1, claimId: claim.id, claimVersion: claim.version,
        scopeId: scope.id, scopeVersion: scope.version, verificationTargets: [] }] } };
}
