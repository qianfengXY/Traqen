import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir, platform, release } from "node:os";
import path from "node:path";
import { isolatedPostgres } from "./source-truth-postgres.js";
import { gitFixture } from "./source-truth-git-fixture.js";
import { owner, reader } from "./source-truth-database.js";
import { sourceTruthServices } from "../../src/source-truth/services.js";
import { SourceTruthRepository } from "../../src/source-truth/repository.js";
import { SourceTruthBlobStore } from "../../src/source-truth/blob-store.js";
import { GitSourceGateway } from "../../src/source-truth/git-gateway.js";
import { capturePolicy } from "../../src/source-truth/policy.js";
import { orderedArrayDigest, pathBytes } from "../../src/source-truth/identity.js";

const exec = promisify(execFile);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const relativeFile = (i) => `materials/g${String(Math.floor(i / 500)).padStart(4, "0")}/f${String(i).padStart(6, "0")}.txt`;
const fixtureBytes = (i, kind) => i === 0 ? Buffer.alloc(1024 * 1024, kind === "git" ? 65 : 68)
  : i === 1 ? Buffer.alloc(0) : i % 10 === 0 ? Buffer.from("shared duplicate material\n") : Buffer.from(`${kind} immutable pilot material ${i}\n`);

async function generate(root, count, kind) {
  for (let i = 0; i < count; i++) {
    const filename = path.join(root, relativeFile(i));
    if (i % 500 === 0) await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await writeFile(filename, fixtureBytes(i, kind), { mode: 0o600, flag: "wx" });
  }
}

async function* walk(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
  for (const item of entries) {
    const name = relative ? `${relative}/${item.name}` : item.name;
    assert.ok(item.isFile() || item.isDirectory(), "fixture must not follow links or silently omit a kind");
    yield { name, directory: item.isDirectory() };
    if (item.isDirectory()) yield* walk(root, name);
  }
}

export function measurements() {
  const result = { sampleCount: 0, peakObservedNodeRssBytes: 0, peakObservedProcessTreeRssBytes: 0,
    peakObservedProcessTreeFileDescriptors: 0, samplingErrors: 0, exitedDuringSample: 0, intervalMs: 1000 };
  let pending, stopped = false;
  const sample = () => {
    if (pending) return pending;
    pending = (async () => {
      result.peakObservedNodeRssBytes = Math.max(result.peakObservedNodeRssBytes, process.memoryUsage().rss);
      const listing = exec("/bin/ps", ["-axo", "pid=,ppid=,rss="], { maxBuffer: 1024 * 1024 });
      const output = (await listing).stdout;
      const processes = output.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
      const owned = new Set([process.pid]);
      for (let size = -1; size !== owned.size;) { size = owned.size; for (const [pid, ppid] of processes) if (owned.has(ppid)) owned.add(pid); }
      owned.delete(listing.child.pid); // The sampler's ps child has already exited.
      result.peakObservedProcessTreeRssBytes = Math.max(result.peakObservedProcessTreeRssBytes, processes.reduce((sum, [pid, , rss]) => sum + (owned.has(pid) ? rss * 1024 : 0), 0));
      let files;
      try { files = await exec("/usr/sbin/lsof", ["-a", "-p", [...owned].join(","), "-Ff"], { maxBuffer: 1024 * 1024 }); }
      catch (error) {
        assert.equal(error.code, 1); assert.equal(error.stderr, "");
        const observed = new Set(error.stdout.split("\n").filter((line) => /^p\d+$/.test(line)).map((line) => Number(line.slice(1))));
        assert.ok(observed.has(process.pid));
        for (const pid of owned) if (!observed.has(pid)) {
          assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "a live unreadable process makes the measurement incomplete");
          result.exitedDuringSample++;
        }
        files = error;
      }
      result.peakObservedProcessTreeFileDescriptors = Math.max(result.peakObservedProcessTreeFileDescriptors, files.stdout.split("\n").filter((line) => /^f\d/.test(line)).length);
      result.sampleCount++;
    })().catch(() => { result.samplingErrors++; }).finally(() => { pending = null; });
    return pending;
  };
  const timer = setInterval(sample, 1000); timer.unref();
  return { result, sample, async stop() { if (stopped) return; stopped = true; clearInterval(timer); await pending; await sample(); } };
}

