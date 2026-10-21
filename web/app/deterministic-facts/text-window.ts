export function boundedTextRange(startLine: number, endLine = startLine) {
  if (![startLine, endLine].every(value => Number.isInteger(value) && value >= 1 && value <= 10_000_000) || endLine < startLine) throw new Error("材料行范围无效");
  return { startLine, endLine };
}

export function controlledTextWindow(bytes: Uint8Array, anchorLine = 1, pageSize = 200, selectedRange = boundedTextRange(anchorLine)) {
  if (bytes.byteLength > 8 * 1024 * 1024 || !Number.isInteger(anchorLine) || anchorLine < 1 || anchorLine > 10_000_000
    || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error("材料阅读行或窗口大小无效");
  const selection = boundedTextRange(selectedRange.startLine, selectedRange.endLine);
  const startLine = Math.floor((anchorLine - 1) / pageSize) * pageSize + 1;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const rows: { line: number; text: string }[] = [];
  // Scan physical separators without allocating a string/DOM row for every
  // newline in an 8 MiB material. Only the requested bounded page is retained.
  const separators = /\r\n|\r|\n/g;
  let offset = 0, totalLines = 1, match: RegExpExecArray | null;
  while ((match = separators.exec(text))) {
    if (totalLines >= startLine && rows.length < pageSize) rows.push({ line: totalLines, text: text.slice(offset, match.index) });
    offset = match.index + match[0].length;
    totalLines += 1;
  }
  if (totalLines >= startLine && rows.length < pageSize) rows.push({ line: totalLines, text: text.slice(offset) });
  const anchorPresent = anchorLine <= totalLines;
  const selectionPresent = selection.endLine <= totalLines;
  return { totalLines, anchorPresent, selectionPresent, startLine, endLine: anchorPresent ? Math.min(totalLines, startLine + pageSize - 1) : null,
    previousLine: anchorPresent && startLine > 1 ? Math.max(1, startLine - pageSize) : null,
    nextLine: anchorPresent && startLine + pageSize <= totalLines ? startLine + pageSize : null,
    rows: anchorPresent && selectionPresent ? rows.map(row => ({ ...row, selected: row.line >= selection.startLine && row.line <= selection.endLine })) : [] };
}
