import { directoryManifest, hashLocalFile, resolveLocalFile, scanDirectory, type DirectoryEntry, type DirectoryHandle, type LocalEntry, type SelectionPolicy, type SelectionProgress } from "./directory.ts";
import { SourceTruthClient } from "./client.ts";

export type TransferProgress = SelectionProgress | { phase: "MANIFEST" | "UPLOAD"; path: string; verifiedFiles: string; sentBytes: string; unnecessaryBytes: string };
type EntryPage = { items: { entry: DirectoryEntry; disposition: { disposition: string } | null }[]; nextCursor: string | null };

export async function transferDirectory(client: SourceTruthClient, runId: string, sourceId: string, root: DirectoryHandle,
  store: { putBatch(rows: LocalEntry[]): Promise<void>; ordered(): AsyncIterable<LocalEntry> }, policy: SelectionPolicy & { maxChunkBytes: number },
  onProgress: (progress: TransferProgress) => void = () => {}) {
  const signal = client.signal;
  const summary = await scanDirectory(root, store, policy, { signal, onProgress });
  const manifestId = await directoryManifest(store.ordered(), signal);
  const path = `/runs/${encodeURIComponent(runId)}/sources/${encodeURIComponent(sourceId)}`;
  const detail = await client.request<{ sources: { sourceId: string; manifestId: string | null }[] }>(`/runs/${encodeURIComponent(runId)}/view`);
  const current = detail.sources.find((source) => source.sourceId === sourceId);
  if (!current) throw new Error("本任务尚未准备此目录来源，请先查询当前任务");
  if (current.manifestId && current.manifestId !== manifestId) throw new Error("重新选择的目录与本次冻结清单不同。请恢复原材料，或取消后创建新版本；不能把缺项当删除继续续传。");
  if (!current.manifestId) {
    let batch: DirectoryEntry[] = [], ordinal = 0;
    const flush = async () => {
      await client.request(`${path}/entries`, "POST", { batchId: String(ordinal++), entries: batch }); batch = [];
      onProgress({ phase: "MANIFEST", path: "", verifiedFiles: "0", sentBytes: "0", unnecessaryBytes: "0" });
    };
    for await (const row of store.ordered()) { batch.push(row.entry); if (batch.length === policy.maxBatchEntries) await flush(); }
    if (batch.length) await flush();
    await client.request(`${path}/close`, "POST", { ...summary, manifestId });
    await client.request(`/runs/${encodeURIComponent(runId)}/advance`, "POST", {});
  }
  let cursor: string | null = null, sent = BigInt(0), unnecessary = BigInt(0), files = BigInt(0);
  do {
    const page: EntryPage = await client.request(`${path}/entries?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    for (const { entry, disposition } of page.items) {
      if (entry.kind !== "FILE") continue;
      signal?.throwIfAborted();
      const localPath = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(entry.pathBytes.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
      const emit = () => onProgress({ phase: "UPLOAD", path: localPath, verifiedFiles: String(files), sentBytes: String(sent), unnecessaryBytes: String(unnecessary) });
      if (disposition?.disposition === "VERIFIED") { unnecessary += BigInt(entry.sizeBytes!); files++; emit(); continue; }
      const file = await resolveLocalFile(root, localPath);
      if (String(file.size) !== entry.sizeBytes) throw new Error("本机文件已变化，请重新选择目录并核对");
      const checkpoint = await client.request<{ verifiedPrefixBytes: string; completed: boolean }>(`${path}/checkpoint?pathBytes=${entry.pathBytes}`);
      if (checkpoint.completed) { unnecessary += BigInt(entry.sizeBytes!); files++; emit(); continue; }
      unnecessary += BigInt(checkpoint.verifiedPrefixBytes);
      for (let offset = Number(checkpoint.verifiedPrefixBytes); offset < file.size; offset += policy.maxChunkBytes) {
        const part = file.slice(offset, offset + policy.maxChunkBytes);
        const digest = await hashLocalFile(part, signal);
        const params = new URLSearchParams({ pathBytes: entry.pathBytes, offset: String(offset), sizeBytes: String(part.size), digest });
        await client.request(`${path}/chunks?${params}`, "POST", part);
        sent += BigInt(part.size); emit();
      }
      await client.request(`${path}/finish-file`, "POST", { pathBytes: entry.pathBytes });
      files++; emit();
    }
    cursor = page.nextCursor;
  } while (cursor);
  await client.request(`/runs/${encodeURIComponent(runId)}/advance`, "POST", {});
  return { manifestId, ...summary, sentBytes: String(sent), unnecessaryBytes: String(unnecessary) };
}
