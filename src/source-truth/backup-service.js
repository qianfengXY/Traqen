import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { open, mkdtemp, readdir, lstat, unlink } from "node:fs/promises";
import path from "node:path";
import { canonicalEncode } from "./identity.js";
import { requireValue, SourceTruthError } from "./errors.js";
import { SourceTruthBlobStore, safeDirectory, syncDirectory, writeAll } from "./blob-store.js";
import { managedStoragePath, verifyProtectedVolume } from "./volume-protection.js";
import { SourcePostgresArchive } from "./postgres-archive.js";
import { fileBytes, fileDigest, catalogueLines, databaseCatalogue, verifyDatabaseEvidence } from "./backup-catalogue.js";
import { transaction } from "./repository.js";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const scopeForDump = (id) => ({ tenantId: "source-backup", workspaceId: id });
const lock = [164001, 1];
const mac = (key, payload) => createHmac("sha256", key).update("Traqen.SourceBackupSet.v1\0").update(canonicalEncode(payload)).digest("hex");
const diagnostic = (error) => ({ code: error instanceof SourceTruthError ? error.code : "SOURCE_BACKUP_FAILED", message: "配套备份未完成；已有版本保留，恢复条件后重试" });

async function writeExclusive(filename, data) {
  const file = await open(filename, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await writeAll(file, Buffer.from(data)); await file.sync(); } finally { await file.close(); }
  await syncDirectory(path.dirname(filename));
}
async function streamFile(filename, input, maximum) {
  const file = await open(filename, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  let size = 0n;
  try {
    for await (const chunk of input) {
      size += BigInt(chunk.length);
      requireValue(size <= maximum, "SOURCE_BACKUP_CAPACITY_EXHAUSTED", "备份超过资源预算", { status: 507 });
      await writeAll(file, chunk);
    }
    await file.sync();
  } finally { await file.close(); }
}
async function* objectBytes(store, row) {
  requireValue(row.type === "OBJECT" && ["blobs", "chunks"].includes(row.kind) && /^[a-f0-9]{64}$/.test(row.id)
    && /^[a-f0-9]{64}$/.test(row.ref?.digest), "SOURCE_BACKUP_CORRUPT", "备份内容引用无效");
  if (row.kind === "blobs") {
    requireValue(row.id === row.ref.digest, "SOURCE_BACKUP_CORRUPT", "备份内容定位与摘要不一致");
    yield* store.readBlob(row.scope, row.ref);
  } else yield* store.readChunk(row.scope, { id: row.id, ...row.ref });
}

export class SourceBackupService {
  constructor({ repository, blobs, configuration }) {
    Object.assign(this, { repository, blobs, config: configuration });
    this.targetBlobs = null;
    this.keyVersion = blobs?.keyVersion ?? configuration.keyVersion;
    this.maximum = BigInt(configuration.maxBytes ?? "0");
  }
  async targetReady() {
    requireValue(this.maximum > 0n && typeof this.config.targetId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(this.config.targetId),
      "SOURCE_BACKUP_CONFIGURATION_INVALID", "需要明确的备份目标身份和容量预算", { status: 503 });
    this.root = await managedStoragePath(this.config.root);
    await safeDirectory(this.root);
    const protection = await verifyProtectedVolume(this.root, { probe: this.config.volumeProbe });
    requireValue(typeof this.config.keyRecoveryOwner === "string" && this.config.keyRecoveryOwner.trim(), "SOURCE_BACKUP_KEY_RECOVERY_REQUIRED", "请登记并验证独立的密钥恢复责任与密钥材料", { status: 503 });
    const keys = this.config.recoveryKeys;
    requireValue(keys && Buffer.isBuffer(keys[this.keyVersion]) && keys[this.keyVersion].length === 32,
      "SOURCE_BACKUP_KEY_RECOVERY_REQUIRED", "备份解密密钥尚无已核验恢复副本", { status: 503 });
    this.targetBlobs ??= await SourceTruthBlobStore.open({ root: path.join(this.root, "objects"), keyVersion: this.keyVersion, keys,
      maxFileBytes: String(this.maximum), requireProtectedVolume: true, volumeProbe: this.config.volumeProbe, minFreeBytes: this.config.minFreeBytes ?? "0" });
    await this.targetBlobs.ready();
    await safeDirectory(path.join(this.root, "sets"));
    return protection;
  }
  async ready() {
    const target = await this.targetReady();
    const source = await verifyProtectedVolume(this.blobs.root, { probe: this.config.volumeProbe });
    const postgres = new SourcePostgresArchive({ ...this.config.postgres, maxBytes: String(this.maximum) });
    const database = await postgres.prove(this.repository.database);
    const databaseVolume = await verifyProtectedVolume(database.data, { probe: this.config.volumeProbe });
    requireValue(target.physicalStores?.length && source.physicalStores?.length && databaseVolume.physicalStores?.length
      && [...source.physicalStores, ...databaseVolume.physicalStores].every((device) => !target.physicalStores.includes(device)),
    "SOURCE_BACKUP_SAME_FAULT_DOMAIN", "备份必须与主内容卷、数据库位于可核验的独立故障域；同盘另目录不算恢复备份", { status: 503 });
    const active = this.blobs.keys.get(this.blobs.keyVersion), recovery = this.config.recoveryKeys[this.blobs.keyVersion];
    requireValue(active?.length === recovery.length && timingSafeEqual(active, recovery), "SOURCE_BACKUP_KEY_RECOVERY_REQUIRED", "恢复密钥与当前内容密钥不匹配", { status: 503 });
    return { postgres, database, source, databaseVolume, target };
  }
  async setBarrier(tx, enabled) {
    await tx.query("SELECT p.id FROM project p JOIN source_truth_workspace w ON w.workspace_id=p.id ORDER BY p.id FOR UPDATE OF p");
    await tx.query("SELECT workspace_id FROM source_truth_workspace ORDER BY workspace_id FOR UPDATE");
    await tx.query("UPDATE source_truth_workspace SET backup_barrier=$1", [enabled]);
  }
  async exclusive(work) {
    const client = await this.repository.database.connect();
    let held = false;
    try {
      held = (await client.query("SELECT pg_try_advisory_lock($1,$2) AS held", lock)).rows[0].held;
      requireValue(held, "SOURCE_BACKUP_BUSY", "已有备份或恢复维护操作正在运行，请查询其状态", { status: 409 });
      return await work(client);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      if (held) await client.query("SELECT pg_advisory_unlock($1,$2)", lock).catch(() => {});
      client.release();
    }
  }
  async recoverAbandoned() {
    return this.exclusive(async () => transaction(this.repository.database, async (tx) => {
      const { rows } = await tx.query(`UPDATE source_truth_backup_attempt SET status='FAILED',finished_at=clock_timestamp(),diagnostic=$1
        WHERE status='RUNNING' RETURNING id`, [JSON.stringify({ code: "SOURCE_BACKUP_INTERRUPTED", message: "备份进程中断；未封闭集合不能作为恢复点，可核验目标完成记录后重建索引" })]);
      await this.setBarrier(tx, false);
      return rows.map((row) => row.id);
    }));
  }

  async create({ requestedBy }) {
    requireValue(typeof requestedBy === "string" && requestedBy.trim(), "SOURCE_BACKUP_AUTHORITY_REQUIRED", "备份须由明确的部署维护者发起");
    return this.exclusive(async (snapshot) => {
      const id = randomUUID();
      let began = false, exported = false;
      let dumpFile;
      try {
        await transaction(this.repository.database, async (tx) => {
          // Holding the advisory lock proves that an earlier RUNNING attempt has
          // no surviving executor. Retain its audit, release only its barrier.
          await tx.query("UPDATE source_truth_backup_attempt SET status='FAILED',finished_at=clock_timestamp(),diagnostic=$1 WHERE status='RUNNING'",
            [JSON.stringify({ code: "SOURCE_BACKUP_INTERRUPTED" })]);
          await tx.query("INSERT INTO source_truth_backup_attempt (id,target_id,requested_by,status) VALUES ($1,$2,$3,'RUNNING')", [id, this.config.targetId, requestedBy]);
        });
        began = true;
        const ready = await this.ready();
        await transaction(this.repository.database, (tx) => this.setBarrier(tx, true));
        const working = await mkdtemp(path.join(this.blobs.root, ".backup-"));
        const directory = path.join(this.root, "sets", id);
        await safeDirectory(directory);
        dumpFile = path.join(working, "database.dump");
        const catalogue = path.join(directory, "catalogue.ndjson");
        await snapshot.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); exported = true;
        const waterline = (await snapshot.query("SELECT pg_export_snapshot() AS snapshot,pg_current_wal_lsn()::text AS lsn,clock_timestamp() AS captured_at,current_database() AS database,current_setting('server_version_num') AS version")).rows[0];
        // Native supported snapshot import, never a copy of the live PG data dir.
        await ready.postgres.dump(waterline.snapshot, dumpFile);
        const dump = await fileDigest(dumpFile, this.maximum);
        await this.targetBlobs.putBlob(scopeForDump(id), dump, fileBytes(dumpFile));
        await verifyDatabaseEvidence(snapshot, this.blobs);
        let bytes = BigInt(dump.sizeBytes), objectCount = 0n, memberCount = 0n, checkpointCount = 0n;
        const hash = createHash("sha256");
        const output = await open(catalogue, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try {
          for await (const row of databaseCatalogue(snapshot)) {
            const line = Buffer.from(`${canonicalEncode(row)}\n`);
            bytes += BigInt(line.length);
            if (row.type === "OBJECT") {
              bytes += BigInt(row.ref.sizeBytes) + 4096n;
              requireValue(bytes <= this.maximum, "SOURCE_BACKUP_CAPACITY_EXHAUSTED", "配套备份超过已配置容量预算", { status: 507 });
              await this.targetBlobs.put(row.scope, row.kind, row.id, row.ref, objectBytes(this.blobs, row)); objectCount++;
            }
            if (row.type === "MEMBER") memberCount++;
            if (row.type === "CHECKPOINT") checkpointCount++;
            requireValue(bytes <= this.maximum, "SOURCE_BACKUP_CAPACITY_EXHAUSTED", "配套备份清单超过容量预算", { status: 507 });
            hash.update(line); await writeAll(output, line);
          }
          await output.sync();
        } finally { await output.close(); }
        await snapshot.query("COMMIT"); exported = false;
        const payload = { id, formatVersion: 1, targetId: this.config.targetId,
          waterline: { capturedAt: new Date(waterline.captured_at).toISOString(), database: waterline.database, postgresVersion: waterline.version, lsn: waterline.lsn, snapshot: waterline.snapshot },
          databaseArchive: dump, catalogue: { digest: hash.digest("hex"), sizeBytes: String((await lstat(catalogue)).size) },
          objectCount: String(objectCount), memberCount: String(memberCount), checkpointCount: String(checkpointCount),
          keyVersion: this.targetBlobs.keyVersion, keyRecoveryOwner: this.config.keyRecoveryOwner, faultDomain: ready.target,
          completedAt: new Date().toISOString() };
        // Verify the copy before declaring completion, not only the source bytes.
        await this.verifyFiles(payload, directory);
        await writeExclusive(path.join(directory, "complete.json"), canonicalEncode({ payload, mac: mac(this.targetBlobs.keys.get(payload.keyVersion), payload) }));
        // Target proof is authority. A crash before this online mirror can be
        // recovered by verify/import, even though it is later than the DB dump.
        await this.mirror(this.repository.database, payload, directory, requestedBy);
        await transaction(this.repository.database, (tx) => this.setBarrier(tx, false));
        return payload;
      } catch (error) {
        if (exported) { await snapshot.query("ROLLBACK").catch(() => {}); exported = false; }
        if (began) await transaction(this.repository.database, async (tx) => {
          await tx.query("UPDATE source_truth_backup_attempt SET status='FAILED',finished_at=clock_timestamp(),diagnostic=$2 WHERE id=$1 AND status='RUNNING'", [id, JSON.stringify(diagnostic(error))]);
          await this.setBarrier(tx, false);
        }).catch(() => {});
        throw error;
      } finally {
        // These two files are owned temporary archive bytes, not user history.
        // The encrypted target and failed-attempt evidence are retained.
        if (dumpFile) await unlink(dumpFile).catch(() => {});
      }
    });
  }

  async completion(id) {
    requireValue(typeof id === "string" && uuid.test(id), "SOURCE_BACKUP_NOT_FOUND", "备份集合标识无效", { status: 404 });
    await this.targetReady();
    const directory = path.join(this.root, "sets", id);
    let document;
    try {
      const info = await lstat(directory);
      requireValue(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0, "SOURCE_BACKUP_CORRUPT", "备份集合目录保护异常");
      const file = path.join(directory, "complete.json");
      requireValue((await lstat(file)).size <= 65536, "SOURCE_BACKUP_CORRUPT", "备份完成记录异常");
      const parts = []; for await (const chunk of fileBytes(file)) parts.push(chunk);
      document = JSON.parse(Buffer.concat(parts).toString("utf8"));
    } catch (error) {
      if (error instanceof SourceTruthError) throw error;
      throw new SourceTruthError("SOURCE_BACKUP_UNSEALED", "该备份集合没有可读的封闭完成证明，不能恢复", { cause: error });
    }
    const p = document.payload, key = this.targetBlobs.keys.get(p?.keyVersion);
    requireValue(p?.id === id && p.formatVersion === 1 && p.targetId === this.config.targetId && key?.length === 32
      && /^[a-f0-9]{64}$/.test(document.mac) && timingSafeEqual(Buffer.from(document.mac, "hex"), Buffer.from(mac(key, p), "hex")),
    "SOURCE_BACKUP_CORRUPT", "备份完成证明无法验证；密钥缺失或记录损坏不能接受绕过");
    return { payload: p, directory };
  }
  async verifyFiles(payload, directory, reference = null) {
    const catalogue = path.join(directory, "catalogue.ndjson");
    const actual = await fileDigest(catalogue, this.maximum);
    requireValue(canonicalEncode(actual) === canonicalEncode(payload.catalogue), "SOURCE_BACKUP_CORRUPT", "备份清单摘要或长度不一致");
    for await (const _ of this.targetBlobs.readBlob(scopeForDump(payload.id), payload.databaseArchive)) { /* authenticated bounded read */ }
    let objects = 0n, members = 0n, checkpoints = 0n, included = false;
    for await (const row of catalogueLines(catalogue)) {
      requireValue(["OBJECT", "MEMBER", "MANIFEST", "CHECKPOINT"].includes(row.type), "SOURCE_BACKUP_CORRUPT", "备份清单包含未知类型");
      if (row.type === "OBJECT") { for await (const _ of objectBytes(this.targetBlobs, row)) {} objects++; }
      if (row.type === "CHECKPOINT") checkpoints++;
      if (row.type === "MEMBER") {
        members++;
        if (reference && row.workspaceId === reference.workspaceId && row.bundleId === reference.bundleId && row.receiptId === reference.receiptId) included = true;
      }
    }
    requireValue(String(objects) === payload.objectCount && String(members) === payload.memberCount && String(checkpoints) === payload.checkpointCount,
      "SOURCE_BACKUP_CORRUPT", "备份成员或引用数量不守恒");
    return { included };
  }
  async verify(id, reference = null) {
    const { payload, directory } = await this.completion(id);
    return { ...payload, ...(await this.verifyFiles(payload, directory, reference)), verifiedAt: new Date().toISOString() };
  }
  async mirror(database, payload, directory, requestedBy) {
    await transaction(database, async (tx) => {
      await tx.query(`INSERT INTO source_truth_backup_attempt (id,target_id,requested_by,status,finished_at) VALUES ($1,$2,$3,'COMPLETED',$4)
        ON CONFLICT (id) DO UPDATE SET status='COMPLETED',finished_at=EXCLUDED.finished_at`, [payload.id, payload.targetId, requestedBy, payload.completedAt]);
      await tx.query("INSERT INTO source_truth_backup_set (id,target_id,payload,completed_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [payload.id, payload.targetId, JSON.stringify(payload), payload.completedAt]);
    });
    let batch = [];
    const flush = async () => {
      if (batch.length) await database.query(`INSERT INTO source_truth_backup_member (backup_id,workspace_id,bundle_id,receipt_id)
        SELECT $1,r->>'workspaceId',r->>'bundleId',r->>'receiptId' FROM jsonb_array_elements($2::jsonb) r ON CONFLICT DO NOTHING`, [payload.id, JSON.stringify(batch)]);
      batch = [];
    };
    for await (const row of catalogueLines(path.join(directory, "catalogue.ndjson"))) if (row.type === "MEMBER") { batch.push(row); if (batch.length === 500) await flush(); }
    await flush();
  }
  async coverage(actor, workspaceId, reference) {
    await this.repository.authorize(actor, workspaceId);
    const { rows } = await this.repository.database.query(`SELECT s.id FROM source_truth_backup_member m JOIN source_truth_backup_set s ON s.id=m.backup_id
      WHERE m.workspace_id=$1 AND m.bundle_id=$2 AND m.receipt_id=$3 AND s.target_id=$4 ORDER BY s.completed_at DESC LIMIT 10`,
    [workspaceId, reference.bundleId, reference.receiptId, this.config.targetId]);
    for (const row of rows) {
      try {
        const proof = await this.verify(row.id, { ...reference, workspaceId });
        requireValue(proof.included, "SOURCE_BACKUP_CORRUPT", "在线备份索引不匹配目标完成证明");
        await this.repository.authorize(actor, workspaceId);
        await this.repository.database.query("INSERT INTO source_truth_backup_health (backup_id,status) VALUES ($1,'VERIFIED')", [row.id]);
        return { status: "COVERED", backupId: row.id, waterline: proof.waterline.capturedAt, verifiedAt: proof.verifiedAt, bundleId: reference.bundleId, receiptId: reference.receiptId };
      } catch (error) {
        if (error.code === "SOURCE_FORBIDDEN") throw error;
        await this.repository.database.query("INSERT INTO source_truth_backup_health (backup_id,status,diagnostic) VALUES ($1,'UNAVAILABLE',$2)", [row.id, JSON.stringify(diagnostic(error))]);
      }
    }
    await this.repository.authorize(actor, workspaceId);
    return { status: rows.length ? "UNAVAILABLE" : "NOT_COVERED", bundleId: reference.bundleId, receiptId: reference.receiptId };
  }
  async status(actor, workspaceId) {
    await this.repository.authorize(actor, workspaceId);
    const attempt = (await this.repository.database.query("SELECT id,status,started_at,finished_at,diagnostic FROM source_truth_backup_attempt WHERE target_id=$1 ORDER BY started_at DESC LIMIT 1", [this.config.targetId])).rows[0];
    return attempt ? { status: attempt.status === "COMPLETED" ? "COMPLETED_NOT_REVERIFIED" : attempt.status,
      backupId: attempt.id, startedAt: new Date(attempt.started_at).toISOString(), completedAt: attempt.finished_at ? new Date(attempt.finished_at).toISOString() : null,
      diagnostic: attempt.diagnostic, coverage: "CHECK_EXACT_BUNDLE_AND_RECEIPT" } : { status: "NO_COMPLETED_BACKUP" };
  }

  async restore({ backupId, database, blobs, postgres: configuration, requestedBy }) {
    requireValue(typeof requestedBy === "string" && requestedBy.trim(), "SOURCE_BACKUP_AUTHORITY_REQUIRED", "隔离恢复需要明确的维护者");
    const { payload, directory } = await this.completion(backupId);
    await this.verifyFiles(payload, directory);
    const tables = (await database.query("SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') LIMIT 1")).rows;
    requireValue(!tables.length && (await readdir(blobs.root)).length === 0, "SOURCE_RESTORE_TARGET_NOT_EMPTY", "仅允许恢复到新的空数据库与空内容目录，不能覆盖现有数据");
    const postgres = new SourcePostgresArchive({ ...configuration, maxBytes: String(this.maximum) });
    const databaseProof = await postgres.prove(database);
    await verifyProtectedVolume(databaseProof.data, { probe: this.config.volumeProbe });
    await verifyProtectedVolume(blobs.root, { probe: this.config.volumeProbe });
    const working = await mkdtemp(path.join(blobs.root, ".restore-"));
    const archive = path.join(working, "database.dump"), sql = path.join(working, "database.sql");
    try {
      await streamFile(archive, this.targetBlobs.readBlob(scopeForDump(backupId), payload.databaseArchive), this.maximum);
      await postgres.sql(archive, sql);
      const file = await open(sql, constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW);
      try {
        // psql --single-transaction makes the imported schema/data and closed
        // restoration gate visible in one commit, with no ready=true window.
        await writeAll(file, Buffer.from(`\nUPDATE public.source_truth_workspace SET restore_ready=false,backup_barrier=true;
          UPDATE public.source_truth_run SET generation=generation+1,lease_until=NULL,worker_id=NULL,
            progress=progress || jsonb_build_object('restoredPriorStatus',status,'waitingFor','RESTORE_RECONCILIATION'),status='WAITING_FOR_CLIENT'
            WHERE status NOT IN ('SUCCEEDED','BLOCKED','FAILED_RETRYABLE','CANCELLED');\n`));
        await file.sync();
      } finally { await file.close(); }
      await postgres.restore(sql);
      for await (const row of catalogueLines(path.join(directory, "catalogue.ndjson"))) if (row.type === "OBJECT") {
        await blobs.put(row.scope, row.kind, row.id, row.ref, objectBytes(this.targetBlobs, row));
      }
      const client = await database.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const hash = createHash("sha256"); let size = 0n;
        for await (const row of databaseCatalogue(client)) { const line = Buffer.from(`${canonicalEncode(row)}\n`); hash.update(line); size += BigInt(line.length); }
        requireValue(hash.digest("hex") === payload.catalogue.digest && String(size) === payload.catalogue.sizeBytes,
          "SOURCE_BACKUP_WATERLINE_MISMATCH", "还原数据库与备份引用集合不在同一水位，不能开放准入");
        await verifyDatabaseEvidence(client, blobs);
        await client.query("COMMIT");
      } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
      await this.mirror(database, payload, directory, requestedBy);
      const result = { backupId, recoveredThrough: payload.waterline.capturedAt, restoredAt: new Date().toISOString(), laterWork: "NOT_INCLUDED",
        checkpointRule: "VERIFIED_PREFIX_ONLY", pendingRuns: "WAIT_FOR_EXPLICIT_RECONCILIATION" };
      await transaction(database, async (tx) => {
        await tx.query("INSERT INTO source_truth_restore_event (id,backup_id,payload) VALUES ($1,$2,$3)", [randomUUID(), backupId, JSON.stringify({ ...result, requestedBy })]);
        await tx.query("UPDATE source_truth_workspace SET restore_ready=true,backup_barrier=false");
      });
      return result;
    } finally { await unlink(archive).catch(() => {}); await unlink(sql).catch(() => {}); }
  }
}
