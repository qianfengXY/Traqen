import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("../node_modules/typescript");

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

test("F006 settings center binds a new global Skill to a mounted executor and lets an Agent remove unavailable legacy grants", async () => {
  const source = await readFile(new URL("../app/f006-settings-center.tsx", import.meta.url), "utf8");

  assert.match(source, /skillVerified/,
    "a global Skill created in Settings needs an explicit verification state before it can be granted");
  assert.match(source, /selectedGlobalSkill/,
    "the UI must require a selected mounted executor before a global Skill can be saved");
  assert.match(source, /adapterId: selectedGlobalSkill!\.id, version: selectedGlobalSkill!\.version/,
    "the UI must submit the exact selected executor identity rather than inventing a signature");
  assert.doesNotMatch(source, /signature:\s*kind === "SKILL" \? "VERIFIED" : undefined/,
    "the client must not self-attest a Skill as VERIFIED");
  assert.match(source, /!skillVerified/,
    "a Skill cannot be saved as grantable before the administrator verifies it");
  assert.match(source, /unavailableGrants/,
    "Agent Settings must retain a recovery view for grants hidden from the effective catalog");
  assert.match(source, /GLOBAL_UNAVAILABLE[\s\S]*props\.selected!\.skills\.includes/,
    "a selected unavailable Skill must remain in the Agent grant list so it can be unchecked");
  assert.match(source, /onToggleGrant\("SKILL", entry\.normalizedName\)/,
    "removing an unavailable grant must edit the same durable Agent draft state");
});

