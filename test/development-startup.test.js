import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  localDevelopmentConfig,
  missingDevelopmentDependencies,
  supportsFullStackNode,
} from "../src/cli/start-development.js";

test("local development uses one stable API/Web configuration", () => {
  const config = localDevelopmentConfig({ CORS_ALLOWED_ORIGINS: "http://custom.local" });

  assert.equal(config.apiUrl, "http://127.0.0.1:3100");
  assert.equal(config.webUrl, "http://127.0.0.1:3000");
  assert.deepEqual(config.corsAllowedOrigins.split(","), [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://custom.local",
  ]);
});

test("full-stack startup rejects Node versions unsupported by the Web application", () => {
  assert.equal(supportsFullStackNode("22.12.0"), false);
  assert.equal(supportsFullStackNode("22.13.0"), true);
  assert.equal(supportsFullStackNode("23.0.0"), true);
});

test("local development reports a single setup action when dependencies are absent", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "traqen-development-startup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(missingDevelopmentDependencies(root).length, 2);

  await mkdir(path.join(root, "node_modules/pg"), { recursive: true });
  await mkdir(path.join(root, "web/node_modules/vinext"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "node_modules/pg/package.json"), "{}"),
    writeFile(path.join(root, "web/node_modules/vinext/package.json"), "{}"),
  ]);
  assert.deepEqual(missingDevelopmentDependencies(root), []);
});
