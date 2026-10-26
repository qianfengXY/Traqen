// Pure model projections. Frozen F001 material identity and complete read
// checkpoints remain unchanged; these are not newly admitted source objects.
export const originalContextBytes = 64 * 1024;
export const analysisContractVersion = 13;
const bytes = text => Buffer.byteLength(text, "utf8");

function fragment(material, start, end) {
  const body = Buffer.from(material.text), prefix = body.subarray(0, start), part = body.subarray(start, end);
  const startLine = (material.startLine ?? 1) + [...prefix].filter(b => b === 10).length;
  const breaks = [...part].filter(b => b === 10).length;
  return { ...material, text: part.toString("utf8"), byteStart: (material.byteStart ?? 0) + start, byteEnd: (material.byteStart ?? 0) + end,
    startLine, endLine: Math.max(startLine, startLine + breaks - (part.at(-1) === 10 ? 1 : 0)),
    partialFirstLine: start === 0 ? !!material.partialFirstLine : body[start - 1] !== 10,
    partialLastLine: end === body.length ? !!material.partialLastLine : body[end - 1] !== 10,
    completeMaterial: material.completeMaterial !== false && start === 0 && end === body.length };
}

export function originalLineWindow(material, startLine, endLine) {
  const body=Buffer.from(material.text),starts=[0];
  for(let i=0;i<body.length;i++)if(body[i]===10)starts.push(i+1);
  if(!Number.isSafeInteger(startLine)||!Number.isSafeInteger(endLine)||startLine<1||endLine<startLine||endLine>starts.length)
    throw new RangeError('Original line window is outside the frozen material');
  return fragment(material,starts[startLine-1],starts[endLine]??body.length);
}

export function partitionOriginalMaterials(materials, limit = originalContextBytes, {serialized=false,packRemaining=false} = {}) {
  const batches = [], current = []; let size = 0;
  const add = part => {
    const n = serialized ? bytes(JSON.stringify(part))+1 : bytes(part.text);
    if (size + n > limit && current.length) { batches.push(current.splice(0)); size = 0; }
    current.push(part); size += n;
  };
  for (const material of materials) {
    const body = Buffer.from(material.text);
    if (!body.length) { add(fragment(material, 0, 0)); continue; }
    for (let offset = 0; offset < body.length;) {
      // Analysis12 can fill a previous material's remaining packet capacity.
      // QA4 keeps the original default layout. No byte, line or identity is
      // dropped to save a call; the extra metadata is counted before cutting.
      let capacity=packRemaining?limit-size-(serialized?1:0):limit;
      if(packRemaining&&current.length&&capacity<(serialized?bytes(JSON.stringify(fragment(material,offset,offset)))+36:4)) {
        batches.push(current.splice(0));size=0;continue;
      }
      let end = Math.min(offset + capacity, body.length);
      if (end < body.length) {
        const newline = body.lastIndexOf(10, end - 1);
        if (newline >= offset) end = newline + 1;
        else while (end > offset && (body[end] & 0xc0) === 0x80) end--;
      }
      if (end <= offset) throw new RangeError("Original-context budget cannot contain a UTF-8 code point");
      if(serialized) {
        // Find the largest fitting byte range, not repeated half-sized pieces.
        // Halving wastes fixed call budgets even when a full bounded range
        // fits; UTF-8 offsets and the original material identity remain exact.
        let lower=offset,upper=end;
        while(lower<upper) {
          const middle=lower+Math.ceil((upper-lower)/2);let boundary=middle;
          while(boundary>offset && boundary<body.length && (body[boundary]&0xc0)===0x80)boundary--;
          if(bytes(JSON.stringify(fragment(material,offset,boundary)))+1<=capacity)lower=middle;
          else upper=middle-1;
        }
        end=lower;
        while(end>offset && end<body.length && (body[end]&0xc0)===0x80)end--;
        const newline=body.lastIndexOf(10,end-1);
        if(newline>=offset)end=newline+1;
        if(end<=offset)throw new RangeError('Original JSON metadata cannot fit the fixed context bound');
      }
      add(fragment(material, offset, end)); offset = end;
    }
  }
  if (current.length) batches.push(current);
  return batches.length ? batches : [[]];
}

