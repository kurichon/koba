export function normalizePanelState(raw) {
  return {
    openTabId: Number.isInteger(raw?.openTabId) ? raw.openTabId : null,
    revision: Math.max(0, Number(raw?.revision) || 0),
    intents: raw?.intents && typeof raw.intents === "object" ? raw.intents : {}
  };
}

// Explicit intent is idempotent. Recent IDs prevent a duplicated old request
// from taking ownership again after a newer close or transfer.
export function setPanelForTab(state, tabId, open, intentId) {
  const current = normalizePanelState(state);
  if (!Number.isInteger(tabId)) return current;
  const previous = current.intents[tabId] || { id: null, recent: [] };
  if (intentId && previous.recent?.includes(intentId)) return current;
  const intents = { ...current.intents, [tabId]: {
    id: intentId || null,
    recent: [...(previous.recent || []), intentId].filter(Boolean).slice(-16)
  } };
  // Closed tabs are also pruned by onRemoved. Bound diagnostic/idempotency data.
  const ids = Object.keys(intents);
  for (const id of ids.slice(0, Math.max(0, ids.length - 32))) {
    if (Number(id) !== tabId && Number(id) !== current.openTabId) delete intents[id];
  }
  return {
    openTabId: open ? tabId : current.openTabId === tabId ? null : current.openTabId,
    revision: current.revision + 1,
    intents
  };
}

