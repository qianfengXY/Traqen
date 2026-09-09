// Diagnostic CDP observer. Allocation sampling changes the measured runtime;
// consumers must not call this an acceptance run. Never forces collection.
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
