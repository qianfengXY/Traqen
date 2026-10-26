import assert from 'node:assert/strict';
import test from 'node:test';
import {authorityFixture} from './support/f003-authority-fixture.js';
import {owner} from './support/source-truth-database.js';
import {completeInput} from './fixtures.js';
import {createExecutionEvidenceBundle,signExecutionEvidenceBundle} from '../src/domain/index.js';
import {executionStatus} from '../src/business-knowledge/published-read-service.js';

test('F003 execution aggregation retains every explicit target, independently of human approval',()=>{
  const current=status=>({mappingCurrent:true,status}),stale=status=>({mappingCurrent:false,status});
  for(const [targets,expected] of [
    [[], 'NOT_RUN'], [[current('PASS')], 'PASS'], [[current('PASS'),current('PASS')], 'PASS'],
    [[current('NOT_RUN'),current('NOT_RUN')], 'NOT_RUN'], [[current('PASS'),current('NOT_RUN')], 'UNKNOWN'],
    [[current('PASS'),current('UNKNOWN')], 'UNKNOWN'], [[current('PASS'),stale('PASS')], 'UNKNOWN'],
    [[current('PASS'),stale('FAIL')], 'UNKNOWN'], [[current('NOT_RUN'),stale('NOT_RUN')], 'UNKNOWN'],
    [[stale('PASS')], 'UNKNOWN'], [[stale('PASS'),stale('PASS')], 'UNKNOWN'],
    [[current('FAIL'),current('PASS')], 'FAIL'], [[current('FAIL'),current('UNKNOWN')], 'FAIL'],
    [[current('FAIL'),stale('PASS')], 'FAIL'], [[{status:'PASS'}], 'UNKNOWN'],
    [[{...current('PASS'),authorityApplies:false}], 'PASS'],
  ]) {
    assert.equal(executionStatus(targets),expected,JSON.stringify(targets));
    assert.equal(executionStatus([...targets].reverse()),expected,'target order must not select a winner');
  }
});

// Isolated database, real domain/ingestion/HTTP. Reasoning, publication quality
// and recovery evidence are the fixture's explicitly synthetic mechanism ports.
async function execution(f,claim,label) {
  const snapshot=await f.application.registerSnapshot('workspace',completeInput().snapshotManifest);
  await f.application.appendTestSpecDraft('workspace',{id:`review-spec-${label}`,version:1,name:'isolated exact target',risk:'LOW',approved:false,
    featureId:claim.featureId,verifiesClaims:[{id:claim.id,version:claim.version}],environment:{target:'sit',operationLevel:'SAFE_READ'},
    steps:[{id:'read',executor:'HTTP',method:'GET',path:'/isolated'}],assertions:[{id:'check',type:'HTTP_STATUS',stepId:'read',expected:200}],cleanup:null,policy:{approvalRequired:true}});
  const spec=await f.application.approveTestSpec('workspace',`review-spec-${label}`,{expectedVersion:1,rationale:'mechanism only'});
  const ref={testSpecId:spec.id,testSpecVersion:spec.version,snapshotManifestId:snapshot.id,deploymentId:snapshot.components.deployment.id};
  await receive(f,ref,`review-execution-${label}`,'PASS');
  return ref;
}
async function receive(f,ref,id,status) {
  const snapshot=await f.store.getSnapshotManifest('workspace',ref.snapshotManifestId);
  const time='2026-10-23T06:00:00.000Z';
  const execution={id,...ref,runner:{id:'isolated-runner',version:'1'},completionReason:'COMPLETED',startedAt:time,finishedAt:time,
    attempts:[{number:1,startedAt:time,finishedAt:time,phaseStatus:status,stepResults:[{id:'read',status}],
      assertionResults:[{id:'check',status,actual:status==='PASS'?200:500}],cleanup:{status:'SKIPPED'}}]};
  const bundle=createExecutionEvidenceBundle({execution,evidence:[{id:`proof-${id}`,type:'ASSERTION',freshness:'FRESH',manifest:{executionId:id,...ref,
    runnerId:'isolated-runner',runnerVersion:'1',snapshotComponents:Object.fromEntries(Object.entries(snapshot.components).map(([k,v])=>[k,{id:v.id,digest:v.digest}])),
    assertionResults:execution.attempts[0].assertionResults,redactions:[]}}]},f.clock);
  await f.application.ingestExecutionEvidence('workspace',signExecutionEvidenceBundle('workspace',bundle,'isolated-test-runner-secret'));
}

