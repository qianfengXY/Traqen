import assert from "node:assert/strict";
import test from "node:test";
import { createParserDeadline, parserPhases, safeParserTimeoutDetails } from "../src/deterministic-facts/parser-deadline.js";
import { compileDeterministicFacts, compileDeterministicFactSteps } from "../src/deterministic-facts/extraction/compile.js";
import { structuredF002Profile } from "../src/deterministic-facts/runtime.js";
import { canonicalRecords } from "../src/deterministic-facts/output-assembly.js";
import { workerParse } from "../src/deterministic-facts/worker.js";

function clock() {
  let time = 0, id = 0; const pending = new Map();
  return { now: () => time, pending,
    timers: { setTimeout(callback, delay) { pending.set(++id, { at: time + delay, callback }); return id; }, clearTimeout(key) { pending.delete(key); } },
    advance(by) { const end = time + by; while (true) { const next = [...pending].filter(([,v]) => v.at <= end).sort((a,b) => a[1].at-b[1].at)[0]; if (!next) break; pending.delete(next[0]); time = next[1].at; next[1].callback(); } time = end; },
  };
}
const progress = (phase, completed, total = 3) => ({ phase, completed, total });

test("F002 native parser refuses an already revoked signal without starting or completing work", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(workerParse({ materials: [] }, { timeoutMs: 1000, signal: controller.signal }), { name: "AbortError" });
});

test("F002 parse watchdog budgets completed material units, not the entire multi-material scope", () => {
  const c = clock(), expired = [];
  const deadline = createParserDeadline({ materialCount: 3, timeoutMs: 10, maxDurationMs: 1000, onTimeout: reason => expired.push(reason), timers: c.timers, now: c.now });
  assert.equal(deadline.progress(progress("NORMALIZE", 0)), true); c.advance(9);
  assert.equal(deadline.progress(progress("MATERIALS", 0)), true);
  for (let done = 1; done <= 3; done++) { c.advance(9); assert.equal(deadline.progress(progress("MATERIALS", done)), true); }
  for (const phase of parserPhases.slice(2)) { c.advance(9); assert.equal(deadline.progress(progress(phase, 3)), true); }
  assert.deepEqual(expired, []); assert.ok(c.now() > 10); deadline.stop(); assert.equal(c.pending.size, 0);
});

test("F002 duplicate, regressive, out-of-scope and skipped-phase messages cannot keep a stuck parser alive", () => {
  const c = clock(), expired = [];
  const deadline = createParserDeadline({ materialCount: 3, timeoutMs: 10, maxDurationMs: 1000, onTimeout: reason => expired.push(reason), timers: c.timers, now: c.now });
  deadline.progress(progress("NORMALIZE", 0)); deadline.progress(progress("MATERIALS", 0)); deadline.progress(progress("MATERIALS", 1)); c.advance(9);
  for (const invalid of [progress("MATERIALS", 1), progress("MATERIALS", 0), progress("MATERIALS", 4), progress("MATERIALS", 2, 4), progress("SORT_FACTS", 3), progress("DOCUMENT_LINKS", 1), null]) {
    assert.equal(deadline.progress(invalid), false);
  }
  c.advance(1); assert.deepEqual(expired, ["unit"]); assert.equal(c.pending.size, 0);
});

test("F002 real progress cannot extend the independent total parse wall budget", () => {
  const c = clock(), expired = [];
  const deadline = createParserDeadline({ materialCount: 3, timeoutMs: 10, maxDurationMs: 30, onTimeout: reason => expired.push(reason), timers: c.timers, now: c.now });
  deadline.progress(progress("NORMALIZE", 0)); c.advance(8); deadline.progress(progress("MATERIALS", 0));
  c.advance(8); deadline.progress(progress("MATERIALS", 1)); c.advance(8); deadline.progress(progress("MATERIALS", 2)); c.advance(6);
  assert.deepEqual(expired, ["wall"]); assert.equal(c.pending.size, 0);
});

test("F002 timeout diagnostics identify the last accepted phase and unit or wall bound without claiming a cause", () => {
  for (const kind of ["unit", "wall"]) {
    const c = clock(), expired = [];
    const deadline = createParserDeadline({ materialCount: 3, timeoutMs: 10, maxDurationMs: kind === "wall" ? 18 : 1000,
      onTimeout: (reason, details) => expired.push({ reason, details }), timers: c.timers, now: c.now });
    deadline.progress(progress("NORMALIZE", 0)); deadline.progress(progress("MATERIALS", 0));
    c.advance(9); deadline.progress(progress("MATERIALS", 1)); c.advance(kind === "wall" ? 9 : 10);
    assert.deepEqual(expired, [{ reason: kind, details: { version: 1, deadline: kind, phase: "MATERIALS", completed: 1, total: 3,
      elapsedMs: kind === "wall" ? 18 : 19, progressAgeMs: kind === "wall" ? 9 : 10, unitBudgetMs: 10, wallBudgetMs: kind === "wall" ? 18 : 1000 } }]);
    assert.equal(c.pending.size, 0);
  }
});

