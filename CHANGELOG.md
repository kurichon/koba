# Changelog

## 0.3.4 — 2026-10-23

- Display live first-scan progress across deck enumeration and batched review eligibility checks, rather than leaving the popup indefinitely on a generic loading message.
- Carry progress through existing background/session messages and surface it in settings and sanitized diagnostics.
- Clear stale progress on completion, error, and extension-worker restart; preserve card eligibility rules and review submission safeguards.
- Add controlled large-deck tests and a Chromium fixture for a delayed second lookup batch.
- First-time scan still needs to read the account's vocabulary; this update improves observability, not a guaranteed cold-sync speedup. Live JPDB account validation remains necessary.

## 0.3.3 — 2026-10-23

- Adopt **KoBa** as the public product name, from *Kotoba no Soba* (ことばのそば),
  with tagline **ことば、そばに。**
- License the code under MIT; include the notice in the runtime ZIP.
- Package `KoBa_vVERSION.zip` plus a byte-identical legacy-named ZIP for updates
  from v0.3.2 without breaking its strict release-asset expectation.
- Adjust the update validator for both names with the same strict URL checks.
- Plan one public `kurichon/koba` source-and-releases repository; no publication yet.
- No changes to review timing, grade handling, card filtering, or permission scope.


## 0.3.2 — 2026-10-23

### Reliability and interaction

- Separate immediate popup ownership from API work; reject stale opening results.
- Persist pending submissions before POST, and accepted receipts before refresh.
- Never automatically retry a grade; add read-only reconciliation and durable
  quarantine for unknown outcomes.
- Persist fresh queues across worker restarts, scope them to API-key fingerprints,
  discard old-account responses, and bound request durations/retries.
- Keep learning-card eligibility through transient errors; only use the `due_at`
  compatibility fallback for an explicit unsupported-field response.
- Restore composer focus, buffer one rapid grade behind reveal, reset ungraded
  answers on close, and rebind after composer replacement.
- Reinjection checks content version and retires old listeners and observers.
- Acknowledge force sync promptly, honor full vocabulary refresh during overlapping
  scans, report errors honestly, and provide sanitized diagnostic export.

### Update distribution foundation

- Add optional public GitHub release checks, opt-in daily scheduling, manual checks,
  and verified release links.
- Validate stable numeric versions, same-repository/tag URLs, and runtime ZIP
  metadata; enforce deadlines, size bounds, and rate-limit cooldowns.
- Keep release checking independent of reviews and omit JPDB credentials from GitHub traffic.
- Add runtime ZIP/checksum generation and GitHub CI/draft-release workflows.
- Document manual unpacked updates and the separate Chrome Web Store route for
  future browser-managed automatic installation.

Publishing the repository and its first release is a separate deployment step.

## 0.3.1 — recovered baseline

Manual launcher, shared review session, popup-local shortcuts, and zero-sized shadow
host. The recovered package is the starting point for this repair; the identified
responsiveness and ownership defects are recorded in the qualification evidence.
