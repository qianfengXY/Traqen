import assert from "node:assert/strict";
import test from "node:test";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { preserveInterruptedGitLocks } from "../src/source-truth/git-cache-recovery.js";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "tq-f001-git-recovery-"));
  const put = async (relative, content) => {
    const location = path.join(root, relative);
    await mkdir(path.dirname(location), { recursive: true, mode: 0o700 });
    await writeFile(location, content, { mode: 0o600 });
  };
  return { root, put };
}

test("B-08 Git recovery preserves only known interrupted metadata, never committed refs or object bytes", async () => {
  const f = await fixture();
  const oid = "a".repeat(40), oid256 = "b".repeat(64);
  const locks = ["HEAD.lock", "config.lock", "packed-refs.lock", "shallow.lock", `refs/traqen/captures/${oid}.lock`, `refs/traqen/captures/${oid256}.lock`];
  const retained = ["HEAD", "config", "packed-refs", "shallow", `refs/traqen/captures/${oid}`, "refs/traqen/captures/unowned.lock", "objects/pack/tmp_pack_fixture", "objects/pack/pack-fixture.pack", "objects/pack/pack-fixture.idx", "objects/pack/pack-fixture.keep"];
  const before = new Map();
  for (const name of [...locks, ...retained]) {
    await f.put(name, `evidence:${name}\n`);
    before.set(name, (await lstat(path.join(f.root, name))).ino);
  }
  assert.equal(await preserveInterruptedGitLocks(f.root), true);
  const [record] = await readdir(path.join(f.root, ".interrupted-locks"));
  for (const name of locks) {
    await assert.rejects(lstat(path.join(f.root, name)), { code: "ENOENT" });
    const archived = path.join(f.root, ".interrupted-locks", record, name);
    assert.equal((await lstat(archived)).ino, before.get(name));
    assert.equal(await readFile(archived, "utf8"), `evidence:${name}\n`);
  }
  for (const name of retained) {
    assert.equal((await lstat(path.join(f.root, name))).ino, before.get(name));
    assert.equal(await readFile(path.join(f.root, name), "utf8"), `evidence:${name}\n`);
  }
  assert.equal(await preserveInterruptedGitLocks(f.root), false, "a repeated attempt cannot reinterpret an archived lock");
  assert.deepEqual(await readdir(path.join(f.root, ".interrupted-locks")), [record]);
});

test("B-05 Git recovery refuses unsafe locks and archive paths before moving any evidence", async () => {
  for (const unsafe of ["symlink", "hardlink", "directory", "public", "archive-symlink"]) {
    const f = await fixture(), outside = await fixture();
    await outside.put("private", "outside-evidence");
    await f.put("HEAD.lock", "must-stay-in-place");
    const lock = path.join(f.root, "shallow.lock");
    if (unsafe === "symlink") await symlink(path.join(outside.root, "private"), lock);
    if (unsafe === "hardlink") await link(path.join(outside.root, "private"), lock);
    if (unsafe === "directory") await mkdir(lock, { mode: 0o700 });
    if (unsafe === "public") { await writeFile(lock, "unsafe-mode"); await chmod(lock, 0o644); }
    if (unsafe === "archive-symlink") await symlink(outside.root, path.join(f.root, ".interrupted-locks"));
    await assert.rejects(preserveInterruptedGitLocks(f.root), { code: "SOURCE_STORAGE_NOT_READY" }, unsafe);
    assert.equal(await readFile(path.join(f.root, "HEAD.lock"), "utf8"), "must-stay-in-place");
    assert.equal(await readFile(path.join(outside.root, "private"), "utf8"), "outside-evidence");
  }
});
