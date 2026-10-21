import assert from "node:assert/strict";
import { open } from "node:fs/promises";
import test from "node:test";

import { F002AdmissionService } from "../src/deterministic-facts/admission.js";
import { F002Error } from "../src/deterministic-facts/errors.js";
import { createProfileId } from "../src/deterministic-facts/identity.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { SourceCandidateService } from "../src/source-truth/candidate-service.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";
import { SourceTruthRepository } from "../src/source-truth/repository.js";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { owner, reader } from "./support/source-truth-database.js";
import { isolatedPostgres } from "./support/source-truth-postgres.js";

function profile() {
  const input = {
    version: "1", schemaVersion: 1, capabilityIds: ["inventory"], ruleVersions: ["inventory@1"],
    canonicalizationVersion: "1", extractionLimits: { maxBytes: 1024, maxRecords: 10 }, redactionPolicyRevision: "policy-v1",
  };
  return { ...input, id: createProfileId(input), name: "inventory", startable: true };
}

async function sourceFixture(t, { acceptance = {}, ...options } = {}) {
  const fixture = await candidateFixture(t, options);
  const prepared = await fixture.candidates.prepare(fixture.context);
  await fixture.advance("RECONCILING", "REVIEW_REQUIRED");
  const publication = new SourcePublicationService(fixture.repository, fixture.candidates);
  const confirmation = await publication.confirm(owner, fixture.context, {
    candidateId: prepared.id, gapSetId: prepared.gapSetId, ...(typeof acceptance === "function" ? acceptance() : acceptance),
  });
  const result = await publication.seal(owner, fixture.context, { confirmationId: confirmation.id, clientToken: "freeze" });
  const sourceRepository = fixture.repository;
  const repository = new F002Repository(fixture.db, {
    authorize: (actor, workspaceId, tx, maintain) => fixture.repository.authorize(actor, workspaceId, maintain, tx),
  });
  await repository.registerProfile(profile());
  const service = new F002AdmissionService(repository, new SourceAdmissionService(sourceRepository, fixture.candidates));
  return { ...fixture, result, sourceRepository, repository, service, reference: { bundleId: result.bundle.id, receiptId: result.receipt.id } };
}

function request(reference, overrides = {}) {
  return {
    operationId: "admit-inventory", reference, profile: profile(),
    scopes: [{ label: "full component", selections: [{ kind: "COMPONENT", componentId: "a".repeat(64) }] }],
    ...overrides,
  };
}

test("F002 creates source bindings only through F001 qualification and resumes no-Fact source bytes by durable run id", async (t) => {
  const f = await sourceFixture(t);
  const inventory = await new SourceAdmissionService(f.sourceRepository, f.candidates).inventory(reader, "workspace", f.reference);
  const start = request(f.reference, {
    scopes: [{ label: "all", selections: [{ kind: "COMPONENT", componentId: inventory.items[0].componentId }] }],
  });
  await assert.rejects(f.service.start(reader, "workspace", start), { code: "SOURCE_FORBIDDEN" });
  const run = await f.service.start(owner, "workspace", start);
  const resumedInventory = await f.service.inventory(reader, "workspace", run.id);
  assert.equal(resumedInventory.items.length, 1);
  const chunks = [];
  for await (const bytes of f.service.readFile(reader, "workspace", run.id, {
    componentId: resumedInventory.items[0].componentId, pathBytes: f.entry.pathBytes,
  })) chunks.push(bytes);
  assert.deepEqual(Buffer.concat(chunks), f.bytes, "reading has no Fact precondition and reuses the F001 stream");
  await assert.rejects(
    f.service.start(reader, "workspace", request(f.reference, { sourceInput: { qualifiedAt: "2000-01-01" } })),
    { code: "F002_SOURCE_INPUT_FORBIDDEN" },
  );
  await assert.rejects(f.service.inventory(reader, "workspace", "unregistered"), { code: "F002_RUN_NOT_FOUND" });
});

test("F002 repository writes and reads recheck the current Workspace ACL", async (t) => {
  const f = await sourceFixture(t);
  const inventory = await new SourceAdmissionService(f.sourceRepository, f.candidates).inventory(reader, "workspace", f.reference);
  const run = await f.service.start(owner, "workspace", request(f.reference, {
    scopes: [{ label: "all", selections: [{ kind: "COMPONENT", componentId: inventory.items[0].componentId }] }],
  }));
  await f.sourceRepository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "MAINTAIN" }, { actorId: "reader", role: "REVOKED" }] });
  await assert.rejects(f.repository.getRun(reader, "workspace", run.id), { code: "SOURCE_FORBIDDEN" });
  await assert.rejects(
    f.repository.claimScope(reader, "workspace", run.id, run.scopes[0].scopeId, { workerId: "worker", leaseMs: 1_000 }),
    { code: "SOURCE_FORBIDDEN" },
  );
});

