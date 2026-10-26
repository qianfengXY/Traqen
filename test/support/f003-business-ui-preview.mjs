// Local acceptance only: new native PG, synthetic accounts/materials, actual
// application services and HTTP, explicitly synthetic external model process.
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {isolatedPostgres} from "./source-truth-postgres.js";
import {knowledgeServerFixture,syntheticPassword} from "./f002-f003-server-fixture.js";
import {businessUiModelResponse} from "./f003-business-ui-model.js";

const root=fileURLToPath(new URL("../../",import.meta.url)),web="http://127.0.0.1:6256";
const cleanup=[],context={after:work=>cleanup.push(work)};
const environment=Object.fromEntries(["PATH","HOME","TMPDIR","LANG","LC_ALL","LC_CTYPE","SHELL"].flatMap(key=>process.env[key]===undefined?[]:[[key,process.env[key]]]));
let closing=false,stopRequested=false,startupDone=false,front;
const close=async()=>{
 if(closing)return;closing=true;clearTimeout(expiry);
 if(front&&front.exitCode===null){front.kill("SIGTERM");await new Promise(resolve=>front.once("exit",resolve));}
 for(const work of cleanup.reverse())await work();
};
const requestStop=()=>{stopRequested=true;if(startupDone)void close().catch(error=>{console.error(error.message);process.exitCode=1;});};
const expiry=setTimeout(requestStop,2*60*60*1000);
for(const signal of ["SIGINT","SIGTERM"])process.once(signal,requestStop);
try{
 const cluster=await isolatedPostgres(context);
 if(stopRequested)throw Error("Preview stopped during startup");
 const fixture=await knowledgeServerFixture(context,{port:6255,webOrigin:web,database:()=>cluster.createDatabase(),modelResponse:businessUiModelResponse});
 if(stopRequested)throw Error("Preview stopped during startup");
 fixture.model.release();await fixture.runtime.knowledge.start();
 front=spawn(process.execPath,[fileURLToPath(new URL("../../web/node_modules/vinext/dist/cli.js",import.meta.url)),"dev","--hostname","127.0.0.1","--port","6256"],{
  cwd:root+"web",env:{...environment,TRAQEN_API_PROXY_TARGET:"http://127.0.0.1:6255",NEXT_PUBLIC_TRAQEN_API_BASE:"/api"},stdio:["ignore","inherit","inherit"]});
 front.once("error",error=>{console.error(error.message);process.exitCode=1;void close();});
 front.once("exit",()=>{if(!closing){process.exitCode=1;void close();}});
 startupDone=true;
 console.log(JSON.stringify({scope:"SYNTHETIC_BUSINESS_GRAPH_UI_ACCEPTANCE",origin:web,apiOrigin:fixture.runtime.origin,
  credentials:{login:"owner",password:syntheticPassword},reference:fixture.reference,componentId:fixture.componentId,
  model:"EXTERNAL_MODEL_PROCESS_DOUBLE_NOT_REAL_MODEL_OR_QUALITY_EVIDENCE",database:"NEW_NATIVE_PG_UNIX_SOCKET_ONLY",
  expiresInSeconds:7200,instructions:"Login once, select workspace, open 业务图谱, select the frozen source and component, enter a business question, confirm Main/Child, start. Saved graph, seven questions and originals are actual server reads. Publication remains server-blocked. SIGTERM drains this preview only."}));
}catch(error){await close();throw error;}
