import { createHash } from "node:crypto";
import { canonicalEncode } from "./identity.js";
import { requireValue } from "./errors.js";

export class SourceCaptureRunner {
  constructor(services) { Object.assign(this, services); }
  async transition(context, from, to, progress) {
    return this.repository.transition(context.workspaceId, context.runId, { generation: context.generation, expectedStatus: from, status: to, progress });
  }
  async sources(context) {
    return (await this.repository.database.query("SELECT * FROM source_truth_run_source WHERE workspace_id=$1 AND run_id=$2 ORDER BY kind", [context.workspaceId, context.runId])).rows;
  }
  async baseline(tx, workspaceId, bundleId, source) {
    const row = (await tx.query(`SELECT c.* FROM source_truth_bundle_component b JOIN source_truth_component c ON c.workspace_id=b.workspace_id AND c.id=b.component_id
      WHERE b.workspace_id=$1 AND b.bundle_id=$2 AND c.id=$3`, [workspaceId, bundleId, source.componentId])).rows[0];
    requireValue(row && row.payload.sourceId === source.sourceId && row.payload.kind === source.kind, "SOURCE_BASELINE_MISMATCH", "沿用组件必须属于选定基线及同一个来源登记");
    return row;
  }

  async preflight(context, run, signal) {
    await this.blobs.ready();
    requireValue(run.policyRevisionId === this.policy.id, "SOURCE_POLICY_CHANGED", "平台策略已变化，请重新确认来源范围");
    for (const source of run.input.sources) {
      const existing = (await this.repository.database.query("SELECT payload FROM source_truth_resolution WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3", [context.workspaceId, context.runId, source.sourceId])).rows[0];
      if (existing) continue;
      let payload = { nativeIdentity: null, gitSnapshot: null };
      if (source.mode === "REUSE") {
        const component = await this.repository.withLease(context, (tx) => this.baseline(tx, context.workspaceId, run.input.baselineBundleId, source));
        payload = { nativeIdentity: component.payload.nativeIdentity, gitSnapshot: null, scope: component.payload.scope, manifestId: component.payload.manifestId };
      } else if (source.kind === "GIT") {
        requireValue(this.git, "SOURCE_GIT_NOT_CONFIGURED", "Git 采集网关尚未安全配置", { status: 503 });
        const snapshot = await this.git.capture({ tenantId: context.tenantId, workspaceId: context.workspaceId, sourceId: source.sourceId },
          { url: source.url, ref: source.ref, root: source.scope.root, credentialRef: source.credentialRef }, { signal });
        payload = { nativeIdentity: { objectFormat: snapshot.objectFormat, commit: snapshot.commit, tree: snapshot.tree }, gitSnapshot: snapshot };
      }
      await this.repository.withLease(context, async (tx) => {
        await tx.query("INSERT INTO source_truth_resolution (workspace_id,run_id,source_id,payload) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [context.workspaceId, context.runId, source.sourceId, JSON.stringify(payload)]);
        const stored = (await tx.query("SELECT payload FROM source_truth_resolution WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3", [context.workspaceId, context.runId, source.sourceId])).rows[0];
        requireValue(canonicalEncode(stored.payload) === canonicalEncode(payload), "SOURCE_NATIVE_IDENTITY_CONFLICT", "来源解析结果与锁定提交不同");
      });
    }
    return this.transition(context, "PREFLIGHTING", "ENUMERATING", { preflight: "PASSED", discoveredCountsOnly: true });
  }

  async enumerate(context, run, signal) {
    for (const source of run.input.sources) {
      const resolution = (await this.repository.database.query("SELECT payload FROM source_truth_resolution WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3", [context.workspaceId, context.runId, source.sourceId])).rows[0];
      requireValue(resolution, "SOURCE_NATIVE_IDENTITY_CONFLICT", "来源原生身份尚未锁定");
      const local = { ...context, sourceId: source.sourceId };
      await this.materials.addSource(local, { ...source, ...resolution.payload, scope: resolution.payload.scope ?? source.scope });
      const stored = await this.materials.source(local);
      if (stored.enumeration_closed) continue;
      if (source.mode === "REUSE") {
        await this.repository.withLease(context, (tx) => tx.query("UPDATE source_truth_run_source SET enumeration_closed=true,manifest_id=$4 WHERE workspace_id=$1 AND run_id=$2 AND source_id=$3", [context.workspaceId, context.runId, source.sourceId, resolution.payload.manifestId]));
      } else if (source.kind === "GIT") {
        let batch = [], ordinal = 0, files = 0n, directories = 0n;
        const save = async () => { await this.materials.appendEntries(local, batch, { batchId: String(ordinal++) }); batch = []; };
        for await (const entry of this.git.entries(resolution.payload.gitSnapshot, { signal })) {
          if (entry.kind === "DIRECTORY") directories++; else files++;
          batch.push(entry);
          if (batch.length === this.policy.maxBatchEntries) await save();
        }
        if (batch.length) await save();
        await this.materials.closeEnumeration(local, { fileCount: String(files), directoryCount: String(directories) });
      }
    }
    const sources = await this.sources(context);
    if (sources.some((source) => !source.enumeration_closed)) return this.transition(context, "ENUMERATING", "WAITING_FOR_CLIENT", { waitingFor: "DIRECTORY_ENUMERATION", discoveredCountsOnly: true });
    let entries = 0n, bytes = 0n;
    for (const source of sources) {
      const local = { ...context, sourceId: source.source_id };
      const manifest = await this.materials.freezeManifest(local);
      entries += BigInt(manifest.fileCount) + BigInt(manifest.directoryCount); bytes += BigInt(manifest.knownBytes);
    }
    requireValue(entries <= BigInt(this.policy.maxEntries) && bytes <= BigInt(this.policy.maxTotalBytes), "SOURCE_CAPACITY_EXHAUSTED", "组合来源超过平台文件/字节预算，不能降低覆盖后继续", { status: 507 });
    await this.blobs.ready();
    return this.transition(context, "ENUMERATING", "MANIFEST_FROZEN", { discoveredCountsOnly: false, entries: String(entries), knownBytes: String(bytes) });
  }

  async capture(context, run, signal) {
    const sources = await this.sources(context);
    for (const source of sources) {
      if (source.source.mode === "REUSE") continue;
      const local = { ...context, sourceId: source.source_id };
      let after = null;
      do {
        const page = await this.materials.entries(local, { after, limit: 100 });
        let gitBatch = [], batchBytes = 0;
        const flushGit = async () => {
          if (gitBatch.length) await this.captureGitFiles(local, source.source, gitBatch, signal);
          gitBatch = []; batchBytes = 0;
        };
        for (const { entry, disposition } of page.items) {
          signal?.throwIfAborted();
          if (disposition) continue;
          if (entry.kind === "DIRECTORY") await this.materials.dispose(local, { pathBytes: entry.pathBytes, disposition: "METADATA", reasonCode: "DIRECTORY_RECORDED" });
          else if (source.kind === "GIT") {
            const size = Number(entry.sizeBytes ?? "0");
            if (batchBytes + size > 32 * 1024 * 1024) await flushGit();
            gitBatch.push(entry); batchBytes += size;
          }
          else if (await this.blobs.verifyBlob({ workspaceId: context.workspaceId, tenantId: context.tenantId }, { digest: entry.expectedContent.digest, sizeBytes: entry.sizeBytes })) {
            await this.materials.dispose(local, { pathBytes: entry.pathBytes, disposition: "VERIFIED", reasonCode: "CONTENT_VERIFIED", digest: entry.expectedContent.digest, sizeBytes: entry.sizeBytes });
          }
        }
        await flushGit();
        after = page.nextCursor;
      } while (after);
    }
    let pending = 0n;
    for (const source of sources) pending += BigInt((await this.materials.summary({ ...context, sourceId: source.source_id })).pendingCount);
    if (pending > 0n) return this.transition(context, "CAPTURING", "WAITING_FOR_CLIENT", { ...run.progress, waitingFor: "DIRECTORY_BYTES", pendingCount: String(pending) });
    return this.transition(context, "CAPTURING", "RECONCILING", { ...run.progress, pendingCount: "0" });
  }

  async captureGitFiles(context, source, entries, signal) {
    for (const entry of entries.filter((entry) => entry.kind === "GITLINK")) {
      await this.materials.dispose(context, { pathBytes: entry.pathBytes, disposition: "EXTERNAL_GAP", reasonCode: "SUBMODULE_NOT_RECURSED", gaps: [
        { ruleCode: "GIT_SUBMODULE_EXTERNAL", severity: "NON_BLOCKING", ruleVersion: "v1", affectedScope: "external-tree", externalReference: entry.expectedContent },
      ] });
    }
    const scope = { tenantId: context.tenantId, workspaceId: context.workspaceId };
    const pending = new Map();
    // Pass one verifies native OIDs and computes the independent product hash.
    // Only bounded metadata and a small LFS/link prefix survive each stream.
    for await (const { entry, content } of this.git.readBlobs(source.gitSnapshot, entries.filter((entry) => entry.kind !== "GITLINK"), { signal })) {
      const hash = createHash("sha256"); let prefix = Buffer.alloc(0);
      for await (const chunk of content) {
        hash.update(chunk);
        if (prefix.length < 8192) prefix = Buffer.concat([prefix, chunk.subarray(0, 8192 - prefix.length)]);
      }
      const disposition = this.gitDisposition(entry, prefix, hash.digest("hex"));
      if (await this.blobs.verifyBlob(scope, disposition)) await this.materials.dispose(context, disposition);
      else pending.set(entry.pathBytes, { entry, disposition });
    }
    // Missing bytes alone are read into encrypted CAS. Native Git is invoked
    // twice per bounded batch, not twice for every file; no plaintext spool.
    for await (const { entry, content } of this.git.readBlobs(source.gitSnapshot, [...pending.values()].map((item) => item.entry), { signal })) {
      const { disposition } = pending.get(entry.pathBytes);
      if (await this.blobs.verifyBlob(scope, disposition)) { for await (const _ of content) { /* validate native frame */ } }
      else await this.blobs.putBlob(scope, disposition, content);
      await this.materials.dispose(context, disposition);
    }
  }

  gitDisposition(entry, prefix, digest) {
    if (entry.kind === "SYMLINK") {
      requireValue(BigInt(entry.sizeBytes) <= 8192n && prefix.length && prefix[0] !== 47 && !prefix.includes(92) && !prefix.some((byte) => byte < 32 || byte === 127)
        && !/^[A-Za-z]:/.test(prefix.toString("ascii")), "SOURCE_PATH_ESCAPE", "Git 链接目标不在可信相对路径边界内");
      let depth = Buffer.from(entry.pathBytes, "base64url").reduce((total, byte) => total + (byte === 47 ? 1 : 0), 0);
      for (const segment of prefix.toString("latin1").split("/")) {
        if (segment === "..") depth--; else if (segment && segment !== ".") depth++;
        requireValue(depth >= 0, "SOURCE_PATH_ESCAPE", "Git 链接越出声明来源范围；不跟随或接受绕过");
      }
    }
    const pointer = BigInt(entry.sizeBytes) <= 8192n ? /^version https:\/\/git-lfs.github.com\/spec\/v1\r?\noid sha256:([a-f0-9]{64})\r?\nsize (0|[1-9][0-9]*)\r?\n?$/.exec(prefix.toString("utf8")) : null;
    const gaps = pointer ? [{ ruleCode: "GIT_LFS_EXTERNAL", severity: "NON_BLOCKING", ruleVersion: "v1", affectedScope: "external-content",
      externalReference: { kind: "GIT_LFS", oid: pointer[1], sizeBytes: pointer[2] } }] : [];
    return { pathBytes: entry.pathBytes, disposition: "VERIFIED", reasonCode: "CONTENT_VERIFIED", digest, sizeBytes: entry.sizeBytes, gaps };
  }

  async advance(context, run, signal) {
    for (let step = 0; step < 8; step++) {
      signal?.throwIfAborted();
      if (run.status === "WAITING_FOR_CLIENT") run = await this.transition(context, run.status, run.station === 4 ? "ENUMERATING" : "CAPTURING", run.progress);
      else if (run.status === "PREFLIGHTING") run = await this.preflight(context, run, signal);
      else if (run.status === "ENUMERATING") run = await this.enumerate(context, run, signal);
      else if (run.status === "MANIFEST_FROZEN") run = await this.transition(context, run.status, "CAPTURING", run.progress);
      else if (run.status === "CAPTURING") run = await this.capture(context, run, signal);
      else if (run.status === "RECONCILING") {
        const candidate = await this.candidates.prepare(context);
        run = await this.transition(context, run.status, "REVIEW_REQUIRED", { ...run.progress, candidate });
      } else return run;
      if (run.status === "WAITING_FOR_CLIENT") return run;
    }
    return run;
  }
}
