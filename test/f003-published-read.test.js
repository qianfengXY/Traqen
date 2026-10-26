import assert from 'node:assert/strict';
import test from 'node:test';
import {authorityFixture} from './support/f003-authority-fixture.js';
import {owner, reader} from './support/source-truth-database.js';
import {createHash} from 'node:crypto';
import {completeInput} from './fixtures.js';
import {createExecutionEvidenceBundle,signExecutionEvidenceBundle} from '../src/domain/index.js';
import {F002Repository} from '../src/deterministic-facts/repository.js';
import {F002AdmissionService} from '../src/deterministic-facts/admission.js';
import {F002Worker} from '../src/deterministic-facts/worker.js';
import {F002PublicationService} from '../src/deterministic-facts/publication-service.js';
import {boundedF002Profile} from '../src/deterministic-facts/runtime.js';
import {InvestigationWorker} from '../src/business-knowledge/worker.js';

const readerHeaders={authorization:'Bearer isolated-reader-token'};
test('F003 exact published revision exposes current confirmed targets to non-author minimum READ, keeping private analysis private',async t=>{
  const f=await authorityFixture(t), rid=f.published.publication.graphRevisionId, route=`${f.root}/versions/${rid}`;
  await f.runtime.services.authorityBindings.bind(owner,'workspace',rid,f.bindingRequest);
  await f.decide('CONFIRMED','2026-10-24T00:00:00Z');
  const privateResponse=await fetch(`${f.root}/investigations/${f.run.id}/graph`,{headers:readerHeaders});
  assert.equal(privateResponse.status,403);
  const response=await fetch(`${route}/graph?view=BUSINESS&onlyHumanConfirmed=true`,{headers:readerHeaders});
  const body=await response.json(); assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(body.graph.graphRevisionId,rid);
  assert.equal(body.graph.graphDigest,f.graph.digest);
  const node=body.graph.nodes.find(n=>n.key===f.bindingRequest.objectKey); assert.ok(node);
  assert.equal(node.authority,'AGENT_ANALYSIS');
  assert.equal(node.currentAuthority.confirmedTargets.length,1);
  assert.equal(node.currentAuthority.objectAuthority,'NOT_ESTABLISHED_BY_MAPPING');
  assert.deepEqual(Object.keys(node.stateDimensions),['authority','conformance','verification','freshness','conflict']);
  assert.equal(node.stateDimensions.conformance.status,'UNKNOWN');assert.equal(node.stateDimensions.freshness.status,'UNKNOWN');
  assert.equal(node.stateDimensions.conflict.status,'UNKNOWN');
  assert.deepEqual(await f.investigations.graph(owner,'workspace',f.run.id),f.graph);
  f.setTime('2026-10-25T00:00:00Z');
  const expired=await fetch(`${route}/graph?onlyHumanConfirmed=true`,{headers:readerHeaders});
  assert.equal(expired.status,200); assert.deepEqual((await expired.json()).graph.nodes,[]);
  const projection=await f.runtime.services.authorityBindings.project(reader,'workspace',rid,f.bindingRequest.objectKey);
  assert.equal(projection.projection.targets[0].authority.status,'DEPRECATED');
});

