> Language: **English** · [简体中文](implementation-semantics-validation-2026-07-15.zh-CN.md)

# Implementation semantics validation — 2026-07-15

## Outcome

The JavaScript Scanner now covers the explicit first-version design requirement for state enums, key branches, permission guards, state transitions, and exception paths. These remain deterministic implementation Facts; they are not promoted into normative business Claims without a separate Skill candidate and authorized human Decision.

## Extracted facts

- `enumValues([...])` symbols retain their literal values;
- every `if` condition becomes a locatable `condition-branch` CodeSymbol with bounded source text;
- statically recognizable state, permission, and configuration conditions receive deterministic classifications;
- explicit role/permission-check calls retain their operation and literal declared arguments;
- JavaScript state assignments and literal SQL `UPDATE ... SET status/state/...` statements become `state-transition` symbols;
- every explicit throw becomes an `exception-path` with error type and literal message when available.

Each fact carries the normal artifact, line range, content hash, extractor, Snapshot, and immutable fact identity. A classification only says that the observed implementation contains that syntax; branch reachability, inferred source state, dynamic authorization, and business correctness remain unknown unless separately evidenced.

## Feature mapping

The built-in reference Skills now attach a bounded implementation context to endpoint candidates. The context follows deterministic endpoint/handler relations and local artifact dependencies for at most two levels and at most 50 combined facts. State/permission/exception symbols therefore survive candidate review into the exact implementation mapping and appear as locatable CodeSymbol nodes in the Feature traceability graph.

This is context Evidence, not additional normative authority. The endpoint Fact remains the direct support for the candidate, while related semantic facts use `CONTEXT` provenance.

## Executable proof

Scanner tests cover enum values, permission and state condition classifications, an explicit permission check, JavaScript state transition, and exception paths. The built-in order pilot includes Artifact and CodeSymbol facts in both Reverse Runs and fails unless the repaired Feature mapping retains condition-branch, state-transition, and exception-path facts through the final current-Snapshot traceability view.
