import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalEncode} from '../../src/source-truth/identity.js';
import {investigationKind} from '../../web/app/business-knowledge/investigation-kind.ts';
import {renderComponent} from '../../web/tests/support/render-components.mjs';
const {InvestigationReadResult}=await import('../../web/app/business-knowledge/investigation-detail.tsx');

// The caller supplies a genuine owning-service DTO, never a hand-built basis.
export function assertIncrementalWebContract(run) {
  const render=value=>renderComponent(InvestigationReadResult,{run:value,client:{workspaceId:run.workspaceId},apiBase:'/unused',
    view:'BUSINESS',objectKey:'',onAccessLost:()=>{},onRefresh:()=>{},onChanged:()=>{}});
  assert.equal(investigationKind(run).kind,'BUSINESS');
  const html=render(run);
  assert.ok(html.includes('调查状态与版本'));assert.ok(html.includes('技术补证与明确采用'));
  assert.ok(!html.includes('运行类型未识别'));
  if(run.latestGraph)assert.ok(html.includes('业务关系')&&html.includes('材料覆盖'));
  const rehash=r=>{const {digest,...body}=r.continuationBasis;
    r.continuationBasis.digest=createHash('sha256').update(canonicalEncode(body)).digest('hex');};
  const changes=[
    r=>delete r.continuationBasis,
    r=>{r.continuationBasis.digest='0'.repeat(64);},
    r=>{delete r.continuationBasis.a;rehash(r);},
    r=>{r.continuationBasis.workspaceId='another';rehash(r);},
    r=>{r.continuationBasis.actorId='another';rehash(r);},
    r=>{r.continuationBasis.b.sourceInput.receiptId='other';rehash(r);},
    r=>{r.continuationBasis.a.sourceInput.workspaceId='another';rehash(r);},
    r=>{r.continuationBasis.b.scope.componentIds=[];rehash(r);},
    r=>{r.continuationBasis.source.graphDigest='0'.repeat(64);rehash(r);},
    r=>{r.continuationBasis.b.question='a different question';rehash(r);},
    r=>{r.continuationBasis.b.budget.maxModelCalls++;rehash(r);},
    r=>{r.continuationBasis.b.profile.id='different';rehash(r);},
    r=>{r.questionContext={sessionId:'fake'};},
    r=>{r.purpose='FUTURE_ANALYSIS';},r=>{delete r.purpose;},r=>{r.analysisContractVersion=11;}
  ];
  for(const [n,mutate] of changes.entries()) {
    const bad=structuredClone(run);mutate(bad);
    assert.equal(investigationKind(bad).kind,'UNKNOWN','consumer malformed binding '+n);
    const denied=render(bad);assert.ok(denied.includes('运行类型未识别'));
    assert.ok(!denied.includes('技术补证与明确采用')&&!denied.includes('业务关系'));
  }
  const question={...run,purpose:'GRAPH_QUESTION',questionContext:undefined};
  assert.equal(investigationKind(question).kind,'QUESTION');assert.ok(!render(question).includes('技术补证与明确采用'));
  console.log(JSON.stringify({kind:'ACTUAL_SERVICE_INCREMENTAL_WEB_CONSUMER',purpose:run.purpose,malformedCases:changes.length,
    rendering:'actual TSX business/detail gate',noBrowserWrites:true}));
}
