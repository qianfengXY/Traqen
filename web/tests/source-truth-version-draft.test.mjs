import assert from "node:assert/strict";
import test from "node:test";
import * as journey from "../app/source-truth/journey.ts";

test("new version binds the selected historical bundle rather than the latest draft", () => {
  const base = { id: "a".repeat(64), components: [{ id: "b".repeat(64), sourceId: "original", kind: "DIRECTORY_UPLOAD" }] };
  const current = { baselineBundleId: "c".repeat(64), sources: [{ sourceId: "unrelated", kind: "DIRECTORY_UPLOAD", mode: "UPDATE" }] };
  const draft = journey.draftFromVersion ? journey.draftFromVersion(base) : current;
  assert.equal(draft.baselineBundleId, base.id);
  assert.deepEqual(draft.sources.map(({ sourceId, componentId, mode }) => ({ sourceId, componentId, mode })), [{ sourceId: "original", componentId: "b".repeat(64), mode: "REUSE" }]);
});
