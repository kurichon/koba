> **v0.3.4 qualification note:** First-load stage/count progress has been added for cold and large-collection scans, with a controlled multi-deck regression. The historical v0.3.2 and v0.3.3 findings remain relevant; live-user collection size, JPDB availability, and the reason for the reported v0.3.3 stall are not verified. A green CI run does not establish the live-user remediation.

> **Historical v0.3.2 record.** This file preserves the tested repair baseline and its original hashes. The KoBa v0.3.3 naming, MIT packaging, release alias and new test results are recorded separately in [BRANDING_0.3.3.md](BRANDING_0.3.3.md).

# v0.3.2 qualification and repair record

Date: **2026-10-23** (Asia/Seoul). Active mode: **Qualification & Repair**.

## Decision

**The local repair candidate passes its recorded automated and isolated-browser
gates. It is ready for a same-folder user validation installation.** It is not
claimed to be fully qualified against the user's live JPDB account, current
ChatGPT DOM, or installed Chrome/Brave. Public-repository setup and later GitHub workflow execution are separate from
this historical local qualification record; no public release or store listing
was tested in this baseline.

The installable candidate is:

`dist/JPDB_Review_Button_for_ChatGPT_v0.3.2.zip`

SHA-256:

`f93f4bdd134bfc4c24fe45898077a2e8cf5c06b2d6b1c1673693b757de49da7c`

The final browser run loaded the files **extracted from this ZIP**. The report
records the hash of each of its nine runtime files. Packaging verification checks
those against the archive and source before the outer project bundle is created.

## Authority and baseline

The starting point is the latest recovered working package, **v0.3.1**, delivered
September 23, 2026. Original ZIP SHA-256:

`e3cfcea93549abe89e0336626d23eb6faa6fdaa7d63ed686068b6ef2e44480b1`

The user requested a responsiveness/polish pass, then accepted the repair work
and added a foundation for future repository-based updates. The manual interaction
contract and vocabulary policy were retained. The original baseline remains
unchanged in `tests/fixtures/v0.3.1/`; its prior review and observations are in
`evidence/baseline/`.

The repaired implementation and distribution boundaries are described in
[architecture](ARCHITECTURE.md) and [updates](UPDATES.md). Automatic release
discovery is implemented. Automatic installation is not available in this unpacked
edition and is not claimed as delivered.

## Original findings and disposition

| Finding | Repair and evidence | Status |
| --- | --- | --- |
| F1: hidden initial loading; repeated launcher clicks ignored | Popup opens immediately; close remains available; late read cannot reopen it. Actual Chromium slow-read scenario passed. | Closed locally |
| F2: accepted grade waits on follow-up lookup | Accepted receipt/cache commit precedes next-card selection and optional refresh. Browser advanced to the next card while follow-up read remained held. | Closed locally |
| F3: restarted worker can repeat a prior grade | Durable pre-write journal; zero automatic write retries; accepted receipt crash recovery; unknown state/quarantine survive reload. Handler crash/storage cases and actual Extensions-page Reload passed. | Closed locally |
| F4: delayed open can leave two popups visible | Explicit local intent, recipient-specific ownership, revisions, previous-owner close. Actual two-tab scenario passed. | Closed locally |
| F5: transient error falsely disables `due_at` | Typed retryable errors retain capability; fallback requires explicit field rejection. Transient and compatibility cases passed. Exact live unsupported-field error shape remains unverified. | Closed locally; live compatibility caveat |
| F6: worker restart/empty result causes avoidable scans | Scoped persisted fresh queue, reused empty result, bounded persisted queue/refill. Handler tests confirm no unnecessary warm/empty scan. Real large-account latency is not measured. | Closed locally; scale measurement pending |

Independent review also found and closed stale/current-version update notices,
repository casing inconsistency, false force-sync success on errors/pending reviews,
and force sync incorrectly reusing an ordinary scan with cached IDs. The last case
was reproduced against the actual handler, then verified to fetch the current deck
list and reject the superseded scan's late result.

## Verification environment

- Node.js **24.19.0**, Playwright **1.52.0**.
- Disposable **Chromium 136.0.7103.25** on Linux, headless with extension support.
  The reduced user-agent version recorded in the browser report is `136.0.0.0`;
  the executable's `--version` identifies the full build.
- Actual unpacked MV3 runtime, content script, Shadow DOM, messaging, local/session
  storage, alarms, and the real Extensions-page Reload control.
- A controlled page supplied the ChatGPT composer layout. The isolated service
  worker used fake JPDB and GitHub responses, including delayed reads and lost
  responses. External page requests were blocked except for the controlled fixture.
- All test API keys are explicit dummy values. **No real JPDB request or review
  write, ChatGPT account interaction, or GitHub publication occurred.**

## Behavioral evidence

### Focused actual-source suites

`evidence/background-tests.txt` records **18 passing cases** against the actual
background modules and registered message interface. They cover ownership during
blocked reads, accepted-write advancement, unknown-write restart/quarantine,
in-flight and accepted-receipt crash boundaries, transient reads and capability
fallback, cache reuse, deadlines, account changes, pre/post-write storage failures,
duplicate grade suppression, reinjection, asynchronous force sync, and forced
vocabulary refresh superseding an ordinary scan.

