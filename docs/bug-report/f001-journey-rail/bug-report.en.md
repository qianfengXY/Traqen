> Language: **English** · [简体中文](bug-report.md)

---
feature_ids: [F001]
topics: [browser, journey, responsive-layout]
doc_kind: bug-report
created: 2026-09-07
---

# F001 narrow-screen journey positioning

Author diagnosis: 砚砚 / gpt-6-astra. This is not independent review or complete feature acceptance.

## Diagnosis and cause

File B §10.1 requires the journey to scroll within its own container and reveal the current station. At `9955570`, both return buttons only reset the selected station; neither scrolled the container. Narrowing the viewport also did not reposition it.

An actual workbench directory capture using the isolated API reached station 7. At a 390px viewport, the rail occupied x=51–339 but station 7 occupied x=555–639. Clicking return and waiting four seconds left `scrollLeft=0`; the behavioral assertion exited 1. Document width remained 390px, distinguishing this from global navigation or page overflow.

## Change and verification

- `revealSourceStation` scrolls only the clipped distance inside the journey, without scrolling the document or moving keyboard focus.
- Both return buttons explicitly reveal the current station, including when selecting it causes no React state change.
- Initial loading, selected-station changes and container resize reveal the selected station. Already visible stations do not scroll; unmount disconnects the resize observer.
- The same browser assertion is GREEN: `scrollLeft=300`, station 7 at x=255–339, entirely visible. Footer return, 1280→390 resize, no premature freeze action in future preview, and no navigation writes also pass.
- Source Web tests: 19/19. Targeted strict ES2017 typecheck: exit 0. Zero-warning lint: exit 0. The first lint run identified an unnecessary effect dependency; removing it made the same check pass without disabling a rule.

Replay script: `test/support/source-truth-rail-browser.mjs`. Start the managed isolated fixture on API 3187 and this worktree's Web application on 3188, then pass three absolute paths: installed Playwright module, headless Chromium executable and temporary evidence directory. The script checks actual button behavior and mutation requests; it fails on the original behavior.

## Evidence limits

This uses Playwright 1.61.1, Chromium headless shell 1234, PGlite test records and independent temporary content storage. OPFS supplies real directory handles in place of the native picker return value. It does not prove native OS picker interaction, browser Git capture, actual PostgreSQL deployment or disaster recovery. RED/GREEN artifacts are in temporary directories `traqen-f001-browser-acceptance.nPLEtj` / `traqen-f001-rail-green.7YdaD1`; key coordinates and results above do not depend on their retention. The earlier temporary environment disappeared after a host restart, so this run reproduced the failure anew.

The preview is `running/origin=launchd`, HTTP 200. Hub delivery is `unconfirmed/no_matching_client`, not proof of an opened panel. No `.pen` design exists; verification uses file B's narrow-screen behavior without changing F005 global navigation.

Risk: only workbench visibility behavior changes; no data, authorization, external API, freeze logic or storage mutation. Targeted checks establish this correction only. The 29 repository type errors, aggregate Git cache control and remaining browser/deployment acceptance remain open. F001 is not complete.
