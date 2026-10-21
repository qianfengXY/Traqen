import assert from "node:assert/strict";
import test from "node:test";
import { emptyEvidenceView, rememberEvidenceView, restoreEvidenceView } from "../app/deterministic-facts/view-state.ts";

test("F002 full-scope material path query survives authorized refresh without becoming source or another member's state", () => {
  const saved = new Map(), storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const context = { workspaceId: "workspace", actorId: "reader", graphVersionId: "a".repeat(64), authorized: true };
  rememberEvidenceView(storage, context, { ...emptyEvidenceView(), materialPathQuery: "scripts/android-native-ci.mjs", rawSource: "DO_NOT_PERSIST_SOURCE" });
  assert.equal(restoreEvidenceView(storage, context).materialPathQuery, "scripts/android-native-ci.mjs");
  assert.equal([...saved.values()].join("").includes("DO_NOT_PERSIST_SOURCE"), false);
  assert.equal(restoreEvidenceView(storage, { ...context, actorId: "other" }).materialPathQuery, "");
  assert.throws(() => rememberEvidenceView(storage, context, { ...emptyEvidenceView(), materialPathQuery: "x".repeat(513) }));
});
