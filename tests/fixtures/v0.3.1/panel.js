export function normalizePanelState(raw) {
  return {
    openTabId: Number.isInteger(raw?.openTabId) ? raw.openTabId : null,
    revision: Math.max(0, Number(raw?.revision) || 0)
  };
}

export function openPanelForTab(state, tabId) {
  const current = normalizePanelState(state);
  if (!Number.isInteger(tabId)) return current;
  if (current.openTabId === tabId) return current;
  return { openTabId: tabId, revision: current.revision + 1 };
}

export function closePanelForTab(state, tabId) {
  const current = normalizePanelState(state);
  if (current.openTabId !== tabId) return current;
  return { openTabId: null, revision: current.revision + 1 };
}

export function togglePanelForTab(state, tabId) {
  const current = normalizePanelState(state);
  if (!Number.isInteger(tabId)) return { state: current, open: false, changed: false };
  if (current.openTabId === tabId) {
    return {
      state: { openTabId: null, revision: current.revision + 1 },
      open: false,
      changed: true
    };
  }
  return {
    state: { openTabId: tabId, revision: current.revision + 1 },
    open: true,
    changed: true
  };
}
