import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { canonicalEncode } from "../src/source-truth/identity.js";
import { PublicationAuthority } from "../src/business-knowledge/publication-authority.js";

// Ephemeral test-only keys prove verification mechanics, not real independent
// quality, identities, physical volumes or production readiness.
const binding = { workspaceId: "isolated-workspace", investigationId: "isolated-run", graphDigest: "a".repeat(64),
  sourceInput: { sourceBundleSnapshotId: "b".repeat(64), receiptId: "receipt" }, adoptedVersionIds: [], profileId: "profile", implementationVersion: { sourceDigest: "c".repeat(64) } };
const keys = () => generateKeyPairSync("ed25519");
const document = (privateKey, overrides = {}) => {
  const payload = { version: 1, kind: "QUALITY", issuerId: "independent-deployment-reviewer", evidenceClass: "REAL_PROJECT", binding,
    observedAt: "2026-01-01T00:00:00Z", ...overrides };
  return { issuerId: payload.issuerId, payload, signature: sign(null, Buffer.from(canonicalEncode(payload)), privateKey).toString("base64url") };
};

test("F003 authority trusts only explicitly configured independent deployment issuers, not product-baked identities", () => {
  const { publicKey, privateKey } = keys();
  const authority = new PublicationAuthority({ implementationAuthors: ["implementation-author"],
    issuers: [{ id: "independent-deployment-reviewer", kind: "QUALITY", publicKey: publicKey.export({ type: "spki", format: "pem" }) }] });
  assert.equal(authority.verify(document(privateKey), binding).issuerId, "independent-deployment-reviewer");
  assert.throws(() => new PublicationAuthority({ implementationAuthors: ["implementation-author"],
    issuers: [{ id: "implementation-author", kind: "QUALITY", publicKey: publicKey.export({ type: "spki", format: "pem" }) }] }), { code: "F003_AUTHORITY_INVALID" });
  assert.throws(() => new PublicationAuthority({ issuers: [{ id: "independent-deployment-reviewer", kind: "QUALITY", publicKey: publicKey.export({ type: "spki", format: "pem" }) }] }),
    { code: "F003_AUTHORITY_INVALID" }, "independence requires an explicit implementation author binding");
  assert.throws(() => new PublicationAuthority().verify(document(privateKey), binding), { code: "F003_EVIDENCE_UNTRUSTED" });
});

test("F003 configured authority rejects unknown, forged, expired, cross-bound, wrong-purpose and synthetic evidence", () => {
  const { publicKey, privateKey } = keys(), other = keys();
  const authority = new PublicationAuthority({ implementationAuthors: ["implementation-author"],
    issuers: [{ id: "independent-deployment-reviewer", kind: "QUALITY", publicKey: publicKey.export({ type: "spki", format: "pem" }) }] });
  for (const d of [document(privateKey, { issuerId: "unknown" }), document(other.privateKey),
    document(privateKey, { validUntil: "2000-01-01T00:00:00Z" }), document(privateKey, { binding: { ...binding, investigationId: "different" } }),
    document(privateKey, { kind: "RECOVERY" }), document(privateKey, { evidenceClass: "SYNTHETIC" })])
    assert.throws(() => authority.verify(d, binding), { code: "F003_EVIDENCE_UNTRUSTED" });
});
