// One-time user-controlled transfer between two unpacked KoBa extension IDs.
// Chrome storage is not a file inside the extension folder. Never inspect browser
// profiles directly or send these values to the updater, JPDB, or GitHub.
const FORMAT = "koba-browser-local-migration";
const SCHEMA = 1;
const LIMIT = 8 * 1024 * 1024;
const EXPLICIT = new Set(["apiKey", "enabled", "launcherPositionY", "jpdbReviewCacheV4", "jpdbUpdateSettings"]);
const RECOVERY = /^jpdbReviewRecoveryV4:[0-9a-f]{64}$/;
export const IMPORT_MARKER = "kobaMigrationImportedV1";

function eligible(name) { return EXPLICIT.has(name) || RECOVERY.test(name); }
function object(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function serialized(value) { return JSON.stringify(value); }
async function sha256(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

function checkData(data) {
  if (!object(data)) throw new Error("Migration data must be an object.");
  for (const key of Object.keys(data)) {
    if (!eligible(key)) throw new Error("Migration contains an unsupported storage field.");
  }
  if (typeof data.apiKey !== "string" || !data.apiKey.trim() || data.apiKey.length > 4096)
    throw new Error("Export must contain the configured JPDB API key.");
  if (typeof data.enabled !== "undefined" && typeof data.enabled !== "boolean")
    throw new Error("Invalid enabled setting.");
  if (typeof data.launcherPositionY !== "undefined" &&
      (!Number.isInteger(data.launcherPositionY) || Math.abs(data.launcherPositionY) > 100))
    throw new Error("Invalid launcher position setting.");
  if (typeof data.jpdbReviewCacheV4 !== "undefined" && !object(data.jpdbReviewCacheV4))
    throw new Error("Invalid account cache format.");
  if (typeof data.jpdbUpdateSettings !== "undefined" && !object(data.jpdbUpdateSettings))
    throw new Error("Invalid update settings.");
  for (const key of Object.keys(data).filter(k => RECOVERY.test(k))) {
    const recovery = data[key];
    if (!object(recovery) || !Array.isArray(recovery.quarantines) ||
        (recovery.active !== null && typeof recovery.active !== "undefined" && !object(recovery.active)))
      throw new Error("Invalid JPDB review recovery journal.");
    if (recovery.active?.status === "saving")
      throw new Error("A JPDB grade may still be saving. Resolve its status before exporting.");
  }
  const json = serialized(data);
  if (new TextEncoder().encode(json).byteLength > LIMIT)
    throw new Error("Migration data is too large. Do not truncate JPDB recovery data.");
  return json;
}

export async function exportMigrationData() {
  const data = await chrome.storage.local.get(null);
  if (data[IMPORT_MARKER])
    throw new Error("This browser installation already imported a migration. No further migration is needed.");
  const state = await chrome.runtime.sendMessage({ type: "JPDB_GET_DIAGNOSTICS" });
  if (!state?.success)
    throw new Error("Cannot verify the JPDB review state. Reconnect the old KoBa installation before exporting.");
  if (state.session?.submission?.status === "saving")
    throw new Error("A grade is still saving. Confirm its outcome before exporting.");
  const selected = {};
  for (const [key, value] of Object.entries(data)) {
    if (eligible(key)) selected[key] = value;
  }
  const payload = checkData(selected);
  const accountHash = await sha256(selected.apiKey);
  if (selected.jpdbReviewCacheV4?.scope &&
      selected.jpdbReviewCacheV4.scope !== accountHash)
    throw new Error("The saved review cache belongs to another account. Resolve the account state before exporting.");
  const record = {
    format: FORMAT, schema: SCHEMA, sourceVersion: chrome.runtime.getManifest().version,
    sourceExtensionId: chrome.runtime.id, exportedAt: new Date().toISOString(),
    sha256: await sha256(payload), data: selected
  };
  if (new TextEncoder().encode(serialized(record)).byteLength > LIMIT)
    throw new Error("Migration file is too large.");
  return serialized(record);
}

export async function importMigrationData(raw) {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > LIMIT)
    throw new Error("Migration file exceeds the permitted size.");
  let record;
  try { record = JSON.parse(raw); }
  catch { throw new Error("The selected migration file is not valid JSON."); }
  if (!object(record) || record.format !== FORMAT || record.schema !== SCHEMA ||
      typeof record.sourceVersion !== "string" ||
      !/^\d+(?:\.\d+){2,3}$/.test(record.sourceVersion) ||
      typeof record.sourceExtensionId !== "string" ||
      !/^[a-p]{32}$/.test(record.sourceExtensionId) ||
      typeof record.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.sha256))
    throw new Error("This is not a supported KoBa migration export.");
  if (record.sourceExtensionId === chrome.runtime.id)
    throw new Error("The source and destination extension are the same. Use the NEW AppData KoBa installation.");
  const payload = checkData(record.data);
  if (await sha256(payload) !== record.sha256)
    throw new Error("Migration file checksum failed. Export it again from the original KoBa.");
  const accountHash = await sha256(record.data.apiKey);
  if (record.data.jpdbReviewCacheV4?.scope &&
      record.data.jpdbReviewCacheV4.scope !== accountHash)
    throw new Error("Migration cache belongs to a different account.");
  const previous = await chrome.storage.local.get(null);
  if (previous[IMPORT_MARKER] ||
      (typeof previous.apiKey === "string" && previous.apiKey.trim()) ||
      Object.hasOwn(previous, "jpdbReviewCacheV4") ||
      Object.keys(previous).some(key => RECOVERY.test(key)))
    throw new Error("The destination already has JPDB data or a completed migration. It will not be overwritten.");
  const marker = { completedAt: new Date().toISOString(), sourceExtensionId: record.sourceExtensionId,
                   exportedAt: record.exportedAt || null, checksum: record.sha256 };
  await chrome.storage.local.set({ ...record.data, [IMPORT_MARKER]: marker });
  const confirmed = await chrome.storage.local.get([...Object.keys(record.data), IMPORT_MARKER]);
  for (const [key, value] of Object.entries(record.data)) {
    if (serialized(confirmed[key]) !== serialized(value))
      throw new Error("Imported data could not be read back. Keep your old installation and export file.");
  }
  if (serialized(confirmed[IMPORT_MARKER]) !== serialized(marker))
    throw new Error("Migration completion could not be verified. Keep the original installation.");
  return { transferredKeys: Object.keys(record.data).length };
}
