// GitHub release metadata only. Unpacked extensions still require a manual
// file replacement/reload; this module never downloads or executes remote code.
export const UPDATE_SETTINGS_KEY = "jpdbUpdateSettings";
export const UPDATE_STATE_KEY = "jpdbUpdateState";
export const UPDATE_ORIGIN = "https://api.github.com/*";
const ALARM_NAME = "jpdb-release-check";
// Keep accepting legacy asset names for people upgrading from the pre-KoBa releases.
function acceptedAssetNames(version) {
  return [`KoBa_v${version}.zip`, `JPDB_Review_Button_for_ChatGPT_v${version}.zip`];
}
const DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
let initialized = false;
let generation = 0;
let inFlight = null;
let mutationQueue = Promise.resolve();

function mutate(fn) {
  const task = mutationQueue.then(fn, fn);
  mutationQueue = task.catch(() => {});
  return task;
}

export function normalizeRepository(value) {
  let text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (/^https:\/\//i.test(text)) {
    let url;
    try { url = new URL(text); } catch { throw new Error("Enter a GitHub repository as owner/repository."); }
    if (url.origin !== "https://github.com" || url.username || url.password || url.search || url.hash) {
      throw new Error("Use a public repository on github.com.");
    }
    text = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  }
  text = text.replace(/\.git$/, "");
  const parts = text.split("/");
  if (parts.length !== 2 || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(parts[0]) ||
      !/^[a-z0-9_.-]{1,100}$/i.test(parts[1]) || [".", ".."].includes(parts[1])) {
    throw new Error("Enter a GitHub repository as owner/repository.");
  }
  return `${parts[0]}/${parts[1]}`;
}

export function parseVersion(value) {
  if (typeof value !== "string" || value.length > 23 || !/^\d+(?:\.\d+){0,3}$/.test(value)) return null;
  const parts = value.split(".");
  if (parts.some(part => (part.length > 1 && part[0] === "0") || Number(part) > 65535) ||
      parts.every(part => Number(part) === 0)) return null;
  return parts.map(Number);
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error("Invalid extension version.");
  for (let i = 0; i < 4; i++) {
    const delta = (left[i] || 0) - (right[i] || 0);
    if (delta) return Math.sign(delta);
  }
  return 0;
}

export function validateReleaseUrl(value, repository, tag) {
  try {
    const url = new URL(value);
    return url.origin === "https://github.com" && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname.toLowerCase() === `/${repository}/releases/tag/${encodeURIComponent(tag)}`.toLowerCase();
  } catch { return false; }
}

function releaseMetadata(release, repository) {
  if (!release || release.draft !== false || release.prerelease !== false || !release.published_at) {
    throw new Error("No supported published stable release was found.");
  }
  const tag = typeof release.tag_name === "string" ? release.tag_name : "";
  const version = tag.replace(/^[vV]/, "");
  if (!parseVersion(version) || !validateReleaseUrl(release.html_url, repository, tag)) {
    throw new Error("The latest release has an unsupported version tag or release URL.");
  }
  const asset = Array.isArray(release.assets) && acceptedAssetNames(version)
    .map(name => release.assets.find(item => item?.name === name && item.state === "uploaded"))
    .find(Boolean);
  const assetName = asset?.name;
  let assetUrl;
  try { assetUrl = new URL(asset?.browser_download_url); } catch {}
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 25 * 1024 * 1024 ||
      !assetUrl || assetUrl.origin !== "https://github.com" || assetUrl.username || assetUrl.password || assetUrl.search || assetUrl.hash ||
      assetUrl.pathname.toLowerCase() !== `/${repository}/releases/download/${encodeURIComponent(tag)}/${assetName}`.toLowerCase()) {
    throw new Error("The latest release does not contain the expected installable extension ZIP.");
  }
  return { latestVersion: version, releaseUrl: release.html_url, tag, assetName };
}

function currentVersion() { return chrome.runtime.getManifest().version; }

async function readSettings() {
  const raw = (await chrome.storage.local.get(UPDATE_SETTINGS_KEY))[UPDATE_SETTINGS_KEY] || {};
  let repository = "";
  try { repository = normalizeRepository(raw.repository); } catch {}
  return { repository, enabled: raw.enabled === true };
}

