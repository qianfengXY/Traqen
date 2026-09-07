import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { canonicalEncode, byteCount, orderedArrayDigest } from "./identity.js";
import { requireValue } from "./errors.js";
import { SourceCandidateService } from "./candidate-service.js";
import { SourceTruthRepository } from "./repository.js";
import { SourceMaterialRepository } from "./material-repository.js";
import { SourceAdmissionService } from "./admission-service.js";

export async function* fileBytes(filename) {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    requireValue(stat.isFile() && (stat.mode & 0o077) === 0, "SOURCE_BACKUP_CORRUPT", "备份文件类型或访问保护异常");
    for await (const chunk of file.createReadStream({ autoClose: false, highWaterMark: 65536 })) yield chunk;
  } finally { await file.close(); }
}
export async function fileDigest(filename, maximum = BigInt(Number.MAX_SAFE_INTEGER)) {
  const hash = createHash("sha256"); let size = 0n;
  for await (const bytes of fileBytes(filename)) {
    size += BigInt(bytes.length);
    requireValue(size <= maximum, "SOURCE_BACKUP_CAPACITY_EXHAUSTED", "备份超过配置的资源预算", { status: 507 });
    hash.update(bytes);
  }
  return { digest: hash.digest("hex"), sizeBytes: String(size) };
}
export async function* catalogueLines(filename) {
  let pending = "";
  // The catalogue is canonical ASCII/UTF-8 JSON; use a decoder so a multibyte
  // Workspace id split across read buffers cannot change the completion proof.
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for await (const chunk of fileBytes(filename)) {
    pending += decoder.decode(chunk, { stream: true });
    let at;
    while ((at = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, at); pending = pending.slice(at + 1);
      requireValue(Buffer.byteLength(line) <= 1024 * 1024, "SOURCE_BACKUP_CORRUPT", "备份清单条目超过限制");
      const row = JSON.parse(line);
      requireValue(canonicalEncode(row) === line, "SOURCE_BACKUP_CORRUPT", "备份清单不是规范化编码");
      yield row;
    }
    requireValue(Buffer.byteLength(pending) <= 1024 * 1024, "SOURCE_BACKUP_CORRUPT", "备份清单条目超过限制");
  }
  pending += decoder.decode();
  requireValue(pending === "", "SOURCE_BACKUP_CORRUPT", "备份清单尾部未闭合");
}

const catalogueQueries = [
  `SELECT jsonb_build_object('type','OBJECT','scope',jsonb_build_object('workspaceId',workspace_id,'tenantId',tenant_id),'kind',kind,'id',id,'ref',jsonb_build_object('digest',digest,'sizeBytes',size_bytes)) AS record FROM (
    SELECT DISTINCT e.workspace_id,w.tenant_id,'blobs'::text AS kind,e.disposition->>'digest' AS id,e.disposition->>'digest' AS digest,e.disposition->>'sizeBytes' AS size_bytes
      FROM source_truth_entry e JOIN source_truth_workspace w USING(workspace_id) WHERE e.disposition->>'digest' IS NOT NULL
    UNION SELECT DISTINCT c.workspace_id,w.tenant_id,'chunks',c.chunk_id,c.digest,c.size_bytes::text
      FROM source_truth_upload_checkpoint c JOIN source_truth_workspace w USING(workspace_id)
      WHERE NOT EXISTS (SELECT 1 FROM source_truth_staging_release a WHERE a.workspace_id=c.workspace_id AND a.run_id=c.run_id)
    ) objects ORDER BY workspace_id,kind,id`,
  `SELECT jsonb_build_object('type','CHECKPOINT','workspaceId',workspace_id,'runId',run_id,'sourceId',source_id,'pathHex',encode(path_bytes,'hex'),
    'offset',offset_bytes::text,'sizeBytes',size_bytes::text,'digest',digest,'id',chunk_id) AS record
    FROM source_truth_upload_checkpoint c WHERE NOT EXISTS
      (SELECT 1 FROM source_truth_staging_release a WHERE a.workspace_id=c.workspace_id AND a.run_id=c.run_id)
    ORDER BY workspace_id,run_id,source_id,path_bytes,offset_bytes`,
  `SELECT jsonb_build_object('type','MANIFEST','workspaceId',workspace_id,'id',id,'kind',kind,'fileCount',file_count::text,'directoryCount',directory_count::text,
    'knownBytes',known_bytes::text,'shardCount',shard_count) AS record FROM source_truth_manifest ORDER BY workspace_id,id`,
  `SELECT jsonb_build_object('type','MEMBER','workspaceId',r.workspace_id,'bundleId',r.bundle_id,'receiptId',r.id,'confirmationId',r.confirmation_id,
    'receipt',r.payload,'confirmation',c.payload) AS record FROM source_truth_receipt r JOIN source_truth_confirmation c ON c.workspace_id=r.workspace_id AND c.id=r.confirmation_id
    ORDER BY r.workspace_id,r.bundle_id,r.id`,
];

