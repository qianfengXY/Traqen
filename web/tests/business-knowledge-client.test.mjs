import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { setSessionProof } from "../app/auth-client.ts";
import { BusinessKnowledgeClient } from "../app/business-knowledge/client.ts";
import {KnowledgeTransport} from "../app/business-knowledge/read-session.ts";
import {SourceClientError} from "../app/source-truth/client.ts";
import {FactsClientError} from "../app/deterministic-facts/client.ts";

const id = "fixed-investigation", workspace = "space / one";
const envelope = body => new Response(JSON.stringify({ schemaVersion: 1, workspaceId: workspace, ...body }), { headers: { "content-type": "application/json" } });

test("task evidence reads pin the current run/graph and reject a different revision instead of silently refreshing to latest",async t=>{
  const run={id,workspaceId:workspace,revision:7,generation:3,state:"COMPLETED",profile:{id:"profile"},
    sourceInput:{sourceBundleSnapshotId:"b".repeat(64),receiptId:"receipt"},latestGraph:{digest:"a".repeat(64),generation:2}};
  const value={version:1,binding:{workspaceId:workspace,investigationId:id,runRevision:7,runGeneration:3,profileId:"profile",
    sourceBundleId:run.sourceInput.sourceBundleSnapshotId,receiptId:"receipt",graphDigest:run.latestGraph.digest},runState:run.state,
    snapshotKind:"SAVED_GRAPH",snapshotGeneration:2,tasks:[],pending:[],missing:[],manifestAvailable:false,pendingInventoryAvailable:false};
  const requests=[];let result=value;
  t.mock.method(globalThis,"fetch",async(url,options)=>{requests.push({url,options});return envelope({taskEvidence:result});});
  const client=new BusinessKnowledgeClient("https://api.test",workspace);
  assert.deepEqual(await client.taskEvidence(run),value);
  assert.equal(requests[0].options.method,"GET");
  assert.equal(new URL(requests[0].url).searchParams.get("expectedRevision"),"7");
  assert.equal(new URL(requests[0].url).searchParams.get("expectedGraphDigest"),run.latestGraph.digest);
  for(const change of [{runRevision:8},{graphDigest:"c".repeat(64)},{sourceBundleId:"d".repeat(64)},{investigationId:"other"},{receiptId:"foreign"}]){
    result={...value,binding:{...value.binding,...change}};
    await assert.rejects(client.taskEvidence(run),{code:"F003_RESPONSE_INVALID"});
  }
  assert.ok(requests.every(r=>r.options.method==="GET"&&r.options.body===undefined));
});

test("business graph reads use the current cookie, exact space/investigation and GET only", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    const field = url.includes("/seven-questions") ? "answer" : url.includes("/trace?") ? "trace" : url.includes("/graph?") ? "graph" : null;
    return envelope(field ? { [field]: { investigationId: id, ...(field === "answer" ? {key:"function-key"} : {}) } } : { investigations: [] });
  });
  const client = new BusinessKnowledgeClient("https://api.test/", workspace);
  assert.deepEqual(await client.list(), []);
  await client.graph(id, { view: "COVERAGE", text: "订单 & 状态", includeUncertain: true, onlyHumanConfirmed: false });
  await client.trace(id, { materialId: "m" });
  await client.sevenQuestions(id, "function-key");
  assert.equal(calls.length, 4);
  assert.ok(calls.every(c => c.options.method === "GET" && c.options.redirect === "error" && c.options.credentials === "same-origin"));
  assert.ok(calls.every(c => !new Headers(c.options.headers).has("authorization")));
  assert.match(calls[0].url, /workspaces\/space%20%2F%20one\/business-knowledge\/investigations/);
  assert.equal(new URL(calls[1].url).searchParams.get("text"), "订单 & 状态");
  assert.equal(new URL(calls[2].url).searchParams.get("materialId"), "m");
  assert.ok(calls.every(c => !c.url.includes("model") && !c.url.includes("/start")));
});

