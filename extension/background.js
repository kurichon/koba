import { REVIEW_GRADES, sortReviewableCards, cardKey, hasAuthoritativeCardChange } from "./lib.js";
import { normalizeReviewSession, validateCardAction } from "./session.js";
import { normalizePanelState, setPanelForTab } from "./panel.js";
import { initializeUpdates, handleUpdateMessage } from "./updates.js";

const API_BASE = "https://jpdb.io/api/v1";
const DEFAULTS = { enabled: true, apiKey: "" };
const VOCAB_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const STATE_CACHE_TTL_MS = 2 * 60 * 1000;
const READ_TIMEOUT_MS = 8000;
const WRITE_TIMEOUT_MS = 12000;
const LOOKUP_BATCH_SIZE = 400;
const BATCH_DELAY_MS = 350;
const MAX_CACHED_CARDS = 1000;
const MAX_QUARANTINES = 32;
const MAX_RECENT_GRADES = 64;
// Refresh before the 2-minute cache expires, but only while the user is active.
// Keep this at one sequential JPDB scan, never parallel/burst lookups.
const WARM_REFRESH_AGE_MS = 70_000;
const WARM_LOW_QUEUE_AGE_MS = 20_000;
const WARM_LOW_QUEUE_SIZE = 4;
const WARM_REFRESH_COOLDOWN_MS = 60_000;
const SHARED_SESSION_KEY = "sharedReviewSessionV3";
const PANEL_STATE_KEY = "reviewPanelV3";
const CACHE_KEY = "jpdbReviewCacheV4";
const JOURNAL_PREFIX = "jpdbReviewRecoveryV4:";
const ACTION_LOG_KEY = "reviewSessionActionLogV3";
const PANEL_LOG_KEY = "reviewPanelLogV3";
const CHATGPT_TAB_PATTERNS = ["https://chatgpt.com/*", "https://chat.openai.com/*"];

