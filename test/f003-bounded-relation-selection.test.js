// Fully synthetic. No product graph, original business material, model output or private reference is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisStagePacket,jsonBytes,analysisInputBytes,stageTechnicalBytes} from '../src/business-knowledge/stage-context.js';
import {buildBusinessGraph} from '../src/business-knowledge/semantic-graph.js';
import {qualifyTaskProposals} from '../src/business-knowledge/proposals.js';
const version='synthetic-v1',bundle='synthetic-bundle',workspace='synthetic-workspace';
const marker=i=>`Marker ${String(i).padStart(2,'0')} contains literal label ${String(i).padStart(2,'0')}: `+'z'.repeat(1800);
const lines=[...Array.from({length:40},(_,i)=>marker(i)),'Marker 00 forwards to Marker 01 only when fixture switch is on. '+'q'.repeat(1800)];
const raw=[{id:'synthetic-material',sourceMaterial:{id:'synthetic-material',bundleId:bundle,workspaceId:workspace},text:lines.join('\n'),startLine:1,endLine:41,completeMaterial:true}];
const cite=i=>({materialId:raw[0].id,startLine:i+1,endLine:i+1,quote:lines[i]});
const candidates=Array.from({length:40},(_,i)=>({key:`marker-${i}`,kind:'BUSINESS_OBJECT',name:`Marker ${i}`,statement:marker(i),scope:'Synthetic literal marker only; no runtime claim.',evidence:[cite(i)],technicalRefs:i<2?[`fact-${i}`]:[],uncertainties:[],originRefs:[`origin-${i}`]}));
const relation={key:'fixture-edge',sourceKey:'marker-0',targetKey:'marker-1',predicate:'FORWARDS_TO',scope:'Only when fixture switch is on; static fixture, not execution.',evidence:[cite(40)],technicalRefs:['fact-edge'],uncertainties:[],originRefs:['origin-edge']};
const fact=(id,subjectId,extra={})=>({id,versionId:version,record:{subjectId,evidenceIds:[],premiseFactIds:[],basis:'DIRECT',...extra}});
const technicalEvidence={versionIds:[version],sourceBundleId:bundle,allowedFactIds:['fact-0','fact-1','fact-edge'],
  records:[fact('fact-0','object-0'),fact('fact-1','object-1'),fact('fact-edge','object-edge',{basis:'DERIVED',targetId:'object-1',premiseFactIds:['fact-0','fact-1']})],
  objects:[0,1,40].map((line,i)=>({objectId:i===2?'object-edge':`object-${i}`,versionId:version,materialId:'technical-material',anchor:{kind:'TEXT',lineStart:line+1,lineEnd:line+1}})),
  materials:[{materialId:'technical-material',versionId:version,sourceMaterial:{id:raw[0].id,bundleId:bundle}}],evidence:[],limitations:[],truncated:false};
const originals=[...candidates,relation].map((p,i)=>({id:p.originRefs[0],proposal:p,producer:{taskKey:i<20?'synthetic-left':'synthetic-right',slotId:'synthetic-child',ordinal:i}}));
const graphBase={workspaceId:workspace,investigationId:'synthetic-run',sourceBundleId:bundle,profileId:'synthetic-profile',materials:raw,inventory:[],allowedFactIds:technicalEvidence.allowedFactIds,adoptedVersionIds:[version],reviews:[]};
const input=stage=>({phase:'VERIFY',stage,question:'Explain the synthetic directed fixture relationship and its conditions.',candidates,relations:[relation],technicalEvidence,
  ...(stage==='CONSOLIDATE_PROPOSALS'?{originalProposals:originals}:{consolidation:{originalProposals:originals,sourceToCanonical:[],groups:[]}})});
