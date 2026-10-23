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

### First-time setup

1. Open **[KoBa Releases](https://github.com/kurichon/koba/releases/latest)** and expand **Assets**. Download `KoBa_vX.Y.Z.zip` (the versioned extension ZIP), **not** GitHub's “Source code” archive.
2. Extract the ZIP into a folder you can keep. Check that **`manifest.json` is directly inside** the folder you will select—do not point your browser at the ZIP or the entire source repository.
3. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave. Switch on **Developer mode**, choose **Load unpacked**, and select the extracted folder.
4. Open **KoBa's extension options** (from its toolbar entry or **Details → Extension options**). Enter your **JPDB API key**, click **Save**, then **Test connection**. Your key is not provided with the download.
5. Open or refresh [ChatGPT](https://chatgpt.com/). Look for the small `○` button beside the conversation composer, and click it to begin.

The first load may take longer for a large JPDB collection while KoBa checks which vocabulary is currently reviewable. The panel displays progress while it loads.

### Updating an existing installation

1. Download the newer `KoBa_vX.Y.Z.zip` from [Releases](https://github.com/kurichon/koba/releases/latest).
2. Extract **over the same folder** already loaded as KoBa, replacing the previous extension files.
3. Find KoBa at `chrome://extensions` or `brave://extensions` and click **Reload**. Refresh an already-open ChatGPT tab if needed.

**Do not uninstall KoBa or load a second copy just to update it.** Keeping the same extension installation and folder preserves its browser-local API key, settings, and review state. A new installation can have a different extension identity and separate storage.

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

To check for new versions, open **Settings → Updates**, use repository `kurichon/koba`, and select **Check now** (or opt in to daily checks). GitHub release checks are optional. **KoBa can notify you about an update, but unpacked extensions do not install it automatically**—follow the update steps above.

If KoBa is missing, taking a long time to load, or shows **Review status uncertain**, start with the [troubleshooting and recovery guide](docs/USER_GUIDE.md). For bugs, use [GitHub Issues](https://github.com/kurichon/koba/issues) and include KoBa's **Copy diagnostics** output if useful—**never share your API key**.

## Privacy and project information

Your JPDB API key is saved in your browser's local extension storage and sent to JPDB only when needed for JPDB API calls. It is **not** packaged in the ZIP, committed to this repository, or sent to GitHub. KoBa does not send ChatGPT conversations to a KoBa server, and does not use the OpenAI API. Optional GitHub release checks request access to GitHub's public release API. Treat browser profiles and extension backups containing API keys as sensitive.

KoBa is an independent project and is not affiliated with or endorsed by JPDB or OpenAI.

**For contributors:** [Development and releases](docs/DEVELOPMENT.md) · [Architecture](docs/ARCHITECTURE.md) · [Changelog](CHANGELOG.md) · [Latest qualification](docs/QUALIFICATION.md)

**License:** [MIT](LICENSE) © 2026 kurichon.
