import { createHash } from "node:crypto";

const domains = new Set(["manifest", "coverage", "component", "inventory", "gaps", "bundle"]);
const sourceKinds = new Set(["GIT", "DIRECTORY_UPLOAD"]);
const decimal = /^(0|[1-9][0-9]*)$/;
const sha256 = /^[0-9a-f]{64}$/;

export function validUnicode(value) {
  if (typeof value !== "string" || !value.isWellFormed()) throw new TypeError("Invalid Unicode string");
  return value;
}

// RFC 8785: emit keys directly, because JSON.stringify reorders integer keys
// even when a sorted intermediate object was constructed with Object.fromEntries.
export function canonicalEncode(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(validUnicode(value));
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new TypeError("Sparse or augmented arrays are not canonical JSON");
    return `[${value.map(canonicalEncode).join(",")}]`;
  }
  if (value && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError("Symbols are not canonical JSON");
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(validUnicode(key))}:${canonicalEncode(value[key])}`).join(",")}}`;
  }
  throw new TypeError("Unsupported canonical JSON value");
}

function requireDomain(domain) {
  if (!domains.has(domain)) throw new TypeError("Unknown identity domain");
}

export function structureDigest(domain, payload) {
  requireDomain(domain);
  return createHash("sha256").update(canonicalEncode({ domain, version: 1, payload }), "utf8").digest("hex");
}

// The caller provides a byte-ordered database cursor, not a materialized array.
// Both in-memory test vectors and streamed production records encode identically.
export async function orderedArrayDigest(domain, fields, arrayKey, rows) {
  requireDomain(domain);
  validUnicode(arrayKey);
  if (Object.hasOwn(fields, arrayKey)) throw new TypeError("Array field already exists");
  const hash = createHash("sha256");
  hash.update(`{"domain":${canonicalEncode(domain)},"payload":{`);
  let firstField = true;
  for (const key of [...Object.keys(fields), arrayKey].sort()) {
    hash.update(`${firstField ? "" : ","}${canonicalEncode(key)}:`);
    firstField = false;
    if (key !== arrayKey) {
      hash.update(canonicalEncode(fields[key]));
      continue;
    }
    hash.update("[");
    let firstRow = true;
    for await (const row of rows) {
      if (!firstRow) hash.update(",");
      hash.update(canonicalEncode(row));
      firstRow = false;
    }
    hash.update("]");
  }
  return hash.update('},"version":1}').digest("hex");
}

export function pathBytes(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(validUnicode(value), "utf8");
  if (!bytes.length || bytes.length > 8192 || bytes[0] === 47 || bytes.at(-1) === 47
    || bytes.some((byte) => byte < 32 || byte === 127 || byte === 92)
    || /^[A-Za-z]:/.test(bytes.toString("latin1"))) throw new TypeError("Unsafe relative path");
  const segments = bytes.toString("latin1").split("/");
  if (segments.length > 128 || segments.some((part) => !part || part === "." || part === "..")) {
    throw new TypeError("Unsafe relative path segments");
  }
  return bytes.toString("base64url");
}

export function decodePathBytes(encoded) {
  if (typeof encoded !== "string" || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new TypeError("Invalid pathBytes encoding");
  const bytes = Buffer.from(encoded, "base64url");
  if (pathBytes(bytes) !== encoded) throw new TypeError("Non-canonical pathBytes encoding");
  return bytes;
}

export function displayPath(encoded) {
  const bytes = decodePathBytes(encoded);
  const text = bytes.toString("utf8");
  return Buffer.from(text, "utf8").equals(bytes) ? text : [...bytes].map((byte) => `\\x${byte.toString(16).padStart(2, "0")}`).join("");
}

export function byteCount(value, field = "sizeBytes") {
  if (typeof value !== "string" || !decimal.test(value) || value.length > 40) {
    throw new TypeError(`${field} must be a non-negative decimal string`);
  }
  return value;
}

export function manifestEntry(sourceKind, input) {
  if (!sourceKinds.has(sourceKind)) throw new TypeError("Unknown source kind");
  const rawPath = decodePathBytes(input.pathBytes);
  if (sourceKind === "DIRECTORY_UPLOAD" && !Buffer.from(rawPath.toString("utf8"), "utf8").equals(rawPath)) {
    throw new TypeError("Invalid directory Unicode path");
  }
  const kind = input.kind;
  if (!["FILE", "DIRECTORY", "SYMLINK", "GITLINK"].includes(kind)) throw new TypeError("Invalid entry kind");
  const directory = kind === "DIRECTORY";
  const gitlink = kind === "GITLINK";
  if ((directory || gitlink) ? input.sizeBytes !== null : !decimal.test(byteCount(input.sizeBytes))) {
    throw new TypeError("Invalid sizeBytes for entry kind");
  }
  let expectedContent = null;
  let gitMode = null;
  if (sourceKind === "GIT") {
    const modes = { FILE: ["100644", "100755"], DIRECTORY: ["040000"], SYMLINK: ["120000"], GITLINK: ["160000"] };
    if (!modes[kind].includes(input.gitMode)) throw new TypeError("Invalid Git mode");
    gitMode = input.gitMode;
    if (!directory) {
      const { objectFormat, oid } = input.expectedContent ?? {};
      const length = objectFormat === "sha1" ? 40 : objectFormat === "sha256" ? 64 : 0;
      if (!length || typeof oid !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`).test(oid)) {
        throw new TypeError("Invalid Git object reference");
      }
      expectedContent = { objectFormat, oid };
    }
  } else {
    if (!["FILE", "DIRECTORY"].includes(kind) || input.gitMode !== null) throw new TypeError("Invalid directory kind or Git mode");
    if (!directory) {
      if (input.expectedContent?.algorithm !== "sha256" || !sha256.test(input.expectedContent?.digest ?? "")) {
        throw new TypeError("Invalid expected SHA-256");
      }
      expectedContent = { algorithm: "sha256", digest: input.expectedContent.digest };
    }
  }
  if (directory && input.expectedContent !== null) throw new TypeError("Directory expectedContent must be null");
  return { pathBytes: input.pathBytes, kind, sizeBytes: input.sizeBytes, expectedContent, gitMode };
}

// Bounded fixture/convenience helper. Production uses the database sorted cursor
// and orderedArrayDigest, retaining no whole 100k-entry list in process memory.
export function manifestIdentity(kind, inputEntries) {
  if (!sourceKinds.has(kind)) throw new TypeError("Unknown source kind");
  const entries = inputEntries.map((entry) => manifestEntry(kind, entry))
    .sort((a, b) => Buffer.compare(decodePathBytes(a.pathBytes), decodePathBytes(b.pathBytes)));
  let previous = null;
  let fileCount = 0n;
  let directoryCount = 0n;
  let knownBytes = 0n;
  for (const entry of entries) {
    if (entry.pathBytes === previous) throw new TypeError("duplicate manifest path");
    previous = entry.pathBytes;
    if (entry.kind === "DIRECTORY") directoryCount++;
    else fileCount++;
    if (entry.sizeBytes !== null) knownBytes += BigInt(entry.sizeBytes);
  }
  return { id: structureDigest("manifest", { kind, entries }), entries, fileCount: String(fileCount), directoryCount: String(directoryCount), knownBytes: String(knownBytes) };
}
