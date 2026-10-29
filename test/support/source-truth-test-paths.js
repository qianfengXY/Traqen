// F001 fixture output placement only. This is not a runtime authority, launcher,
// platform admission protocol or permission to read any existing private data.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lstat, mkdir, mkdtemp, readFile, realpath } from "node:fs/promises";

const checkout = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
const inside = (root, value) => value === root || value.startsWith(root + path.sep);
async function projectRoot() {
  const entry = path.join(checkout, ".git"), info = await lstat(entry);
  if (info.isDirectory() && !info.isSymbolicLink()) return checkout;
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Expected a source checkout's Git metadata");
  const pointer = await readFile(entry, "utf8");
  if (!/^gitdir: [^\r\n]+\r?\n?$/.test(pointer)) throw new Error("Invalid worktree Git pointer");
  const own = await realpath(path.resolve(checkout, pointer.slice(8).trim()));
  const common = await realpath(path.resolve(own, (await readFile(path.join(own, "commondir"), "utf8")).trim()));
  if (path.basename(common) !== ".git") throw new Error("Expected project Git common directory");
  return path.dirname(common);
}

// Parent is selected by the fixture caller, not by production configuration.
// Every existing segment is checked before creating the next child. Shared
// parent modes are left intact; newly owned fixture directories use 0700.
export async function sourceTruthTestParent(value) {
  const project = await projectRoot(), allowed = path.join(project, ".review-local", "validation-runs");
  const target = value ?? allowed;
  if (!path.isAbsolute(target) || path.resolve(target) !== target || !inside(allowed, target) || inside(checkout, target))
    throw new Error("F001 fixtures require a project-local validation-runs parent outside the feature code checkout");
  let current = project;
  for (const segment of path.relative(project, target).split(path.sep)) {
    current = path.join(current, segment);
    try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(current) !== current
      || typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error("Fixture output parent metadata mismatch");
  }
  return target;
}

export async function sourceTruthTestRoot(prefix, parent) {
  if (!/^[a-z0-9-]+$/.test(prefix)) throw new Error("Invalid F001 fixture name");
  return mkdtemp(path.join(await sourceTruthTestParent(parent), prefix + "-"));
}

export async function sourceTruthTestEnvironment(root) {
  await sourceTruthTestParent(root);
  const roles = { home: "home", temporary: "tmp", cache: "cache", config: "config", data: "data", state: "state",
    npm: "npm-cache", runtime: "runtime", downloads: "downloads", logs: "logs" };
  const paths = {};
  for (const [role, relative] of Object.entries(roles)) {
    paths[role] = path.join(root, relative);
    await mkdir(paths[role], { recursive: true, mode: 0o700 });
  }
  return Object.freeze({ PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C", TZ: "UTC",
    HOME: paths.home, TMPDIR: paths.temporary, TMP: paths.temporary, TEMP: paths.temporary,
    XDG_CACHE_HOME: paths.cache, XDG_CONFIG_HOME: paths.config, XDG_DATA_HOME: paths.data, XDG_STATE_HOME: paths.state,
    XDG_RUNTIME_DIR: paths.runtime, npm_config_cache: paths.npm, NODE_DISABLE_COMPILE_CACHE: "1",
    WRANGLER_LOG_PATH: path.join(paths.logs, "wrangler.log"), MINIFLARE_REGISTRY_PATH: path.join(paths.cache, "miniflare-registry"),
    WRANGLER_SEND_METRICS: "false", CLOUDFLARE_CF_FETCH_ENABLED: "false" });
}
