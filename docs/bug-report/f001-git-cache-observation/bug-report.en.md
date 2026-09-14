> Language: **English** · [简体中文](bug-report.md)

---
feature_ids: [F001]
topics: [git, capacity, concurrency, diagnostics]
doc_kind: bug-report
created: 2026-09-09
---

# Unattributed Git capacity-check failures

Author: 砚砚 / gpt-6-astra. Independent execution evidence: 搬砖工 / gpt-5.6-terra. Implementation diagnosis, not formal review or completion.

## Diagnosis capsule

| Field | Record |
| --- | --- |
| Symptom | At `a6de16a`, two real Git tests in the three-concurrent whole-repository run returned `SOURCE_STORAGE_NOT_READY` / 503 instead of capturing and replaying normally. The browser gate did not run. |
| Evidence | `traqen-f001-exact-reuse-gate.40HSVk/backend.log`: 564 tests, 562 passed, two failed, zero skipped/cancelled, 308.123s. The same Git file passed 5/5 in isolation, 20.069s. Failures at test lines 89 and 113 both reach `git-process.js:67`. |
| Hypothesis/cause | Confirmed: the supervisor collapses all non-capacity failures into `STORAGE`, losing errno and phase. A scan racing Git atomic renames is only a hypothesis. The original underlying failure remains unproven; an isolated pass does not exclude an intermittent product defect. |
| Strategy | Add bounded, allowlisted phase/operation/errno/entry-category diagnostics to the private control channel, excluding paths, arguments, stderr and credentials. Run targeted RED→GREEN, then the same whole-repository three-concurrent gate with evidence retained. |
| Timeout | Small diagnostics tests within 30 seconds; managed gate within 3600 seconds. Narrow by the next attributable failure rather than repeating blind runs. |
| Warning signals | Do not ignore ENOENT, omit entries, reduce concurrency, or relax budgets. Diagnostics alone do not fix the original failure. |
| User interaction | Preserve public codes, messages and details. Local exception cause carries only safe diagnostics, not source text. |
| Acceptance | Safe private-channel propagation; missing/unsafe entries remain fail-closed; malformed frames and unknown values cannot echo input; original cases and whole gate must pass before the browser stage. |

## Runtime preflight

Checkout `feat/f001-source-truth`, HEAD `a6de16a95f22b25f9e71da0616ddec99f0808471`, only the existing untracked tsbuildinfo; Node v25.6.0 on macOS. These failures belong to transient test-owned Git supervisors, not a persistent Web/API deployment. Original failure PID/start time/live descriptors are unavailable from the log. No duplicate test or supervisor is currently active. The isolated preflight measured a 1,048,575 descriptor soft limit and approximately 92,398,444 KiB free; it did not sample the original failure instant.

## History and boundaries

The existing `f001-git-cache-capacity` report covers aggregate watermarks, private locking, owner crashes, and retained interrupted locks. The new defect is untraceable dynamic measurement failure, not missing capacity policy. The a6 product delta changes components/admission, not the supervisor directly. Keep original reports and PostgreSQL/pilot fixtures unchanged; no production access or CUA approval attempt.

## Diagnostic delta and verification

- Two new regressions were first RED: the supervisor cause was undefined, while the direct scan cause was a raw filesystem error containing a local path. Both became GREEN with fixed-enum phase, operation, errno and entry-category diagnostics. Private frames are bounded to 512 bytes and sanitized again by the parent; unknown values, malformed frames and oversized frames only produce safe failures.
- Accounting, scan bounds, the 100ms interval, admission headroom and rejection logic are unchanged. `sourceFailure` returns only code/message/requestId/details; workers retain existing public diagnostics. The new cause is not public. Git stderr remains discarded.
- `node --test --test-concurrency=3 test/source-truth-git.test.js test/source-truth-git-capacity.test.js test/source-truth-git-batch.test.js`: 19/19, zero skipped/cancelled, 15.864s, exit 0, including both original failing cases. This does not establish that the intermittent whole-suite failure is fixed.
- Original failing log SHA256: `f79d5abb5f58dd8bab94fb3bc8ffda14fd997eeb55e544c1e4dbeda59d37ffb8`; original isolated log SHA256: `ea60dbcaed586c3bfafffdd7f8ef48c32b3b942d9925f2338cf5b001ac1cfcff`. Originals retained.
- Risk: internal diagnostic behavior; no persistence changes; security-sensitive private framing/redaction; unchanged public contract; no irreversible action. Ownership remains Source Truth Git execution, with no new Store, authorization boundary or architecture decision. No UI delta; do not rerun unchanged Web gates.
- Next actual check: the same three-concurrent whole-backend gate with diagnostics, then the original-budget browser test only if backend passes. F001 remains incomplete, without formal review or merge.
