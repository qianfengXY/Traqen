// Trusted test executable, never loaded from a captured repository.
import { writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const [mode] = process.argv.slice(2);
if (mode === "hold" || mode === "orphan") {
  process.stdout.write(mode === "hold" ? "READY\n" : `GROUP:${execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(process.pid)]).toString().trim()}\n`);
  setTimeout(() => process.exit(0), 20000);
} else if (mode === "burst" || mode === "burst-and-wait") {
  await writeFile("part-a", Buffer.alloc(700 * 1024, 1));
  await writeFile("part-b", Buffer.alloc(700 * 1024, 2));
  if (mode === "burst-and-wait") {
    process.stdout.write("WRITTEN\n");
    setTimeout(async () => { await writeFile("must-not-complete", "unbounded writer"); }, 10000);
  }
} else if (mode === "ok") {
  process.stdout.write("OK\n");
} else if (mode === "credential-check") {
  // Deliberately adversarial stderr, which must never become a public error.
  process.stderr.write("fixture-secret-do-not-expose\n");
  await readFile("missing-fixture-file");
} else {
  throw new Error("Unknown trusted fixture mode");
}
