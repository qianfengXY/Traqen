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
