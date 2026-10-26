import test from 'node:test';
import assert from 'node:assert/strict';
import {incrementalFixture,actor,workspace,sourceB} from './support/f003-incremental-fixture.js';
import {dependencyIndex,rebindContinuation,recordDependencies,guardHistoricalReview,dependencyDigest} from '../src/business-knowledge/dependency-review.js';

test('actual admitted A/B binds byte-equal new ids and fails closed on mapping/rule/premise/source/boundary mutations',async t=>{
  const f=await incrementalFixture(t),a=await f.run({...f.request,operationId:'boundary-A'}),next=await f.next();
  const queued=await f.service.startIncremental(actor,workspace,{...f.request,...next,operationId:'boundary-B',
    baseInvestigationId:a.run.id,expectedBaseGraphDigest:a.graph.digest});
  const run=await f.service.claim(actor,workspace,queued.id,{workerId:'boundary'});
  const evidence=await f.service.continuationEvidence(actor,workspace,run.id,{generation:run.generation});
  const factSelectors=evidence.graph.dependencyReview.entries.flatMap(e=>[...(e.factBindings??[]).flatMap(f=>f.selector?[f.selector]:[]),
    ...(e.proof?.nameFactSelector?[e.proof.nameFactSelector]:[])]);
  const data=await f.service.dependencyEvidence(actor,workspace,run.id,{generation:run.generation,factSelectors}),materials=[];
  for(const m of data.inventory.filter(m=>m.kind==='FILE')) {
    const raw=await f.service.readMaterial(actor,workspace,run.id,{componentId:m.componentId,pathBytes:m.pathBytes},{generation:run.generation});
    materials.push({id:raw.sourceMaterial.id,sourceMaterial:raw.sourceMaterial,text:raw.bytes.toString(),receiptId:raw.receiptId});
  }
  const check=(modified=data,graph=evidence.graph,basis=evidence.basis,raw=materials)=>
    rebindContinuation({basis,graph,index:dependencyIndex({...modified,workspaceId:workspace,bundleId:run.sourceInput.sourceBundleSnapshotId}),materials:raw,run});
  const positive=check();assert.equal(positive.candidates.length,1);
  assert.equal(positive.candidates[0].provenance.producer.investigationId,a.run.id);
  const health=materials.find(m=>Buffer.from(m.sourceMaterial.pathBytes,'base64url').toString()==='health.js');
  const healthTech=data.rows.find(r=>r.kind==='MATERIAL'&&r.payload.pathBytes===health.sourceMaterial.pathBytes);
  const subject=data.rows.find(r=>r.kind==='OBJECT'&&r.payload.materialId===healthTech.id&&r.payload.kind==='FUNCTION');
  const sourceFact=data.rows.find(r=>r.kind==='FACT'&&r.payload.subjectId===subject.id&&r.payload.predicate==='name');
  const mutations={
    wrongProfile:x=>x.profiles[0].payloadDigest='0'.repeat(64),
    changedRule:x=>x.rows.find(r=>r.id===sourceFact.id).payload.ruleRef.version='wrong-rule',
    missingPremise:x=>x.rows=x.rows.filter(r=>r.id!==subject.id),
    wrongAnchor:x=>x.rows.find(r=>r.id===subject.id).payload.anchor.byteEnd--,
    ambiguousFact:x=>x.rows.push({...structuredClone(sourceFact),id:'f'.repeat(64)}),
    sourceRegistration:x=>{for(const m of x.inventory)m.sourceId='another-registration';},
    scope:x=>{for(const m of x.inventory)m.sourceContract={kind:'GIT',declaredScope:{kind:'GIT_TREE',root:'other'}};},
    renameAmbiguity:x=>{const m=x.inventory.find(m=>m.materialId===health.id);x.inventory.push({...m,materialId:'alternate'});},
    truncatedIndex:x=>x.status='INCOMPLETE'
  };
  for(const [name,mutate] of Object.entries(mutations)) {
    const x=structuredClone(data);mutate(x);assert.equal(check(x).candidates.length,0,name);
  }
  const wrongRaw=structuredClone(materials);wrongRaw.find(m=>m.id===health.id).text="export function health() { return 'bad'; }\n";
  assert.equal(check(data,evidence.graph,evidence.basis,wrongRaw).candidates.length,0);
  for(const version of [11,12]) {
    const legacy=structuredClone(evidence.basis);legacy.a.analysisContractVersion=version;
    assert.equal(check(data,evidence.graph,legacy).mode,'FULL_B_FALLBACK');
  }
  assert.ok(positive.dispositions.find(d=>d.sourceKey===a.graph.candidates.find(c=>c.name==='checkout').key).reasons.includes('AFFECTED_DEPENDENCY'),
    'caller omitted the condition citation: reverse impact comes from actual F002 cross-asset premises');
  assert.ok(positive.dispositions.find(d=>d.sourceKey===a.graph.relations[0].key).reasons.includes('RELATION_OWN_CONDITIONS_REQUIRE_RECHECK'));
  const before=await f.service.get(actor,workspace,run.id);
  await f.service.control(actor,workspace,run.id,{action:'CANCEL',expectedRevision:before.revision});
  await assert.rejects(f.service.checkpoint(actor,workspace,run.id,{generation:run.generation,key:'late-proof',payload:{data:positive}}),{code:'F003_STALE_WORKER'});
  console.log(JSON.stringify({kind:'INCREMENTAL_MAPPING_BOUNDARIES',cases:Object.keys(mutations).length,realModel:false}));
});

