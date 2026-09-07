import { createHash } from "node:crypto";
import { canonicalEncode, decodePathBytes, manifestEntry, orderedArrayDigest, byteCount } from "./identity.js";
import { fail, requireValue } from "./errors.js";

const values = (context) => [context.workspaceId, context.runId, context.sourceId];
const manifestRecord = (row) => ({ id: row.id, kind: row.kind, fileCount: String(row.file_count), directoryCount: String(row.directory_count), knownBytes: String(row.known_bytes), shardCount: row.shard_count });
const sha = (value) => createHash("sha256").update(canonicalEncode(value)).digest("hex");

export class SourceMaterialRepository {
  constructor(repository, { maxEntries = 200000, maxBatchEntries = 500 } = {}) {
    this.repository = repository;
    this.db = repository.database;
    this.maxEntries = maxEntries;
    this.maxBatchEntries = maxBatchEntries;
  }

  async source(context, tx = this.db) {
    const { rows } = await tx.query("SELECT * FROM source_truth_run_source WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3", values(context));
    requireValue(rows[0], "SOURCE_NOT_FOUND", "本任务中没有该来源", { status: 404 });
    return rows[0];
  }

  async readContext(context, tx = this.db) {
    const source = await this.source(context, tx);
    if (source.source.mode !== "REUSE") return context;
    const row = (await tx.query("SELECT run_id,source_id FROM source_truth_component WHERE workspace_id=$1 AND id=$2", [context.workspaceId, source.source.componentId])).rows[0];
    requireValue(row && row.run_id !== context.runId, "SOURCE_CONTENT_MISSING", "沿用组件的完整材料引用不可用");
    return { ...context, runId: row.run_id, sourceId: row.source_id };
  }

  async addSource(context, source) {
    return this.repository.withLease(context, async (tx, run) => {
      requireValue(run.status === "ENUMERATING" && source.sourceId === context.sourceId && ["GIT", "DIRECTORY_UPLOAD"].includes(source.kind), "SOURCE_INVALID_INPUT", "来源不属于当前枚举", { status: 400 });
      await tx.query(`INSERT INTO source_truth_run_source (workspace_id,run_id,source_id,kind,source) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (workspace_id,run_id,source_id) DO NOTHING`, [...values(context), source.kind, JSON.stringify(source)]);
      const stored = await this.source(context, tx);
      requireValue(canonicalEncode(stored.source) === canonicalEncode(source), "SOURCE_REVISION_CONFLICT", "恢复输入与原来源不一致");
      return stored.source;
    });
  }

  async appendEntries(context, entries, { batchId = null } = {}) {
    requireValue(Array.isArray(entries) && entries.length > 0 && entries.length <= this.maxBatchEntries, "SOURCE_INVALID_INPUT", "清单批次为空或超过限制", { status: 400 });
    return this.repository.withLease(context, async (tx, run) => {
      const source = await this.source(context, tx);
      const normalized = entries.map((row) => manifestEntry(source.kind, row));
      if (batchId !== null) {
        requireValue(typeof batchId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(batchId), "SOURCE_INVALID_INPUT", "枚举批次标识无效", { status: 400 });
        const prior = (await tx.query("SELECT digest,result FROM source_truth_enumeration_batch WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3 AND batch_id=$4", [...values(context), batchId])).rows[0];
        if (prior) {
          requireValue(prior.digest === sha(normalized), "SOURCE_ENUMERATION_CONFLICT", "重试批次与原清单不同，请重新核对目录");
          return prior.result;
        }
      }
      requireValue(!source.enumeration_closed && !source.manifest_id, "SOURCE_MANIFEST_LOCKED", "清单已闭合，修改来源需创建新候选");
      requireValue(["ENUMERATING", "WAITING_FOR_CLIENT"].includes(run.status), "SOURCE_INVALID_TRANSITION", "当前阶段不能添加清单");
      const existing = await this.count(context, tx);
      requireValue(BigInt(existing.fileCount) + BigInt(existing.directoryCount) + BigInt(normalized.length) <= BigInt(this.maxEntries), "SOURCE_ENTRY_LIMIT", "文件/目录数量超过平台限制", { status: 413 });
      try {
        await tx.query(`INSERT INTO source_truth_entry (workspace_id,run_id,source_id,path_bytes,entry)
          SELECT $1,$2,$3,decode(translate(r->>'pathBytes','-_','+/') || repeat('=',(4-length(r->>'pathBytes')%4)%4),'base64'),r
          FROM jsonb_array_elements($4::jsonb) r`, [...values(context), JSON.stringify(normalized)]);
      } catch (error) {
        if (error.code === "23505") fail("SOURCE_DUPLICATE_PATH", "清单含重复路径，不能合并或忽略", { status: 409 });
        throw error;
      }
      const result = { discoveredCount: String(BigInt(existing.fileCount) + BigInt(existing.directoryCount) + BigInt(normalized.length)) };
      if (batchId !== null) await tx.query("INSERT INTO source_truth_enumeration_batch (workspace_id,run_id,source_id,batch_id,digest,result) VALUES ($1,$2,$3,$4,$5,$6)", [...values(context), batchId, sha(normalized), JSON.stringify(result)]);
      return result;
    });
  }