test("F002 admission consumes the frozen Inventory before accepting a scope selector", async (t) => {
  const f = await sourceFixture(t);
  await assert.rejects(f.service.start(owner, "workspace", request(f.reference, {
    operationId: "out-of-inventory-scope", scopes: [{ selections: [{ kind: "ENTRY", componentId: "a".repeat(64), pathBytes: Buffer.from("not-in-inventory.js").toString("base64url") }] }],
  })), { code: "F002_SCOPE_OUT_OF_INVENTORY" });
});

test("F002 retries a lost run-start response from its durable binding after Receipt expiry", async (t) => {
  const f = await sourceFixture(t, { acceptance: () => ({ expiresAt: new Date(Date.now() + 50).toISOString() }) });
  const inventory = await new SourceAdmissionService(f.sourceRepository, f.candidates).inventory(owner, "workspace", f.reference);
  const start = request(f.reference, { operationId: "lost-start-response", scopes: [{ label: "all", selections: [{ kind: "COMPONENT", componentId: inventory.items[0].componentId }] }] });
  const first = await f.service.start(owner, "workspace", start);
  f.service.sourceAdmission.qualify = async () => { throw new F002Error("SOURCE_ACCEPTANCE_EXPIRED", "new qualification expired", { status: 409 }); };
  const recovered = await f.service.start(owner, "workspace", start);
  assert.equal(recovered.id, first.id, "the retry rechecks the durable qualified binding instead of creating a new qualification");
});

test("F002 keeps a server-qualified binding across restart but fences expired new starts, ACL revocation, restore failure, and content corruption", { skip: !process.env.F001_TEST_PG_BIN }, async (t) => {
  const cluster = await isolatedPostgres(t);
  const database = await cluster.createDatabase();
  const f = await sourceFixture(t, {
    database: () => database,
    git: true,
    gaps: [{ ruleCode: "GIT_LFS_EXTERNAL", severity: "NON_BLOCKING", ruleVersion: "v1", affectedScope: "external-content" }],
    acceptance: () => ({ reason: "bounded F002 resume test", expiresAt: new Date(Date.now() + 1500).toISOString() }),
  });
  const ordinaryInventory = await new SourceAdmissionService(f.sourceRepository, f.candidates).inventory(reader, "workspace", f.reference);
  const run = await f.service.start(owner, "workspace", request(f.reference, {
    scopes: [{ label: "all", selections: [{ kind: "COMPONENT", componentId: ordinaryInventory.items[0].componentId }] }],
  }));
  const qualified = (await f.repository.sourceBinding("workspace", run.id)).sourceInput;

  await cluster.restart();
  const db = cluster.pool(database.name);
  const sourceRepository = new SourceTruthRepository(db);
  const candidates = new SourceCandidateService(sourceRepository, new SourceMaterialRepository(sourceRepository), f.blobs);
  const repository = new F002Repository(db, {
    authorize: (actor, workspaceId, tx, maintain) => sourceRepository.authorize(actor, workspaceId, maintain, tx),
  });
  const service = new F002AdmissionService(repository, new SourceAdmissionService(sourceRepository, candidates));
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(qualified.receiptValidUntil) - Date.now() + 10)));

  await assert.rejects(
    service.start(owner, "workspace", request(f.reference, { operationId: "expired-new-start", scopes: [{ label: "all", selections: [{ kind: "COMPONENT", componentId: ordinaryInventory.items[0].componentId }] }] })),
    { code: "SOURCE_ACCEPTANCE_EXPIRED" },
  );
  assert.equal((await service.inventory(reader, "workspace", run.id)).items.length, 1, "the persistent binding resumes without a fresh qualification");
  await sourceRepository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "MAINTAIN" }, { actorId: "reader", role: "REVOKED" }] });
  await assert.rejects(service.inventory(reader, "workspace", run.id), { code: "SOURCE_FORBIDDEN" });
  await sourceRepository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "MAINTAIN" }, { actorId: "reader", role: "READ" }] });
  await db.query("UPDATE source_truth_workspace SET restore_ready=false WHERE workspace_id='workspace'");
  await assert.rejects(service.inventory(reader, "workspace", run.id), { code: "SOURCE_RESTORE_UNVERIFIED" });
  await db.query("UPDATE source_truth_workspace SET restore_ready=true WHERE workspace_id='workspace'");
  const location = await f.blobs.location({ tenantId: "tenant", workspaceId: "workspace" }, "blobs", f.digest);
  const file = await open(location, "r+");
  const stat = await file.stat();
  const byte = Buffer.alloc(1);
  await file.read(byte, 0, 1, stat.size - 1);
  byte[0] ^= 1;
  await file.write(byte, 0, 1, stat.size - 1);
  await file.close();
  const read = async () => {
    const chunks = [];
    for await (const bytes of service.readFile(reader, "workspace", run.id, { componentId: ordinaryInventory.items[0].componentId, pathBytes: f.entry.pathBytes })) chunks.push(bytes);
    return Buffer.concat(chunks);
  };
  await assert.rejects(read(), { code: "SOURCE_CONTENT_CORRUPT" });
});
