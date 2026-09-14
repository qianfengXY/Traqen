import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { sourceTruthPilot } from "./source-truth-pilot.js";
import { SourceCaptureService } from "../../src/source-truth/capture-service.js";
import { SourceUploadService } from "../../src/source-truth/upload-service.js";
import { SourceTruthRepository } from "../../src/source-truth/repository.js";
import { SourceTruthBlobStore } from "../../src/source-truth/blob-store.js";
import { SourceCaptureRunner } from "../../src/source-truth/capture-runner.js";
import { SourceMaterialRepository } from "../../src/source-truth/material-repository.js";

// Bounded diagnostic only: normal production services and an isolated fixture.
// Nested timings overlap. No SQL parameters, source text or credentials logged.
const scope = new AsyncLocalStorage(), measurements = new Map();
const add = (name, started) => {
  const current = measurements.get(name) ?? { calls: 0, milliseconds: 0 };
  current.calls++; current.milliseconds += performance.now() - started;
  measurements.set(name, current);
};
function wrap(prototype, method, top = false) {
  const original = prototype[method];
  prototype[method] = async function (...args) {
    const name = `${this.constructor.name}.${method}`;
    const execute = async () => {
      const started = performance.now();
      try { return await original.apply(this, args); }
      finally { if (scope.getStore()) add(`${scope.getStore()} > ${name}`, started); }
    };
    return top && !scope.getStore() ? scope.run(name, execute) : execute();
  };
}
for (const method of ["uploadChunk", "finishFile", "uploadFile"]) wrap(SourceCaptureService.prototype, method, true);
wrap(SourceUploadService.prototype, "checkpoint", true);
wrap(SourceCaptureRunner.prototype, "capture", true);
wrap(SourceCaptureRunner.prototype, "captureGitFiles");
wrap(SourceMaterialRepository.prototype, "dispose");
wrap(SourceMaterialRepository.prototype, "disposeBatch");
for (const method of ["context", "directoryContext"]) wrap(SourceCaptureService.prototype, method);
for (const method of ["authorize", "heartbeat", "getRun", "withLease", "withWorkspace"]) wrap(SourceTruthRepository.prototype, method);
for (const method of ["putBlob", "putChunk", "verifyBlob", "ready"]) wrap(SourceTruthBlobStore.prototype, method);
const query = pg.Client.prototype.query;
pg.Client.prototype.query = function (...args) {
  if (!scope.getStore()) return query.apply(this, args);
  const label = `${scope.getStore()} > SQL ${String(args[0]?.text ?? args[0]).trim().split(/\s+/)[0]}`;
  const started = performance.now();
  if (typeof args.at(-1) === "function") {
    const callback = args.pop();
    args.push(function (...result) { add(label, started); callback.apply(this, result); });
    return query.apply(this, args);
  }
  return query.apply(this, args).finally(() => add(label, started));
};
try {
  const result = await sourceTruthPilot({ filesPerSource: Number(process.argv[2] ?? 100), postgresBin: process.env.F001_TEST_PG_BIN,
    maxTreeRssBytes: 1024 * 1024 * 1024, maxTreeFileDescriptors: 1024,
    onProgress: (event) => { if (event.state !== "RUNNING") process.stdout.write(`${JSON.stringify(event)}\n`); } });
  process.stdout.write(`${JSON.stringify({ status: result.status, phases: result.phases, resources: result.resources })}\n`);
} finally {
  for (const [name, value] of measurements) process.stdout.write(`${JSON.stringify({ name, calls: value.calls, milliseconds: Math.round(value.milliseconds), meanMs: +(value.milliseconds / value.calls).toFixed(3) })}\n`);
}
