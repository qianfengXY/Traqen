// Only isolated Web verification. Reasoning, quality/recovery and runner
// credentials are explicitly synthetic. Real F008/F001/F006/F003 stores,
// governance, signature verification, publication and HTTP are retained.
import assert from "node:assert/strict";
import {mkdtemp,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {generateKeyPairSync,sign,randomUUID} from "node:crypto";
import {knowledgeServerFixture,syntheticPassword} from "./f002-f003-server-fixture.js";
import {businessUiModelResponse} from "./f003-business-ui-model.js";
import {createConfiguredApplication} from "../../src/api/application-bootstrap.js";
import {createTraceabilityHttpHandler} from "../../src/api/http-server.js";
import {contextualDatabase} from "../../src/auth/database.js";
import {authorizedStore} from "../../src/auth/authorized-store.js";
import {authContext} from "../../src/auth/context.js";
import {PostgresTraceabilityStore} from "../../src/storage/index.js";
import {PublicationAuthority} from "../../src/business-knowledge/publication-authority.js";
import {canonicalEncode} from "../../src/source-truth/identity.js";
import {createExecutionEvidenceBundle,signExecutionEvidenceBundle} from "../../src/domain/index.js";
import {completeInput} from "../fixtures.js";
import {AnalysisModelRegistry} from "../../src/analysis/index.js";
import {request as httpRequest} from "node:http";

// Exercise the same exact Host as the owned Web reverse proxy. Native fetch
// may normalize Host back to its URL, so use the HTTP transport explicitly;
// no authentication or Host check in the actual server is bypassed.
function fixtureFetch(url,{method="GET",headers={},body}={}) {
  return new Promise((resolve,reject)=>{
    const request=httpRequest(url,{method,headers},response=>{
      const chunks=[];let size=0;
      response.on("data",chunk=>{size+=chunk.length;if(size>16*1024*1024)request.destroy(Error("Fixture response limit"));else chunks.push(chunk);});
      response.on("error",reject);response.on("end",()=>{
        const h=new Headers();for(let i=0;i<response.rawHeaders.length;i+=2)h.append(response.rawHeaders[i],response.rawHeaders[i+1]);
        resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:h}));
      });
    });request.setTimeout(15000,()=>request.destroy(Error("Fixture request deadline")));request.on("error",reject);request.end(body);
  });
}