test('F003 published technical binding reads the explicitly adopted historical profile, not active models or separately sampled admission timestamps',async t=>{
  const f=await authorityFixture(t,{sourceOptions:{entryPath:'orders.js',content:'export function cancelOrder() { return true; }'}}),s=f.runtime.services;
  const facts=new F002Repository(f.db,{authorize:(actor,w,tx,maintain)=>f.repository.authorize(actor,w,maintain,tx)});
  const profile=boundedF002Profile();await facts.registerProfile(profile);
  const admission=new F002AdmissionService(facts,f.sourceAdmission);
  const factRun=await admission.start(owner,'workspace',{operationId:'published-technical',reference:f.reference,profile,
    scopes:[{selections:[{kind:'COMPONENT',componentId:f.request.scope.componentIds[0]}]}]});
  const scope=await new F002Worker(facts,{admission}).run(owner,'workspace',factRun.id,factRun.scopes[0].scopeId,{workerId:'published-facts',leaseMs:60000});
  const version=await new F002PublicationService(facts).publish(owner,'workspace',factRun.id,scope.scopeId,{revision:scope.revision,operationId:'published-facts-version'});
  const run=await f.investigations.start(owner,'workspace',{...f.request,operationId:'technical-business-read',technicalVersionId:version.graphVersionId});
  assert.notEqual(run.sourceInput.qualifiedAt,factRun.sourceInput.qualifiedAt,'consumer admissions have separate timestamps');
  const worker=new InvestigationWorker({investigations:f.investigations,invokeModel:async c=>{
    const reservation=await f.investigations.reserveModelCall(owner,'workspace',run.id,c),i=c.input;
    const result=i.phase==='PLAN'?{assignments:[{slotId:'child-1',obligations:["核查本任务原文条件、反例与未供应前提（机制替身）"],objective:'mechanism only',materialKeys:i.inventory.map(m=>m.key)}]}
      :i.phase==='INVESTIGATE'?{candidates:[{key:'code-rule',kind:'RULE',name:'frozen rule',statement:'frozen source declares cancelOrder',scope:'isolated',uncertainties:[],
        evidence:[{materialId:i.materials[0].id,startLine:1,endLine:1,quote:i.materials[0].text}]}],relations:[]}
      :{reviews:i.candidates.map(p=>({key:p.key,support:'SUPPORTED',rationale:'explicit mechanism double',premises:[],unresolvedConflicts:[]}))};
    return {result,reservationId:reservation.id};
  }});
  await worker.run(owner,'workspace',run.id,{workerId:'published-business'});
  const graph=await f.investigations.graph(owner,'workspace',run.id);
  const published=await f.publishAnalysis(run.id,graph,{operationId:'publish-technical-bound',expectedHeadVersion:1});
  await f.db.query('UPDATE f002_profile SET startable=false WHERE id=$1',[profile.id]);
  s.investigations.profiles={resolveActive:()=>{throw Error('offline');}};
  const view=await s.publishedReads.graph(reader,'workspace',published.publication.graphRevisionId,{});
  assert.deepEqual(view.adoptedVersionIds,[version.graphVersionId]);
  assert.equal(view.technicalVersions[0].profileId,profile.id);assert.ok(view.technicalVersions[0].recordDigest);
  assert.equal(view.sourceInput.receiptId,f.reference.receiptId);
});

test('F003 published raw bytes are withheld when current ACL is revoked after the final source chunk',async t=>{
  const f=await authorityFixture(t),reads=f.runtime.services.publishedReads,original=reads.reader.readFile.bind(reads.reader);
  reads.reader.readFile=async function*(...args) {
    yield* original(...args);
    await f.db.query("DELETE FROM source_truth_access_legacy WHERE actor_id='reader'");
  };
  await assert.rejects(reads.material(reader,'workspace',f.published.publication.graphRevisionId,f.graph.materials[0].id),{status:403});
});

test('F003 current human confirmation does not depend on a model accepting the proposition and never overwrites its UNKNOWN analysis',async t=>{
  const f=await authorityFixture(t,{analysisSupport:'UNKNOWN'}),s=f.runtime.services,rid=f.published.publication.graphRevisionId;
  assert.equal(f.graph.candidates[0].state,'RETAINED_UNKNOWN');
  assert.deepEqual((await s.publishedReads.graph(reader,'workspace',rid)).nodes,[]);
  await s.authorityBindings.bind(owner,'workspace',rid,f.bindingRequest);await f.decide('CONFIRMED');
  const human=await s.publishedReads.graph(reader,'workspace',rid,{onlyHumanConfirmed:true});
  assert.equal(human.nodes.length,1);assert.equal(human.nodes[0].state,'RETAINED_UNKNOWN');
  assert.equal(human.nodes[0].currentAuthority.confirmedTargets[0].authority.status,'CONFIRMED');
  assert.deepEqual(await f.investigations.graph(owner,'workspace',f.run.id),f.graph);
});

