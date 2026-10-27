# KoBa — Kotoba no Soba (ことばのそば)

**ことば、そばに。 — A little Japanese, always close by.**

Review your existing [JPDB](https://jpdb.io/) Japanese vocabulary while using ChatGPT—one card at a time, only when you choose.

[**Download the latest version**](https://github.com/kurichon/koba/releases/latest) · [Getting started](#installation) · [Using KoBa](#how-to-use) · [Help & troubleshooting](docs/USER_GUIDE.md)

[![GitHub release](https://img.shields.io/github/v/release/kurichon/koba?label=Latest%20release)](https://github.com/kurichon/koba/releases/latest) [![MIT License](https://img.shields.io/github/license/kurichon/koba)](LICENSE)

KoBa is a free, open-source browser extension for **desktop Chrome and Brave**. It opens a small review panel beside ChatGPT, talks directly to your JPDB account, and stays out of the way when you are working. There are no automatic study interruptions, no audio, and no separate server to set up.

> **Before you start:** You need a JPDB account and its API key. KoBa currently installs as an **unpacked extension** from GitHub, not from the Chrome Web Store.

## What KoBa does

- **Review on demand.** Click the small `○` button in ChatGPT to reveal and grade vocabulary. Close it whenever you want.
- **Stay in your workflow.** Reviews advance card-by-card; nothing appears automatically. Keyboard shortcuts work only inside the review panel.
- **Choose your position.** Drag the button up or down, or use the slider in KoBa settings. Its horizontal position remains anchored beside ChatGPT's composer.
- **Keep your progress safe.** KoBa works with JPDB's existing review schedule and avoids automatically resending a grade when its outcome is uncertain.
- **Resume across tabs.** Your review queue is shared between ChatGPT tabs; simply changing tabs does not open a panel.

## Installation

### Windows installer and updater (planned for v0.3.8)

KoBa v0.3.7 is the current published stable extension-only release. Starting with the qualified v0.3.8 release, Windows builds will also provide **KoBaSetup.exe**, a separate installer/updater. Until that is published, use the [current ZIP](https://github.com/kurichon/koba/releases/latest) and follow the portable steps below.

1. Download **KoBaSetup.exe** from the new release Assets and run it. Select **Install / Update KoBa**. The installed browser extension files live permanently under **`%LOCALAPPDATA%\KoBa\Extension`**. A reusable `KoBaSetup.exe` is also saved under `%LOCALAPPDATA%\KoBa`.
2. In Chrome or Brave open `chrome://extensions` or `brave://extensions`, enable Developer mode, click **Load unpacked**, and select the AppData **Extension** folder. Browser approval is required for a first-time installation.
3. Open KoBa Options, add your JPDB API key, Save and Test connection. Open or refresh [ChatGPT](https://chatgpt.com/) and click KoBa's `○` launcher.
4. For future updates, close Chrome and Brave (resolve any uncertain JPDB review first), run the saved **`%LOCALAPPDATA%\KoBa\KoBaSetup.exe`**, and select **Install / Update KoBa**. Restart the browser and reload KoBa if necessary. No migration or folder selection repeats.

### One-time migration from a manually installed KoBa (Windows)

Changing the unpacked installation folder **changes the extension ID** in Chromium. Merely moving the folder or creating a junction can detach the existing browser-local API key and review state. The migration therefore transfers browser-local data **explicitly**. Never delete the old installation until the new one is verified.

1. In the old KoBa extension, resolve any active **Saving…** or **Review status uncertain** item as appropriate. Fully close Chrome and Brave. Run **KoBaSetup.exe**, select **Prepare one-time transfer…**, and choose the **old KoBa folder with `manifest.json`**. Setup retains a copy of the original folder, installs current KoBa files into the **same real old directory path** (so the existing browser entry can export its data), and also installs KoBa in AppData.
2. Reopen the browser, open **Options on the OLD KoBa extension entry** and choose **Export migration file**. The downloaded `KoBa_Migration_*.json` contains your **JPDB API key, review recovery journal, and browser-local preferences**. **Keep it private. Do not upload or share it.**
3. In the same browser profile, use **Load unpacked** to register **`%LOCALAPPDATA%\KoBa\Extension`** as a **new** KoBa installation. Open Options on this **new AppData extension** (not the old entry). Select the JSON and choose **Import into new KoBa**. Import refuses existing configured JPDB data and verifies the transfer. The action is marked as completed so it cannot run again.
4. Verify the JPDB key, button position, review recovery state and normal operation in the new installation. **Only then** remove the old extension entry. Delete the sensitive migration JSON securely after verification. Leave the original folder backup intact until satisfied.
5. If the old extension fails before transfer, fully close the browser and select **Restore original folder…** in setup. The original files are restored from backup. Setup never modifies Chrome or Brave profile files.

**The Windows folder-preparation workflow runs at most once.** Later releases are normal AppData-only updates; they do not migrate browser data again.

### Portable ZIP installation (Chrome, Brave and other supported platforms)

Download the single **`KoBa_vX.Y.Z.zip`** from [GitHub Releases](https://github.com/kurichon/koba/releases/latest), not the auto-generated source archive. Extract into a permanent directory containing `manifest.json` and select that directory through **Load unpacked**. Update it by replacing its files **in the same folder** and clicking **Reload**. Never load another copy merely to update.

The first vocabulary scan can be slower for a large JPDB deck. KoBa displays progress while identifying reviewable words.

## How to use

Click `○` to open the review panel. Choose **Reveal**, then rate the word. KoBa moves to the next available card after JPDB accepts the grade. Click `×`, `○`, or press **Esc** to close the panel.

| Shortcut | When the review panel has focus |
| --- | --- |
| **Space** | Reveal the current answer |
| **1** | Nothing |
| **2** | Something |
| **3** | Hard |
| **4** | Okay |
| **5** | Easy |
| **Esc** | Close the panel |

Shortcuts do not override ordinary typing in ChatGPT. If you close a revealed but ungraded card, its answer is hidden the next time you open it.

**Move the button:** Drag `○` vertically to your preferred height. Or open **KoBa Settings → Behavior → Button vertical position** and use **Reset to center** to return to the original position. Horizontal alignment stays attached to ChatGPT's composer.

**Across tabs:** Click KoBa in another ChatGPT tab to move the shared review panel there. Switching tabs alone does not open or transfer it.

KoBa reviews **due, failed, and eligible learning vocabulary** already in your JPDB decks. It does not introduce new vocabulary or dedicated kanji/component-learning cards. [More about card eligibility and review recovery →](docs/USER_GUIDE.md)

## Settings, updates, and troubleshooting

In KoBa's extension options you can enable/disable the button, manage your JPDB API key, check the connection, adjust button position, request a fresh sync, and view diagnostics.

To check for new versions, open **Settings → Updates**, use repository `kurichon/koba`, and select **Check now** (or opt in to daily checks). GitHub release checks are optional. **KoBa can notify you about updates.** Starting with v0.3.8, the optional Windows KoBaSetup updater can install verified new files on request; browsers still require Reload. ZIP-only users replace their extension files manually.

If KoBa is missing, taking a long time to load, or shows **Review status uncertain**, start with the [troubleshooting and recovery guide](docs/USER_GUIDE.md). For bugs, use [GitHub Issues](https://github.com/kurichon/koba/issues) and include KoBa's **Copy diagnostics** output if useful—**never share your API key**.

## Privacy and project information

Your JPDB API key is saved in your browser's local extension storage and sent to JPDB only when needed for JPDB API calls. It is **not** packaged in the ZIP, committed to this repository, or sent to GitHub. KoBa does not send ChatGPT conversations to a KoBa server, and does not use the OpenAI API. Optional GitHub release checks request access to GitHub's public release API. Treat browser profiles and extension backups containing API keys as sensitive.

KoBa is an independent project and is not affiliated with or endorsed by JPDB or OpenAI.

**For contributors:** [Development and releases](docs/DEVELOPMENT.md) · [Architecture](docs/ARCHITECTURE.md) · [Changelog](CHANGELOG.md) · [Latest qualification](docs/QUALIFICATION.md)

**License:** [MIT](LICENSE) © 2026 kurichon.
