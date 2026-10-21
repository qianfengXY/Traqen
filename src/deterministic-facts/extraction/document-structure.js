import path from "node:path";
import { isRestrictedText } from "../sensitive-content.js";

// static-document-v1: paragraphs, ATX hierarchy, simple inline link/image
// occurrences and a fixed heading-fragment algorithm. Not a full CommonMark
// renderer, natural-language interpreter, or remote resource reader.
// Document privacy is a fixed spelling check, not a configuration display
// parser. A refusal to interpret Markdown as YAML says nothing about whether
// its literal paragraph is sensitive. Check source escapes conservatively
// without parsing, resolving, or changing the published document bytes.
function restricted(text) {
  if (isRestrictedText(text)) return true;
  const spelling = text.replace(/\\(?:\r\n|[\r\n])[ \t]*|\\(?:u([\da-fA-F]{4})|x([\da-fA-F]{2})|U([\da-fA-F]{8})|([^\r\n]))/g,
    (source, unicode, hex, wide, escaped) => {
      if (escaped !== undefined) return escaped;
      const digits = unicode ?? hex ?? wide;
      if (digits === undefined) return "";
      const codePoint = Number.parseInt(digits, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : source;
    });
  return isRestrictedText(spelling);
}
const titleFragment = title => title.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, "").trim().replace(/[ \t]+/g, "-");
class DocumentLimit extends Error { constructor(start, end) { super("DOCUMENT_STRUCTURE_LIMIT"); this.start = start; this.end = end; } }

function lines(text) {
  const result = []; let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index < text.length && text[index] !== "\r" && text[index] !== "\n") continue;
    result.push({ start, end: index, text: text.slice(start, index) });
    if (text[index] === "\r" && text[index + 1] === "\n") index += 1;
    start = index + 1;
  }
  return result;
}

