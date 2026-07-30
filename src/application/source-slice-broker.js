import { createSourceSlice, SourceSliceStatus } from "../domain/index.js";

const secretPattern = /(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?[^"'\s]+/gi;

export class SourceSliceBroker {
  constructor({ artifactResolver, auditSink = async () => {}, clock = () => new Date() }) {
    if (typeof artifactResolver !== "function") throw new TypeError("artifactResolver is required");
    this.artifactResolver = artifactResolver;
    this.auditSink = auditSink;
    this.clock = clock;
  }

  async read(request, authorization) {
    if (!authorization?.serviceIdentity || authorization.projectId !== request.projectId
      || authorization.analysisRunId !== request.analysisRunId
      || !authorization.workUnitArtifactIds?.includes(request.artifactId)) {
      const rejection = createSourceSlice(request, {
        status: SourceSliceStatus.REJECTED,
        diagnostics: [{ code: "SOURCE_SLICE_FORBIDDEN" }],
      }, this.clock);
      await this.auditSink(rejection);
      return rejection;
    }
    const artifact = await this.artifactResolver(request.projectId, request.snapshotManifestId, request.artifactId);
    if (!artifact || ["BINARY", "SECRET_REDACTED", "READ_FAILED"].includes(artifact.disposition)) {
      const rejection = createSourceSlice(request, {
        status: SourceSliceStatus.REJECTED,
        diagnostics: [{ code: artifact ? `ARTIFACT_${artifact.disposition}` : "ARTIFACT_NOT_FOUND" }],
      }, this.clock);
      await this.auditSink(rejection);
      return rejection;
    }
    const bytes = Buffer.from(artifact.content, "utf8");
    const requestedEnd = request.range.endByte ?? bytes.length;
    const cappedEnd = Math.min(requestedEnd, request.range.startByte + request.maxBytes, bytes.length);
    let content = bytes.subarray(request.range.startByte, cappedEnd).toString("utf8");
    const redactions = [];
    content = content.replace(secretPattern, (match) => {
      redactions.push("SECRET_PATTERN");
      return `[REDACTED:${match.split(/[:=]/, 1)[0].trim()}]`;
    });
    const truncated = cappedEnd < requestedEnd || cappedEnd < bytes.length;
    const slice = createSourceSlice(request, {
      status: redactions.length ? SourceSliceStatus.REDACTED : truncated ? SourceSliceStatus.TRUNCATED : SourceSliceStatus.COMPLETE,
      content,
      range: { startByte: request.range.startByte, endByte: cappedEnd },
      redactions,
      diagnostics: truncated ? [{ code: "SOURCE_SLICE_TRUNCATED" }] : [],
    }, this.clock);
    await this.auditSink(slice);
    return slice;
  }
}
