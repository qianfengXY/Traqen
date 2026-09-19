import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = "docs/policies/branch-review-publication-policy.md";
const policyZhPath = "docs/policies/branch-review-publication-policy.zh-CN.md";
const governanceFixturePath = "test/fixtures/project-governance-policy.json";
const immutableGovernance = [
  "frontend 3003 and API 3004",
  "Redis port 6399",
  "No self-review",
  "Identity is constant",
];

test("tracked project policy and provider-neutral governance fixture remain enforceable in an exact tree", async () => {
  const [policy, policyZh, fixtureSource] = await Promise.all([
    readFile(path.join(root, policyPath), "utf8"),
    readFile(path.join(root, policyZhPath), "utf8"),
    readFile(path.join(root, governanceFixturePath), "utf8"),
  ]);
  const fixture = JSON.parse(fixtureSource);

  assert.equal(fixture.reviewPolicy, policyPath);
  assert.deepEqual(fixture.immutableConstraints, immutableGovernance);
  assert.match(policy, /At least two distinct models or reviewer identities/);
  assert.match(policy, /A synthesizer\s+must not impersonate another reviewer/);
  assert.match(policy, /A normal branch review does not itself enter the publication gate/);
  assert.match(policy, /Local `main` is the sole integration source/);
  assert.match(policy, /Issue title and body must be written in Simplified Chinese/);
  assert.doesNotMatch(policy, /must be bilingual/);
  assert.ok(policy.includes("branch-review-publication-policy.zh-CN.md"));
  assert.match(policyZh, /本发布门不为分支合入本地 `main` 增加第二位 reviewer/);
  assert.match(policyZh, /远端仓库仅保留 `main` 分支/);
  assert.match(policyZh, /通用审阅保障适用于任何被请求的分支或 commit Review/);
  assert.ok(fixture.localProviderInstructions.tracked === false);
  assert.equal(fixture.localProviderInstructions.purpose, "local tool/runtime adaptation only");
});
