import { createHash } from "node:crypto";
import { requireValue } from "./errors.js";

// One bounded stdout cursor. No whole-object or whole-batch concatenation.
class BatchCursor {
  constructor(stream) { this.iterator = stream[Symbol.asyncIterator](); this.pending = Buffer.alloc(0); this.ended = false; }
  async refill() {
    if (this.pending.length || this.ended) return;
    const next = await this.iterator.next();
    this.ended = next.done;
    this.pending = next.value ?? Buffer.alloc(0);
  }
  async take(size) {
    await this.refill();
    requireValue(this.pending.length, "SOURCE_GIT_INTEGRITY_FAILED", "Git 批量对象流被截断");
    const part = this.pending.subarray(0, Math.min(size, this.pending.length));
    this.pending = this.pending.subarray(part.length);
    return part;
  }
  async line() {
    const bytes = [];
    for (let size = 0; size < 200; size++) {
      const byte = (await this.take(1))[0];
      if (byte === 10) return Buffer.from(bytes).toString("ascii");
      bytes.push(byte);
    }
    requireValue(false, "SOURCE_GIT_INTEGRITY_FAILED", "Git 批量对象头超过边界");
  }
}

export async function* verifiedGitBatch(stream, entries, objectFormat) {
  const cursor = new BatchCursor(stream);
  try {
    for (const entry of entries) {
      const header = await cursor.line();
      requireValue(header === `${entry.expectedContent.oid} blob ${entry.sizeBytes}`,
        "SOURCE_GIT_INTEGRITY_FAILED", "Git 对象顺序、类型或长度与冻结清单不一致");
      let complete = false;
      const content = (async function* () {
        const native = createHash(objectFormat).update(`blob ${entry.sizeBytes}\0`);
        let remaining = Number(entry.sizeBytes);
        while (remaining) {
          const bytes = await cursor.take(Math.min(remaining, 64 * 1024));
          native.update(bytes); remaining -= bytes.length;
          yield bytes;
        }
        requireValue((await cursor.take(1))[0] === 10 && native.digest("hex") === entry.expectedContent.oid,
          "SOURCE_GIT_INTEGRITY_FAILED", "Git 对象字节摘要或帧边界不一致");
        complete = true;
      })();
      yield { entry, content };
      requireValue(complete, "SOURCE_GIT_BATCH_NOT_CONSUMED", "必须完整校验当前 Git 对象后才能推进下一条");
    }
    await cursor.refill();
    requireValue(cursor.ended && cursor.pending.length === 0, "SOURCE_GIT_INTEGRITY_FAILED", "Git 对象流包含未声明的尾部");
  } finally { await cursor.iterator.return?.(); }
}
