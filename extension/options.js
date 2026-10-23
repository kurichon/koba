import { normalizeRepository, validateReleaseUrl, compareVersions, UPDATE_ORIGIN } from "./updates.js";

const DEFAULTS = {
  enabled: true,
  apiKey: "",
  launcherPositionY: 0
};

const $ = (id) => document.getElementById(id);
let updateFormBusy = false;
let syncAttempt = null;
let latestSession = null;
let positionSaveTimer = null;

function normalizeLauncherPosition(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.max(-100, Math.min(100, number))) : 0;
}

function renderLauncherPosition(value) {
  const position = normalizeLauncherPosition(value);
  $("launcherPositionY").value = String(position);
  const label = position === 0 ? "Centered (default)" :
    `${Math.abs(position)}% toward ${position < 0 ? "top" : "bottom"}`;
  $("launcherPositionLabel").textContent = label;
  $("launcherPositionY").setAttribute("aria-valuetext", label);
  $("launcherPositionReset").disabled = position === 0;
}

async function saveLauncherPosition(value) {
  const position = normalizeLauncherPosition(value);
  await chrome.storage.local.set({ launcherPositionY: position });
  $("launcherPositionStatus").textContent = position === 0 ? "Default position restored." : "Position saved.";
}

function message(type, fields = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The extension did not respond in time. Try again when it reconnects.")), 30_000);
    try {
      chrome.runtime.sendMessage({ type, ...fields }, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response?.success) return reject(new Error(response?.error || "Request failed"));
        resolve(response);
      });
    } catch (error) { clearTimeout(timer); reject(error); }
  });
}

function renderUpdates(updates, { fillInputs = false } = {}) {
  if (!updates) return;
  const { settings = {}, state = {} } = updates;
  if (fillInputs) {
    $("updateRepository").value = settings.repository || "kurichon/koba";
    $("updateEnabled").checked = Boolean(settings.enabled);
  }
  $("updateInstalled").textContent = chrome.runtime.getManifest().version;
  $("updateChecked").textContent = state.checkedAt ? new Date(state.checkedAt).toLocaleString() : "Never";
  const labels = {
    "not-configured": "Add the repository once a public release is available.",
    disabled: "Automatic checks are off. You can still use Check now.",
    idle: "Ready to check published releases.",
    checking: "Checking published releases…",
    current: "You have the latest supported version from this repository.",
    available: `Version ${state.latestVersion || ""} is available. Open the release for the download and changes.`,
    "permission-required": "GitHub access is needed. Save these settings or choose Check now to allow it.",
    "no-release": "No public stable release found. Check the repository name and published release assets.",
    error: state.error || "Could not check releases. Try again later."
  };
  $("updateStatus").textContent = labels[state.status] || labels.idle;
  $("updateCheck").disabled = updateFormBusy || state.status === "checking";
  const link = $("updateRelease");
  link.hidden = true;
  link.removeAttribute("href");
  try {
    if (state.available && compareVersions(state.latestVersion, chrome.runtime.getManifest().version) > 0 &&
        validateReleaseUrl(state.releaseUrl, settings.repository, state.tag)) {
      link.href = state.releaseUrl;
      link.textContent = `View v${state.latestVersion} release`;
      link.hidden = false;
    }
  } catch {}
}

async function loadUpdates({ fillInputs = false } = {}) {
  try { renderUpdates((await message("JPDB_GET_UPDATE_STATUS")).updates, { fillInputs }); }
  catch (error) { $("updateStatus").textContent = error.message; }
}

async function updateSettingsFromClick(checkNow) {
  if (updateFormBusy) return;
  let repository;
  const enabled = $("updateEnabled").checked;
  try {
    repository = normalizeRepository($("updateRepository").value);
    if ((checkNow || enabled) && !repository) throw new Error("Enter the public GitHub repository first.");
    // Call request synchronously inside the click gesture, before storage or messaging awaits.
    const permission = repository && (checkNow || enabled)
      ? chrome.permissions.request({ origins: [UPDATE_ORIGIN] })
      : Promise.resolve(true);
    updateFormBusy = true;
    $("updateSave").disabled = true;
    $("updateCheck").disabled = true;
    $("updateStatus").textContent = "Saving update settings…";
    const granted = await permission;
    const saved = await message("JPDB_SAVE_UPDATE_SETTINGS", { repository, enabled });
    renderUpdates(saved.updates, { fillInputs: true });
    if (granted && repository && (checkNow || enabled)) {
      renderUpdates((await message("JPDB_CHECK_FOR_UPDATE")).updates);
    } else if (!granted) {
      $("updateStatus").textContent = "GitHub access was not granted. Review functionality is unchanged; allow access here when you want release checks.";
    }
  } catch (error) { $("updateStatus").textContent = error.message; }
  finally {
    updateFormBusy = false;
    $("updateSave").disabled = false;
    await loadUpdates();
  }
}

