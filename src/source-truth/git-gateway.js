import { createHash } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { canonicalEncode, pathBytes, manifestEntry } from "./identity.js";
import { requireValue, SourceTruthError } from "./errors.js";
import { resolveGitTarget, validateGitRef } from "./git-target.js";
import { GitProcess } from "./git-process.js";
import { verifiedGitBatch } from "./git-batch.js";
import { managedStoragePath, verifyProtectedVolume } from "./volume-protection.js";
import { gitCacheBudget } from "./git-cache-capacity.js";

const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
async function directory(location) {
  try { await mkdir(location, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
  const stat = await lstat(location);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077), "SOURCE_STORAGE_NOT_READY", "Git 对象缓存权限或类型异常", { status: 503 });
}

export class GitSourceGateway {
  constructor(configuration) {
    this.config = configuration;
    this.process = new GitProcess(configuration);
    gitCacheBudget(configuration.cacheRoot, configuration); // Reject invalid deployment limits before any work.
    this.maxFileBytes = configuration.maxFileBytes ?? 1024 * 1024 * 1024;
    this.maxEntries = configuration.maxEntries ?? 200000;
    this.locks = new Set();
    requireValue(path.isAbsolute(configuration.cacheRoot), "SOURCE_STORAGE_NOT_READY", "Git 缓存须在受保护的专用卷内", { status: 503 });
  }

  location(snapshot) {
    requireValue(/^[a-f0-9]{64}$/.test(snapshot.cacheKey) && ["sha1", "sha256"].includes(snapshot.objectFormat), "SOURCE_INVALID_INPUT", "Git 缓存引用无效");
    return path.join(this.config.cacheRoot, snapshot.cacheKey, snapshot.objectFormat);
  }

  async ready() {
    this.config.cacheRoot = await managedStoragePath(this.config.cacheRoot, this.config.forbiddenRoots);
    await directory(this.config.cacheRoot);
    if (this.config.requireProtectedVolume) await verifyProtectedVolume(this.config.cacheRoot);
  }

  async network(input) {
    const target = await resolveGitTarget(input.url, this.config.targets, this.config.lookup);
    const config = [["http.curloptResolve", target.curlResolve]];
    if (target.caFile) config.push(["http.sslCAInfo", target.caFile]);
    if (input.credentialRef) {
      const credential = await this.config.credentialProvider?.(input.credentialRef, target.origin);
      requireValue(typeof credential === "string" && credential.length > 0 && credential.length < 8192 && !/[\r\n\0]/.test(credential),
        "SOURCE_GIT_CREDENTIAL_UNAVAILABLE", "无法取得该只读连接的受保护凭据", { status: 403 });
      config.push(["http.extraHeader", `Authorization: ${credential}`]);
    }
    return { target, config };
  }

  async capture(scope, input, { signal } = {}) {
    await this.ready();
    validateGitRef(input.ref);
    if (input.root !== null) pathBytes(input.root);
    const cacheKey = createHash("sha256").update(canonicalEncode(scope)).digest("hex");
    requireValue(!this.locks.has(cacheKey), "SOURCE_GIT_BUSY", "该来源已有 Git 对象采集在运行", { status: 429 });
    this.locks.add(cacheKey);
    try {
      let { target, config } = await this.network(input);
      let wanted = input.ref;
      if (!oidPattern.test(wanted)) {
        const refs = wanted === "HEAD" || wanted.startsWith("refs/") ? [wanted] : [`refs/heads/${wanted}`, `refs/tags/${wanted}`];
        const output = await this.process.run(["ls-remote", "--refs", target.url, ...refs], { config, signal, maxBytes: 1024 * 1024 });
        const candidates = output.toString("ascii").trim().split("\n").filter(Boolean).map((line) => line.split("\t"));
        // ls-remote --refs excludes HEAD: resolve it explicitly without --refs.
        if (wanted === "HEAD" && candidates.length === 0) {
          const head = await this.process.run(["ls-remote", target.url, "HEAD"], { config, signal, maxBytes: 1024 });
          candidates.push(...head.toString("ascii").trim().split("\n").filter(Boolean).map((line) => line.split("\t")));
        }
        requireValue(candidates.length === 1 && oidPattern.test(candidates[0][0]) && refs.includes(candidates[0][1]), "SOURCE_GIT_REF_AMBIGUOUS", "版本不存在或 branch/tag 重名，请指定完整 ref");
        wanted = candidates[0][0];
      }
      const objectFormat = wanted.length === 64 ? "sha256" : "sha1";
      const snapshot = { cacheKey, objectFormat, commit: null, tree: null, root: input.root };
      const cwd = this.location(snapshot);
      const cacheBudget = gitCacheBudget(this.config.cacheRoot, this.config);
      await this.process.run(["init", "--bare", "--template=", `--object-format=${objectFormat}`, "."], { cwd, signal, cacheBudget });
      // Re-resolve and pin for this actual connection; never rely on an earlier
      // DNS answer, redirect, host environment proxy or inherited Git config.
      ({ target, config } = await this.network(input));
      await this.process.run(["fetch", "--no-tags", "--depth=1", "--no-write-fetch-head", "--keep", target.url,
        `${wanted}:refs/traqen/captures/${wanted}`], { cwd, config, signal, maxBytes: 65536, cacheBudget });
      const text = async (args) => (await this.process.run(args, { cwd, signal, maxBytes: 1024 })).toString("ascii").trim();
      snapshot.commit = await text(["rev-parse", "--verify", `${wanted}^{commit}`]);
      requireValue(oidPattern.test(snapshot.commit), "SOURCE_GIT_INTEGRITY_FAILED", "无法确认 Git commit 对象");
      try {
        snapshot.tree = await text(["rev-parse", "--verify", input.root === null ? `${snapshot.commit}^{tree}` : `${snapshot.commit}:${input.root}`]);
        requireValue(await text(["cat-file", "-t", snapshot.tree]) === "tree", "SOURCE_GIT_ROOT_MISSING", "声明的 Git 目录根不存在或不是目录");
      } catch (cause) {
        throw new SourceTruthError("SOURCE_GIT_ROOT_MISSING", "声明的 Git 目录根不存在或不可读取；不是空目录成功", { cause });
      }
      return snapshot;
    } finally { this.locks.delete(cacheKey); }
  }

