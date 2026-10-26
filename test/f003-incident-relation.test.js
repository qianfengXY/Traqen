import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {incrementalFixture,actor,workspace} from './support/f003-incremental-fixture.js';
import {isolatedPostgres} from './support/source-truth-postgres.js';
import {InvestigationService} from '../src/business-knowledge/investigation-service.js';
import {F003PublicationService} from '../src/business-knowledge/publication-service.js';
import {SourceTruthRepository} from '../src/source-truth/repository.js';
import {SourceMaterialRepository} from '../src/source-truth/material-repository.js';
import {SourceCandidateService} from '../src/source-truth/candidate-service.js';
import {SourceAdmissionService} from '../src/source-truth/admission-service.js';
import {dependencyDigest} from '../src/business-knowledge/dependency-review.js';

for (const scenario of [
  {changed:['left'],mergeEdge:false},
  {changed:['right'],mergeEdge:true},
  {changed:['left','right'],mergeEdge:true}
]) test(`native Worker revokes incident reuse for ${scenario.changed.join('+')} with relation merge=${scenario.mergeEdge}`,async t=>{
  const pg=await isolatedPostgres(t);let databaseName,stage='A';
  const files={'left.js':'export function left() { return true; }\n','right.js':'export function right() { return 1; }\n',
    'unrelated.js':'export function unrelated() { return 7; }\n'};
  const modelResult=i=>{
    if(i.phase==='PLAN')return {assignments:[{slotId:'child-1',objective:'Inspect both local declarations and their directed conditional relation',
      obligations:['Check current B declarations, changed conditions and counterexamples'],materialKeys:i.inventory.map(m=>m.key)}],pendingMaterials:[]};
    if(i.phase==='INVESTIGATE') {
      const emit=name=>{
        const m=i.materials.find(m=>Buffer.from(m.sourceMaterial.pathBytes,'base64url').toString()===name+'.js');assert.ok(m);
        const tm=i.technicalEvidence.materials.find(x=>x.sourceMaterial.id===m.id);assert.ok(tm);
        const object=i.technicalEvidence.objects.find(x=>x.materialId===tm.materialId&&x.name===name)
          ??i.technicalEvidence.objects.find(x=>x.materialId===tm.materialId);assert.ok(object);
        const fact=i.technicalEvidence.records.find(x=>x.record.subjectId===object.objectId);assert.ok(fact);
        return {key:'current-'+name,kind:'RULE',name,statement:stage==='B'&&scenario.changed.includes(name)?name+' has a NEW meaning':name+' local declaration',
          scope:'local declared branch',uncertainties:[],evidence:[{materialId:m.id,startLine:1,endLine:1,quote:m.text.trim()}],technicalRefs:[fact.id]};
      };
      const left=emit('left'),right=emit('right');
      if(stage==='A')return {candidates:[left,right],relations:[{key:'directed',sourceKey:left.key,targetKey:right.key,predicate:'REQUIRES',
        scope:'local declared branch',uncertainties:[],evidence:[...left.evidence,...right.evidence],technicalRefs:[...left.technicalRefs,...right.technicalRefs]}],requestedMaterialKeys:[]};
      assert.equal(i.reuseProposals.length,2,'both A propositions reached the actual B Child');
      return {candidates:[left,right].filter(p=>scenario.mergeEdge||scenario.changed.includes(p.name)),
        relations:scenario.mergeEdge?[{key:'current-directed',sourceKey:left.key,targetKey:right.key,predicate:'REQUIRES',
          scope:'local declared branch',uncertainties:[],evidence:[...left.evidence,...right.evidence],technicalRefs:[...left.technicalRefs,...right.technicalRefs]}]:[],requestedMaterialKeys:[]};
    }
    if(i.stage==='CONSOLIDATE_PROPOSALS') {
      if(stage==='A')return {mergeSuggestions:[],conflictGroups:[]};
      const mergeSuggestions=(scenario.mergeEdge?['left','right']:scenario.changed).map(name=>{
        const old=i.candidates.find(p=>p.name===name&&p.reuse),fresh=i.candidates.find(p=>p.name===name&&!p.reuse);assert.ok(old&&fresh);
        return {keys:[old.key,fresh.key],rationale:'Current Main changes the final endpoint meaning',mergedProposal:{kind:fresh.kind,name,
          statement:fresh.statement,scope:fresh.scope}};
      });
      if(scenario.mergeEdge){const old=i.relations.find(p=>p.reuse),fresh=i.relations.find(p=>!p.reuse);assert.ok(old&&fresh);
        mergeSuggestions.push({keys:[old.key,fresh.key],rationale:'Current same-direction relation after endpoint canonicalization',mergedProposal:{...fresh}});}
      return {mergeSuggestions,conflictGroups:[]};
    }
    return {reviews:[...i.candidates,...i.relations].map(p=>({key:p.key,support:'SUPPORTED',rationale:'Explicit mechanism double, not semantic qualification',
      premises:['Only supplied local declarations'],unresolvedConflicts:[],dependencyAssessment:{extent:'POSITIVE_LOCAL',applicabilityEvidence:p.evidence,
        counterexampleEvidence:p.evidence,unresolvedDependencies:[],rationale:'Current B local evidence and counterexamples inspected by double'}}))};
  };
  const f=await incrementalFixture(t,{files,modelResult,database:async()=>{const d=await pg.createDatabase();databaseName=d.name;return d;}});
  f.request.question='What do the two positive local declarations and their directed relation mean?';
  const a=await f.run({...f.request,operationId:'incident-A'});
  assert.ok(a.graph.dependencyReview.entries.every(e=>e.eligibility==='HISTORICAL_CANDIDATE_ONLY'));
  const next=await f.next({...files,'unrelated.js':files['unrelated.js'].replace('7','8')});stage='B';
  const input={...f.request,...next,operationId:'incident-B',baseInvestigationId:a.run.id,expectedBaseGraphDigest:a.graph.digest};
  const b=await f.service.startIncremental(actor,workspace,input);
  await f.worker().run(actor,workspace,b.id,{workerId:'incident-repair'});
  const graph=await f.service.graph(actor,workspace,b.id),done=await f.service.get(actor,workspace,b.id),edge=graph.relations[0];
  const calls=f.calls.filter(c=>c.runId===b.id),main=calls.find(c=>c.input.stage==='CONSOLIDATE_PROPOSALS');
  const verify=calls.find(c=>c.input.stage==='EVIDENCE_VERIFICATION'),verifiedEdge=verify.input.relations[0];
  assert.equal(verifiedEdge.reuse,null,'VERIFY sees the revoked proof rather than laundering it after validation');
  assert.notEqual(verifiedEdge.provenance.kind,'REVALIDATED_REUSE');
  assert.equal(edge.reuse,null);
  assert.equal(edge.state,'ANALYSIS_ACCEPTED','current B truth can be independently rechecked');
  assert.equal(edge.sourceKey,graph.candidates.find(p=>p.name==='left').key);
  assert.equal(edge.targetKey,graph.candidates.find(p=>p.name==='right').key);
  assert.equal(edge.predicate,'REQUIRES');
  assert.notEqual(edge.provenance.kind,'REVALIDATED_REUSE');
  const dependency=graph.dependencyReview.entries.find(e=>e.key===edge.key);
  assert.equal(dependency.producer.investigationId,b.id);
  assert.equal(dependency.producer.reservationId,main.reservationId);
  assert.equal(dependency.producer.kind,'MAIN_CONSOLIDATION');
  const original=graph.consolidation.originalProposals.find(p=>p.id===graph.continuation.dispositions.find(d=>d.sourceKey===a.graph.relations[0].key).targetKey)
    ??graph.consolidation.originalProposals.find(p=>p.proposal.reuse?.sourceKey===a.graph.relations[0].key);
  assert.ok(original,'the original reused A relation remains inspectable');
  assert.equal(original.origin.producer.investigationId,a.run.id);
  for(const name of ['left','right']){
    const p=graph.candidates.find(p=>p.name===name);
    assert.equal(p.state,'ANALYSIS_ACCEPTED');
    if(scenario.changed.includes(name)){assert.equal(p.reuse,null);assert.match(p.statement,/NEW/);}
    else {assert.ok(p.reuse);assert.equal(p.reuse.sourceInvestigationId,a.run.id);}
  }
  const disposition=graph.continuation.dispositions.find(d=>d.sourceKey===a.graph.relations[0].key);
  assert.equal(disposition.status,'PENDING_B_RECHECK');assert.equal(disposition.targetKey,edge.key);
  const accepted=graph.continuation.proofs.filter(proof=>[...graph.candidates,...graph.relations]
    .some(p=>p.state==='ANALYSIS_ACCEPTED'&&p.reuse?.reuseProofDigest===proof.reuseProofDigest));
  assert.equal(accepted.length,2-scenario.changed.length);
  assert.equal(graph.continuation.mode,accepted.length?'INCREMENTAL_A_TO_B':'FULL_B_FALLBACK');
  assert.equal(graph.continuation.reusedSemanticResultDigest,accepted.length?dependencyDigest(accepted):null);
  assert.equal(done.usage.modelCalls,4);assert.equal(done.usage.readBytes,Object.values(files).reduce((n,s)=>n+Buffer.byteLength(s),0));
  assert.ok(calls.every(c=>Buffer.byteLength(JSON.stringify(c.input))<=128*1024));
  assert.equal((await new F003PublicationService({sources:f.repository}).readiness(actor,workspace,b.id)).status,'BLOCKED');
  for(const table of ['f003_publication','current_graph_head'])assert.equal(Number((await f.db.query(`SELECT count(*) n FROM ${table}`)).rows[0].n),0);
  assert.equal(Number((await f.db.query("SELECT count(*) n FROM understanding_record WHERE record_type='WORK_SESSION'")).rows[0].n),0);
  const events=await f.service.events(actor,workspace,b.id);await pg.restart();
  const sources=new SourceTruthRepository(pg.pool(databaseName)),materials=new SourceMaterialRepository(sources),candidates=new SourceCandidateService(sources,materials,f.blobs);
  const unavailable=async()=>{throw Error('No offline model/profile call allowed');};
  const offline=new InvestigationService({sources,sourceAdmission:new SourceAdmissionService(sources,candidates),profiles:{resolveActive:unavailable,assertUsable:unavailable}});
  assert.deepEqual(await offline.graph(actor,workspace,b.id),graph);
  assert.deepEqual(await offline.get(actor,workspace,b.id),done);
  assert.deepEqual(await offline.events(actor,workspace,b.id),events);
  assert.equal((await offline.startIncremental(actor,workspace,input)).id,b.id);
  assert.deepEqual(await offline.graph(actor,workspace,a.run.id),a.graph);
  await pg.stop();
  assert.equal(existsSync(pg.data+'/postmaster.pid'),false);assert.equal(existsSync(pg.socket+'/.s.PGSQL.5432'),false);
  console.log(JSON.stringify({kind:'NATIVE_INCIDENT_REPAIR_MECHANISM_ONLY',scenario,currentProducer:dependency.producer.reservationId,
    acceptedReuse:accepted.length,mode:graph.continuation.mode,usage:done.usage,offlineRestartPreserved:true,realModel:false,
    ownedCluster:{root:pg.root,stopped:true},publicationWrites:0}));
});
