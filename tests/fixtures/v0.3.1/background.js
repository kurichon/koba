import { REVIEW_GRADES, sortReviewableCards } from "./lib.js";
import { normalizeReviewSession, validateCardAction } from "./session.js";
import { normalizePanelState, togglePanelForTab, closePanelForTab } from "./panel.js";

const API_BASE = "https://jpdb.io/api/v1";
const DEFAULTS = {
  enabled: true,
  apiKey: ""
};
const VOCAB_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const STATE_CACHE_TTL_MS = 2 * 60 * 1000;
const LOOKUP_BATCH_SIZE = 400;
const BATCH_DELAY_MS = 350;
const CHATGPT_TAB_PATTERNS = [
  "https://chatgpt.com/*",
  "https://chat.openai.com/*"
];

const SHARED_SESSION_KEY = "sharedReviewSessionV3";
const PANEL_STATE_KEY = "reviewPanelV3";
const ACTION_LOG_KEY = "reviewSessionActionLogV3";
const ACTION_LOG_LIMIT = 50;
const PANEL_LOG_KEY = "reviewPanelLogV3";
const PANEL_LOG_LIMIT = 40;

let memory = {
  vocabIds: [],
  vocabCachedAt: 0,
  cards: [],
  statesCachedAt: 0,
  dueAtSupported: null,
  lastError: null,
  refreshPromise: null
};

let sharedSessionHydrated = false;
let sharedSession = {
  card: null,
  revealed: false,
  revision: 0
};

let panelStateHydrated = false;
let panelState = {
  openTabId: null,
  revision: 0
};

let sessionActionQueue = Promise.resolve();
const reviewSubmissionPromises = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

function publicSharedSession() {
  return {
    card: sharedSession.card || null,
    revealed: Boolean(sharedSession.revealed),
    revision: Number(sharedSession.revision) || 0
  };
}

async function hydrateSharedSession() {
  if (sharedSessionHydrated) return;
  const stored = await chrome.storage.session.get([SHARED_SESSION_KEY]);
  sharedSession = normalizeReviewSession(stored?.[SHARED_SESSION_KEY]);
  sharedSessionHydrated = true;
}

async function persistSharedSession() {
  await chrome.storage.session.set({ [SHARED_SESSION_KEY]: sharedSession });
}

async function hydratePanelState() {
  if (panelStateHydrated) return;
  const stored = await chrome.storage.session.get([PANEL_STATE_KEY]);
  panelState = normalizePanelState(stored?.[PANEL_STATE_KEY]);
  panelStateHydrated = true;
}

async function persistPanelState() {
  await chrome.storage.session.set({ [PANEL_STATE_KEY]: panelState });
}

async function appendLog(key, limit, entry) {
  try {
    const stored = await chrome.storage.session.get([key]);
    const existing = Array.isArray(stored?.[key]) ? stored[key] : [];
    existing.push({ at: Date.now(), ...entry });
    await chrome.storage.session.set({ [key]: existing.slice(-limit) });
  } catch {
    // Diagnostics must never interfere with reviews.
  }
}

async function logAction(type, extra = {}) {
  await appendLog(ACTION_LOG_KEY, ACTION_LOG_LIMIT, {
    type,
    revision: Number(sharedSession.revision) || 0,
    card: sharedSession.card ? `${sharedSession.card.vid}:${sharedSession.card.sid}` : null,
    ...extra
  });
}

async function logPanel(type, extra = {}) {
  await appendLog(PANEL_LOG_KEY, PANEL_LOG_LIMIT, {
    type,
    openTabId: panelState.openTabId,
    revision: panelState.revision,
    ...extra
  });
}

function enqueueSessionAction(fn) {
  const run = async () => {
    await hydrateSharedSession();
    return await fn();
  };
  const task = sessionActionQueue.then(run, run);
  sessionActionQueue = task.catch(() => {});
  return task;
}

async function sendToTab(tabId, message) {
  if (!Number.isInteger(tabId)) return false;
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    return false;
  }
}

async function broadcastSharedSession() {
  await hydratePanelState();
  if (!Number.isInteger(panelState.openTabId)) return;
  await sendToTab(panelState.openTabId, {
    type: "JPDB_SHARED_SESSION_CHANGED",
    state: publicSharedSession()
  });
}

async function updateSharedSession(patch, { broadcast = true } = {}) {
  await hydrateSharedSession();
  sharedSession = {
    ...sharedSession,
    ...patch,
    revision: (Number(sharedSession.revision) || 0) + 1
  };
  await persistSharedSession();
  if (broadcast) await broadcastSharedSession();
  return publicSharedSession();
}

