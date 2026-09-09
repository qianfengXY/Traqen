import assert from "node:assert/strict";
import test from "node:test";
import { observeBrowserMemory } from "./support/source-truth-browser-memory-observer.js";

test("browser allocation diagnosis preserves heap and raw call stacks without collecting garbage", async () => {
  const calls = [];
  const profile = { head: { id: 1, selfSize: 0, callFrame: { functionName: "root" }, children: [] }, samples: [] };
  const values = { "Runtime.getHeapUsage": { usedSize: 120, totalSize: 200, embedderHeapUsedSize: 40, backingStorageSize: 30 },
    "Memory.getDOMCounters": { documents: 1, nodes: 12, jsEventListeners: 2 },
    "HeapProfiler.getSamplingProfile": { profile }, "SystemInfo.getProcessInfo": { processInfo: [{ type: "renderer", id: 8 }] } };
  const session = (name) => ({ send: async (command, parameters) => { calls.push({ name, command, parameters }); return values[command] ?? {}; },
    detach: async () => { calls.push({ name, command: "detach" }); } });
  const observer = await observeBrowserMemory(session("page"), session("browser"));
  const result = await observer.snapshot();
  assert.equal(result.acceptanceGate, false);
  assert.equal(result.explicitGcDiagnostic, false);
  assert.deepEqual(result.heap, values["Runtime.getHeapUsage"]);
  assert.deepEqual(result.dom, values["Memory.getDOMCounters"]);
  assert.deepEqual(result.browserProcesses, values["SystemInfo.getProcessInfo"].processInfo);
  assert.deepEqual(result.allocationProfile, profile);
  assert.deepEqual(calls[0], { name: "page", command: "HeapProfiler.startSampling", parameters: {
    samplingInterval: 65536, stackDepth: 64, includeObjectsCollectedByMajorGC: false, includeObjectsCollectedByMinorGC: false,
  } });
  await observer.stop();
  assert.equal(calls.some((call) => /collectGarbage|takeHeapSnapshot/.test(call.command)), false);
  assert.deepEqual(calls.slice(-3).map((call) => `${call.name}:${call.command}`), ["page:HeapProfiler.stopSampling", "page:detach", "browser:detach"]);
});

test("browser allocation diagnosis fails visibly and detaches even when the profiler stops with an error", async () => {
  const detached = [], failure = new Error("test profiler unavailable");
  const observer = await observeBrowserMemory({ send: async (command) => { if (command !== "HeapProfiler.startSampling") throw failure; }, detach: async () => { detached.push("page"); } },
    { send: async () => ({}), detach: async () => { detached.push("browser"); } });
  await assert.rejects(observer.snapshot(), (error) => error === failure);
  await assert.rejects(observer.stop(), (error) => error === failure);
  assert.deepEqual(detached.sort(), ["browser", "page"]);
});
