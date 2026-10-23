import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseVersion } from "../extension/updates.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runtime = join(root, "extension");
const output = join(root, "dist");
// An explicit allowlist keeps tests, credentials, browser profiles and docs out
// of both the installable archive and a future Chrome Web Store upload.
const filenames = [
  "LICENSE", "background.js", "content.js", "lib.js", "manifest.json", "options.html",
  "options.js", "panel.js", "session.js", "updates.js"
].sort();

async function build() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--tag")) {
    throw new Error("Usage: node scripts/build-release.mjs [--tag vVERSION]");
  }
  const files = [];
  for (const name of filenames) {
    const path = join(runtime, name);
    if (!(await lstat(path)).isFile()) throw new Error(`Runtime entry must be a regular file: ${name}`);
    files.push({ name, data: (await readFile(path)).toString("base64") });
  }
  const manifest = JSON.parse(Buffer.from(files.find(file => file.name === "manifest.json").data, "base64").toString());
  const version = manifest.version;
  if (manifest.manifest_version !== 3 || !parseVersion(version)) throw new Error("Expected a Manifest V3 extension with a valid numeric version.");
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (pkg.version !== version) throw new Error("package.json and manifest.json versions must match.");
  if (args.length && args[1] !== `v${version}`) throw new Error(`Release tag must be v${version}; received ${args[1]}.`);

  const referenced = [
    manifest.background?.service_worker, manifest.options_page,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    manifest.action?.default_popup,
    ...(manifest.content_scripts || []).flatMap(item => [...(item.js || []), ...(item.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap(item => item.resources || [])
  ].filter(Boolean);
  for (const name of referenced) {
    if (!filenames.includes(name)) throw new Error(`Manifest references a file outside the reviewed runtime allowlist: ${name}`);
  }

  await mkdir(output, { recursive: true });
  const filename = `KoBa_v${version}.zip`;
  const legacyFilename = `JPDB_Review_Button_for_ChatGPT_v${version}.zip`;
  const archive = join(output, filename);
  const python = process.env.JPDB_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const work = await mkdtemp(join(output, ".build-"));
  const payload = join(work, "payload.json");
  await writeFile(payload, JSON.stringify({ files, archive, temporary: join(work, filename) }));
  let result;
  try {
    result = spawnSync(python, ["-c", `
import base64, json, os, sys, zipfile
with open(sys.argv[1], encoding="utf-8") as source:
    payload = json.load(source)
files = {item["name"]: base64.b64decode(item["data"], validate=True) for item in payload["files"]}
target = payload["archive"]
temporary = payload["temporary"]
try:
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in files.items():
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data, compresslevel=9)
    with zipfile.ZipFile(temporary) as archive:
        if archive.namelist() != list(files) or archive.testzip() is not None:
            raise ValueError("Archive member or CRC validation failed")
        for name, data in files.items():
            if archive.read(name) != data:
                raise ValueError("Archive byte validation failed: " + name)
    os.replace(temporary, target)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
`, payload], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024 });
  } finally { await rm(work, { recursive: true, force: true }); }
  if (result.error) throw new Error(`Python 3 is needed to build the ZIP: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`ZIP build failed: ${result.stderr.trim()}`);
  const legacyArchive = join(output, legacyFilename);
  await copyFile(archive, legacyArchive);
  const sha = createHash("sha256").update(await readFile(archive)).digest("hex");
  if (createHash("sha256").update(await readFile(legacyArchive)).digest("hex") !== sha) {
    throw new Error("Legacy update ZIP differs from KoBa release bytes.");
  }
  const sums = join(output, "SHA256SUMS.txt");
  await writeFile(`${sums}.tmp`, `${sha}  ${filename}\n${sha}  ${legacyFilename}\n`);
  await rename(`${sums}.tmp`, sums);
  console.log(`Built dist/${filename} and legacy update alias (${files.length} runtime files).`);
  console.log(`SHA-256 (both): ${sha}`);
  console.log("Wrote dist/SHA256SUMS.txt. No release was published.");
}

build().catch(error => { console.error(error.message); process.exitCode = 1; });
