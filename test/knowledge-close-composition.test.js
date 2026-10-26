import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { knowledgeServerFixture } from './support/f002-f003-server-fixture.js';
import { isolatedPostgres } from './support/source-truth-postgres.js';
import { owner } from './support/source-truth-database.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(read, accepts) {
  for (let i = 0; i < 400; i++) { const value = await read(); if (accepts(value)) return value; await delay(10); }
  assert.fail('Owned lifecycle barrier did not settle');
}
async function fixture(t) {
  assert.ok(process.env.F001_TEST_PG_BIN, 'Native composition checks must not silently skip');
  const cluster = await isolatedPostgres(t);
  const f = await knowledgeServerFixture(t, { database: () => cluster.createDatabase() });
  return { f, k: f.runtime.knowledge };
}
function assertFenced(k) {
  assert.equal(k.business.services.executor.closed, true);
  assert.equal(k.business.services.executor.timer, null);
  for (const s of [k.facts.services.executor, k.facts.services.replayExecutor, k.facts.services.requestExecutor]) {
    assert.equal(s.closed, true); assert.equal(s.timer, null);
  }
}
const scope = { workspaceId: 'workspace', runId: 'owned-close-probe', scopeId: 'owned-scope', actorId: owner.actorId, status: 'QUEUED' };

test('composite close fences real F2 queues before held F3 drain; no new worker', { timeout: 60000 }, async t => {
  const { k } = await fixture(t), entered = deferred(), release = deferred();
  const closeBusiness = k.business.close;
  k.business.close = async () => { entered.resolve(); await release.promise; await closeBusiness(); };
  let calls = 0; k.facts.services.executor.worker.run = async () => { calls++; };
  await k.start(); const closing = k.close();
  try {
    await entered.promise;
    await k.facts.services.executor.enqueue({ id: scope.runId, workspaceId: scope.workspaceId, actorId: scope.actorId, scopes: [scope] });
    assert.equal(calls, 0, 'valid actor started new F2 work after composite close');
    assertFenced(k);
    assert.strictEqual(k.close(), closing);
    await assert.rejects(k.start(), /closed/);
  } finally { release.resolve(); await closing; }
});

test('composite close fences pending initial F2 scan before recovered work begins', { timeout: 60000 }, async t => {
  const { k } = await fixture(t), entered = deferred(), release = deferred();
  k.facts.services.repository.findRunnableScopes = async () => { entered.resolve(); return release.promise; };
  let calls = 0; k.facts.services.executor.worker.run = async () => { calls++; };
  const starting = k.start(); const started = starting.catch(e => { assert.match(e.message, /closed/); });
  await entered.promise; const closing = k.close();
  try {
    const fencedBeforeRelease = k.facts.services.executor.closed;
    release.resolve([scope]); await started; await closing;
    assert.equal(calls, 0, 'recovered F2 worker began after composite close');
    assert.equal(fencedBeforeRelease, true); assertFenced(k);
  } finally { release.resolve([]); await started; await closing; }
});

test('rejected F3 drain preserves failure, closes every F2 queue and remains idempotent', { timeout: 60000 }, async t => {
  const { k } = await fixture(t), failure = new Error('owned F3 drain failure');
  const closeBusiness = k.business.close;
  k.business.close = async () => { await closeBusiness(); throw failure; };
  await k.start(); const closing = k.close();
  assert.strictEqual(k.close(), closing);
  await assert.rejects(closing, e => e instanceof AggregateError && e.errors.includes(failure));
  assertFenced(k); assert.equal(k.business.services.executor.timer, null);
  // The fixture also closes the runtime; retain the explicit rejected-close
  // assertion while allowing that independent cleanup to finish normally.
  k.close = () => Promise.resolve();
});

test('already accepted real C03 drains before F3 lease release; investigation stays recoverable', { timeout: 60000 }, async t => {
  const { f, k } = await fixture(t); await k.start();
  const facts = k.facts.services, investigations = k.business.services.investigations;
  const run = await facts.admission.start(owner, 'workspace', { operationId: 'close-base', reference: f.reference,
    profile: facts.technicalProfile, scopes: [{ selections: [{ kind: 'COMPONENT', componentId: f.componentId }] }] });
  await facts.executor.enqueue(run);
  const sealed = await facts.repository.getRun(owner, 'workspace', run.id), version = sealed.scopes[0].graphVersionId;
  assert.ok(version, 'actual F2 worker must seal the baseline');
  const investigation = await investigations.start(owner, 'workspace', { operationId: 'close-investigation', reference: f.reference,
    expectedProfileId: f.profile.id, question: 'Synthetic close/C03 persistence mechanism', technicalVersionId: version,
    scope: { componentIds: [f.componentId] }, budget: { maxReadBytes: 65536, maxModelCalls: 10, deadline: '2099-01-01T00:00:00Z' },
    supplementBudget: { maxMaterials: 10, maxBytes: 65536, maxRuleApplications: 100, maximumAttempts: 10, deadline: '2099-01-01T00:00:00Z' } });
  k.business.services.executor.enqueue({ workspaceId: 'workspace', id: investigation.id, actorId: owner.actorId });
  await until(() => investigations.get(owner, 'workspace', investigation.id), r => r.state === 'RUNNING' && r.usage.modelCalls > 0);
  const fact = (await f.runtime.db.query("SELECT id FROM f002_record WHERE graph_version_id=$1 AND kind='FACT' LIMIT 1", [version])).rows[0];
  assert.ok(fact);
  const request = await facts.requests.submit(owner, 'workspace', { operationId: 'accepted-close-request', investigationId: investigation.id,
    baseVersionId: version, requestKind: 'LOOKUP', question: 'Read already accepted technical evidence', factRefs: [fact.id], materialRefs: [], requestedCapabilities: [] });
  const entered = deferred(), release = deferred(), execute = facts.requests.execute.bind(facts.requests);
  facts.requests.execute = async (...args) => { entered.resolve(); await release.promise; return execute(...args); };
  const pending = facts.requestExecutor.enqueue(request); await entered.promise;
  const closing = k.close();
  try {
    await until(() => facts.requestExecutor.closed, v => v);
    release.resolve(); await pending; await closing;
    const completed = await facts.requests.get(owner, 'workspace', request.id);
    assert.equal(completed.status, 'COMPLETED', JSON.stringify(completed));
    assert.equal(completed.outcome, 'EXISTING_EVIDENCE');
    const recovered = await investigations.get(owner, 'workspace', investigation.id);
    assert.equal(recovered.state, 'QUEUED', 'shutdown releases F3 rather than losing accepted work');
    assert.ok((await investigations.events(owner, 'workspace', investigation.id)).some(e => e.event_type === 'INVESTIGATION_HOST_INTERRUPTED'));
    assertFenced(k);
    assert.equal(k.business.services.executor.running.size, 0);
    assert.equal(k.business.services.executor.timer, null);
  } finally { release.resolve(); await pending; await closing; }
});
