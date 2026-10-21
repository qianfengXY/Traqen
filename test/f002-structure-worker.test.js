import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalDigest, createProfileConfigDigest, createProfileId } from "../src/deterministic-facts/identity.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";
import { F002AdmissionService } from "../src/deterministic-facts/admission.js";
import { F002Worker } from "../src/deterministic-facts/worker.js";
import { F002PublicationService } from "../src/deterministic-facts/publication-service.js";
import { F002ReplayService } from "../src/deterministic-facts/replay-service.js";
import { F002QueryService } from "../src/deterministic-facts/queries.js";
import { standardF002Profile, structuredF002Profile } from "../src/deterministic-facts/runtime.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { owner } from "./support/source-truth-database.js";
import { uniqueDeclaredObject } from "./support/f002-declared-object.js";

const examples = [
  ["src/nested.js", "import 'external-package';\r\nexport function outer() {\r\n  function inner() { return '😀'; }\r\n}\r\n", "outer", "inner"],
  ["src/Nested.java", "class Outer { class Inner { void run() {} } }\n", "Outer", "Inner"],
  ["docs/nested.md", "# 根\r\n## 子😀\r\n~~~\r\n# not a section\r\n~~~\r\n\r\nA raw paragraph line\r\nSecond raw line\r\n\r\n![diagram](diagram.png)\r\n[chapter](#子)\r\n", "根", "子😀"],
  ["docs/config.json", '{\r\n  "nested": {"value": 7, "empty": null}\r\n}\r\n', "nested", "value"],
  ["docs/app.properties", 'title=根😀\\\r\n  后续\r\nempty=\r\npassword=NOT_INDEXED\r\n', "docs/app.properties", "title"],
  ["docs/.env.dev", 'export title="根😀\r\n后续"\r\nempty=\r\nexport API_TOKEN="NOT_INDEXED\r\nALSO_NOT_INDEXED"\r\n', "docs/.env.dev", "title"],
  ["docs/note.txt", "plain 原文😀\r\nsecond\r\n", "docs/note.txt", "plain 原文😀\r\nsecond"],
  ["src/calls.js", "import {target as alias} from './binding-target.js';\r\nexport function outer() {\r\n  function inner() { alias(); }\r\n  inner();\r\n}\r\n", "outer", "inner"],
  ["src/routes.js", "import express from 'express';\r\nconst app=express(); const router=express.Router();\r\nfunction handler(){return '😀';}\r\napp.use('/api',router);\r\nrouter.get('/orders/:id',handler);\r\n", "router", "GET /orders/:id"],
  ["src/Declarations.java", "package demo;\r\nclass Example {\r\n  @Deprecated String run(String label) {\r\n    return helper();\r\n  }\r\n  static String helper() {return \"😀\";}\r\n}\r\n", "Example", "Example#run"],
  ["src/Controller.java", 'import org.springframework.web.bind.annotation.RestController;\r\nimport org.springframework.web.bind.annotation.RequestMapping;\r\nimport org.springframework.web.bind.annotation.GetMapping;\r\n@RestController\r\n@RequestMapping("/api")\r\nclass Orders {\r\n  @GetMapping("/orders/{id}")\r\n  String read(String id) { return "😀"; }\r\n}\r\n', "GetMapping", "GET /api/orders/{id}"],
  ["test/assets.js", "import test from 'node:test';\r\nimport assert from 'node:assert/strict';\r\nfunction subject(){return 7;}\r\ntest('reads subject😀',()=>{\r\n  assert.strictEqual(subject(),7);\r\n});\r\n", "reads subject😀", "strictEqual"],
  ["test/Assets.java", 'import org.junit.jupiter.api.Test;\r\nimport static org.junit.jupiter.api.Assertions.assertEquals;\r\nclass Example {\r\n  @Test void read(){\r\n    assertEquals(subject(),7);\r\n  }\r\n  static int subject(){return 7;}\r\n}\r\n', "read", "assertEquals"],
  ["reports/results.json", '{\r\n "tests": [\r\n  {"name":"read😀","status":"PASS","testId":"opaque-case","sourceBundleId":"' + "d".repeat(64) + '","command":"node --test","environment":"isolated","producer":"untrusted-reporter","testedVersion":"revision-1"}\r\n ]\r\n}\r\n', "tests", "read😀"],
  ["reports/junit.xml", '<?xml version="1.0" encoding="UTF-8"?>\r\n<testsuite name="suite">\r\n <testcase name="read😀" id="opaque-case" sourceBundleId="' + "d".repeat(64) + '" command="node --test" environment="isolated" producer="untrusted-reporter" testedVersion="revision-1"/>\r\n</testsuite>\r\n', "suite", "read😀"],
  ["src/contract-routes.js", "import express from 'express';\r\nconst app=express();\r\nfunction handler(){}\r\napp.get('/api/orders/:id',handler);\r\n", "app", "GET /api/orders/:id"],
  ["src/ContractController.java", 'import org.springframework.web.bind.annotation.RestController;\r\nimport org.springframework.web.bind.annotation.RequestMapping;\r\nimport org.springframework.web.bind.annotation.GetMapping;\r\n@RestController\r\n@RequestMapping("/api")\r\nclass Orders {\r\n @GetMapping("/orders/{id}")\r\n String read(){return "x";}\r\n}\r\n', "GetMapping", "GET /api/orders/{id}"],
  ["src/BindingCaller.java", 'package demo; import library.Helper;\r\npublic class BindingCaller {\r\n @Deprecated String run(String label) {\r\n  return Helper.helper();\r\n }\r\n}\r\n', "BindingCaller", "BindingCaller#run"],
];

