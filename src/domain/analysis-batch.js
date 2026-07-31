import { canonicalJson, contentId, deepFreeze } from "./canonical-json.js";
import { requireNonEmptyString } from "./model.js";

export function createAnalysisBatch(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("AnalysisBatch must be an object");
  const workspaceId = requireNonEmptyString(input.workspaceId, "workspaceId");
  const analysisRunId = requireNonEmptyString(input.analysisRunId, "analysisRunId");
  const sourceScope = structuredClone(input.sourceScope ?? {});
  const taskStatement = requireNonEmptyString(input.taskStatement, "taskStatement");
  const outputSchema = structuredClone(input.outputSchema ?? {});
  const sourcePolicy = structuredClone(input.sourcePolicy ?? {});
  const inputDigest = contentId("ANALYSIS-BATCH-INPUT", { sourceScope, taskStatement, outputSchema, sourcePolicy });
  const sequence = Number(input.sequence);
  if (!Number.isInteger(sequence) || sequence < 1) throw new TypeError("sequence must be a positive integer");
  return deepFreeze({
    id: contentId("ANALYSIS-BATCH", { workspaceId, analysisRunId, sequence, inputDigest }),
    workspaceId,
    snapshotManifestId: requireNonEmptyString(input.snapshotManifestId, "snapshotManifestId"),
    analysisRunId,
    profileRevisionId: requireNonEmptyString(input.profileRevisionId, "profileRevisionId"),
    sequence,
    inputDigest,
    sourceScope,
    taskStatement,
    outputSchema,
    sourcePolicy,
    createdAt: clock().toISOString(),
  });
}

export function fanOutAnalysisBatch(batch, profile, clock = () => new Date()) {
  if (batch.workspaceId !== profile.workspaceId) throw new TypeError("AnalysisBatch and execution profile scopes do not match");
  return deepFreeze(profile.childSlots.map((slot) => ({
    id: contentId("CHILD-WORK-UNIT", { batchId: batch.id, slotId: slot.id, inputDigest: batch.inputDigest }),
    workspaceId: batch.workspaceId,
    analysisRunId: batch.analysisRunId,
    analysisBatchId: batch.id,
    slotId: slot.id,
    inputDigest: batch.inputDigest,
    sourceScope: structuredClone(batch.sourceScope),
    taskStatement: batch.taskStatement,
    outputSchema: structuredClone(batch.outputSchema),
    sourcePolicy: structuredClone(batch.sourcePolicy),
    route: {
      model: slot.model,
      skillNames: [...slot.skillNames],
      mcpNames: [...slot.mcpNames],
      independenceGroup: slot.independenceGroup,
    },
    status: "PENDING",
    createdAt: clock().toISOString(),
  })));
}

export function commitChildBatchResult(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Child result must be an object");
  const result = {
    workspaceId: requireNonEmptyString(input.workspaceId, "workspaceId"),
    analysisRunId: requireNonEmptyString(input.analysisRunId, "analysisRunId"),
    analysisBatchId: requireNonEmptyString(input.analysisBatchId, "analysisBatchId"),
    childWorkUnitId: requireNonEmptyString(input.childWorkUnitId, "childWorkUnitId"),
    slotId: requireNonEmptyString(input.slotId, "slotId"),
    inputDigest: requireNonEmptyString(input.inputDigest, "inputDigest"),
    independenceGroup: requireNonEmptyString(input.independenceGroup, "independenceGroup"),
    status: requireNonEmptyString(input.status, "status").toUpperCase(),
    output: structuredClone(input.output ?? null),
    evidenceFactIds: [...new Set(input.evidenceFactIds ?? [])].sort(),
    sourceSliceIds: [...new Set(input.sourceSliceIds ?? [])].sort(),
  };
  if (!["COMPLETED", "FAILED", "GAP"].includes(result.status)) throw new TypeError("Child result status must be terminal");
  return deepFreeze({
    id: contentId("CHILD-BATCH-RESULT", {
      analysisBatchId: result.analysisBatchId,
      slotId: result.slotId,
      inputDigest: result.inputDigest,
    }),
    ...result,
    outputDigest: contentId("CHILD-OUTPUT", result.output),
    completedAt: clock().toISOString(),
  });
}

export function openAnalysisBatchBarrier(batch, assignments, results) {
  const expected = new Map(assignments.map((assignment) => [assignment.slotId, assignment]));
  if (expected.size < 1) throw new TypeError("AnalysisBatch requires at least one Child assignment");
  const terminal = new Map();
  for (const result of results) {
    const assignment = expected.get(result.slotId);
    if (!assignment) throw new TypeError(`unexpected Child result for slot ${result.slotId}`);
    if (result.analysisBatchId !== batch.id || result.inputDigest !== batch.inputDigest) {
      throw new TypeError("Child result does not match the sealed AnalysisBatch input");
    }
    const existing = terminal.get(result.slotId);
    if (existing && canonicalJson(existing) !== canonicalJson(result)) throw new TypeError("conflicting duplicate Child result");
    terminal.set(result.slotId, result);
  }
  if (terminal.size !== expected.size) throw new TypeError("Main Agent cannot reconcile before every required Child slot is terminal");
  return deepFreeze({
    analysisBatchId: batch.id,
    inputDigest: batch.inputDigest,
    resultIds: [...terminal.values()].sort((a, b) => a.slotId.localeCompare(b.slotId)).map(({ id }) => id),
    independenceGroups: [...new Set([...terminal.values()].map(({ independenceGroup }) => independenceGroup))].sort(),
    opened: true,
  });
}
