import test from 'node:test';
import assert from 'node:assert/strict';
import {renderComponent} from './support/render-components.mjs';
import {businessSevenQuestions} from '../../src/business-knowledge/queries.js';
import {associationGraph} from '../../test/support/f003-seven-association-fixture.js';
const {SevenAnswers}=await import('../app/business-knowledge/trace-panel.tsx');
const {PublishedSevenAnswers}=await import('../app/business-knowledge/published-seven.tsx');
const props=answer=>({answer,onMaterial(){},onSelect(){}});
const q5=html=>html.match(/<section class="bk-answer"><h4>5\.[\s\S]*?<\/section>/)?.[0];

for(const [mode,Component]of [['private',SevenAnswers],['published',PublishedSevenAnswers]]){
 test(`${mode} Q5 cannot display a CODE check as a test and explains an unestablished association`,()=>{
  const graph=associationGraph(),answer=businessSevenQuestions(graph,'selected'),before=structuredClone(answer);
  const html=renderComponent(Component,props(answer)),section=q5(html);
  assert.ok(section);assert.doesNotMatch(section,/CHECKS_ACCESS/);
  assert.match(section,/本视图尚未建立测试与规则关联/);assert.match(section,/不据此推断系统没有测试/);
  assert.match(html,/CHECKS_ACCESS/,'general implementation relationship is retained');
  assert.deepEqual(answer,before);
 });
 test(`${mode} Q5 retains a real static test association without inventing execution success`,()=>{
  const answer=businessSevenQuestions(associationGraph({edgeMaterials:['test'],predicate:'CHECKS_RULE'}),'selected');
  const section=q5(renderComponent(Component,props(answer)));
  assert.match(section,/CHECKS_RULE/);assert.doesNotMatch(section,/本视图尚未建立测试与规则关联/);
  assert.doesNotMatch(section,/当前执行：通过/);
 });
}
test('published explicit trusted execution remains visible even with no source-analysis test association',()=>{
 const answer=businessSevenQuestions(associationGraph(),'selected');
 answer.sections[4]={...answer.sections[4],executionStatus:'FAIL',executionTargets:[{objectKey:'selected',claimId:'claim',scopeId:'scope',testSpecId:'explicit-test',testSpecVersion:1,
  status:'FAIL',mappingCurrent:true,authorityApplies:false,ordering:'SERVER_RECEIPT_TIME',snapshotManifestId:'snapshot',deploymentId:'environment',
  history:[{id:'later-failure',status:'FAIL',trusted:true,receivedAt:'later'},{id:'earlier-pass',status:'PASS',trusted:true,receivedAt:'earlier'}]}]};
 const before=structuredClone(answer),section=q5(renderComponent(PublishedSevenAnswers,props(answer)));
 assert.match(section,/本视图尚未建立测试与规则关联/);assert.match(section,/当前执行：失败/);
 assert.match(section,/explicit-test/);assert.ok(section.indexOf('later-failure')<section.indexOf('earlier-pass'));
 assert.deepEqual(answer,before);
});
