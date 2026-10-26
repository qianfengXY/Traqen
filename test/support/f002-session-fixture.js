// Isolated F001 bytes + F008 identity + F002 persistence; no legacy graph,
// F003 resolver, external model, production configuration or user dataset.
import { candidateFixture } from "./source-truth-candidate-fixture.js";
import { owner } from "./source-truth-database.js";
import { SourcePublicationService } from "../../src/source-truth/publication-service.js";
import { sourceTruthServices } from "../../src/source-truth/services.js";
import { capturePolicy } from "../../src/source-truth/policy.js";
import { createSourceTruthHttpHandler } from "../../src/source-truth/http-handler.js";
import { AuthRepository } from "../../src/auth/repository.js";
import { AuthService } from "../../src/auth/service.js";
import { AuthHttp } from "../../src/auth/http.js";
import { contextualDatabase } from "../../src/auth/database.js";
import { createF002Runtime } from "../../src/deterministic-facts/runtime.js";
import { createConfiguredApplication } from "../../src/api/application-bootstrap.js";
import { createTraceabilityHttpServer } from "../../src/api/http-server.js";
import { PostgresTraceabilityStore } from "../../src/storage/index.js";

export const isolatedPassword = "owned-session-evidence1";
export async function sessionEvidenceFixture({ port = 6225, origin = "http://127.0.0.1:6226" } = {}) {
  if (![6225, 6235].includes(port) || !/^http:\/\/127\.0\.0\.1:(6226|6236)$/.test(origin)) throw Error("Use owned session verification coordinates");
  const cleanups = [];
  const source = await candidateFixture({ after: cleanup => cleanups.push(cleanup) }, {
    entryPath: "evidence-sentinel.js", content: "export function EvidenceSentinelOct21() { return 42; }\n",
    additionalFiles: [{ entryPath: "not-selected.js", content: "export function MustNotExtractOutsideScope() { return 7; }\n" }],
  });
  const prepared = await source.candidates.prepare(source.context);
  await source.advance("RECONCILING", "REVIEW_REQUIRED");
  const publisher = new SourcePublicationService(source.repository, source.candidates);
  const confirmation = await publisher.confirm(owner, source.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId });
  const frozen = await publisher.seal(owner, source.context, { confirmationId: confirmation.id, clientToken: "session-browser-source" });
  const identity = new AuthService({ repository: new AuthRepository(contextualDatabase(source.db)), key: Buffer.alloc(32, 18) });
  const account = await identity.initialize({ login: "owner", displayName: "Evidence Owner", password: isolatedPassword });
  await identity.migrate({ bindings: [{ principalId: owner.actorId, accountId: account.id }], owners: [{ workspaceId: "workspace", accountId: account.id }], grants: [], confirmed: true, requestedBy: "DEPLOYMENT" });
  source.repository.identityService = identity;
  const origins = [origin], services = sourceTruthServices({ repository: source.repository, blobs: source.blobs, policy: capturePolicy() });
  const facts = await createF002Runtime({ sourceRuntime: { pool: source.db, services, configuration: { members: [], origins } }, cursorSecret: "owned-cookie-evidence-cursor" });
  const application = createConfiguredApplication({ store: new PostgresTraceabilityStore(source.db), env: {} });
  await application.ready;
  const auth = new AuthHttp({ service: identity, origin, development: true });
  const server = createTraceabilityHttpServer({ application: application.application, auth, sourceTruthAllowedOrigins: origins, deterministicFactsAllowedOrigins: origins,
    sourceTruthHandler: createSourceTruthHttpHandler({ services, allowedOrigins: origins, authenticate: () => { throw Error("Session context required"); } }),
    deterministicFactsHandler: facts.deterministicFactsHandler });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  await facts.start();
  return { source, facts, metadata: { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id, profileId: facts.services.technicalProfile.id, originalDigest: source.digest },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await facts.close(); for (const cleanup of cleanups.reverse()) await cleanup(); } };
}
