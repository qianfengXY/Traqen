import type {
  AdoptGraphInput,
  ChangePreview,
  ContinuationInput,
  ContinueInput,
  EventPage,
  Feedback,
  FeedbackInput,
  QuestionInput,
  QuestionResult,
  SessionPage,
  WorkBinding,
  WorkEvent,
  WorkSession,
  SessionIndex,
  OperationLookup,
  OperationResult,
} from "./work-types.ts";
import {
  bindingEqual,
  bindingValid,
  positive,
  questionValid,
  sameList,
  sessionValid,
  workId,
} from "./work-types.ts";
import type { Investigation } from "./types.ts";
export type WorkRequest = <T>(path: string, method?: string, input?: object) => Promise<T>;
const invalid = () =>
  Object.assign(new Error("响应与固定会话、问题或来源版本不符，未更新当前内容。"), {
    code: "F003_RESPONSE_INVALID",
    status: 0,
  });
const key = (s: string) => {
  if (!workId(s)) throw invalid();
  return encodeURIComponent(s);
};
const eventValid = (e: WorkEvent, ws: string, id: string) =>
  e &&
  e.workspaceId === ws &&
  e.sessionId === id &&
  positive(e.version) &&
  typeof e.type === "string";
export class WorkSessionClient {
  private workspace: string;
  private request: WorkRequest;
  constructor(workspace: string, request: WorkRequest) {
    this.workspace = workspace;
    this.request = request;
  }
  async listSessions({limit=50,cursor,graphRevisionId,originSessionId}:{limit?:number;cursor?:string;graphRevisionId?:string;originSessionId?:string}={}){
    if(!positive(limit)||limit>100||(cursor!==undefined&&(!/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)))
      ||(graphRevisionId!==undefined&&!workId(graphRevisionId))||(originSessionId!==undefined&&!workId(originSessionId)))throw invalid();
    const query=new URLSearchParams({limit:String(limit)});
    if(cursor)query.set('cursor',cursor);if(graphRevisionId)query.set('graphRevisionId',graphRevisionId);if(originSessionId)query.set('originSessionId',originSessionId);
    const v=await this.request<SessionIndex>(`work-sessions?${query}`);
    if(!Array.isArray(v.sessions)||v.sessions.length>limit||new Set(v.sessions.map(s=>s?.id)).size!==v.sessions.length
      ||v.sessions.some(s=>!s||!workId(s.id)||typeof s.title!=='string'||!positive(s.version)||!bindingValid(s.binding)
        ||(graphRevisionId!==undefined&&s.binding.graphRevisionId!==graphRevisionId)||(originSessionId!==undefined&&s.origin?.sessionId!==originSessionId)
        ||s.graphState!==(s.binding.graphRevisionId?'EXPLICITLY_ADOPTED':'AWAITING_EXPLICIT_GRAPH_ADOPTION'))
      ||(v.nextCursor!==null&&(typeof v.nextCursor!=='string'||!/^[A-Za-z0-9_-]{1,2048}$/.test(v.nextCursor)||v.nextCursor===cursor||!v.sessions.length)))throw invalid();
    return v;
  }
  async operation(operationId:string,expected:OperationLookup){
    if(!workId(operationId)||!['CREATE_SESSION','QUESTION','FEEDBACK','CONTINUATION','ADOPT_GRAPH'].includes(expected.kind)
      ||[expected.originSessionId,expected.originGraphRevisionId,expected.expectedResultId].some(v=>v!==undefined&&v!==null&&!workId(v))
      ||(expected.expectedRequestDigest!==undefined&&!/^[a-f0-9]{64}$/.test(expected.expectedRequestDigest))
      ||(expected.kind==='ADOPT_GRAPH'&&!expected.originSessionId))throw invalid();
    const q=new URLSearchParams({kind:expected.kind});
    if(expected.originSessionId)q.set('originSessionId',expected.originSessionId);
    if(expected.originGraphRevisionId)q.set('originGraphRevisionId',expected.originGraphRevisionId);
    if(expected.expectedRequestDigest)q.set('expectedRequestDigest',expected.expectedRequestDigest);
    const v=await this.request<OperationResult>(`work-operations/${key(operationId)}?${q}`),o=v.operation,s=v.session;
    if(!o||o.id!==operationId||o.kind!==expected.kind||typeof o.actorId!=='string'||!o.actorId||!/^[a-f0-9]{64}$/.test(o.requestDigest)
      ||!o.origin||!o.result||!sessionValid(s,this.workspace,o.result.sessionId)
      ||(o.origin.sessionId!==null&&!workId(o.origin.sessionId))||(o.origin.graphRevisionId!==null&&!workId(o.origin.graphRevisionId))
      ||(Object.hasOwn(expected,'originSessionId')&&o.origin.sessionId!==expected.originSessionId)
      ||(Object.hasOwn(expected,'originGraphRevisionId')&&o.origin.graphRevisionId!==expected.originGraphRevisionId)
      ||(expected.expectedRequestDigest!==undefined&&o.requestDigest!==expected.expectedRequestDigest))throw invalid();
    const resultId=o.kind==='QUESTION'?o.result.questionId:o.kind==='FEEDBACK'?o.result.feedbackId:o.kind==='ADOPT_GRAPH'?o.result.eventId:s.id;
    if(!workId(resultId)||(expected.expectedResultId!==undefined&&resultId!==expected.expectedResultId))throw invalid();
    if(o.kind==='CREATE_SESSION'){
      if(o.origin.sessionId!==null||!o.origin.graphRevisionId||s.origin||s.operationId!==o.id||s.actorId!==o.actorId)throw invalid();
    }else if(o.kind==='CONTINUATION'){
      if(!o.origin.sessionId||s.id===o.origin.sessionId||s.operationId!==o.id||s.actorId!==o.actorId||s.origin?.sessionId!==o.origin.sessionId
        ||s.origin.binding.graphRevisionId!==o.origin.graphRevisionId||!bindingValid(s.origin.binding)||!/^[a-f0-9]{64}$/.test(s.origin.changeSetDigest)
        ||(expected.expectedBinding&&!bindingEqual(s.origin.binding,expected.expectedBinding))||!v.run||v.run.workspaceId!==this.workspace||v.run.id!==s.investigationId
        ||v.run.id!==o.result.investigationId||!bindingValid({graphRevisionId:null,graphDigest:null,sourceInput:v.run.sourceInput,adoptedVersionIds:v.run.adoptedVersionIds})
        ||v.run.sourceInput.sourceBundleSnapshotId!==s.binding.sourceInput.sourceBundleSnapshotId||v.run.sourceInput.receiptId!==s.binding.sourceInput.receiptId)throw invalid();
    }else{
      if(o.origin.sessionId!==s.id)throw invalid();
      if(o.kind==='QUESTION'){
        const value=v.question;
        if(!value||!questionValid(value,this.workspace,s.id,o.result.questionId)||value.request.operationId!==o.id||value.request.requestDigest!==o.requestDigest
          ||value.request.binding.graphRevisionId!==o.origin.graphRevisionId||(expected.expectedBinding&&!bindingEqual(value.request.binding,expected.expectedBinding)))throw invalid();
      }else if(o.kind==='FEEDBACK'){
        const f=v.feedback;
        if(!f||f.id!==o.result.feedbackId||f.workspaceId!==this.workspace||f.sessionId!==s.id||f.operationId!==o.id||f.binding.graphRevisionId!==o.origin.graphRevisionId
          ||f.status!=='REVIEW_REQUESTED'||f.authority!=='NONE_USE_EXISTING_DECISION_WORKFLOW'||(expected.expectedBinding&&!bindingEqual(f.binding,expected.expectedBinding)))throw invalid();
      }else{
        const e=v.event;
        if(!e||!eventValid(e,this.workspace,s.id)||e.id!==o.result.eventId||e.operationId!==o.id||e.actorId!==o.actorId||e.type!=='GRAPH_EXPLICITLY_ADOPTED'
          ||!e.binding||!bindingValid(e.binding)||e.binding.graphRevisionId!==o.result.graphRevisionId)throw invalid();
      }
    }
    return v;
  }
  async create(
    revision: string,
    input: { operationId: string; expectedGraphDigest: string; title: string },
  ) {
    const v = await this.request<{ session: WorkSession; replayed: boolean }>(
      `versions/${key(revision)}/work-sessions`,
      "POST",
      input,
    );
    if (
      !sessionValid(v.session, this.workspace) ||
      v.session.operationId !== input.operationId ||
      v.session.binding.graphRevisionId !== revision ||
      v.session.binding.graphDigest !== input.expectedGraphDigest ||
      typeof v.replayed !== "boolean"
    )
      throw invalid();
    return v;
  }
  async session(id: string, cursor?: string) {
    const query = new URLSearchParams({ limit: "50" });
    if (cursor) query.set("cursor", cursor);
    const v = await this.request<SessionPage>(`work-sessions/${key(id)}?${query}`);
    if (
      !sessionValid(v.session, this.workspace, id) ||
      !Array.isArray(v.records) ||
      v.records.length > 50 ||
      v.records.some(
        (r) =>
          !r ||
          r.workspaceId !== this.workspace ||
          r.sessionId !== id ||
          !["KNOWLEDGE_QUESTION", "KNOWLEDGE_FEEDBACK"].includes(r.type),
      ) ||
      typeof v.recordsTruncated !== "boolean" ||
      (v.recordsTruncated
        ? typeof v.nextCursor !== "string" || !v.nextCursor
        : v.nextCursor !== null)
    )
      throw invalid();
    return v;
  }
  async recoverContinuation(original: WorkSession, operationId: string, resultId?: string) {
    if (!sessionValid(original, this.workspace) || !workId(operationId)) throw invalid();
    const validate = (found: WorkSession) => {
      if (
        !sessionValid(found, this.workspace) ||
        found.id === original.id ||
        found.operationId !== operationId ||
        found.origin?.sessionId !== original.id ||
        !bindingEqual(found.origin.binding, original.binding) ||
        !/^[a-f0-9]{64}$/.test(found.origin.changeSetDigest ?? "") ||
        !workId(found.investigationId)
      )
        throw invalid();
      return found;
    };
    if (resultId) return validate((await this.session(resultId)).session);
    let after = 0;
    const seen = new Set<number>();
    do {
      const page = await this.events(original.id, after);
      for (const event of page.events) {
        if (!event.newSessionId) continue;
        const found = (await this.session(event.newSessionId)).session;
        if (found.operationId === operationId) return validate(found);
      }
      if (page.nextAfterVersion === null) break;
      if (seen.has(page.nextAfterVersion)) throw invalid();
      seen.add(page.nextAfterVersion);
      after = page.nextAfterVersion;
    } while (true);
    throw Error("尚未找到原接续受理，保留坐标，不重复创建。");
  }
  async events(id: string, afterVersion = 0) {
    if (!Number.isSafeInteger(afterVersion) || afterVersion < 0) throw invalid();
    const v = await this.request<EventPage>(
      `work-sessions/${key(id)}/events?${new URLSearchParams({ afterVersion: String(afterVersion), limit: "50" })}`,
    );
    if (
      v.sessionId !== id ||
      !positive(v.currentVersion) ||
      !Array.isArray(v.events) ||
      v.events.length > 50 ||
      v.events.some(
        (e, i) =>
          !eventValid(e, this.workspace, id) ||
          e.version <= (v.events[i - 1]?.version ?? afterVersion) ||
          e.version > v.currentVersion,
      ) ||
      (v.nextAfterVersion !== null &&
        (!positive(v.nextAfterVersion) ||
          v.nextAfterVersion !== v.events.at(-1)?.version ||
          v.nextAfterVersion <= afterVersion))
    )
      throw invalid();
    return v;
  }
  async question(sid: string, qid: string) {
    const v = await this.request<QuestionResult>(`work-sessions/${key(sid)}/questions/${key(qid)}`);
    if (!questionValid(v, this.workspace, sid, qid)) throw invalid();
    return v;
  }
  async ask(sid: string, input: QuestionInput, expectedBinding?: WorkBinding) {
    const v = await this.request<QuestionResult & { replayed: boolean }>(
      `work-sessions/${key(sid)}/questions`,
      "POST",
      input,
    );
    if (
      !questionValid(v, this.workspace, sid) ||
      v.request.operationId !== input.operationId ||
      v.request.question !== input.question.trim() ||
      v.request.profileId !== input.expectedProfileId ||
      (expectedBinding && !bindingEqual(v.request.binding, expectedBinding)) ||
      (input.objectKeys !== null && !sameList(v.request.binding.objectKeys, input.objectKeys)) ||
      typeof v.replayed !== "boolean"
    )
      throw invalid();
    return v;
  }
  async control(
    sid: string,
    qid: string,
    action: "pause" | "resume" | "cancel",
    expectedRevision: number,
  ) {
    const v = await this.request<{
      run: Investigation & { purpose: string; questionContext: { sessionId: string } };
    }>(`work-sessions/${key(sid)}/questions/${key(qid)}/${action}`, "POST", { expectedRevision });
    if (
      v.run?.workspaceId !== this.workspace ||
      v.run.id !== qid ||
      v.run.purpose !== "GRAPH_QUESTION" ||
      v.run.questionContext?.sessionId !== sid ||
      !positive(v.run.revision)
    )
      throw invalid();
    return v;
  }
  async feedback(sid: string, input: FeedbackInput) {
    const v = await this.request<{ feedback: Feedback; replayed: boolean }>(
        `work-sessions/${key(sid)}/feedback`,
        "POST",
        input,
      ),
      f = v.feedback;
    if (
      !f ||
      f.workspaceId !== this.workspace ||
      f.sessionId !== sid ||
      f.operationId !== input.operationId ||
      f.binding?.graphDigest !== input.graphDigest ||
      f.objectKey !== input.objectKey ||
      f.answerId !== input.answerId ||
      f.kind !== input.kind ||
      f.message !== input.message.trim() ||
      f.status !== "REVIEW_REQUESTED" ||
      f.authority !== "NONE_USE_EXISTING_DECISION_WORKFLOW" ||
      typeof v.replayed !== "boolean"
    )
      throw invalid();
    return v;
  }
  async preview(sid: string, input: ContinuationInput) {
    const v = await this.request<ChangePreview>(
      `work-sessions/${key(sid)}/continuation-preview`,
      "POST",
      input,
    );
    if (
      !bindingValid(v.from) ||
      v.to?.reference.bundleId !== input.reference.bundleId ||
      v.to.reference.receiptId !== input.reference.receiptId ||
      !sameList(v.to.scope?.componentIds, [...input.scope.componentIds].sort()) ||
      !sameList(
        v.to.adoptedVersionIds,
        input.technicalVersionId ? [input.technicalVersionId] : [],
      ) ||
      !Array.isArray(v.changedEntries) ||
      v.changedEntries.length > 10000 ||
      !Array.isArray(v.deltas) ||
      !Array.isArray(v.limitations) ||
      !/^[a-f0-9]{64}$/.test(v.changeSetDigest)
    )
      throw invalid();
    return v;
  }
  async continue(sid: string, input: ContinueInput) {
    const v = await this.request<{ session: WorkSession; run: Investigation; replayed: boolean }>(
        `work-sessions/${key(sid)}/continue`,
        "POST",
        input,
      ),
      s = v.session;
    if (
      !sessionValid(s, this.workspace) ||
      s.operationId !== input.operationId ||
      s.id === sid ||
      s.origin?.sessionId !== sid ||
      s.origin.changeSetDigest !== input.expectedChangeSetDigest ||
      s.binding.graphRevisionId !== null ||
      s.investigationId !== v.run?.id ||
      v.run.workspaceId !== this.workspace ||
      s.binding.sourceInput.sourceBundleSnapshotId !== input.reference.bundleId ||
      s.binding.sourceInput.receiptId !== input.reference.receiptId ||
      !sameList(
        s.binding.adoptedVersionIds,
        input.technicalVersionId ? [input.technicalVersionId] : [],
      ) ||
      typeof v.replayed !== "boolean"
    )
      throw invalid();
    return v;
  }
  async adopt(sid: string, input: AdoptGraphInput) {
    const v = await this.request<{ event: WorkEvent; replayed: boolean }>(
        `work-sessions/${key(sid)}/adopt-graph`,
        "POST",
        input,
      ),
      e = v.event;
    if (
      !eventValid(e, this.workspace, sid) ||
      e.operationId !== input.operationId ||
      e.type !== "GRAPH_EXPLICITLY_ADOPTED" ||
      e.version !== input.expectedSessionVersion + 1 ||
      !e.binding ||
      !bindingValid(e.binding) ||
      e.binding.graphRevisionId !== input.graphRevisionId ||
      e.binding.graphDigest !== input.expectedGraphDigest ||
      !sameList(e.binding.adoptedVersionIds, input.adoptedVersionIds) ||
      typeof v.replayed !== "boolean"
    )
      throw invalid();
    return v;
  }
}
