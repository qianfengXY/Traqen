> Language: **English** · [简体中文](branch-review-publication-policy.zh-CN.md)

# Branch Review Publication Policy

This policy applies whenever a model or reviewer is asked to review a specified branch or
commit. It governs review artifacts and findings; it does not authorize implementation changes.

## 1. Keep the reviewed repository read-only

- Record the repository, target branch, and exact reviewed commit SHA before reviewing.
- During the review, do not modify the reviewed source or commit review-only artifacts to any
  branch in the project repository.
- Review notes, reports, convergence matrices, and consensus documents are review-only artifacts.
- Code fixes require a separate implementation request and branch.

Reviews of different commit SHAs are not independent reviews of the same target and must not be
combined as consensus.

## 2. Review independently before convergence

- At least two distinct models or reviewer identities must review the same commit independently.
- Each reviewer must complete and timestamp its own evidence-backed findings before reading or
  copying another reviewer's conclusions.
- Each independent record must retain the reviewer's real identity and wording. A synthesizer
  must not impersonate another reviewer.
- Agreement produced only after one reviewer sees another review is corroboration, not an
  independent confirmation, and does not satisfy the publication gate by itself.

## 3. Require evidence-backed consensus

A finding is publishable only when at least two independent reviewers:

1. identify the same underlying defect or risk against the same commit;
2. support it with verifiable code anchors, tests, logs, contract mismatches, or a reproducible
   counterexample;
3. agree on the material impact; and
4. agree on the required correction or acceptance condition.

Similar wording, a majority vote, or repeated speculation is not evidence. Single-reviewer,
disputed, or unverified findings remain local and must not be published as project Issues.

The convergence record must map every publishable finding back to each independent review and
must preserve material disagreement or scope differences.

## 4. Publish through the Issue tracker only

After the consensus gate passes, deduplicate the confirmed findings and publish them only through
the project's Issue tracker. Do not commit a review report or consensus document as the
publication mechanism.

Use one Issue per independently actionable finding unless the repository's Issue convention
requires a consolidated report. Every published Issue must include:

- target branch and exact reviewed commit SHA;
- problem statement and severity;
- affected code or contract locations;
- verification or reproduction evidence;
- impact;
- recommended correction and observable acceptance conditions;
- confirming reviewer identities; and
- unresolved disagreement or open questions, if any.

A request to review a branch authorizes publication of findings that pass this policy unless the
requester explicitly asks for draft-only output. Never publish findings that fail the consensus
gate.

## 5. Keep local review records out of Git

Reviewers may keep independent notes and a convergence record locally. Store them outside the
repository root whenever practical. If repository-relative tooling requires a local path, use:

```text
.review-local/<target-branch>/<reviewed-sha>/<reviewer-id>.md
.review-local/<target-branch>/<reviewed-sha>/consensus.md
```

`.review-local/` is intentionally ignored by Git. Local review records must never be staged,
committed, pushed, attached to a release, or used as the repository's published review result.
Before completing the review, verify that `git status --short` contains no review artifacts.

Existing tracked review artifacts are historical records and do not establish a precedent for
new reviews.

## 6. Fail closed and report completion

Publish no Issue when:

- fewer than two independent reviewers examined the target;
- reviewers examined different commit SHAs;
- evidence cannot be reproduced or anchored;
- the reviewers do not reach material consensus; or
- reviewer independence cannot be established.

In that case, report which gate was not met and retain the findings locally. When publication
succeeds, report the Issue URLs or identifiers, the reviewed SHA, the confirming reviewers, and
the local record location.
