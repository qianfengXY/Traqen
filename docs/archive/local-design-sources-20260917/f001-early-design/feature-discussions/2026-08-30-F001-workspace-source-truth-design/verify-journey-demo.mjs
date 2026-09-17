import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";

const folder=path.dirname(fileURLToPath(import.meta.url));
const html=path.join(folder,"assets/source-truth-journey-v3-zh-CN.html");
const url=pathToFileURL(html).href;
const modulePath=process.env.F001_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(modulePath).href:"playwright");
const browser=await chromium.launch({channel:"chrome",headless:true});
const context=await browser.newContext({viewport:{width:1536,height:1080}});
const page=await context.newPage();
page.setDefaultTimeout(7000);
const errors=[],requests=[];
page.on("pageerror",error=>errors.push(error.message));
page.on("request",request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
const state=()=>page.evaluate(()=>window.f001Demo.getState());
const click=a=>page.locator('[data-action="'+a+'"]').first().click();
const until=step=>page.waitForFunction(n=>window.f001Demo.getState().step===n,step,{timeout:32000});
const check=(condition,message)=>{assert.ok(condition,message);console.log("PASS",message);};

try{
 await page.goto(url);
 check(await page.locator('[data-action="to-scope"]').isDisabled(),"empty source selection cannot continue");
 const sentinel="review-sentinel-Q7";
 await page.locator("#git-url").fill("https://example.invalid/"+sentinel+".git");
 await page.locator("#git-ref").fill(sentinel);
 await click("add-git");
 await page.locator("#dir-name").fill(sentinel+"-docs");
 await click("add-dir");
 await click("to-scope");
 await page.locator('[data-peek="8"]').click();
 check((await state()).step===2,"future-station inspection does not bypass workflow");
 await click("close-dialog");
 await click("start");
 await click("play");
 const paused=await state();
 await page.waitForTimeout(1600);
 check((await state()).phase===paused.phase&&(await state()).step===paused.step,"pause stops counts and automatic transitions");
 await click("play");
 await until(7);
 check(await page.locator('[data-action="seal"]').isDisabled(),"unresolved gaps prevent freeze");
 await page.locator('[data-reason="G-01"]').fill(sentinel+" <img src=x onerror=alert(1)>");
 await page.locator("#gap-expiry").fill("2020-01-01");
 await click("accept-G-01");
 check((await state()).accept["G-01"]===undefined,"expired acceptance cannot be recorded");
 await click("close-dialog");
 await page.locator("#gap-expiry").fill("2026-12-31");
 await click("accept-G-01");
 await page.locator('[data-reason="G-02"]').fill(sentinel+" second limitation");
 await click("accept-G-02");
 check(await page.locator("#gap-expiry").isDisabled(),"accepted record expiry cannot be silently edited");
 check(await page.locator("#current-card img").count()===0,"entered rationale is rendered as text, not HTML");
 check(!(await page.locator('[data-action="seal"]').isDisabled()),"valid explicit acceptance opens freeze action");
 await click("seal");
 check((await state()).step===8&&!(await state()).sealed,"station eight has an observable finalization state");
 check(await page.locator(".receipt-id").count()===0,"no Receipt exists before finalization");
 await page.waitForFunction(()=>window.f001Demo.getState().sealed,undefined,{timeout:10000});
 await click("receipt");
 check((await page.locator("#dialog-body").innerText()).includes(sentinel),"unknown source and rationale input flows into Receipt");
 check((await page.locator("#dialog-body").innerText()).includes("G-02"),"frozen Receipt inherits the complete accepted gap set");
 await click("close-dialog");
 await page.reload();
 check((await state()).sealed&&(await state()).ref===sentinel,"same-tab refresh restores demo state and input");
 await click("new-version");
 check((await state()).baselineVersion===1&&(await page.locator("#side-baseline").innerText()).includes("r1"),"new version uses the version actually frozen as baseline");

 await page.goto(url+"?scene=blocked");
 check(await page.locator('[data-action="disabled"]').isDisabled(),"blocking preflight has no continue action");
 check(await page.locator('[data-action^="accept-"]').count()===0,"blocker has no acceptance control");
 await click("edit-block");await click("start");
 check((await state()).block,"rechecking unchanged blocked inputs remains blocked");
 await click("edit-block");
 await page.locator("#scope-ref").fill("fixed-source-"+sentinel);
 await click("start");
 check((await state()).step===3&&!(await state()).block,"source correction returns through preflight, not directly to capture");
 await click("play");

 await page.goto(url+"?scene=retry");
 const failed=await state();await click("retry");
 check((await state()).attempt===failed.attempt+1&&(await state()).phase===failed.phase,"retry creates a new attempt while preserving verified checkpoint");
 await click("play");await click("cancel");await click("confirm-cancel");
 check((await state()).cancelled&&!(await state()).sealed,"cancel preserves a terminal attempt without Receipt");
 check((await page.locator("#footer-strip").innerText()).includes("r3"),"failed or cancelled new attempt keeps older Receipt usable");

 await page.goto(url+"?scene=1");
 await click("add-dir");await click("to-scope");await click("start");
 await until(7);
 check((await state()).git===false&&!(await page.locator('[data-action="seal"]').isDisabled()),"directory-only complete input needs no invented gap acceptance");
 await click("seal");
 await page.waitForFunction(()=>window.f001Demo.getState().sealed,undefined,{timeout:10000});
 check((await page.locator("#current-card").innerText()).includes("READY ·"),"gap-free path produces a READY example");

 const frames=[["1","01-sources"],["2","02-scope"],["3","03-preflight"],["4","04-enumerate"],
 ["5","05-manifest"],["6","06-capture"],["7","07-gaps"],["8","08-sealing"],["frozen","08-frozen"],
 ["blocked","03-blocked"],["retry","06-retry"],["incremental","02-incremental"]];
 const report=[];
 for(const [scene,name] of frames){
  await page.setViewportSize({width:1536,height:1080});
  await page.goto(url+"?scene="+scene+"&clean=1");
  check(await page.locator(".station").count()===8,name+" keeps eight stations");
  const layout=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,viewport:innerWidth}));
  check(layout.width<=layout.viewport,name+" desktop has no horizontal overflow");
  await page.screenshot({path:path.join(folder,"assets/source-truth-journey-v3-"+name+"-zh-CN.png"),fullPage:true});
  report.push({scene,name,...layout});
 }
 await page.setViewportSize({width:390,height:844});
 await page.goto(url+"?scene=7&clean=1");
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"390px layout contains overflow inside the horizontal metro map");
 check(await page.evaluate(()=>{
  const node=document.querySelector(".station.current .node").getBoundingClientRect();
  const pill=document.getElementById("position-pill").getBoundingClientRect();
  return node.left>=0&&node.right<=innerWidth&&pill.left>=0&&pill.right<=innerWidth;
 }),"390px layout keeps the current station and step counter visible");
 await page.screenshot({path:path.join(folder,"assets/source-truth-journey-v3-mobile-zh-CN.png"),fullPage:true});
 check(errors.length===0,"no browser runtime errors");
 check(requests.length===0,"no network reads or uploads");
 console.log("FRAMES",JSON.stringify(report));
 console.log("ALL CHECKS PASSED");
}finally{await browser.close();}
