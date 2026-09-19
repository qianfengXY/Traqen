import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = "docs/policies/branch-review-publication-policy.md";
const policyZhPath = "docs/policies/branch-review-publication-policy.zh-CN.md";
const sopPath = "docs/SOP.md";
const sopZhPath = "docs/SOP.zh-CN.md";
const governanceFixturePath = "test/fixtures/project-governance-policy.json";
const immutableGovernance = [
  "frontend 3003 and API 3004",
  "Redis port 6399",
  "No self-review",
  "Identity is constant",
];

test("tracked project review policy and SOP preserve the publication and local-main boundaries", async () => {
  const [policy, policyZh, sop, sopZh, fixtureSource] = await Promise.all([
    readFile(path.join(root, policyPath), "utf8"),
    readFile(path.join(root, policyZhPath), "utf8"),
    readFile(path.join(root, sopPath), "utf8"),
    readFile(path.join(root, sopZhPath), "utf8"),
    readFile(path.join(root, governanceFixturePath), "utf8"),
  ]);
  const fixture = JSON.parse(fixtureSource);

  assert.equal(fixture.reviewPolicy, policyPath);
  assert.deepEqual(fixture.immutableConstraints, immutableGovernance);
  assert.match(policy, /At least two distinct models or reviewer identities must review the same commit independently\s+before that candidate Finding is published/);
  assert.match(policy, /No reviewer or\s+synthesizer may impersonate another reviewer/);
  assert.match(policy, /A normal branch review does not itself enter the publication gate/);
  assert.match(policy, /Local integration and remote synchronization rules are defined by `docs\/SOP\.md`/);
  assert.match(policy, /Issue title and body must be written in Simplified Chinese/);
  assert.doesNotMatch(policy, /must be bilingual/);
  assert.ok(policy.includes("branch-review-publication-policy.zh-CN.md"));
  assert.match(policyZh, /本发布门不为分支合入本地 `main` 增加第二位\s+reviewer/);
  assert.match(policyZh, /通用审阅保障适用于任何被请求的分支或 commit Review/);
  assert.match(sop, /A normal branch review does not itself activate the\s+stricter two-reviewer publication policy/);
  assert.doesNotMatch(sop, /A request to review a branch or SHA also activates the\s+stricter two-reviewer publication policy/);
  assert.match(sop, /A pre-existing remote branch or open pull request is not authorization for deletion or closure/);
  assert.match(sopZh, /普通分支 Review 不因请求本身触发双 Review/);
  assert.match(sopZh, /既有远端分支或开放 PR 的存在不构成删除或关闭授权/);
  assert.ok(fixture.localProviderInstructions.tracked === false);
  assert.equal(fixture.localProviderInstructions.purpose, "local tool/runtime adaptation only");
});
