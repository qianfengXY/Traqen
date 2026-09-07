import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sourceDatabase } from "./support/source-truth-database.js";
import { createTraceabilityHttpServer } from "../src/api/http-server.js";
import { createSourceTruthHttpHandler } from "../src/source-truth/http-handler.js";
import { sourceTruthAuthenticator } from "../src/source-truth/authentication.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";
import { SourceTruthBlobStore } from "../src/source-truth/blob-store.js";
import { SourceUploadService } from "../src/source-truth/upload-service.js";
import { SourceCandidateService } from "../src/source-truth/candidate-service.js";
import { SourceCaptureService } from "../src/source-truth/capture-service.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { SourceRenewalService } from "../src/source-truth/renewal-service.js";
import { SourceDeltaService } from "../src/source-truth/delta-service.js";
import { capturePolicy } from "../src/source-truth/policy.js";
import { manifestIdentity, pathBytes } from "../src/source-truth/identity.js";
import { SourceTruthClient } from "../web/app/source-truth/client.ts";
import { transferDirectory } from "../web/app/source-truth/transfer.ts";

const token = "isolated-http-source-owner-credential";
const readerToken = "isolated-http-source-reader-credential";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fixture(t) {
  const { repository, db } = await sourceDatabase(t);
  const policy = capturePolicy();
  const materials = new SourceMaterialRepository(repository, policy);
  const blobs = await SourceTruthBlobStore.open({ root: await mkdtemp(path.join(tmpdir(), "traqen-source-http-test-")), keyVersion: "test", keys: { test: Buffer.alloc(32, 26) } });
  const upload = new SourceUploadService(repository, materials, blobs);
  const candidates = new SourceCandidateService(repository, materials, blobs);
  const capture = new SourceCaptureService({ repository, policy, materials, blobs, upload, candidates });
  const publication = new SourcePublicationService(repository, candidates, { policyRevisionId: policy.id });
  const services = { repository, policy, materials, blobs, capture, upload, candidates, publication,
    admission: new SourceAdmissionService(repository, candidates), renewal: new SourceRenewalService(repository, candidates), delta: new SourceDeltaService(repository) };
  const authenticate = sourceTruthAuthenticator([{ tokenDigest: hash(token), actorId: "owner", tenantId: "tenant" }, { tokenDigest: hash(readerToken), actorId: "reader", tenantId: "tenant" }]);
  const sourceTruthHandler = createSourceTruthHttpHandler({ services, authenticate, allowedOrigins: ["https://app.example.test"] });
  const server = createTraceabilityHttpServer({ application: {}, apiBearerToken: "legacy-api-token-not-source-identity", sourceTruthHandler });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/v1/workspaces/workspace/source-truth`;
  const call = async (suffix, method = "GET", body, credential = token) => {
    const response = await fetch(base + suffix, { method, headers: { authorization: `Bearer ${credential}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { ...services, db, base, call };
}

