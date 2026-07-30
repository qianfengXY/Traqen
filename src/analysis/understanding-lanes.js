import { deepFreeze } from "../domain/index.js";

export const UnderstandingLane = Object.freeze({
  INVENTORY: "INVENTORY",
  DETERMINISTIC: "DETERMINISTIC",
  DOCUMENT_CONTRACT: "DOCUMENT_CONTRACT",
  TEST_CONFIG_RESULT: "TEST_CONFIG_RESULT",
  AGENT_SKILL: "AGENT_SKILL",
  RECONCILIATION: "RECONCILIATION",
});

export function createUnderstandingLaneStatus(input) {
  if (!Object.values(UnderstandingLane).includes(input.lane)) throw new TypeError("lane is unsupported");
  if (!["PENDING", "RUNNING", "COMPLETED", "COMPLETED_WITH_GAPS", "FAILED"].includes(input.status)) {
    throw new TypeError("status is unsupported");
  }
  if (!Number.isSafeInteger(input.denominator) || input.denominator < 0) throw new TypeError("denominator must be non-negative");
  if (!Number.isSafeInteger(input.processed) || input.processed < 0 || input.processed > input.denominator) {
    throw new TypeError("processed must be within the coverage denominator");
  }
  return deepFreeze({
    lane: input.lane,
    status: input.status,
    producerId: input.producerId,
    producerVersion: input.producerVersion,
    denominator: input.denominator,
    processed: input.processed,
    gaps: structuredClone(input.gaps ?? []),
    diagnostics: structuredClone(input.diagnostics ?? []),
  });
}
