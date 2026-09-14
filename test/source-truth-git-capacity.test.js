import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { GitProcess } from "../src/source-truth/git-process.js";
import { checkGitCacheCapacity, gitCacheBudget } from "../src/source-truth/git-cache-capacity.js";
import { decodeGitCacheFailure, encodeGitCacheFailure } from "../src/source-truth/git-cache-diagnostic.js";

const writer = fileURLToPath(new URL("./support/source-truth-git-cache-writer.js", import.meta.url));
const ownerScript = fileURLToPath(new URL("./support/source-truth-git-cache-owner.js", import.meta.url));
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "tq-f001-git-budget-"));
  const budget = gitCacheBudget(root, { maxCacheBytes: "1250000", maxPackBytes: 65536 });
  const cwd = path.join(root, "a".repeat(64), "sha1");
  // The aggregate budget is intentionally below two legal individual files.
  const process = new GitProcess({ executable: globalThis.process.execPath, maxPackBytes: 1024 * 1024, timeoutMs: 6000 });
  return { root, budget, cwd, process, options: { cwd, cacheBudget: budget } };
}

test("B-09 a successful native exit cannot hide aggregate cache exhaustion", async () => {
  const f = await fixture();
  await assert.rejects(f.process.run([writer, "burst"], f.options), { code: "SOURCE_CAPACITY_EXHAUSTED", status: 507 });
  assert.ok((await stat(path.join(f.cwd, "part-a"))).size < f.process.maxPackBytes);
  assert.ok((await stat(path.join(f.cwd, "part-b"))).size < f.process.maxPackBytes);
  assert.equal(f.process.active, 0);
});

test("B-09 runtime capacity monitoring stops the native writer, retains bytes, and releases its lock", async () => {
  const f = await fixture(), started = Date.now();
  await assert.rejects(f.process.run([writer, "burst-and-wait"], f.options), { code: "SOURCE_CAPACITY_EXHAUSTED", status: 507 });
  assert.ok(Date.now() - started < 5000, "capacity failure must precede the six-second generic timeout");
  assert.equal((await readFile(path.join(f.cwd, "part-a"))).length, 700 * 1024);
  await assert.rejects(stat(path.join(f.cwd, "must-not-complete")), { code: "ENOENT" });
  const enlarged = { ...f.options, cacheBudget: { ...f.budget, maximum: "4000000" } };
  assert.equal((await f.process.run([writer, "ok"], enlarged)).toString(), "OK\n");
});

test("B-09 independent process owners share the cache lock; abort releases it without deleting the lock inode", async () => {
  const f = await fixture(), abort = new AbortController();
  const first = f.process.stream([writer, "hold"], { ...f.options, signal: abort.signal });
  assert.equal((await first.next()).value.toString(), "READY\n");
  const lockBefore = await stat(path.join(f.root, ".capture.lock"));
  const contender = new GitProcess({ executable: process.execPath });
  await assert.rejects(contender.run([writer, "ok"], f.options), { code: "SOURCE_GIT_BUSY", status: 429 });
  assert.equal(contender.active, 0);
  abort.abort();
  await assert.rejects(first.next(), { code: "SOURCE_GIT_TRANSFER_FAILED" });
  assert.equal(f.process.active, 0);
  assert.equal((await contender.run([writer, "ok"], f.options)).toString(), "OK\n");
  assert.equal((await stat(path.join(f.root, ".capture.lock"))).ino, lockBefore.ino);
});

test("B-09 capacity admission reserves headroom before creating a source directory", async () => {
  const f = await fixture();
  const options = { ...f.options, cacheBudget: { ...f.budget, maximum: "1048576" } };
  await assert.rejects(f.process.run([writer, "ok"], options), { code: "SOURCE_CAPACITY_EXHAUSTED", status: 507 });
  assert.deepEqual(await readdir(f.root), [".capture.lock"]);
  await assert.rejects(f.process.run([writer, "ok"], { ...f.options, cacheBudget: { ...f.budget, minimumFree: "9999999999999999" } }), { code: "SOURCE_CAPACITY_EXHAUSTED", status: 507 });
  assert.deepEqual(await readdir(f.root), [".capture.lock"]);
});

test("B-09 an API owner crash stops its native group and permits a new owner", { timeout: 10000 }, async (t) => {
  const f = await fixture();
  const owner = spawn(process.execPath, [ownerScript, f.root, f.cwd], { stdio: ["ignore", "pipe", "pipe"] });
  owner.stderr.resume();
  const exited = once(owner, "exit");
  let group;
  t.after(async () => {
    if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
    if (group) { try { process.kill(-group, "SIGKILL"); } catch { /* already reaped */ } }
    await exited;
  });
  let output = "";
  for await (const bytes of owner.stdout) {
    output += bytes;
    const found = /^GROUP:(\d+)\n$/.exec(output);
    if (found) { group = Number(found[1]); break; }
  }
  assert.ok(Number.isInteger(group) && group > 1);
  owner.kill("SIGKILL");
  await exited;
  const contender = new GitProcess({ executable: process.execPath });
  let recovered = false;
  for (let attempts = 0; attempts < 10; attempts++) {
    try {
      assert.equal((await contender.run([writer, "ok"], f.options)).toString(), "OK\n");
      recovered = true; break;
    } catch (error) {
      assert.equal(error.code, "SOURCE_GIT_BUSY");
      await delay(100);
    }
  }
  assert.equal(recovered, true, "lost owner must not leave a native writer holding the cache for its remaining lifetime");
});

