// Fixed, bounded node-static-v1 declarations, not an environment loader.
// https://nodejs.org/api/environment_variables.html#dotenv
// Unsupported quote/escape forms fail closed; duplicates have no winner.
export class DotenvSyntaxError extends Error {
  constructor(code, start, end) { super(code); this.code = code; this.start = start; this.end = end; }
}

export function isDotenvPath(displayPath) {
  if (typeof displayPath !== "string") return false;
  const filename = displayPath.slice(displayPath.lastIndexOf("/") + 1).toLowerCase();
  return filename === ".env" || filename.startsWith(".env.") || filename.endsWith(".env");
}

export function isDotenvPathBytes(rawPath) {
  // A non-UTF8 directory must not disable safety for an ASCII .env filename.
  // Latin1 is byte-preserving here, not a source-text decoding claim.
  return isDotenvPath(rawPath.subarray(rawPath.lastIndexOf(47) + 1).toString("latin1"));
}

const horizontal = char => char === " " || char === "\t" || char === "\f";
const newline = char => char === "\r" || char === "\n";

export function parseDotenvDeclarations(text, { maxConfigEntries = 20_000, maxConfigLineBytes = 65_536 } = {}) {
  if (typeof text !== "string" || !Number.isSafeInteger(maxConfigEntries) || maxConfigEntries < 1 || maxConfigEntries > 20_000
    || !Number.isSafeInteger(maxConfigLineBytes) || maxConfigLineBytes < 1 || maxConfigLineBytes > 65_536) throw new TypeError("invalid fixed dotenv declaration limits");
  const entries = []; let index = 0;
  const skipHorizontal = () => { while (horizontal(text[index])) index += 1; };
  const skipComment = () => { while (index < text.length && !newline(text[index])) index += 1; };
  while (index < text.length) {
    if (newline(text[index])) { index += 1; continue; }
    const start = index; skipHorizontal();
    if (text[index] === "#") { skipComment(); continue; }
    if (index === text.length || newline(text[index])) continue;
    if (text.startsWith("export", index) && horizontal(text[index + 6])) { index += 6; skipHorizontal(); }
    const keyStart = index;
    if (!/[A-Za-z_]/.test(text[index] ?? "")) throw new DotenvSyntaxError("CONFIG_DECLARATION_INVALID", start, index + 1);
    index += 1;
    while (index < text.length && /[A-Za-z0-9_]/.test(text[index])) index += 1;
    const keyEnd = index, key = text.slice(keyStart, keyEnd); skipHorizontal();
    if (text[index] !== "=") throw new DotenvSyntaxError("CONFIG_DECLARATION_INVALID", start, index + 1);
    index += 1; skipHorizontal();
    const valueStart = index; let contentStart = index, contentEnd, valueEnd, value;
    const quote = text[index];
    if (quote === '"' || quote === "'") {
      index += 1; contentStart = index;
      while (index < text.length && text[index] !== quote) index += 1;
      if (index === text.length) throw new DotenvSyntaxError("CONFIG_QUOTE_INCOMPLETE", start, index);
      contentEnd = index; index += 1; valueEnd = index;
      value = text.slice(contentStart, contentEnd);
      if (quote === '"') value = value.replace(/\\n/g, "\n");
      skipHorizontal();
      if (text[index] !== "#" && index < text.length && !newline(text[index])) throw new DotenvSyntaxError("CONFIG_QUOTE_UNSUPPORTED", start, index + 1);
    } else {
      if (quote === "`") throw new DotenvSyntaxError("CONFIG_QUOTE_UNSUPPORTED", start, index + 1);
      while (index < text.length && !newline(text[index]) && text[index] !== "#") index += 1;
      contentEnd = index;
      while (contentEnd > contentStart && horizontal(text[contentEnd - 1])) contentEnd -= 1;
      valueEnd = contentEnd; value = text.slice(contentStart, contentEnd);
    }
    if (entries.length >= maxConfigEntries || Buffer.byteLength(text.slice(start, valueEnd)) > maxConfigLineBytes) {
      throw new DotenvSyntaxError("CONFIG_STRUCTURE_LIMIT", start, valueEnd);
    }
    entries.push({ key, value, keyStart, keyEnd, valueStart, valueEnd, contentStart, contentEnd });
    if (text[index] === "#") skipComment();
  }
  return entries;
}
