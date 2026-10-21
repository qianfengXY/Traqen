import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { createTextAnchor } from "../src/deterministic-facts/extraction/text-anchor.js";

// Independent frozen pre-optimization definition: physical CR/LF handling,
// code-point columns, and the UTF-8 size of each UTF-16 prefix (even mid-pair).
function original(text, start, end) {
  const position = index => {
    const before = text.slice(0, index); let line = 1, lineStart = 0;
    for (let offset = 0; offset < before.length; offset++) {
      if (before[offset] === "\r") { if (before[offset + 1] === "\n") offset++; line++; lineStart = offset + 1; }
      else if (before[offset] === "\n") { line++; lineStart = offset + 1; }
    }
    return [line, [...text.slice(lineStart, index)].length + 1];
  };
  const first = position(start), last = position(end);
  return { kind: "TEXT", byteStart: Buffer.byteLength(text.slice(0, start)), byteEnd: Buffer.byteLength(text.slice(0, end)),
    lineStart: first[0], columnStart: first[1], lineEnd: last[0], columnEnd: last[1] };
}

test("F002 indexed anchors preserve every original UTF-16 boundary including CRLF, Unicode and split surrogates", () => {
  const texts = ["", "a\r\nb\rc\n", "中😀é\r\n\r😀\n尾", "\ud800x\udc00😀\r\n", "\r\n\r\r\n\n"];
  let state = 317;
  const chars = ["a", "中", "😀", "é", "\r", "\n", "\ud800", "\udc00", "\u2028"];
  for (let n = 0; n < 25; n++) {
    let text = "";
    for (let k = 0; k < 25; k++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; text += chars[state % chars.length]; }
    texts.push(text);
  }
  for (const text of texts) {
    const anchor = createTextAnchor(text);
    // Deliberately query in reverse/random order: no monotonic-visitor assumption.
    for (let end = text.length; end >= 0; end--) for (let start = 0; start <= end; start++) {
      assert.deepEqual(anchor(start, end), original(text, start, end));
    }
  }
});

test("F002 repeated anchors index a large document instead of rescanning its complete prefix", async () => {
  const module = new URL("../src/deterministic-facts/extraction/text-anchor.js", import.meta.url).href;
  const worker = new Worker(`import { parentPort } from 'node:worker_threads';
    import { createTextAnchor } from ${JSON.stringify(module)};
    const text = 'a'.repeat(2_000_000)+'😀\\r\\n中';
    const anchor = createTextAnchor(text);
    for(let i=0;i<10_000;i++) { const result=anchor(text.length-1,text.length); if(result.lineStart!==2||result.columnStart!==1)throw Error('wrong anchor'); }
    parentPort.postMessage('complete');`, { eval: true });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("repeated anchors still rescan the large prefix")), 4000);
      worker.once("message", message => { clearTimeout(timer); assert.equal(message, "complete"); resolve(); });
      worker.once("error", error => { clearTimeout(timer); reject(error); });
    });
  } finally { await worker.terminate(); }
});