  async count(context, tx = this.db) {
    context = await this.readContext(context, tx);
    const { rows } = await tx.query(`SELECT count(*) FILTER (WHERE entry->>'kind'<>'DIRECTORY')::text AS files,
      count(*) FILTER (WHERE entry->>'kind'='DIRECTORY')::text AS directories,
      COALESCE(sum((entry->>'sizeBytes')::numeric),0)::text AS bytes,
      count(*) FILTER (WHERE disposition IS NULL)::text AS pending
      FROM source_truth_entry WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3`, values(context));
    return { fileCount: rows[0].files, directoryCount: rows[0].directories, knownBytes: rows[0].bytes, pendingCount: rows[0].pending };
  }

  async closeEnumeration(context, { fileCount, directoryCount, beforeClose }) {
    byteCount(fileCount, "fileCount");
    byteCount(directoryCount, "directoryCount");
    return this.repository.withLease(context, async (tx) => {
      const source = await this.source(context, tx);
      const actual = await this.count(context, tx);
      requireValue(source.kind !== "DIRECTORY_UPLOAD" || fileCount !== "0", "SOURCE_EMPTY_DIRECTORY_UNSUPPORTED", "首期不支持零文件的上传目录；清空目录不能发布删除结论");
      requireValue(actual.fileCount === fileCount && actual.directoryCount === directoryCount, "SOURCE_ENUMERATION_INCOMPLETE", "枚举闭合计数与已收到清单不一致");
      const missingParent = await tx.query(`SELECT 1 FROM source_truth_entry e WHERE e.workspace_id=$1 AND e.run_id=$2 AND e.source_id=$3
        AND source_truth_parent_path(e.path_bytes) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM source_truth_entry p
          WHERE p.workspace_id=e.workspace_id AND p.run_id=e.run_id AND p.source_id=e.source_id
          AND p.path_bytes=source_truth_parent_path(e.path_bytes) AND p.entry->>'kind'='DIRECTORY') LIMIT 1`, values(context));
      requireValue(!missingParent.rows.length, "SOURCE_ENUMERATION_INCOMPLETE", "清单缺少父目录或路径层次冲突，不能静默补造");
      await beforeClose?.(tx);
      await tx.query("UPDATE source_truth_run_source SET enumeration_closed=true WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3", values(context));
      return actual;
    });
  }

  async entries(context, { after = null, limit = 100 } = {}, tx = this.db) {
    context = await this.readContext(context, tx);
    requireValue(Number.isInteger(limit) && limit > 0 && limit <= 1000, "SOURCE_INVALID_INPUT", "分页大小必须为 1～1000", { status: 400 });
    const { rows } = await tx.query(`SELECT entry,disposition FROM source_truth_entry WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3
      AND ($4::bytea IS NULL OR path_bytes>$4) ORDER BY path_bytes LIMIT $5`, [...values(context), after ? decodePathBytes(after) : null, limit + 1]);
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    return { items, nextCursor: more ? items.at(-1).entry.pathBytes : null };
  }

  async *entryStream(context, pageSize = 500) {
    let after = null;
    do {
      const page = await this.entries(context, { after, limit: pageSize });
      for (const row of page.items) yield row.entry;
      after = page.nextCursor;
    } while (after);
  }