async function saveDiagnostics(extra = {}) {
  await chrome.storage.local.set({
    diagnostics: {
      vocabularyCount: memory.vocabIds.length,
      eligibleCount: memory.cards.length,
      lastSync: memory.statesCachedAt || null,
      dueAtSupported: memory.dueAtSupported,
      lastError: memory.lastError,
      ...extra
    }
  });
}

async function jpdbRequest(path, body, { allowEmpty = false } = {}) {
  const { apiKey } = await getSettings();
  if (!apiKey) throw new Error("JPDB API key is not configured.");

  const response = await fetch(`${API_BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`JPDB ${path} failed (${response.status})${text ? `: ${text.slice(0, 180)}` : ""}`);
  }

  if (allowEmpty && response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function testConnection() {
  try {
    await jpdbRequest("/ping", undefined, { allowEmpty: true });
  } catch {
    await jpdbRequest("/list-user-decks", { fields: ["id", "name"] });
  }
  return true;
}

async function loadVocabularyIds(force = false) {
  const now = Date.now();
  if (!force && memory.vocabIds.length && now - memory.vocabCachedAt < VOCAB_CACHE_TTL_MS) {
    return memory.vocabIds;
  }

  const decksResponse = await jpdbRequest("/list-user-decks", { fields: ["id", "name"] });
  const decks = Array.isArray(decksResponse?.decks) ? decksResponse.decks : [];
  const unique = new Map();

  for (const deck of decks) {
    const deckId = Array.isArray(deck) ? deck[0] : null;
    if (!Number.isFinite(deckId)) continue;
    const response = await jpdbRequest("/deck/list-vocabulary", { id: deckId });
    const vocab = Array.isArray(response?.vocabulary) ? response.vocabulary : [];
    for (const pair of vocab) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const [vid, sid] = pair;
      if (!Number.isFinite(vid) || !Number.isFinite(sid)) continue;
      unique.set(`${vid}:${sid}`, [vid, sid]);
    }
    await sleep(120);
  }

  memory.vocabIds = [...unique.values()];
  memory.vocabCachedAt = now;
  await chrome.storage.local.set({
    vocabCache: memory.vocabIds,
    vocabCachedAt: memory.vocabCachedAt
  });
  return memory.vocabIds;
}

async function hydratePersistentCache() {
  if (memory.vocabIds.length) return;
  const stored = await chrome.storage.local.get(["vocabCache", "vocabCachedAt"]);
  if (Array.isArray(stored.vocabCache)) {
    memory.vocabIds = stored.vocabCache;
    memory.vocabCachedAt = Number(stored.vocabCachedAt) || 0;
  }
}

function rowsToCards(ids, rows, fields) {
  return rows.map((row, i) => {
    const card = { vid: ids[i]?.[0], sid: ids[i]?.[1] };
    fields.forEach((field, idx) => {
      card[field] = Array.isArray(row) ? row[idx] : undefined;
    });
    return card;
  }).filter((card) => Number.isFinite(card.vid) && Number.isFinite(card.sid));
}

async function lookupBatch(ids, includeDueAt = true) {
  const fields = includeDueAt
    ? ["spelling", "reading", "meanings", "card_state", "due_at"]
    : ["spelling", "reading", "meanings", "card_state"];

  const response = await jpdbRequest("/lookup-vocabulary", { list: ids, fields });
  const rows = Array.isArray(response?.vocabulary_info) ? response.vocabulary_info : [];
  return rowsToCards(ids, rows, fields);
}

async function lookupCards(ids) {
  const result = [];
  let includeDueAt = memory.dueAtSupported !== false;

  for (let i = 0; i < ids.length; i += LOOKUP_BATCH_SIZE) {
    const batch = ids.slice(i, i + LOOKUP_BATCH_SIZE);
    try {
      const cards = await lookupBatch(batch, includeDueAt);
      if (includeDueAt && memory.dueAtSupported == null) memory.dueAtSupported = true;
      result.push(...cards);
    } catch (error) {
      if (includeDueAt) {
        includeDueAt = false;
        memory.dueAtSupported = false;
        const cards = await lookupBatch(batch, false);
        result.push(...cards);
      } else {
        throw error;
      }
    }
    if (i + LOOKUP_BATCH_SIZE < ids.length) await sleep(BATCH_DELAY_MS);
  }

  return result;
}

async function refreshCards({ forceVocabulary = false, forceStates = false } = {}) {
  if (memory.refreshPromise) return memory.refreshPromise;
  memory.refreshPromise = (async () => {
    try {
      await hydratePersistentCache();
      const ids = await loadVocabularyIds(forceVocabulary);
      const now = Date.now();
      if (!forceStates && memory.statesCachedAt && now - memory.statesCachedAt < STATE_CACHE_TTL_MS) {
        return memory.cards;
      }
      const allCards = await lookupCards(ids);
      memory.cards = sortReviewableCards(allCards, now);
      memory.statesCachedAt = now;
      memory.lastError = null;
      await saveDiagnostics();
      return memory.cards;
    } catch (error) {
      memory.lastError = String(error?.message || error);
      await saveDiagnostics();
      throw error;
    } finally {
      memory.refreshPromise = null;
    }
  })();
  return memory.refreshPromise;
}

async function canReview() {
  const settings = await getSettings();
  if (!settings.enabled) return { ok: false, reason: "disabled" };
  if (!settings.apiKey) return { ok: false, reason: "no-api-key" };
  return { ok: true };
}

async function chooseNextCard({ refreshIfStale = false } = {}) {
  await hydrateSharedSession();

  if (sharedSession.card) {
    return {
      card: sharedSession.card,
      revealed: Boolean(sharedSession.revealed),
      reason: "shared-pending",
      state: publicSharedSession()
    };
  }

  const eligibility = await canReview();
  if (!eligibility.ok) {
    return { card: null, reason: eligibility.reason, state: publicSharedSession() };
  }

  if (
    !memory.cards.length ||
    !memory.statesCachedAt ||
    (refreshIfStale && Date.now() - memory.statesCachedAt >= STATE_CACHE_TTL_MS)
  ) {
    await refreshCards({ forceStates: Boolean(refreshIfStale && memory.statesCachedAt) });
  }

  let card = memory.cards[0] || null;
  if (!card && memory.statesCachedAt) {
    // A long manual session may exhaust the in-memory queue just as new learning
    // cards become due. Do one authoritative refresh before declaring completion.
    await refreshCards({ forceStates: true });
    card = memory.cards[0] || null;
  }

  if (!card) {
    return { card: null, reason: "no-reviewable-cards", state: publicSharedSession() };
  }

  const state = await updateSharedSession({ card, revealed: false });
  return { card, revealed: false, reason: "ready", state };
}

async function markRevealed({ vid, sid, revision }) {
  return await enqueueSessionAction(async () => {
    const status = validateCardAction(sharedSession, { vid, sid, revision });
    if (!status.valid) {
      await logAction("reveal-ignored", { reason: status.reason, requestedRevision: revision });
      return publicSharedSession();
    }
    const state = await updateSharedSession({ revealed: true });
    await logAction("reveal-accepted", { requestedRevision: revision });
    return state;
  });
}

async function submitReview({ vid, sid, grade, revision }) {
  if (!Number.isFinite(vid) || !Number.isFinite(sid)) throw new Error("Invalid JPDB card IDs.");
  if (!REVIEW_GRADES.includes(grade)) throw new Error("Invalid JPDB review grade.");

  await hydrateSharedSession();
  const status = validateCardAction(sharedSession, { vid, sid, revision, requireRevealed: true });
  if (!status.valid) {
    await logAction("review-ignored", { reason: status.reason, requestedRevision: revision, vid, sid });
    return { ok: true, ignored: true, reason: status.reason, state: publicSharedSession() };
  }

  const actionKey = `${revision}:${vid}:${sid}`;
  const existing = reviewSubmissionPromises.get(actionKey);
  if (existing) return await existing;

  const task = enqueueSessionAction(async () => {
    // Re-validate inside the serialized queue in case another tab/action got there first.
    const queuedStatus = validateCardAction(sharedSession, { vid, sid, revision, requireRevealed: true });
    if (!queuedStatus.valid) {
      return { ok: true, ignored: true, reason: queuedStatus.reason, state: publicSharedSession() };
    }

    await jpdbRequest("/review", { vid, sid, grade }, { allowEmpty: true });

    memory.cards = memory.cards.filter((c) => !(c.vid === vid && c.sid === sid));
    try {
      const refreshed = await lookupCards([[vid, sid]]);
      const reviewableAgain = sortReviewableCards(refreshed, Date.now());
      if (reviewableAgain.length) {
        const without = memory.cards.filter((c) => !(c.vid === vid && c.sid === sid));
        memory.cards = sortReviewableCards([...without, ...reviewableAgain], Date.now());
      }
    } catch (error) {
      console.debug("Ambient JPDB targeted refresh failed:", error);
    }

    await updateSharedSession({ card: null, revealed: false }, { broadcast: false });
    const next = await chooseNextCard({ refreshIfStale: false });
    await saveDiagnostics();
    await logAction("review-accepted", { requestedRevision: revision, vid, sid, grade });
    return { ok: true, ...next };
  });

  reviewSubmissionPromises.set(actionKey, task);
  try {
    return await task;
  } finally {
    reviewSubmissionPromises.delete(actionKey);
  }
}

async function resetRevealOnClose() {
  await hydrateSharedSession();
  if (sharedSession.card && sharedSession.revealed) {
    await updateSharedSession({ revealed: false }, { broadcast: false });
  }
}

async function togglePanel(sender) {
  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error("Unable to identify the current ChatGPT tab.");

  await hydratePanelState();
  const previousTabId = panelState.openTabId;
  const result = togglePanelForTab(panelState, tabId);
  panelState = result.state;
  await persistPanelState();

  if (!result.open) {
    await resetRevealOnClose();
    await logPanel("panel-closed", { tabId });
    return { open: false, panelRevision: panelState.revision, state: publicSharedSession() };
  }

  if (Number.isInteger(previousTabId) && previousTabId !== tabId) {
    await sendToTab(previousTabId, {
      type: "JPDB_PANEL_FORCE_CLOSE",
      panelRevision: panelState.revision
    });
  }

  const next = await chooseNextCard({ refreshIfStale: true });
  await logPanel("panel-opened", { tabId, previousTabId });
  return {
    open: true,
    panelRevision: panelState.revision,
    ...next
  };
}

async function closePanel(sender) {
  const tabId = sender?.tab?.id;
  await hydratePanelState();
  const next = closePanelForTab(panelState, tabId);
  const changed = next.revision !== panelState.revision;
  panelState = next;
  if (changed) {
    await persistPanelState();
    await resetRevealOnClose();
    await logPanel("panel-closed", { tabId });
  }
  return { open: false, panelRevision: panelState.revision, state: publicSharedSession() };
}

async function getPanelState(sender) {
  await hydratePanelState();
  await hydrateSharedSession();
  const tabId = sender?.tab?.id;
  return {
    open: Number.isInteger(tabId) && panelState.openTabId === tabId,
    panelRevision: panelState.revision,
    state: publicSharedSession()
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (existing[key] === undefined) patch[key] = value;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

async function ensureCurrentContentScript(tabId) {
  if (!Number.isInteger(tabId)) return false;
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: "JPDB_UI_PROBE" });
    if (result?.ready) return true;
  } catch {
    // Old/inactive extension instance or no content script yet.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return true;
  } catch (error) {
    console.debug("Ambient JPDB content re-injection failed:", tabId, error);
    return false;
  }
}

async function restoreOpenChatGPTTabs() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: CHATGPT_TAB_PATTERNS });
  } catch (error) {
    console.debug("Ambient JPDB open-tab query failed:", error);
    return;
  }
  for (const tab of tabs) {
    if (Number.isInteger(tab?.id)) await ensureCurrentContentScript(tab.id);
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await hydratePanelState();
  if (panelState.openTabId !== tabId) return;
  panelState = { openTabId: null, revision: panelState.revision + 1 };
  await persistPanelState();
  await resetRevealOnClose();
  await logPanel("panel-tab-removed", { tabId });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "JPDB_TOGGLE_PANEL":
        return await togglePanel(sender);
      case "JPDB_CLOSE_PANEL":
        return await closePanel(sender);
      case "JPDB_GET_PANEL_STATE":
        return await getPanelState(sender);
      case "JPDB_GET_SHARED_SESSION":
        await hydrateSharedSession();
        return { state: publicSharedSession() };
      case "JPDB_MARK_REVEALED":
        return { state: await markRevealed(message) };
      case "JPDB_SUBMIT_REVIEW":
        return await submitReview(message);
      case "JPDB_TEST_CONNECTION":
        await testConnection();
        return { ok: true };
      case "JPDB_FORCE_SYNC": {
        await refreshCards({ forceVocabulary: true, forceStates: true });
        await hydrateSharedSession();
        if (sharedSession.card) {
          const stillEligible = memory.cards.some((c) => c.vid === sharedSession.card.vid && c.sid === sharedSession.card.sid);
          if (!stillEligible) await updateSharedSession({ card: null, revealed: false });
        }
        return {
          ok: true,
          count: memory.cards.length,
          dueAtSupported: memory.dueAtSupported,
          state: publicSharedSession()
        };
      }
      case "JPDB_GET_DIAGNOSTICS": {
        await hydratePanelState();
        await hydrateSharedSession();
        const stored = await chrome.storage.session.get([ACTION_LOG_KEY, PANEL_LOG_KEY]);
        return {
          panel: panelState,
          session: publicSharedSession(),
          actionEvents: Array.isArray(stored?.[ACTION_LOG_KEY]) ? stored[ACTION_LOG_KEY] : [],
          panelEvents: Array.isArray(stored?.[PANEL_LOG_KEY]) ? stored[PANEL_LOG_KEY] : []
        };
      }
      default:
        throw new Error("Unknown extension message.");
    }
  })().then((result) => sendResponse({ success: true, ...result }))
    .catch((error) => sendResponse({ success: false, error: String(error?.message || error) }));
  return true;
});

restoreOpenChatGPTTabs().catch((error) =>
  console.debug("Ambient JPDB runtime restore:", error)
);
