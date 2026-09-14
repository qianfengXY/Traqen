import type { FrozenVersion, RunDetail, SourceSummary } from "./types.ts";

type EmptyGitEvidence = Pick<FrozenVersion["components"][number], "kind" | "nativeIdentity" | "manifestId" | "fileCount" | "directoryCount" | "knownBytes">;

// Presentation of server-verified evidence only; this never grants admission.
export function isEmptyGitComponent(component: EmptyGitEvidence): boolean {
  return component.kind === "GIT" && Boolean(component.nativeIdentity?.commit && component.nativeIdentity.tree && component.manifestId)
    && component.fileCount === "0" && component.directoryCount === "0" && component.knownBytes === "0";
}

export function isConfirmedEmptyGitSource(source: SourceSummary, detail: Pick<RunDetail, "run" | "candidate">): boolean {
  return ["REVIEW_REQUIRED", "PREPARING_SEAL", "FINALIZING", "SUCCEEDED"].includes(detail.run.status)
    && source.enumerationClosed && source.summary.pendingCount === "0"
    && Boolean(detail.candidate?.components.some((component) => component.sourceId === source.sourceId && component.kind === "GIT"))
    && isEmptyGitComponent({ ...source, ...source.summary });
}
