# GitHub updates and release distribution

[← Back to KoBa](../README.md) · [Install or update KoBa](../README.md#installation) · [Developer release steps](DEVELOPMENT.md)

## What KoBa supports today

KoBa's current public GitHub edition can **discover** newer releases, but it cannot silently install them. The extension is installed via **Load unpacked** and must be updated by replacing its local files and pressing **Reload**.

To enable discovery, open **KoBa Extension options → Updates**, set the repository to **`kurichon/koba`**, and choose **Check now** or enable the daily check. KoBa requests optional permission for `https://api.github.com/*`. Without that permission, review features still work normally.

The checker requests only metadata from `https://api.github.com/repos/kurichon/koba/releases/latest`. It sends **no** JPDB API key, vocabulary, ChatGPT content, personal GitHub token, or browser cookies to this endpoint. GitHub receives ordinary connection metadata, including your IP address and requested repository.

## Installing an available update

1. Open the verified GitHub release and download its **`KoBa_vVERSION.zip`** file under **Assets**. Do not use GitHub's automatically generated **Source code** archive.
2. Extract the ZIP over the **same folder** already loaded as KoBa, preserving its existing extension installation and identity.
3. Use **Reload** at `chrome://extensions` (Chrome) or `brave://extensions` (Brave); refresh ChatGPT if the injected UI did not change.

Your API key and review state belong to the browser extension's storage, not to the ZIP. Removing KoBa or loading a second copy can create a different identity with separate storage. [Step-by-step user instructions](../README.md#updating-an-existing-installation).

## Which releases qualify for a notice?

KoBa deliberately rejects untrusted, ambiguous or unavailable update metadata:

- Only a **published, non-prerelease** GitHub release is considered; drafts and preview tags are ignored.
- Its tag must contain a numerically greater Chrome-compatible version (1–4 numeric components, optional `v` prefix) than the current installation.
- Its release page and assets must belong to the configured public repository, with matching version and valid URL structure.
- At least one runtime asset must be an uploaded, nonempty `KoBa_vVERSION.zip` or compatible `JPDB_Review_Button_for_ChatGPT_vVERSION.zip`, no larger than 25 MiB.

Older KoBa/JPDB extension clients recognize the legacy asset name, so the release builder still publishes a byte-identical alias. This is intentional compatibility—not duplicate release code.

Metadata requests have a 12-second deadline and a 256 KiB response cap. Checks are deduplicated, respect GitHub rate-limit cooldowns, and reject stale responses after changing the configured repository. A failed check cannot block JPDB reviews. A notice links to GitHub's release page; KoBa **does not download, execute or verify the ZIP contents itself**. The publisher verifies ZIP bytes and hashes before release.

## How releases are produced

The current source is at [`kurichon/koba`](https://github.com/kurichon/koba). The release builder packages only allowlisted runtime files and the MIT license, produces two byte-identical ZIPs, and writes `SHA256SUMS.txt`. Pull requests and `main` pushes run source tests, controlled Chromium review scenarios and archive validation.

The permanent [Prepare draft release](https://github.com/kurichon/koba/actions/workflows/release.yml) workflow qualifies the matching version and creates an **unpublished draft**. A maintainer checks it, then publishes it as stable. A pushed tag or a draft alone will not trigger a user-facing update notice. See [DEVELOPMENT.md](DEVELOPMENT.md#release-process) for the full procedure and testing caveats.

## Automatic installation is a separate distribution model

Normal Chrome installs on Windows/macOS cannot self-update from a GitHub ZIP. Browser-managed automatic updates generally require distribution through the **Chrome Web Store**, or an enterprise-managed distribution mechanism where supported. KoBa does not currently offer a Chrome Web Store listing. GitHub remains the official place for source, history, releases, and issue reporting.

Platform references: [Chrome — load an unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) · [Chrome — extension distribution](https://developer.chrome.com/docs/extensions/how-to/distribute) · [Brave — managing extensions](https://support.brave.com/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave) · [GitHub — latest release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release).