// Real controlled HTTPS Git, local file bytes and an owned PostgreSQL cluster.
// This tests the production service path, NOT browser UX or deployment/disaster
// readiness. Artifacts are retained in freshly allocated private temp roots.
export async function sourceTruthPilot({ filesPerSource, postgresBin, maxTreeRssBytes, maxTreeFileDescriptors, onProgress = () => {} }) {
  assert.ok(Number.isSafeInteger(filesPerSource) && filesPerSource >= 10 && filesPerSource <= 50000);
  assert.ok(Number.isSafeInteger(maxTreeRssBytes) && maxTreeRssBytes > 0 && Number.isSafeInteger(maxTreeFileDescriptors) && maxTreeFileDescriptors > 0);
  const cleanups = [], t = { after: (fn) => cleanups.push(fn) }, measured = measurements(), phases = [];
  let activePhase = "initialization";
  const pulse = setInterval(() => onProgress({ phase: activePhase, state: "RUNNING", ...measured.result }), 10000); pulse.unref();
  const stage = async (name, work) => {
    activePhase = name;
    onProgress({ phase: name, state: "STARTED" }); const start = performance.now();
    const value = await work(); const milliseconds = Math.round(performance.now() - start); await measured.sample();
    phases.push({ name, milliseconds }); onProgress({ phase: name, state: "FINISHED", ...phases.at(-1) });
    return value;
  };
  try {
    const cluster = await isolatedPostgres(t, { binaries: postgresBin }), database = await cluster.createDatabase();
    const gitSource = await gitFixture(t);
    const root = await mkdtemp(path.join(tmpdir(), "tq-f001-pilot-"));
    const directory = path.join(root, "selected-directory"); await mkdir(directory, { mode: 0o700 });
    await stage("generate-files", async () => {
      await generate(gitSource.work, filesPerSource - 2, "git"); // Git fixture already has two real files.
      await generate(directory, filesPerSource, "directory"); await mkdir(path.join(directory, "empty-child"), { mode: 0o700 });
      await gitSource.git("add", "."); await gitSource.git("commit", "-m", "pilot A");
      await gitSource.git("push", path.join(gitSource.root, "repo.git"), "main");
    });
    const policy = capturePolicy({ maxEntries: filesPerSource * 2 + 1000, maxFileBytes: "4194304", maxTotalBytes: "536870912", gitTargets: gitSource.targets });
    const blobConfig = { root: path.join(root, "managed-bytes"), keyVersion: "pilot", keys: { pilot: Buffer.alloc(32, 31) }, maxFileBytes: policy.maxFileBytes,
      maxWriters: 4, maxReaders: 16, maxInflightBytes: "16793600" };
    let blobs = await SourceTruthBlobStore.open(blobConfig);
    const git = new GitSourceGateway({ cacheRoot: path.join(root, "git-cache"), targets: gitSource.targets, maxEntries: policy.maxEntries, maxFileBytes: Number(policy.maxFileBytes), maxPackBytes: 64 * 1024 * 1024 });
    let services = sourceTruthServices({ repository: database.repository, blobs, policy, git });
    const gitInput = { sourceId: "git", kind: "GIT", mode: "UPDATE", url: gitSource.url, ref: await gitSource.git("rev-parse", "HEAD"), root: null };
    const directoryInput = { sourceId: "directory", kind: "DIRECTORY_UPLOAD", mode: "UPDATE", label: "完整目录试点" };
    let revision = 0, sentBytes = 0n, reusableBytes = 0n, enumeratedBytes = 0n;
    const startRun = async (input) => {
      revision = (await services.capture.save(owner, "workspace", { expectedRevision: revision, input })).revision;
      const run = await services.capture.start(owner, "workspace", { draftRevision: revision });
      return { run, progressed: await services.capture.advance(owner, "workspace", run.id) };
    };
    const uploadDirectory = async (run) => {
      let batch = [], ordinal = 0, files = 0n, directories = 0n;
      const flush = async () => { await services.capture.enumerateDirectory(owner, "workspace", run.id, "directory", { batchId: String(ordinal++), entries: batch }); batch = []; };
      const entries = async function* () {
        for await (const item of walk(directory)) {
          const entry = { pathBytes: pathBytes(item.name), kind: item.directory ? "DIRECTORY" : "FILE", gitMode: null, sizeBytes: null, expectedContent: null };
          if (item.directory) directories++;
          else {
            files++; const digest = createHash("sha256"); let bytes = 0n;
            for await (const part of createReadStream(path.join(directory, item.name))) { digest.update(part); bytes += BigInt(part.length); }
            enumeratedBytes += bytes; entry.sizeBytes = String(bytes); entry.expectedContent = { algorithm: "sha256", digest: digest.digest("hex") };
          }
          batch.push(entry); if (batch.length === policy.maxBatchEntries) await flush(); yield entry;
        }
        if (batch.length) await flush();
      };
      const manifestId = await orderedArrayDigest("manifest", { kind: "DIRECTORY_UPLOAD" }, "entries", entries());
      await services.capture.closeDirectory(owner, "workspace", run.id, "directory", { fileCount: String(files), directoryCount: String(directories), manifestId });
      const progress = await services.capture.advance(owner, "workspace", run.id);
      assert.equal(progress.status, "WAITING_FOR_CLIENT");
      const context = { workspaceId: "workspace", runId: run.id, sourceId: "directory" };
      let cursor = null, completed = 0;
      do {
        const page = await services.materials.entries(context, { after: cursor, limit: 100 });
        for (const { entry, disposition } of page.items) {
          if (entry.kind !== "FILE") continue;
          if (disposition?.disposition === "VERIFIED") {
            reusableBytes += BigInt(entry.sizeBytes); completed++; continue;
          }
          const checkpoint = await services.upload.checkpoint(owner, context, entry.pathBytes);
          if (checkpoint.reusable) reusableBytes += BigInt(entry.sizeBytes);
          else if (BigInt(entry.sizeBytes) <= BigInt(policy.maxChunkBytes) && checkpoint.verifiedPrefixBytes === "0") {
            await services.capture.uploadFile(owner, "workspace", run.id, "directory", entry.pathBytes,
              createReadStream(path.join(directory, Buffer.from(entry.pathBytes, "base64url").toString("utf8"))));
            sentBytes += BigInt(entry.sizeBytes);
            if (++completed % 1000 === 0) onProgress({ phase: "directory-bytes", verifiedFiles: completed, totalFiles: String(files), sentBytes: String(sentBytes) });
            continue;
          }
          else {
            let offset = BigInt(checkpoint.verifiedPrefixBytes);
            for await (const chunk of createReadStream(path.join(directory, Buffer.from(entry.pathBytes, "base64url").toString("utf8")), { start: Number(offset), highWaterMark: 65536 })) {
              await services.capture.uploadChunk(owner, "workspace", run.id, "directory", { pathBytes: entry.pathBytes, offset: String(offset), sizeBytes: String(chunk.length), digest: hash(chunk) }, [chunk]);
              sentBytes += BigInt(chunk.length); offset += BigInt(chunk.length);
            }
          }
          await services.capture.finishFile(owner, "workspace", run.id, "directory", entry.pathBytes);
          if (++completed % 1000 === 0) onProgress({ phase: "directory-bytes", verifiedFiles: completed, totalFiles: String(files), sentBytes: String(sentBytes) });
        }
        cursor = page.nextCursor;
      } while (cursor);
      return services.capture.advance(owner, "workspace", run.id);
    };
    const freeze = async (review, token) => {
      assert.equal(review.status, "REVIEW_REQUIRED");
      const { context } = await services.capture.context(owner, "workspace", review.id);
      const candidate = review.progress.candidate;
      const confirmation = await services.publication.confirm(owner, context, { candidateId: candidate.id, gapSetId: candidate.gapSetId });
      return services.capture.withHeartbeat(context, () => services.publication.seal(owner, context, { confirmationId: confirmation.id, clientToken: token }));
    };
    const first = await stage("capture-and-freeze-A-D1", async () => {
      const { run, progressed } = await startRun({ sources: [gitInput, directoryInput], baselineBundleId: null });
      assert.equal(progressed.status, "WAITING_FOR_CLIENT");
      return freeze(await uploadDirectory(run), "pilot-A-D1");
    });
    assert.equal(first.bundle.fileCount, String(filesPerSource * 2));
    const initialTransfer = String(sentBytes), initialStored = String(blobs.metrics.streamedBytes);
    const directoryComponent = first.bundle.components.find((item) => item.kind === "DIRECTORY_UPLOAD");
    const second = await stage("Git-B-reuses-D1", async () => {
      const commit = await gitSource.update(), before = blobs.metrics.streamedBytes, sentBefore = sentBytes;
      const { progressed } = await startRun({ baselineBundleId: first.bundle.id, sources: [{ ...gitInput, ref: commit }, { ...directoryInput, mode: "REUSE", componentId: directoryComponent.id }] });
      const result = await freeze(progressed, "pilot-B-D1");
      assert.equal(result.bundle.components.find((item) => item.kind === "DIRECTORY_UPLOAD").id, directoryComponent.id);
      assert.equal(sentBytes, sentBefore); assert.equal(blobs.metrics.streamedBytes - before, BigInt(Buffer.byteLength("fixture version B\n")));
      return result;
    });
    const third = await stage("directory-D2-full-enumeration-incremental-bytes", async () => {
      await rename(path.join(directory, relativeFile(2)), path.join(root, "removed-document-retained"));
      await writeFile(path.join(directory, relativeFile(3)), "changed document v2\n");
      await writeFile(path.join(directory, "new-document.txt"), "new document v2\n", { flag: "wx" });
      const gitComponent = second.bundle.components.find((item) => item.kind === "GIT");
      const before = sentBytes;
      const { run } = await startRun({ baselineBundleId: second.bundle.id, sources: [{ ...gitInput, mode: "REUSE", componentId: gitComponent.id }, directoryInput] });
      const result = await freeze(await uploadDirectory(run), "pilot-B-D2");
      assert.equal(sentBytes - before, BigInt(Buffer.byteLength("changed document v2\nnew document v2\n")));
      const delta = await services.delta.compare(reader, "workspace", { fromBundleId: second.bundle.id, toBundleId: result.bundle.id, sourceId: "directory", limit: 1 });
      assert.equal(delta.counts.added, "1"); assert.equal(delta.counts.modified, "1"); assert.equal(delta.counts.deleted, "1");
      let page = delta, count = 0;
      do { count += page.items.length; if (!page.nextCursor) break; page = await services.delta.compare(reader, "workspace", { fromBundleId: second.bundle.id, toBundleId: result.bundle.id, sourceId: "directory", limit: 1, cursor: page.nextCursor }); } while (true);
      assert.equal(count, 3); return result;
    });
    const resourceCounters = { ...blobs.metrics, nativeGitPeakProcesses: git.process.peakProcesses };
    await stage("source-offline-database-and-storage-reopen", async () => {
      // Move only this owned fixture, keeping it recoverable. Any accidental
      // source re-fetch now fails; history must use captured bytes exclusively.
      await rename(path.join(gitSource.root, "repo.git"), path.join(gitSource.root, "repo-offline.git"));
      await rename(directory, path.join(root, "directory-offline"));
      await cluster.restart();
      const db = cluster.pool(database.name);
      blobs = await SourceTruthBlobStore.open(blobConfig);
      services = sourceTruthServices({ repository: new SourceTruthRepository(db), blobs, policy });
      for (const frozen of [first, third]) {
        const reference = { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id };
        const qualification = await services.admission.qualify(reader, "workspace", reference);
        assert.equal(qualification.fileCount, String(filesPerSource * 2));
        let cursor = null, files = 0, entries = 0;
        do {
          const page = await services.inspection.inventory(reader, "workspace", reference, { cursor, limit: 200 });
          for (const item of page.items) { entries++; if (item.entry.kind === "FILE") files++; }
          cursor = page.nextCursor;
        } while (cursor);
        assert.equal(files, filesPerSource * 2); assert.equal(String(entries), String(BigInt(qualification.fileCount) + BigInt(qualification.directoryCount)));
      }
    });
    await measured.stop();
    assert.equal(measured.result.samplingErrors, 0, "a failed measurement is not a zero resource result");
    assert.ok(measured.result.sampleCount > 0);
    onProgress({ phase: "resource-measurements", ...measured.result });
    assert.ok(measured.result.peakObservedProcessTreeRssBytes <= maxTreeRssBytes, `process-tree sampled RSS ${measured.result.peakObservedProcessTreeRssBytes} exceeds supplied budget ${maxTreeRssBytes}`);
    assert.ok(measured.result.peakObservedProcessTreeFileDescriptors <= maxTreeFileDescriptors, `process-tree sampled descriptors ${measured.result.peakObservedProcessTreeFileDescriptors} exceed supplied budget ${maxTreeFileDescriptors}`);
    assert.ok(resourceCounters.peakWriters <= 4 && resourceCounters.peakReaders <= 16 && resourceCounters.nativeGitPeakProcesses <= 2);
    const report = { status: "PASSED", scope: "REAL_POSTGRES_HTTPS_GIT_DIRECTORY_SERVICE_PILOT", browserVerified: false, disasterDeploymentVerified: false,
      environment: { node: process.version, platform: platform(), release: release() }, filesPerSource, totalFiles: filesPerSource * 2, phases,
      initialDirectoryTransferredBytes: initialTransfer, initialStorageWrittenBytes: initialStored, totalDirectoryTransferredBytes: String(sentBytes),
      directoryReusedBytes: String(reusableBytes), directoryEnumerationHashedBytes: String(enumeratedBytes), resources: measured.result,
      resourceCounters, budgets: { maxTreeRssBytes, maxTreeFileDescriptors }, bundleIds: [first, second, third].map((item) => item.bundle.id) };
    await writeFile(path.join(root, "report.json"), JSON.stringify(report, (_, value) => typeof value === "bigint" ? String(value) : value, 2), { mode: 0o600, flag: "wx" });
    return { ...report, artifactRoot: root };
  } finally { clearInterval(pulse); await measured.stop(); for (const cleanup of cleanups.reverse()) await cleanup(); }
}
