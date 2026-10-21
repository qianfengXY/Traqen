import { requireF002 } from "./errors.js";

// One bounded page in memory. Every page goes through the ordinary current
// authorization gate; an interruption leaves no syntactically complete file.
export async function* exportFactSet(queries, actor, workspaceId, graphVersionId, { signal } = {}) {
  const active = () => signal?.throwIfAborted();
  active();
  const manifest = await queries.manifest(actor, workspaceId, graphVersionId);
  yield JSON.stringify({ schemaVersion: 1, workspaceId, graphVersionId, manifest, vocabulary: manifest.vocabulary }).slice(0, -1);
  for (const [name, kinds] of [["objects", ["MATERIAL", "OBJECT"]], ["facts", ["FACT"]], ["evidence", ["EVIDENCE"]], ["gaps", ["GAP"]]]) {
    yield `,"${name}":[`;
    let first = true;
    for (const kind of kinds) {
      let cursor = null, count = 0;
      const seen = new Set();
      do {
        active();
        const page = await queries.records(actor, workspaceId, graphVersionId, { kind, limit: 500, cursor });
        count += page.items.length;
        if (page.items.length) { yield (first ? "" : ",") + JSON.stringify(page.items).slice(1, -1); first = false; }
        cursor = page.nextCursor;
        requireF002(!cursor || !seen.has(cursor), "F002_EXPORT_INCOMPLETE", "导出分页未前进", { status: 409 });
        if (cursor) seen.add(cursor);
      } while (cursor);
      requireF002(count === (manifest.counts[kind] ?? 0), "F002_EXPORT_INCOMPLETE", "导出记录数量与固定清单不符", { status: 409 });
    }
    yield "]";
  }
  let cursor = null, count = 0, expected = null, first = true;
  const seen = new Set();
  do {
    active();
    const page = await queries.coverage(actor, workspaceId, graphVersionId, { limit: 500, cursor });
    if (expected === null) {
      expected = page.totalItems;
      const { items: _items, nextCursor: _cursor, ...metadata } = page;
      yield ',"coverage":' + JSON.stringify(metadata).slice(0, -1) + ',"items":[';
    }
    count += page.items.length;
    if (page.items.length) { yield (first ? "" : ",") + JSON.stringify(page.items).slice(1, -1); first = false; }
    cursor = page.nextCursor;
    requireF002(!cursor || !seen.has(cursor), "F002_EXPORT_INCOMPLETE", "覆盖导出分页未前进", { status: 409 });
    if (cursor) seen.add(cursor);
  } while (cursor);
  requireF002(count === expected, "F002_EXPORT_INCOMPLETE", "覆盖导出数量与固定清单不符", { status: 409 });
  active();
  // Recheck current access before emitting the only complete closing marker.
  await queries.records(actor, workspaceId, graphVersionId, { limit: 1 });
  active();
  yield ']},"completion":{"status":"COMPLETE"}}';
}
