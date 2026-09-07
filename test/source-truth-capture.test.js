import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sourceDatabase, owner } from "./support/source-truth-database.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";
import { SourceTruthBlobStore } from "../src/source-truth/blob-store.js";
import { SourceUploadService } from "../src/source-truth/upload-service.js";
import { SourceCandidateService } from "../src/source-truth/candidate-service.js";
import { SourceCaptureService } from "../src/source-truth/capture-service.js";
import { capturePolicy } from "../src/source-truth/policy.js";
import { pathBytes, manifestIdentity } from "../src/source-truth/identity.js";
import { GitSourceGateway } from "../src/source-truth/git-gateway.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { gitFixture } from "./support/source-truth-git-fixture.js";

async function fixture(t, gitInput = null) {
  const { repository, db } = await sourceDatabase(t);
  const policy = capturePolicy({ gitTargets: gitInput?.targets ?? [] });
  const materials = new SourceMaterialRepository(repository, policy);
  const blobs = await SourceTruthBlobStore.open({ root: await mkdtemp(path.join(tmpdir(), "traqen-source-capture-test-")), keyVersion: "test", keys: { test: Buffer.alloc(32, 17) } });
  const upload = new SourceUploadService(repository, materials, blobs);
  const candidates = new SourceCandidateService(repository, materials, blobs);
  const git = gitInput ? new GitSourceGateway({ cacheRoot: path.join(gitInput.root, "private-cache"), targets: gitInput.targets, maxPackBytes: 16 * 1024 * 1024 }) : null;
  const services = { repository, db, policy, materials, blobs, upload, candidates, git };
  return { ...services, capture: new SourceCaptureService(services) };
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const input = { baselineBundleId: null, sources: [{ sourceId: "directory", kind: "DIRECTORY_UPLOAD", mode: "UPDATE", label: "设计资料" }] };

test("B-01 real directory workflow stops at user review and never publishes on its own", async (t) => {
  const f = await fixture(t);
  const draft = await f.capture.save(owner, "workspace", { expectedRevision: 0, input });
  assert.equal(draft?.revision, 1);
  const run = await f.capture.start(owner, "workspace", { draftRevision: 1 });
  assert.equal(run.status, "PREFLIGHTING");
  const waiting = await f.capture.advance(owner, "workspace", run.id);
  assert.equal(waiting.status, "WAITING_FOR_CLIENT");
  assert.equal(waiting.station, 4);
  const bytes = Buffer.from("directory material");
  const entry = { pathBytes: pathBytes("readme.md"), kind: "FILE", sizeBytes: String(bytes.length), expectedContent: { algorithm: "sha256", digest: hash(bytes) }, gitMode: null };
  await f.capture.enumerateDirectory(owner, "workspace", run.id, "directory", { batchId: "0", entries: [entry] });
  // Lost acknowledgement: same enumeration batch is not a second file.
  await f.capture.enumerateDirectory(owner, "workspace", run.id, "directory", { batchId: "0", entries: [entry] });
  const manifestId = manifestIdentity("DIRECTORY_UPLOAD", [entry]).id;
  await f.capture.closeDirectory(owner, "workspace", run.id, "directory", { fileCount: "1", directoryCount: "0", manifestId });
  const uploading = await f.capture.advance(owner, "workspace", run.id);
  assert.equal(uploading.station, 6);
  assert.equal(uploading.status, "WAITING_FOR_CLIENT");
  await f.capture.uploadChunk(owner, "workspace", run.id, "directory", { pathBytes: entry.pathBytes, offset: "0", sizeBytes: entry.sizeBytes, digest: hash(bytes) }, [bytes]);
  await f.capture.finishFile(owner, "workspace", run.id, "directory", entry.pathBytes);
  const review = await f.capture.advance(owner, "workspace", run.id);
  assert.equal(review.status, "REVIEW_REQUIRED");
  assert.equal(review.station, 7);
  assert.equal((await f.capture.advance(owner, "workspace", run.id)).status, "REVIEW_REQUIRED");
  assert.deepEqual(await f.repository.listBundles(owner, "workspace"), []);
});

test("B-08 server restart resumes the same waiting task without a second run or user confirmation", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.capture.save(owner, "workspace", { expectedRevision: 0, input }))?.revision, 1);
  const run = await f.capture.start(owner, "workspace", { draftRevision: 1 });
  await f.capture.advance(owner, "workspace", run.id);
  const restarted = new SourceCaptureService({ ...f, workerId: "replacement" });
  // An expired execution lease is ownership recovery, not record expiration.
  await f.db.query("UPDATE source_truth_run SET lease_until=clock_timestamp()-interval '1 second' WHERE workspace_id='workspace' AND id=$1", [run.id]);
  const resumed = await restarted.advance(owner, "workspace", run.id);
  assert.equal(resumed.id, run.id);
  assert.equal(resumed.status, "WAITING_FOR_CLIENT");
  assert.equal(resumed.generation, 2);
  assert.deepEqual(await f.repository.listBundles(owner, "workspace"), []);
});

