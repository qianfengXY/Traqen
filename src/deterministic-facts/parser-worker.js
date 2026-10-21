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
    let step, phase = null, postedAt = 0;
    while (!(step = steps.next()).done) {
      const progress = step.value, now = performance.now();
      if (progress.phase !== phase || now - postedAt >= 100 || progress.completed === progress.total) {
        parentPort.postMessage({ type: "PROGRESS", progress }); phase = progress.phase; postedAt = now;
      }
    }
    parentPort.postMessage({ type: "RESULT", result: step.value });
  } catch (error) {
    parentPort.postMessage({ type: "ERROR", code: error instanceof F002Error ? error.code : null, message: error instanceof Error ? error.message : "F002 parser failed" });
  }
});
