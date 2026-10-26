// Isolated synthetic materials and accounts. Only the external CLI process is
// a test double: F001, F002, F003, F006, F008, SQL and HTTP are real modules.
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { createServer } from "node:http";
import { candidateFixture } from "./source-truth-candidate-fixture.js";
import { owner } from "./source-truth-database.js";
import { SourcePublicationService } from "../../src/source-truth/publication-service.js";
import { SourceTruthRepository } from "../../src/source-truth/repository.js";
import { sourceTruthServices } from "../../src/source-truth/services.js";
import { capturePolicy } from "../../src/source-truth/policy.js";
import { createSourceTruthHttpHandler } from "../../src/source-truth/http-handler.js";
import { AuthService } from "../../src/auth/service.js";
import { AuthRepository } from "../../src/auth/repository.js";
import { AuthHttp } from "../../src/auth/http.js";
import { contextualDatabase } from "../../src/auth/database.js";
import { authContext } from "../../src/auth/context.js";
import { authorizedStore } from "../../src/auth/authorized-store.js";
import { PostgresTraceabilityStore } from "../../src/storage/index.js";
import { AnalysisModelRegistry } from "../../src/analysis/index.js";
import { TraceabilityApplication } from "../../src/application/traceability-application.js";
import { createTraceabilityHttpHandler } from "../../src/api/http-server.js";
import { createKnowledgeRuntime } from "../../src/api/knowledge-bootstrap.js";

export const syntheticPassword = "isolated-knowledge-password1";
const key = Buffer.alloc(32, 84);

function cliModelPort(modelResponse) {
  const calls = [], pending = new Set();
  let held = true;
  const registry = new AnalysisModelRegistry({ cliSpawn: (_executable, args, options) => {
    const child = new EventEmitter(); child.pid = 99999999;
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let stopped = false, finish;
    child.kill = () => { stopped = true; pending.delete(finish); child.stdout.end(); child.stderr.end(); child.emit("close", 1); };
    const reply = prompt => {
      const task = JSON.parse(prompt), input = task.input;
      finish = () => {
        pending.delete(finish); if (stopped) return;
        let result;
        if (task.task === "connection-verification") result = { ready: true, challenge: input.challenge };
        else if (modelResponse) result = modelResponse(input);
        else if (input.phase === "PLAN") result = { assignments: [{ slotId: input.childSlots[0].id, obligations: ["核查本任务原文条件、反例与未供应前提（机制替身）"], objective: "read fixed material", materialKeys: [input.inventory[0].key] }],pendingMaterials:input.inventory.slice(1).map(m=>({materialKey:m.key,reason:'该机制夹具未调查，保持待完成'})) };
        else if (input.phase === "INVESTIGATE") result = { candidates: [], relations: [] };
        else result = { reviews: [] };
        child.stdout.end(`${JSON.stringify(result)}\n`); child.stderr.end(); child.emit("close", 0);
      };
      if (task.task !== "connection-verification") calls.push({ phase: input.phase, task: task.task, args, toolsDisabled: args.includes("--ignore-user-config"), hasPrivateCwd: Boolean(options.cwd) });
      if (held && task.task !== "connection-verification") pending.add(finish); else queueMicrotask(finish);
    };
    let prompt = "";
    child.stdin = new Writable({ write(chunk, _encoding, done) { prompt += chunk; done(); }, final(done) { reply(prompt); done(); } });
    if (args.at(-1) !== "-") queueMicrotask(() => reply(args.at(-1)));
    return child;
  } });
  return { registry, calls, hold() { held = true; }, release() { held = false; for (const reply of [...pending]) queueMicrotask(reply); } };
}

