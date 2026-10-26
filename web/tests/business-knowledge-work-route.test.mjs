import test from "node:test";
import assert from "node:assert/strict";
import { workPosition, workAddress } from "../app/business-knowledge/work-route.ts";
test("published and work-session deep links never depend on private investigation or implicit latest", () => {
  assert.equal(
    workPosition("?workspace=w&knowledge=published&publishedRevision=R1", "w").revision,
    "R1",
  );
  assert.equal(
    workPosition("?workspace=w&knowledge=sessions&sessionId=S1&questionId=Q1", "w").question,
    "Q1",
  );
  for (const q of [
    "knowledge=published&runId=private",
    "knowledge=published&publishedRevision=R1&publishedRevision=R2",
    "knowledge=sessions&questionId=Q1",
    "knowledge=published&sessionId=S1",
    "knowledge=sessions&sessionId=S1&workspace=w",
    "knowledge=unknown",
  ]) {
    assert.ok(workPosition(`?workspace=w&${q}`, "w").error, q);
  }
  const next = workAddress(
    "https://example.test/?page=graph&workspace=w&runId=private&view=BUSINESS&objectId=old",
    "w",
    { tab: "sessions", session: "S1", question: "Q1" },
  );
  assert.equal(new URL(next).searchParams.get("sessionId"), "S1");
  assert.equal(new URL(next).searchParams.has("runId"), false);
  assert.equal(
    workAddress("https://example.test/?workspace=foreign", "w", { tab: "published" }),
    null,
  );
});
test('published original deep links retain an exact public revision and never borrow a private investigation',()=>{
  const next=workAddress('https://example.test/?workspace=w&page=graph&runId=private','w',{tab:'published',revision:'R1',material:'M1'});
  assert.equal(new URL(next).searchParams.get('publishedMaterial'),'M1');
  assert.equal(workPosition(new URL(next).search,'w').material,'M1');
  assert.ok(workPosition('?workspace=w&knowledge=sessions&sessionId=S1&publishedMaterial=M1','w').error);
  assert.ok(workPosition('?workspace=w&knowledge=published&publishedMaterial=M1','w').error);
});