let settings = null;
let accountScope = "";
let accountGeneration = 0;
let initialized = false;
let panelState = normalizePanelState(null);
let sharedSession = normalizeReviewSession(null);
let journal = { active: null, quarantines: [], lastOutcome: null };
let memory = emptyMemory();
let mutationQueue = Promise.resolve();
let loadJob = null;
let warmJob = null;
let lastWarmStartedAt = 0;
let loadSequence = 0;
let reconcileJob = null;
const activeControllers = new Set();
const copy = value => JSON.parse(JSON.stringify(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function emptyMemory() {
  return { vocabIds: [], vocabCachedAt: 0, cards: [], statesCachedAt: 0,
    dueAtSupported: null, truncated: false, needsRefill: false, lastError: null,
    recentGrades: [], lastGradeRequestMs: null, lastAdvanceMs: null,
    lastWarmRefreshMs: null, lastForegroundMs: null, warmRefreshes: 0, warmFailures: 0 };
}

class RequestError extends Error {
  constructor(code, message, { retryable = false, status = 0, detail = "", ambiguous = false } = {}) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    this.detail = detail;
    this.ambiguous = ambiguous;
  }
}

function publicError(error) {
  return { code: error?.code || "REQUEST_FAILED",
    message: String(error?.message || error || "The request failed."),
    retryable: Boolean(error?.retryable) };
}

function context() {
  return { scope: accountScope, generation: accountGeneration, apiKey: settings?.apiKey || "" };
}

function current(ctx) {
  return ctx.scope === accountScope && ctx.generation === accountGeneration;
}

function requireCurrent(ctx) {
  if (!current(ctx)) throw new RequestError("ACCOUNT_CHANGED", "The API key changed. This old request was discarded.");
}

async function scopeForKey(key) {
  if (!key) return "unconfigured";
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function journalKey() {
  return JOURNAL_PREFIX + accountScope;
}

function touch(patch = {}) {
  sharedSession = { ...sharedSession, ...patch, revision: sharedSession.revision + 1 };
  refreshSubmissionView();
}

function refreshSubmissionView() {
  const active = journal.active;
  sharedSession.submission = active ? {
    status: active.status === "saving" ? "saving" : "uncertain",
    attemptId: active.attemptId, vid: active.card.vid, sid: active.card.sid,
    grade: active.grade,
    message: active.status === "saving" ? "Saving your review…" :
      "The result of this review is unknown. Check its status, or continue without sending it again.",
    canContinue: active.status !== "saving" && journal.quarantines.length < MAX_QUARANTINES
  } : null;
  sharedSession.recoveryCount = journal.quarantines.length;
  sharedSession.lastOutcome = journal.lastOutcome || null;
}

function publicSharedSession() {
  refreshSubmissionView();
  return copy(sharedSession);
}

function snapshot(tabId, { forcedClose = false } = {}) {
  return {
    open: Number.isInteger(tabId) && panelState.openTabId === tabId,
    openTabId: panelState.openTabId, ownerTabId: panelState.openTabId,
    panelRevision: panelState.revision,
    intentId: forcedClose ? null : panelState.intents?.[tabId]?.id || null,
    state: publicSharedSession()
  };
}

function sendToTab(tabId, message) {
  if (!Number.isInteger(tabId)) return;
  try { Promise.resolve(chrome.tabs.sendMessage(tabId, message)).catch(() => {}); } catch {}
}

function publish({ previousOwner = null, caller = null, panel = false } = {}) {
  const type = panel ? "JPDB_PANEL_STATE_CHANGED" : "JPDB_SHARED_SESSION_CHANGED";
  const targets = new Set([panelState.openTabId, previousOwner, caller]);
  for (const tabId of targets) {
    if (!Number.isInteger(tabId)) continue;
    const forcedClose = tabId === previousOwner && tabId !== panelState.openTabId;
    sendToTab(tabId, { type, ...snapshot(tabId, { forcedClose }) });
  }
}

async function persistSession() {
  await chrome.storage.session.set({ [SHARED_SESSION_KEY]: { ...publicSharedSession(), scope: accountScope } });
}

async function persistPanel() {
  await chrome.storage.session.set({ [PANEL_STATE_KEY]: panelState });
}

function cachedValue() {
  return {
    scope: accountScope, vocabIds: memory.vocabIds, vocabCachedAt: memory.vocabCachedAt,
    cards: memory.cards.slice(0, MAX_CACHED_CARDS), statesCachedAt: memory.statesCachedAt,
    dueAtSupported: memory.dueAtSupported,
    truncated: memory.truncated || memory.cards.length > MAX_CACHED_CARDS,
    needsRefill: memory.needsRefill,
    recentGrades: memory.recentGrades.slice(-MAX_RECENT_GRADES)
  };
}

async function persistAccount({ cache = false, recovery = false } = {}) {
  const values = {};
  if (cache) values[CACHE_KEY] = cachedValue();
  if (recovery && settings?.apiKey) values[journalKey()] = journal;
  if (Object.keys(values).length) await chrome.storage.local.set(values);
}

async function logEvent(key, type, extra = {}) {
  try {
    const data = await chrome.storage.session.get([key]);
    const list = Array.isArray(data[key]) ? data[key] : [];
    list.push({ at: Date.now(), type, revision: sharedSession.revision,
      openTabId: panelState.openTabId, ...extra });
    await chrome.storage.session.set({ [key]: list.slice(-50) });
  } catch {}
}

async function saveDiagnostics() {
  try {
    await chrome.storage.local.set({ diagnostics: {
      vocabularyCount: memory.vocabIds.length,
      eligibleCount: eligibleCards().length,
      lastSync: memory.statesCachedAt || null,
      dueAtSupported: memory.dueAtSupported,
      lastError: memory.lastError,
      recoveryCount: journal.quarantines.length,
      submissionStatus: journal.active?.status || null,
      warmRefreshActive: Boolean(warmJob),
      lastGradeRequestMs: memory.lastGradeRequestMs,
      lastAdvanceMs: memory.lastAdvanceMs,
      lastWarmRefreshMs: memory.lastWarmRefreshMs,
      lastForegroundMs: memory.lastForegroundMs,
      warmRefreshes: memory.warmRefreshes,
      warmFailures: memory.warmFailures
    } });
  } catch {}
}

function cancelLoad() {
  if (loadJob) loadJob.controller.abort();
  loadJob = null;
  loadSequence++;
}

function cancelWarmRefresh() {
  if (warmJob) warmJob.controller.abort();
  warmJob = null;
}

async function syncSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  const next = { enabled: stored.enabled !== false, apiKey: String(stored.apiKey || "").trim() };
  if (!initialized) {
    const data = await chrome.storage.session.get([PANEL_STATE_KEY, SHARED_SESSION_KEY]);
    panelState = normalizePanelState(data[PANEL_STATE_KEY]);
    sharedSession = normalizeReviewSession(data[SHARED_SESSION_KEY]);
    initialized = true;
  }
  if (!settings || next.apiKey !== settings.apiKey) {
    const previousRevision = sharedSession.revision;
    const previousOwner = panelState.openTabId;
    accountGeneration++;
    cancelLoad();
    cancelWarmRefresh();
    lastWarmStartedAt = 0;
    if (reconcileJob) reconcileJob.controller.abort();
    reconcileJob = null;
    for (const controller of activeControllers) controller.abort();
    settings = next;
    accountScope = await scopeForKey(next.apiKey);
    const data = await chrome.storage.local.get([CACHE_KEY, journalKey()]);
    const oldSession = await chrome.storage.session.get([SHARED_SESSION_KEY]);
    const storedSession = oldSession[SHARED_SESSION_KEY];
    sharedSession = normalizeReviewSession(storedSession?.scope === accountScope ? storedSession : null);
    sharedSession.revision = Math.max(previousRevision, sharedSession.revision) + 1;
    sharedSession.loading = false;
    sharedSession.progress = null;
    sharedSession.error = null;
    memory = emptyMemory();
    const cache = data[CACHE_KEY];
    if (cache?.scope === accountScope) {
      memory.vocabIds = Array.isArray(cache.vocabIds) ? cache.vocabIds : [];
      memory.vocabCachedAt = Number(cache.vocabCachedAt) || 0;
      memory.cards = Array.isArray(cache.cards) ? cache.cards : [];
      memory.statesCachedAt = Number(cache.statesCachedAt) || 0;
      memory.dueAtSupported = typeof cache.dueAtSupported === "boolean" ? cache.dueAtSupported : null;
      memory.truncated = Boolean(cache.truncated);
      memory.needsRefill = Boolean(cache.needsRefill);
      memory.recentGrades = Array.isArray(cache.recentGrades) ? cache.recentGrades
        .filter(item => validCard(item?.card) && Number.isFinite(item?.acceptedAt))
        .slice(-MAX_RECENT_GRADES) : [];
    }
    const saved = data[journalKey()];
    journal = {
      active: saved?.active?.card && saved.active.attemptId ? saved.active : null,
      quarantines: Array.isArray(saved?.quarantines) ? saved.quarantines.slice(0, MAX_QUARANTINES) : [],
      lastOutcome: saved?.lastOutcome || null
    };
    if (journal.active) {
      // A worker never resumes a write. A surviving "saving" record means its
      // outcome is unknown even if the previous worker received no response.
      journal.active.status = "uncertain";
      sharedSession.card = journal.active.card;
      sharedSession.revealed = true;
      await persistAccount({ recovery: true });
    } else if (journal.lastOutcome?.status === "accepted" &&
      cardKey(sharedSession.card) === journal.lastOutcome.cardKey &&
      (Number(storedSession?.revision) || 0) <= journal.lastOutcome.sessionRevision) {
      // Accepted receipt/cache commit can precede the session-storage write.
      sharedSession.card = null;
      sharedSession.revealed = false;
    }
    if (!next.apiKey) sharedSession.error = { code: "NO_API_KEY", message: "Add your JPDB API key in settings.", retryable: false };
    if (!next.enabled) sharedSession.error = { code: "DISABLED", message: "JPDB reviews are disabled in settings.", retryable: false };
    await persistSession();
    publish({ previousOwner });
  } else if (next.enabled !== settings.enabled) {
    settings = next;
    if (!next.enabled) {
      const previousOwner = panelState.openTabId;
      cancelLoad();
      cancelWarmRefresh();
      panelState = { ...panelState, openTabId: null, revision: panelState.revision + 1 };
      touch({ loading: false, revealed: false,
        error: { code: "DISABLED", message: "JPDB reviews are disabled in settings.", retryable: false } });
      await persistPanel();
      await persistSession();
      publish({ previousOwner, panel: true });
    } else {
      touch({ error: null });
      await persistSession();
      publish();
    }
  }
}

function mutate(fn) {
  const task = mutationQueue.then(async () => {
    await syncSettings();
    return await fn();
  });
  mutationQueue = task.catch(() => {});
  return task;
}

function requireEnabled() {
  if (!settings.enabled) throw new RequestError("DISABLED", "JPDB reviews are disabled in settings.");
  if (!settings.apiKey) throw new RequestError("NO_API_KEY", "Add your JPDB API key in settings.");
}

function validCard(card) {
  return Number.isFinite(card?.vid) && Number.isFinite(card?.sid);
}

function recentGradeCard(card) {
  return { vid: card.vid, sid: card.sid,
    card_state: Array.isArray(card.card_state) ? card.card_state.slice(0, 4) : [],
    due_at: card.due_at ?? null };
}

function acceptRecentlyGraded(card) {
  memory.recentGrades = memory.recentGrades.filter(entry => cardKey(entry.card) !== cardKey(card));
  memory.recentGrades.push({ card: recentGradeCard(card), acceptedAt: Date.now() });
  memory.recentGrades = memory.recentGrades.slice(-MAX_RECENT_GRADES);
}

// A newly accepted grade can be visible as "due" in an eventually consistent
// lookup. Only an authoritative change in card state or due_at may release it.
function applyVerifiedRecentGrades(cards) {
  const byKey = new Map(cards.map(card => [cardKey(card), card]));
  memory.recentGrades = memory.recentGrades.filter(entry =>
    !hasAuthoritativeCardChange(entry.card, byKey.get(cardKey(entry.card))));
  const blocked = new Set(memory.recentGrades.map(entry => cardKey(entry.card)));
  return cards.filter(card => !blocked.has(cardKey(card)));
}

function eligibleCards() {
  const withheld = new Set(journal.quarantines.map(item => cardKey(item.card)));
  if (journal.active) withheld.add(cardKey(journal.active.card));
  return sortReviewableCards(memory.cards).filter(card => validCard(card) && !withheld.has(cardKey(card)));
}

function cacheFresh() {
  return memory.statesCachedAt > 0 && Date.now() - memory.statesCachedAt < STATE_CACHE_TTL_MS && !memory.needsRefill;
}

function selectCachedCard() {
  if (journal.active) {
    sharedSession.card = journal.active.card;
    return;
  }
  const cards = eligibleCards();
  if (sharedSession.card && cards.some(card => cardKey(card) === cardKey(sharedSession.card))) {
    // Preserve the review front/back while its authoritative cached entry is valid.
    sharedSession.card = cards.find(card => cardKey(card) === cardKey(sharedSession.card));
    return;
  }
  sharedSession.card = cards[0] || null;
  sharedSession.revealed = false;
}

function prepareLoad({ forceVocabulary = false, forceStates = false } = {}) {
  if (!settings.enabled || !settings.apiKey || journal.active) {
    sharedSession.loading = false;
    sharedSession.progress = null;
    return null;
  }
  if (loadJob) {
    if (!forceVocabulary || loadJob.forceVocabulary) return loadJob;
    // An explicit full sync must refresh deck membership even when an ordinary
    // state refresh is already using cached vocabulary IDs. Its aborted result
    // is rejected by the existing job-identity guard in runLoad.
    cancelLoad();
  }
  if (warmJob && !forceVocabulary) {
    // Reuse the already-running complete read instead of sending the same
    // request sequence again when the visible queue is exhausted.
    if (!cacheFresh() || forceStates || !sharedSession.card) {
      warmJob.promoted = true;
      sharedSession.loading = true;
      sharedSession.progress = { phase: "reviews", completed: warmJob.completed,
        total: warmJob.ids.length, startedAt: warmJob.startedAt };
    }
    return warmJob;
  }
  if (warmJob) cancelWarmRefresh();
  if (!forceVocabulary && !forceStates && cacheFresh()) {
    selectCachedCard();
    sharedSession.loading = false;
    sharedSession.progress = null;
    sharedSession.error = null;
    return null;
  }
  const job = { id: ++loadSequence, ctx: context(), controller: new AbortController(),
    forceVocabulary, forceStates, promise: null, started: false, startedAt: Date.now(), lastProgress: null,
    snapshot: { vocabIds: copy(memory.vocabIds), vocabCachedAt: memory.vocabCachedAt,
      dueAtSupported: forceVocabulary || Date.now() - memory.vocabCachedAt >= VOCAB_CACHE_TTL_MS
        ? null : memory.dueAtSupported } };
  loadJob = job;
  sharedSession.loading = true;
  sharedSession.progress = { phase: "decks", completed: 0, total: null, startedAt: job.startedAt };
  sharedSession.error = null;
  return job;
}

function maybeWarmRefresh() {
  if (warmJob || loadJob || !settings?.enabled || !settings.apiKey ||
    journal.active || panelState.openTabId === null || !sharedSession.card ||
    !memory.vocabIds.length || !memory.statesCachedAt || memory.needsRefill) return;
  const age = Date.now() - memory.statesCachedAt;
  const lowQueue = eligibleCards().length <= WARM_LOW_QUEUE_SIZE;
  if (age < WARM_REFRESH_AGE_MS && !(lowQueue && age >= WARM_LOW_QUEUE_AGE_MS)) return;
  if (Date.now() - lastWarmStartedAt < WARM_REFRESH_COOLDOWN_MS) return;
  const job = { ctx: context(), controller: new AbortController(), startedAt: Date.now(),
    ids: copy(memory.vocabIds), dueAtSupported: memory.dueAtSupported,
    completed: 0, promoted: false, started: true, promise: null };
  warmJob = job;
  lastWarmStartedAt = job.startedAt;
  job.promise = runWarmRefresh(job);
}

async function runWarmRefresh(job) {
  try {
    const result = await lookupCards(job.ctx, job.ids, job.dueAtSupported, job.controller.signal,
      async completed => {
        job.completed = completed;
        if (!job.promoted || warmJob !== job) return;
        await mutate(async () => {
          if (warmJob !== job || !current(job.ctx) || job.controller.signal.aborted) return;
          touch({ progress: { phase: "reviews", completed, total: job.ids.length,
            startedAt: job.startedAt } });
          await persistSession();
          publish();
        });
      });
    await mutate(async () => {
      if (warmJob !== job || !current(job.ctx) || job.controller.signal.aborted) return;
      const previous = JSON.stringify(sharedSession.card);
      const old = { cards: memory.cards, recentGrades: memory.recentGrades,
        statesCachedAt: memory.statesCachedAt, dueAtSupported: memory.dueAtSupported,
        needsRefill: memory.needsRefill, truncated: memory.truncated };
      memory.cards = sortReviewableCards(applyVerifiedRecentGrades(result.cards));
      memory.statesCachedAt = Date.now();
      memory.dueAtSupported = result.dueAtSupported;
      memory.needsRefill = false;
      memory.truncated = false;
      try { await persistAccount({ cache: true, recovery: true }); }
      catch (error) { Object.assign(memory, old); throw error; }
      memory.lastWarmRefreshMs = Date.now() - job.startedAt;
      memory.warmRefreshes++;
      if (!journal.active) selectCachedCard();
      // A refresh in the background must not invalidate an in-progress Reveal
      // or grade merely because it finished another batch of JPDB reads.
      if (job.promoted || JSON.stringify(sharedSession.card) !== previous) {
        touch({ loading: false, progress: null, error: null });
        await persistSession();
        publish();
      }
      warmJob = null;
      await saveDiagnostics();
    });
  } catch (error) {
    await mutate(async () => {
      if (warmJob !== job || !current(job.ctx)) return;
      warmJob = null;
      if (job.controller.signal.aborted) return;
      memory.warmFailures++;
      memory.lastWarmRefreshMs = Date.now() - job.startedAt;
      if (job.promoted) {
        memory.lastError = error.message;
        touch({ loading: false, progress: null, error: publicError(error) });
        await persistSession().catch(() => {});
        publish();
      }
      await saveDiagnostics();
    }).catch(() => {});
  }
}

async function reportLoadProgress(job, phase, completed, total) {
  if (loadJob !== job || job.controller.signal.aborted || !current(job.ctx)) return;
  const now = Date.now();
  // Every stage change, first batch, and terminal batch is visible. Intermediate
  // batches are coalesced to avoid repeatedly serializing the entire session.
  const previous = job.lastProgress;
  if (previous?.phase === phase && completed !== total && previous.completed > 0 &&
    now - previous.at < 500) return;
  job.lastProgress = { phase, completed, total, at: now };
  await mutate(async () => {
    if (loadJob !== job || job.controller.signal.aborted || !current(job.ctx)) return;
    touch({ progress: { phase, completed, total, startedAt: job.startedAt } });
    await persistSession();
    publish();
  });
}

function launchLoad(job) {
  if (job && !job.started) {
    job.started = true;
    job.promise = runLoad(job);
  }
  return job?.promise || Promise.resolve();
}

async function boundedFetch(ctx, path, body, { write = false, signal } = {}) {
  requireCurrent(ctx);
  if (!ctx.apiKey) throw new RequestError("NO_API_KEY", "Add your JPDB API key in settings.");
  const controller = new AbortController();
  activeControllers.add(controller);
  let timer;
  let stop;
  const stopped = new Promise((_, reject) => {
    stop = () => { controller.abort(); reject(new RequestError("CANCELLED", "The request was cancelled.", { ambiguous: write })); };
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    timer = setTimeout(() => {
      reject(new RequestError("TIMEOUT", write ?
        "JPDB did not confirm the review in time. Its result is unknown." :
        "JPDB is taking too long to respond. Try again.", { retryable: !write, ambiguous: write }));
      controller.abort();
    }, write ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS);
  });
  // Account changes abort the same controller even when no job signal exists.
  let accountAbort;
  const cancelled = new Promise((_, reject) => {
    accountAbort = () => reject(new RequestError("CANCELLED", "The request was cancelled.", { ambiguous: write }));
    controller.signal.addEventListener("abort", accountAbort, { once: true });
  });
  try {
    const operation = (async () => {
      let response;
      try {
        response = await fetch(API_BASE + path, {
          method: body === undefined ? "GET" : "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json",
            Authorization: "Bearer " + ctx.apiKey },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        });
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new RequestError("NETWORK", write ?
          "The connection ended before JPDB confirmed this review. Its result is unknown." :
          "Could not reach JPDB. Check your connection and try again.", { retryable: !write, ambiguous: write });
      }
      if (!response.ok) {
        const raw = await response.text().catch(() => "");
        const detail = raw.split(ctx.apiKey).join("[redacted]").slice(0, 200);
        const status = response.status;
        const definiteRejection = [400, 401, 403, 404, 405, 413, 422].includes(status);
        throw new RequestError(status === 401 || status === 403 ? "AUTHENTICATION" :
          status === 429 ? "RATE_LIMITED" : "HTTP_ERROR",
          status === 401 || status === 403 ? "JPDB rejected the API key. Check it in settings." :
          "JPDB returned HTTP " + status + ".", {
            status, detail, retryable: !write && (status === 429 || status >= 500),
            ambiguous: write && !definiteRejection
          });
      }
      // A successful HTTP response is the review receipt. Do not wait for an
      // unused body after the server has accepted this non-idempotent write.
      if (write || response.status === 204) return null;
      const raw = await response.text();
      if (!raw) return null;
      try { return JSON.parse(raw); }
      catch { throw new RequestError("INVALID_RESPONSE", "JPDB returned an unreadable response.", { retryable: true }); }
    })();
    return await Promise.race([operation, stopped, cancelled]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    controller.signal.removeEventListener("abort", accountAbort);
    activeControllers.delete(controller);
  }
}

async function jpdbRequest(ctx, path, body, options = {}) {
  const attempts = options.write ? 1 : 2;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await boundedFetch(ctx, path, body, options); }
    catch (error) {
      requireCurrent(ctx);
      if (options.write || !error.retryable || attempt + 1 === attempts || options.signal?.aborted) throw error;
      await sleep(450);
    }
  }
}

