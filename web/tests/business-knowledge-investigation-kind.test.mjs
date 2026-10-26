import test from "node:test";
import assert from "node:assert/strict";
import { renderComponent } from "./support/render-components.mjs";
import { investigationKind } from "../app/business-knowledge/investigation-kind.ts";
const { InvestigationTypeNotice } = await import(
  "../app/business-knowledge/investigation-type-notice.tsx"
);
const source = { sourceBundleSnapshotId: "a".repeat(64), receiptId: "receipt" };
const qa = {
  id: "question",
  workspaceId: "workspace",
  question: "Saved derived question",
  purpose: "GRAPH_QUESTION",
  state: "COMPLETED",
  sourceInput: source,
  adoptedVersionIds: [],
  questionContext: {
    sessionId: "session",
    graphRevisionId: "revision",
    graphDigest: "b".repeat(64),
    sourceInput: source,
    adoptedVersionIds: [],
    objectKeys: ["object"],
  },
};
test("actual GRAPH_QUESTION context resolves only its exact session and same run question, never a business graph", () => {
  const type = investigationKind(qa);
  assert.equal(type.kind, "QUESTION");
  assert.equal(type.state, "派生答案已保存");
  assert.deepEqual(type.position, {
    tab: "sessions",
    session: "session",
    question: "question",
  });
  const html = renderComponent(InvestigationTypeNotice, { run: qa });
  assert.ok(html.includes("这是图谱问答运行，不是业务调查"));
  assert.ok(!html.includes("技术补证与明确采用"));
  assert.ok(html.includes("打开所属会话的精确问题"));
  assert.ok(!html.includes("尚无保存的分析图谱"));
});
test("missing or contradictory QA context stays typed but cannot invent a session link", () => {
  for (const change of [
    { questionContext: undefined },
    { questionContext: { ...qa.questionContext, sessionId: "../../session" } },
    { sourceInput: { ...source, receiptId: "foreign" } },
    { adoptedVersionIds: ["c".repeat(64)] },
    {
      questionContext: {
        ...qa.questionContext,
        sourceInput: { ...source, workspaceId: "foreign" },
      },
    },
  ]) {
    const run = { ...qa, ...change },
      type = investigationKind(run);
    assert.equal(type.kind, "QUESTION");
    assert.equal(type.position, undefined);
    assert.ok(
      !renderComponent(InvestigationTypeNotice, { run }).includes("打开所属会话的精确问题"),
    );
  }
});
test("the existing absent-purpose business contract is explicit; unknown or incomplete types never inherit it", () => {
  const old = { ...qa };
  delete old.purpose;
  delete old.questionContext;
  assert.equal(investigationKind(old).kind, "BUSINESS");
  assert.equal(investigationKind(old).label,"业务调查");
  for (const purpose of ["FUTURE_KIND", null, "", 123, { future: "type" }]) {
    const run = { ...old, purpose };
    assert.equal(investigationKind(run).kind, "UNKNOWN");
    assert.ok(renderComponent(InvestigationTypeNotice, { run }).includes("运行类型未识别"));
  }
  assert.equal(investigationKind({ ...qa, purpose: undefined }).kind, "UNKNOWN");
});
