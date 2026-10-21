import assert from "node:assert/strict";
import test from "node:test";
import { createParserDeadline, parserPhases } from "../src/deterministic-facts/parser-deadline.js";
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
