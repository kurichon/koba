# Upgrade fixture provenance

`v0.3.1/` is the unchanged runtime source extracted from the user's recovered
latest working package, `JPDB_Review_Button_for_ChatGPT_v0.3.1.zip`.

Original ZIP SHA-256:

`e3cfcea93549abe89e0336626d23eb6faa6fdaa7d63ed686068b6ef2e44480b1`

This fixture is intentionally not repaired. Browser tests install it in a
disposable profile, store a clearly fake key, replace its files in the same folder
with the candidate, and use the real Extensions-page Reload button. They verify
that local settings survive and an already-open tab receives the new UI.

The fixture contains no user profile or credentials, and is excluded from the
installable release ZIP. Set `JPDB_TEST_UPGRADE_FROM` to another unpacked baseline
directory when testing a different upgrade path.
