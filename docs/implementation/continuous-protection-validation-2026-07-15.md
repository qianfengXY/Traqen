> Language: **English** · [简体中文](continuous-protection-validation-2026-07-15.zh-CN.md)

# Continuous protection validation — 2026-07-15

## Outcome

This slice implements the repository-controlled core of design stage 5. An immutable ChangeSet no longer stops at “these records are stale”; Traqen derives an explainable regression plan, evaluates every affected Feature proof chain on the target Snapshot, and emits a policy-controlled CI/CD result.

```text
ChangeSet + deterministic impact
→ mapped affected TestSpecs ∪ fixed high-risk TestSpecs
→ conservative fallback when collection is incomplete
→ target-Snapshot Feature traceability and TraceGaps
→ PASS / BLOCKED / UNKNOWN assessment
→ ADVISORY / MANUAL_APPROVAL / ENFORCED action
```

## Selection safety

- Mapped impact tests and the fixed high-risk set are a union, never an intersection.
- Each selected TestSpec records why it was included: mapped change, fixed high-risk policy, or conservative fallback.
- An incomplete ChangeSet or any collection warning changes the strategy to `CONSERVATIVE_UNION`; it can never produce `PASS`.
- Missing catalog entries, unavailable Feature traceability, and unapproved selected tests remain explicit.
- The plan uses the latest immutable TestSpec version but does not execute it or bypass its operation-level policy.

The current deterministic Fact graph supplies static API/code/data/config/dependency relationships. Runtime-only paths can be added as separately attested dynamic Fact inputs later; until they exist, operators configure the conservative and high-risk sets rather than allowing Traqen to guess.

## Quality gate semantics

The trust assessment and enforcement choice are deliberately separate:

| Assessment | Meaning |
| --- | --- |
| `PASS` | impact is complete and every assessed current-Snapshot Feature chain is complete |
| `BLOCKED` | a selected test is not approved or an affected proof chain contains a gap |
| `UNKNOWN` | impact, test resolution, or Feature traceability is incomplete |

| Policy | Non-pass action |
| --- | --- |
| `ADVISORY` | `WARN`; default because design section 22 leaves first gate enforcement to the adopter |
| `MANUAL_APPROVAL` | `REQUIRE_APPROVAL` |
| `ENFORCED` | `FAIL` |

No composite score is calculated. The API returns each Feature's authority, conformance, verification, freshness, conflict dimensions, gaps, and repair actions.

## Interfaces and proof

- `GET /v1/projects/{projectId}/change-sets/{changeSetId}/continuous-protection`
- `npm run quality-gate -- --base-url ... --project ... --change-set ...`
- the product's change-impact screen shows the selected tests, reasons, policy mode, gate assessment, CI action, and required repairs;
- the built-in order pilot asserts `BLOCKED/WARN` immediately after an implementation change and `PASS/PASS` only after authorized reanalysis and a fresh current-deployment regression execution.

CI exit codes are 0 for pass or advisory warning, 1 for enforced failure, 2 for required manual approval, and 3 for transport/configuration failure. The API token is read from the environment, not a command-line argument.
