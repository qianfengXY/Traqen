import assert from 'node:assert/strict';
import test from 'node:test';
import {questionPremiseResolver,questionOriginalContext,boundedQuestionVerification} from '../src/business-knowledge/question-context.js';

const empty={records:[],objects:[],evidence:[],materials:[],allowedFactIds:[],versionIds:[],sourceBundleId:'bundle'};
const cite=(materialId,quote='ANCHOR')=>({materialId,startLine:1,endLine:1,quote});
const node=(key,evidence,extra={})=>({key,kind:'RULE',state:'ANALYSIS_ACCEPTED',evidence,technicalRefs:[],...extra});
const item=(key,...graphRefs)=>({key,graphRefs});
const visible=(packet,word)=>packet.materials.some(m=>m.text.includes(word));

test('QA premise closure is derived from exact graph refs, includes all sources and is not the Child citation subset',()=>{
  const object=node('rule',[cite('a','ALLOW'),cite('b')]),resolver=questionPremiseResolver([object],[],empty);
  const packet=questionOriginalContext([{...item('answer','rule'),evidence:[cite('a','ALLOW')]}],[{id:'a',text:'ALLOW'},{id:'b',text:'ONLY_UNPAID ANCHOR'}],resolver);
  assert.equal(visible(packet,'ONLY_UNPAID'),true);assert.deepEqual(packet.evidenceContext.missingEvidence,[]);
  assert.deepEqual(resolver.materialIds,['a','b']);assert.equal(object.evidence.length,2);
});

test('QA directed relation closure contains both endpoints, their conditions and actual direct material endpoints without changing direction',()=>{
  const left=node('cancel',[cite('a')]),right=node('release',[cite('b')]);
  const edge=node('edge',[cite('c')],{sourceKey:'cancel',targetKey:'release',predicate:'INVOKES'});
  const before=structuredClone(edge),resolver=questionPremiseResolver([edge],[left,right],empty);
  const packet=questionOriginalContext([item('answer','edge')],[{id:'a',text:'source ANCHOR'},{id:'b',text:'target CONDITION ANCHOR'},{id:'c',text:'edge ANCHOR'}],resolver);
  assert.ok(visible(packet,'CONDITION'));assert.deepEqual(packet.evidenceContext.premises[0].endpointKeys,['cancel','release']);assert.deepEqual(edge,before);
  const material={key:'code',id:'code',kind:'UNKNOWN',sourceMaterial:{id:'code'}};
  const toMaterial={...edge,targetKey:'code'},direct=questionPremiseResolver([toMaterial],[left,material],empty);
  assert.ok(visible(questionOriginalContext([item('a','edge')],[{id:'a',text:'ANCHOR'},{id:'c',text:'ANCHOR'},{id:'code',text:'FULL MATERIAL PREMISE'}],direct),'FULL MATERIAL PREMISE'));
});

function technicalFixture() {
  const versionId='adopted',sourceMaterial=id=>({id,bundleId:'bundle'});
  return {...empty,versionIds:[versionId],allowedFactIds:['call','premise'],
    records:[{id:'call',versionId,record:{subjectId:'caller',targetId:'callee',evidenceIds:['call-e'],premiseFactIds:['premise']}},
      {id:'premise',versionId,record:{subjectId:'callee',evidenceIds:['condition-e'],premiseFactIds:[]}}],
    objects:[{objectId:'caller',versionId,materialId:'m-call',anchor:{kind:'TEXT',lineStart:1,lineEnd:1}},
      {objectId:'callee',versionId,materialId:'m-target',anchor:{kind:'TEXT',lineStart:1,lineEnd:1}}],
    evidence:[{evidenceId:'call-e',versionId,materialId:'m-call',anchor:{kind:'TEXT',lineStart:1,lineEnd:1}},
      {evidenceId:'condition-e',versionId,materialId:'m-condition',anchor:{kind:'TEXT',lineStart:1,lineEnd:1}}],
    materials:['call','target','condition'].map(id=>({materialId:`m-${id}`,versionId,sourceMaterial:sourceMaterial(id)}))};
}

test('QA recursively closes adopted technical premises to real F001 raw anchors instead of Fact summaries and short graph quotes',()=>{
  const t=technicalFixture(),resolver=questionPremiseResolver([node('rule',[cite('business')],{technicalRefs:['call']})],[],t);
  const p=questionOriginalContext([item('answer','rule')],[{id:'business',text:'ANCHOR'},{id:'call',text:'CALL RAW'},
    {id:'target',text:'FUNCTION RAW'},{id:'condition',text:'ONLY_UNPAID TECHNICAL PREMISE'}],resolver);
  assert.ok(visible(p,'ONLY_UNPAID TECHNICAL PREMISE'));assert.ok(visible(p,'FUNCTION RAW'));
  assert.deepEqual(p.evidenceContext.premises[0].technicalDependencies,[{versionId:'adopted',factId:'call'},{versionId:'adopted',factId:'premise'}]);
  assert.deepEqual(p.evidenceContext.missingEvidence,[]);
});

