import { contentId, deepFreeze } from "./canonical-json.js";
import { requireNonEmptyString } from "./model.js";

export const ArtifactDisposition = Object.freeze({
  INCLUDED: "INCLUDED",
  EXCLUDED_BY_POLICY: "EXCLUDED_BY_POLICY",
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
    const reasonCode = disposition === ArtifactDisposition.INCLUDED
      ? null
      : requireNonEmptyString(artifact.reasonCode ?? artifact.reason, `artifacts[${index}].reasonCode`);
    const relativePath = requireNonEmptyString(
      artifact.relativePath ?? artifact.path,
      `artifacts[${index}].relativePath`,
    ).replaceAll("\\", "/");
    if (relativePath.startsWith("/") || relativePath.split("/").includes("..")) {
      throw new TypeError(`artifacts[${index}].relativePath must stay within the Snapshot`);
    }
    const artifactKinds = artifact.artifactKinds ?? (artifact.kind ? [artifact.kind] : []);
    if (!Array.isArray(artifactKinds) || artifactKinds.length === 0
      || artifactKinds.some((kind) => typeof kind !== "string" || kind.length === 0)) {
      throw new TypeError(`artifacts[${index}].artifactKinds must contain at least one kind`);
    }
    const sizeBytes = artifact.sizeBytes ?? artifact.byteSize;
    return {
      id: requireNonEmptyString(artifact.id, `artifacts[${index}].id`),
      relativePath,
      artifactKinds: [...new Set(artifactKinds)].sort(),
      mediaType: requireNonEmptyString(artifact.mediaType ?? "application/octet-stream", `artifacts[${index}].mediaType`),
      language: artifact.language ?? null,
      sizeBytes: Number.isSafeInteger(sizeBytes) && sizeBytes >= 0
        ? sizeBytes
        : (() => { throw new TypeError(`artifacts[${index}].sizeBytes must be a non-negative integer`); })(),
      contentDigest: requireDigest(artifact.contentDigest, `artifacts[${index}].contentDigest`),
      disposition,
      reasonCode,
    };
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath) || left.id.localeCompare(right.id));
  if (new Set(artifacts.map(({ id }) => id)).size !== artifacts.length) {
    throw new TypeError("artifacts must have unique ids");
  }
  if (new Set(artifacts.map(({ relativePath }) => relativePath)).size !== artifacts.length) {
    throw new TypeError("artifacts must have unique relative paths");
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
