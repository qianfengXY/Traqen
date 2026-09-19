> Language: **English** · [简体中文](branch-review-publication-policy.zh-CN.md)

# Branch Review Publication Policy

This policy has two layers. Its general review safeguards apply whenever a model or reviewer is
asked to review a specified branch or commit. Its publication gate applies only when an operator
or review request explicitly intends to publish a candidate Finding as a Traqen Issue. The policy
does not authorize implementation changes or define merge authority by itself. Normal branch
review and local-main integration follow `docs/SOP.md` and Cat Café risk routing.

## 1. Keep every reviewed repository read-only

These general review safeguards apply to every requested branch or commit review, including a
normal local-main merge review that has no Issue-publication intent.

- Record the repository, target branch, and exact reviewed commit SHA before reviewing.
- During the review, do not modify the reviewed source or commit review-only artifacts to any
  branch in the project repository.
- Review notes, reports, convergence matrices, and consensus documents are review-only artifacts.
- Code fixes require a separate implementation request and branch.
- Each review record must retain the reviewer's real identity and wording. A reviewer must not
  impersonate another reviewer. A synthesizer must not impersonate another reviewer.

An ordinary review must cover the exact commit that is proposed for its local merge gate. Reviews
of different commit SHAs are not independent reviews of the same target and must not be combined
as publication consensus.

## 2. Review independently before publishing a finding

- A candidate Finding may enter this publication gate only when its operator or review request
  explicitly states an intent to publish a Traqen Issue.
- At least two distinct models or reviewer identities must review the same commit independently
  before that candidate Finding is published.
- Each reviewer must complete and timestamp its own evidence-backed findings before reading or
  copying another reviewer's conclusions.
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

## 4. Write review descriptions in Simplified Chinese

Every formal independent Finding and convergence or consensus description used by the
publication gate must be written in Simplified Chinese.

- Describe the problem, severity, evidence, impact, recommended correction, acceptance
  conditions, and disagreement.
- Preserve code symbols, paths, commands, logs, identifiers, commit SHAs, and quoted source text
  exactly; add a Chinese explanation when needed.
- A supplemental translation is optional and must not omit, weaken, strengthen, or otherwise
  change a claim.
- Informal scratch notes may use another language, but they cannot serve as an independent
  confirmation or consensus record until the required Simplified Chinese description is complete.

## 5. Publish findings through the Issue tracker only

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

The Issue title and body must be written in Simplified Chinese. A supplemental translation is
optional, but it does not replace any required field above.

A normal branch review does not itself enter the publication gate or add a second merge reviewer.
Only an explicit operator or review request to publish a candidate Finding as a Traqen Issue
activates this gate. Never publish findings that fail the consensus gate.

## 6. Integrate locally and synchronize the remote from local main

- Local `main` is the sole integration source. Every implementation and documentation branch must
  complete its applicable local review and gate before merging into local `main`.
- Side branches and their review or acceptance worktrees stay local. Do not push a side branch or
  bypass local `main` through a remote branch or remote pull request.
- After the merge, complete applicable acceptance on local `main`, then push only local `main` to
  `origin/main`. The remote repository retains only the `main` branch.
- After local and remote `main` are confirmed at the same commit, promptly delete the merged local
  branch and remove its worktree. Preserve and report a dirty or running worktree; never force its
  cleanup.
- This publication gate does not add a second reviewer to a branch merge into local `main`. A
  second independent review is required only when a candidate Finding is being published as an
  Issue.

## 7. Keep local review records out of Git

Reviewers may keep independent notes and, when the publication gate applies, a convergence record
locally. Store them outside the repository root whenever practical. If repository-relative tooling
requires a local path, use:

```text
.review-local/<target-branch>/<reviewed-sha>/<reviewer-id>.md
.review-local/<target-branch>/<reviewed-sha>/consensus.md
```

`.review-local/` is intentionally ignored by Git. Local review records must never be staged,
committed, pushed, attached to a release, or used as the repository's published review result.
Before completing the review, verify that `git status --short` contains no review artifacts.

Existing tracked review artifacts are historical records and do not establish a precedent for
new reviews.

## 8. Fail closed and report publication completion

For an Issue-publication candidate, publish no Issue when:

- fewer than two independent reviewers examined the target;
- reviewers examined different commit SHAs;
- evidence cannot be reproduced or anchored;
- the reviewers do not reach material consensus;
- the required Review or Issue content is missing; or
- reviewer independence cannot be established.

In that case, report which gate was not met and retain the findings locally. When publication
succeeds, report the Issue URLs or identifiers, the reviewed SHA, the confirming reviewers, and
the local record location.
