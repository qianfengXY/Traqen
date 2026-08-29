> Language: **English** · [简体中文](F001-legacy-system-understanding.zh-CN.md)

---
feature_ids: [F001]
topics: [workspace, source-snapshot, artifact-inventory, provenance, legacy-system]
doc_kind: feature-spec
created: 2026-08-29
updated: 2026-08-29
description: Establish the versioned source boundary and complete inventory required for trustworthy legacy-system analysis.
description_source: human
description_author: co-creator
description_updated_at: 2026-08-29T03:18:18Z
---

# F001 — Workspace & Source Truth

**Status:** Spec
**Owner:** CodeX
**Related:** F006 workspace capability settings

## Why

Before anyone can reason about a legacy system, we need to answer a simpler question precisely: which source, at which version, was actually examined? A directory name, a live checkout, or a chat attachment is not sufficient evidence. Every later conclusion must be able to point back to a stable, permissioned source boundary.

## Outcome

F001 creates a read-only analysis workspace, an immutable `SourceSnapshot`, and a complete `ArtifactInventory` for the registered source. The inventory covers documentation, code, tests, configuration, and other discovered artifacts, including explicit dispositions for material that was excluded, unsupported, unreadable, redacted, or failed to scan.

It does not infer business meaning, decide ownership, publish a business tree, or claim change impact. Those are later capabilities.

## User journey

1. An architect registers a source root and its allowed analysis policy.
2. Traqen captures an immutable snapshot identity and inventories every discoverable artifact.
3. The architect can inspect what was analyzed, what was deliberately excluded, and why.
4. Downstream facts, candidates, claims, and executions refer to this snapshot rather than to an ambiguous live filesystem.

## Scope

### In scope

- Workspace registration with source locator, access policy, and source provenance.
- Immutable snapshot identity: source revision where available, content digest, capture time, and scanner version.
- Artifact inventory records with path, kind, content digest, size, and disposition.
- Explicit coverage states: `INCLUDED`, `EXCLUDED`, `UNSUPPORTED`, `FAILED`, and `REDACTED`.
- A source-access boundary: raw content may be read only by approved local extractors or by an explicitly authorized F006 agent configuration. Unapproved external model egress is prohibited.

### Out of scope

- Extracting facts or constructing an API tree (F002).
- LLM semantic interpretation, human review, or the business-function tree (F003).
- Test execution evidence, impact analysis, and revalidation advice (F004).
- Enforcing a production deployment or CI gate.

## Required records

| Record | Minimum fields |
| --- | --- |
| `Workspace` | workspace ID, registered source locator, access policy, owner |
| `SourceSnapshot` | snapshot ID, source revision when available, content digest, capture time, scanner version |
| `ArtifactInventoryItem` | snapshot ID, artifact locator, kind, digest, disposition, disposition reason |
| `CoverageGap` | affected scope, reason, discovery method, follow-up state |

An unreadable file is not silently absent: it produces an inventory disposition and, where it limits analysis, a `CoverageGap`.

## Acceptance criteria

- [ ] A reference repository can be registered without mutating its source.
- [ ] Re-running inventory on the same content produces the same snapshot identity and artifact digests.
- [ ] Every discovered artifact has exactly one recorded disposition.
- [ ] An excluded, unsupported, redacted, or failed artifact is visible to the user with its reason.
- [ ] A downstream record can name its exact `SourceSnapshot` and artifact locator.
- [ ] The reference-pilot report proves source-boundary and inventory coverage before semantic analysis is enabled.

## Open questions

- Which source-control systems and archive formats are included in the first production adapter set?
- What is the approved redaction contract for repositories that contain credentials or regulated data?
- Which F006 configuration forms count as explicit authorization for a remote analysis agent?

## Dependencies and handoff

F001 is the evidence boundary for F002–F004. F006 supplies reusable workspace and agent-capability settings; F001's local inventory can be validated independently, while any remote-agent access must use an approved F006 configuration.

**Next:** F002 consumes the snapshot and inventory to create deterministic evidence facts and the API-structure projection.
