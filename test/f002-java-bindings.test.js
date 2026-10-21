import assert from "node:assert/strict";
import test from "node:test";
import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { createFactId } from "../src/deterministic-facts/identity.js";
import { normalizeCanonicalRecords } from "../src/deterministic-facts/verification.js";
import { standardF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";

const workspaceId="workspace", bundleId="b".repeat(64), componentId="a".repeat(64);
const profile=limits=>({id:"c".repeat(64),version:"2",ruleVersions:["java@2"],extractionLimits:{javaSyntax:"ast-declarations-v1",javaBindings:"component-static-zero-v1",...limits}});
const helper="package library;\npublic class Helper {\n public static String read() { return null; }\n}\n";
const caller="package client;\nimport library.Helper;\npublic class Caller {\n String run() { return Helper.read(); }\n}\n";
const compile=(source=caller,target=helper,limits={},extra=[])=>compileDeterministicFacts({workspaceId,bundleId,profile:profile(limits),materials:[
  {componentId,pathBytes:Buffer.from("src/Caller.java").toString("base64url"),mediaType:"text/x-java",bytes:Buffer.from(source)},
  {componentId,pathBytes:Buffer.from("src/Helper.java").toString("base64url"),mediaType:"text/x-java",bytes:Buffer.from(target)},...extra]});
const edges=r=>r.facts.filter(f=>f.predicate==="staticCalls");
const cross=r=>edges(r).filter(f=>r.objects.find(o=>o.objectId===f.subjectId).materialId!==r.objects.find(o=>o.objectId===f.targetId).materialId);
const check=r=>normalizeCanonicalRecords(canonicalRecords(r),{workspaceId,bundleId,profile:profile()});

test("F002 Java cross-material binding is a separate fixed opt-in profile",()=>{
  assert.equal(standardF002Profile().extractionLimits.javaBindings,undefined);
  assert.equal(structuredF002Profile().extractionLimits.javaBindings,"component-static-zero-v1");
  assert.equal(edges(compile(caller,helper,{javaBindings:undefined})).length,0);
});
test("F002 Java explicit type import binds only one public top-level zero-argument static declaration",()=>{
  const r=compile();assert.equal(cross(r).length,1);const f=cross(r)[0];
  assert.equal(r.objects.find(o=>o.objectId===f.targetId).name,"Helper#read");
  assert.equal(f.premiseFactIds.length,20);assert.ok(f.premiseFactIds.every(id=>r.facts.some(p=>p.factId===id&&p.basis==="DECLARED")));
  assert.equal(r.evidence.find(e=>e.evidenceId===f.evidenceIds[0]).anchor.lineStart,4);check(r);
});
test("F002 Java same-package and fully-qualified receivers retain their distinct binding premises",()=>{
  for(const [s,n] of [[caller.replace("package client;\nimport library.Helper;","package library;"),19],[caller.replace("import library.Helper;\n","").replace("Helper.read()","library.Helper.read()"),18]]){
    const r=compile(s);assert.equal(cross(r).length,1);assert.equal(cross(r)[0].premiseFactIds.length,n);check(r);
  }
});
test("F002 Java exact static import binds the original import and not an unqualified same-name guess",()=>{
  const r=compile(caller.replace("import library.Helper;","import static library.Helper.read;").replace("Helper.read()","read()"));
  assert.equal(cross(r).length,1);assert.equal(cross(r)[0].premiseFactIds.length,20);check(r);
  assert.equal(cross(compile(caller.replace("import library.Helper;\n", "").replace("Helper.read()","read()"))).length,0);
});
test("F002 Java component boundaries and unresolved external names never borrow another material target",()=>{
  const r=compile(caller,"",{},[{componentId:"d".repeat(64),pathBytes:Buffer.from("src/External.java").toString("base64url"),mediaType:"text/x-java",bytes:Buffer.from(helper)}]);
  assert.equal(cross(r).length,0);assert.ok(r.gaps.some(g=>g.code==="JAVA_BINDING_UNRESOLVED"));
});
test("F002 Java duplicate qualified types preserve bounded candidates instead of choosing file order",()=>{
  const extra={componentId,pathBytes:Buffer.from("other/Helper.java").toString("base64url"),mediaType:"text/x-java",bytes:Buffer.from(helper)};
  const r=compile(caller,helper,{maxJavaBindingCandidateRefs:1},[extra]);assert.equal(cross(r).length,0);
  const g=r.gaps.find(g=>g.code==="JAVA_BINDING_AMBIGUOUS");assert.ok(g);assert.equal(g.reason.candidateObjectIds.length,1);assert.equal(g.reason.candidatesTruncated,true);
  assert.ok(g.reason.candidateObjectIds.every(id=>r.objects.some(o=>o.objectId===id)));check(r);
});
test("F002 Java wildcard conflicting imports and local receiver shadows remain limitations",()=>{
  for(const s of [caller.replace("library.Helper;","library.*;"),caller.replace("library.Helper;","library.Helper;\nimport other.Helper;"),caller.replace("String run()", "String run(Object Helper)"),caller.replace("Helper.read()","((Helper)null).read()")]){
    const r=compile(s);assert.equal(cross(r).length,0);assert.ok(r.gaps.some(g=>g.code.startsWith("JAVA_BINDING_")));
  }
});
test("F002 Java non-public generic inherited nested instance and overloaded targets are not statically selected",()=>{
  for(const h of [helper.replace("public class","class"),helper.replace("public static String","private static String"),helper.replace("class Helper", "class Helper<T>"),helper.replace("static String read", "static <T> String read"),helper.replace("class Helper", "class Helper extends Parent"),helper.replace("static String", "String"),helper.replace("public static String read()", "public static String read(int n)"),helper.replace(" public static String read()", " public static String read(int n){return null;}\n public static String read()")]){
    const r=compile(caller,h);assert.equal(cross(r).length,0);assert.ok(r.gaps.some(g=>g.code.startsWith("JAVA_BINDING_")));
  }
});
test("F002 Java nonzero call arguments and caller inheritance are not resolved by the cross-file rule",()=>{
  for(const s of [caller.replace("Helper.read()","Helper.read(1)"),caller.replace("class Caller", "class Caller extends Parent")]){
    const r=compile(s);assert.equal(cross(r).length,0);assert.ok(r.gaps.some(g=>g.code.startsWith("JAVA_BINDING_")));
  }
});
test("F002 Java cross-file call budgets stop all links rather than publish an order-dependent prefix",()=>{
  const r=compile(caller.replace("return Helper.read();","Helper.read(); return Helper.read();"),helper,{maxJavaBindingCalls:1});
  assert.equal(cross(r).length,0);assert.ok(r.gaps.some(g=>g.code==="JAVA_BINDING_LIMIT"));
});
test("F002 Java cross-file proof preserves CRLF bytes and deterministic input ordering",()=>{
  const s=caller.replace("return Helper.read();",'String marker="😀"; return Helper.read();').replaceAll("\n","\r\n");const r=compile(s);
  assert.equal(cross(r).length,1);const f=cross(r)[0],e=r.evidence.find(e=>e.evidenceId===f.evidenceIds[0]);
  assert.equal(e.anchor.lineStart,4);assert.equal(Buffer.from(s).subarray(e.anchor.byteStart,e.anchor.byteEnd).toString(),"Helper.read()");
  const reversed=compileDeterministicFacts({workspaceId,bundleId,profile:profile(),materials:[{componentId,pathBytes:Buffer.from("src/Helper.java").toString("base64url"),mediaType:"text/x-java",bytes:Buffer.from(helper)},{componentId,pathBytes:Buffer.from("src/Caller.java").toString("base64url"),mediaType:"text/x-java",bytes:Buffer.from(s)}]});
  assert.deepEqual(canonicalRecords(r),canonicalRecords(reversed));check(r);
});
test("F002 Java rehashed cross-file retargeting and missing import premises fail publication",()=>{
  const r=compile(caller,helper.replace(" public static String read()", " public static String other(){return null;}\n public static String read()"));assert.equal(cross(r).length,1);
  const target=r.objects.find(o=>o.kind==="JAVA_METHOD"&&o.name==="Helper#other");
  for(const change of [{targetId:target.objectId},{premiseFactIds:cross(r)[0].premiseFactIds.slice(0,-1)}]){
    const records=canonicalRecords(r).map(record=>{if(record.id!==cross(r)[0].factId)return record;const p={...record.payload,...change};const id=createFactId({subjectId:p.subjectId,predicate:p.predicate,targetId:p.targetId,basis:p.basis,evidenceIds:p.evidenceIds,ruleRef:p.ruleRef,premiseFactIds:p.premiseFactIds});return{...record,id,payload:{...p,factId:id}};});
    assert.throws(()=>normalizeCanonicalRecords(records,{workspaceId,bundleId,profile:profile()}),{code:"F002_RECORD_JAVA_BINDING_INVALID"});
  }
});
test("F002 Java method-local type declarations shadow an imported receiver instead of borrowing its name",()=>{
  const r=compile(caller.replace("return Helper.read();","class Helper {} return Helper.read();"));
  assert.equal(cross(r).length,0);assert.ok(r.gaps.some(g=>g.code==="JAVA_BINDING_UNSUPPORTED"));
});
test("F002 Java conflicting explicit imports retain both current component declaration candidates",()=>{
  const r=compile(caller.replace("import library.Helper;","import library.Helper;\nimport other.Helper;"),helper,{},[
    {componentId,pathBytes:Buffer.from("src/Other.java").toString("base64url"),mediaType:"text/x-java",bytes:Buffer.from(helper.replace("package library;","package other;"))}]);
  assert.equal(cross(r).length,0);const g=r.gaps.find(g=>g.code==="JAVA_BINDING_AMBIGUOUS");
  assert.equal(g?.reason.candidateObjectIds.length,2);check(r);
});
test("F002 Java nested target classes are never treated as top-level package bindings",()=>{
  const r=compile(caller.replace("library.Helper", "library.Outer.Helper"),"package library; public class Outer { public static class Helper { public static String read(){return null;} } }");
  assert.equal(cross(r).length,0);assert.ok(r.gaps.some(g=>g.code==="JAVA_BINDING_UNSUPPORTED"));
});
test("F002 Java publication rejects an ambiguous edge even when all twenty premises and identities are valid",()=>{
  const good=compile();const edge=canonicalRecords(good).find(r=>r.kind==="FACT"&&r.payload.predicate==="staticCalls");assert.ok(edge);
  const ambiguous=compile(caller,helper,{},[{componentId,pathBytes:Buffer.from("copy/Helper.java").toString("base64url"),mediaType:"text/x-java",bytes:Buffer.from(helper)}]);
  assert.equal(cross(ambiguous).length,0);
  assert.throws(()=>normalizeCanonicalRecords([...canonicalRecords(ambiguous),edge],{workspaceId,bundleId,profile:profile()}),{code:"F002_RECORD_JAVA_BINDING_INVALID"});
});
test("F002 Java unqualified inherited Object method names cannot pretend to be exact static-import bindings",()=>{
  const r=compile(caller.replace("import library.Helper;","import static library.Helper.toString;").replace("Helper.read()","toString()"),helper.replace("read()","toString()"));
  assert.equal(cross(r).length,0);assert.ok(r.gaps.some(g=>g.code==="JAVA_BINDING_UNSUPPORTED"));
});