test('F003 published READ keeps exact relation endpoints, raw digest and all GET tables unchanged during backup',async t=>{
  const f=await authorityFixture(t,{includeRelation:true}),s=f.runtime.services,rid=f.published.publication.graphRevisionId;
  const relation=f.graph.relations[0]; assert.equal(relation.state,'ANALYSIS_ACCEPTED');
  await s.authorityBindings.bind(owner,'workspace',rid,{...f.bindingRequest,objectKey:relation.key});
  await f.decide('CONFIRMED');
  const query=path=>fetch(`${f.root}/versions/${rid}/${path}`,{headers:readerHeaders});
  const human=await (await query('graph?view=IMPLEMENTATION&onlyHumanConfirmed=true')).json();
  assert.equal(human.graph.edges[0].key,relation.key);
  assert.equal(human.graph.nodes[0].selectionRole,'ENDPOINT_CONTEXT_ONLY');
  assert.equal(human.graph.nodes[0].currentAuthority.confirmedTargets.length,0);
  const trace=await (await query(`trace?key=${relation.key}`)).json();
  assert.equal(trace.trace.edges.length,1);assert.equal(trace.trace.edges[0].sourceKey,relation.sourceKey);
  assert.equal(trace.trace.edges[0].targetKey,relation.targetKey);assert.equal(trace.trace.materials.length,1);
  const material=f.graph.materials[0];
  // Historical reads do not requalify a model/config or run publication gates.
  s.publications.qualityPolicy=null;s.publications.backup=null;
  s.investigations.profiles={resolveActive:()=>{throw Error('offline');},assertUsable:()=>{throw Error('offline');}};
  const counts=()=>f.db.query(`SELECT (SELECT count(*) FROM source_truth_event) events,
    (SELECT count(*) FROM understanding_record) records,(SELECT count(*) FROM f003_publication_evidence) proofs,
    (SELECT count(*) FROM f003_authority_binding_set) bindings,(SELECT count(*) FROM f003_investigation_event) calls`);
  await f.db.query("UPDATE source_truth_workspace SET backup_barrier=true WHERE workspace_id='workspace'");
  const before=await counts();
  for(const path of ['graph?view=COVERAGE',`trace?materialId=${material.id}`,`seven-questions?key=${relation.key}`,'materials']) {
    const r=await query(path);assert.equal(r.status,200,await r.clone().text());
  }
  const raw=await query(`materials/${material.id}`);assert.equal(raw.status,200,await raw.clone().text());
  const bytes=Buffer.from(await raw.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),material.sourceMaterial.contentDigest);
  assert.equal(raw.headers.get('x-original-sha256'),material.sourceMaterial.contentDigest);
  assert.equal(raw.headers.get('x-graph-revision-id'),rid);
  assert.equal(raw.headers.get('x-source-receipt-id'),f.reference.receiptId);
  assert.deepEqual(await counts(),before);
  assert.equal((await query('materials/not-in-this-version')).status,404);
  assert.equal((await query(`trace?key=${relation.key}&materialId=${material.id}`)).status,422);
  assert.equal((await query('graph?onlyHumanConfirmed=1')).status,422);
  await f.db.query("UPDATE source_truth_workspace SET backup_barrier=false WHERE workspace_id='workspace'");
  const old=await s.publications.version(reader,'workspace',rid);
  assert.equal(old.graph.digest,f.graph.digest);
});

async function execution(f) {
  const snapshot=await f.application.registerSnapshot('workspace',completeInput().snapshotManifest);
  await f.application.appendTestSpecDraft('workspace',{id:'published-spec',version:1,name:'isolated trusted receipt projection',risk:'LOW',approved:false,
    featureId:f.claim.featureId,verifiesClaims:[{id:f.claim.id,version:f.claim.version}],environment:{target:'sit',operationLevel:'SAFE_READ'},
    steps:[{id:'read',executor:'HTTP',method:'GET',path:'/isolated-order'}],assertions:[{id:'check',type:'HTTP_STATUS',stepId:'read',expected:200}],
    cleanup:null,policy:{approvalRequired:true}});
  const spec=await f.application.approveTestSpec('workspace','published-spec',{expectedVersion:1,rationale:'mechanism only'});
  const ref={testSpecId:spec.id,testSpecVersion:spec.version,snapshotManifestId:snapshot.id,deploymentId:snapshot.components.deployment.id};
  return {ref,ingest:async(id,status)=>{
    const time='2026-10-23T06:00:00.000Z';
    const execution={id,...ref,runner:{id:'isolated-runner',version:'1'},completionReason:'COMPLETED',startedAt:time,finishedAt:time,
      attempts:[{number:1,startedAt:time,finishedAt:time,phaseStatus:status,stepResults:[{id:'read',status}],
        assertionResults:[{id:'check',status,actual:status==='PASS'?200:500}],cleanup:{status:'SKIPPED'}}]};
    const bundle=createExecutionEvidenceBundle({execution,evidence:[{id:`proof-${id}`,type:'ASSERTION',freshness:'FRESH',manifest:{
      executionId:id,...ref,runnerId:'isolated-runner',runnerVersion:'1',snapshotComponents:Object.fromEntries(Object.entries(snapshot.components).map(([k,v])=>[k,{id:v.id,digest:v.digest}])),
      assertionResults:execution.attempts[0].assertionResults,redactions:[]}}]},f.clock);
    await f.application.ingestExecutionEvidence('workspace',signExecutionEvidenceBundle('workspace',bundle,'isolated-test-runner-secret'));
  }};
}

