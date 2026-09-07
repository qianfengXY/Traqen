> Language: **English** · [简体中文](bug-report.md)

---
feature_ids: [F001]
topics: [migrations, regression, validation]
doc_kind: bug-report
created: 2026-09-07
---

# F001 shared migration test inventory was not updated

Reported by 砚砚 / gpt-6-astra during repository-wide implementation acceptance. This is an author's implementation diagnosis, not a formal branch review.

## Diagnostic capsule

| Field | Record |
|---|---|
| Symptom | Expected repository-wide tests to pass. Several storage tests instead failed inside shared `migratedDatabase()` setup, before their business assertions. |
| Evidence | Commit `bc03c4ca1235f6423167fcc76ea2b709b25d1ec1`; managed task `hold-ball-1788773869297-v3tlm5`, exit 1 after 279 seconds. Expectations at `test/storage-migrations.test.js:36` ended at 0035, while 0036 and 0037 were applied. |
| Root cause | F001 commits `8c2e262` and `a1292a3` added renewal-execution and staging-disposition migrations without updating the shared test's explicit expected inventory. The migration runner loaded and successfully committed both SQL files; this was not an SQL execution failure. |
| Diagnosis | Compare migration source, runner, and commit history; reproduce with one core migration test, then change only the expected inventory. |
| Timebox | If unconfirmed after ten minutes, isolate one migration. Do not rerun the expensive, unrelated 100k pilot. |
| Warning | New SQL errors or different causes require fresh diagnosis; changing expectations must not conceal them. |
| User interaction | No product behavior change; database SQL, backup, recovery, and permission contracts are unchanged. |
| Acceptance | Core migration test RED → GREEN; full storage and repository gates still need checking. One passing test is not a passing full gate. |

## Fix and verification

Command: `node --test --test-name-pattern='core PostgreSQL migration applies once' test/storage-migrations.test.js`.

- RED: one failure, exit 1; the exact difference was the missing `0036_f001_renewal_execution` and `0037_f001_staging_disposition` entries.
- Fix: append only those two IDs to the explicit expected array. Preserve order and strict equality; do not derive expectations from the same actual result, delete migrations, or relax assertions.
- GREEN: the same command passes one test with zero failures, exit 0. The second migration result remains `[]`, and required-table checks also execute and pass.
- The original managed command used `set -e`, so web tests, typechecking, and lint never ran after its failure. The output tail cannot establish the absence of other failures; the next repository-wide run must retain complete logs and check each result.

This fix does not affect the archived `bcb21ac` 100k service pilot. Aggregate Git-cache budgeting, browser interactions, and independent review remain incomplete; the Feature cannot be closed on this evidence.
