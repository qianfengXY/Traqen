import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { stat } from "node:fs/promises";
import test from "node:test";
import { AllowlistedCliModelAdapter, AnalysisModelRegistry } from "../src/analysis/index.js";

function replyingCli(calls, response = input => ({ ready: true, challenge: input.challenge })) {
  return (executable, args, options) => {
    const call = { executable, args, options, prompt: "" }; calls.push(call);
    const child = new EventEmitter(); child.pid = 99999999; child.kill = () => {};
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let replied = false;
    const reply = prompt => {
      if (replied) return; replied = true; call.prompt = prompt;
      const { input } = JSON.parse(prompt);
      queueMicrotask(() => { child.stdout.end(`${JSON.stringify(response(input))}\n`); child.stderr.end(); child.emit("close", 0); });
    };
    child.stdin = new Writable({ write(b, _enc, cb) { call.prompt += b; cb(); }, final(cb) { reply(call.prompt); cb(); } });
    if (args.at(-1)?.startsWith("{")) queueMicrotask(() => reply(args.at(-1)));
    return child;
  };
}

test("F003 connection verification uses the isolated task transport without ambient host credentials or TRACE logging", async t => {
  const canaries = { CAT_CAFE_TEST_CANARY: "private-callback-canary", DATABASE_URL: "postgresql://not-a-real-db.invalid", NODE_OPTIONS: "--trace-warnings", RUST_LOG: "trace" };
  const before = new Map(Object.keys(canaries).map(k => [k, process.env[k]]));
  Object.assign(process.env, canaries);
  t.after(() => { for (const [k, v] of before) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  for (const cliAdapter of ["CODEX", "CLAUDE"]) {
    const calls = [], credentialKey = cliAdapter === "CODEX" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    const adapter = new AllowlistedCliModelAdapter({ id: "F003-VERIFY", cliAdapter, model: "pinned-model", spawnImpl: replyingCli(calls),
      environmentResolver: async () => ({ [credentialKey]: "selected-test-credential" }) });
    assert.ok((await adapter.verify({ taskPolicy: "BUSINESS_KNOWLEDGE" })).latencyMs >= 0);
    assert.deepEqual(await adapter.businessKnowledge({ phase: "PLAN", outputContract: {} }), { ready: true });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].options.env, calls[0].options.env, "actual analysis uses the same environment boundary as readiness");
    const { args, options, prompt } = calls[0];
    assert.equal(JSON.parse(prompt).task, "connection-verification");
    assert.equal(args.some(a => a.includes("challenge")), false, "nonce and evidence belong on bounded stdin, not argv");
    assert.ok(options.cwd && options.cwd !== process.cwd());
    assert.equal(options.shell, false);
    await assert.rejects(stat(options.cwd), { code: "ENOENT" });
    for (const key of ["CAT_CAFE_TEST_CANARY", "DATABASE_URL", "NODE_OPTIONS"]) assert.equal(options.env[key], undefined);
    assert.equal(options.env.RUST_LOG, "error");
    assert.equal(options.env[credentialKey], "selected-test-credential");
    if (cliAdapter === "CODEX") { assert.ok(args.includes("--ignore-user-config")); assert.ok(args.includes("mcp_servers={}")); }
    else { assert.ok(args.includes("--strict-mcp-config")); assert.ok(args.some((a, i) => a === "--tools" && args[i + 1] === "")); }
  }
});

test("F003 readiness does not make a model ready when the live response is malformed or has the wrong nonce", async () => {
  for (const response of [() => ({ ready: true, challenge: "wrong-nonce" }), () => ({ ready: false }), () => ({})]) {
    const calls = [], registry = new AnalysisModelRegistry({ cliSpawn: replyingCli(calls, response) });
    registry.configure({ id: "CODEX", transport: "CLI", cliAdapter: "CODEX", model: "pinned-model" });
    await assert.rejects(registry.verify("CODEX", { taskPolicy: "BUSINESS_KNOWLEDGE" }), /verification challenge/);
    assert.equal(registry.list()[0].ready, false);
    assert.equal(registry.list()[0].verifiedAt, null);
    await assert.rejects(stat(calls[0].options.cwd), { code: "ENOENT" });
  }
});

test("F003 readiness rejects unknown policies and unsupported no-tools adapters without marking a model verified", async () => {
  const calls = [], registry = new AnalysisModelRegistry({ cliSpawn: replyingCli(calls) });
  registry.configure({ id: "CODEX", transport: "CLI", cliAdapter: "CODEX", model: "pinned-model" });
  await assert.rejects(registry.verify("CODEX", { taskPolicy: "GUESS" }), /policy/i);
  for (const cliAdapter of ["GEMINI", "KIMI"]) {
    registry.configure({ id: cliAdapter, transport: "CLI", cliAdapter, model: "pinned-model" });
    await assert.rejects(registry.verify(cliAdapter, { taskPolicy: "BUSINESS_KNOWLEDGE" }), { code: "F003_CLI_ISOLATION_UNAVAILABLE" });
    assert.equal(registry.list().find(p => p.id === cliAdapter).ready, false);
  }
  assert.equal(calls.length, 0);
});