test('F003 published seven questions consume later trusted FAIL independently of human expiry and never upgrade static assets; partial targets stay partial',async t=>{
  const f=await authorityFixture(t),s=f.runtime.services,rid=f.published.publication.graphRevisionId,key=f.bindingRequest.objectKey,x=await execution(f);
  const secondScope=await f.application.appendClaimScope('workspace',{id:'second-scope',version:1,scope:{condition:'other explicit unreviewed range'}});
  await f.application.appendClaim('workspace',{id:'other-claim',version:1,featureId:'order-feature',type:'NORMATIVE_REQUIREMENT',statement:'unreviewed distinct target',
    sourceType:'AI_CANDIDATE',evidenceSupport:'SINGLE_SOURCE',scopeId:secondScope.id,scopeVersion:1,provenance:{source:'isolated mechanism only'}});
  const targets=[{...f.bindingRequest.targets[0],verificationTargets:[x.ref]},
    {...f.bindingRequest.targets[0],claimId:'other-claim',scopeId:secondScope.id}];
  await s.authorityBindings.bind(owner,'workspace',rid,{...f.bindingRequest,targets});
  const seven=()=>s.publishedReads.sevenQuestions(reader,'workspace',rid,key);
  assert.equal((await seven()).sections[4].executionStatus,'NOT_RUN');
  await x.ingest('published-pass','PASS');
  assert.equal((await seven()).sections[4].executionStatus,'PASS','trusted execution does not require human approval');
  await f.decide('CONFIRMED','2026-10-23T09:00:00Z');
  const view=await s.publishedReads.graph(reader,'workspace',rid,{onlyHumanConfirmed:true});
  assert.equal(view.nodes[0].currentAuthority.status,'PARTIALLY_CONFIRMED');
  assert.equal(view.nodes[0].currentAuthority.confirmedTargets.length,1);
  assert.equal(view.nodes[0].currentAuthority.targets.length,2);
  await x.ingest('published-fail','FAIL');
  assert.equal((await seven()).sections[4].executionStatus,'FAIL');
  f.setTime('2026-10-23T10:00:00Z');
  assert.equal((await seven()).sections[4].executionStatus,'FAIL');
  assert.deepEqual((await s.publishedReads.graph(reader,'workspace',rid,{onlyHumanConfirmed:true})).nodes,[]);
  const next=await s.publications.publish(owner,'workspace',f.run.id,{operationId:'same-digest-new-revision',expectedGraphDigest:f.graph.digest,expectedHeadVersion:1});
  const newRid=next.publication.graphRevisionId;assert.notEqual(newRid,rid);
  const newer=await s.publishedReads.graph(reader,'workspace',newRid,{includeUncertain:true});
  assert.equal(newer.graphDigest,f.graph.digest);assert.equal(newer.nodes[0].currentAuthority.status,'UNMAPPED');
  assert.equal((await s.publishedReads.sevenQuestions(reader,'workspace',newRid,key)).sections[4].executionStatus,'NOT_RUN');
  assert.deepEqual(await f.investigations.graph(owner,'workspace',f.run.id),f.graph);
  s.authorityBindings.verifyExecution=null;
  assert.equal((await seven()).sections[4].executionStatus,'UNKNOWN','unverifiable latest receipt cannot fall back to old PASS');
});
