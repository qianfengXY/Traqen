import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sessionEvidenceFixture, isolatedPassword } from './f002-session-fixture.js';
import { verifyNativeSourceReflow } from './f001-native-responsive-checks.mjs';

const [modulePath, executablePath, output, nativeExecutablePath, phase = 'all'] = process.argv.slice(2);
if (!modulePath || !executablePath || !output) throw Error('Expected Playwright module, owned browser binary and new evidence directory');
assert.ok(['all','journey'].includes(phase),'Select all checks or the explicit continuation journey');
await mkdir(output, { recursive: true });
const report = { scope: 'CURRENT_BRANCH_REAL_SESSION_F001_LAYOUT_NOT_PRODUCTION_OR_MODEL_ACCEPTANCE', phase, results: [], sweep: [], pageErrors: [], mutations: [] };
let fixture, browser, page;
const screenshot = async name => {
  const file = path.join(output, `${name}.png`);
  await page.screenshot({ path: file });
  return { file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') };
};
try {
  const longPath='长路径参考材料'.repeat(8)+'.md';
  const longOriginal='Synthetic layout material only.\n'+'合成原文长行'.repeat(120)+'\n';
  fixture = await sessionEvidenceFixture({ port: 6225, origin: 'http://127.0.0.1:6226', additionalFiles:[{entryPath:longPath,content:longOriginal}] });
  const { chromium } = await import(pathToFileURL(modulePath).href);
  browser = await chromium.launch({ executablePath, headless: true });
  page = await browser.newPage({ viewport: { width: 800, height: 1000 }, reducedMotion: 'reduce' });
  report.browser = browser.version();
  page.on('pageerror', e => report.pageErrors.push(e.message));
  page.on('request', request => {
    if (!['GET', 'OPTIONS'].includes(request.method())) report.mutations.push({ method: request.method(), path: new URL(request.url()).pathname });
  });
  await page.goto('http://127.0.0.1:6226/?page=sources&workspace=workspace');
  await page.getByLabel('账号', { exact: true }).fill('owner');
  await page.getByLabel('密码', { exact: true }).fill(isolatedPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.st-workbench').waitFor();
  await page.getByRole('button', { name: '查看冻结版本', exact: true }).click();
  await page.locator('.st-version-view').waitFor();
  const text = await page.locator('.st-version-view').innerText();
  assert.ok(text.includes(fixture.metadata.bundleId), 'the selected exact bundle is shown');
  const selected = await page.locator('.st-version-view').innerText();
  if (phase === 'all') {
  const views = [[800,1000],[761,600],[820,560],[860,900],[861,600],[760,1000],[390,844],[1024,768],[1280,800],[1366,768],[1440,900],[1920,1080],[2560,1440],[3440,1440],[1600,600],[900,1400]];
  for (const theme of ['light','dark']) {
    if (theme === 'dark') {
      await page.setViewportSize({ width:1440, height:900 });
      await page.getByRole('combobox', { name: '全局主题配色', exact: true }).selectOption(theme);
    }
    for (const [width,height] of views) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(() => { window.scrollTo(0,0); document.querySelector('.main').scrollTo(0,0); });
      const geometry = await page.evaluate(() => {
        const rect = selector => { const e=document.querySelector(selector),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,font:s.fontSize,transform:s.transform,display:s.display}; };
        return {viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,frame:rect('.desktop-frame'),sidebar:rect('.sidebar'),main:rect('.main'),content:rect('#product-content'),selectedNav:document.querySelectorAll('.nav [aria-current="page"]').length};
      });
      const image = await screenshot(`${theme}-${width}x${height}`);
      report.results.push({ theme, width, height, geometry, image });
      assert.ok(geometry.main.y < height / 2, `main work must be present in the first viewport at ${width}x${height}; got y=${geometry.main.y}`);
      assert.ok(Math.abs(geometry.frame.width-width)<2, `the shell uses available width at ${width}x${height}`);
      assert.ok(geometry.documentWidth<=width+1, `only local data areas may overflow at ${width}x${height}`);
      assert.ok(geometry.main.scrollWidth<=geometry.main.clientWidth+1, `the work surface must not require horizontal page scrolling at ${width}x${height}`);
      assert.equal(geometry.selectedNav,1);
      assert.ok((await page.locator('.st-version-view').innerText()).includes(fixture.metadata.bundleId));
    }
  }
  assert.ok(selected.includes(fixture.metadata.bundleId));
  // Sweep width and height separately, including both sides of every active
  // shell/source breakpoint; screenshots above are the representative views.
  report.sweep=[];
  const widths=[360,390,640,720,759,760,761,780,800,820,840,859,860,861,900,1024,1099,1100,1101,1180,1280,1366,1439,1440,1600,1920,2560,3440];
  for(const width of widths)for(const height of [360,600,899,900,1000]) {
    await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('.main').scrollTo(0,0);});
    const state=await page.evaluate(()=>{const main=document.querySelector('.main');return {width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,frameWidth:document.querySelector('.desktop-frame').getBoundingClientRect().width,mainY:main.getBoundingClientRect().y,mainWidth:main.clientWidth,mainScrollWidth:main.scrollWidth};});
    report.sweep.push(state);assert.ok(state.mainY<height/2);assert.ok(state.pageWidth<=width+1);assert.ok(Math.abs(state.frameWidth-width)<2);assert.ok(state.mainScrollWidth<=state.mainWidth+1);
  }
  }
  await page.setViewportSize({width:820,height:560});
  const search=page.getByLabel('路径搜索',{exact:true});
  await search.fill('长路径'.repeat(20)+'.opaque');await page.getByRole('button',{name:'搜索清单',exact:true}).click();
  await page.getByText('当前筛选匹配 0 项 · 本页 0 项',{exact:true}).waitFor();
  await page.getByRole('button',{name:'清除筛选',exact:true}).click();
  await page.getByRole('button',{name:'查看材料详情 evidence-sentinel.js',exact:true}).click();
  const inspector=page.getByRole('complementary',{name:'材料详情',exact:true});
  await inspector.getByRole('button',{name:'读取原文预览',exact:true}).click();
  await inspector.locator('pre').waitFor();assert.equal(await inspector.locator('pre').textContent(),fixture.source.bytes.toString());
  await inspector.press('Escape');
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:`查看材料详情 ${longPath}`,exact:true}).click();
  await inspector.getByRole('button',{name:'读取原文预览',exact:true}).click();
  await inspector.locator('pre').waitFor();assert.equal(await inspector.locator('pre').textContent(),longOriginal);
  await inspector.locator('pre').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  report.material={originalRead:true,longSearchEmptyState:true,exactDigest:fixture.metadata.originalDigest,longPathBytes:Buffer.byteLength(longPath),longOriginalBytes:Buffer.byteLength(longOriginal),image:await screenshot('long-material-390x844')};
  await inspector.press('Escape');
  await page.setViewportSize({width:820,height:560});
  await page.getByRole('link', {name:'技术证据',exact:true}).click();
  await page.waitForURL(/page=evidence/);
  const evidenceHeading=page.getByRole('heading',{name:'技术证据',level:1,exact:true});
  await evidenceHeading.waitFor();
  const evidenceTitle=await evidenceHeading.innerText();
  assert.ok(evidenceTitle.length>0);
  await page.getByRole('link', {name:'业务图谱',exact:true}).click();
  await page.waitForURL(/page=graph/);
  const graphHeading=page.getByRole('heading',{name:'业务图谱',level:1,exact:true});
  await graphHeading.waitFor();
  const graphTitle=await graphHeading.innerText();
  assert.ok(graphTitle.length>0);
  await page.goBack(); await page.goBack();
  await page.locator('.st-version-view').waitFor();
  assert.ok((await page.locator('.st-version-view').innerText()).includes(fixture.metadata.bundleId));
  await page.reload();await page.locator('.st-version-view').waitFor();
  assert.ok((await page.locator('.st-version-view').innerText()).includes(fixture.metadata.bundleId));
  report.context = {bundleId:fixture.metadata.bundleId,receiptId:fixture.metadata.receiptId,historyAndReloadRetained:true,evidenceTitle,graphTitle};
  if(nativeExecutablePath) report.native=await verifyNativeSourceReflow({chromium,executablePath:nativeExecutablePath,output,password:isolatedPassword,bundleId:fixture.metadata.bundleId});
  assert.deepEqual(report.pageErrors,[]);
  assert.equal(report.mutations.some(r=>/analysis|extract|investigat|seal|capture/i.test(r.path)),false,'reading and responsive navigation must not start analysis');
  report.status='PASSED';
} catch(error) {
  report.status='FAILED';report.failure={message:error.message,stack:error.stack};
  if(page) { report.failureImage=await screenshot('failure').catch(()=>null);report.aria=await page.locator('body').ariaSnapshot().catch(()=>null); }
  process.exitCode=1;
} finally {
  await browser?.close();await fixture?.close();
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:report.status,results:report.results.length,failure:report.failure?.message,output}));
}
// PGlite's worker shutdown may reset process.exitCode; assert the recorded
// verdict after every cleanup so a failed browser journey cannot exit green.
if (report.status !== 'PASSED') process.exitCode = 1;
