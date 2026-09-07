// Trusted native-write supervisor, invoked only under the cache-wide lock.
// lockf closes FD 3 on exec; FD 5 is a duplicate of that locked description.
// FD 4 is private control output: never inherited by source-facing Git.
import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import { Socket } from "node:net";
import { checkGitCacheCapacity, prepareGitCacheDirectory } from "./git-cache-capacity.js";
import { preserveInterruptedGitLocks } from "./git-cache-recovery.js";

const [root, maximum, minimumFree, reserve, cwd, executable, ...args] = process.argv.slice(2);
const budget = { root, maximum, minimumFree, reserve };
let failed = false;
const stopGroup = () => { try { process.kill(0, "SIGKILL"); } catch { process.exit(125); } };
// Only the API owner holds the other end. Its death closes this private pipe;
// native Git never inherits it, so an orphan cannot keep its own owner alive.
const owner = new Socket({ fd: 4, readable: true, writable: true });
owner.on("end", stopGroup).on("error", stopGroup).on("data", stopGroup);
owner.resume();
function deny(error) {
  if (failed) return;
  failed = true;
  try { writeSync(4, error.code === "SOURCE_CAPACITY_EXHAUSTED" ? "CAPACITY\n" : "STORAGE\n"); }
  catch { stopGroup(); }
  // Parent kills the entire native process group on this private signal. If it
  // disappeared, self-stop the same group rather than leave an unmetered writer.
  setTimeout(stopGroup, 500).unref();
}

try {
  await checkGitCacheCapacity(budget, BigInt(reserve));
  await prepareGitCacheDirectory(root, cwd);
  if (await preserveInterruptedGitLocks(cwd)) await checkGitCacheCapacity(budget, BigInt(reserve));
  const child = spawn(executable, args, { cwd, env: process.env, stdio: [0, 1, 2, 5] });
  let pending = null;
  const timer = setInterval(() => {
    if (pending || failed) return;
    pending = checkGitCacheCapacity(budget).catch(deny).finally(() => { pending = null; });
  }, 100);
  const code = await new Promise((resolve) => {
    child.once("error", () => resolve(125));
    child.once("close", (code) => resolve(code ?? 125));
  });
  clearInterval(timer);
  await pending;
  if (!failed) await checkGitCacheCapacity(budget);
  process.exitCode = failed ? 125 : code;
} catch (error) { deny(error); process.exitCode = 125; }
finally { owner.destroy(); }
