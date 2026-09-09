import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import * as memoryObserver from "./support/source-truth-browser-memory-observer.js";
import { observeBrowserMemory } from "./support/source-truth-browser-memory-observer.js";

function nativeSession({ lost = false, missing = false, failure = false } = {}) {
  const session = new EventEmitter(); session.calls = [];
  session.send = async (command, parameters) => {
    session.calls.push({ command, parameters });
    if (command === "SystemInfo.getProcessInfo") return { processInfo: [{ type: "browser", id: 7 }, { type: "renderer", id: 8 }] };
    if (command === "Tracing.requestMemoryDump") {
      if (failure) throw new Error("native dump failed");
      return { success: true, dumpGuid: "0x1" };
    }
    if (command === "Tracing.end") {
      for (const pid of missing ? [7] : [7, 8]) session.emit("Tracing.dataCollected", { value: [{ ph: "v", pid, id: "0x0", args: { dumps: { allocators: {
        "malloc": { attrs: { size: { type: "scalar", units: "bytes", value: "200" } } },
        "malloc/allocated_objects": { attrs: { size: { type: "scalar", units: "bytes", value: "100" },
          object_count: { type: "scalar", units: "objects", value: "a" } } },
        "leveldatabase": { attrs: { name: { type: "string", units: "", value: "/private/user-file" } } },
      } } } }] });
      session.emit("Tracing.tracingComplete", { dataLossOccurred: lost });
    }
    return {};
  };
  return session;
}

test("native memory trace keeps per-PID allocator counters separate from RSS and parent/child totals", async () => {
  const session = nativeSession();
  assert.equal(typeof memoryObserver.captureNativeMemory, "function");
  const result = await memoryObserver.captureNativeMemory(session);
  assert.equal(result.acceptanceGate, false); assert.equal(result.explicitGcDiagnostic, false);
  assert.equal(result.requestDumpGuid, "0x1");
  assert.deepEqual(result.processes.map(p => [p.pid, p.role, p.traceDumpId]), [[7, "browser", "0x0"], [8, "renderer", "0x0"]]);
  assert.deepEqual(result.processes[0].allocators["malloc/allocated_objects"], {
    size: { units: "bytes", value: "256" }, object_count: { units: "objects", value: "10" },
  });
  assert.equal(result.processes[0].allocators.malloc.size.value, "512");
  assert.equal(JSON.stringify(result.processes).includes("/private/user-file"), false);
  assert.ok(result.traceEvents.length); // Preserve raw evidence separately; never present it as a stack profile.
  assert.deepEqual(session.calls.find(c => c.command === "Tracing.requestMemoryDump").parameters, { deterministic: false, levelOfDetail: "detailed" });
  assert.deepEqual(session.calls.find(c => c.command === "Tracing.start").parameters.traceConfig.memoryDumpConfig, { triggers: [] });
  assert.equal(session.eventNames().length, 0);
});

test("native memory trace rejects dropped evidence or missing process coverage and cleans listeners on errors", async () => {
  assert.equal(typeof memoryObserver.captureNativeMemory, "function");
  for (const [options, error] of [[{ lost: true }, /data loss/], [{ missing: true }, /missing.*renderer/], [{ failure: true }, /native dump failed/]]) {
    const session = nativeSession(options);
    await assert.rejects(memoryObserver.captureNativeMemory(session), error);
    assert.equal(session.eventNames().length, 0);
    assert.equal(session.calls.filter(c => c.command === "Tracing.end").length, 1);
  }
});

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
