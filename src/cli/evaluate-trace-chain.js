#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

import { createSnapshotManifest, evaluateTraceChain } from "../domain/index.js";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("Usage: node src/cli/evaluate-trace-chain.js <input.json>");
  }

  const input = JSON.parse(await readFile(filePath, "utf8"));
  input.snapshotManifest = createSnapshotManifest(input.snapshotManifest);
  if (input.execution?.snapshotManifestId === "__CURRENT__") {
    input.execution.snapshotManifestId = input.snapshotManifest.id;
  }
  if (input.conformance?.snapshotManifestId === "__CURRENT__") {
    input.conformance.snapshotManifestId = input.snapshotManifest.id;
  }
  const chain = evaluateTraceChain(input);
  process.stdout.write(`${JSON.stringify(chain, null, 2)}\n`);
  process.exitCode = chain.complete ? 0 : 2;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