`evidence/update-tests.txt` records **8 passing cases** for configuration/opt-in and
permission gates; numeric versions and ETag; invalid/draft/preview/downgrade or
missing-asset rejection; cooldown and retained verified metadata; source changes
during requests; deadlines; worker restart; and unavailable/oversized metadata.

The Node wrapper reports two successful test files. The counts above refer to
their named behavioral cases, not that file-level total.

### Browser scenarios on the extracted final ZIP

`evidence/browser/browser-results.json` records **five passing scenarios**:

| Scenario | Observed result |
| --- | --- |
| Initial loading and ownership | Popup visible in **45 ms** in this single controlled run; dismisses while lookup is held; no late reopen; former tab closes on transfer; ordinary tab switching does not open a popup. |
| Accepted grade, input, layout | Rapid Space/4 produces exactly one simulated review POST. Next card appears before a held refresh completes. Close/reopen remains usable, Escape restores composer focus, typing produces no reviews, ungraded answer resets, and composer replacement repositions the launcher. |
| Unknown write and reload | One simulated write attempt becomes uncertain. Read-only reconciliation explains unchanged state. Real Extensions-page Reload preserves uncertainty; there are **zero repeat POSTs** after reload. Continue holds the original card aside and advances. The dummy API key remains stored. |
| Settings and update controls | Simulated permission denial causes zero GitHub calls. Allowing the simulated permission enables validated release links and a 1,440-minute alarm. Mixed-case repo names work; already-installed notices hide. Diagnostic copy fallback omits key/vocabulary/headers. Failed force sync shows failure and disables review grades until recovery. |
| v0.3.1 same-folder upgrade | Install unchanged baseline, store dummy key, replace files in that same directory with extracted candidate, then press real Reload. Version becomes 0.3.2, key survives, the existing tab receives one current UI, and a review opens. |

The **45 ms** observation is not a performance percentile or a promise for the
user's collection/network. Cold-scan latency and real-world failure frequency have
not been measured. An independent source review and focused reproductions support
the findings; test counts alone are not the release conclusion.

Internal visual inspection covered the controlled popup, recovery controls, and
settings layout. This Linux environment has no Japanese font installed; DOM
assertions verify Japanese spelling/readings, but Japanese glyph typography on
the user's platform remains part of live validation.

## Packaging and repository automation

The ZIP builder enforces manifest/package/tag version agreement, an explicit
runtime allowlist, regular files, manifest references, deterministic member order
and timestamps, and reopened archive byte checks. A matching tag builds successfully;
a mismatched tag is rejected. The workflows parse as YAML and reference verified
published GitHub actions. They run the source tests and browser scenarios before
preparing an unpublished draft release.

The workflows have **not** executed on a remote GitHub repository here. GitHub
source visibility, repository identity, publication of the first stable release,
and a possible Chrome Web Store listing remain publisher decisions.

## Remaining live gates and limits

| Gate | Why it remains open / next check |
| --- | --- |
| User's Chrome and Brave builds | Test the loaded candidate on each browser actually used, with the current live ChatGPT layout, theme, zoom, and desktop viewport. |
| Live JPDB account | Verify connection, real eligible vocabulary including learning cards, and one intentionally chosen review. Observe its actual JPDB result. Real account changes were not performed during automated testing. |
| Large collection / real latency | Check first cold sync and warm reopening on the user's collection. Total cold work still scales with vocabulary/decks even though popup controls stay independent. |
| `due_at` compatibility response | Fallback requires HTTP 400/422 with explicit unsupported/invalid `due_at` wording. No authenticated live response established that exact shape. Other failures remain visible/retryable instead of silently excluding learning cards. |
| Native GitHub permission prompt | Tests simulated allow/deny results and used the real options wiring, storage, and alarm. Exercise the browser's actual optional-host prompt when configuring the selected repository. |
| Real published GitHub release | Configure the chosen public release repository, publish the correctly named ZIP with a greater version, and check real discovery. A repository now exists, but no published release was exercised in this historical baseline. |
| Remote CI and store distribution | Run the included workflows after repository setup. True automatic installation requires a supported distribution channel and a plan for the current unpacked identity; it is a later step. |

## Reproduce

```sh
npm ci
node --experimental-vm-modules tests/background.test.mjs
node tests/updates.test.mjs
npx playwright install --with-deps chromium
npm run build -- --tag v0.3.2
python3 -m zipfile -e dist/JPDB_Review_Button_for_ChatGPT_v0.3.2.zip test-results/release-extension
JPDB_TEST_EXTENSION="$PWD/test-results/release-extension" npm run test:browser
```

`JPDB_TEST_OUTPUT` selects the report/screenshot directory. `JPDB_TEST_EXECUTABLE`
can explicitly select a local Chromium executable; the bundled Playwright browser
is used by default. `JPDB_TEST_UPGRADE_FROM` overrides the included unchanged
v0.3.1 fixture. `JPDB_TEST_CASE` limits a diagnostic run to a name substring;
leave it unset for the complete acceptance run. Linux browser execution may need
the system dependencies installed by Playwright. No user browser profile is used.