for (const [entryPath, content, parentName, childName] of examples) test(`F002 @2 ${entryPath} real admitted worker seal and replay preserve @1 records and source bytes`, async t => {
  const additionalFiles = entryPath.endsWith(".md") ? [{ entryPath: "docs/diagram.png", content: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7yQAAAAASUVORK5CYII=", "base64") }]
    : entryPath === "src/calls.js" ? [{ entryPath: "src/binding-target.js", content: "export function target() { return '😀'; }\r\n" }]
      : entryPath === "src/BindingCaller.java" ? [{entryPath:"src/Helper.java",content:'package library;\r\npublic class Helper {\r\n public static String helper(){return "😀";}\r\n}\r\n'}]
      : ["src/contract-routes.js", "src/ContractController.java"].includes(entryPath) ? [{ entryPath: "src/contract-api.json", content: '{\r\n "openapi":"3.0.3",\r\n "paths":{"/api/orders/{id}":{"get":{"responses":{"200":{"description":"declared"}}}}}\r\n}\r\n' }] : [];
  const source = await candidateFixture(t, { entryPath, directoryPaths: [entryPath.split("/")[0]], content, additionalFiles });
  assert.deepEqual(await source.materials.count(source.context), { fileCount: String(1 + source.additional.length), directoryCount: "1", knownBytes: String(source.bytes.length + source.additional.reduce((total, file) => total + file.bytes.length, 0)), pendingCount: "0" });
  const sourceEntries = (await source.materials.entries(source.context)).items;
  assert.equal(sourceEntries.find(item => item.entry.kind === "DIRECTORY")?.disposition.disposition, "METADATA");
  const prepared = await source.candidates.prepare(source.context);
  await source.advance("RECONCILING", "REVIEW_REQUIRED");
  const publication = new SourcePublicationService(source.repository, source.candidates);
  const confirmation = await publication.confirm(owner, source.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId });
  const frozen = await publication.seal(owner, source.context, { confirmationId: confirmation.id, clientToken: "structural-source" });
  const repository = new F002Repository(source.db, { authorize: (actor, workspaceId, tx, maintain) => source.repository.authorize(actor, workspaceId, maintain, tx) });
  const admission = new F002AdmissionService(repository, new SourceAdmissionService(source.repository, source.candidates));
  const reference = { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id }, componentId = frozen.bundle.components[0].id;
  const worker = new F002Worker(repository, { admission }), publisher = new F002PublicationService(repository), replay = new F002ReplayService(repository, { admission });
  const readRecords = async version => (await source.db.query("SELECT kind,id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 ORDER BY kind,id", ["workspace", version])).rows;
  const seal = async profile => {
    await repository.registerProfile(profile);
    const run = await admission.start(owner, "workspace", { operationId: `structure-${profile.id}`, reference, profile,
      scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
    const ready = await worker.run(owner, "workspace", run.id, run.scopes[0].scopeId, { workerId: `structure-worker-${profile.version}`, leaseMs: 60_000, timeoutMs: 20_000 });
    assert.equal(ready.status, "READY_TO_SEAL");
    const sealed = await publisher.publish(owner, "workspace", run.id, run.scopes[0].scopeId, { revision: ready.revision, operationId: `structure-seal-${profile.id}` });
    return { run, version: sealed.graphVersionId, records: await readRecords(sealed.graphVersionId) };
  };
  const old = await seal(standardF002Profile()), oldDigest = canonicalDigest("FACT_SET_RECORDS", { records: old.records });
  let historicDotenv;
  if (entryPath.endsWith(".env.dev")) {
    const historicalConfig = structuredF002Profile();
    delete historicalConfig.id; delete historicalConfig.configDigest; delete historicalConfig.extractionLimits.dotenvSyntax;
    historicDotenv = await seal({ ...historicalConfig, id: createProfileId(historicalConfig), configDigest: createProfileConfigDigest(historicalConfig) });
    assert.equal(historicDotenv.records.some(record => record.kind === "FACT"), false);
    assert.ok(historicDotenv.records.some(record => record.kind === "GAP" && record.payload.code === "FORMAT_UNSUPPORTED"));
  }
  const current = await seal(structuredF002Profile());
  assert.notEqual(current.version, old.version);
  assert.equal(old.records.some(record => record.kind === "OBJECT" && Object.hasOwn(record.payload, "parentId")), false);
  const objects = current.records.filter(record => record.kind === "OBJECT");
  const material = current.records.find(record => record.kind === "MATERIAL" && record.payload.pathBytes === source.entry.pathBytes);
  assert.ok(material);
  const [parentKind, childKind] = entryPath.startsWith("reports/") ? [entryPath.endsWith(".xml") ? "JUNIT_SUITE" : "JSON_ARRAY", "TEST_RESULT"] : entryPath === "test/assets.js" || entryPath === "test/Assets.java" ? ["TEST_CASE", "TEST_ASSERTION"] : ["src/Controller.java", "src/ContractController.java"].includes(entryPath) ? ["JAVA_ANNOTATION", "ROUTE"] : ["src/Declarations.java","src/BindingCaller.java"].includes(entryPath) ? ["JAVA_TYPE", "JAVA_METHOD"] : ["src/routes.js", "src/contract-routes.js"].includes(entryPath) ? ["EXPRESS_ROUTER", "ROUTE"] : entryPath.endsWith(".js") ? ["FUNCTION", "FUNCTION"] : entryPath.endsWith(".java") ? ["JAVA_TYPE", "JAVA_TYPE"]
    : entryPath.endsWith(".md") ? ["DOCUMENT_SECTION", "DOCUMENT_SECTION"] : entryPath.endsWith(".json") ? ["JSON_OBJECT", "JSON_VALUE"]
      : entryPath.endsWith(".txt") ? ["MATERIAL", "DOCUMENT_PARAGRAPH"] : ["MATERIAL", "CONFIG_KEY"];
  const parent = uniqueDeclaredObject(objects, { materialId: material.id, kind: parentKind, name: parentName }),
    child = uniqueDeclaredObject(objects, { materialId: material.id, kind: childKind, name: childName, parentId: parent.id });
  assert.ok(parent); assert.ok(child); assert.equal(child.payload.parentId, parent.id);
  const detail = await new F002QueryService(repository, { cursorSecret: "structure-real-query-test" }).record(owner, "workspace", current.version, "OBJECT", child.id);
  assert.equal(detail.references.find(reference => reference.role === "parent")?.id, parent.id);
  const contains = current.records.find(record => record.kind === "FACT" && record.payload.predicate === "contains" && record.payload.subjectId === parent.id && record.payload.targetId === child.id);
  assert.ok(contains); assert.equal(contains.payload.ruleRef.version, "2");
  assert.ok(current.records.some(record => record.kind === "EVIDENCE" && contains.payload.evidenceIds.includes(record.id)));
  if (entryPath === "docs/config.json") {
    assert.equal(child.payload.anchor.kind, "JSON_POINTER"); assert.equal(child.payload.anchor.pointer, "/nested/value");
    assert.equal(child.payload.anchor.textRange.lineStart, 2); assert.equal(child.payload.anchor.textRange.lineEnd, 2);
    const integer = current.records.find(record => record.kind === "FACT" && record.payload.subjectId === child.id && record.payload.predicate === "literalValue");
    assert.deepEqual(integer.payload.value, { datatype: "integer", value: 7 });
    const empty = objects.find(record => record.payload.anchor?.pointer === "/nested/empty"); assert.ok(empty);
    const nullFact = current.records.find(record => record.kind === "FACT" && record.payload.subjectId === empty.id && record.payload.predicate === "literalValue");
    assert.deepEqual(nullFact.payload.value, { datatype: "null", value: null });
    assert.equal(old.records.some(record => record.kind === "FACT" && record.payload.predicate === "literalValue"), false);
  }
  if (entryPath.endsWith(".properties") || entryPath.endsWith(".env.dev")) {
    assert.equal(child.payload.anchor.lineStart, 1); assert.equal(parent.payload.kind, "MATERIAL");
    const literal = current.records.find(record => record.kind === "FACT" && record.payload.subjectId === child.id && record.payload.predicate === "literalValue");
    assert.deepEqual(literal.payload.value, { datatype: "string", value: entryPath.endsWith(".env.dev") ? "根😀\r\n后续" : "根😀后续" });
    const physical = current.records.find(record => record.kind === "EVIDENCE" && literal.payload.evidenceIds.includes(record.id));
    assert.equal(physical.payload.anchor.lineStart, 1); assert.equal(physical.payload.anchor.lineEnd, 2);
    assert.equal(JSON.stringify(current.records).includes("NOT_INDEXED"), false);
    assert.ok(current.records.some(record => record.kind === "GAP" && record.payload.code === "CONFIG_SENSITIVE_DECLARATION_RESTRICTED"));
    assert.equal(old.records.some(record => record.kind === "FACT" && record.payload.predicate === "literalValue"), false);
  }
  if (entryPath.endsWith(".md") || entryPath.endsWith(".txt")) {
    const paragraphs = objects.filter(record => record.payload.kind === "DOCUMENT_PARAGRAPH"); assert.ok(paragraphs.length);
    assert.ok(current.records.some(record => record.kind === "FACT" && record.payload.predicate === "literalValue" && record.payload.value.datatype === "string"));
    if (entryPath.endsWith(".md")) {
      const image = objects.find(record => record.payload.kind === "DOCUMENT_IMAGE"); assert.ok(image);
      const imageRef = current.records.find(record => record.kind === "FACT" && record.payload.predicate === "refersTo" && record.payload.subjectId === image.id); assert.ok(imageRef);
      assert.equal(imageRef.payload.basis, "DERIVED"); assert.ok(imageRef.payload.premiseFactIds.length);
      const target = objects.find(record => record.id === imageRef.payload.targetId); assert.equal(target.payload.name, "docs/diagram.png");
      assert.ok(current.records.some(record => record.kind === "FACT" && record.payload.predicate === "refersTo" && record.payload.targetId === child.id && record.payload.premiseFactIds.length === 2));
    }
  }
  if (entryPath === "src/calls.js") {
    const calls = current.records.filter(r => r.kind === "FACT" && r.payload.predicate === "staticCalls"); assert.equal(calls.length, 2);
    const local = calls.find(r => r.payload.targetId === child.id), imported = calls.find(r => r.payload.subjectId === child.id);
    assert.ok(local); assert.ok(imported); assert.equal(local.payload.premiseFactIds.length, 2); assert.equal(imported.payload.premiseFactIds.length, 5);
    const detail = await new F002QueryService(repository, { cursorSecret: "bindings-real-query-test" }).record(owner, "workspace", current.version, "FACT", imported.id);
    assert.ok(imported.payload.premiseFactIds.every(id => detail.references.some(r => r.role === "premise" && r.id === id && r.payload.basis === "DECLARED")));
    assert.equal(detail.references.find(r => r.role === "target").payload.name, "target");
    assert.ok(current.records.some(r => r.kind === "OBJECT" && r.payload.kind === "JAVASCRIPT_CALL" && r.payload.anchor.lineStart === 3));
  }
  if (entryPath === "src/routes.js") {
    const effective = current.records.filter(r => r.kind === "FACT" && r.payload.predicate === "effectivePath"); assert.equal(effective.length, 1);
    assert.equal(effective[0].payload.value.value, "/api/orders/:id"); assert.equal(effective[0].payload.subjectId, child.id); assert.equal(effective[0].payload.premiseFactIds.length, 4);
    const mounts = current.records.filter(r => r.kind === "FACT" && r.payload.predicate === "mountsRouter"); assert.equal(mounts.length, 1); assert.equal(mounts[0].payload.targetId, parent.id); assert.equal(mounts[0].payload.premiseFactIds.length, 5);
    const handler = current.records.find(r => r.kind === "FACT" && r.payload.predicate === "handlesRoute"); assert.ok(handler); assert.equal(handler.payload.targetId, child.id); assert.equal(handler.payload.premiseFactIds.length, 5);
    const detail = await new F002QueryService(repository, { cursorSecret: "express-real-query-test" }).record(owner, "workspace", current.version, "FACT", effective[0].id);
    assert.ok(effective[0].payload.premiseFactIds.every(id => detail.references.some(r => r.role === "premise" && r.id === id)));
    assert.equal(child.payload.anchor.lineStart, 5); assert.equal(child.payload.anchor.lineEnd, 5);
  }
  if (entryPath === "src/Declarations.java") {
    assert.equal(child.payload.anchor.lineStart, 3); assert.equal(child.payload.anchor.lineEnd, 5);
    const signature = current.records.find(r => r.kind === "FACT" && r.payload.subjectId === child.id && r.payload.predicate === "signature");
    assert.deepEqual(signature.payload.value, { datatype: "string", value: "run(String)" });
    const parameter = uniqueDeclaredObject(objects, { materialId: material.id, kind: "JAVA_PARAMETER", name: "label", parentId: child.id });
    assert.ok(current.records.some(r => r.kind === "FACT" && r.payload.predicate === "declaresParameter" && r.payload.subjectId === child.id && r.payload.targetId === parameter.id));
    const annotation = uniqueDeclaredObject(objects, { materialId: material.id, kind: "JAVA_ANNOTATION", name: "Deprecated", parentId: child.id }); assert.equal(annotation.payload.anchor.lineStart, 3);
    const call = current.records.find(r => r.kind === "FACT" && r.payload.predicate === "staticCalls"); assert.ok(call); assert.equal(call.payload.subjectId, child.id); assert.equal(call.payload.premiseFactIds.length, 5);
    const target = uniqueDeclaredObject(objects, { materialId: material.id, kind: "JAVA_METHOD", name: "Example#helper", parentId: parent.id }); assert.equal(call.payload.targetId, target.id);
    const detail = await new F002QueryService(repository, { cursorSecret: "java-real-query-test" }).record(owner, "workspace", current.version, "FACT", call.id);
    assert.ok(call.payload.premiseFactIds.every(id => detail.references.some(r => r.role === "premise" && r.id === id && r.payload.basis === "DECLARED")));
  }
  if(entryPath==="src/BindingCaller.java"){
    const call=current.records.find(r=>r.kind==="FACT"&&r.payload.predicate==="staticCalls");assert.ok(call);
    assert.equal(call.payload.subjectId,child.id);assert.equal(call.payload.premiseFactIds.length,20);
    const target=objects.find(r=>r.id===call.payload.targetId);assert.equal(target.payload.name,"Helper#helper");assert.notEqual(target.payload.materialId,child.payload.materialId);
    assert.equal(target.payload.anchor.lineStart,3);assert.equal(target.payload.anchor.lineEnd,3);
    const detail=await new F002QueryService(repository,{cursorSecret:"java-cross-binding-real-test"}).record(owner,"workspace",current.version,"FACT",call.id);
    assert.ok(call.payload.premiseFactIds.every(id=>detail.references.some(r=>r.role==="premise"&&r.id===id&&r.payload.basis==="DECLARED")));
    assert.ok(current.records.some(r=>r.kind==="OBJECT"&&r.payload.kind==="JAVA_CALL"&&r.payload.anchor.lineStart===4));
    assert.equal(old.records.some(r=>r.kind==="FACT"&&r.payload.predicate==="staticCalls"),false);
  }
  if (entryPath === "src/Controller.java") {
    assert.equal(child.payload.anchor.lineStart, 7); assert.equal(child.payload.anchor.lineEnd, 7);
    const path = current.records.find(r => r.kind === "FACT" && r.payload.predicate === "path" && r.payload.subjectId === child.id);
    const verb = current.records.find(r => r.kind === "FACT" && r.payload.predicate === "httpMethod" && r.payload.subjectId === child.id);
    const handler = current.records.find(r => r.kind === "FACT" && r.payload.predicate === "handlesRoute" && r.payload.targetId === child.id);
    assert.deepEqual(path.payload.value, { datatype: "string", value: "/api/orders/{id}" }); assert.equal(path.payload.premiseFactIds.length, 7);
    assert.deepEqual(verb.payload.value, { datatype: "string", value: "GET" }); assert.equal(verb.payload.premiseFactIds.length, 2);
    assert.equal(handler.payload.subjectId, parent.payload.parentId); assert.equal(handler.payload.premiseFactIds.length, 4);
    const detail = await new F002QueryService(repository, { cursorSecret: "spring-real-query-test" }).record(owner, "workspace", current.version, "FACT", path.id);
    assert.ok(path.payload.premiseFactIds.every(id => detail.references.some(r => r.role === "premise" && r.id === id)));
    assert.ok(detail.references.some(r => r.role === "premise" && r.payload.predicate === "mappingPath" && r.payload.value.value === "/api"));
    assert.ok(detail.references.some(r => r.role === "premise" && r.payload.predicate === "annotationType" && r.payload.value.value === "org.springframework.web.bind.annotation.RestController"));
    assert.equal(current.records.some(r => r.kind === "GAP" && ["JAVA_ANNOTATION_ARGUMENTS_NOT_INTERPRETED", "SPRING_MAPPING_NOT_CONFIGURED"].includes(r.payload.code)), false);
  }
  if (entryPath === "test/assets.js" || entryPath === "test/Assets.java") {
    const java = entryPath.endsWith(".java"), frames = current.records.filter(r => r.kind === "FACT" && r.payload.predicate === "testFramework");
    const testFrame = frames.find(r => r.payload.subjectId === parent.id), assertionFrame = frames.find(r => r.payload.subjectId === child.id);
    assert.equal(testFrame.payload.value.value, java ? "junit-jupiter" : "node:test"); assert.equal(testFrame.payload.premiseFactIds.length, java ? 7 : 6);
    assert.equal(assertionFrame.payload.value.value, java ? "junit-jupiter" : "node:assert/strict"); assert.equal(assertionFrame.payload.premiseFactIds.length, java ? 4 : 5);
    const assertion = current.records.find(r => r.kind === "FACT" && r.payload.predicate === "hasAssertion" && r.payload.subjectId === parent.id && r.payload.targetId === child.id); assert.ok(assertion); assert.equal(assertion.payload.premiseFactIds.length, 2);
    const reference = current.records.find(r => r.kind === "FACT" && r.payload.predicate === "refersTo" && r.payload.subjectId === parent.id); assert.ok(reference); assert.equal(reference.payload.premiseFactIds.length, 2);
    const target = objects.find(r => r.id === reference.payload.targetId); assert.equal(target.payload.name, java ? "Example#subject" : "subject"); assert.equal(target.payload.anchor.lineStart, java ? 7 : 3);
    assert.equal(child.payload.anchor.lineStart, 5); assert.equal(child.payload.anchor.lineEnd, 5);
    const detail = await new F002QueryService(repository, { cursorSecret: "test-assets-real-query-test" }).record(owner, "workspace", current.version, "FACT", reference.id);
    assert.ok(reference.payload.premiseFactIds.every(id => detail.references.some(r => r.role === "premise" && r.id === id)));
    assert.equal(current.records.some(r => r.kind === "FACT" && r.payload.predicate === "reportsResult"), false);
  }
  if (entryPath.startsWith("reports/")) {
    const properties = current.records.filter(r => r.kind === "FACT" && r.payload.subjectId === child.id), property = predicate => properties.find(r => r.payload.predicate === predicate);
    assert.deepEqual(property("reportsResult")?.payload.value, { datatype: "string", value: "PASS" });
    assert.equal(property("reportsResult").payload.basis, entryPath.endsWith(".xml") ? "DERIVED" : "DECLARED");
    assert.equal(property("reportsResult").payload.premiseFactIds.length, entryPath.endsWith(".xml") ? 2 : 0);
    for (const [p, v] of [["reportTestId", "opaque-case"], ["reportSourceBundleId", "d".repeat(64)], ["reportCommand", "node --test"], ["reportEnvironment", "isolated"], ["reportProducer", "untrusted-reporter"], ["reportTestedVersion", "revision-1"]]) assert.equal(property(p)?.payload.value.value, v);
    for (const code of ["EXECUTION_BINDING_MISSING", "REPORT_SOURCE_BINDING_MISMATCH"]) assert.ok(current.records.some(r => r.kind === "GAP" && r.payload.code === code));
    assert.equal(properties.some(r => r.payload.kind === "RELATION" && r.payload.predicate === "refersTo"), false);
  }
  if (["src/contract-routes.js", "src/ContractController.java"].includes(entryPath)) {
    const matching = current.records.filter(r => r.kind === "FACT" && r.payload.predicate === "matchesEndpointContract"); assert.equal(matching.length, 1);
    assert.equal(matching[0].payload.targetId, child.id); assert.equal(matching[0].payload.basis, "DERIVED"); assert.equal(matching[0].payload.premiseFactIds.length, 4);
    const source = objects.find(o => o.id === matching[0].payload.subjectId); assert.equal(source.payload.kind, "OPENAPI_OPERATION"); assert.notEqual(source.payload.materialId, child.payload.materialId);
    const detail = await new F002QueryService(repository, { cursorSecret: "contract-matching-real-test" }).record(owner, "workspace", current.version, "FACT", matching[0].id);
    assert.ok(matching[0].payload.premiseFactIds.every(id => detail.references.some(r => r.role === "premise" && r.id === id)));
    assert.equal(old.records.some(r => r.kind === "FACT" && r.payload.predicate === "matchesEndpointContract"), false);
  }
  assert.equal((await replay.replay(owner, "workspace", current.version)).status, "MATCH");
  assert.equal((await replay.replay(owner, "workspace", old.version)).status, "MATCH");
  if (historicDotenv) {
    assert.equal((await replay.replay(owner, "workspace", historicDotenv.version)).status, "MATCH");
    assert.deepEqual(await readRecords(historicDotenv.version), historicDotenv.records);
  }
  assert.equal(canonicalDigest("FACT_SET_RECORDS", { records: await readRecords(old.version) }), oldDigest);
  const chunks = [];
  for await (const chunk of admission.readFile(owner, "workspace", old.run.id, { componentId, pathBytes: source.entry.pathBytes })) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks); assert.deepEqual(bytes, source.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), source.digest);
  for (const file of source.additional) {
    const chunks = []; for await (const chunk of admission.readFile(owner, "workspace", old.run.id, { componentId, pathBytes: file.entry.pathBytes })) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), file.bytes); assert.equal(createHash("sha256").update(Buffer.concat(chunks)).digest("hex"), file.digest);
  }
});
