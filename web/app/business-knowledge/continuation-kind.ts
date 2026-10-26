import type { Investigation } from "./types.ts";
import { canonical } from "./work-journal.ts";
import { SourceSha256 } from "../source-truth/stream-hash.ts";
import { workId, sameList } from "./work-types.ts";

const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const versions = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 128 && v.every(hash);
const scope = (v: Investigation["scope"]) => !!v && Array.isArray(v.componentIds) && v.componentIds.length > 0 && v.componentIds.every(hash);
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);

// Integrity and cross-field consistency for the server DTO, NOT permission or
// publication authority. Every GET/write remains authorized by the server.
export function continuationKindValid(run: Investigation): boolean {
  try {
    const c = run.continuationBasis;
    if (!c || c.version !== 1 || c.purpose !== run.purpose || run.questionContext !== undefined
      || run.analysisContractVersion !== 12 || c.workspaceId !== run.workspaceId
      || c.actorId !== run.actorId || c.operationId !== run.operationId
      || !workId(run.id) || !workId(c.actorId) || !workId(c.operationId) || !hash(c.digest)) return false;
    const { digest, ...body } = c;
    if (new SourceSha256().update(new TextEncoder().encode(canonical(body))).hex() !== digest) return false;
    const { a, b, source } = c;
    if (!a || !b || !source || !workId(a.investigationId) || !hash(a.graphDigest)
      || source.investigationId !== a.investigationId || source.graphDigest !== a.graphDigest
      || !scope(a.scope) || !scope(b.scope) || !hash(a.inventoryDigest) || !hash(b.inventoryDigest)
      || !versions(a.adoptedVersionIds) || !versions(b.adoptedVersionIds)
      || !Array.isArray(a.technicalBinding) || !Array.isArray(b.technicalBinding)
      || typeof a.question !== "string" || !a.profile?.id || a.implementationVersion === undefined
      || !(a.analysisContractVersion === null || Number.isSafeInteger(a.analysisContractVersion))
      || !(a.dependencyReviewDigest === null || hash(a.dependencyReviewDigest))) return false;
    const from = a.sourceInput, to = b.sourceInput as typeof from;
    if (![from, to].every(s => s?.workspaceId === run.workspaceId && hash(s.sourceBundleSnapshotId)
      && workId(s.receiptId) && hash(s.inventoryDigest))) return false;
    if (!equal(b.sourceInput, run.sourceInput) || !equal(b.scope, run.scope) || !equal(b.profile, run.profile)
      || b.question !== run.question || !equal(b.budget, run.budget) || !equal(b.supplementBudget, run.supplementBudget)
      || !equal(b.implementationVersion, run.implementationVersion)
      || !versions(run.adoptedVersionIds) || !sameList(b.adoptedVersionIds, run.adoptedVersionIds.slice(0, b.adoptedVersionIds.length))) return false;
    // A later explicitly recorded C03 adoption may append versions. It does not
    // rewrite this immutable admitted basis or turn the run into another type.
    if (c.purpose === "PREPUBLICATION_INCREMENTAL_ANALYSIS")
      return source.kind === "PRIVATE_ANALYSIS" && a.graphRevisionId === null && source.graphRevisionId === undefined;
    return c.purpose === "PUBLISHED_WORK_CONTINUATION" && source.kind === "PUBLISHED_WORK_SESSION"
      && workId(a.graphRevisionId) && source.graphRevisionId === a.graphRevisionId && workId(source.sessionId)
      && Number.isSafeInteger(source.sessionVersion) && Number(source.sessionVersion) > 0 && hash(source.changeSetDigest);
  } catch { return false; }
}