function unsupportedDueAt(error) {
  return [400, 422].includes(error?.status) &&
    /due_at/i.test(error.detail || "") &&
    /(unknown|unsupported|unrecognized|invalid|not supported|not a valid)/i.test(error.detail || "");
}

function rowsToCards(ids, rows, fields) {
  return rows.map((row, index) => {
    const card = { vid: ids[index]?.[0], sid: ids[index]?.[1] };
    fields.forEach((field, fieldIndex) => { card[field] = Array.isArray(row) ? row[fieldIndex] : undefined; });
    return card;
  }).filter(validCard);
}

async function lookupBatch(ctx, ids, includeDueAt, signal) {
  const fields = ["spelling", "reading", "meanings", "card_state"];
  if (includeDueAt) fields.push("due_at");
  const data = await jpdbRequest(ctx, "/lookup-vocabulary", { list: ids, fields }, { signal });
  if (!Array.isArray(data?.vocabulary_info) || data.vocabulary_info.length !== ids.length) {
    throw new RequestError("INVALID_RESPONSE", "JPDB returned an incomplete vocabulary response.", { retryable: true });
  }
  return rowsToCards(ids, data.vocabulary_info, fields);
}

async function lookupCards(ctx, ids, dueAtSupported, signal, onBatch = async () => {}) {
  const cards = [];
  let includeDueAt = dueAtSupported !== false;
  let supported = dueAtSupported;
  for (let offset = 0; offset < ids.length; offset += LOOKUP_BATCH_SIZE) {
    requireCurrent(ctx);
    if (signal?.aborted) throw new RequestError("CANCELLED", "The request was cancelled.");
    const batch = ids.slice(offset, offset + LOOKUP_BATCH_SIZE);
    try {
      cards.push(...await lookupBatch(ctx, batch, includeDueAt, signal));
      if (includeDueAt) supported = true;
    } catch (error) {
      if (!includeDueAt || !unsupportedDueAt(error)) throw error;
      includeDueAt = false;
      supported = false;
      cards.push(...await lookupBatch(ctx, batch, false, signal));
    }
    await onBatch(Math.min(offset + LOOKUP_BATCH_SIZE, ids.length), ids.length);
    if (offset + LOOKUP_BATCH_SIZE < ids.length) await sleep(BATCH_DELAY_MS);
  }
  return { cards, dueAtSupported: supported };
}

