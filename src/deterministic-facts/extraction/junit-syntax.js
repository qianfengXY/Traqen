// Fixed, non-validating static JUnit subset. No DTD, custom entity, namespace,
// network, schema, XInclude or processing-instruction execution exists here.
// Parse the whole document before publishing any case, including ignored logs.
export class JunitSyntaxError extends Error {
  constructor(code, index) { super(code); this.code = code; this.index = index; }
}
const character = cp => cp === 9 || cp === 10 || cp === 13 || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
const predefined = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const children = new Map([
  ["testsuites", new Set(["testsuite"])],
  ["testsuite", new Set(["testsuite", "testcase", "properties", "system-out", "system-err"])],
  ["testcase", new Set(["failure", "error", "skipped", "properties", "system-out", "system-err"])],
  ["properties", new Set(["property"])],
]);
const textElements = new Set(["failure", "error", "skipped", "system-out", "system-err"]);

export function parseJunitSyntax(text, limits = {}) {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0, count = 0, cases = 0, root = null;
  const stack = [], nodes = [];
  const fail = (code = "JUNIT_XML_PARSE_FAILED", at = i) => { throw new JunitSyntaxError(code, at); };
  const maxNodes = limits.maxXmlNodes ?? 20_000, maxDepth = limits.maxXmlDepth ?? 64;
  const maxCases = limits.maxReportCases ?? 2000, maxAttributeBytes = limits.maxXmlAttributeBytes ?? 65_536;
  for (let p = 0; p < text.length;) { const cp = text.codePointAt(p); if (!character(cp)) fail("JUNIT_XML_PARSE_FAILED", p); p += cp > 0xffff ? 2 : 1; }
  const decode = (value, start, attribute = false) => {
    let out = "", p = 0;
    while (p < value.length) {
      if (value[p] !== "&") {
        if (attribute && value[p] === "<") fail("JUNIT_XML_PARSE_FAILED", start + p);
        if (attribute && /[\r\n\t]/.test(value[p])) { if (value[p] === "\r" && value[p + 1] === "\n") p++; out += " "; p++; }
        else out += value[p++];
        continue;
      }
      const end = value.indexOf(";", p + 1); if (end < 0 || end - p > 32) fail("JUNIT_XML_PARSE_FAILED", start + p);
      const token = value.slice(p + 1, end);
      if (Object.hasOwn(predefined, token)) out += predefined[token];
      else if (/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(token)) {
        const cp = token[1] === "x" ? Number.parseInt(token.slice(2), 16) : Number(token.slice(1));
        if (!character(cp)) fail("JUNIT_XML_PARSE_FAILED", start + p); out += String.fromCodePoint(cp);
      } else fail("JUNIT_XML_PARSE_FAILED", start + p);
      p = end + 1;
    }
    return out;
  };
  const whitespace = () => { const start = i; while (/[\t\n\r ]/.test(text[i] ?? "") && i < text.length) i++; return i > start; };
  const name = () => {
    const start = i; while (i < text.length && !/[\t\n\r =/>?]/.test(text[i])) i++;
    const value = text.slice(start, i); if (!value) fail();
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)) fail("JUNIT_XML_UNSUPPORTED", start);
    return value;
  };
  const content = (start, end, cdata = false) => {
    const raw = text.slice(start, end);
    if (!cdata && raw.includes("]]>")) fail("JUNIT_XML_PARSE_FAILED", start);
    if (!stack.length && raw.trim()) fail("JUNIT_XML_PARSE_FAILED", start);
    if (stack.length && !textElements.has(stack.at(-1).name) && raw.trim()) fail("JUNIT_XML_UNSUPPORTED", start);
    if (!cdata) decode(raw, start);
  };
  while (i < text.length) {
    if (text[i] !== "<") { const end = text.indexOf("<", i); const next = end < 0 ? text.length : end; content(i, next); i = next; continue; }
    const start = i;
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4); if (end < 0 || text.slice(i + 4, end).includes("--") || text[end - 1] === "-") fail(); i = end + 3; continue;
    }
    if (text.startsWith("<![CDATA[", i)) {
      if (!stack.length) fail(); const end = text.indexOf("]]>", i + 9); if (end < 0) fail(); content(i + 9, end, true); i = end + 3; continue;
    }
    if (text.startsWith("<!", i)) fail("JUNIT_XML_UNSAFE");
    if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i + 2); if (end < 0) fail();
      const declaration = text.slice(i, end + 2);
      if (i !== (text.charCodeAt(0) === 0xfeff ? 1 : 0) || !/^<\?xml[\t\r\n ]+version[\t\r\n ]*=[\t\r\n ]*(["'])1\.0\1(?:[\t\r\n ]+encoding[\t\r\n ]*=[\t\r\n ]*(["'])[Uu][Tt][Ff]-8\2)?(?:[\t\r\n ]+standalone[\t\r\n ]*=[\t\r\n ]*(["'])(?:yes|no)\3)?[\t\r\n ]*\?>$/.test(declaration)) fail("JUNIT_XML_UNSUPPORTED");
      i = end + 2; continue;
    }
    if (text.startsWith("</", i)) {
      i += 2; const tag = name(); whitespace(); if (text[i++] !== ">" || stack.at(-1)?.name !== tag) fail();
      stack.pop().end = i; continue;
    }
    i++; const tag = name(), attrs = new Map();
    let space = whitespace();
    while (i < text.length && text[i] !== ">" && !text.startsWith("/>", i)) {
      if (!space) fail(); const key = name(); if (attrs.has(key)) fail(); if (key === "xmlns") fail("JUNIT_XML_UNSUPPORTED");
      whitespace(); if (text[i++] !== "=") fail(); whitespace(); const quote = text[i++]; if (!["'", '"'].includes(quote)) fail();
      const valueStart = i, end = text.indexOf(quote, i); if (end < 0) fail();
      const raw = text.slice(i, end); if (Buffer.byteLength(raw) > maxAttributeBytes || attrs.size >= (limits.maxXmlAttributes ?? 64)) fail("JUNIT_XML_LIMIT", valueStart);
      attrs.set(key, { value: decode(raw, valueStart, true), start: valueStart, end }); i = end + 1; space = whitespace();
    }
    const empty = text.startsWith("/>", i); if (empty) i += 2; else if (text[i++] !== ">") fail();
    const parent = stack.at(-1);
    if (!parent && root !== null) fail("JUNIT_XML_PARSE_FAILED", start);
    if (parent ? !children.get(parent.name)?.has(tag) : !["testsuite", "testsuites"].includes(tag)) fail("JUNIT_XML_UNSUPPORTED", start);
    if (++count > maxNodes || stack.length + 1 > maxDepth || (tag === "testcase" && ++cases > maxCases)) fail("JUNIT_XML_LIMIT", start);
    const node = { name: tag, attrs, start, end: empty ? i : null, children: [], parent };
    if (parent) parent.children.push(node); else root = node; nodes.push(node); if (!empty) stack.push(node);
  }
  if (!root || stack.length) fail();
  return { root, nodes };
}
