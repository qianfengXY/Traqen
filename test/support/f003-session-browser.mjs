import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {randomUUID} from "node:crypto";
import {createServer} from "node:net";
import {isolatedPostgres} from "./source-truth-postgres.js";
import {knowledgeServerFixture,syntheticPassword} from "./f002-f003-server-fixture.js";
import {businessUiModelResponse} from "./f003-business-ui-model.js";

const [modulePath,executablePath]=process.argv.slice(2);
assert.ok(path.isAbsolute(modulePath??"")&&path.isAbsolute(executablePath??""));
const probe=createServer();await new Promise(resolve=>probe.listen(0,"127.0.0.1",resolve));const webPort=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const root=fileURLToPath(new URL("../../",import.meta.url)),web=`http://127.0.0.1:${webPort}`;
const directory=await mkdtemp(path.join(tmpdir(),"traqen-f003-business-browser-"));
const environment=Object.fromEntries(["PATH","HOME","TMPDIR","LANG","LC_ALL","LC_CTYPE","SHELL"].flatMap(key=>process.env[key]===undefined?[]:[[key,process.env[key]]]));
const report={scope:"SYNTHETIC_PASSWORD_F001_F006_F003_REAL_HTTP_AND_PERSISTENT_GRAPH_EXTERNAL_MODEL_PROCESS_DOUBLE",status:"RUNNING",checks:[],errors:[],writes:[],screenshots:[]};
const cleanups=[],t={after:callback=>cleanups.push(callback)},logs=[];
let front,browser,page,fixture;
const timer=setTimeout(()=>{report.errors.push("Browser verification exceeded its bound");front?.kill("SIGTERM");void browser?.close();},240000);
try{
 const cluster=await isolatedPostgres(t,{binaries:"/Users/skybowen/Library/Application Support/Traqen-F001/postgres/bin"});
 fixture=await knowledgeServerFixture(t,{port:0,webOrigin:web,database:()=>cluster.createDatabase(),modelResponse:businessUiModelResponse});
 fixture.model.release();await fixture.runtime.knowledge.start();
 front=spawn(process.execPath,[path.join(root,"web/node_modules/vinext/dist/cli.js"),"dev","--hostname","127.0.0.1","--port",String(webPort)],{
  cwd:path.join(root,"web"),env:{...environment,TRAQEN_API_PROXY_TARGET:fixture.runtime.origin,NEXT_PUBLIC_TRAQEN_API_BASE:"/api",WRANGLER_LOG_PATH:path.join(directory,"wrangler.log")},stdio:["ignore","pipe","pipe"]});
 front.stdout.on("data",bytes=>logs.push(bytes.toString()));front.stderr.on("data",bytes=>logs.push(bytes.toString()));
 const started=Date.now();
 while(true){try{if((await fetch(web,{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}
  assert.ok(front.exitCode===null&&Date.now()-started<40000,"Owned frontend failed to start");await new Promise(resolve=>setTimeout(resolve,100));}
 const {chromium}=await import(pathToFileURL(modulePath).href);
 browser=await chromium.launch({executablePath,headless:true,env:environment});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.setDefaultTimeout(25000);
 page.on("pageerror",error=>report.errors.push(error.message));
 page.on("request",request=>{const pathname=new URL(request.url()).pathname;if(pathname.includes("/business-knowledge")&&request.method()!=="GET")report.writes.push({pathname,method:request.method(),authorizationPresent:!!request.headers().authorization});});
 await page.goto(web);
 await page.getByLabel("账号",{exact:true}).fill("owner");await page.getByLabel("密码",{exact:true}).fill(syntheticPassword);
 await page.getByRole("button",{name:"登录",exact:true}).click();
 await page.getByLabel("切换工作区",{exact:true}).selectOption("workspace");
 await page.getByRole("navigation",{name:"主导航",exact:true}).getByRole("link",{name:"业务图谱",exact:true}).click();
 const board=page.getByTestId("business-knowledge-workbench");await board.waitFor();
 await board.getByRole("heading",{name:"新建调查",exact:true}).waitFor();
 await page.screenshot({path:path.join(directory,"business-empty-1440.png"),fullPage:true});report.screenshots.push("business-empty-1440.png");
 report.checks.push("default-entry-one-password-real-navigation-existing-frozen-material");
 await board.getByLabel("材料版本",{exact:true}).selectOption(fixture.reference.bundleId);
 await board.locator(".bk-components input[type=checkbox]").check();
 const question=`订单状态如何得到 · ${randomUUID()}`;report.question=question;
 await board.getByLabel("业务问题",{exact:true}).fill(question);
 await board.getByLabel(/确认使用此 Main \/ Child 配置启动/).check();
 const accepted=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname.endsWith("/business-knowledge/investigations"));
 await board.getByRole("button",{name:"开始业务调查",exact:true}).click();
 const response=await accepted;assert.equal(response.status(),202);const run=(await response.json()).investigation;report.investigationId=run.id;
 assert.equal(run.sourceInput.sourceBundleSnapshotId,fixture.reference.bundleId);assert.equal(run.profile.id,fixture.profile.id);assert.equal(run.technicalVersionId,null);
 await board.getByRole("heading",{name:"已保存分析",exact:true}).waitFor();
 await board.getByRole("button",{name:"查看查询订单状态",exact:true}).waitFor();
 // Prepared actual-HTTP task evidence checks. This legacy entry is still
 // path-blocked; shared730 must close its paths before anyone runs it.
 const tasks=board.getByRole("region",{name:"调查任务与证据返回",exact:true});
 await tasks.getByText("以下是已保存图谱的任务证据，不将当前运行进度倒写进历史图谱。",{exact:true}).waitFor();
 await tasks.locator("summary").filter({hasText:/^Child/}).first().click();
 await tasks.getByText(/义务未解决/).first().waitFor();
 await tasks.getByRole("button",{name:"查询订单状态",exact:true}).first().click();
 assert.equal(new URL(page.url()).searchParams.get("runId"),run.id);
 assert.ok(new URL(page.url()).searchParams.get("objectId"));
 await board.getByRole("button",{name:"关闭追溯",exact:true}).click();
 await tasks.getByRole("button",{name:"orders.js",exact:true}).first().click();
 await board.getByLabel("原文回查").locator("pre").getByText(/export function orderStatus/).waitFor();
 await board.getByRole("button",{name:"关闭追溯",exact:true}).click();
 const callsBeforeTaskRefresh=fixture.model.calls.length;
 const taskRefresh=page.waitForResponse(r=>r.request().method()==="GET"&&new URL(r.url()).pathname.endsWith("/task-evidence"));
 await tasks.getByRole("button",{name:"刷新任务证据",exact:true}).click();
 const refreshedTaskResponse=await taskRefresh;assert.equal(refreshedTaskResponse.status(),200);
 const refreshedTasks=(await refreshedTaskResponse.json()).taskEvidence;
 assert.equal(refreshedTasks.binding.investigationId,run.id);
 assert.equal(refreshedTasks.binding.graphDigest,new URL(refreshedTaskResponse.url()).searchParams.get("expectedGraphDigest"));
 assert.equal(fixture.model.calls.length,callsBeforeTaskRefresh);
 report.checks.push("actual-fixed-investigation-task-projection-original-proposition-key-and-read-only-refresh");
 await board.getByText(/业务图谱质量计量策略尚未确认/).waitFor({state:"attached"});
 assert.equal(await board.getByRole("button",{name:"发布业务版本",exact:true}).count(),0);
 assert.equal(new URL(page.url()).searchParams.get("runId"),run.id);
 assert.equal(await board.locator(".bk-map-edge").first().evaluate(edge=>{
  const point=edge.getPointAtLength(edge.getTotalLength()),screen=new DOMPoint(point.x,point.y).matrixTransform(edge.getScreenCTM());
  return [...document.querySelectorAll(".bk-map-node")].every(node=>{const r=node.getBoundingClientRect();return screen.x<r.left||screen.x>r.right||screen.y<r.top||screen.y>r.bottom;});
 }),true,"actual SVG arrow must not terminate behind an opaque card");
 await page.screenshot({path:path.join(directory,"business-map-1440.png"),fullPage:true});report.screenshots.push("business-map-1440.png");
 await board.getByRole("button",{name:"查看查询订单状态",exact:true}).click();
 await board.getByRole("heading",{name:"业务七问",exact:true}).waitFor();
 assert.equal(await board.getByRole("dialog",{name:"业务依据追溯",exact:true}).isVisible(),true);
 await board.getByLabel("图谱派生七问").getByText(/实际运行环境/).waitFor();
 report.checks.push("user-question-sentinel-accepted-pinned-source-model-profile-nonempty-persisted-graph-directed-edge-and-seven-questions");
 await page.screenshot({path:path.join(directory,"business-graph-1440.png"),fullPage:true});report.screenshots.push("business-graph-1440.png");
 const calls=fixture.model.calls.length;fixture.model.hold();
 await board.getByRole("button",{name:/回查原文 · 行1/}).first().click();
 await board.getByLabel("原文回查").locator("pre").getByText(/export function orderStatus/).waitFor();
 await board.getByLabel("原文回查").getByText(/摘要已核对/).waitFor();
 await board.getByRole("button",{name:"关闭追溯",exact:true}).click();
 await board.getByRole("button",{name:"复验权限并刷新图谱",exact:true}).click();
 await board.getByRole("button",{name:"材料覆盖",exact:true}).click();
 await board.getByRole("heading",{name:"材料与覆盖",exact:true}).waitFor();
 await page.reload();await page.getByTestId("business-knowledge-workbench").getByRole("heading",{name:"材料与覆盖",exact:true}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get("runId"),run.id);assert.equal(new URL(page.url()).searchParams.get("view"),"COVERAGE");
 assert.equal(fixture.model.calls.length,calls,"saved graph reads cannot trigger a model call");
 assert.ok(await page.getByText(question,{exact:true}).count());report.checks.push("material-original-digest-reverse-trace-model-offline-read-only-refresh-retains-exact-investigation-and-view");
 await board.getByRole("button",{name:"业务关系",exact:true}).click();
 await board.getByLabel("搜索保存图谱",{exact:true}).fill("不匹配的新搜索-"+randomUUID());await board.getByRole("button",{name:"搜索",exact:true}).click();
 await board.getByRole("heading",{name:"当前筛选内没有业务对象",exact:true}).waitFor();
 await board.getByLabel("搜索保存图谱",{exact:true}).fill("");await board.getByRole("button",{name:"搜索",exact:true}).click();
 await board.getByRole("button",{name:"查看查询订单状态",exact:true}).click();
 await page.keyboard.press("Escape");assert.equal(await board.getByRole("dialog",{name:"业务依据追溯"}).count(),0);
 assert.equal(fixture.model.calls.length,calls);report.checks.push("server-publication-blocked-without-local-override-search-empty-distinct-and-inspector-escape");
 await page.getByLabel("全局主题配色",{exact:true}).selectOption("dark");
 await page.screenshot({path:path.join(directory,"business-dark-1440.png"),fullPage:true});report.screenshots.push("business-dark-1440.png");
 await page.setViewportSize({width:900,height:900});
 await page.screenshot({path:path.join(directory,"business-narrow-900.png"),fullPage:true});report.screenshots.push("business-narrow-900.png");
 assert.equal(report.writes.length,1,"browsing cannot import evidence, publish, adopt or rerun analysis");assert.equal(report.writes[0].authorizationPresent,false);
 // Delay an actual admitted 202, not a forged response: the original operation
 // must remain recoverable without acquiring authority over a newer selection.
 fixture.model.release();await board.getByRole("button",{name:"新建业务调查",exact:true}).click();
 await board.getByLabel("材料版本",{exact:true}).selectOption(fixture.reference.bundleId);await board.locator(".bk-components input").check();
 await board.getByLabel("业务问题",{exact:true}).fill("DELAYED_ACK_SENTINEL");await board.getByLabel(/确认使用此 Main \/ Child 配置启动/).check();
 let release,saw;const gate=new Promise(resolve=>release=resolve),admitted=new Promise(resolve=>saw=resolve);let delayed;
 const pattern="**/business-knowledge/investigations";
 await page.route(pattern,async route=>{if(route.request().method()!=="POST")return route.continue();const actual=await route.fetch();delayed=(await actual.json()).investigation;saw();await gate;await route.fulfill({response:actual}).catch(()=>{});});
 await board.getByRole("button",{name:"开始业务调查",exact:true}).click();await admitted;
 await board.getByRole("button",{name:new RegExp(question.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"))}).click();
 await board.getByRole("button",{name:"查看查询订单状态",exact:true}).waitFor();
 await board.getByRole("button",{name:"新建业务调查",exact:true}).click();await board.getByRole("heading",{name:"新建调查",exact:true}).waitFor();
 release();await new Promise(resolve=>setTimeout(resolve,400));await page.unroute(pattern);
 assert.equal(new URL(page.url()).searchParams.get("runId"),run.id,"late accepted B cannot replace newer A navigation");
 assert.equal(await board.getByRole("heading",{name:"新建调查",exact:true}).isVisible(),true,"late B must not replace a fresh form");
 // Original journal is retained after leaving. Reconciliation is a read, not a
 // second POST, and only its currently mounted form may choose the result.
 await board.getByRole("button",{name:"查询原次提交",exact:true}).waitFor();
 let releaseLookup,sawLookup;const lookupGate=new Promise(resolve=>releaseLookup=resolve),lookupRead=new Promise(resolve=>sawLookup=resolve);
 const lookupPattern="**/business-knowledge/investigations?limit=1000";
 await page.route(lookupPattern,async route=>{const actual=await route.fetch();sawLookup();await lookupGate;await route.fulfill({response:actual}).catch(()=>{});});
 await board.getByRole("button",{name:"查询原次提交",exact:true}).click();await lookupRead;
 await board.getByRole("button",{name:new RegExp(question.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"))}).click();
 await board.getByRole("button",{name:"查看查询订单状态",exact:true}).waitFor();releaseLookup();await new Promise(resolve=>setTimeout(resolve,400));await page.unroute(lookupPattern);
 assert.equal(new URL(page.url()).searchParams.get("runId"),run.id,"late reconciliation cannot replace newer selection");
 await board.getByRole("button",{name:"新建业务调查",exact:true}).click();await board.getByRole("button",{name:"查询原次提交",exact:true}).waitFor();
 await board.getByRole("button",{name:"查询原次提交",exact:true}).click();await board.getByRole("heading",{name:"已保存分析",exact:true}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get("runId"),delayed.id);assert.equal(report.writes.length,2);
 report.checks.push("late-actual-202-keeps-newer-selection-and-original-operation-read-only-recovery-without-duplicate-post");
 await board.getByRole("button",{name:new RegExp(question.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"))}).click();await board.getByRole("button",{name:"查看查询订单状态",exact:true}).waitFor();
 // A real server-side role revocation must clear old authorized content.
 const admin=await fixture.runtime.identity.login({login:"admin",password:syntheticPassword});
 await fixture.runtime.identity.grant(admin.token,"workspace",{accountId:fixture.accounts.owner.id,roles:[]});
 await page.getByRole("alert").getByText("当前无权读取",{exact:true}).waitFor();
 assert.equal(await page.locator(".bk-graph-result").count(),0);assert.equal(await page.locator(".bk-original").count(),0);
 report.checks.push("real-current-role-revocation-removes-graph-and-original-without-retaining-cached-authority");
 report.modelCalls=fixture.model.calls.map(call=>({phase:call.phase,toolsDisabled:call.toolsDisabled,hasPrivateCwd:call.hasPrivateCwd}));
 report.status=report.errors.length?"FAILED":"PASSED";
}catch(error){report.status="FAILED";report.errors.push(error.stack??error.message);
 if(page&&!page.isClosed()){report.failure={url:page.url(),text:(await page.locator("body").innerText().catch(()=>"unavailable")).slice(-18000)};await page.screenshot({path:path.join(directory,"failure.png"),fullPage:true}).catch(()=>{});}
}finally{
 clearTimeout(timer);await browser?.close().catch(()=>{});
 if(front&&front.exitCode===null){front.kill("SIGTERM");await new Promise(resolve=>front.once("exit",resolve));}
 for(const cleanup of cleanups.reverse())await cleanup().catch(error=>report.errors.push(error.message));
 if(report.errors.length)report.status="FAILED";
 await writeFile(path.join(directory,"frontend.log"),logs.join(""),{flag:"wx"});await writeFile(path.join(directory,"summary.json"),JSON.stringify(report,null,2),{flag:"wx"});
 console.log(JSON.stringify({...report,parentPath:`${directory}/`,childPath:"summary.json"}));
}
if(report.status!=="PASSED")process.exitCode=1;
