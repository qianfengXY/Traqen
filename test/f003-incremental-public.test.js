import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {incrementalFixture,actor,workspace} from './support/f003-incremental-fixture.js';
import {isolatedPostgres} from './support/source-truth-postgres.js';

// Exact public source envelope supplied by operator838, not a private R2
// expected answer, real trial output, replacement trial or quality certificate.
const scope=JSON.parse(readFileSync(new URL('./fixtures/f003-public-incremental-scope.json',import.meta.url)));
const source=()=>Object.fromEntries(scope.files.map(f=>{
  const body=execFileSync('git',['show',scope.baseline+':'+f.path],{cwd:new URL('../',import.meta.url),maxBuffer:1024*1024});
  assert.equal(createHash('sha256').update(body).digest('hex'),f.sha256);return [f.path,body.toString()];
}));
const path=m=>Buffer.from(m.sourceMaterial.pathBytes,'base64url').toString();
const quote=m=>({materialId:m.id,startLine:m.startLine??1,endLine:m.endLine??m.text.trimEnd().split('\n').length,quote:m.text.trimEnd()});

test('original public24 scope supports B-reviewed positive business history, without certifying semantic completeness or private quality',
  {timeout:600000},async t=>{
    const files=source(),target='src/auth/recovery-fence.js';
    let genericVerification=false;
    const modelResult=i=>{
      if(i.phase==='PLAN')return {assignments:[
        {slotId:'child-1',objective:'What local authentication controls does the explicit restore SQL alter?',
          obligations:['Inspect the exact recovery and conflict branches, without claiming global restore success'],
          materialKeys:i.inventory.filter(m=>m.path===target).map(m=>m.key)},
        {slotId:'child-1',objective:'Which other supplied conditions could contradict the local restore-control hypotheses?',
          obligations:['Check supplied ranges for counterexamples and missing cross-asset premises; report unresolved rather than global completion'],
          materialKeys:i.inventory.filter(m=>m.kind==='FILE'&&m.path!==target).map(m=>m.key)}],
        pendingMaterials:i.inventory.filter(m=>m.kind!=='FILE').map(m=>({materialKey:m.key,reason:'Directory metadata, not a textual business proposition'}))};
      if(i.phase==='INVESTIGATE') {
        const m=i.materials.find(m=>path(m)===target);
        if(!m||i.reuseProposals?.length)return {candidates:[],relations:[],requestedMaterialKeys:[]};
        const tm=i.technicalEvidence.materials.find(t=>t.sourceMaterial.id===m.id);
        const object=tm&&i.technicalEvidence.objects.find(o=>o.materialId===tm.materialId);
        const fact=object&&i.technicalEvidence.records.find(r=>r.record.subjectId===object.objectId);
        assert.ok(fact,'actual supplied closed F002 reference');
        return {candidates:[
          {key:'recovery',kind:'RULE',name:'restore recovery fence',statement:'The restore SQL sets the recovery control to true.',
            scope:'Only this explicit SQL restore transaction; not a claim that all restoration succeeds',uncertainties:[],evidence:[quote(m)],technicalRefs:[fact.id]},
          {key:'epoch',kind:'RULE',name:'restore epoch invalidation',statement:'The conflict branch increments the existing authentication epoch.',
            scope:'Only the ON CONFLICT branch in the supplied restore SQL; not an absence or global claim',uncertainties:[],evidence:[quote(m)],technicalRefs:[fact.id]}],
          relations:[{key:'same-restore-branch',sourceKey:'recovery',targetKey:'epoch',predicate:'CO_OCCURS',
            scope:'Only the explicit restore SQL conflicting-record branch; no global successful recovery claim',
            uncertainties:[],evidence:[quote(m)],technicalRefs:[fact.id]}],requestedMaterialKeys:[]};
      }
      if(i.stage==='CONSOLIDATE_PROPOSALS')return {mergeSuggestions:[],conflictGroups:[]};
      return {reviews:[...i.candidates,...i.relations].map(p=>({key:p.key,support:'SUPPORTED',rationale:'Synthetic current B evidence review, NOT independent semantic qualification',
        premises:['Explicit restore SQL branch; outside functions are not claimed complete'],unresolvedConflicts:[],
        ...(!genericVerification?{dependencyAssessment:{extent:'POSITIVE_LOCAL',applicabilityEvidence:p.evidence,counterexampleEvidence:p.evidence,
          unresolvedDependencies:[],rationale:'Explicit conditional SQL scope; inspect the conflicting-record branch rather than infer complete restore success'}}:{})}))};
    };
    const pg=await isolatedPostgres(t);
    const f=await incrementalFixture(t,{files,modelResult,database:()=>pg.createDatabase()});
    console.log(JSON.stringify({kind:'PUBLIC24_F002_METADATA_COUNTS',
      counts:(await f.db.query('SELECT kind,count(*)::integer n FROM f002_record WHERE graph_version_id=$1 GROUP BY kind ORDER BY kind',[f.versionA])).rows}));
    f.request.question='What explicit local account recovery conditions are declared by the frozen public source?';
    f.request.budget.maxReadBytes=2*1024*1024; // Same explicit cap for A/B/full-B; no production or root-trial configuration change.
    let a;
    try {a=await f.run({...f.request,operationId:'public-A'});}catch(error){console.log(JSON.stringify({failure:'public-A',code:error.code,details:error.details}));throw error;}
    assert.equal(a.graph.candidates.length,2);
    assert.ok(a.graph.dependencyReview.entries.every(e=>e.eligibility==='HISTORICAL_CANDIDATE_ONLY'),
      JSON.stringify({status:a.graph.dependencyReview.status,entries:a.graph.dependencyReview.entries.map(e=>({key:e.key,eligibility:e.eligibility,reasons:e.reasons}))}));
    assert.ok(a.graph.dependencyReview.entries.every(e=>e.proof.dependencyCompleteness==='UNPROVEN'));
    const bFiles={...files,'src/source-truth/policy.js':files['src/source-truth/policy.js'].replace('maxBatchEntries ?? 500','maxBatchEntries ?? 499')};
    assert.notEqual(bFiles['src/source-truth/policy.js'],files['src/source-truth/policy.js']);
    const next=await f.next(bFiles);
    const input={...f.request,...next,operationId:'public-incremental-B',baseInvestigationId:a.run.id,expectedBaseGraphDigest:a.graph.digest};
    const run=await f.service.startIncremental(actor,workspace,input);
    await f.worker().run(actor,workspace,run.id,{workerId:'public-B'});
    const b=await f.service.graph(actor,workspace,run.id);
    assert.equal(b.coverage.filter(m=>m.kind==='FILE').length,24);assert.equal(b.continuation.mode,'INCREMENTAL_A_TO_B');
    assert.ok(b.candidates.every(p=>p.state==='ANALYSIS_ACCEPTED'&&p.reuse.qualification==='HISTORICAL_HYPOTHESIS_REBOUND'
      &&p.reuse.dependencyCompleteness==='UNPROVEN'&&p.provenance.producer.investigationId===a.run.id));
    assert.equal(b.relations.length,1);assert.equal(b.relations[0].state,'ANALYSIS_ACCEPTED');
    assert.equal(b.relations[0].provenance.producer.investigationId,a.run.id);
    assert.equal(b.relations[0].predicate,'CO_OCCURS');
    assert.equal(b.relations[0].sourceKey,b.candidates.find(p=>p.name==='restore recovery fence').key);
    assert.equal(b.relations[0].targetKey,b.candidates.find(p=>p.name==='restore epoch invalidation').key);
    assert.ok(f.calls.filter(c=>c.runId===run.id&&c.input.phase==='INVESTIGATE').every(c=>c.result.candidates.length===0),
      'B counterexample checks may run, but the semantic producer is real A, not regenerated B proposals');
    const full=await f.run({...f.request,...next,operationId:'public-independent-full-B'});
    const semantic=g=>g.candidates.map(p=>[p.name,p.statement,p.scope,p.state]).sort();
    assert.deepEqual(semantic(b),semantic(full.graph));
    assert.deepEqual(b.relations.map(p=>[p.predicate,p.scope,p.state]),full.graph.relations.map(p=>[p.predicate,p.scope,p.state]));
    assert.equal(full.graph.continuation,undefined);
    // A generic SUPPORTED is insufficient to discharge an unproved boundary.
    genericVerification=true;
    const pending=await f.service.startIncremental(actor,workspace,{...input,operationId:'public-B-generic'});
    await f.worker().run(actor,workspace,pending.id,{workerId:'generic'});
    const unknown=await f.service.graph(actor,workspace,pending.id);
    assert.ok(unknown.candidates.every(p=>p.state==='RETAINED_UNKNOWN'));
    assert.equal(unknown.continuation.mode,'FULL_B_FALLBACK');
    assert.equal(unknown.continuation.reusedSemanticResultDigest,null);
    for(const id of [a.run.id,run.id,full.run.id,pending.id])for(const cp of await f.service.checkpoints(actor,workspace,id))if(['dependency-index','dependency-result-index'].includes(cp.key)) {
      const d=cp.payload.data;assert.ok(d.rows.length+(d.impactEdges??[]).length<=50000);
      assert.ok(Buffer.byteLength(JSON.stringify(d.rows))+Buffer.byteLength(JSON.stringify(d.impactEdges??[]))<=16*1024*1024);
      console.log(JSON.stringify({kind:'PUBLIC24_BOUNDED_SELECTED_METADATA',stage:cp.key,rows:d.rows.length,edges:d.impactEdges?.length??0,
        bytes:Buffer.byteLength(JSON.stringify(d)),status:d.status,modelBudgetUnchanged:true}));
    }
    console.log(JSON.stringify({kind:'PUBLIC24_POSITIVE_HISTORY_MECHANISM_ONLY',files:24,inputBytes:scope.files.reduce((n,f)=>n+f.sizeBytes,0),
      semanticProducer:'A',currentRecheck:'B_FULL_SCOPE_CHILD_AND_MAIN',dependencyCompleteness:'UNPROVEN',
      modelCalls:(await f.service.get(actor,workspace,run.id)).usage.modelCalls,realModels:0,semanticScoring:false,privateR2:false,qualityPolicyAdopted:false}));
  });
