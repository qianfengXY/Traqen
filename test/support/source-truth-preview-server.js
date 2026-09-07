// Isolated browser-test fixture, not a production server or PostgreSQL proof.
// Every start creates owned temporary test stores; never reads user .env/data.
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sourceDatabase } from "./source-truth-database.js";
import { SourceTruthBlobStore } from "../../src/source-truth/blob-store.js";
import { sourceTruthServices } from "../../src/source-truth/services.js";
import { capturePolicy } from "../../src/source-truth/policy.js";
import { sourceTruthAuthenticator } from "../../src/source-truth/authentication.js";
import { createSourceTruthHttpHandler } from "../../src/source-truth/http-handler.js";
import { createConfiguredApplication } from "../../src/api/application-bootstrap.js";
import { createTraceabilityHttpServer } from "../../src/api/http-server.js";
import { PostgresTraceabilityStore } from "../../src/storage/index.js";

const cleanups = [];
const { db, repository } = await sourceDatabase({ after: (cleanup) => cleanups.push(cleanup) });
const root = await mkdtemp(path.join(tmpdir(), "traqen-f001-browser-fixture-"));
const blobs = await SourceTruthBlobStore.open({ root, keyVersion: "fixture", keys: { fixture: Buffer.alloc(32, 29) } });
const services = sourceTruthServices({ repository, blobs, policy: capturePolicy() });
const token = "f001-browser-isolated-fixture-token";
const authenticate = sourceTruthAuthenticator([{ tokenDigest: createHash("sha256").update(token).digest("hex"), actorId: "owner", tenantId: "tenant" }]);
const corsAllowedOrigins = ["http://127.0.0.1:3188", "http://localhost:3188"];
const configured = createConfiguredApplication({ store: new PostgresTraceabilityStore(db), env: { CORS_ALLOWED_ORIGINS: corsAllowedOrigins.join(",") } });
await configured.ready;
const server = createTraceabilityHttpServer({ application: configured.application, corsAllowedOrigins, sourceTruthAllowedOrigins: corsAllowedOrigins, apiBearerToken: token,
  sourceTruthHandler: createSourceTruthHttpHandler({ services, authenticate, allowedOrigins: corsAllowedOrigins }) });
server.listen(3187, "127.0.0.1", () => process.stdout.write("F001 isolated browser fixture listening on 127.0.0.1:3187; not production evidence.\n"));
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, async () => {
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  for (const cleanup of cleanups) await cleanup();
});
