(() => {
  const RETIRE_EVENT = "ambient-jpdb-retire-current-instance";
  let retired = false;
  let positionFrame = null;
  let mutationObserver = null;
  let anchorResizeObserver = null;
  let currentAnchor = null;
  // Hold the panel position during reveal/grade layout changes.
  let pinnedPopupTop = null;
  // -100 = near viewport top, 0 = original centered position, +100 = bottom.
  // Stored per browser profile; the X coordinate always comes from ChatGPT.
  let launcherPositionY = 0;
  let movePopupWithLauncher = false;
  let launcherDrag = null;
  let suppressLauncherClickUntil = 0;

  try {
    document.dispatchEvent(new CustomEvent(RETIRE_EVENT));
  } catch {
    // Best effort only.
  }

  const host = document.createElement("div");
  host.id = "ambient-jpdb-host";
  // Keep the host itself at zero size. The launcher/popup are fixed-position
  // shadow children, so there is no reason to place a transparent full-screen
  // hit-testing layer over ChatGPT. This is more reliable in Chromium/Brave.
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.width = "0";
  host.style.height = "0";
  host.style.overflow = "visible";
  host.style.zIndex = "2147483000";
  host.style.pointerEvents = "auto";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      button { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
      .launcher {
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        position: fixed;
        width: 30px;
        height: 34px;
        display: grid;
        place-items: center;
        pointer-events: auto;
        border: 1px solid rgba(80,80,80,.16);
        border-radius: 10px;
        background: rgba(255,255,255,.72);
        color: #4a4a4a;
        box-shadow: 0 2px 10px rgba(0,0,0,.05);
        backdrop-filter: blur(10px);
        cursor: grab;
        opacity: .46;
        transition: opacity .14s ease, background .14s ease, transform .14s ease;
        font: 16px/1 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 0;
      }
      .launcher:hover,
      .launcher.open {
        opacity: .92;
        background: rgba(255,255,255,.92);
      }
      .launcher:active { transform: scale(.96); }
      .launcher.dragging { cursor: grabbing; transform: none; transition: none; opacity: .92; }
      .launcher.hidden { display: none; }
      .glyph { transform: translateY(-1px); opacity: .72; }

      .popup {
        position: fixed;
        width: min(420px, calc(100vw - 32px));
        max-height: min(520px, calc(100vh - 32px));
        overflow: auto;
        pointer-events: auto;
        border: 1px solid rgba(80,80,80,.16);
        border-radius: 16px;
        background: rgba(255,255,255,.97);
        color: #202020;
        box-shadow: 0 18px 50px rgba(0,0,0,.14);
        backdrop-filter: blur(14px);
        padding: 12px 14px 14px;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        outline: none;
      }
      .popup.hidden { display: none; }
      .popup.busy { cursor: progress; }
      .popup.busy .reveal,
      .popup.busy .grade { opacity: .45; }
      .popup-header {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        min-height: 24px;
        margin-bottom: 2px;
      }
      .close {
        width: 25px;
        height: 25px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: inherit;
        opacity: .42;
        cursor: pointer;
        font: 18px/1 ui-sans-serif, sans-serif;
        padding: 0;
      }
      .close:hover { opacity: .85; background: rgba(0,0,0,.05); }
      .word-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 48px;
      }
      .word {
        flex: 1;
        min-width: 0;
        font-size: 25px;
        line-height: 1.3;
        font-weight: 560;
        letter-spacing: .01em;
        overflow-wrap: anywhere;
      }
      .reveal {
        border: 1px solid rgba(80,80,80,.16);
        border-radius: 9px;
        background: transparent;
        color: inherit;
        padding: 6px 9px;
        cursor: pointer;
        font: 12px/1.2 ui-sans-serif, sans-serif;
        opacity: .74;
      }
      .reveal:hover { background: rgba(0,0,0,.045); opacity: 1; }
      .answer {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(80,80,80,.12);
      }
      .answer.hidden { display: none; }
      .reading { font-size: 15px; opacity: .82; margin-bottom: 6px; }
      .meanings { font-size: 14px; line-height: 1.48; opacity: .92; }
      .grades {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 6px;
        margin-top: 12px;
      }
      .grade {
        border: 1px solid rgba(80,80,80,.16);
        border-radius: 8px;
        background: transparent;
        color: inherit;
        min-width: 0;
        padding: 6px 4px;
        cursor: pointer;
        font: 11px/1.15 ui-sans-serif, sans-serif;
      }
      .grade:hover { background: rgba(0,0,0,.045); }
      .grade kbd {
        display: block;
        font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
        opacity: .45;
        margin-bottom: 3px;
      }
      .empty,
      .loading,
      .error {
        min-height: 78px;
        display: grid;
        place-items: center;
        text-align: center;
        font-size: 13px;
        line-height: 1.4;
        opacity: .58;
        padding: 10px;
      }
      .error { color: #a33; opacity: .9; }
      button:disabled { cursor: wait; opacity: .45; }
      button:focus-visible, a:focus-visible { outline: 2px solid #6688ad; outline-offset: 3px; }
      .notice { margin-top: 10px; font-size: 12px; line-height: 1.45; }
      .notice-text { color: #a44; }
      .recovery-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 9px; }
      .recovery-actions button { border: 1px solid #8885; border-radius: 7px; background: transparent; color: inherit; padding: 7px 9px; font: inherit; cursor: pointer; }
      .update-hint { margin-top: 10px; font-size: 11px; }
      .update-link { color: inherit; opacity: .72; text-decoration: underline; text-underline-offset: 2px; }
      @media (prefers-color-scheme: dark) { .notice-text { color: #eeaaaa; } }
      .state-hidden { display: none !important; }

      @media (prefers-color-scheme: dark) {
        .launcher {
          background: rgba(32,32,32,.72);
          color: #e5e5e5;
          border-color: rgba(255,255,255,.11);
          box-shadow: 0 2px 10px rgba(0,0,0,.16);
        }
        .launcher:hover,
        .launcher.open { background: rgba(32,32,32,.94); }
        .popup {
          background: rgba(32,32,32,.97);
          color: #ececec;
          border-color: rgba(255,255,255,.11);
          box-shadow: 0 18px 54px rgba(0,0,0,.34);
        }
        .close:hover,
        .reveal:hover,
        .grade:hover { background: rgba(255,255,255,.07); }
        .reveal,
        .grade { border-color: rgba(255,255,255,.12); }
        .answer { border-color: rgba(255,255,255,.10); }
      }

      @media (max-width: 720px) {
        .grades { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      }
    </style>

    <button class="launcher hidden" type="button" aria-label="Open vocabulary reviews" aria-expanded="false" title="Click to review · Drag vertically to move">
      <span class="glyph">○</span>
    </button>

    <div class="popup hidden" tabindex="0" role="dialog" aria-label="JPDB vocabulary reviews">
      <div class="popup-header">
        <span class="status" aria-live="polite" style="margin-right:auto;font-size:11px;opacity:.45"></span>
        <button class="close" type="button" aria-label="Close reviews" title="Close">×</button>
      </div>
      <div class="review state-hidden">
        <div class="word-row">
          <div class="word"></div>
          <button class="reveal" type="button">Reveal</button>
        </div>
        <div class="answer hidden">
          <div class="reading"></div>
          <div class="meanings"></div>
          <div class="grades">
            <button class="grade" data-grade="nothing"><kbd>1</kbd>Nothing</button>
            <button class="grade" data-grade="something"><kbd>2</kbd>Something</button>
            <button class="grade" data-grade="hard"><kbd>3</kbd>Hard</button>
            <button class="grade" data-grade="okay"><kbd>4</kbd>Okay</button>
            <button class="grade" data-grade="easy"><kbd>5</kbd>Easy</button>
          </div>
        </div>
      </div>
      <div class="loading state-hidden">Loading reviews…</div>
      <div class="empty state-hidden">✓ No reviewable vocabulary right now.</div>
      <div class="error state-hidden"></div>
      <div class="notice state-hidden" role="status">
        <div class="notice-text"></div>
        <div class="recovery-actions">
          <button type="button" class="retry state-hidden">Try again</button>
          <button type="button" class="reconcile state-hidden">Check review status</button>
          <button type="button" class="continue-review state-hidden">Continue without resending</button>
          <button type="button" class="settings state-hidden">Open settings</button>
        </div>
      </div>
      <div class="update-hint state-hidden"><a class="update-link" target="_blank" rel="noopener noreferrer"></a></div>
    </div>`;

  const launcher = shadow.querySelector(".launcher");
  const popup = shadow.querySelector(".popup");
  const closeBtn = shadow.querySelector(".close");
  const statusEl = shadow.querySelector(".status");
  const reviewEl = shadow.querySelector(".review");
  const loadingEl = shadow.querySelector(".loading");
  const emptyEl = shadow.querySelector(".empty");
  const errorEl = shadow.querySelector(".error");
  const wordEl = shadow.querySelector(".word");
  const revealBtn = shadow.querySelector(".reveal");
  const answerEl = shadow.querySelector(".answer");
  const readingEl = shadow.querySelector(".reading");
  const meaningsEl = shadow.querySelector(".meanings");

  let enabled = true;
  let panelOpen = false;
  let panelRevision = 0;
  let sharedRevision = -1;
  let state = { card: null, revealed: false, revision: 0, loading: false, error: null, submission: null };
  let localPanelSequence = 0;
  let pendingPanelSequence = null;
  let latestIntent = null;
  let restoreFocusTarget = null;
  let lastPageFocusTarget = null;
  let revealTask = null;
  let optimisticCard = null;
  let gradePending = false;
  let recoveryPending = false;
  let localError = null;
  const pendingMessages = new Set();
  const version = chrome.runtime.getManifest().version;
  const instanceId = globalThis.crypto.randomUUID();
  const notice = shadow.querySelector('.notice');
  const noticeText = shadow.querySelector('.notice-text');
  const retryBtn = shadow.querySelector('.retry');
  const reconcileBtn = shadow.querySelector('.reconcile');
  const continueBtn = shadow.querySelector('.continue-review');
  const settingsBtn = shadow.querySelector('.settings');
  const updateHint = shadow.querySelector('.update-hint');
  const updateLink = shadow.querySelector('.update-link');
  const gradeButtons = [...shadow.querySelectorAll('.grade[data-grade]')];
  const cleanup = [];

  function normalizeLauncherPosition(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(Math.max(-100, Math.min(100, number))) : 0;
  }

  function launcherBounds() {
    const minimum = 48;
    const maximum = Math.max(minimum, innerHeight - 70);
    const center = Math.max(minimum, Math.min(maximum, Math.round(innerHeight / 2 - 17)));
    return { minimum, maximum, center };
  }

  function launcherTopForPosition(percent) {
    const { minimum, maximum, center } = launcherBounds();
    const span = percent < 0 ? center - minimum : maximum - center;
    return Math.round(center + span * percent / 100);
  }

  function launcherPositionForTop(top) {
    const { minimum, maximum, center } = launcherBounds();
    const clamped = Math.max(minimum, Math.min(maximum, top));
    const span = clamped < center ? center - minimum : maximum - center;
    return span > 0 ? normalizeLauncherPosition((clamped - center) * 100 / span) : 0;
  }

  function setLauncherPosition(value, { followPopup = true } = {}) {
    const next = normalizeLauncherPosition(value);
    if (next === launcherPositionY) return;
    launcherPositionY = next;
    if (panelOpen && followPopup) movePopupWithLauncher = true;
    schedulePosition();
  }

  function listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    cleanup.push(() => target.removeEventListener(type, fn, options));
  }

  function sameCard(a, b) {
    return Boolean(a && b && a.vid === b.vid && a.sid === b.sid);
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pendingMessages.delete(cancel);
        if (error) reject(error); else resolve(result);
      };
      const cancel = () => finish(new Error('The extension is reloading.'));
      const timer = setTimeout(() => {
        const error = new Error('The extension is taking longer to respond. Check the current status before trying again.');
        error.code = 'MESSAGE_TIMEOUT';
        finish(error);
      }, 18000);
      pendingMessages.add(cancel);
      if (retired) return cancel();
      try {
        if (!chrome.runtime.id) throw new Error('Extension context invalidated.');
        chrome.runtime.sendMessage(message, response => {
          if (settled) return;
          let error;
          try {
            if (chrome.runtime.lastError) error = new Error(chrome.runtime.lastError.message);
          } catch (caught) { error = caught; }
          if (!error && !response?.success) {
            error = new Error(response?.error?.message || response?.error || 'The extension request could not finish.');
            error.code = response?.code || response?.error?.code;
          }
          if (/extension context invalidated/i.test(error?.message || '')) retireInstance();
          finish(error, response);
        });
      } catch (error) {
        if (/extension context invalidated/i.test(error.message)) retireInstance();
        finish(error);
      }
    });
  }

  function retireInstance() {
    if (retired) return;
    retired = true;
    launcherDrag = null;
    if (positionFrame !== null) cancelAnimationFrame(positionFrame);
    mutationObserver?.disconnect();
    anchorResizeObserver?.disconnect();
    cleanup.splice(0).forEach(remove => { try { remove(); } catch {} });
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch {}
    try { chrome.storage.onChanged.removeListener(onStorageChanged); } catch {}
    [...pendingMessages].forEach(cancel => cancel());
    host.remove();
  }
  listen(document, RETIRE_EVENT, retireInstance);

  function focusIsInPopup() {
    return document.activeElement === host && popup.contains(shadow.activeElement);
  }

  function setPanelOpenLocal(open, { focus = false, restoreFocus = true } = {}) {
    if (retired) return;
    if (open && !panelOpen) {
      const previous = document.activeElement;
      restoreFocusTarget = previous && previous !== host ? previous : lastPageFocusTarget || restoreFocusTarget;
    }
    const shouldRestore = !open && panelOpen && restoreFocus && document.activeElement === host;
    if (Boolean(open) !== panelOpen) pinnedPopupTop = null;
    panelOpen = Boolean(open);
    launcher.classList.toggle('open', panelOpen);
    launcher.setAttribute('aria-expanded', String(panelOpen));
    launcher.setAttribute('aria-label', panelOpen ? 'Close vocabulary reviews' : 'Open vocabulary reviews');
    popup.classList.toggle('hidden', !panelOpen);
    if (panelOpen && focus) popup.focus({ preventScroll: true });
    if (shouldRestore) {
      const target = restoreFocusTarget?.isConnected ? restoreFocusTarget : launcher;
      try { target.focus({ preventScroll: true }); } catch {}
    }
    schedulePosition();
  }

  function applySession(incoming) {
    if (!incoming || typeof incoming !== 'object') return;
    const revision = Number(incoming.revision) || 0;
    if (revision < sharedRevision) return;
    sharedRevision = revision;
    const oldCard = state.card;
    state = { ...incoming, revision };
    if (!sameCard(oldCard, state.card) || state.revealed || state.submission) optimisticCard = null;
    localError = null;
    render();
  }

  function applySnapshot(snapshot, { allowOpen = false, responseSequence = null } = {}) {
    if (!snapshot || retired) return;
    if (snapshot.state) applySession(snapshot.state);
    if (responseSequence !== null && responseSequence !== localPanelSequence) return;
    const revision = Number(snapshot.panelRevision) || 0;
    if (revision < panelRevision) return;
    const previousRevision = panelRevision;
    panelRevision = revision;
    if (typeof snapshot.open !== 'boolean') return;
    if (snapshot.open) {
      // A late background result never opens a popup that the user dismissed.
      if (allowOpen || (panelOpen && snapshot.intentId === latestIntent)) {
        setPanelOpenLocal(true);
      }
    } else {
      // An old snapshot during a newer local click cannot cancel that click.
      if (pendingPanelSequence !== null && responseSequence === null && revision <= previousRevision) return;
      if (panelOpen && responseSequence === null) {
        localPanelSequence += 1;
        pendingPanelSequence = null;
      }
      setPanelOpenLocal(false);
    }
  }

  function render() {
    if (retired) return;
    const card = state.card;
    const isRevealed = Boolean(state.revealed || (sameCard(optimisticCard, card) && revealTask));
    const submission = state.submission;
    const uncertain = submission?.status === 'uncertain';
    const saving = submission?.status === 'saving';
    const busy = Boolean(state.loading || saving || gradePending || recoveryPending || revealTask);
    popup.classList.toggle('busy', busy);
    popup.setAttribute('aria-busy', String(busy));
    statusEl.textContent = saving || gradePending ? 'Saving…'
      : recoveryPending ? 'Checking…'
      : state.loading ? (state.lastOutcome?.status === 'accepted' ? 'Saved — loading next review…' : 'Loading…')
      : uncertain ? 'Review status uncertain'
      : revealTask ? 'Syncing…'
      : state.lastOutcome?.status === 'accepted' && Date.now() - state.lastOutcome.at < 5000 ? 'Saved' : '';

    reviewEl.classList.toggle('state-hidden', !card);
    const progress = state.progress;
    const done = Number(progress?.completed) || 0;
    const total = Number.isFinite(progress?.total) ? progress.total : null;
    loadingEl.textContent = progress?.phase === 'vocabulary'
      ? `Reading JPDB decks: ${done} of ${total ?? '…'}…`
      : progress?.phase === 'reviews'
        ? `Checking review eligibility: ${done.toLocaleString()} of ${total?.toLocaleString() ?? '…'} vocabulary entries…`
        : 'Finding your JPDB decks…';
    loadingEl.classList.toggle('state-hidden', Boolean(card) || !state.loading);
    emptyEl.classList.toggle('state-hidden', Boolean(card) || state.loading || Boolean(state.error || localError || uncertain));
    errorEl.classList.add('state-hidden');
    if (card) {
      wordEl.textContent = card.spelling || '…';
      readingEl.textContent = isRevealed ? card.reading || '' : '';
      const meanings = Array.isArray(card.meanings) ? card.meanings : [];
      meaningsEl.textContent = isRevealed ? (meanings.join(' · ') || 'No meanings returned by JPDB.') : '';
      answerEl.classList.toggle('hidden', !isRevealed);
      revealBtn.classList.toggle('state-hidden', isRevealed);
    }
    revealBtn.disabled = Boolean(!card || state.loading || state.error || submission || revealTask || gradePending || recoveryPending);
    gradeButtons.forEach(button => {
      // One grade can be buffered behind the local reveal handshake.
      button.disabled = Boolean(!card || !isRevealed || state.loading || state.error || submission || gradePending || recoveryPending);
    });

    const error = localError || state.error;
    const message = uncertain ? (error?.message || submission.message || 'The connection ended before the review result was confirmed. Check its status before submitting again.') : error?.message;
    notice.classList.toggle('state-hidden', !message);
    noticeText.textContent = message || '';
    retryBtn.classList.toggle('state-hidden', uncertain || !error || error.retryable === false);
    retryBtn.disabled = recoveryPending;
    reconcileBtn.classList.toggle('state-hidden', !uncertain);
    reconcileBtn.disabled = recoveryPending;
    continueBtn.classList.toggle('state-hidden', !uncertain || submission.canContinue === false);
    continueBtn.disabled = recoveryPending;
    settingsBtn.classList.toggle('state-hidden', !error || !/(api.?key|auth|disabled|config)/i.test(error.code || error.message || ''));
    schedulePosition();
  }

  async function changePanel(open) {
    if (retired || (!enabled && open)) return;
    const sequence = ++localPanelSequence;
    pendingPanelSequence = sequence;
    latestIntent = `${instanceId}:${sequence}`;
    localError = null;
    if (open && !state.card) state = { ...state, loading: true, progress: null, error: null };
    if (!open) optimisticCard = null;
    setPanelOpenLocal(open, { focus: open });
    render();
    try {
      const result = await send({ type: 'JPDB_SET_PANEL_OPEN', open, intentId: latestIntent });
      if (sequence !== localPanelSequence) return;
      applySnapshot(result, { allowOpen: open, responseSequence: sequence });
    } catch (error) {
      if (sequence !== localPanelSequence || retired || !open) return;
      state = { ...state, loading: false };
      localError = { code: error.code || 'CONNECTION', message: error.message, retryable: true };
      render();
    } finally {
      if (pendingPanelSequence === sequence) pendingPanelSequence = null;
    }
  }

  async function reveal() {
    if (!panelOpen || !state.card || state.revealed || state.error || state.submission || revealTask || gradePending || state.loading) return;
    const card = state.card;
    optimisticCard = card;
    const run = async () => {
      try {
        const result = await send({ type: 'JPDB_MARK_REVEALED', vid: card.vid, sid: card.sid, revision: sharedRevision });
        applySnapshot(result);
      } catch (error) {
        optimisticCard = null;
        await recoverConnection(error);
      } finally {
        revealTask = null;
        optimisticCard = null;
        render();
      }
    };
    // Assign the promise before rendering so the optimistic answer is immediate.
    revealTask = Promise.resolve().then(run);
    render();
    await revealTask;
  }

  async function grade(value) {
    const card = state.card;
    if (!panelOpen || !card || state.error || gradePending || state.submission || recoveryPending || (!state.revealed && !sameCard(optimisticCard, card))) return;
    gradePending = true;
    render();
    try {
      if (revealTask) await revealTask;
      if (!sameCard(card, state.card) || !state.revealed) return;
      const result = await send({ type: 'JPDB_SUBMIT_REVIEW', vid: card.vid, sid: card.sid, grade: value, revision: sharedRevision });
      applySnapshot(result);
      if (result.ignored && sameCard(card, state.card)) {
        localError = { code: 'CARD_CHANGED', message: 'The review state changed. Please choose a grade again.', retryable: false };
      }
    } catch (error) {
      // A lost response is not proof that the write failed. Never resend here.
      await recoverConnection(error);
    } finally {
      gradePending = false;
      render();
      if (panelOpen && focusIsInPopup()) popup.focus({ preventScroll: true });
    }
  }

  async function recoverConnection(error) {
    if (retired) return;
    try {
      const result = await send({ type: 'JPDB_GET_SHARED_SESSION' });
      applySnapshot(result);
      if (!state.submission && !state.error) {
        localError = { code: error.code || 'CONNECTION', message: error.message, retryable: true };
      }
    } catch {
      localError = { code: 'CONNECTION', message: 'The extension could not confirm the current review state. Reconnect and check status before submitting again.', retryable: true };
      // Keep the current card non-submittable until authoritative state returns.
      state = { ...state, submission: { status: 'uncertain', message: localError.message, canContinue: false } };
    }
    render();
  }

  async function recover(type) {
    if (retired || recoveryPending) return;
    recoveryPending = true;
    localError = null;
    render();
    try {
      const result = await send({ type });
      applySnapshot(result);
    } catch (error) {
      localError = { code: error.code || 'CONNECTION', message: error.message, retryable: true };
    } finally {
      recoveryPending = false;
      render();
    }
  }

  function renderUpdate(update) {
    let url = null;
    if (update?.available || update?.status === 'available') {
      try {
        const candidate = new URL(update.releaseUrl);
        const repository = String(update.repository || '');
        const parse = value => {
          if (typeof value !== 'string' || !/^\d+(?:\.\d+){0,3}$/.test(value)) return null;
          const parts = value.split('.');
          if (parts.some(part => (part.length > 1 && part[0] === '0') || Number(part) > 65535) || parts.every(part => Number(part) === 0)) return null;
          return Array.from({ length: 4 }, (_, i) => Number(parts[i] || 0));
        };
        const latest = parse(update.latestVersion);
        const installed = parse(version);
        const firstDifference = latest && installed && latest.findIndex((part, i) => part !== installed[i]);
        const newer = Number.isInteger(firstDifference) && firstDifference >= 0 && latest[firstDifference] > installed[firstDifference];
        const tag = typeof update.tag === 'string' ? update.tag : '';
        if (newer && tag.replace(/^[vV]/, '') === update.latestVersion &&
          /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository) && candidate.origin === 'https://github.com' &&
          !candidate.username && !candidate.password && !candidate.search && !candidate.hash &&
          candidate.pathname.toLowerCase() === `/${repository}/releases/tag/${encodeURIComponent(tag)}`.toLowerCase()) url = candidate.href;
      } catch {}
    }
    updateHint.classList.toggle('state-hidden', !url);
    if (url) {
      updateLink.href = url;
      updateLink.textContent = `Update ${update.latestVersion} available — view release`;
    } else updateLink.removeAttribute('href');
  }

  function findChatAnchor() {
    const prompt = document.querySelector('#prompt-textarea, [data-testid="prompt-textarea"], main form textarea, main form [contenteditable="true"]');
    if (!prompt) return null;
    const form = prompt.closest('form');
    if (form) {
      const rect = form.getBoundingClientRect();
      if (rect.width >= 240 && rect.height >= 30) return form;
    }
    return prompt;
  }

  function updatePosition() {
    positionFrame = null;
    if (retired) return;
    if (!host.isConnected) document.documentElement.appendChild(host);
    const nextAnchor = findChatAnchor();
    if (nextAnchor !== currentAnchor) {
      if (currentAnchor) anchorResizeObserver.unobserve(currentAnchor);
      currentAnchor = nextAnchor;
      if (currentAnchor) anchorResizeObserver.observe(currentAnchor);
    }
    const rect = currentAnchor?.getBoundingClientRect();
    const valid = rect && rect.width >= 160 && rect.bottom > 0 && rect.top < innerHeight;
    launcher.classList.toggle('hidden', !enabled || !valid);
    // Keep an explicitly open review usable during transient composer replacement.
    popup.style.visibility = 'visible';
    const left = valid ? Math.max(8, Math.round(rect.left - 42)) : Math.max(8, Number.parseFloat(launcher.style.left) || 8);
    const top = launcherTopForPosition(launcherPositionY);
    const previousTop = Number.parseFloat(launcher.style.top);
    launcher.style.left = `${left}px`;
    launcher.style.top = `${top}px`;
    if (movePopupWithLauncher && pinnedPopupTop !== null && Number.isFinite(previousTop)) {
      pinnedPopupTop += top - previousTop;
    }
    movePopupWithLauncher = false;
    if (!panelOpen) return;
    const width = Math.max(180, Math.min(420, innerWidth - 24));
    popup.style.width = `${width}px`;
    popup.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, left + 40))}px`;
    // Center once on opening, then pin the top edge. Revealing an answer can
    // significantly increase its height; recentering on every render made the
    // whole popup jump (even when the user only pressed Reveal).
    const availableHeight = Math.max(0, innerHeight - 24);
    const reservedHeight = Math.min(320, availableHeight);
    if (pinnedPopupTop === null) {
      const height = popup.getBoundingClientRect().height || 220;
      pinnedPopupTop = Math.round(Math.max(12,
        Math.min(innerHeight - reservedHeight - 12, top + 17 - height / 2)));
    }
    const visibleTop = Math.max(12, Math.min(pinnedPopupTop, innerHeight - reservedHeight - 12));
    popup.style.top = `${Math.round(visibleTop)}px`;
    // Grow or scroll inside the popup instead of moving its upper edge.
    popup.style.maxHeight = `${Math.max(48, Math.min(520, innerHeight - visibleTop - 12))}px`;
  }

  function schedulePosition() {
    if (retired || positionFrame !== null) return;
    positionFrame = requestAnimationFrame(updatePosition);
  }

  function onMessage(message, _sender, respond) {
    if (retired) return;
    if (message?.type === 'JPDB_UI_PROBE') { respond?.({ ready: true, version }); return; }
    if (message?.type === 'JPDB_PANEL_FORCE_CLOSE') {
      applySnapshot({ ...message, open: false });
    } else if (message?.type === 'JPDB_SHARED_SESSION_CHANGED' || message?.type === 'JPDB_PANEL_STATE_CHANGED') {
      applySnapshot(message);
    }
  }

  function onStorageChanged(changes, area) {
    if (area !== 'local' || retired) return;
    if (changes.enabled) {
      enabled = Boolean(changes.enabled.newValue);
      if (!enabled && panelOpen) void changePanel(false);
      schedulePosition();
    }
    if (changes.launcherPositionY && !launcherDrag) setLauncherPosition(changes.launcherPositionY.newValue);
    if (changes.jpdbUpdateState) renderUpdate(changes.jpdbUpdateState.newValue);
  }

  // Drag only along Y. Pointer capture lets the user release outside the button,
  // while the movement threshold preserves normal click-to-toggle behavior.
  listen(launcher, 'pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || launcherDrag) return;
    launcherDrag = { pointerId: event.pointerId, startY: event.clientY,
      startTop: launcherTopForPosition(launcherPositionY), startPosition: launcherPositionY, moved: false };
    try { launcher.setPointerCapture(event.pointerId); } catch {}
  });
  listen(launcher, 'pointermove', event => {
    const drag = launcherDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(delta) < 6) return;
    drag.moved = true;
    launcher.classList.add('dragging');
    setLauncherPosition(launcherPositionForTop(drag.startTop + delta));
    event.preventDefault();
  });
  listen(launcher, 'pointerup', event => {
    const drag = launcherDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    launcherDrag = null;
    launcher.classList.remove('dragging');
    try { launcher.releasePointerCapture(event.pointerId); } catch {}
    if (drag.moved) {
      suppressLauncherClickUntil = performance.now() + 700;
      void chrome.storage.local.set({ launcherPositionY }).catch(() => {
        // Keep the current layout responsive even if storage is temporarily unavailable.
      });
      event.preventDefault();
    }
  });
  listen(launcher, 'pointercancel', event => {
    if (!launcherDrag || event.pointerId !== launcherDrag.pointerId) return;
    const previous = launcherDrag.startPosition;
    launcherDrag = null;
    launcher.classList.remove('dragging');
    setLauncherPosition(previous);
  });

  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
    listen(shadow, type, event => {
      if (event.composedPath().some(node => node instanceof HTMLButtonElement || node instanceof HTMLAnchorElement)) event.stopPropagation();
    });
  }
  listen(launcher, 'click', event => {
    event.preventDefault();
    if (performance.now() < suppressLauncherClickUntil) {
      suppressLauncherClickUntil = 0;
      return;
    }
    void changePanel(!panelOpen);
  });
  listen(closeBtn, 'click', event => { event.preventDefault(); void changePanel(false); });
  listen(revealBtn, 'click', event => { event.preventDefault(); void reveal(); });
  gradeButtons.forEach(button => listen(button, 'click', event => { event.preventDefault(); void grade(button.dataset.grade); }));
  listen(retryBtn, 'click', () => { void recover('JPDB_RETRY_LOAD'); });
  listen(reconcileBtn, 'click', () => { void recover('JPDB_RECONCILE_REVIEW'); });
  listen(continueBtn, 'click', () => { void recover('JPDB_CONTINUE_WITHOUT_RESENDING'); });
  listen(settingsBtn, 'click', () => {
    void send({ type: 'JPDB_OPEN_SETTINGS' }).catch(error => { localError = { message: error.message, retryable: true }; render(); });
  });
  listen(popup, 'keydown', event => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); void changePanel(false); return;
    }
    if ((event.key === ' ' || event.code === 'Space') && !state.revealed && !revealBtn.disabled) {
      event.preventDefault(); event.stopPropagation(); void reveal(); return;
    }
    if (/^[1-5]$/.test(event.key)) {
      const button = gradeButtons[Number(event.key) - 1];
      if (button && !button.disabled) { event.preventDefault(); event.stopPropagation(); void grade(button.dataset.grade); }
    }
  });
  anchorResizeObserver = new ResizeObserver(schedulePosition);
  mutationObserver = new MutationObserver(records => {
    if (records.some(record => record.target !== host)) schedulePosition();
  });
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  listen(window, 'resize', schedulePosition, { passive: true });
  listen(window, 'scroll', schedulePosition, { passive: true, capture: true });
  listen(window, 'popstate', schedulePosition);
  listen(window, 'pageshow', schedulePosition);
  listen(document, 'focusin', event => {
    if (event.target !== host && event.target instanceof HTMLElement) lastPageFocusTarget = event.target;
  });
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onStorageChanged);

  async function initialize() {
    const sequence = localPanelSequence;
    try {
      const stored = await chrome.storage.local.get({ enabled: true, launcherPositionY: 0, jpdbUpdateState: null });
      enabled = Boolean(stored.enabled);
      setLauncherPosition(stored.launcherPositionY, { followPopup: false });
      renderUpdate(stored.jpdbUpdateState);
      schedulePosition();
      const result = await send({ type: 'JPDB_GET_PANEL_STATE' });
      if (sequence === localPanelSequence) applySnapshot(result, { allowOpen: true, responseSequence: sequence });
      else if (result.state) applySession(result.state);
    } catch (error) {
      if (panelOpen) { localError = { message: error.message, retryable: true }; render(); }
    }
  }
  render();
  schedulePosition();
  void initialize();
})();
