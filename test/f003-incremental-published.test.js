import test from 'node:test';
import assert from 'node:assert/strict';
import {authorityFixture} from './support/f003-authority-fixture.js';
import {incrementalFixture,actor,workspace} from './support/f003-incremental-fixture.js';
import {investigationKind} from '../web/app/business-knowledge/investigation-kind.ts';
import {assertIncrementalWebContract} from './support/f003-incremental-web.js';

test('published work continuation shares real dependency path, keeps publication/CAS/operation and new authority boundaries',async t=>{
  const f=await incrementalFixture(t,{fixtureFactory:async(t,sourceOptions)=>{
    const a=await authorityFixture(t,{sourceOptions}),service=a.runtime.services.investigations;
    service.profiles=a.profiles;service.implementationVersion=a.investigations.implementationVersion;
    return {...a,service};
  }}),s=f.runtime.services;
  const a=await f.run({...f.request,operationId:'published-A'});
  const published=await f.publishAnalysis(a.run.id,a.graph,{operationId:'publish-real-new-A-mechanism',expectedHeadVersion:1});
  const revision=published.publication.graphRevisionId;
  const session=(await s.workSessions.create(actor,workspace,revision,{operationId:'work-A',expectedGraphDigest:a.graph.digest,title:'mechanism only'})).session;
  const ah=a.graph.candidates.find(c=>c.name==='health');
  await s.authorityBindings.bind(actor,workspace,revision,{...f.bindingRequest,operationId:'bind-A-health',expectedGraphDigest:a.graph.digest,objectKey:ah.key});
  await f.decide('CONFIRMED');
  const oldHuman=await s.authorityBindings.project(actor,workspace,revision,ah.key);
  const next=await f.next(),preview=await s.workSessions.continuationPreview(actor,workspace,session.id,next);
  const input={...f.request,...next,operationId:'work-B',expectedSessionVersion:1,expectedChangeSetDigest:preview.changeSetDigest};
  const before=(await f.db.query('SELECT count(*) n FROM f003_investigation')).rows;
  await assert.rejects(s.workSessions.continue(actor,workspace,session.id,{...input,expectedSessionVersion:2}),{code:'F003_SESSION_CONFLICT'});
  assert.deepEqual((await f.db.query('SELECT count(*) n FROM f003_investigation')).rows,before);
  const b=await s.workSessions.continue(actor,workspace,session.id,input);
  assert.equal(b.run.purpose,'PUBLISHED_WORK_CONTINUATION');
  assert.equal(investigationKind(b.run).kind,'BUSINESS','the real published continuation response must not be stranded on the unknown-type page');
  assert.equal(b.run.continuationBasis.source.graphRevisionId,revision);
  await f.worker().run(actor,workspace,b.run.id,{workerId:'published-B'});
  const graph=await f.service.graph(actor,workspace,b.run.id);
  assert.equal(graph.continuation.mode,'INCREMENTAL_A_TO_B');
  assert.equal(graph.candidates.find(p=>p.name==='health').reuse.sourceCandidateId,ah.id);
  const beforeReplay=await f.service.get(actor,workspace,b.run.id),calls=f.calls.length;
  const replay=await s.workSessions.continue(actor,workspace,session.id,input);
  assert.equal(replay.replayed,true);assert.equal(replay.run.id,b.run.id);
  assert.deepEqual(await f.service.get(actor,workspace,b.run.id),beforeReplay);assert.equal(f.calls.length,calls);
  const response=await fetch(f.root+'/work-operations/work-B?kind=CONTINUATION',{headers:f.headers});
  assert.equal(response.status,200);const recovery=await response.json();
  assert.equal(recovery.operation.result.investigationId,b.run.id);
  assert.equal(recovery.operation.origin.graphRevisionId,revision);
  assertIncrementalWebContract(recovery.run);
  assert.equal((await s.publications.current(actor,workspace)).graph.digest,a.graph.digest);
  // Existing HTTP never accepts private-analysis identifiers or trusted basis.
  for(const extra of [{baseInvestigationId:a.run.id,expectedBaseGraphDigest:a.graph.digest},{measurement:true},{continuationBasis:b.run.continuationBasis}]) {
    const refused=await fetch(f.root+'/investigations',{method:'POST',headers:f.headers,body:JSON.stringify({...f.request,...next,operationId:'forged-http',...extra})});
    assert.equal(refused.status,422);
  }
  const publishedB=await f.publishAnalysis(b.run.id,graph,{operationId:'publish-B-mechanism-only',expectedHeadVersion:2});
  const adopted=await s.workSessions.adoptGraph(actor,workspace,b.session.id,{operationId:'adopt-B',expectedSessionVersion:1,
    graphRevisionId:publishedB.publication.graphRevisionId,expectedGraphDigest:graph.digest,adoptedVersionIds:graph.adoptedVersionIds});
  assert.equal(adopted.event.binding.graphDigest,graph.digest);
  const bh=graph.candidates.find(c=>c.name==='health'),newHuman=await s.authorityBindings.project(actor,workspace,publishedB.publication.graphRevisionId,bh.key);
  assert.equal(newHuman.bindingSet,null);assert.deepEqual(newHuman.projection.targets,[]);
  assert.deepEqual(await s.authorityBindings.project(actor,workspace,revision,ah.key),oldHuman);
  assert.equal((await f.service.graph(actor,workspace,a.run.id)).digest,a.graph.digest);
  console.log(JSON.stringify({kind:'PUBLISHED_INCREMENTAL_WORK_HTTP_MECHANISM_ONLY',authentication:'isolated Bearer',
    qualityAndRecovery:'explicit synthetic ports',realModel:false,realSemanticQuality:false,oldAuthorityNotInherited:true}));
});
