import assert from "node:assert/strict";
import test from "node:test";
import {setTimeout as delay} from "node:timers/promises";
import {isolatedPostgres} from "./support/source-truth-postgres.js";
import {webAuthorityFixture} from "./support/f003-web-authority-fixture.js";

test("Web fixture uses real F008/F006/frozen materials and governed HTTP for default blocking, exact mapping, decisions and trusted later failures",{timeout:90000},async t=>{
  const cluster=process.env.F001_TEST_PG_BIN?await isolatedPostgres(t):null;
  const f=await webAuthorityFixture(t,{database:cluster?()=>cluster.createDatabase():undefined});
  f.model.release();await f.runtime.knowledge.start();
  const deadline=new Date(Date.now()+120000).toISOString();
  const run=(await f.post("owner",`${f.base}/investigations`,{operationId:"synthetic-web-authority",question:"synthetic order rule",reference:f.reference,expectedProfileId:f.profile.id,technicalVersionId:null,
    scope:{componentIds:[f.componentId]},budget:{maxReadBytes:20000,maxModelCalls:12,deadline},supplementBudget:{maxMaterials:10,maxBytes:20000,maxRuleApplications:100,maximumAttempts:2,deadline}})).investigation;
  let current;
  for(let attempt=0;attempt<200;attempt++){current=(await f.request("owner",`${f.base}/investigations/${run.id}`)).body.investigation;if(["COMPLETED","FAILED"].includes(current.state))break;await delay(50);}
  assert.equal(current.state,"COMPLETED",JSON.stringify(current));
  const graph=(await f.request("owner",`${f.base}/investigations/${run.id}/graph?view=COVERAGE`)).body.graph;
  assert.ok(graph.coverage.some(m=>m.sourceReadStatus==="READ"&&m.modelInput.status==="FULLY_SUPPLIED"));
  assert.ok(graph.coverage.some(m=>m.sourceReadStatus==="UNREAD"&&m.modelInput.status==="NOT_SUPPLIED"));
  const blocked=(await f.request("owner",`${f.base}/investigations/${run.id}/publication-readiness`)).body.readiness;
  assert.equal(blocked.canPublish,false);assert.ok(blocked.missing.some(m=>m.code==="F003_QUALITY_POLICY_UNCONFIRMED"));
  const published=await f.publishMechanism(run.id),revision=published.publication.graphRevisionId;
  assert.equal((await f.request("owner",`${f.base}/investigations/${run.id}/publication-readiness`)).body.readiness.canPublish,false,"mechanism injection is removed; default remains blocked");
  const authority=await f.prepareAuthority(),key=graph.nodes[0].key,route=`${f.base}/versions/${revision}/authority-bindings`;
  const input={operationId:"web-authority-map",expectedGraphDigest:graph.graphDigest,objectKey:key,expectedVersion:0,rationale:"mechanism only",targets:[authority.target]};
  await f.post("owner",route,input);
  const project=async()=>{const result=await f.request("owner",`${route}?objectKey=${encodeURIComponent(key)}`);assert.equal(result.status,200,JSON.stringify(result));return result.body;};
  assert.equal((await project()).projection.targets[0].verification[0].status,"NOT_RUN");
  await authority.decide();await authority.ingest("PASS");await authority.ingest("FAIL");
  const result=await project(),target=result.projection.targets[0];
  assert.equal(target.authority.status,"CONFIRMED");assert.equal(target.authority.applies,true);
  assert.equal(target.verification[0].status,"FAIL");assert.deepEqual(target.verification[0].history.map(r=>r.status),["FAIL","PASS"]);
  await authority.upgrade();assert.equal((await project()).projection.targets[0].authority.versionCurrent,false);
  await f.revoke();assert.equal((await f.request("owner",`${route}?objectKey=${encodeURIComponent(key)}`)).status,403);
});
