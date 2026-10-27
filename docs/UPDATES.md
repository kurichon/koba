# GitHub updates and release distribution

[← Back to KoBa](../README.md) · [Install or update KoBa](../README.md#installation) · [Developer release steps](DEVELOPMENT.md)

## What KoBa supports today

KoBa's current public GitHub edition can **discover** newer releases, but it cannot silently install them. The extension is installed via **Load unpacked** and must be updated by replacing its local files and pressing **Reload**.

To enable discovery, open **KoBa Extension options → Updates**, set the repository to **`kurichon/koba`**, and choose **Check now** or enable the daily check. KoBa requests optional permission for `https://api.github.com/*`. Without that permission, review features still work normally.

The checker requests only metadata from `https://api.github.com/repos/kurichon/koba/releases/latest`. It sends **no** JPDB API key, vocabulary, ChatGPT content, personal GitHub token, or browser cookies to this endpoint. GitHub receives ordinary connection metadata, including your IP address and requested repository.

## Installing an available update

**Windows managed folder:** Run `%LOCALAPPDATA%\KoBa\KoBaSetup.exe` and select **Install / Update KoBa**. The helper downloads the latest public KoBa ZIP and checksum, verifies expected filenames/version/digest and archive contents, stages the replacement, and saves the previous extension under AppData Backups before swapping the directory. Fully close Chrome/Brave before replacement, then reopen and reload KoBa if necessary.

**One-time legacy-folder migration:** If KoBa is already registered from another folder, use the installer’s **Migrate old installation…** exactly once. The original folder is moved to a retained backup and replaced by a directory junction pointing to the fixed AppData extension folder. Keep the **old Chrome/Brave extension entry**, and verify the stored JPDB key after restarting. **Undo migration…** restores the old directory if identity or settings differ. A saved migration marker prevents repeating this step during future updates. See [README installation](../README.md#installation).

**Portable ZIP users:** Download the single `KoBa_vVERSION.zip`, extract over the same installed folder, and use Reload in `chrome://extensions` or `brave://extensions`. Do not load a second extension copy just to update.

The Windows installer never reads, exports or overwrites the browser’s JPDB credentials, and it does not edit Chrome/Brave profile databases. Browser-managed automatic installation remains unavailable to unpacked extensions. Browser closure/reload is required by this distribution approach.

## Which releases qualify for a notice?

KoBa deliberately rejects untrusted, ambiguous or unavailable update metadata:

- Only a **published, non-prerelease** GitHub release is considered; drafts and preview tags are ignored.
- Its tag must contain a numerically greater Chrome-compatible version (1–4 numeric components, optional `v` prefix) than the current installation.
- Its release page and assets must belong to the configured public repository, with matching version and valid URL structure.
- The runtime asset must be an uploaded, nonempty `KoBa_vVERSION.zip`, no larger than 25 MiB.

Only the KoBa package name is supported. Pre-rebrand update discovery and installation compatibility are retired. Unsupported cached update notices are discarded and revalidated; current settings and review data remain intact.

Metadata requests have a 12-second deadline and a 256 KiB response cap. Checks are deduplicated, respect GitHub rate-limit cooldowns, and reject stale responses after changing the configured repository. A failed check cannot block JPDB reviews. A notice links to GitHub's release page; KoBa **does not download, execute or verify the ZIP contents itself**. The publisher verifies ZIP bytes and hashes before release.

## How releases are produced

The current source is at [`kurichon/koba`](https://github.com/kurichon/koba). The release builder packages only allowlisted runtime files and the MIT license, produces one canonical `KoBa_vVERSION.zip` and its `SHA256SUMS.txt`. Windows releases additionally ship a purpose-built `KoBaSetup.exe` updater—not a second extension ZIP. Pull requests and `main` pushes run source tests, controlled Chromium review scenarios and archive validation.

The permanent [Prepare draft release](https://github.com/kurichon/koba/actions/workflows/release.yml) workflow qualifies the matching version and creates an **unpublished draft** with the canonical ZIP, checksum and Windows updater after Windows installer tests pass. A maintainer checks it, then publishes it as stable. A pushed tag or a draft alone will not trigger a user-facing update notice. See [DEVELOPMENT.md](DEVELOPMENT.md#release-process) for the full procedure and testing caveats.

## Automatic installation is a separate distribution model

Chrome itself cannot silently install updates from a GitHub ZIP; KoBa's optional Windows updater manages only the unpacked extension files. Browser-managed automatic updates generally require distribution through the **Chrome Web Store**, or an enterprise-managed distribution mechanism where supported. KoBa does not currently offer a Chrome Web Store listing. GitHub remains the official place for source, history, releases, and issue reporting.

Platform references: [Chrome — load an unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) · [Chrome — extension distribution](https://developer.chrome.com/docs/extensions/how-to/distribute) · [Brave — managing extensions](https://support.brave.com/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave) · [GitHub — latest release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release).