async function loadVocabularyIds(job) {
  const now = Date.now();
  if (!job.forceVocabulary && job.snapshot.vocabCachedAt &&
    now - job.snapshot.vocabCachedAt < VOCAB_CACHE_TTL_MS) {
    return { ids: job.snapshot.vocabIds, fetchedAt: job.snapshot.vocabCachedAt };
  }
  const ctx = job.ctx;
  const signal = job.controller.signal;
  const data = await jpdbRequest(ctx, "/list-user-decks", { fields: ["id", "name"] }, { signal });
  if (!Array.isArray(data?.decks)) throw new RequestError("INVALID_RESPONSE", "JPDB returned an unreadable deck list.", { retryable: true });
  const unique = new Map();
  const deckIds = data.decks.map(deck => Array.isArray(deck) ? deck[0] : null)
    .filter(Number.isFinite);
  await reportLoadProgress(job, "vocabulary", 0, deckIds.length);
  for (let index = 0; index < deckIds.length; index++) {
    const id = deckIds[index];
    const vocabulary = await jpdbRequest(ctx, "/deck/list-vocabulary", { id }, { signal });
    if (!Array.isArray(vocabulary?.vocabulary)) throw new RequestError("INVALID_RESPONSE", "JPDB returned an unreadable vocabulary list.", { retryable: true });
    for (const pair of vocabulary.vocabulary) {
      if (Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1])) unique.set(pair[0] + ":" + pair[1], [pair[0], pair[1]]);
    }
    if (signal.aborted) throw new RequestError("CANCELLED", "The request was cancelled.");
    await reportLoadProgress(job, "vocabulary", index + 1, deckIds.length);
    if (index + 1 < deckIds.length) await sleep(120);
  }
  return { ids: [...unique.values()], fetchedAt: now };
}

