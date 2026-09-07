import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, statfs, unlink } from "node:fs/promises";
import path from "node:path";
import { canonicalEncode, byteCount } from "./identity.js";
import { SourceTruthError, fail, requireValue } from "./errors.js";
import { managedStoragePath, verifyProtectedVolume } from "./volume-protection.js";

const MAGIC = Buffer.from("TQSTv1\0\0");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const HASH = /^[a-f0-9]{64}$/;
const MAX_HEADER = 2048;
const BUFFER_BYTES = 64 * 1024;

export async function writeAll(handle, bytes) {
  let at = 0;
  while (at < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, at, bytes.length - at);
    if (!bytesWritten) throw new Error("Short storage write");
    at += bytesWritten;
  }
}

async function readExactly(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let at = 0;
  while (at < length) {
    const { bytesRead } = await handle.read(buffer, at, length - at, position + at);
    requireValue(bytesRead > 0, "SOURCE_CONTENT_CORRUPT", "已存内容被截断，需恢复并校验");
    at += bytesRead;
  }
  return buffer;
}

export async function safeDirectory(directory) {
  try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
  const stat = await lstat(directory);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0
    && (typeof process.getuid !== "function" || stat.uid === process.getuid()), "SOURCE_STORAGE_NOT_READY", "数据目录权限或类型不安全", { status: 503 });
}

export async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

export class SourceTruthBlobStore {
  constructor(config) {
    this.root = config.root;
    this.keyVersion = config.keyVersion;
    this.keys = new Map(Object.entries(config.keys).map(([version, key]) => [version, Buffer.from(key)]));
    this.maxFileBytes = BigInt(config.maxFileBytes ?? "1073741824");
    this.maxChunkBytes = config.maxChunkBytes ?? 4 * 1024 * 1024;
    this.minFreeBytes = BigInt(config.minFreeBytes ?? "0");
    this.maxWriters = config.maxWriters ?? 4;
    this.writers = 0;
    this.metrics = { peakWriters: 0, streamedBytes: 0n };
    this.requireProtectedVolume = config.requireProtectedVolume ?? false;
    this.volumeProbe = config.volumeProbe;
    this.volumeProtection = null;
  }

  static async open(config) {
    const activeKey = config?.keys?.[config?.keyVersion];
    requireValue(Buffer.isBuffer(activeKey) && activeKey.length === 32 && typeof config.keyVersion === "string"
      && config.keyVersion.length > 0 && config.keyVersion.length <= 128, "SOURCE_STORAGE_NOT_READY", "缺少受保护的存储加密密钥", { status: 503 });
    requireValue(typeof config.root === "string" && path.isAbsolute(config.root) && config.root !== path.parse(config.root).root,
      "SOURCE_STORAGE_NOT_READY", "必须配置专用持久化数据卷", { status: 503 });
    const root = await managedStoragePath(config.root, config.forbiddenRoots);
    await safeDirectory(root);
    const store = new SourceTruthBlobStore({ ...config, root: await realpath(root) });
    requireValue(store.maxFileBytes >= 0 && Number.isSafeInteger(store.maxChunkBytes) && store.maxChunkBytes > 0
      && Number.isInteger(store.maxWriters) && store.maxWriters > 0 && store.maxWriters <= 64, "SOURCE_STORAGE_NOT_READY", "存储资源限制无效", { status: 503 });
    await store.ready();
    return store;
  }

  async ready(additionalBytes = 0n) {
    await safeDirectory(this.root);
    if (this.requireProtectedVolume) {
      const { dev } = await lstat(this.root);
      if (!this.volumeProtection || this.volumeProtection.device !== dev || Date.now() - this.volumeProtection.at >= 10000) {
        this.volumeProtection = null;
        const evidence = await verifyProtectedVolume(this.root, { probe: this.volumeProbe });
        this.volumeProtection = { evidence, device: dev, at: Date.now() };
      }
    }
    const fs = await statfs(this.root, { bigint: true });
    requireValue(fs.bavail * fs.bsize >= this.minFreeBytes + additionalBytes, "SOURCE_CAPACITY_EXHAUSTED", "存储容量不足；扩容或恢复存储后重试", { status: 507 });
    return { encryption: "AES-256-GCM", keyVersion: this.keyVersion, availableBytes: String(fs.bavail * fs.bsize), maxFileBytes: String(this.maxFileBytes) };
  }

