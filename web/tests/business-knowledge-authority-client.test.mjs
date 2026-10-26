import assert from 'node:assert/strict';
import test from 'node:test';
import {BusinessKnowledgeClient} from '../app/business-knowledge/client.ts';
import {setSessionProof} from '../app/auth-client.ts';
const workspace='workspace',revision='published-revision',objectKey='rule',graphDigest='a'.repeat(64),sourceBundleId='b'.repeat(64);
const fixed={graphDigest,sourceBundleId};
const target={featureId:'feature',featureVersion:1,claimId:'claim',claimVersion:1,scopeId:'scope',scopeVersion:1,verificationTargets:[]};
const input={operationId:'original-operation',objectKey,expectedGraphDigest:graphDigest,expectedVersion:0,rationale:'explicit comparison',targets:[target]};
const bindingSet={id:'binding',workspaceId:workspace,graphRevisionId:revision,graphDigest,sourceBundleId,objectKey,version:1,actorId:'member',rationale:input.rationale,targets:[{...target,scope:{id:'scope',version:1}}],createdAt:'2026-10-23T00:00:00Z'};
const projection={kind:'DERIVED_AUTHORITY_AND_EXECUTION',workspaceId:workspace,graphRevisionId:revision,graphDigest,objectKey,analysisState:'ANALYSIS_ACCEPTED',evaluatedAt:'2026-10-23T00:00:00Z',targets:[{...bindingSet.targets[0],authority:{status:'UNREVIEWED',scopeActive:true,versionCurrent:true,applies:false,latestDecision:null,history:[],historyTruncated:false},verification:[]}]};
const envelope=body=>new Response(JSON.stringify({schemaVersion:1,workspaceId:workspace,...body}),{headers:{'content-type':'application/json'}});

test('authority reads bind the exact published revision, object and optional history, without any write',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return envelope({bindingSet,currentBindingVersion:1,projection});});
 const client=new BusinessKnowledgeClient('https://api.test',workspace);
 const result=await client.authorityBindings(revision,objectKey,fixed,1);
 assert.equal(result.projection.authority,undefined);assert.equal(result.projection.targets[0].authority.applies,false);
 assert.equal(new URL(calls[0].url).searchParams.get('bindingVersion'),'1');assert.equal(new URL(calls[0].url).searchParams.get('objectKey'),objectKey);
 assert.match(calls[0].url,/business-knowledge\/versions\/published-revision\/authority-bindings/);
 assert.equal(calls[0].options.method,'GET');assert.equal(calls.length,1);
});

test('authority refuses wrong workspace/revision/digest/object/source and malformed history without substituting latest',async t=>{
 const client=new BusinessKnowledgeClient('https://api.test',workspace);
 for(const patch of [{workspaceId:'other'},{graphRevisionId:'other'},{graphDigest:'c'.repeat(64)},{objectKey:'other'}]){
  t.mock.method(globalThis,'fetch',async()=>envelope({bindingSet,currentBindingVersion:1,projection:{...projection,...patch}}));
  await assert.rejects(client.authorityBindings(revision,objectKey,fixed),{code:'F003_RESPONSE_INVALID'});
 }
 for(const patch of [{sourceBundleId:'other'},{version:2},{targets:[]}]){
  t.mock.method(globalThis,'fetch',async()=>envelope({bindingSet:{...bindingSet,...patch},currentBindingVersion:1,projection}));
  await assert.rejects(client.authorityBindings(revision,objectKey,fixed,1),{code:'F003_RESPONSE_INVALID'});
 }
});

test('mapping writes send one explicit full set with CSRF/CAS and validate acknowledgements, never approval or PASS',async t=>{
 const calls=[];setSessionProof('proof');t.after(()=>setSessionProof(''));
 t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return envelope({bindingSet,replayed:false});});
 const client=new BusinessKnowledgeClient('https://api.test',workspace);
 await client.bindAuthority(revision,input,fixed);
 assert.deepEqual(JSON.parse(calls[0].options.body),input);assert.equal(new Headers(calls[0].options.headers).get('x-traqen-csrf'),'proof');
 assert.ok(!new Headers(calls[0].options.headers).has('authorization'));assert.equal(calls.length,1);
 t.mock.method(globalThis,'fetch',async()=>envelope({bindingSet:{...bindingSet,objectKey:'foreign'},replayed:false}));
 await assert.rejects(client.bindAuthority(revision,input,fixed),{code:'F003_RESPONSE_INVALID'});
 t.mock.method(globalThis,'fetch',async()=>{calls.push('lost');throw Error('lost accepted response');});
 await assert.rejects(client.bindAuthority(revision,input,fixed),{code:'F003_NETWORK_UNCONFIRMED'});assert.equal(calls.filter(c=>c==='lost').length,1);
});

test('unpublished, forbidden and conflicting mappings preserve their actual refusal; invalid path coordinates never fetch',async t=>{
 let calls=0;const client=new BusinessKnowledgeClient('https://api.test',workspace);
 for(const [status,code] of [[404,'F003_VERSION_NOT_FOUND'],[403,'F003_INVESTIGATION_FORBIDDEN'],[409,'F003_BINDING_CONFLICT']]){
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({error:{code,message:'refused'}}),{status,headers:{'content-type':'application/json'}});});
  await assert.rejects(client.authorityBindings(revision,objectKey,fixed),{status,code});
 }
 const previous=calls;
 for(const bad of ['.','..',''])await assert.rejects(client.authorityBindings(bad,objectKey,fixed),{code:'F003_RESPONSE_INVALID'});
 assert.equal(calls,previous);
});

