import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { GitSourceGateway } from "../src/source-truth/git-gateway.js";
import { displayPath } from "../src/source-truth/identity.js";
import { gitFixture } from "./support/source-truth-git-fixture.js";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { Transform } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

const collect = async (stream) => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks); };
const scope = { tenantId: "tenant", workspaceId: "workspace", sourceId: "git-registration" };
function gateway(fixture) { return new GitSourceGateway({ cacheRoot: path.join(fixture.root, "private-cache"), targets: fixture.targets, maxFileBytes: 1024 * 1024, maxPackBytes: 16 * 1024 * 1024, timeoutMs: 30000 }); }

test("B-08/09 interrupted real HTTPS fetch can retry without losing its historical capture", { timeout: 20000 }, async (t) => {
  let pause = false;
  let packStarted;
  const started = new Promise((resolve) => { packStarted = resolve; });
  const fixture = await gitFixture(t, { transformResponse(request) {
    if (!pause || request.method !== "POST") return null;
    let prefix = Buffer.alloc(0);
    return new Transform({ transform(chunk, encoding, callback) {
      const probe = Buffer.concat([prefix, chunk]);
      prefix = probe.subarray(-3);
      if (probe.includes(Buffer.from("PACK"))) {
        this.push(chunk.subarray(0, Math.min(4096, chunk.length)));
        packStarted(); // Deliberately retain this callback until cancellation.
        return;
      }
      callback(null, chunk);
    } });
  } });
  const git = gateway(fixture);
  const input = { url: fixture.url, ref: "main", root: null };
  const a = await git.capture(scope, input);
  const entries = []; for await (const entry of git.entries(a)) entries.push(entry);
  await writeFile(path.join(fixture.work, "payload.bin"), randomBytes(512 * 1024));
  const commitB = await fixture.update();
  pause = true;
  const abort = new AbortController();
  t.after(() => abort.abort());
  const interrupted = assert.rejects(git.capture(scope, { ...input, ref: commitB }, { signal: abort.signal }),
    { code: "SOURCE_GIT_TRANSFER_FAILED" });
  let startTimer;
  try { await Promise.race([started, new Promise((_, reject) => { startTimer = setTimeout(() => reject(new Error("real pack did not start")), 5000); })]); }
  finally { clearTimeout(startTimer); }
  const lock = path.join(git.location(a), "shallow.lock");
  let lockObserved = false;
  for (let tries = 0; tries < 100; tries++) {
    try { lockObserved = (await lstat(lock)).isFile(); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (lockObserved) break;
    await delay(20);
  }
  assert.equal(lockObserved, true, "native fetch must create its own lock before interruption");
  const liveLock = await lstat(lock);
  const lockBytes = await readFile(lock);
  await assert.rejects(gateway(fixture).capture(scope, { ...input, ref: commitB }), { code: "SOURCE_GIT_BUSY" });
  assert.equal((await lstat(lock)).ino, liveLock.ino, "a contender cannot recover a live native lock");
  abort.abort();
  await interrupted;
  assert.equal(git.process.active, 0);
  pause = false;
  const restart = gateway(fixture);
  const b = await restart.capture(scope, { ...input, ref: commitB });
  assert.equal(b.commit, commitB, "a new executor must finish the originally selected commit");
  const recoveryRoot = path.join(git.location(a), ".interrupted-locks");
  const recoveries = await readdir(recoveryRoot);
  assert.equal(recoveries.length, 1);
  const preserved = path.join(recoveryRoot, recoveries[0], "shallow.lock");
  assert.deepEqual(await readFile(preserved), lockBytes, "interrupted metadata is preserved, not published or deleted");
  assert.equal((await lstat(preserved)).ino, liveLock.ino);
  assert.equal((await collect(restart.readBlob(a, entries[0]))).toString(), "fixture version A\n");
});

test("B-09 aggregate Git cache capacity blocks new capture without removing readable old objects", async (t) => {
  const fixture = await gitFixture(t);
  const original = gateway(fixture);
  const a = await original.capture(scope, { url: fixture.url, ref: "main", root: null });
  const rows = []; for await (const row of original.entries(a)) rows.push(row);
  const before = await readdir(original.config.cacheRoot);
  const limited = new GitSourceGateway({ ...original.config, maxCacheBytes: "1" });
  await assert.rejects(limited.capture({ ...scope, sourceId: "another-registration" }, { url: fixture.url, ref: fixture.commitA, root: null }),
    { code: "SOURCE_CAPACITY_EXHAUSTED", status: 507 });
  assert.deepEqual(await readdir(original.config.cacheRoot), before, "denied captures do not allocate more source directories");
  assert.equal((await collect(limited.readBlob(a, rows[0]))).toString(), "fixture version A\n", "capacity exhaustion never disables historical reads");
});

test("B-01/02/07 HTTPS capture locks commit objects and replays them after the ref moves", async (t) => {
  const fixture = await gitFixture(t);
  const git = gateway(fixture);
  const a = await git.capture(scope, { url: fixture.url, ref: "main", root: null });
  assert.equal(a?.commit, fixture.commitA);
  assert.equal(a.objectFormat, "sha1");
  const rows = []; for await (const entry of git.entries(a)) rows.push(entry);
  assert.deepEqual(rows.map((entry) => displayPath(entry.pathBytes)), ["README.md", "src", "src/orders.js"]);
  assert.equal((await collect(git.readBlob(a, rows[0]))).toString(), "fixture version A\n");
  const commitB = await fixture.update();
  const b = await git.capture(scope, { url: fixture.url, ref: commitB, root: null });
  assert.equal(b.commit, commitB);
  assert.equal((await collect(git.readBlob(a, rows[0]))).toString(), "fixture version A\n");
  const restart = gateway(fixture);
  assert.equal((await collect(restart.readBlob(a, rows[0]))).toString(), "fixture version A\n");
});

test("B-05/13 a missing root and HTTPS redirects cannot become an empty successful source", async (t) => {
  const fixture = await gitFixture(t);
  const git = gateway(fixture);
  await assert.rejects(git.capture(scope, { url: fixture.url, ref: "main", root: "missing" }), { code: "SOURCE_GIT_ROOT_MISSING" });
  await assert.rejects(git.capture(scope, { url: `${fixture.origin}/redirect`, ref: "main", root: null }), { code: "SOURCE_GIT_TRANSFER_FAILED" });
});

test("B-06 native Git batch uses one process and verifies each framed blob without buffering the batch", async (t) => {
  const fixture = await gitFixture(t);
  const git = gateway(fixture);
  const snapshot = await git.capture(scope, { url: fixture.url, ref: "main", root: null });
  const entries = []; for await (const entry of git.entries(snapshot)) if (entry.kind === "FILE") entries.push(entry);
  const processCalls = t.mock.method(git.process, "stream", git.process.stream.bind(git.process));
  const values = [];
  // Until batch support exists, exercise the real behavior, not an import error.
  const batches = git.readBlobs ? git.readBlobs(snapshot, entries) : (async function* () {
    for (const entry of entries) yield { entry, content: git.readBlob(snapshot, entry) };
  })();
  for await (const item of batches) values.push((await collect(item.content)).toString());
  assert.deepEqual(values, ["fixture version A\n", "throw new Error('SOURCE_MUST_NEVER_EXECUTE');\n"]);
  assert.equal(processCalls.mock.callCount(), 1, "batch must not spawn one Git process per file");
  assert.equal(git.process.active, 0);
});
