import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { sourceTruthTestRoot, sourceTruthTestParent, sourceTruthTestEnvironment } from "./support/source-truth-test-paths.js";

// Source preparation only: these file-metadata controls have NOT been run.
test("F001 fixture paths and child home/temp/cache roles stay in the project without mutating the parent environment", async () => {
  const before = { ...process.env };
  const root = await sourceTruthTestRoot("f001-path-control");
  assert.equal(await realpath(root), root);
  assert.equal((await lstat(root)).mode & 0o777, 0o700);
  const env = await sourceTruthTestEnvironment(root);
  for (const key of ["HOME", "TMPDIR", "TMP", "TEMP", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR", "npm_config_cache", "WRANGLER_LOG_PATH", "MINIFLARE_REGISTRY_PATH"])
    assert.ok(env[key].startsWith(root + path.sep), key);
  assert.equal(env.NODE_DISABLE_COMPILE_CACHE, "1");
  assert.deepEqual({ ...process.env }, before);
  await assert.rejects(sourceTruthTestParent(path.join(path.parse(root).root, "not-a-traqen-fixture")), /project-local/);
});
