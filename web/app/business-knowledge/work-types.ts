import type { Citation, Investigation, Proposition } from "./types.ts";
export type WorkBinding = {
  graphRevisionId: string | null;
  graphDigest: string | null;
  sourceInput: Investigation["sourceInput"];
  adoptedVersionIds: string[];
};
export type WorkEvent = {
  id: string;
  sessionId: string;
  workspaceId: string;
  version: number;
  type: string;
  createdAt: string;
  questionId?: string;
  feedbackId?: string;
  newSessionId?: string;
  operationId?: string;
  actorId?: string;
  binding?: WorkBinding;
};
export type WorkSession = {
  id: string;
  workspaceId: string;
  actorId: string;
  operationId: string;
  title: string;
  createdAt: string;
  version: number;
  binding: WorkBinding;
  events?: WorkEvent[];
  eventsTruncated?: boolean;
  investigationId?: string;
  origin?: { sessionId: string; binding: WorkBinding; changeSetDigest: string };
};
export type WorkRecord = {
  id: string;
  workspaceId: string;
  sessionId: string;
  type: "KNOWLEDGE_QUESTION" | "KNOWLEDGE_FEEDBACK";
  operationId: string;
  question?: string;
  message?: string;
  createdAt: string;
  binding: WorkBinding;
};
export type SessionPage = {
  session: WorkSession;
  records: WorkRecord[];
  recordsTruncated: boolean;
  nextCursor: string | null;
};
export type SessionSummary = Pick<WorkSession,'id'|'title'|'actorId'|'createdAt'|'version'|'binding'|'origin'|'investigationId'> & {graphState:'EXPLICITLY_ADOPTED'|'AWAITING_EXPLICIT_GRAPH_ADOPTION'};
export type SessionIndex = {sessions:SessionSummary[];nextCursor:string|null};
export type OperationKind = 'CREATE_SESSION'|'QUESTION'|'FEEDBACK'|'CONTINUATION'|'ADOPT_GRAPH';
export type OperationLookup = {kind:OperationKind;originSessionId?:string|null;originGraphRevisionId?:string|null;expectedRequestDigest?:string;expectedResultId?:string;expectedBinding?:WorkBinding};
export type OperationResult = {operation:{id:string;kind:OperationKind;actorId:string;createdAt:string;requestDigest:string;origin:{sessionId:string|null;graphRevisionId:string|null};result:{sessionId:string;questionId?:string;feedbackId?:string;investigationId?:string;eventId?:string;graphRevisionId?:string}};session:WorkSession;question?:QuestionResult;feedback?:Feedback;run?:Investigation;event?:WorkEvent};
export type EventPage = {
  sessionId: string;
  events: WorkEvent[];
  currentVersion: number;
  nextAfterVersion: number | null;
};
export type QuestionBinding = WorkBinding & { sessionId: string; objectKeys: string[] };
export type QuestionRequest = {
  id: string;
  workspaceId: string;
  sessionId: string;
  operationId: string;
  requestDigest: string;
  question: string;
  binding: QuestionBinding;
  profileId: string;
  budget: Investigation["budget"];
  graphView?: Proposition[];
};
export type AnswerSegment = {
  key: string;
  localKey: string;
  text: string;
  stance: "SUPPORTED" | "UNKNOWN";
  graphRefs: string[];
  evidence: unknown[];
  technicalRefs: string[];
  uncertainties: string[];
  guardReasons: string[];
  origin: { taskKey: string; slotId: string };
  verification: unknown;
};
export type KnowledgeAnswer = {
  id: string;
  workspaceId: string;
  kind: "DERIVED_KNOWLEDGE_ANSWER";
  authority: "DERIVED_ANALYSIS_NOT_BUSINESS_AUTHORITY";
  investigationId: string;
  requestDigest: string;
  binding: QuestionBinding;
  sourceInput: Investigation["sourceInput"];
  profileId: string;
  segments: AnswerSegment[];
  unknowns: string[];
  readGaps: unknown[];
  conflicts: unknown[];
  unresolvedConflicts: unknown[];
  process: unknown[];
  usage: Investigation["usage"];
  createdAt: string;
  questionContractVersion?: number;
  premiseContext?: unknown;
};
export type QuestionResult = {
  request: QuestionRequest;
  run: Investigation & { purpose: "GRAPH_QUESTION"; questionContext: QuestionBinding };
  answer: KnowledgeAnswer | null;
};
export type QuestionInput = {
  operationId: string;
  expectedSessionVersion: number;
  expectedProfileId: string;
  question: string;
  objectKeys: string[] | null;
  budget: Investigation["budget"];
};
export type FeedbackInput = {
  operationId: string;
  expectedSessionVersion: number;
  graphDigest: string;
  objectKey: string | null;
  answerId: string | null;
  kind: "CORRECTION" | "REVIEW_REQUEST";
  message: string;
};
export type Feedback = {
  id: string;
  workspaceId: string;
  sessionId: string;
  operationId: string;
  binding: WorkBinding;
  objectKey: string | null;
  answerId: string | null;
  kind: FeedbackInput["kind"];
  message: string;
  status: "REVIEW_REQUESTED";
  authority: "NONE_USE_EXISTING_DECISION_WORKFLOW";
};
export type ContinuationInput = {
  reference: { bundleId: string; receiptId: string };
  scope: { componentIds: string[] };
  technicalVersionId: string | null;
};
export type ChangePreview = {
  from: WorkBinding;
  to: {
    reference: ContinuationInput["reference"];
    scope: ContinuationInput["scope"];
    adoptedVersionIds: string[];
  };
  deltas: unknown[];
  changedEntries: unknown[];
  adoptionChange: unknown;
  limitations: string[];
  changeSetDigest: string;
};
export type ContinueInput = ContinuationInput & {
  operationId: string;
  expectedSessionVersion: number;
  expectedChangeSetDigest: string;
  expectedProfileId: string;
  question: string;
  budget: Investigation["budget"];
  supplementBudget: Investigation["supplementBudget"];
};
export type AdoptGraphInput = {
  operationId: string;
  expectedSessionVersion: number;
  graphRevisionId: string;
  expectedGraphDigest: string;
  adoptedVersionIds: string[];
};

