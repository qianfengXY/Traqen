import { constants } from "node:fs";
import { open, lstat, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import pg from "pg";
import { requireValue, SourceTruthError } from "./errors.js";
import { managedStoragePath, verifyProtectedVolume } from "./volume-protection.js";
import { safeDirectory, SourceTruthBlobStore, writeAll, syncDirectory } from "./blob-store.js";
import { SourceTruthRepository } from "./repository.js";
import { SourcePostgresArchive } from "./postgres-archive.js";
import { sourceTruthServices } from "./services.js";
import { SourceTruthWorker } from "./worker.js";
import { capturePolicy } from "./policy.js";
import { GitSourceGateway } from "./git-gateway.js";
import { sourceTruthAuthenticator } from "./authentication.js";
import { createSourceTruthHttpHandler } from "./http-handler.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };
const exactKeys = (object, allowed) => object && typeof object === "object" && !Array.isArray(object) && Object.keys(object).every((key) => allowed.includes(key));

export async function privateSourceFile(filename, { maximum = 1048576, forbiddenRoots = [] } = {}) {
  requireValue(typeof filename === "string" && path.isAbsolute(filename), "SOURCE_CONFIGURATION_PRIVATE_REQUIRED", "配置和密钥必须使用明确的私有文件", { status: 503 });
  let file;
  try {
    const resolved = await realpath(filename);
    for (const root of forbiddenRoots) requireValue(!inside(root, resolved), "SOURCE_CONFIGURATION_PRIVATE_REQUIRED", "密钥不能放入项目、主内容或备份数据目录", { status: 503 });
    const link = await lstat(filename);
    requireValue(!link.isSymbolicLink(), "SOURCE_CONFIGURATION_PRIVATE_REQUIRED", "配置和密钥不能通过符号链接替换", { status: 503 });
    file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    requireValue(stat.isFile() && (stat.mode & 0o077) === 0 && stat.size <= maximum
      && (typeof process.getuid !== "function" || stat.uid === process.getuid()),
    "SOURCE_CONFIGURATION_PRIVATE_REQUIRED", "配置和密钥须由服务账号持有，且不能被其他主机用户读写", { status: 503 });
    return { bytes: await file.readFile(), path: resolved };
  } catch (error) {
    if (error instanceof SourceTruthError) throw error;
    throw new SourceTruthError("SOURCE_CONFIGURATION_PRIVATE_REQUIRED", "无法安全读取指定的私有配置或密钥文件", { status: 503, cause: error });
  } finally { await file?.close(); }
}

export async function readSourceTruthConfiguration(filename) {
  const file = await privateSourceFile(filename);
  let config;
  try { config = JSON.parse(file.bytes.toString("utf8")); } catch { throw new SourceTruthError("SOURCE_CONFIGURATION_INVALID", "来源配置不是有效 JSON", { status: 503 }); }
  requireValue(exactKeys(config, ["version", "storage", "postgres", "members", "origins", "git", "resources", "backup"]) && config.version === 1
    && exactKeys(config.storage, ["root", "keyVersion", "keyFiles", "recoveryKeyFiles", "recoveryOwner", "minFreeBytes"])
    && exactKeys(config.postgres, ["binDirectory"]) && exactKeys(config.git, ["targets", "credentials"])
    && exactKeys(config.resources, ["maxFileBytes", "maxTotalBytes", "maxEntries", "maxChunkBytes", "maxBatchEntries", "maxWriters", "maxPackBytes", "workerConcurrency", "poolConnections"]),
  "SOURCE_CONFIGURATION_INVALID", "来源配置版本、字段或资源边界无效；没有关闭安全检查的配置开关", { status: 503 });
  requireValue(Array.isArray(config.origins) && config.origins.length <= 32 && config.origins.every((value) => {
    try { const url = new URL(value); return url.origin === value && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))); } catch { return false; }
  }), "SOURCE_CONFIGURATION_INVALID", "浏览器来源必须为明确的 HTTPS origin；仅本机开发地址允许 HTTP", { status: 503 });
  requireValue(Array.isArray(config.git.targets) && config.git.targets.length <= 100 && config.git.targets.every((target) => {
    try { const url = new URL(target.origin); return exactKeys(target, ["origin", "allowedAddresses", "caFile"]) && url.origin === target.origin && url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
  }), "SOURCE_CONFIGURATION_INVALID", "Git 网关需要明确的只读 HTTPS 目标许可", { status: 503 });
  if (config.backup) requireValue(exactKeys(config.backup, ["root", "targetId", "maxBytes", "minFreeBytes", "mode", "intervalMs"])
    && ["MANUAL", "INTERVAL"].includes(config.backup.mode)
    && (config.backup.mode === "MANUAL" || (Number.isSafeInteger(config.backup.intervalMs) && config.backup.intervalMs >= 60000)),
  "SOURCE_CONFIGURATION_INVALID", "备份须明确选择人工触发或已配置周期，不默认设置保留删除期限", { status: 503 });
  sourceTruthAuthenticator(config.members); // Validate before opening any service.
  capturePolicy({ ...config.resources, gitTargets: config.git.targets });
  return config;
}

