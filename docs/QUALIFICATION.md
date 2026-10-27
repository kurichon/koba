# KoBa qualification and known verification limits

[← Back to KoBa](../README.md) · [Current architecture](ARCHITECTURE.md) · [Development](DEVELOPMENT.md)

**Current source:** v0.3.7, October 27, 2026. **Current public release:** [v0.3.6](https://github.com/kurichon/koba/releases/tag/v0.3.6) until the v0.3.7 publication checks complete.

This record separates demonstrated behavior from checks that require a live user installation. KoBa provides manual review, a vertically adjustable launcher, stable Reveal, JPDB scheduling, safe review recovery, and optional GitHub update notifications.

## v0.3.7 completion scope

- Build and publish one `KoBa_vVERSION.zip` and its checksum file.
- Require the KoBa filename in fetched and cached update metadata and in content-script notices.
- Retire pre-rebrand panel-message adapters, compatibility fixtures, and superseded documents. Retain negative checks proving retired inputs cannot alter an active review.
- Preserve current browser storage, API key, account-scoped queue and pending/uncertain review recovery.

Local candidate checks passed on October 27, 2026:

- Background/recovery and update-checker tests passed, including rejection of retired messages, old package names and cached notices.
- **8/8 actual-extension Chromium scenarios passed against the extracted v0.3.7 ZIP**, including notice rejection before and after a real page reload. The suite uses controlled ChatGPT layout and simulated JPDB/GitHub transport; it never submits a real review.
- The archive contains exactly ten allowlisted runtime files, each matching source bytes. The output directory contains only `KoBa_v0.3.7.zip` and its one-line `SHA256SUMS.txt`.
- ZIP SHA-256: `493a5a633839e3e3432619e106c9e17d4cc8a83cf285cabb3aa86452a6ac729d`.

Hosted checks on the exact PR revision and the publication workflow must also pass before the release is published.

## Current behavior covered by the controlled suite

| Area | Required observable result |
| --- | --- |
| Ownership and first load | Popup opens immediately, closes during a held lookup, and follows explicit tab ownership without stale reopening. |
| Large collection | Delayed lookup displays stage/progress counts. |
| Reviews and recovery | One grade POST per accepted input; interrupted or uncertain writes survive restart without automatic resubmission. |
| Queue warming | Cached review remains interactive during a held refresh; stale results do not restore recently graded cards. |
| Popup stability | Both Reveal scenarios and tab-return checks retain the ≤1 px upper-edge invariant after bounded initial layout synchronization. |
| Launcher positioning | Drag, cross-tab storage, Settings slider and reset preserve the composer-based horizontal anchor. |
| Updates and diagnostics | Canonical package notices display; retired package names and stale cached notices are rejected; permissions and sanitized diagnostics work. |
| Retired messages | Unsupported panel messages cannot close, steal, reveal, or grade an active review. |

## Remaining popup observation

[PR #7](https://github.com/kurichon/koba/pull/7) corrected a layout-measurement race and added a deterministic distinction between initial placement and Reveal. Its [merged-main CI](https://github.com/kurichon/koba/actions/runs/40434918529) passed. The timing reproduction established stale initial positioning, and a deliberately recentering disposable copy failed the strict assertion.

That evidence does not conclusively explain the historical 15 px observation or exclude every transient/live-browser flicker. [Issue #6](https://github.com/kurichon/koba/issues/6) remains open for the long-open/idle → switch tabs → return → Reveal sequence on the supported live Chrome/Brave installation. Distinguish actual viewport or intentional launcher movements from Reveal. No real grade is needed to check layout.

## Not verified by the automated environment

- The exact Windows Chrome/Brave profile and current live ChatGPT layout across themes, zoom levels and long sessions.
- JPDB's account-specific scheduling and server response times; automated transport is simulated.
- An in-place hot update on a live Chrome/Brave profile. Cold browser restart coverage verifies persistence, not hot reinjection.
- Browser-managed automatic installation. The unpacked distribution supports update notification and manual replacement/reload.

These are bounded verification gaps, not claims of failure. Passing controlled checks does not establish behavior in an untested live environment.
