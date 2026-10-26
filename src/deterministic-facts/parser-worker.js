import { parentPort } from "node:worker_threads";

import { compileDeterministicFactSteps } from "./extraction/compile.js";
import { F002Error } from "./errors.js";

if (!parentPort) throw new Error("F002 parser worker requires a parent port");

parentPort.on("message", (message) => {
  try {
    if (message?.type !== "COMPILE") throw new TypeError("unsupported F002 parser operation");
    // The only parser-worker operation is deterministic parsing of already read
    // bytes. It never imports or executes a source artifact.
    const steps = compileDeterministicFactSteps(message.input);
    const started = performance.now();
    let step, phase = null, postedAt = 0;
    while (true) {
      const stepStarted = performance.now();
      const cpuStarted = typeof process.threadCpuUsage === "function" ? process.threadCpuUsage() : null;
      step = steps.next();
      const cpu = cpuStarted ? process.threadCpuUsage(cpuStarted) : null;
      const progress = step.value, now = performance.now();
      if (step.done) break;
      if (progress.phase !== phase || now - postedAt >= 100 || progress.completed === progress.total) {
        parentPort.postMessage({ type: "PROGRESS", progress, timing: { elapsedMs: Math.ceil(now - started),
          stepElapsedMs: Math.ceil(now - stepStarted), stepCpuMs: cpu ? Math.ceil((cpu.user + cpu.system) / 1000) : null } });
        phase = progress.phase; postedAt = now;
      }
    }
    parentPort.postMessage({ type: "RESULT", result: step.value });
  } catch (error) {
    parentPort.postMessage({ type: "ERROR", code: error instanceof F002Error ? error.code : null, message: error instanceof Error ? error.message : "F002 parser failed" });
  }
});
