import test from 'node:test';
import assert from 'node:assert/strict';
import {incrementalFixture,actor,workspace} from './support/f003-incremental-fixture.js';

test('internal private analysis resolves current ownership/delegation and denies forged/foreign/unfinished bases atomically',async t=>{
  const f=await incrementalFixture(t),a=await f.run({...f.request,operationId:'private-A'}),next=await f.next();
  const input={...f.request,...next,operationId:'private-B',baseInvestigationId:a.run.id,expectedBaseGraphDigest:a.graph.digest};
  const count=async()=>Number((await f.db.query('SELECT count(*) n FROM f003_investigation')).rows[0].n);
  const reader={actorId:'reader',tenantId:'tenant'};
  await f.repository.provision(workspace,{tenantId:'tenant',grants:[{actorId:'reader',role:'MAINTAIN'}]});
  const before=await count();
  await assert.rejects(f.service.startIncremental(reader,workspace,input),{code:'F003_INVESTIGATION_FORBIDDEN'});
  await assert.rejects(f.service.startIncremental(actor,'workspace2',input),{code:'SOURCE_FORBIDDEN'});
  await assert.rejects(f.service.startIncremental(actor,workspace,{...input,expectedBaseGraphDigest:'e'.repeat(64)}),{code:'F003_CONTINUATION_SOURCE_MISMATCH'});
  for(const field of ['trustedBasis','measurement','purpose','continuationBasis'])
    await assert.rejects(f.service.startIncremental(actor,workspace,{...input,[field]:true}),{code:'F003_INPUT_INVALID'});
  assert.equal(await count(),before);
  const unfinished=await f.service.start(actor,workspace,{...f.request,operationId:'unfinished-A'});
  await assert.rejects(f.service.startIncremental(actor,workspace,{...input,baseInvestigationId:unfinished.id}),{code:'F003_CONTINUATION_SOURCE_INCOMPLETE'});
  // Existing explicit delegation state, not a new HTTP delegation bypass.
  await f.db.query("UPDATE f003_investigation SET payload=jsonb_set(payload,'{delegateActorIds}','[\"reader\"]') WHERE id=$1",[a.run.id]);
  const delegated=await f.service.startIncremental(reader,workspace,input);
  assert.equal(delegated.actorId,'reader');assert.equal(delegated.continuationBasis.a.investigationId,a.run.id);
  await f.db.query("UPDATE f003_investigation SET payload=jsonb_set(payload,'{delegateActorIds}','[]') WHERE id=$1",[a.run.id]);
  await assert.rejects(f.service.claim(reader,workspace,delegated.id,{workerId:'revoked-delegate'}),{code:'F003_INVESTIGATION_FORBIDDEN'});
  assert.equal((await f.service.get(reader,workspace,delegated.id)).usage.modelCalls,0);
  const own=await f.service.startIncremental(actor,workspace,input);
  const saved=await f.service.get(actor,workspace,own.id);
  for(const [column,value,code] of [['backup_barrier',true,'F003_BACKUP_BARRIER'],['restore_ready',false,'F003_RESTORE_UNVERIFIED']]) {
    await f.db.query(`UPDATE source_truth_workspace SET ${column}=$1 WHERE workspace_id=$2`,[value,workspace]);
    await assert.rejects(f.service.startIncremental(actor,workspace,{...input,operationId:'blocked-'+column}),{code});
    if(column==='backup_barrier')assert.deepEqual(await f.service.get(actor,workspace,own.id),saved);
    await f.db.query(`UPDATE source_truth_workspace SET ${column}=$1 WHERE workspace_id=$2`,[!value,workspace]);
  }
  await f.repository.provision(workspace,{tenantId:'tenant',grants:[{actorId:'owner',role:'REVOKED'}]});
  await assert.rejects(f.service.claim(actor,workspace,own.id,{workerId:'revoked-owner'}),{code:'SOURCE_FORBIDDEN'});
});
