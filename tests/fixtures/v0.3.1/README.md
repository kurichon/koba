# JPDB Review Button for ChatGPT v0.3.1

A manual-first Brave/Chromium extension for reviewing existing JPDB vocabulary while using ChatGPT.

## What changed in v0.3.1

The ambient timer/automatic interruption model has been removed.

- A small neutral `○` launcher sits beside the **left edge of the ChatGPT conversation/composer column**, around the middle of the viewport.
- Nothing opens automatically.
- Click the launcher when you have time to review.
- The popup stays open and **automatically advances to the next review after every 1–5 grade**.
- Continue as long as you want.
- Click the launcher again, click `×`, or press `Esc` to close the popup.
- Closing a revealed-but-ungraded card resets it to the front next time so the answer is not left exposed.
- Only one review popup is open across ChatGPT tabs. Clicking the launcher in another tab moves the shared review session there. Merely changing tabs does not move/open anything.

This removes the previous automatic ownership-transfer machinery and the races caused by fast tab switching. The background still owns one shared JPDB review session and queue, so reviews made in one tab are immediately authoritative everywhere.

## Review scope

Included:
- due vocabulary
- failed vocabulary when reviewable
- learning vocabulary only when JPDB reports `due_at` as reached
- vocabulary written with kanji or kana as JPDB stores it

Excluded:
- new cards
- dedicated kanji/component learning cards
- redundant spelling variants
- locked cards
- suspended / blacklisted cards

## Keyboard

While the popup has focus:

- `Space` — reveal
- `1` — Nothing
- `2` — Something
- `3` — Hard
- `4` — Okay
- `5` — Easy
- `Esc` — close popup

Keyboard shortcuts are scoped to the popup, so normal ChatGPT typing is unaffected.

## Install / update in Brave

1. Extract this ZIP over the existing unpacked extension folder (or use a new folder).
2. Open `brave://extensions`.
3. Enable Developer mode if necessary.
4. If updating the existing folder, press **Reload** on the extension. If using a new folder, choose **Load unpacked**.
5. Reload currently open ChatGPT tabs once for the cleanest transition from v0.2.x.

Your API key remains in extension storage when updating the same installed extension/folder identity.

## Privacy / architecture

- No backend server.
- No OpenAI API calls.
- JPDB API key remains in `chrome.storage.local`.
- The key is never inserted into ChatGPT's page DOM.
- JPDB remains responsible for SRS updates.


## v0.3.1 interaction fix

- Removed the full-viewport pointer-events-none shadow host; the host is now zero-sized and only visible controls participate in hit testing.
- Added explicit event isolation for review buttons.
- Reveal responds optimistically, then reconciles with shared session state.
- Review submission shows `Saving…` immediately so a network round-trip never looks like a dead click.
- Errors re-sync the shared session instead of leaving the popup in a half-updated state.