  scopeKey(scope) {
    requireValue(typeof scope?.tenantId === "string" && scope.tenantId && typeof scope?.workspaceId === "string" && scope.workspaceId,
      "SOURCE_FORBIDDEN", "缺少 Workspace 存储边界", { status: 403 });
    return sha(canonicalEncode({ tenantId: scope.tenantId, workspaceId: scope.workspaceId }));
  }

  async location(scope, kind, id, create = false) {
    requireValue(["blobs", "chunks"].includes(kind) && HASH.test(id), "SOURCE_INVALID_INPUT", "内容定位符无效", { status: 400 });
    let directory = this.root;
    for (const segment of [this.scopeKey(scope), kind, id.slice(0, 2)]) {
      directory = path.join(directory, segment);
      if (create) await safeDirectory(directory);
      else {
        const stat = await lstat(directory);
        requireValue(stat.isDirectory() && !stat.isSymbolicLink(), "SOURCE_STORAGE_NOT_READY", "内容目录类型异常", { status: 503 });
      }
    }
    return path.join(directory, id);
  }

  async putBlob(scope, ref, stream) { return this.put(scope, "blobs", ref.digest, ref, stream); }

  async putChunk(scope, input, stream) {
    byteCount(input.offset, "offset");
    requireValue(typeof input.runId === "string" && typeof input.fileKey === "string", "SOURCE_INVALID_INPUT", "缺少传输定位符", { status: 400 });
    requireValue(BigInt(byteCount(input.sizeBytes)) <= BigInt(this.maxChunkBytes), "SOURCE_FILE_TOO_LARGE", "传输分片超过平台限制", { status: 413 });
    const id = sha(canonicalEncode({ runId: input.runId, fileKey: input.fileKey, offset: input.offset, digest: input.digest, sizeBytes: input.sizeBytes }));
    return { ...(await this.put(scope, "chunks", id, input, stream)), id, offset: input.offset };
  }

  async put(scope, kind, id, ref, stream) {
    requireValue(HASH.test(ref.digest), "SOURCE_INVALID_INPUT", "SHA-256 无效", { status: 400 });
    const expectedSize = BigInt(byteCount(ref.sizeBytes));
    requireValue(expectedSize <= this.maxFileBytes, "SOURCE_FILE_TOO_LARGE", "文件超过平台限制，不能跳过后发布", { status: 413 });
    requireValue(this.writers < this.maxWriters, "SOURCE_STORAGE_BUSY", "存储并发已满，请等待后重试", { status: 429 });
    this.writers++;
    this.metrics.peakWriters = Math.max(this.metrics.peakWriters, this.writers);
    let handle;
    let temporary;
    try {
      await this.ready(expectedSize + 4096n);
      const destination = await this.location(scope, kind, id, true);
      temporary = path.join(path.dirname(destination), `.pending-${randomUUID()}`);
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const nonce = randomBytes(12);
      const metadata = Buffer.from(canonicalEncode({ keyVersion: this.keyVersion, nonce: nonce.toString("base64"), digest: ref.digest, sizeBytes: ref.sizeBytes, scope: this.scopeKey(scope), kind, id }));
      const prefix = Buffer.alloc(MAGIC.length + 4);
      MAGIC.copy(prefix);
      prefix.writeUInt32BE(metadata.length, MAGIC.length);
      const cipher = createCipheriv("aes-256-gcm", this.keys.get(this.keyVersion), nonce);
      cipher.setAAD(metadata);
      await writeAll(handle, prefix);
      await writeAll(handle, metadata);
      let size = 0n;
      const hash = createHash("sha256");
      for await (const input of stream) {
        requireValue(Buffer.isBuffer(input) || input instanceof Uint8Array, "SOURCE_INVALID_INPUT", "传输必须是原始字节", { status: 400 });
        const chunk = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
        size += BigInt(chunk.length);
        requireValue(size <= expectedSize, "SOURCE_CONTENT_MISMATCH", "收到的字节长度与冻结清单不符");
        // Slice untrusted producers too; cipher output is bounded to the read size.
        for (let at = 0; at < chunk.length; at += BUFFER_BYTES) {
          const slice = chunk.subarray(at, at + BUFFER_BYTES);
          hash.update(slice);
          await writeAll(handle, cipher.update(slice));
          this.metrics.streamedBytes += BigInt(slice.length);
        }
      }
      requireValue(size === expectedSize && hash.digest("hex") === ref.digest, "SOURCE_CONTENT_MISMATCH", "收到的内容与冻结清单不符；请重新核对来源");
      await writeAll(handle, cipher.final());
      await writeAll(handle, cipher.getAuthTag());
      await handle.sync();
      await handle.close();
      handle = null;
      let reused = false;
      try { await link(temporary, destination); } catch (error) {
        if (error.code !== "EEXIST") throw error;
        for await (const _ of this.read(scope, kind, id, ref)) { /* verify before reuse */ }
        reused = true;
      }
      await syncDirectory(path.dirname(destination));
      return { digest: ref.digest, sizeBytes: ref.sizeBytes, keyVersion: this.keyVersion, reused };
    } catch (error) {
      if (error instanceof SourceTruthError) throw error;
      if (["ENOSPC", "EDQUOT"].includes(error.code)) fail("SOURCE_CAPACITY_EXHAUSTED", "存储容量不足，已验证检查点仍保留", { status: 507, cause: error });
      fail("SOURCE_STORAGE_UNAVAILABLE", "存储暂不可用，请恢复存储后重试", { status: 503, cause: error });
    } finally {
      await handle?.close().catch(() => {});
      // Only this operation's incomplete encrypted output, never saved checkpoints/history.
      if (temporary) await unlink(temporary).catch(() => {});
      this.writers--;
    }
  }

