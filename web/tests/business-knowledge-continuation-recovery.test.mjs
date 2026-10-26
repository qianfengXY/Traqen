import test from "node:test";
import assert from "node:assert/strict";
import { WorkSessionClient } from "../app/business-knowledge/work-client.ts";
const binding = {
  graphRevisionId: "revision",
  graphDigest: "a".repeat(64),
  sourceInput: { sourceBundleSnapshotId: "b".repeat(64), receiptId: "receipt" },
  adoptedVersionIds: [],
};
const original = {
  id: "original",
  workspaceId: "workspace",
  operationId: "create-original",
  version: 2,
  title: "Original",
  binding,
};
const child = {
  id: "child",
  workspaceId: "workspace",
  operationId: "continue-op",
  version: 1,
  title: "Child",
  binding: { ...binding, graphRevisionId: null, graphDigest: null },
  investigationId: "new-investigation",
  origin: { sessionId: "original", binding, changeSetDigest: "c".repeat(64) },
};
const page = (s) => ({
  session: s,
  records: [],
  recordsTruncated: false,
  nextCursor: null,
});
test("direct continuation receipt validates original operation, parent and immutable origin, not just readable resultId", async () => {
  for (const change of [
    { operationId: "unrelated-op" },
    { origin: { ...child.origin, sessionId: "foreign-parent" } },
    {
      origin: {
        ...child.origin,
        binding: { ...binding, graphDigest: "d".repeat(64) },
      },
    },
    { origin: undefined },
    { investigationId: undefined },
    { id: "original" },
    { workspaceId: "foreign" },
  ]) {
    const c = new WorkSessionClient("workspace", async () => page({ ...child, ...change }));
    await assert.rejects(c.recoverContinuation(original, "continue-op", change.id ?? "child"));
  }
});
test("direct and paged event recovery share exact validation and issue only GETs", async () => {
  for (const direct of [true, false]) {
    const calls = [];
    const client = new WorkSessionClient("workspace", async (path, method = "GET") => {
      calls.push({ path, method });
      if (path.includes("/events"))
        return {
          sessionId: "original",
          events: [
            {
              id: "event",
              workspaceId: "workspace",
              sessionId: "original",
              version: 3,
              type: "CONTINUATION_CREATED",
              newSessionId: "child",
            },
          ],
          currentVersion: 3,
          nextAfterVersion: null,
        };
      return page(child);
    });
    assert.equal(
      (await client.recoverContinuation(original, "continue-op", direct ? "child" : undefined)).id,
      "child",
    );
    assert.ok(calls.every((c) => c.method === "GET"));
  }
  const client = new WorkSessionClient("workspace", async (path) =>
    path.includes("/events")
      ? {
          sessionId: "original",
          events: [
            {
              id: "event",
              workspaceId: "workspace",
              sessionId: "original",
              version: 3,
              type: "CONTINUATION_CREATED",
              newSessionId: "child",
            },
          ],
          currentVersion: 3,
          nextAfterVersion: null,
        }
      : page({
          ...child,
          origin: { ...child.origin, sessionId: "wrong-parent" },
        }),
  );
  await assert.rejects(client.recoverContinuation(original, "continue-op"));
});
test("current refusal and missing original operation remain failures rather than a replacement session or POST retry", async () => {
  const denial = Object.assign(new Error("Forbidden"), { status: 403 });
  const client = new WorkSessionClient("workspace", async () => {
    throw denial;
  });
  await assert.rejects(
    client.recoverContinuation(original, "continue-op", "child"),
    (e) => e === denial,
  );
  const missing = new WorkSessionClient("workspace", async () => ({
    sessionId: "original",
    events: [],
    currentVersion: 2,
    nextAfterVersion: null,
  }));
  await assert.rejects(missing.recoverContinuation(original, "continue-op"), /保留坐标/);
});
