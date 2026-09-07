import assert from "node:assert/strict";
import test from "node:test";
import { sourceJourney, sourceStations } from "../app/source-truth/journey.ts";

test("all eight stations share one workbench; browsing a future or past station never grants execution", () => {
  assert.equal(sourceStations.length, 8);
  assert.equal(sourceStations[7], "冻结包");
  assert.equal(sourceJourney(null, 0, false).current, 1);
  assert.equal(sourceJourney(null, 1, false).action, "START");
  const review = { status: "REVIEW_REQUIRED", station: 7 };
  assert.equal(sourceJourney(review, 1, false).action, "CONFIRM");
  assert.equal(sourceJourney(review, 1, false, 8).action, null);
  assert.equal(sourceJourney(review, 1, false, 8).preview, true);
  assert.equal(sourceJourney(review, 1, true).current, 8);
  assert.equal(sourceJourney(review, 1, true).action, "SEAL");
  assert.equal(sourceJourney(review, 1, true, 1).action, null);
});

test("blocked and unconfirmed states are not green and never offer accept or downstream start", () => {
  const blocked = sourceJourney({ status: "BLOCKED", station: 3 }, 1, false);
  assert.equal(blocked.tone, "danger");
  assert.equal(blocked.action, "EDIT");
  assert.equal(sourceJourney({ status: "FAILED_RETRYABLE", station: 6 }, 1, false).action, "RETRY");
  assert.equal(sourceJourney({ status: "WAITING_FOR_CLIENT", station: 6 }, 1, false).action, "RESUME_DIRECTORY");
  assert.equal(sourceJourney({ status: "SUCCEEDED", station: 8 }, 1, true).label, "包已冻结 · 当前准入另行核验");
  assert.equal(sourceJourney({ status: "PREPARING_SEAL", station: 8 }, 1, true).action, "QUERY_RESULT");
});
