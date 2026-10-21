import { createHash } from "node:crypto";
import { DotenvSyntaxError, isDotenvPathBytes, parseDotenvDeclarations } from "./extraction/dotenv-syntax.js";
import { redactYamlPresentation } from "./yaml-presentation.js";
import { containsPrivateKey, isSensitiveKey } from "./sensitive-content.js";

export const CURRENT_DISPLAY_POLICY_REVISION = "policy-v4-private-key-boundaries";

export function displayFormatForPathBytes(rawPath) {
  if (isDotenvPathBytes(rawPath)) return "DOTENV";
  const bytes = Buffer.from(rawPath), name = bytes.subarray(bytes.lastIndexOf(47) + 1);
  // Only compare an ASCII extension; opaque/non-UTF8 parent names remain valid
  // admitted coordinates and are never converted through a lossy path string.
  const lower = Buffer.from(name.map(byte => byte >= 65 && byte <= 90 ? byte + 32 : byte));
  for (const [suffix, format] of [[".yaml", "YAML"], [".yml", "YAML"], [".json", "JSON"], [".properties", "PROPERTIES"]]) {
    const extension = Buffer.from(suffix);
    if (lower.length >= extension.length && lower.subarray(-extension.length).equals(extension)) return format;
  }
  return null;
}

function utf8(bytes) {
  const text = Buffer.from(bytes).toString("utf8");
  return Buffer.from(text, "utf8").equals(Buffer.from(bytes)) ? text : null;
}

export function digestBytes(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function linesOf(text) {
  const lines = [];
  for (let start = 0; start < text.length;) {
    let end = start;
    while (end < text.length && text[end] !== "\n" && text[end] !== "\r") end += 1;
    let next = end;
    if (text[next] === "\r" && text[next + 1] === "\n") next += 2;
    else if (text[next] === "\r" || text[next] === "\n") next += 1;
    lines.push({ content: text.slice(start, end), ending: text.slice(end, next) });
    start = next;
  }
  return lines;
}

function skipPropertyWhitespace(text, index) {
  while (index < text.length && (text[index] === " " || text[index] === "\t" || text[index] === "\f")) index += 1;
  return index;
}

function escapedCodePoint(text, start) {
  if (text[start] !== "\\") return null;
  const kind = text[start + 1];
  const length = kind === "x" ? 2 : kind === "u" ? 4 : kind === "U" ? 8 : 0;
  if (length === 0) return null;
  const hex = text.slice(start + 2, start + 2 + length);
  if (hex.length !== length || !/^[0-9A-Fa-f]+$/.test(hex)) return null;
  const value = Number.parseInt(hex, 16);
  if (value > 0x10ffff) return null;
  return { value: String.fromCodePoint(value), end: start + 2 + length };
}

function decodePropertyKey(key) {
  let output = "";
  for (let index = 0; index < key.length; index += 1) {
    const codePoint = escapedCodePoint(key, index);
    if (codePoint?.end && key[index + 1] === "u") {
      output += codePoint.value;
      index = codePoint.end - 1;
      continue;
    }
    if (key[index] === "\\" && index + 1 < key.length) {
      output += key[index + 1];
      index += 1;
      continue;
    }
    output += key[index];
  }
  return output;
}

function propertyAssignment(line) {
  let index = skipPropertyWhitespace(line, 0);
  if (line[index] === "#" || line[index] === "!") return null;
  const keyStart = index;
  let escaped = false;
  for (; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "=" || char === ":") return { key: line.slice(keyStart, index).trim(), valueStart: index + 1 };
    if (char === " " || char === "\t" || char === "\f") {
      const separator = skipPropertyWhitespace(line, index);
      if (line[separator] === "=" || line[separator] === ":") return { key: line.slice(keyStart, index), valueStart: separator + 1 };
      return { key: line.slice(keyStart, index), valueStart: separator };
    }
  }
  return null;
}

function hasContinuation(line) {
  let slashes = 0;
  while (line.length > slashes && line[line.length - slashes - 1] === "\\") slashes += 1;
  return slashes % 2 === 1;
}

function withoutContinuationMarker(line) {
  return line.slice(0, -1);
}

function logicalPropertyLine(lines, start) {
  const chunks = [];
  let end = start;
  let continuing = false;
  while (end < lines.length) {
    const line = lines[end].content;
    const first = skipPropertyWhitespace(line, 0);
    // Java .properties comments terminate at their physical line; a trailing
    // backslash in a comment must never consume the next assignment. Once a
    // logical item is continuing, # and ! are value bytes, not new comments.
    const comment = !continuing && (line[first] === "#" || line[first] === "!");
    const continues = !comment && hasContinuation(line);
    chunks.push(continues ? withoutContinuationMarker(line) : line);
    end += 1;
    if (!continues) break;
    continuing = true;
  }
  return { content: chunks.map((chunk, index) => index === 0 ? chunk : chunk.trimStart()).join(""), end };
}