test("B-09 cache budgets reject malformed or unbounded deployment values", () => {
  assert.equal(gitCacheBudget("/unused").maximum, "4294967296");
  for (const value of [0, -1, 1.1, NaN, Infinity, "", "001", "1e9", null, ["1000"], Number.MAX_SAFE_INTEGER + 1, "99999999999999999"]) {
    assert.throws(() => gitCacheBudget("/unused", { maxCacheBytes: value }), { code: "SOURCE_CONFIGURATION_INVALID" });
  }
});

test("B-09 private supervisor diagnostics identify unsafe entries without exposing their names", async () => {
  const f = await fixture();
  await symlink("/fixture-secret-do-not-expose", path.join(f.root, "private-name-do-not-expose"));
  await assert.rejects(f.process.run([writer, "ok"], f.options), (error) => {
    assert.equal(error.code, "SOURCE_STORAGE_NOT_READY");
    assert.equal(error.status, 503);
    assert.equal(error.details, null);
    assert.deepEqual(error.cause, { phase: "ADMISSION", operation: "ENTRY_TYPE", errno: null, entryKind: "OTHER" });
    assert.doesNotMatch(JSON.stringify(error), /do-not-expose/);
    return true;
  });
  assert.equal(f.process.active, 0);
});

test("B-09 missing cache roots retain only a safe filesystem diagnosis and remain rejected", async () => {
  const f = await fixture();
  await assert.rejects(checkGitCacheCapacity({ ...f.budget, root: path.join(f.root, "private-name-do-not-expose") }), (error) => {
    assert.equal(error.code, "SOURCE_STORAGE_NOT_READY");
    assert.deepEqual(error.cause, { phase: "UNKNOWN", operation: "ENTRY_STAT", errno: "ENOENT", entryKind: "ROOT" });
    assert.doesNotMatch(JSON.stringify(error), /do-not-expose/);
    return true;
  });
});

test("B-09 supervisor control diagnostics never forward unknown values or malformed frames", () => {
  const secret = "fixture-secret-do-not-expose";
  const encoded = encodeGitCacheFailure({ code: secret, cause: {
    operation: secret, errno: secret, entryKind: secret, path: secret, message: secret,
  } }, secret);
  assert.doesNotMatch(encoded, /do-not-expose/);
  for (const control of [encoded, "STORAGE\n", secret, "{\n", "x".repeat(513), "null\n",
    JSON.stringify({ kind: secret, diagnostic: { phase: secret, operation: secret, errno: secret, entryKind: secret } }) + "\n"]) {
    const error = decodeGitCacheFailure(control);
    assert.equal(error.code, "SOURCE_STORAGE_NOT_READY");
    assert.equal(error.status, 503);
    assert.equal(error.details, null);
    assert.deepEqual(error.cause, { phase: "UNKNOWN", operation: "UNKNOWN", errno: null, entryKind: "OTHER" });
    assert.doesNotMatch(JSON.stringify(error), /do-not-expose/);
  }
  const exhausted = decodeGitCacheFailure(encodeGitCacheFailure({ code: "SOURCE_CAPACITY_EXHAUSTED",
    cause: { operation: "FILESYSTEM_CAPACITY", entryKind: "ROOT" } }, "FINAL"));
  assert.equal(exhausted.code, "SOURCE_CAPACITY_EXHAUSTED");
  assert.equal(exhausted.status, 507);
  assert.deepEqual(exhausted.cause, { phase: "FINAL", operation: "FILESYSTEM_CAPACITY", entryKind: "ROOT", errno: null });
});

test("B-09 unsafe cache entries and lock paths fail closed without exposing local or source text", async () => {
  const f = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), "tq-f001-git-budget-outside-"));
  await writeFile(path.join(outside, "secret"), "fixture-secret-do-not-expose");
  await symlink(path.join(outside, "secret"), path.join(f.root, ".capture.lock"));
  await assert.rejects(f.process.run([writer, "ok"], f.options), (error) => {
    assert.equal(error.code, "SOURCE_STORAGE_NOT_READY");
    assert.equal(error.message.includes(f.root), false);
    return true;
  });
  assert.equal(f.process.active, 0);
  const another = await fixture();
  await mkdir(path.join(another.root, "contents"));
  await symlink(outside, path.join(another.root, "contents", "unsafe"));
  await assert.rejects(checkGitCacheCapacity(another.budget), { code: "SOURCE_STORAGE_NOT_READY" });
  const clean = await fixture();
  await assert.rejects(clean.process.run([writer, "credential-check"], clean.options), (error) => {
    assert.equal(error.code, "SOURCE_GIT_TRANSFER_FAILED");
    assert.equal(error.message.includes("fixture-secret-do-not-expose"), false);
    return true;
  });
});