function normalizeState(raw, repository) {
  const current = currentVersion();
  const state = {
    status: repository ? "idle" : "not-configured", repository, currentVersion: current,
    available: false, latestVersion: null, releaseUrl: null, tag: null, assetName: null,
    checkedAt: null, nextCheckAt: null, retryAfter: null, error: null, etag: null
  };
  if (!raw || typeof raw.repository !== "string" || raw.repository.toLowerCase() !== repository.toLowerCase()) return state;
  for (const key of ["checkedAt", "nextCheckAt", "retryAfter"]) {
    if (Number.isFinite(raw[key]) && raw[key] > 0) state[key] = raw[key];
  }
  if (typeof raw.etag === "string" && raw.etag.length <= 200 && !/[\r\n]/.test(raw.etag)) state.etag = raw.etag;
  const statuses = ["idle", "checking", "current", "available", "error", "permission-required", "disabled", "no-release"];
  if (statuses.includes(raw.status)) state.status = raw.status;
  if (typeof raw.error === "string") state.error = raw.error.slice(0, 240);
  if (parseVersion(raw.latestVersion) && typeof raw.tag === "string" &&
      raw.tag.replace(/^[vV]/, "") === raw.latestVersion && validateReleaseUrl(raw.releaseUrl, repository, raw.tag) &&
      acceptedAssetNames(raw.latestVersion).includes(raw.assetName)) {
    for (const key of ["latestVersion", "releaseUrl", "tag", "assetName"]) state[key] = raw[key];
    state.available = compareVersions(state.latestVersion, current) > 0;
    if (state.status === "available" && !state.available) state.status = "current";
  }
  return state;
}

export async function getUpdateStatus() {
  const settings = await readSettings();
  const raw = (await chrome.storage.local.get(UPDATE_STATE_KEY))[UPDATE_STATE_KEY];
  const state = normalizeState(raw, settings.repository);
  if (state.status === "checking" && inFlight?.generation !== generation) {
    state.status = "error";
    state.error = "The previous update check was interrupted. Check again when ready.";
    state.nextCheckAt = null;
  }
  if (!settings.repository) state.status = "not-configured";
  else if (!settings.enabled && !state.checkedAt && state.status === "idle") state.status = "disabled";
  return { settings, state };
}

async function commitState(state, expectedGeneration) {
  return await mutate(async () => {
    if (generation !== expectedGeneration) return false;
    const settings = await readSettings();
    if (settings.repository.toLowerCase() !== state.repository.toLowerCase()) return false;
    await chrome.storage.local.set({ [UPDATE_STATE_KEY]: state });
    return true;
  });
}

async function hasPermission() {
  return await chrome.permissions.contains({ origins: [UPDATE_ORIGIN] });
}

async function scheduleCheck() {
  const { settings, state } = await getUpdateStatus();
  if (!settings.repository || !settings.enabled || !(await hasPermission())) {
    await chrome.alarms.clear(ALARM_NAME);
    return;
  }
  await chrome.alarms.create(ALARM_NAME, {
    when: Math.max(Date.now() + 60_000, state.nextCheckAt || 0, state.retryAfter || 0),
    periodInMinutes: 24 * 60
  });
}

export async function saveUpdateSettings({ repository, enabled } = {}) {
  const next = { repository: normalizeRepository(repository), enabled: enabled === true };
  generation++;
  inFlight?.controller.abort();
  await mutate(async () => {
    const previous = await getUpdateStatus();
    const state = normalizeState(previous.state, next.repository);
    const unchanged = previous.settings.repository.toLowerCase() === next.repository.toLowerCase() && previous.settings.enabled === next.enabled;
    if (!unchanged) {
      state.status = !next.repository ? "not-configured" : !next.enabled ? "disabled" : "idle";
      state.error = null;
    }
    if (next.enabled && state.retryAfter > Date.now()) {
      state.status = "error";
      state.error = previous.state.error || "GitHub asked us to wait before checking again.";
    }
    if (next.repository && !(await hasPermission())) state.status = "permission-required";
    await chrome.storage.local.set({ [UPDATE_SETTINGS_KEY]: next, [UPDATE_STATE_KEY]: state });
  });
  await scheduleCheck();
  return await getUpdateStatus();
}

async function readBoundedJson(response) {
  const parseJson = text => {
    try { return JSON.parse(text); }
    catch { throw new Error("GitHub returned invalid release metadata."); }
  };
  const length = Number(response.headers.get("content-length"));
  if (length > MAX_RESPONSE_BYTES) throw new Error("GitHub returned too much release metadata.");
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) throw new Error("GitHub returned too much release metadata.");
    return parseJson(text);
  }
  const chunks = [];
  let count = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > MAX_RESPONSE_BYTES) throw new Error("GitHub returned too much release metadata.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return parseJson(new TextDecoder().decode(bytes));
}

function retryTime(response) {
  const now = Date.now();
  const seconds = Number(response.headers.get("retry-after"));
  const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
  const requested = seconds > 0 ? now + seconds * 1000 : reset > now ? reset : now + 60_000;
  return Math.min(now + 7 * DAY_MS, requested);
}

