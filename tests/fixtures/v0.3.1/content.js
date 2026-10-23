(() => {
  const RETIRE_EVENT = "ambient-jpdb-retire-current-instance";
  let retired = false;
  let historyRestorers = [];
  let positionFrame = null;
  let mutationObserver = null;
  let anchorResizeObserver = null;
  let currentAnchor = null;

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
        cursor: pointer;
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

    <button class="launcher hidden" type="button" aria-label="Open vocabulary reviews" title="Reviews">
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
  let currentCard = null;
  let revealed = false;
  let sharedRevision = 0;
  let loading = false;

  function isInvalidatedContextError(error) {
    return /extension context invalidated/i.test(String(error?.message || error || ""));
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      if (retired) return reject(new Error("Ambient JPDB content instance is retired."));
      try {
        if (!chrome?.runtime?.id) {
          retireInstance("extension context invalidated");
          return reject(new Error("Extension context invalidated."));
        }
        chrome.runtime.sendMessage(message, (response) => {
          let lastError = null;
          try { lastError = chrome.runtime.lastError; } catch (error) {
            if (isInvalidatedContextError(error)) retireInstance("extension context invalidated");
            return reject(error);
          }
          if (lastError) {
            const error = new Error(lastError.message);
            if (isInvalidatedContextError(error)) retireInstance("extension context invalidated");
            return reject(error);
          }
          if (!response?.success) return reject(new Error(response?.error || "Extension request failed"));
          resolve(response);
        });
      } catch (error) {
        if (isInvalidatedContextError(error)) retireInstance("extension context invalidated");
        reject(error);
      }
    });
  }

  function retireInstance(reason = "replaced") {
    if (retired) return;
    retired = true;
    if (positionFrame !== null) cancelAnimationFrame(positionFrame);
    positionFrame = null;
    try { mutationObserver?.disconnect(); } catch {}
    try { anchorResizeObserver?.disconnect(); } catch {}
    for (const restore of historyRestorers.splice(0)) {
      try { restore(); } catch {}
    }
    try { chrome.storage.onChanged.removeListener(onStorageChanged); } catch {}
    try { document.removeEventListener(RETIRE_EVENT, onRetireEvent); } catch {}
    try { host.remove(); } catch {}
    if (reason !== "replaced") console.debug(`Ambient JPDB retired: ${reason}`);
  }

  function onRetireEvent() { retireInstance("replaced"); }
  document.addEventListener(RETIRE_EVENT, onRetireEvent);

  function sameCard(a, b) {
    return Boolean(a && b && a.vid === b.vid && a.sid === b.sid);
  }

  function setStateView(name) {
    for (const el of [reviewEl, loadingEl, emptyEl, errorEl]) el.classList.add("state-hidden");
    const target = { review: reviewEl, loading: loadingEl, empty: emptyEl, error: errorEl }[name];
    if (target) target.classList.remove("state-hidden");
    schedulePosition();
  }

  function showError(message) {
    popup.classList.remove("busy");
    statusEl.textContent = "";
    errorEl.textContent = message || "Unable to load reviews.";
    setStateView("error");
  }

  function setBusy(isBusy, label = "") {
    loading = Boolean(isBusy);
    popup.classList.toggle("busy", loading);
    statusEl.textContent = loading ? label : "";
  }

  function renderCard(card, isRevealed = false, { focus = false } = {}) {
    currentCard = card;
    revealed = Boolean(isRevealed);
    wordEl.textContent = card?.spelling || "…";
    readingEl.textContent = revealed ? (card?.reading || "") : "";
    const meanings = Array.isArray(card?.meanings) ? card.meanings : [];
    meaningsEl.textContent = revealed ? (meanings.length ? meanings.join(" · ") : "No meanings returned by JPDB.") : "";
    answerEl.classList.toggle("hidden", !revealed);
    revealBtn.classList.toggle("state-hidden", revealed);
    setStateView("review");
    if (focus) popup.focus({ preventScroll: true });
  }

  function applySession(state, { focus = false } = {}) {
    if (!state || typeof state !== "object") return;
    const incoming = Number(state.revision) || 0;
    if (incoming < sharedRevision) return;
    sharedRevision = incoming;
    if (state.card) {
      renderCard(state.card, state.revealed, { focus });
    } else {
      currentCard = null;
      revealed = false;
      setStateView("empty");
      if (focus) popup.focus({ preventScroll: true });
    }
  }

  function setPanelOpenLocal(open, { focus = false } = {}) {
    panelOpen = Boolean(open);
    launcher.classList.toggle("open", panelOpen);
    popup.classList.toggle("hidden", !panelOpen);
    if (panelOpen && focus) popup.focus({ preventScroll: true });
    schedulePosition();
  }

  function findChatAnchor() {
    const prompt = document.querySelector(
      '#prompt-textarea, [data-testid="prompt-textarea"], main form textarea, main form [contenteditable="true"]'
    );
    if (!prompt) return null;
    const form = prompt.closest("form");
    if (form) {
      const rect = form.getBoundingClientRect();
      if (rect.width >= 240 && rect.height >= 30) return form;
    }
    return prompt;
  }

  function bindAnchor() {
    const next = findChatAnchor();
    if (next === currentAnchor) return;
    if (currentAnchor) {
      try { anchorResizeObserver.unobserve(currentAnchor); } catch {}
    }
    currentAnchor = next;
    if (currentAnchor) {
      try { anchorResizeObserver.observe(currentAnchor); } catch {}
    }
    schedulePosition();
  }

  function updatePosition() {
    positionFrame = null;
    if (retired) return;
    const anchor = currentAnchor || findChatAnchor();
    if (!anchor || !enabled) {
      launcher.classList.add("hidden");
      if (!anchor) popup.style.visibility = "hidden";
      return;
    }

    const rect = anchor.getBoundingClientRect();
    if (rect.width < 160 || rect.bottom <= 0 || rect.top >= window.innerHeight) {
      launcher.classList.add("hidden");
      popup.style.visibility = "hidden";
      return;
    }

    launcher.classList.remove("hidden");
    popup.style.visibility = "visible";

    const buttonWidth = 30;
    const buttonHeight = 34;
    const left = Math.max(8, Math.round(rect.left - buttonWidth - 12));
    const top = Math.max(72, Math.min(window.innerHeight - buttonHeight - 72, Math.round(window.innerHeight * 0.5 - buttonHeight / 2)));
    launcher.style.left = `${left}px`;
    launcher.style.top = `${top}px`;

    if (!panelOpen) return;

    const popupWidth = Math.min(420, window.innerWidth - 24);
    const preferredLeft = left + buttonWidth + 10;
    const popupLeft = Math.max(12, Math.min(window.innerWidth - popupWidth - 12, preferredLeft));
    popup.style.width = `${popupWidth}px`;
    popup.style.left = `${popupLeft}px`;

    const popupHeight = popup.getBoundingClientRect().height || 220;
    const preferredTop = top + buttonHeight / 2 - popupHeight / 2;
    const popupTop = Math.max(12, Math.min(window.innerHeight - popupHeight - 12, preferredTop));
    popup.style.top = `${Math.round(popupTop)}px`;
  }

  function schedulePosition() {
    if (retired || positionFrame !== null) return;
    positionFrame = requestAnimationFrame(updatePosition);
  }

  anchorResizeObserver = new ResizeObserver(schedulePosition);
  mutationObserver = new MutationObserver(() => bindAnchor());
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("resize", schedulePosition, { passive: true });
  window.addEventListener("scroll", schedulePosition, { passive: true, capture: true });
  bindAnchor();

  async function togglePanel() {
    if (loading || retired) return;
    setBusy(true, "Loading…");
    if (!panelOpen) setStateView("loading");
    try {
      const result = await send({ type: "JPDB_TOGGLE_PANEL" });
      panelRevision = Number(result.panelRevision) || panelRevision;
      setPanelOpenLocal(result.open, { focus: result.open });
      if (result.open) {
        if (result.reason === "no-api-key") {
          showError("Add your JPDB API key in the extension settings first.");
        } else if (result.reason === "disabled") {
          showError("The review button is disabled in extension settings.");
        } else if (result.state) {
          applySession(result.state, { focus: true });
        } else if (result.card) {
          renderCard(result.card, result.revealed, { focus: true });
        } else {
          setStateView("empty");
        }
      }
    } catch (error) {
      setPanelOpenLocal(true, { focus: true });
      showError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function closePanel() {
    if (retired) return;
    setPanelOpenLocal(false);
    try {
      const result = await send({ type: "JPDB_CLOSE_PANEL" });
      panelRevision = Number(result.panelRevision) || panelRevision;
      if (result.state) {
        sharedRevision = Number(result.state.revision) || sharedRevision;
        revealed = false;
      }
    } catch {
      // Local close should remain immediate even if the extension is reloading.
    }
  }

  async function reveal() {
    if (!panelOpen || !currentCard || revealed || loading) return;
    // Reveal locally first so the control always feels responsive. JPDB/session
    // state is reconciled immediately afterward.
    const cardAtClick = currentCard;
    renderCard(cardAtClick, true, { focus: true });
    setBusy(true, "Syncing…");
    try {
      let result = await send({
        type: "JPDB_MARK_REVEALED",
        vid: currentCard.vid,
        sid: currentCard.sid,
        revision: sharedRevision
      });
      if (result.state) applySession(result.state, { focus: true });
      if (!result.state?.revealed && sameCard(result.state?.card, currentCard)) {
        result = await send({
          type: "JPDB_MARK_REVEALED",
          vid: currentCard.vid,
          sid: currentCard.sid,
          revision: Number(result.state.revision) || sharedRevision
        });
        if (result.state) applySession(result.state, { focus: true });
      }
    } catch (error) {
      // Re-sync is safer than leaving an optimistic reveal in a misleading state.
      try {
        const sync = await send({ type: "JPDB_GET_SHARED_SESSION" });
        if (sync.state) applySession(sync.state, { focus: true });
        else showError(error.message);
      } catch {
        showError(error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function grade(grade) {
    if (!panelOpen || !currentCard || !revealed || loading) return;
    setBusy(true, "Saving…");
    const card = currentCard;
    try {
      let result = await send({
        type: "JPDB_SUBMIT_REVIEW",
        vid: card.vid,
        sid: card.sid,
        grade,
        revision: sharedRevision
      });
      if (result.state) applySession(result.state, { focus: true });

      if (
        result.ignored &&
        result.reason === "stale-session" &&
        sameCard(result.state?.card, card) &&
        result.state?.revealed
      ) {
        result = await send({
          type: "JPDB_SUBMIT_REVIEW",
          vid: card.vid,
          sid: card.sid,
          grade,
          revision: Number(result.state.revision) || sharedRevision
        });
        if (result.state) applySession(result.state, { focus: true });
      }
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(false);
    }
  }

  // Keep ChatGPT's own click handlers from treating controls inside the shadow
  // surface as chat-page interactions. The host is zero-sized, so this affects
  // only actual extension controls.
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click"]) {
    shadow.addEventListener(type, (event) => {
      if (event.composedPath().some((node) => node instanceof HTMLButtonElement)) {
        event.stopPropagation();
      }
    });
  }

  launcher.addEventListener("click", (event) => { event.preventDefault(); togglePanel(); });
  closeBtn.addEventListener("click", (event) => { event.preventDefault(); closePanel(); });
  revealBtn.addEventListener("click", (event) => { event.preventDefault(); reveal(); });
  shadow.querySelectorAll(".grade[data-grade]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      grade(button.dataset.grade);
    });
  });

  popup.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      return;
    }
    if ((event.key === " " || event.code === "Space") && currentCard && !revealed) {
      event.preventDefault();
      reveal();
      return;
    }
    if (revealed && /^[1-5]$/.test(event.key)) {
      event.preventDefault();
      const grades = ["nothing", "something", "hard", "okay", "easy"];
      grade(grades[Number(event.key) - 1]);
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (retired) return;
    if (message?.type === "JPDB_UI_PROBE") {
      sendResponse?.({ ready: true });
      return;
    }
    if (message?.type === "JPDB_PANEL_FORCE_CLOSE") {
      const incoming = Number(message.panelRevision) || 0;
      if (incoming < panelRevision) return;
      panelRevision = incoming;
      setPanelOpenLocal(false);
      return;
    }
    if (message?.type === "JPDB_SHARED_SESSION_CHANGED") {
      if (panelOpen && message.state) applySession(message.state);
    }
  });

  async function loadInitialState() {
    try {
      const settings = await chrome.storage.local.get({ enabled: true });
      enabled = Boolean(settings.enabled);
      schedulePosition();
      const result = await send({ type: "JPDB_GET_PANEL_STATE" });
      panelRevision = Number(result.panelRevision) || 0;
      setPanelOpenLocal(Boolean(result.open));
      if (result.open && result.state) applySession(result.state);
    } catch (error) {
      console.debug("Ambient JPDB startup:", error);
    }
  }

  function onStorageChanged(changes, area) {
    if (area !== "local" || !changes.enabled) return;
    enabled = Boolean(changes.enabled.newValue);
    if (!enabled && panelOpen) closePanel();
    schedulePosition();
  }
  chrome.storage.onChanged.addListener(onStorageChanged);

  // ChatGPT uses client-side route changes for image views and other surfaces.
  // Re-run the anchor lookup after history transitions without changing panel state.
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    if (typeof original !== "function") continue;
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      if (!retired) {
        bindAnchor();
        schedulePosition();
      }
      return result;
    };
    history[method] = wrapped;
    historyRestorers.push(() => {
      if (history[method] === wrapped) history[method] = original;
    });
  }
  window.addEventListener("popstate", () => { bindAnchor(); schedulePosition(); });
  window.addEventListener("pageshow", () => { bindAnchor(); schedulePosition(); });

  loadInitialState();
})();