test("B-01/05 HTTP directory journey streams original bytes and publishes only after authenticated confirmation", async (t) => {
  const f = await fixture(t);
  const overview = await f.call("");
  assert.equal(overview.status, 200);
  assert.equal(overview.body.actor.actorId, "owner");
  const draft = await f.call("/draft", "PUT", { expectedRevision: 0, input: { sources: [{ sourceId: "docs", kind: "DIRECTORY_UPLOAD", mode: "UPDATE", label: "设计资料" }], baselineBundleId: null } });
  assert.equal(draft.status, 200);
  const created = await f.call("/runs", "POST", { draftRevision: draft.body.revision });
  const runId = created.body.id;
  const runPath = `/runs/${runId}`;
  assert.equal((await f.call(`${runPath}/advance`, "POST", {})).body.station, 4);
  const content = Buffer.from("HTTP 原始材料\r\n");
  const entry = { pathBytes: pathBytes("readme.txt"), kind: "FILE", sizeBytes: String(content.length), expectedContent: { algorithm: "sha256", digest: hash(content) }, gitMode: null };
  assert.equal((await f.call(`${runPath}/sources/docs/entries`, "POST", { batchId: "0", entries: [entry] })).status, 200);
  assert.equal((await f.call(`${runPath}/sources/docs/close`, "POST", { fileCount: "1", directoryCount: "0", manifestId: manifestIdentity("DIRECTORY_UPLOAD", [entry]).id })).status, 200);
  await f.call(`${runPath}/advance`, "POST", {});
  const query = new URLSearchParams({ pathBytes: entry.pathBytes, offset: "0", sizeBytes: entry.sizeBytes, digest: hash(content) });
  const uploaded = await fetch(`${f.base}${runPath}/sources/docs/chunks?${query}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" }, body: content });
  assert.equal(uploaded.status, 200);
  assert.equal((await f.call(`${runPath}/sources/docs/finish-file`, "POST", { pathBytes: entry.pathBytes })).status, 200);
  const review = await f.call(`${runPath}/advance`, "POST", {});
  assert.equal(review.body.status, "REVIEW_REQUIRED");
  const candidate = review.body.progress.candidate;
  const confirmation = await f.call(`${runPath}/confirm`, "POST", { candidateId: candidate.id, gapSetId: candidate.gapSetId });
  const published = await f.call(`${runPath}/seal`, "POST", { confirmationId: confirmation.body.id, clientToken: "one" });
  assert.equal(published.status, 200);
  assert.equal(published.body.receipt.status, "READY");
  const reference = { bundleId: published.body.bundle.id, receiptId: published.body.receipt.id };
  const admitted = await f.call("/admission", "POST", reference, readerToken);
  assert.equal(admitted.status, 200);
  assert.equal(admitted.body.fileCount, "1");
  assert.equal(admitted.body.sourceBundleSnapshotId, reference.bundleId);
  assert.equal(admitted.body.receiptValidUntil, null);
  assert.equal(admitted.body.confirmationId, confirmation.body.id);
  assert.equal(admitted.body.inventoryDigest, published.body.bundle.inventoryId);
  assert.equal(admitted.body.policyRevisionId, f.policy.id);
  assert.equal(admitted.body.components[0].kind, "DIRECTORY_UPLOAD");
  assert.equal((await f.call(`${runPath}/result`)).body.receipt.id, reference.receiptId);
  const coverage = await f.call("/backup-coverage", "POST", reference, readerToken);
  assert.equal(coverage.status, 200);
  assert.equal(coverage.body.status, "NOT_CONFIGURED");
  assert.equal(coverage.body.receiptId, reference.receiptId);
});

test("B-05 HTTP request claims cannot impersonate a maintainer and untrusted origins have no write access", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call("", "GET", undefined, "wrong-token")).status, 401);
  assert.equal((await f.call("/draft", "PUT", { actorId: "owner", tenantId: "tenant", expectedRevision: 0, input: { sources: [{ sourceId: "docs", kind: "DIRECTORY_UPLOAD", mode: "UPDATE" }] } }, readerToken)).status, 403);
  const response = await fetch(f.base + "/runs", { method: "POST", headers: { origin: "https://untrusted.example.test", authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
  assert.equal(response.status, 403);
});

test("restored tasks require a maintainer's explicit resume and retain their original identity", async (t) => {
  const f = await fixture(t);
  await f.call("/draft", "PUT", { expectedRevision: 0, input: { sources: [{ sourceId: "docs", kind: "DIRECTORY_UPLOAD", mode: "UPDATE" }], baselineBundleId: null } });
  const run = (await f.call("/runs", "POST", { draftRevision: 1 })).body;
  await f.db.query("UPDATE source_truth_run SET status='WAITING_FOR_CLIENT',progress=$2 WHERE id=$1", [run.id, { waitingFor: "RESTORE_RECONCILIATION", restoredPriorStatus: "PREFLIGHTING" }]);
  const route = `/runs/${run.id}/reconcile-restore`;
  assert.equal((await f.call(route, "POST", {}, readerToken)).status, 403);
  const resumed = await f.call(route, "POST", {});
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.status, "PREFLIGHTING");
  assert.equal(resumed.body.actorId, "owner");
  assert.equal((await f.call(route, "POST", {})).body.id, run.id, "a lost resume response must not create a new run");
  await f.call(`/runs/${run.id}/advance`, "POST", {});
  assert.equal((await f.call(`/runs/${run.id}`)).body.progress.waitingFor, "DIRECTORY_ENUMERATION");
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM source_truth_confirmation")).rows[0].n, 0);
});

test("HTTP staging disposition requires explicit maintain authority and remains queryable after abandonment", async (t) => {
  const f = await fixture(t);
  await f.call("/draft", "PUT", { expectedRevision: 0, input: { sources: [{ sourceId: "docs", kind: "DIRECTORY_UPLOAD", mode: "UPDATE" }] } });
  const run = (await f.call("/runs", "POST", { draftRevision: 1 })).body;
  const route = `/runs/${run.id}/staging-release`;
  assert.equal((await f.call(route)).body.abandoned, false);
  assert.equal((await f.call(route, "POST", { confirmRelease: true })).body.error.code, "SOURCE_RUN_ACTIVE");
  assert.equal((await f.call(`/runs/${run.id}/cancel`, "POST", {})).status, 200);
  assert.equal((await f.call(route, "POST", {})).status, 400);
  assert.equal((await f.call(route, "POST", { confirmRelease: true }, readerToken)).status, 403);
  const released = await f.call(route, "POST", { confirmRelease: true });
  assert.equal(released.status, 200); assert.equal(released.body.status, "COMPLETED");
  assert.equal((await f.call(route, "GET", undefined, readerToken)).body.requestedBy, "owner");
  assert.equal((await f.call(`/runs/${run.id}/view`)).body.run.abandoned, true);
});

test("browser transfer protocol closes a complete directory, sends bytes once and stops for the human at station 7", async (t) => {
  const f = await fixture(t);
  const input = { sources: [{ sourceId: "docs", kind: "DIRECTORY_UPLOAD", mode: "UPDATE", label: "目录" }], baselineBundleId: null };
  await f.call("/draft", "PUT", { expectedRevision: 0, input });
  const run = (await f.call("/runs", "POST", { draftRevision: 1 })).body;
  await f.call(`/runs/${run.id}/advance`, "POST", {});
  const root = {
    kind: "directory", async *entries() {
      yield ["empty", { kind: "directory", async *entries() {} }];
      yield ["doc.txt", { kind: "file", getFile: async () => new File(["真实目录传输"], "doc.txt", { lastModified: 1 }) }];
      yield ["duplicate.txt", { kind: "file", getFile: async () => new File(["真实目录传输"], "duplicate.txt", { lastModified: 1 }) }];
    }, async getFileHandle() { return { kind: "file", getFile: async () => new File(["真实目录传输"], "doc.txt", { lastModified: 1 }) }; },
  };
  const rows = [];
  const store = { async putBatch(batch) { rows.push(...batch); }, async *ordered() { yield* rows.toSorted((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key))); } };
  const client = new SourceTruthClient(f.base.split("/v1/")[0], token, "workspace");
  const request = client.request.bind(client), uploads = [];
  client.request = async (...args) => { if (args[1] === "POST") uploads.push(args[0]); return request(...args); };
  const progress = [];
  const transferred = await transferDirectory(client, run.id, "docs", root, store, f.policy, (value) => progress.push(value));
  assert.equal(transferred.sentBytes, String(Buffer.byteLength("真实目录传输")));
  assert.equal((await f.call(`/runs/${run.id}`)).body.status, "REVIEW_REQUIRED");
  const detail = (await f.call(`/runs/${run.id}/view`)).body;
  assert.equal(detail.candidate.directoryCount, "1");
  assert.equal(detail.confirmation, null);
  assert.equal(detail.result, null);
  assert.equal(progress.at(-1).verifiedFiles, "2");
  assert.equal(transferred.unnecessaryBytes, String(Buffer.byteLength("真实目录传输")), "same-Workspace verified content must not be sent twice");
  assert.equal(uploads.filter((route) => route.includes("/complete-file?")).length, 1, "one small-file request, not chunk copy plus finish");
  assert.equal(uploads.filter((route) => route.includes("/chunks?")).length, 0);
  assert.equal(uploads.filter((route) => route.endsWith("/finish-file")).length, 1, "duplicate uses only verified content, never uploads again");
  assert.equal((await f.call("/history/runs?limit=1")).body.items[0].id, run.id);
});
