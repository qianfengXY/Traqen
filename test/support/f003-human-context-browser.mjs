// Actual Cookie/native PG/UI, synthetic unrelated model/quality mechanisms.
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
const [modulePath,executablePath]=process.argv.slice(2),root=fileURLToPath(new URL('../../',import.meta.url));
const directory=await mkdtemp(path.join(tmpdir(),'traqen-f003-human-context-browser-'));
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
assert.ok(![3003,3004,6399].includes(port));
const origin=`http://127.0.0.1:${port}`,cleanups=[],logs=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','LC_CTYPE','SHELL'].flatMap(k=>process.env[k]===undefined?[]:[[k,process.env[k]]]));
const report={scope:'REAL_COOKIE_NATIVE_PG_HUMAN_FORM_CONTEXT_SYNTHETIC_MODEL_QUALITY_ONLY',status:'RUNNING',checks:[],errors:[],writes:[],sessionCreates:[],screenshots:[]};
let f,front,browser,page;
const url=(rid,key)=>`${origin}/?${new URLSearchParams({page:'graph',workspace:'workspace',knowledge:'published',publishedRevision:rid,publishedObject:key})}`;
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:v=>resolve(v)};};
const bounded=p=>Promise.race([p,sleep(20000).then(()=>{throw Error('No actual held HTTP receipt within 20s');})]);
async function shot(name){await page.screenshot({path:path.join(directory,name),fullPage:true});report.screenshots.push(name);}
try{
 const pg=await isolatedPostgres({after:cb=>cleanups.push(cb)});
 f=await webAuthorityFixture({after:cb=>cleanups.push(cb)},{database:()=>pg.createDatabase(),webOrigin:origin,workModelResponse:syntheticQuestion});
 f.model.release();await f.runtime.knowledge.start();
 const deadline=new Date(Date.now()+600000).toISOString(),budget={maxReadBytes:20000,maxModelCalls:12,deadline},supplementBudget={maxMaterials:10,maxBytes:20000,maxRuleApplications:100,maximumAttempts:2,deadline};
 const run=(await f.post('owner',`${f.base}/investigations`,{operationId:'human-context-business',question:'Unrelated synthetic published relation',reference:f.reference,expectedProfileId:f.profile.id,technicalVersionId:null,scope:{componentIds:[f.componentId]},budget,supplementBudget})).investigation;
 let row;for(let i=0;i<400;i++){row=(await f.request('owner',`${f.base}/investigations/${run.id}`)).body.investigation;if(['COMPLETED','FAILED'].includes(row.state))break;await sleep(40);}assert.equal(row.state,'COMPLETED');
 const pub=await f.publishMechanism(run.id,{retainForWork:true}),rid=pub.publication.graphRevisionId;
 const saved=(await f.request('owner',`${f.base}/versions/${rid}`)).body;
 const a=saved.graph.candidates[0],b=saved.graph.candidates.find(n=>n.key!==a.key),relation=saved.graph.relations[0];assert.ok(b&&relation);
 const auth=await f.prepareAuthority();
 front=spawn(process.execPath,[path.join(root,'web/node_modules/vinext/dist/cli.js'),'dev','--hostname','127.0.0.1','--port',String(port)],{cwd:path.join(root,'web'),env:{...env,TRAQEN_API_PROXY_TARGET:f.runtime.origin,NEXT_PUBLIC_TRAQEN_API_BASE:'/api',WRANGLER_LOG_PATH:path.join(directory,'wrangler.log')},stdio:['ignore','pipe','pipe']});
 front.stdout.on('data',b=>logs.push(b.toString()));front.stderr.on('data',b=>logs.push(b.toString()));const started=Date.now();
 while(true){try{if((await fetch(origin,{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}assert.ok(front.exitCode===null&&Date.now()-started<60000);await sleep(100);}
 const {chromium}=await import(pathToFileURL(modulePath).href);browser=await chromium.launch({executablePath,headless:true,env});page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(18000);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/decision-review-cases'))report.writes.push({path:new URL(r.url()).pathname,body:r.postDataJSON(),csrf:!!r.headers()['x-traqen-csrf'],bearer:!!r.headers().authorization});if(r.method()==='POST'&&/\/versions\/[^/]+\/work-sessions$/.test(new URL(r.url()).pathname))report.sessionCreates.push(r.postDataJSON().operationId);});
 await page.goto(origin);await page.getByLabel('账号',{exact:true}).fill('owner');await page.getByLabel('密码',{exact:true}).fill(syntheticPassword);await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByLabel('切换工作区',{exact:true}).selectOption('workspace');await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('link',{name:'业务图谱',exact:true}).click();await page.goto(url(rid,a.key));
 const human=page.getByRole('region',{name:'单条对象人工复核',exact:true});
 const choose=async record=>{if(record.kind==='RELATION'||record.key===relation.key){const edge=page.locator('details.bk-edge').first();await edge.locator('summary').first().click();await edge.getByRole('button',{name:'查看关系决定与执行',exact:true}).click();}else await page.getByRole('button',{name:`查看${record.name}`,exact:true}).first().click();await human.getByText(new RegExp(record.key)).first().waitFor();};
 const verify=async()=>{for(const k of ['featureId','featureVersion','claimId','claimVersion','scopeId','scopeVersion'])await human.getByLabel(k,{exact:true}).fill(String(auth.target[k]));await human.getByRole('button',{name:'读取并核对这条Claim的现有版本',exact:true}).click();await human.getByText(/当前服务端Feature\/Claim\/scope版本已核对/).waitFor();await human.getByRole('combobox',{name:'本次明确审核角色',exact:true}).selectOption('business-owner');await human.getByLabel('提案理由与适用条件',{exact:true}).fill('Only object A, not a graph-wide decision');};
 await human.getByText(/固定对象/).waitFor();await verify();
 await page.getByLabel('会话标题',{exact:true}).fill('Revision-scoped unsent session draft');
 await human.getByText('明确创建单条Feature / scope / Claim（如已有则不创建）',{exact:true}).click();
 await choose(b);
 const switched={claim:await human.getByLabel('claimId',{exact:true}).inputValue(),enabled:await human.getByRole('button',{name:'明确提出此Claim的决定复核',exact:true}).isEnabled(),rationale:await human.getByLabel('提案理由与适用条件',{exact:true}).inputValue()};report.switched=switched;
 assert.equal(switched.claim,'','R1: B must not inherit A Claim');assert.equal(switched.enabled,false,'R1: B must not inherit A verified status');assert.equal(switched.rationale,'');
 await human.getByText('明确创建单条Feature / scope / Claim（如已有则不创建）',{exact:true}).click();assert.equal(await human.getByLabel('Feature名称',{exact:true}).inputValue(),b.name??b.predicate??'');assert.equal(await human.getByRole('textbox',{name:'这一条Claim的明确陈述',exact:true}).inputValue(),b.statement??b.predicate??'');
 assert.equal(await page.getByLabel('会话标题',{exact:true}).inputValue(),'Revision-scoped unsent session draft');
 report.checks.push('R1-actual-A-to-B-isolates-Claim-verification-and-drafts-without-remounting-session-create');await human.screenshot({path:path.join(directory,'B-clean-human-form.png')});report.screenshots.push('B-clean-human-form.png');
 await choose(relation);await human.getByLabel('claimId',{exact:true}).fill('relation-only-draft');await human.getByLabel('提案理由与适用条件',{exact:true}).fill('relation draft');await choose(a);assert.equal(await human.getByLabel('claimId',{exact:true}).inputValue(),'');assert.equal(await human.getByLabel('提案理由与适用条件',{exact:true}).inputValue(),'');report.checks.push('relation-to-node-does-not-reuse-form-case-or-verification');
 await verify();
 const received=deferred(),release=deferred(),finished=deferred();let admitted;
 const held=async route=>{try{if(route.request().method()!=='POST')return await route.continue();const response=await route.fetch();assert.equal(response.status(),201);admitted=await response.json();received.resolve();await release.promise;await route.fulfill({response});finished.resolve();}catch(error){received.resolve({error});finished.resolve({error});}};
 await page.route('**/decision-review-cases',held);await human.getByRole('button',{name:'明确提出此Claim的决定复核',exact:true}).click();const r=await bounded(received.promise);if(r?.error)throw r.error;
 await choose(b);assert.equal(await human.getByRole('button',{name:'只读找回原人工提案',exact:true}).count(),0);release.resolve();const done=await bounded(finished.promise);if(done?.error)throw done.error;await page.unroute('**/decision-review-cases',held);
 assert.equal(await human.getByLabel('claimId',{exact:true}).inputValue(),'');assert.equal(await human.getByRole('region',{name:'独立审批案例',exact:true}).count(),0);
 await choose(a);await human.getByRole('button',{name:'只读找回原人工提案',exact:true}).waitFor();
 const originalJournal=await page.evaluate(({rid,key})=>{const k=Object.keys(localStorage).find(k=>k.startsWith('traqen.work.')&&decodeURIComponent(k).endsWith(`human:${rid}:${key}`));return {key:k,value:localStorage.getItem(k)};},{rid,key:a.key});assert.ok(originalJournal.key&&originalJournal.value);
 assert.equal(report.writes.length,1);assert.ok(admitted.reviewCase.proposedDecision.evidenceRefs.includes(`F003:${rid}:${a.key}`));report.checks.push('A-pending-to-B-late201-keeps-A-journal-and-does-not-populate-B');
 const originalId=admitted.reviewCase.id,got=deferred(),allow=deferred(),getDone=deferred();
 const holdGet=async route=>{try{const response=await route.fetch();got.resolve();await allow.promise;await route.fulfill({response});getDone.resolve();}catch(error){got.resolve({error});getDone.resolve({error});}};
 await page.route(`**/decision-review-cases/${originalId}`,holdGet);await human.getByRole('button',{name:'只读找回原人工提案',exact:true}).click();const g=await bounded(got.promise);if(g?.error)throw g.error;await choose(b);allow.resolve();await bounded(getDone.promise);await page.unroute(`**/decision-review-cases/${originalId}`,holdGet);
 assert.equal(await human.getByRole('region',{name:'独立审批案例',exact:true}).count(),0);await choose(a);await human.getByRole('button',{name:'只读找回原人工提案',exact:true}).click();await human.getByRole('region',{name:'独立审批案例',exact:true}).waitFor();assert.equal(await human.getByLabel('claimId',{exact:true}).inputValue(),auth.target.claimId);assert.equal(report.writes.length,1);report.checks.push('late-GET-keeps-new-object-and-return-to-A-recovers-original-through-GET-only');
 // A local coordinate is not authority: an A proposal planted in B's namespace
 // must remain unresolved and cannot populate B's form or case.
 const foreignKey=originalJournal.key.slice(0,originalJournal.key.lastIndexOf('.')+1)+encodeURIComponent(`human:${rid}:${b.key}`);
 await page.evaluate(({key,value})=>localStorage.setItem(key,value),{key:foreignKey,value:originalJournal.value});await choose(b);await human.getByRole('button',{name:'只读找回原人工提案',exact:true}).click();await human.getByRole('alert').waitFor();assert.equal(await human.getByRole('region',{name:'独立审批案例',exact:true}).count(),0);assert.equal(await page.evaluate(key=>localStorage.getItem(key),foreignKey),originalJournal.value);report.checks.push('tampered-readable-case-coordinate-for-another-object-is-rejected-and-retained');
 // The sibling revision-wide session draft/unknown admission must not reset
 // while changing human objects. Hold a real accepted201, not a fake success.
 const created=deferred(),drop=deferred(),dropped=deferred();let savedSession;
 const loseCreate=async route=>{try{if(route.request().method()!=='POST')return await route.continue();const response=await route.fetch();assert.equal(response.status(),201);savedSession=(await response.json()).session;created.resolve();await drop.promise;await route.abort('failed');dropped.resolve();}catch(error){created.resolve({error});dropped.resolve({error});}};
 await page.route('**/versions/*/work-sessions',loseCreate);await page.getByRole('button',{name:'显式创建此版本的工作会话',exact:true}).click();const cr=await bounded(created.promise);if(cr?.error)throw cr.error;await choose(a);drop.resolve();const dr=await bounded(dropped.promise);if(dr?.error)throw dr.error;await page.unroute('**/versions/*/work-sessions',loseCreate);await page.getByRole('button',{name:'读取原次会话',exact:true}).waitFor();await choose(b);assert.equal(await page.getByRole('button',{name:'读取原次会话',exact:true}).count(),1);assert.equal(await page.getByLabel('会话标题',{exact:true}).inputValue(),'Revision-scoped unsent session draft');assert.ok((await page.getByRole('region',{name:'创建图谱工作会话',exact:true}).innerText()).includes(savedSession.operationId));report.checks.push('real-lost-session201-and-revision-draft-survive-object-switches-without-replacement');
 const admin=await f.runtime.identity.login({login:'admin',password:syntheticPassword});await f.runtime.identity.grant(admin.token,'workspace',{accountId:f.accounts.owner.id,roles:[]});await page.waitForFunction(()=>!document.querySelector('[aria-label="单条对象人工复核"]'),{},{timeout:25000});assert.equal(await human.count(),0);report.checks.push('real-current-ACL-revocation-clears-human-review-without-reload');
 await page.close();page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(18000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(origin);await page.getByLabel('账号',{exact:true}).fill('reader');await page.getByLabel('密码',{exact:true}).fill(syntheticPassword);await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByLabel('切换工作区',{exact:true}).selectOption('workspace');await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('link',{name:'业务图谱',exact:true}).click();await page.goto(url(rid,a.key));
 const otherHuman=page.getByRole('region',{name:'单条对象人工复核',exact:true});await otherHuman.getByText(/固定对象/).waitFor();assert.equal(await otherHuman.getByRole('button',{name:'只读找回原人工提案',exact:true}).count(),0);assert.equal(await otherHuman.getByLabel('claimId',{exact:true}).inputValue(),'');
 const copiedActorKey=`traqen.work.${encodeURIComponent(f.accounts.reader.id)}.workspace.${encodeURIComponent(`human:${rid}:${a.key}`)}`;
 await page.evaluate(({key,value})=>localStorage.setItem(key,value),{key:copiedActorKey,value:originalJournal.value});await page.reload();await otherHuman.getByRole('button',{name:'只读找回原人工提案',exact:true}).click();await otherHuman.getByRole('alert').waitFor();assert.equal(await otherHuman.getByRole('region',{name:'独立审批案例',exact:true}).count(),0);assert.equal(await page.evaluate(key=>localStorage.getItem(key),copiedActorKey),originalJournal.value);report.checks.push('different-real-account-does-not-inherit-journal-and-copied-coordinate-cannot-consume-another-proposer');
 assert.equal(report.writes[0].csrf,true);assert.equal(report.writes[0].bearer,false);assert.equal(report.writes.length,1);assert.equal(report.sessionCreates.length,1);report.revision=rid;report.status='PASSED';
}catch(error){report.status='FAILED';report.errors.push(error.stack??String(error));try{await writeFile(path.join(directory,'failure-visible.txt'),await page.locator('body').innerText());await shot('failure.png');}catch{}process.exitCode=1;}
finally{await page?.unrouteAll({behavior:'ignoreErrors'});await browser?.close();if(front&&front.exitCode===null){front.kill('SIGTERM');await Promise.race([new Promise(r=>front.once('exit',r)),sleep(3000)]);if(front.exitCode===null)front.kill('SIGKILL');}for(const cleanup of cleanups.reverse())try{await cleanup();}catch(error){report.errors.push(`cleanup:${error.message}`);}if(report.errors.length)report.status='FAILED';await writeFile(path.join(directory,'frontend.log'),logs.join(''));await writeFile(path.join(directory,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,parentPath:directory+'/',childPath:'summary.json'}));if(report.status!=='PASSED')process.exitCode=1;}
