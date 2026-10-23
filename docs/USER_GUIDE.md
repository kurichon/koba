# KoBa user guide

[← Back to KoBa](../README.md) · [Latest download](https://github.com/kurichon/koba/releases/latest) · [Report an issue](https://github.com/kurichon/koba/issues)

KoBa keeps your existing JPDB reviews a click away while you use ChatGPT. It never automatically interrupts your work or creates new cards. For the installation steps, see the [README](../README.md#installation).

## A typical review session

1. In ChatGPT, click the small **`○`** button beside the composer.
2. KoBa displays a word from your existing JPDB review queue. Click **Reveal** (or press **Space** while the panel is focused).
3. Choose **Nothing**, **Something**, **Hard**, **Okay**, or **Easy** (keyboard **1–5**). KoBa sends that grade directly to JPDB and advances after acceptance.
4. Keep reviewing, or close with `○`, `×`, or **Esc**. A revealed but ungraded card is hidden again when you reopen it.

Only one ChatGPT tab owns the open review panel. To review in another ChatGPT tab, explicitly click its launcher; ordinary tab switching does not transfer or open the panel. Keyboard shortcuts are limited to the popup, so typing in ChatGPT stays normal.

## What appears in the queue?

KoBa follows your JPDB decks and current scheduling state. It includes due and failed vocabulary, plus learning vocabulary when JPDB reports a due time that has passed. Words written with kanji or kana are both supported.

It intentionally **does not** introduce new cards or show dedicated kanji/component cards, redundant spellings, locked, suspended, or blacklisted vocabulary. If JPDB temporarily cannot supply scheduling information needed to establish learning-card eligibility, KoBa avoids guessing.

A first-time scan can take longer because KoBa reads your decks and checks vocabulary in batches. Later sessions can use cached reviews and refresh the queue in the background. An empty queue or expired cache may still require a scan; progress is shown rather than silently waiting.

## Personalize the launcher

- **Drag:** Hold `○` and move it up or down. An ordinary click still opens and closes KoBa.
- **Precise control:** Open **Extension options → Behavior → Button vertical position** and adjust the slider.
- **Restore default:** Select **Reset to center** in the same section.

The horizontal position always follows ChatGPT's composer. Your vertical preference is saved in the browser profile and shared across ChatGPT tabs. The popup stays steady when revealing an answer; long answers may scroll within the popup on smaller displays.

## Settings and updates

Open the KoBa toolbar entry or its **Extension options** through Chrome/Brave's Extensions page.

| Section | What you can do |
| --- | --- |
| JPDB connection | Enter/save your API key, enable or disable the button, **Test connection**, **Force sync** |
| Behavior | Adjust vertical position or **Reset to center** |
| Updates | Set the public repository (`kurichon/koba`), opt in to daily checks, or **Check now** |
| Diagnostics | See loading counts and request/transition timings, refresh status, **Copy diagnostics** |

**Update discovery is not installation.** An unpacked extension cannot replace its own local files. Download the versioned extension ZIP from [GitHub Releases](https://github.com/kurichon/koba/releases/latest), extract it over your existing folder, click **Reload** in the Extensions page, and refresh ChatGPT. Avoid removing the old installation: that can separate it from the API key and saved review state.

When enabled, update checking talks to GitHub's public release API and does not send your JPDB credentials or ChatGPT conversation there.

## If something goes wrong

| Symptom | What to try |
| --- | --- |
| No `○` in ChatGPT | Confirm **Show review button in ChatGPT** is enabled; refresh `chatgpt.com`; check that KoBa is enabled and installed from the folder containing `manifest.json`. |
| No API key / connection rejected | Open Extension options, check the key field, click **Save** and **Test connection**. A second separately installed copy won't necessarily share the original key. |
| Long **Loading reviews…** | Watch the deck/eligibility counters. A large first scan can be slow. In Settings use **Test connection** and **Refresh diagnostics**; do not repeatedly reinstall or clear storage. |
| Delays between cards | Cached cards should advance after accepted grades. **Diagnostics** shows grade-response time, card-advance time, and background refresh time. Network issues and genuinely empty queues can still take longer. |
| Button shifted or popup jumps | Confirm you're using the latest version and reload ChatGPT. Use **Reset to center** for button placement; keep the same installation during upgrades. |
| No cards available | KoBa shows only existing eligible reviews; check JPDB itself for scheduling and deck contents. |
| New version detected | Follow the manual upgrade steps in the README. Don't install an additional copy alongside the old one. |

### A review result is uncertain

If the network connection ends after you submit a grade, KoBa may not know whether JPDB accepted it. **Do not repeatedly press the grade or assume the review failed.** KoBa avoids automatically resending such submissions.

- **Check review status** performs a read-only lookup. If JPDB reports a changed schedule or card state, KoBa can reconcile it; that does not prove which exact grade JPDB received.
- **Continue without resending** holds the unresolved card aside and lets you review other cards. It does **not** claim that the uncertain answer was successfully saved.

This hold survives extension-worker restarts and reloads. If a card remains unresolved, inspect the card in JPDB rather than forcing repeat submissions.

### Reporting an issue

Use [KoBa Issues](https://github.com/kurichon/koba/issues) and include the installed version, Chrome/Brave version, what you clicked, what appeared, and (optionally) **Copy diagnostics** from Extension options. Diagnostics are designed to omit API keys, vocabulary text, and JPDB response bodies; review what you paste anyway. Never paste an API key or a full browser profile.

## Privacy and limitations

- KoBa makes JPDB API requests directly from its extension background worker, using your locally saved JPDB API key. There is no KoBa cloud backend, no OpenAI API call, no analytics/telemetry endpoint, and no automatic study timer.
- Local browser storage also holds cached review data and safe recovery markers. It is **not a password vault**: protect access to your browser profile and its backups.
- The extension runs in ChatGPT to display the launcher; it does not need to transmit the text of your ChatGPT conversation to JPDB or GitHub.
- GitHub permissions are optional and only used for release checks when enabled.
- Browser-supported automatic installation would require a separately distributed store edition. This GitHub edition is installed as **Load unpacked**.

KoBa is independent and not endorsed by JPDB or OpenAI. [Source and MIT license →](../README.md#privacy-and-project-information)
