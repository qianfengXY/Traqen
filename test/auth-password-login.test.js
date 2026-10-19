import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, copyFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from '../src/storage/postgres/migrations.js';
import { AuthRepository } from '../src/auth/repository.js';
import { AuthService } from '../src/auth/service.js';
import { digest } from '../src/auth/crypto.js';

const migrations = new URL('../db/migrations/', import.meta.url).pathname;
async function fixture(t, directory = migrations) {
  const db = await PGlite.create();
  t.after(() => db.close());
  await applyMigrations(db, directory);
  let now = 1800000000000;
  const repo = new AuthRepository(db);
  const service = new AuthService({ repository: repo, key: Buffer.alloc(32, 7), clock: () => now });
  return { db, repo, service, advance: ms => { now += ms; } };
}
const initialize = service => service.initialize({ login: 'admin', displayName: 'Admin', password: 'password1' });
const login = service => service.login({ login: 'admin', password: 'password1' });

test('terminal initialization activates the administrator; password login immediately grants management access', async t => {
  const { service } = await fixture(t);
  assert.equal((await initialize(service)).admin, true);
  const session = await login(service);
  assert.equal(session.state, 'AUTHENTICATED');
  assert.equal((await service.listAccounts(session.token))[0].admin, true);
  await assert.rejects(service.initialize({ login: 'other', displayName: 'Other', password: 'password2' }), e => e.code === 'AUTH_ALREADY_INITIALIZED');
  const request = await service.apply(session.token, { kind: 'CREATE', name: 'Workspace', reason: 'Team', operationId: 'create' });
  const space = await service.decide(session.token, request.id, { approve: true, version: 1 });
  assert.equal((await service.authorize(session.token, space.workspaceId, 'MANAGE')).admin, true);
  await assert.rejects(service.updateAccount(session.token, session.account.id, { admin: false }), e => e.code === 'AUTH_LAST_ADMIN');
});

test('legacy enrolled and pending administrators log in with a password; pending sessions are never silently upgraded', async t => {
  const { service, repo, advance } = await fixture(t);
  const account = await initialize(service);
  for (const enrolled of [false, true]) {
    await repo.change(s => {
      s.accounts[account.id].admin = enrolled;
      s.accounts[account.id].adminRequested = true;
      s.accounts[account.id].totp = { secret: { obsolete: true }, recoveryCodes: [digest('old-recovery')] };
    });
    const session = await login(service);
    assert.equal(session.state, 'AUTHENTICATED');
    assert.equal(session.account.admin, true);
    assert.equal('mfaEnabled' in session.account, false);
    advance(600001);
    await assert.rejects(service.createAccount(session.token, { login: `person-${enrolled}`, displayName: 'Person' }), e => e.code === 'AUTH_REAUTH_REQUIRED');
    await assert.rejects(service.reauthenticate(session.token, { password: 'wrong-password' }), e => e.code === 'AUTH_INVALID_CREDENTIALS');
    const reverified = await service.reauthenticate(session.token, { password: 'password1' });
    assert.equal((await service.createAccount(reverified.token, { login: `person-${enrolled}`, displayName: 'Person' })).account.status, 'PENDING');
    await repo.change(s => { s.sessions[digest(reverified.token)].phase = 'MFA_REQUIRED'; });
    await assert.rejects(service.authenticate(reverified.token, { pending: true }), e => e.code === 'AUTH_SESSION_REVOKED');
  }
});

test('administrator promotion is immediate and demotion still revokes old sessions and derived grants', async t => {
  const { service } = await fixture(t);
  await initialize(service);
  const first = await login(service);
  const created = await service.createAccount(first.token, { login: 'second', displayName: 'Second' });
  await service.setPassword({ credential: created.credential, password: 'password2' });
  const ordinary = await service.login({ login: 'second', password: 'password2' });
  await assert.rejects(service.listAccounts(ordinary.token), e => e.code === 'AUTH_ADMIN_REQUIRED');
  assert.equal((await service.updateAccount(first.token, created.account.id, { admin: true })).admin, true);
  await assert.rejects(service.authenticate(ordinary.token), e => e.code === 'AUTH_SESSION_REVOKED');
  const second = await service.login({ login: 'second', password: 'password2' });
  assert.equal(second.state, 'AUTHENTICATED');
  assert.equal((await service.listAccounts(second.token)).length, 2);
  await service.updateAccount(second.token, first.account.id, { admin: false });
  await assert.rejects(service.authenticate(first.token), e => e.code === 'AUTH_SESSION_REVOKED');
  await assert.rejects(service.listAccounts((await login(service)).token), e => e.code === 'AUTH_ADMIN_REQUIRED');
});

