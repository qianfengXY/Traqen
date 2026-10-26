import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createF002Runtime, technicalF002Profile } from "../src/deterministic-facts/runtime.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { isolatedPostgres } from "./support/source-truth-postgres.js";
import { owner } from "./support/source-truth-database.js";

test("F002 native timeout publishes nothing; explicit retry retains the same frozen bytes and immutable failure history", async t => {
  const cluster = await isolatedPostgres(t);
  const content = "const f = () => 1; export function invoke() { return f(); } invoke();\n";
  const source = await candidateFixture(t, { database: () => cluster.createDatabase(), entryPath: "src/invoke.js", content, directoryPaths: ["src"] });
  const prepared = await source.candidates.prepare(source.context);
  await source.advance("RECONCILING", "REVIEW_REQUIRED");
  const publisher = new SourcePublicationService(source.repository, source.candidates);
  const confirmation = await publisher.confirm(owner, source.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId });
  const frozen = await publisher.seal(owner, source.context, { confirmationId: confirmation.id, clientToken: "timeout-source" });
  const runtime = await createF002Runtime({ sourceRuntime: { pool: source.db,
    services: { repository: source.repository, admission: new SourceAdmissionService(source.repository, source.candidates) },
    configuration: { members: [{ ...owner, tokenDigest: "a".repeat(64) }], origins: [] } }, cursorSecret: "timeout-owned-cursor" });
  t.after(() => runtime.close());
  const reference = { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id };
  const inventory = await runtime.services.admission.sourceAdmission.inventory(owner, "workspace", reference);
  const componentId = inventory.items[0].componentId;
  const run = await runtime.services.admission.start(owner, "workspace", { operationId: "native-timeout", reference, profile: technicalF002Profile(),
    scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const scopeId = run.scopes[0].scopeId;
  // A deliberately tiny test-only bound exercises the actual native watchdog,
  // not an injected compiler wrapped in an incorrect whole-scope 10s timer.
  const first = await runtime.services.worker.run(owner, "workspace", run.id, scopeId, { workerId: "controlled-timeout", leaseMs: 60000, timeoutMs: 1 });
  assert.equal(first.status, "FAILED_RETRYABLE");
  assert.equal(first.diagnostic.code, "F002_PARSE_TIMEOUT");
  assert.equal(first.diagnostic.parser.deadline, "unit");
  assert.equal(first.diagnostic.parser.phase, "STARTUP");
  assert.equal(first.diagnostic.parser.unitBudgetMs, 1);
  assert.equal(first.diagnostic.parser.wallBudgetMs, 1200000);
  const count = async table => (await source.db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  assert.equal(await count("f002_fact_set"), 0);
  assert.equal(await count("f002_record"), 0);
  assert.equal(await count("f002_prepared_record"), 0);
  assert.equal((await source.db.query("SELECT DISTINCT status FROM f002_scope_item WHERE run_id=$1", [run.id])).rows[0].status, "PENDING");
  const events = async () => (await source.db.query("SELECT sequence,event_type,payload FROM f002_event WHERE run_id=$1 ORDER BY sequence", [run.id])).rows;
  const failedEvent = (await events()).find(event => event.event_type === "SCOPE_FAILED_RETRYABLE");
  assert.deepEqual(failedEvent.payload, first.diagnostic);
  await runtime.services.executor.enqueue(await runtime.services.repository.getRun(owner, "workspace", run.id));
  let failed = await runtime.services.repository.getScope(owner, "workspace", run.id, scopeId);
  assert.equal(failed.status, "FAILED_RETRYABLE");
  assert.equal(failed.generation, 1, "polling must not implicitly retry a failed parser");
  await runtime.services.repository.retryScope(owner, "workspace", run.id, scopeId, { revision: failed.revision, operationId: "explicit-timeout-retry" });
  // Normal executor uses its unchanged 10s-per-unit / 20min-total budgets.
  await runtime.services.executor.enqueue(await runtime.services.repository.getRun(owner, "workspace", run.id));
  const sealed = await runtime.services.repository.getScope(owner, "workspace", run.id, scopeId);
  assert.equal(sealed.status, "SEALED", JSON.stringify(sealed));
  assert.equal(sealed.generation, 2);
  const same = await runtime.services.repository.getRun(owner, "workspace", run.id);
  assert.deepEqual(same.sourceInput, run.sourceInput);
  assert.equal(same.profileId, run.profileId);
  assert.deepEqual((await events()).find(event => event.sequence === failedEvent.sequence), failedEvent);
  const material = (await source.db.query("SELECT id FROM f002_record WHERE graph_version_id=$1 AND kind='MATERIAL' AND payload->>'contentAvailable'='true'", [sealed.graphVersionId])).rows[0];
  const original = await runtime.services.materials.read(owner, "workspace", sealed.graphVersionId, material.id);
  assert.equal(original.bytes.toString(), content);
  assert.equal(original.originalDigest, createHash("sha256").update(content).digest("hex"));
  assert.equal((await runtime.services.replays.replay(owner, "workspace", sealed.graphVersionId)).status, "MATCH");
});
