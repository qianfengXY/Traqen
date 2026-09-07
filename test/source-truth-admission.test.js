import assert from "node:assert/strict";
import { open } from "node:fs/promises";
import test from "node:test";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { owner, reader } from "./support/source-truth-database.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";

async function fixture(t) {
  const f = await candidateFixture(t);
  const prepared = await f.candidates.prepare(f.context);
  await f.advance("RECONCILING", "REVIEW_REQUIRED");
  const publication = new SourcePublicationService(f.repository, f.candidates);
  const confirmation = await publication.confirm(owner, f.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId });
  const result = await publication.seal(owner, f.context, { confirmationId: confirmation.id, clientToken: "freeze" });
  const admission = new SourceAdmissionService(f.repository, f.candidates);
  return { ...f, result, admission, reference: { bundleId: result.bundle.id, receiptId: result.receipt.id } };
}

test("B-07 F002 consumes only exact sealed Bundle and Receipt with complete paged inventory", async (t) => {
  const f = await fixture(t);
  const qualified = await f.admission.qualify(reader, "workspace", f.reference);
  assert.equal(qualified?.bundleId, f.reference.bundleId);
  assert.equal(qualified.receiptId, f.reference.receiptId);
  assert.equal(qualified.fileCount, "1");
  assert.equal(qualified.gapCount, "0");
  const page = await f.admission.inventory(reader, "workspace", f.reference, { limit: 1 });
  assert.equal(page.items[0].entry.pathBytes, f.entry.pathBytes);
  assert.equal(page.nextCursor, null);
  const content = [];
  for await (const bytes of f.admission.readFile(reader, "workspace", f.reference, { componentId: page.items[0].componentId, pathBytes: f.entry.pathBytes })) content.push(bytes);
  assert.deepEqual(Buffer.concat(content), f.bytes);
  assert.deepEqual((await f.admission.inheritedGaps(reader, "workspace", f.reference)).items, []);
});

test("B-05 direct locators and cross-Workspace references are not admitted", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.admission.qualify(reader, "workspace", { url: "https://example.test/repo" }), { code: "SOURCE_SEALED_REFERENCE_REQUIRED" });
  await assert.rejects(f.admission.qualify(reader, "workspace2", f.reference), { code: "SOURCE_FORBIDDEN" });
  await assert.rejects(f.admission.qualify(reader, "workspace", { ...f.reference, receiptId: "nonexistent" }), { code: "SOURCE_RECEIPT_NOT_FOUND" });
});

test("B-05 corruption rejects current admission without rewriting the historical READY Receipt", async (t) => {
  const f = await fixture(t);
  const location = await f.blobs.location({ tenantId: "tenant", workspaceId: "workspace" }, "blobs", f.digest);
  const handle = await open(location, "r+");
  const stat = await handle.stat();
  const last = Buffer.alloc(1);
  await handle.read(last, 0, 1, stat.size - 1);
  last[0] ^= 1;
  await handle.write(last, 0, 1, stat.size - 1);
  await handle.close();
  await assert.rejects(f.admission.qualify(reader, "workspace", f.reference), { code: "SOURCE_CONTENT_CORRUPT" });
  const receipt = await f.db.query("SELECT status FROM source_truth_receipt WHERE workspace_id='workspace' AND id=$1", [f.reference.receiptId]);
  assert.equal(receipt.rows[0].status, "READY");
});
