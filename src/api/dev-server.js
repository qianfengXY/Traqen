import process from "node:process";

import { TraceabilityApplication } from "../application/traceability-application.js";
import { createTraceabilityHttpServer } from "./http-server.js";
import { MemoryTraceabilityStore } from "../storage/index.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("PORT must be an integer between 0 and 65535");
}

const runnerId = process.env.RUNNER_ID ?? null;
const runnerSharedSecret = process.env.RUNNER_SHARED_SECRET ?? null;
const scannerId = process.env.SCANNER_ID ?? null;
const scannerSharedSecret = process.env.SCANNER_SHARED_SECRET ?? null;
const application = new TraceabilityApplication({
  store: new MemoryTraceabilityStore(),
  runnerKeyResolver: (candidateRunnerId) =>
    runnerId && runnerSharedSecret && candidateRunnerId === runnerId ? runnerSharedSecret : null,
  scannerKeyResolver: (candidateScannerId) =>
    scannerId && scannerSharedSecret && candidateScannerId === scannerId ? scannerSharedSecret : null,
});
const server = createTraceabilityHttpServer({ application });

server.listen(port, host, () => {
  const address = server.address();
  process.stdout.write(`Traqen development API listening on http://${host}:${address.port}\n`);
});

function shutdown(signal) {
  server.close((error) => {
    if (error) {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    }
    process.stdout.write(`Traqen development API stopped after ${signal}\n`);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