function releaseChangedQuarantines(cards) {
  const byId = new Map(cards.map(card => [cardKey(card), card]));
  journal.quarantines = journal.quarantines.filter(item =>
    !hasAuthoritativeCardChange(item.card, byId.get(cardKey(item.card))));
}

async function runLoad(job) {
  try {
    const vocabulary = await loadVocabularyIds(job);
    await reportLoadProgress(job, "reviews", 0, vocabulary.ids.length);
    const result = await lookupCards(job.ctx, vocabulary.ids, job.snapshot.dueAtSupported,
      job.controller.signal, (completed, total) => reportLoadProgress(job, "reviews", completed, total));
    await mutate(async () => {
      if (!current(job.ctx) || loadJob !== job || job.controller.signal.aborted) return;
      memory.vocabIds = vocabulary.ids;
      memory.vocabCachedAt = vocabulary.fetchedAt;
      memory.cards = sortReviewableCards(applyVerifiedRecentGrades(result.cards));
      memory.statesCachedAt = Date.now();
      memory.dueAtSupported = result.dueAtSupported;
      memory.truncated = false;
      memory.needsRefill = false;
      memory.lastError = null;
      memory.lastForegroundMs = Date.now() - job.startedAt;
      releaseChangedQuarantines(result.cards);
      selectCachedCard();
      touch({ loading: false, progress: null, error: null });
      await persistAccount({ cache: true, recovery: true });
      await persistSession();
      loadJob = null;
      await saveDiagnostics();
      publish();
    });
  } catch (error) {
    await mutate(async () => {
      if (!current(job.ctx) || loadJob !== job || job.controller.signal.aborted) return;
      loadJob = null;
      memory.lastError = error.message;
      touch({ loading: false, progress: null, error: publicError(error) });
      await persistSession().catch(() => {});
      await saveDiagnostics();
      publish();
    }).catch(() => {});
  }
}

