export function normalizeReviewSession(raw) {
  return {
    card: raw?.card || null,
    revealed: Boolean(raw?.revealed),
    revision: Math.max(0, Number(raw?.revision) || 0),
    loading: Boolean(raw?.loading),
    progress: raw?.progress && ["decks", "vocabulary", "reviews"].includes(raw.progress.phase) ? {
      phase: raw.progress.phase, completed: Math.max(0, Number(raw.progress.completed) || 0),
      total: Number.isFinite(raw.progress.total) && raw.progress.total >= 0 ? Number(raw.progress.total) : null,
      startedAt: Number(raw.progress.startedAt) || 0
    } : null,
    error: raw?.error && typeof raw.error.message === "string" ? raw.error : null,
    submission: raw?.submission || null,
    recoveryCount: Math.max(0, Number(raw?.recoveryCount) || 0),
    lastOutcome: raw?.lastOutcome || null
  };
}

export function validateCardAction(session, {
  vid,
  sid,
  revision,
  requireRevealed = false
} = {}) {
  const card = session?.card;
  if (!card) return { valid: false, reason: "already-handled" };
  if (card.vid !== vid || card.sid !== sid) return { valid: false, reason: "stale-card" };
  if (Number(revision) !== Number(session?.revision)) return { valid: false, reason: "stale-session" };
  if (requireRevealed && !session?.revealed) return { valid: false, reason: "not-revealed" };
  return { valid: true, reason: null };
}
