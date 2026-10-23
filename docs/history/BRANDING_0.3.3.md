# KoBa v0.3.3 identity and migration record

Date: 2026-10-23. This addendum does not replace the v0.3.2 reliability qualification evidence.

## Accepted identity

- Public name: **KoBa**
- Expanded name: **Kotoba no Soba** (ことばのそば)
- Tagline: **ことば、そばに。** (*Kotoba, soba ni.*)
- GitHub target: **`kurichon/koba`**, one public repo for source and stable releases
- License: **MIT**, copyright (c) 2026 kurichon; bundled in project root and runtime ZIP

## Compatibility

The manifest and Node package versions advance from 0.3.2 to 0.3.3 so installed
v0.3.2 extensions can detect a newer version. The displayed name change is not
intended to change the extension ID. Upgrade by replacing files **in the same
unpacked directory** and reloading the existing extension instead of uninstalling.

Existing v0.3.2 release checks require a legacy-named ZIP at each future release.
The new builder publishes two byte-identical assets with both the original
`JPDB_Review_Button_for_ChatGPT_vVERSION.zip` filename and the preferred
`KoBa_vVERSION.zip` filename. New clients prefer the KoBa name but validate
legacy assets as a compatibility path, including strict GitHub host, repository,
tag and asset checks. The downloaded ZIP is not executed by the checker.

The original v0.3.2 code and archived evidence remain unchanged except where the
historical qualification file was given a pointer to this addendum. The v0.3.1
upgrade fixture is preserved unmodified for regression testing.

## Release status

The GitHub target path was checked and did not exist at packaging time. No
remote GitHub repository, release, store listing, or native prompt has been
created or validated. Browser tests run against controlled transport only.

## Local verification performed for this candidate

- Runtime Node regression checks: 18 behavior cases passed.
- Release metadata/update tests: 9 unit cases passed, including new/legacy asset selection and exact URL security checks.
- The builder emits two byte-identical ZIPs, verified SHA-256 hashes and a bundled MIT LICENSE.
- A supplementary browser smoke attempt against the available system Chromium 144 could
  not initialize the extension service worker in this container. This is an
  environment-specific test blocker, **not** a successful live-browser qualification.
- Original v0.3.2 browser verification evidence is preserved only as historical evidence.
- The extension has not been tried on the user's actual Chrome or Brave profile or JPDB account.