test('terminal recovery no longer requires enrollment, while trust, confirmation and source restore barriers remain mandatory', async t => {
  const { service, db } = await fixture(t);
  await service.enterRecovery({ requestedBy: 'DEPLOYMENT' });
  await assert.rejects(service.finishRecovery({ requestedBy: 'DEPLOYMENT', confirmed: true }), e => e.code === 'AUTH_RECOVERY_ADMIN_REQUIRED');
  await service.trustRecoveryAdmin({ login: 'admin', displayName: 'Admin', password: 'password1', requestedBy: 'DEPLOYMENT' });
  const session = await login(service);
  assert.equal(session.state, 'AUTHENTICATED');
  assert.equal((await service.authenticate(session.token)).restrictedRestore, true);
  await assert.rejects(service.finishRecovery({ requestedBy: 'DEPLOYMENT' }), e => e.code === 'AUTH_RECOVERY_CONFIRMATION_REQUIRED');
  await db.query("INSERT INTO organization(id,name) VALUES('ORG','Organization')");
  await db.query("INSERT INTO tenant(id,organization_id,name) VALUES('TENANT','ORG','Tenant')");
  await db.query("INSERT INTO project(id,tenant_id,name) VALUES('RESTORED','TENANT','Restored')");
  await db.query("INSERT INTO source_truth_workspace(workspace_id,tenant_id,restore_ready) VALUES('RESTORED','TENANT',false)");
  await assert.rejects(service.finishRecovery({ requestedBy: 'DEPLOYMENT', confirmed: true }), e => e.code === 'AUTH_SOURCE_RESTORE_UNVERIFIED');
  await db.query("UPDATE source_truth_workspace SET restore_ready=true WHERE workspace_id='RESTORED'");
  await service.finishRecovery({ requestedBy: 'DEPLOYMENT', confirmed: true });
  assert.equal((await service.authenticate(session.token)).restrictedRestore, false);
});

test('program identities cannot acquire person privileges or replace the last human administrator', async t => {
  const { service, repo } = await fixture(t);
  await initialize(service);
  const admin = await login(service);
  const request = await service.apply(admin.token, { kind: 'CREATE', name: 'Automation', reason: 'Worker', operationId: 'automation' });
  const space = await service.decide(admin.token, request.id, { approve: true, version: 1 });
  const program = await service.createProgram(admin.token, { displayName: 'Worker', operations: ['READ'], workspaceIds: [space.workspaceId], expiresAt: 1800000100000 });
  await assert.rejects(service.updateAccount(admin.token, program.account.id, { admin: true, globalConfig: true }), e => e.code === 'AUTH_ACCOUNT_NOT_FOUND');
  await assert.rejects(service.recoverAccount(admin.token, program.account.id), e => e.code === 'AUTH_ACCOUNT_NOT_FOUND');
  assert.equal((await repo.read()).accounts[program.account.id].admin, false);
  // Even imported invalid program flags never count as another usable administrator.
  await repo.change(s => { s.accounts[program.account.id].admin = true; });
  await assert.rejects(service.updateAccount(admin.token, admin.account.id, { admin: false }), e => e.code === 'AUTH_LAST_ADMIN');
});

test('upgrade removes obsolete factors and pending enrollments without changing passwords, sessions or demoted privileges', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'traqen-f008-before-password-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of await readdir(migrations)) if (name.endsWith('.sql') && name < '0040') await copyFile(join(migrations, name), join(directory, name));
  const { db, repo, service } = await fixture(t, directory);
  const account = await initialize(service);
  const password = (await repo.read()).accounts[account.id].password;
  await repo.change(s => {
    Object.assign(s.accounts[account.id], { admin: false, adminRequested: true, totp: { recoveryCodes: ['digest'] } });
    s.accounts.demoted = { id: 'demoted', login: 'demoted', kind: 'HUMAN', status: 'ACTIVE', admin: false, adminRequested: false, totp: {} };
    s.accounts.program = { id: 'program', login: 'program', kind: 'PROGRAM', status: 'ACTIVE', admin: false, adminRequested: true };
    s.sessions.pending = { accountId: account.id, phase: 'MFA_ENROLLMENT_REQUIRED', enrollment: { secret: {}, recoveryCodes: ['digest'] } };
    s.sessions.active = { accountId: account.id, phase: 'AUTHENTICATED', revoked: false };
  });
  await applyMigrations(db, migrations);
  const state = await repo.read();
  assert.equal(state.accounts[account.id].admin, true);
  assert.deepEqual(state.accounts[account.id].password, password);
  assert.equal(state.accounts.demoted.admin, false);
  assert.equal(state.accounts.program.admin, false);
  for (const account of Object.values(state.accounts)) {
    assert.equal('totp' in account, false);
    assert.equal('adminRequested' in account, false);
  }
  assert.equal(state.sessions.pending.revoked, true);
  assert.equal('enrollment' in state.sessions.pending, false);
  assert.equal(state.sessions.active.revoked, false);
  assert.deepEqual(await applyMigrations(db, migrations), []);
});
