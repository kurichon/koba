# KoBa architecture

[← Back to KoBa](../README.md) · [Development](DEVELOPMENT.md) · [Current qualification](QUALIFICATION.md)

This describes the **v0.3.8 implementation candidate**, not yet published. The public stable release is v0.3.7. KoBa is a Manifest V3 Chrome/Brave extension. It adds a manually opened vocabulary panel to ChatGPT, uses a local API key to talk directly to JPDB, and has no separate server or OpenAI API integration.

## Source responsibilities

| Source | Responsibility |
| --- | --- |
| `extension/content.js` | Shadow-DOM launcher and review panel; keyboard and pointer interaction; positioning; local optimistic Reveal; focus and stale-response rejection |
| `extension/background.js` | JPDB requests; one authoritative shared review session; tab ownership; queue/cache; submission journal and recovery; content-script reinjection |
| `extension/panel.js`, `extension/session.js` | Intent/ownership and session/revision validation |
| `extension/lib.js` | Reviewable-card eligibility and sorting; due-time and authoritative-card-change interpretation |
| `extension/options.html`, `extension/options.js` | API key and enabled setting; vertical launcher control; sync, diagnostics, update settings; one-time transfer controls |
| `extension/migration.js` | User-controlled local export/import, allowlisted fields, integrity verification, and refusal to overwrite configured data |
| `extension/updates.js` | Optional GitHub release discovery with strict validation and bounded network requests |
| `scripts/build-release.mjs` | Allowlisted runtime packaging, version checks, reproducible ZIPs and hashes |

Network requests run outside the short state-mutation queue and can only apply results to the current account generation and job. GitHub update checks run independently of JPDB review actions.

## Manual UI and cross-tab ownership

The launcher appears beside ChatGPT's composer; its **horizontal position is anchored** to the composer. Its vertical position is user-adjustable by dragging or with the settings slider. The chosen viewport-relative position is bounded, saved in browser-local extension settings, and shared across ChatGPT tabs. Default positioning remains centered.

The popup opens only following an explicit launcher action and remains usable while data loads. Its top edge is pinned during Reveal and answer resizing to prevent jumping; long content scrolls internally. Keyboard shortcuts are scoped to the panel. Closing or changing tabs does not automatically submit a review.

A unique content-instance intent ID and revision identify each open/close request. The background returns a recipient-specific snapshot and closes a former owner when another tab explicitly takes ownership. The UI ignores stale responses that could otherwise reopen a dismissed panel. Normal tab activation does not transfer ownership. Reinjecting a changed content-script version retires its old event handlers/observers rather than stacking two UIs.

## Review grades and recovery

1. The background validates the owning tab, card identity, session revision, revealed state and current journal.
2. Before calling JPDB, it persists a unique pending submission attempt locally; if that write fails, **nothing is sent**.
3. It makes **one** bounded `POST /review`. Grades are never automatically retried.
4. When JPDB confirms acceptance, the receipt and queue removal are persisted together **before** advancing to a cached next card or performing an optional refresh.
5. If the response is lost, times out, or a worker restarts with an unresolved write, the attempt remains **uncertain**. Read-only reconciliation and **Continue without resending** preserve uncertainty without writing twice.

These protections reduce accidental duplicate submissions; they are **not** proof of exactly-once processing on the JPDB server. A changed card state/schedule can resolve a hold but cannot prove which grade was received.

## Review queue and caching

| Data or operation | Behavior |
| --- | --- |
| JPDB vocabulary inventory | Account-scoped local cache; 12-hour freshness |
| Card states | Up to 1,000 cached review-card records; nominal 2-minute freshness |
| Warm refresh | When an eligible card is cached, a sequential background refresh can run before expiry or when a low queue has aged; it does not block Reveal/grade |
| Batch lookup | Sequential groups of 400 with 350 ms between batches; no parallel request burst |
| Empty queue | An ongoing warm refresh is reused as foreground loading instead of launching a duplicate |
| Recently accepted reviews | Up to 64 state markers suppress stale responses until JPDB reports a changed authoritative state/schedule |
| Ambiguous review attempts | Durable per-account journal; at most 32 held unresolved attempts |
| API request limits | Reads: 8-second per-attempt deadline with at most one transient retry; grades: 12-second deadline with no retry |

An initial scan or a truly empty queue may still require complete JPDB lookups. Warm refresh improves the chance of continuous reviewing but does not eliminate API latency or remove the need to revalidate scheduling. Review eligibility follows JPDB's due/failed/learning status; new, locked, suspended, blacklisted, redundant and standalone component/kanji cards are deliberately excluded.

## Storage and privacy boundaries

| Location | Contents |
| --- | --- |
| `chrome.storage.local` | `apiKey`, enabled setting, launcher vertical position, account-scoped cache/recovery journal, optional GitHub update settings/metadata, sanitized summary metrics |
| `chrome.storage.session` | Active panel/session state, ownership revisions and bounded diagnostic action events |
| JPDB API (`jpdb.io`) | Vocabulary/deck lookups and review grades with the locally configured API key |
| Optional GitHub API (`api.github.com`) | Published release metadata only, after user-granted permission |

Local API-key fingerprints scope cache records; **they are not encryption**. Treat browser storage and profile backups as sensitive. The API key is never part of the runtime ZIP or sent to GitHub. No telemetry service or remote-code loader is included.

## Packaging and distribution

The build allowlists eleven files from `extension/`, including the MIT license, and produces one `KoBa_vVERSION.zip` plus `SHA256SUMS.txt`. The archive contains no tests, docs, Node dependencies or credentials. The optional Windows `KoBaSetup.exe` installs or updates files under `%LOCALAPPDATA%\KoBa\Extension`, using verified downloads and retained backups.

Migrating an existing unpacked extension requires a **one-time user-mediated local data transfer**: the setup wizard leaves a real directory at the original browser path (and backs up the original files), so the old KoBa extension can export browser-local settings and review recovery. The new AppData installation uses a different extension ID, imports the user-held file after explicit confirmation and records a one-time marker. No junctions, direct browser-profile editing or automatic credential upload are involved. Subsequent updates only replace AppData files.

Tests and build are in GitHub Actions; the release workflow prepares an unpublished **draft**, deliberately published only after qualification.

Update checking discovers newer published releases but **cannot install them automatically** into an unpacked Chrome/Brave extension. See [update policy](UPDATES.md) and [developer release steps](DEVELOPMENT.md).
