import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  canonicalEncode, structureDigest, pathBytes, manifestEntry, manifestIdentity, orderedArrayDigest,
} from "../src/source-truth/identity.js";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const zero = "0".repeat(64);
const file = (path, changes = {}) => ({
  pathBytes: Buffer.from(path).toString("base64url"), kind: "FILE", sizeBytes: "0",
  expectedContent: { algorithm: "sha256", digest: sha("") }, gitMode: null, ...changes,
});

test("B-02 canonical v1 encodes exact field order, domain and empty Git vector", () => {
  const expected = '{"domain":"manifest","payload":{"entries":[],"kind":"GIT"},"version":1}';
  assert.equal(canonicalEncode({ version: 1, payload: { kind: "GIT", entries: [] }, domain: "manifest" }), expected);
  assert.equal(structureDigest("manifest", { kind: "GIT", entries: [] }), sha(expected));
  assert.notEqual(structureDigest("coverage", { kind: "GIT", entries: [] }), sha(expected));
  assert.deepEqual(manifestIdentity("GIT", []), { id: sha(expected), entries: [], fileCount: "0", directoryCount: "0", knownBytes: "0" });
});

test("B-02 JCS sorts raw UTF-16 keys, including integer-looking properties", () => {
  assert.equal(canonicalEncode({ "2": "two", "10": "ten", "1": "one" }), '{"1":"one","10":"ten","2":"two"}');
  const source = { "€": "euro", "\r": "CR", "דּ": "hebrew", "1": "one", "😀": "emoji", "\u0080": "control", "ö": "latin" };
  assert.equal(canonicalEncode(source), '{"\\r":"CR","1":"one","\u0080":"control","ö":"latin","€":"euro","😀":"emoji","דּ":"hebrew"}');
  assert.equal(canonicalEncode({ x: -0, nested: [{ z: true, a: null }] }), '{"nested":[{"a":null,"z":true}],"x":0}');
  for (const bad of [NaN, Infinity, undefined, 1n, new Date(), { x: undefined }, "\ud800", { "\udfff": 1 }]) {
    assert.throws(() => canonicalEncode(bad), /canonical|Unicode|JSON/);
  }
});

test("B-02 path identity is lossless, case and Unicode normalization remain distinct", () => {
  assert.equal(pathBytes("docs/订单.md"), "ZG9jcy_orqLljZUubWQ");
  assert.notEqual(pathBytes("A"), pathBytes("a"));
  assert.notEqual(pathBytes("é"), pathBytes("e\u0301"));
  const rawGit = Buffer.from([0x66, 0x2f, 0xff]);
  assert.equal(pathBytes(rawGit), rawGit.toString("base64url"));
  for (const bad of ["", "/absolute", "a/../b", "./a", "a//b", "a/", "a\\b", "C:/a", "a\u0000b", "a\n", "\ud800"]) {
    assert.throws(() => pathBytes(bad), /path|Unicode/);
  }
});

test("B-02 directory manifest vector retains empty subdirectories and excludes audit fields", () => {
  const entry = file("docs/订单.md");
  const directory = { pathBytes: pathBytes("empty"), kind: "DIRECTORY", sizeBytes: null, expectedContent: null, gitMode: null };
  const expected = '{"domain":"manifest","payload":{"entries":[{"expectedContent":{"algorithm":"sha256","digest":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},"gitMode":null,"kind":"FILE","pathBytes":"ZG9jcy_orqLljZUubWQ","sizeBytes":"0"},{"expectedContent":null,"gitMode":null,"kind":"DIRECTORY","pathBytes":"ZW1wdHk","sizeBytes":null}],"kind":"DIRECTORY_UPLOAD"},"version":1}';
  const result = manifestIdentity("DIRECTORY_UPLOAD", [directory, { ...entry, mtime: 12, uploadId: "audit-only" }]);
  assert.equal(result.id, sha(expected));
  assert.equal(result.fileCount, "1");
  assert.equal(result.directoryCount, "1");
  assert.equal(result.knownBytes, "0");
  assert.deepEqual(result.entries, [entry, directory]);
  assert.equal(result.id, manifestIdentity("DIRECTORY_UPLOAD", [entry, directory]).id);
});

test("B-02 Git native object identity is not a raw SHA-256 and modes affect identity", () => {
  const entry = file("a", { expectedContent: { objectFormat: "sha1", oid: "a".repeat(40) }, gitMode: "100644" });
  const a = manifestIdentity("GIT", [entry]);
  const executable = manifestIdentity("GIT", [{ ...entry, gitMode: "100755" }]);
  assert.notEqual(a.id, executable.id);
  assert.deepEqual(manifestEntry("GIT", entry).expectedContent, { objectFormat: "sha1", oid: "a".repeat(40) });
  assert.throws(() => manifestEntry("GIT", file("a")), /object|Git/);
  assert.throws(() => manifestEntry("DIRECTORY_UPLOAD", entry), /SHA-256|directory|Git/);
});

test("B-02 manifest validation never silently coalesces duplicates or rounds byte counts", () => {
  const huge = "9007199254740993";
  assert.equal(manifestIdentity("DIRECTORY_UPLOAD", [file("large", { sizeBytes: huge })]).knownBytes, huge);
  assert.throws(() => manifestIdentity("GIT", [file("a"), file("a")]), /object|Git|duplicate/);
  assert.throws(() => manifestIdentity("DIRECTORY_UPLOAD", [file("a"), file("a")]), /duplicate/);
  for (const sizeBytes of [0, -1, "01", "-1", "1.5", null]) {
    assert.throws(() => manifestEntry("DIRECTORY_UPLOAD", file("a", { sizeBytes })), /sizeBytes/);
  }
  assert.throws(() => manifestEntry("DIRECTORY_UPLOAD", file("a", { pathBytes: "YQ==" })), /pathBytes/);
  assert.throws(() => manifestEntry("DIRECTORY_UPLOAD", file("a", { expectedContent: { algorithm: "sha256", digest: zero.toUpperCase()+"1" } })), /SHA-256/);
});

test("B-06 bounded array encoding is independent of page boundaries", async () => {
  const entries = [file("a"), file("b"), file("é")];
  async function* rows() { for (const entry of entries) yield entry; }
  assert.equal(await orderedArrayDigest("manifest", { kind: "DIRECTORY_UPLOAD" }, "entries", rows()), structureDigest("manifest", { kind: "DIRECTORY_UPLOAD", entries }));
  assert.notEqual(await orderedArrayDigest("inventory", { workspaceId: "A" }, "items", rows()), await orderedArrayDigest("inventory", { workspaceId: "B" }, "items", rows()));
});
