import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { captureNativeViewport } from './f002-native-capture.mjs';

// Full Chrome settings in a new disposable profile: not CSS zoom, DPR
// emulation, pinch, an OS preference, or an existing user's browser profile.
export async function verifyNativeSourceReflow({chromium, executablePath, output, password, bundleId}) {
  const profile = await mkdtemp(path.join(output, 'owned-native-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath, headless:true, viewport:null,
    args:['--window-size=1440,900','--force-device-scale-factor=1'],
  });
  const proof = {profile, disposableProfile:true, conditions:[], controls:[], captures:[]};
  const page = context.pages()[0] ?? await context.newPage();
  const dimensions = () => page.evaluate(() => ({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,pinch:visualViewport.scale,
    applicationScale:Number(getComputedStyle(document.querySelector('.desktop-frame')).getPropertyValue('--desktop-scale')),pageWidth:document.documentElement.scrollWidth}));
  try {
    await page.goto('http://127.0.0.1:6226/?page=sources&workspace=workspace');
    await page.getByLabel('账号',{exact:true}).fill('owner');await page.getByLabel('密码',{exact:true}).fill(password);
    await page.getByRole('button',{name:'登录',exact:true}).click();
    await page.getByRole('button',{name:'查看冻结版本',exact:true}).click();await page.locator('.st-version-view').waitFor();
    const cdp = await context.newCDPSession(page), settings=await context.newPage();
    proof.browser=await cdp.send('Browser.getVersion');assert.match(proof.browser.product,/^Chrome\//);
    await settings.goto('chrome://settings/appearance');const zoom=settings.locator('select#zoomLevel');
    assert.equal(await zoom.inputValue(),'1');
    const initial=await dimensions(), window=await cdp.send('Browser.getWindowForTarget');
    proof.calibration={initial,window,method:'native window bounds + target activation'};
    await cdp.send('Browser.setWindowBounds',{windowId:window.windowId,bounds:{width:window.bounds.width+1440-initial.width,height:window.bounds.height+900-initial.height}});
    // Headless Chrome applies changed content bounds when its target is
    // activated. Do not replace this with emulated device metrics.
    await page.bringToFront();
    await page.waitForFunction(()=>innerWidth===1440&&innerHeight===900);
    const baseline=await dimensions();proof.baseline=baseline;
    const fixed=page.url();
    for(const factor of [2,4]) {
      await zoom.selectOption(String(factor));
      await page.waitForFunction(f=>devicePixelRatio===f&&innerWidth===1440/f,factor);
      const metrics=await dimensions();assert.equal(metrics.height,baseline.height/factor);assert.equal(metrics.pinch,1);assert.equal(metrics.applicationScale,1);
      assert.ok(metrics.pageWidth<=metrics.width+1);proof.conditions.push({factor,metrics});
      const table=await page.locator('.st-table-scroll table').first().evaluate(node=>({width:node.getBoundingClientRect().width,columns:node.querySelectorAll('th').length,rootFont:parseFloat(getComputedStyle(document.documentElement).fontSize),scrollport:node.parentElement.clientWidth}));
      proof.conditions.at(-1).table=table;
      assert.equal(table.columns,6);
      assert.ok(table.width>=48*table.rootFont-.5,'six material columns must retain readable width inside their local scrollport');
      for(const theme of ['light','dark']) {
        await page.getByRole('combobox',{name:'全局主题配色',exact:true}).selectOption(theme);
        const controls=[page.getByRole('link',{name:'来源快照',exact:true}),page.getByLabel('切换工作区',{exact:true}),
          page.getByRole('combobox',{name:'全局主题配色',exact:true}),page.getByRole('tab',{name:'材料清单',exact:true}),
          page.getByLabel('路径搜索',{exact:true}),page.getByRole('button',{name:'搜索清单',exact:true}),
          page.getByRole('button',{name:'查看材料详情 evidence-sentinel.js',exact:true})];
        for(let index=0;index<controls.length;index++) {
          const target=controls[index];await target.scrollIntoViewIfNeeded();await target.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
          const state=await target.evaluate(node=>{
            node.scrollIntoView({block:'center',inline:'nearest'});const r=node.getBoundingClientRect(),s=getComputedStyle(node),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
            return {focused:document.activeElement===node,hit:hit===node||node.contains(hit),box:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},viewport:{width:innerWidth,height:innerHeight},outline:parseFloat(s.outlineWidth)};
          });
          proof.controls.push({factor,theme,index,...state});assert.equal(state.focused,true);assert.equal(state.hit,true);
          assert.ok(state.box.left>=0&&state.box.right<=state.viewport.width+.5&&state.box.top>=0&&state.box.bottom<=state.viewport.height+.5,'the complete real control must remain reachable');
        }
        assert.equal(page.url(),fixed);assert.ok((await page.locator('.st-version-view').innerText()).includes(bundleId));
        proof.captures.push(await captureNativeViewport({page,cdp,file:path.join(output,`native-${factor*100}-${theme}.png`),dimensions}));
      }
    }
    await page.reload();await page.locator('.st-version-view').waitFor();assert.ok((await page.locator('.st-version-view').innerText()).includes(bundleId));
    proof.reloadedExactVersion=true;proof.status='PASSED';return proof;
  } catch(error) {
    proof.status='FAILED';proof.failure={message:error.message,stack:error.stack};
    proof.failureDimensions=await dimensions().catch(()=>null);
    proof.failureImage=path.join(output,'native-failure.png');
    await page.screenshot({path:proof.failureImage}).catch(()=>{proof.failureImage=null;});
    throw error;
  } finally {
    await writeFile(path.join(output,'native-proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
    await context.close();
  }
}
