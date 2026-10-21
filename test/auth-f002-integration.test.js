import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { AuthRepository } from "../src/auth/repository.js";
import { AuthService } from "../src/auth/service.js";
import { AuthHttp } from "../src/auth/http.js";
import { contextualDatabase } from "../src/auth/database.js";
import { createTraceabilityHttpServer } from "../src/api/http-server.js";
import { createF002Runtime } from "../src/deterministic-facts/runtime.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { owner } from "./support/source-truth-database.js";

test("password-session users extract an existing F001 version without a second credential or legacy runtime", async t => {
  const fixture = await candidateFixture(t, { entryPath: "routes.js", content: "export function usableEvidence() { return 42; }" });
  const prepared = await fixture.candidates.prepare(fixture.context);
  await fixture.advance("RECONCILING", "REVIEW_REQUIRED");
  const publication = new SourcePublicationService(fixture.repository, fixture.candidates);
  const confirmation = await publication.confirm(owner, fixture.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId });
  const frozen = await publication.seal(owner, fixture.context, { confirmationId: confirmation.id, clientToken: "source-freeze" });
  const sourceCount = (await fixture.db.query("SELECT count(*) AS n FROM source_truth_run")).rows[0].n;
  const service = new AuthService({ repository: new AuthRepository(contextualDatabase(fixture.db)), key: Buffer.alloc(32, 7) });
  const account = await service.initialize({ login: "admin", displayName: "Admin", password: "test-password1" });
  await service.migrate({ bindings: [{ principalId: "owner", accountId: account.id }], owners: [{ workspaceId: "workspace", accountId: account.id }], grants: [], confirmed: true, requestedBy: "DEPLOYMENT" });
  fixture.repository.identityService = service;
  const sourceRuntime = { pool: fixture.db, services: { repository: fixture.repository, admission: new SourceAdmissionService(fixture.repository, fixture.candidates) }, configuration: { members: [], origins: [] } };
  const runtime = await createF002Runtime({ sourceRuntime, cursorSecret: "isolated-unified-f002-cursor" });
  t.after(() => runtime.close());
  const http = new AuthHttp({ service, origin: "http://127.0.0.1:54321", development: true });
  const server = createTraceabilityHttpServer({ application: {}, auth: http, deterministicFactsHandler: runtime.deterministicFactsHandler });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  http.origin = base; http.host = new URL(base).host; sourceRuntime.configuration.origins.push(base);
  const session = await service.login({ login: "admin", password: "test-password1" });
  const headers = { cookie: `${http.cookieName}=${session.token}`, origin: base, "x-traqen-csrf": http.csrfFor(session.token), "content-type": "application/json" };
  const call = async (suffix = "", method = "GET", input, overrides = {}) => {
    const response = await fetch(`${base}/v1/workspaces/workspace/deterministic-facts${suffix}`, { method, headers: { ...headers, ...overrides }, body: input === undefined ? undefined : JSON.stringify(input) });
    return { status: response.status, body: await response.json() };
  };
  const overview = await call();
  assert.equal(overview.status, 200, JSON.stringify(overview.body));
  assert.equal(overview.body.consumer.configured, false, "ordinary extraction is independent of F003");
  const profile = overview.body.profiles.find(p => p.version === "2");
  assert.ok(profile);
  const reference = { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id };
  const inventory = await sourceRuntime.services.admission.inventory(owner, "workspace", reference);
  const input = { operationId: "session-extract", source: reference, profileId: profile.id, scopes: [{ selections: [{ kind: "COMPONENT", componentId: inventory.items[0].componentId }] }] };
  const missingProof = await call("/runs", "POST", input, { "x-traqen-csrf": "" });
  assert.equal(missingProof.status, 403);
  const accepted = await call("/runs", "POST", input);
  assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
  const runId = accepted.body.run.id;
  // Simulate process recovery: no copied member credentials survive. The
  // replacement scheduler must resolve the persisted principal and current ACL.
  await runtime.close();
  const recovered = await createF002Runtime({ sourceRuntime, cursorSecret: "isolated-unified-f002-cursor" });
  t.after(() => recovered.close());
  await recovered.services.executor.dispatch();
  let run;
  for (let attempt = 0; attempt < 100; attempt++) {
    run = await recovered.services.repository.getRun(owner, "workspace", runId);
    if (run.scopes[0].status === "READY_TO_SEAL") break;
    await pause(25);
  }
  assert.equal(run.scopes[0].status, "READY_TO_SEAL", JSON.stringify(run));
  const scope = run.scopes[0];
  const sealed = await call(`/runs/${runId}/scopes/${scope.scopeId}/seal`, "POST", { revision: scope.revision, operationId: "session-seal" });
  assert.equal(sealed.status, 200, JSON.stringify(sealed.body));
  const versionId = sealed.body.scope.graphVersionId;
  const records = await call(`/versions/${versionId}/records?limit=100`);
  assert.equal(records.status, 200);
  assert.ok(records.body.items.some(item => item.kind === "FACT"));
  assert.equal((await fixture.db.query("SELECT count(*) AS n FROM source_truth_run")).rows[0].n, sourceCount, "F002 does not rescan or replace the frozen source");
  assert.equal((await call("/runs", "POST", input)).body.run.id, runId, "same operation has one durable run");
  await service.logout(session.token);
  assert.equal((await call(`/versions/${versionId}/records?limit=100`)).status, 401);
});
