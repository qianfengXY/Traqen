> Language: **English** · [简体中文](reverse-skill-framework-validation-2026-07-14.zh-CN.md)

# Reverse Skill Framework validation — 2026-07-14

## Product boundary

This slice implements the replaceable Reverse Skill protocol without allowing a Skill to become a fact source or business authority. A successful run ends at `WAITING_REVIEW`; it cannot create a normative Claim, Decision, conformance result, approved TestSpec, or complete TraceChain.

The built-in `specone-reference` and `gsd-reference` adapters are deterministic compatibility/reference implementations for exercising the common protocol. They are not claims that the external Specone or GSD products, prompts, models, or services have been integrated. Both consume exactly the same controlled Fact package and can be removed or replaced without changing storage or merge contracts.

## Validated flow

```text
Signed installed Skill Manifest
→ append ALLOWED/OBSERVE/BLOCKED registration event
→ select exact Fact Bundles and task scope
→ create minimal immutable input package
→ enforce project, Snapshot Manifest, Source Snapshot and policy
→ execute digest-matched built-in adapters with timeout/retry boundary
→ reject sensitive or undeclared output
→ retain raw output separately
→ normalize candidates with Fact evidence
→ exact deduplication with all producer provenance
→ scope-aware conflict analysis
→ append run events, attempts, candidates, conflicts and open questions
→ WAITING_REVIEW
```

Automated tests validate two adapters in one run, an explicit opposing-constraint conflict, non-conflicting business variants in disjoint scopes, exact duplicate preservation, unknown evidence rejection, task-scope escape rejection, server-side input and raw-output caps, sensitive or undeclared output rejection, timeout retries, artifact-digest mismatch, publisher-signature failure, incomplete-Fact policy, and immediate blocking of a previously allowed Skill version.

## Trust and immutability

- Manifest HMAC attestation binds publisher, Skill ID/version, artifact digest, permissions, compatibility and execution policy.
- Registration accepts only a compiled-in adapter whose ID, version and digest exactly match the signed Manifest.
- supply status changes are new immutable registration events; a monotonic server event order makes the latest event the execution policy projection even when wall-clock timestamps collide.
- every run pins an exact Skill version. Task scope supports exact artifacts, Fact node IDs/types and modules. Unknown scope fields or references are rejected rather than silently widening analysis; Policy Context, timestamps and maximum input size are controlled by the server.
- the input ID and digest cover the immutable Fact selection, Scope and Policy Context but exclude the observation timestamp, so identical controlled content remains reproducibly identifiable.
- inputs contain structured Facts and relationships, never unrestricted filesystem, database, Shell, network or secret access.
- source content is marked `UNTRUSTED_SOURCE_CONTENT`; source text is not interpreted as control instructions by the deterministic adapters.
- every candidate Feature, Claim and TestSpec cites a node Fact or relation Fact from the exact input package.
- raw Skill output and normalized `ReverseArtifactBundle` are stored in separate database fields; both are append-only. Raw output accepts only protocol-declared fields and has a server-side byte limit in addition to the candidate-count limit.
- reverse runs, status events, Skill attempts, conflicts and open questions reject updates and deletes.

## Merge and conflict semantics

Only exact stable identities are automatically merged. The result preserves all original candidate IDs, producers, statements and evidence. Semantic similarity is not auto-merged in this slice.

Machine-readable constraints are compared only when Claim type, subject and Scope overlap. Opposing equality, allow/forbid and disjoint-set constraints create an `OPEN` Conflict. Text that sounds contradictory but has disjoint Scope remains separate. No score, adapter count or majority vote can overwrite another result.

All generated Claims are `IMPLEMENTATION_BEHAVIOR` candidates. Code facts may support “the observed implementation behaves this way”; they do not establish “the business requires this behavior.”

## Deliberate limitations

The executor only runs compiled-in deterministic adapters in the API process. It does not load uploaded executable code and rejects network, Shell and secret permissions. Production external Skills require a separately isolated worker/container boundary, signed workload identity, network egress controls, durable asynchronous queue, live cancellation/resume, model gateway audit, and enterprise authorization. Those controls must exist before enabling third-party or model-backed adapters.

The reference adapters discover endpoint-centered Feature/implementation candidates and deterministic write relations. The Specone-compatible adapter also declares a generic `TEST_DESIGN` capability and emits a structured candidate TestSpec for each endpoint, including proposed operation level, HTTP step, assertions, exact Fact Evidence, and an explicit human-review requirement. It cannot approve or execute the candidate. Deeper domain rules, state machines, and permission semantics still require specialized adapters and human review.
