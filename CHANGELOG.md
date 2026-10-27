# Changelog

User-facing download links and installation steps live in the [README](README.md).

## 0.3.8 — 2026-10-27

- Add a self-contained Windows installer/updater for `%LOCALAPPDATA%\KoBa\Extension`. Download and validate the official KoBa ZIP; back up and stage replacements before switching directories.
- Provide **one-time** migration from an unpacked KoBa folder: stage current files at the same original real path and retain an original backup, then explicitly export and import browser-local JPDB credentials, recovery and preferences. No junctions or browser profile edits.
- Reject repeated imports, tampered JSON and configured destinations; future updates use only AppData without repeating migration.
- Preserve the browser extension's JPDB review, account state and on-demand UI; the browser still requires initial Load unpacked or normal Reload.

## 0.3.7 — 2026-10-27

- Publish one `KoBa_vVERSION.zip` plus its checksum file.
- Accept only KoBa package names for update discovery and hide unsupported cached notices.
- Retire pre-rebrand panel-message adapters, compatibility fixtures, and superseded branding/qualification documents.
- Preserve current KoBa settings, account-scoped reviews, recovery journal, and normal manual updates.
- Retain the completed popup-position test repair and its strict Reveal/tab-return checks.

## 0.3.6 — 2026-10-23

- Fixed popup twitching when **Reveal** expands an answer; the popup now keeps a stable upper edge and scrolls long content within smaller windows.
- Added a vertically draggable `○` launcher while retaining horizontal anchoring beside ChatGPT's composer.
- Added **Behavior → Button vertical position** and **Reset to center** in extension settings; position is saved across ChatGPT tabs.
- Preserved the normal click-to-open behavior, shared review ownership, and all existing JPDB grading safeguards.
- Published as the [v0.3.6 release](https://github.com/kurichon/koba/releases/tag/v0.3.6).

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
