import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { GitSourceGateway } from "../src/source-truth/git-gateway.js";
import { displayPath } from "../src/source-truth/identity.js";
import { gitFixture } from "./support/source-truth-git-fixture.js";

const collect = async (stream) => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks); };
const scope = { tenantId: "tenant", workspaceId: "workspace", sourceId: "git-registration" };
function gateway(fixture) { return new GitSourceGateway({ cacheRoot: path.join(fixture.root, "private-cache"), targets: fixture.targets, maxFileBytes: 1024 * 1024, maxPackBytes: 16 * 1024 * 1024, timeoutMs: 30000 }); }

test("B-01/02/07 HTTPS capture locks commit objects and replays them after the ref moves", async (t) => {
  const fixture = await gitFixture(t);
  const git = gateway(fixture);
  const a = await git.capture(scope, { url: fixture.url, ref: "main", root: null });
  assert.equal(a?.commit, fixture.commitA);
  assert.equal(a.objectFormat, "sha1");
  const rows = []; for await (const entry of git.entries(a)) rows.push(entry);
  assert.deepEqual(rows.map((entry) => displayPath(entry.pathBytes)), ["README.md", "src", "src/orders.js"]);
  assert.equal((await collect(git.readBlob(a, rows[0]))).toString(), "fixture version A\n");
  const commitB = await fixture.update();
  const b = await git.capture(scope, { url: fixture.url, ref: commitB, root: null });
  assert.equal(b.commit, commitB);
  assert.equal((await collect(git.readBlob(a, rows[0]))).toString(), "fixture version A\n");
  const restart = gateway(fixture);
  assert.equal((await collect(restart.readBlob(a, rows[0]))).toString(), "fixture version A\n");
});

test("B-05/13 a missing root and HTTPS redirects cannot become an empty successful source", async (t) => {
  const fixture = await gitFixture(t);
  const git = gateway(fixture);
  await assert.rejects(git.capture(scope, { url: fixture.url, ref: "main", root: "missing" }), { code: "SOURCE_GIT_ROOT_MISSING" });
  await assert.rejects(git.capture(scope, { url: `${fixture.origin}/redirect`, ref: "main", root: null }), { code: "SOURCE_GIT_TRANSFER_FAILED" });
});

test("B-06 native Git batch uses one process and verifies each framed blob without buffering the batch", async (t) => {
  const fixture = await gitFixture(t);
  const git = gateway(fixture);
  const snapshot = await git.capture(scope, { url: fixture.url, ref: "main", root: null });
  const entries = []; for await (const entry of git.entries(snapshot)) if (entry.kind === "FILE") entries.push(entry);
  const processCalls = t.mock.method(git.process, "stream", git.process.stream.bind(git.process));
  const values = [];
  // Until batch support exists, exercise the real behavior, not an import error.
  const batches = git.readBlobs ? git.readBlobs(snapshot, entries) : (async function* () {
    for (const entry of entries) yield { entry, content: git.readBlob(snapshot, entry) };
  })();
  for await (const item of batches) values.push((await collect(item.content)).toString());
  assert.deepEqual(values, ["fixture version A\n", "throw new Error('SOURCE_MUST_NEVER_EXECUTE');\n"]);
  assert.equal(processCalls.mock.callCount(), 1, "batch must not spawn one Git process per file");
  assert.equal(git.process.active, 0);
});