export async function knowledgeServerFixture(t, { database, port = 0, webOrigin, modelResponse } = {}) {
  if (webOrigin && (!/^http:\/\/127\.0\.0\.1:\d+$/.test(webOrigin) || [3003,3004,3100,3188].includes(Number(new URL(webOrigin).port)))) throw Error("Synthetic Web origin must use its exact isolated loopback port");
  const source = await candidateFixture(t, { database, entryPath: "openapi.json", additionalFiles: [{ entryPath: "orders.js", content: "export function orderStatus() { return 'OPEN'; }\n" }],
    content: '{"openapi":"3.0.0","paths":{"/orders":{"get":{"responses":{"200":{"description":"ok"}}}}}}' });
  const prepared = await source.candidates.prepare(source.context);
  await source.advance("RECONCILING", "REVIEW_REQUIRED");
  const publication = new SourcePublicationService(source.repository, source.candidates);
  const confirmation = await publication.confirm(owner, source.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId });
  const frozen = await publication.seal(owner, source.context, { confirmationId: confirmation.id, clientToken: "knowledge-server-source" });
  const databaseContext = contextualDatabase(source.db);
  const identity = new AuthService({ repository: new AuthRepository(databaseContext), key });
  const admin = await identity.initialize({ login: "admin", displayName: "Synthetic Admin", password: syntheticPassword });
  const adminSession = await identity.login({ login: "admin", password: syntheticPassword });
  const accounts = {};
  for (const login of ["owner", "reader"]) {
    const created = await identity.createAccount(adminSession.token, { login, displayName: `Synthetic ${login}` });
    await identity.setPassword({ credential: created.credential, password: syntheticPassword }); accounts[login] = created.account;
  }
  await identity.migrate({ bindings: ["owner", "reader"].map(principalId => ({ principalId, accountId: accounts[principalId].id })),
    owners: [{ workspaceId: "workspace", accountId: admin.id }],
    grants: [{ workspaceId: "workspace", accountId: accounts.owner.id, roles: ["MAINTAIN"] },
      { workspaceId: "workspace", accountId: accounts.reader.id, roles: ["READ"] }], confirmed: true, requestedBy: "DEPLOYMENT" });
  const model = cliModelPort(modelResponse);
  const application = new TraceabilityApplication({ store: authorizedStore(new PostgresTraceabilityStore(databaseContext), identity, databaseContext),
    analysisModelRegistry: model.registry, secretReferenceResolver: async () => "synthetic-model-port-not-a-real-secret" });
  const freshAdmin = await identity.login({ login: "admin", password: syntheticPassword });
  const profile = await authContext.run({ raw: freshAdmin.token, actorId: admin.id, accountId: admin.id, global: true, operation: "MAINTAIN" }, async () => {
    await application.saveGlobalAccount({ accountId: "isolated-model-account", displayName: "Synthetic model", authMethod: "API_KEY", secretRefId: "vault://synthetic-only", expectedVersion: 0 });
    await application.configureGlobalCliModel({ profileId: "isolated-model", accountId: "isolated-model-account", cliAdapter: "CODEX", model: "synthetic-only" });
    await application.verifyGlobalModelProfile("isolated-model");
    await application.saveWorkspaceCapabilityDraft("workspace", { expectedVersion: 0, mainAgentSlot: { modelProfileId: "isolated-model" },
      childAgentSlots: [{ id: "child", modelProfileId: "isolated-model", independenceGroup: "isolated-child" }], projectCapabilityRevisionIds: [], disabledKeys: [] });
    return application.activateWorkspaceCapabilityDraft("workspace");
  });
  let current = null;
  const start = async (db = source.db, listenPort = port) => {
    const context = contextualDatabase(db);
    const service = new AuthService({ repository: new AuthRepository(context), key });
    const repository = new SourceTruthRepository(db, { identityService: service });
    const services = sourceTruthServices({ repository, blobs: source.blobs, policy: capturePolicy() });
    let handler;
    const server = createServer((req, res) => handler(req, res));
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(listenPort, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`, origins = [...new Set([origin, ...(webOrigin ? [webOrigin] : [])])];
    const sourceRuntime = { pool: db, services, configuration: { members: [], origins, resources: { workerConcurrency: 2 } },
      sourceTruthHandler: createSourceTruthHttpHandler({ services, allowedOrigins: origins, authenticate: () => { throw Error("Current session required"); } }) };
    const app = new TraceabilityApplication({ store: authorizedStore(new PostgresTraceabilityStore(context), service, context), analysisModelRegistry: model.registry,
      secretReferenceResolver: async () => "synthetic-model-port-not-a-real-secret" });
    const knowledge = await createKnowledgeRuntime({ sourceRuntime, application: app, cursorSecret: "synthetic-knowledge-cursor" });
    const auth = new AuthHttp({ service, origin: webOrigin ?? origin, development: true });
    handler = createTraceabilityHttpHandler({ application: app, auth, ...knowledge.httpOptions });
    current = { db, knowledge, auth, identity: service, server, origin };
    return current;
  };
  const stop = async () => {
    if (!current) return;
    const previous = current; current = null;
    previous.server.closeAllConnections(); await new Promise(resolve => previous.server.close(resolve));
    await previous.knowledge.close();
  };
  t.after(stop);
  await start();
  return { source, model, accounts, profile, componentId: frozen.bundle.components[0].id, reference: { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id },
    get runtime() { return current; }, stop, start };
}
