import test from 'node:test';
import assert from 'node:assert/strict';
import {qualityContractFixture} from './support/f003-quality-contract-fixture.js';
import {publicationDigest} from '../src/business-knowledge/publication-authority.js';
import * as adapter from '../src/business-knowledge/quality-contract-adapter.js';
const ledger=q=>{q.artifacts.attemptLedgerDigest=publicationDigest(q.attempts);};
test('F003 quality comparisons retain the same question and complete investigation/supplement budget rules',()=>{
  for(const mutate of [b=>{b.questionDigest=publicationDigest('another easier question');},
    b=>{b.budget={...b.budget,maxModelCalls:1000};},b=>{b.budget={...b.budget,maxReadBytes:1073741824};},
    b=>{b.supplementBudget={...b.supplementBudget,maximumAttempts:1000};}]) {
    const f=qualityContractFixture(),q=structuredClone(f.quality);assert.deepEqual(f.assess(),[]);
    const b=q.attempts[0].rightBinding;mutate(b);
    if(adapter.comparisonContractDigest)b.runContractDigest=adapter.comparisonContractDigest(b);
    ledger(q);assert.ok(f.assess(q).some(r=>r.code==='F003_QUALITY_COMPARISON_BINDING_MISMATCH'));
  }
});
test('F003 incomplete or malformed signed comparison objects are typed denials for all required shapes',()=>{
  for(const mutate of [b=>({investigationId:b.investigationId,graphDigest:b.graphDigest}),
    ...['workspaceId','sourceInput','investigationScope','sourceManifest','adoptedVersionIds','technicalVersions',
      'profileId','modelRevisionIds','implementationVersion','questionDigest','budget','supplementBudget','admittedAt','runContractDigest']
      .map(k=>b=>{delete b[k];return b;}),
    b=>({...b,sourceInput:[]}),b=>({...b,modelRevisionIds:'not-an-array'}),b=>({...b,technicalVersions:[null]}),
    b=>({...b,implementationVersion:[]}),b=>({...b,budget:{maxModelCalls:'12'}}),
    b=>{delete b.sourceInput.receiptId;return b;},b=>{delete b.sourceInput.components[0].manifestId;return b;},
    b=>{b.sourceManifest.components=[null];return b;},b=>{b.budget.deadline='not-a-date';return b;}]) {
    const f=qualityContractFixture(),q=structuredClone(f.quality);
    q.attempts[0].leftBinding=mutate(q.attempts[0].leftBinding);ledger(q);
    let reasons;assert.doesNotThrow(()=>{reasons=f.assess(q);});
    assert.ok(reasons.some(r=>r.code==='F003_QUALITY_COMPARISON_BINDING_MISMATCH'));
  }
});
test('F003 independent wall-clock starts may differ only when the recorded relative budget rules and preregistered contract agree',()=>{
  const f=qualityContractFixture(),q=structuredClone(f.quality),other=q.attempts[0].rightBinding;
  const shift=s=>new Date(Date.parse(s)+86400000).toISOString();
  other.admittedAt=shift(other.admittedAt);other.budget.deadline=shift(other.budget.deadline);
  other.supplementBudget.deadline=shift(other.supplementBudget.deadline);
  other.runContractDigest=adapter.comparisonContractDigest(other);ledger(q);
  assert.equal(other.runContractDigest,f.binding.runContractDigest);assert.deepEqual(f.assess(q),[]);
  other.budget.deadline=new Date(Date.parse(other.budget.deadline)+1).toISOString();
  other.runContractDigest=adapter.comparisonContractDigest(other);ledger(q);
  assert.ok(f.assess(q).some(r=>r.code==='F003_QUALITY_COMPARISON_BINDING_MISMATCH'));
  const unregistered=qualityContractFixture();unregistered.policy.scope.registeredAttempts[0].conditionsDigest='0'.repeat(64);
  assert.ok(unregistered.assess().some(r=>r.code==='F003_QUALITY_COMPARISON_BINDING_MISMATCH'));
});