test('authority rejects mismatched scope snapshots, malformed decisions and fabricated execution success',async t=>{
 const client=new BusinessKnowledgeClient('https://api.test',workspace);
 const decisions={id:'decision',type:'CONFIRMED',content:'approved exact scope',actorId:'reviewer',actorRole:'business-owner',validUntil:null,createdAt:'2026-10-23T00:00:00Z',evidenceRefs:[]};
 const normal={bindingSet,currentBindingVersion:1,projection};
 const cases=[];
 let v=structuredClone(normal);v.bindingSet.targets[0].scope.id='foreign-scope';cases.push(v);
 v=structuredClone(normal);v.projection.targets[0].scope.version=9;cases.push(v);
 v=structuredClone(normal);v.projection.targets[0].authority={...v.projection.targets[0].authority,status:'CONFIRMED',applies:true,latestDecision:decisions,history:[{...decisions,content:{unsafe:'not text'}}]};cases.push(v);
 v=structuredClone(normal);v.projection.targets[0].authority={...v.projection.targets[0].authority,status:'CONFIRMED',applies:true,latestDecision:decisions,history:[]};cases.push(v);
 const ref={testSpecId:'test',testSpecVersion:2,snapshotManifestId:'snapshot',deploymentId:'env'};
 for(const history of [[],[{id:'exec',trusted:false,status:'PASS',receivedAt:'now',evidenceRefs:[]}],[{id:'exec',trusted:true,status:'FAIL',receivedAt:'now',evidenceRefs:[]}]]){
  v=structuredClone(normal);v.bindingSet.targets[0].verificationTargets=[ref];v.projection.targets[0].verificationTargets=[ref];v.projection.targets[0].verification=[{...ref,status:'PASS',testSpecApproved:true,ordering:'SERVER_RECEIPT_TIME',truncated:false,history}];cases.push(v);
 }
 for(const body of cases){t.mock.method(globalThis,'fetch',async()=>envelope(body));await assert.rejects(client.authorityBindings(revision,objectKey,fixed),{code:'F003_RESPONSE_INVALID'});}
});

test('published graph reads reject a different revision, source, profile, investigation or digest',async t=>{
 const client=new BusinessKnowledgeClient('https://api.test',workspace),expected={...fixed,profileId:'profile'};
 const binding={workspaceId:workspace,investigationId:'run',graphDigest,sourceInput:{sourceBundleSnapshotId:sourceBundleId,receiptId:'receipt'},profileId:'profile',adoptedVersionIds:[]};
 const valid={publication:{workspaceId:workspace,investigationId:'run',graphDigest,graphRevisionId:revision,headVersion:1,binding},revision:{id:revision,projectId:workspace,status:'PUBLISHED',analysisRunId:'run',graphArtifactDigest:graphDigest},graph:{digest:graphDigest,sourceBundleId,profileId:'profile',adoptedVersionIds:[],candidates:[],relations:[]}};
 t.mock.method(globalThis,'fetch',async()=>envelope(valid));await client.publishedVersion(revision,'run',expected);
 for(const [section,patch] of [['publication',{graphRevisionId:'other'}],['publication',{investigationId:'other'}],['graph',{sourceBundleId:'other'}],['graph',{profileId:'other'}],['graph',{digest:'other'}],['graph',{adoptedVersionIds:['foreign-technical-version']}],['revision',{status:'DRAFT'}]]){
  t.mock.method(globalThis,'fetch',async()=>envelope({...valid,[section]:{...valid[section],...patch}}));await assert.rejects(client.publishedVersion(revision,'run',expected),{code:'F003_RESPONSE_INVALID'});
 }
});

test('relation inspection reads the exact saved implementation graph and retains only its own evidence closure',async t=>{
 const client=new BusinessKnowledgeClient('https://api.test',workspace),expected={...fixed,profileId:'profile'},calls=[];
 const graph={investigationId:'run',graphDigest,sourceBundleId,profileId:'profile',adoptedVersionIds:[],view:'IMPLEMENTATION',nodes:[{key:'source'},{key:'target'},{key:'unrelated'}],edges:[{key:'relation',sourceKey:'source',targetKey:'target',evidence:[{materialId:'edge-material'}]},{key:'other',sourceKey:'source',targetKey:'unrelated',evidence:[{materialId:'other-material'}]}],materials:[{id:'edge-material'},{id:'other-material'}],coverage:[]};
 t.mock.method(globalThis,'fetch',async(url)=>{calls.push(url);return envelope({graph});});
 const inspected=await client.inspect('run','relation',expected);
 assert.equal(inspected.relation,true);assert.deepEqual(inspected.nodes.map(n=>n.key),['source','target']);assert.deepEqual(inspected.edges.map(n=>n.key),['relation']);assert.deepEqual(inspected.materials.map(m=>m.id),['edge-material']);
 assert.equal(calls.length,1);assert.equal(new URL(calls[0]).searchParams.get('includeUncertain'),'true');assert.ok(!calls[0].includes('/trace?'));
 t.mock.method(globalThis,'fetch',async()=>envelope({graph:{...graph,graphDigest:'other'}}));
 await assert.rejects(client.inspect('run','relation',expected),{code:'F003_RESPONSE_INVALID'});
});
