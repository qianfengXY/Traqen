// Current F008 password/Cookie boundary, native isolated PostgreSQL and owned
// HTTPS Git. Seed accounts/projects only: NO draft, run, candidate or publication.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { isolatedPostgres } from './source-truth-postgres.js';
import { gitFixture } from './source-truth-git-fixture.js';
import { SourceTruthRepository } from '../../src/source-truth/repository.js';
import { SourceTruthBlobStore } from '../../src/source-truth/blob-store.js';
import { GitSourceGateway } from '../../src/source-truth/git-gateway.js';
import { sourceTruthServices } from '../../src/source-truth/services.js';
import { capturePolicy } from '../../src/source-truth/policy.js';
import { SourceTruthWorker } from '../../src/source-truth/worker.js';
import { createSourceTruthHttpHandler } from '../../src/source-truth/http-handler.js';
import { AuthService } from '../../src/auth/service.js';
import { AuthRepository } from '../../src/auth/repository.js';
import { AuthHttp } from '../../src/auth/http.js';
import { createConfiguredApplication } from '../../src/api/application-bootstrap.js';
import { createTraceabilityHttpServer } from '../../src/api/http-server.js';
import { PostgresTraceabilityStore } from '../../src/storage/index.js';
export const cookieFixturePassword = 'owned-eight-station-password1';
export const directoryVersions = {
    D1: { 'README.md': 'directory version D1\n', 'unchanged.txt': 'unchanged bytes\n', 'deleted.txt': 'explicitly deleted in D2\n', 'zero.txt': '', 'deep/copy.txt': 'unchanged bytes\n' },
    D2: { 'README.md': 'directory version D2\n', 'unchanged.txt': 'unchanged bytes\n', 'added.txt': 'new D2 bytes\n', 'zero.txt': '', 'deep/copy.txt': 'unchanged bytes\n' },
};
export function cookieFixtureOrigin(value) {
    const url = new URL(value), port = Number(url.port);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !Number.isInteger(port) || port < 1024 || port > 65535
        || [3003, 3004, 3100, 3188, 5432, 6398, 6399].includes(port) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
        throw Error('An explicit dedicated loopback Web origin is required');
    return url.origin;
}
export function fixtureCookieClient(apiBase, webOrigin) {
    const jar = new Map();
    let proof = '';
    const request = async (route, method = 'GET', body, antiforgery = true) => {
        // Node fetch may discard a caller-supplied Host. Exercise the same exact
        // Host as the frontend gateway with native HTTP, never loosen AuthHttp.
        const response = await new Promise((resolve, reject) => {
            const request = httpRequest(new URL(apiBase + route), { method, headers: { host: new URL(webOrigin).host, origin: webOrigin,
                    ...(jar.size ? { cookie: [...jar].map(([k, v]) => k + '=' + v).join('; ') } : {}),
                    ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(proof && antiforgery ? { 'x-traqen-csrf': proof } : {}) } }, res => {
                const chunks = [];
                let bytes = 0;
                res.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) {
                    res.destroy(Error('Bounded fixture control response exceeded'));
                    return;
                } chunks.push(chunk); });
                res.on('error', reject);
                res.on('end', () => { const headers = new Headers(); for (const [name, value] of Object.entries(res.headers))
                    for (const item of Array.isArray(value) ? value : [value])
                        if (item !== undefined)
                            headers.append(name, item); resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers })); });
            });
            request.on('error', reject);
            request.end(body === undefined ? undefined : JSON.stringify(body));
        });
        for (const value of response.headers.getSetCookie()) {
            const [pair] = value.split(';'), i = pair.indexOf('=');
            jar.set(pair.slice(0, i), pair.slice(i + 1));
        }
        return response;
    };
    return { request, async login(login = 'owner') {
            const pre = await request('/v1/auth/csrf');
            assert.equal(pre.status, 200);
            proof = (await pre.json()).csrfToken;
            const response = await request('/v1/auth/login', 'POST', { login, password: cookieFixturePassword, device: 'isolated-harness-audit' });
            assert.equal(response.status, 200);
            const result = await response.json();
            proof = result.csrfToken;
            return result;
        } };
}
export async function cookieBrowserFixture(t, { webOrigin, apiPort = 0 } = {}) {
    webOrigin = cookieFixtureOrigin(webOrigin);
    if (!Number.isInteger(apiPort) || apiPort < 0 || apiPort > 65535 || apiPort && ([3003, 3004, 3100, 3188, 5432, 6398, 6399, Number(new URL(webOrigin).port)].includes(apiPort) || apiPort < 1024))
        throw Error('An owned non-production API port is required');
    const cleanups = [], register = { after: fn => cleanups.push(fn) };
    let current = null, cluster, sourceStop, closed = false;
    const stop = async () => {
        if (!current)
            return;
        const old = current;
        current = null;
        try {
            old.server.closeAllConnections();
            await new Promise((resolve, reject) => old.server.close(error => error ? reject(error) : resolve()));
        }
        finally {
            await old.worker.stop();
        }
    };
    const close = async () => {
        if (closed)
            return;
        closed = true;
        const errors = [];
        // Always attempt every owned cleanup, even if an earlier resource failed.
        for (const cleanup of [stop, ...cleanups.toReversed()])
            try {
                await cleanup();
            }
            catch (error) {
                errors.push(error);
            }
        if (errors.length)
            throw new AggregateError(errors, 'Owned Cookie fixture cleanup failed');
    };
    t.after(close);
    try {
        cluster = await isolatedPostgres(register);
        const initial = await cluster.createDatabase();
        let db = initial.db;
        const names = { git: 'Cookie Git', directory: 'Cookie Directory', combined: 'Cookie Combined' };
        for (const [id, name] of Object.entries(names)) {
            await db.query("INSERT INTO project(id,tenant_id,name) VALUES($1,'tenant',$2)", [id, name]);
            await initial.repository.provision(id, { tenantId: 'tenant', grants: [{ actorId: 'owner', role: 'MAINTAIN' }, { actorId: 'reader', role: 'READ' }] });
        }
        const source = await gitFixture({ after: fn => { let done = false; sourceStop = async () => { if (!done) {
                done = true;
                await fn();
            } }; cleanups.push(sourceStop); } });
        await writeFile(path.join(source.work, 'external.bin'), `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 12\n`);
        await source.git('add', '.');
        await source.git('commit', '-m', 'bounded external material gap');
        await source.git('push', path.join(source.root, 'repo.git'), 'main');
        const gapCommit = await source.git('rev-parse', 'HEAD');
        const root = await mkdtemp(path.join(tmpdir(), 'tq-f001-cookie-browser-')), key = Buffer.alloc(32, 79), blobKey = Buffer.alloc(32, 29), gitReads = [], blobWrites = [], directoryManifests = {};
        for (const [version, files] of Object.entries(directoryVersions)) {
            const rows = [];
            for (const [entryPath, content] of Object.entries(files)) {
                const target = path.join(root, 'directories', version, entryPath);
                await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
                await writeFile(target, content, { flag: 'wx', mode: 0o600 });
                rows.push({ path: entryPath, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') });
            }
            await mkdir(path.join(root, 'directories', version, 'empty'), { mode: 0o700 });
            directoryManifests[version] = rows;
        }
        const policy = capturePolicy({ gitTargets: source.targets });
        const identity = new AuthService({ repository: new AuthRepository(db), key });
        const admin = await identity.initialize({ login: 'admin', displayName: 'Isolated administrator', password: cookieFixturePassword });
        const adminSession = await identity.login({ login: 'admin', password: cookieFixturePassword }), accounts = {};
        for (const login of ['owner', 'reader']) {
            const made = await identity.createAccount(adminSession.token, { login, displayName: `Isolated ${login}` });
            await identity.setPassword({ credential: made.credential, password: cookieFixturePassword });
            accounts[login] = made.account;
        }
        await identity.migrate({ bindings: ['owner', 'reader'].map(principalId => ({ principalId, accountId: accounts[principalId].id })),
            owners: Object.keys(names).map(workspaceId => ({ workspaceId, accountId: admin.id })),
            grants: Object.keys(names).flatMap(workspaceId => ['owner', 'reader'].map(login => ({ workspaceId, accountId: accounts[login].id, roles: [login === 'owner' ? 'MAINTAIN' : 'READ'] }))), confirmed: true, requestedBy: 'DEPLOYMENT' });
        const start = async (port = apiPort) => {
            const identity = new AuthService({ repository: new AuthRepository(db), key }), repository = new SourceTruthRepository(db, { identityService: identity });
            const blobs = await SourceTruthBlobStore.open({ root: path.join(root, 'bytes'), keyVersion: 'fixture', keys: { fixture: blobKey } });
            const put = blobs.putBlob.bind(blobs);
            blobs.putBlob = async (scope, item, stream, options) => { let bytes = 0; const measured = async function* () { for await (const chunk of stream) {
                bytes += chunk.length;
                yield chunk;
            } }; const result = await put(scope, item, measured(), options); blobWrites.push({ workspaceId: scope.workspaceId, digest: item.digest, sizeBytes: item.sizeBytes, streamBytes: bytes }); return result; };
            const git = new GitSourceGateway({ cacheRoot: path.join(root, 'git'), targets: source.targets });
            const read = git.readBlobs.bind(git);
            git.readBlobs = async function* (snapshot, entries, options) { gitReads.push({ commit: snapshot.commit, paths: entries.map(e => Buffer.from(e.pathBytes, 'base64url').toString('utf8')), oids: entries.map(e => e.expectedContent.oid) }); yield* read(snapshot, entries, options); };
            const services = sourceTruthServices({ repository, blobs, policy, git });
            const worker = new SourceTruthWorker(services);
            services.dispatch = () => worker.dispatch();
            const configured = createConfiguredApplication({ store: new PostgresTraceabilityStore(db), env: {} });
            await configured.ready;
            const server = createTraceabilityHttpServer({ application: configured.application, auth: new AuthHttp({ service: identity, origin: webOrigin, development: true }),
                sourceTruthAllowedOrigins: [webOrigin], sourceTruthHandler: createSourceTruthHttpHandler({ services, allowedOrigins: [webOrigin], authenticate: () => { throw Error('Current Cookie session context is required'); } }) });
            await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
            current = { db, identity, services, server, worker };
            worker.start();
            return `http://127.0.0.1:${server.address().port}`;
        };
        const apiBase = await start(), clients = new Map();
        const client = async (login = 'owner') => { if (!clients.has(login)) {
            const value = fixtureCookieClient(apiBase, webOrigin);
            await value.login(login);
            clients.set(login, value);
        } return clients.get(login); };
        const audit = async (workspace) => {
            assert.ok(Object.hasOwn(names, workspace));
            const rows = async (sql) => (await db.query(sql, [workspace])).rows;
            return { drafts: await rows('SELECT revision,input FROM source_truth_draft WHERE workspace_id=$1 ORDER BY revision'),
                runs: await rows('SELECT id,status,station,progress,input FROM source_truth_run WHERE workspace_id=$1 ORDER BY created_at'),
                bundles: await rows('SELECT id,payload FROM source_truth_bundle WHERE workspace_id=$1 ORDER BY published_at,id'),
                receipts: await rows('SELECT id,bundle_id,payload FROM source_truth_receipt WHERE workspace_id=$1 ORDER BY issued_at,id'),
                events: await rows('SELECT run_id,event_type,payload FROM source_truth_event WHERE workspace_id=$1 ORDER BY sequence') };
        };
        return { root, names, source, gapCommit, apiBase, webOrigin, accounts, audit, client, gitReads, blobWrites, directoryManifests,
            get runtime() { return current; },
            async read(workspace, route = '', login = 'owner') { assert.ok(Object.hasOwn(names, workspace)); const response = await (await client(login)).request(`/v1/workspaces/${workspace}/source-truth${route}`); assert.equal(response.status, 200, `fixture audit read ${route}`); return response.json(); },
            async restart() { const port = current.server.address().port; await stop(); await cluster.restart(); db = cluster.pool(initial.name); await start(port); clients.clear(); },
            stopSources: () => sourceStop(),
            async setAccess(workspace, login, roles) { assert.ok(Object.hasOwn(names, workspace) && Object.hasOwn(accounts, login)); const admin = await current.identity.login({ login: 'admin', password: cookieFixturePassword }); return current.identity.grant(admin.token, workspace, { accountId: accounts[login].id, roles }); },
            async revokeOtherOwnerSessions() { const session = await current.identity.login({ login: 'owner', password: cookieFixturePassword }); await current.identity.revokeSession(session.token, 'others'); clients.delete('owner'); },
            async resources() { return { pid: process.pid, apiBase, webOrigin, postgresRoot: cluster.root, postgresPid: Number((await readFile(path.join(cluster.data, 'postmaster.pid'), 'utf8')).split('\n')[0]), sourceOrigin: source.origin, storageRoot: root }; }, close };
    }
    catch (error) {
        await close();
        throw error;
    }
}
