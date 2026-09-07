import assert from "node:assert/strict";
import test from "node:test";
import { transferDirectory } from "../app/source-truth/transfer.ts";

test("small-file transfer requires an exact completion acknowledgement before displaying verified progress", async () => {
  for (const reply of [null, {}, { completed: true, verifiedPrefixBytes: "2", pathBytes: "wrong" }]) {
    const file = new File(["ok"], "doc"), rows = [], requests = [], progress = [];
    const handle = { kind: "file", getFile: async () => file };
    const root = { kind: "directory", async *entries() { yield ["doc", handle]; }, getFileHandle: async () => handle };
    const store = { async putBatch(batch) { rows.push(...batch); }, async *ordered() { yield* rows; } };
    const client = { async request(route, method = "GET") {
      requests.push([route, method]);
      if (route.endsWith("/view")) return { sources: [{ sourceId: "docs", manifestId: null }] };
      if (route.includes("/entries?") && method === "GET") return { items: rows.map((r) => ({ entry: r.entry, disposition: null })), nextCursor: null };
      if (route.includes("/checkpoint?")) return { verifiedPrefixBytes: "0", completed: false, reusable: false };
      if (route.includes("/complete-file?")) return reply;
      return {};
    } };
    await assert.rejects(transferDirectory(client, "run", "docs", root, store,
      { maxEntries: 10, maxFileBytes: "100", maxTotalBytes: "100", maxBatchEntries: 5, maxChunkBytes: 4 }, (event) => progress.push(event)), /确认/);
    assert.equal(requests.filter(([route]) => route.endsWith("/advance")).length, 1, "never advance to review after an unconfirmed write");
    assert.equal(progress.filter((event) => event.phase === "UPLOAD" && event.verifiedFiles !== "0").length, 0);
  }
});
