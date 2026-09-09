import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, statfs } from "node:fs/promises";
import path from "node:path";
import { requireValue, SourceTruthError } from "./errors.js";
import { gitCacheDiagnostic } from "./git-cache-diagnostic.js";

const capacity = () => new SourceTruthError("SOURCE_CAPACITY_EXHAUSTED", "Git 缓存容量不足；扩容或恢复存储后重试，已有材料保留", { status: 507 });

export function gitCacheBudget(root, { maxCacheBytes = "4294967296", minFreeBytes = "0", maxPackBytes = 268435456 } = {}) {
  const count = (value, positive) => {
    requireValue((typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value)))
      && /^(0|[1-9][0-9]{0,15})$/.test(String(value)), "SOURCE_CONFIGURATION_INVALID", "Git 缓存容量配置无效", { status: 503 });
    const number = BigInt(value);
    requireValue(number >= (positive ? 1n : 0n), "SOURCE_CONFIGURATION_INVALID", "Git 缓存容量配置无效", { status: 503 });
    return number;
  };
  const maximum = count(maxCacheBytes, true), minimumFree = count(minFreeBytes, false);
  // Admission headroom, not a claim that native Git can write only one pack.
  const reserve = count(maxPackBytes, true) + 1048576n;
  return { root, maximum: String(maximum), minimumFree: String(minimumFree), reserve: String(reserve) };
}

export async function openGitCacheLock(root) {
  let handle;
  try {
    handle = await open(path.join(root, ".capture.lock"), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    const stat = await handle.stat();
    requireValue(stat.isFile() && stat.nlink === 1 && !(stat.mode & 0o077) && stat.uid === process.getuid(),
      "SOURCE_STORAGE_NOT_READY", "Git 缓存写入锁的类型或权限异常", { status: 503 });
    return handle;
  } catch (error) {
    await handle?.close();
    if (error instanceof SourceTruthError) throw error;
    if (["ENOSPC", "EDQUOT"].includes(error.code)) throw capacity();
    throw new SourceTruthError("SOURCE_STORAGE_NOT_READY", "无法安全取得 Git 缓存写入锁", { status: 503, cause: error });
  }
}

export async function checkGitCacheCapacity(budget, reservation = 0n) {
  const maximum = BigInt(budget.maximum), minimumFree = BigInt(budget.minimumFree);
  let accounted = 0n, entries = 0;
  let operation = "SCAN_BOUND", entryKind = "ROOT";
  const visit = async (location, depth) => {
    const name = path.basename(location);
    const kind = depth === 0 ? "ROOT" : name.endsWith(".lock") ? "LOCK" : name.startsWith("tmp_pack_") ? "PACK_TEMP"
      : name.endsWith(".pack") ? "PACK" : name.endsWith(".idx") ? "INDEX" : "OTHER";
    entryKind = kind; operation = "SCAN_BOUND";
    requireValue(depth <= 16 && ++entries <= 100000, "SOURCE_STORAGE_NOT_READY", "Git 缓存计量超过有界扫描范围，请检查存储", { status: 503 });
    operation = "ENTRY_STAT";
    const stat = await lstat(location, { bigint: true });
    operation = "ENTRY_TYPE";
    requireValue(!stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory()), "SOURCE_STORAGE_NOT_READY", "Git 缓存包含不可安全计量的条目", { status: 503 });
    // Conservative accounting for sparse/compressed files, not a dedup claim.
    accounted += stat.size > stat.blocks * 512n ? stat.size : stat.blocks * 512n;
    operation = "ENTRY_CAPACITY";
    if (accounted + reservation > maximum) throw capacity();
    if (stat.isDirectory()) {
      operation = "DIRECTORY_OPEN";
      const directory = await opendir(location, { bufferSize: 32 });
      operation = "DIRECTORY_READ";
      for await (const entry of directory) {
        await visit(path.join(location, entry.name), depth + 1);
        operation = "DIRECTORY_READ"; entryKind = kind;
      }
    }
  };
  try {
    await visit(budget.root, 0);
    operation = "FILESYSTEM_STAT"; entryKind = "ROOT";
    const filesystem = await statfs(budget.root, { bigint: true });
    operation = "FILESYSTEM_CAPACITY";
    if (filesystem.bavail * filesystem.bsize < minimumFree + reservation) throw capacity();
    return accounted;
  } catch (error) {
    const cause = gitCacheDiagnostic({ operation, entryKind, errno: error.code });
    if (error instanceof SourceTruthError) {
      error.cause = cause;
      throw error;
    }
    throw new SourceTruthError("SOURCE_STORAGE_NOT_READY", "无法完整核验 Git 缓存容量，请恢复存储后重试", { status: 503, cause });
  }
}

export async function prepareGitCacheDirectory(root, cwd) {
  const relative = path.relative(root, cwd), segments = relative.split(path.sep);
  requireValue(segments.length === 2 && /^[a-f0-9]{64}$/.test(segments[0]) && ["sha1", "sha256"].includes(segments[1]),
    "SOURCE_STORAGE_NOT_READY", "Git 缓存目录定位无效", { status: 503 });
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    const stat = await lstat(current);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077), "SOURCE_STORAGE_NOT_READY", "Git 缓存目录类型或权限异常", { status: 503 });
  }
}
