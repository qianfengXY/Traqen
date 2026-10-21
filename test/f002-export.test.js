import assert from "node:assert/strict";
import test from "node:test";
import { exportFactSet } from "../src/deterministic-facts/export.js";

function fixture(total = 100001) {
  const calls = [];
  return { calls, queries: {
    manifest: async () => ({ counts: { FACT: total }, vocabulary: {} }),
    records: async (_actor, _workspace, _version, { kind, limit, cursor }) => {
      calls.push({ kind, limit, cursor });
      const start = Number(cursor ?? 0), count = kind === "FACT" ? Math.min(limit, total - start) : 0;
      return { items: Array.from({ length: count }, (_, i) => ({ kind, id: String(start + i), payload: {} })), nextCursor: start + count < total && kind === "FACT" ? String(start + count) : null };
    },
    coverage: async () => ({ totalItems: 1, scopeId: "scope", counts: { DONE: 1 }, declaredCapabilities: ["inventory"], items: [{ materialId: "material", capabilityId: "inventory", status: "DONE" }], nextCursor: null }),
  } };
}
test("F002 export streams more than 100k records with bounded reads and a verified completion marker", async () => {
  const { queries, calls } = fixture();
  const chunks = [];
  for await (const chunk of exportFactSet(queries, {}, "workspace", "version")) chunks.push(chunk);
  const result = JSON.parse(chunks.join(""));
  assert.equal(result.facts.length, 100001);
  assert.equal(result.coverage.items.length, 1);
  assert.equal(result.completion.status, "COMPLETE");
  assert.ok(calls.every(call => call.limit <= 500));
  assert.equal(calls.at(-1).kind, undefined, "final current-access read precedes the closing marker");
});
test("F002 export never emits a complete file after revocation, cancellation or missing rows", async () => {
  for (const mode of ["revoked", "cancelled", "missing"]) {
    const { queries } = fixture(1001), controller = new AbortController(), chunks = [];
    const records = queries.records;
    queries.records = async (...args) => {
      if (args[3].kind === "FACT" && args[3].cursor) {
        if (mode === "revoked") throw Object.assign(new Error("revoked"), { code: "SOURCE_FORBIDDEN" });
        if (mode === "cancelled") controller.abort();
        if (mode === "missing") return { items: [], nextCursor: null };
      }
      return records(...args);
    };
    await assert.rejects(async () => { for await (const chunk of exportFactSet(queries, {}, "workspace", "version", { signal: controller.signal })) chunks.push(chunk); });
    assert.equal(chunks.join("").includes('"COMPLETE"'), false);
    assert.throws(() => JSON.parse(chunks.join("")));
  }
});
