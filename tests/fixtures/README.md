# Frozen v0.3.1 upgrade fixture

`v0.3.1/` is an **unchanged historical extension baseline**, recovered from the older `JPDB_Review_Button_for_ChatGPT_v0.3.1.zip` package. Its original ZIP SHA-256 was:

`e3cfcea93549abe89e0336626d23eb6faa6fdaa7d63ed686068b6ef2e44480b1`

This baseline is deliberately **not repaired, renamed or removed**. It allows compatibility investigations and optional same-folder upgrade checks using a disposable browser profile and fake API key. It contains no user profile or credentials and is excluded from release ZIPs.

**Qualification limitation:** Headless Chromium sometimes retains a cached service worker after replacing unpacked files, so the automated CI suite skips the fragile hot-update scenario by default. The exact upgrade remains a **manual Chrome/Brave acceptance check**. To exercise the optional fixture scenario, use the browser test settings described in [Development](../../docs/DEVELOPMENT.md). Do not interpret a skipped scenario as a passing upgrade test.
