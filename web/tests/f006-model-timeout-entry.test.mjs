import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url), ts = require("../node_modules/typescript");
const source = await readFile(new URL("../app/f006-settings-center.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

function fixture(overrides = {}) {
  const slots = [], saves = []; let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const hooks = { useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
  useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
  useMemo(factory) { cursor++; return factory(); }, useEffect() { cursor++; } };
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compiled, { module: sandboxModule, exports: sandboxModule.exports, require: name => name === "react" ? hooks
    : name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : {}, crypto: { randomUUID: () => "unique-test" } });
  const props = { t: (_zh, en) => en, scope: "global", canGlobalConfig: true, workspace: null,
    accounts: [{ id: "account", accountId: "account", lifecycle: "ACTIVE", authMethod: "API_KEY" }], models: [], capabilities: [],
    executableSkills: [], catalog: { entries: [], effective: [] }, childSlots: [], mainSkillNames: [], mainMcpNames: [],
    working: false, recoveryReady: true, onSaveCliModel: async input => { saves.push(input); return true; }, ...overrides };
  const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes)
    : [tree, ...nodes(tree.props?.children)];
  const text = node => typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : text(node?.props?.children ?? "");
  const root = () => { cursor = 0; return sandboxModule.exports.F006SettingsCenter(props); };
  const models = () => { const node = nodes(root()).find(n => n.type?.name === "GlobalModels"); return node?.type(node.props); };
  const button = (tree, label) => nodes(tree).find(n => n.type === "button" && text(n.props.children) === label);
  button(root(), "Models")?.props.onClick();
  const field = label => { const node = nodes(models()).find(n => n.type === "label" && text(n.props.children).startsWith(label));
    return nodes(node).find(n => ["input", "select"].includes(n.type)); };
  const fill = (label, value) => { const input = field(label); assert.ok(input, `Missing actual input: ${label}`); input.props.onChange({ currentTarget: { value } }); };
  if (models()) fill("Account", "account");
  return { props, saves, models, nodes, text, button, field, fill,
    save: async () => { await button(models(), "Save CLI model").props.onClick(); for (let n = 0; n < 4; n++) await Promise.resolve(); } };
}

test("F006 actual model form sends explicit default and exact second-to-millisecond values", async () => {
  const f = fixture();
  assert.equal(f.field("Call timeout (seconds)")?.props.value, "120");
  await f.save(); assert.equal(f.saves.at(-1).timeoutMs, 120000);
  for (const [seconds, ms] of [["600", 600000], ["0.001", 1], ["1.234", 1234], ["2147483.647", 2147483647]]) {
    f.fill("Call timeout (seconds)", seconds); await f.save(); assert.equal(f.saves.at(-1).timeoutMs, ms);
  }
});

test("F006 invalid timeout never calls the save port, including bypassing disabled button", async () => {
  const f = fixture();
  for (const value of ["", "0", "-1", "NaN", "Infinity", "1e3", "0.0001", "1.2345", "2147483.648", "999999999999999999999"]) {
    f.fill("Call timeout (seconds)", value);
    assert.equal(f.button(f.models(), "Save CLI model").props.disabled, true, value);
    await f.save(); assert.equal(f.saves.length, 0, value);
  }
});

test("F006 adapter changes preserve timeout; replacement uses actual saved value, unknown stays unknown", async () => {
  const model = { id: "old-r1", profileId: "old", displayName: "Old", transport: "CLI", cliAdapter: "CODEX", lifecycle: "ACTIVE", readiness: "UNVERIFIED", accountId: "account", timeoutMs: 600000 };
  const f = fixture({ models: [model, { ...model, id: "unknown-r1", profileId: "unknown", displayName: "Unknown", timeoutMs: undefined }] });
  assert.ok(f.text(f.models()).includes("600 s")); assert.ok(f.text(f.models()).includes("Call timeout unknown"));
  f.fill("Call timeout (seconds)", "701.123"); f.fill("CLI client", "CLAUDE");
  assert.equal(f.field("Call timeout (seconds)").props.value, "701.123");
  f.nodes(f.models()).find(n => n.type === "button" && f.text(n.props.children) === "Create pinned replacement").props.onClick();
  assert.equal(f.field("Call timeout (seconds)").props.value, "600");
  assert.equal(f.field("Stable ID (optional)").props.value, "");
  f.nodes(f.models()).filter(n => n.type === "button" && f.text(n.props.children) === "Create pinned replacement")[1].props.onClick();
  assert.equal(f.field("Call timeout (seconds)").props.value, "");
  assert.equal(model.timeoutMs, 600000); assert.equal(f.saves.length, 0);
});

test("F006 current global permission is separate from Workspace read-only status", async () => {
  const denied = fixture({ readOnly: true, canGlobalConfig: false });
  assert.equal(denied.models(), undefined); assert.equal(denied.saves.length, 0);
  const admin = fixture({ readOnly: true, canGlobalConfig: true });
  assert.equal(admin.button(admin.models(), "Save CLI model").props.disabled, false);
  await admin.save(); assert.equal(admin.saves[0].timeoutMs, 120000);
});

test("F006 failed save retains the explicit timeout draft; working never sends a second request", async () => {
  let calls = 0;
  const f = fixture({ onSaveCliModel: async input => { calls++; assert.equal(input.timeoutMs, 600000); return false; } });
  f.fill("Call timeout (seconds)", "600"); await f.save();
  assert.equal(calls, 1); assert.equal(f.field("Call timeout (seconds)").props.value, "600");
  f.props.working = true; await f.save(); assert.equal(calls, 1);
});
