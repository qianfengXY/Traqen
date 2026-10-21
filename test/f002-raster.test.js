import assert from "node:assert/strict";
import test from "node:test";
import * as materials from "../src/deterministic-facts/material-service.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7yQAAAAASUVORK5CYII=", "base64");
const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
// Header fixtures prove deterministic MIME/dimension parsing, not a successful
// pixel decode. The browser acceptance chain must separately prove decoding.
const jpegHeader = Buffer.from("ffd8ffc0000b080002000301011100ffd9", "hex");
function webpHeader(kind, data) {
  const bytes = Buffer.alloc(20 + data.length + (data.length % 2));
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WEBP", 8); bytes.write(kind, 12); bytes.writeUInt32LE(data.length, 16);
  data.copy(bytes, 20);
  return bytes;
}
const vp8 = webpHeader("VP8 ", Buffer.from([0x10, 0, 0, 0x9d, 1, 0x2a, 3, 0, 2, 0]));
const lossless = Buffer.alloc(5); lossless[0] = 0x2f; lossless.writeUInt32LE(2 | (1 << 14), 1);
const vp8l = webpHeader("VP8L", lossless);
const vp8x = webpHeader("VP8X", Buffer.from([0, 0, 0, 0, 2, 0, 0, 1, 0, 0]));
function header(bytes) {
  assert.equal(typeof materials.rasterImageHeader, "function", "controlled images need a bounded shared byte-header parser before allocating a pixel decoder");
  return materials.rasterImageHeader(bytes);
}
for (const [name, bytes, expected] of [
  ["PNG", png, { mediaType: "image/png", width: 1, height: 1 }],
  ["GIF", gif, { mediaType: "image/gif", width: 1, height: 1 }],
  ["JPEG", jpegHeader, { mediaType: "image/jpeg", width: 3, height: 2 }],
  ["WebP VP8", vp8, { mediaType: "image/webp", width: 3, height: 2 }],
  ["WebP VP8L", vp8l, { mediaType: "image/webp", width: 3, height: 2 }],
  ["WebP VP8X", vp8x, { mediaType: "image/webp", width: 3, height: 2 }],
]) {
  test(`F002 controlled raster header identifies ${name} from bytes without filenames`, () => assert.deepEqual(header(bytes), expected));
}
test("F002 controlled raster header rejects truncated, malformed and non-raster content without throwing", () => {
  for (const [bytes, minimum] of [[png, 33], [gif, 13], [jpegHeader, 15], [vp8, vp8.length], [vp8l, vp8l.length], [vp8x, vp8x.length]]) {
    for (let length = 0; length < minimum; length++) assert.equal(header(bytes.subarray(0, length)), null);
  }
  for (const bytes of [Buffer.from("<svg onload='alert(1)'/>"), Buffer.from("GIF89a"), Buffer.from("not an image")]) assert.equal(header(bytes), null);
  const badChunk = Buffer.from(vp8); badChunk.writeUInt32LE(0xffffffff, 16); assert.equal(header(badChunk), null);
  const badFrame = Buffer.from(jpegHeader); badFrame.writeUInt16BE(1, 4); assert.equal(header(badFrame), null);
});
test("F002 controlled raster header refuses zero and excessive pixel dimensions before decoding", () => {
  const empty = Buffer.from(png); empty.writeUInt32BE(0, 16); assert.equal(header(empty), null);
  const oversized = Buffer.from(png); oversized.writeUInt32BE(100_000, 16); assert.equal(header(oversized), null);
  const pixels = Buffer.from(png); pixels.writeUInt32BE(16_384, 16); pixels.writeUInt32BE(16_384, 20); assert.equal(header(pixels), null);
  const reserved = Buffer.from(vp8l); reserved[24] |= 0xe0; assert.equal(header(reserved), null);
});
