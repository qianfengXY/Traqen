import { SourceSha256 } from "./stream-hash.ts";

export type DirectoryEntry = { pathBytes: string; kind: "DIRECTORY" | "FILE"; sizeBytes: string | null; expectedContent: { algorithm: "sha256"; digest: string } | null; gitMode: null };
export type LocalEntry = { path: string; key: ArrayBuffer; entry: DirectoryEntry };
export type DirectoryHandle = { kind: "directory"; name?: string; entries(): AsyncIterable<[string, DirectoryHandle | FileHandle]>; getDirectoryHandle?(name: string): Promise<DirectoryHandle>; getFileHandle?(name: string): Promise<FileHandle> };
export type FileHandle = { kind: "file"; getFile(): Promise<File> };
export type SelectionPolicy = { maxEntries: number; maxFileBytes: string; maxTotalBytes: string; maxBatchEntries: number };
export type SelectionProgress = { phase: "LOCAL_SCAN"; fileCount: string; directoryCount: string; readBytes: string; path: string };
export type SelectionSummary = { fileCount: string; directoryCount: string; knownBytes: string };
export type LocalEntryWriter = { putBatch(rows: LocalEntry[]): Promise<void> };
const encoder = new TextEncoder();

export function encodeDirectoryPath(path: string) {
  const bytes = encoder.encode(path);
  if (!path.isWellFormed() || bytes.length === 0 || bytes.length > 8192 || path.startsWith("/") || /^[A-Za-z]:/.test(path)
    || /[\u0000-\u001f\u007f\\]/.test(path) || path.split("/").length > 128 || path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("目录含不安全或过深的路径，不能跳过后继续");
  return { key: bytes.buffer as ArrayBuffer, pathBytes: btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") };
}

export async function hashLocalFile(file: Blob, signal?: AbortSignal, onBytes?: (bytes: number) => void) {
  const hash = new SourceSha256();
  // Read bounded slices and yield between them; never file.arrayBuffer().
  for (let offset = 0; offset < file.size; offset += 256 * 1024) {
    signal?.throwIfAborted();
    const bytes = new Uint8Array(await file.slice(offset, offset + 256 * 1024).arrayBuffer());
    hash.update(bytes); onBytes?.(bytes.length);
  }
  signal?.throwIfAborted();
  return hash.hex();
}

export async function scanDirectory(root: DirectoryHandle, store: LocalEntryWriter, policy: SelectionPolicy, options: {
  signal?: AbortSignal; hashFile?: (file: File, signal?: AbortSignal, onBytes?: (bytes: number) => void) => Promise<string>; onProgress?: (progress: SelectionProgress) => void;
} = {}): Promise<SelectionSummary> {
  const { signal, hashFile = hashLocalFile, onProgress } = options;
  let files = BigInt(0), directories = BigInt(0), knownBytes = BigInt(0), readBytes = BigInt(0), batch: LocalEntry[] = [];
  const emit = (path: string) => onProgress?.({ phase: "LOCAL_SCAN", fileCount: String(files), directoryCount: String(directories), readBytes: String(readBytes), path });
  const flush = async () => { if (batch.length) { await store.putBatch(batch); batch = []; } };
  async function visit(directory: DirectoryHandle, prefix: string) {
    for await (const [name, handle] of directory.entries()) {
      signal?.throwIfAborted();
      // A directory entry is one path segment, never a pre-normalized path.
      if (name.includes("/")) throw new Error("目录条目路径无效");
      const path = prefix ? `${prefix}/${name}` : name;
      const encoded = encodeDirectoryPath(path);
      if (files + directories >= BigInt(policy.maxEntries)) throw new Error("目录文件/目录数量超过平台限制");
      let entry: DirectoryEntry;
      if (handle.kind === "directory") {
        directories++;
        entry = { pathBytes: encoded.pathBytes, kind: "DIRECTORY", sizeBytes: null, expectedContent: null, gitMode: null };
      } else if (handle.kind === "file") {
        const file = await handle.getFile();
        if (!Number.isSafeInteger(file.size) || BigInt(file.size) > BigInt(policy.maxFileBytes)) throw new Error("目录文件大小超过平台限制，不能排除后继续");
        knownBytes += BigInt(file.size);
        if (knownBytes > BigInt(policy.maxTotalBytes)) throw new Error("目录总字节数超过平台限制");
        const digest = await hashFile(file, signal, (count) => { readBytes += BigInt(count); emit(path); });
        const current = await handle.getFile();
        if (file.size !== current.size || file.lastModified !== current.lastModified) throw new Error("读取期间文件发生变化，请重新选择并完整核对目录");
        files++;
        entry = { pathBytes: encoded.pathBytes, kind: "FILE", sizeBytes: String(file.size), expectedContent: { algorithm: "sha256", digest }, gitMode: null };
      } else throw new Error("目录包含浏览器不能完整读取的条目");
      batch.push({ path, key: encoded.key, entry });
      if (batch.length >= policy.maxBatchEntries) await flush();
      emit(path);
      if (handle.kind === "directory") await visit(handle, path);
    }
  }
  await visit(root, "");
  signal?.throwIfAborted();
  if (files === BigInt(0)) throw new Error("所选目录必须含至少一个文件；全部删除不能发布为空目录版本");
  await flush();
  return { fileCount: String(files), directoryCount: String(directories), knownBytes: String(knownBytes) };
}

// Fixed schema, exact JCS key order. Raw path ordering is the store's binary key
// order, NOT localeCompare, filesystem enumeration order, or base64 string order.
export async function directoryManifest(rows: AsyncIterable<LocalEntry>, signal?: AbortSignal) {
  const hash = new SourceSha256().update(encoder.encode('{"domain":"manifest","payload":{"entries":['));
  let first = true;
  for await (const { entry } of rows) {
    signal?.throwIfAborted();
    const row = { expectedContent: entry.expectedContent, gitMode: null, kind: entry.kind, pathBytes: entry.pathBytes, sizeBytes: entry.sizeBytes };
    hash.update(encoder.encode(`${first ? "" : ","}${JSON.stringify(row)}`));
    first = false;
  }
  return hash.update(encoder.encode('],"kind":"DIRECTORY_UPLOAD"},"version":1}')).hex();
}

export async function resolveLocalFile(root: DirectoryHandle, path: string) {
  encodeDirectoryPath(path);
  const segments = path.split("/");
  let directory = root;
  for (const name of segments.slice(0, -1)) {
    if (!directory.getDirectoryHandle) throw new Error("浏览器缺少完整目录访问能力");
    directory = await directory.getDirectoryHandle(name);
  }
  if (!directory.getFileHandle) throw new Error("浏览器缺少文件重新读取能力");
  return (await directory.getFileHandle(segments.at(-1)!)).getFile();
}
