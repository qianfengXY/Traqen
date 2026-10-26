import test from 'node:test';
import assert from 'node:assert/strict';
import {largeStorageFixture} from './support/f003-large-storage-fixture.js';
import {owner} from './support/source-truth-database.js';
import {investigationFixture} from './support/f003-investigation-fixture.js';
import {checkpointDocument,checkpointRowBytes,checkpointChunkPrefix,checkpointDocumentBytes} from '../src/business-knowledge/checkpoint-storage.js';
import {InvestigationService} from '../src/business-knowledge/investigation-service.js';
import {InvestigationWorker} from '../src/business-knowledge/worker.js';

test('F003 actual Worker preserves aggregate proposals and final directed graph beyond one row without increasing any row/model limit',async t=>{
  const f=await largeStorageFixture(t);
  const result=await f.worker.run(owner,'workspace',f.run.id,{workerId:'storage-worker'});
  assert.equal(result.state,'COMPLETED');
  const graph=await f.service.graph(owner,'workspace',f.run.id),history=await f.service.checkpoints(owner,'workspace',f.run.id);
  const consolidated=history.find(p=>p.key==='consolidated-proposals');
  assert.ok(Buffer.byteLength(JSON.stringify(consolidated.payload))>2*1024*1024);
  assert.ok(Buffer.byteLength(JSON.stringify(graph))>2*1024*1024);
  assert.equal(graph.candidates.length,160);assert.equal(graph.relations.length,140);
  assert.equal(graph.consolidation.originalProposals.length,300);assert.equal(graph.consolidation.sourceToCanonical.length,300);
  assert.ok(graph.quarantine.length>=4);assert.ok(graph.consolidation.groups.some(g=>g.disposition==='CONFLICT'));
  assert.ok(graph.process.at(-1).taskReports.every(r=>r.obligations.some(o=>o.status==='UNRESOLVED')));
  assert.equal(f.calls.length,7);assert.ok(f.calls.every(c=>c.outputBytes<=1024*1024&&c.inputBytes<=128*1024));
  const rows=(await f.db.query('SELECT checkpoint_key,payload FROM f003_checkpoint WHERE investigation_id=$1',[f.run.id])).rows;
  assert.ok(rows.every(r=>Buffer.byteLength(JSON.stringify(r.payload))<=2*1024*1024));
  assert.equal(history.filter(p=>p.key==='consolidated-proposals').length,1);
  console.log(JSON.stringify({kind:'SYNTHETIC_AGGREGATE_STORAGE_MECHANISM_ONLY',outputs:f.calls.map(c=>c.outputBytes),
    consolidatedBytes:Buffer.byteLength(JSON.stringify(consolidated.payload)),graphBytes:Buffer.byteLength(JSON.stringify(graph)),
    physicalRows:rows.length,largestRow:Math.max(...rows.map(r=>Buffer.byteLength(JSON.stringify(r.payload)))),realModel:false}));
});

const aggregate=()=>({parts:Array.from({length:4},(_,i)=>({index:i,text:'condition-😺\\\n'.repeat(60000)}))});
async function claimed(f,operationId='storage') {
  const run=await f.service.start(owner,'workspace',{...f.request,operationId});
  const current=await f.service.claim(owner,'workspace',run.id,{workerId:operationId});
  const row=(await f.db.query('SELECT * FROM f003_investigation WHERE id=$1',[run.id])).rows[0];
  return {run:current,row};
}
const count=(f,id)=>f.db.query(`SELECT (SELECT count(*)::int FROM f003_checkpoint WHERE investigation_id=$1) checkpoints,
  (SELECT count(*)::int FROM f003_investigation_event WHERE investigation_id=$1) events`,[id]).then(r=>r.rows[0]);

