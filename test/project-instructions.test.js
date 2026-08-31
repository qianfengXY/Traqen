import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = "docs/policies/branch-review-publication-policy.md";
const governanceFixturePath = "test/fixtures/project-governance-policy.json";
const immutableGovernance = [
  "frontend 3003 and API 3004",
  "Redis port 6399",
  "No self-review",
  "Identity is constant",
];

test("tracked project policy and provider-neutral governance fixture remain enforceable in an exact tree", async () => {
  const [policy, fixtureSource] = await Promise.all([
    readFile(path.join(root, policyPath), "utf8"),
    readFile(path.join(root, governanceFixturePath), "utf8"),
  ]);
  const fixture = JSON.parse(fixtureSource);

  assert.equal(fixture.reviewPolicy, policyPath);
  assert.deepEqual(fixture.immutableConstraints, immutableGovernance);
  assert.match(policy, /At least two distinct models or reviewer identities/);
  assert.match(policy, /A synthesizer\s+must not impersonate another reviewer/);
  assert.match(policy, /Issue title and body must be bilingual/);
  assert.ok(policy.includes("branch-review-publication-policy.zh-CN.md"));
  assert.ok(fixture.localProviderInstructions.tracked === false);
  assert.equal(fixture.localProviderInstructions.purpose, "local tool/runtime adaptation only");
});

test("review records stay bilingual while published Issues are Chinese-only and model-signed", async () => {
  const [english, chinese] = await Promise.all([
    readFile(path.join(root, policyPath), "utf8"),
    readFile(path.join(root, "docs/policies/branch-review-publication-policy.zh-CN.md"), "utf8"),
  ]);

  assert.match(english, /formal independent Finding and convergence or consensus description[\s\S]*English and Simplified Chinese/);
  assert.match(chinese, /正式独立 Finding，以及收敛或共识描述[\s\S]*英文和简体中文/);

  assert.match(english, /Issue title and body must use Simplified Chinese only/);
  assert.match(english, /submitting model identity/);
  assert.match(english, /cat model signature/);
  assert.doesNotMatch(english, /Issue title and body must be bilingual/);

  assert.match(chinese, /Issue 标题和正文只使用简体中文/);
  assert.match(chinese, /提交模型身份/);
  assert.match(chinese, /猫猫模型签名/);
  assert.doesNotMatch(chinese, /Issue 的标题和正文必须中英双语/);
});
