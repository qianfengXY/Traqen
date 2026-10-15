import { SourceSliceStatus, createSourceSlice } from "../domain/index.js";

const secretPattern = /(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?[^"'\s]+/gi;

// These buffers are encoded from UTF-8 text. Round both boundaries inward:
// partial characters must neither manufacture U+FFFD nor read outside a selector.
function completeUtf8Window(bytes, start, end) {
  while (start < end && (bytes[start] & 0xc0) === 0x80) start += 1;
  while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(start, end);
}

export class SourceSliceBroker {
  constructor({ artifactResolver, auditSink = async () => {}, clock = () => new Date() }) {
    if (typeof artifactResolver !== "function") throw new TypeError("artifactResolver is required");
    this.artifactResolver = artifactResolver;
    this.auditSink = auditSink;
    this.clock = clock;
  }

  async #reject(request, code) {
    const rejection = createSourceSlice(request, {
      status: SourceSliceStatus.REJECTED,
      artifactSlices: [],
      diagnostics: [{ code }],
      omittedReasons: [code],
    }, this.clock);
    await this.auditSink(rejection);
    return rejection;
  }

  async read(request, authorization) {
    const allowedArtifacts = new Set(authorization?.workUnitArtifactIds ?? []);
    const allowedFacts = new Set(authorization?.workUnitFactIds ?? []);
    if (!authorization?.serviceIdentity || authorization.projectId !== request.projectId
      || authorization.analysisRunId !== request.analysisRunId
      || request.selectors.some(({ artifactId }) => !allowedArtifacts.has(artifactId))) {
      return this.#reject(request, "SOURCE_SLICE_SCOPE_VIOLATION");
    }
    if (request.allowedFactIds.some((factId) => !allowedFacts.has(factId))) {
      return this.#reject(request, "FACT_NOT_IN_WORK_UNIT");
    }

    let remainingBytes = request.maxBytes;
    const artifactSlices = [];
    const redactions = [];
    const omittedReasons = [];
    let truncated = false;
    for (const selector of request.selectors) {
      const artifact = await this.artifactResolver(
        request.projectId,
        request.snapshotManifestId,
        selector.artifactId,
      );
      if (!artifact) {
        omittedReasons.push("ARTIFACT_NOT_IN_SNAPSHOT");
        continue;
      }
      if (["BINARY", "SECRET_REDACTED", "READ_FAILED"].includes(artifact.disposition)) {
        omittedReasons.push(`ARTIFACT_${artifact.disposition}`);
        continue;
      }
      const bytes = Buffer.from(artifact.content, "utf8");
      const requestedEnd = selector.endByte ?? bytes.length;
      const cappedEnd = Math.min(requestedEnd, selector.startByte + remainingBytes, bytes.length);
      if (cappedEnd <= selector.startByte || remainingBytes <= 0) {
        truncated = true;
        omittedReasons.push("SOURCE_SLICE_BUDGET_EXCEEDED");
        continue;
      }
      const textBytes = completeUtf8Window(bytes, selector.startByte, cappedEnd);
      if (textBytes.length < cappedEnd - selector.startByte) truncated = true;
      let redactedText = textBytes.toString("utf8");
      redactedText = redactedText.replace(secretPattern, (match) => {
        redactions.push({
          kind: "SECRET_PATTERN",
          artifactId: selector.artifactId,
          range: { startByte: selector.startByte, endByte: cappedEnd },
        });
        return `[REDACTED:${match.split(/[:=]/, 1)[0].trim()}]`;
      });
      const redactedBytes = Buffer.from(redactedText);
      if (redactedBytes.length > remainingBytes) {
        redactedText = completeUtf8Window(redactedBytes, 0, remainingBytes).toString("utf8");
        truncated = true;
      }
      remainingBytes -= Buffer.byteLength(redactedText);
      if (cappedEnd < requestedEnd || cappedEnd < bytes.length) truncated = true;
      artifactSlices.push({
        artifactId: selector.artifactId,
        relativePath: artifact.relativePath,
        contentDigest: artifact.contentDigest,
        range: { startByte: selector.startByte, endByte: cappedEnd },
        redactedText,
      });
    }
    if (artifactSlices.length === 0) {
      return this.#reject(request, omittedReasons[0] ?? "ARTIFACT_NOT_IN_SNAPSHOT");
    }
    const status = redactions.length > 0
      ? SourceSliceStatus.REDACTED
      : truncated ? SourceSliceStatus.TRUNCATED : SourceSliceStatus.COMPLETE;
    const slice = createSourceSlice(request, {
      status,
      artifactSlices,
      factIds: request.allowedFactIds,
      redactions,
      truncated,
      omittedReasons,
      diagnostics: truncated ? [{ code: "SOURCE_SLICE_TRUNCATED" }] : [],
    }, this.clock);
    await this.auditSink(slice);
    return slice;
  }
}
