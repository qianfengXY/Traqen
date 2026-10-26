import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { investigationFixture } from "./support/f003-investigation-fixture.js";
import { owner } from "./support/source-truth-database.js";
import { F006ExecutionConfiguration } from "../src/business-knowledge/execution-configuration.js";
import { InvestigationService } from "../src/business-knowledge/investigation-service.js";
import { InvestigationWorker } from "../src/business-knowledge/worker.js";
import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { AnalysisModelRegistry } from "../src/analysis/index.js";
import { PostgresTraceabilityStore } from "../src/storage/index.js";

test("F003 actual F006 account/team/registry port reaches Main and Child CLI tasks without a legacy analysis job", async t => {
  const f = await investigationFixture(t), invocations = [], verifications = [];
  // Only the external CLI process is a test double. F006 creation, active head,
  // immutable model revision, account eligibility and all F003 I/O are real.
  const registry = new AnalysisModelRegistry({ cliSpawn: (_executable, args, options) => {
    const child = new EventEmitter(); child.pid = 99999999; child.kill = () => {};
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let prompt = "";
    const reply = text => {
      const task = JSON.parse(text), input = task.input; let result;
      if (task.task === "connection-verification") { verifications.push({ args, options }); result = { ready: true, challenge: input.challenge }; }
      else {
        invocations.push({ phase: input.phase, args, options });
        if (input.phase === "PLAN") result = { assignments: [{ slotId: input.childSlots[0].id, obligations: ["核查本任务原文条件、反例与未供应前提（机制替身）"], objective: "read original rule", materialKeys: [input.inventory[0].key] }] };
        if (input.phase === "INVESTIGATE") result = { candidates: [{ key: "cancel", kind: "FUNCTION", name: "取消订单", statement: "用户可取消未支付订单", scope: "本原文", uncertainties: [],
          evidence: [{ materialId: input.materials[0].id, startLine: 1, endLine: 1, quote: "用户可以取消未支付的订单。" }] }], relations: [] };
        if (input.phase === "VERIFY") result = { reviews: input.candidates.map(c => ({ key: c.key, support: "SUPPORTED", rationale: "exact source sentence", premises: ["未支付订单"], unresolvedConflicts: [] })) };
      }
      queueMicrotask(() => { child.stdout.end(`${JSON.stringify(result)}\n`); child.stderr.end(); child.emit("close", 0); });
    };
    child.stdin = new Writable({ write(chunk, _encoding, callback) { prompt += chunk; callback(); }, final(callback) { reply(prompt); callback(); } });
    if (args.at(-1) !== "-") queueMicrotask(() => reply(args.at(-1)));
    return child;
  } });
  const store = new PostgresTraceabilityStore(f.db);
  const application = new TraceabilityApplication({ store, analysisModelRegistry: registry, secretReferenceResolver: async () => "isolated-key-not-real" });
  await application.saveGlobalAccount({ accountId: "F003-account", displayName: "Test account", authMethod: "API_KEY", secretRefId: "vault://test-only", expectedVersion: 0 });
  await application.configureGlobalCliModel({ profileId: "F003-model", accountId: "F003-account", cliAdapter: "CODEX", model: "test-only" });
  await application.verifyGlobalModelProfile("F003-model", { taskPolicy: "BUSINESS_KNOWLEDGE" });
  assert.equal(verifications.length, 1);
  assert.ok(verifications[0].args.includes("--ignore-user-config"), "F006 readiness itself must not use the legacy tools-enabled invocation");
  await application.saveWorkspaceCapabilityDraft("workspace", { expectedVersion: 0, mainAgentSlot: { modelProfileId: "F003-model" },
    childAgentSlots: [{ id: "child", modelProfileId: "F003-model", independenceGroup: "child" }], projectCapabilityRevisionIds: [], disabledKeys: [] });
  const active = await application.activateWorkspaceCapabilityDraft("workspace");
  const service = new InvestigationService({ sources: f.repository, sourceAdmission: f.sourceAdmission, profiles: new F006ExecutionConfiguration() });
  const admitted = await service.start(owner, "workspace", { ...f.request, expectedProfileId: active.id });
  const worker = new InvestigationWorker({ investigations: service, invokeModel: application.createBusinessKnowledgeModelExecutor(service) });
  await worker.run(owner, "workspace", admitted.id, { workerId: "model-port" });
  assert.deepEqual(invocations.map(i => i.phase), ["PLAN", "INVESTIGATE", "VERIFY"]);
  assert.ok(invocations.every(i => i.args.includes("--ignore-user-config") && i.options.env.OPENAI_API_KEY === "isolated-key-not-real"));
  assert.equal((await service.graph(owner, "workspace", admitted.id)).candidates[0].state, "ANALYSIS_ACCEPTED");
  const events = await service.events(owner, "workspace", admitted.id);
  assert.equal(events.filter(e => e.event_type === "MODEL_CALL_STARTED").length, 3);
  assert.equal(JSON.stringify(await service.checkpoints(owner, "workspace", admitted.id)).includes("isolated-key-not-real"), false);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM understanding_record WHERE record_type='WORKSPACE_ANALYSIS_JOB'")).rows[0].n, 0);
});
