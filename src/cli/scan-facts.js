#!/usr/bin/env node
import process from "node:process";
import path from "node:path";

import { signFactBundle } from "../domain/index.js";
import { JavaScriptProjectScanner } from "../scanner/index.js";

function usage() {
  return [
    "Usage: node src/cli/scan-facts.js --project <id> --snapshot <id> --source-component <id> [options]",
    "",
    "Options:",
    "  --root <path>       Project root (default: current directory)",
    "  --summary           Print coverage counts instead of the complete FactBundle",
    "  --help              Show this message",
    "",
    "Complete bundle output requires SCANNER_SHARED_SECRET. SCANNER_ID and",
    "SCANNER_VERSION default to javascript-node-scanner and 0.1.0.",
  ].join("\n");
}

function parseArguments(argv) {
  const options = { rootPath: process.cwd(), summary: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { help: true };
    if (argument === "--summary") {
      options.summary = true;
      continue;
    }
    const fields = {
      "--root": "rootPath",
      "--project": "projectId",
      "--snapshot": "snapshotManifestId",
      "--source-component": "sourceComponentId",
    };
    const field = fields[argument];
    if (!field) throw new TypeError(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`${argument} requires a value`);
    options[field] = value;
    index += 1;
  }
  if (!options.projectId || !options.snapshotManifestId || !options.sourceComponentId) {
    throw new TypeError("--project, --snapshot, and --source-component are required");
  }
  options.rootPath = path.resolve(options.rootPath);
  return options;
}

function countsBy(records, field) {
  return Object.fromEntries(
    [...records.reduce((counts, record) => {
      counts.set(record[field], (counts.get(record[field]) ?? 0) + 1);
      return counts;
    }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function summary(bundle, rootPath) {
  return {
    bundleId: bundle.id,
    projectId: bundle.projectId,
    snapshotManifestId: bundle.snapshotManifestId,
    sourceComponentId: bundle.sourceComponentId,
    rootPath,
    sourceDigest: bundle.sourceDigest,
    complete: bundle.complete,
    diagnostics: bundle.diagnostics,
    nodeCount: bundle.nodes.length,
    edgeCount: bundle.edges.length,
    nodeTypes: countsBy(bundle.nodes, "type"),
    predicates: countsBy(bundle.edges, "predicate"),
    locatableNodeCount: bundle.nodes.filter(
      (node) => node.source.artifact && node.source.startLine > 0 && node.source.contentHash.startsWith("sha256:"),
    ).length,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const extractor = {
    id: process.env.SCANNER_ID ?? "javascript-node-scanner",
    version: process.env.SCANNER_VERSION ?? "0.1.0",
  };
  const scanner = new JavaScriptProjectScanner({ extractor });
  const bundle = await scanner.scan(options);
  if (options.summary) {
    process.stdout.write(`${JSON.stringify(summary(bundle, options.rootPath), null, 2)}\n`);
    return;
  }
  const secret = process.env.SCANNER_SHARED_SECRET;
  if (!secret) throw new Error("SCANNER_SHARED_SECRET is required for complete FactBundle output");
  process.stdout.write(`${JSON.stringify(signFactBundle(bundle, secret), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
