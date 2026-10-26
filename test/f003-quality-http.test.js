import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {authorityFixture} from './support/f003-authority-fixture.js';
import {qualityContractFixture} from './support/f003-quality-contract-fixture.js';
import {isolatedPostgres} from './support/source-truth-postgres.js';
import {owner} from './support/source-truth-database.js';
import {InvestigationWorker} from '../src/business-knowledge/worker.js';
import {AuthService} from '../src/auth/service.js';
import {AuthRepository} from '../src/auth/repository.js';
import {AuthHttp} from '../src/auth/http.js';
import {contextualDatabase} from '../src/auth/database.js';
import {SourceTruthRepository} from '../src/source-truth/repository.js';
import {SourceCandidateService} from '../src/source-truth/candidate-service.js';
import {SourceMaterialRepository} from '../src/source-truth/material-repository.js';
import {SourceAdmissionService} from '../src/source-truth/admission-service.js';
import {createF003Runtime} from '../src/business-knowledge/runtime.js';
import {createTraceabilityHttpHandler} from '../src/api/http-server.js';
import {F003PublicationService} from '../src/business-knowledge/publication-service.js';
import {loadPublicationAuthority,publicationDigest} from '../src/business-knowledge/publication-authority.js';
import {canonicalEncode} from '../src/source-truth/identity.js';

