// UTF-8 character declarations, using Java Properties.load(Reader) syntax.
// No environment lookup, interpolation, shell evaluation or property winner.
// https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Properties.html#load(java.io.Reader)
import { DotenvSyntaxError, isDotenvPath, parseDotenvDeclarations } from "./dotenv-syntax.js";
export class ConfigSyntaxError extends Error {
  constructor(code, start, end) { super(code); this.code = code; this.start = start; this.end = end; }
}
const whitespace = char => char === " " || char === "\t" || char === "\f";
const sensitive = /(?:password|secret|token|api[_-]?key)/i;

function naturalLines(text) {
  const lines = []; let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index < text.length && text[index] !== "\r" && text[index] !== "\n") continue;
    const end = index;
    if (text[index] === "\r" && text[index + 1] === "\n") index += 1;
    lines.push({ start, end }); start = index + 1;
  }
  return lines;
}

function decode(text, start, end) {
  let value = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== "\\") { value += char; continue; }
    const escaped = text[++index];
    if (escaped === undefined) throw new ConfigSyntaxError("CONFIG_ESCAPE_INVALID", start, end);
    if (escaped === "u") {
      const hex = text.slice(index + 1, index + 5);
      if (!/^[a-fA-F0-9]{4}$/.test(hex)) throw new ConfigSyntaxError("CONFIG_ESCAPE_INVALID", start, end);
      value += String.fromCharCode(parseInt(hex, 16)); index += 4;
    } else value += ({ t: "\t", n: "\n", r: "\r", f: "\f" })[escaped] ?? escaped;
  }
  if (Buffer.from(value).toString("utf8") !== value) throw new ConfigSyntaxError("CONFIG_UNICODE_UNSUPPORTED", start, end);
  return value;
}

export function parsePropertyDeclarations(text, { maxConfigEntries = 20_000, maxConfigLineBytes = 65_536 } = {}) {
  if (!Number.isSafeInteger(maxConfigEntries) || maxConfigEntries < 1 || maxConfigEntries > 20_000
    || !Number.isSafeInteger(maxConfigLineBytes) || maxConfigLineBytes < 1 || maxConfigLineBytes > 65_536) throw new TypeError("invalid fixed property declaration limits");
  const lines = naturalLines(text), entries = [];
  for (let index = 0; index < lines.length;) {
    const first = lines[index]; let left = first.start;
    while (left < first.end && whitespace(text[left])) left += 1;
    if (left === first.end || text[left] === "#" || text[left] === "!") { index += 1; continue; }
    const offsets = []; let logical = "", end;
    while (index < lines.length) {
      const line = lines[index++]; let start = line.start;
      if (offsets.length) while (start < line.end && whitespace(text[start])) start += 1;
      let slashes = 0;
      while (line.end - slashes > start && text[line.end - slashes - 1] === "\\") slashes += 1;
      const continued = slashes % 2 === 1, stop = line.end - (continued ? 1 : 0);
      for (let at = start; at < stop; at += 1) { logical += text[at]; offsets.push(at); }
      end = line.end;
      if (Buffer.byteLength(logical) > maxConfigLineBytes) throw new ConfigSyntaxError("CONFIG_STRUCTURE_LIMIT", first.start, end);
      if (!continued) break;
      if (index === lines.length) throw new ConfigSyntaxError("CONFIG_CONTINUATION_INCOMPLETE", first.start, end);
    }
    if (entries.length >= maxConfigEntries) throw new ConfigSyntaxError("CONFIG_STRUCTURE_LIMIT", first.start, end);
    const position = at => offsets[at] ?? end;
    let keyStart = 0;
    while (whitespace(logical[keyStart])) keyStart += 1;
    let keyEnd = keyStart, escaped = false;
    for (; keyEnd < logical.length; keyEnd += 1) {
      const char = logical[keyEnd];
      if (!escaped && (whitespace(char) || char === "=" || char === ":")) break;
      if (!escaped && char === "\\") escaped = true; else escaped = false;
    }
    let valueStart = keyEnd;
    while (whitespace(logical[valueStart])) valueStart += 1;
    if (logical[valueStart] === "=" || logical[valueStart] === ":") valueStart += 1;
    while (whitespace(logical[valueStart])) valueStart += 1;
    const keyPhysicalStart = position(keyStart), keyPhysicalEnd = keyEnd === keyStart ? keyPhysicalStart : offsets[keyEnd - 1] + 1;
    entries.push({ key: decode(logical.slice(keyStart, keyEnd), keyPhysicalStart, keyPhysicalEnd),
      value: decode(logical.slice(valueStart), position(valueStart), end), keyStart: keyPhysicalStart, keyEnd: keyPhysicalEnd,
      valueStart: position(valueStart), valueEnd: end });
  }
  return entries;
}

export function extractPropertyStructure({ material, text, limits, textAnchor, addObject, addFact, addGap }) {
  const dotenv = limits?.dotenvSyntax === "node-static-v1" && isDotenvPath(material.displayPath);
  if (!dotenv && !material.displayPath?.toLowerCase().endsWith(".properties")) {
    addGap(material, "properties", "DOTENV_DECLARATIONS_NOT_CONFIGURED", textAnchor(text, 0, text.length)); return;
  }
  let entries;
  try { entries = dotenv ? parseDotenvDeclarations(text, limits) : parsePropertyDeclarations(text, limits); }
  catch (error) {
    if (!(error instanceof ConfigSyntaxError) && !(error instanceof DotenvSyntaxError)) throw error;
    addGap(material, "properties", error.code, textAnchor(text, error.start, error.end)); return;
  }
  const seen = new Set();
  for (const entry of entries) {
    const anchor = textAnchor(text, entry.keyStart, entry.keyEnd);
    if (sensitive.test(entry.key)) { addGap(material, "properties", "CONFIG_SENSITIVE_DECLARATION_RESTRICTED", anchor); continue; }
    if (seen.has(entry.key)) addGap(material, "properties", "CONFIG_DUPLICATE_KEY", anchor);
    seen.add(entry.key);
    const object = addObject(material, "CONFIG_KEY", entry.key, anchor);
    addFact({ subject: object, predicate: "name", value: { datatype: "string", value: entry.key }, material, anchor });
    const valueAnchor = textAnchor(text, entry.valueStart, entry.valueEnd);
    addFact({ subject: object, predicate: "type", value: { datatype: "string", value: "string" }, material, anchor: valueAnchor });
    addFact({ subject: object, predicate: "literalValue", value: { datatype: "string", value: entry.value }, material, anchor: valueAnchor });
    if (/\$\{|\$\(/.test(entry.value)) addGap(material, "properties", "CONFIG_RUNTIME_INTERPOLATION_UNRESOLVED", valueAnchor);
  }
}
