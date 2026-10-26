import assert from "node:assert/strict";
import test from "node:test";
import {knowledgeServerFixture,syntheticPassword} from "./support/f002-f003-server-fixture.js";
import {businessUiModelResponse} from "./support/f003-business-ui-model.js";

test("the browser fixture persists traceable nonempty business analysis through the real F008/F001/F006 HTTP assembly", {timeout:60000}, async t => {
  const f=await knowledgeServerFixture(t,{modelResponse:businessUiModelResponse});
  f.model.release(); await f.runtime.knowledge.start();
  const origin=f.runtime.origin, pre=await fetch(origin+"/v1/auth/csrf"), proof=await pre.json();
  const login=await fetch(origin+"/v1/auth/login",{method:"POST",headers:{origin,"content-type":"application/json","x-traqen-csrf":proof.csrfToken,
    cookie:pre.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ")},body:JSON.stringify({login:"owner",password:syntheticPassword})});
  const session=await login.json(); assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
  const base=origin+"/v1/workspaces/workspace/business-knowledge/investigations";
  const accepted=await fetch(base,{method:"POST",headers:{origin,cookie,"content-type":"application/json","x-traqen-csrf":session.csrfToken},body:JSON.stringify({
    operationId:"ui-fixture-real-start",reference:f.reference,expectedProfileId:f.profile.id,question:"固定示例怎样返回订单状态？",technicalVersionId:null,
    scope:{componentIds:[f.componentId]},budget:{maxReadBytes:65536,maxModelCalls:12,deadline:"2099-01-01T00:00:00Z"},
    supplementBudget:{maxMaterials:10,maxBytes:65536,maxRuleApplications:100,maximumAttempts:10,deadline:"2099-01-01T00:00:00Z"}})});
  const body=await accepted.json(); assert.equal(accepted.status,202,JSON.stringify(body));
  const id=body.investigation.id; let run;
  for(let i=0;i<200;i++) {run=(await (await fetch(base+"/"+id,{headers:{cookie,origin}})).json()).investigation;
    if(["COMPLETED","FAILED"].includes(run.state))break; await new Promise(resolve=>setTimeout(resolve,25));}
  assert.equal(run.state,"COMPLETED",JSON.stringify(run));
  const {graph}=await(await fetch(base+"/"+id+"/graph",{headers:{cookie,origin}})).json();
  assert.equal(graph.nodes.length,2); assert.equal(graph.edges.length,1);
  const {trace}=await(await fetch(base+"/"+id+"/trace?key="+graph.nodes[0].key,{headers:{cookie,origin}})).json();
  assert.ok(trace.materials.length); assert.equal(graph.published,false);
  assert.equal(f.model.calls.length,4,"plan, investigate, consolidate, verify use the actual F006 port");
});