test('actual deletion retires the old scoped proposition, addition retains full B inventory and changed call conditions are re-investigated',async t=>{
  const f=await incrementalFixture(t),a=await f.run({...f.request,operationId:'delete-A'});
  const {['health.js']:removed,...files}=sourceB;
  files['new-policy.txt']='A newly supplied policy requires explicit review; it is not historical A evidence.\n';
  const next=await f.next(files),b=await f.service.startIncremental(actor,workspace,{...f.request,...next,operationId:'delete-B',
    baseInvestigationId:a.run.id,expectedBaseGraphDigest:a.graph.digest});
  await f.worker().run(actor,workspace,b.id,{workerId:'delete-add'});
  const graph=await f.service.graph(actor,workspace,b.id),health=a.graph.candidates.find(p=>p.name==='health');
  assert.equal(graph.continuation.dispositions.find(d=>d.sourceKey===health.key).status,'REMOVED_OR_OUT_OF_SCOPE');
  assert.ok(!graph.candidates.some(p=>p.name==='health'));
  assert.ok(graph.coverage.some(m=>m.path==='new-policy.txt'));assert.equal(graph.coverage.length,3);
  assert.equal(graph.candidates.find(p=>p.name==='canCancel').statement,'total <= 50');
  assert.equal(graph.continuation.mode,'FULL_B_FALLBACK');
  assert.ok(f.calls.some(c=>c.runId===b.id&&c.input.historicalRecheck?.items.some(p=>p.name==='health')),
    'removed or unmapped historical scope remains an explicit current recheck/retirement obligation');
  assert.equal((await f.service.graph(actor,workspace,a.run.id)).digest,a.graph.digest);
});

test('complete/reuse flags and negative or global scopes do not create semantic dependency sufficiency',async t=>{
  const f=await incrementalFixture(t),a=await f.run({...f.request,operationId:'forgery-A'});
  const history=await f.service.checkpoints(actor,workspace,a.run.id),data=history.find(p=>p.key==='dependency-result-index').payload.data;
  const raw=history.filter(p=>p.key.startsWith('material-')).map(p=>p.payload.data).filter(m=>!m.unavailable);
  const index=dependencyIndex({...data,workspaceId:workspace,bundleId:a.run.sourceInput.sourceBundleSnapshotId});
  const copy=structuredClone(a.graph),p=copy.candidates.find(p=>p.name==='health');
  delete p.dependencyScope;p.complete=true;p.reuse={trusted:true};p.verification.complete=true;
  assert.equal(recordDependencies(copy,raw,index).entries.find(e=>e.key===p.key).eligibility,'RECHECK');
  p.verification.dependencyAssessment={extent:'UNIVERSAL',rationale:'model says complete',unresolvedDependencies:[],applicabilityEvidence:p.evidence,counterexampleEvidence:p.evidence};
  assert.equal(recordDependencies(copy,raw,index).entries.find(e=>e.key===p.key).eligibility,'RECHECK');
  const proposal={...p,reuse:{qualification:'HISTORICAL_HYPOTHESIS_REBOUND'}};
  assert.equal(guardHistoricalReview(proposal,{...p.verification,support:'SUPPORTED'},{materials:raw,fullScopeRechecked:true}).support,'UNKNOWN');
  p.verification.dependencyAssessment.extent='POSITIVE_LOCAL';
  assert.equal(guardHistoricalReview(proposal,p.verification,{materials:raw,fullScopeRechecked:false}).support,'UNKNOWN');
  const reviewed=guardHistoricalReview(proposal,p.verification,{materials:raw,fullScopeRechecked:true});
  assert.equal(reviewed.support,'SUPPORTED'); // Current model review only, not quality/semantic completeness.
  assert.equal(dependencyDigest(reviewed),dependencyDigest(p.verification));
});
