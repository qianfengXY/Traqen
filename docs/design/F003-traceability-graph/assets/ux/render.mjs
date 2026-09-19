/** Render the fixture-only UX proposal. No product server or user data is used.
 * node render.mjs /absolute/playwright/index.mjs /absolute/chromium-executable
 * Outputs live beside this file; HTML edits must be followed by fresh rendering.
 */
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [playwrightPath,browserPath]=process.argv.slice(2);
assert(playwrightPath&&browserPath,'Usage: node render.mjs PLAYWRIGHT_MODULE CHROMIUM_EXECUTABLE');
const {chromium}=await import(pathToFileURL(resolve(playwrightPath)));
const dir=dirname(fileURLToPath(import.meta.url));
await mkdir(resolve(dir,'previews'),{recursive:true});
const html=await readFile(resolve(dir,'prototype.html'));
const server=createServer((req,res)=>{if(new URL(req.url,'http://local').pathname!=='/prototype.html'){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}/prototype.html`;
const report={version:'0.2',kind:'author-fixture-render-validation',fixtureOnly:true,recordedAt:new Date().toISOString(),sourceHTMLSha256:createHash('sha256').update(html).digest('hex'),screens:[],checks:[],pageErrors:[],limitations:['Static design proposal, not product implementation or backend acceptance.','CSS viewport simulation only, not physical monitor testing.','No full assistive-technology or WCAG certification.','Secondary unfinished product actions show an explicit prototype explanation; no business state is written.']};
const shots=[['01-graph-light','graph','light',1440,900],['02-evidence-light','evidence','light',1440,900],['03-review-light','review','light',1440,900],['04-coverage-light','coverage','light',1440,900],['05-run-light','runs','light',1440,900],['06-preflight-blocked','setup','light',1440,900],['07-graph-dark','graph','dark',1440,900],['08-graph-display-light','graph','light',2560,1440],['09-graph-display-dark','graph','dark',2560,1440]];
let browser;
const settle=p=>p.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
try{
 browser=await chromium.launch({headless:true,executablePath:browserPath});
 report.browser=browser.version();
 const context=await browser.newContext({deviceScaleFactor:1});
 const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
 let graphSignature;
 for(const [name,view,theme,width,height] of shots){
  await page.setViewportSize({width,height});await page.goto(`${origin}?theme=${theme}#${view}`);await settle(page);
  const layout=await page.evaluate(()=>{const f=document.querySelector('#frame').getBoundingClientRect();const s=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale'));return {view:window.__f003UX.state.view,theme:document.documentElement.dataset.theme,scale:s,frame:{x:f.x,y:f.y,width:f.width,height:f.height},documentOverflow:document.documentElement.scrollWidth>innerWidth,panels:[...document.querySelectorAll('.panel')].map(e=>{const r=e.getBoundingClientRect();return {x:(r.x-f.x)/s,y:r.y/s,width:r.width/s,height:r.height/s,overflowX:e.scrollWidth>e.clientWidth+1};}),visibleText:document.querySelector('#main').innerText};});
  assert.equal(layout.theme,theme);assert.equal(layout.documentOverflow,false);assert(layout.frame.height<=height+1);assert(layout.frame.x>=0);assert(layout.panels.every(p=>!p.overflowX),`${name}: horizontal overflow`);
  if(view==='graph'){const signature=JSON.stringify({panels:layout.panels.map(p=>Object.fromEntries(Object.entries(p).map(([k,v])=>[k,typeof v==='number'?Math.round(v*10)/10:v]))),text:layout.visibleText});if(!graphSignature)graphSignature=signature;else assert.equal(signature,graphSignature,'Same graph content and normalized geometry must survive theme and viewport changes');}
  for(const selector of (view==='runs'?['.run-actions','.run-layout>aside .btn']:view==='review'?['.decision-row','.review-notice']:view==='coverage'?['.panel-foot','.coverage-layout>aside .notice']:[])){
   assert(await page.locator(selector).evaluateAll(els=>els.length>0&&els.every(e=>{const r=e.getBoundingClientRect(),p=e.closest('.panel').getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom;})),`${name}: critical content clipped: ${selector}`);
  }
  await page.screenshot({path:resolve(dir,'previews',name+'.png'),animations:'disabled'});
  const bytes=await readFile(resolve(dir,'previews',name+'.png'));delete layout.visibleText;
  report.screens.push({file:`previews/${name}.png`,width,height,sha256:createHash('sha256').update(bytes).digest('hex'),...layout});console.log('Captured '+name);
 }
 report.checks.push('Four graph screenshots have identical main text and normalized panel geometry across themes and viewports.');
 // Check all sample surfaces in both themes, including states omitted from the six primary figures.
 await page.setViewportSize({width:1440,height:900});
 for(const theme of ['light','dark'])for(const view of ['graph','implementation','coverage','evidence','review','runs','setup','empty']){
  await page.goto(`${origin}?theme=${theme}#${view}`);await settle(page);assert.equal(await page.locator('h1').count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 report.checks.push('Eight routes rendered in both themes with one h1 and no page-level horizontal overflow.');
 await page.goto(origin+'#graph');await page.getByLabel('等价列表视图').click();assert.equal(await page.locator('.list-view').count(),1);
 await page.getByLabel('图谱视图',{exact:true}).click();await page.getByLabel('仅人工确认',{exact:true}).check();assert.equal(await page.locator('.graph-svg .node').count(),2);await page.locator('#clear-filter').click();assert.equal(await page.locator('.graph-svg .node').count(),8);
 report.checks.push('Equivalent list and human-confirmed filter; hidden selection remains explained and can be restored.');
 await page.getByRole('button',{name:'查看关系：取消订单由取消订单 API 实现'}).focus();await page.keyboard.press('Enter');assert.match(await page.locator('.inspector').innerText(),/REL-018/);assert.match(await page.locator('.inspector').innerText(),/FACT-42/);
 report.checks.push('A directed relationship can be selected with keyboard and exposes its own evidence and scope.');
 await page.getByRole('button',{name:'查看 创建订单',exact:true}).click();assert.match(await page.locator('.inspector').innerText(),/DEC-012/);assert.doesNotMatch(await page.locator('.inspector').innerText(),/未产生人工确认决定/);
 await page.getByRole('button',{name:'查看 application.yml',exact:true}).click();assert.match(await page.locator('.inspector').innerText(),/不能据此认定实际部署环境值/);
 await page.goto(origin+'#coverage');assert.equal(await page.locator('#human-filter').count(),0);assert.equal(await page.locator('[data-mode]').count(),0);
 report.checks.push('Object inspectors preserve distinct decisions/material scope; coverage has no misleading graph-only filters.');
 await page.goto(origin+'#evidence');await page.locator('[data-ref="test"]').click();assert.match(await page.locator('#source-body').innerText(),/未关联执行记录/);
 report.checks.push('Test-asset reading explicitly says no execution record, never a fabricated passed result.');
 await page.goto(origin+'#review');await page.locator('#decision-note').fill('主题切换保留这条未提交说明');await page.locator('#theme').selectOption('dark');assert.equal(await page.locator('#decision-note').inputValue(),'主题切换保留这条未提交说明');
 await page.getByRole('button',{name:'记录本条决定',exact:true}).click();assert(await page.locator('dialog').isVisible());assert.match(await page.locator('#dialog-copy').innerText(),/不生成真正的人工确认/);await page.keyboard.press('Escape');
 report.checks.push('Theme switch preserves review draft; mock action explains no real decision is written; dialog Escape works.');
 await page.goto(origin+'#setup');assert(await page.getByRole('button',{name:'确认配置并启动'}).isDisabled());await page.locator('#run-name').fill('保留调查输入');await page.locator('#preflight-toggle').click();assert.equal(await page.locator('#run-name').inputValue(),'保留调查输入');assert(await page.getByRole('button',{name:'确认配置并启动'}).isEnabled());
 report.checks.push('Blocking preflight cannot start; explicit fixture-state toggle preserves the entered investigation name.');
 assert.equal(report.pageErrors.length,0);
 await writeFile(resolve(dir,'verification.json'),JSON.stringify(report,null,2)+'\n');
 const sums=[`${report.sourceHTMLSha256}  prototype.html`,...report.screens.map(x=>`${x.sha256}  ${x.file}`)].join('\n')+'\n';
 await writeFile(resolve(dir,'SHA256SUMS'),sums);
 console.log(JSON.stringify({result:'PASS',screens:report.screens.length,checks:report.checks,pageErrors:report.pageErrors}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
