import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const execute = promisify(execFile), root = fileURLToPath(new URL("../../", import.meta.url));
// Deployment-owned executable identity, never a model/HTTP-provided digest.
// A source checkout without a verifiable committed implementation stays usable
// for analysis, but cannot claim production publication readiness.
export async function resolveF003ImplementationVersion() {
  try {
    const git = args => execute("git", ["-c", "core.fsmonitor=false", "-C", root, ...args], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    const { stdout: head } = await git(["rev-parse", "HEAD"]);
    const { stdout: changes } = await git(["status", "--porcelain", "--untracked-files=all", "--", "src", "db"]);
    const { stdout: names } = await git(["ls-tree", "-r", "--name-only", "HEAD", "--", "src", "db"]);
    const hash = createHash("sha256");
    for (const name of names.trim().split("\n").filter(Boolean).sort()) {
      const bytes = await readFile(resolve(root, name)); hash.update(`${name}\0${bytes.length}\0`); hash.update(bytes);
    }
    return { status: changes ? "UNVERIFIED" : "VERIFIED", commitSha: head.trim(), sourceDigest: hash.digest("hex") };
  } catch { return { status: "UNVERIFIED", commitSha: null, sourceDigest: null }; }
}
