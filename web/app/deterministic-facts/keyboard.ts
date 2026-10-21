type EvidenceKey = Pick<KeyboardEvent, "key" | "keyCode" | "isComposing" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

// IME's final keydown can follow compositionend: isComposing is then false,
// but legacy PROCESSKEY (229) still marks an IME-owned key. A UI shortcut is
// not the composition confirmation, nor an editing/platform modifier chord.
export function isEvidenceShortcut(event: EvidenceKey, keys: readonly string[], shift = false) {
  return keys.includes(event.key) && !event.isComposing && event.keyCode !== 229
    && !event.ctrlKey && !event.metaKey && !event.altKey && event.shiftKey === shift;
}