test('review: mixed current and superseded execution mappings cannot reduce the mapped obligation set to a PASS subset',async t=>{
  const f=await authorityFixture(t),rid=f.published.publication.graphRevisionId,key=f.bindingRequest.objectKey;
  const secondScope=await f.application.appendClaimScope('workspace',{id:'review-scope-two',version:1,scope:{condition:'independent second condition'}});
  const input={id:'review-claim-two',version:1,featureId:'order-feature',type:'NORMATIVE_REQUIREMENT',statement:'second independent required target',
    sourceType:'AI_CANDIDATE',evidenceSupport:'SINGLE_SOURCE',scopeId:secondScope.id,scopeVersion:1,provenance:{source:'synthetic reviewer mechanism'}};
  const second=await f.application.appendClaim('workspace',input);
  const firstRef=await execution(f,f.claim,'first'),secondRef=await execution(f,second,'second');
  await f.runtime.services.authorityBindings.bind(owner,'workspace',rid,{...f.bindingRequest,targets:[
    {...f.bindingRequest.targets[0],verificationTargets:[firstRef]},
    {...f.bindingRequest.targets[0],claimId:second.id,scopeId:secondScope.id,verificationTargets:[secondRef]}]});
  const get=async suffix=>{
    const response=await fetch(`${f.root}/versions/${rid}/${suffix}`,{headers:{authorization:'Bearer isolated-reader-token'}});
    assert.equal(response.status,200);return response.json();
  };
  const baseline=(await get('graph')).graph.nodes.find(n=>n.key===key);
  assert.deepEqual(baseline.currentExecution.targets.map(x=>[x.mappingCurrent,x.status]),[[true,'PASS'],[true,'PASS']]);
  assert.equal(baseline.stateDimensions.verification.status,'PASS');
  assert.equal((await get(`seven-questions?key=${key}`)).answer.sections[4].executionStatus,'PASS');
  await f.application.appendClaim('workspace',{...input,version:2,statement:'updated second target explicitly has no new binding or run'});
  const node=(await get('graph')).graph.nodes.find(n=>n.key===key),seven=(await get(`seven-questions?key=${key}`)).answer;
  assert.deepEqual(node.currentExecution.targets.map(x=>[x.mappingCurrent,x.status]),[[true,'PASS'],[false,'PASS']]);
  assert.equal(node.stateDimensions.freshness.status,'STALE');
  assert.equal(node.currentAuthority.targets.length,2);
  assert.deepEqual(await f.investigations.graph(owner,'workspace',f.run.id),f.graph);
  console.log(JSON.stringify({kind:'REVIEW_MIXED_TARGET_MECHANISM_ONLY',baseline:'PASS',targetCount:2,currentMappingCount:1,
    graphStatus:node.stateDimensions.verification.status,sevenStatus:seven.sections[4].executionStatus,canonicalDigestUnchanged:true}));
  assert.deepEqual([node.stateDimensions.verification.status,seven.sections[4].executionStatus],['UNKNOWN','UNKNOWN']);
  const traced=(await get(`trace?key=${key}`)).trace.nodes.find(n=>n.key===key);
  assert.equal(traced.stateDimensions.verification.status,'UNKNOWN');
  await receive(f,firstRef,'later-current-failure','FAIL');
  const statuses=async expected=>{
    const graph=(await get('graph')).graph.nodes.find(n=>n.key===key);
    const trace=(await get(`trace?key=${key}`)).trace.nodes.find(n=>n.key===key);
    const seven=(await get(`seven-questions?key=${key}`)).answer;
    assert.deepEqual([graph.stateDimensions.verification.status,trace.stateDimensions.verification.status,seven.sections[4].executionStatus],
      [expected,expected,expected]);
    assert.deepEqual(graph.currentExecution.targets.map(e=>e.mappingCurrent),[true,false]);
    return graph;
  };
  const failed=await statuses('FAIL');
  assert.deepEqual(failed.currentExecution.targets[0].history.map(e=>e.status),['FAIL','PASS']);
  f.runtime.services.authorityBindings.verifyExecution=null;
  const unknown=await statuses('UNKNOWN');
  assert.deepEqual(unknown.currentExecution.targets[0].history.map(e=>e.status),['UNKNOWN','UNKNOWN']);
  assert.deepEqual(await f.investigations.graph(owner,'workspace',f.run.id),f.graph);
});

