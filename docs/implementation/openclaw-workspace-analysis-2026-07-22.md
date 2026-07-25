> Language: **English** · [简体中文](openclaw-workspace-analysis-2026-07-22.zh-CN.md)

# OpenClaw Workspace Analysis Validation — 2026-07-22

## Purpose

This report validates Traqen's browser-side Workspace scanner against the real [`openclaw/openclaw`](https://github.com/openclaw/openclaw) repository. The repository was inspected read-only at commit `591c6ce3278d8c5011e5cad0fdef7381235f8f41`. No OpenClaw setup, install, test, or runtime command was executed.

## Scope and observed scale

The pinned Git tree contained 27,712 files. Its largest areas included `src` (11,622 files), `extensions` (8,277), `apps` (1,927), `ui` (1,561), `test` (792), and `packages` (722). The complete core `src` tree was checked out and passed through Traqen's bounded local scanner:

| Metric | Result |
| --- | ---: |
| Core `src` files presented | 11,622 |
| Supported and scanned | 11,618 |
| Deliberately skipped | 4 |
| Extracted implementation/API candidates after corrections | 15,806 |
| Conservative deterministic business projection | 265 |
| Gateway/RPC API projection | 329 |
| RPC descriptors linked to handler source | 304 |

The four skipped files were HTML/CSS export templates or vendored minified JavaScript. They were not silently counted as analyzed source.

## Defects found and corrections

The original baseline promoted 11,630 of 15,715 extracted symbols into the business tree. Samples were internal helpers such as backend-candidate resolution, task-record construction, session state, and test support. This demonstrated that an exported symbol is locatable implementation evidence, not a business Feature. The deterministic business fallback is now deliberately conservative, and test-helper/support filename variants no longer contribute Feature candidates. The resulting 265 entries are still heuristic candidates pending model reconciliation, not business authority.

The baseline API projection was empty because OpenClaw exposes a typed Gateway/RPC method registry rather than Express-style routes. Traqen now recognizes `GatewayMethodDescriptor`/`GatewayMethodSpec` records as API design evidence, including method name and authorization scope. It also recognizes corresponding `GatewayRequestHandlers` entries and links exact method identities to implementation code. This produced 329 RPC endpoints and exact source linkage for 304 of them. Unlinked methods remain visible with their descriptor evidence rather than receiving an unrelated implementation match.

## Model-failure behavior exercised by this change

An OpenAI-compatible provider can claim JSON mode while still returning truncated text or an incomplete object. Traqen continues to bisect invalid batches. If a single-candidate atomic unit still has no complete valid JSON object or array, it now emits `BATCH_SKIPPED`, preserves deterministic evidence without model classification, checkpoints the unit as pending, and continues the run. It does not invent missing fields or report a successful model conclusion.

Agent-facing messages now expose public work summaries using goal, action, findings, evidence, uncertainty, checkpoint, and next-action fields. Raw payloads, request identifiers, token diagnostics, and bounded previews remain behind Technical diagnostics; provider or model private reasoning is neither requested nor displayed.

## Remaining limitations

- This run validates the complete core `src` tree, not every source file in all 27,712 repository paths.
- Swift and Kotlin source found under mobile application areas is not yet supported by the browser scanner. Those files require explicit language adapters before Traqen can claim complete mobile coverage.
- The deterministic 265-item business view is only a high-precision starting projection. Human-readable product capabilities require independent direct-source Skill/model analysis and reconciliation; scanner output alone must not become business truth.
- Gateway descriptor extraction is structural pattern analysis, not a TypeScript compiler proof. Exact source ranges and handler identity make it auditable, but model/Skill review and human confirmation remain required.
- OpenClaw was not executed, so test results and deployed-runtime evidence remain `NOT_RUN`.

## Conclusion

The real repository test changed product behavior rather than merely documenting a gap: custom Gateway/RPC APIs are now visible with design and implementation evidence, test-support noise is excluded, deterministic business promotion is sharply reduced, and malformed model JSON no longer aborts a Workspace analysis. The remaining gaps are explicit and remain pending rather than being presented as completed analysis.
