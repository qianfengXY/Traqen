import assert from "node:assert/strict";
import test from "node:test";
import { currentScopeCheck, storeScopeCheck, scopeExplanation, defaultProfileId } from "../app/deterministic-facts/delivery-state.ts";

const scope = { scopeId: "b".repeat(64), status: "READY_TO_SEAL", revision: 3 };
const ready = { scope, ready: true, blockers: [] };

test("a fresh extraction selects the recommended startable bounded profile instead of an arbitrary hash-ordered historical profile", () => {
  const profiles = [{ id: "legacy", startable: true }, { id: "disabled", recommended: true, startable: false }, { id: "bounded", recommended: true, startable: true }];
  assert.equal(defaultProfileId(profiles), "bounded");
  assert.equal(defaultProfileId(profiles.slice(0, 2)), "legacy");
  assert.equal(defaultProfileId([]), "");
});

test("new analysis prefers a startable automatic technical profile without rewriting a retained historical profile", () => {
  const profiles = [{ id: "bounded", recommended: true, startable: true },
    { id: "unavailable", recommended: true, startable: false, extractionLimits: { automaticPublication: "closed-scope-v1" } },
    { id: "technical", recommended: true, startable: true, extractionLimits: { automaticPublication: "closed-scope-v1" } }];
  assert.equal(defaultProfileId(profiles), "technical");
});

test("automatic analysis explains pending validation, failure and readable output without asking for a manual seal", () => {
  const profile = { extractionLimits: { automaticPublication: "closed-scope-v1" } };
  assert.match(scopeExplanation(scope, undefined, profile), /自动.*校验/);
  assert.doesNotMatch(scopeExplanation(scope, ready, profile), /点击|封存此范围|查看封存条件/);
  assert.match(scopeExplanation({ ...scope, status: "SEALED", graphVersionId: "v1" }, undefined, profile), /查看分析结果/);
  assert.match(scopeExplanation({ ...scope, status: "BLOCKED" }, undefined, profile), /未发布.*诊断/);
});

test("a checked scope in one run never authorizes or displays its result in another run with the same deterministic scope id", () => {
  const checks = storeScopeCheck({}, "run-one", scope.scopeId, ready);
  assert.deepEqual(currentScopeCheck(checks, "run-one", scope), ready);
  assert.equal(currentScopeCheck(checks, "run-two", scope), undefined);
  const failed = { scope: { ...scope, status: "FAILED_RETRYABLE", revision: 4 }, ready: false, blockers: [{ code: "F002_SCOPE_PENDING", count: 718572 }] };
  const both = storeScopeCheck(checks, "run-two", scope.scopeId, failed);
  assert.deepEqual(currentScopeCheck(both, "run-one", scope), ready);
  assert.deepEqual(currentScopeCheck(both, "run-two", failed.scope), failed);
});

test("a previous revision or different current state cannot reuse a ready-to-seal check", () => {
  const checks = storeScopeCheck({}, "run-one", scope.scopeId, ready);
  assert.equal(currentScopeCheck(checks, "run-one", { ...scope, revision: 4 }), undefined);
  assert.equal(currentScopeCheck(checks, "run-one", { ...scope, status: "CANCELLED" }), undefined);
});

test("a check returned for a different scope is refused instead of filed under the requested scope", () => {
  assert.throws(() => storeScopeCheck({}, "run-one", "c".repeat(64), ready), /范围/);
});

test("delivery explains why seal and sealed-version steps are absent instead of offering only a raw runtime code", () => {
  const failed = { ...scope, status: "FAILED_RETRYABLE", diagnostic: { code: "F002_PARSE_TIMEOUT" } };
  assert.match(scopeExplanation(failed), /解析.*预算.*未封存/);
  assert.match(scopeExplanation({ ...scope, status: "RUNNING" }), /正在提取.*不能封存/);
  assert.match(scopeExplanation(scope), /查看封存条件/);
  assert.match(scopeExplanation(scope, ready), /封存此范围/);
  assert.match(scopeExplanation({ ...scope, status: "SEALED", graphVersionId: "v1" }), /查看独立封存版本/);
  assert.match(scopeExplanation({ ...scope, status: "unexpected" }), /核验/);
});

test("pending coverage is labeled as material-capability work, not as a count of files", () => {
  const running = { ...scope, status: "RUNNING" };
  const message = scopeExplanation(running, { scope: running, ready: false, blockers: [{ code: "F002_SCOPE_PENDING", count: 718572 }] });
  assert.match(message, /718,572.*材料.*能力.*工作项/);
  assert.doesNotMatch(message, /718,572.*文件/);
});