  async *entries(snapshot, { signal } = {}) {
    const cwd = this.location(snapshot);
    let pending = Buffer.alloc(0);
    let count = 0;
    const stream = this.process.stream(["ls-tree", "-r", "-t", "-l", "-z", snapshot.tree], { cwd, signal, maxBytes: this.maxEntries * 8400 });
    for await (const chunk of stream) {
      pending = Buffer.concat([pending, chunk]);
      let boundary;
      while ((boundary = pending.indexOf(0)) >= 0) {
        const row = pending.subarray(0, boundary);
        pending = pending.subarray(boundary + 1);
        count++;
        requireValue(count <= this.maxEntries && row.length <= 8400, "SOURCE_ENTRY_LIMIT", "Git 条目数量或路径超出限制");
        const tab = row.indexOf(9);
        const fields = row.subarray(0, tab).toString("ascii").trim().split(/\s+/);
        requireValue(tab > 0 && fields.length === 4 && oidPattern.test(fields[2]), "SOURCE_GIT_INTEGRITY_FAILED", "Git tree 条目无效");
        const [mode, type, oid, size] = fields;
        const kind = type === "tree" ? "DIRECTORY" : type === "commit" ? "GITLINK" : mode === "120000" ? "SYMLINK" : "FILE";
        const sizeBytes = ["DIRECTORY", "GITLINK"].includes(kind) ? null : size;
        requireValue(sizeBytes === null || (/^\d+$/.test(sizeBytes) && BigInt(sizeBytes) <= BigInt(this.maxFileBytes)), "SOURCE_FILE_TOO_LARGE", "Git 文件超过平台限制，不能静默跳过");
        yield manifestEntry("GIT", { pathBytes: pathBytes(row.subarray(tab + 1)), kind, sizeBytes,
          expectedContent: kind === "DIRECTORY" ? null : { objectFormat: snapshot.objectFormat, oid }, gitMode: mode });
      }
      requireValue(pending.length <= 8400, "SOURCE_GIT_INTEGRITY_FAILED", "Git tree 记录超过边界");
    }
    requireValue(pending.length === 0, "SOURCE_GIT_INTEGRITY_FAILED", "Git tree 枚举被截断");
  }

  async *readBlob(snapshot, input, { signal } = {}) {
    const entry = manifestEntry("GIT", input);
    requireValue(["FILE", "SYMLINK"].includes(entry.kind) && entry.expectedContent.objectFormat === snapshot.objectFormat,
      "SOURCE_INVALID_INPUT", "不是当前 Git 来源的内容对象");
    const size = Number(entry.sizeBytes);
    requireValue(Number.isSafeInteger(size) && size <= this.maxFileBytes, "SOURCE_FILE_TOO_LARGE", "Git 文件超过平台限制");
    const native = createHash(snapshot.objectFormat).update(`blob ${size}\0`);
    let received = 0;
    for await (const chunk of this.process.stream(["cat-file", "blob", entry.expectedContent.oid], { cwd: this.location(snapshot), signal, maxBytes: size })) {
      native.update(chunk); received += chunk.length; yield chunk;
    }
    requireValue(received === size && native.digest("hex") === entry.expectedContent.oid, "SOURCE_GIT_INTEGRITY_FAILED", "Git 对象字节与固定引用不一致");
  }

  async *readBlobs(snapshot, inputs, { signal } = {}) {
    requireValue(Array.isArray(inputs) && inputs.length <= 500, "SOURCE_GIT_RESOURCE_LIMIT", "Git 批次必须有界");
    if (!inputs.length) return;
    const entries = inputs.map((input) => manifestEntry("GIT", input));
    let maxBytes = 0;
    for (const entry of entries) {
      requireValue(["FILE", "SYMLINK"].includes(entry.kind) && entry.expectedContent.objectFormat === snapshot.objectFormat,
        "SOURCE_INVALID_INPUT", "不是当前 Git 来源的内容对象");
      const size = Number(entry.sizeBytes);
      requireValue(Number.isSafeInteger(size) && size <= this.maxFileBytes, "SOURCE_FILE_TOO_LARGE", "Git 文件超过平台限制");
      maxBytes += size + 200;
    }
    requireValue(Number.isSafeInteger(maxBytes), "SOURCE_GIT_RESOURCE_LIMIT", "Git 批次字节预算无效");
    const input = entries.map((entry) => `${entry.expectedContent.oid}\n`).join("");
    yield* verifiedGitBatch(this.process.stream(["cat-file", "--batch"], { cwd: this.location(snapshot), input, signal, maxBytes }), entries, snapshot.objectFormat);
  }
}
