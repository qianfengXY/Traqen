import assert from "node:assert/strict";
import test from "node:test";
import { knowledgeServerFixture, syntheticPassword } from "./support/f002-f003-server-fixture.js";
import { isolatedPostgres } from "./support/source-truth-postgres.js";

test("F006 native Cookie HTTP exposes exact persisted CLI timeout without new model calls or mutating old revisions", { timeout: 120000 }, async t => {
  const cluster = await isolatedPostgres(t); let name;
  const f = await knowledgeServerFixture(t, { database: async () => { const db = await cluster.createDatabase(); name = db.name; return db; } });
  async function login(who) {
    const csrf = await fetch(`${f.runtime.origin}/v1/auth/csrf`), proof = await csrf.json();
    const r = await fetch(`${f.runtime.origin}/v1/auth/login`, { method: "POST", headers: { origin: f.runtime.origin,
      "content-type": "application/json", "x-traqen-csrf": proof.csrfToken, cookie: csrf.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") },
    body: JSON.stringify({ login: who, password: syntheticPassword }) });
    assert.equal(r.status, 200); const body = await r.json();
    return { cookie: r.headers.getSetCookie().map(c => c.split(";")[0]).join("; "), csrf: body.csrfToken };
  }
  async function request(session, method, body, csrf = session.csrf) {
    const r = await fetch(`${f.runtime.origin}/v1/global-cli-models`, { method, headers: { cookie: session.cookie, origin: f.runtime.origin,
      ...(body ? { "content-type": "application/json", "x-traqen-csrf": csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  }
  let admin = await login("admin"); const reader = await login("reader");
  const before = (await f.runtime.db.query("SELECT revision_id,profile_payload FROM global_model_profile_revision ORDER BY revision_id")).rows;
  const callCount = f.model.calls.length;
  const input = { accountId: "isolated-model-account", cliAdapter: "CODEX", model: "synthetic-only", reasoningEffort: "xhigh" };
  assert.equal((await request(reader, "POST", { ...input, profileId: "reader-forbidden", timeoutMs: 600000 })).status, 403);
  assert.equal((await request(admin, "POST", { ...input, profileId: "csrf-forbidden", timeoutMs: 600000 }, "wrong")).status, 403);
  const created = await request(admin, "POST", { ...input, profileId: "timeout-600", timeoutMs: 600000 });
  assert.equal(created.status, 201); assert.equal(created.body.timeoutMs, 600000);
  const normal = await request(admin, "POST", { ...input, profileId: "timeout-default" });
  assert.equal(normal.status, 201); assert.equal(normal.body.timeoutMs, 120000);
  const stored = (await f.runtime.db.query("SELECT profile_payload FROM global_model_profile_revision WHERE profile_id='timeout-600'")).rows[0].profile_payload;
  assert.equal(stored.timeoutMs, 600000); assert.equal(stored.currentRevisionId, created.body.currentRevisionId);
  const after = (await f.runtime.db.query("SELECT revision_id,profile_payload FROM global_model_profile_revision WHERE revision_id=ANY($1) ORDER BY revision_id", [before.map(r => r.revision_id)])).rows;
  assert.deepEqual(after, before); assert.equal(f.model.calls.length, callCount);
  await f.stop(); await cluster.restart(); await f.start(cluster.pool(name)); admin = await login("admin");
  const listing = await request(admin, "GET"); assert.equal(listing.status, 200);
  const restored = listing.body.models.find(m => m.profileId === "timeout-600");
  assert.equal(restored.timeoutMs, 600000); assert.equal(restored.currentRevisionId, created.body.currentRevisionId);
  assert.equal(f.model.calls.length, callCount);
});
