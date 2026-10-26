import assert from "node:assert/strict";
import test from "node:test";
import { isolatedPostgres } from "./support/source-truth-postgres.js";
import { investigationFixture } from "./support/f003-investigation-fixture.js";
import { owner } from "./support/source-truth-database.js";
import { SourceTruthRepository } from "../src/source-truth/repository.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";
import { SourceCandidateService } from "../src/source-truth/candidate-service.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { InvestigationService } from "../src/business-knowledge/investigation-service.js";
import { InvestigationWorker } from "../src/business-knowledge/worker.js";

test("F003 native PostgreSQL restart preserves exact source, immutable checkpoints, graph and original budget", { skip: !process.env.F001_TEST_PG_BIN, timeout: 60000 }, async t => {
  const cluster = await isolatedPostgres(t);
  let databaseName;
  const f = await investigationFixture(t, { database: async () => { const created = await cluster.createDatabase(); databaseName = created.name; return created; } });
  const run = await f.service.start(owner, "workspace", f.request);
  // External reasoning alone is a fixture. PostgreSQL, F001 admission/source
  // bytes, F003 persistence and native stop/start are actual implementations.
  const worker = new InvestigationWorker({ investigations: f.service, invokeModel: async context => {
    const { input } = context, reservation = await f.service.reserveModelCall(owner, "workspace", run.id, context);
    const result = input.phase === "PLAN" ? { assignments: [{ slotId: "child-1", obligations: ["核查本任务原文条件、反例与未供应前提（机制替身）"], objective: "read frozen evidence", materialKeys: input.inventory.map(m => m.key) }] }
      : input.phase === "INVESTIGATE" ? { candidates: [], relations: [] } : { reviews: [] };
    return { result, reservationId: reservation.id };
  } });
  await worker.run(owner, "workspace", run.id, { workerId: "before-restart" });
  const graph = await f.service.graph(owner, "workspace", run.id), before = await f.service.get(owner, "workspace", run.id);
  const checkpoints = await f.service.checkpoints(owner, "workspace", run.id);
  assert.ok(checkpoints.some(c => c.key === "graph"));
  await cluster.restart();
  const db = cluster.pool(databaseName), sources = new SourceTruthRepository(db);
  const candidates = new SourceCandidateService(sources, new SourceMaterialRepository(sources), f.blobs);
  const service = new InvestigationService({ sources, sourceAdmission: new SourceAdmissionService(sources, candidates), profiles: f.profiles });
  const recovered = await service.get(owner, "workspace", run.id);
  assert.deepEqual(recovered.sourceInput, before.sourceInput);
  assert.deepEqual(recovered.usage, before.usage);
  assert.deepEqual(await service.checkpoints(owner, "workspace", run.id), checkpoints);
  assert.deepEqual(await service.graph(owner, "workspace", run.id), graph);
  const material = await service.evidenceMaterial(owner, "workspace", run.id, graph.materials[0].id);
  assert.deepEqual(material.bytes, f.bytes);
  const events = await service.events(owner, "workspace", run.id);
  assert.equal(events.filter(e => e.event_type === "ANALYSIS_COLLECTED").length, 1);
  // This is restart persistence only, not an independent-volume paired restore,
  // real-model quality assessment, production permission or release approval.
});
