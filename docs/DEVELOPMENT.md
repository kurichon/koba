# Developing and releasing KoBa

[← Back to KoBa](../README.md) · [Current architecture](ARCHITECTURE.md) · [Qualification](QUALIFICATION.md)

This page is for maintainers and contributors. First-time users should start with the [README](../README.md), not these build instructions.

## Repository structure

| Location | Purpose |
| --- | --- |
| `extension/` | Unpacked Chrome/Brave extension, including `manifest.json`, UI, and background worker |
| `scripts/build-release.mjs` | Builds deterministic, runtime-only release ZIPs with checksums |
| `installer/KoBaSetup/` | Self-contained Windows installer/updater, transactional swaps and one-time original-path transfer preparation |
| `tests/` | Background-state, update-checker, and controlled Chromium tests |
| `.github/workflows/ci.yml` | Linux extension checks plus Windows installer and browser identity checks |
| `.github/workflows/release.yml` | Creates a **draft** GitHub release from an exact version tag |
| `docs/` | User guide, architecture, updates, and current qualification |
| `dist/` | Generated ZIPs and `SHA256SUMS.txt`; intentionally ignored by Git |

## Requirements and commands

You need **Node.js 22+** and **Python 3**. The extension itself has no runtime npm dependencies; Playwright is only a development/test dependency.

```sh
npm ci
npm test
npx playwright install --with-deps chromium
npm run test:browser
npm run build
```

On Linux CI without a display, use `xvfb-run -a npm run test:browser`. `JPDB_TEST_EXECUTABLE` selects a Chromium executable for the browser fixture. `JPDB_TEST_EXTENSION` points browser tests to an extracted candidate; `JPDB_TEST_CASE` filters scenarios by name. Tests use fake JPDB/GitHub transport and disposable profiles—**never a real API key or real review grades**.

The ZIP builder requires matching versions in `package.json` and `extension/manifest.json`. To verify a release tag as well, run (substituting the correct version):

```sh
npm run build -- --tag v0.3.7
```

`dist/` contains one installable extension ZIP `KoBa_vVERSION.zip` and its `SHA256SUMS.txt`. The Windows release job adds the separate `KoBaSetup.exe` application. The archive contains only allowlisted extension runtime files and the MIT license, with no user data, keys, tests, documentation, or browser profile. The builder verifies member names, references, CRC, and bytes. Upload only the named ZIP, checksum and the verified self-contained Windows updater executable; do not upload a wildcard of old build output.

## Change and test guidelines

- Keep the normal review UI manual and unobtrusive. Do not add auto-opening or audio without a separate product decision.
- Preserve due/failed/eligible-learning filtering, cross-tab ownership, one shared session, review-journal safety, and no automatic retry of grade POSTs.
- Keep settings and update checking outside the JPDB grading critical path. Do not send JPDB credentials to GitHub or ChatGPT.
- Add focused state tests for behavior changes and actual Chromium interactions for UI changes. Test slow responses and restarts rather than relying solely on a happy path.
- Keep user help in the [README](../README.md) and [user guide](USER_GUIDE.md); technical design goes to [architecture](ARCHITECTURE.md). Document user-visible changes in [CHANGELOG](../CHANGELOG.md).
- Use a pull request and let GitHub CI qualify its exact source commit. Headless tests do **not** certify live JPDB behavior, the user's browser profile, or same-folder hot reinjection.

## Release process

1. Update the extension manifest, `package.json`, package lock, and changelog to the same new version. Inspect generated files and run the tests on the proposed source.
2. Merge only after the relevant PR checks pass. Confirm CI on `main` and perform a real-browser installation/update check if the change affects it.
3. Open [GitHub Actions → Prepare draft release](https://github.com/kurichon/koba/actions/workflows/release.yml) and enter the exact `vVERSION`, or push that version tag from a qualified commit. The workflow requires the tag to match the manifest, runs the tests, and prepares a **draft** with the KoBa ZIP, its checksum file and the separately built Windows setup executable.
4. Review the draft release notes, filenames, installation compatibility, and hashes. **Publish the draft deliberately** and verify [Releases/latest](https://github.com/kurichon/koba/releases/latest) resolves to the new public stable release.
5. Keep published KoBa package bytes and source tags stable. When a package is explicitly retired, remove its distribution entry and reconcile checksums and help text together.

The default release workflow **does not publish automatically**; historical one-time publication workflows used for previous versions have been removed from the repository. GitHub notifications require a published stable release, not merely a tag or draft. See [update behavior](UPDATES.md).

## Windows installer verification

CI builds the self-contained `net8.0-windows` WinForms application on Windows, runs `KoBaSetup.exe --self-test dist/KoBa_vVERSION.zip`, and tests ordinary Windows folders, retained backups, explicit rollback and subsequent updates. A disposable Chromium profile test checks that replacing **real files at the same unpacked path** preserves the ID and `chrome.storage.local`, unlike moving to a different unpacked path. Browser transfer uses explicit user-controlled export/import from KoBa Options; no browser-profile databases are edited. The installer stages official release downloads, checks ZIP integrity and allowlisted runtime files, uses an update journal and backup during replacement, and never manipulates user browser profile storage. The one-time preparation keeps its own rollback backup and journal. The export JSON contains the API key and must be handled as a secret; import into a new AppData extension requires explicit user confirmation. The Windows executable is presently **unsigned**, so Windows SmartScreen may warn. The first end-user installation/reload in a real Chrome or Brave profile remains a live qualification gate.

## Supported installation and verification

KoBa uses its current package name and explicit panel-message protocol. Pre-rebrand installation compatibility has been retired. Keep current settings, account-scoped review state and recovery safeguards intact. The `jpdb` names used internally identify the service and existing browser storage; they are not a reason to reset or rename user data.

The current [qualification page](QUALIFICATION.md) records source and packaged-browser evidence plus the remaining live-user checks. A cold browser restart tests persisted review recovery; an actual hot extension reload still requires a supported Chrome/Brave installation.

## Secrets and disclosure

Never commit JPDB API keys, Chrome/Brave profiles, `.env` files, diagnostics containing secrets, or review data. The only API key used in tests is explicitly fake. Follow the [MIT license](../LICENSE). KoBa is independent of JPDB and OpenAI.