export const sourceRange = m => ({ materialId: m.id, byteStart: m.byteStart, byteEnd: m.byteEnd,
  startLine: m.startLine, endLine: m.endLine, partialFirstLine: m.partialFirstLine, partialLastLine: m.partialLastLine });

export function citationVisible(c, fragments) {
  return Number.isSafeInteger(c?.startLine) && Number.isSafeInteger(c?.endLine) && c.startLine > 0
    && c.endLine >= c.startLine && typeof c.quote === "string" && c.quote.length > 0
    && fragments.some(m => m.id === c.materialId && c.startLine >= m.startLine && c.endLine <= m.endLine
      && m.text.split(/\r?\n/).slice(c.startLine - m.startLine, c.endLine - m.startLine + 1).join("\n").includes(c.quote));
}

// Re-read the actual original lines and their neighbors, never the model's
// quote alone. Retain a reason for each proposal whose complete context cannot
// fit. Such a proposal cannot acquire SUPPORTED through a blind model review.
export function originalEvidenceContext(proposals, materials, limit = originalContextBytes) {
  const byId = new Map(materials.map(m => [m.id, m])), offsets = new Map(), selected = new Map(), missingEvidence = [];
  for (const m of materials) {
    const body = Buffer.from(m.text), starts = [0];
    for (let i = 0; i < body.length; i++) if (body[i] === 10) starts.push(i + 1);
    offsets.set(m.id, { starts, length: body.length });
  }
  const merge = ranges => {
    const result = [];
    for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
      const prior = result.at(-1);
      if (prior && start <= prior[1]) prior[1] = Math.max(prior[1], end);
      else result.push([start, end]);
    }
    return result;
  };
  for (const proposal of proposals) {
    const next = new Map([...selected].map(([id, ranges]) => [id, ranges.map(r => [...r])]));
    let reason = Array.isArray(proposal?.evidence) ? null : "INVALID_ORIGINAL_CITATIONS";
    for (const c of Array.isArray(proposal?.evidence) ? proposal.evidence : []) {
      const m = byId.get(c?.materialId), location = offsets.get(c?.materialId);
      if (!m || !Number.isSafeInteger(c.startLine) || !Number.isSafeInteger(c.endLine)
        || c.startLine < 1 || c.endLine < c.startLine || c.endLine > location.starts.length) { reason = "INVALID_ORIGINAL_RANGE"; break; }
      const start = location.starts[Math.max(0, c.startLine - 3)], end = location.starts[c.endLine + 2] ?? location.length;
      next.set(m.id, merge([...(next.get(m.id) ?? []), [start, end]]));
    }
    const total = [...next.values()].flat().reduce((n, [start, end]) => n + end - start, 0);
    if (total > limit) reason = "ORIGINAL_CONTEXT_BYTE_BUDGET";
    if (reason) missingEvidence.push({ key: proposal.key, reason });
    else { selected.clear(); for (const [id, ranges] of next) selected.set(id, ranges); }
  }
  const snippets = [...selected].flatMap(([id, ranges]) => ranges.map(([start, end]) => fragment(byId.get(id), start, end)));
  return { materials: snippets, evidenceContext: { kind: "ORIGINAL_LINE_RANGES", maxBytes: limit,
    scope: "PARTIAL_WINDOWS_NOT_COMPLETE_SEMANTIC_CONTEXT",
    rules: ["These are actual original citation lines and two neighboring lines, not a proof that all business premises are present.",
      "Use global original line numbers. If a necessary premise or counterexample is outside supplied ranges, return INSUFFICIENT or UNKNOWN, never invent it."],
    suppliedBytes: snippets.reduce((n, m) => n + bytes(m.text), 0), missingEvidence } };
}
