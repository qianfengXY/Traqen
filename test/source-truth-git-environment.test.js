import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GitProcess } from "../src/source-truth/git-process.js";
import { gitCacheBudget } from "../src/source-truth/git-cache-capacity.js";
import { sourceTruthTestRoot, sourceTruthTestEnvironment } from "./support/source-truth-test-paths.js";

// NOT_RUN: exercise the real shell/lockf/cache supervisor and its actual child.
// The controlled executable reports synthetic environment fields only; it does
// not replace GitProcess, admission, the lock or the supervisor with mocks.
const probe = fileURLToPath(new URL("./support/source-truth-git-environment-probe.js", import.meta.url));
const paths = ["HOME", "TMPDIR", "TMP", "TEMP", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR"];
const excluded = root => ({ PATH: path.join(root, "untrusted-bin"), NODE_OPTIONS: "--untrusted-source-option", NODE_COMPILE_CACHE: path.join(root, "untrusted-compile-cache"),
  GIT_CONFIG_GLOBAL: path.join(root, "untrusted-config"), GIT_CONFIG_COUNT: "999", GIT_CONFIG_KEY_999: "core.hooksPath", GIT_CONFIG_VALUE_999: path.join(root, "untrusted-hooks"),
  GIT_ASKPASS: path.join(root, "untrusted-askpass"), HTTP_PROXY: "http://untrusted.invalid", HTTPS_PROXY: "http://untrusted.invalid",
  SOURCE_TRUTH_HTTP_HOME: path.join(root, "untrusted-request-field") });

async function environmentControl(t, { cache, configured }) {
  const root = await sourceTruthTestRoot("f001-git-environment"), owned = await sourceTruthTestEnvironment(root);
  const untrusted = excluded(root), keys = [...paths, "NODE_DISABLE_COMPILE_CACHE", ...Object.keys(untrusted)];
  const before = new Map(keys.map(key => [key, process.env[key]]));
  const expected = configured ? Object.fromEntries(paths.map(key => [key, owned[key]])) : {};
  if (configured) expected.NODE_DISABLE_COMPILE_CACHE = "1";
  const cacheRoot = path.join(root, "git-cache"), direct = path.join(root, "direct");
  await mkdir(cache ? cacheRoot : direct, { mode: 0o700 });
  const cwd = cache ? path.join(cacheRoot, "a".repeat(64), "sha1") : direct;
  const runner = new GitProcess({ executable: process.execPath, timeoutMs: 10000 });
  let value;
  try {
    for (const key of [...paths, "NODE_DISABLE_COMPILE_CACHE"]) delete process.env[key];
    Object.assign(process.env, untrusted, expected);
    value = JSON.parse((await runner.run([probe], { cwd,
      ...(cache ? { cacheBudget: gitCacheBudget(cacheRoot) } : {}) })).toString());
  } finally {
    for (const [key, old] of before) { if (old === undefined) delete process.env[key]; else process.env[key] = old; }
  }
  assert.equal(runner.active, 0);
  assert.equal(value.cwd, cwd, "native command keeps the original requested cwd");
  for (const key of [...paths, "NODE_DISABLE_COMPILE_CACHE"]) assert.equal(value.env[key], expected[key], key);
  assert.equal(value.env.PATH, "/usr/bin:/bin");
  assert.equal(value.env.GIT_CONFIG_GLOBAL, "/dev/null");
  assert.equal(value.env.GIT_CONFIG_SYSTEM, "/dev/null");
  assert.equal(value.env.GIT_CONFIG_NOSYSTEM, "1");
  assert.equal(value.env.GIT_ASKPASS, "/usr/bin/false");
  assert.equal(value.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(value.env.GIT_NO_LAZY_FETCH, "1");
  assert.equal(value.env.GIT_NO_REPLACE_OBJECTS, "1");
  const config = new Map(Array.from({ length: Number(value.env.GIT_CONFIG_COUNT) }, (_, i) => [value.env[`GIT_CONFIG_KEY_${i}`], value.env[`GIT_CONFIG_VALUE_${i}`]]));
  assert.equal(config.get("core.hooksPath"), "/dev/null");
  assert.equal(config.get("credential.helper"), "");
  assert.equal(config.get("protocol.allow"), "never");
  assert.equal(config.get("protocol.https.allow"), "always");
  assert.equal(config.get("http.proxy"), "");
  assert.equal(config.get("http.sslVerify"), "true");
  for (const key of ["NODE_OPTIONS", "NODE_COMPILE_CACHE", "GIT_CONFIG_KEY_999", "GIT_CONFIG_VALUE_999", "HTTP_PROXY", "HTTPS_PROXY", "SOURCE_TRUTH_HTTP_HOME"])
    assert.equal(value.env[key], undefined, key);
  if (cache) assert.equal((await readFile(path.join(cacheRoot, ".capture.lock"))).length, 0);
}

for (const cache of [false, true]) for (const configured of [true, false]) {
  test(`GitProcess ${cache ? "real cache supervisor" : "direct child"}: ${configured ? "configured paths survive" : "missing paths stay unset"}`,
    { skip: cache && process.platform !== "darwin" ? "existing cache lock requires macOS" : false },
    t => environmentControl(t, { cache, configured }));
}
