import type { DeterministicFactsClient } from "./client.ts";
import type { Coverage, RecordPage } from "./types.ts";

export async function materialRecords(client: DeterministicFactsClient, versionId: string, materialIds: string[]): Promise<RecordPage> {
  const ids = [...new Set(materialIds)].sort(), items: RecordPage["items"] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const page = await client.request<RecordPage>(`/versions/${versionId}/materials?limit=100&materialIds=${batch.join(",")}`);
    if (page.nextCursor || page.items.some(item => item.kind !== "MATERIAL" || !batch.includes(item.id))) throw new Error("材料清单未对应当前固定引用批次。");
    items.push(...page.items);
  }
  return { items, nextCursor: null };
}

// Only the materials currently rendered/inspected, never the full denominator.
export async function materialCoverage(client: DeterministicFactsClient, versionId: string, materialIds: string[]): Promise<Coverage | null> {
  const ids = [...new Set(materialIds)].sort();
  let result: Coverage | null = null;
  const items: Coverage["items"] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const filter = ids.slice(offset, offset + 100).join(",");
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const { coverage }: { coverage: Coverage } = await client.request(`/versions/${versionId}/coverage?limit=500&materialIds=${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      result = coverage;
      items.push(...coverage.items);
      cursor = coverage.nextCursor ?? null;
      if (cursor && seen.has(cursor)) throw new Error("覆盖分页未前进，处置尚未确认。");
      if (cursor) seen.add(cursor);
    } while (cursor);
  }
  return result ? { ...result, items, nextCursor: null } : null;
}
