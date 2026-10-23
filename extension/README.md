# KoBa (Kotoba no Soba) v0.3.3

ことば、そばに。 — A little Japanese, always close by.

This folder contains the unpacked extension. Load the folder containing
`manifest.json` in Chrome or Brave. Full source, installation notes, release
instructions, and qualification evidence are in the project root.

## Upgrade an existing installation

1. Close any open review popup.
2. Copy these runtime files into the **same folder** already loaded by your
   browser. Keep the existing extension installed.
3. Open `chrome://extensions` or `brave://extensions` and click **Reload** on
   KoBa. The version should now be **0.3.3**.
4. Open ChatGPT and click the small `○` launcher. If an old tab does not refresh
   its controls automatically, refresh that tab once.

The same-folder upgrade preserves the extension's local settings and API key.
Loading a different folder or removing the extension can change that identity.

## Use

Click `○` to open or close. While the popup has focus: **Space** reveals,
**1–5** grades Nothing / Something / Hard / Okay / Easy, and **Esc** closes.
The popup advances after each accepted review. Clicking another ChatGPT tab's
launcher moves the shared session there; changing tabs alone does not open it.

If a review's outcome is uncertain, use **Check review status** or **Continue
without resending**. The latter holds that card aside and lets you review others.
It does not claim that the uncertain review was saved.

## Updates

Settings can check a configured public GitHub repository for new published
releases, automatically once a day or through **Check now**. No repository is
configured by default; the planned public repo is `kurichon/koba`. This unpacked edition shows an update link; replacing its
files and reloading remains manual. It never installs code from GitHub.
