import { parentPort } from "node:worker_threads";

import { compileDeterministicFacts } from "./extraction/compile.js";

if (!parentPort) throw new Error("F002 parser worker requires a parent port");

parentPort.on("message", (message) => {
  try {
    if (message?.type !== "COMPILE") throw new TypeError("unsupported F002 parser operation");
    // The only parser-worker operation is deterministic parsing of already read
    // bytes. It never imports or executes a source artifact.
    parentPort.postMessage({ type: "RESULT", result: compileDeterministicFacts(message.input) });
  } catch (error) {
    parentPort.postMessage({ type: "ERROR", message: error instanceof Error ? error.message : "F002 parser failed" });
  }
});
