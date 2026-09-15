import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkGitCacheCapacity, gitCacheBudget } from "../src/source-truth/git-cache-capacity.js";

const runtime = { duringWrite: true };
const nativeStat = fs.lstat;

// Each test runs serially in this file's isolated Node test process. Replace
// the real filesystem boundary, not product logic or a production test hook.
function intercept(t, name, implementation) {
  const mock = t.mock.method(fs, name, implementation);
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "tq-f001-cache-race-"));
  const budget = gitCacheBudget(root, { maxCacheBytes: "10485760", maxPackBytes: 1024 });
  const objects = path.join(root, "a".repeat(64), "sha1", "objects");
  const pack = path.join(objects, "pack");
  await fs.mkdir(pack, { recursive: true, mode: 0o700 });
  const temporary = path.join(pack, "tmp_pack_fixture");
  await fs.writeFile(temporary, Buffer.alloc(16384, 42));
  return { root, budget, pack, temporary, final: path.join(pack, "pack-fixture.pack") };
}

for (const method of ["rename", "link-unlink"]) {
  test(`B-09 runtime rescan accounts for a pack finalized by ${method} between enumeration and lstat`, async (t) => {
    const f = await fixture();
    let transitions = 0, roots = 0;
    intercept(t, "lstat", async (location, options) => {
      if (location === f.root) roots++;
      if (location === f.temporary && transitions++ === 0) {
        if (method === "rename") await fs.rename(location, f.final);
        else { await fs.link(location, f.final); await fs.unlink(location); }
      }
      return nativeStat(location, options);
    });
    const observed = await checkGitCacheCapacity(f.budget, 0n, runtime);
    assert.equal(roots, 2, "the vanished entry requires a new root-to-leaf accounting pass");
    assert.ok(observed >= 16384n, "the final pack must not be skipped");
    assert.equal(observed, await checkGitCacheCapacity(f.budget), "partial sums must not survive a restarted scan");
  });
}

test("B-09 runtime rescan still rejects aggregate capacity and unsafe replacement entries", async (t) => {
  for (const unsafe of [false, true]) {
    await t.test(unsafe ? "unsafe entry" : "aggregate capacity", async (t) => {
      const f = await fixture();
      // Root-wide restart is required even if the replacement is in a directory
      // already visited. A local retry of only the vanished pathname is wrong.
      const destination = path.join(f.root, "settled.pack");
      let moved = false;
      intercept(t, "lstat", async (location, options) => {
        if (location === f.temporary && !moved) {
          moved = true;
          await fs.rename(location, destination);
          if (unsafe) await fs.symlink("/fixture-private-target", path.join(f.root, "unsafe"));
          else await fs.writeFile(destination, Buffer.alloc(32768, 1));
        }
        return nativeStat(location, options);
      });
      await assert.rejects(checkGitCacheCapacity({ ...f.budget, maximum: unsafe ? f.budget.maximum : "20000" }, 0n, runtime), (error) => {
        assert.equal(error.code, unsafe ? "SOURCE_STORAGE_NOT_READY" : "SOURCE_CAPACITY_EXHAUSTED");
        assert.equal(error.cause.operation, unsafe ? "ENTRY_TYPE" : "ENTRY_CAPACITY");
        return true;
      });
      assert.equal(moved, true);
    });
  }
});

test("B-09 runtime rescans are bounded under repeated disappearance; no partial scan is accepted", async (t) => {
  const f = await fixture();
  let calls = 0;
  intercept(t, "lstat", async (location, options) => {
    if (location === f.temporary) { calls++; throw Object.assign(new Error("private"), { code: "ENOENT" }); }
    return nativeStat(location, options);
  });
  await assert.rejects(checkGitCacheCapacity(f.budget, 0n, runtime), (error) => {
    assert.equal(error.code, "SOURCE_STORAGE_NOT_READY");
    assert.deepEqual(error.cause, { phase: "UNKNOWN", operation: "ENTRY_STAT", errno: "ENOENT", entryKind: "PACK_TEMP" });
    return true;
  });
  assert.equal(calls, 3, "one scan and at most two full restarts");
});

test("B-09 admission/final checks remain strict and runtime never retries root or non-ENOENT faults", async (t) => {
  for (const scenario of ["strict", "root", "EACCES", "EIO", "directory"]) {
    await t.test(scenario, async (t) => {
      const f = await fixture();
      const target = scenario === "root" ? f.root : scenario === "directory" ? f.pack : f.temporary;
      const errno = ["EACCES", "EIO"].includes(scenario) ? scenario : "ENOENT";
      let calls = 0;
      intercept(t, "lstat", async (location, options) => {
        if (location === target) { calls++; throw Object.assign(new Error("private"), { code: errno }); }
        return nativeStat(location, options);
      });
      await assert.rejects(checkGitCacheCapacity(f.budget, 0n, scenario === "strict" ? undefined : runtime), { code: "SOURCE_STORAGE_NOT_READY" });
      assert.equal(calls, 1);
    });
  }
});

test("B-09 a rescan shares the original entry-work bound instead of multiplying it", async (t) => {
  const f = await fixture(), fileStat = await nativeStat(f.temporary, { bigint: true });
  let reads = 0, rootScans = 0, closed = 0;
  intercept(t, "opendir", async () => ({
    async *[Symbol.asyncIterator]() {
      rootScans++;
      try {
        for (let index = 0; index < 60000; index++) yield { name: `entry-${index}`, isFile: () => true };
      } finally { closed++; }
    },
  }));
  intercept(t, "lstat", async (location, options) => {
    if (location === f.root) return nativeStat(location, options);
    reads++;
    if (reads === 60000) throw Object.assign(new Error("private"), { code: "ENOENT" });
    return fileStat;
  });
  await assert.rejects(checkGitCacheCapacity({ ...f.budget, maximum: "999999999999999" }, 0n, runtime), (error) => {
    assert.equal(error.code, "SOURCE_STORAGE_NOT_READY");
    assert.equal(error.cause.operation, "SCAN_BOUND");
    return true;
  });
  assert.equal(rootScans, 2);
  assert.ok(reads <= 100000);
  assert.equal(closed, 2, "interrupted scans must close every iterator");
});