export async function checkForUpdates({ force = false } = {}) {
  await mutationQueue;
  const ownGeneration = generation;
  const snapshot = await getUpdateStatus();
  const { settings } = snapshot;
  let state = snapshot.state;
  if (!settings.repository) return snapshot;
  if (!force && !settings.enabled) return snapshot;
  if (!(await hasPermission())) {
    state = { ...state, status: "permission-required", error: "Allow GitHub access in Updates settings to check releases." };
    await commitState(state, ownGeneration);
    return await getUpdateStatus();
  }
  if (state.retryAfter > Date.now() || (!force && state.nextCheckAt > Date.now())) return snapshot;
  if (inFlight?.generation === ownGeneration) return await inFlight.promise;

  const flight = { generation: ownGeneration, controller: new AbortController(), promise: null };
  inFlight = flight;
  flight.promise = (async () => {
    await commitState({ ...state, status: "checking", error: null }, ownGeneration);
    if (generation !== ownGeneration || flight.controller.signal.aborted) return await getUpdateStatus();
    let timeout;
    try {
      const headers = { Accept: "application/vnd.github+json" };
      if (state.etag && state.latestVersion) headers["If-None-Match"] = state.etag;
      const request = (async () => {
        const response = await fetch(`https://api.github.com/repos/${settings.repository}/releases/latest`, {
          headers, credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: flight.controller.signal
        });
        if (response.status === 304 && state.latestVersion) return { ...state, error: null };
        if (response.status === 404) {
          return { ...normalizeState(null, settings.repository), status: "no-release", error: "No public stable release found. Check the repository name and publish a release with an extension ZIP." };
        }
        if (response.status === 403 || response.status === 429) {
          const error = new Error("GitHub refused or rate-limited this check. Try again later.");
          error.retryAfter = retryTime(response);
          throw error;
        }
        if (!response.ok) throw new Error(`GitHub release check failed (${response.status}).`);
        const metadata = releaseMetadata(await readBoundedJson(response), settings.repository);
        const etag = response.headers.get("etag");
        return { ...normalizeState(null, settings.repository), ...metadata, etag: etag && etag.length <= 200 && !/[\r\n]/.test(etag) ? etag : null };
      })();
      const deadline = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          flight.controller.abort();
          reject(new Error("GitHub did not respond in time. You can check again later."));
        }, REQUEST_TIMEOUT_MS);
      });
      const next = await Promise.race([request, deadline]);
      const available = next.latestVersion ? compareVersions(next.latestVersion, currentVersion()) > 0 : false;
      state = { ...next, currentVersion: currentVersion(), available,
        status: next.status === "no-release" ? "no-release" : available ? "available" : "current",
        checkedAt: Date.now(), nextCheckAt: Date.now() + DAY_MS, retryAfter: null };
    } catch (error) {
      state = { ...state, status: "error", checkedAt: Date.now(), nextCheckAt: Date.now() + DAY_MS,
        retryAfter: Number.isFinite(error.retryAfter) ? error.retryAfter : null,
        error: error.name === "AbortError" ? "GitHub did not respond in time. You can check again later." : String(error.message || "Unable to check GitHub releases.").slice(0, 240) };
    } finally { clearTimeout(timeout); }
    await commitState(state, ownGeneration);
    if (generation === ownGeneration) await scheduleCheck();
    return await getUpdateStatus();
  })();
  try { return await flight.promise; }
  finally { if (inFlight === flight) inFlight = null; }
}

export async function handleUpdateMessage(message) {
  if (message?.type === "JPDB_GET_UPDATE_STATUS") return { updates: await getUpdateStatus() };
  if (message?.type === "JPDB_CHECK_FOR_UPDATE") return { updates: await checkForUpdates({ force: true }) };
  if (message?.type === "JPDB_SAVE_UPDATE_SETTINGS") return { updates: await saveUpdateSettings(message) };
  return null;
}

export async function initializeUpdates() {
  const dueCheck = () => { void checkForUpdates().catch(() => {}); };
  if (!initialized) {
    initialized = true;
    chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM_NAME) dueCheck(); });
    chrome.runtime.onStartup.addListener(() => { void scheduleCheck().then(dueCheck).catch(() => {}); });
    chrome.permissions.onRemoved.addListener(() => {
      generation++;
      inFlight?.controller.abort();
      void scheduleCheck().then(dueCheck).catch(() => {});
    });
    chrome.permissions.onAdded.addListener(() => { void scheduleCheck().then(dueCheck).catch(() => {}); });
  }
  await scheduleCheck();
  dueCheck();
}