function limits(p){assert.ok(jsonBytes(p)<=analysisInputBytes);assert.ok(jsonBytes(p.technicalEvidence)<=stageTechnicalBytes);assert.ok(p.evidenceContext.suppliedBytes<=64*1024);assert.deepEqual(p.evidenceContext.missingEvidence,[]);}
const results=[];
for(const stage of ['CONSOLIDATE_PROPOSALS','EVIDENCE_VERIFICATION']) {
  const base=input(stage),packed=analysisStagePacket(base,raw);
  // Feasibility witness, not an implementation: exchange two selected unrelated objects for the edge.
  // The complete universe remains in base, never deleted or marked accepted.
  const count=packed.input.candidates.length;
  const witness=analysisStagePacket({...base,candidates:packed.input.candidates.slice(0,count-2)},raw);
  results.push({stage,base,packed,witness,count});
}
test('synthetic control: all originals pass production structure/citation guards and remain below one output budget',()=>{
  assert.equal(buildBusinessGraph({...graphBase,candidates,relations:[relation]}).quarantine.length,0);
  assert.ok(jsonBytes({candidates,relations:[relation]})<1024*1024);
  assert.equal(candidates.length+1,41);
});
test('synthetic feasibility: a complete directed edge and both technical/raw endpoint closures fit the unchanged envelope',()=>{
  for(const {stage,base,packed,witness,count}of results){
    limits(packed.input);limits(witness.input);
    assert.ok(count>3);assert.equal(witness.input.relations.length,1);assert.equal(witness.omitted.length,0);
    assert.ok(witness.input.candidates.some(p=>p.key===relation.sourceKey));assert.ok(witness.input.candidates.some(p=>p.key===relation.targetKey));
    assert.deepEqual(new Set(witness.input.technicalEvidence.allowedFactIds),new Set(technicalEvidence.allowedFactIds));
    assert.equal(base.candidates.length,40);assert.equal(base.relations.length,1);
    const edgePremise=witness.input.evidenceContext.premises.find(p=>p.key===relation.key);
    assert.deepEqual(new Set(edgePremise.endpointKeys),new Set([relation.sourceKey,relation.targetKey]));
    console.log(JSON.stringify({kind:'SYNTHETIC_SELECTION_WITNESS',stage,universe:41,defaultObjects:count,defaultRelations:packed.input.relations.length,
      defaultBytes:jsonBytes(packed.input),defaultRaw:packed.input.evidenceContext.suppliedBytes,witnessObjects:witness.input.candidates.length,witnessRelations:1,
      witnessBytes:jsonBytes(witness.input),witnessRaw:witness.input.evidenceContext.suppliedBytes,witnessTechnicalBytes:jsonBytes(witness.input.technicalEvidence),realModel:false}));
  }
});
for(const {stage,packed}of results)test(`candidate category must not exhaust ${stage} while a complete requested relationship fits by bounded exchange`,()=>{
  assert.equal(packed.input.relations.length,1,'Complete requested relation is starved by the unconditional candidate prefix, not by an impossible closure');
});
test('synthetic safety control: invalid endpoint never enters a relation packet, and absent reviews never imply acceptance',()=>{
  const p=analysisStagePacket({...input('EVIDENCE_VERIFICATION'),candidates:candidates.slice(0,2),invalidProposalKeys:['marker-0']},raw);
  assert.equal(p.input.relations.length,0);
  const g=buildBusinessGraph({...graphBase,candidates,relations:[relation]});
  assert.ok([...g.candidates,...g.relations].every(p=>p.state==='RETAINED_UNKNOWN'));
});

test('equivalent array and task-origin orderings preserve a complete relationship and independent objects in both stages',()=>{
 for(const stage of ['CONSOLIDATE_PROPOSALS','EVIDENCE_VERIFICATION'])for(const reversed of [false,true]) {
  const base=input(stage),before=structuredClone(base);
  if(reversed){base.candidates.reverse();(base.originalProposals??base.consolidation.originalProposals).reverse();}
  const p=analysisStagePacket(base,raw);limits(p.input);
  assert.equal(p.input.relations.length,1);
  for(const k of [relation.sourceKey,relation.targetKey])assert.ok(p.input.candidates.some(c=>c.key===k),'endpoints must receive their own reviews');
  assert.ok(p.input.candidates.some(c=>![relation.sourceKey,relation.targetKey].includes(c.key)));
  assert.equal(p.input.evidenceContext.missingEvidence.length,0);
  const sorted=analysisStagePacket(before,raw);
  assert.deepEqual(p.input.candidates.map(p=>p.key),sorted.input.candidates.map(p=>p.key));
  assert.deepEqual(p.omitted,sorted.omitted);
 }
});

test('large, invalid and incomplete relationship neighbors cannot displace a feasible complete closure',()=>{
 const huge={...relation,key:'a-huge',scope:'x'.repeat(150000)};
 const bad={...candidates[0],key:'bad',statement:undefined,name:undefined};
 const incident={...relation,key:'b-invalid',sourceKey:'bad'};
 const missing={...relation,key:'c-missing',technicalRefs:['absent']};
 const base={...input('CONSOLIDATE_PROPOSALS'),candidates:[bad,...candidates],relations:[huge,incident,missing,relation],invalidProposalKeys:['bad']};
 const p=analysisStagePacket(base,raw);
 assert.ok(jsonBytes(p.input)<=analysisInputBytes);
 assert.ok(!p.input.evidenceContext.missingEvidence.some(g=>g.key===relation.key));
 assert.ok(p.input.relations.some(r=>r.key===relation.key));
 assert.ok(!p.input.relations.some(r=>r.key===incident.key));
 assert.ok(p.omitted.some(r=>r.key===huge.key));
 const edge=p.input.evidenceContext.premises.find(p=>p.key===relation.key);
 assert.deepEqual(new Set(edge.endpointKeys),new Set([relation.sourceKey,relation.targetKey]));
});

