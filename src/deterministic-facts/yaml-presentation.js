import { Composer, Lexer, Parser, isAlias, isMap, isScalar, isSeq } from "yaml";
import { containsPrivateKey } from "./sensitive-content.js";

// Bound concrete syntax before the library's recursive semantic composer.
// Never call toJS/resolve aliases, construct custom tags, or reserialize source.
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_SYNTAX_NODES = 100_000;
const MAX_DEPTH = 64;
const collections = new Set(["block-map", "block-seq", "flow-collection"]);
const tags = new Set(["tag:yaml.org,2002:str", "tag:yaml.org,2002:map", "tag:yaml.org,2002:seq"]);

function boundedSyntax(tokens) {
  const pending = tokens.map(value => ({ value, depth: 0 }));
  let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (++count > MAX_SYNTAX_NODES || value.type === "alias") return false;
    const nextDepth = depth + (collections.has(value.type) ? 1 : 0);
    if (nextDepth > MAX_DEPTH) return false;
    for (const child of Object.values(value)) if (child && typeof child === "object") pending.push({ value: child, depth: nextDepth });
  }
  return true;
}

export function redactYamlPresentation(text, sensitiveKey, { explicit = false, json = false } = {}) {
  const refusal = { applicable: true, refused: true };
  if (Buffer.byteLength(text) > MAX_BYTES) return refusal;
  try {
    // The CST itself must not grow without bound before boundedSyntax can
    // examine it. Count the library's real lexemes without retaining them.
    let lexemes = 0;
    for (const token of new Lexer().lex(text)) {
      if (typeof token !== "string" || ++lexemes > MAX_SYNTAX_NODES) return refusal;
    }
    const tokens = [];
    for (const token of new Parser().parse(text)) {
      tokens.push(token);
      if (tokens.length > MAX_SYNTAX_NODES) return refusal;
    }
    if (!boundedSyntax(tokens)) return refusal;
    const applicable = explicit || tokens.some(token => token.type === "document" &&
      (collections.has(token.value?.type) || ["single-quoted-scalar", "double-quoted-scalar", "block-scalar"].includes(token.value?.type)));
    if (!applicable) return { applicable: false };
    const documents = [];
    const composer = new Composer({ schema: "failsafe", resolveKnownTags: false, keepSourceTokens: true,
      stringKeys: true, uniqueKeys: false, strict: true, prettyErrors: false, logLevel: "silent" });
    for (const document of composer.compose(tokens)) {
      if (document.errors.length || document.warnings.length || documents.length >= 32) return refusal;
      documents.push(document);
    }
    const pending = documents.map(document => document.contents), spans = [];
    while (pending.length) {
      const node = pending.pop();
      if (!node) continue;
      if (isScalar(node) && containsPrivateKey(node.value)) return refusal;
      if (isAlias(node) || (node.tag && !tags.has(node.tag))) return refusal;
      if (isMap(node)) {
        const keys = new Set();
        for (const pair of node.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== "string" || keys.has(pair.key.value)) return refusal;
          keys.add(pair.key.value);
          if (sensitiveKey(pair.key.value)) {
            // Preserve the established refusal for explicit/complex sensitive
            // keys; their exact semantic identity is now parser-derived.
            if (pair.key.anchor || pair.key.tag || pair.srcToken?.start?.some(token => token.type === "explicit-key-ind")) return refusal;
            const range = pair.value?.range;
            if (range && range[1] > range[0]) spans.push({ start: range[0], end: range[1] });
          }
          pending.push(pair.key, pair.value);
        }
      } else if (isSeq(node)) pending.push(...node.items);
    }
    // Parent sensitive mappings cover their children. Merge once, then replace
    // from right to left without shifting any unrelated source or line ending.
    spans.sort((a, b) => a.start - b.start || b.end - a.end);
    const merged = [];
    for (const span of spans) {
      const previous = merged.at(-1);
      if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
      else merged.push({ ...span });
    }
    let output = text;
    for (const { start, end } of merged.reverse()) {
      const lines = text.slice(start, end).match(/\r\n|\r|\n/g) ?? [];
      output = output.slice(0, start) + (json ? '"[REDACTED]"' : "[REDACTED]") + lines.join("") + output.slice(end);
    }
    return { applicable: true, refused: false, text: output, redacted: spans.length > 0 };
  } catch {
    // A parser fault is never permission to return the original configuration.
    return refusal;
  }
}
