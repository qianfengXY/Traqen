import { createHash } from "node:crypto";
import { canonicalJson, contentId, deepFreeze } from "./canonical-json.js";
import { requireNonEmptyString } from "./model.js";

export const SourceSliceStatus = Object.freeze({
  COMPLETE: "COMPLETE",
  TRUNCATED: "TRUNCATED",
  REDACTED: "REDACTED",
  REJECTED: "REJECTED",
});

export function createSourceSliceRequest(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("source slice request must be an object");
  for (const forbidden of ["path", "glob", "absolutePath"]) {
    if (Object.hasOwn(input, forbidden)) throw new TypeError(`source slice request cannot contain ${forbidden}`);
  }
  const range = input.range ?? {};
  const startByte = range.startByte ?? 0;
  const endByte = range.endByte ?? null;
  if (!Number.isSafeInteger(startByte) || startByte < 0) throw new TypeError("range.startByte must be a non-negative integer");
  if (endByte !== null && (!Number.isSafeInteger(endByte) || endByte <= startByte)) {
    throw new TypeError("range.endByte must be greater than range.startByte");
  }
  const identity = {
    projectId: requireNonEmptyString(input.projectId, "projectId"),
    snapshotManifestId: requireNonEmptyString(input.snapshotManifestId, "snapshotManifestId"),
    analysisRunId: requireNonEmptyString(input.analysisRunId, "analysisRunId"),
    workUnitId: requireNonEmptyString(input.workUnitId, "workUnitId"),
    artifactId: requireNonEmptyString(input.artifactId, "artifactId"),
    range: { startByte, endByte },
    maxBytes: Math.min(input.maxBytes ?? 65_536, 65_536),
    maxTokens: Math.min(input.maxTokens ?? 12_000, 12_000),
    policyDigest: requireNonEmptyString(input.policyDigest, "policyDigest"),
  };
  if (!Number.isSafeInteger(identity.maxBytes) || identity.maxBytes < 1) throw new TypeError("maxBytes must be a positive integer");
  if (!Number.isSafeInteger(identity.maxTokens) || identity.maxTokens < 1) throw new TypeError("maxTokens must be a positive integer");
  return deepFreeze({ id: contentId("SOURCE-SLICE-REQUEST", identity), ...identity, requestedAt: clock().toISOString() });
}

export function createSourceSlice(request, input, clock = () => new Date()) {
  const status = requireNonEmptyString(input.status, "status");
  if (!Object.values(SourceSliceStatus).includes(status)) throw new TypeError("status is unsupported");
  const content = input.content ?? "";
  if (typeof content !== "string") throw new TypeError("content must be a string");
  const byteLength = Buffer.byteLength(content);
  if (byteLength > request.maxBytes) throw new RangeError("content exceeds request byte budget");
  const contentDigest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  const identity = { requestId: request.id, artifactId: request.artifactId, status, contentDigest, byteLength };
  return deepFreeze({
    id: contentId("SOURCE-SLICE", identity),
    ...identity,
    projectId: request.projectId,
    snapshotManifestId: request.snapshotManifestId,
    analysisRunId: request.analysisRunId,
    workUnitId: request.workUnitId,
    content,
    range: structuredClone(input.range ?? request.range),
    redactions: [...new Set(input.redactions ?? [])].sort(),
    diagnostics: structuredClone(input.diagnostics ?? []),
    responseDigest: `sha256:${createHash("sha256").update(canonicalJson(identity)).digest("hex")}`,
    producedAt: clock().toISOString(),
  });
}
