import assert from 'node:assert/strict';
import { startSource, openSourceVersion, acceptSourceGaps } from './source-truth-browser-controls.mjs';
import { cookieFixturePassword, directoryVersions } from './source-truth-browser-cookie-fixture.js';
// Reuse real user controls. OPFS below supplies actual FileSystemHandles, not
// an OS picker: the coverage report must keep those two claims separate.
export function cookieSourceControls(getPage, f, report, capture) {
    const station = async (n) => getPage().waitForFunction(n => document.querySelector('.st-rail [aria-current="step"]')?.dataset.station === String(n), n, { timeout: 45000 });
    const login = async (workspace, login = 'owner', query = '') => {
        const page = getPage();
        await page.goto(f.webOrigin + `/?page=sources&workspace=${workspace}${query}`);
        await page.getByLabel('账号', { exact: true }).fill(login);
        await page.getByLabel('密码', { exact: true }).fill(cookieFixturePassword);
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await page.locator('.st-workbench').waitFor();
        assert.equal(new URL(page.url()).searchParams.get('workspace'), workspace);
    };
    const select = async (workspace) => { await getPage().getByLabel('切换工作区', { exact: true }).selectOption(workspace); await station(1); };
    const picker = async (version, label) => {
        const page = getPage();
        await page.evaluate(async ({ files, label }) => {
            const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(label, { create: true });
            await root.getDirectoryHandle('empty', { create: true });
            for (const [name, text] of Object.entries(files)) {
                const parts = name.split('/');
                let directory = root;
                for (const part of parts.slice(0, -1))
                    directory = await directory.getDirectoryHandle(part, { create: true });
                const writer = await (await directory.getFileHandle(parts.at(-1), { create: true })).createWritable();
                await writer.write(text);
                await writer.close();
            }
            window.__ownedPickerCalls = 0;
            window.showDirectoryPicker = async () => { window.__ownedPickerCalls++; return root; };
        }, { files: directoryVersions[version], label });
    };
    const configure = async ({ git, directory }) => {
        const page = getPage();
        await station(1);
        assert.equal(await page.getByRole('button', { name: '继续配置范围', exact: true }).isDisabled(), true);
        if (git) {
            await page.getByRole('checkbox', { name: 'Git 仓库', exact: true }).check();
            await page.getByLabel('仓库 HTTPS 地址', { exact: true }).fill(f.source.url);
            await page.getByLabel('版本或分支', { exact: true }).fill(git);
        }
        if (directory)
            await page.getByRole('checkbox', { name: '上传目录', exact: true }).check();
        await page.getByRole('button', { name: '继续配置范围', exact: true }).click();
        await station(2);
    };
    const start = () => startSource(getPage(), station);
    const previewStations = async (workspace, label) => {
        const page = getPage(), states = [];
        for (const n of [1, 2, 3, 4, 5, 6, 7]) {
            await page.getByRole('button', { name: new RegExp(`^第 ${n} 站`) }).click();
            const value = await page.locator('.st-current').evaluate(n => ({ text: n.innerText, selected: n.querySelector('.st-eyebrow')?.textContent }));
            states.push({ station: n, readOnlyReplay: n !== 7, ...value });
        }
        await page.getByRole('button', { name: '回到当前 · 第 7 站', exact: true }).click();
        report.stationViews.push({ workspace, label, states });
    };
    const freeze = async (workspace, label, { gaps = false, loseResponse = false, newBundle = true } = {}) => {
        const page = getPage();
        await station(7);
        const before = await f.audit(workspace);
        assert.equal(before.runs.at(-1).status, 'REVIEW_REQUIRED');
        const detail = await f.read(workspace, `/runs/${before.runs.at(-1).id}/view`);
        assert.ok(detail.candidate);
        assert.equal(detail.result, null);
        assert.equal(await page.getByRole('button', { name: '冻结来源包', exact: true }).isDisabled(), true);
        await previewStations(workspace, label);
        await capture(label + '-review');
        if (gaps)
            await acceptSourceGaps(page, '当前Cookie旅程明确接受未取得的LFS外部正文');
        await page.getByRole('checkbox', { name: /^我已核对完整清单/ }).check();
        let release, seen;
        const gate = new Promise(r => { release = r; }), requested = new Promise(r => { seen = r; });
        const pattern = '**/runs/*/seal';
        await page.route(pattern, async (route) => { seen(); await gate; if (loseResponse) {
            const response = await route.fetch();
            assert.equal(response.status(), 200);
            await route.abort('failed');
        }
        else
            await route.continue(); });
        try {
            await page.getByRole('button', { name: '冻结来源包', exact: true }).click();
            await requested;
            const confirmed = await f.audit(workspace);
            assert.equal(confirmed.bundles.length, before.bundles.length);
            assert.equal(confirmed.receipts.length, before.receipts.length);
            report.prePublication.push({ workspace, label, bundles: confirmed.bundles.length, receipts: confirmed.receipts.length, run: detail.run.id, candidate: detail.candidate.id, confirmedButUnpublished: true });
        }
        finally {
            release();
        }
        await page.getByRole('heading', { name: '来源包已冻结', exact: true }).waitFor({ timeout: 45000 });
        await page.unroute(pattern);
        if (loseResponse) {
            await page.getByRole('button', { name: '查询最新状态', exact: true }).click();
            await page.getByRole('button', { name: '创建新版本', exact: true }).waitFor();
        }
        const after = await f.audit(workspace);
        assert.equal(after.bundles.length, before.bundles.length + (newBundle ? 1 : 0));
        assert.equal(after.receipts.length, before.receipts.length + 1);
        const version = (await f.read(workspace, '/history/bundles?limit=50')).items[0];
        const inventory = await f.read(workspace, `/bundles/${version.id}/inventory-history?receiptId=${version.latestReceipt.id}&limit=500`);
        assert.equal(inventory.nextCursor, null, 'this deliberately small fixture must fit one complete inventory page');
        assert.equal(inventory.items.length, Number(version.counts.fileCount) + Number(version.counts.directoryCount));
        assert.equal(new Set(inventory.items.map(row => `${row.componentId}:${row.entry.pathBytes}`)).size, inventory.items.length);
        assert.ok(inventory.items.every(row => ['VERIFIED', 'METADATA', 'EXTERNAL_GAP'].includes(row.disposition?.disposition)), 'every entry needs one terminal disposition');
        if (version.components.length === 2) {
            const sameName = inventory.items.filter(row => Buffer.from(row.entry.pathBytes, 'base64url').toString() === 'README.md');
            assert.equal(sameName.length, 2);
            assert.equal(new Set(sameName.map(row => row.componentId)).size, 2);
        }
        (report.inventoryChecks ??= []).push({ workspace, label, bundle: version.id, entries: inventory.items.length, exactlyOneDispositionPerLocator: true });
        assert.equal(after.runs.at(-1).status, 'SUCCEEDED');
        report.frozen.push({ workspace, label, run: detail.run.id, candidate: detail.candidate.id, bundle: version.id, receipt: version.latestReceipt.id, counts: version.counts, components: version.components, gapCount: version.latestReceipt.gapCount, expiresAt: version.latestReceipt.expiresAt, responseLossRecovered: loseResponse, events: after.events.filter(e => e.run_id === detail.run.id) });
        await capture(label + '-frozen');
        return version;
    };
    const version = async (id) => { await openSourceVersion(getPage(), id); await getPage().locator('.st-version-view').getByRole('tab', { name: '材料清单', exact: true }).click(); };
    const original = async (kind, expected, label) => {
        const page = getPage(), view = page.locator('.st-version-view');
        const row = view.locator('tbody tr').filter({ hasText: kind }).filter({ has: page.getByRole('button', { name: '查看材料详情 README.md', exact: true }) });
        await row.getByRole('button', { name: '查看材料详情 README.md', exact: true }).click();
        const inspector = page.getByRole('complementary', { name: '材料详情', exact: true });
        await inspector.getByRole('button', { name: '读取原文预览', exact: true }).click();
        await inspector.locator('.st-original').waitFor();
        assert.equal(await inspector.locator('.st-original').innerText(), expected);
        await capture(label);
        return { url: page.url(), text: expected };
    };
    const closeOriginal = () => getPage().getByRole('button', { name: '关闭材料详情', exact: true }).click();
    const compare = async (workspace, from, to, sourceId) => {
        const page = getPage(), view = page.locator('.st-version-view');
        await version(to);
        await view.getByRole('tab', { name: '版本历史', exact: true }).click();
        await view.getByRole('combobox', { name: '从哪个冻结包比较', exact: true }).selectOption(from);
        await view.getByRole('combobox', { name: '来源', exact: true }).selectOption(sourceId);
        const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/source-truth/delta') && r.status() === 200);
        await view.getByRole('button', { name: '比较文件级变化', exact: true }).click();
        const delta = await (await response).json();
        assert.equal(delta.comparable, true);
        report.deltas.push({ workspace, from, to, sourceId, ...delta });
        await capture(workspace + '-delta');
        return delta;
    };
    return { station, login, select, picker, configure, start, freeze, version, original, closeOriginal, compare };
}
