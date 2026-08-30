import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("F006 settings center keeps global availability, Workspace grants, and external OAuth separate", async () => {
  const source = await readFile(new URL("../app/f006-settings-center.tsx", import.meta.url), "utf8");
  assert.match(source, /Settings center/);
  assert.match(source, /Global inherited and available/);
  assert.match(source, /Global unavailable \/ needs attention/);
  assert.match(source, /Workspace-local capabilities/);
  assert.match(source, /Workspace availability and Agent grants are separate layers/);
  assert.match(source, /Complete .* OAuth in its own CLI|Sign in in the CLI/);
  assert.match(source, /const OAUTH_ADAPTERS = \["CODEX", "CLAUDE"\]/,
    "OAuth is available only for CLIs with a supported read-only status probe");
  assert.match(source, /const accountAdapters = props\.authMethod === "OAUTH" \? OAUTH_ADAPTERS : ADAPTERS/,
    "the account form must hide adapters without a supported OAuth status probe");
  assert.doesNotMatch(source, /accessToken|refreshToken|beginOAuthLogin/, "the UI must not create an OAuth token or login flow");
  assert.match(source, /Apply configuration/);
  assert.match(source, /setTimeout\(\(\) => \{\s*autosaveInFlight\.current = true/);
  assert.match(source, /onAutoSave\(\)\.then\(\(saved\)/);
  assert.match(source, /Retry save/);
  assert.match(source, /Cannot re-enable here/);
  assert.match(source, /actualUnavailable/);
  assert.match(source, /Granted to/);
  assert.match(source, /onOpenAgentSettings/);
  assert.match(source, /f006-settings-nav/);
  assert.match(source, /f006-mobile-agent-back/);
  assert.match(source, /agentDrawerOpen/);
  assert.match(source, /availableSkills\.length \?/);
  assert.match(source, /availableMcps\.length \?/);
});

test("F006 Codex model settings require an explicit model and expose reasoning effort", async () => {
  const source = await readFile(new URL("../app/f006-settings-center.tsx", import.meta.url), "utf8");

  assert.match(source, /useState\("gpt-5\.6-sol"\)/,
    "new Codex profiles must start from a visible pinned model instead of an implicit CLI default");
  for (const model of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
    assert.match(source, new RegExp(model), `the ${model} preset must be discoverable`);
  }
  assert.match(source, /model_reasoning_effort/,
    "the form must name the real Codex configuration key it controls");
  assert.match(source, /reasoningEffort: modelAdapter === "CODEX"/,
    "only Codex profiles may submit a reasoning effort");
  assert.match(source, /!props\.modelValue\.trim\(\)/,
    "the save action must refuse an unpinned new model");
  assert.match(source, /Legacy default \(un-pinned\)/,
    "existing blank profiles remain intelligible without being silently rewritten");
  assert.match(source, /function hasPinnedModelId\(model: GlobalModelProfile\)/,
    "the settings center must identify legacy unpinned records explicitly");
  assert.match(source, /&& hasPinnedModelId\(model\)/,
    "legacy unpinned records must never enter Agent model selectors");
  assert.match(source, /Pin a model ID before verification|固定模型后才能验证/,
    "the UI must explain why a legacy record cannot be re-verified");
  assert.match(source, /Create pinned replacement|创建固定模型副本/,
    "the UI must offer a recovery path for a legacy unpinned profile");
});