export async function webAuthorityFixture(t,options={}) {
  const f=await knowledgeServerFixture(t,{...options,modelResponse:input=>options.workModelResponse&&['GRAPH_QUESTION_PLAN','DRAFT','VERIFY'].includes(input.operation)?options.workModelResponse(input):input.phase==="PLAN"?{assignments:[{slotId:input.childSlots[0].id,obligations:["核查本任务原文条件、反例与未供应前提（机制替身）"],objective:"synthetic selective read",materialKeys:[input.inventory.find(m=>m.path==="orders.js").key]}],pendingMaterials:input.inventory.filter(m=>m.path!=="orders.js").map(m=>({materialKey:m.key,reason:'合成选择性读取夹具明确不调查本项'}))}:businessUiModelResponse(input)});
  const identity=f.runtime.identity,db=f.runtime.db,origin=options.webOrigin??f.runtime.origin;
  const runnerSecret="isolated-ui-runner-secret",context=contextualDatabase(db);
  const admin=await identity.login({login:"admin",password:syntheticPassword});
  const program=await identity.createProgram(admin.token,{displayName:"Synthetic Web runner",operations:["MAINTAIN"],workspaceIds:["workspace"],expiresAt:Date.now()+3600000});
  await identity.grant(admin.token,"workspace",{accountId:program.account.id,roles:["MAINTAIN"]});
  const runnerId=(await identity.resolveActor(program.credential,"workspace")).actorId;
  const configured=await authContext.run({raw:admin.token,global:true,operation:"MAINTAIN"},async()=>{
    const application=createConfiguredApplication({store:authorizedStore(new PostgresTraceabilityStore(context),identity,context),identityService:identity,
      analysisModelRegistry:new AnalysisModelRegistry({cliSpawn:()=>{throw Error("Governance fixture cannot start an external model");}}),env:{RUNNER_ID:runnerId,RUNNER_SHARED_SECRET:runnerSecret}});
    await application.ready;return application;
  });
  // Recompose only the server this fixture owns, using the production handler
  // and the existing actual knowledge runtimes, not a fake HTTP/resolver.
  const handler=createTraceabilityHttpHandler({application:configured.application,auth:f.runtime.auth,...f.runtime.knowledge.httpOptions});
  f.runtime.server.removeAllListeners("request");f.runtime.server.on("request",handler);
  for(const name of ["owner","reader"])await identity.grant(admin.token,"workspace",{accountId:f.accounts[name].id,roles:["MAINTAIN","business-owner"]});
  const business=f.runtime.knowledge.business.services;
  // Keep this owned fixture's test trust roots stable across two publications;
  // immutable earlier reports must still verify under their original issuer.
  const issuers=["synthetic-quality","synthetic-recovery"].map(id=>({id,...generateKeyPairSync("ed25519")}));
  const mechanismBackupId=`ui-backup-${randomUUID()}`;
  business.authorityBindings.verifyExecution=configured.application.createBusinessKnowledgeExecutionVerifier();
  const login=async name=>{
    const csrf=await fixtureFetch(`${f.runtime.origin}/v1/auth/csrf`,{headers:{host:new URL(origin).host}}),proof=await csrf.json();
    const response=await fixtureFetch(`${f.runtime.origin}/v1/auth/login`,{method:"POST",headers:{origin,host:new URL(origin).host,"content-type":"application/json","x-traqen-csrf":proof.csrfToken,
      cookie:csrf.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ")},body:JSON.stringify({login:name,password:syntheticPassword})});
    const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
    return {cookie:response.headers.getSetCookie().map(c=>c.split(";")[0]).join("; "),csrf:body.csrfToken};
  };
  const sessions={owner:await login("owner"),reader:await login("reader")};
  const request=async(name,route,method="GET",input)=>{
    const s=sessions[name];const response=await fixtureFetch(`${f.runtime.origin}${route}`,{method,headers:{origin,host:new URL(origin).host,cookie:s.cookie,"x-traqen-review-role":"business-owner",
      ...(method!=="GET"?{"content-type":"application/json","x-traqen-csrf":s.csrf}:{})},body:input===undefined?undefined:JSON.stringify(input)});
    return {status:response.status,body:await response.json()};
  };
  const post=async(name,route,input)=>{const r=await request(name,route,"POST",input);assert.ok([200,201,202].includes(r.status),JSON.stringify(r));return r.body;};
  const project="/v1/projects/workspace",base="/v1/workspaces/workspace/business-knowledge";
  async function prepareAuthority() {
    await post("owner",`${project}/features`,{id:"ui-feature",version:1,name:"合成订单状态规则"});
    await post("owner",`${project}/claim-scopes`,{id:"ui-scope",version:1,scope:{condition:"synthetic only"},effectiveTo:new Date(Date.now()+86400000).toISOString()});
    const claim={id:"ui-claim",version:1,featureId:"ui-feature",type:"NORMATIVE_REQUIREMENT",statement:"固定示例返回OPEN",sourceType:"AI_CANDIDATE",evidenceSupport:"SINGLE_SOURCE",scopeId:"ui-scope",scopeVersion:1};
    await post("owner",`${project}/claims`,claim);
    const snapshot=await post("owner",`${project}/snapshots`,completeInput().snapshotManifest);
    await post("owner",`${project}/test-specs`,{id:"ui-test",version:1,name:"合成签名摄取测试",risk:"LOW",approved:false,featureId:"ui-feature",verifiesClaims:[{id:claim.id,version:1}],
      environment:{target:"sit",operationLevel:"SAFE_READ"},steps:[{id:"read",executor:"HTTP",method:"GET",path:"/synthetic"}],assertions:[{id:"check",type:"HTTP_STATUS",stepId:"read",expected:200}],cleanup:null,policy:{approvalRequired:true}});
    const spec=await post("owner",`${project}/test-specs/ui-test/approvals`,{expectedVersion:1,rationale:"mechanism only"});
    const ref={testSpecId:spec.id,testSpecVersion:spec.version,snapshotManifestId:snapshot.id,deploymentId:snapshot.components.deployment.id};
    const target={featureId:"ui-feature",featureVersion:1,claimId:claim.id,claimVersion:1,scopeId:"ui-scope",scopeVersion:1,verificationTargets:[ref]};
    async function decide(validUntil=null){
      const id=randomUUID();await post("owner",`${project}/decision-review-cases`,{id,claimId:claim.id,claimVersion:1,scopeId:"ui-scope",scopeVersion:1,risk:"LOW",approvalMode:"SINGLE",expiresAt:new Date(Date.now()+3600000).toISOString(),
        proposedDecision:{id:`decision-${id}`,type:"CONFIRMED",content:"真实独立账号审批的合成规则",evidenceRefs:[],validUntil}});
      return post("reader",`${project}/decision-review-cases/${id}/events`,{id:`approve-${id}`,action:"APPROVE",rationale:"different actual F008 account; synthetic business only"});
    }
    async function ingest(status){
      const id=`ui-execution-${randomUUID()}`,time=new Date(Date.now()-10000).toISOString(),execution={id,...ref,runner:{id:runnerId,version:"1"},completionReason:"COMPLETED",startedAt:time,finishedAt:time,
        attempts:[{number:1,startedAt:time,finishedAt:time,phaseStatus:status,stepResults:[{id:"read",status}],assertionResults:[{id:"check",status,actual:status==="PASS"?200:500}],cleanup:{status:"SKIPPED"}}]};
      const bundle=createExecutionEvidenceBundle({execution,evidence:[{id:`evidence-${id}`,type:"ASSERTION",freshness:"FRESH",manifest:{executionId:id,...ref,runnerId,runnerVersion:"1",
        snapshotComponents:Object.fromEntries(Object.entries(snapshot.components).map(([key,v])=>[key,{id:v.id,digest:v.digest}])),assertionResults:execution.attempts[0].assertionResults,redactions:[]}}]});
      // The signed runner endpoint resolves the real program mapping; it must
      // not inherit the human browser's cookie or fabricate an execution row.
      const response=await fixtureFetch(`${f.runtime.origin}${project}/test-executions`,{method:"POST",headers:{origin,host:new URL(origin).host,"content-type":"application/json"},body:JSON.stringify(signExecutionEvidenceBundle("workspace",bundle,runnerSecret))});
      const body=await response.json();assert.equal(response.status,201,JSON.stringify(body));return body;
    }
    return {target,decide,ingest,upgrade:()=>post("owner",`${project}/claims`,{...claim,version:2,statement:"new exact claim version"})};
  }
  async function publishMechanism(runId,{retainForWork=false}={}) {
    const pubs=business.publications,actor={actorId:"owner",tenantId:"tenant"};
    const original={authority:pubs.authority,qualityPolicy:pubs.qualityPolicy,backup:pubs.backup,implementationResolver:pubs.implementationResolver};
    const run=await business.investigations.get(actor,"workspace",runId),graph=await business.investigations.graph(actor,"workspace",runId);
    const binding=(await pubs.readiness(actor,"workspace",runId)).binding;
    const directory=await mkdtemp(path.join(tmpdir(),"traqen-ui-mechanism-authority-")),reportFile=path.join(directory,"reports.json"),backupId=mechanismBackupId;
    try{
      pubs.authority=new PublicationAuthority({implementationAuthors:["synthetic-author"],artifactFiles:[reportFile],issuers:issuers.map((s,i)=>({id:s.id,kind:i?"RECOVERY":"QUALITY",publicKey:s.publicKey.export({type:"spki",format:"pem"})}))});
      pubs.implementationResolver=async()=>binding.implementationVersion;
      pubs.qualityPolicy={id:"ISOLATED_MECHANISM_ONLY_NOT_REAL_QUALITY",minimumDenominators:{inventory:1,candidateSample:1},thresholds:{candidatePrecision:1}};
      pubs.backup={config:{targetId:"synthetic-ui-target"},ready:async()=>{},verify:async()=>({included:true,waterline:{capturedAt:"2090-01-01T00:00:00Z"}})};
      // One explicitly synthetic coverage catalogue per owned fixture: a later
      // publication must not invent a newer archive and silently invalidate the
      // older session's still-required recovery binding. This is not real media.
      await db.query("INSERT INTO source_truth_backup_attempt(id,target_id,requested_by,status,finished_at) VALUES ($1,'synthetic-ui-target','ISOLATED_TEST','COMPLETED',clock_timestamp()) ON CONFLICT DO NOTHING",[backupId]);
      await db.query("INSERT INTO source_truth_backup_set(id,target_id,payload,completed_at) VALUES ($1,'synthetic-ui-target','{}',clock_timestamp()) ON CONFLICT DO NOTHING",[backupId]);
      await db.query("INSERT INTO source_truth_backup_member(backup_id,workspace_id,bundle_id,receipt_id) VALUES ($1,'workspace',$2,$3) ON CONFLICT DO NOTHING",[backupId,run.sourceInput.sourceBundleSnapshotId,run.sourceInput.receiptId]);
      const payloads=[{version:1,kind:"QUALITY",issuerId:issuers[0].id,evidenceClass:"REAL_PROJECT",binding,observedAt:new Date().toISOString(),quality:{measurementKind:"INDEPENDENT_REVIEW",truthSetDigest:"e".repeat(64),measurementRefs:["ISOLATED_TEST_ONLY_NOT_REAL_QUALITY"],denominators:{inventory:graph.coverage.length,candidateSample:1},metrics:{candidatePrecision:1},equivalence:{kind:"MEASURED_REPLAY_AND_INCREMENTAL"}}},
        {version:1,kind:"RECOVERY",issuerId:issuers[1].id,evidenceClass:"REAL_PROJECT",binding,observedAt:new Date().toISOString(),recovery:{kind:"REAL_NATIVE_PAIRED_RESTORE",backupId,waterline:"2090-01-01T00:00:00Z",restoredGraphDigest:graph.digest,restoreReportDigest:"f".repeat(64),restoreEventId:"ISOLATED_TEST_ONLY_NOT_PROTECTED_MEDIA"}}];
      await writeFile(reportFile,JSON.stringify({artifacts:payloads.map((payload,i)=>({issuerId:payload.issuerId,payload,signature:sign(null,Buffer.from(canonicalEncode(payload)),issuers[i].privateKey).toString("base64url")}))}),{mode:0o600});
      await post("owner",`${base}/investigations/${runId}/import-publication-evidence`,{});
      const ready=await request("owner",`${base}/investigations/${runId}/publication-readiness`);assert.equal(ready.body.readiness.canPublish,true,JSON.stringify(ready));
      return await post("owner",`${base}/investigations/${runId}/publish`,{operationId:`synthetic-ui-publish-${runId}-${ready.body.readiness.currentHead?.version??0}`,expectedGraphDigest:graph.digest,expectedHeadVersion:ready.body.readiness.currentHead?.version??0});
    }finally{if(retainForWork)t.after(()=>Object.assign(pubs,original));else Object.assign(pubs,original);}
  }
  return {...f,request,post,base,prepareAuthority,publishMechanism,business,
    get runtime(){return f.runtime;},
    async revoke(){await identity.grant(admin.token,"workspace",{accountId:f.accounts.owner.id,roles:[]});}};
}