test("F002 startup expiry is distinguished from a completed parsing unit", () => {
  const c = clock(), expired = [];
  createParserDeadline({ materialCount: 32, timeoutMs: 10, onTimeout: (reason, details) => expired.push(details), timers: c.timers, now: c.now });
  c.advance(10);
  assert.equal(expired[0]?.phase, "STARTUP");
  assert.equal(expired[0]?.completed, 0);
  assert.equal(expired[0]?.wallBudgetMs, 1200000);
});

test("F002 native progress separates worker step observation from parent receipt without changing compiled records", async () => {
  const input = { workspaceId: "workspace", bundleId: "b".repeat(64), profile: structuredF002Profile(), materials: [
    { componentId: "a".repeat(64), pathBytes: Buffer.from("a.js").toString("base64url"), bytes: Buffer.from("export function a() { return 1; }") },
  ] };
  const observations = [];
  const compiled = await workerParse(input, { timeoutMs: 10000, onProgress: (value, observation) => observations.push({ value, observation }) });
  assert.deepEqual(canonicalRecords(compiled), canonicalRecords(compileDeterministicFacts(input)));
  assert.equal(observations.at(-1).value.phase, "RESULT");
  for (const { observation } of observations) {
    assert.ok(observation && observation.receivedElapsedMs >= 0);
    assert.ok(observation.worker.elapsedMs >= 0);
    assert.ok(observation.worker.stepElapsedMs >= 0);
    assert.ok(observation.worker.stepCpuMs === null || observation.worker.stepCpuMs >= 0);
    assert.deepEqual(Object.keys(observation.worker).sort(), ["elapsedMs", "stepCpuMs", "stepElapsedMs"]);
  }
});

test("F002 persists only allowlisted timeout observations, never arbitrary parser error details", () => {
  const observed = { version: 1, deadline: "unit", phase: "MATERIALS", completed: 1, total: 32,
    elapsedMs: 12, progressAgeMs: 10, unitBudgetMs: 10, wallBudgetMs: 1200000 };
  const error = { code: "F002_PARSE_TIMEOUT", details: { parser: { ...observed, path: "/private/source", stderr: "SECRET",
    lastReceived: { phase: "MATERIALS", completed: 2, total: 32, receivedElapsedMs: 13, source: "SECRET",
      worker: { elapsedMs: 11, stepElapsedMs: 10, stepCpuMs: 9, credential: "SECRET" } } } } };
  assert.deepEqual(safeParserTimeoutDetails(error), { ...observed, lastReceived: { phase: "MATERIALS", completed: 2, total: 32,
    receivedElapsedMs: 13, worker: { elapsedMs: 11, stepElapsedMs: 10, stepCpuMs: 9 } } });
  for (const invalid of [{ ...observed, phase: "private-path" }, { ...observed, completed: 33 }, { ...observed, elapsedMs: Infinity },
    { ...observed, unitBudgetMs: 120001 }, { ...observed, wallBudgetMs: 1200001 }]) {
    assert.equal(safeParserTimeoutDetails({ code: error.code, details: { parser: invalid } }), null);
  }
  assert.equal(safeParserTimeoutDetails({ code: "F002_PARSE_RUNTIME_FAILURE", details: error.details }), null);
});

test("F002 stepped compilation retains complete input, cross-material linking and canonical output", () => {
  const material = (name, text) => ({ componentId: "a".repeat(64), pathBytes: Buffer.from(name).toString("base64url"), bytes: Buffer.from(text), mediaType: "text/plain" });
  const input = { workspaceId: "workspace", bundleId: "b".repeat(64), profile: structuredF002Profile(), materials: [material("a.md", "# Alpha\n\n[child](b.md#beta)\n"), material("b.md", "# Beta\n"), material("unsupported.ts", "export const value: number = 1;")] };
  const iterator = compileDeterministicFactSteps(input), steps = []; let next;
  while (!(next = iterator.next()).done) steps.push(next.value);
  assert.deepEqual(steps.filter(step => step.phase === "MATERIALS").map(step => step.completed), [0,1,2,3]);
  assert.deepEqual([...new Set(steps.map(step => step.phase))], parserPhases);
  assert.deepEqual(canonicalRecords(next.value), canonicalRecords(compileDeterministicFacts(input)));
  assert.ok(next.value.facts.some(fact => fact.predicate === "refersTo"));
  assert.ok(next.value.gaps.some(gap => gap.code === "FORMAT_UNSUPPORTED"));
});
