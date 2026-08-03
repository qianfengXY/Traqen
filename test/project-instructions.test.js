import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const governanceStart = "<!-- CAT-CAFE-GOVERNANCE-START -->";
const governanceEnd = "<!-- CAT-CAFE-GOVERNANCE-END -->";
const policyPath = "docs/policies/branch-review-publication-policy.md";
const immutableGovernance = [
  "frontend 3003 and API 3004",
  "Redis port 6399",
  "No self-review",
  "Identity is constant",
];

const providerFiles = new Map([
  ["AGENTS.md", "codex"],
  ["CLAUDE.md", "claude"],
  ["GEMINI.md", "gemini"],
  ["KIMI.md", "kimi"],
]);

test("provider instructions preserve managed governance before the project review policy", async () => {
  for (const [file, provider] of providerFiles) {
    const content = await readFile(path.join(root, file), "utf8");
    const startIndex = content.indexOf(governanceStart);
    const endIndex = content.indexOf(governanceEnd);
    const policyIndex = content.indexOf(policyPath);

    assert.ok(startIndex >= 0, `${file} is missing the managed governance start marker`);
    assert.ok(endIndex > startIndex, `${file} is missing the managed governance end marker`);
    assert.match(content, new RegExp(`Pack version: [^|\\n]+ \\| Provider: ${provider}`));
    for (const constraint of immutableGovernance) {
      assert.ok(content.includes(constraint), `${file} is missing immutable governance: ${constraint}`);
    }
    assert.ok(policyIndex > endIndex, `${file} must append the project policy after managed governance`);
  }
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
