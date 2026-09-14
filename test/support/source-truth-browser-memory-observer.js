// Diagnostic CDP observer. Allocation sampling changes the measured runtime;
// consumers must not call this an acceptance run. Never forces collection.

// One bounded trace window per observation. These allocator counters overlap
// hierarchically: never sum parent and child nodes or equate them with OS RSS.
export async function captureNativeMemory(session, { requireRenderer = true } = {}) {
  const roles = (await session.send("SystemInfo.getProcessInfo")).processInfo
    .filter(p => p.type === "browser" || p.type === "renderer");
  if (!roles.some(p => p.type === "browser") || (requireRenderer && !roles.some(p => p.type === "renderer"))) {
    throw new Error("missing browser/renderer process identity");
  }
  const events = []; let bytes = 0, overflow = false, tracing = false, timer;
  const collect = ({ value }) => {
    bytes += Buffer.byteLength(JSON.stringify(value));
    if (bytes > 64 * 1024 * 1024) overflow = true;
    if (!overflow) for (const event of value) events.push(event);
  };
  let complete;
  const completion = new Promise(resolve => { complete = resolve; });
  session.on("Tracing.dataCollected", collect); session.on("Tracing.tracingComplete", complete);
  try {
    await session.send("Tracing.start", { transferMode: "ReportEvents", traceConfig: {
      recordMode: "recordUntilFull", traceBufferSizeInKb: 16384,
      includedCategories: ["disabled-by-default-memory-infra"], excludedCategories: ["*"], memoryDumpConfig: { triggers: [] },
    } });
    tracing = true;
    const request = await session.send("Tracing.requestMemoryDump", { deterministic: false, levelOfDetail: "detailed" });
    if (!request.success) throw new Error("native dump request failed");
    await session.send("Tracing.end"); tracing = false;
    const end = await Promise.race([completion, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("native trace completion timeout")), 15000);
    })]);
    if (end.dataLossOccurred !== false || overflow) throw new Error("native trace data loss or buffer overflow");
    const selected = new Set(["malloc", "malloc/allocated_objects", "malloc/partitions", "malloc/partitions/allocator",
      "malloc/partitions/original", "partition_alloc", "partition_alloc/partitions", "partition_alloc/partitions/fast_malloc",
      "blink_gc", "v8", "leveldatabase"]);
    const processes = roles.map(role => {
      const dumps = events.filter(e => e.ph === "v" && e.pid === role.id && e.args?.dumps?.allocators?.malloc);
      if (dumps.length !== 1) throw new Error(`missing or ambiguous native allocator dump for ${role.type} PID ${role.id}`);
      const dump = dumps[0], allocators = {};
      if (!dump.args.dumps.allocators["malloc/allocated_objects"]) throw new Error("missing allocated object counters");
      for (const [name, allocation] of Object.entries(dump.args.dumps.allocators)) {
        if (!selected.has(name)) continue;
        allocators[name] = {};
        for (const [key, attribute] of Object.entries(allocation.attrs ?? {})) {
          if (attribute.type !== "scalar" || !["bytes", "objects"].includes(attribute.units)) continue;
          if (!/^[0-9a-f]+$/i.test(attribute.value)) throw new Error("invalid native scalar encoding");
          allocators[name][key] = { units: attribute.units, value: BigInt(`0x${attribute.value}`).toString() };
        }
      }
      return { pid: role.id, role: role.type, traceDumpId: dump.id, allocators };
    });
    // This Chromium exporter reports 0x0 even when the request returns 0x1.
    // Preserve both; the evidence is the single dump in this trace window,
    // not a claim of request-GUID equality or native allocation call stacks.
    return { acceptanceGate: false, explicitGcDiagnostic: false,
      measurement: "SINGLE_TRACE_WINDOW_ALLOCATOR_COUNTERS_NOT_RSS_OR_STACKS",
      requestDumpGuid: request.dumpGuid, dataLossOccurred: false, processes, traceEvents: events };
  } finally {
    clearTimeout(timer);
    try { if (tracing) await session.send("Tracing.end"); }
    finally { session.removeListener("Tracing.dataCollected", collect); session.removeListener("Tracing.tracingComplete", complete); }
  }
}

export async function observeBrowserMemory(pageSession, browserSession) {
  const detach = () => Promise.all([pageSession.detach(), browserSession.detach()]);
  try {
    await pageSession.send("HeapProfiler.startSampling", { samplingInterval: 65536, stackDepth: 64,
      includeObjectsCollectedByMajorGC: false, includeObjectsCollectedByMinorGC: false });
  } catch (error) { await detach(); throw error; }
  return {
    async snapshot() {
      const [heap, dom, processes, allocation] = await Promise.all([
        pageSession.send("Runtime.getHeapUsage"), pageSession.send("Memory.getDOMCounters"),
        browserSession.send("SystemInfo.getProcessInfo"), pageSession.send("HeapProfiler.getSamplingProfile"),
      ]);
      return { acceptanceGate: false, explicitGcDiagnostic: false, heap, dom,
        allocationMeasurement: "SAMPLED_ALLOCATION_ESTIMATE_NOT_RETAINING_PATH_OR_RSS", samplingIntervalBytes: 65536,
        browserProcesses: processes.processInfo, allocationProfile: allocation.profile };
    },
    async stop() {
      try { await pageSession.send("HeapProfiler.stopSampling"); }
      finally { await detach(); }
    },
  };
}