  async *read(scope, kind, id, ref) {
    let handle;
    try {
      const location = await this.location(scope, kind, id);
      handle = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat({ bigint: true });
      const prefix = await readExactly(handle, MAGIC.length + 4, 0);
      const length = prefix.readUInt32BE(MAGIC.length);
      requireValue(prefix.subarray(0, MAGIC.length).equals(MAGIC) && length > 0 && length <= MAX_HEADER, "SOURCE_CONTENT_CORRUPT", "内容封装损坏，需恢复并校验");
      const metadata = await readExactly(handle, length, prefix.length);
      const header = JSON.parse(metadata.toString("utf8"));
      requireValue(header.scope === this.scopeKey(scope) && header.kind === kind && header.id === id
        && header.digest === ref.digest && header.sizeBytes === ref.sizeBytes, "SOURCE_CONTENT_CORRUPT", "内容引用与封装不一致");
      const key = this.keys.get(header.keyVersion);
      requireValue(key?.length === 32, "SOURCE_STORAGE_NOT_READY", "无法取得该历史内容的解密密钥", { status: 503 });
      const expectedSize = BigInt(byteCount(ref.sizeBytes));
      const start = prefix.length + length;
      requireValue(stat.isFile() && (stat.mode & 0o077n) === 0n && stat.size === BigInt(start) + expectedSize + 16n,
        "SOURCE_CONTENT_CORRUPT", "内容长度、权限或文件类型异常");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.nonce, "base64"));
      decipher.setAAD(metadata);
      decipher.setAuthTag(await readExactly(handle, 16, start + Number(expectedSize)));
      const hash = createHash("sha256");
      let at = 0;
      while (at < Number(expectedSize)) {
        const encrypted = await readExactly(handle, Math.min(BUFFER_BYTES, Number(expectedSize) - at), start + at);
        const plain = decipher.update(encrypted);
        hash.update(plain);
        at += encrypted.length;
        yield plain;
      }
      const tail = decipher.final();
      hash.update(tail);
      requireValue(hash.digest("hex") === ref.digest, "SOURCE_CONTENT_CORRUPT", "已存内容摘要校验失败");
      if (tail.length) yield tail;
    } catch (error) {
      if (error instanceof SourceTruthError || error.code === "ENOENT") throw error;
      fail("SOURCE_CONTENT_CORRUPT", "已存内容无法解密或校验，请恢复后重试", { cause: error });
    } finally { await handle?.close(); }
  }

  async verifyBlob(scope, ref) {
    try { for await (const _ of this.read(scope, "blobs", ref.digest, ref)) { /* streaming validation */ } return true; }
    catch (error) { if (error.code === "ENOENT") return false; throw error; }
  }

  async *readBlob(scope, ref) {
    // GCM authenticates at EOF. Validate before releasing any plaintext to a
    // consumer; both passes are bounded streams, not a full-file memory buffer.
    for await (const _ of this.read(scope, "blobs", ref.digest, ref)) { /* authenticated first pass */ }
    yield* this.read(scope, "blobs", ref.digest, ref);
  }
  async *readChunk(scope, ref) {
    for await (const _ of this.read(scope, "chunks", ref.id, ref)) { /* authenticated first pass */ }
    yield* this.read(scope, "chunks", ref.id, ref);
  }
}