test('F003 row threshold, multibyte reconstruction, idempotent same-value retry and changed-value refusal keep the original row bound',async t=>{
  const f=await investigationFixture(t),{run,row}=await claimed(f);
  const overhead=Buffer.byteLength(JSON.stringify({text:''})),exact={text:'x'.repeat(checkpointRowBytes-overhead)};
  assert.equal(checkpointDocument(row,run.generation,'exact',exact).chunks.length,0);
  assert.equal(checkpointDocument(row,run.generation,'over',{text:exact.text+'x'}).chunks.length,3);
  await f.service.checkpoint(owner,'workspace',run.id,{generation:run.generation,key:'exact',payload:exact});
  const payload=aggregate();await f.service.checkpoint(owner,'workspace',run.id,{generation:run.generation,key:'aggregate',payload});
  const before=await count(f,run.id),history=await f.service.checkpoints(owner,'workspace',run.id);
  assert.deepEqual(history.find(p=>p.key==='aggregate').payload,payload);
  const retry={parts:payload.parts.map(({index,text})=>({text,index}))};
  await f.service.checkpoint(owner,'workspace',run.id,{generation:run.generation,key:'aggregate',payload:retry});
  assert.deepEqual(await count(f,run.id),before);
  await assert.rejects(f.service.checkpoint(owner,'workspace',run.id,{generation:run.generation,key:'aggregate',payload:{...payload,changed:true}}),{code:'F003_OPERATION_CONFLICT'});
  assert.deepEqual(await count(f,run.id),before);
  assert.ok(!history.some(p=>p.key.startsWith(checkpointChunkPrefix)));
  await assert.rejects(f.service.checkpoint(owner,'workspace',run.id,{generation:run.generation,key:checkpointChunkPrefix+'forged',payload:{x:1}}),{code:'F003_INPUT_INVALID'});
});