function safeNumber(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function safeCode(value) { return typeof value === "string" && /^[a-z0-9_.-]{1,80}$/i.test(value) ? value : null; }

async function copyDiagnostics() {
  $("diagCopy").disabled = true;
  try {
    const results = await Promise.allSettled([
      chrome.storage.local.get({ diagnostics: {} }),
      message("JPDB_GET_DIAGNOSTICS"),
      message("JPDB_GET_UPDATE_STATUS")
    ]);
    const diag = results[0].status === "fulfilled" ? results[0].value.diagnostics || {} : {};
    const runtime = results[1].status === "fulfilled" ? results[1].value : {};
    const updates = results[2].status === "fulfilled" ? results[2].value.updates?.state || {} : {};
    const events = items => (Array.isArray(items) ? items : []).slice(-14).map(item => ({
      at: safeNumber(item.at), type: safeCode(item.type), revision: safeNumber(item.revision)
    }));
    const report = {
      extensionVersion: chrome.runtime.getManifest().version,
      collectedAt: new Date().toISOString(),
      vocabularyCount: safeNumber(diag.vocabularyCount),
      eligibleCount: safeNumber(diag.eligibleCount),
      lastSync: safeNumber(diag.lastSync),
      warmRefreshActive: Boolean(runtime.warmRefreshActive),
      warmRefreshes: safeNumber(diag.warmRefreshes),
      warmFailures: safeNumber(diag.warmFailures),
      lastGradeRequestMs: safeNumber(diag.lastGradeRequestMs),
      lastAdvanceMs: safeNumber(diag.lastAdvanceMs),
      lastWarmRefreshMs: safeNumber(diag.lastWarmRefreshMs),
      lastForegroundMs: safeNumber(diag.lastForegroundMs),
      dueAtSupported: typeof diag.dueAtSupported === "boolean" ? diag.dueAtSupported : null,
      lastErrorPresent: Boolean(diag.lastError || runtime.session?.error),
      lastErrorCode: safeCode(runtime.session?.error?.code) || safeCode(diag.errorCode),
      runtimeAvailable: results[1].status === "fulfilled",
      panelOpen: Number.isInteger(runtime.panel?.openTabId),
      panelRevision: safeNumber(runtime.panel?.revision),
      sessionRevision: safeNumber(runtime.session?.revision),
      sessionLoading: typeof runtime.session?.loading === "boolean" ? runtime.session.loading : null,
      loadPhase: safeCode(runtime.session?.progress?.phase),
      loadCompleted: safeNumber(runtime.session?.progress?.completed),
      loadTotal: safeNumber(runtime.session?.progress?.total),
      hasCurrentCard: Boolean(runtime.session?.card),
      recoveryCount: safeNumber(runtime.session?.recoveryCount ?? diag.recoveryCount),
      submissionStatus: safeCode(runtime.session?.submission?.status),
      panelEvents: events(runtime.panelEvents),
      reviewEvents: events(runtime.actionEvents),
      updates: {
        status: safeCode(updates.status), available: Boolean(updates.available),
        lastChecked: safeNumber(updates.checkedAt)
      }
    };
    const text = JSON.stringify(report, null, 2);
    const output = $("diagnosticExport");
    output.value = text;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      output.hidden = true;
      $("diagCopyStatus").textContent = "Diagnostics copied. API keys, vocabulary text, and server response bodies are omitted.";
    } catch {
      output.hidden = false;
      output.focus();
      output.select();
      $("diagCopyStatus").textContent = "Copy the selected diagnostics below. API keys, vocabulary text, and server response bodies are omitted.";
    }
  } catch { $("diagCopyStatus").textContent = "Diagnostics could not be collected. Try again after reloading the extension."; }
  finally { $("diagCopy").disabled = false; }
}

