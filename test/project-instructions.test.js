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