  async freezeManifest(context, { shardSize = 500 } = {}) {
    requireValue(Number.isInteger(shardSize) && shardSize > 0 && shardSize <= 1000, "SOURCE_INVALID_INPUT", "清单分片大小无效", { status: 400 });
    const source = await this.repository.withLease(context, async (tx) => this.source(context, tx));
    requireValue(source.enumeration_closed, "SOURCE_ENUMERATION_INCOMPLETE", "完整枚举尚未闭合，不能冻结清单");
    const id = await orderedArrayDigest("manifest", { kind: source.kind }, "entries", this.entryStream(context));
    const existing = await this.db.query("SELECT * FROM source_truth_manifest WHERE workspace_id=$1 AND id=$2", [context.workspaceId, id]);
    if (!existing.rows[0]) {
      let batch = [];
      let ordinal = 0;
      const save = async () => {
        await this.repository.withLease(context, async (tx) => {
          await tx.query(`INSERT INTO source_truth_manifest_shard (workspace_id,manifest_id,ordinal,entries,digest) VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT DO NOTHING`, [context.workspaceId, id, ordinal, JSON.stringify(batch), sha(batch)]);
          const stored = await tx.query("SELECT digest FROM source_truth_manifest_shard WHERE workspace_id=$1 AND manifest_id=$2 AND ordinal=$3", [context.workspaceId, id, ordinal]);
          requireValue(stored.rows[0]?.digest === sha(batch), "SOURCE_MANIFEST_CORRUPT", "清单准备分片不一致");
        });
        ordinal++;
        batch = [];
      };
      for await (const row of this.entryStream(context, shardSize)) {
        batch.push(row);
        if (batch.length === shardSize) await save();
      }
      if (batch.length) await save();
      await this.repository.withLease(context, async (tx) => {
        const counts = await this.count(context, tx);
        await tx.query(`INSERT INTO source_truth_manifest (workspace_id,id,kind,file_count,directory_count,known_bytes,shard_count)
          VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [context.workspaceId, id, source.kind, counts.fileCount, counts.directoryCount, counts.knownBytes, ordinal]);
      });
    }
    return this.repository.withLease(context, async (tx) => {
      const { rows } = await tx.query("SELECT * FROM source_truth_manifest WHERE workspace_id=$1 AND id=$2", [context.workspaceId, id]);
      requireValue(rows[0], "SOURCE_MANIFEST_CORRUPT", "清单完成记录缺失");
      await tx.query("UPDATE source_truth_run_source SET manifest_id=$4 WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3", [...values(context), id]);
      return manifestRecord(rows[0]);
    });
  }

  async dispose(context, input) {
    return this.repository.withLease(context, async (tx) => {
      const source = await this.source(context, tx);
      requireValue(source.manifest_id, "SOURCE_ENUMERATION_INCOMPLETE", "先冻结完整清单再校验内容");
      const { rows } = await tx.query("SELECT entry,disposition FROM source_truth_entry WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3 AND path_bytes=$4 FOR UPDATE", [...values(context), decodePathBytes(input.pathBytes)]);
      const row = rows[0];
      requireValue(row, "SOURCE_NOT_FOUND", "文件不在冻结清单中", { status: 404 });
      const disposition = { disposition: input.disposition, reasonCode: input.reasonCode, digest: input.digest ?? null, sizeBytes: input.sizeBytes ?? null, gaps: input.gaps ?? [] };
      const metadataOnly = ["DIRECTORY", "GITLINK"].includes(row.entry.kind);
      requireValue(source.kind !== "DIRECTORY_UPLOAD" || (row.entry.kind === "DIRECTORY" ? input.disposition === "METADATA" : input.disposition === "VERIFIED"), "SOURCE_DIRECTORY_INCOMPLETE", "上传目录中的已选文件不能被跳过或接受为缺失");
      requireValue(["VERIFIED", "METADATA", "EXTERNAL_GAP"].includes(input.disposition), "SOURCE_INVALID_INPUT", "条目处置无效", { status: 400 });
      requireValue(typeof input.reasonCode === "string" && input.reasonCode.length > 0, "SOURCE_INVALID_INPUT", "处置必须有规则原因", { status: 400 });
      if (!metadataOnly) {
        requireValue(/^[a-f0-9]{64}$/.test(input.digest ?? "") && input.sizeBytes === row.entry.sizeBytes
          && (source.kind !== "DIRECTORY_UPLOAD" || input.digest === row.entry.expectedContent.digest), "SOURCE_CONTENT_MISMATCH", "内容证据与冻结清单不一致");
      }
      requireValue(!row.disposition || canonicalEncode(row.disposition) === canonicalEncode(disposition), "SOURCE_CONTENT_MISMATCH", "终态处置不可改写");
      await tx.query("UPDATE source_truth_entry SET disposition=$5 WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3 AND path_bytes=$4 AND disposition IS NULL", [...values(context), decodePathBytes(input.pathBytes), JSON.stringify(disposition)]);
      return disposition;
    });
  }

  async summary(context, tx = this.db) { return this.count(context, tx); }
}
