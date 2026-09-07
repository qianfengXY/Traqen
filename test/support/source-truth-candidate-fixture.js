import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sourceDatabase, owner } from "./source-truth-database.js";
import { SourceMaterialRepository } from "../../src/source-truth/material-repository.js";
import { SourceTruthBlobStore } from "../../src/source-truth/blob-store.js";
import { SourceCandidateService } from "../../src/source-truth/candidate-service.js";
import { pathBytes } from "../../src/source-truth/identity.js";

export async function candidateFixture(t, { gaps = [], verified = true, stored = true, git = false, database = sourceDatabase } = {}) {
  const { repository, db } = await database(t);
  const materials = new SourceMaterialRepository(repository);
  const blobs = await SourceTruthBlobStore.open({ root: await mkdtemp(path.join(tmpdir(), "traqen-source-candidate-test-")), keyVersion: "test", keys: { test: Buffer.alloc(32, 12) } });
  const bytes = Buffer.from("material");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const source = { sourceId: "registration", kind: git ? "GIT" : "DIRECTORY_UPLOAD", scope: git ? { kind: "GIT_TREE", root: null } : { kind: "UPLOADED_DIRECTORY" },
    nativeIdentity: git ? { objectFormat: "sha1", commit: "a".repeat(40), tree: "b".repeat(40) } : null };
  await repository.saveDraft(owner, "workspace", { expectedRevision: 0, input: { sources: [source] } });
  const run = await repository.startRun(owner, "workspace", { draftRevision: 1, policyRevisionId: "policy-v1" });
  const lease = await repository.claimRun("workspace", run.id, { workerId: "w", leaseMs: 60000 });
  const context = { workspaceId: "workspace", runId: run.id, generation: lease.generation, sourceId: source.sourceId };
  const advance = (from, to) => repository.transition("workspace", run.id, { generation: lease.generation, expectedStatus: from, status: to });
  await advance("PREFLIGHTING", "ENUMERATING");
  await materials.addSource(context, source);
  const entry = { pathBytes: pathBytes("a"), kind: "FILE", sizeBytes: String(bytes.length),
    expectedContent: git ? { objectFormat: "sha1", oid: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") } : { algorithm: "sha256", digest }, gitMode: git ? "100644" : null };
  await materials.appendEntries(context, [entry]);
  await materials.closeEnumeration(context, { fileCount: "1", directoryCount: "0" });
  await materials.freezeManifest(context);
  await advance("ENUMERATING", "MANIFEST_FROZEN");
  await advance("MANIFEST_FROZEN", "CAPTURING");
  if (stored) await blobs.putBlob({ tenantId: "tenant", workspaceId: "workspace" }, { digest, sizeBytes: entry.sizeBytes }, [bytes]);
  if (verified) await materials.dispose(context, { pathBytes: entry.pathBytes, disposition: "VERIFIED", reasonCode: "CONTENT_VERIFIED", digest, sizeBytes: entry.sizeBytes, gaps });
  await advance("CAPTURING", "RECONCILING");
  const candidates = new SourceCandidateService(repository, materials, blobs);
  return { repository, db, materials, blobs, context, candidates, entry, bytes, digest, advance };
}
