import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { authorityFixture } from "./support/f003-authority-fixture.js";
import { AuthService } from "../src/auth/service.js";
import { AuthRepository } from "../src/auth/repository.js";
import { AuthHttp } from "../src/auth/http.js";
import { contextualDatabase } from "../src/auth/database.js";
import { SourceTruthRepository } from "../src/source-truth/repository.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";
import { SourceCandidateService } from "../src/source-truth/candidate-service.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { createF003Runtime } from "../src/business-knowledge/runtime.js";
import { createTraceabilityHttpHandler } from "../src/api/http-server.js";

test("F003 mapping HTTP uses current F008 cookies, CSRF, Workspace rights and revocation rather than caller roles or legacy bearer", async t => {
  const f = await authorityFixture(t); await f.closeHttp();
  const identity = new AuthService({ repository: new AuthRepository(contextualDatabase(f.db)), key: Buffer.alloc(32, 73) });
  const password = "authority-fixture-password1";
  const admin = await identity.initialize({ login: "admin", displayName: "isolated authority admin", password });
  const adminSession = await identity.login({ login: "admin", password });
  const accounts = {};
  for (const name of ["owner", "reader"]) {
    const created = await identity.createAccount(adminSession.token, { login: name, displayName: `isolated ${name}` });
    await identity.setPassword({ credential: created.credential, password }); accounts[name] = created.account;
  }
  await identity.migrate({ bindings: ["owner", "reader"].map(principalId => ({ principalId, accountId: accounts[principalId].id })),
    owners: [{ workspaceId: "workspace", accountId: admin.id }], grants: [{ workspaceId: "workspace", accountId: accounts.owner.id, roles: ["MAINTAIN"] },
      { workspaceId: "workspace", accountId: accounts.reader.id, roles: ["READ"] }], confirmed: true, requestedBy: "ISOLATED_TEST" });
  let handler;
  const server = createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const repository = new SourceTruthRepository(f.db, { identityService: identity });
  const admission = new SourceAdmissionService(repository, new SourceCandidateService(repository, new SourceMaterialRepository(repository), f.blobs));
  const runtime = await createF003Runtime({ publicationAuthorityFile: null, application: f.application, sourceRuntime: { pool: f.db, services: { repository, admission },
    configuration: { members: [], origins: [origin] } } });
  t.after(() => runtime.close());
  handler = createTraceabilityHttpHandler({ application: f.application, auth: new AuthHttp({ service: identity, origin, development: true }), businessKnowledgeHandler: runtime.businessKnowledgeHandler });
  const route = `/v1/workspaces/workspace/business-knowledge/versions/${f.published.publication.graphRevisionId}/authority-bindings`;
  async function login(name) {
    const csrf = await fetch(`${origin}/v1/auth/csrf`), proof = await csrf.json();
    const response = await fetch(`${origin}/v1/auth/login`, { method: "POST", headers: { origin, "content-type": "application/json", "x-traqen-csrf": proof.csrfToken,
      cookie: csrf.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") }, body: JSON.stringify({ login: name, password }) });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
    return { cookie: response.headers.getSetCookie().map(c => c.split(";")[0]).join("; "), csrf: body.csrfToken };
  }
  async function request(session, { method = "POST", body = f.bindingRequest, headers = {} } = {}) {
    return fetch(`${origin}${route}${method === "GET" ? `?objectKey=${f.bindingRequest.objectKey}` : ""}`, { method, headers: { origin, cookie: session.cookie,
      ...(method === "POST" ? { "content-type": "application/json", "x-traqen-csrf": session.csrf } : {}), ...headers },
    body: method === "POST" ? JSON.stringify(body) : undefined });
  }
  const ownerSession = await login("owner"), readerSession = await login("reader");
  assert.equal((await fetch(`${origin}${route}`, { method: "POST", headers: f.headers, body: JSON.stringify(f.bindingRequest) })).status, 401);
  assert.equal((await request(ownerSession, { headers: { "x-traqen-csrf": "wrong" } })).status, 403);
  assert.equal((await request(ownerSession, { headers: { origin: "http://foreign.invalid" } })).status, 403);
  assert.equal((await request(readerSession, { headers: { "x-traqen-review-role": "business-owner" } })).status, 403);
  const bound = await request(ownerSession); assert.equal(bound.status, 201, await bound.clone().text());
  const readable = await request(readerSession, { method: "GET" });
  assert.equal(readable.status, 200); assert.equal((await readable.json()).projection.targets[0].authority.status, "UNREVIEWED");
  const freshAdmin = await identity.login({ login: "admin", password });
  await identity.grant(freshAdmin.token, "workspace", { accountId: accounts.owner.id, roles: [] });
  assert.equal((await request(ownerSession)).status, 403, "even an idempotent replay rechecks current rights");
  assert.equal((await request(ownerSession, { method: "GET" })).status, 403);
  assert.equal((await request(readerSession, { method: "GET" })).status, 200);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM f003_authority_binding_set")).rows[0].n, 1);
});