test('QA cannot substitute a different technical version, missing raw premise or cycle with a summary/quote',()=>{
  for(const mutate of [t=>t.evidence.splice(1,1),t=>{t.evidence[1].versionId='not-adopted';},
    t=>{t.materials[2].sourceMaterial.bundleId='different-bundle';},t=>{t.records[1].record.premiseFactIds=['call'];}]) {
    const t=technicalFixture();mutate(t);
    const resolver=questionPremiseResolver([node('rule',[cite('business')],{technicalRefs:['call']})],[],t);
    const p=questionOriginalContext([item('answer','rule')],[{id:'business',text:'ANCHOR'}],resolver);
    assert.ok(p.evidenceContext.missingEvidence.some(m=>m.key==='answer'));assert.equal(p.materials.length,0);
  }
});

test('QA complete long-line windows and whole-material technical projections are atomic under the unchanged 64KiB raw budget',()=>{
  const resolver=questionPremiseResolver([node('large',[cite('a'),cite('long')]),node('small',[cite('small')])],[],empty);
  const p=questionOriginalContext([item('large-answer','large'),item('small-answer','small')],
    [{id:'a',text:'harmless ANCHOR'},{id:'long',text:'CONDITION '+'.'.repeat(70000)+' ANCHOR'},{id:'small',text:'SMALL ANCHOR'}],resolver);
  assert.deepEqual(p.evidenceContext.missingEvidence,[{key:'large-answer',reason:'ORIGINAL_CONTEXT_BYTE_BUDGET'}]);
  assert.equal(visible(p,'harmless'),false);assert.equal(visible(p,'SMALL'),true);assert.ok(p.evidenceContext.suppliedBytes<=65536);
  const t=technicalFixture();t.evidence[1].anchor={kind:'JSON_POINTER',pointer:'/condition'};
  const tech=questionPremiseResolver([node('rule',[cite('business')],{technicalRefs:['call']})],[],t);
  const body=[{id:'business',text:'ANCHOR'},{id:'call',text:'call'},{id:'target',text:'target'},{id:'condition',text:'whole\nJSON RAW'}];
  assert.ok(visible(questionOriginalContext([item('a','rule')],body,tech),'JSON RAW'));
  body[3].text='.'.repeat(70000);assert.equal(questionOriginalContext([item('a','rule')],body,tech).materials.length,0);
});

test('QA missing or conflicted endpoint is unknown, never a direction-reversing fallback or unrelated-source lookup',()=>{
  const edge=node('edge',[cite('edge')],{sourceKey:'left',targetKey:'right',predicate:'INVOKES'});
  for(const endpoints of [[node('left',[cite('a')])],[node('left',[cite('a')]),node('right',[cite('b')],{state:'HUMAN_REVIEW'})],
    [node('left',[cite('a')]),node('right',[cite('b')],{verification:{unresolvedConflicts:['condition disputed']}})]]) {
    const r=questionPremiseResolver([edge],endpoints,empty),p=questionOriginalContext([item('s','edge')],[],r);
    assert.equal(p.materials.length,0);assert.ok(p.evidenceContext.missingEvidence.length);
  }
});

test('QA whole model-envelope budget retains atomic premise closures and isolates giant/invalid drafts without raising the bound',()=>{
  const resolver=questionPremiseResolver([node('rule',[cite('a'),cite('b')])],[],empty);
  const material=[{id:'a',text:'ALLOW ANCHOR'},{id:'b',text:'ONLY_UNPAID ANCHOR'}];
  const good={...item('good','rule'),text:'bounded'},giant={...item('giant','rule'),text:'.'.repeat(10000)},bad={...item('bad','foreign'),text:'.'.repeat(10000)};
  const drafts=[{taskKey:'child',segments:[bad,giant,good],unknowns:['An explicit unresolved boundary must reach Main.']}];
  const packet=boundedQuestionVerification({operation:'VERIFY'},drafts,material,resolver,s=>s.key!=='bad',2500);
  assert.deepEqual(packet.input.drafts[0].segments.map(s=>s.key),['good']);
  assert.deepEqual(packet.input.drafts[0].unknowns,drafts[0].unknowns);
  assert.ok(visible(packet.input,'ONLY_UNPAID'));assert.equal(packet.omitted.length,2);assert.ok(Buffer.byteLength(JSON.stringify(packet.input))<=2500);
  const blocked=boundedQuestionVerification({metadata:'.'.repeat(3000)},drafts,material,resolver,s=>s.key!=='bad',2500);
  assert.equal(blocked.input,null);assert.equal(blocked.omitted.length,3);
});
