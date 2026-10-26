import test from 'node:test';
import assert from 'node:assert/strict';
import {renderComponent} from './support/render-components.mjs';
import {businessSevenQuestions} from '../../src/business-knowledge/queries.js';
const {SevenAnswers}=await import('../app/business-knowledge/trace-panel.tsx');
const {PublishedSevenAnswers}=await import('../app/business-knowledge/published-seven.tsx');
const {GraphView}=await import('../app/business-knowledge/graph-view.tsx');
const meaning='TRANSPORT_COVERAGE_NOT_SEMANTIC_COMPLETENESS';
const directory={key:'directory',kind:'DIRECTORY',path:'synthetic-dir',materialId:null,componentId:'component',disposition:'METADATA',reasonCode:'DIRECTORY_RECORDED',
 sourceReadStatus:'UNREAD',businessStatus:'UNASSOCIATED',modelInput:{status:'NOT_SUPPLIED',meaning,suppliedByteRanges:[],pendingByteRanges:[]}};
const file={...directory,key:'file',kind:'FILE',path:'synthetic-dir/todo.txt',materialId:'unread-file',disposition:'VERIFIED',reasonCode:'CONTENT_VERIFIED'};
const base={id:'synthetic-graph',digest:'a'.repeat(64),investigationId:'synthetic-run',sourceBundleId:'b'.repeat(64),profileId:'synthetic-profile',
 adoptedVersionIds:[],published:false,materials:[],relations:[],candidates:[{key:'business',kind:'FUNCTION',name:'Synthetic local function',statement:'Synthetic local statement',
 scope:'Fixture only',state:'ANALYSIS_ACCEPTED',authority:'AGENT_ANALYSIS',evidence:[],uncertainties:[],technicalRefs:[],verification:{premises:[]}}]};
function seven(coverage,Component){
 const graph={...base,coverage},before=structuredClone(graph),answer=businessSevenQuestions(graph,'business'),answerBefore=structuredClone(answer);
 const html=renderComponent(Component,{answer,onMaterial(){},onSelect(){}});
 assert.deepEqual(graph,before);assert.deepEqual(answer,answerBefore);
 assert.deepEqual(answer.sections.at(-1).unassociatedMaterials,coverage.filter(p=>p.businessStatus==='UNASSOCIATED'));
 return html;
}
const coverage=entries=>renderComponent(GraphView,{graph:{view:'COVERAGE',nodes:[],edges:[],materials:[],coverage:entries,
 adoptedVersionIds:[],uncertaintyCount:0,graphDigest:'fixed',sourceBundleId:'source',profileId:'profile'},selectedKey:'',onSelect(){},onMaterial(){}});
function notice(html){return html.match(/<p[^>]*>[^<]*未关联文件[^<]*<\/p>/)?.[0];}
for(const [mode,Component]of [['private',SevenAnswers],['published',PublishedSevenAnswers]]){
 test(`${mode} seven questions distinguish pending files, directories and unknown kinds without changing the ledger`,()=>{
  const entries=[directory,file,{...file,key:'zero',path:'empty.txt',sizeBytes:0,materialId:null},{...directory,key:'legacy',kind:undefined},
   {...directory,key:'future',kind:'FUTURE_KIND'},{...file,key:'associated',businessStatus:'ASSOCIATED'}];
  const html=seven(entries,Component);
  assert.match(html,/未关联文件原文材料：2份/);assert.match(html,/目录元数据：1条/);assert.match(html,/未分类条目：2条/);
  assert.doesNotMatch(html,/5份未关联材料/);assert.match(html,/不能据此声称完整理解/);
 });
 test(`${mode} directory-only summary never calls metadata a pending original file`,()=>{
  const html=seven([directory],Component);assert.match(html,/目录元数据：1条/);assert.match(html,/无文件正文/);
  assert.doesNotMatch(html,/未关联文件原文材料：/);
 });
 test(`${mode} zero-byte FILE with no material id still counts as a file; empty scope never claims completeness`,()=>{
  assert.match(seven([{...file,sizeBytes:0,materialId:null}],Component),/未关联文件原文材料：1份/);
  const html=seven([],Component);assert.doesNotMatch(html,/未关联文件原文材料：|目录元数据：|完整理解已完成|全部理解完成/);
 });
}
test('private and published summaries use exactly the same derived wording',()=>{
 const entries=[directory,file,{...directory,key:'legacy',kind:undefined}];
 const a=notice(seven(entries,SevenAnswers)),b=notice(seven(entries,PublishedSevenAnswers));
 assert.ok(a);assert.equal(a,b);
});
test('directory coverage row has no body-read or model-byte obligation and every original entry remains untouched',()=>{
 const entries=[structuredClone(directory)],before=structuredClone(entries),html=coverage(entries);
 assert.match(html,/目录元数据/);assert.match(html,/不适用.*无文件正文/s);
 assert.doesNotMatch(html,/尚未读取原文|未传输给模型|查询已读原文/);
 assert.match(html,/DIRECTORY_RECORDED/);assert.match(html,/尚未关联/);assert.deepEqual(entries,before);
});
test('files retain unread, partial-byte, zero-byte and unknown ledger states independently of association',()=>{
 const entries=[file,{...file,key:'partial',sourceReadStatus:'READ',businessStatus:'ASSOCIATED',modelInput:{status:'PARTIALLY_SUPPLIED',meaning,suppliedByteRanges:[[0,2]],pendingByteRanges:[[2,10]]}},
  {...file,key:'zero',sizeBytes:0,materialId:null,modelInput:{status:'FULLY_SUPPLIED',meaning,suppliedByteRanges:[[0,0]],pendingByteRanges:[]}},
  {...file,key:'legacy',kind:undefined,sourceReadStatus:undefined,modelInput:undefined},{...file,key:'future',kind:'FUTURE_KIND'}];
 const before=structuredClone(entries),html=coverage(entries);
 assert.match(html,/尚未读取原文/);assert.match(html,/未传输给模型/);assert.match(html,/部分字节已传输/);assert.match(html,/\[2, 10\)/);
 assert.match(html,/全部字节已传输/);assert.match(html,/\[0, 0\)/);assert.match(html,/读取情况未知/);assert.match(html,/旧图谱未记录模型片段/);
 assert.match(html,/类型未分类/);assert.equal((html.match(/<tbody>.*?<\/tbody>/s)?.[0].match(/<tr>/g)??[]).length,entries.length);
 assert.deepEqual(entries,before);
});
test('published execution history remains ordered and separate from the directory projection',()=>{
 const answer=businessSevenQuestions({...base,coverage:[directory,file]},'business');
 answer.sections[4]={...answer.sections[4],executionStatus:'FAIL',executionTargets:[{objectKey:'business',claimId:'claim',scopeId:'scope',testSpecId:'test',testSpecVersion:2,
  status:'FAIL',mappingCurrent:false,authorityApplies:false,ordering:'SERVER_RECEIPT_TIME',snapshotManifestId:'fixed-snapshot',deploymentId:'fixed-environment',
  history:[{id:'later-failure',status:'FAIL',trusted:true,receivedAt:'later'},{id:'earlier-pass',status:'PASS',trusted:true,receivedAt:'earlier'}]}]};
 const before=structuredClone(answer),html=renderComponent(PublishedSevenAnswers,{answer,onSelect(){},onMaterial(){}});
 assert.match(html,/当前执行：失败/);assert.match(html,/映射已失效/);assert.match(html,/未据此建立人类认可/);
 assert.ok(html.indexOf('later-failure')<html.indexOf('earlier-pass'));assert.match(html,/目录元数据：1条/);
 assert.deepEqual(answer,before);
});