test('F003 graph, directed relation trace and seven questions keep feature/scope obligations after human decision expiry',async t=>{
  const f=await authorityFixture(t,{includeRelation:true}),rid=f.published.publication.graphRevisionId;
  const candidateKey=f.bindingRequest.objectKey,relationKey=f.graph.relations[0].key;
  await f.application.appendFeatureVersion('workspace',{id:'second-feature',version:1,name:'Independent scope target'});
  const scope=await f.application.appendClaimScope('workspace',{id:'expiring-scope',version:1,
    scope:{condition:'independent second obligation'},effectiveTo:'2026-10-23T09:00:00.000Z'});
  const second=await f.application.appendClaim('workspace',{id:'expiring-claim',version:1,featureId:'second-feature',
    type:'NORMATIVE_REQUIREMENT',statement:'separate explicit verification target',sourceType:'AI_CANDIDATE',
    evidenceSupport:'SINGLE_SOURCE',scopeId:scope.id,scopeVersion:1,provenance:{source:'mechanism only'}});
  const firstRef=await execution(f,f.claim,'feature-first'),secondRef=await execution(f,second,'scope-second');
  const targets=[{...f.bindingRequest.targets[0],verificationTargets:[firstRef]},
    {featureId:second.featureId,featureVersion:1,claimId:second.id,claimVersion:1,scopeId:scope.id,scopeVersion:1,verificationTargets:[secondRef]}];
  for(const [index,key] of [candidateKey,relationKey].entries()) {
    await f.runtime.services.authorityBindings.bind(owner,'workspace',rid,
      {...f.bindingRequest,objectKey:key,operationId:`bind-expiry-${index}`,targets});
    if(index===0) {
      // The relation is a separately selected object: its source endpoint's
      // trusted PASS must not become the relation's own execution evidence.
      const response=await fetch(`${f.root}/versions/${rid}/seven-questions?key=${relationKey}`,
        {headers:{authorization:'Bearer isolated-reader-token'}});
      assert.equal(response.status,200);
      const seven=(await response.json()).answer;
      assert.equal(seven.sections[4].executionStatus,'NOT_RUN');
      const endpoint=seven.currentProjection.nodes.find(n=>n.key===candidateKey);
      assert.equal(endpoint.stateDimensions.verification.status,'PASS');
      assert.equal(seven.currentProjection.edges[0].stateDimensions.verification.status,'NOT_RUN');
    }
  }
  await f.decide('CONFIRMED','2026-10-23T08:15:00Z');
  const get=async suffix=>{
    const response=await fetch(`${f.root}/versions/${rid}/${suffix}`,{headers:{authorization:'Bearer isolated-reader-token'}});
    assert.equal(response.status,200);return response.json();
  };
  const readAll=async expected=>{
    const graph=(await get('graph?view=IMPLEMENTATION')).graph;
    for(const key of [candidateKey,relationKey]) {
      const record=[...graph.nodes,...graph.edges].find(n=>n.key===key);
      const trace=(await get(`trace?key=${key}`)).trace,seven=(await get(`seven-questions?key=${key}`)).answer;
      assert.equal(record.stateDimensions.verification.status,expected);
      assert.equal([...trace.nodes,...trace.edges].find(n=>n.key===key).stateDimensions.verification.status,expected);
      assert.equal(seven.sections[4].executionStatus,expected);
      assert.equal(record.currentExecution.targets.length,2);
      assert.deepEqual(record.currentExecution.targets.map(e=>e.status),['PASS','PASS'],'historical receipts remain readable');
    }
    const edge=graph.edges.find(e=>e.key===relationKey);
    assert.equal(edge.sourceKey,f.graph.relations[0].sourceKey);assert.equal(edge.targetKey,f.graph.relations[0].targetKey);
    assert.deepEqual(await f.investigations.graph(owner,'workspace',f.run.id),f.graph);
    return graph.nodes.find(n=>n.key===candidateKey);
  };
  await readAll('PASS');
  f.setTime('2026-10-23T08:30:00Z');
  const expiredDecision=await readAll('PASS');
  assert.equal(expiredDecision.currentAuthority.targets[0].authority.status,'DEPRECATED');
  assert.deepEqual(expiredDecision.currentExecution.targets.map(e=>e.mappingCurrent),[true,true]);
  await f.application.appendFeatureVersion('workspace',{id:'order-feature',version:2,name:'New explicit feature version'});
  const mixed=await readAll('UNKNOWN');
  assert.deepEqual(mixed.currentExecution.targets.map(e=>e.mappingCurrent),[false,true]);
  f.setTime('2026-10-23T09:01:00Z');
  const allStale=await readAll('UNKNOWN');
  assert.deepEqual(allStale.currentExecution.targets.map(e=>e.mappingCurrent),[false,false]);
  assert.equal(allStale.currentAuthority.targets[1].authority.scopeActive,false);
});