function inlineLinks(text, gaps) {
  const links = [];
  if (/<[A-Za-z!/]/.test(text)) { gaps.push({ code: "DOCUMENT_INLINE_UNSUPPORTED", start: 0, end: text.length }); return links; }
  for (let index = 0; index < text.length;) {
    if (text[index] === "\\") { index += 2; continue; }
    if (text[index] === "`") {
      let end = index + 1; while (text[end] === "`") end += 1;
      const marker = text.slice(index, end), close = text.indexOf(marker, end);
      if (close < 0) { gaps.push({ code: "DOCUMENT_INLINE_UNSUPPORTED", start: index, end: text.length }); break; }
      index = close + marker.length; continue;
    }
    const image = text[index] === "!" && text[index + 1] === "[", open = image ? index + 1 : index;
    if (text[open] !== "[") { index += 1; continue; }
    const close = text.indexOf("]", open + 1), label = text.slice(open + 1, close);
    if (close < 0 || label.includes("[")) { gaps.push({ code: "DOCUMENT_INLINE_UNSUPPORTED", start: index, end: text.length }); break; }
    if (text[close + 1] !== "(") {
      if (text[close + 1] === "[") gaps.push({ code: "DOCUMENT_INLINE_UNSUPPORTED", start: index, end: close + 2 });
      index = close + 1; continue;
    }
    const end = text.indexOf(")", close + 2), target = text.slice(close + 2, end);
    if (end < 0 || /[()\s<>\\]|&(?:#\w+|\w+);/.test(target) || /[\\`]/.test(label)) {
      gaps.push({ code: "DOCUMENT_INLINE_UNSUPPORTED", start: index, end: end < 0 ? text.length : end + 1 });
      if (end < 0) break; index = end + 1; continue;
    }
    links.push({ image, name: label || (image ? "[image reference]" : "[link reference]"), target, start: index, end: end + 1 });
    index = end + 1;
  }
  return links;
}

export function extractDocumentStructure({ material, text, limits = {}, textAnchor, addObject, addFact, addGap, documentLinks, documentSections }) {
  const { maxDocumentObjects = 10_000, maxDocumentParagraphBytes = 65_536 } = limits;
  if (!Number.isSafeInteger(maxDocumentObjects) || maxDocumentObjects < 1 || maxDocumentObjects > 10_000
    || !Number.isSafeInteger(maxDocumentParagraphBytes) || maxDocumentParagraphBytes < 1 || maxDocumentParagraphBytes > 65_536) throw new TypeError("invalid fixed document limits");
  const plain = material.displayPath.toLowerCase().endsWith(".txt"), descriptors = [], gaps = [], sections = [];
  let paragraph = null, fence = null, html = false, restrictedLevel = null;
  const append = item => { if (descriptors.length >= maxDocumentObjects) throw new DocumentLimit(item.start, item.end); descriptors.push(item); return item; };
  const flush = () => {
    if (!paragraph) return;
    const value = text.slice(paragraph.start, paragraph.end);
    if (Buffer.byteLength(value) > maxDocumentParagraphBytes) throw new DocumentLimit(paragraph.start, paragraph.end);
    if (restricted(value)) gaps.push({ code: "DOCUMENT_TEXT_RESTRICTED", ...paragraph });
    else {
      const owner = append({ ...paragraph, kind: "DOCUMENT_PARAGRAPH", name: [...value.trim()].slice(0, 120).join(""), value });
      if (!plain) {
        const localGaps = [], links = inlineLinks(value, localGaps);
        gaps.push(...localGaps.map(gap => ({ ...gap, start: gap.start + paragraph.start, end: gap.end + paragraph.start })));
        for (const link of links) append({ ...link, kind: link.image ? "DOCUMENT_IMAGE" : "DOCUMENT_LINK", parent: owner,
          start: link.start + paragraph.start, end: link.end + paragraph.start });
      }
    }
    paragraph = null;
  };
  try {
    for (const line of lines(text)) {
      if (!line.text.trim()) { flush(); html = false; continue; }
      if (!plain) {
        const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
        if (fence) { if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null; continue; }
        if (marker && !(marker[1][0] === "`" && marker[2].includes("`"))) { flush(); fence = { char: marker[1][0], length: marker[1].length }; continue; }
        if (html || /^ {0,3}</.test(line.text)) { flush(); html = true; gaps.push({ code: "DOCUMENT_HTML_UNSUPPORTED", ...line }); continue; }
        if (/^(?: {4}|\t)/.test(line.text)) { flush(); gaps.push({ code: "DOCUMENT_INDENTED_CODE_UNSUPPORTED", ...line }); continue; }
        if (/^ {0,3}(?:>|[-+*][ \t]|\d+[.)][ \t]|\[[^\]]+\]:|[-=]{2,}[ \t]*$)/.test(line.text)) { flush(); gaps.push({ code: "DOCUMENT_BLOCK_UNSUPPORTED", ...line }); continue; }
        const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/.exec(line.text);
        if (heading) {
          flush(); const name = (heading[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
          const level = heading[1].length;
          if (restrictedLevel !== null && level > restrictedLevel) { gaps.push({ code: "DOCUMENT_TEXT_RESTRICTED", ...line }); continue; }
          restrictedLevel = null;
          while (sections.length && sections.at(-1).level >= heading[1].length) sections.pop();
          if (restricted(name)) { restrictedLevel = level; gaps.push({ code: "DOCUMENT_TEXT_RESTRICTED", ...line }); continue; }
          const start = line.start + line.text.indexOf(heading[1]) + heading[1].length;
          const section = append({ kind: "DOCUMENT_SECTION", name, start, end: line.end, parent: sections.at(-1), level: heading[1].length });
          sections.push(section); continue;
        }
      }
      if (restrictedLevel !== null) { flush(); gaps.push({ code: "DOCUMENT_TEXT_RESTRICTED", ...line }); continue; }
      if (!paragraph) paragraph = { start: line.start, end: line.end, parent: sections.at(-1) };
      else paragraph.end = line.end;
    }
    flush();
  } catch (error) {
    if (!(error instanceof DocumentLimit)) throw error;
    addGap(material, "markdown", error.message, textAnchor(text, error.start, error.end)); return;
  }
  for (const gap of gaps) addGap(material, "markdown", gap.code, textAnchor(text, gap.start, gap.end));
  for (const descriptor of descriptors) {
    const anchor = textAnchor(text, descriptor.start, descriptor.end), object = addObject(material, descriptor.kind, descriptor.name, anchor);
    object.parentId = descriptor.parent?.object?.objectId ?? material.root.objectId; descriptor.object = object;
    const nameFactId = addFact({ subject: object, predicate: "name", value: { datatype: "string", value: descriptor.name }, material, anchor });
    if (descriptor.kind === "DOCUMENT_SECTION") documentSections.push({ material, object, nameFactId, fragment: titleFragment(descriptor.name) });
    if (descriptor.kind === "DOCUMENT_PARAGRAPH") addFact({ subject: object, predicate: "literalValue", value: { datatype: "string", value: descriptor.value }, material, anchor });
    if (descriptor.target !== undefined) documentLinks.push({ ...descriptor, material, object, anchor });
  }
}

export function resolveDocumentLinks({ documentLinks, documentSections, materialByLocation, addFact, addGap }) {
  for (const link of documentLinks) {
    const reject = code => addGap(link.material, "markdown", code, link.anchor);
    let pathname, fragment;
    try {
      const split = link.target.indexOf("#");
      pathname = decodeURIComponent(split < 0 ? link.target : link.target.slice(0, split));
      fragment = split < 0 ? null : decodeURIComponent(link.target.slice(split + 1));
    } catch { reject("DOCUMENT_LINK_INVALID"); continue; }
    if (/[\u0000-\u001f\u007f\\]/.test(pathname) || pathname.includes("?")) { reject("DOCUMENT_LINK_INVALID"); continue; }
    if (pathname.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(pathname)) { reject("DOCUMENT_LINK_OUT_OF_SCOPE"); continue; }
    const resolved = pathname ? path.posix.normalize(path.posix.join(path.posix.dirname(link.material.displayPath), pathname)) : link.material.displayPath;
    if (resolved === ".." || resolved.startsWith("../")) { reject("DOCUMENT_LINK_OUT_OF_SCOPE"); continue; }
    const material = materialByLocation.get(`${link.material.componentId}\u0000${resolved}`);
    if (!material) { reject("DOCUMENT_LINK_UNRESOLVED"); continue; }
    let target = material.root, section;
    if (fragment !== null) {
      const matches = documentSections.filter(item => item.material.materialId === material.materialId && item.fragment === fragment);
      if (matches.length !== 1) { reject(matches.length ? "DOCUMENT_FRAGMENT_AMBIGUOUS" : "DOCUMENT_FRAGMENT_UNRESOLVED"); continue; }
      section = matches[0]; target = section.object;
    }
    const premise = addFact({ subject: link.object, predicate: "path", value: { datatype: "string", value: link.target }, material: link.material, anchor: link.anchor });
    addFact({ subject: link.object, predicate: "refersTo", target, basis: "DERIVED", premiseFactIds: [premise, ...(section ? [section.nameFactId] : [])], material: link.material, anchor: link.anchor });
  }
}