function requireTab(sender) {
  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId)) throw new RequestError("UNKNOWN_TAB", "Could not identify the ChatGPT tab.");
  return tabId;
}

function requireOwner(tabId) {
  if (panelState.openTabId !== tabId) throw new RequestError("NOT_OWNER", "This review is open in another tab.");
}

async function setPanelOpen(message, sender) {
  const tabId = requireTab(sender);
  let job;
  const reply = await mutate(async () => {
    const previousOwner = panelState.openTabId;
    panelState = setPanelForTab(panelState, tabId, Boolean(message.open), String(message.intentId || ""));
    if (panelState.openTabId === tabId) {
      if (!settings.apiKey) sharedSession.error = { code: "NO_API_KEY", message: "Add your JPDB API key in settings.", retryable: false };
      else if (!settings.enabled) sharedSession.error = { code: "DISABLED", message: "JPDB reviews are disabled in settings.", retryable: false };
      else job = prepareLoad();
    } else if (previousOwner === tabId) {
      if (!warmJob?.promoted) cancelWarmRefresh();
      if (sharedSession.revealed) sharedSession.revealed = false;
    }
    touch();
    await persistPanel();
    await persistSession();
    publish({ previousOwner, caller: tabId, panel: true });
    void logEvent(PANEL_LOG_KEY, message.open ? "panel-open-request" : "panel-close-request", { tabId });
    return snapshot(tabId);
  });
  launchLoad(job);
  maybeWarmRefresh();
  return reply;
}

async function retryLoad(sender, { forceVocabulary = false, wait = false } = {}) {
  const tabId = sender?.tab?.id;
  let job;
  const reply = await mutate(async () => {
    requireEnabled();
    if (journal.active) {
      if (wait || forceVocabulary) throw new RequestError("REVIEW_PENDING", journal.active.status === "saving" ?
        "A review is still being saved. Wait for its result before syncing." :
        "Resolve the uncertain review in the review panel, or continue without resending, before syncing.");
      return snapshot(tabId);
    }
    job = prepareLoad({ forceVocabulary, forceStates: true });
    touch();
    await persistSession();
    publish({ caller: tabId });
    return snapshot(tabId);
  });
  const promise = launchLoad(job);
  if (!wait) return { ...reply, syncStarted: Boolean(job) };
  await promise;
  return await mutate(async () => ({ ...snapshot(tabId), count: eligibleCards().length,
    dueAtSupported: memory.dueAtSupported, ok: !sharedSession.error }));
}

async function getPanelState(sender) {
  const tabId = sender?.tab?.id;
  let job;
  const reply = await mutate(async () => {
    // A reloaded page may reconnect to an open panel after the cached schedule
    // has expired. Validate before allowing another grade, without toggling it.
    if (panelState.openTabId === tabId && !journal.active && !sharedSession.error) {
      const before = JSON.stringify(sharedSession);
      job = prepareLoad();
      if (before !== JSON.stringify(sharedSession)) {
        touch();
        await persistSession();
        publish();
      }
    }
    return snapshot(tabId);
  });
  launchLoad(job);
  maybeWarmRefresh();
  return reply;
}

async function reveal(message, sender) {
  const tabId = requireTab(sender);
  const result = await mutate(async () => {
    requireEnabled();
    requireOwner(tabId);
    if (journal.active || sharedSession.loading || sharedSession.error) return snapshot(tabId);
    const valid = validateCardAction(sharedSession, message);
    if (!valid.valid) return { ...snapshot(tabId), ignored: true, reason: valid.reason };
    if (!sharedSession.revealed) {
      touch({ revealed: true });
      await persistSession();
      publish();
      void logEvent(ACTION_LOG_KEY, "reveal-accepted");
    }
    return snapshot(tabId);
  });
  maybeWarmRefresh();
  return result;
}

async function submitReview(message, sender) {
  const tabId = requireTab(sender);
  let work;
  const reply = await mutate(async () => {
    requireEnabled();
    requireOwner(tabId);
    if (journal.active) return { ...snapshot(tabId), ignored: true, reason: "submission-pending" };
    if (!validCard(message) || !REVIEW_GRADES.includes(message.grade)) throw new RequestError("INVALID_REVIEW", "Invalid review card or grade.");
    if (sharedSession.loading || sharedSession.error) return { ...snapshot(tabId), ignored: true, reason: "not-ready" };
    const valid = validateCardAction(sharedSession, { ...message, requireRevealed: true });
    if (!valid.valid) return { ...snapshot(tabId), ignored: true, reason: valid.reason };
    if (journal.quarantines.some(item => cardKey(item.card) === cardKey(sharedSession.card))) {
      throw new RequestError("QUARANTINED", "This card has an unresolved earlier review. Check its status before reviewing it again.");
    }
    cancelLoad();
    const attempt = { attemptId: crypto.randomUUID(), card: copy(sharedSession.card),
      grade: message.grade, sessionRevision: sharedSession.revision, at: Date.now(), status: "saving" };
    journal.active = attempt;
    touch({ loading: false, error: null });
    // Durable before the network write. If this fails, no POST may be sent.
    try { await persistAccount({ recovery: true }); }
    catch (error) {
      journal.active = null;
      touch({ error: { code: "STORAGE_FAILED", message: "Could not safely record this review. Nothing was sent. Try again.", retryable: true } });
      await persistSession().catch(() => {});
      return snapshot(tabId);
    }
    await persistSession().catch(() => {});
    publish();
    work = { ctx: context(), attempt: copy(attempt) };
    return snapshot(tabId);
  });
  if (work) void runReview(work);
  return reply;
}