test('without a fitting relationship ordinary objects still receive the unchanged budget',()=>{
 const large={...relation,scope:'x'.repeat(150000)};
 const p=analysisStagePacket({...input('EVIDENCE_VERIFICATION'),relations:[large]},raw);
 assert.ok(p.input.candidates.length>3);assert.equal(p.input.relations.length,0);
 assert.ok(p.omitted.some(o=>o.key===relation.key));limits(p.input);
});

test('a fitting relation may exchange an independent object, without switching to unconditional relationship priority',()=>{
 const heavy={...candidates[3],key:'a-independent',statement:'x'.repeat(16000),scope:'s'.repeat(16000),uncertainties:['u'.repeat(10000)],originRefs:['heavy']};
 const edge={...relation,scope:'s'.repeat(16000),originRefs:['large-edge']};
 const ordinary={...candidates[4],key:'z-small',originRefs:['small']};
 const selected=[heavy,...candidates.slice(0,2),ordinary];
 const base={...input('CONSOLIDATE_PROPOSALS'),candidates:selected,relations:[edge],
  originalProposals:[...selected,edge].map(p=>({id:p.originRefs[0],proposal:p}))};
 const alone=analysisStagePacket({...base,candidates:candidates.slice(0,2)},raw);limits(alone.input);
 assert.equal(alone.input.relations.length,1,'the complete closure really fits alone');
 const p=analysisStagePacket(base,raw);limits(p.input);
 assert.equal(p.input.relations.length,1);assert.ok(p.input.candidates.some(p=>p.key==='z-small'));
 assert.ok(p.omitted.some(p=>p.key==='a-independent'));
 const noFit=analysisStagePacket({...base,relations:[{...edge,scope:'x'.repeat(150000)}]},raw);
 assert.ok(noFit.input.candidates.some(p=>p.key==='a-independent'),'an oversized relationship cannot reserve or consume the independent lane');
});

test('raw and technical incomplete closures remain explicitly unknown without displacing a good independent branch',()=>{
 for(const failure of ['RAW','MISSING_FACT','LARGE_DAG']) {
  const base=input('EVIDENCE_VERIFICATION'),largeRaw=structuredClone(raw),tech=structuredClone(technicalEvidence);
  if(failure==='RAW')largeRaw[0].text=lines.map((l,n)=>n===40?'x'.repeat(70000):l).join('\n');
  if(failure==='MISSING_FACT')tech.records=tech.records.filter(r=>r.id!=='fact-edge');
  if(failure==='LARGE_DAG')tech.records.find(r=>r.id==='fact-edge').record.payload='x'.repeat(40000);
  const p=analysisStagePacket({...base,technicalEvidence:tech},largeRaw);
  assert.ok(p.input.candidates.some(c=>c.key==='marker-10'));
  assert.ok(p.omitted.some(o=>o.key===relation.key)||p.input.evidenceContext.missingEvidence.some(o=>o.key===relation.key));
  assert.ok(jsonBytes(p.input)<=analysisInputBytes);assert.ok(jsonBytes(p.input.technicalEvidence)<=stageTechnicalBytes);
 }
});

test('actual task-qualified proposals retain directed closures across task order and relationship sizes',()=>{
 for(const extra of [0,5000,16000])for(const reverse of [false,true]) {
  const tasks=Array.from({length:4},(_,n)=>qualifyTaskProposals({investigationId:'synthetic-run',sourceBundleId:bundle,
   taskKey:`task-${n}`,slotId:'child',modelRevisionId:'synthetic',reservationId:`reservation-${n}`,materialIds:[raw[0].id],
   output:{candidates:candidates.slice(n*10,n*10+10),relations:n===0?[{...relation,scope:relation.scope+'s'.repeat(extra)}]:[]}}));
  if(reverse)tasks.reverse();
  const c=tasks.flatMap(t=>t.candidates),r=tasks.flatMap(t=>t.relations),originalProposals=tasks.flatMap(t=>t.originalProposals);
  assert.deepEqual(buildBusinessGraph({...graphBase,candidates:c,relations:r}).quarantine,[]);
  for(const stage of ['CONSOLIDATE_PROPOSALS','EVIDENCE_VERIFICATION']) {
   const base={...input(stage),candidates:c,relations:r};
   if(stage==='CONSOLIDATE_PROPOSALS')base.originalProposals=originalProposals;
   else base.consolidation={originalProposals,sourceToCanonical:[],groups:[]};
   const p=analysisStagePacket(base,raw);limits(p.input);
   assert.equal(p.input.relations.length,1);
   for(const key of [r[0].sourceKey,r[0].targetKey])assert.ok(p.input.candidates.some(p=>p.key===key));
   assert.ok(p.input.candidates.some(p=>![r[0].sourceKey,r[0].targetKey].includes(p.key)));
  }
 }
});
