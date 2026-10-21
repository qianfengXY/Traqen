import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sourceDatabase, owner } from "./source-truth-database.js";
import { SourceMaterialRepository } from "../../src/source-truth/material-repository.js";
import { SourceTruthBlobStore } from "../../src/source-truth/blob-store.js";
import { SourceCandidateService } from "../../src/source-truth/candidate-service.js";
import { pathBytes } from "../../src/source-truth/identity.js";

export async function candidateFixture(t, { gaps = [], verified = true, stored = true, git = false, root = null, objectFormat = "sha1", entryPath = "a", directoryPaths = [], content = "material", additionalFiles = [], database = sourceDatabase } = {}) {
  const { repository, db } = await database(t);
  const materials = new SourceMaterialRepository(repository);
  const blobs = await SourceTruthBlobStore.open({ root: await mkdtemp(path.join(tmpdir(), "traqen-source-candidate-test-")), keyVersion: "test", keys: { test: Buffer.alloc(32, 12) } });
  const bytes = Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(content, "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const oidLength = objectFormat === "sha256" ? 64 : 40;
  const source = { sourceId: "registration", kind: git ? "GIT" : "DIRECTORY_UPLOAD", scope: git ? { kind: "GIT_TREE", root } : { kind: "UPLOADED_DIRECTORY" },
    nativeIdentity: git ? { objectFormat, commit: "a".repeat(oidLength), tree: "b".repeat(oidLength) } : null };
  await repository.saveDraft(owner, "workspace", { expectedRevision: 0, input: { sources: [source] } });
  const run = await repository.startRun(owner, "workspace", { draftRevision: 1, policyRevisionId: "policy-v1" });
  const lease = await repository.claimRun("workspace", run.id, { workerId: "w", leaseMs: 60000 });
  const context = { workspaceId: "workspace", runId: run.id, generation: lease.generation, sourceId: source.sourceId };
  const advance = (from, to) => repository.transition("workspace", run.id, { generation: lease.generation, expectedStatus: from, status: to });
  await advance("PREFLIGHTING", "ENUMERATING");
  await materials.addSource(context, source);
  const entry = { pathBytes: pathBytes(entryPath), kind: "FILE", sizeBytes: String(bytes.length),
    expectedContent: git ? { objectFormat, oid: createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest("hex") } : { algorithm: "sha256", digest }, gitMode: git ? "100644" : null };
  const additional = additionalFiles.map(file => {
    const bytes = Buffer.isBuffer(file.content) ? Buffer.from(file.content) : Buffer.from(file.content, "utf8"), digest = createHash("sha256").update(bytes).digest("hex");
    return { bytes, digest, entry: { pathBytes: pathBytes(file.entryPath), kind: "FILE", sizeBytes: String(bytes.length),
      expectedContent: git ? { objectFormat, oid: createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest("hex") } : { algorithm: "sha256", digest }, gitMode: git ? "100644" : null } };
  });
  // The synthetic source explicitly declares its directories. The helper
  // never asks F001 to infer or silently repair an incomplete source tree.
  const directoryEntries = directoryPaths.map(directoryPath => ({ pathBytes: pathBytes(directoryPath), kind: "DIRECTORY",
    sizeBytes: null, expectedContent: null, gitMode: git ? "040000" : null }));
  await materials.appendEntries(context, [...directoryEntries, entry, ...additional.map(file => file.entry)]);
  await materials.closeEnumeration(context, { fileCount: String(1 + additional.length), directoryCount: String(directoryEntries.length) });
  await materials.freezeManifest(context);
  await advance("ENUMERATING", "MANIFEST_FROZEN");
  await advance("MANIFEST_FROZEN", "CAPTURING");
  for (const directory of directoryEntries) await materials.dispose(context, { pathBytes: directory.pathBytes, disposition: "METADATA", reasonCode: "DIRECTORY_RECORDED" });
  if (stored) await blobs.putBlob({ tenantId: "tenant", workspaceId: "workspace" }, { digest, sizeBytes: entry.sizeBytes }, [bytes]);
  if (verified) await materials.dispose(context, { pathBytes: entry.pathBytes, disposition: "VERIFIED", reasonCode: "CONTENT_VERIFIED", digest, sizeBytes: entry.sizeBytes, gaps });
  for (const file of additional) {
    if (stored) await blobs.putBlob({ tenantId: "tenant", workspaceId: "workspace" }, { digest: file.digest, sizeBytes: file.entry.sizeBytes }, [file.bytes]);
    if (verified) await materials.dispose(context, { pathBytes: file.entry.pathBytes, disposition: "VERIFIED", reasonCode: "CONTENT_VERIFIED", digest: file.digest, sizeBytes: file.entry.sizeBytes, gaps: [] });
  }
  await advance("CAPTURING", "RECONCILING");
  const candidates = new SourceCandidateService(repository, materials, blobs);
  return { repository, db, materials, blobs, context, candidates, entry, bytes, digest, additional, advance };
}
