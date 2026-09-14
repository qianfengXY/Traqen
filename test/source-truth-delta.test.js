import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { owner, reader } from "./support/source-truth-database.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { SourceDeltaService } from "../src/source-truth/delta-service.js";
import { pathBytes } from "../src/source-truth/identity.js";

test("B-03 file-level delta uses complete manifests for additions, changes and deletions, with paged exact locators", async (t) => {
  const f = await candidateFixture(t);
  const publication = new SourcePublicationService(f.repository, f.candidates);
  const seal = async (context) => {
    const candidate = await f.candidates.prepare(context);
    await f.repository.transition("workspace", context.runId, { generation: context.generation, expectedStatus: "RECONCILING", status: "REVIEW_REQUIRED" });
    const confirmation = await publication.confirm(owner, context, { candidateId: candidate.id, gapSetId: candidate.gapSetId });
    return publication.seal(owner, context, { confirmationId: confirmation.id, clientToken: context.runId });
  };
  const first = await seal(f.context);
  let revision = 1;
  const next = async (files, sourceId = "registration") => {
    const source = { sourceId, kind: "DIRECTORY_UPLOAD", scope: { kind: "UPLOADED_DIRECTORY" } };
    await f.repository.saveDraft(owner, "workspace", { expectedRevision: revision++, input: { sources: [source] } });
    const run = await f.repository.startRun(owner, "workspace", { draftRevision: revision, policyRevisionId: "policy-v1" });
    const lease = await f.repository.claimRun("workspace", run.id, { workerId: "w", leaseMs: 60000 });
    const context = { workspaceId: "workspace", runId: run.id, generation: lease.generation, sourceId: source.sourceId };
    const advance = (from, to) => f.repository.transition("workspace", run.id, { generation: context.generation, expectedStatus: from, status: to });
    await advance("PREFLIGHTING", "ENUMERATING");
    await f.materials.addSource(context, source);
    for (const [name, text] of files) {
      const bytes = Buffer.from(text), digest = createHash("sha256").update(bytes).digest("hex");
      await f.materials.appendEntries(context, [{ pathBytes: pathBytes(name), kind: "FILE", sizeBytes: String(bytes.length), expectedContent: { algorithm: "sha256", digest }, gitMode: null }]);
      await f.blobs.putBlob({ workspaceId: "workspace", tenantId: "tenant" }, { digest, sizeBytes: String(bytes.length) }, [bytes]);
    }
    await f.materials.closeEnumeration(context, { fileCount: String(files.length), directoryCount: "0" });
    await f.materials.freezeManifest(context);
    for (const [name, text] of files) await f.materials.dispose(context, { pathBytes: pathBytes(name), disposition: "VERIFIED", reasonCode: "CONTENT_VERIFIED", digest: createHash("sha256").update(text).digest("hex"), sizeBytes: String(Buffer.byteLength(text)) });
    await advance("ENUMERATING", "MANIFEST_FROZEN"); await advance("MANIFEST_FROZEN", "CAPTURING"); await advance("CAPTURING", "RECONCILING");
    return seal(context);
  };
  const second = await next([["a", "changed"], ["b", ""]]);
  const delta = new SourceDeltaService(f.repository);
  const input = { fromBundleId: first.bundle.id, toBundleId: second.bundle.id, sourceId: "registration", limit: 1 };
  const page = await delta.compare(reader, "workspace", input);
  assert.equal(page?.comparable, true);
  assert.deepEqual(page.counts, { added: "1", modified: "1", deleted: "0", unchanged: "0" });
  assert.equal(page.items[0].change, "MODIFIED");
  assert.equal(page.items[0].before.bundleId, first.bundle.id);
  const last = await delta.compare(reader, "workspace", { ...input, cursor: page.nextCursor });
  assert.equal(last.items[0].change, "ADDED");
  assert.equal(last.nextCursor, null);
  const third = await next([["b", ""]]);
  const removed = await delta.compare(reader, "workspace", { fromBundleId: second.bundle.id, toBundleId: third.bundle.id, sourceId: "registration" });
  assert.deepEqual(removed.counts, { added: "0", modified: "0", deleted: "1", unchanged: "1" });
  assert.equal(removed.items[0].change, "DELETED");
  assert.equal(removed.items[0].after, null);
  const fourth = await next([["c", "new registration"]], "another-directory");
  for (const [sourceId, reason] of [["registration", "SOURCE_REMOVED"], ["another-directory", "SOURCE_ADDED"]]) {
    const sourceChange = await delta.compare(reader, "workspace", { fromBundleId: third.bundle.id, toBundleId: fourth.bundle.id, sourceId });
    assert.equal(sourceChange.comparable, false);
    assert.equal(sourceChange.reason, reason);
    assert.equal(sourceChange.counts, null, "component removal/addition is not a file deletion/addition count");
    assert.deepEqual(sourceChange.items, []);
    assert.equal(sourceChange.nextCursor, null);
  }
  await assert.rejects(delta.compare(reader, "workspace2", input), { code: "SOURCE_FORBIDDEN" });
});