function renderDiagnostics(diag) {
  $("diagVocab").textContent = diag.vocabularyCount ?? "—";
  $("diagEligible").textContent = diag.eligibleCount ?? "—";
  $("diagSync").textContent = diag.lastSync ? new Date(diag.lastSync).toLocaleString() : "—";
  $("diagWarm").textContent = `${Number(diag.warmRefreshes)||0} completed · ${Number(diag.warmFailures)||0} failed`;
  const ms = value => Number.isFinite(value) && value >= 0 ? `${Math.round(value)} ms` : "—";
  $("diagGradeMs").textContent = ms(diag.lastGradeRequestMs);
  $("diagAdvanceMs").textContent = ms(diag.lastAdvanceMs);
  $("diagWarmMs").textContent = ms(diag.lastWarmRefreshMs);
  $("diagDueAt").textContent = diag.dueAtSupported == null ? "unknown" : (diag.dueAtSupported ? "yes" : "no (learning cards withheld safely)");
  $("diagError").textContent = diag.lastError || "—";
}

function progressText(progress) {
  if (!progress || !["decks", "vocabulary", "reviews"].includes(progress.phase)) return "—";
  if (progress.phase === "decks") return "Retrieving JPDB deck list…";
  const completed = Math.max(0, Number(progress.completed) || 0);
  const total = Number.isFinite(progress.total) ? progress.total : "…";
  return progress.phase === "vocabulary" ? `Deck vocabulary: ${completed} / ${total}` :
    `Review eligibility: ${completed.toLocaleString()} / ${typeof total === "number" ? total.toLocaleString() : total} entries`;
}

function renderRuntimeResult(result) {
    $("diagProgress").textContent = result.session?.loading ? progressText(result.session?.progress) : "—";
    $("diagOpenTab").textContent = result.panel?.openTabId ?? "none";
    $("diagPanelRevision").textContent = result.panel?.revision ?? 0;
    $("diagSessionRevision").textContent = result.session?.revision ?? 0;

    const panelEvents = Array.isArray(result.panelEvents) ? result.panelEvents.slice(-12) : [];
    $("panelLog").textContent = panelEvents.map((event) => {
      const time = event.at ? new Date(event.at).toLocaleTimeString() : "—";
      return `${time}  ${event.type}  openTab=${event.openTabId ?? "none"}  rev=${event.revision ?? 0}`;
    }).join("\n") || "—";
    const actions = Array.isArray(result.actionEvents) ? result.actionEvents.slice(-14) : [];
    $("actionLog").textContent = actions.map((event) => {
      const time = event.at ? new Date(event.at).toLocaleTimeString() : "—";
      const reason = event.reason ? ` reason=${event.reason}` : "";
      return `${time}  ${event.type}  rev=${event.revision ?? 0}${reason}`;
    }).join("\n") || "—";
}

async function renderRuntimeDiagnostics() {
  try {
    renderRuntimeResult(await message("JPDB_GET_DIAGNOSTICS"));
  } catch (error) {
    $("panelLog").textContent = `Runtime diagnostics unavailable: ${error.message}`;
    $("actionLog").textContent = "—";
  }
}

async function finishSyncIfReady() {
  const attempt = syncAttempt;
  if (!attempt || attempt.starting) return;
  if (attempt.finishing) { attempt.refreshRequested = true; return; }
  attempt.finishing = true;
  attempt.refreshRequested = false;
  let terminal = true;
  try {
    // The handler serializes this read after the load's final state and counts.
    const result = await message("JPDB_GET_DIAGNOSTICS");
    if (syncAttempt !== attempt) return;
    if (result.session?.loading || result.state?.loading) {
      terminal = false;
      return;
    }
    const data = await chrome.storage.local.get({ diagnostics: {} });
    renderDiagnostics(data.diagnostics || {});
    renderRuntimeResult(result);
    const error = result.session?.error || result.state?.error;
    const count = safeNumber(result.eligibleCount ?? data.diagnostics?.eligibleCount);
    $("status").textContent = error
      ? `Sync failed: ${error.message || "Vocabulary sync did not complete. Try again."}`
      : count === null ? "Sync complete." : `Sync complete: ${count} reviewable card(s).`;
  } catch (error) {
    $("status").textContent = `Could not confirm sync status: ${error.message}`;
  } finally {
    if (syncAttempt === attempt) {
      if (terminal) {
        syncAttempt = null;
        $("sync").disabled = false;
      } else {
        attempt.finishing = false;
        // An observed completion event may race a previous diagnostics reply.
        if (attempt.refreshRequested) void finishSyncIfReady();
      }
    }
  }
}

