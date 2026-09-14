import type { DirectoryEntry, SelectionPolicy } from "./directory.ts";

export type SourceInput = { sourceId: string; kind: "GIT" | "DIRECTORY_UPLOAD"; mode: "UPDATE" | "REUSE"; label: string; componentId?: string | null; url?: string; ref?: string; credentialRef?: string | null; root?: string | null; scope?: { kind: string; root?: string | null } };
export type DraftInput = { sources: SourceInput[]; baselineBundleId: string | null };
export type Counts = { fileCount: string; directoryCount: string; knownBytes: string; gapCount?: string; pendingCount?: string };
export type Candidate = Counts & { id: string; inventoryId: string; gapSetId: string; policyRevisionId: string; components: { id: string; sourceId: string; kind: string }[] };
export type SourceRun = { id: string; workspaceId: string; actorId: string; status: string; station: number; abandoned?: boolean; input: DraftInput; draftRevision: number; progress: { entries?: string; knownBytes?: string; pendingCount?: string; waitingFor?: string; candidate?: Candidate }; diagnostic: { code: string; message: string; recovery: string } | null; createdAt: string; updatedAt: string };
export type Receipt = { id: string; bundleId: string; status: "READY" | "READY_WITH_ACCEPTED_GAPS"; gapCount: string; gapSetId: string; acceptedBy: string; expiresAt: string | null; issuedAt?: string };
export type Confirmation = { id: string; actorId: string; candidateId: string; gapSetId: string; reason: string | null; expiresAt: string | null; confirmedAt: string; currentlyValid?: boolean };
export type SourceSummary = { sourceId: string; kind: string; mode: string; scope: SourceInput["scope"]; nativeIdentity: { commit?: string; tree?: string; objectFormat?: string } | null; manifestId: string | null; enumerationClosed: boolean; summary: Counts };
export type RunDetail = { run: SourceRun; sources: SourceSummary[]; candidate: Candidate | null; confirmation: Confirmation | null; operation: { id: string; status: string } | null; result: { bundle: Candidate; receipt: Receipt } | null };
export type FrozenVersion = { id: string; publishedAt: string; counts: Counts; identity: { inventoryId: string; gapSetId: string }; components: (Counts & { id: string; sourceId: string; kind: string; scope: SourceInput["scope"]; nativeIdentity: SourceSummary["nativeIdentity"]; manifestId: string | null; sourceUrl?: string | null })[]; latestReceipt: Receipt | null; currentAdmission: "NOT_CHECKED" };
export type SourceOverview = { actor: { actorId: string; tenantId: string }; role: "READ" | "MAINTAIN"; draft: { revision: number; input: DraftInput } | null; activeRun: SourceRun | null; storage: { ready: boolean; code?: string; availableBytes?: string }; backup: { status: string }; policy: SelectionPolicy & { id: string; gitEnabled: boolean; maxChunkBytes: number } };
export type Page<T> = { items: T[]; nextCursor: string | null };
export type ArtifactRow = { entry: DirectoryEntry & { kind: string; gitMode: string | null }; disposition: { disposition: string; reasonCode: string; digest: string | null } | null; componentId?: string };
export type Gap = { gapKey: string; componentId: string; sourceId: string; pathBytes: string; ruleCode: string; severity: string; affectedScope: string };
export type GapPage = Page<Gap> & { total: string; gapSetId: string };
