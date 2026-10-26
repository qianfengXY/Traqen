import assert from "node:assert/strict";
import test from "node:test";
import { createF002Runtime, technicalF002Profile } from "../src/deterministic-facts/runtime.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { owner } from "./support/source-truth-database.js";

test("F002 consumes real F001 frozen TS/config/SQL/test/docs, automatically publishes, reads original and replays its fixed result", async t => {
  const content = `export function submit(id: string) { const enabled = process.env.SUBMIT_ENABLED; if(enabled) return db.query('UPDATE orders SET status=$1 WHERE id=$2', [id]); return null; }`;
  const java = "class Loop { String item; void f(java.util.List<String> items) { for (String item : items) { use(item); } } }";
  const source = await candidateFixture(t, { entryPath: "src/service.ts", directoryPaths: ["src", "config", "db", "test", "docs"], content, additionalFiles: [
    { entryPath: "config/app.properties", content: "SUBMIT_ENABLED=true\nAPI_TOKEN=NEVER_INDEXED_SECRET\n" },
    { entryPath: "db/schema.sql", content: "CREATE TABLE IF NOT EXISTS orders (id TEXT, status TEXT);" },
    { entryPath: "test/service.test.ts", content: "import test from 'node:test'; import assert from 'node:assert/strict'; import {submit} from '../src/service.js'; test('conditional submit', () => { assert.equal(submit('id'), null); });" },
    { entryPath: "docs/rules.md", content: "# Submit\n\n[Implementation](../src/service.ts)\n\n[Test plan](../test/service.test.ts)" },
    { entryPath: "src/Loop.java", content: java },
  ] });
  const prepared = await source.candidates.prepare(source.context);
  await source.advance("RECONCILING", "REVIEW_REQUIRED");
  const publisher = new SourcePublicationService(source.repository, source.candidates);
  const confirmation = await publisher.confirm(owner, source.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId });
  const frozen = await publisher.seal(owner, source.context, { confirmationId: confirmation.id, clientToken: "technical-journey-source" });
  const runtime = await createF002Runtime({ sourceRuntime: { pool: source.db, services: { repository: source.repository, admission: new SourceAdmissionService(source.repository, source.candidates) },
    configuration: { members: [{ ...owner, tokenDigest: "a".repeat(64) }], origins: [] } }, cursorSecret: "technical-journey-owned-cursor-secret" });
  t.after(() => runtime.close());
  const reference = { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id };
  const inventory = await runtime.services.admission.sourceAdmission.inventory(owner, "workspace", reference);
  assert.equal(inventory.items.filter(item => item.disposition.disposition === "VERIFIED").length, 6);
  const componentId = inventory.items.find(item => item.entry.pathBytes === source.entry.pathBytes).componentId;
  const run = await runtime.services.admission.start(owner, "workspace", { operationId: "technical-journey", reference, profile: technicalF002Profile(),
    scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  await runtime.services.executor.enqueue(run);
  const scope = await runtime.services.repository.getScope(owner, "workspace", run.id, run.scopes[0].scopeId);
  assert.equal(scope.status, "SEALED", JSON.stringify(scope));
  const records = (await source.db.query("SELECT kind,id,payload FROM f002_record WHERE graph_version_id=$1", [scope.graphVersionId])).rows;
  const facts = records.filter(record => record.kind === "FACT").map(record => record.payload);
  for (const predicate of ["withinBranch", "readsBinding", "matchesConfigKey", "embedsSql", "writesTable", "matchesSqlTable", "callsDeclaration", "declaredTestBody", "declaredAssertion", "refersTo"]) {
    assert.ok(facts.some(fact => fact.predicate === predicate), predicate);
  }
  assert.equal(JSON.stringify(records).includes("NEVER_INDEXED_SECRET"), false);
  const objects = new Map(records.filter(record => record.kind === "OBJECT").map(record => [record.id, record.payload]));
  const javaMaterial = records.find(record => record.kind === "MATERIAL" && record.payload.pathBytes === Buffer.from("src/Loop.java").toString("base64url"));
  const loopRead = facts.find(fact => fact.predicate === "readsBinding" && objects.get(fact.subjectId)?.materialId === javaMaterial.id
    && objects.get(fact.subjectId)?.anchor.byteStart === java.indexOf("item);"));
  assert.equal(objects.get(loopRead?.targetId)?.anchor.byteStart, java.indexOf("item :"), "the immutable version must retain the loop binding, not the field");
  const ts = records.find(record => record.kind === "MATERIAL" && record.payload.pathBytes === source.entry.pathBytes);
  const read = await runtime.services.materials.read(owner, "workspace", scope.graphVersionId, ts.id);
  assert.equal(read.bytes.toString(), content);
  assert.equal(read.originalDigest, source.digest);
  const replay = await runtime.services.replays.replay(owner, "workspace", scope.graphVersionId);
  assert.equal(replay.status, "MATCH", JSON.stringify(replay));
  const coverage = (await source.db.query("SELECT capability_id,status FROM f002_scope_item WHERE run_id=$1 AND material_id=$2", [run.id, ts.id])).rows;
  assert.equal(coverage.find(item => item.capability_id === "program-logic").status, "DONE");
  assert.equal(coverage.find(item => item.capability_id === "typescript").status, "DONE");
});
