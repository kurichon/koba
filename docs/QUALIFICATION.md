# KoBa qualification and known verification limits

[← Back to KoBa](../README.md) · [Current architecture](ARCHITECTURE.md) · [Historical evidence](history/)

**Current public release:** [KoBa v0.3.6](https://github.com/kurichon/koba/releases/tag/v0.3.6) · **Source commit tagged:** [`be5ce2c`](https://github.com/kurichon/koba/commit/be5ce2c544e5f05d2f57acb4e719c0a24840b63d) · **Date:** October 23, 2026.

This is an evidence register, not a statement that every user environment was tested. The user requested manual on-demand review, a vertically adjustable horizontal-anchored launcher, stable Reveal, preserved JPDB scheduling, reliable queue and recovery, and a GitHub update path. The following evidence applies to the stated source/artifact only.

## Verified in GitHub Actions

- [Source and Chromium CI on the v0.3.6 code](https://github.com/kurichon/koba/actions/runs/39918959317): background-state and GitHub update tests passed; **seven** actual-extension Chromium browser scenarios passed against controlled ChatGPT and simulated JPDB/GitHub transport; runtime ZIP build passed.
- [v0.3.6 publication workflow](https://github.com/kurichon/koba/actions/runs/39920480123): rebuilt the tagged source, repeated tests, validated SHA-256 against the qualified build, created the immutable source tag and published the stable release.
- Both release ZIP filenames contain the same runtime bytes. The published `KoBa_v0.3.6.zip` digest is `180948881f3159826969d92102cd81f3f9253ff6f1733fe8f371af4261f656d3` (SHA-256).

| Area | Controlled outcome |
| --- | --- |
| First load and ownership | Popup opens visibly, can be dismissed during a held lookup, and follows explicit tab ownership without stale reopening. |
| Large collection | Delayed second lookup displays stage/progress counts instead of unbounded generic loading. |
| Reviews and recovery | One grade POST per accepted input; safe journal handling after interrupted writes or worker restarts; no duplicate auto-retry. |
| Queue warming | Cached review remains interactive while refresh is deliberately held; stale responses do not restore recently graded cards. |
| Popup stability | Reveal maintains a stationary top edge after an answer expands; switching tabs alone does not move the panel. |
| Launcher vertical position | Drag, saved setting, cross-tab synchronization, Settings slider and reset preserve the composer-based horizontal anchor. |
| Updates and diagnostics | Optional GitHub release permission/validation and sanitized diagnostics are exercised with controlled responses. |

## Not verified by the automated environment

- The exact live Chrome/Brave installation on a user's Windows profile and the **current live ChatGPT page** across different themes, zoom levels and long sessions.
- JPDB's actual account-specific scheduling and server response times; all browser tests use **simulated API transport** and fake credentials.
- An in-place **hot update** of an installed unpacked extension on a live Chrome/Brave profile. Headless Chromium can keep a cached prior service worker after an in-place folder replacement; the CI upgrade path is not a substitute.
- Browser-managed auto-installation: the unpacked distribution supports **notification only**, and a Chrome Web Store edition is not implemented.

These are bounded validation gaps, not automatic claims that the extension fails. When user feedback identifies a defect, reproduce it and add a targeted regression before closing it. A passing CI suite alone is not proof of real-account behavior.

## Historical snapshots retained for recovery

The original reliability and naming reviews are preserved under [history](history/). They describe earlier version candidates, may mention then-pending publication, and must not be used to infer current release status:

- [Recovered v0.3.2 qualification and repair record](history/QUALIFICATION_v0.3.2.md)
- [v0.3.3 name, licensing and compatibility record](history/BRANDING_0.3.3.md)

The frozen [`tests/fixtures/v0.3.1/`](../tests/fixtures/v0.3.1/) baseline is retained for backward-compatibility investigations and is intentionally excluded from runtime ZIPs. Source code and the [release changelog](../CHANGELOG.md) remain the current behavior/version authority.
