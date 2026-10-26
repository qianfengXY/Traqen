// Real F008/native HTTP and browser; unrelated synthetic reasoning/quality/
// recovery ports only. No production authority or real model-quality claim.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {isolatedPostgres} from './source-truth-postgres.js';
import {webAuthorityFixture} from './f003-web-authority-fixture.js';
import {syntheticQuestion} from './f003-work-ui-model.js';
import {syntheticPassword} from './f002-f003-server-fixture.js';
const [modulePath,executablePath]=process.argv.slice(2);
assert.ok(path.isAbsolute(modulePath??'')&&path.isAbsolute(executablePath??''));
const root=fileURLToPath(new URL('../../',import.meta.url)),directory=await mkdtemp(path.join(tmpdir(),'traqen-f003-published-reader-browser-'));
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const origin=`http://127.0.0.1:${port}`,cleanups=[],logs=[],env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','LC_CTYPE','SHELL'].flatMap(k=>process.env[k]===undefined?[]:[[k,process.env[k]]]));
const report={scope:'REAL_MINIMUM_READ_COOKIE_NATIVE_WEB_SYNTHETIC_MODEL_QUALITY_RECOVERY_ONLY',status:'RUNNING',checks:[],errors:[],writes:[],screenshots:[]};
let f,front,browser,page;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const timer=setTimeout(()=>{report.errors.push('Bounded browser deadline');front?.kill('SIGTERM');void browser?.close();},240000);
const url=(revision,object,material)=>`${origin}/?${new URLSearchParams({page:'graph',workspace:'workspace',knowledge:'published',publishedRevision:revision,...(object?{publishedObject:object}:{}),...(material?{publishedMaterial:material}:{})})}`;
const sessionURL=(sid,qid)=>`${origin}/?${new URLSearchParams({page:'graph',workspace:'workspace',knowledge:'sessions',...(sid?{sessionId:sid}:{}),...(qid?{questionId:qid}:{})})}`;
async function shot(name){await page.screenshot({path:path.join(directory,name),fullPage:true});report.screenshots.push(name);}
async function done(id){let r;for(let i=0;i<400;i++){r=(await f.request('owner',`${f.base}/investigations/${id}`)).body.investigation;if(['COMPLETED','FAILED'].includes(r.state))break;await sleep(40);}assert.equal(r.state,'COMPLETED',JSON.stringify(r));return r;}
async function login(name){await page.goto(origin);await page.getByLabel('账号',{exact:true}).fill(name);await page.getByLabel('密码',{exact:true}).fill(syntheticPassword);await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByLabel('切换工作区',{exact:true}).selectOption('workspace');await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('link',{name:'业务图谱',exact:true}).click();}
try{
 const cluster=await isolatedPostgres({after:cb=>cleanups.push(cb)});
 f=await webAuthorityFixture({after:cb=>cleanups.push(cb)},{database:()=>cluster.createDatabase(),webOrigin:origin,workModelResponse:syntheticQuestion});
 f.model.release();await f.runtime.knowledge.start();
 const deadline=new Date(Date.now()+600000).toISOString(),budget={maxReadBytes:20000,maxModelCalls:12,deadline},supplementBudget={maxMaterials:10,maxBytes:20000,maxRuleApplications:100,maximumAttempts:2,deadline};
 const run=(await f.post('owner',`${f.base}/investigations`,{operationId:'reader-browser-business',question:'Unrelated synthetic published rule',reference:f.reference,expectedProfileId:f.profile.id,technicalVersionId:null,scope:{componentIds:[f.componentId]},budget,supplementBudget})).investigation;
 await done(run.id);const first=await f.publishMechanism(run.id,{retainForWork:true}),rid=first.publication.graphRevisionId;
 const raw=(await f.request('owner',`${f.base}/versions/${rid}`)).body,key=raw.graph.candidates[0].key,relation=raw.graph.relations[0];assert.ok(relation,'fixture must contain a directed relation');
 const authority=await f.prepareAuthority();await authority.decide();await authority.ingest('PASS');await authority.ingest('FAIL');
 await f.post('owner',`${f.base}/versions/${rid}/authority-bindings`,{operationId:'reader-relation-mapping',expectedGraphDigest:raw.graph.digest,objectKey:relation.key,expectedVersion:0,rationale:'only this directed relationship and explicit scope',targets:[authority.target]});
 const sessions=[];for(let i=0;i<12;i++)sessions.push((await f.post('owner',`${f.base}/versions/${rid}/work-sessions`,{operationId:`server-index-${i}`,expectedGraphDigest:raw.graph.digest,title:`Server durable session ${i}`})).session);
 const saved=(await f.post('owner',`${f.base}/work-sessions/${sessions[11].id}/questions`,{operationId:'server-index-question',expectedSessionVersion:1,expectedProfileId:f.profile.id,question:'Retained v4 unknowns',objectKeys:null,budget:{...budget,maxModelCalls:5}})).request;await done(saved.id);
 const current=await f.publishMechanism(run.id,{retainForWork:true});assert.notEqual(current.publication.graphRevisionId,rid);
 const admin=await f.runtime.identity.login({login:'admin',password:syntheticPassword});await f.runtime.identity.grant(admin.token,'workspace',{accountId:f.accounts.reader.id,roles:['READ']});
 front=spawn(process.execPath,[path.join(root,'web/node_modules/vinext/dist/cli.js'),'dev','--hostname','127.0.0.1','--port',String(port)],{cwd:path.join(root,'web'),env:{...env,TRAQEN_API_PROXY_TARGET:f.runtime.origin,NEXT_PUBLIC_TRAQEN_API_BASE:'/api',WRANGLER_LOG_PATH:path.join(directory,'wrangler.log')},stdio:['ignore','pipe','pipe']});
 front.stdout.on('data',b=>logs.push(b.toString()));front.stderr.on('data',b=>logs.push(b.toString()));const start=Date.now();
 while(true){try{if((await fetch(origin,{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}assert.ok(front.exitCode===null&&Date.now()-start<60000,'owned frontend startup');await sleep(100);}
 console.log(JSON.stringify({phase:'owned-frontend-ready',port,origin,parentPath:directory+'/',childPath:'summary.json'}));
 const {chromium}=await import(pathToFileURL(modulePath).href);browser=await chromium.launch({executablePath,headless:true,env});page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
 const reads=[];page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{const u=new URL(r.url());if(u.pathname.includes('/business-knowledge/')){if(r.method()==='GET')reads.push(u.pathname+u.search);else report.writes.push({path:u.pathname,method:r.method(),csrf:!!r.headers()['x-traqen-csrf'],bearer:!!r.headers().authorization});}});
 await login('reader');await page.getByRole('button',{name:'已发布知识',exact:true}).click();await page.getByRole('button',{name:'打开当前头的精确发布版本',exact:true}).click();
 await page.getByRole('region',{name:'发布图谱查询',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('publishedRevision'),current.publication.graphRevisionId);
 assert.equal((await f.request('reader',`${f.base}/investigations/${run.id}`)).status,403);assert.equal(await page.getByRole('button',{name:'显式创建此版本的工作会话',exact:true}).isEnabled(),false);
 await page.goto(url(rid,relation.key));await page.getByRole('region',{name:'发布版本业务七问',exact:true}).waitFor();
 await page.getByLabel('仅显示已有明确人工确认的目标',{exact:true}).check();await page.getByText(/仅为关系端点提供上下文/).first().waitFor();
 const currentState=page.getByRole('region',{name:'当前状态分项',exact:true}).first();await currentState.getByText(/完整声明集合/).waitFor();assert.ok((await currentState.innerText()).includes('ui-test'));
 assert.ok(reads.some(p=>p.includes(`/versions/${rid}/seven-questions?key=${encodeURIComponent(relation.key)}`)));
 report.checks.push('minimum-READ-non-author-discovers-current-and-exact-history-relation-own-seven-human-filter-endpoint-context');
 await page.getByRole('button',{name:'材料覆盖',exact:true}).click();await page.getByRole('button',{name:'实现与依据',exact:true}).click();
 const originalClick=page.getByRole('button',{name:'orders.js',exact:true}).first();await originalClick.click();const original=page.getByRole('region',{name:'发布版本原文',exact:true});await original.getByText(/摘要已核对/).waitFor();assert.ok((await original.locator('pre').innerText()).length>0);await original.screenshot({path:path.join(directory,'published-original-1440.png')});report.screenshots.push('published-original-1440.png');
 const materialId=new URL(page.url()).searchParams.get('publishedMaterial');assert.ok(materialId);report.checks.push('published-original-exact-revision-bundle-receipt-and-byte-digest-before-inert-text-and-download');
 await page.goto(url('unknown-explicit-revision'));await page.getByText('指定结果不可读',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('publishedRevision'),'unknown-explicit-revision');assert.equal(await page.getByRole('region',{name:'发布图谱查询',exact:true}).count(),0);report.checks.push('unknown-exact-revision-does-not-substitute-current-head');
 const calls=f.model.calls.length;await page.goto(sessionURL());const index=page.getByRole('region',{name:'服务端工作会话清单',exact:true});await index.getByText('Server durable session 0',{exact:true}).waitFor();await index.getByRole('button',{name:'下一页会话',exact:true}).click();await index.getByText('Server durable session 11',{exact:true}).waitFor();
 await page.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('traqen.work'))localStorage.removeItem(k);});await page.reload();await index.getByRole('button',{name:'下一页会话',exact:true}).click();await index.getByRole('button',{name:'Server durable session 11',exact:true}).click();
 await page.getByRole('button',{name:'Retained v4 unknowns',exact:true}).click();await page.getByText('派生答案 · 非业务权威',{exact:true}).waitFor();await page.getByText('答案核查合同：4',{exact:false}).waitFor();await page.getByRole('button',{name:'打开此答案的来源发布版本',exact:true}).click();assert.equal(new URL(page.url()).searchParams.get('publishedRevision'),rid);
 assert.equal(f.model.calls.length,calls);report.checks.push('server-cursor-cross-page-discovery-survives-empty-localStorage-and-saved-QAv4-reference-is-exact-GET-only');
 await f.runtime.db.query("UPDATE source_truth_workspace SET backup_barrier=true WHERE workspace_id='workspace'");await page.goto(url(rid,key,materialId));await page.getByRole('region',{name:'发布版本原文',exact:true}).getByText(/摘要已核对/).waitFor();await f.runtime.db.query("UPDATE source_truth_workspace SET backup_barrier=false WHERE workspace_id='workspace'");report.checks.push('backup-period-published-read-keeps-original-without-write-or-model');
 assert.equal(report.writes.length,0,'minimum READ journey is GET only');assert.ok(!reads.some(p=>p.includes('/investigations/')),'no private investigation read fallback');
 await page.setViewportSize({width:900,height:1000});await page.emulateMedia({colorScheme:'dark'});await shot('published-reader-dark-900.png');
 await f.runtime.identity.grant(admin.token,'workspace',{accountId:f.accounts.reader.id,roles:[]});await page.reload();await sleep(1500);assert.equal(await page.getByRole('region',{name:'发布版本原文',exact:true}).count(),0);report.checks.push('actual-current-READ-revocation-clears-published-original-and-graph');
 await page.close();page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(r.url().includes('/business-knowledge/')&&r.method()!=='GET')report.writes.push({path:new URL(r.url()).pathname,method:r.method(),csrf:!!r.headers()['x-traqen-csrf'],bearer:!!r.headers().authorization});});await login('owner');await page.goto(url(rid));
 // The pending-coordinate button appears BEFORE the HTTP response. It is not
 // evidence that route.fetch/abort completed. Await the actual receipt and
 // completed interception before removing the handler or reading its result.
 let received;const intercepted=new Promise(resolve=>{received=resolve;});
 const loseReceipt=async route=>{
  try{
   if(route.request().method()!=='POST')return await route.continue();
   const response=await route.fetch();assert.equal(response.status(),201);
   const value=await response.json();await route.abort('failed');received({value});
  }catch(error){received({error});}
 };
 await page.route('**/versions/*/work-sessions',loseReceipt);
 await page.getByLabel('会话标题',{exact:true}).fill('Lost actual 201 recover through own-operation GET');await page.getByRole('button',{name:'显式创建此版本的工作会话',exact:true}).click();
 const admitted=await Promise.race([intercepted,sleep(20000).then(()=>({error:Error('No actual create receipt observed within the probe deadline')}))]);
 if(admitted.error)throw admitted.error;
 const lost=admitted.value;assert.ok(lost);
 await page.unroute('**/versions/*/work-sessions',loseReceipt);await page.getByRole('button',{name:'读取原次会话',exact:true}).waitFor();
 await page.getByRole('button',{name:'读取原次会话',exact:true}).click();await page.getByRole('region',{name:'当前工作会话',exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('sessionId'),lost.session.id);report.checks.push('lost-actual-create201-without-resultId-recovers-own-operation-through-GET-no-replacement');
 await page.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('traqen.work'))localStorage.removeItem(k);});await page.goto(sessionURL());await page.getByText('按本人原操作键找回受理',{exact:true}).click();await page.getByLabel('原操作键',{exact:true}).fill(lost.session.operationId);await page.getByLabel('操作发起时的发布版本 ID（未采用时留空）',{exact:true}).fill(rid);await page.getByRole('button',{name:'仅 GET 查找原受理',exact:true}).click();await page.getByRole('region',{name:'已定位原操作',exact:true}).waitFor();await page.getByRole('button',{name:'打开已核对的原次结果',exact:true}).click();assert.equal(new URL(page.url()).searchParams.get('sessionId'),lost.session.id);report.checks.push('manual-own-operation-recovery-survives-cleared-local-coordinates');
 assert.equal(report.writes.length,1,'lost receipt recovery and manual recovery must not create a second write');assert.equal(report.writes[0].csrf,true);assert.equal(report.writes[0].bearer,false);
 report.status=report.errors.length?'FAILED':'PASSED';
}catch(e){report.status='FAILED';report.errors.push(e.stack??String(e));try{report.currentURL=page.url();await writeFile(path.join(directory,'failure-visible-text.txt'),await page.locator('body').innerText());await shot('failure.png');}catch{}process.exitCode=1;}
finally{clearTimeout(timer);await page?.unrouteAll({behavior:'wait'}).catch(e=>report.errors.push(`route-cleanup:${e.message}`));await browser?.close();if(front&&front.exitCode===null){front.kill('SIGTERM');await Promise.race([new Promise(r=>front.once('exit',r)),sleep(3000)]);if(front.exitCode===null)front.kill('SIGKILL');}for(const cleanup of cleanups.reverse())try{await cleanup();}catch(e){report.errors.push(`cleanup:${e.message}`);process.exitCode=1;}if(report.errors.length)report.status='FAILED';await writeFile(path.join(directory,'frontend.log'),logs.join(''));await writeFile(path.join(directory,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,parentPath:directory+'/',childPath:'summary.json'}));if(report.status!=='PASSED')process.exitCode=1;}