function redactProperties(text) {
  const lines = linesOf(text);
  let output = "";
  let redacted = false;
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const logical = logicalPropertyLine(lines, index);
    const assignment = propertyAssignment(logical.content);
    if (!assignment || !isSensitiveKey(decodePropertyKey(assignment.key))) {
      for (let current = index; current < logical.end; current += 1) output += lines[current].content + lines[current].ending;
      index = logical.end;
      continue;
    }
    const value = logical.content.slice(assignment.valueStart);
    if (value.trim().length === 0) {
      for (let current = index; current < logical.end; current += 1) output += lines[current].content + lines[current].ending;
      index = logical.end;
      continue;
    }
    const physical = propertyAssignment(line.content);
    if (!physical) {
      output += `[REDACTED]${line.ending}`;
    } else {
      output += `${line.content.slice(0, physical.valueStart)}[REDACTED]${line.ending}`;
    }
    for (let current = index + 1; current < logical.end; current += 1) output += lines[current].ending;
    redacted = true;
    index = logical.end;
  }
  return { text: output, redacted };
}

function refusedSensitivePresentation(revision) {
  return { bytes: Buffer.from("[REDACTED: sensitive configuration cannot be safely presented]\n", "utf8"), redacted: true,
    transform: "CONFIG_SECRET_PRESENTATION_REFUSAL", policyRevision: revision };
}

function redactDotenv(text, revision) {
  let entries;
  try { entries = parseDotenvDeclarations(text); }
  catch (error) {
    if (!(error instanceof DotenvSyntaxError)) throw error;
    return refusedSensitivePresentation(revision);
  }
  const spans = entries.filter(entry => isSensitiveKey(entry.key) && entry.contentEnd > entry.contentStart);
  let output = text;
  for (const entry of spans.reverse()) {
    // Physical separators survive unchanged; source bytes and canonical anchor
    // ranges are never rewritten. The returned copy is explicitly redacted.
    const masked = output.slice(entry.contentStart, entry.contentEnd).replace(/[^\r\n]+/g, "[REDACTED]");
    output = output.slice(0, entry.contentStart) + masked + output.slice(entry.contentEnd);
  }
  return { bytes: Buffer.from(output), redacted: spans.length > 0, transform: spans.length ? "CONFIG_SECRET_VALUE_REDACTION" : null, policyRevision: revision };
}

export function redactDisplayBytes(bytes, { revision = CURRENT_DISPLAY_POLICY_REVISION, format = "AUTO" } = {}) {
  // Runtime callers supply one grammar selected from admitted filename bytes.
  // Explicit null means ordinary material, not permission to guess YAML from
  // Markdown/code prose. AUTO remains the conservative legacy helper mode;
  // it is not selectable by an HTTP client.
  const text = utf8(bytes);
  if (containsPrivateKey(text) || containsPrivateKey(Buffer.from(bytes).toString("latin1"))) return refusedSensitivePresentation(revision);
  if (format === null) return { bytes: Buffer.from(bytes), redacted: false, transform: null, policyRevision: revision };
  if (format === "DOTENV") return text === null ? refusedSensitivePresentation(revision) : redactDotenv(text, revision);
  if (text === null) return format !== "AUTO" ? refusedSensitivePresentation(revision)
    : { bytes: Buffer.from(bytes), redacted: false, transform: null, policyRevision: revision };
  if (!["AUTO", "YAML", "JSON", "PROPERTIES"].includes(format)) return refusedSensitivePresentation(revision);
  if (format === "PROPERTIES") {
    const result = redactProperties(text);
    return { bytes: Buffer.from(result.text), redacted: result.redacted,
      transform: result.redacted ? "CONFIG_SECRET_VALUE_REDACTION" : null, policyRevision: revision };
  }
  let json = false;
  if (format !== "YAML") {
    try { JSON.parse(text); json = true; }
    catch { if (format === "JSON") return refusedSensitivePresentation(revision); }
  }
  const yaml = redactYamlPresentation(text, isSensitiveKey, { explicit: format === "YAML" || json, json });
  if (yaml.refused) return refusedSensitivePresentation(revision);
  const result = yaml.applicable ? yaml : redactProperties(text);
  return { bytes: Buffer.from(result.text), redacted: result.redacted,
    transform: result.redacted ? "CONFIG_SECRET_VALUE_REDACTION" : null, policyRevision: revision };
}

export function assertSafeMediaType(mediaType) {
  if (typeof mediaType !== "string" || mediaType.length === 0) return "application/octet-stream";
  // SVG/HTML/XML need a separate sanitizer and are never a pass-through view.
  if (/^(?:image\/svg\+xml|text\/html|application\/xhtml\+xml|application\/xml|text\/xml)$/i.test(mediaType)) {
    const error = new Error("不安全的内容类型不能直接展示");
    error.code = "F002_CONTENT_TYPE_RESTRICTED";
    throw error;
  }
  return mediaType.toLowerCase();
}
