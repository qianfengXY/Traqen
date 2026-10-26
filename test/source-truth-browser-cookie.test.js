import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from 'node:http';
import { cookieBrowserFixture, cookieFixtureOrigin, fixtureCookieClient } from './support/source-truth-browser-cookie-fixture.js';
test('Cookie browser origin is explicit, loopback-only and cannot target production or credentials', () => {
    assert.equal(cookieFixtureOrigin('http://127.0.0.1:6266'), 'http://127.0.0.1:6266');
    for (const value of ['https://example.test', 'http://localhost:6266', 'http://127.0.0.1:3003', 'http://127.0.0.1:3004', 'http://127.0.0.1:3100', 'http://127.0.0.1:3188', 'http://127.0.0.1:6399', 'http://owner@127.0.0.1:6266', 'http://127.0.0.1:6266/api', 'http://127.0.0.1:6266/?secret=x'])
        assert.throws(() => cookieFixtureOrigin(value));
});
test('current native fixture starts unsealed, uses real Cookie/CSRF/Host, and reopens same SQL state', { skip: !process.env.F001_TEST_PG_BIN, timeout: 120000 }, async (t) => {
    const close = [];
    t.after(async () => { for (const fn of close.reverse())
        await fn(); });
    const f = await cookieBrowserFixture({ after: fn => close.push(fn) }, { webOrigin: 'http://127.0.0.1:6266' });
    const anonymous = fixtureCookieClient(f.apiBase, f.webOrigin);
    const status = await anonymous.request('/v1/auth/status');
    assert.equal(status.status, 200);
    assert.equal((await status.json()).initialized, true);
    const route = '/v1/workspaces/git/source-truth';
    assert.equal((await anonymous.request(route)).status, 401);
    const owner = await f.client();
    assert.equal((await owner.request(route)).status, 200);
    const draft = { expectedRevision: 0, input: { sources: [], baselineBundleId: null } };
    assert.equal((await owner.request(route + '/draft', 'PUT', draft, false)).status, 403, 'missing antiforgery must be denied');
    const retiredStatus = await new Promise((resolve, reject) => { const r = request(new URL(f.apiBase + route), { headers: { host: new URL(f.webOrigin).host, authorization: 'Bearer retired-shared-token' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); r.on('error', reject); r.end(); });
    assert.equal(retiredStatus, 401);
    assert.equal((await fetch(f.apiBase + '/v1/auth/status')).status, 403, 'real Host is still exact');
    const reader = await f.client('reader');
    assert.equal((await reader.request(route + '/draft', 'PUT', draft)).status, 403);
    for (const workspace of Object.keys(f.names)) {
        const state = await f.audit(workspace);
        assert.equal(state.bundles.length, 0);
        assert.equal(state.receipts.length, 0);
        assert.equal(state.runs.length, 0);
    }
    await f.restart();
    assert.equal((await (await f.client()).request(route)).status, 200);
    assert.equal((await f.audit('git')).bundles.length, 0);
    await f.setAccess('git', 'reader', []);
    assert.equal((await (await f.client('reader')).request(route)).status, 403);
});
