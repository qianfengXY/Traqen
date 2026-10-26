export const parserPhases = Object.freeze(["NORMALIZE", "MATERIALS", "DOCUMENT_LINKS", "JAVASCRIPT_MODULES", "JAVA_BINDINGS", "TEST_REFERENCES", "ENDPOINT_CONTRACTS", "SORT_OBJECTS", "SORT_EVIDENCE", "SORT_FACTS", "SORT_GAPS", "RESULT"]);

export function createParserDeadline({ materialCount, timeoutMs, onTimeout, maxDurationMs = 20 * 60_000,
  timers = { setTimeout, clearTimeout }, now = () => performance.now() }) {
  if (!Number.isSafeInteger(materialCount) || materialCount < 0 || materialCount > 200_000
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000
    || !Number.isSafeInteger(maxDurationMs) || maxDurationMs <= 0 || maxDurationMs > 20 * 60_000
    || typeof onTimeout !== "function") throw new TypeError("invalid parser deadline");
  const started = now(); let unitStarted = started, phase = -1, completed = 0, stopped = false, unitTimer, wallTimer;
  const stop = () => { stopped = true; timers.clearTimeout(unitTimer); timers.clearTimeout(wallTimer); };
  const expire = reason => {
    if (stopped) return;
    const observed = now();
    const details = { version: 1, deadline: reason, phase: phase < 0 ? "STARTUP" : parserPhases[phase], completed, total: materialCount,
      elapsedMs: Math.ceil(observed - started), progressAgeMs: Math.ceil(observed - unitStarted), unitBudgetMs: timeoutMs, wallBudgetMs: maxDurationMs };
    stop(); onTimeout(reason, details);
  };
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

// Errors may also originate in injected parsers. Never persist arbitrary
// error.details, paths, source text or exception messages as diagnostics.
export function safeParserTimeoutDetails(error) {
  const value = error?.code === "F002_PARSE_TIMEOUT" ? error.details?.parser : null;
  const duration = number => Number.isSafeInteger(number) && number >= 0;
  if (value?.version !== 1 || !["unit", "wall"].includes(value.deadline)
    || !["STARTUP", ...parserPhases].includes(value.phase)
    || !Number.isSafeInteger(value.total) || value.total < 0 || value.total > 200_000
    || !Number.isSafeInteger(value.completed) || value.completed < 0 || value.completed > value.total
    || ![value.elapsedMs, value.progressAgeMs, value.unitBudgetMs, value.wallBudgetMs].every(duration)
    || value.unitBudgetMs < 1 || value.unitBudgetMs > 120_000 || value.wallBudgetMs < 1 || value.wallBudgetMs > 1200000) return null;
  const result = Object.fromEntries(["version", "deadline", "phase", "completed", "total", "elapsedMs", "progressAgeMs", "unitBudgetMs", "wallBudgetMs"].map(key => [key, value[key]]));
  const received = value.lastReceived;
  if (received && parserPhases.includes(received.phase) && received.total === value.total
    && Number.isSafeInteger(received.completed) && received.completed >= 0 && received.completed <= value.total && duration(received.receivedElapsedMs)) {
    result.lastReceived = { phase: received.phase, completed: received.completed, total: value.total, receivedElapsedMs: received.receivedElapsedMs };
    const worker = received.worker;
    if (worker && duration(worker.elapsedMs) && duration(worker.stepElapsedMs) && (worker.stepCpuMs === null || duration(worker.stepCpuMs))) {
      result.lastReceived.worker = { elapsedMs: worker.elapsedMs, stepElapsedMs: worker.stepElapsedMs, stepCpuMs: worker.stepCpuMs };
    }
  }
  return result;
}
