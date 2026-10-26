import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BusinessKnowledgeClient} from '../app/business-knowledge/client.ts';
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=Buffer.from('订单\n<script>inert()</script>\n');
const source={sourceBundleSnapshotId:'a'.repeat(64),receiptId:'receipt'};
const material={id:'material',receiptId:'receipt',kind:'FILE',assetType:'CODE',sourceMaterial:{id:'material',workspaceId:'workspace',bundleId:source.sourceBundleSnapshotId,componentId:'component',pathBytes:'b3JkZXJzLnRz',contentDigest:sha(bytes)}};
const version={publication:{workspaceId:'workspace',graphRevisionId:'revision',investigationId:'private-run',graphDigest:'b'.repeat(64),binding:{sourceInput:source,profileId:'profile',adoptedVersionIds:[]}},
  graph:{digest:'b'.repeat(64),sourceBundleId:source.sourceBundleSnapshotId,profileId:'profile',adoptedVersionIds:[]}};
const identity={graphId:'graph',investigationId:'private-run',graphRevisionId:'revision',graphDigest:'b'.repeat(64),sourceInput:source,sourceBundleId:source.sourceBundleSnapshotId,profileId:'profile',adoptedVersionIds:[],technicalVersions:[],published:true,canonicalAnalysisPublished:false,publicationState:'PUBLISHED'};
const relation={key:'relation',scope:'explicit relation',state:'ANALYSIS_ACCEPTED',authority:'AGENT_ANALYSIS',evidence:[],uncertainties:[],technicalRefs:[],currentAuthority:{objectAuthority:'NOT_ESTABLISHED_BY_MAPPING',status:'UNMAPPED',targets:[],confirmedTargets:[]},currentExecution:{targets:[]},stateDimensions:Object.fromEntries(['authority','conformance','verification','freshness','conflict'].map(k=>[k,{status:'UNKNOWN'}]))};
const envelope=value=>new Response(JSON.stringify({schemaVersion:1,workspaceId:'workspace',...value}),{headers:{'content-type':'application/json'}});
test('exact published graph, relation trace, seven questions and materials use READ routes only, never the private investigation',async t=>{
  const old=globalThis.fetch,calls=[];t.after(()=>globalThis.fetch=old);
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),method:options.method});
    if(String(url).includes('/seven-questions'))return envelope({answer:{...identity,key:'relation',authority:'DERIVED_VIEW',sections:Array.from({length:7},(_,i)=>({question:String(i)})),currentProjection:{nodes:[],edges:[]},stateDimensions:null}});
    if(String(url).includes('/trace'))return envelope({trace:{...identity,direction:'RELATION_TO_ENDPOINTS_AND_MATERIAL',nodes:[],edges:[relation],materials:[material]}});
    if(String(url).endsWith('/materials'))return envelope({...identity,materials:[material],coverage:[]});
    return envelope({graph:{...identity,view:'COVERAGE',nodes:[],edges:[],materials:[material],coverage:[],uncertaintyCount:0,selectionScope:'ANALYSIS_WITH_CURRENT_PROJECTION'}});
  };
  const reader=new BusinessKnowledgeClient('/api','workspace').publishedReads(version);
  assert.equal((await reader.graph({view:'COVERAGE',onlyHumanConfirmed:true})).graphRevisionId,'revision');
  await reader.trace({key:'relation'});await reader.sevenQuestions('relation');await reader.materials();
  assert.ok(calls.every(c=>c.method==='GET'&&!c.url.includes('/investigations/')));
  assert.ok(calls.every(c=>c.url.includes('/versions/revision/')));
  assert.equal(new URL(calls[0].url,'https://example.invalid').searchParams.get('onlyHumanConfirmed'),'true');
});
test('published responses cannot swap exact revision, source, receipt, profile, adopted versions or requested question key',async t=>{
  const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);
  const reader=new BusinessKnowledgeClient('/api','workspace').publishedReads(version);
  for(const change of [{graphRevisionId:'other'},{graphDigest:'c'.repeat(64)},{sourceInput:{...source,receiptId:'other'}},{sourceInput:{...source,sourceBundleSnapshotId:'d'.repeat(64)}},{profileId:'other'},{adoptedVersionIds:['e'.repeat(64)]}]){
    globalThis.fetch=async()=>envelope({graph:{...identity,view:'BUSINESS',nodes:[],edges:[],materials:[],coverage:[],uncertaintyCount:0,...change}});
    await assert.rejects(reader.graph({view:'BUSINESS'}));
  }
  globalThis.fetch=async()=>envelope({answer:{...identity,key:'other',authority:'DERIVED_VIEW',sections:[]}});
  await assert.rejects(reader.sevenQuestions('relation'));
});
test('published originals validate all identity headers and actual SHA before returning inert UTF8 or binary download bytes',async t=>{
  const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);
  const reader=new BusinessKnowledgeClient('/api','workspace').publishedReads(version);
  const headers={'content-type':'application/octet-stream','x-source-material-ref':'material','x-original-sha256':sha(bytes),'x-graph-revision-id':'revision','x-graph-digest':identity.graphDigest,'x-source-bundle-id':source.sourceBundleSnapshotId,'x-source-receipt-id':'receipt'};
  globalThis.fetch=async()=>new Response(bytes,{headers});
  const value=await reader.material(material);assert.equal(value.text,bytes.toString());assert.deepEqual(Buffer.from(value.data),bytes);
  for(const field of Object.keys(headers).filter(k=>k!=='content-type')){
    globalThis.fetch=async()=>new Response(bytes,{headers:{...headers,[field]:'wrong'}});
    await assert.rejects(reader.material(material));
  }
  globalThis.fetch=async()=>new Response(Buffer.from('wrong'),{headers});await assert.rejects(reader.material(material));
  const binary=Buffer.from([0,255,1]),binaryMaterial={...material,sourceMaterial:{...material.sourceMaterial,contentDigest:sha(binary)}};
  globalThis.fetch=async()=>new Response(binary,{headers:{...headers,'x-original-sha256':sha(binary)}});
  assert.equal((await reader.material(binaryMaterial)).text,null);
});
