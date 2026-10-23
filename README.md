# KoBa — Kotoba no Soba

**Version 0.3.3 — KoBa public identity, MIT license, and backward-compatible releases.**

*ことば、そばに。 — A little Japanese, always close by.*

A small, manual review popup for existing JPDB vocabulary while using ChatGPT.
It connects directly to JPDB. There is no backend, OpenAI API call, automatic
interruption timer, or audio feature.

The source repository is [kurichon/koba](https://github.com/kurichon/koba).
GitHub release checks are opt-in and remain inactive until enabled in settings.
The repository can prepare draft releases through GitHub Actions. Publishing a
release or Chrome Web Store listing remains a separate action.

## Upgrade an existing v0.3.1 installation

1. Close any open JPDB review popup.
2. Copy the files from this project's `extension/` directory into the **same
   directory** currently loaded in Chrome or Brave. Alternatively, extract
   `dist/KoBa_v0.3.3.zip` into that directory.
3. Open `chrome://extensions` or `brave://extensions` and click **Reload** on
   the existing KoBa installation.
4. Verify **0.3.3** in the extension settings. Open ChatGPT and click `○`.
   Refresh an existing ChatGPT tab once if its controls do not update.

`manifest.json` must be directly inside the loaded directory. Keep the existing
extension installed and retain its folder path to preserve its API key and
settings. Loading a different folder, removing the extension, or installing a
future store edition can create a different extension identity.

For a first installation, open the browser's Extensions page, enable **Developer
mode**, choose **Load unpacked**, and select `extension/`. Open the extension's
toolbar settings, enter the JPDB API key, then **Save** and **Test connection**.
Do not select the entire repository as the extension folder.

The declared minimum is Chrome/Chromium 114. This candidate was exercised in
isolated Chromium; see [qualification](docs/QUALIFICATION.md) for exact evidence
and the checks still needed on the user's Chrome/Brave and live accounts.

## Review behavior

Nothing opens automatically. Click the neutral `○` beside the ChatGPT
conversation/composer column when you want to review. Reveal the answer and choose
a grade; the popup advances after each accepted review until you close it.
Closing a revealed but ungraded card resets it to its front.

Only one ChatGPT tab owns the popup. Clicking the launcher in another tab moves
the same shared review session there. Merely switching tabs does not move or open
the popup. Shortcuts work only while the popup has focus.

| Key | Action |
| --- | --- |
| Space | Reveal |
| 1 | Nothing |
| 2 | Something |
| 3 | Hard |
| 4 | Okay |
| 5 | Easy |
| Escape | Close; the launcher and `×` also close |

The queue includes due and failed vocabulary, and learning vocabulary only when
JPDB supplies an elapsed `due_at`. Vocabulary may be written with kanji or kana.
New, redundant, locked, suspended, and blacklisted entries are excluded. This uses
deck vocabulary; it does not implement dedicated kanji/component learning.

## KoBa identity and licensing (0.3.3)

- **Short name:** KoBa. **Expanded name:** Kotoba no Soba (ことばのそば).
- **Tagline:** ことば、そばに。 (*Kotoba, soba ni.*)
- **License:** [MIT](LICENSE), copyright (c) 2026 kurichon. The runtime ZIP also includes a license copy.
- **Public source/release repository:** [kurichon/koba](https://github.com/kurichon/koba).
- The release builder generates both `KoBa_vVERSION.zip` and a byte-identical legacy-named
  `JPDB_Review_Button_for_ChatGPT_vVERSION.zip`. Pre-rebrand v0.3.2 update checkers
  require the legacy filename, so do not remove this alias from future releases
  while those clients need the upgrade path.
- This release changes product identity and packaging, not the JPDB grading workflow.
  Existing unpacked installations should upgrade in place to retain browser storage.
- This is an independent tool, not affiliated with or endorsed by JPDB or OpenAI.
  The license covers this repository's code, not the external services or their content.

## Changes in 0.3.2

- Opening shows a loading state immediately. Closing, reopening, and transferring
  the popup do not wait behind network requests.
- An accepted grade is recorded before optional refreshes. A slow refresh cannot
  leave an already accepted review stuck at **Saving**.
- Pending writes survive background restarts. Unknown outcomes become explicit
  recovery states and are never automatically resubmitted.
- A fresh queue survives worker sleep. Cache/recovery data is scoped to an API-key
  fingerprint; late work from a previous key cannot update the current account.
- Temporary API failures no longer falsely disable `due_at` support. Empty scans
  are reused, and explicit force sync refreshes the vocabulary list.
- Rapid reveal-and-grade input is buffered once, controls reflect real state,
  closing restores composer focus, and composer replacement does not strand the popup.
- Settings add GitHub release checks, sanitized diagnostic export, and a force-sync
  flow that acknowledges immediately and reports background completion or failure.

## Interrupted reviews and diagnostics

A missing response cannot tell the extension whether JPDB received a grade.
**Check review status** reads the current card without sending another grade.
A changed state or schedule can reconcile the card, but does not prove which exact
grade was received. An unchanged state remains uncertain.

**Continue without resending** holds the card aside and moves to other reviews.
That hold survives reloads until an authoritative state/schedule change is observed.
Up to 32 unresolved cards can be held; the extension does not discard older
unresolved writes to continue. Use JPDB to resolve the underlying status if needed.

Use **Try again** for recoverable read errors. **Force sync** refreshes vocabulary
and review states; it does not resend uncertain grades. **Copy diagnostics** exports
version, counts, status, safe error codes, and recent event types/revisions. It omits
API keys, vocabulary text, and server response bodies. A selectable text fallback
appears when clipboard access is unavailable.

## GitHub and updates

The checker reads **published release metadata**, rather than arbitrary commits.
A newer stable release needs a valid numeric version and the correctly named
runtime ZIP before it can produce a notice.

The **Updates** field suggests `kurichon/koba`. Enable daily checks if desired and allow
optional access to `api.github.com` to check published stable releases. **Check now** also works without daily checks.
JPDB credentials and ChatGPT content are not sent to GitHub. Private repositories
are not supported by the checker; private source can use a separate public release
repository without putting a GitHub token in the extension.

**This unpacked edition discovers updates automatically; installation is manual.**
Open the release, replace files in the same folder, and press Reload. Browser-managed
automatic installation for normal Chrome on Windows/macOS requires a later Chrome
Web Store distribution step. [Updates and publication](docs/UPDATES.md) explains
the browser rules, official sources, configuration, and release process.

## Development and release

Use Node.js 22 or later and Python 3. Runtime code has no external package dependency.

```sh
npm ci
npm test
npx playwright install --with-deps chromium
npm run test:browser
npm run build
```

Browser tests use the actual extension in a disposable profile, a controlled
ChatGPT layout, and fake JPDB/GitHub transport. They never submit a real review.
Exact hot upgrades of an existing unpacked folder remain a manual browser
acceptance check; headless Chromium may retain an older service worker after
files are replaced.
The build emits a runtime-only ZIP and checksum in `dist/`, validating version
agreement, file membership, and all archive bytes. Add `-- --tag v0.3.3` to enforce
the release tag too.

The included GitHub workflows qualify changes and prepare an **unpublished draft**
when a matching version tag is pushed **or** via the manual workflow action.
A remote GitHub run and publication must be verified separately.

| Location | Purpose |
| --- | --- |
| `extension/` | Runtime source and unpacked installation folder |
| `tests/` | State/update tests and actual-browser scenarios |
| `scripts/build-release.mjs` | Runtime ZIP/checksum builder |
| `.github/workflows/` | CI and draft-release preparation |
| `docs/UPDATES.md` | GitHub setup and distribution design |
| `docs/QUALIFICATION.md` | Resolved findings, evidence, and live-test limits |
| `dist/` | KoBa ZIP, legacy-compatible ZIP, and checksum |

## Data and permissions

The key remains in `chrome.storage.local`, is sent to JPDB as a bearer credential,
and is never inserted into the ChatGPT page DOM. Local storage also holds the bounded
queue, unresolved-write records, and update preferences. Session storage holds the
current popup/session and bounded diagnostic events.

JPDB host access supports review requests. ChatGPT host access and scripting support
the popup/reinjection. Storage persists state; alarms schedule optional release checks.
GitHub API access is optional and requested from settings. There is no telemetry
endpoint or remote code loading.