async function storageConfiguration(config) {
  const forbiddenRoots = [...new Set([await realpath(process.cwd()), await realpath(projectRoot)])];
  const root = await managedStoragePath(config.storage.root, forbiddenRoots);
  await safeDirectory(root);
  await verifyProtectedVolume(root);
  const backupRoot = config.backup ? await managedStoragePath(config.backup.root, forbiddenRoots) : null;
  const forbiddenKeys = [...forbiddenRoots, root, ...(backupRoot ? [backupRoot] : [])];
  const keyVersion = config.storage.keyVersion;
  requireValue(typeof keyVersion === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(keyVersion)
    && typeof config.storage.recoveryOwner === "string" && config.storage.recoveryOwner.trim(),
  "SOURCE_STORAGE_NOT_READY", "需明确内容密钥版本与恢复责任人", { status: 503 });
  const keys = {}, recoveryKeys = {};
  for (const [version, filename] of Object.entries(config.storage.keyFiles ?? {})) {
    requireValue(Object.keys(keys).length < 32 && /^[A-Za-z0-9_-]{1,128}$/.test(version), "SOURCE_STORAGE_NOT_READY", "内容密钥版本配置无效", { status: 503 });
    const primary = await privateSourceFile(filename, { maximum: 32, forbiddenRoots: forbiddenKeys });
    const recovery = await privateSourceFile(config.storage.recoveryKeyFiles?.[version], { maximum: 32, forbiddenRoots: forbiddenKeys });
    requireValue(primary.bytes.length === 32 && recovery.bytes.length === 32 && primary.path !== recovery.path
      && timingSafeEqual(primary.bytes, recovery.bytes), "SOURCE_BACKUP_KEY_RECOVERY_REQUIRED", "必须核验分开保管的同版本密钥恢复副本", { status: 503 });
    await verifyProtectedVolume(path.dirname(primary.path)); await verifyProtectedVolume(path.dirname(recovery.path));
    keys[version] = primary.bytes; recoveryKeys[version] = recovery.bytes;
  }
  requireValue(keys[keyVersion], "SOURCE_STORAGE_NOT_READY", "当前内容密钥缺失", { status: 503 });
  const marker = path.join(root, "source-truth-store.json");
  const entries = await readdir(root);
  if (entries.length) {
    requireValue(entries.includes("source-truth-store.json") && entries.every((name) => ["source-truth-store.json", "bytes", "git"].includes(name)),
      "SOURCE_STORAGE_NOT_READY", "数据目录不是专用来源存储，不能混入现有用户文件", { status: 503 });
    const saved = await privateSourceFile(marker, { maximum: 1024 });
    requireValue(saved.bytes.toString("utf8") === '{"format":"Traqen.SourceTruthStore","version":1}', "SOURCE_STORAGE_NOT_READY", "存储格式标识不匹配", { status: 503 });
  } else {
    const file = await open(marker, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await writeAll(file, Buffer.from('{"format":"Traqen.SourceTruthStore","version":1}')); await file.sync(); } finally { await file.close(); }
    await syncDirectory(root);
  }
  return { root, backupRoot, forbiddenRoots, keyVersion, keys, recoveryKeys };
}

