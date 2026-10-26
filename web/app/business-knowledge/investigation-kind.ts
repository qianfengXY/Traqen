import type { Investigation } from "./types.ts";
import type { WorkPosition } from "./work-route.ts";
import { bindingValid, sameList, stringList, workId } from "./work-types.ts";
import { investigationState } from "./model.ts";
import { continuationKindValid } from "./continuation-kind.ts";

const questionStates: Record<string, string> = {
  QUEUED: "问答等待执行",
  RUNNING: "问答进行中",
  PAUSED: "问答已暂停",
  COMPLETED: "派生答案已保存",
  FAILED: "问答失败",
  CANCELLED: "问答已取消",
};
export function investigationKind(run: Investigation): {
  kind: "BUSINESS" | "QUESTION" | "UNKNOWN";
  label: string;
  state: string;
  position?: WorkPosition;
} {
  // The current business producer predates purpose. Only its absent-purpose,
  // absent-question-context contract is compatible; future types are not guessed.
  if ((run.purpose === undefined && run.questionContext === undefined && run.continuationBasis === undefined)
    || ((run.purpose === "PREPUBLICATION_INCREMENTAL_ANALYSIS" || run.purpose === "PUBLISHED_WORK_CONTINUATION") && continuationKindValid(run)))
    return {
      kind: "BUSINESS",
      label: "业务调查",
      state: investigationState(run.state),
    };
  if (run.purpose !== "GRAPH_QUESTION")
    return {
      kind: "UNKNOWN",
      label: "未识别运行类型",
      state: "运行状态：" + run.state,
    };
  const q = run.questionContext;
  const valid =
    !!q &&
    workId(run.id) &&
    workId(q.sessionId) &&
    bindingValid(q) &&
    !!q.graphRevisionId &&
    stringList(q.objectKeys) &&
    q.objectKeys.length <= 512 &&
    q.sourceInput.sourceBundleSnapshotId === run.sourceInput.sourceBundleSnapshotId &&
    q.sourceInput.receiptId === run.sourceInput.receiptId &&
    (!("workspaceId" in q.sourceInput) || q.sourceInput.workspaceId === run.workspaceId) &&
    sameList(q.adoptedVersionIds, run.adoptedVersionIds);
  return {
    kind: "QUESTION",
    label: "图谱问答",
    state: questionStates[run.state] ?? "问答状态未知",
    ...(valid
      ? {
          position: {
            tab: "sessions",
            session: q.sessionId,
            question: run.id,
          } as WorkPosition,
        }
      : {}),
  };
}
