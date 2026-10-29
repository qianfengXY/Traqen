import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fixtureChildEnvironment, fixturePostgresSocketPrefix, isolatedPostgres } from "./support/source-truth-postgres.js";

// Preparation only until root authorizes execution. Each future test writes
// only a new owned directory under the supplied canonical project temp root.
async function directories(root, home) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  return { HOME: home, TMPDIR: root, TMP: root, TEMP: root,
    XDG_CACHE_HOME: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_STATE_HOME: home, XDG_RUNTIME_DIR: home };
}
async function fixture() {
  const base = (await fixtureChildEnvironment()).TMPDIR;
  assert.ok(path.isAbsolute(base ?? "") && path.basename(base) === "validation-runs" && path.basename(path.dirname(base)) === ".review-local");
  assert.equal(await realpath(base), base);
  const owned = await mkdtemp(path.join(base, "f002-path-test-"));
  const home = path.join(owned, "home"); await mkdir(home, { mode: 0o700 });
  return { owned, root: base, environment: await directories(base, home) };
}

test("fixture children retain audited HOME TMP XDG and tool caches without inheriting unrelated application state", async () => {
  const { root, environment } = await fixture();
  const cache = environment.HOME, log = path.join(cache, "wrangler.log");
  const inherited = await fixtureChildEnvironment({ ...environment, PATH: "/usr/bin:/bin", NODE_COMPILE_CACHE: cache,
    MINIFLARE_REGISTRY_PATH: cache, PLAYWRIGHT_BROWSERS_PATH: cache, WRANGLER_LOG_PATH: log,
    SOURCE_TRUTH_CONFIG: "/sentinel-do-not-read", DATABASE_URL: "sentinel-do-not-connect" });
  assert.equal(inherited.HOME, environment.HOME); assert.equal(inherited.TEMP, root);
  assert.equal(inherited.XDG_CONFIG_HOME, environment.XDG_CONFIG_HOME);
  assert.equal(inherited.NODE_COMPILE_CACHE, cache); assert.equal(inherited.MINIFLARE_REGISTRY_PATH, cache);
  assert.equal(inherited.PLAYWRIGHT_BROWSERS_PATH, cache); assert.equal(inherited.WRANGLER_LOG_PATH, log);
  assert.equal("SOURCE_TRUTH_CONFIG" in inherited, false); assert.equal("DATABASE_URL" in inherited, false);
});

test("missing or external child HOME/cache rejects before allocating fixture resources", async () => {
  const { root, environment } = await fixture(), before = await readdir(root);
  await assert.rejects(fixtureChildEnvironment({ ...environment, HOME: undefined }), /Fixture HOME must name an audited project path/);
  await assert.rejects(fixtureChildEnvironment({ ...environment, XDG_CACHE_HOME: "/sentinel-do-not-stat" }), /Fixture XDG_CACHE_HOME is outside validation-runs/);
  await assert.rejects(fixtureChildEnvironment({ ...environment, TMPDIR: undefined }), /canonical project/);
  assert.deepEqual(await readdir(root), before);
});

test("PG uses the short socket layout and refuses a long name or foreign temp before allocation or native startup", async () => {
  const { owned, root: base, environment } = await fixture();
  const root = path.join(owned, "long-project-".repeat(8), ".review-local", "validation-runs");
  const prefix = fixturePostgresSocketPrefix(base), before = await readdir(base);
  assert.ok(Buffer.byteLength(path.join(`${prefix}XXXXXX`, "s", ".s.PGSQL.5432")) + 1 < 104);
  assert.throws(() => fixturePostgresSocketPrefix(root), /Project PostgreSQL socket filename exceeds the platform limit/);
  await assert.rejects(isolatedPostgres({ after() { assert.fail("no native cleanup may be registered"); } },
    { environment: { ...environment, TMPDIR: root }, binaries: "/usr/bin" }), /canonical project/);
  assert.deepEqual(await readdir(base), before);
});
