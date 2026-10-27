# GitHub updates and release distribution

[← Back to KoBa](../README.md) · [Install or update KoBa](../README.md#installation) · [Developer release steps](DEVELOPMENT.md)

## What KoBa supports today

KoBa's currently published v0.3.7 extension can **discover** newer releases but cannot install them. The upcoming Windows KoBaSetup updater installs verified files into AppData on request starting with v0.3.8; browser registration and Reload still require user action.

To enable discovery, open **KoBa Extension options → Updates**, set the repository to **`kurichon/koba`**, and choose **Check now** or enable the daily check. KoBa requests optional permission for `https://api.github.com/*`. Without that permission, review features still work normally.

The checker requests only metadata from `https://api.github.com/repos/kurichon/koba/releases/latest`. It sends **no** JPDB API key, vocabulary, ChatGPT content, personal GitHub token, or browser cookies to this endpoint. GitHub receives ordinary connection metadata, including your IP address and requested repository.

## Installing an available update

**Windows AppData installation (starting with v0.3.8):** Run `%LOCALAPPDATA%\KoBa\KoBaSetup.exe` and select **Install / Update KoBa**. The helper downloads the latest published KoBa ZIP and SHA-256 checksum, verifies package identity and contents, stages the replacement, and saves the previous installed files under AppData Backups. Close all Chrome/Brave processes before replacement; reopen the browser and press Reload if needed.

**One-time migration from an old unpacked folder:** Chrome and Brave associate local extension data with the unpacked extension's ID. Changing its path can change that ID. A directory junction or symlink is **not a safe data migration**. Instead, use **Prepare one-time transfer…** to install current KoBa files into a real folder at the original old path (preserving an original-folder backup). Export sensitive JPDB data from the **old extension's Options**, register the **AppData** folder with Load unpacked as a new extension, then import JSON through the **new extension's Options**. Verify before removing the old browser entry. The one-time preparation marker prevents repeating this step; future updates affect AppData alone. **Restore original folder…** undoes preparation without touching browser data. See [README migration instructions](../README.md#one-time-migration-from-a-manually-installed-koba-windows).

**Portable ZIP installations:** Download the single `KoBa_vVERSION.zip`, extract over the same previously loaded extension folder and press Reload. Do not load an extra copy just to update.

The migration JSON is a **plaintext sensitive backup** containing your JPDB API key, account cache and uncertain-grade recovery data. Never share it or upload it to GitHub/JPDB; securely delete it after verifying the new installation. KoBaSetup never reads or transfers browser profile data.

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

Starting with v0.3.8, the permanent [Prepare draft release](https://github.com/kurichon/koba/actions/workflows/release.yml) workflow qualifies the matching version and creates an **unpublished draft** with the canonical ZIP, checksum and Windows updater after Windows installer tests pass. A maintainer checks it, then publishes it as stable. A pushed tag or a draft alone will not trigger a user-facing update notice. See [DEVELOPMENT.md](DEVELOPMENT.md#release-process) for the full procedure and testing caveats.

## Automatic installation is a separate distribution model

Chrome itself cannot silently install updates from a GitHub ZIP; KoBa's optional Windows updater manages only the unpacked extension files. Browser-managed automatic updates generally require distribution through the **Chrome Web Store**, or an enterprise-managed distribution mechanism where supported. KoBa does not currently offer a Chrome Web Store listing. GitHub remains the official place for source, history, releases, and issue reporting.

Platform references: [Chrome — load an unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) · [Chrome — extension distribution](https://developer.chrome.com/docs/extensions/how-to/distribute) · [Brave — managing extensions](https://support.brave.com/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave) · [GitHub — latest release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release).
