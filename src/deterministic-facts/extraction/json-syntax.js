// Strict bounded JSON syntax tree. No evaluation, prototype assignment, network
// resolution or whole-document JSON.parse (which would discard duplicate keys).
export class JsonSyntaxError extends Error {
  constructor(code, start, end, pointer) { super(code); this.code = code; this.start = start; this.end = end; this.pointer = pointer; }
}
export const escapeJsonPointer = key => key.replace(/~/g, "~0").replace(/\//g, "~1");
export const validJsonPointer = value => typeof value === "string" && (value === "" || value.startsWith("/")) && !/~(?![01])/u.test(value);

function decimalIdentity(token) {
  const [mantissa, exponent = "0"] = token.toLowerCase().split("e");
  const negative = mantissa.startsWith("-"), unsigned = negative ? mantissa.slice(1) : mantissa;
  const [whole, fraction = ""] = unsigned.split(".");
  let digits = (whole + fraction).replace(/^0+/, ""), scale = Number(exponent) - fraction.length;
  if (!Number.isSafeInteger(scale)) return null;
  if (!digits) return "0";
  while (digits.endsWith("0")) { digits = digits.slice(0, -1); scale += 1; }
  return `${negative ? "-" : ""}${digits}e${scale}`;
}

export function parseJsonSyntax(text, { maxJsonDepth = 64, maxJsonNodes = 20_000 } = {}) {
  if (!Number.isSafeInteger(maxJsonDepth) || maxJsonDepth < 1 || maxJsonDepth > 64 || !Number.isSafeInteger(maxJsonNodes) || maxJsonNodes < 1 || maxJsonNodes > 20_000) throw new TypeError("invalid fixed JSON syntax limits");
  let at = 0, count = 0;
  const fail = (code = "JSON_PARSE_FAILED", start = at, end = Math.min(text.length, at + 1), pointer = "") => { throw new JsonSyntaxError(code, Math.min(text.length, start), Math.min(text.length, end), pointer); };
  const whitespace = () => { while (at < text.length && /[\x20\x09\x0a\x0d]/.test(text[at])) at += 1; };
  const string = pointer => {
    const start = at;
    if (text[at++] !== '"') fail("JSON_PARSE_FAILED", start, at, pointer);
    while (at < text.length) {
      const char = text[at++];
      if (char === '"') {
        let value;
        try { value = JSON.parse(text.slice(start, at)); } catch { fail("JSON_PARSE_FAILED", start, at, pointer); }
        if (Buffer.from(value).toString("utf8") !== value) fail("JSON_UNICODE_UNSUPPORTED", start, at, pointer);
        return { value, start, end: at };
      }
      if (char === "\\") at += 1;
    }
    fail("JSON_PARSE_FAILED", start, at, pointer);
  };
  const read = (pointer, depth) => {
    whitespace(); const start = at;
    if (Buffer.byteLength(pointer) > 8192) fail("JSON_STRUCTURE_LIMIT", start, Math.min(text.length, start + 1));
    if (depth > maxJsonDepth || ++count > maxJsonNodes) fail("JSON_STRUCTURE_LIMIT", start, Math.min(text.length, start + 1), pointer);
    const node = { pointer, start, end: null, type: null, children: [] };
    const first = text[at];
    if (first === "{" || first === "[") {
      node.type = first === "{" ? "object" : "array"; const close = first === "{" ? "}" : "]", keys = new Set();
      at += 1; whitespace();
      if (text[at] !== close) while (true) {
        let key, keyToken;
        if (first === "{") {
          whitespace(); keyToken = string(pointer); key = keyToken.value;
          if (keys.has(key)) fail("JSON_DUPLICATE_KEY", keyToken.start, keyToken.end, pointer);
          keys.add(key); whitespace(); if (text[at++] !== ":") fail("JSON_PARSE_FAILED", at - 1, at, pointer);
        } else key = String(node.children.length);
        const child = read(`${pointer}/${escapeJsonPointer(key)}`, depth + 1);
        child.key = key; if (keyToken) { child.keyStart = keyToken.start; child.keyEnd = keyToken.end; }
        node.children.push(child); whitespace();
        if (text[at] === close) break;
        if (text[at++] !== ",") fail("JSON_PARSE_FAILED", at - 1, at, pointer);
      }
      if (text[at++] !== close) fail("JSON_PARSE_FAILED", at - 1, at, pointer);
    } else if (first === '"') { const token = string(pointer); node.type = "string"; node.value = token.value; }
    else {
      const rest = text.slice(at), token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(rest)?.[0];
      if (!token) fail("JSON_PARSE_FAILED", start, Math.min(text.length, start + 1), pointer);
      at += token.length;
      node.value = JSON.parse(token); node.type = node.value === null ? "null" : typeof node.value;
      if (node.type === "number" && (!Number.isFinite(node.value) || (Number.isInteger(node.value) && !Number.isSafeInteger(node.value))
        || decimalIdentity(token) !== decimalIdentity(String(node.value)))) fail("JSON_NUMBER_UNREPRESENTABLE", start, at, pointer);
    }
    node.end = at; return node;
  };
  const root = read("", 0); whitespace(); if (at !== text.length) fail(); return root;
}
