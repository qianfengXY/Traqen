import { createHash } from "node:crypto";
import { canonicalJson, contentId, deepFreeze } from "./canonical-json.js";
import { requireNonEmptyString } from "./model.js";

export const SourceSliceStatus = Object.freeze({
  COMPLETE: "COMPLETE",
  TRUNCATED: "TRUNCATED",
  REDACTED: "REDACTED",
  REJECTED: "REJECTED",
});

function selector(input, index) {
  const startByte = input.startByte ?? input.range?.startByte ?? 0;
  const endByte = input.endByte ?? input.range?.endByte ?? null;
  if (!Number.isSafeInteger(startByte) || startByte < 0) {
    throw new TypeError(`selectors[${index}].startByte must be a non-negative integer`);
  }
  if (endByte !== null && (!Number.isSafeInteger(endByte) || endByte <= startByte)) {
    throw new TypeError(`selectors[${index}].endByte must be greater than startByte`);
  }
  return {
    artifactId: requireNonEmptyString(input.artifactId, `selectors[${index}].artifactId`),
    symbolId: input.symbolId ?? null,
    startByte,
    endByte,
  };
}

export function createSourceSliceRequest(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("source slice request must be an object");
  }
  for (const forbidden of ["path", "glob", "absolutePath"]) {
    if (Object.hasOwn(input, forbidden)) throw new TypeError(`source slice request cannot contain ${forbidden}`);
  }
  const selectorInputs = input.selectors ?? (input.artifactId
    ? [{ artifactId: input.artifactId, ...input.range }]
    : []);
  if (!Array.isArray(selectorInputs) || selectorInputs.length === 0) {
    throw new TypeError("selectors must contain at least one Artifact selector");
  }
  const selectors = selectorInputs.map(selector);
  if (new Set(selectors.map(({ artifactId, symbolId, startByte, endByte }) =>
    `${artifactId}\u0000${symbolId ?? ""}\u0000${startByte}\u0000${endByte ?? ""}`)).size !== selectors.length) {
    throw new TypeError("selectors must not contain duplicates");
  }
  const identity = {
    projectId: requireNonEmptyString(input.projectId, "projectId"),
    snapshotManifestId: requireNonEmptyString(input.snapshotManifestId, "snapshotManifestId"),
    analysisRunId: requireNonEmptyString(input.analysisRunId, "analysisRunId"),
    workUnitId: requireNonEmptyString(input.workUnitId, "workUnitId"),
    producerRef: requireNonEmptyString(input.producerRef ?? "SERVER_RUNTIME", "producerRef"),
    purpose: requireNonEmptyString(input.purpose ?? "RELATION_RESOLUTION", "purpose"),
    selectors,
    allowedFactIds: [...new Set(input.allowedFactIds ?? [])].sort(),
    maxBytes: Math.min(input.maxBytes ?? 65_536, 65_536),
    maxTokens: Math.min(input.maxTokens ?? 12_000, 12_000),
    policyId: requireNonEmptyString(input.policyId ?? input.policyDigest, "policyId"),
  };
  if (!Number.isSafeInteger(identity.maxBytes) || identity.maxBytes < 1) throw new TypeError("maxBytes must be positive");
  if (!Number.isSafeInteger(identity.maxTokens) || identity.maxTokens < 1) throw new TypeError("maxTokens must be positive");
  return deepFreeze({
    id: contentId("SOURCE-SLICE-REQUEST", identity),
    ...identity,
    requestedAt: clock().toISOString(),
  });
}

export function createSourceSlice(request, input, clock = () => new Date()) {
  const status = requireNonEmptyString(input.status, "status");
  if (!Object.values(SourceSliceStatus).includes(status)) throw new TypeError("status is unsupported");
  const artifactSlices = structuredClone(input.artifactSlices ?? []);
  const totalBytes = artifactSlices.reduce((sum, item) => sum + Buffer.byteLength(item.redactedText ?? ""), 0);
  if (totalBytes > request.maxBytes) throw new RangeError("SourceSlice exceeds request byte budget");
  const contentDigest = `sha256:${createHash("sha256").update(canonicalJson(artifactSlices)).digest("hex")}`;
  const identity = {
    requestId: request.id,
    status,
    artifactSlices: artifactSlices.map(({ artifactId, contentDigest: digest, range }) => ({
      artifactId,
      contentDigest: digest,
      range,
    })),
    contentDigest,
  };
  return deepFreeze({
    id: contentId("SOURCE-SLICE", identity),
    requestId: request.id,
    projectId: request.projectId,
    snapshotManifestId: request.snapshotManifestId,
    analysisRunId: request.analysisRunId,
    workUnitId: request.workUnitId,
    status,
    artifactSlices,
    factIds: structuredClone(input.factIds ?? []),
    redactions: structuredClone(input.redactions ?? []),
    contentDigest,
    truncated: input.truncated === true,
    omittedReasons: structuredClone(input.omittedReasons ?? []),
    diagnostics: structuredClone(input.diagnostics ?? []),
    policyDecisionId: input.policyDecisionId ?? contentId("SOURCE-SLICE-POLICY-DECISION", {
      requestId: request.id,
      policyId: request.policyId,
      status,
    }),
    responseDigest: `sha256:${createHash("sha256").update(canonicalJson(identity)).digest("hex")}`,
    createdAt: clock().toISOString(),
  });
}
