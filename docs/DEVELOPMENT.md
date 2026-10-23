# Developing and releasing KoBa

[← Back to KoBa](../README.md) · [Current architecture](ARCHITECTURE.md) · [Qualification](QUALIFICATION.md)

This page is for maintainers and contributors. First-time users should start with the [README](../README.md), not these build instructions.

## Repository structure

| Location | Purpose |
| --- | --- |
| `extension/` | Unpacked Chrome/Brave extension, including `manifest.json`, UI, and background worker |
| `scripts/build-release.mjs` | Builds deterministic, runtime-only release ZIPs with checksums |
| `tests/` | Background-state, update-checker, and controlled Chromium tests |
| `tests/fixtures/v0.3.1/` | Immutable pre-rebrand baseline used for upgrade-compatibility testing |
| `.github/workflows/ci.yml` | Qualification for PRs, `main` pushes, and manual runs |
| `.github/workflows/release.yml` | Creates a **draft** GitHub release from an exact version tag |
| `docs/` | User guide, architecture, updates, qualification, and historical evidence |
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
npm run build -- --tag v0.3.6
```

`dist/` then contains `KoBa_vVERSION.zip`, the **byte-identical** `JPDB_Review_Button_for_ChatGPT_vVERSION.zip` compatibility alias, and `SHA256SUMS.txt`. The alias is required by older clients' strict release-check logic; it is not a second product or implementation. Both archives contain only allowlisted extension runtime files and the MIT license. They **do not** contain user data, keys, tests, documentation, or a browser profile. The builder verifies member names, references, CRC, and bytes.

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
3. Open [GitHub Actions → Prepare draft release](https://github.com/kurichon/koba/actions/workflows/release.yml) and enter the exact `vVERSION`, or push that version tag from a qualified commit. The workflow requires the tag to match the manifest, runs the tests, and prepares a **draft** with both ZIP filenames and checksums.
4. Review the draft release notes, filenames, installation compatibility, and hashes. **Publish the draft deliberately** and verify [Releases/latest](https://github.com/kurichon/koba/releases/latest) resolves to the new public stable release.
5. Leave prior release assets in place for recovery and downgrade investigations. Never rewrite an existing tag or replace published assets without a specific migration decision.

The default release workflow **does not publish automatically**; historical one-time publication workflows used for previous versions have been removed from the repository. GitHub notifications require a published stable release, not merely a tag or draft. See [update behavior](UPDATES.md).

## Compatibility fixtures and historical evidence

`tests/fixtures/v0.3.1/` is an intentionally unchanged copy of an older working extension. Keep it for upgrade regression tests and disaster recovery; it is not production source and is excluded from the installable ZIP. Automated headless Chromium checks skip the fragile same-folder **hot reload** scenario because Chromium may keep an outdated extension worker when files are replaced. Perform that upgrade check on an actual Chrome/Brave installation when it materially matters.

Older review/release evidence is preserved under [docs/history](history/) rather than promoted into current qualification claims. The current [qualification page](QUALIFICATION.md) states the exact latest source and the remaining real-user checks.

## Secrets and disclosure

Never commit JPDB API keys, Chrome/Brave profiles, `.env` files, diagnostics containing secrets, or review data. The only API key used in tests is explicitly fake. Follow the [MIT license](../LICENSE). KoBa is independent of JPDB and OpenAI.
