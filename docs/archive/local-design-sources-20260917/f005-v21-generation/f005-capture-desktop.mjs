import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from '/Volumes/WorkSSD/clowder-ai/node_modules/playwright/index.mjs';
const assetDir='/Volumes/WorkSSD/projects/Traqen-worktrees/f005-docs-publication/docs/design-reviews/F005/assets';
const server=createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=resolve(assetDir,'.'+name);if(!file.startsWith(assetDir+'/'))throw Error('outside assets');const data=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.png':'image/png','.json':'application/json'})[extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
const report={revision:'2.1',request:'0001789614562911-000019-617589c4',recordedAt:new Date().toISOString(),fixtureOnly:true,deviceScaleFactor:1,baselineViewports:[{width:1440,height:900},{width:2560,height:1440}],additionalDesktopViewports:[{width:1280,height:800},{width:1920,height:1080}],themeChoice:'Existing Porcelain Light / Graphite Dark; no new palette',screens:[],layoutChecks:[],interactionChecks:[],pageErrors:[],limitations:['CSS viewport simulation, not physical hardware testing.','No new mobile design or mobile acceptance.','No complete WCAG certification or production theme registry.']};
const settle=page=>page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
try{
 browser=await chromium.launch({headless:true,channel:'chrome'});
 report.browser=browser.version();
 for(const [width,height,prefix,start] of [[1440,900,'laptop',18],[2560,1440,'display',20]]){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,colorScheme:'light'});
  const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
  await page.goto(origin+'/Traqen-F005-review.html#overview');
  await page.locator('[data-action="focus-cancel"]').first().click();
  await page.waitForFunction(()=>window.__traqenDemo.state.view==='graph' && document.querySelector('.graph-canvas'));
  await settle(page);
  assert.equal(await page.evaluate(()=>window.__traqenDemo.state.selected),'cancel');
  const before=await page.evaluate(()=>{const {theme,...other}=window.__traqenDemo.state;return JSON.stringify(other);});
  for(const [theme,offset] of [['light',0],['dark',1]]){
   if(theme==='dark')await page.locator('#theme-toggle').click();
   await page.mouse.move(width-8,height-8);await settle(page);
   const observed=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,selected:window.__traqenDemo.state.selected,overflow:document.documentElement.scrollWidth>innerWidth,sidebar:Math.round(document.querySelector('#sidebar').getBoundingClientRect().width),h1:getComputedStyle(document.querySelector('h1')).fontSize,graph:document.querySelector('.graph-canvas')?.getBoundingClientRect().toJSON()}));
   assert.equal(observed.theme,theme);assert.equal(observed.overflow,false);
   const filename=`${start+offset}-graph-${prefix}-${theme}.png`;
   await page.screenshot({path:resolve(assetDir,'previews',filename),animations:'disabled'});
   report.screens.push({file:'previews/'+filename,viewport:{width,height},...observed});
   console.log('Captured '+filename);
  }
  assert.equal(await page.evaluate(()=>{const {theme,...other}=window.__traqenDemo.state;return JSON.stringify(other);}),before);
  report.interactionChecks.push({viewport:width,check:'Theme switch preserves all non-theme fixture state',passed:true});
  await page.reload();await settle(page);assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
  report.interactionChecks.push({viewport:width,check:'Reload restores chosen dark theme',passed:true});
  await page.locator('#theme-toggle').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
  report.interactionChecks.push({viewport:width,check:'Theme switch works with keyboard Enter',passed:true});
  await context.close();
 }
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
 const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
 for(const [width,height] of [[1440,900],[2560,1440],[1280,800],[1920,1080]]){
  await page.setViewportSize({width,height});
  for(const theme of ['light','dark']){
   for(const view of ['overview','sources','evidence','graph','impact','settings','components']){
    await page.goto(origin+'/Traqen-F005-review.html#'+view);
    if(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme)await page.locator('#theme-toggle').click();
    await settle(page);
    const observed=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,h1:document.querySelector('h1')?.textContent,sidebarVisible:document.querySelector('#sidebar').getBoundingClientRect().left>=0}));
    assert.equal(observed.overflow,false,`${width}/${theme}/${view} overflow`);assert.ok(observed.h1);assert.equal(observed.sidebarVisible,true);
    report.layoutChecks.push({viewport:{width,height},theme,view,...observed});
    console.log(`Checked ${width} ${theme} ${view}`);
   }
  }
 }
 const response=await page.goto(origin+'/charter.html');assert.equal(response.status(),200);assert.equal(await page.locator('h2[id^="section-"]').count(),16);assert.ok(await page.getByText('默认主题与扩展边界',{exact:true}).count());
 const standalone=await page.locator('main').innerText();
 await page.goto(origin+'/Traqen-F005-review.html#overview');await page.locator('.studio-links a[href="charter.html"]').click();
 await page.locator('#charter-dialog').waitFor({state:'visible'});
 assert.equal(await page.frameLocator('#charter-dialog iframe').locator('main').innerText(),standalone);
 await page.locator('#close-charter').click();
 report.interactionChecks.push({check:'Standalone reader HTTP 200, 16 sections, embedded reader identical, opens/closes',passed:true});
 await page.goto(origin+'/gallery.html');assert.equal(await page.locator('figure').count(),14);assert.equal(await page.locator('img[src*="mobile"]').count(),0);
 report.interactionChecks.push({check:'Gallery has 14 desktop images and no active mobile images',passed:true});
 assert.equal(report.pageErrors.length,0);
 await writeFile(resolve(assetDir,'desktop-themes-verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({screens:report.screens,layoutChecks:report.layoutChecks.length,interactions:report.interactionChecks,pageErrors:report.pageErrors}));
}finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
