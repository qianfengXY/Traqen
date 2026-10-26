import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {randomUUID} from "node:crypto";
import {createServer} from "node:net";
import {isolatedPostgres} from "./source-truth-postgres.js";
import {webAuthorityFixture} from "./f003-web-authority-fixture.js";
import {syntheticPassword} from "./f002-f003-server-fixture.js";
const [modulePath,executablePath]=process.argv.slice(2);
assert.ok(path.isAbsolute(modulePath??"")&&path.isAbsolute(executablePath??""));
const root=fileURLToPath(new URL("../../",import.meta.url)),directory=await mkdtemp(path.join(tmpdir(),"traqen-f003-coverage-authority-browser-"));
const environment=Object.fromEntries(["PATH","HOME","TMPDIR","LANG","LC_ALL","LC_CTYPE","SHELL"].flatMap(key=>process.env[key]===undefined?[]:[[key,process.env[key]]]));
const probe=createServer();await new Promise(resolve=>probe.listen(0,"127.0.0.1",resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const web=`http://127.0.0.1:${port}`,cleanups=[],t={after:callback=>cleanups.push(callback)},logs=[];
const report={scope:"REAL_F008_NATIVE_PG_F001_F006_HTTP_WEB_SYNTHETIC_MODEL_QUALITY_RECOVERY_AND_RUNNER_MECHANISMS_ONLY",status:"RUNNING",checks:[],errors:[],writes:[],screenshots:[]};
let front,browser,page,fixture;
const timer=setTimeout(()=>{report.errors.push("Bounded browser deadline exceeded");front?.kill("SIGTERM");void browser?.close();},300000);
async function eventWithin(promise,label){let timeout;try{return await Promise.race([promise,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error(`No actual ${label} within 30 seconds`)),30000);})]);}finally{clearTimeout(timeout);}}
async function shot(name){await page.screenshot({path:path.join(directory,name),fullPage:true});report.screenshots.push(name);}
try{
 const cluster=await isolatedPostgres(t);fixture=await webAuthorityFixture(t,{database:()=>cluster.createDatabase(),webOrigin:web});
 fixture.model.release();await fixture.runtime.knowledge.start();
 front=spawn(process.execPath,[path.join(root,"web/node_modules/vinext/dist/cli.js"),"dev","--hostname","127.0.0.1","--port",String(port)],{cwd:path.join(root,"web"),env:{...environment,TRAQEN_API_PROXY_TARGET:fixture.runtime.origin,NEXT_PUBLIC_TRAQEN_API_BASE:"/api",WRANGLER_LOG_PATH:path.join(directory,"wrangler.log")},stdio:["ignore","pipe","pipe"]});
 front.stdout.on("data",b=>logs.push(b.toString()));front.stderr.on("data",b=>logs.push(b.toString()));
 const started=Date.now();while(true){try{if((await fetch(web,{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}assert.ok(front.exitCode===null&&Date.now()-started<45000,"Owned Web failed to start");await new Promise(r=>setTimeout(r,100));}
 const {chromium}=await import(pathToFileURL(modulePath).href);browser=await chromium.launch({executablePath,headless:true,env:environment});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.setDefaultTimeout(25000);
 page.on("pageerror",error=>report.errors.push(error.message));page.on("request",r=>{if(new URL(r.url()).pathname.includes("/business-knowledge")&&r.method()!=="GET")report.writes.push({path:new URL(r.url()).pathname,method:r.method(),csrf:!!r.headers()["x-traqen-csrf"],bearer:!!r.headers().authorization});});
 await page.goto(web);await page.getByLabel("账号",{exact:true}).fill("owner");await page.getByLabel("密码",{exact:true}).fill(syntheticPassword);await page.getByRole("button",{name:"登录",exact:true}).click();
 await page.getByLabel("切换工作区",{exact:true}).selectOption("workspace");await page.getByRole("navigation",{name:"主导航",exact:true}).getByRole("link",{name:"业务图谱",exact:true}).click();
 const board=page.getByTestId("business-knowledge-workbench");await board.waitFor();
 const question=`状态追溯 ${randomUUID()}`;
 async function start(question){
  await board.getByLabel("材料版本",{exact:true}).selectOption(fixture.reference.bundleId);await board.locator(".bk-components input").check();
  await board.getByLabel("业务问题",{exact:true}).fill(question);await board.getByLabel(/确认使用此 Main \/ Child 配置启动/).check();
  const accepted=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname.endsWith("/business-knowledge/investigations"));
  await board.getByRole("button",{name:"开始业务调查",exact:true}).click();const response=await accepted;assert.equal(response.status(),202);return(await response.json()).investigation;
 }
 const run=await start(question);report.runId=run.id;
 await board.getByRole("button",{name:"查看查询订单状态",exact:true}).waitFor();
 await board.getByRole("button",{name:"材料覆盖",exact:true}).click();
 const coverage=board.getByRole("region",{name:"材料覆盖明细"});await coverage.getByText("已读取原文",{exact:true}).waitFor();await coverage.getByText("尚未读取原文",{exact:true}).waitFor();
 await coverage.getByText("全部字节已传输",{exact:true}).waitFor();await coverage.getByText("未传输给模型",{exact:true}).waitFor();
 assert.ok((await coverage.innerText()).includes("已有分析关联"));await coverage.locator("summary").first().click();await coverage.getByText(/UTF-8 半开字节范围/).first().waitFor();
 await shot("coverage-1440.png");report.checks.push("actual-selective-F001-read-ledger-transport-business-association-distinct");
 await board.getByRole("button",{name:"业务关系",exact:true}).click();await board.getByRole("button",{name:"查看查询订单状态",exact:true}).click();
 let dialog=board.getByRole("dialog",{name:"业务依据追溯"});await dialog.getByText(/此分析尚无已核实的发布版本/).waitFor();
 assert.equal(await dialog.getByText("显式映射既有权威版本",{exact:true}).count(),0);await dialog.getByRole("heading",{name:"业务七问",exact:true}).waitFor();
 assert.equal(await board.getByRole("button",{name:"发布业务版本",exact:true}).count(),0);
 await dialog.getByRole("button",{name:"关闭追溯",exact:true}).click();report.checks.push("real-default-publication-blocked-and-unpublished-cannot-map");
 await board.locator(".bk-edge summary").first().click();await board.getByRole("button",{name:"查看关系决定与执行",exact:true}).click();dialog=board.getByRole("dialog",{name:"业务依据追溯"});
 await dialog.getByRole("heading",{name:"关系端点与业务七问",exact:true}).waitFor();await dialog.getByText(/此分析尚无已核实的发布版本/).waitFor();await dialog.getByRole("button",{name:"关闭追溯",exact:true}).click();report.checks.push("relation-own-saved-graph-evidence-and-explicit-endpoint-seven-questions-no-fabricated-relation-trace");
 const publication=await fixture.publishMechanism(run.id),authority=await fixture.prepareAuthority();report.revision=publication.publication.graphRevisionId;
 await board.getByRole("button",{name:"查看查询订单状态",exact:true}).click();dialog=board.getByRole("dialog",{name:"业务依据追溯"});
 await dialog.getByRole("button",{name:"读取发布版本 r1 的决定与执行",exact:true}).click();await dialog.getByText(/尚无显式权威映射/).waitFor();
 await dialog.getByText("显式映射既有权威版本",{exact:true}).click();
 for(const [label,value]of [["Feature ID",authority.target.featureId],["Claim ID",authority.target.claimId],["范围 ID",authority.target.scopeId]])await dialog.getByLabel(label,{exact:true}).fill(value);
 await dialog.getByRole("button",{name:"添加执行目标",exact:true}).click();const ref=authority.target.verificationTargets[0];
 for(const [label,value]of [["测试方案 ID",ref.testSpecId],["测试方案版本",String(ref.testSpecVersion)],["SnapshotManifest ID",ref.snapshotManifestId],["环境 ID",ref.deploymentId]])await dialog.getByLabel(label,{exact:true}).fill(value);
 await dialog.getByLabel("映射理由",{exact:true}).fill(`显式映射哨兵 ${randomUUID()}`);await dialog.getByLabel(/已比较此发布版本/).check();
 // Delay an actual accepted mapping; its receipt must not touch a newer form.
 let release,saw;const gate=new Promise(r=>release=r),admitted=new Promise(r=>saw=r),pattern="**/versions/*/authority-bindings*";
 await page.route(pattern,async route=>{if(route.request().method()!=="POST")return route.continue();const actual=await route.fetch();assert.equal(actual.status(),201);saw();await gate;await route.fulfill({response:actual}).catch(()=>{});});
 await dialog.getByRole("button",{name:"保存版本映射",exact:true}).click();await eventWithin(admitted,"mapping POST admission");await dialog.getByRole("button",{name:"关闭追溯",exact:true}).click();
 await board.getByRole("button",{name:"新建业务调查",exact:true}).click();await board.getByLabel("业务问题",{exact:true}).fill("NEW_FORM_AFTER_MAPPING");release();await new Promise(r=>setTimeout(r,350));await page.unroute(pattern);
 assert.equal(await board.getByRole("region",{name:"新建业务调查"}).locator("textarea").first().inputValue(),"NEW_FORM_AFTER_MAPPING");assert.equal(new URL(page.url()).searchParams.get("runId"),run.id);
 await board.getByRole("button",{name:"返回调查",exact:true}).click();await board.getByRole("button",{name:"查看查询订单状态",exact:true}).click();dialog=board.getByRole("dialog",{name:"业务依据追溯"});
 await dialog.getByRole("button",{name:"读取发布版本 r1 的决定与执行",exact:true}).click();await dialog.getByText(/当前执行状态：未运行/).waitFor();await dialog.getByText(/人类决定：尚无人类决定/).waitFor();
 assert.equal(report.writes.filter(r=>r.path.endsWith("authority-bindings")).length,1);report.checks.push("explicit-full-set-CAS-mapping-late-201-keeps-new-form-read-only-recovery-no-duplicate");
 await authority.decide(new Date(Date.now()+86400000).toISOString());await authority.ingest("PASS");await dialog.getByRole("button",{name:"刷新决定与执行投影",exact:true}).click();
 await dialog.getByText(/当前执行状态：通过/).waitFor();await dialog.getByText(/决定适用于此绑定/).waitFor();
 await authority.ingest("FAIL");await dialog.getByRole("button",{name:"刷新决定与执行投影",exact:true}).click();await dialog.getByText(/当前执行状态：失败/).waitFor();
 await dialog.getByText(/执行历史 · 2/).click();await dialog.getByText(/证据引用：evidence-/).first().waitFor();await shot("authority-failure-1440.png");
 const verifier=fixture.business.authorityBindings.verifyExecution;fixture.business.authorityBindings.verifyExecution=null;
 await dialog.getByRole("button",{name:"刷新决定与执行投影",exact:true}).click();await dialog.getByText(/当前执行状态：可信依据未知/).waitFor();fixture.business.authorityBindings.verifyExecution=verifier;
 fixture.business.authorityBindings.clock=()=>new Date(Date.now()+2*86400000);await dialog.getByRole("button",{name:"刷新决定与执行投影",exact:true}).click();await dialog.getByText(/人类决定：已失效或到期/).waitFor();await dialog.getByText(/范围已失效/).waitFor();
 fixture.business.authorityBindings.clock=()=>new Date();await authority.upgrade();await dialog.getByRole("button",{name:"刷新决定与执行投影",exact:true}).click();await dialog.getByText(/已不是当前版本/).waitFor();
 report.checks.push("actual-independent-account-decision-trusted-ingestion-PASS-then-FAIL-unknown-expiry-and-version-current-independent");
 await dialog.getByText("显式映射既有权威版本",{exact:true}).click();await dialog.getByRole("button",{name:"移除此命题映射",exact:true}).click();await dialog.getByLabel("映射理由",{exact:true}).fill("explicitly clear old binding; retain history");await dialog.getByLabel(/已比较此发布版本/).check();
 await dialog.getByRole("button",{name:"保存版本映射",exact:true}).click();await dialog.getByText(/本次集合已显式清空/).waitFor();
 await dialog.getByLabel("历史映射修订",{exact:true}).fill("1");await dialog.getByRole("button",{name:"读取历史映射",exact:true}).click();await dialog.getByText(/正在查看历史映射/).waitFor();
 assert.equal(await dialog.getByRole("button",{name:"保存版本映射",exact:true}).count(),0);
 const second=await fixture.publishMechanism(run.id);assert.notEqual(second.publication.graphRevisionId,report.revision);
 await dialog.getByRole("button",{name:"刷新已发布版本清单",exact:true}).click();await dialog.getByRole("button",{name:"读取发布版本 r2 的决定与执行",exact:true}).waitFor();
 await dialog.getByText(/正在查看历史映射/).waitFor();await dialog.getByRole("button",{name:"读取发布版本 r2 的决定与执行",exact:true}).click();await dialog.getByText(/尚无显式权威映射/).waitFor();
 report.checks.push("historical-binding-retained-explicit-new-published-revision-never-inherits-old-mapping");
 const calls=fixture.model.calls.length;fixture.model.hold();await page.reload();await board.getByRole("dialog",{name:"业务依据追溯"}).waitFor();
 await board.getByRole("dialog",{name:"业务依据追溯"}).getByRole("button",{name:"关闭追溯",exact:true}).click();assert.equal(fixture.model.calls.length,calls);
 await board.getByRole("button",{name:"新建业务调查",exact:true}).click();const controlled=await start("实际暂停恢复取消控制");
 report.controls=[];
 for(const [action,label]of [["pause","暂停调查"],["resume","恢复调查"],["cancel","取消调查"]]){
  // A returned QUEUED 202 is not a stable RUNNING revision. Wait for the
  // actual held model call and the page's exact generation/revision before
  // commanding it; never rewrite the CAS or automatically retry a 409.
  let observed;for(let i=0;i<300;i++){const value=(await fixture.request('owner',`${fixture.base}/investigations/${controlled.id}`)).body.investigation;
   if(action==='resume'?value.state==='PAUSED':value.state==='RUNNING'&&value.usage.modelCalls>=(action==='pause'?1:2)){observed=value;break;}await new Promise(r=>setTimeout(r,100));}
  assert.ok(observed,`No stable actual ${action} state`);const status=board.getByRole('region',{name:'调查状态与版本',exact:true});
  const coordinates=status.locator('details').filter({has:page.getByText('来源、固定模型与恢复坐标',{exact:true})});if(!await coordinates.evaluate(e=>e.open))await coordinates.locator('summary').click();
  await status.getByText(`${observed.generation} / ${observed.revision}`,{exact:true}).waitFor();
  const pattern=`**/investigations/${controlled.id}/${action}`;await page.route(pattern,async route=>{const actual=await route.fetch(),body=await actual.json();report.controls.push({action,request:route.request().postDataJSON(),observed:{state:observed.state,generation:observed.generation,revision:observed.revision},status:actual.status(),response:{code:body.error?.code??null,state:body.investigation?.state??null,generation:body.investigation?.generation??null,revision:body.investigation?.revision??null}});await route.fulfill({response:actual});});
  if(action==="cancel")page.once("dialog",d=>{void d.accept().catch(error=>report.errors.push(`cancel dialog: ${error.message}`));});const response=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname.endsWith(`/${action}`));await board.getByRole("button",{name:label,exact:true}).click();assert.equal((await response).status(),200);await page.unroute(pattern);
  assert.equal(report.controls.at(-1).request.expectedRevision,observed.revision);
 }
 await board.getByText("已取消",{exact:true}).first().waitFor();fixture.model.release();report.checks.push("real-pause-resume-cancel-controls-and-offline-browse-without-model-reexecution");
 await board.getByRole("button",{name:new RegExp(question)}).click();await board.getByRole("button",{name:"查看查询订单状态",exact:true}).click();dialog=board.getByRole("dialog",{name:"业务依据追溯"});
 await dialog.getByRole("button",{name:"读取发布版本 r2 的决定与执行",exact:true}).click();await dialog.getByText(/尚无显式权威映射/).waitFor();
 await page.setViewportSize({width:900,height:900});await shot("authority-900.png");await dialog.getByRole("button",{name:"关闭追溯",exact:true}).click();await page.getByLabel("全局主题配色",{exact:true}).selectOption("dark");await board.getByRole("button",{name:"查看查询订单状态",exact:true}).click();dialog=board.getByRole("dialog",{name:"业务依据追溯"});await dialog.getByRole("button",{name:"读取发布版本 r2 的决定与执行",exact:true}).click();await dialog.getByText(/尚无显式权威映射/).waitFor();await shot("authority-dark-900.png");
 let releaseRead,acceptedRead;const readGate=new Promise(r=>releaseRead=r),readAdmitted=new Promise(r=>acceptedRead=r);
 await page.route(pattern,async route=>{if(route.request().method()!=="GET")return route.continue();const actual=await route.fetch();assert.equal(actual.status(),200);acceptedRead();await readGate;await route.fulfill({response:actual}).catch(()=>{});});
 await dialog.getByRole("button",{name:"刷新决定与执行投影",exact:true}).click();await eventWithin(readAdmitted,"authority GET admission");await fixture.revoke();await page.getByRole("alert").getByText("当前无权读取",{exact:true}).waitFor();releaseRead();await page.unroute(pattern);await new Promise(r=>setTimeout(r,200));assert.equal(await board.locator(".bk-authority").count(),0);assert.equal(await board.locator(".bk-graph-result").count(),0);
 report.checks.push("real-current-role-revocation-clears-authority-and-graph");assert.ok(report.writes.every(r=>r.csrf&&!r.bearer));report.status=report.errors.length?"FAILED":"PASSED";
}catch(error){report.status="FAILED";report.errors.push(error.stack??error.message);if(page)await shot("failure.png").catch(()=>{});}
finally{clearTimeout(timer);await browser?.close().catch(()=>{});if(front&&front.exitCode===null){front.kill("SIGTERM");await new Promise(resolve=>{front.once("exit",resolve);setTimeout(resolve,3000);});}for(const cleanup of cleanups.reverse())await cleanup().catch(e=>report.errors.push(`cleanup: ${e.message}`));await writeFile(path.join(directory,"frontend.log"),logs.join(""));await writeFile(path.join(directory,"summary.json"),JSON.stringify(report,null,2));}
process.stdout.write(JSON.stringify({...report,parentPath:`${directory}/`,childPath:"summary.json"})+"\n");if(report.status!=="PASSED"||report.errors.length)process.exitCode=1;