test("F006 settings keeps creation-only guards separate from lifecycle controls and maps local Skills to executors", async () => {
  const source = await readFile(new URL("../app/f006-settings-center.tsx", import.meta.url), "utf8");

  assert.match(source, /selectedLocalSkill/,
    "a Workspace-local Skill must select an executor before it can be granted and applied");
  assert.match(source, /adapterId: selectedLocalSkill!\.id, version: selectedLocalSkill!\.version/,
    "a Workspace-local Skill must submit the exact selected executor mapping");
  assert.match(source, /handwritten signature is not accepted/,
    "the recovery UI must explain that the server seals the executor mapping");
  assert.doesNotMatch(source, /<GlobalCapabilities \{\.\.\.props\} working=\{props\.working \|\| \(globalPage === "skills" && !skillVerified\)\}/,
    "the new-Skill verification checkbox must not disable lifecycle recovery controls for existing global capabilities");
  assert.match(source, /createDisabled=\{props\.working \|\| \(globalPage === "skills" && \(!skillVerified \|\| !selectedGlobalSkill\)\)\}/,
    "only creation is disabled until a new Skill has both confirmation and an executable identity");
  assert.match(source, /disabled=\{props\.working\} onClick=\{\(\) => props\.onLifecycle/,
    "an existing global capability remains deactivatable while the new-Skill checkbox is clear");
});

test("F006 settings stops autosave after a failed conflict and requires an explicit retry", async () => {
  const source = await readFile(new URL("../app/f006-settings-center.tsx", import.meta.url), "utf8");

  assert.match(source, /if \(!edited \|\| edited === savedEdited \|\| !recoveryReady \|\| working \|\| autosaveStatus === "ERROR" \|\| props\.draftConflict \|\| autosaveInFlight\.current\) return/,
    "a failed autosave must become a terminal state until the operator chooses to retry");
  assert.match(source, /setAutosaveStatus\("IDLE"\)[\s\S]*setAutosaveAttempt/,
    "Retry save must explicitly re-arm autosave instead of an unrelated rerender retrying forever");
  assert.match(source, /draftConflict/,
    "a stale draft conflict remains an explicit recovery state rather than an autosave loop");
  assert.match(source, /function acknowledgeRecoveredDraft\(acknowledgedEdited: number \| null\)/,
    "both conflict-recovery actions must explicitly acknowledge the child edit revision that is now durable");
  assert.match(source, /void props\.onRetryDraftConflict\(edited\)\.then\(acknowledgeRecoveredDraft\)/,
    "retrying the local draft must acknowledge exactly the recovered snapshot");
  assert.match(source, /void props\.onUseCurrentDraft\(edited\)\.then\(acknowledgeRecoveredDraft\)/,
    "adopting the server draft must clear the error state and re-enable Apply without an extra autosave");
});

test("F006 conflict recovery acknowledges both recovered drafts, re-enables Apply, and preserves later edits", async () => {
  const source = await readFile(new URL("../app/f006-settings-center.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;

  async function exercise(recoveryLabel) {
    const slots = [];
    const effects = [];
    const timers = new Map();
    let cursor = 0;
    let timerId = 0;
    let saves = 0;
    const hooks = {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useRef(initial) {
        const index = cursor++;
        return slots[index] ?? (slots[index] = { current: initial });
      },
      useMemo(factory) { cursor++; return factory(); },
      useEffect(callback, dependencies) {
        const index = cursor++;
        const previous = slots[index];
        if (!previous || dependencies.some((value, dependencyIndex) => !Object.is(value, previous.dependencies[dependencyIndex]))) {
          previous?.cleanup?.();
          slots[index] = { dependencies };
          effects.push(() => { slots[index].cleanup = callback(); });
        }
      },
    };
    const jsx = (type, props, key) => ({ type, props, key });
    const module = { exports: {} };
    vm.runInNewContext(compiled, {
      module,
      exports: module.exports,
      require: (name) => name === "react" ? hooks : name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : {},
      window: {
        setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
        clearTimeout: (id) => timers.delete(id),
      },
      crypto: { randomUUID: () => "fixture" },
    });
    const props = {
      t: (_zh, english) => english,
      scope: "workspace",
      workspace: { id: "WORKSPACE-1", name: "Workspace" },
      accounts: [], models: [], capabilities: [], executableSkills: [],
      catalog: { entries: [], effective: [] },
      draft: { revision: 1 },
      draftConflict: false,
      mainModel: "MODEL-1", mainSkillNames: [], mainMcpNames: [],
      childSlots: [{ id: "CHILD-1", model: "MODEL-1", skillNames: [], mcpNames: [] }],
      disabledKeys: [], working: false, recoveryReady: true, profile: null,
      setMainModel: (model) => { props.mainModel = model; },
      onAutoSave: async () => {
        saves += 1;
        if (saves === 1) {
          props.draftConflict = true;
          return false;
        }
        return true;
      },
      onUseCurrentDraft: async (editedRevision) => {
        props.draftConflict = false;
        props.draft = { revision: 2 };
        props.mainModel = "SERVER-MODEL";
        return editedRevision;
      },
      onRetryDraftConflict: async (editedRevision) => {
        props.draftConflict = false;
        props.draft = { revision: 3 };
        return editedRevision;
      },
      onApply: () => {}, onSaveLocalCapability: () => {}, onDeleteLocalCapability: () => {},
      onSaveAccount: async () => true, onRecheckAccount: async () => {}, onSaveModel: async () => true,
      onVerifyModel: async () => {}, onCreatePinnedReplacement: () => {}, onLifecycle: () => {},
      setScope: () => {}, setMainSkillNames: () => {}, setMainMcpNames: () => {}, setChildSlots: () => {}, setDisabledKeys: () => {},
    };
    function render() {
      cursor = 0;
      const tree = module.exports.F006SettingsCenter(props);
      while (effects.length) effects.shift()();
      return tree;
    }
    function nodes(tree) {
      if (!tree || typeof tree !== "object") return [];
      if (Array.isArray(tree)) return tree.flatMap(nodes);
      return [tree, ...nodes(tree.props?.children)];
    }
    const button = (tree, label) => nodes(tree).find((node) => node.type === "button" && node.props.children === label);
    const flushTimers = () => {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    };
    const settle = async () => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); };

    let tree = render();
    nodes(tree).find((node) => node.type?.name === "AgentSettings").props.onModelChange("MODEL-2");
    render();
    flushTimers();
    await settle();
    tree = render();
    assert.equal(saves, 1, "the failed save must happen once");
    assert.equal(timers.size, 0, "a conflict must not schedule a background retry");

    button(tree, recoveryLabel).props.onClick();
    await settle();
    tree = render();
    assert.equal(props.draftConflict, false, `${recoveryLabel} clears the conflict`);
    assert.equal(button(tree, "Apply configuration").props.disabled, false, `${recoveryLabel} makes the recovered draft applyable`);
    assert.equal(Boolean(button(tree, "Retry save")), false, `${recoveryLabel} clears the failed autosave state`);
    assert.equal(timers.size, 0, `${recoveryLabel} does not re-arm stale autosave work`);

    nodes(tree).find((node) => node.type?.name === "AgentSettings").props.onModelChange("MODEL-3");
    render();
    assert.equal(timers.size, 1, "a later edit remains saveable after recovery");
    flushTimers();
    await settle();
    tree = render();
    assert.equal(saves, 2, "a later edit performs one fresh autosave");
    assert.equal(button(tree, "Apply configuration").props.disabled, false, "the later saved edit stays applyable");
  }

  await exercise("Use server draft");
  await exercise("Retry my draft");
});

test("F006 API-key account form advertises and validates the server-supported environment reference", async () => {
  const source = await readFile(new URL("../app/f006-settings-center.tsx", import.meta.url), "utf8");

  assert.match(source, /env:\/\/OPENAI_API_KEY/,
    "the API-key account form must show the reference scheme the default server resolver can actually resolve");
  assert.match(source, /environment variable reference/,
    "the UI must explain that a secret value is not entered or stored here");
  assert.match(source, /isEnvironmentSecretReference/,
    "the form must reject an unsupported provider reference before a silent server-side configuration failure");
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
