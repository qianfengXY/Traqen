import { contentId, deepFreeze } from "./canonical-json.js";
import { requireNonEmptyString } from "./model.js";

export const ArtifactDisposition = Object.freeze({
  INCLUDED: "INCLUDED",
  EXCLUDED: "EXCLUDED",
  UNSUPPORTED: "UNSUPPORTED",
  GENERATED: "GENERATED",
  BINARY: "BINARY",
  OVERSIZED: "OVERSIZED",
  SECRET_REDACTED: "SECRET_REDACTED",
  READ_FAILED: "READ_FAILED",
});

const dispositions = new Set(Object.values(ArtifactDisposition));

function requireDigest(value, fieldName) {
  const digest = requireNonEmptyString(value, fieldName);
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new TypeError(`${fieldName} must be a SHA-256 digest`);
  return digest;
}

export function createArtifactInventory(input, clock = () => new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("artifact inventory input must be an object");
  }
  const artifacts = (input.artifacts ?? []).map((artifact, index) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      throw new TypeError(`artifacts[${index}] must be an object`);
    }
    const disposition = requireNonEmptyString(artifact.disposition, `artifacts[${index}].disposition`);
    if (!dispositions.has(disposition)) throw new TypeError(`artifacts[${index}].disposition is unsupported`);
    const reason = disposition === ArtifactDisposition.INCLUDED
      ? null
      : requireNonEmptyString(artifact.reason, `artifacts[${index}].reason`);
    const path = requireNonEmptyString(artifact.path, `artifacts[${index}].path`).replaceAll("\\", "/");
    if (path.startsWith("/") || path.split("/").includes("..")) {
      throw new TypeError(`artifacts[${index}].path must stay within the Snapshot`);
    }
    return {
      id: requireNonEmptyString(artifact.id, `artifacts[${index}].id`),
      path,
      kind: requireNonEmptyString(artifact.kind, `artifacts[${index}].kind`),
      language: artifact.language ?? null,
      byteSize: Number.isSafeInteger(artifact.byteSize) && artifact.byteSize >= 0
        ? artifact.byteSize
        : (() => { throw new TypeError(`artifacts[${index}].byteSize must be a non-negative integer`); })(),
      contentDigest: requireDigest(artifact.contentDigest, `artifacts[${index}].contentDigest`),
      disposition,
      reason,
    };
  }).sort((left, right) => left.path.localeCompare(right.path) || left.id.localeCompare(right.id));
  if (new Set(artifacts.map(({ id }) => id)).size !== artifacts.length) {
    throw new TypeError("artifacts must have unique ids");
  }
  if (new Set(artifacts.map(({ path }) => path)).size !== artifacts.length) {
    throw new TypeError("artifacts must have unique paths");
  }
  const identity = {
    projectId: requireNonEmptyString(input.projectId, "projectId"),
    snapshotManifestId: requireNonEmptyString(input.snapshotManifestId, "snapshotManifestId"),
    sourceDigest: requireDigest(input.sourceDigest, "sourceDigest"),
    scannerVersion: requireNonEmptyString(input.scannerVersion, "scannerVersion"),
    sealed: input.sealed === true,
    artifacts,
  };
  if (identity.sealed && artifacts.length === 0) throw new TypeError("sealed inventory must contain artifacts");
  return deepFreeze({
    id: contentId("ARTIFACT-INVENTORY", identity),
    ...identity,
    totalCount: artifacts.length,
    disposedCount: artifacts.length,
    dispositionCounts: Object.fromEntries(
      Object.values(ArtifactDisposition).map((value) => [
        value,
        artifacts.filter(({ disposition }) => disposition === value).length,
      ]),
    ),
    createdAt: clock().toISOString(),
  });
}
