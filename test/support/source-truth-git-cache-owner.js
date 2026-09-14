// A disposable API-process analogue used only by the owner-crash regression.
import { fileURLToPath } from "node:url";
import { GitProcess } from "../../src/source-truth/git-process.js";
import { gitCacheBudget } from "../../src/source-truth/git-cache-capacity.js";
const [root, cwd] = process.argv.slice(2);
const writer = fileURLToPath(new URL("./source-truth-git-cache-writer.js", import.meta.url));
const git = new GitProcess({ executable: process.execPath });
for await (const bytes of git.stream([writer, "orphan"], { cwd, cacheBudget: gitCacheBudget(root) })) process.stdout.write(bytes);
