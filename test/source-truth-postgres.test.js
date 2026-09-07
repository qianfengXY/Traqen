import assert from "node:assert/strict";
import test from "node:test";
import { isolatedPostgres } from "./support/source-truth-postgres.js";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { owner, reader } from "./support/source-truth-database.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { SourceTruthRepository, transaction } from "../src/source-truth/repository.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { SourceCandidateService } from "../src/source-truth/candidate-service.js";
import { SourceMaterialRepository } from "../src/source-truth/material-repository.js";

test("real PostgreSQL B-05/08/11 multi-connection, atomic publication and restart", { skip: !process.env.F001_TEST_PG_BIN, timeout: 120000 }, async (t) => {
  const cluster = await isolatedPostgres(t);
  async function fixture(st, options = {}) {
    const database = await cluster.createDatabase();
    const f = await candidateFixture(st, { database: () => database });
    const candidate = await f.candidates.prepare(f.context);
    await f.advance("RECONCILING", "REVIEW_REQUIRED");
    const publication = new SourcePublicationService(f.repository, f.candidates, options);
    const confirmation = await publication.confirm(owner, f.context, { candidateId: candidate.id, gapSetId: candidate.gapSetId });
    return { ...f, name: database.name, candidate, publication, confirmation };
  }
  await t.test("independent transactions have different server backends and uncommitted writes stay private", async () => {
    const { db } = await cluster.createDatabase();
    let enter, release;
    const entered = new Promise((r) => { enter = r; }), blocked = new Promise((r) => { release = r; });
    const left = transaction(db, async (tx) => {
      const pid = (await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await tx.query("UPDATE project SET name='uncommitted' WHERE id='workspace'");
      enter(pid); await blocked; throw new Error("deliberate rollback");
    });
    const rejection = assert.rejects(left, /deliberate rollback/);
    const leftPid = await entered;
    try {
      await transaction(db, async (tx) => {
        assert.notEqual((await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid, leftPid);
        assert.equal((await tx.query("SELECT name FROM project WHERE id='workspace'")).rows[0].name, "Workspace");
      });
    } finally { release(); }
    await rejection;
    assert.equal((await db.query("SELECT name FROM project WHERE id='workspace'")).rows[0].name, "Workspace");
  });
  await t.test("concurrent seals return a single receipt; restart keeps it immutable and readable", async (st) => {
    let arrivals = 0, release;
    const barrier = new Promise((r) => { release = r; });
    const f = await fixture(st, { beforeCommit: async () => { if (++arrivals === 2) release(); await barrier; } });
    const results = await Promise.all(["a", "b"].map((clientToken) => f.publication.seal(owner, f.context, { confirmationId: f.confirmation.id, clientToken })));
    assert.equal(results[0].receipt.id, results[1].receipt.id);
    assert.equal((await f.db.query("SELECT count(*)::int n FROM source_truth_receipt")).rows[0].n, 1);
    await cluster.restart();
    const db = cluster.pool(f.name), repository = new SourceTruthRepository(db);
    const candidates = new SourceCandidateService(repository, new SourceMaterialRepository(repository), f.blobs);
    const publication = new SourcePublicationService(repository, candidates);
    assert.deepEqual(await publication.result(reader, "workspace", f.context.runId), results[0]);
    assert.equal((await publication.seal(owner, f.context, { confirmationId: f.confirmation.id, clientToken: "after-restart" })).receipt.id, results[0].receipt.id);
    const admission = new SourceAdmissionService(repository, candidates);
    assert.equal((await admission.qualify(reader, "workspace", { bundleId: f.candidate.id, receiptId: results[0].receipt.id })).bundleId, f.candidate.id);
    await assert.rejects(db.query("DELETE FROM source_truth_receipt"), /append-only|immutable/i);
  });
  await t.test("cancel and revocation linearize before seal and cannot expose a prepared candidate", async (st) => {
    for (const action of ["cancel", "revoke"]) {
      let enter, release;
      const entered = new Promise((r) => { enter = r; }), blocked = new Promise((r) => { release = r; });
      const f = await fixture(st, { beforeCommit: async () => { enter(); await blocked; } });
      const sealing = f.publication.seal(owner, f.context, { confirmationId: f.confirmation.id, clientToken: action });
      const rejection = assert.rejects(sealing, { code: action === "cancel" ? "SOURCE_STALE_WORKER" : "SOURCE_FORBIDDEN" });
      await entered;
      try {
        assert.equal((await f.repository.listBundles(reader, "workspace")).length, 0);
        if (action === "cancel") await f.repository.cancel(owner, "workspace", f.context.runId);
        else await f.repository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "REVOKED" }] });
      } finally { release(); }
      await rejection;
      assert.equal((await f.db.query("SELECT count(*)::int n FROM source_truth_bundle")).rows[0].n, 0);
      assert.equal((await f.db.query("SELECT count(*)::int n FROM source_truth_receipt")).rows[0].n, 0);
    }
  });
  await t.test("database failure inside final publication rolls back bundle, receipt and run together", async (st) => {
    const f = await fixture(st);
    await f.db.query(`CREATE FUNCTION fail_test_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt storage failure'; END $$;
      CREATE TRIGGER fail_test_receipt BEFORE INSERT ON source_truth_receipt FOR EACH ROW EXECUTE FUNCTION fail_test_receipt();`);
    const input = { confirmationId: f.confirmation.id, clientToken: "database-failure" };
    await assert.rejects(f.publication.seal(owner, f.context, input), /injected receipt storage failure/);
    assert.equal((await f.repository.listBundles(reader, "workspace")).length, 0);
    assert.equal((await f.repository.getRun(reader, "workspace", f.context.runId)).status, "PREPARING_SEAL");
    await f.db.query("DROP TRIGGER fail_test_receipt ON source_truth_receipt");
    const result = await f.publication.seal(owner, f.context, input);
    assert.equal(result.receipt.status, "READY");
    assert.equal((await f.db.query("SELECT count(*)::int n FROM source_truth_publication_operation")).rows[0].n, 1);
  });
});
