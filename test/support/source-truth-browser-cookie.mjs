import assert from 'node:assert/strict';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cookieBrowserFixture, directoryVersions } from './source-truth-browser-cookie-fixture.js';
import { cookieSourceControls } from './source-truth-browser-cookie-controls.mjs';
const [modulePath, executablePath, output, webOrigin, apiPort] = process.argv.slice(2);
assert.ok(modulePath && executablePath && path.isAbsolute(output));
await mkdir(output, { mode: 0o700 });
const cleanups = [], report = { scope: 'CURRENT_COOKIE_NATIVE_PG_REAL_UI_INGESTION_NOT_SCALE_MODEL_OR_PHYSICAL_BACKUP', status: 'RUNNING', nativePickerVerified: false, opfsHandlesVerified: false, scale100kBrowserVerified: false, stationViews: [], prePublication: [], frozen: [], deltas: [], requests: [], pageErrors: [], resources: [], screenshots: [], results: [] };
await writeFile(path.join(output, 'started.json'), JSON.stringify({ at: new Date().toISOString(), cwd: process.cwd(), pid: process.pid, webOrigin, apiPort: Number(apiPort) }, null, 2), { flag: 'wx', mode: 0o600 });
const progress = async (label, data = {}) => appendFile(path.join(output, 'progress.jsonl'), JSON.stringify({ at: new Date().toISOString(), label, ...data }) + '\n', { mode: 0o600 });
let f, browser, context, page;
const pending = [];
const browserProcesses = async () => {
    const session = await browser.newBrowserCDPSession();
    try {
        const { processInfo } = await session.send('SystemInfo.getProcessInfo');
        report.browserProcessIds = [...new Set([...(report.browserProcessIds ?? []), ...processInfo.map(process => Number(process.id))])];
    }
    finally {
        await session.detach();
    }
};
const observe = p => {
    p.on('pageerror', error => report.pageErrors.push(error.message));
    p.on('request', request => { const url = new URL(request.url()); if (!url.pathname.startsWith('/api/'))
        return; const body = request.postDataBuffer(), row = { method: request.method(), path: url.pathname, bytes: body?.length ?? null, bodyExposed: body !== null }; report.requests.push(row); pending.push(request.allHeaders().then(headers => Object.assign(row, { bytes: body?.length ?? (headers['content-length'] === undefined ? null : Number(headers['content-length'])), hasCookie: Boolean(headers.cookie), hasAntiforgery: Boolean(headers['x-traqen-csrf']), hasLegacyToken: Boolean(headers.authorization || headers['x-traqen-api-token']) })).catch(error => { row.observationError = { message: error.message, pageClosed: p.isClosed() }; })); });
};
const capture = async (label) => { const file = path.join(output, label + '.png'); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push({ label, file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') }); };
const bytes = workspace => report.requests.filter(r => r.path.includes(`/workspaces/${workspace}/source-truth/`) && /\/(complete-file|chunks)$/.test(r.path)).reduce((n, r) => { assert.ok(Number.isSafeInteger(r.bytes) && r.bytes >= 0, 'unknown File body size cannot count as zero'); return n + r.bytes; }, 0);
try {
    const resource = async () => { const value = await f.resources(); report.resources.push(value); await appendFile(path.join(output, 'resources.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n', { mode: 0o600 }); };
    f = await cookieBrowserFixture({ after: fn => cleanups.push(fn) }, { webOrigin, apiPort: Number(apiPort) });
    await resource();
    report.directoryManifests = f.directoryManifests;
    report.gitCommits = { A: f.source.commitA, gapA: f.gapCommit };
    for (const workspace of Object.keys(f.names)) {
        const state = await f.audit(workspace);
        assert.equal(state.bundles.length, 0);
        assert.equal(state.receipts.length, 0);
        assert.equal(state.runs.length, 0);
    }
    const { chromium } = await import(pathToFileURL(modulePath).href);
    browser = await chromium.launch({ executablePath, headless: true });
    cleanups.push(() => browser.close());
    await browserProcesses();
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    observe(page);
    report.browser = browser.version();
    const ui = cookieSourceControls(() => page, f, report, capture);
    await ui.login('git');
    await ui.station(1);
    await progress('real-cookie-login');
    await ui.configure({ git: f.source.commitA });
    const draft = await f.audit('git');
    assert.equal(draft.runs.length, 0);
    assert.equal(draft.bundles.length, 0);
    assert.equal(draft.receipts.length, 0);
    report.results.push({ case: 'draft-is-not-publication', workspace: 'git', drafts: draft.drafts.length, runs: 0, bundles: 0, receipts: 0 });
    await ui.start();
    const gitA = await ui.freeze('git', 'git-A');
    assert.equal(gitA.components[0].nativeIdentity.commit, f.source.commitA);
    assert.equal(gitA.components.length, 1);
    await progress('git-only-frozen', { bundle: gitA.id });
    await ui.select('directory');
    await ui.configure({ directory: true });
    await ui.start();
    await ui.station(4);
    const paused = (await f.read('directory')).activeRun;
    assert.equal(paused.status, 'WAITING_FOR_CLIENT');
    const resumeURL = page.url();
    await capture('directory-waiting-for-client');
    await Promise.all(pending);
    await page.close();
    await f.restart();
    await resource();
    page = await context.newPage();
    observe(page);
    await page.goto(resumeURL);
    await ui.station(4);
    assert.equal((await f.read('directory')).activeRun.id, paused.id);
    report.results.push({ case: 'same-run-after-page-close-api-and-postgres-restart', run: paused.id, url: resumeURL });
    await ui.picker('D1', 'owned-cookie-directory-D1');
    await page.getByRole('button', { name: '重新选择目录并继续', exact: true }).click();
    const d1 = await ui.freeze('directory', 'directory-D1', { loseResponse: true });
    assert.equal(d1.counts.fileCount, '5');
    assert.equal(d1.counts.directoryCount, '2');
    report.opfsHandlesVerified = true;
    await ui.version(d1.id);
    await ui.original('DIRECTORY_UPLOAD', directoryVersions.D1['README.md'], 'directory-D1-original');
    await ui.closeOriginal();
    await page.getByRole('button', { name: '从选中的冻结包创建新版本', exact: true }).click();
    await ui.station(2);
    await page.getByRole('combobox', { name: '本版处理', exact: true }).selectOption('UPDATE');
    await ui.picker('D2', 'owned-cookie-directory-D2');
    await page.getByRole('button', { name: /^(选择本机目录|重新选择目录)$/ }).click();
    await Promise.all(pending);
    const beforeD2 = bytes('directory'), beforeD2Writes = f.blobWrites.length;
    await ui.start();
    const d2 = await ui.freeze('directory', 'directory-D2');
    await Promise.all(pending);
    const transferred = bytes('directory') - beforeD2, expected = Buffer.byteLength(directoryVersions.D2['README.md']) + Buffer.byteLength(directoryVersions.D2['added.txt']);
    assert.equal(transferred, expected);
    const directoryWrites = f.blobWrites.slice(beforeD2Writes);
    assert.equal(directoryWrites.reduce((n, r) => n + r.streamBytes, 0), expected);
    const delta = await ui.compare('directory', d1.id, d2.id, d2.components[0].sourceId);
    assert.ok(delta.items.some(i => Buffer.from(i.pathBytes, 'base64url').toString() === 'deleted.txt' && i.change === 'DELETED'));
    report.results.push({ case: 'directory-D1-to-D2-complete-enumeration-missing-bytes-only', from: d1.id, to: d2.id, transferred, expectedMissingBytes: expected, actualCasStreams: directoryWrites, explicitDeletion: true });
    await ui.version(d1.id);
    await ui.original('DIRECTORY_UPLOAD', directoryVersions.D1['README.md'], 'directory-old-version-still-original');
    await ui.closeOriginal();
    await progress('directory-two-versions', { d1: d1.id, d2: d2.id });
    await ui.select('combined');
    await ui.picker('D1', 'owned-cookie-combined-D1');
    await ui.configure({ git: f.gapCommit, directory: true });
    await page.getByRole('button', { name: '选择本机目录', exact: true }).click();
    await ui.start();
    const c1 = await ui.freeze('combined', 'combined-A-D1', { gaps: true });
    assert.equal(c1.components.length, 2);
    assert.equal(c1.latestReceipt.status, 'READY_WITH_ACCEPTED_GAPS');
    assert.equal(c1.latestReceipt.gapCount, '1');
    assert.ok(c1.latestReceipt.expiresAt);
    const oldDirectory = c1.components.find(c => c.kind === 'DIRECTORY_UPLOAD');
    await ui.version(c1.id);
    await ui.original('GIT', 'fixture version A\n', 'combined-git-A-original');
    await ui.closeOriginal();
    await ui.original('DIRECTORY_UPLOAD', directoryVersions.D1['README.md'], 'combined-directory-original');
    await ui.closeOriginal();
    const commitB = await f.source.update();
    report.gitCommits.B = commitB;
    await page.getByRole('button', { name: '从选中的冻结包创建新版本', exact: true }).click();
    await ui.station(2);
    const gitCard = page.locator('.st-source-card').filter({ has: page.getByRole('checkbox', { name: 'Git 仓库', exact: true }) });
    await gitCard.getByRole('combobox', { name: '本版处理', exact: true }).selectOption('UPDATE');
    await gitCard.getByLabel('版本或分支', { exact: true }).fill(commitB);
    const dirCard = page.locator('.st-source-card').filter({ has: page.getByRole('checkbox', { name: '上传目录', exact: true }) });
    assert.equal(await dirCard.getByRole('combobox', { name: '本版处理', exact: true }).inputValue(), 'REUSE');
    assert.equal(await dirCard.getByRole('button', { name: /选择.*目录/ }).count(), 0);
    await page.evaluate(() => { window.showDirectoryPicker = async () => { throw Error('REUSE must not ask for the original directory'); }; });
    await Promise.all(pending);
    const beforeReuse = bytes('combined'), beforeReads = f.gitReads.length, beforeWrites = f.blobWrites.length;
    await ui.start();
    const c2 = await ui.freeze('combined', 'combined-B-keep-D1', { gaps: true });
    await Promise.all(pending);
    assert.equal(c2.components.find(c => c.kind === 'DIRECTORY_UPLOAD').id, oldDirectory.id);
    assert.equal(bytes('combined'), beforeReuse);
    const objectReads = f.gitReads.slice(beforeReads);
    assert.ok(objectReads.length >= 2);
    assert.deepEqual(objectReads.at(-1).paths, ['README.md']);
    const missingWrites = f.blobWrites.slice(beforeWrites);
    assert.equal(missingWrites.length, 1);
    assert.equal(missingWrites[0].digest, createHash('sha256').update('fixture version B\n').digest('hex'));
    report.results.push({ case: 'git-A-to-B-directory-D1-explicit-reuse', from: c1.id, to: c2.id, directoryComponent: oldDirectory.id, directoryBytesSent: 0, gitLocalVerificationAndMissingReads: objectReads, encryptedCasMissingWrites: missingWrites });
    await ui.version(c1.id);
    await ui.original('GIT', 'fixture version A\n', 'combined-historical-A-unchanged');
    await ui.closeOriginal();
    await ui.version(c2.id);
    await ui.original('GIT', 'fixture version B\n', 'combined-B-original');
    const fixed = page.url();
    await page.reload();
    await page.locator('.st-version-view').waitFor();
    assert.equal(page.url(), fixed);
    assert.ok((await page.locator('.st-version-view').innerText()).includes(c2.latestReceipt.id));
    await progress('combined-two-versions', { c1: c1.id, c2: c2.id });
    await Promise.all(pending);
    await context.close();
    await f.stopSources();
    await f.restart();
    await resource();
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    observe(page);
    await ui.login('combined', 'owner', `&bundleId=${c2.id}&receiptId=${c2.latestReceipt.id}`);
    await page.evaluate(() => { window.showDirectoryPicker = async () => { throw Error('Original directory offline'); }; });
    await ui.original('GIT', 'fixture version B\n', 'offline-restarted-git-original');
    await ui.closeOriginal();
    await ui.original('DIRECTORY_UPLOAD', directoryVersions.D1['README.md'], 'offline-restarted-directory-original');
    await ui.closeOriginal();
    const offlineURL = page.url();
    await page.reload();
    await page.locator('.st-version-view').waitFor();
    assert.equal(page.url(), offlineURL);
    report.results.push({ case: 'original-git-offline-and-directory-context-closed-native-PG-and-storage-reopen', bundle: c2.id, receipt: c2.latestReceipt.id, exactRefresh: true });
    const readerContext = await browser.newContext();
    const ownerPage = page;
    page = await readerContext.newPage();
    observe(page);
    await ui.login('combined', 'reader', `&bundleId=${c1.id}&receiptId=${c1.latestReceipt.id}`);
    await page.getByText('当前成员为只读权限，可查看历史与证据，不能创建任务、上传、确认或冻结。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '从选中的冻结包创建新版本', exact: true }).count(), 0);
    await ui.original('GIT', 'fixture version A\n', 'reader-old-original');
    await readerContext.close();
    page = ownerPage;
    await ui.original('GIT', 'fixture version B\n', 'before-revocation-original');
    await f.setAccess('combined', 'owner', []);
    await page.getByRole('heading', { name: '来源访问尚未就绪', exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await page.locator('.st-original').count(), 0);
    assert.equal(await page.locator('.st-version-view').count(), 0);
    assert.equal(await page.getByRole('heading', { name: '尚无冻结来源版本', exact: true }).count(), 0);
    await capture('revocation-not-empty');
    await f.setAccess('combined', 'owner', ['MAINTAIN']);
    await page.reload();
    await page.locator('.st-version-view').waitFor();
    await ui.original('GIT', 'fixture version B\n', 'restored-exact-read');
    await f.revokeOtherOwnerSessions();
    await page.getByLabel('账号', { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await page.locator('.st-original').count(), 0);
    assert.equal(await page.locator('.st-workbench').count(), 0);
    await capture('session-revoked-not-empty');
    report.results.push({ case: 'current-readonly-grants-revocation-and-session-invalidation', readOnlyPreservesHistory: true, revocationClearsBody: true, sessionInvalidationClearsWorkspace: true });
    report.persisted = {};
    for (const [workspace, count] of [['git', 1], ['directory', 2], ['combined', 2]]) {
        const state = await f.audit(workspace);
        assert.equal(state.bundles.length, count);
        assert.equal(state.receipts.length, count);
        assert.ok(state.runs.every(r => r.status === 'SUCCEEDED'));
        report.persisted[workspace] = state;
    }
    await Promise.all(pending);
    assert.deepEqual(report.pageErrors, []);
    assert.equal(report.requests.some(r => r.hasLegacyToken), false);
    const sourceWrites = report.requests.filter(r => r.path.includes('/source-truth/') && !['GET', 'OPTIONS'].includes(r.method));
    assert.ok(sourceWrites.length > 0);
    assert.ok(sourceWrites.every(r => r.hasCookie && r.hasAntiforgery));
    const analysisRequests = report.requests.filter(r => /analysis|extract|investigat/.test(r.path));
    // The shared shell reads the task list; reading it is not model execution.
    report.analysisObservationReads = analysisRequests.filter(r => r.method === 'GET');
    assert.ok(analysisRequests.every(r => r.method === 'GET' && /^\/api\/v1\/projects\/[^/]+\/workspace-analysis-jobs$/.test(r.path)), 'no model/analysis execution request is permitted');
    report.status = 'PASSED';
}
catch (error) {
    report.status = 'FAILED';
    report.failure = { message: error.message, stack: error.stack };
    await writeFile(path.join(output, 'failure.json'), JSON.stringify(report.failure, null, 2), { flag: 'wx', mode: 0o600 });
    if (page) {
        await capture('failure').catch(() => { });
        report.aria = await page.locator('body').ariaSnapshot().catch(() => null);
    }
}
finally {
    if (browser?.isConnected()) {
        try { await browserProcesses(); }
        catch (error) { (report.cleanupErrors ??= []).push(error.message); report.status = 'FAILED'; }
    }
    for (const close of cleanups.reverse())
        try {
            await close();
        }
        catch (error) {
            (report.cleanupErrors ??= []).push(error.message);
            report.status = 'FAILED';
        }
    await Promise.all(pending);
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, results: report.results.length, frozen: report.frozen.length, failure: report.failure?.message, cleanupErrors: report.cleanupErrors }));
}
if (report.status !== 'PASSED')
    process.exitCode = 1;
