import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createHash} from 'node:crypto';
import {authorityFixture} from './support/f003-authority-fixture.js';
import {AnalysisModelRegistry} from '../src/analysis/index.js';
import {PostgresTraceabilityStore} from '../src/storage/index.js';
import {TraceabilityApplication} from '../src/application/traceability-application.js';
import {createF003Runtime} from '../src/business-knowledge/runtime.js';
import {questionActor as actor,questionInput} from './support/f003-question-fixture.js';

test('F003 question uses the actual F006 active account/team/registry ANSWER port, and retired models block new calls but not saved answers',async t=>{
  const f=await authorityFixture(t),calls=[];
  // External CLI process only is a double; activation, immutable configuration,
  // account eligibility, model grants, material reads and durable budgets are real.
  const registry=new AnalysisModelRegistry({cliSpawn:(_executable,args,options)=>{
    const child=new EventEmitter();child.pid=99999999;child.kill=()=>{};
    child.stdout=new PassThrough();child.stderr=new PassThrough();let prompt='';
    const reply=raw=>{
      const task=JSON.parse(raw),i=task.input;let result;
      if(task.task==='connection-verification')result={ready:true,challenge:i.challenge};
      else {
        calls.push({phase:i.phase,operation:i.operation,args,options});
        result=i.phase==='PLAN'?{assignments:[{slotId:i.childSlots[0].id,objectKeys:i.objects.map(o=>o.key)}]}
          :i.operation==='DRAFT'?{segments:[{key:'rule',text:'该版原文支持未支付订单可取消。',stance:'SUPPORTED',graphRefs:[i.objects[0].key],
            evidence:i.objects[0].evidence,technicalRefs:[],uncertainties:[]}],unknowns:['未证明真实执行']}
            :{reviews:i.drafts.flatMap(d=>d.segments).map(s=>({key:s.key,support:'SUPPORTED',rationale:'synthetic CLI mechanism response',unresolvedConflicts:[]}))};
      }
      queueMicrotask(()=>{child.stdout.end(`${JSON.stringify(result)}\n`);child.stderr.end();child.emit('close',0);});
    };
    child.stdin=new Writable({write(chunk,_encoding,callback){prompt+=chunk;callback();},final(callback){reply(prompt);callback();}});
    if(args.at(-1)!=='-')queueMicrotask(()=>reply(args.at(-1)));return child;
  }});
  const store=new PostgresTraceabilityStore(f.db),application=new TraceabilityApplication({store,analysisModelRegistry:registry,secretReferenceResolver:async()=>'isolated-qa-secret-not-real'});
  await application.saveGlobalAccount({accountId:'qa-account',displayName:'mechanism CLI account',authMethod:'API_KEY',secretRefId:'vault://test-only',expectedVersion:0});
  await application.configureGlobalCliModel({profileId:'qa-model',accountId:'qa-account',cliAdapter:'CODEX',model:'isolated-qa-test-model'});
  await application.verifyGlobalModelProfile('qa-model',{taskPolicy:'BUSINESS_KNOWLEDGE'});
  await application.saveWorkspaceCapabilityDraft('workspace',{expectedVersion:0,mainAgentSlot:{modelProfileId:'qa-model'},
    childAgentSlots:[{id:'qa-child',modelProfileId:'qa-model',independenceGroup:'independent-child'}],projectCapabilityRevisionIds:[],disabledKeys:[]});
  const active=await application.activateWorkspaceCapabilityDraft('workspace');
  const runtime=await createF003Runtime({publicationAuthorityFile:null,application,sourceRuntime:{pool:f.db,
    services:{repository:f.repository,admission:f.sourceAdmission},configuration:{members:[{...actor,
      tokenDigest:createHash('sha256').update('isolated-qa-port-token').digest('hex')}],origins:[]}}});t.after(()=>runtime.close());
  const pubs=f.runtime.services.publications;
  Object.assign(runtime.services.publications,{authority:pubs.authority,backup:pubs.backup,qualityPolicy:pubs.qualityPolicy,implementationResolver:pubs.implementationResolver});
  const {workSessions,executor}=runtime.services;
  const {session}=await workSessions.create(actor,'workspace',f.published.publication.graphRevisionId,{operationId:'actual-port-session',expectedGraphDigest:f.graph.digest,title:'actual F006 port, synthetic process'});
  const q=await workSessions.ask(actor,'workspace',session.id,questionInput(f,{expectedProfileId:active.id}));
  executor.enqueue(q.run);await executor.drain();const completed=await workSessions.question(actor,'workspace',session.id,q.run.id);
  assert.equal(completed.run.state,'COMPLETED',JSON.stringify(completed.run.lastFailure));assert.equal(completed.run.profile.id,active.id);
  assert.equal(completed.answer.profileId,active.id);assert.equal(completed.answer.segments[0].stance,'SUPPORTED');
  assert.deepEqual(calls.map(c=>c.phase),['PLAN','ANSWER','ANSWER']);assert.equal(completed.run.usage.modelCalls,3);
  assert.ok(calls.every(c=>c.args.includes('--ignore-user-config') && c.options.env.OPENAI_API_KEY==='isolated-qa-secret-not-real'));
  assert.equal(JSON.stringify(await runtime.services.investigations.checkpoints(actor,'workspace',q.run.id)).includes('isolated-qa-secret-not-real'),false);
  await store.setGlobalModelLifecycle('qa-model','RETIRING');
  await assert.rejects(()=>workSessions.ask(actor,'workspace',session.id,questionInput(f,{operationId:'after-retire',expectedSessionVersion:2,expectedProfileId:active.id})),e=>e.code==='F003_MODEL_UNAVAILABLE');
  assert.deepEqual((await workSessions.question(actor,'workspace',session.id,q.run.id)).answer,completed.answer);assert.equal(calls.length,3);
  assert.equal((await f.db.query("SELECT count(*)::int n FROM understanding_record WHERE record_type='WORKSPACE_ANALYSIS_JOB'")).rows[0].n,0);
});
