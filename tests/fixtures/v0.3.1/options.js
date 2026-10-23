const DEFAULTS = {
  enabled: true,
  apiKey: ""
};

const $ = (id) => document.getElementById(id);

function message(type) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.success) return reject(new Error(response?.error || "Request failed"));
      resolve(response);
    });
  });
}

function renderDiagnostics(diag) {
  $("diagVocab").textContent = diag.vocabularyCount ?? "—";
  $("diagEligible").textContent = diag.eligibleCount ?? "—";
  $("diagSync").textContent = diag.lastSync ? new Date(diag.lastSync).toLocaleString() : "—";
  $("diagDueAt").textContent = diag.dueAtSupported == null ? "unknown" : (diag.dueAtSupported ? "yes" : "no (learning cards withheld safely)");
  $("diagError").textContent = diag.lastError || "—";
}

async function renderRuntimeDiagnostics() {
  try {
    const result = await message("JPDB_GET_DIAGNOSTICS");
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
  } catch (error) {
    $("panelLog").textContent = `Runtime diagnostics unavailable: ${error.message}`;
    $("actionLog").textContent = "—";
  }
}

async function load() {
  const data = await chrome.storage.local.get({ ...DEFAULTS, diagnostics: {} });
  $("enabled").checked = Boolean(data.enabled);
  $("apiKey").value = data.apiKey || "";
  renderDiagnostics(data.diagnostics || {});
  await renderRuntimeDiagnostics();
}

async function save() {
  await chrome.storage.local.set({
    enabled: $("enabled").checked,
    apiKey: $("apiKey").value.trim()
  });
  $("status").textContent = "Saved.";
}

$("diagRefresh").addEventListener("click", renderRuntimeDiagnostics);

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
  try {
    await save();
    $("status").textContent = "Syncing vocabulary states…";
    const result = await message("JPDB_FORCE_SYNC");
    const data = await chrome.storage.local.get({ diagnostics: {} });
    renderDiagnostics(data.diagnostics || {});
    await renderRuntimeDiagnostics();
    $("status").textContent = `Sync complete: ${result.count} reviewable card(s).`;
  } catch (error) {
    const data = await chrome.storage.local.get({ diagnostics: {} });
    renderDiagnostics(data.diagnostics || {});
    $("status").textContent = `Sync failed: ${error.message}`;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.diagnostics) renderDiagnostics(changes.diagnostics.newValue || {});
});

load();
