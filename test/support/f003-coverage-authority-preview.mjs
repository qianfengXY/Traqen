// Isolated acceptance entry, never a deployment or a production data source.
// The quality/recovery issuers, business model and signed runner are synthetic.
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import {isolatedPostgres} from "./source-truth-postgres.js";
import {webAuthorityFixture} from "./f003-web-authority-fixture.js";
import {syntheticPassword} from "./f002-f003-server-fixture.js";

const port=Number(process.argv[2]??6276);
if(!Number.isSafeInteger(port)||port<1024||port>65535||[3003,3004,3100,3188,6398,6399].includes(port))throw Error("Choose an unreserved isolated Web port");
const root=fileURLToPath(new URL("../../",import.meta.url)),origin=`http://127.0.0.1:${port}`;
const cleanups=[],context={after:callback=>cleanups.push(callback)};
const environment=Object.fromEntries(["PATH","HOME","TMPDIR","LANG","LC_ALL","LC_CTYPE","SHELL"].flatMap(key=>process.env[key]===undefined?[]:[[key,process.env[key]]]));
let front,stopping=false,ready=false,requested=false;
async function close(){
  if(stopping)return;stopping=true;clearTimeout(expiry);
  if(front&&front.exitCode===null){front.kill("SIGTERM");await Promise.race([new Promise(resolve=>front.once("exit",resolve)),delay(3000)]);if(front.exitCode===null)front.kill("SIGKILL");}
  for(const callback of cleanups.reverse())await callback();
}
function stop(){requested=true;if(ready)void close().catch(error=>{console.error(error.message);process.exitCode=1;});}
for(const signal of ["SIGINT","SIGTERM"])process.once(signal,stop);
const expiry=setTimeout(stop,3600000);
try{
  const cluster=await isolatedPostgres(context),fixture=await webAuthorityFixture(context,{database:()=>cluster.createDatabase(),webOrigin:origin});
  fixture.model.release();await fixture.runtime.knowledge.start();
  const deadline=new Date(Date.now()+120000).toISOString();
  const run=(await fixture.post("owner",`${fixture.base}/investigations`,{operationId:"isolated-preview",question:"合成机制示例：订单状态依据（非真实质量／发布许可）",reference:fixture.reference,expectedProfileId:fixture.profile.id,technicalVersionId:null,
    scope:{componentIds:[fixture.componentId]},budget:{maxReadBytes:20000,maxModelCalls:12,deadline},supplementBudget:{maxMaterials:10,maxBytes:20000,maxRuleApplications:100,maximumAttempts:2,deadline}})).investigation;
  let current;
  for(let attempt=0;attempt<300;attempt++){if(requested)throw Error("Preview stopped during startup");current=(await fixture.request("owner",`${fixture.base}/investigations/${run.id}`)).body.investigation;if(["COMPLETED","FAILED"].includes(current.state))break;await delay(100);}
  if(current.state!=="COMPLETED")throw Error("Isolated investigation did not complete");
  const graph=(await fixture.request("owner",`${fixture.base}/investigations/${run.id}/graph?view=BUSINESS`)).body.graph;
  const publication=await fixture.publishMechanism(run.id),authority=await fixture.prepareAuthority();
  await fixture.post("owner",`${fixture.base}/versions/${publication.publication.graphRevisionId}/authority-bindings`,{operationId:"isolated-preview-map",expectedGraphDigest:graph.graphDigest,objectKey:graph.nodes[0].key,expectedVersion:0,rationale:"Synthetic mechanical demonstration, not actual business authority",targets:[authority.target]});
  await authority.decide();await authority.ingest("PASS");await authority.ingest("FAIL");
  if((await fixture.request("owner",`${fixture.base}/investigations/${run.id}/publication-readiness`)).body.readiness.canPublish)throw Error("Default publication must remain blocked");
  if(requested)throw Error("Preview stopped during startup");
  front=spawn(process.execPath,[fileURLToPath(new URL("../../web/node_modules/vinext/dist/cli.js",import.meta.url)),"dev","--hostname","127.0.0.1","--port",String(port)],{cwd:root+"web",env:{...environment,TRAQEN_API_PROXY_TARGET:fixture.runtime.origin,NEXT_PUBLIC_TRAQEN_API_BASE:"/api"},stdio:["ignore","inherit","inherit"]});
  front.once("error",error=>{console.error(error.message);process.exitCode=1;void close();});front.once("exit",()=>{if(!stopping){process.exitCode=1;void close();}});ready=true;
  console.log(JSON.stringify({scope:"SYNTHETIC_MECHANISMS_ONLY_NOT_REAL_BUSINESS_QUALITY_MEDIA_OR_PUBLICATION_APPROVAL",origin,credentials:{login:"owner",password:syntheticPassword},runId:run.id,objectKey:graph.nodes[0].key,graphRevisionId:publication.publication.graphRevisionId,reference:fixture.reference,
    expiresInSeconds:3600,instructions:"Login once, select Workspace, open 业务图谱, choose the explicitly synthetic example. 材料覆盖 separates read/transport/business association. Select an object, explicitly read published r1: actual independent-account decision, trusted synthetic FAIL after PASS. Relations have separate mappings. Actual default publication remains blocked; no UI quality override. Start a separate synthetic investigation to exercise controls. SIGTERM drains only this owned preview."}));
}catch(error){await close();throw error;}
