import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LegacyUnderstandingRuntime } from "../src/application/legacy-understanding-runtime.js";
import { createLocalSourceSnapshotBroker } from "../src/application/local-source-snapshot-broker.js";
import { TraceabilityApplication } from "../src/application/traceability-application.js";
import { createTraceabilityHttpServer } from "../src/api/http-server.js";
import { MemoryTraceabilityStore } from "../src/storage/index.js";
import {
  deterministicFixtureChildProducer,
  fixtureEquivalenceResolver,
  fixtureReviewedEvaluationResolver,
} from "./helpers/legacy-understanding-fixture.js";

test("allowlisted HTTP SourceRegistration starts and reads the real server-owned F001 job", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "traqen-f001-http-"));
  const source = path.join(temporary, "source");
  const snapshots = path.join(temporary, "snapshots");
  await mkdir(source);
  await mkdir(snapshots);
  await writeFile(path.join(source, "entry.js"), "export function httpStartedCapability() {}\n");
  const store = new MemoryTraceabilityStore();
  const broker = createLocalSourceSnapshotBroker({ store, snapshotRoot: snapshots });
  const runtime = new LegacyUnderstandingRuntime({
    store, allowlistedRoots: [source], snapshotRoot: snapshots, sourceSliceBroker: broker,
    childProducer: deterministicFixtureChildProducer,
    equivalenceResolver: fixtureEquivalenceResolver,
    reviewedEvaluationResolver: fixtureReviewedEvaluationResolver("entry.js"),
  });
  const application = new TraceabilityApplication({
    store, sourceSliceBroker: broker, legacyUnderstandingRuntime: runtime,
  });
  const server = createTraceabilityHttpServer({ application });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/v1/projects/P`;
  const registrationResponse = await fetch(`${base}/source-registrations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootPath: source, displayName: "HTTP source" }),
  });
  assert.equal(registrationResponse.status, 201);
  const registration = await registrationResponse.json();
  assert.equal(Object.hasOwn(registration, "canonicalRootRef"), false);
  const startResponse = await fetch(`${base}/workspace-analysis-jobs?async=false`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceRegistrationId: registration.id, requestedMode: "AUTO" }),
  });
  assert.equal(startResponse.status, 201);
  const completed = await startResponse.json();
  assert.equal(completed.status, "COMPLETED");
  const readResponse = await fetch(`${base}/workspace-analysis-jobs/${completed.id}`);
  assert.equal(readResponse.status, 200);
  assert.equal((await readResponse.json()).outputs.PUBLISHING.currentGraphHead.version, 1);
  const graphResponse = await fetch(`${base}/graph/current`);
  assert.equal(graphResponse.status, 200);
  const graph = await graphResponse.json();
  assert.equal(graph.graphArtifact.id, graph.revision.graphArtifactId);
  assert.ok(graph.graphArtifact.nodes.some(({ authority }) => authority === "CANDIDATE"));
});
