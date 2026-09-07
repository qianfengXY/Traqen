import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { requireValue, SourceTruthError } from "./errors.js";

const exec = promisify(execFile);
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };

// Resolve ancestors before any mkdir: a harmless-looking alias outside the
// repository must not redirect source bytes into the repository itself.
export async function managedStoragePath(root, forbiddenRoots = [process.cwd()]) {
  requireValue(typeof root === "string" && path.isAbsolute(root) && path.resolve(root) !== path.parse(root).root,
    "SOURCE_STORAGE_NOT_READY", "必须配置专用持久化数据卷", { status: 503 });
  const normalized = path.resolve(root);
  const resolved = path.join(await realpath(path.dirname(normalized)), path.basename(normalized));
  for (const forbidden of forbiddenRoots) {
    requireValue(!inside(await realpath(forbidden), resolved), "SOURCE_STORAGE_NOT_READY", "来源内容不能存入项目目录", { status: 503 });
  }
  return resolved;
}

async function diskInfo(location) {
  // Fixed, platform-owned read-only commands. The pathname is a quoted argument,
  // never shell text, and output/error text is never returned to an API caller.
  const { stdout } = await exec("/bin/bash", ["-o", "pipefail", "-c", '/usr/sbin/diskutil info -plist "$1" | /usr/bin/plutil -convert json -o - -', "source-volume-probe", location],
    { timeout: 10000, maxBuffer: 65536, env: { PATH: "/usr/bin:/bin:/usr/sbin", LC_ALL: "C" } });
  return JSON.parse(stdout);
}

export async function probeLocalVolume(root) {
  // Other deployment platforms must supply an independently verified host
  // adapter, not an environment boolean claiming encryption. Unsupported hosts
  // fail closed until that adapter is configured in trusted runtime code.
  requireValue(process.platform === "darwin", "SOURCE_VOLUME_PROBE_UNAVAILABLE", "此部署平台尚无受支持的卷保护核验器，不能宣称存储就绪", { status: 503 });
  const info = await diskInfo(root);
  const physicalStores = [];
  for (const item of info.APFSPhysicalStores ?? []) {
    requireValue(/^disk\d+(?:s\d+)*$/.test(item.APFSPhysicalStore), "SOURCE_VOLUME_PROBE_UNAVAILABLE", "卷物理依赖无法核验", { status: 503 });
    const backing = await diskInfo(item.APFSPhysicalStore);
    // Do not call two virtual disk images on one disk independent fault domains.
    if (backing.DeviceTreePath && backing.ParentWholeDisk) physicalStores.push(backing.ParentWholeDisk);
  }
  return { encrypted: info.Encryption === true && info.FileVault === true,
    permissionsEnforced: info.GlobalPermissionsEnabled === true,
    persistent: info.FilesystemType === "apfs" && info.WritableVolume === true && info.Locked === false,
    filesystemId: info.VolumeUUID, physicalStores: [...new Set(physicalStores)].sort() };
}

export async function verifyProtectedVolume(root, { probe = probeLocalVolume } = {}) {
  try {
    const result = await probe(root);
    requireValue(result?.encrypted === true && result.permissionsEnforced === true && result.persistent === true
      && typeof result.filesystemId === "string" && result.filesystemId.length > 0,
    "SOURCE_VOLUME_PROTECTION_REQUIRED", "主卷必须启用静态加密、访问权限及持久化保护；加密 blob 不替代数据库和 Git 缓存保护", { status: 503 });
    return { ...result, checkedAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof SourceTruthError) throw error;
    throw new SourceTruthError("SOURCE_VOLUME_PROBE_UNAVAILABLE", "无法核验部署卷保护，请恢复核验条件后重试", { status: 503, cause: error });
  }
}
