import test from 'node:test';
import assert from 'node:assert/strict';
import {incrementalFixture,actor,workspace} from './support/f003-incremental-fixture.js';
import {F003PublicationService} from '../src/business-knowledge/publication-service.js';
import {investigationKind} from '../web/app/business-knowledge/investigation-kind.ts';
import {assertIncrementalWebContract} from './support/f003-incremental-web.js';

test('new A records a checkable dependency boundary, not model completeness or unchanged filename',async t=>{
  const f=await incrementalFixture(t),a=await f.run({...f.request,operationId:'full-A'});
  assert.equal(a.run.state,'COMPLETED');
  assert.equal(a.graph.candidates.length,3);
  const health=a.graph.candidates.find(c=>c.name==='health');
  assert.equal(health.state,'ANALYSIS_ACCEPTED');
  assert.equal(a.graph.dependencyReview?.entries.find(e=>e.key===health.key)?.eligibility,'PROVABLE_LOCAL',
    'a real new-contract A must store validated raw/technical/producer boundaries before B can reuse it');
});

test('private unpublished A bootstraps real semantic reuse on B without quality/publication/session writes',async t=>{
  const f=await incrementalFixture(t),a=await f.run({...f.request,operationId:'full-A'}),next=await f.next();
  const pubs=new F003PublicationService({sources:f.repository});
  assert.equal(pubs.qualityPolicy,null);
  const input={...f.request,...next,operationId:'incremental-B',baseInvestigationId:a.run.id,expectedBaseGraphDigest:a.graph.digest};
  const admitted=await f.service.startIncremental(actor,workspace,input);
  assert.equal(investigationKind(admitted).kind,'BUSINESS','the actual unpublished analysis response must remain consumable by the business UI');
  await f.worker().run(actor,workspace,admitted.id,{workerId:'incremental'});
  const b=await f.service.graph(actor,workspace,admitted.id);
  assertIncrementalWebContract(await f.service.get(actor,workspace,admitted.id));
  const ah=a.graph.candidates.find(c=>c.name==='health'),bh=b.candidates.find(c=>c.name==='health');
  assert.ok(bh,JSON.stringify({names:b.candidates.map(c=>c.name),dispositions:b.continuation?.dispositions}));
  assert.equal(b.continuation?.mode,'INCREMENTAL_A_TO_B');
  assert.equal(bh.state,'ANALYSIS_ACCEPTED');
  assert.equal(bh.reuse.sourceGraphDigest,a.graph.digest);
  assert.equal(bh.reuse.sourceCandidateId,ah.id);
  assert.equal(bh.provenance.kind,'REVALIDATED_REUSE');
  assert.equal(bh.provenance.producer.reservationId,ah.provenance.reservationId);
  assert.notEqual(bh.id,ah.id);
  assert.notEqual(bh.evidence[0].materialId,ah.evidence[0].materialId);
  assert.ok(bh.technicalRefs.every(id=>!ah.technicalRefs.includes(id)));
  assert.equal(b.coverage.length,3);
  const disposition=name=>b.continuation.dispositions.find(d=>d.sourceKey===a.graph.candidates.find(c=>c.name===name).key);
  assert.equal(disposition('health').status,'REVALIDATED_REUSE');
  assert.equal(disposition('checkout').status,'RECHECK');
  assert.ok(disposition('checkout').reasons.includes('AFFECTED_DEPENDENCY'));
  assert.ok(b.candidates.some(c=>c.name==='canCancel'&&c.statement==='total <= 50'));
  const actual=f.calls.filter(c=>c.runId===admitted.id);
  assert.ok(actual.some(c=>c.input.phase==='INVESTIGATE'&&c.input.historicalRecheck?.items.some(p=>p.name==='checkout')),
    'affected old semantic scope reaches the actual Child, not only an opaque id in the final audit');
  assert.ok(actual.some(c=>c.input.phase==='INVESTIGATE'&&c.input.reuseProposals?.some(p=>p.name==='health')));
  assert.ok(actual.some(c=>c.input.stage==='EVIDENCE_VERIFICATION'&&c.input.candidates.some(p=>p.reuse?.sourceCandidateId===ah.id)));
  assert.ok(actual.filter(c=>c.input.phase==='INVESTIGATE').every(c=>c.result.candidates.every(p=>p.name!=='health')),
    'purposeful revalidation may run, but cannot masquerade as regeneration of A semantics');
  const full=await f.run({...f.request,...next,operationId:'full-B'});
  const semantic=g=>g.candidates.map(c=>[c.name,c.statement,c.state]).sort();
  assert.deepEqual(semantic(b),semantic(full.graph));
  assert.deepEqual(b.relations.map(r=>[r.predicate,r.scope,r.state]),full.graph.relations.map(r=>[r.predicate,r.scope,r.state]));
  assert.deepEqual(await f.service.startIncremental(actor,workspace,input),await f.service.get(actor,workspace,admitted.id));
  assert.equal((await f.service.graph(actor,workspace,a.run.id)).digest,a.graph.digest);
  const counts=(await f.db.query(`SELECT
    (SELECT count(*)::int FROM current_graph_head) heads,
    (SELECT count(*)::int FROM understanding_record WHERE record_type='WORK_SESSION') sessions`)).rows[0];
  assert.deepEqual(counts,{heads:0,sessions:0});
  assert.equal((await pubs.readiness(actor,workspace,admitted.id)).status,'BLOCKED');
  await assert.rejects(f.service.start(actor,workspace,{...f.request,operationId:'forged',continuationBasis:admitted.continuationBasis}),{code:'F003_INPUT_INVALID'});
  await assert.rejects(f.service.startIncremental({...actor,actorId:'reader'},workspace,{...input,operationId:'foreign'}));
  await assert.rejects(f.service.startIncremental(actor,workspace,{...input,operationId:'wrong-graph',expectedBaseGraphDigest:'0'.repeat(64)}),{code:'F003_CONTINUATION_SOURCE_MISMATCH'});
  console.log(JSON.stringify({kind:'UNPUBLISHED_INCREMENTAL_MECHANISM_ONLY',reused:bh.reuse.reuseProofDigest,
    sourceProducer:bh.provenance.producer.reservationId,coverage:b.coverage.length,publicationWrites:0,realModel:false,realQuality:false}));
});
