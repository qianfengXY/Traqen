import test from 'node:test';
import assert from 'node:assert/strict';
import {incrementalFixture,actor,workspace} from './support/f003-incremental-fixture.js';
import {recordDependencies,dependencyIndex} from '../src/business-knowledge/dependency-review.js';

test('Main consolidation keeps exact current producer and immutable prior references without recursively inlining multi-generation origin trees',async t=>{
  const f=await incrementalFixture(t),a=await f.run({...f.request,operationId:'lineage-A'});
  const checkpoints=await f.service.checkpoints(actor,workspace,a.run.id),data=checkpoints.find(p=>p.key==='dependency-result-index').payload.data;
  const materials=checkpoints.filter(p=>p.key.startsWith('material-')).map(p=>p.payload.data).filter(m=>!m.unavailable);
  const index=dependencyIndex({...data,workspaceId:workspace,bundleId:a.run.sourceInput.sourceBundleSnapshotId});
  const graph=structuredClone(a.graph),p=graph.candidates.find(p=>p.name==='health'),raw=p.provenance;
  // Deliberately synthetic history-shape stressor, NOT an authorized source or
  // a claim of24 real prior runs. Current A/raw evidence/Main are real services.
  let history=structuredClone(raw);
  for(let n=0;n<24;n++)history={kind:'MAIN_CONSOLIDATION',investigationId:'prior-'+n,reservationId:'main-'+n,
    modelRevisionId:raw.modelRevisionId,taskKey:'consolidation',originalProducers:[{id:'old-'+n,origin:{kind:'REVALIDATED_REUSE',
      producer:history,sourceGraphDigest:a.graph.digest,sourceKey:p.key,reuseProofDigest:'a'.repeat(64)}}]};
  p.provenance={consolidationGroupId:'actual-current-main-group',sourceKeys:['old','fresh']};
  graph.consolidation.originalProposals=[{id:'old',origin:{kind:'REVALIDATED_REUSE',producer:history,
    sourceGraphDigest:a.graph.digest,sourceKey:p.key,reuseProofDigest:'b'.repeat(64)}},{id:'fresh',origin:raw}];
  const entry=recordDependencies(graph,materials,index).entries.find(e=>e.key===p.key);
  assert.equal(entry.eligibility,'PROVABLE_LOCAL');assert.equal(entry.producer.investigationId,a.run.id);
  assert.equal(entry.producer.reservationId,graph.process.find(c=>c.taskKey==='consolidation').reservationId);
  const old=entry.producer.originalProducers.find(o=>o.id==='old');
  assert.ok(Buffer.byteLength(JSON.stringify(entry.producer))<4096,'a previous history tree must be referenced, not recursively copied');
  assert.equal(old.origin.sourceGraphDigest,a.graph.digest);
  assert.equal(old.origin.producer.investigationId,'prior-23');
  assert.equal(old.origin.producer.originalProducers,undefined);
  assert.match(old.originDigest,/^[a-f0-9]{64}$/);
});
