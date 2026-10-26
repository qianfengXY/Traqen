import assert from 'node:assert/strict';
import test from 'node:test';
import {renderComponent} from './support/render-components.mjs';
const {AuthorityStatus}=await import('../app/business-knowledge/authority-status.tsx');
const base={bindingSet:{version:1,rationale:'explicit source comparison',targets:[{}]},currentBindingVersion:2,projection:{analysisState:'ANALYSIS_ACCEPTED',evaluatedAt:'fixed-time',targets:[{
 claimId:'claim-1',claimVersion:1,featureId:'feature-1',featureVersion:1,scopeId:'scope-1',scopeVersion:1,scope:{condition:'unpaid'},
 authority:{status:'CONFIRMED',scopeActive:false,versionCurrent:false,applies:false,historyTruncated:false,history:[{id:'decision-1',type:'CONFIRMED',content:'approved unpaid only',actorId:'approver',actorRole:'business-owner',createdAt:'before',validUntil:'expired'}],latestDecision:{type:'CONFIRMED',validUntil:'expired'}},
 verification:[{testSpecId:'test-1',testSpecVersion:2,snapshotManifestId:'snapshot',deploymentId:'deployment',testSpecApproved:true,ordering:'SERVER_RECEIPT_TIME',status:'FAIL',truncated:false,history:[{id:'later',status:'FAIL',receivedAt:'later',trusted:true,evidenceRefs:['failed-evidence']},{id:'old',status:'PASS',receivedAt:'old',trusted:true,evidenceRefs:['old-evidence']}]}]
}]}};
test('analysis, human authority applicability/expiry/history and latest trusted failure are independent',()=>{
 const html=renderComponent(AuthorityStatus,{value:base});
 assert.match(html,/ANALYSIS_ACCEPTED/);assert.match(html,/人类已确认/);assert.match(html,/范围已失效/);assert.match(html,/已不是当前版本/);assert.match(html,/决定不适用于此绑定/);
 assert.match(html,/当前执行状态：失败/);assert.match(html,/old-evidence/);assert.match(html,/failed-evidence/);assert.match(html,/正在查看历史映射/);assert.match(html,/到期不改写原决定/);
 assert.doesNotMatch(html,/批准此|确认通过|运行测试|一键确认/);
});
test('unmapped and no selected execution target do not become model-approved execution success',()=>{
 const html=renderComponent(AuthorityStatus,{value:{...base,bindingSet:null,projection:{...base.projection,targets:[]}}});
 assert.match(html,/尚无显式权威映射/);assert.doesNotMatch(html,/当前执行状态：通过/);
 const noTarget=structuredClone(base);noTarget.projection.targets[0].verification=[];
 assert.match(renderComponent(AuthorityStatus,{value:noTarget}),/未选择固定执行目标/);
});
test('NOT_RUN, UNKNOWN and expired authority remain visible without reviving old PASS',()=>{
 for(const status of ['NOT_RUN','UNKNOWN']){
  const value=structuredClone(base),target=value.projection.targets[0];target.authority.status='DEPRECATED';target.verification[0].status=status;
  if(status==='NOT_RUN')target.verification[0].history=[];
  const html=renderComponent(AuthorityStatus,{value});assert.match(html,/已失效或到期/);assert.match(html,status==='NOT_RUN'?/当前执行状态：未运行/:/当前执行状态：可信依据未知/);
 }
});
