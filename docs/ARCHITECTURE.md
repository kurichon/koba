# Architecture and repair scope

## Accepted scope

This repair starts from the recovered v0.3.1 extension. It keeps the manual neutral
launcher, continuous vocabulary review, one shared session, one visible owner,
popup-scoped shortcuts, and existing vocabulary eligibility policy. The user
authorized Qualification & Repair and added a foundation for future GitHub updates.

The distribution scope includes configurable release discovery, local packaging,
and automation for the public `kurichon/koba` repository. Public release/store publication
requires separate verification. The unpacked extension
does not have a supported self-install mechanism on normal Windows Chrome.

## Responsibilities

| Component | Responsibility |
| --- | --- |
| `content.js` | Immediate popup UI, local input intent, focus, positioning, verified update link |
| `background.js` | JPDB requests, authoritative shared state, ownership, queue, submission journal, reinjection |
| `session.js` | Normalize shared state and validate card/revision actions |
| `panel.js` | Explicit open/close intents, recipient ownership, duplicate intent handling |
| `lib.js` | Vocabulary eligibility, sorting, due timestamps, authoritative change checks |
| `updates.js` | GitHub release metadata, optional access, scheduling, validation, cooldowns |
| `options.js` / `options.html` | Local settings, connection/sync controls, update configuration, diagnostics |
| `scripts/build-release.mjs` | Validate and package runtime bytes; emit checksum |

The review mutation queue serializes short state/storage changes. Network work
runs outside it and applies its result only if the account generation and job
are still current. Update checking has its own independent operation state.

## Ownership and UI

An opening or closing request carries a unique content-instance intent ID. The
background records explicit desired state and returns a snapshot specific to the
requesting tab, with a panel revision. Broadcasts close the former owner. The UI
also tracks its latest local action, so delayed replies cannot reopen a dismissed
popup. Loading/saving state does not disable dismissal.

The popup opens locally before waiting for a message. Reveal is optimistic; one
rapid grade waits for the reveal handshake, then uses the current card and revision.
The background validates owner, card, revision, reveal state, and pending journal
before accepting the action. Grades are disabled during loading/errors/recovery.

## Review writes and recovery

1. Validate the action in the serialized mutation queue.
2. Persist a unique pending attempt, card, grade, and revision to local storage.
   If that write fails, send no review POST.
3. Issue one bounded `/review` request. There is no automatic grade retry.
4. On HTTP acceptance, persist the accepted receipt and removal from the queue
   in one local-storage update before selecting the next card or refreshing data.
5. On timeout, network interruption, or ambiguous response, retain an uncertain
   attempt. A surviving pending attempt after worker restart is also uncertain.
6. Reconcile only through reads. Continue-without-resending persists a quarantine
   before progressing. A later authoritative state/schedule change can release it.

This is duplicate-write prevention in the client, not a claim of exactly-once
remote effects. No server idempotency key or review-history API was assumed.
An observed schedule/state change does not prove the exact submitted grade.

## Persistence and bounds

| State | Storage and bound |
| --- | --- |
| API key and enabled setting | Existing `chrome.storage.local` keys, preserved during same-identity upgrade |
| Queue | Local cache scoped to SHA-256 fingerprint of API key; up to 1,000 cached cards |
| Recent accepted reviews | Bounded cache of 64 card IDs/states/due times; prevents eventual-consistency lookups from returning a just-graded card until JPDB confirms a change |
| Vocabulary IDs | Local cache, same account scope; 12-hour freshness |
| Review state freshness | 2 minutes; revalidated when stale |
| Active review / quarantines | Local journal keyed by account fingerprint; at most 32 quarantined attempts |
| Open popup/current card | Session storage; revisions and account scope |
| Diagnostic events | Session storage; up to 50 recent events per log |
| Release metadata/preferences | Local storage; no GitHub token |

The fingerprint scopes data; it is not encryption or a replacement for API-key
privacy. Account changes abort active work or discard its late results. Old
unscoped v0.3.1 caches are deliberately refreshed once rather than reused across
an unknown account association.

Reads have an 8-second per-attempt deadline and at most one transient retry. Grade
writes have a 12-second deadline and no retry. A cold scan can contain many bounded
requests, so total sync time depends on collection size and network. The UI reports
ongoing work without tying up ownership controls or the settings message channel.
Explicit force sync replaces an overlapping ordinary scan if necessary to refresh
the deck/vocabulary list. Late results from superseded scans are rejected.

### v0.3.5 active-session queue refresh

When a cached card is available, opening, revealing, or grading can trigger a
**non-blocking warm refresh** of the known vocabulary IDs before the two-minute
state cache expires (or when a low queue is at least 20 seconds old). The warm
scan uses the same 400-entry sequential requests and 350-ms pacing as a normal
scan, never parallel bursts. A one-minute start cooldown bounds extra requests.
Its progress does **not** change the session revision or disable grading.
The current UI card stays in place unless JPDB's completed authoritative
snapshot materially changes it. Closing the popup cancels an unpromoted warm
refresh; account change and full sync cancel it regardless.

If the queue empties during a warm refresh, the already-running request becomes
the visible foreground refill rather than starting another duplicate scan.
Warm-scan failures are recorded in sanitized diagnostics without interrupting
remaining cached reviews. A promoted scan reports its errors normally.
Accepted card markers survive worker restarts; an unchanged/stale post-grade
lookup cannot put a graded card back into the queue. This does not imply
exactly-once server processing and never resends ambiguous grades.

Warm refresh reduces **interaction downtime**, not the number of necessary
JPDB requests over a long session. A first cold load and truly empty review
queue may still require a complete scan.

## Release discovery and distribution

The GitHub checker is disabled until a repository and optional API access are
configured. It reads only the latest published stable release metadata, validates
version/tag/repository/asset identity, and displays a release-page link. It never
downloads or executes remote code. Checks have independent deadlines, bounded
metadata, concurrency control, and rate-limit cooldowns.

The KoBa v0.3.3 release builder includes ten explicitly allowlisted runtime files (nine executable/HTML runtime files and LICENSE), verifies
the ZIP contents, and writes SHA-256. GitHub CI qualifies changes; matching tags
can create an unpublished draft with checked assets. The owner publishes only
after review. Browser-managed automatic installation is a separate future store
distribution step, with a plan needed for the existing unpacked identity.

See [updates](UPDATES.md) for the operational procedure and official platform
references, and [qualification](QUALIFICATION.md) for evidence and remaining gates.
