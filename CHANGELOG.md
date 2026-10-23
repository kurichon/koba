# Changelog

User-facing download links and installation steps live in the [README](README.md). For archived engineering evidence, see [docs/history](docs/history/).

## 0.3.6 — 2026-10-23

- Fixed popup twitching when **Reveal** expands an answer; the popup now keeps a stable upper edge and scrolls long content within smaller windows.
- Added a vertically draggable `○` launcher while retaining horizontal anchoring beside ChatGPT's composer.
- Added **Behavior → Button vertical position** and **Reset to center** in extension settings; position is saved across ChatGPT tabs.
- Preserved the normal click-to-open behavior, shared review ownership, and all existing JPDB grading safeguards.
- Published as the current stable [v0.3.6 release](https://github.com/kurichon/koba/releases/tag/v0.3.6).

## 0.3.5 — 2026-10-23

- Keep the existing review queue usable while a **sequential background refresh** runs, and reuse that refresh when the queue empties.
- Suppress stale lookup responses from resurfacing a recently graded card until JPDB confirms a schedule/state change.
- Add sanitized timing diagnostics for grade responses, card transitions, and refreshes. Preserve paced API requests and no automatic grade resubmission.

## 0.3.4 — 2026-10-23

- Show stage and counts during first-time deck enumeration and vocabulary-eligibility checks.
- Clear loading indicators correctly after errors and worker restarts, and add slow-batch browser regressions.

## 0.3.3 — 2026-10-23

- Adopt the name **KoBa — Kotoba no Soba (ことばのそば)** and the tagline **ことば、そばに。**
- Add the [MIT license](LICENSE) and GitHub-ready source/release packaging.
- Provide `KoBa_vVERSION.zip` and a byte-identical legacy-named alias for older extension update clients.

## 0.3.2 — 2026-10-23

- Acknowledge popup opening immediately, preserve one-owner tab behavior and reject stale actions/late popup replies.
- Persist pending reviews before their POST and accepted receipts before optional refresh; keep ambiguous results as recoverable, never automatically retry a grade.
- Scope durable caches and recovery state to the JPDB account fingerprint, survive worker restarts, avoid erroneous learning-card eligibility fallback, and bound network requests.
- Buffer rapid Reveal/grade input, preserve focus across ChatGPT composer replacement, and add sanitized diagnostics and configurable GitHub release checks.
- Introduce runtime ZIP/checksum generation and CI/draft-release workflows.

## 0.3.1 — recovered baseline

- Replace automatic interruptions with a manual `○` launcher and continuous card-by-card review.
- Add shared cross-tab session ownership and popup-only keyboard shortcuts.
- Reduce hit-testing conflicts with a zero-sized shadow host and isolate interaction events.

Historical baseline, naming and validation details remain in [docs/history](docs/history/) and the frozen [v0.3.1 compatibility fixture](tests/fixtures/v0.3.1/).