test("writes carry CSRF and exact revisions, run once, and never silently adopt latest", async t => {
  const calls = [];
  setSessionProof("current-proof");
  t.after(() => setSessionProof(""));
  t.mock.method(globalThis, "fetch", async (url, options) => { calls.push({ url, options }); return envelope({ investigation: { id, workspaceId: workspace } }); });
  const client = new BusinessKnowledgeClient("https://api.test", workspace);
  await client.control(id, "pause", 7);
  await client.adopt(id, { requestId: "request-1", versionId: "a".repeat(64), expectedRevision: 8 });
  assert.deepEqual(JSON.parse(calls[0].options.body), { expectedRevision: 7 });
  assert.deepEqual(JSON.parse(calls[1].options.body), { requestId: "request-1", versionId: "a".repeat(64), expectedRevision: 8 });
  assert.equal(new Headers(calls[0].options.headers).get("x-traqen-csrf"), "current-proof");
  t.mock.method(globalThis, "fetch", async () => { calls.push("lost"); throw Error("connection lost after acceptance"); });
  await assert.rejects(client.start({ operationId: "original-op" }), { code: "F003_NETWORK_UNCONFIRMED" });
  assert.equal(calls.filter(c => c === "lost").length, 1);
});

test("HTML, malformed, cross-space and cross-investigation responses cannot replace a fixed read", async t => {
  const client = new BusinessKnowledgeClient("https://api.test", workspace);
  for (const response of [new Response("<html>login</html>"), envelope({ investigation: { id: "foreign", workspaceId: workspace } }),
    new Response(JSON.stringify({ schemaVersion: 1, workspaceId: "foreign", investigations: [] }), { headers: { "content-type": "application/json" } })]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(client.get(id), { code: "F003_RESPONSE_INVALID" });
  }
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: { code: "F003_INVESTIGATION_FORBIDDEN", message: "not delegated" } }), { status: 403, headers: { "content-type": "application/json", "x-request-id": "refused" } }));
  await assert.rejects(client.get(id), { status: 403, code: "F003_INVESTIGATION_FORBIDDEN", requestId: "refused" });
});

test("aborted identities cannot publish late body consumption or issue subsequent writes", async t => {
  const controller = new AbortController();
  const client = new BusinessKnowledgeClient("https://api.test", workspace, controller.signal);
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }));
  const pending = client.list();
  await new Promise(resolve => setTimeout(resolve, 0)); controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelled, true, "aborted reads release the stream instead of waiting for late body bytes");
  await assert.rejects(client.start({ operationId: "must-not-send" }), { name: "AbortError" });
});

test("raw material is inert, bounded, identity-bound and verified against admitted bytes", async t => {
  const bytes = new TextEncoder().encode("<script>not executed</script>\n原文哨兵"), digest = createHash("sha256").update(bytes).digest("hex");
  const material = { id: "material-ref", sourceMaterial: { contentDigest: digest } };
  const headers = { "content-type": "application/octet-stream", "x-source-material-ref": material.id };
  const client = new BusinessKnowledgeClient("https://api.test", workspace);
  t.mock.method(globalThis, "fetch", async () => new Response(bytes, { headers }));
  assert.equal((await client.material(id, material)).text, new TextDecoder().decode(bytes));
  t.mock.method(globalThis, "fetch", async () => new Response("tampered", { headers }));
  await assert.rejects(client.material(id, material), { code: "F003_MATERIAL_DIGEST_MISMATCH" });
  t.mock.method(globalThis, "fetch", async () => new Response(bytes, { headers: { ...headers, "x-source-material-ref": "another" } }));
  await assert.rejects(client.material(id, material), { code: "F003_RESPONSE_INVALID" });
  t.mock.method(globalThis, "fetch", async () => new Response(bytes, { headers }));
  await assert.rejects(client.material(id, material, 2), { code: "F003_MATERIAL_TOO_LARGE" });
});

test("publication readiness reads never import evidence, while explicit writes preserve fixed binding and head CAS", async t => {
  const binding={workspaceId:workspace,investigationId:id,graphDigest:"a".repeat(64),sourceInput:{sourceBundleSnapshotId:"b".repeat(64),receiptId:"receipt"},profileId:"fixed-profile",adoptedVersionIds:[]};
  const readiness={status:"BLOCKED",canPublish:false,binding,missing:[{code:"F003_QUALITY_POLICY_UNCONFIRMED"}],currentHead:null,policy:null,evidenceRefs:{quality:null,recovery:null,backupId:null}};
  const calls=[];setSessionProof("current-proof");t.after(()=>setSessionProof(""));
  t.mock.method(globalThis,"fetch",async(url,options)=>{calls.push({url,options});return envelope(url.endsWith("publication-readiness")?{readiness}:{binding,importedEvidenceRefs:[],diagnostics:[]});});
  const client=new BusinessKnowledgeClient("https://api.test",workspace);
  assert.equal((await client.publicationReadiness(id)).canPublish,false);
  assert.equal(calls.length,1);assert.equal(calls[0].options.method,"GET");assert.ok(!calls[0].url.includes("import-publication-evidence"));
  await client.importPublicationEvidence(id);assert.equal(calls[1].options.method,"POST");assert.deepEqual(JSON.parse(calls[1].options.body),{});
  t.mock.method(globalThis,"fetch",async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({error:{code:"F003_HEAD_CONFLICT",message:"head changed"}}),{status:409,headers:{"content-type":"application/json"}});});
  const input={operationId:"original-publication",expectedGraphDigest:binding.graphDigest,expectedHeadVersion:3};
  await assert.rejects(client.publish(id,input),{code:"F003_HEAD_CONFLICT",status:409});
  assert.deepEqual(JSON.parse(calls[2].options.body),input);assert.equal(calls.length,3,"CAS conflict cannot cause automatic retries");
  t.mock.method(globalThis,"fetch",async()=>envelope({readiness:{...readiness,binding:{...binding,investigationId:"other"}}}));
  await assert.rejects(client.publicationReadiness(id),{code:"F003_RESPONSE_INVALID"});
});

