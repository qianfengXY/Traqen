// Only the trusted write supervisor calls this, while holding the cache-wide
// kernel lock. No time/PID heuristic can establish that a Git lock is stale.
import { lstat, mkdir, mkdtemp, open, opendir, rename } from "node:fs/promises";
import path from "node:path";
import { requireValue } from "./errors.js";

async function optionalStat(location) {
  try { return await lstat(location); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function privateEntry(stat, directory) {
  requireValue(stat && (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1)
    && !(stat.mode & 0o077) && stat.uid === process.getuid(),
  "SOURCE_STORAGE_NOT_READY", "Git 中断元数据不能安全恢复", { status: 503 });
}
async function syncDirectory(location) {
  const handle = await open(location, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function preserveInterruptedGitLocks(cwd) {
  const locks = [];
  const add = async (relative) => {
    const stat = await optionalStat(path.join(cwd, relative));
    if (!stat) return;
    privateEntry(stat, false);
    locks.push(relative);
  };
  // These are the metadata paths our init/fetch commands can lock. Never
  // glob arbitrary '*.lock' paths or move objects, refs, or an unfinished pack.
  for (const name of ["config.lock", "HEAD.lock", "shallow.lock", "packed-refs.lock"]) await add(name);
  const refDirectory = path.join("refs", "traqen", "captures");
  let current = cwd, refsPresent = true;
  for (const part of refDirectory.split(path.sep)) {
    current = path.join(current, part);
    const stat = await optionalStat(current);
    if (!stat) { refsPresent = false; break; }
    privateEntry(stat, true);
  }
  if (refsPresent) {
    let count = 0;
    const directory = await opendir(current, { bufferSize: 32 });
    for await (const entry of directory) {
      requireValue(++count <= 100000, "SOURCE_STORAGE_NOT_READY", "Git 中断元数据超出恢复边界", { status: 503 });
      if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})\.lock$/.test(entry.name)) await add(path.join(refDirectory, entry.name));
    }
  }
  if (!locks.length) return false;
  const archive = path.join(cwd, ".interrupted-locks");
  try { await mkdir(archive, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
  privateEntry(await lstat(archive), true);
  const destination = await mkdtemp(path.join(archive, "recovery-"));
  const sync = new Set([cwd, archive, destination]);
  for (const relative of locks) {
    let parent = destination;
    for (const part of path.dirname(relative).split(path.sep).filter((part) => part !== ".")) {
      parent = path.join(parent, part);
      try { await mkdir(parent, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
      sync.add(parent);
    }
    await rename(path.join(cwd, relative), path.join(destination, relative));
    sync.add(path.dirname(path.join(cwd, relative)));
  }
  // Rename preserves the original bytes/inode. The original relative path is
  // retained beneath a fresh private recovery directory, with no TTL/cleanup.
  for (const directory of [...sync].reverse()) await syncDirectory(directory);
  return true;
}
