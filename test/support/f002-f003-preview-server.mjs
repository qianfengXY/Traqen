// Reproducible local acceptance entry. No existing database, user config or
// model account is opened. F001_TEST_PG_BIN must point to installed PG binaries.
import { isolatedPostgres } from "./source-truth-postgres.js";
import { knowledgeServerFixture, syntheticPassword } from "./f002-f003-server-fixture.js";

const port = Number(process.argv[2] ?? 6245);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3003, 3004, 3100, 3188].includes(port)) throw Error("Choose an isolated loopback port (default 6245)");
const cleanups = [], testContext = { after: work => cleanups.push(work) };
let closing;
const close = () => closing ??= (async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
})();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void close().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }); });
try {
  const cluster = await isolatedPostgres(testContext);
  const fixture = await knowledgeServerFixture(testContext, { port, database: () => cluster.createDatabase() });
  fixture.model.release();
  await fixture.runtime.knowledge.start();
  process.stdout.write(`${JSON.stringify({ scope: "OWNED_SYNTHETIC_F001_F002_F003_F006_F008_HTTP_ACCEPTANCE", origin: fixture.runtime.origin,
    credentials: { login: "owner", password: syntheticPassword }, reference: fixture.reference, componentId: fixture.componentId,
    f006ProfileId: fixture.profile.id, technicalProfileId: fixture.runtime.knowledge.facts.services.technicalProfile.id,
    model: "EXTERNAL_CLI_PROCESS_TEST_DOUBLE_NOT_REAL_MODEL_OR_QUALITY_ACCEPTANCE", database: "NEW_OWNED_NATIVE_POSTGRES_UNIX_SOCKET_ONLY",
    instructions: "GET /v1/auth/csrf, POST /v1/auth/login with prelogin cookie + x-traqen-csrf + exact Origin; retain session cookie and returned csrfToken for subsequent writes. Stop with SIGTERM to drain both runtimes and the owned PG cluster." })}\n`);
} catch (error) { await close(); throw error; }