// Real native PostgreSQL, F001, domain/SQL and F008 HTTP. Reasoning, calibration,
// quality and prior fixture recovery/volume ports are SYNTHETIC MECHANISM ONLY.
// Even numerically eligible signed metadata must not unlock absent real gates.
test('F003 graph-native quality uses private deployment trust, real F008 write fences and immutable native evidence without opening publication',async t=>{
  const cluster=await isolatedPostgres(t),database=await cluster.createDatabase(),{db,name}=database;
  const f=await authorityFixture(t,{database:async()=>database});
  await f.closeHttp();
  const run=await f.investigations.start(owner,'workspace',{...f.request,operationId:'quality-native-analysis'});
  const worker=new InvestigationWorker({investigations:f.investigations,invokeModel:async c=>{
    const reservation=await f.investigations.reserveModelCall(owner,'workspace',c.investigationId,c),i=c.input;
    const result=i.phase==='PLAN'?{assignments:[{slotId:'child-1',obligations:["核查本任务原文条件、反例与未供应前提（机制替身）"],objective:'synthetic mechanism only',materialKeys:i.inventory.map(m=>m.key)}]}:
      i.phase==='INVESTIGATE'?{candidates:[{key:'rule',kind:'RULE',name:'synthetic rule',statement:'用户可取消未支付订单',scope:'mechanism only',
        evidence:[{materialId:i.materials[0].id,startLine:1,endLine:1,quote:i.materials[0].text}],uncertainties:[]}],relations:[]}:
      i.stage==='CONSOLIDATE_PROPOSALS'?{mergeSuggestions:[],conflictGroups:[]}:
      {reviews:i.candidates.map(p=>({key:p.key,support:'SUPPORTED',rationale:'test double, no quality claim',premises:['mechanism only'],unresolvedConflicts:[]}))};
    return {result,reservationId:reservation.id};
  }});
  await worker.run(owner,'workspace',run.id,{workerId:'quality-fixture-only'});
  const original=(await f.runtime.services.publications.readiness(owner,'workspace',run.id)).binding;
  assert.deepEqual(original.technicalVersions,[]);
  assert.equal(original.questionDigest,publicationDigest(f.request.question));
  assert.deepEqual(original.budget,{...f.request.budget,deadline:new Date(f.request.budget.deadline).toISOString()});
  assert.deepEqual(original.supplementBudget,{...f.request.supplementBudget,deadline:new Date(f.request.supplementBudget.deadline).toISOString()});
  assert.match(original.runContractDigest,/^[a-f0-9]{64}$/);
  assert.ok(original.sourceInput.components.every(c=>c.kind==='DIRECTORY_UPLOAD'));
  assert.deepEqual(original.investigationScope,f.request.scope);
  assert.ok(original.sourceManifest.entryCount>0);
  const entries=(await db.query(`SELECT c.id,e.entry,e.disposition FROM source_truth_component c
    JOIN source_truth_entry e ON e.workspace_id=c.workspace_id AND e.run_id=c.run_id AND e.source_id=c.source_id
    WHERE c.workspace_id='workspace' AND c.id=ANY($1::text[]) ORDER BY c.id,e.path_bytes`,[f.request.scope.componentIds])).rows;
  const map=createHash('sha256');
  for(const r of entries) {
    if(r.entry.kind!=='DIRECTORY')assert.equal(r.disposition.digest,r.entry.expectedContent.digest,'actual uploaded bytes retain their own F001 identity');
    map.update(canonicalEncode({componentId:r.id,pathBytes:r.entry.pathBytes,kind:r.entry.kind,
      contentDigest:r.disposition?.digest??null,sizeBytes:r.entry.sizeBytes??null,disposition:r.disposition?.disposition??'PENDING'})).update('\n');
  }
  assert.equal(original.sourceManifest.entriesDigest,map.digest('hex'));
  assert.equal(original.sourceManifest.entryCount,entries.length);
  const graph=await f.investigations.graph(owner,'workspace',run.id),measurement=qualityContractFixture({binding:original,inventorySize:graph.coverage.length});
  const directory=await mkdtemp(join(tmpdir(),'traqen-quality-http-mechanism-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const configFile=join(directory,'authority.json'),reportFile=join(directory,'reports.json');
  const invalid=structuredClone(measurement.quality);invalid.population.outputClaims++;
  const failedDocument=measurement.document(invalid),goodDocument=measurement.document();
  const malformed=structuredClone(measurement.quality);
  malformed.attempts[0].leftBinding={investigationId:'incomplete-binding',graphDigest:'f'.repeat(64)};
  malformed.artifacts.attemptLedgerDigest=publicationDigest(malformed.attempts);
  const malformedDocument=measurement.document(malformed);
  const missingImplementation=structuredClone(measurement.quality);delete missingImplementation.finalImplementation;
  const missingImplementationDocument=measurement.document(missingImplementation);
  const laterMalformedDocument=measurement.document(malformed,{observedAt:'2026-01-01T00:00:01Z'});
  await writeFile(reportFile,JSON.stringify({artifacts:[failedDocument]}),{mode:0o600});
  await writeFile(configFile,JSON.stringify({version:1,...measurement.config,artifactFiles:[reportFile]}),{mode:0o600});
  const identity=new AuthService({repository:new AuthRepository(contextualDatabase(db)),key:Buffer.alloc(32,83)}),password='quality-test-password1';
  const admin=await identity.initialize({login:'admin',displayName:'quality test admin',password});
  const adminSession=await identity.login({login:'admin',password}),accounts={};
  for(const login of ['owner','reader']) {
    const created=await identity.createAccount(adminSession.token,{login,displayName:`isolated ${login}`});
    await identity.setPassword({credential:created.credential,password});accounts[login]=created.account;
  }
  await identity.migrate({bindings:['owner','reader'].map(principalId=>({principalId,accountId:accounts[principalId].id})),
    owners:[{workspaceId:'workspace',accountId:admin.id}],grants:[{workspaceId:'workspace',accountId:accounts.owner.id,roles:['MAINTAIN']},
      {workspaceId:'workspace',accountId:accounts.reader.id,roles:['READ']}],confirmed:true,requestedBy:'ISOLATED_MECHANISM'});
  let handler;
  const server=createServer((req,res)=>handler(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const close=async()=>{if(server.listening)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});};t.after(close);
  const origin=`http://127.0.0.1:${server.address().port}`,repository=new SourceTruthRepository(db,{identityService:identity});
  const admission=new SourceAdmissionService(repository,new SourceCandidateService(repository,new SourceMaterialRepository(repository),f.blobs));
  const runtime=await createF003Runtime({publicationAuthorityFile:configFile,application:f.application,sourceRuntime:{pool:db,
    services:{repository,admission},configuration:{members:[],origins:[origin]}}});t.after(()=>runtime.close());
  handler=createTraceabilityHttpHandler({application:f.application,auth:new AuthHttp({service:identity,origin,development:true}),businessKnowledgeHandler:runtime.businessKnowledgeHandler});
  const root=`${origin}/v1/workspaces/workspace/business-knowledge/investigations/${run.id}`;
  async function login(login) {
    const csrf=await fetch(`${origin}/v1/auth/csrf`),proof=await csrf.json();
    const response=await fetch(`${origin}/v1/auth/login`,{method:'POST',headers:{origin,'content-type':'application/json','x-traqen-csrf':proof.csrfToken,
      cookie:csrf.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')},body:JSON.stringify({login,password})});
    const body=await response.json();assert.equal(response.status,200);
    return {cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),csrf:body.csrfToken};
  }
  const own=await login('owner'),read=await login('reader');
  const request=(session,tail,{method='GET',body={},headers={}}={})=>fetch(root+'/'+tail,{method,
    headers:{origin,cookie:session.cookie,...(method==='POST'?{'content-type':'application/json','x-traqen-csrf':session.csrf}:{}),...headers},
    body:method==='POST'?JSON.stringify(body):undefined});
  const count=async()=>Number((await db.query('SELECT count(*) AS n FROM f003_publication_evidence WHERE binding_digest=$1',
    [publicationDigest(original)])).rows[0].n);
  assert.equal(await count(),0);
  assert.equal((await request(read,'import-publication-evidence',{method:'POST'})).status,403);
  assert.equal((await request(own,'import-publication-evidence',{method:'POST',headers:{'x-traqen-csrf':'wrong'}})).status,403);
  assert.equal((await request(own,'import-publication-evidence',{method:'POST',body:{issuer:'client-issuer',qualityPassed:true}})).status,422);
  await db.query("UPDATE source_truth_workspace SET backup_barrier=true WHERE workspace_id='workspace'");
  assert.equal((await request(own,'publication-readiness')).status,200);assert.equal(await count(),0,'GET cannot import approved artifacts');
  assert.equal((await request(own,'import-publication-evidence',{method:'POST'})).status,409);assert.equal(await count(),0);
  await db.query("UPDATE source_truth_workspace SET backup_barrier=false WHERE workspace_id='workspace'");
  assert.equal((await request(own,'import-publication-evidence',{method:'POST'})).status,200);assert.equal(await count(),1);
  const failed=(await (await request(own,'publication-readiness')).json()).readiness;
  assert.ok(failed.missing.some(e=>e.code==='F003_QUALITY_DENOMINATOR'));
  await writeFile(reportFile,JSON.stringify({artifacts:[failedDocument,malformedDocument]}),{mode:0o600});
  assert.equal((await request(own,'import-publication-evidence',{method:'POST'})).status,200);assert.equal(await count(),2);
  const badResponse=await request(own,'publication-readiness');assert.equal(badResponse.status,200,'signed malformed comparison must not become HTTP500');
  const bad=(await badResponse.json()).readiness;assert.equal(bad.status,'BLOCKED');
  assert.ok(bad.missing.some(e=>e.code==='F003_QUALITY_COMPARISON_BINDING_MISMATCH'));
  await writeFile(reportFile,JSON.stringify({artifacts:[failedDocument,malformedDocument,missingImplementationDocument]}),{mode:0o600});
  assert.equal((await request(own,'import-publication-evidence',{method:'POST'})).status,200);assert.equal(await count(),3);
  const missingResponse=await request(own,'publication-readiness');assert.equal(missingResponse.status,200);
  assert.ok((await missingResponse.json()).readiness.missing.some(e=>e.code==='F003_QUALITY_SCOPE_MISMATCH'));
  await writeFile(reportFile,JSON.stringify({artifacts:[failedDocument,malformedDocument,missingImplementationDocument,goodDocument]}),{mode:0o600});
  assert.equal((await request(own,'import-publication-evidence',{method:'POST'})).status,200);assert.equal(await count(),4);
  const ready=(await (await request(own,'publication-readiness')).json()).readiness;
  assert.equal(ready.status,'BLOCKED');assert.ok(ready.evidenceRefs.quality);
  assert.ok(ready.missing.some(e=>e.code==='F003_BACKUP_UNAVAILABLE'));assert.ok(ready.missing.some(e=>e.code==='F003_PAIRED_RECOVERY_MISSING'));
  const publish=await request(own,'publish',{method:'POST',body:{operationId:'cannot-publish-synthetic-quality',expectedGraphDigest:graph.digest,expectedHeadVersion:1}});
  assert.equal(publish.status,409);assert.equal((await publish.json()).error.code,'F003_PUBLICATION_BLOCKED');
  await writeFile(reportFile,JSON.stringify({artifacts:[failedDocument,malformedDocument,missingImplementationDocument,goodDocument,laterMalformedDocument]}),{mode:0o600});
  assert.equal((await request(own,'import-publication-evidence',{method:'POST'})).status,200);assert.equal(await count(),5);
  const laterResponse=await request(own,'publication-readiness');assert.equal(laterResponse.status,200);
  const later=(await laterResponse.json()).readiness;assert.equal(later.status,'BLOCKED');assert.equal(later.evidenceRefs.quality,ready.evidenceRefs.quality);
  const stored=(await db.query('SELECT document FROM f003_publication_evidence WHERE binding_digest=$1 ORDER BY id',
    [publicationDigest(original)])).rows;
  const freshAdmin=await identity.login({login:'admin',password});
  await identity.grant(freshAdmin.token,'workspace',{accountId:accounts.owner.id,roles:[]});
  assert.equal((await request(own,'import-publication-evidence',{method:'POST'})).status,403);
  assert.equal((await request(own,'publication-readiness')).status,403);
  await runtime.close();await close();await cluster.restart();
  const recovered=cluster.pool(name),records=(await recovered.query('SELECT document FROM f003_publication_evidence WHERE binding_digest=$1 ORDER BY id',
    [publicationDigest(original)])).rows;
  assert.deepEqual(records,stored,'invalid attempt and later eligible mechanism report both persist byte-for-byte');
  const authority=await loadPublicationAuthority(configFile);
  for(const record of records)authority.verify(record.document,original);
  const offline=new F003PublicationService({sources:new SourceTruthRepository(recovered),authority});
  assert.equal(offline.qualityPolicy.adapterId,measurement.policy.adapterId);
  console.log(JSON.stringify({kind:'SYNTHETIC_GRAPH_QUALITY_NATIVE_HTTP_MECHANISM_ONLY',nativeRestart:true,immutableReports:records.length,
    realSemanticQuality:false,realProtectedMedia:false,realModelCalls:0,publicationOpened:false}));
});
