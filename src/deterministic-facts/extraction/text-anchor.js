export function createTextAnchor(text) {
  // Lazy and material-local: unsupported/binary materials never allocate an
  // index, and a finished file's text/index is not retained by a global cache.
  let bytes, points, breaks, starts;
  const indexText = () => {
    bytes = new Uint32Array(text.length + 1);
    points = new Uint32Array(text.length + 1);
    breaks = [0]; starts = [0];
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i), low = code >= 0xdc00 && code <= 0xdfff;
      const previous = i ? text.charCodeAt(i - 1) : 0;
      const pairedLow = low && previous >= 0xd800 && previous <= 0xdbff;
      // A prefix ending at a high surrogate encodes U+FFFD (3 bytes); extending
      // it through its low surrogate changes that prefix to 4, not 6 bytes.
      bytes[i + 1] = bytes[i] + (pairedLow ? 1 : code < 0x80 ? 1 : code < 0x800 ? 2 : 3);
      points[i + 1] = points[i] + (pairedLow ? 0 : 1);
      if (code === 13) { breaks.push(i + 1); starts.push(i + (text.charCodeAt(i + 1) === 10 ? 2 : 1)); }
      else if (code === 10 && previous !== 13) { breaks.push(i + 1); starts.push(i + 1); }
    }
  };
  const position = index => {
    let low = 0, high = breaks.length;
    while (low + 1 < high) { const middle = (low + high) >>> 1; if (breaks[middle] <= index) low = middle; else high = middle; }
    const start = Math.min(starts[low], index);
    return { line: low + 1, column: points[index] - points[start] + 1 };
  };
  return (start, end) => {
    if (!bytes) indexText();
    const first = position(start), last = position(end);
    return { kind: "TEXT", byteStart: bytes[start], byteEnd: bytes[end],
      lineStart: first.line, columnStart: first.column, lineEnd: last.line, columnEnd: last.column };
  };
}
