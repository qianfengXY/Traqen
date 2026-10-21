export const parserPhases = Object.freeze(["NORMALIZE", "MATERIALS", "DOCUMENT_LINKS", "JAVASCRIPT_MODULES", "JAVA_BINDINGS", "TEST_REFERENCES", "ENDPOINT_CONTRACTS", "SORT_OBJECTS", "SORT_EVIDENCE", "SORT_FACTS", "SORT_GAPS", "RESULT"]);

export function createParserDeadline({ materialCount, timeoutMs, onTimeout, maxDurationMs = 20 * 60_000,
  timers = { setTimeout, clearTimeout }, now = () => performance.now() }) {
  if (!Number.isSafeInteger(materialCount) || materialCount < 0 || materialCount > 200_000
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000
    || !Number.isSafeInteger(maxDurationMs) || maxDurationMs <= 0 || maxDurationMs > 20 * 60_000
    || typeof onTimeout !== "function") throw new TypeError("invalid parser deadline");
  const started = now(); let unitStarted = started, phase = -1, completed = 0, stopped = false, unitTimer, wallTimer;
  const stop = () => { stopped = true; timers.clearTimeout(unitTimer); timers.clearTimeout(wallTimer); };
  const expire = reason => { if (stopped) return; stop(); onTimeout(reason); };
  const arm = () => { timers.clearTimeout(unitTimer); unitStarted = now(); unitTimer = timers.setTimeout(() => expire("unit"), timeoutMs); };
  arm(); wallTimer = timers.setTimeout(() => expire("wall"), maxDurationMs);
  return { stop, complete: () => !stopped && phase === parserPhases.length - 1 && completed === materialCount, progress(value) {
    if (stopped) return false;
    if (now() - started >= maxDurationMs) { expire("wall"); return false; }
    if (now() - unitStarted >= timeoutMs) { expire("unit"); return false; }
    if (!value || value.total !== materialCount || !Number.isSafeInteger(value.completed)
      || value.completed < completed || value.completed > materialCount) return false;
    const next = parserPhases.indexOf(value.phase);
    if (next === -1 || (next !== phase && next !== phase + 1)) return false;
    if (next === phase && (next !== 1 || value.completed <= completed)) return false;
    if (next === 0 && value.completed !== 0) return false;
    if (next === 1 && phase === 0 && value.completed !== 0) return false;
    if (next > 1 && (completed !== materialCount || value.completed !== materialCount)) return false;
    phase = next; completed = value.completed; arm(); return true;
  } };
}