test("source and technical current-access refusals retire the same workspace read identity",()=>{
 for(const error of [new SourceClientError("revoked","AUTH_FORBIDDEN",403),new FactsClientError("expired","AUTH_REQUIRED",401)]){
  const transport=new KnowledgeTransport("https://api.test",workspace),unsubscribe=transport.subscribe(()=>{});
  const original=transport.getSnapshot().client;transport.refuse(error);
  assert.equal(transport.getSnapshot().client,null);assert.equal(original.signal.aborted,true);unsubscribe();
 }
});

test("publication acknowledgements must belong to the requested investigation, graph and head",async t=>{
 const client=new BusinessKnowledgeClient("https://api.test",workspace),digest="a".repeat(64);
 const input={operationId:"fixed-operation",expectedGraphDigest:digest,expectedHeadVersion:2};
 const publication={workspaceId:workspace,investigationId:id,graphDigest:digest,graphRevisionId:"revision",headVersion:3};
 const head={projectId:workspace,graphRevisionId:"revision",version:3};
 for(const result of [{publication:{...publication,investigationId:"foreign"},head,replayed:false},
  {publication:{...publication,graphDigest:"b".repeat(64)},head,replayed:false},
  {publication,head:{...head,graphRevisionId:"foreign"},replayed:false}]){
  t.mock.method(globalThis,"fetch",async()=>envelope(result));
  await assert.rejects(client.publish(id,input),{code:"F003_RESPONSE_INVALID"});
 }
 t.mock.method(globalThis,"fetch",async()=>envelope({publication,head,replayed:false}));
 assert.equal((await client.publish(id,input)).head.version,3);
});

test("oversized error bodies retain denial status and cannot be materialized without a bound",async t=>{
 let cancelled=false;
 t.mock.method(globalThis,"fetch",async()=>new Response(new ReadableStream({
  start(stream){stream.enqueue(new Uint8Array(256*1024));setTimeout(()=>{if(!cancelled)stream.close();},50);},cancel(){cancelled=true;}
 }),{status:403,headers:{"content-type":"application/json"}}));
 await assert.rejects(new BusinessKnowledgeClient("https://api.test",workspace).get(id),{status:403,code:"F003_HTTP_ERROR"});
 assert.equal(cancelled,true);
});

test("trace and seven-question replies cannot substitute another saved graph of the same investigation",async t=>{
 const client=new BusinessKnowledgeClient("https://api.test",workspace);
 const expected={graphDigest:"a".repeat(64),sourceBundleId:"b".repeat(64),profileId:"fixed-profile"};
 for(const field of ["trace","answer"]){
  for(const mismatch of [{graphDigest:"c".repeat(64)},{sourceBundleId:"foreign-source"},{profileId:"foreign-profile"}]){
   t.mock.method(globalThis,"fetch",async()=>envelope({[field]:{investigationId:id,...expected,...mismatch}}));
   await assert.rejects(field==="trace"?client.trace(id,{key:"rule"},expected):client.sevenQuestions(id,"rule",expected),{code:"F003_RESPONSE_INVALID"});
  }
  t.mock.method(globalThis,"fetch",async()=>envelope({[field]:{investigationId:id,...expected,...(field==="answer"?{key:"rule"}:{})}}));
  assert.equal((await(field==="trace"?client.trace(id,{key:"rule"},expected):client.sevenQuestions(id,"rule",expected))).graphDigest,expected.graphDigest);
 }
});
