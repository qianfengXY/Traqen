import type { LocalEntry } from "./directory.ts";

// Only a disposable local selection index. No tokens, file handles or file bytes
// are persisted in the browser. Server manifests/checkpoints are the recovery
// authority. Session IDs never identify a Git commit or a frozen Bundle.
export class LocalEntryStore {
  private db: IDBDatabase;
  private name: string;
  private constructor(db: IDBDatabase, name: string) { this.db = db; this.name = name; }
  static async open() {
    if (!globalThis.indexedDB) throw new Error("浏览器缺少有界目录清单存储能力，请使用支持目录访问的浏览器");
    const name = `traqen-source-selection-${crypto.randomUUID()}`;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("entries", { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("本机清单索引被其他页面占用"));
    });
    return new LocalEntryStore(db, name);
  }
  async putBatch(rows: LocalEntry[]) {
    await new Promise<void>((resolve, reject) => {
      const transaction = this.db.transaction("entries", "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("本机清单存储失败或出现重复路径，尚未形成完整目录清单"));
      for (const row of rows) transaction.objectStore("entries").add(row);
    });
  }
  async *ordered(): AsyncGenerator<LocalEntry> {
    let after: ArrayBuffer | null = null;
    while (true) {
      const rows = await new Promise<LocalEntry[]>((resolve, reject) => {
        const transaction = this.db.transaction("entries", "readonly");
        const request = transaction.objectStore("entries").getAll(after ? IDBKeyRange.lowerBound(after, true) : null, 500);
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
      });
      for (const row of rows) yield row;
      if (rows.length < 500) return;
      after = rows.at(-1)!.key;
    }
  }
  async discard() {
    this.db.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.name);
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("本机临时清单索引尚在使用，未确认清除"));
    });
  }
}
