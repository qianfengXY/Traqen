import { SourceTruthError } from "./errors.js";

// This is a private supervisor protocol, not a source-facing error contract.
// Only enum values cross it: never forward fs messages, paths or Git stderr.
const phases = new Set(["ADMISSION", "PREPARE", "RECOVERY", "RUNTIME", "FINAL"]);
const operations = new Set(["SCAN_BOUND", "ENTRY_STAT", "ENTRY_TYPE", "ENTRY_CAPACITY", "DIRECTORY_OPEN", "DIRECTORY_READ", "FILESYSTEM_STAT", "FILESYSTEM_CAPACITY"]);
const errnos = new Set(["ENOENT", "EACCES", "EPERM", "EIO", "ENOSPC", "EDQUOT", "EMFILE", "ENFILE", "ENOTDIR", "ELOOP", "EBADF", "ENOMEM", "ESTALE", "EBUSY", "EINTR"]);
const entryKinds = new Set(["ROOT", "LOCK", "PACK_TEMP", "PACK", "INDEX", "OTHER"]);
export const MAX_GIT_CACHE_CONTROL_BYTES = 512;

export function gitCacheDiagnostic(value = {}) {
  return {
    phase: phases.has(value?.phase) ? value.phase : "UNKNOWN",
    operation: operations.has(value?.operation) ? value.operation : "UNKNOWN",
    errno: errnos.has(value?.errno) ? value.errno : null,
    entryKind: entryKinds.has(value?.entryKind) ? value.entryKind : "OTHER",
  };
}

export function encodeGitCacheFailure(error, phase) {
  return JSON.stringify({
    kind: error?.code === "SOURCE_CAPACITY_EXHAUSTED" ? "CAPACITY" : "STORAGE",
    diagnostic: gitCacheDiagnostic({ ...error?.cause, errno: error?.cause?.errno ?? error?.code, phase }),
  }) + "\n";
}

export function decodeGitCacheFailure(control) {
  let frame;
  if (Buffer.byteLength(control) <= MAX_GIT_CACHE_CONTROL_BYTES && control.endsWith("\n")) {
    try { frame = JSON.parse(control); } catch { /* malformed control still fails closed */ }
  }
  const exhausted = frame?.kind === "CAPACITY";
  return new SourceTruthError(exhausted ? "SOURCE_CAPACITY_EXHAUSTED" : "SOURCE_STORAGE_NOT_READY",
    exhausted ? "Git 缓存容量不足；扩容或恢复存储后重试，已有材料保留" : "Git 缓存容量无法完整核验，请恢复存储后重试",
    { status: exhausted ? 507 : 503, cause: gitCacheDiagnostic(frame?.diagnostic) });
}