test("B-01/04 combined input updates Git while reusing the exact frozen directory without reselecting it", async (t) => {
  const source = await gitFixture(t);
  const f = await fixture(t, source);
  const gitInput = { sourceId: "git", kind: "GIT", mode: "UPDATE", url: source.url, ref: "main", root: null };
  await f.capture.save(owner, "workspace", { expectedRevision: 0, input: { ...input, sources: [gitInput, ...input.sources] } });
  const run = await f.capture.start(owner, "workspace", { draftRevision: 1 });
  assert.equal((await f.capture.advance(owner, "workspace", run.id)).status, "WAITING_FOR_CLIENT");
  const bytes = Buffer.from("design document");
  const entry = { pathBytes: pathBytes("design.md"), kind: "FILE", sizeBytes: String(bytes.length), expectedContent: { algorithm: "sha256", digest: hash(bytes) }, gitMode: null };
  await f.capture.enumerateDirectory(owner, "workspace", run.id, "directory", { batchId: "0", entries: [entry] });
  await f.capture.closeDirectory(owner, "workspace", run.id, "directory", { fileCount: "1", directoryCount: "0", manifestId: manifestIdentity("DIRECTORY_UPLOAD", [entry]).id });
  await f.capture.advance(owner, "workspace", run.id);
  await f.capture.uploadChunk(owner, "workspace", run.id, "directory", { pathBytes: entry.pathBytes, offset: "0", sizeBytes: entry.sizeBytes, digest: hash(bytes) }, [bytes]);
  await f.capture.finishFile(owner, "workspace", run.id, "directory", entry.pathBytes);
  const review = await f.capture.advance(owner, "workspace", run.id);
  assert.equal(review.status, "REVIEW_REQUIRED");
  const publication = new SourcePublicationService(f.repository, f.candidates);
  const publish = async (review, token) => {
    const context = { workspaceId: "workspace", runId: review.id, generation: review.generation };
    const candidate = review.progress.candidate;
    const confirmation = await publication.confirm(owner, context, { candidateId: candidate.id, gapSetId: candidate.gapSetId });
    return publication.seal(owner, context, { confirmationId: confirmation.id, clientToken: token });
  };
  const first = await publish(review, "first");
  assert.equal(first.bundle.fileCount, "3");
  const directory = first.bundle.components.find((component) => component.kind === "DIRECTORY_UPLOAD");
  const nextCommit = await source.update();
  const beforeBytes = f.blobs.metrics.streamedBytes;
  await f.capture.save(owner, "workspace", { expectedRevision: 1, input: { baselineBundleId: first.bundle.id,
    sources: [{ ...gitInput, ref: nextCommit }, { sourceId: "directory", kind: "DIRECTORY_UPLOAD", mode: "REUSE", componentId: directory.id }] } });
  const next = await f.capture.start(owner, "workspace", { draftRevision: 2 });
  const secondReview = await f.capture.advance(owner, "workspace", next.id);
  assert.equal(secondReview.status, "REVIEW_REQUIRED");
  const second = await publish(secondReview, "second");
  assert.notEqual(second.bundle.id, first.bundle.id);
  assert.equal(second.bundle.components.find((component) => component.kind === "DIRECTORY_UPLOAD").id, directory.id);
  assert.equal(f.blobs.metrics.streamedBytes - beforeBytes, BigInt(Buffer.byteLength("fixture version B\n")));
  assert.equal((await f.repository.listBundles(owner, "workspace")).length, 2);
});

test("B-08 directory close and selection proof commit together", async (t) => {
  const f = await fixture(t);
  await f.capture.save(owner, "workspace", { expectedRevision: 0, input });
  const run = await f.capture.start(owner, "workspace", { draftRevision: 1 });
  await f.capture.advance(owner, "workspace", run.id);
  const entry = { pathBytes: pathBytes("empty.txt"), kind: "FILE", sizeBytes: "0", expectedContent: { algorithm: "sha256", digest: hash(Buffer.alloc(0)) }, gitMode: null };
  await f.capture.enumerateDirectory(owner, "workspace", run.id, "directory", { batchId: "0", entries: [entry] });
  await f.db.exec(`CREATE FUNCTION reject_test_selection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected selection failure'; END; $$;
    CREATE TRIGGER fail_test_selection BEFORE INSERT ON source_truth_directory_selection FOR EACH ROW EXECUTE FUNCTION reject_test_selection();`);
  await assert.rejects(f.capture.closeDirectory(owner, "workspace", run.id, "directory", { fileCount: "1", directoryCount: "0", manifestId: manifestIdentity("DIRECTORY_UPLOAD", [entry]).id }), /injected selection failure/);
  const source = (await f.db.query("SELECT enumeration_closed FROM source_truth_run_source WHERE workspace_id='workspace' AND run_id=$1", [run.id])).rows[0];
  assert.equal(source.enumeration_closed, false);
});
