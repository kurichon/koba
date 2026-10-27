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

### Windows (recommended)

1. Download **`KoBaSetup.exe`** from [the latest published release](https://github.com/kurichon/koba/releases/latest). This is the Windows installer/updater; `KoBa_vX.Y.Z.zip` remains the single extension-only package.
2. Run the installer. Select **Install / Update KoBa**. KoBa goes into **`%LOCALAPPDATA%\KoBa\Extension`** (the same path for all future versions); a reusable `KoBaSetup.exe` is also saved under `%LOCALAPPDATA%\KoBa`.
3. Open `chrome://extensions` or `brave://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the **Extension** folder above. This browser approval is required once for a new installation.
4. Open KoBa's extension options, add your **JPDB API key**, click **Save** and then **Test connection**. Refresh [ChatGPT](https://chatgpt.com/) and click the small `○` launcher.

When a later version is published, run the saved **`%LOCALAPPDATA%\KoBa\KoBaSetup.exe`**, close Chrome/Brave, and click **Install / Update KoBa**. The updater validates the official GitHub ZIP and its checksum and replaces only the AppData extension files; no migration is repeated. Reopen the browser and use **Reload** on KoBa's Extensions page if the new version is not yet active.

### One-time migration from an existing KoBa folder (Windows)

**Do not uninstall the old browser extension.** Its unpacked extension ID and JPDB data are associated with the original browser path.

1. Resolve any **Review status uncertain** message before closing the browser. Fully exit Chrome and Brave.
2. Run the Windows installer and choose **Migrate old installation…**. Select the *existing unpacked KoBa directory containing `manifest.json`*. The installer installs a verified current KoBa build in AppData, moves the original directory to a retained backup, and creates a Windows directory junction at its **original** path pointing to AppData.
3. Reopen Chrome/Brave. Keep the **existing extension entry** loaded from the old path. Confirm your JPDB key and settings remain and the KoBa version has updated; if needed click **Reload** on the existing entry.
4. If your browser installation behaves differently, close it and use **Undo migration…** in the setup tool. This restores the original directory from the retained backup. Do not remove the backup or your browser extension before verifying the migration.

This is a **one-time transition**. The migration marker prevents repeating it; subsequent updates operate solely on the fixed AppData folder. The old-path junction stays in place for the already-registered browser extension. It is **not** a second KoBa installation. Live browser profiles vary; automatic migration of browser storage is deliberately not attempted.

### Portable ZIP installation (other platforms / developers)

Download the single **`KoBa_vX.Y.Z.zip`** asset from [Releases](https://github.com/kurichon/koba/releases/latest), not GitHub's source-code archive. Extract it into a permanent folder, then use **Load unpacked** on that folder. Future portable updates still require replacing those files and clicking **Reload**. Keep the original folder to retain the extension identity.

The first review load may take longer for a large JPDB collection; KoBa shows progress as it checks your vocabulary.

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

To check for new versions, open **Settings → Updates**, use repository `kurichon/koba`, and select **Check now** (or opt in to daily checks). GitHub release checks are optional. **KoBa can notify you about an update; the Windows KoBaSetup updater installs verified files on request.** The browser still requires its regular extension reload. ZIP-only users update files manually.

If KoBa is missing, taking a long time to load, or shows **Review status uncertain**, start with the [troubleshooting and recovery guide](docs/USER_GUIDE.md). For bugs, use [GitHub Issues](https://github.com/kurichon/koba/issues) and include KoBa's **Copy diagnostics** output if useful—**never share your API key**.

## Privacy and project information

Your JPDB API key is saved in your browser's local extension storage and sent to JPDB only when needed for JPDB API calls. It is **not** packaged in the ZIP, committed to this repository, or sent to GitHub. KoBa does not send ChatGPT conversations to a KoBa server, and does not use the OpenAI API. Optional GitHub release checks request access to GitHub's public release API. Treat browser profiles and extension backups containing API keys as sensitive.

KoBa is an independent project and is not affiliated with or endorsed by JPDB or OpenAI.

**For contributors:** [Development and releases](docs/DEVELOPMENT.md) · [Architecture](docs/ARCHITECTURE.md) · [Changelog](CHANGELOG.md) · [Latest qualification](docs/QUALIFICATION.md)

**License:** [MIT](LICENSE) © 2026 kurichon.
