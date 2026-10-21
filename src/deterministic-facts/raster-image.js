// Header identification is not pixel decoding or full format validation.
// This portable module is shared by the controlled HTTP reader and browser:
// bounded dimensions are checked BEFORE the browser allocates its decoder.
// PNG IHDR, GIF logical screen, JPEG SOF and WebP VP8/VP8L/VP8X are supported.
// No filename, source-provided MIME, user code or network access is consulted.

const maxDimension = 16_384;
const maxPixels = 32 * 1024 * 1024;

/** @param {string} mediaType @param {number} width @param {number} height */
function dimensions(mediaType, width, height) {
  return width > 0 && height > 0 && width <= maxDimension && height <= maxDimension && width * height <= maxPixels
    ? { mediaType, width, height } : null;
}

/** @param {Uint8Array} bytes */
export function rasterImageHeader(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  const size = bytes.byteLength;
  const view = new DataView(bytes.buffer, bytes.byteOffset, size);
  const ascii = (offset, text) => offset + text.length <= size
    && [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  if (size >= 33 && bytes[0] === 0x89 && ascii(1, "PNG\r\n\x1a\n")
    && view.getUint32(8) === 13 && ascii(12, "IHDR")) {
    return dimensions("image/png", view.getUint32(16), view.getUint32(20));
  }
  if (size >= 13 && (ascii(0, "GIF87a") || ascii(0, "GIF89a"))) {
    return dimensions("image/gif", view.getUint16(6, true), view.getUint16(8, true));
  }
  if (size >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    for (let segments = 0; segments < 4096 && offset + 4 <= size; segments++) {
      if (bytes[offset++] !== 0xff) return null;
      while (offset < size && bytes[offset] === 0xff) offset++;
      if (offset >= size) return null;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda || marker === 0) return null;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > size) return null;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > size) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8 || bytes[offset + 7] === 0 || length !== 8 + 3 * bytes[offset + 7]) return null;
        return dimensions("image/jpeg", view.getUint16(offset + 5), view.getUint16(offset + 3));
      }
      offset += length;
    }
    return null;
  }
  if (size >= 25 && ascii(0, "RIFF") && ascii(8, "WEBP")) {
    if (view.getUint32(4, true) + 8 !== size) return null;
    const length = view.getUint32(16, true);
    if (20 + length + (length % 2) > size) return null;
    if (ascii(12, "VP8 ") && length >= 10 && (bytes[20] & 1) === 0
      && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
      return dimensions("image/webp", view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    }
    if (ascii(12, "VP8L") && length >= 5 && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      if ((bits >>> 29) !== 0) return null;
      return dimensions("image/webp", (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (ascii(12, "VP8X") && length === 10 && (bytes[20] & 0xc1) === 0
      && bytes[21] === 0 && bytes[22] === 0 && bytes[23] === 0) {
      return dimensions("image/webp", 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16));
    }
  }
  return null;
}
