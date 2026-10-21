type TextRange = { kind: "TEXT"; lineStart: number; lineEnd: number; [key: string]: unknown };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function sourceAnchorTextRange(value: unknown): TextRange | null {
  const anchor = object(value);
  if (anchor.kind === "JSON_POINTER" && (typeof anchor.pointer !== "string" || (anchor.pointer !== "" && !anchor.pointer.startsWith("/")) || /~(?![01])/u.test(anchor.pointer))) return null;
  const range = anchor.kind === "JSON_POINTER" ? object(anchor.textRange) : anchor;
  if (range.kind !== "TEXT" || !Number.isSafeInteger(range.lineStart) || !Number.isSafeInteger(range.lineEnd)
    || Number(range.lineStart) < 1 || Number(range.lineEnd) < Number(range.lineStart)) return null;
  return range as TextRange;
}
