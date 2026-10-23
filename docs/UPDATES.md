# Updates and GitHub releases

## What this version does

Version 0.3.3 can check a configured public GitHub repository for a newer published extension release. It shows a release link in settings and a quiet notice beside the review controls. Checks run at most once a day automatically, with a **Check now** button for an explicit check. They never open the review popup or interrupt a review.

This is automatic **update detection**. An extension loaded with **Load unpacked** still needs its files replaced and the extension reloaded by the user. This extension does not download, execute, or install code from GitHub.

For normal Chrome installations on Windows and macOS, Chrome Web Store distribution is the route to browser-managed installation of future updates. Adding a GitHub ZIP URL to `manifest.json` does not provide that behavior. Chrome documents separate self-hosted CRX distribution for Linux and enterprise-managed environments; those are outside this personal extension's current distribution plan. See [Chrome distribution options](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions), [Linux self-hosting](https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux), and [Chrome Web Store publishing](https://developer.chrome.com/docs/webstore/publish).

The public source and release repository is [kurichon/koba](https://github.com/kurichon/koba).
A GitHub tag or draft is not a published stable release; manually publish a verified draft before expecting update notices.

## Configure release checks

1. Open **KoBa settings** from the browser's extension toolbar.
2. In **Updates**, use the suggested `kurichon/koba` repository, or enter another public `owner/repository` name. A canonical `https://github.com/owner/repository` URL also works.
3. Select **Automatically check once a day** and click **Save update settings**, or leave automatic checking off and use **Check now** when needed.
4. Allow the browser's optional access request for `api.github.com`. Permission is requested only from these settings buttons. If access is declined or removed, settings show how to enable it again.

The repository name is suggested in the settings UI but is not enabled automatically. Until a repository is saved and GitHub access is granted, the checker makes no GitHub requests. Automatic checks additionally require the checkbox to be enabled. Browser shutdown, sleep, and service worker scheduling can delay a daily check; it is not a promise of an exact time.

Only public release metadata is supported. A private source repository can be used for development, but this checker would then need a separate public repository containing the distributed release assets. The extension intentionally has no GitHub token field and embeds no personal access token. A private repository, a nonexistent repository, and a repository without a public stable release can all produce the same unavailable response. The UI does not claim to distinguish them.

The request goes to `https://api.github.com/repos/OWNER/REPOSITORY/releases/latest`. It sends no JPDB API key, review vocabulary, ChatGPT text, GitHub credentials, or cookies. GitHub receives normal connection metadata such as the user's IP address and the configured repository path. The checker stores only bounded release metadata and check status locally. There is no telemetry endpoint. See [GitHub's release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) and [Chrome's optional permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions).

## Install an unpacked update

1. Open the displayed release and download its **`KoBa_vVERSION.zip`** asset. GitHub's automatically generated source archives are development snapshots, not the runtime package.
2. If desired, compare the downloaded ZIP's SHA-256 value with `SHA256SUMS.txt` on that release. This checks file integrity; the repository owner remains the publisher you are trusting.
3. Close any open JPDB review popup, then extract the runtime files into the **same directory** currently loaded by Chrome or Brave. `manifest.json` should be directly inside that directory.
4. Open `chrome://extensions` or `brave://extensions` and click **Reload** for the existing KoBa installation. Refresh any open ChatGPT tab that asks to be refreshed.
5. Verify the installed version in extension settings and try one review.

Keep the existing installation and folder path to preserve its identity, settings, and locally stored API key. Removing the extension, loading a different folder, or moving to a new store installation can create a different identity or clear its storage. The current build does not migrate data between extension identities. Changing the displayed name from the former JPDB Review Button to KoBa does not change the identity when reloading the same unpacked extension in the same folder. If a later store migration needs the API key again, re-enter it locally from JPDB; do not put keys in the repository, release assets, or issue reports.

## How a release qualifies for a notice

The checker uses GitHub's latest published release metadata, then validates the result independently. A notice requires all of the following:

- A published release with `draft: false` and `prerelease: false`.
- A version tag containing one to four numeric Chrome version components, optionally prefixed by `v`. Each component is in the Chrome-supported range, and the complete version must be greater than the installed version. Tags such as `v0.3.3-beta` are excluded.
- A canonical HTTPS release page on `github.com` for the configured repository and tag.
- An uploaded, nonempty runtime asset named exactly `KoBa_vVERSION.zip` or the compatibility alias `JPDB_Review_Button_for_ChatGPT_vVERSION.zip`, with a matching same-repository GitHub download URL and a size no larger than 25 MiB.

Release titles and descriptions are not rendered inside the extension. The checker does not fetch the ZIP or verify its contents; those are built and checked by the release workflow and then reviewed by the publisher. The link opens the release page so the user can inspect the release and its assets.

Metadata requests have a 12-second deadline and a 256 KiB response limit. Concurrent checks share one request. Rate-limit cooldowns apply to manual checks too. Changing the repository while a check is running prevents an old result from being saved under the new source. A worker restart cannot leave the settings page permanently stuck on **Checking**. Temporary failures retain only the previously validated release from that same repository, while displaying the failed check honestly. Update failures do not enter the JPDB review request path.

## Build the installable package

Use Node.js 22 or newer and Python 3. The ZIP builder itself uses only standard libraries; Playwright is a development dependency for browser qualification. If Python is named differently on your system, set `JPDB_PYTHON` to its executable path.

From the project root:

```sh
npm ci
npm test
npx playwright install --with-deps chromium
npm run test:browser
npm run build
```

On Linux without a display, run the browser step with `xvfb-run -a npm run test:browser`. The browser test uses isolated fixtures and the bundled Playwright Chromium. `JPDB_TEST_EXECUTABLE` can explicitly select a local browser executable; `JPDB_TEST_EXTENSION` can select an extracted release for verification.

The build creates two byte-identical ZIP files (to bridge older update clients):

- `dist/KoBa_vVERSION.zip`
- `dist/JPDB_Review_Button_for_ChatGPT_vVERSION.zip` (identical legacy-named alias)
- `dist/SHA256SUMS.txt`

Each ZIP contains only the explicitly reviewed runtime files and the MIT license notice, with `manifest.json` at its root. Documentation, tests, dependency directories, browser profiles, and user configuration are excluded. The builder requires the package and manifest versions to match, rejects symlink entries, validates manifest file references against the runtime allowlist, and reopens the ZIP to check every member's bytes. File timestamps and ordering are fixed so builds from identical runtime bytes with the same ZIP implementation are reproducible.

## Publish from GitHub

The public source repository is `kurichon/koba`. Verify CI passes on the default branch before preparing a draft release.

The CI workflow runs on pull requests, updates to `main` or `master`, and manual dispatch. It installs locked dependencies, runs the state/update tests, exercises the extension in Chromium, and validates the runtime package. The release workflow runs when a `v*` tag is pushed **or** through Actions → Prepare draft release → Run workflow. For the manual action, enter the matching tag (for example `v0.3.3`); the workflow creates the tag **only after** qualification succeeds. Both routes require the tag to match the manifest version exactly and prepare a **draft** release containing the runtime ZIP and checksum file.

For each future release:

1. Make the intended changes and update both `extension/manifest.json` and `package.json` to the same greater numeric version. Refresh the package lock if needed and record the release notes.
2. Run the tests and build locally; review the resulting package. Commit the release candidate to the intended repository branch.
3. Push a version tag such as `v0.3.3`, **or** run the draft-release workflow manually from the GitHub Actions tab with that exact tag. The manual workflow creates the tag on the qualified commit after tests pass.
4. Wait for qualification to pass. Inspect the generated draft, release notes, runtime ZIP, and checksum. An existing release is not silently replaced on a workflow rerun.
5. Publish the draft as a stable release and make it the intended latest release. Only then can configured extensions discover it. A tag alone or a draft does not activate the notice.

The workflow publishes both asset filenames so the legacy v0.3.2 checker can discover KoBa updates. The workflow uses GitHub's per-run token solely on the hosted runner to create the draft and upload assets. It is not bundled into the extension. Automated release creation uses `gh release create --verify-tag --draft`; the publisher explicitly publishes after review. See the [GitHub CLI release documentation](https://cli.github.com/manual/gh_release_create), [GitHub's Node.js workflow guidance](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs), and [Playwright CI guidance](https://playwright.dev/docs/ci).

## Finish true automatic installation later

After the repository and release process are in place, the next distribution milestone is a Chrome Web Store listing: choose the publisher identity, prepare the listing and privacy disclosures, submit the reviewed runtime package, and follow the store's review/publishing process. Future versions then go through that same store item; the browser checks for and installs accepted updates. GitHub remains useful for source history, issue tracking, test results, and human-readable release notes.

Store publication and a migration plan for the existing unpacked installation are separate pending steps. This build supplies the release-checking and packaging foundation without claiming those steps are already complete.