async function runReview(work) {
  let accepted = false;
  let durablyCommitted = false;
  const startedAt = Date.now();
  try {
    await jpdbRequest(work.ctx, "/review", { vid: work.attempt.card.vid, sid: work.attempt.card.sid,
      grade: work.attempt.grade }, { write: true });
    accepted = true;
    const requestMs = Date.now() - startedAt;
    let job;
    await mutate(async () => {
      if (!current(work.ctx) || journal.active?.attemptId !== work.attempt.attemptId) return;
      memory.cards = memory.cards.filter(card => cardKey(card) !== cardKey(work.attempt.card));
      acceptRecentlyGraded(work.attempt.card);
      memory.needsRefill = eligibleCards().length === 0;
      journal.lastOutcome = { status: "accepted", attemptId: work.attempt.attemptId, at: Date.now(),
        cardKey: cardKey(work.attempt.card), sessionRevision: sharedSession.revision };
      journal.active = null;
      sharedSession.card = null;
      sharedSession.revealed = false;
      // Receipt and removal from persisted queue are committed together before
      // selecting another card or doing any optional network work.
      await persistAccount({ recovery: true, cache: true });
      durablyCommitted = true;
      memory.lastGradeRequestMs = requestMs;
      selectCachedCard();
      if (!sharedSession.card) job = prepareLoad({ forceStates: memory.needsRefill });
      touch({ error: null });
      memory.lastAdvanceMs = Date.now() - startedAt;
      await persistSession();
      await saveDiagnostics();
      publish();
      void logEvent(ACTION_LOG_KEY, "review-accepted", { attemptId: work.attempt.attemptId });
    });
    launchLoad(job);
    maybeWarmRefresh();
    // Post-grade learning/failed-state refresh is optional and cannot hold the
    // accepted grade, next card, or ownership controls hostage.
    if (!job) void refreshReviewedCard(work);
  } catch (error) {
    await mutate(async () => {
      if (!current(work.ctx)) return;
      if (durablyCommitted) {
        cancelLoad();
        touch({ loading: false, error: { code: "STORAGE_FAILED",
          message: "Your review was saved. Local state could not be refreshed; retry loading to continue.", retryable: true } });
        await persistSession().catch(() => {});
        publish();
        return;
      }
      // Restore the pending attempt if a local commit failed after HTTP success.
      if (!journal.active && accepted) journal.active = { ...work.attempt, status: "uncertain" };
      if (journal.active?.attemptId !== work.attempt.attemptId) return;
      if (accepted || error.ambiguous || ["NETWORK", "TIMEOUT", "CANCELLED"].includes(error.code)) {
        journal.active.status = "uncertain";
        sharedSession.card = work.attempt.card;
        sharedSession.revealed = true;
        touch({ loading: false, error: { code: "REVIEW_UNCERTAIN",
          message: accepted ? "JPDB accepted the review, but its local receipt could not be saved. Do not send it again. Check status or continue." :
            "JPDB did not confirm this review. Do not send it again. Check status or continue.", retryable: false } });
      } else {
        journal.active = null;
        sharedSession.card = work.attempt.card;
        sharedSession.revealed = true;
        touch({ loading: false, error: publicError(error) });
      }
      await persistAccount({ recovery: true }).catch(() => {});
      await persistSession().catch(() => {});
      await saveDiagnostics();
      publish();
      void logEvent(ACTION_LOG_KEY, journal.active ? "review-uncertain" : "review-rejected", { attemptId: work.attempt.attemptId, code: error.code });
    }).catch(() => {});
  }
}

async function refreshReviewedCard(work) {
  try {
    const result = await lookupCards(work.ctx, [[work.attempt.card.vid, work.attempt.card.sid]], memory.dueAtSupported);
    await mutate(async () => {
      if (!current(work.ctx) || journal.active || loadJob) return;
      const refreshed = result.cards[0];
      memory.cards = memory.cards.filter(card => cardKey(card) !== cardKey(work.attempt.card));
      memory.cards = sortReviewableCards([...memory.cards, ...applyVerifiedRecentGrades([refreshed])]);
      memory.dueAtSupported = result.dueAtSupported;
      await persistAccount({ cache: true });
    });
  } catch {}
}

async function reconcileReview(sender) {
  const tabId = requireTab(sender);
  let work;
  const reply = await mutate(async () => {
    requireEnabled();
    requireOwner(tabId);
    if (journal.active?.status === "saving" || reconcileJob) return snapshot(tabId);
    const entries = journal.active ? [journal.active] : journal.quarantines;
    if (!entries.length) return snapshot(tabId);
    const job = { ctx: context(), controller: new AbortController(), entries: copy(entries), activeId: journal.active?.attemptId || null };
    reconcileJob = job;
    touch({ loading: true, error: null });
    await persistSession();
    publish();
    work = job;
    return snapshot(tabId);
  });
  if (work) void runReconcile(work);
  return reply;
}

async function runReconcile(job) {
  try {
    const ids = job.entries.map(entry => [entry.card.vid, entry.card.sid]);
    const result = await lookupCards(job.ctx, ids, memory.dueAtSupported, job.controller.signal);
    let nextLoad;
    await mutate(async () => {
      if (!current(job.ctx) || reconcileJob !== job) return;
      memory.dueAtSupported = result.dueAtSupported;
      const cards = new Map(result.cards.map(card => [cardKey(card), card]));
      releaseChangedQuarantines(result.cards);
      if (journal.active && journal.active.attemptId === job.activeId) {
        const after = cards.get(cardKey(journal.active.card));
        if (hasAuthoritativeCardChange(journal.active.card, after)) {
          journal.lastOutcome = { status: "reconciled", attemptId: journal.active.attemptId, at: Date.now() };
          journal.active = null;
          sharedSession.card = null;
          sharedSession.revealed = false;
          memory.cards = sortReviewableCards([...memory.cards.filter(card => cardKey(card) !== cardKey(after)), after]);
          selectCachedCard();
          if (!sharedSession.card) nextLoad = prepareLoad({ forceStates: true });
          touch({ loading: Boolean(nextLoad), error: null });
        } else {
          touch({ loading: false, error: { code: "REVIEW_UNCERTAIN",
            message: "JPDB's card state has not changed. This does not tell us whether the review was received. You can check again or continue without resending.", retryable: false } });
        }
      } else {
        touch({ loading: false, error: null });
      }
      await persistAccount({ recovery: true, cache: true });
      await persistSession();
      reconcileJob = null;
      publish();
    });
    launchLoad(nextLoad);
  } catch (error) {
    await mutate(async () => {
      if (!current(job.ctx) || reconcileJob !== job) return;
      reconcileJob = null;
      touch({ loading: false, error: publicError(error) });
      await persistSession().catch(() => {});
      publish();
    }).catch(() => {});
  }
}