// The same deterministic bounded stream is used at the exported database
// waterline and after restore. Membership and checkpoints must match exactly,
// not merely exist as a subset in an unrelated dump.
export async function* databaseCatalogue(tx) {
  for (let i = 0; i < catalogueQueries.length; i++) {
    const name = `f001_catalogue_${i}`;
    await tx.query(`DECLARE ${name} NO SCROLL CURSOR FOR ${catalogueQueries[i]}`);
    try {
      while (true) {
        const { rows } = await tx.query(`FETCH FORWARD 500 FROM ${name}`);
        for (const row of rows) yield row.record;
        if (rows.length < 500) break;
      }
    } finally { await tx.query(`CLOSE ${name}`); }
  }
}

export async function verifyDatabaseEvidence(tx, blobs) {
  const repository = new SourceTruthRepository(tx), materials = new SourceMaterialRepository(repository);
  const candidates = new SourceCandidateService(repository, materials, blobs);
  const admission = new SourceAdmissionService(repository, candidates);
  let after = null;
  while (true) {
    const { rows } = await tx.query(`SELECT b.*,w.tenant_id FROM source_truth_bundle b JOIN source_truth_workspace w USING(workspace_id)
      WHERE $1::text IS NULL OR (b.workspace_id,b.id)>($1,$2) ORDER BY b.workspace_id,b.id LIMIT 100`, [after?.workspace_id ?? null, after?.id ?? null]);
    for (const row of rows) {
      await candidates.verifyEvidence(row.workspace_id, { id: row.id, payload: row.payload.identity, counts: row.payload.counts },
        { scope: { workspaceId: row.workspace_id, tenantId: row.tenant_id }, heartbeat: async () => {} });
    }
    if (rows.length < 100) break;
    after = rows.at(-1);
  }
  // Validate receipt binding without requiring an unexpired acceptance or a
  // presently authorized original member. Historical evidence must be backed up
  // even after access/acceptance expires; restore does not auto-renew either.
  for await (const row of databaseCatalogue(tx)) {
    if (row.type === "MEMBER") await admission.assertBinding(row.workspaceId, { bundleId: row.bundleId, receiptId: row.receiptId }, tx);
    if (row.type === "MANIFEST") {
      let count = 0, previous = null, files = 0n, directories = 0n, knownBytes = 0n;
      async function* entries() {
        while (count < row.shardCount) {
          const { rows } = await tx.query("SELECT * FROM source_truth_manifest_shard WHERE workspace_id=$1 AND manifest_id=$2 AND ordinal=$3", [row.workspaceId, row.id, count]);
          const shard = rows[0];
          requireValue(shard && shard.entries.length > 0 && shard.entries.length <= 1000
            && createHash("sha256").update(canonicalEncode(shard.entries)).digest("hex") === shard.digest,
          "SOURCE_MANIFEST_CORRUPT", "备份清单分片缺失或损坏");
          for (const entry of shard.entries) {
            const rawPath = Buffer.from(entry.pathBytes, "base64url");
            requireValue(!previous || Buffer.compare(previous, rawPath) < 0, "SOURCE_MANIFEST_CORRUPT", "备份清单顺序或成员重复");
            previous = rawPath;
            if (entry.kind === "DIRECTORY") directories++; else files++;
            if (entry.sizeBytes !== null) knownBytes += BigInt(byteCount(entry.sizeBytes));
            yield entry;
          }
          count++;
        }
      }
      requireValue(await orderedArrayDigest("manifest", { kind: row.kind }, "entries", entries()) === row.id
        && String(files) === row.fileCount && String(directories) === row.directoryCount && String(knownBytes) === row.knownBytes,
      "SOURCE_MANIFEST_CORRUPT", "备份清单身份或计数不守恒");
    }
  }
  const invalidPrefix = (await tx.query(`SELECT 1 FROM (SELECT offset_bytes,COALESCE(sum(size_bytes) OVER
    (PARTITION BY workspace_id,run_id,source_id,path_bytes ORDER BY offset_bytes ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS expected
    FROM source_truth_upload_checkpoint) prefixes WHERE offset_bytes<>expected LIMIT 1`)).rows[0];
  requireValue(!invalidPrefix, "SOURCE_BACKUP_CHECKPOINT_CORRUPT", "已保存分片并非连续验证前缀，不能宣称可恢复");
}
