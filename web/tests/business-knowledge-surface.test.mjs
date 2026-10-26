import assert from "node:assert/strict";
import test from "node:test";
import { renderComponent } from "./support/render-components.mjs";
const { RunStatus } = await import("../app/business-knowledge/run-status.tsx");
const {PublicationStatus}=await import("../app/business-knowledge/publication-panel.tsx");
const {GraphView}=await import("../app/business-knowledge/graph-view.tsx");
const { writeProductRoute, accessViewFromRoute } = await import("../app/product-navigation.ts");

const run = { id: "saved-investigation", question: "订单取消的条件", state: "RUNNING", revision: 3, generation: 2,
  updatedAt: "2026-10-22T00:00:00Z", sourceInput: { sourceBundleSnapshotId: "a".repeat(64), receiptId: "receipt" },
  profile: { id: "fixed-profile" }, budget: { maxModelCalls: 12, maxReadBytes: 4096, deadline: "2026-10-23T00:00:00Z" },
  usage: { modelCalls: 2, readBytes: 512 }, adoptedVersionIds: [], technicalVersionId: null, leaseUntil: null };

test("graph view and legacy view are not access-center routes, while settings deep links remain intact", () => {
  assert.equal(accessViewFromRoute("?page=graph&workspace=w&runId=fixed&view=COVERAGE"), null);
  assert.equal(accessViewFromRoute("?page=graph&workspace=w&view=legacy"), null);
  assert.equal(accessViewFromRoute("?page=settings&workspace=w&view=members"), "members");
  assert.equal(accessViewFromRoute("?page=settings&view=security"), "security");
  assert.equal(accessViewFromRoute("?page=overview&view=security"), "security");
  assert.equal(accessViewFromRoute("?page=overview&view=spaces"), "spaces");
});

test("read-only members see the saved investigation but cannot operate its controls", () => {
  const html = renderComponent(RunStatus, { run, busy: false, canControl: false, onControl() {} });
  assert.match(html, /订单取消的条件/);
  assert.doesNotMatch(html, /<button[^>]*>暂停调查|<button[^>]*>取消调查/);
});

test("the server's typed timeout identifies its task while unknown historical failures stay unknown", () => {
  const html = renderComponent(RunStatus, { run: { ...run, state: "FAILED", lastFailure: {
    code: "F003_MODEL_TIMEOUT", phase: "CHILD", taskKey: "task-one", slotId: "child-one", generation: 2 } }, busy: false, canControl: true, onControl() {} });
  assert.match(html, /模型调用超时/);
  assert.match(html, /task-one/); assert.match(html, /child-one/);
  const old = renderComponent(RunStatus, { run: { ...run, state: "FAILED", lastFailure: { code: "F003_EXECUTION_FAILED", generation: 1 } }, busy: false, canControl: true, onControl() {} });
  assert.doesNotMatch(old, /模型调用超时/);
});

test("new business investigation coordinates never become legacy technical object coordinates during navigation", () => {
  const priorWindow = globalThis.window, priorLocation = globalThis.location;
  let href;
  globalThis.location = { origin: "http://localhost", pathname: "/", search: "?page=graph&workspace=w&runId=investigation&view=BUSINESS&objectId=business-rule" };
  globalThis.window = { history: { pushState(_state, _title, value) { href = value; } }, dispatchEvent() {} };
  try {
    writeProductRoute("feature", "w");
    assert.equal(new URL(href, "http://localhost").searchParams.has("objectId"), false);
    globalThis.location.search = "?page=graph&workspace=w&revision=old-revision&objectId=old-object";
    writeProductRoute("feature", "w");
    const legacy = new URL(href, "http://localhost");
    assert.equal(legacy.searchParams.get("revision"), "old-revision");
    assert.equal(legacy.searchParams.get("objectId"), "old-object");
  } finally { globalThis.window = priorWindow; globalThis.location = priorLocation; }
});

test("the actual server's unconfirmed quality policy remains blocked and cannot render a publication action",()=>{
 const readiness={status:"BLOCKED",canPublish:false,missing:[{code:"F003_QUALITY_POLICY_UNCONFIRMED"}],policy:null,currentHead:null,evidenceRefs:{quality:null,recovery:null,backupId:null}};
 const html=renderComponent(PublicationStatus,{readiness,canControl:true,busy:false,confirmed:true,onConfirm(){},onPublish(){},onImport(){}});
 assert.match(html,/业务图谱质量计量策略尚未确认/);assert.match(html,/F003_QUALITY_POLICY_UNCONFIRMED/);assert.doesNotMatch(html,/>发布业务版本</);
 const inconsistent=renderComponent(PublicationStatus,{readiness:{...readiness,canPublish:true,status:"READY"},canControl:true,busy:false,confirmed:true,onConfirm(){},onPublish(){},onImport(){}});
 assert.doesNotMatch(inconsistent,/>发布业务版本</);
});

test("directed graph arrow tips stay outside the target card instead of being painted underneath it",()=>{
 const node=(key)=>({key,name:key,kind:"FUNCTION",state:"ANALYSIS_ACCEPTED",authority:"MODEL_ANALYSIS"});
 for(const [source,target,index] of [["a","b",1],["b","a",0],["a","d",3],["a","a",0]]){
  const graph={view:"BUSINESS",nodes:["a","b","c","d"].map(node),edges:[{key:"edge",sourceKey:source,targetKey:target,predicate:"CALLS",scope:"static",uncertainties:[],evidence:[],technicalRefs:[]}],
   materials:[],coverage:[],adoptedVersionIds:[],uncertaintyCount:0};
  const html=renderComponent(GraphView,{graph,selectedKey:"",onSelect(){},onMaterial(){}});
  assert.match(html,/<title>CALLS · static<\/title>/,"SVG relationship title remains readable in React development and production rendering");
  const path=html.match(/class="bk-map-edge"[^>]*d="([^"]+)"/),end=path?.[1].match(/([\d.]+),([\d.]+)$/);
  assert.ok(end);const x=Number(end[1]),y=Number(end[2]),left=20+index%3*250,top=30+Math.floor(index/3)*110;
  assert.equal(x>=left&&x<=left+216&&y>=top&&y<=top+62,false,"arrow tip inside target card is invisible");
  assert.ok(html.includes(`${source} → CALLS → ${target}`));
 }
});
