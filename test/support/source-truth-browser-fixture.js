// Real PostgreSQL + HTTPS Git for browser acceptance, never production data.
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isolatedPostgres } from "./source-truth-postgres.js";
import { gitFixture } from "./source-truth-git-fixture.js";
import { SourceTruthBlobStore } from "../../src/source-truth/blob-store.js";
import { GitSourceGateway } from "../../src/source-truth/git-gateway.js";
import { sourceTruthServices } from "../../src/source-truth/services.js";
import { capturePolicy } from "../../src/source-truth/policy.js";
import { sourceTruthAuthenticator } from "../../src/source-truth/authentication.js";
import { createSourceTruthHttpHandler } from "../../src/source-truth/http-handler.js";
import { createConfiguredApplication } from "../../src/api/application-bootstrap.js";
import { createTraceabilityHttpServer } from "../../src/api/http-server.js";
import { PostgresTraceabilityStore } from "../../src/storage/index.js";

export async function browserFixture(t) {
  const cluster = await isolatedPostgres(t);
  const { db, repository } = await cluster.createDatabase();
  const names = { directory: "Browser Directory", git: "Browser Git", combined: "Browser Combined", blocked: "Browser Blocked" };
  for (const [id, name] of Object.entries(names)) {
    await db.query("INSERT INTO project (id,tenant_id,name) VALUES ($1,'tenant',$2)", [id, name]);
    await repository.provision(id, { tenantId: "tenant", grants: [{ actorId: "owner", role: "MAINTAIN" }, { actorId: "reader", role: "READ" }] });
  }
  const source = await gitFixture(t);
  await writeFile(path.join(source.work, "external.bin"), `version https://git-lfs.github.com/spec/v1\noid sha256:${"a".repeat(64)}\nsize 12\n`);
  await source.git("add", "."); await source.git("commit", "-m", "browser external gap");
  await source.git("push", path.join(source.root, "repo.git"), "main");
  const gapCommit = await source.git("rev-parse", "HEAD");
  const root = await mkdtemp(path.join(tmpdir(), "tq-f001-browser-matrix-"));
  const policy = capturePolicy({ gitTargets: source.targets });
  const blobs = await SourceTruthBlobStore.open({ root: path.join(root, "bytes"), keyVersion: "fixture", keys: { fixture: Buffer.alloc(32, 29) } });
  const git = new GitSourceGateway({ cacheRoot: path.join(root, "git"), targets: source.targets });
  const services = sourceTruthServices({ repository, blobs, policy, git });
  const token = "f001-browser-isolated-fixture-token", readerToken = "f001-browser-isolated-reader-token";
  const authenticate = sourceTruthAuthenticator([[token, "owner"], [readerToken, "reader"]].map(([value, actorId]) => ({ tokenDigest: createHash("sha256").update(value).digest("hex"), actorId, tenantId: "tenant" })));
  const corsAllowedOrigins = ["http://127.0.0.1:3188", "http://localhost:3188"];
  const configured = createConfiguredApplication({ store: new PostgresTraceabilityStore(db), env: { CORS_ALLOWED_ORIGINS: corsAllowedOrigins.join(",") } });
  await configured.ready;
  const server = createTraceabilityHttpServer({ application: configured.application, corsAllowedOrigins, sourceTruthAllowedOrigins: corsAllowedOrigins, apiBearerToken: token,
    sourceTruthHandler: createSourceTruthHttpHandler({ services, authenticate, allowedOrigins: corsAllowedOrigins }) });
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(3197, "127.0.0.1", resolve); });
  const apiBase = "http://127.0.0.1:3197";
  const read = async (workspace, route = "") => {
    const response = await fetch(`${apiBase}/v1/workspaces/${workspace}/source-truth${route}`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Fixture evidence read failed: ${response.status}`);
    return response.json();
  };
  return { root, names, source, gapCommit, token, readerToken, apiBase, read };
}