export async function createSourceTruthRuntime({ configuration: config, connectionString, ssl, host = "127.0.0.1" }) {
  requireValue(["127.0.0.1", "::1"].includes(host), "SOURCE_TRANSPORT_PROTECTION_REQUIRED", "来源 API 必须绑定本机并经受保护的入口提供服务，不能直接公开明文凭据通道", { status: 503 });
  const storage = await storageConfiguration(config);
  const max = config.resources.poolConnections ?? 8;
  requireValue(Number.isInteger(max) && max >= 2 && max <= 32, "SOURCE_CONFIGURATION_INVALID", "来源数据库连接池大小无效", { status: 503 });
  const pool = new pg.Pool({ connectionString, ssl, max, connectionTimeoutMillis: 10000, application_name: "traqen-source-truth" });
  pool.on("error", () => {}); // Requests/recovery expose bounded diagnostics, never credentials.
  const parameters = new pg.Client({ connectionString, ssl }).connectionParameters;
  const connection = { host: parameters.host, port: parameters.port, database: parameters.database, user: parameters.user, password: parameters.password, ssl: false };
  const postgres = new SourcePostgresArchive({ ...config.postgres, connection });
  let worker, backupTimer, backupTask = null;
  try {
    const database = await postgres.prove(pool);
    await verifyProtectedVolume(database.data);
    const repository = new SourceTruthRepository(pool);
    for (const member of config.members) {
      const exists = (await pool.query("SELECT 1 FROM principal WHERE id=$1 AND tenant_id=$2 AND principal_type='USER'", [member.actorId, member.tenantId])).rows[0];
      requireValue(exists, "SOURCE_AUTH_CONFIGURATION_REQUIRED", "来源成员须由部署管理员登记为同租户的人类成员，不能冒用 Agent 身份", { status: 503 });
    }
    const policy = capturePolicy({ ...config.resources, gitTargets: config.git.targets });
    const blobs = await SourceTruthBlobStore.open({ root: path.join(storage.root, "bytes"), forbiddenRoots: storage.forbiddenRoots,
      keyVersion: storage.keyVersion, keys: storage.keys, maxFileBytes: policy.maxFileBytes, maxChunkBytes: policy.maxChunkBytes,
      maxWriters: config.resources.maxWriters ?? 4, minFreeBytes: config.storage.minFreeBytes ?? "0", requireProtectedVolume: true });
    const credentials = new Map();
    for (const value of config.git.credentials ?? []) {
      requireValue(exactKeys(value, ["id", "origin", "authorizationFile"]) && /^[A-Za-z0-9_-]{1,128}$/.test(value.id) && !credentials.has(value.id)
        && config.git.targets.some((target) => target.origin === value.origin), "SOURCE_CONFIGURATION_INVALID", "Git 只读凭据引用必须唯一并绑定获准 origin", { status: 503 });
      credentials.set(value.id, value);
    }
    const git = config.git.targets.length ? new GitSourceGateway({ cacheRoot: path.join(storage.root, "git"), targets: config.git.targets,
      maxFileBytes: Number(policy.maxFileBytes), maxEntries: policy.maxEntries, maxPackBytes: config.resources.maxPackBytes,
      requireProtectedVolume: true, forbiddenRoots: storage.forbiddenRoots,
      credentialProvider: async (id, origin) => {
        const value = credentials.get(id);
        requireValue(value?.origin === origin, "SOURCE_GIT_CREDENTIAL_UNAVAILABLE", "只读凭据未授权给当前来源", { status: 403 });
        const file = await privateSourceFile(value.authorizationFile, { maximum: 8192, forbiddenRoots: [...storage.forbiddenRoots, storage.root, ...(storage.backupRoot ? [storage.backupRoot] : [])] });
        return file.bytes.toString("utf8").trim();
      } }) : null;
    if (git) await git.ready();
    const services = sourceTruthServices({ repository, blobs, policy, git, backupConfiguration: config.backup ? { ...config.backup,
      postgres: { ...config.postgres, connection }, recoveryKeys: storage.recoveryKeys, keyRecoveryOwner: config.storage.recoveryOwner } : null });
    let checkedAt = 0;
    services.ensureReady = async () => {
      if (Date.now() - checkedAt < 10000) return;
      await verifyProtectedVolume(database.data);
      await blobs.ready(); if (git) await git.ready(); checkedAt = Date.now();
    };
    await services.ensureReady();
    worker = new SourceTruthWorker(services, { maxConcurrent: config.resources.workerConcurrency ?? 2 });
    services.dispatch = () => worker.dispatch();
    const sourceTruthHandler = createSourceTruthHttpHandler({ services, authenticate: sourceTruthAuthenticator(config.members), allowedOrigins: config.origins });
    if (services.backup) await services.backup.recoverAbandoned().catch((error) => { if (error.code !== "SOURCE_BACKUP_BUSY") throw error; });
    return { services, sourceTruthHandler, worker, pool, configuration: config,
      start() {
        worker.start();
        if (services.backup && config.backup.mode === "INTERVAL" && !backupTimer) {
          backupTimer = setInterval(() => {
            if (backupTask) return;
            backupTask = (async () => {
              try {
                const latest = (await pool.query("SELECT started_at FROM source_truth_backup_attempt WHERE target_id=$1 ORDER BY started_at DESC LIMIT 1", [config.backup.targetId])).rows[0];
                if (!latest || Date.now() - new Date(latest.started_at).getTime() >= config.backup.intervalMs) await services.backup.create({ requestedBy: `schedule:${config.storage.recoveryOwner}` });
              } catch { /* Durable attempt/diagnostic is the status surface. */ }
            })().finally(() => { backupTask = null; });
          }, Math.min(config.backup.intervalMs, 60000));
          backupTimer.unref();
        }
      },
      async close() { if (backupTimer) clearInterval(backupTimer); await worker.stop(); await backupTask; await pool.end(); } };
  } catch (error) { if (worker) await worker.stop().catch(() => {}); await pool.end(); throw error; }
}
