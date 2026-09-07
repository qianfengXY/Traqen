import { decodePathBytes, byteCount } from "./identity.js";
import { requireValue } from "./errors.js";

const locator = (context, encodedPath) => [context.workspaceId, context.runId, context.sourceId, decodePathBytes(encodedPath)];
const checkpointRef = (row) => ({ id: row.chunk_id, digest: row.digest, sizeBytes: String(row.size_bytes), offset: String(row.offset_bytes) });

export class SourceUploadService {
  constructor(repository, materials, blobs) { Object.assign(this, { repository, materials, blobs }); }

  async check(actor, context, encodedPath, tx, maintain = true) {
    const access = await this.repository.authorize(actor, context.workspaceId, maintain, tx);
    const source = await this.materials.source(context, tx);
    requireValue(source.kind === "DIRECTORY_UPLOAD" && source.manifest_id, "SOURCE_MANIFEST_LOCKED", "需要当前目录的冻结清单才能传输");
    const { rows } = await tx.query("SELECT entry,disposition FROM source_truth_entry WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3 AND path_bytes=$4", locator(context, encodedPath));
    requireValue(rows[0]?.entry.kind === "FILE", "SOURCE_NOT_FOUND", "文件不在冻结的目录清单中", { status: 404 });
    return { ...rows[0], scope: { tenantId: access.tenantId, workspaceId: context.workspaceId } };
  }

  async prefix(context, encodedPath, tx = this.repository.database) {
    const { rows } = await tx.query(`SELECT COALESCE(sum(size_bytes),0)::text AS bytes FROM source_truth_upload_checkpoint
      WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3 AND path_bytes=$4`, locator(context, encodedPath));
    return rows[0].bytes;
  }

  async checkpoint(actor, context, encodedPath) {
    return this.repository.withWorkspace(actor, context.workspaceId, false, async (tx) => {
      const current = await this.check(actor, context, encodedPath, tx, false);
      return { pathBytes: encodedPath, verifiedPrefixBytes: await this.prefix(context, encodedPath, tx),
        expectedBytes: current.entry.sizeBytes, completed: current.disposition?.disposition === "VERIFIED" };
    });
  }

  async validateChunk(actor, context, input, tx) {
    const current = await this.check(actor, context, input.pathBytes, tx);
    const size = BigInt(byteCount(input.sizeBytes));
    const offset = BigInt(byteCount(input.offset, "offset"));
    requireValue(size > 0n && size <= BigInt(this.blobs.maxChunkBytes) && offset + size <= BigInt(current.entry.sizeBytes),
      "SOURCE_UPLOAD_CHUNK_INVALID", "分片长度超过平台限制或冻结文件边界", { status: 400 });
    const existing = await tx.query(`SELECT digest,size_bytes FROM source_truth_upload_checkpoint WHERE workspace_id=$1
      AND run_id=$2 AND source_id=$3 AND path_bytes=$4 AND offset_bytes=$5`, [...locator(context, input.pathBytes), input.offset]);
    if (existing.rows[0]) {
      requireValue(existing.rows[0].digest === input.digest && String(existing.rows[0].size_bytes) === input.sizeBytes,
        "SOURCE_UPLOAD_CHECKPOINT_CONFLICT", "该位置已有不同的已验证分片，请重新核对所选目录");
    } else {
      requireValue(await this.prefix(context, input.pathBytes, tx) === input.offset, "SOURCE_UPLOAD_OFFSET_MISMATCH", "请从服务端已验证前缀续传，不能跳过中间字节");
    }
    return current;
  }

  async uploadChunk(actor, context, input, stream) {
    const check = (tx, run) => {
      requireValue(["CAPTURING", "WAITING_FOR_CLIENT"].includes(run.status), "SOURCE_INVALID_TRANSITION", "当前阶段不接受文件分片");
      return this.validateChunk(actor, context, input, tx);
    };
    const current = await this.repository.withLease(context, check);
    // Only this verified durable chunk may become a checkpoint. If the second
    // transaction fails, the private encrypted bytes remain retryable, not READY.
    const saved = await this.blobs.putChunk(current.scope, { ...input, runId: context.runId, fileKey: `${context.sourceId}:${input.pathBytes}` }, stream);
    return this.repository.withLease(context, async (tx, run) => {
      await check(tx, run);
      await tx.query(`INSERT INTO source_truth_upload_checkpoint
        (workspace_id,run_id,source_id,path_bytes,offset_bytes,size_bytes,digest,chunk_id,actor_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [...locator(context, input.pathBytes), input.offset, input.sizeBytes, input.digest, saved.id, actor.actorId]);
      return { pathBytes: input.pathBytes, verifiedPrefixBytes: await this.prefix(context, input.pathBytes, tx) };
    });
  }

  async *verifiedChunks(scope, context, encodedPath) {
    let offset = "0";
    while (true) {
      const { rows } = await this.repository.database.query(`SELECT * FROM source_truth_upload_checkpoint
        WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3 AND path_bytes=$4 AND offset_bytes >= $5
        ORDER BY offset_bytes LIMIT 100`, [...locator(context, encodedPath), offset]);
      if (!rows.length) return;
      for (const row of rows) {
        const ref = checkpointRef(row);
        requireValue(ref.offset === offset, "SOURCE_UPLOAD_INCOMPLETE", "已验证分片不连续，不能恢复为完整文件");
        yield* this.blobs.readChunk(scope, ref);
        offset = String(BigInt(offset) + BigInt(ref.sizeBytes));
      }
    }
  }

  async finishFile(actor, context, encodedPath) {
    const current = await this.repository.withLease(context, async (tx, run) => {
      requireValue(["CAPTURING", "WAITING_FOR_CLIENT", "RECONCILING"].includes(run.status), "SOURCE_INVALID_TRANSITION", "当前阶段不能完成文件验证");
      return this.check(actor, context, encodedPath, tx);
    });
    const ref = { digest: current.entry.expectedContent.digest, sizeBytes: current.entry.sizeBytes };
    const reused = await this.blobs.verifyBlob(current.scope, ref);
    if (!reused) {
      requireValue(await this.prefix(context, encodedPath) === ref.sizeBytes, "SOURCE_UPLOAD_INCOMPLETE", "文件还缺字节，重新选择原目录后继续传输");
      await this.blobs.putBlob(current.scope, ref, this.verifiedChunks(current.scope, context, encodedPath));
    }
    await this.repository.withLease(context, (tx) => this.check(actor, context, encodedPath, tx));
    await this.materials.dispose(context, { pathBytes: encodedPath, disposition: "VERIFIED", reasonCode: "CONTENT_VERIFIED", ...ref });
    return { ...ref, reused };
  }
}