export const workId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
export const citationValid = (v: unknown): v is Citation =>
  !!v &&
  typeof v === "object" &&
  "materialId" in v &&
  typeof v.materialId === "string" &&
  "startLine" in v &&
  positive(v.startLine) &&
  "endLine" in v &&
  positive(v.endLine) &&
  v.endLine >= v.startLine &&
  "quote" in v &&
  typeof v.quote === "string";
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export const stringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");
export const sameList = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
export function bindingValid(b: WorkBinding) {
  return (
    !!b &&
    ((workId(b.graphRevisionId) && hash(b.graphDigest)) ||
      (b.graphRevisionId === null && b.graphDigest === null)) &&
    hash(b.sourceInput?.sourceBundleSnapshotId) &&
    workId(b.sourceInput?.receiptId) &&
    Array.isArray(b.adoptedVersionIds) &&
    b.adoptedVersionIds.length <= 128 &&
    b.adoptedVersionIds.every(hash)
  );
}
export function bindingEqual(a: WorkBinding, b: WorkBinding) {
  return (
    bindingValid(a) &&
    bindingValid(b) &&
    a.graphRevisionId === b.graphRevisionId &&
    a.graphDigest === b.graphDigest &&
    a.sourceInput.sourceBundleSnapshotId === b.sourceInput.sourceBundleSnapshotId &&
    a.sourceInput.receiptId === b.sourceInput.receiptId &&
    sameList(a.adoptedVersionIds, b.adoptedVersionIds)
  );
}
export function sessionValid(s: WorkSession, workspace: string, id?: string) {
  return (
    !!s &&
    workId(s.id) &&
    (!id || s.id === id) &&
    s.workspaceId === workspace &&
    positive(s.version) &&
    typeof s.title === "string" &&
    bindingValid(s.binding)
  );
}
export function questionValid(v: QuestionResult, workspace: string, session: string, id?: string) {
  const q = v?.request,
    r = v?.run,
    a = v?.answer,
    b = q?.binding;
  if (
    !q ||
    !r ||
    q.workspaceId !== workspace ||
    q.sessionId !== session ||
    !workId(q.id) ||
    (id && q.id !== id) ||
    r.id !== q.id ||
    r.workspaceId !== workspace ||
    !bindingValid(b) ||
    b.sessionId !== session ||
    !b.graphRevisionId ||
    !stringList(b.objectKeys) ||
    b.objectKeys.length > 512 ||
    r.purpose !== "GRAPH_QUESTION" ||
    !bindingEqual(r.questionContext, b) ||
    r.questionContext.sessionId !== session ||
    !sameList(r.questionContext.objectKeys, b.objectKeys) ||
    r.sourceInput?.sourceBundleSnapshotId !== b.sourceInput.sourceBundleSnapshotId ||
    r.sourceInput.receiptId !== b.sourceInput.receiptId ||
    !sameList(r.adoptedVersionIds, b.adoptedVersionIds) ||
    r.profile?.id !== q.profileId ||
    !positive(r.revision) ||
    !Number.isSafeInteger(r.generation) ||
    r.generation < 0 ||
    !["QUEUED", "RUNNING", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"].includes(r.state) ||
    !r.budget ||
    !r.usage
  )
    return false;
  if (a === null) return r.state !== "COMPLETED";
  return (
    !!a &&
    r.state === "COMPLETED" &&
    a.workspaceId === workspace &&
    a.kind === "DERIVED_KNOWLEDGE_ANSWER" &&
    a.authority === "DERIVED_ANALYSIS_NOT_BUSINESS_AUTHORITY" &&
    a.investigationId === q.id &&
    a.requestDigest === q.requestDigest &&
    a.profileId === q.profileId &&
    bindingEqual(a.binding, b) &&
    a.binding.sessionId === session &&
    sameList(a.binding.objectKeys, b.objectKeys) &&
    a.sourceInput?.sourceBundleSnapshotId === b.sourceInput.sourceBundleSnapshotId &&
    a.sourceInput.receiptId === b.sourceInput.receiptId &&
    Array.isArray(a.segments) &&
    a.segments.length <= 3840 &&
    a.segments.every(
      (s) =>
        s &&
        typeof s.text === "string" &&
        ["SUPPORTED", "UNKNOWN"].includes(s.stance) &&
        stringList(s.graphRefs) &&
        (s.stance === "UNKNOWN" || s.graphRefs.every((k) => b.objectKeys.includes(k))) &&
        stringList(s.technicalRefs) &&
        stringList(s.uncertainties) &&
        stringList(s.guardReasons) &&
        Array.isArray(s.evidence) &&
        (s.stance === "UNKNOWN" || s.evidence.every(citationValid)),
    ) &&
    stringList(a.unknowns) &&
    Array.isArray(a.readGaps) &&
    Array.isArray(a.conflicts) &&
    Array.isArray(a.process) &&
    Array.isArray(a.unresolvedConflicts)
  );
}