async function load() {
  const data = await chrome.storage.local.get({ ...DEFAULTS, diagnostics: {} });
  $("enabled").checked = Boolean(data.enabled);
  $("apiKey").value = data.apiKey || "";
  renderLauncherPosition(data.launcherPositionY);
  renderDiagnostics(data.diagnostics || {});
  await Promise.allSettled([renderRuntimeDiagnostics(), loadUpdates({ fillInputs: true })]);
}

async function save() {
  await chrome.storage.local.set({
    enabled: $("enabled").checked,
    apiKey: $("apiKey").value.trim()
  });
  $("status").textContent = "Saved.";
}

$("launcherPositionY").addEventListener("input", () => {
  const value = $("launcherPositionY").value;
  renderLauncherPosition(value);
  clearTimeout(positionSaveTimer);
  positionSaveTimer = setTimeout(() => {
    positionSaveTimer = null;
    void saveLauncherPosition(value).catch(error => { $("launcherPositionStatus").textContent = error.message; });
  }, 120);
});
$("launcherPositionY").addEventListener("change", () => {
  clearTimeout(positionSaveTimer);
  positionSaveTimer = null;
  void saveLauncherPosition($("launcherPositionY").value).catch(error => { $("launcherPositionStatus").textContent = error.message; });
});
$("launcherPositionReset").addEventListener("click", () => {
  clearTimeout(positionSaveTimer);
  positionSaveTimer = null;
  renderLauncherPosition(0);
  void saveLauncherPosition(0).catch(error => { $("launcherPositionStatus").textContent = error.message; });
});

$("diagRefresh").addEventListener("click", () => syncAttempt ? finishSyncIfReady() : renderRuntimeDiagnostics());
$("diagCopy").addEventListener("click", copyDiagnostics);
$("updateSave").addEventListener("click", () => updateSettingsFromClick(false));
$("updateCheck").addEventListener("click", () => updateSettingsFromClick(true));

$("save").addEventListener("click", async () => {
  try { await save(); } catch (error) { $("status").textContent = error.message; }
});

$("test").addEventListener("click", async () => {
  try {
    await save();
    $("status").textContent = "Testing…";
    await message("JPDB_TEST_CONNECTION");
    $("status").textContent = "JPDB connection successful.";
  } catch (error) {
    $("status").textContent = `Connection failed: ${error.message}`;
  }
});

$("sync").addEventListener("click", async () => {
  if (syncAttempt) return;
  const attempt = syncAttempt = { starting: true, finishing: false, revision: 0 };
  latestSession = null;
  $("sync").disabled = true;
  try {
    await save();
    $("status").textContent = "Syncing vocabulary states… Large collections may take a while.";
    const result = await message("JPDB_FORCE_SYNC", { wait: false });
    attempt.starting = false;
    attempt.revision = result.state?.revision || 0;
    if (!result.state?.loading || (latestSession && !latestSession.loading && latestSession.revision >= attempt.revision)) {
      void finishSyncIfReady();
    }
  } catch (error) {
    const data = await chrome.storage.local.get({ diagnostics: {} }).catch(() => null);
    if (data) renderDiagnostics(data.diagnostics || {});
    $("status").textContent = `Sync failed: ${error.message}`;
    syncAttempt = null;
    $("sync").disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.sharedReviewSessionV3) {
    latestSession = changes.sharedReviewSessionV3.newValue || null;
    $("diagProgress").textContent = latestSession?.loading ? progressText(latestSession.progress) : "—";
    if (syncAttempt && !syncAttempt.starting && latestSession?.loading) {
      $("status").textContent = `Syncing… ${progressText(latestSession.progress)}`;
    }
    if (latestSession && !latestSession.loading && latestSession.revision >= (syncAttempt?.revision || 0)) void finishSyncIfReady();
  }
  if (area === "local" && changes.launcherPositionY &&
    !$("launcherPositionY").matches(":active")) {
    renderLauncherPosition(changes.launcherPositionY.newValue);
  }
  if (area === "local" && changes.diagnostics) {
    renderDiagnostics(changes.diagnostics.newValue || {});
    if (syncAttempt && !syncAttempt.starting) void finishSyncIfReady();
  }
  if (area === "local" && (changes.jpdbUpdateState || changes.jpdbUpdateSettings)) void loadUpdates();
});

load().catch(error => { $("status").textContent = error.message; });