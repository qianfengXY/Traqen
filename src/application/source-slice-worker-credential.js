import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { canonicalJson, deepFreeze } from "../domain/index.js";

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value;
}

function decodeJson(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new SourceSliceWorkerAuthenticationError("Worker credential is malformed");
  }
}

export class SourceSliceWorkerAuthenticationError extends Error {}
export class SourceSliceWorkerAuthorizationError extends Error {}

export class SourceSliceWorkerCredentialService {
  constructor({ secret, clock = () => new Date(), ttlMs = 60_000, nonce = () => randomBytes(24).toString("base64url") }) {
    const secretBytes = Buffer.isBuffer(secret) ? secret : Buffer.from(secret ?? "", "utf8");
    if (secretBytes.length < 32) throw new TypeError("SourceSlice worker credential secret must contain at least 32 bytes");
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000) {
      throw new RangeError("SourceSlice worker credential ttlMs must be between 1000 and 300000");
    }
    this.secret = secretBytes;
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.nonce = nonce;
  }

  #signature(payload) {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  issue(input) {
    const issuedAt = this.clock().getTime();
    const claims = {
      version: 1,
      credentialId: requiredString(this.nonce(), "credentialId"),
      projectId: requiredString(input.projectId, "projectId"),
      snapshotManifestId: requiredString(input.snapshotManifestId, "snapshotManifestId"),
      analysisRunId: requiredString(input.analysisRunId, "analysisRunId"),
      workUnitId: requiredString(input.workUnitId, "workUnitId"),
      routeDecisionId: requiredString(input.routeDecisionId, "routeDecisionId"),
      producerKey: requiredString(input.producerKey, "producerKey"),
      policyDigest: requiredString(input.policyDigest, "policyDigest"),
      issuedAt,
      expiresAt: issuedAt + this.ttlMs,
    };
    const payload = Buffer.from(canonicalJson(claims), "utf8").toString("base64url");
    return deepFreeze({ token: `${payload}.${this.#signature(payload)}`, claims });
  }

  verify(token) {
    if (typeof token !== "string" || token.trim() === "") {
      throw new SourceSliceWorkerAuthenticationError("A server-attested worker credential is required");
    }
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) {
      throw new SourceSliceWorkerAuthenticationError("Worker credential is malformed");
    }
    const expected = Buffer.from(this.#signature(payload));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new SourceSliceWorkerAuthenticationError("Worker credential signature is invalid");
    }
    const claims = decodeJson(payload);
    const now = this.clock().getTime();
    if (claims.version !== 1 || !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt)) {
      throw new SourceSliceWorkerAuthenticationError("Worker credential claims are invalid");
    }
    if (claims.issuedAt > now + 5_000 || claims.expiresAt <= now || claims.expiresAt - claims.issuedAt > this.ttlMs) {
      throw new SourceSliceWorkerAuthenticationError("Worker credential is expired or not yet valid");
    }
    for (const field of ["credentialId", "projectId", "snapshotManifestId", "analysisRunId", "workUnitId", "routeDecisionId", "producerKey", "policyDigest"]) {
      requiredString(claims[field], field);
    }
    return deepFreeze(claims);
  }
}
