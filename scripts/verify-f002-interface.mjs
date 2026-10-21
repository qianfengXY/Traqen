import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This verifier never starts an application against production stores. HTTP
// tests allocate their own loopback ports and sourceDatabase uses PGlite.
const root = fileURLToPath(new URL("../", import.meta.url));
const web = path.join(root, "web");
const directory = await mkdtemp(path.join(tmpdir(), "traqen-f002-interface-"));
if (process.argv.length > 3 || (process.argv[2] !== undefined && process.argv[2] !== "--structure")) throw new Error("unsupported verifier arguments");
const structureGroups = process.argv[2] === "--structure" ? [
  { name: "structure-model-tests", cwd: root, command: process.execPath, args: ["--test", "test/f002-structure.test.js", "test/f002-json.test.js", "test/f002-properties.test.js", "test/f002-dotenv.test.js", "test/f002-document.test.js", "test/f002-javascript-bindings.test.js", "test/f002-express-static.test.js", "test/f002-java-declarations.test.js", "test/f002-java-bindings.test.js", "test/f002-spring-mappings.test.js", "test/f002-test-assets.test.js", "test/f002-test-reports.test.js", "test/f002-endpoint-contracts.test.js", "test/f002-extraction.test.js", "test/f002-verification.test.js", "test/f002-reference-corpus.test.js", "test/f002-structured-reference-corpus.test.js"] },
  { name: "structure-worker-tests", cwd: root, command: process.execPath, args: ["--test", "--test-concurrency=1", "test/f002-structure-worker.test.js", "test/f002-worker.test.js", "test/f002-runtime.test.js"] },
] : [];
const groups = [
  ...structureGroups,
  { name: "canvas-verifier-tests", cwd: root, command: process.execPath, args: ["--test", "test/f002-canvas-verifier.test.js"] },
  { name: "theme-contrast-verifier-tests", cwd: root, command: process.execPath, args: ["--test", "test/f002-theme-contrast-verifier.test.js"] },
  { name: "request-context-tests", cwd: root, command: process.execPath, args: ["--test", "--test-name-pattern=investigation preview|request list pages|request list refuses", "test/f002-requests.test.js"] },
  { name: "recovery-tests", cwd: root, command: process.execPath, args: ["--test", "--test-name-pattern=scope operation|cancellation reconciliation|replay cancellation|restores draft|journal persistence|operation reconciliation|scope reconciliation", "test/f002-repository.test.js", "test/f002-publication.test.js", "test/f002-requests.test.js", "web/tests/deterministic-facts-model.test.mjs"] },
  { name: "interface-tests", cwd: root, command: process.execPath, args: ["--test", "test/f002-http.test.js", "test/f002-query.test.js", "test/f002-accessibility-verifier.test.js", "test/f002-native-accessibility-verifier.test.js", "web/tests/deterministic-facts-keyboard.test.mjs", "web/tests/deterministic-facts-client.test.mjs", "web/tests/deterministic-facts-model.test.mjs", "web/tests/deterministic-facts-request-result.test.mjs", "web/tests/deterministic-facts-request-access.test.mjs", "web/tests/deterministic-facts-request-input.test.mjs", "web/tests/deterministic-facts-request-material.test.mjs", "web/tests/deterministic-facts-request-catalog.test.mjs", "web/tests/deterministic-facts-request-recovery.test.mjs", "web/tests/deterministic-facts-delivery-browser.test.mjs", "web/tests/deterministic-facts-search.test.mjs", "web/tests/deterministic-facts-view.test.mjs", "web/tests/deterministic-facts-traversal.test.mjs", "web/tests/deterministic-facts-directory.test.mjs", "web/tests/deterministic-facts-range.test.mjs", "web/tests/deterministic-facts-explanation.test.mjs", "web/tests/deterministic-facts-wiring.test.mjs"] },
  { name: "raster-tests", cwd: root, command: process.execPath, args: ["--test", "test/f002-raster.test.js"] },
  // Full material safety is required: no name filter may omit YAML lexical or
  // real admitted READ regressions from a green interface verification.
  { name: "material-security-tests", cwd: root, command: process.execPath, args: ["--test", "--test-concurrency=1", "test/f002-material.test.js", "test/f002-security.test.js", "test/f002-presentation-policy.test.js", "test/f002-dotenv.test.js"] },
  { name: "types", cwd: web, command: process.execPath, args: ["node_modules/typescript/bin/tsc", "--noEmit"] },
  { name: "lint", cwd: web, command: process.execPath, args: ["node_modules/eslint/bin/eslint.js", "app/deterministic-facts", "app/traqen-product.tsx", "app/product-surfaces.tsx"] },
  { name: "build", cwd: web, command: "npm", args: ["run", "build"] },
];
const results = [];
for (const group of groups) {
  const started = Date.now();
  const log = path.join(directory, `${group.name}.log`);
  const stream = createWriteStream(log, { flags: "wx" });
  const child = spawn(group.command, group.args, { cwd: group.cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let tail = "", failure = null;
  const record = chunk => { stream.write(chunk); tail = (tail + chunk.toString()).slice(-32_000); };
  child.stdout.on("data", record); child.stderr.on("data", record);
  child.on("error", error => { failure = error.message; });
  const timeout = setTimeout(() => { failure = "verifier_timeout"; child.kill("SIGTERM"); }, 180_000);
  const result = await new Promise(resolve => child.on("close", (exit, signal) => resolve({ name: group.name, exit, signal, error: failure, durationMs: Date.now() - started, log })));
  clearTimeout(timeout);
  await new Promise(resolve => stream.end(resolve));
  results.push(result);
  console.log(JSON.stringify(result));
  console.log(tail);
  if (result.exit !== 0 || result.error) break;
}
await writeFile(path.join(directory, "summary.json"), JSON.stringify(results, null, 2), { flag: "wx" });
console.log(JSON.stringify({ finalExit: results.some(result => result.exit !== 0 || result.error) ? 1 : 0, parentPath: `${directory}/`, childPath: "summary.json" }));
process.exitCode = results.some(result => result.exit !== 0 || result.error) ? 1 : 0;
