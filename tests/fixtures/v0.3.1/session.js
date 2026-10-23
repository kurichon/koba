export function normalizeReviewSession(raw) {
  return {
    card: raw?.card || null,
    revealed: Boolean(raw?.revealed),
    revision: Math.max(0, Number(raw?.revision) || 0)
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