test('F003 interrupted chunk transaction and lease expiry publish neither partial roots nor blocks, and cancellation fences later writes',async t=>{
  const f=await investigationFixture(t),{run}=await claimed(f),original=f.repository.withWorkspace.bind(f.repository),before=await count(f,run.id),payload=aggregate();
  for(const failure of ['CONNECTION_LOST','LEASE_EXPIRED']) {
    let intercepted=false;
    f.repository.withWorkspace=(a,w,m,work)=>original(a,w,m,(tx,access)=>work(new Proxy(tx,{get(target,prop){
      if(prop==='query')return async(sql,params)=>{
        const result=await target.query(sql,params);
        if(!intercepted&&/INSERT INTO f003_checkpoint/.test(sql)&&params?.[3]?.startsWith(checkpointChunkPrefix)) {
          intercepted=true;if(failure==='CONNECTION_LOST')throw Object.assign(Error('owned synthetic connection loss'),{code:'OWNED_CONNECTION_LOST'});
          await target.query("UPDATE f003_investigation SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[run.id]);
        }
        return result;
      };
      const v=Reflect.get(target,prop);return typeof v==='function'?v.bind(target):v;
    }}),access));
    await assert.rejects(f.service.checkpoint(owner,'workspace',run.id,{generation:run.generation,key:failure,payload}),
      {code:failure==='CONNECTION_LOST'?'OWNED_CONNECTION_LOST':'F003_STALE_WORKER'});
    assert.ok(intercepted);f.repository.withWorkspace=original;assert.deepEqual(await count(f,run.id),before);
  }
  await f.service.checkpoint(owner,'workspace',run.id,{generation:run.generation,key:'complete',payload});
  const history=await f.service.checkpoints(owner,'workspace',run.id);
  const current=await f.service.get(owner,'workspace',run.id);
  await f.service.control(owner,'workspace',run.id,{action:'CANCEL',expectedRevision:current.revision});
  const stopped=await count(f,run.id);
  await assert.rejects(f.service.checkpoint(owner,'workspace',run.id,{generation:run.generation,key:'late',payload}),{code:'F003_STALE_WORKER'});
  assert.deepEqual(await count(f,run.id),stopped);assert.deepEqual(await f.service.checkpoints(owner,'workspace',run.id),history);
});

test('F003 missing, duplicate, reordered, corrupt or wrong-bound storage cannot become a complete logical checkpoint',async t=>{
  const f=await investigationFixture(t),payload=aggregate();let cases=0;
  const changes={
    missing:p=>p.chunks.pop(),
    duplicate:p=>{p.root.chunks[1]={...p.root.chunks[0]};},
    order:p=>p.root.chunks.reverse(),
    corrupt:p=>{p.chunks[0].payload.data='A'+p.chunks[0].payload.data.slice(1);},
    binding:p=>{p.chunks[0].payload.binding={...p.chunks[0].payload.binding,profileDigest:'0'.repeat(64)};},
    missingBinding:p=>{delete p.chunks[0].payload.binding;},
    generation:p=>{p.root.binding={...p.root.binding,generation:p.root.binding.generation+1};},
    source:p=>{p.root.binding={...p.root.binding,sourceInputDigest:'0'.repeat(64)};},
    total:p=>{p.root.byteLength++;},
    canonical:p=>{p.root.canonicalDigest='0'.repeat(64);},
    malformed:p=>{p.root.chunks[0]=null;},
    tooLarge:p=>{p.root.byteLength=checkpointDocumentBytes+1;}
  };
  for(const [name,change] of Object.entries(changes)) {
    const {run,row}=await claimed(f,'corrupt-'+name),plan=structuredClone(checkpointDocument(row,run.generation,'aggregate',payload));
    change(plan);
    for(const r of [...plan.chunks,{key:'aggregate',payload:plan.root}])await f.db.query(`INSERT INTO f003_checkpoint
      (workspace_id,investigation_id,generation,checkpoint_key,payload) VALUES ($1,$2,$3,$4,$5)`,['workspace',run.id,run.generation,r.key,JSON.stringify(r.payload)]);
    const before=await count(f,run.id);
    await assert.rejects(f.service.checkpoints(owner,'workspace',run.id),{code:'F003_CHECKPOINT_CORRUPT'},name);
    await assert.rejects(f.service.graph(owner,'workspace',run.id),{code:'F003_GRAPH_NOT_FOUND'},name);
    assert.deepEqual(await count(f,run.id),before);cases++;
  }
  console.log(JSON.stringify({kind:'OWNED_CORRUPT_STORAGE_MATRIX',cases,realModel:false}));
});

test('F003 uncommitted orphan blocks stay invisible, cannot be healed into a commit, and generations keep distinct bound storage',async t=>{
  const f=await investigationFixture(t),payload=aggregate(),{run,row}=await claimed(f,'orphan');
  const orphan=checkpointDocument(row,run.generation,'orphan-stage',payload).chunks[0];
  await f.db.query(`INSERT INTO f003_checkpoint (workspace_id,investigation_id,generation,checkpoint_key,payload)
    VALUES ($1,$2,$3,$4,$5)`,['workspace',run.id,run.generation,orphan.key,JSON.stringify(orphan.payload)]);
  assert.deepEqual(await f.service.checkpoints(owner,'workspace',run.id),[]);
  const before=await count(f,run.id);
  await assert.rejects(f.service.checkpoint(owner,'workspace',run.id,{generation:run.generation,key:'orphan-stage',payload}),{code:'F003_CHECKPOINT_CORRUPT'});
  assert.deepEqual(await count(f,run.id),before);
  await f.service.checkpoint(owner,'workspace',run.id,{generation:run.generation,key:'retained',payload});
  let current=await f.service.get(owner,'workspace',run.id);
  current=await f.service.control(owner,'workspace',run.id,{action:'PAUSE',expectedRevision:current.revision});
  await f.service.control(owner,'workspace',run.id,{action:'RESUME',expectedRevision:current.revision});
  const next=await f.service.claim(owner,'workspace',run.id,{workerId:'new-generation'});
  await assert.rejects(f.service.checkpoint(owner,'workspace',run.id,{generation:run.generation,key:'late-old',payload}),{code:'F003_STALE_WORKER'});
  await f.service.checkpoint(owner,'workspace',run.id,{generation:next.generation,key:'retained',payload});
  const history=await f.service.checkpoints(owner,'workspace',run.id);
  assert.deepEqual(history.map(p=>p.generation),[run.generation,next.generation]);
  assert.ok(history.every(p=>JSON.stringify(p.payload)===JSON.stringify(payload)));
  const roots=(await f.db.query("SELECT payload FROM f003_checkpoint WHERE investigation_id=$1 AND checkpoint_key='retained' ORDER BY generation",[run.id])).rows;
  assert.notEqual(roots[0].payload.chunks[0].key,roots[1].payload.chunks[0].key);
  assert.equal(roots[0].payload.documentDigest,roots[1].payload.documentDigest);
});

test('F003 finite aggregate storage cap refuses an oversized logical document before writing any physical rows',async t=>{
  const f=await investigationFixture(t),{run}=await claimed(f,'finite-document'),before=await count(f,run.id);
  await assert.rejects(f.service.checkpoint(owner,'workspace',run.id,{generation:run.generation,key:'too-large',payload:{text:'x'.repeat(checkpointDocumentBytes)}}),
    {code:'F003_CHECKPOINT_STORAGE_LIMIT',status:422});
  assert.deepEqual(await count(f,run.id),before);
  assert.deepEqual(await f.service.checkpoints(owner,'workspace',run.id),[]);
});

test('F003 fresh Worker resumes committed chunked consolidation with zero prior-stage replay and no refund after a known VERIFY failure',async t=>{
  const f=await largeStorageFixture(t),attempts=[];let failed=false;
  f.worker.invokeModel=async context=>{
    attempts.push(context.input.stage??context.input.phase);
    if(context.input.stage==='EVIDENCE_VERIFICATION'&&!failed) {
      failed=true;const r=await f.service.reserveModelCall(owner,'workspace',f.run.id,context);
      await f.service.beginModelCall(owner,'workspace',f.run.id,{generation:context.generation,reservationId:r.id});
      await f.service.finishModelCall(owner,'workspace',f.run.id,{generation:context.generation,reservationId:r.id,outcome:'FAILED'});
      throw Object.assign(Error('known mechanism VERIFY failure after committed aggregate'),{code:'OWNED_VERIFY_FAILURE'});
    }
    return f.invokeModel(context);
  };
  await assert.rejects(f.worker.run(owner,'workspace',f.run.id,{workerId:'before-restart'}),{code:'OWNED_VERIFY_FAILURE'});
  const old=await f.service.get(owner,'workspace',f.run.id),history=await f.service.checkpoints(owner,'workspace',f.run.id);
  const aggregate=history.find(c=>c.key==='consolidated-proposals');
  assert.ok(Buffer.byteLength(JSON.stringify(aggregate.payload))>checkpointRowBytes);assert.equal(old.usage.modelCalls,7);
  const invoke=f.worker.invokeModel;
  f.service=new InvestigationService({sources:f.repository,sourceAdmission:f.sourceAdmission,profiles:f.profiles});
  await f.service.control(owner,'workspace',f.run.id,{action:'RESUME',expectedRevision:old.revision});
  const completed=await new InvestigationWorker({investigations:f.service,invokeModel:invoke}).run(owner,'workspace',f.run.id,{workerId:'fresh-resumed'});
  assert.equal(completed.state,'COMPLETED');assert.equal(completed.usage.modelCalls,8);
  assert.equal(completed.usage.readBytes,old.usage.readBytes);
  assert.deepEqual(attempts,['PLAN',...Array(4).fill('INVESTIGATE'),'CONSOLIDATE_PROPOSALS','EVIDENCE_VERIFICATION','EVIDENCE_VERIFICATION']);
  const after=await f.service.checkpoints(owner,'workspace',f.run.id);
  assert.deepEqual(after.find(c=>c.key===aggregate.key&&c.generation===aggregate.generation),aggregate);
  const graph=await f.service.graph(owner,'workspace',f.run.id);
  assert.equal(graph.consolidation.originalProposals.length,300);assert.equal(graph.candidates.length,160);assert.equal(graph.relations.length,140);
  const snapshot=await f.service.get(owner,'workspace',f.run.id);
  await assert.rejects(new InvestigationWorker({investigations:f.service,invokeModel:async()=>{throw Error('completed graph must not call a model');}})
    .run(owner,'workspace',f.run.id,{workerId:'completed-read'}),{code:'F003_LEASE_UNAVAILABLE'});
  assert.deepEqual(await f.service.get(owner,'workspace',f.run.id),snapshot);
});
