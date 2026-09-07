import { SourceClientError, type SourceTruthClient } from "./client.ts";

export type StagingDisposition = { abandoned: boolean; canAbandon: boolean; releasedBytes: string; retainedBytes: string;
  remainingChunks: string; unverifiedBackupChunks: string; status: string; boundary: string; requestedBy: string | null };

// One explicit action, bounded server batches, no retry after an uncertain
// response. The persisted operation can be queried and explicitly continued.
export async function continueStagingRelease(client: Pick<SourceTruthClient, "request">, runId: string,
  isCurrent: () => boolean, onProgress: (state: StagingDisposition) => void): Promise<StagingDisposition | null> {
  let previous: bigint | null = null;
  while (isCurrent()) {
    const value = await client.request<StagingDisposition>(`/runs/${encodeURIComponent(runId)}/staging-release`, "POST", { confirmRelease: true });
    if (!isCurrent()) return null;
    if (!/^(0|[1-9][0-9]*)$/.test(value.remainingChunks)) throw new SourceClientError("暂存处置结果未确认，请查询原处置");
    const pending = BigInt(value.remainingChunks);
    onProgress(value);
    if (pending === 0n) return value;
    if (previous !== null && pending >= previous) throw new SourceClientError("尚待处理数量未减少，已停止后续写入；请查询原处置");
    previous = pending;
  }
  return null;
}
