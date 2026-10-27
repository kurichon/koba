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
| Popup stability | Controlled passing browser runs held the popup's top edge during Reveal and tab switching; see the intermittent CI observation below. |
| Launcher vertical position | Drag, saved setting, cross-tab synchronization, Settings slider and reset preserve the composer-based horizontal anchor. |
| Updates and diagnostics | Optional GitHub release permission/validation and sanitized diagnostics are exercised with controlled responses. |

## Popup layout measurement follow-up (October 27, 2026)

Following the documentation-only [PR #5](https://github.com/kurichon/koba/pull/5), the first [main-branch CI run (attempt 1)](https://github.com/kurichon/koba/actions/runs/39923016817/attempts/1) measured a **15 px Reveal-related popup shift** in its Chromium fixture; [attempt 2](https://github.com/kurichon/koba/actions/runs/39923016817/attempts/2) passed the same seven browser scenarios. The v0.3.6 runtime source blobs and packaged SHA-256 were **identical** to the prior qualified release, so the documentation edit did not cause this difference.

The interrupted [PR #7](https://github.com/kurichon/koba/pull/7) addressed a timing gap: a ready card does not establish that the popup's initial `requestAnimationFrame` placement has run. An inline `top` value also survives closing and can describe the previous opening. The completed test repair at [`5a801c4`](https://github.com/kurichon/koba/commit/5a801c44c55d9fabcd00351db633ed7d28c5dd13) uses one bounded two-frame measurement helper in **both** Reveal scenarios and after tab return, and waits for the Reveal response to finish. It retains the strict **≤1 px** requirement and reports before/after geometry; it never waits until a movement disappears.

### Controlled evidence for the repair

| Check | Observed result |
| --- | --- |
| Deterministic stale-baseline reproduction | With the popup closed, change the launcher position and synchronously reopen it. The old top was **334 px**, then initial placement moved it to **131 px** before any Reveal. Reveal after the settled baseline moved it **0 px**; no review POST was sent. |
| Sensitivity to an actual defect | A disposable extension copy deliberately recentered the popup when the answer appeared. The repaired review scenario rejected a **59 px** Reveal movement at the intended assertion. Production runtime source was not modified. |
| Local development checks | Node.js **24.22.1**, Playwright **1.52.0**, pinned Chromium build **1169** on Linux: both state/update test files and **8/8** actual-extension browser scenarios passed. The same-folder hot-upgrade scenario remains explicitly skipped. |
| Hosted verification | [GitHub Actions run 40434565750](https://github.com/kurichon/koba/actions/runs/40434565750) passed on the exact test repair commit, including the state/update tests, **8/8** Chromium scenarios and runtime ZIP validation. Final PR and merge checks remain available in [PR #7](https://github.com/kurichon/koba/pull/7/checks). |
| Runtime and package integrity | All ten packaged files matched the published `v0.3.6` tag byte-for-byte. Rebuilding with `npm run build -- --tag v0.3.6` reproduced SHA-256 `180948881f3159826969d92102cd81f3f9253ff6f1733fe8f371af4261f656d3`. No version bump or replacement release is needed for this test/documentation repair. |

The new reopen scenario is a regression for the **measurement harness and current asynchronous placement**, not a requirement that a stale position remain visible. A future synchronous-placement implementation may legitimately replace that timing precondition while preserving the Reveal-stability assertion.

The controlled reproduction establishes the stale-baseline mechanism; it does **not** conclusively attribute the historical **15 px** observation to that mechanism, nor exclude every transient flicker. [Issue #6](https://github.com/kurichon/koba/issues/6) therefore remains open for the user's long-idle/live Chrome/Brave symptom. The next required evidence is a supported live-browser check after leaving a panel open, switching away and back, and revealing a card, with viewport or intentional launcher movements distinguished from Reveal. Preserve the existing installation, settings and API key; do not use a real grade merely to test layout.

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
