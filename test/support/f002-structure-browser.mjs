// Real, worker-sealed @2 structure. No injected API records or layout overrides.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { f002BrowserFixture, fixtureToken, fixtureReaderToken } from "./f002-browser-fixture.js";
import { uniqueDeclaredObject } from "./f002-declared-object.js";

const [modulePath, executablePath, mode] = process.argv.slice(2);
assert.ok(path.isAbsolute(modulePath ?? "") && path.isAbsolute(executablePath ?? ""));
assert.ok(process.argv.length <= 5 && (mode === undefined || ["--json", "--properties", "--dotenv", "--document", "--bindings", "--express", "--java", "--spring", "--node-tests", "--java-tests", "--json-reports", "--xml-reports", "--express-contracts", "--spring-contracts", "--java-bindings"].includes(mode)));
const javaBindingsMode = mode === "--java-bindings";
const expressContractMode = mode === "--express-contracts", springContractMode = mode === "--spring-contracts", contractMode = expressContractMode || springContractMode;
const jsonMode = mode === "--json", propertiesMode = mode === "--properties", dotenvMode = mode === "--dotenv", documentMode = mode === "--document", bindingsMode = mode === "--bindings", expressMode = mode === "--express" || expressContractMode, javaMode = mode === "--java" || javaBindingsMode, springMode = mode === "--spring" || springContractMode, configMode = propertiesMode || dotenvMode;
const nodeTestsMode = mode === "--node-tests", javaTestsMode = mode === "--java-tests", testMode = nodeTestsMode || javaTestsMode;
const xmlReportMode = mode === "--xml-reports", reportMode = xmlReportMode || mode === "--json-reports";
const reportEntry = xmlReportMode ? "junit-report.xml" : "test-report.json";
const reportContent = xmlReportMode ? '<?xml version="1.0" encoding="UTF-8"?>\r\n<testsuite name="suite">\r\n <testcase name="read😀" id="opaque-case" sourceBundleId="' + "d".repeat(64) + '" command="node --test" environment="isolated" producer="untrusted-reporter" testedVersion="revision-1"/>\r\n</testsuite>\r\n'
  : '{\r\n "tests": [\r\n  {"name":"read😀","status":"PASS","testId":"opaque-case","sourceBundleId":"' + "d".repeat(64) + '","command":"node --test","environment":"isolated","producer":"untrusted-reporter","testedVersion":"revision-1"}\r\n ]\r\n}\r\n';
