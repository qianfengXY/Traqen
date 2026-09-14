import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
import { createSourceTruthRuntime, privateSourceFile, readSourceTruthConfiguration } from "./configuration.js";
import { requireValue } from "./errors.js";
import { SourceTruthRepository, transaction } from "./repository.js";
import { SourcePostgresArchive } from "./postgres-archive.js";
import { SourceBackupService } from "./backup-service.js";
import { SourceTruthBlobStore, safeDirectory, syncDirectory, writeAll } from "./blob-store.js";
import { managedStoragePath, verifyProtectedVolume } from "./volume-protection.js";

async function databaseConfig(filename, postgres) {
  const value = JSON.parse((await privateSourceFile(filename)).bytes.toString("utf8"));
  requireValue(value && Object.keys(value).every((key) => ["host", "port", "database", "user", "password"].includes(key))
    && path.isAbsolute(value.host ?? "") && typeof value.database === "string" && value.database && typeof value.user === "string" && value.user
    && Number.isInteger(value.port) && value.port > 0 && value.port < 65536 && typeof value.password === "string",
  "SOURCE_DATABASE_PROTECTION_UNVERIFIED", "需要明确的本机受保护 PostgreSQL socket 与数据库，不能继承环境默认值", { status: 503 });
  const pool = new pg.Pool({ ...value, ssl: false, max: 4, connectionTimeoutMillis: 10000, application_name: "traqen-source-admin" });
  pool.on("error", () => {});
  try {
    const proof = await new SourcePostgresArchive({ ...postgres, connection: value }).prove(pool);
    await verifyProtectedVolume(proof.data);
    return { pool, connection: value };
  } catch (error) { await pool.end(); throw error; }
}

async function recoveryBackup(config) {
  requireValue(config.backup, "SOURCE_BACKUP_NOT_CONFIGURED", "尚未配置配套备份目标", { status: 503 });
  const forbiddenRoots = [await realpath(process.cwd()), await realpath(fileURLToPath(new URL("../../", import.meta.url))),
    await managedStoragePath(config.storage.root), await managedStoragePath(config.backup.root)];
  const recoveryKeys = {};
  for (const [version, filename] of Object.entries(config.storage.recoveryKeyFiles ?? {})) {
    requireValue(Object.keys(recoveryKeys).length < 32 && /^[A-Za-z0-9_-]{1,128}$/.test(version), "SOURCE_BACKUP_KEY_RECOVERY_REQUIRED", "恢复密钥版本无效");
    const file = await privateSourceFile(filename, { maximum: 32, forbiddenRoots });
    requireValue(file.bytes.length === 32, "SOURCE_BACKUP_KEY_RECOVERY_REQUIRED", "恢复密钥长度无效");
    await verifyProtectedVolume(path.dirname(file.path)); recoveryKeys[version] = file.bytes;
  }
  requireValue(recoveryKeys[config.storage.keyVersion], "SOURCE_BACKUP_KEY_RECOVERY_REQUIRED", "恢复密钥缺失，不能推定原主卷仍然可访问");
  return { service: new SourceBackupService({ configuration: { ...config.backup, keyVersion: config.storage.keyVersion,
    recoveryKeys, keyRecoveryOwner: config.storage.recoveryOwner } }), recoveryKeys, forbiddenRoots };
}

// Host administrator boundary. This module is deliberately absent from HTTP
// routing; private configuration access, not a browser bearer, grants authority.
export async function administerSourceTruth(command, values) {
  const config = await readSourceTruthConfiguration(values.config);
  const operator = values.operator;
  requireValue(typeof operator === "string" && operator.trim() && operator.length <= 256 && !/[\u0000-\u001f]/.test(operator), "SOURCE_BACKUP_AUTHORITY_REQUIRED", "需要明确的部署维护者");
  let database, runtime;
  try {
    if (command !== "verify") database = await databaseConfig(values["database-config"], config.postgres);
    if (command === "provision-members") {
      await transaction(database.pool, async (tx) => {
        for (const member of config.members) {
          const row = (await tx.query("SELECT tenant_id,principal_type FROM principal WHERE id=$1 FOR UPDATE", [member.actorId])).rows[0];
          requireValue(!row || row.tenant_id === member.tenantId && row.principal_type === "USER", "SOURCE_FORBIDDEN", "不能覆盖其他租户或 Agent 身份", { status: 403 });
          requireValue((await tx.query("SELECT id FROM tenant WHERE id=$1", [member.tenantId])).rows[0], "SOURCE_FORBIDDEN", "成员租户须已由应用登记", { status: 403 });
          await tx.query("INSERT INTO principal (id,tenant_id,principal_type,display_name) VALUES ($1,$2,'USER',$1) ON CONFLICT DO NOTHING", [member.actorId, member.tenantId]);
        }
      });
      return { status: "MEMBERS_PROVISIONED", memberCount: config.members.length };
    }
    if (command === "grant") {
      const repository = new SourceTruthRepository(database.pool);
      await repository.provision(values.workspace, { tenantId: values.tenant, grants: [{ actorId: values.member, role: values.role }], requestedBy: operator });
      return { status: "GRANT_RECORDED", workspaceId: values.workspace, memberId: values.member, role: values.role };
    }
    if (command === "backup") {
      // Pass an explicit connection object to pg; never reinterpret a password
      // or socket string as part of a shell command / connection URL.
      runtime = await createSourceTruthRuntime({ configuration: config, connection: database.connection });
      requireValue(runtime.services.backup, "SOURCE_BACKUP_NOT_CONFIGURED", "尚未配置配套备份目标", { status: 503 });
      const proof = await runtime.services.backup.create({ requestedBy: operator });
      return { status: "COMPLETED", backupId: proof.id, waterline: proof.waterline.capturedAt, memberCount: proof.memberCount };
    }
    const recovery = await recoveryBackup(config);
    if (command === "verify" || command === "import") {
      const proof = await recovery.service.verify(values.set);
      if (command === "import") {
        const sealed = await recovery.service.completion(values.set);
        await recovery.service.mirror(database.pool, sealed.payload, sealed.directory, operator);
      }
      return { status: command === "import" ? "VERIFIED_INDEX_IMPORTED" : "VERIFIED", backupId: proof.id, waterline: proof.waterline.capturedAt, verifiedAt: proof.verifiedAt };
    }
    requireValue(command === "restore", "SOURCE_ADMIN_ARGUMENT_REQUIRED", "未知维护操作", { status: 400 });
    const root = await managedStoragePath(values["target-root"], recovery.forbiddenRoots);
    await safeDirectory(root); await verifyProtectedVolume(root);
    requireValue((await readdir(root)).length === 0, "SOURCE_RESTORE_TARGET_NOT_EMPTY", "恢复只允许新的空专用目录");
    const blobs = await SourceTruthBlobStore.open({ root: path.join(root, "bytes"), keys: recovery.recoveryKeys, keyVersion: config.storage.keyVersion,
      maxFileBytes: config.resources.maxFileBytes, maxChunkBytes: config.resources.maxChunkBytes, requireProtectedVolume: true });
    const result = await recovery.service.restore({ backupId: values.set, database: database.pool, blobs,
      postgres: { ...config.postgres, connection: database.connection }, requestedBy: operator });
    const marker = await open(path.join(root, "source-truth-store.json"), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await writeAll(marker, Buffer.from('{"format":"Traqen.SourceTruthStore","version":1}')); await marker.sync(); } finally { await marker.close(); }
    await syncDirectory(root);
    return result;
  } finally { await runtime?.close(); await database?.pool.end(); }
}
