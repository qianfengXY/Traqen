import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Internal acceptance only: explicit existing binaries, private clusters from
// isolatedPostgres, synthetic source bytes and an environment allow-list.
// No service/database URL, project .env, user program or package installation.
if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) throw new Error("supply exactly one installed PostgreSQL bin directory");
const bin = await realpath(process.argv[2]);
for (const name of ["initdb", "postgres", "pg_dump", "pg_restore", "psql"]) {
  const executable = await realpath(path.join(bin, name)), permissions = await stat(executable);
  if (!permissions.isFile() || permissions.mode & 0o022) throw new Error("native PostgreSQL distribution is not protected");
}
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), "traqen-f002-recovery-"));
const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC", F001_TEST_PG_BIN: bin };
const groups = [
  ["repository", ["test/f002-repository.test.js"]],
  ["publication", ["test/f002-publication.test.js"]],
  ["requests", ["test/f002-requests.test.js"]],
  ["admission", ["test/f002-admission.test.js"]],
  ["native-postgres", ["test/f002-publication-postgres.test.js", "test/f002-recovery-postgres.test.js"]],
  ["source-native-regression", ["test/source-truth-postgres.test.js", "test/source-truth-backup.test.js"]],
];
const results = [];
for (const [name, files] of groups) {
  const log = path.join(directory, `${name}.log`), stream = createWriteStream(log, { flags: "wx" });
  const started = Date.now(), child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...files], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let tail = "", error = null;
  const record = chunk => { stream.write(chunk); tail = (tail + chunk.toString()).slice(-24_000); };
  child.stdout.on("data", record); child.stderr.on("data", record);
  child.on("error", e => { error = e.message; });
  const timeout = setTimeout(() => { error = "recovery_verifier_timeout"; child.kill("SIGTERM"); }, 180_000);
  const result = await new Promise(resolve => child.on("close", (exit, signal) => resolve({ name, exit, signal, error, durationMs: Date.now() - started, log })));
  clearTimeout(timeout); await new Promise(resolve => stream.end(resolve));
  results.push(result); console.log(JSON.stringify(result)); console.log(tail);
  // This chain is conditional: no later group may be represented as run or
  // green after a failure. Retain exactly the attempted groups in the receipt.
  if (result.exit !== 0 || result.error) break;
}
const passed = results.length === groups.length && results.every(r => r.exit === 0 && r.error === null);
await writeFile(path.join(directory, "summary.json"), JSON.stringify({ scope: "OWNED_SYNTHETIC_NATIVE_POSTGRES_F001_F002",
  status: passed ? "PASSED" : "FAILED", volumeProtection: "TEST_DOUBLE_NOT_PHYSICAL_BACKUP_ACCEPTANCE", results }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ finalExit: passed ? 0 : 1, parentPath: `${directory}/`, childPath: "summary.json" }));
process.exitCode = passed ? 0 : 1;