const root = fileURLToPath(new URL("../../", import.meta.url)), api = "http://127.0.0.1:6225", web = "http://127.0.0.1:6226";
const directory = await mkdtemp(path.join(tmpdir(), contractMode ? springContractMode ? "traqen-f002-spring-contracts-browser-" : "traqen-f002-express-contracts-browser-" : reportMode ? xmlReportMode ? "traqen-f002-xml-reports-browser-" : "traqen-f002-json-reports-browser-" : testMode ? javaTestsMode ? "traqen-f002-java-tests-browser-" : "traqen-f002-node-tests-browser-" : jsonMode ? "traqen-f002-json-browser-" : propertiesMode ? "traqen-f002-properties-browser-" : dotenvMode ? "traqen-f002-dotenv-browser-" : documentMode ? "traqen-f002-document-browser-" : bindingsMode ? "traqen-f002-bindings-browser-" : expressMode ? "traqen-f002-express-browser-" : javaMode ? "traqen-f002-java-browser-" : springMode ? "traqen-f002-spring-browser-" : "traqen-f002-structure-browser-"));
const environment = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SHELL"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
const results = [], errors = [], log = [];
const report = { scope: testMode ? javaTestsMode ? "OWNED_SYNTHETIC_F001_F002_JUNIT_TEST_ASSETS_V2" : "OWNED_SYNTHETIC_F001_F002_NODE_TEST_ASSETS_V2" : jsonMode ? "OWNED_SYNTHETIC_F001_F002_JSON_V2" : propertiesMode ? "OWNED_SYNTHETIC_F001_F002_PROPERTIES_V2" : dotenvMode ? "OWNED_SYNTHETIC_F001_F002_DOTENV_V2" : documentMode ? "OWNED_SYNTHETIC_F001_F002_DOCUMENT_V2" : bindingsMode ? "OWNED_SYNTHETIC_F001_F002_JAVASCRIPT_BINDINGS_V2" : expressMode ? "OWNED_SYNTHETIC_F001_F002_EXPRESS_STATIC_V2" : javaMode ? "OWNED_SYNTHETIC_F001_F002_JAVA_DECLARATIONS_V2" : springMode ? "OWNED_SYNTHETIC_F001_F002_SPRING_MAPPINGS_V2" : "OWNED_SYNTHETIC_F001_F002_STRUCTURE_V2", status: "RUNNING", results, errors, hubPreview: "NOT_OPENED", yamlSecurity: "NOT_RUN", f003Runtime: "NOT_CONFIGURED" };
if (reportMode) report.scope = xmlReportMode ? "OWNED_SYNTHETIC_F001_F002_JUNIT_REPORT_V2" : "OWNED_SYNTHETIC_F001_F002_JSON_REPORT_V2";
if (contractMode) report.scope = springContractMode ? "OWNED_SYNTHETIC_F001_F002_SPRING_ENDPOINT_CONTRACT_V2" : "OWNED_SYNTHETIC_F001_F002_EXPRESS_ENDPOINT_CONTRACT_V2";
if(javaBindingsMode) report.scope="OWNED_SYNTHETIC_F001_F002_JAVA_CROSS_BINDINGS_V2";
let fixture, child, browser, page;
const deadline = setTimeout(() => { errors.push("bounded structure browser timed out"); child?.kill("SIGTERM"); void browser?.close(); }, 180_000);
async function read(route, method = "GET") {
  const response = await fetch(`${api}${route}`, { method, headers: { Authorization: `Bearer ${fixtureToken}` }, signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200); return response.json();
}
async function readAll(route) {
  const items = [], seen = new Set(); let cursor = null;
  do {
    const url = new URL(route, api); if (cursor) url.searchParams.set("cursor", cursor);
    const page = await read(url.pathname + url.search); items.push(...page.items); cursor = page.nextCursor;
    assert.ok(items.length <= 20_000 && (!cursor || !seen.has(cursor)), "bounded owned metadata traversal"); if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}
async function authenticate(token = fixtureToken) {
  await page.locator(".workspace-connection").getByText("需要访问令牌", { exact: true }).waitFor();
  await page.getByLabel("访问令牌（仅当前页面内存）", { exact: true }).fill(token);
  const response = page.waitForResponse(value => new URL(value.url()).pathname === "/v1/workspaces" && value.request().headers()["x-traqen-api-token"] === token);
  await page.locator(".workspace-connection").getByRole("button", { name: "验证并连接", exact: true }).click();
  assert.equal((await response).status(), 200);
}
try {
  const { chromium } = await import(pathToFileURL(modulePath).href);
  fixture = await f002BrowserFixture({ structured: true, entryPath: testMode ? javaTestsMode ? "structure-tests.java" : "structure-tests.js" : jsonMode ? "structure-nested.json" : propertiesMode ? "structure-literals.properties" : dotenvMode ? ".env.structure" : documentMode ? "structure-document.md" : bindingsMode ? "structure-bindings.js" : expressMode ? "structure-express.js" : javaMode ? "structure-declarations.java" : springMode ? "structure-controller.java" : "structure-nested.js",
    additionalFiles: contractMode ? [{ entryPath: "contract-api.json", content: '{\r\n "openapi":"3.0.3",\r\n "paths":{"/api/orders/{id}":{"get":{"responses":{"200":{"description":"declared"}}}}}\r\n}\r\n' }] : documentMode ? [{ entryPath: "document-image.png", content: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7yQAAAAASUVORK5CYII=", "base64") }]
      : bindingsMode ? [{ entryPath: "binding-target.js", content: "export function target() { return '😀'; }\r\n" }] : [],
    content: nodeTestsMode ? "import test from 'node:test';\r\nimport assert from 'node:assert/strict';\r\nfunction subject(){return 7;}\r\ntest('reads subject😀',()=>{\r\n  assert.strictEqual(subject(),7);\r\n});\r\n" : javaTestsMode ? 'import org.junit.jupiter.api.Test;\r\nimport static org.junit.jupiter.api.Assertions.assertEquals;\r\nclass Example {\r\n  @Test void read(){\r\n    assertEquals(subject(),7);\r\n  }\r\n  static int subject(){return 7;}\r\n}\r\n' : springMode ? 'import org.springframework.web.bind.annotation.RestController;\r\nimport org.springframework.web.bind.annotation.RequestMapping;\r\nimport org.springframework.web.bind.annotation.GetMapping;\r\n@RestController\r\n@RequestMapping("/api")\r\nclass Orders {\r\n  @GetMapping("/orders/{id}")\r\n  String read(String id) { return "😀"; }\r\n}\r\n' : javaMode ? 'package demo;\r\nclass Example {\r\n  @Deprecated String run(String label) {\r\n    return helper();\r\n  }\r\n  static String helper() {return "😀";}\r\n}\r\n' : expressMode ? "import express from 'express';\r\nconst app=express(); const router=express.Router();\r\nfunction handler(){return '😀';}\r\napp.use('/api',router);\r\nrouter.get('/orders/:id',handler);\r\n" : bindingsMode ? "import {target as alias} from './binding-target.js';\r\nexport function outer() {\r\n  function inner() { alias(); }\r\n  inner();\r\n}\r\n" : documentMode ? '# 根\r\n## Target Section\r\nFirst 原文😀 line\r\nSecond original line\r\n\r\n![图😀](document-image.png)\r\n\r\n[chapter](#target-section)\r\n' : dotenvMode
    ? '# comment\r\n  export title="根😀\r\n后续" # outside\r\nenabled=true\r\nempty=\r\nexport API_TOKEN="FIRST_SECRET_SENTINEL\r\nSECOND_SECRET_SENTINEL"\r\n'
    : propertiesMode
    ? '# comment \\\r\n  title=根😀\\\r\n    后续\r\nenabled=true\r\nempty=\r\npass\\\r\n  word=FIRST_SECRET_SENTINEL\\\r\n  SECOND_SECRET_SENTINEL\r\n'
    : jsonMode
    ? '{\r\n  "根😀": {\r\n    "port": 8080,\r\n    "empty": null\r\n  },\r\n  "safe": true,\r\n  "openapi": "3.0.3",\r\n  "paths": {"/probe": {"get": {"parameters": [{"name": "id", "in": "query"}]}}}\r\n}\r\n'
    : "import 'external-package';\r\nexport function outer() {\r\n  function inner() { return '😀'; }\r\n}\r\nclass Box { run() { function local() {} } }\r\n", ...(reportMode ? { entryPath: reportEntry, content: reportContent } : {}),
    ...(javaBindingsMode ? {entryPath:"Example.java",content:'package demo; import library.Helper;\r\npublic class Example {\r\n @Deprecated String run(String label) {\r\n  return Helper.helper();\r\n }\r\n}\r\n',additionalFiles:[{entryPath:"Helper.java",content:'package library;\r\npublic class Helper {\r\n public static String helper(){return "😀";}\r\n}\r\n'}]} : {}) });
  const meta = await read("/__f002_fixture/metadata"), route = `/v1/workspaces/workspace/deterministic-facts/versions/${meta.standard.graphVersionId}`;
  const objects = await readAll(`${route}/objects?limit=100`), relations = await readAll(`${route}/relations?limit=100`);
  const primaryObjects = objects.filter(record => record.payload.materialId === meta.standard.materialId);
  const parent = reportMode ? uniqueDeclaredObject(primaryObjects, { materialId: meta.standard.materialId, kind: xmlReportMode ? "JUNIT_SUITE" : "JSON_ARRAY", name: xmlReportMode ? "suite" : "tests" }) : jsonMode ? primaryObjects.find(record => record.payload.anchor?.pointer === "/根😀") : configMode ? primaryObjects.find(record => record.payload.kind === "MATERIAL")
    : uniqueDeclaredObject(primaryObjects, { materialId: meta.standard.materialId, kind: testMode ? "TEST_CASE" : documentMode ? "DOCUMENT_SECTION" : expressMode ? "EXPRESS_ROUTER" : javaMode ? "JAVA_TYPE" : springMode ? "JAVA_ANNOTATION" : "FUNCTION", name: nodeTestsMode ? "reads subject😀" : javaTestsMode ? "read" : documentMode ? "Target Section" : expressMode ? "router" : javaMode ? "Example" : springMode ? "GetMapping" : "outer" });
  assert.ok(parent);
  const selected = reportMode ? uniqueDeclaredObject(primaryObjects, { materialId: meta.standard.materialId, kind: "TEST_RESULT", name: "read😀", parentId: parent.id }) : jsonMode ? primaryObjects.find(record => record.payload.anchor?.pointer === "/根😀/port") : documentMode ? primaryObjects.find(record => record.payload.kind === "DOCUMENT_PARAGRAPH" && record.payload.anchor.lineStart === 3)
    : uniqueDeclaredObject(primaryObjects, { materialId: meta.standard.materialId, kind: testMode ? "TEST_ASSERTION" : configMode ? "CONFIG_KEY" : expressMode || springMode ? "ROUTE" : javaMode ? "JAVA_METHOD" : "FUNCTION", name: nodeTestsMode ? "strictEqual" : javaTestsMode ? "assertEquals" : configMode ? "title" : expressMode ? "GET /orders/:id" : javaMode ? "Example#run" : springMode ? "GET /api/orders/{id}" : "inner", parentId: parent.id });
  assert.ok(parent); assert.ok(selected); assert.equal(selected.payload.parentId, parent.id);
  const contains = relations.find(record => record.payload.predicate === "contains" && record.payload.subjectId === parent.id && record.payload.targetId === selected.id);
  assert.ok(contains); assert.equal(contains.payload.ruleRef.version, "2");
  const detail = (await read(`${route}/records/OBJECT/${selected.id}`));
  assert.equal(detail.references.find(reference => reference.role === "parent")?.id, parent.id);
  const manifest = await read(`${route}/manifest`);
  assert.ok(manifest.manifest.rules.ruleVersions.includes(reportMode ? xmlReportMode ? "junit-xml@2" : "json@2" : jsonMode ? "json@2" : configMode ? "properties@2" : documentMode ? "markdown@2" : javaMode || springMode || javaTestsMode ? "java@2" : "javascript@2"));
  if (dotenvMode) {
    const profiles = (await read("/v1/workspaces/workspace/deterministic-facts/profiles")).profiles;
    assert.equal(profiles.find(profile => profile.id === manifest.manifest.profileId)?.extractionLimits.dotenvSyntax, "node-static-v1");
    const content = await fetch(`${api}${route}/materials/${meta.standard.materialId}/content`, {
      headers: { Authorization: `Bearer ${fixtureToken}` }, signal: AbortSignal.timeout(10_000) });
    assert.equal(content.status, 200); assert.equal(content.headers.get("content-type"), "text/plain");
    assert.equal(content.headers.get("x-f002-redacted"), "true"); assert.equal(content.headers.get("x-f002-transform"), "CONFIG_SECRET_VALUE_REDACTION");
    const display = await content.text();
    for (const marker of ["FIRST_SECRET_SENTINEL", "SECOND_SECRET_SENTINEL"]) assert.equal(display.includes(marker), false);
    assert.ok(display.includes("enabled=true")); assert.ok(display.includes('export title="根😀\r\n后续"'));
    report.displayPreflight = { status: content.status, mediaType: content.headers.get("content-type"), redacted: true,
      transform: content.headers.get("x-f002-transform"), originalDigest: content.headers.get("x-f002-original-digest"), displayDigest: content.headers.get("x-f002-display-digest") };
    assert.equal(report.displayPreflight.originalDigest, meta.originalDigest); assert.notEqual(report.displayPreflight.displayDigest, meta.originalDigest);
  }
  const vocabulary = (await read(`${route}/vocabulary`)).vocabulary;
  const expectedPredicates = testMode ? ["contains", "testName", "registrationName", "testBody", "testFramework", "assertionName", "assertionReceiver", "hasAssertion", "refersTo", "staticCalls"] : jsonMode ? ["contains", "type", "literalValue", "declaresParameter"] : configMode ? ["contains", "type", "literalValue"] : documentMode ? ["contains", "literalValue", "refersTo", "path"] : bindingsMode ? ["contains", "staticCalls", "bindingName", "importedName", "exportedName", "path"] : expressMode ? ["contains", "routerKind", "mountsRouter", "effectivePath", "handlesRoute", "path", "httpMethod"] : javaMode ? ["contains", "declares", "declaresParameter", "type", "signature", "annotationName", "packageName", "qualifiedName", "staticCalls"] : springMode ? ["contains", "annotationName", "annotationType", "mappingPath", "mappingMethod", "path", "httpMethod", "handlesRoute"] : ["contains", "declares", "imports"];
  const checkedPredicates = reportMode ? ["contains", "testName", "reportsResult", "reportTestId", "reportSourceBundleId", "reportCommand", "reportEnvironment", "reportProducer", "reportTestedVersion", ...(xmlReportMode ? ["reportOutcomeMarker"] : [])] : expectedPredicates;
  report.vocabularyPreflight = { expected: checkedPredicates, actual: vocabulary.predicates.map(item => item.predicate) };
  for (const predicate of checkedPredicates) assert.ok(vocabulary.predicates.some(item => item.predicate === predicate), `version vocabulary lacks used predicate ${predicate}`);
  if (contractMode) assert.ok(vocabulary.predicates.some(p => p.predicate === "matchesEndpointContract"));
  const verifyContractBrowser = async () => {
    if (!contractMode) return;
    const matches = relations.filter(r => r.payload.predicate === "matchesEndpointContract"); assert.equal(matches.length, 1); const match = matches[0];
    const operation = objects.find(o => o.id === match.payload.subjectId); assert.equal(operation.payload.kind, "OPENAPI_OPERATION"); assert.equal(operation.payload.name, "GET /api/orders/{id}");
    assert.equal(match.payload.targetId, selected.id); assert.equal(match.payload.basis, "DERIVED"); assert.equal(match.payload.premiseFactIds.length, 4);
    const detail = await read(`${route}/records/FACT/${match.id}`); assert.ok(match.payload.premiseFactIds.every(id => detail.references.some(r => r.role === "premise" && r.id === id)));
    assert.equal(new Set(detail.references.filter(r => r.role === "premise").map(p => p.payload.subjectId)).size, 2);
    const row = page.locator(".f002-records tr").filter({ has: page.locator(`code[title="${match.id}"]`) }); await row.getByRole("button").focus(); await row.getByRole("button").press("Enter");
    await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, match.id);
    const statement = `GET /api/orders/{id} — matchesEndpointContract → ${selected.payload.name}`;
    await page.locator(".f002-detail").getByText(statement, { exact: true }).waitFor();
    await page.locator(".f002-detail").getByText(vocabulary.predicates.find(p => p.predicate === "matchesEndpointContract").meaning, { exact: true }).waitFor();
    await page.locator(".f002-detail").getByText("所列前提已载入；不代表业务确认或实际执行。", { exact: true }).waitFor();
    report.contractStatement = await page.locator(".f002-detail [data-evidence-statement]").innerText();
    const source = page.locator(".f002-detail").getByRole("button", { name: /^subject · GET \/api\/orders\/\{id\}/ }); await source.focus(); await source.press("Enter");
    await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, operation.id);
    await page.locator('.f002-code [data-line="3"].selected').waitFor(); assert.equal(await page.locator(".f002-reading h2").innerText(), "contract-api.json");
    await page.screenshot({ path: path.join(directory, "contract-source.png"), fullPage: true });
    await button.focus(); await button.press("Enter"); await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, selected.id);
    await page.locator(`.f002-code [data-line="${physical.lineStart}"].selected`).waitFor();
    assert.notEqual(operation.payload.materialId, selected.payload.materialId); assert.equal(meta.fileCount, 2); assert.equal(meta.additionalSourceStable, true);
    report.endpointContract = { factId: match.id, contractId: operation.id, routeId: selected.id, premiseCount: 4, contractLine: 3, routeLine: physical.lineStart,
      componentBounded: true, declarationOnly: true, fileCount: meta.fileCount, additionalSourceStable: meta.additionalSourceStable };
  };
  if (reportMode) {
    const response = await fetch(`${api}${route}/materials/${meta.standard.materialId}/content`, { headers: { Authorization: `Bearer ${fixtureToken}` }, signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "text/plain");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(await response.text(), reportContent);
    report.reportDisplay = { status: 200, mediaType: "text/plain", nosniff: true, activeXml: false };
  }
  if (jsonMode) {
    const declaration = relations.find(record => record.payload.predicate === "declaresParameter"); assert.ok(declaration);
    const operation = objects.find(record => record.id === declaration.payload.subjectId), parameter = objects.find(record => record.id === declaration.payload.targetId);
    assert.equal(operation?.payload.anchor.pointer, "/paths/~1probe/get"); assert.equal(parameter?.payload.anchor.pointer, "/paths/~1probe/get/parameters/0");
    assert.equal(declaration.payload.basis, "DECLARED"); assert.equal(declaration.payload.ruleRef.version, "2");
    report.parameterDeclaration = { factId: declaration.id, operationId: operation.id, parameterId: parameter.id };
  }
  const physical = jsonMode || (reportMode && !xmlReportMode) ? selected.payload.anchor.textRange : selected.payload.anchor;
  assert.equal(physical.lineStart, testMode ? 5 : configMode ? 2 : expressMode ? 5 : springMode ? 7 : 3); assert.equal(physical.lineEnd, testMode ? 5 : configMode ? 2 : documentMode ? 4 : expressMode || javaMode ? 5 : springMode ? 7 : 3);
  child = spawn(process.execPath, [path.join(root, "web/node_modules/vinext/dist/cli.js"), "dev", "--hostname", "127.0.0.1", "--port", "6226"], {
    cwd: path.join(root, "web"), env: { ...environment, NEXT_PUBLIC_TRAQEN_API_BASE: api, WRANGLER_LOG_PATH: path.join(directory, "wrangler.log") }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => log.push(chunk.toString())); child.stderr.on("data", chunk => log.push(chunk.toString())); child.on("error", error => errors.push(error.message));
  report.startup = { pid: child.pid, startedAt: new Date().toISOString(), port: 6226, lastProbe: null };
  let ready = false; const until = Date.now() + 30_000;
  while (!ready && Date.now() < until && child.exitCode === null) {
    try { const response = await fetch(web, { signal: AbortSignal.timeout(1000) }); ready = response.ok; report.startup.lastProbe = response.status; } catch {}
    if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true);
  browser = await chromium.launch({ executablePath, headless: true, env: environment });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("**/*", request => ["localhost", "127.0.0.1"].includes(new URL(request.request().url()).hostname) ? request.continue() : request.abort());
  page = await context.newPage(); page.setDefaultTimeout(20_000); page.on("pageerror", error => errors.push(error.message));
  const href = `/?${new URLSearchParams({ page: "evidence", workspace: "workspace", tab: "objects", factset: meta.standard.graphVersionId,
    source: meta.sourceVersionId, kind: "MATERIAL", record: meta.standard.materialId })}`;
  await page.goto(`${web}${href}`); await authenticate();
  const materialDetails = page.locator(`[data-directory-material="${meta.standard.materialId}"] > details`), parentDetails = page.locator(`[data-directory-object="${parent.id}"] > details`);
  await materialDetails.locator(":scope > summary").focus(); await materialDetails.locator(":scope > summary").press("Enter");
  const ancestors = []; let ancestor = parent;
  while (ancestor && ancestor.payload.kind !== "MATERIAL") { ancestors.push(ancestor); ancestor = objects.find(record => record.id === ancestor.payload.parentId); }
  for (const owner of ancestors.reverse()) {
    const details = page.locator(`[data-directory-object="${owner.id}"] > details`);
    await details.locator(":scope > summary").focus(); await details.locator(":scope > summary").press("Enter");
  }
  const button = page.locator(`[data-directory-object="${selected.id}"] > button`);
  assert.equal(await button.isVisible(), true); await button.focus(); await button.press("Enter");
  await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, selected.id);
  await page.locator(`.f002-code [data-line="${physical.lineStart}"]`).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("line"), String(physical.lineStart));
  if (jsonMode) {
    await page.locator(".f002-detail").getByText(/JSON Pointer.*根😀\/port.*第 3/).waitFor();
    const facts = (await read(`${route}/facts?limit=100`)).items;
    const literal = facts.find(record => record.payload.subjectId === selected.id && record.payload.predicate === "literalValue");
    const empty = objects.find(record => record.payload.anchor?.pointer === "/根😀/empty");
    const nullFact = facts.find(record => record.payload.subjectId === empty.id && record.payload.predicate === "literalValue");
    assert.deepEqual(literal.payload.value, { datatype: "integer", value: 8080 }); assert.deepEqual(nullFact.payload.value, { datatype: "null", value: null });
    for (const [fact, displayed] of [[literal, /8080（integer）/], [nullFact, /null（null）/]]) {
      const row = page.locator(".f002-records tr").filter({ has: page.locator(`code[title="${fact.id}"]`) });
      await row.getByRole("button").focus(); await row.getByRole("button").press("Enter");
      await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, fact.id);
      await page.locator(".f002-detail").getByText(displayed).waitFor();
    }
    await button.focus(); await button.press("Enter");
    await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, selected.id);
  }
  if (configMode) {
    const titleValue = dotenvMode ? "根😀\r\n后续" : "根😀后续";
    const facts = (await read(`${route}/facts?limit=100`)).items;
    const literal = facts.find(record => record.payload.subjectId === selected.id && record.payload.predicate === "literalValue");
    assert.deepEqual(literal.payload.value, { datatype: "string", value: titleValue });
    const literalDetail = await read(`${route}/records/FACT/${literal.id}`), sourceRange = literalDetail.references.find(record => record.role === "evidence")?.payload.anchor;
    assert.equal(sourceRange.lineStart, 2); assert.equal(sourceRange.lineEnd, 3);
    for (const [name, value, displayed] of [["title", titleValue, dotenvMode ? `${JSON.stringify(titleValue)}（string）` : /"根😀后续"（string）/], ["enabled", "true", /"true"（string）/], ["empty", "", /""（string）/]]) {
      const object = objects.find(record => record.payload.kind === "CONFIG_KEY" && record.payload.name === name);
      const fact = facts.find(record => record.payload.subjectId === object.id && record.payload.predicate === "literalValue");
      assert.deepEqual(fact.payload.value, { datatype: "string", value });
      const row = page.locator(".f002-records tr").filter({ has: page.locator(`code[title="${fact.id}"]`) });
      await row.getByRole("button").focus(); await row.getByRole("button").press("Enter");
      await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, fact.id);
      await page.locator(".f002-detail").getByText(displayed).waitFor();
      if (name === "title") {
        await page.locator('.f002-code [data-line="2"].selected').waitFor(); await page.locator('.f002-code [data-line="3"].selected').waitFor();
      }
    }
    const gaps = (await read(`${route}/gaps?limit=100`)).items;
    assert.ok(gaps.some(record => record.payload.code === "CONFIG_SENSITIVE_DECLARATION_RESTRICTED"));
    for (const marker of ["FIRST_SECRET_SENTINEL", "SECOND_SECRET_SENTINEL"]) {
      assert.equal(JSON.stringify([...objects, ...facts, ...relations, ...gaps]).includes(marker), false);
      assert.equal((await page.locator(".f002-code").textContent()).includes(marker), false);
    }
    await button.focus(); await button.press("Enter");
    await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, selected.id);
    report.configuration = { literalFactId: literal.id, lineStart: sourceRange.lineStart, lineEnd: sourceRange.lineEnd, sensitiveValuesAbsent: true,
      ...(dotenvMode ? { dialect: "node-static-v1" } : {}) };
  }
  if (documentMode) {
    assert.equal(meta.fileCount, 2); assert.equal(meta.additionalSourceStable, true);
    const facts = (await read(`${route}/facts?limit=100`)).items, literal = facts.find(record => record.payload.subjectId === selected.id && record.payload.predicate === "literalValue");
    assert.deepEqual(literal.payload.value, { datatype: "string", value: "First 原文😀 line\r\nSecond original line" });
    const choose = async fact => {
      const row = page.locator(".f002-records tr").filter({ has: page.locator(`code[title="${fact.id}"]`) });
      await row.getByRole("button").focus(); await row.getByRole("button").press("Enter");
      await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, fact.id);
    };
    await choose(literal); await page.locator(".f002-detail").getByText(`${JSON.stringify(literal.payload.value.value)}（string）`).waitFor();
    await page.locator('.f002-code [data-line="3"].selected').waitFor(); await page.locator('.f002-code [data-line="4"].selected').waitFor();
    const image = objects.find(record => record.payload.kind === "DOCUMENT_IMAGE"), imageReference = relations.find(record => record.payload.subjectId === image.id && record.payload.predicate === "refersTo");
    assert.ok(imageReference); const imageDetail = await read(`${route}/records/FACT/${imageReference.id}`);
    assert.ok(imageReference.payload.premiseFactIds.length); assert.ok(imageReference.payload.premiseFactIds.every(id => imageDetail.references.some(ref => ref.role === "premise" && ref.id === id)));
    const imageTarget = imageDetail.references.find(ref => ref.role === "target"); assert.equal(imageTarget.payload.name, "document-image.png");
    await choose(imageReference); await page.locator(".f002-detail").getByText("所列前提已载入；不代表业务确认或实际执行。", { exact: true }).waitFor();
    const targetButton = page.locator(".f002-detail").getByRole("button", { name: /^target · document-image\.png/ });
    await targetButton.focus(); await targetButton.press("Enter");
    await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, imageTarget.id);
    await page.locator(".f002-raster img").waitFor(); assert.deepEqual(await page.locator(".f002-raster img").evaluate(img => [img.naturalWidth, img.naturalHeight]), [1, 1]);
    await page.screenshot({ path: path.join(directory, "document-image.png"), fullPage: true });
    const chapter = relations.find(record => record.payload.predicate === "refersTo" && record.payload.targetId === parent.id); assert.ok(chapter); assert.equal(chapter.payload.premiseFactIds.length, 2);
    await choose(chapter); await page.locator(".f002-detail").getByText("所列前提已载入；不代表业务确认或实际执行。", { exact: true }).waitFor();
    await button.focus(); await button.press("Enter"); await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, selected.id);
    await page.locator('.f002-code [data-line="3"].selected').waitFor(); await page.locator('.f002-code [data-line="4"].selected').waitFor();
    report.document = { paragraphFactId: literal.id, imageReferenceFactId: imageReference.id, chapterReferenceFactId: chapter.id, chapterPremiseCount: 2,
      imageMaterialObjectId: imageTarget.id, imageDecoded: [1, 1], physical: [3, 4], fileCount: meta.fileCount, additionalSourceStable: meta.additionalSourceStable };
  }
  if (bindingsMode) {
    assert.equal(meta.fileCount, 2); assert.equal(meta.additionalSourceStable, true);
    const calls = relations.filter(r => r.payload.predicate === "staticCalls"), imported = calls.find(r => r.payload.subjectId === selected.id), local = calls.find(r => r.payload.targetId === selected.id);
    assert.equal(calls.length, 2); assert.ok(imported); assert.ok(local); assert.equal(imported.payload.premiseFactIds.length, 5); assert.equal(local.payload.premiseFactIds.length, 2);
    for (const fact of [local, imported]) {
      const detail = await read(`${route}/records/FACT/${fact.id}`); assert.ok(fact.payload.premiseFactIds.every(id => detail.references.some(r => r.role === "premise" && r.id === id && r.payload.basis === "DECLARED")));
      const row = page.locator(".f002-records tr").filter({ has: page.locator(`code[title="${fact.id}"]`) });
      await row.getByRole("button").focus(); await row.getByRole("button").press("Enter");
      await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, fact.id);
      await page.locator(".f002-detail").getByText("所列前提已载入；不代表业务确认或实际执行。", { exact: true }).waitFor();
      assert.equal(await page.locator(".f002-detail [data-premise-notice]").count(), 1);
    }
    const target = page.locator(".f002-detail").getByRole("button", { name: /^target · target/ }); await target.focus(); await target.press("Enter");
    await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, imported.payload.targetId);
    await page.locator('.f002-code [data-line="1"]').waitFor(); assert.match(await page.locator(".f002-code").innerText(), /export function target/);
    await page.screenshot({ path: path.join(directory, "bindings-target.png"), fullPage: true });
    await button.focus(); await button.press("Enter"); await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, selected.id);
    await page.locator('.f002-code [data-line="3"].selected').waitFor();
    report.bindings = { localFactId: local.id, importedFactId: imported.id, localPremiseCount: 2, importedPremiseCount: 5, targetId: imported.payload.targetId,
      callLine: 3, targetLine: 1, fileCount: meta.fileCount, additionalSourceStable: meta.additionalSourceStable };
  }
  if (expressMode) {
    const facts = (await read(`${route}/facts?limit=100`)).items;
    const mounted = facts.find(r => r.payload.subjectId === selected.id && r.payload.predicate === "effectivePath"), mount = relations.find(r => r.payload.predicate === "mountsRouter"), handler = relations.find(r => r.payload.predicate === "handlesRoute");
    assert.ok(mounted); assert.ok(mount); assert.ok(handler); assert.deepEqual(mounted.payload.value, { datatype: "string", value: "/api/orders/:id" });
    assert.equal(mounted.payload.premiseFactIds.length, 4); assert.equal(mount.payload.premiseFactIds.length, 5); assert.equal(handler.payload.premiseFactIds.length, 5);
    for (const fact of [mounted, mount, handler]) {
      const detail = await read(`${route}/records/FACT/${fact.id}`); assert.ok(fact.payload.premiseFactIds.every(id => detail.references.some(r => r.role === "premise" && r.id === id)));
      const row = page.locator(".f002-records tr").filter({ has: page.locator(`code[title="${fact.id}"]`) }); await row.getByRole("button").focus(); await row.getByRole("button").press("Enter");
      await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, fact.id);
      await page.locator(".f002-detail").getByText("所列前提已载入；不代表业务确认或实际执行。", { exact: true }).waitFor();
      if (fact === mounted) {
        const statement = page.locator(".f002-detail [data-evidence-statement]");
        await page.locator(".f002-detail").getByText('GET /orders/:id · effectivePath = "/api/orders/:id"（string）', { exact: true }).waitFor();
        report.expressStatement = await statement.innerText();
      }
    }
    const target = page.locator(".f002-detail").getByRole("button", { name: /^subject · handler/ }); await target.focus(); await target.press("Enter");
    await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, handler.payload.subjectId);
    await page.locator('.f002-code [data-line="3"].selected').waitFor(); await page.screenshot({ path: path.join(directory, "express-handler.png"), fullPage: true });
    await button.focus(); await button.press("Enter"); await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, selected.id); await page.locator('.f002-code [data-line="5"].selected').waitFor();
    report.express = { effectiveFactId: mounted.id, mountFactId: mount.id, handlerFactId: handler.id, path: mounted.payload.value.value,
      pathPremiseCount: 4, mountPremiseCount: 5, handlerPremiseCount: 5, routeLine: 5, handlerLine: 3 };
  }
  if (javaMode) {
    const facts = await readAll(`${route}/facts?limit=100`);
    const signature = facts.find(r => r.payload.subjectId === selected.id && r.payload.predicate === "signature"); assert.ok(signature);
    assert.deepEqual(signature.payload.value, { datatype: "string", value: "run(String)" });
    const parameter = uniqueDeclaredObject(primaryObjects, { materialId: meta.standard.materialId, kind: "JAVA_PARAMETER", name: "label", parentId: selected.id });
    const declaration = relations.find(r => r.payload.predicate === "declaresParameter" && r.payload.subjectId === selected.id && r.payload.targetId === parameter.id); assert.ok(declaration);
    const annotation = uniqueDeclaredObject(primaryObjects, { materialId: meta.standard.materialId, kind: "JAVA_ANNOTATION", name: "Deprecated", parentId: selected.id }); assert.equal(annotation.payload.anchor.lineStart, 3);
    const call = relations.find(r => r.payload.predicate === "staticCalls" && r.payload.subjectId === selected.id); assert.ok(call); assert.equal(call.payload.premiseFactIds.length, javaBindingsMode ? 20 : 5);
    const target = javaBindingsMode ? objects.find(r=>r.id===call.payload.targetId) : uniqueDeclaredObject(primaryObjects, { materialId: meta.standard.materialId, kind: "JAVA_METHOD", name: "Example#helper", parentId: parent.id }); assert.equal(call.payload.targetId, target.id);
    if(javaBindingsMode){
      assert.equal(target.payload.name,"Helper#helper");assert.notEqual(target.payload.materialId,selected.payload.materialId);
      const detail=await read(`${route}/records/FACT/${call.id}`);assert.ok(call.payload.premiseFactIds.every(id=>detail.references.some(p=>p.role==="premise"&&p.id===id&&p.payload.basis==="DECLARED")));
      for(const predicate of ["visibility","hasTypeParameters","lexicalShadow","importKind"])assert.ok(vocabulary.predicates.some(p=>p.predicate===predicate));
    }
    for (const fact of [signature, call]) {
      const row = page.locator(".f002-records tr").filter({ has: page.locator(`code[title="${fact.id}"]`) }); await row.getByRole("button").focus(); await row.getByRole("button").press("Enter");
      await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, fact.id);
      if (fact === signature) await page.locator(".f002-detail").getByText('Example#run · signature = "run(String)"（string）', { exact: true }).waitFor();
      else {
        await page.locator(".f002-detail").getByText("所列前提已载入；不代表业务确认或实际执行。", { exact: true }).waitFor();
        if(javaBindingsMode){await page.locator(".f002-detail").getByText("Example#run — staticCalls → Helper#helper",{exact:true}).waitFor();report.javaBindingStatement=await page.locator(".f002-detail [data-evidence-statement]").innerText();}
      }
    }
    const link = page.locator(".f002-detail").getByRole("button", { name: javaBindingsMode ? /^target · Helper#helper/ : /^target · Example#helper/ }); await link.focus(); await link.press("Enter");
    await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, target.id); await page.locator(`.f002-code [data-line="${javaBindingsMode ? 3 : 6}"].selected`).waitFor();
    if(javaBindingsMode){assert.equal(await page.locator(".f002-reading h2").innerText(),"Helper.java");assert.equal(meta.fileCount,2);assert.equal(meta.additionalSourceStable,true);}
    await page.screenshot({ path: path.join(directory, "java-static-target.png"), fullPage: true });
    await button.focus(); await button.press("Enter"); await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, selected.id);
    await page.locator('.f002-code [data-line="3"].selected').waitFor(); await page.locator('.f002-code [data-line="5"].selected').waitFor();
    report.java = { methodId: selected.id, signatureFactId: signature.id, parameterId: parameter.id, annotationId: annotation.id, callFactId: call.id, premiseCount: javaBindingsMode ? 20 : 5, targetId: target.id, callLine: 4, targetLine: javaBindingsMode ? 3 : 6 };
    if(javaBindingsMode)report.javaBindings={...report.java,fileCount:meta.fileCount,additionalSourceStable:meta.additionalSourceStable,componentBounded:true,declarationOnly:true};
  }
  if (springMode) {
    const facts = (await read(`${route}/facts?limit=100`)).items;
    const pathFact = facts.find(r => r.payload.subjectId === selected.id && r.payload.predicate === "path");
    const verb = facts.find(r => r.payload.subjectId === selected.id && r.payload.predicate === "httpMethod");
    const handler = relations.find(r => r.payload.predicate === "handlesRoute" && r.payload.targetId === selected.id);
    assert.ok(pathFact); assert.ok(verb); assert.ok(handler);
    assert.deepEqual(pathFact.payload.value, { datatype: "string", value: "/api/orders/{id}" }); assert.equal(pathFact.payload.premiseFactIds.length, 7);
    assert.deepEqual(verb.payload.value, { datatype: "string", value: "GET" }); assert.equal(verb.payload.premiseFactIds.length, 2);
    assert.equal(handler.payload.premiseFactIds.length, 4); assert.equal(handler.payload.subjectId, parent.payload.parentId);
    const method = primaryObjects.find(r => r.id === handler.payload.subjectId); assert.equal(method.payload.name, "Orders#read"); assert.equal(method.payload.anchor.lineStart, 7); assert.equal(method.payload.anchor.lineEnd, 8);
    for (const fact of [pathFact, verb, handler]) {
      const detail = await read(`${route}/records/FACT/${fact.id}`);
      assert.ok(fact.payload.premiseFactIds.every(id => detail.references.some(r => r.role === "premise" && r.id === id)));
      if (fact === pathFact) {
        assert.ok(detail.references.some(r => r.role === "premise" && r.payload.predicate === "mappingPath" && r.payload.value.value === "/api"));
        assert.ok(detail.references.some(r => r.role === "premise" && r.payload.predicate === "mappingPath" && r.payload.value.value === "/orders/{id}"));
        assert.ok(detail.references.some(r => r.role === "premise" && r.payload.predicate === "annotationType" && r.payload.value.value === "org.springframework.web.bind.annotation.RestController"));
      }
      const row = page.locator(".f002-records tr").filter({ has: page.locator(`code[title="${fact.id}"]`) }); await row.getByRole("button").focus(); await row.getByRole("button").press("Enter");
      await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, fact.id);
      await page.locator(".f002-detail").getByText("所列前提已载入；不代表业务确认或实际执行。", { exact: true }).waitFor();
      if (fact === pathFact) {
        await page.locator(".f002-detail").getByText('GET /api/orders/{id} · path = "/api/orders/{id}"（string）', { exact: true }).waitFor();
        report.springStatement = await page.locator(".f002-detail [data-evidence-statement]").innerText();
      }
    }
    const link = page.locator(".f002-detail").getByRole("button", { name: /^subject · Orders#read/ }); await link.focus(); await link.press("Enter");
    await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, method.id);
    await page.locator('.f002-code [data-line="8"].selected').waitFor(); await page.screenshot({ path: path.join(directory, "spring-handler.png"), fullPage: true });
    await button.focus(); await button.press("Enter"); await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, selected.id);
    await page.locator('.f002-code [data-line="7"].selected').waitFor();
    report.spring = { pathFactId: pathFact.id, httpMethodFactId: verb.id, handlerFactId: handler.id, path: pathFact.payload.value.value,
      pathPremiseCount: 7, methodPremiseCount: 2, handlerPremiseCount: 4, routeLine: 7, handlerLine: 8 };
  }
  await verifyContractBrowser();
  if (reportMode) {
    const facts = (await read(`${route}/facts?limit=100`)).items, gaps = (await read(`${route}/gaps?limit=100`)).items;
    const property = p => { const found = facts.filter(f => f.payload.subjectId === selected.id && f.payload.predicate === p); assert.equal(found.length, 1); return found[0]; };
    const outcome = property("reportsResult"), identity = property("reportTestId");
    assert.deepEqual(outcome.payload.value, { datatype: "string", value: "PASS" }); assert.equal(outcome.payload.basis, xmlReportMode ? "DERIVED" : "DECLARED");
    assert.equal(outcome.payload.premiseFactIds.length, xmlReportMode ? 2 : 0); assert.equal(identity.payload.value.value, "opaque-case");
    for (const [p, expected] of [["reportSourceBundleId", "d".repeat(64)], ["reportCommand", "node --test"], ["reportEnvironment", "isolated"], ["reportProducer", "untrusted-reporter"], ["reportTestedVersion", "revision-1"]]) assert.equal(property(p).payload.value.value, expected);
    assert.equal(relations.some(r => r.payload.subjectId === selected.id && r.payload.predicate === "refersTo"), false, "an opaque report test-id never grants a code binding");
    for (const fact of [identity, outcome]) {
      const row = page.locator(".f002-records tr").filter({ has: page.locator(`code[title="${fact.id}"]`) }); await row.getByRole("button").focus(); await row.getByRole("button").press("Enter");
      await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, fact.id);
      const statement = `read😀 · ${fact.payload.predicate} = "${fact.payload.value.value}"（string）`;
      await page.locator(".f002-detail").getByText(statement, { exact: true }).waitFor();
      await page.locator(".f002-detail").getByText(vocabulary.predicates.find(p => p.predicate === fact.payload.predicate).meaning, { exact: true }).waitFor();
      if (fact === outcome) {
        report.reportStatement = await page.locator(".f002-detail [data-evidence-statement]").innerText();
        const detail = await read(`${route}/records/FACT/${outcome.id}`);
        assert.ok(outcome.payload.premiseFactIds.every(id => detail.references.some(r => r.role === "premise" && r.id === id)));
        if (xmlReportMode) await page.locator(".f002-detail").getByText("所列前提已载入；不代表业务确认或实际执行。", { exact: true }).waitFor();
      }
    }
    const missing = gaps.find(g => g.payload.materialId === meta.standard.materialId && g.payload.code === "EXECUTION_BINDING_MISSING"), mismatch = gaps.find(g => g.payload.materialId === meta.standard.materialId && g.payload.code === "REPORT_SOURCE_BINDING_MISMATCH");
    assert.ok(missing); assert.ok(mismatch);
    await page.locator(".f002-tabs").getByRole("link", { name: "覆盖与缺口", exact: true }).click();
    for (const gap of [missing, mismatch]) {
      const row = page.locator(`[data-gap-id="${gap.id}"]`); await row.getByRole("button").focus(); await row.getByRole("button").press("Enter");
      await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, gap.id);
      await page.locator(".f002-detail [data-gap-explanation]").getByText(gap.payload.code, { exact: true }).waitFor();
    }
    await page.screenshot({ path: path.join(directory, "report-binding-limitation.png"), fullPage: true });
    await page.locator(".f002-tabs").getByRole("link", { name: "对象与事实", exact: true }).click();
    await button.focus(); await button.press("Enter"); await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, selected.id);
    await page.locator('.f002-code [data-line="3"].selected').waitFor();
    report.testReport = { resultId: selected.id, outcomeFactId: outcome.id, identityFactId: identity.id, missingBindingGapId: missing.id, mismatchedSourceGapId: mismatch.id,
      result: "PASS", basis: outcome.payload.basis, premiseCount: outcome.payload.premiseFactIds.length, trust: "REPORT_DECLARATION_ONLY", automaticTestBinding: false, physical: [3, 3] };
  }
  if (testMode) {
    const facts = (await read(`${route}/facts?limit=100`)).items;
    const frames = facts.filter(r => r.payload.predicate === "testFramework"), testFrame = frames.find(r => r.payload.subjectId === parent.id), assertionFrame = frames.find(r => r.payload.subjectId === selected.id);
    assert.ok(testFrame); assert.ok(assertionFrame);
    assert.deepEqual(testFrame.payload.value, { datatype: "string", value: javaTestsMode ? "junit-jupiter" : "node:test" }); assert.equal(testFrame.payload.premiseFactIds.length, javaTestsMode ? 7 : 6);
    assert.deepEqual(assertionFrame.payload.value, { datatype: "string", value: javaTestsMode ? "junit-jupiter" : "node:assert/strict" }); assert.equal(assertionFrame.payload.premiseFactIds.length, javaTestsMode ? 4 : 5);
    const assertion = relations.find(r => r.payload.predicate === "hasAssertion" && r.payload.subjectId === parent.id && r.payload.targetId === selected.id);
    const reference = relations.find(r => r.payload.predicate === "refersTo" && r.payload.subjectId === parent.id);
    const body = relations.find(r => r.payload.predicate === "testBody" && r.payload.subjectId === parent.id);
    assert.ok(assertion); assert.ok(reference); assert.ok(body); assert.equal(assertion.payload.premiseFactIds.length, 2); assert.equal(reference.payload.premiseFactIds.length, 2);
    assert.equal([...facts, ...relations].some(r => r.payload.predicate === "reportsResult"), false, "test declarations never fabricate execution results");
    const target = objects.find(r => r.id === reference.payload.targetId); assert.equal(target.payload.name, javaTestsMode ? "Example#subject" : "subject"); assert.equal(target.payload.anchor.lineStart, javaTestsMode ? 7 : 3);
    for (const fact of [assertionFrame, assertion, reference]) {
      const detail = await read(`${route}/records/FACT/${fact.id}`); assert.ok(fact.payload.premiseFactIds.every(id => detail.references.some(r => r.role === "premise" && r.id === id)));
      const row = page.locator(".f002-records tr").filter({ has: page.locator(`code[title="${fact.id}"]`) }); await row.getByRole("button").focus(); await row.getByRole("button").press("Enter");
      await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, fact.id);
      await page.locator(".f002-detail").getByText("所列前提已载入；不代表业务确认或实际执行。", { exact: true }).waitFor();
      if (fact === assertionFrame) {
        await page.locator(".f002-detail").getByText(javaTestsMode ? 'assertEquals · testFramework = "junit-jupiter"（string）' : 'strictEqual · testFramework = "node:assert/strict"（string）', { exact: true }).waitFor();
        report.testStatement = await page.locator(".f002-detail [data-evidence-statement]").innerText();
      }
    }
    const link = page.locator(".f002-detail").getByRole("button", { name: javaTestsMode ? /^target · Example#subject/ : /^target · subject/ }); await link.focus(); await link.press("Enter");
    await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, target.id);
    await page.locator(`.f002-code [data-line="${javaTestsMode ? 7 : 3}"].selected`).waitFor(); await page.screenshot({ path: path.join(directory, "test-subject.png"), fullPage: true });
    await button.focus(); await button.press("Enter"); await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, selected.id);
    await page.locator('.f002-code [data-line="5"].selected').waitFor();
    report.testAssets = { testCaseId: parent.id, assertionId: selected.id, testFrameFactId: testFrame.id, assertionFrameFactId: assertionFrame.id, bodyFactId: body.id, hasAssertionFactId: assertion.id, subjectReferenceFactId: reference.id,
      testPremiseCount: javaTestsMode ? 7 : 6, assertionPremiseCount: javaTestsMode ? 4 : 5, relationPremiseCount: 2, referencePremiseCount: 2, assertionLine: 5, targetLine: javaTestsMode ? 7 : 3, executionResultAbsent: true };
  }
  await page.screenshot({ path: path.join(directory, "structure-nested.png"), fullPage: true });
  results.push({ case: testMode ? javaTestsMode ? "actual-junit-direct-test-assertion-imports-body-proof-and-keyboard-subject-without-execution-claim" : "actual-node-lexical-test-assertion-imports-body-proof-and-keyboard-subject-without-execution-claim" : jsonMode ? "actual-json-v2-parent-pointer-typed-integer-null-used-parameter-vocabulary-and-keyboard-physical-range" : propertiesMode ? "actual-properties-v2-logical-string-empty-physical-range-and-secret-retirement-without-runtime-inference" : dotenvMode ? "actual-dotenv-v2-export-quoted-multiline-string-physical-range-and-safe-current-display-without-evaluation" : documentMode ? "actual-document-v2-multiline-original-paragraph-image-and-chapter-reference-premises-keyboard-read" : bindingsMode ? "actual-lexical-nested-and-imported-call-premises-keyboard-exact-two-material-source-navigation" : expressMode ? "actual-express-literal-mount-path-handler-premises-and-keyboard-physical-source-navigation" : javaMode ? "actual-java-ast-package-method-signature-parameter-annotation-static-premises-and-keyboard-source-target" : springMode ? "actual-spring-exact-import-class-method-literal-path-condition-premises-and-keyboard-handler-source" : "actual-v2-parent-and-contains-fact-drive-keyboard-nested-directory-and-exact-source-range", passed: true });
  if (reportMode) results.at(-1).case = xmlReportMode ? "actual-bounded-junit-report-result-premises-opaque-id-source-mismatch-inert-read-and-keyboard-limitation" : "actual-json-report-literal-result-exact-fields-opaque-id-source-mismatch-and-keyboard-limitation";
  if (contractMode) results.at(-1).case = springContractMode ? "actual-spring-openapi-component-path-shape-four-premise-contract-and-keyboard-two-source-navigation" : "actual-express-openapi-component-path-shape-four-premise-contract-and-keyboard-two-source-navigation";
  if (javaBindingsMode) results.at(-1).case = "actual-java-explicit-import-twenty-declared-premise-cross-material-static-binding-and-keyboard-source-navigation";
  await page.reload();
  assert.equal(await page.locator(".f002-code").count(), 0, "no material bytes before current member authentication");
  await authenticate(); await button.waitFor();
  assert.equal(await materialDetails.getAttribute("open"), ""); if (!configMode) assert.equal(await parentDetails.getAttribute("open"), "");
  assert.equal(await button.getAttribute("aria-current"), "true");
  await page.locator(`.f002-code [data-line="${physical.lineStart}"]`).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("factset"), meta.standard.graphVersionId);
  await page.screenshot({ path: path.join(directory, "structure-restored.png"), fullPage: true });
  results.push({ case: "current-member-authorized-refresh-restores-declared-ancestors-without-historical-substitution", passed: true });
  await page.locator(".f002-auth > summary").click();
  await page.getByLabel("成员访问令牌（仅本页内存）", { exact: true }).fill(fixtureReaderToken);
  const reader = page.waitForResponse(response => new URL(response.url()).pathname === "/v1/workspaces/workspace/deterministic-facts" && response.request().headers().authorization === `Bearer ${fixtureReaderToken}`);
  await page.locator(".f002-auth").getByRole("button", { name: "验证并连接", exact: true }).click(); assert.equal((await reader).status(), 200);
  await page.locator(".f002-code").waitFor(); await materialDetails.waitFor();
  assert.equal(await materialDetails.getAttribute("open"), null, "owner expansion preferences are not reader preferences");
  const revoked = page.waitForResponse(response => response.status() === 403 && new URL(response.url()).pathname.startsWith("/v1/workspaces/workspace/deterministic-facts"));
  await read("/__f002_fixture/revoke-reader", "POST"); await revoked;
  await page.getByRole("heading", { name: "访问已停止", exact: true }).waitFor();
  assert.equal(await page.locator(".f002-code, [data-directory-object]").count(), 0);
  assert.equal(new URL(page.url()).searchParams.get("record"), selected.id);
  await page.screenshot({ path: path.join(directory, "structure-revoked.png"), fullPage: true });
  const final = await read("/__f002_fixture/metadata"); assert.equal(final.sourceStable, true); assert.equal(final.startRunCount, 0);
  if (bindingsMode || documentMode || contractMode) assert.equal(final.additionalSourceStable, true);
  report.structure = { graphVersionId: meta.standard.graphVersionId, parentId: parent.id, childId: selected.id, containsFactId: contains.id,
    lineStart: physical.lineStart, lineEnd: physical.lineEnd, ...(jsonMode ? { pointer: selected.payload.anchor.pointer } : {}), sourceStable: final.sourceStable, startRunCount: final.startRunCount };
  results.push({ case: "structure-preferences-are-member-isolated-and-live-revocation-retires-directory-and-bytes", passed: true });
} catch (error) {
  errors.push(error.stack ?? error.message);
  if (page) try { await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true }); } catch {}
} finally {
  clearTimeout(deadline); await browser?.close();
  if (child && child.exitCode === null) { child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
  await fixture?.close(); await writeFile(path.join(directory, "frontend.log"), log.join(""), { flag: "wx" });
  report.status = errors.length ? "FAILED" : "PASSED";
  await writeFile(path.join(directory, "summary.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ ...report, parentPath: `${directory}/`, childPath: "summary.json" })); process.exitCode = errors.length ? 1 : 0;
}
