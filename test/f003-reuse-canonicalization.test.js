import test from 'node:test';
import assert from 'node:assert/strict';
import {consolidateProposals} from '../src/business-knowledge/proposals.js';
const candidate=(key,reuse=null)=>({key,proposalCollection:'CANDIDATE',kind:'RULE',name:'conditional rule',statement:'A exact old condition',
  scope:'local branch only',dependencyScope:null,evidence:[],technicalRefs:[],uncertainties:[],originRefs:[key],
  provenance:{reservationId:key},identityIssues:[],consolidationIssues:[],reuse});
const proof={reuseProofDigest:'a'.repeat(64),sourceGraphDigest:'b'.repeat(64)};
const merge=change=>consolidateProposals({candidates:[candidate('old',proof),candidate('fresh')],relations:[],originalProposals:[],
  mergeSuggestions:[{keys:['old','fresh'],rationale:'explicit Main candidate merge',...change}]}).candidates[0];
test('exact source agreement cannot retain A reuse when Main supplies different canonical semantics',()=>{
  for(const change of [{statement:'different current condition'},{name:'a different business identity'},{scope:'a broader runtime scope'}]) {
    const p=merge({mergedProposal:{kind:'RULE',name:'conditional rule',statement:'A exact old condition',scope:'local branch only',...change}});
    assert.equal(p.reuse,null,JSON.stringify(change));assert.ok(p.provenance.consolidationGroupId);
  }
});
test('an actually unchanged canonical semantic projection retains the original A proof and mapping',()=>{
  const p=merge({});assert.deepEqual(p.reuse,proof);assert.deepEqual(p.originRefs,['fresh','old']);
});
test('a changed canonical directed predicate or relation condition cannot inherit its old A proof',()=>{
  for(const change of [{predicate:'PREVENTS'},{scope:'a different condition'}]) {
    const relation=key=>({...candidate(key,key==='old'?proof:null),proposalCollection:'RELATION',sourceKey:'from',targetKey:'to',predicate:'REQUIRES'});
    const result=consolidateProposals({candidates:[],relations:[relation('old'),relation('fresh')],originalProposals:[],
      mergeSuggestions:[{keys:['old','fresh'],rationale:'explicit current relation semantics',
        mergedProposal:{sourceKey:'from',targetKey:'to',predicate:'REQUIRES',scope:'local branch only',...change}}]});
    assert.equal(result.relations.length,1);assert.equal(result.relations[0].reuse,null);
  }
});