async function continueWithoutResending(sender) {
  const tabId = requireTab(sender);
  let job;
  const reply = await mutate(async () => {
    requireEnabled();
    requireOwner(tabId);
    if (!journal.active || journal.active.status === "saving") return snapshot(tabId);
    if (journal.quarantines.length >= MAX_QUARANTINES) throw new RequestError("RECOVERY_FULL",
      "There are too many unresolved reviews. Check their JPDB status before continuing.");
    if (reconcileJob) reconcileJob.controller.abort();
    reconcileJob = null;
    const active = journal.active;
    if (!journal.quarantines.some(entry => entry.attemptId === active.attemptId)) journal.quarantines.push({ ...active, status: "uncertain" });
    journal.lastOutcome = { status: "skipped", attemptId: active.attemptId, at: Date.now() };
    journal.active = null;
    sharedSession.card = null;
    sharedSession.revealed = false;
    selectCachedCard();
    if (!sharedSession.card) job = prepareLoad({ forceStates: true });
    touch({ loading: Boolean(job), error: null });
    await persistAccount({ recovery: true, cache: true });
    await persistSession();
    publish();
    return snapshot(tabId);
  });
  launchLoad(job);
  return reply;
}

async function testConnection() {
  const ctx = await mutate(async () => { requireEnabled(); return context(); });
  try { await jpdbRequest(ctx, "/ping"); }
  catch (error) {
    if (![404, 405].includes(error.status)) throw error;
    await jpdbRequest(ctx, "/list-user-decks", { fields: ["id", "name"] });
  }
  return { ok: true };
}

async function ensureCurrentContentScript(tabId) {
  if (!Number.isInteger(tabId)) return false;
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: "JPDB_UI_PROBE" });
    if (result?.ready && result.version === chrome.runtime.getManifest().version) return true;
  } catch {}
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return true;
  } catch { return false; }
}

async function restoreOpenChatGPTTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: CHATGPT_TAB_PATTERNS });
    await Promise.all(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => ensureCurrentContentScript(tab.id)));
  } catch {}
}

chrome.runtime.onInstalled.addListener(() => {
  // Never write default settings during installation: an asynchronous read of
  // missing keys can race with a new user's first save and overwrite their key.
  // Both background and options already apply DEFAULTS when reading storage.
  void restoreOpenChatGPTTabs();
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || (!changes.apiKey && !changes.enabled)) return;
  // Only state mutation is serialized; this never waits behind JPDB traffic.
  void mutate(async () => {
    const job = panelState.openTabId !== null ? prepareLoad() : null;
    touch();
    await persistSession();
    publish();
    launchLoad(job);
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(tabId => {
  void mutate(async () => {
    const previousOwner = panelState.openTabId;
    delete panelState.intents[tabId];
    if (previousOwner === tabId) {
      if (!warmJob?.promoted) cancelWarmRefresh();
      panelState = { ...panelState, openTabId: null, revision: panelState.revision + 1 };
      touch({ revealed: false });
      await persistSession();
    }
    await persistPanel();
    publish({ previousOwner, panel: true });
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const updateResult = await handleUpdateMessage(message);
    if (updateResult !== null) return updateResult;
    switch (message?.type) {
      case "JPDB_SET_PANEL_OPEN": return await setPanelOpen(message, sender);
      case "JPDB_GET_PANEL_STATE":
      case "JPDB_GET_SHARED_SESSION":
        return await getPanelState(sender);
      case "JPDB_MARK_REVEALED": return await reveal(message, sender);
      case "JPDB_SUBMIT_REVIEW": return await submitReview(message, sender);
      case "JPDB_RETRY_LOAD": return await retryLoad(sender);
      case "JPDB_RECONCILE_REVIEW": return await reconcileReview(sender);
      case "JPDB_CONTINUE_WITHOUT_RESENDING": return await continueWithoutResending(sender);
      case "JPDB_OPEN_SETTINGS":
        await chrome.runtime.openOptionsPage();
        return { ok: true };
      case "JPDB_TEST_CONNECTION": return await testConnection();
      case "JPDB_FORCE_SYNC": return await retryLoad(sender, { forceVocabulary: true, wait: message.wait !== false });
      case "JPDB_GET_DIAGNOSTICS":
        return await mutate(async () => {
          const logs = await chrome.storage.session.get([ACTION_LOG_KEY, PANEL_LOG_KEY]);
          return { ...snapshot(sender?.tab?.id), panel: copy(panelState), session: publicSharedSession(),
            eligibleCount: eligibleCards().length,
            warmRefreshActive: Boolean(warmJob),
            actionEvents: logs[ACTION_LOG_KEY] || [], panelEvents: logs[PANEL_LOG_KEY] || [] };
        });
      // Thin adapters for tabs still running the previous injected script.
      case "JPDB_TOGGLE_PANEL": {
        const state = await mutate(async () => snapshot(sender?.tab?.id));
        return await setPanelOpen({ open: !state.open, intentId: "legacy-" + crypto.randomUUID() }, sender);
      }
      case "JPDB_CLOSE_PANEL": return await setPanelOpen({ open: false, intentId: "legacy-" + crypto.randomUUID() }, sender);
      default: throw new RequestError("UNKNOWN_MESSAGE", "Unknown extension message.");
    }
  })().then(result => sendResponse({ success: true, ...result }))
    .catch(error => sendResponse({ success: false, error: error.message, errorInfo: publicError(error) }));
  return true;
});

void restoreOpenChatGPTTabs();
initializeUpdates().catch(() => {});
