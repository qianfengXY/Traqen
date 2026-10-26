import test from 'node:test';
import assert from 'node:assert/strict';
import {dependencyIndex} from '../src/business-knowledge/dependency-review.js';
const input=n=>{
  let reads=0;const versionId='v',inventory=[{materialId:'raw',componentId:'component',pathBytes:'eA',contentDigest:'sha',sourceId:'source'}];
  const rows=[{kind:'MATERIAL',id:'m',versionId,payload:{componentId:'component',pathBytes:'eA',contentDigest:'sha'}},
    {kind:'OBJECT',id:'o',versionId,payload:{materialId:'m'}}];
  for(let i=0;i<n;i++)rows.push({kind:'FACT',id:'f'+i,versionId,payload:new Proxy({subjectId:'o',predicate:'derived',
    premiseFactIds:i<2?[]:['f'+(i-1),'f'+(i-2)]},{get(t,k,r){if(k==='premiseFactIds')reads++;return Reflect.get(t,k,r);}})});
  return {rows,profiles:[],inventory,bundleId:'bundle',workspaceId:'workspace',reads:()=>reads};
};
test('shared acyclic premise DAG has one equivalent material closure and bounded observable expansion work',()=>{
  for(const n of [12,20,28,100]) {
    const data=input(n),index=dependencyIndex(data);
    assert.equal(index.status,'AVAILABLE');
    assert.deepEqual(index.dependencies(data.rows.at(-1)),['raw']);
    assert.ok(data.reads()<n*6+20,`shared premises must be solved once, n=${n},reads=${data.reads()}`);
    console.log(JSON.stringify({kind:'SHARED_DAG_EXPANSION_ORACLE',n,reads:data.reads(),uniqueClosure:['raw']}));
  }
});
test('true cycle, missing premise and over-deep chain cannot acquire an empty available closure through memoization',()=>{
  for(const mode of ['cycle','missing','depth']) {
    const data=input(3);
    data.rows=data.rows.map(r=>({...r,payload:{...r.payload}}));
    if(mode==='cycle')data.rows.at(-3).payload.premiseFactIds=['f2'];
    if(mode==='missing')data.rows.at(-1).payload.premiseFactIds=['absent'];
    if(mode==='depth')for(let i=3;i<140;i++)data.rows.push({kind:'FACT',id:'f'+i,versionId:'v',payload:{subjectId:'o',premiseFactIds:['f'+(i-1)]}});
    const index=dependencyIndex(data);assert.equal(index.status,'INCOMPLETE',mode);
    assert.throws(()=>index.dependencies(data.rows.at(-1)),undefined,mode);
  }
});
test('exhausted global traversal and closure-output budgets are honest incomplete states, never zero dependencies',()=>{
  for(const limits of [{maxDependencyWork:2},{maxDependencyClosureItems:2}]) {
    const data=input(8),index=dependencyIndex({...data,...limits});
    assert.equal(index.status,'INCOMPLETE');
    assert.throws(()=>index.dependencies(data.rows.at(-1)));
  }
});

test('general shared DAG closure matches an independent unique-material traversal, including joins across distinct assets',()=>{
  const data=input(12);data.rows=data.rows.map(r=>({...r,payload:{...r.payload}}));
  data.inventory.push({...data.inventory[0],materialId:'second',pathBytes:'eQ',contentDigest:'other'});
  data.rows.push({versionId:'v',kind:'MATERIAL',id:'m2',payload:{componentId:'component',pathBytes:'eQ',contentDigest:'other'}},
    {versionId:'v',kind:'OBJECT',id:'o2',payload:{materialId:'m2'}});
  for(const [n,r]of data.rows.filter(r=>r.kind==='FACT').entries())if(n%3===0)r.payload.subjectId='o2';
  const byId=new Map(data.rows.map(r=>[r.id,r]));
  const unique=(r,seen=new Set())=>{
    if(seen.has(r.id))return [];seen.add(r.id);
    if(r.kind==='MATERIAL')return [r.id==='m'?'raw':'second'];
    const ids=r.kind==='FACT'?[r.payload.subjectId,...r.payload.premiseFactIds]:[r.payload.materialId];
    return [...new Set(ids.flatMap(id=>unique(byId.get(id),seen)))].sort();
  };
  const index=dependencyIndex(data);
  for(const r of data.rows)assert.deepEqual(index.dependencies(r),unique(r));
  assert.equal(index.status,'AVAILABLE');
});
