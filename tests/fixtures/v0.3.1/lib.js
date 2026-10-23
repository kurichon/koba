export const REVIEW_GRADES = ["nothing", "something", "hard", "okay", "easy"];

export function normalizeCardState(state) {
  if (!Array.isArray(state)) return [];
  return state.filter((v) => typeof v === "string");
}

export function parseDueAt(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Accept unix seconds or milliseconds.
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && value.trim() !== "") {
      return asNumber < 10_000_000_000 ? asNumber * 1000 : asNumber;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function isReviewableCard(card, now = Date.now()) {
  const states = normalizeCardState(card?.card_state);
  const primary = states[0] ?? "";
  const nested = states[1] ?? "";
  const dueAt = parseDueAt(card?.due_at);
  const dueNow = dueAt == null || dueAt <= now;

  // Explicitly exclude states that JPDB itself never puts in the active review queue.
  // `redundant` entries are spelling variants whose state is derived from another card,
  // and `locked` entries are waiting on dependencies. Both may carry a nested due/failed
  // state, but must not be surfaced as standalone reviews.
  if (
    states.includes("blacklisted") ||
    states.includes("suspended") ||
    states.includes("new") ||
    states.includes("redundant") ||
    states.includes("locked")
  ) {
    return false;
  }

  if (primary === "due" || nested === "due") return dueNow;
  if (primary === "failed" || nested === "failed") return dueNow;

  // A learning card is only surfaced when JPDB gives us a due timestamp that has elapsed.
  if (primary === "learning" || nested === "learning") {
    return dueAt != null && dueAt <= now;
  }

  return false;
}

export function reviewPriority(card) {
  const states = normalizeCardState(card?.card_state);
  if (states.includes("failed")) return 0;
  if (states.includes("due")) return 1;
  if (states.includes("learning")) return 2;
  return 9;
}

export function sortReviewableCards(cards, now = Date.now()) {
  return cards
    .filter((card) => isReviewableCard(card, now))
    .sort((a, b) => {
      const pa = reviewPriority(a);
      const pb = reviewPriority(b);
      if (pa !== pb) return pa - pb;
      const da = parseDueAt(a.due_at) ?? 0;
      const db = parseDueAt(b.due_at) ?? 0;
      return da - db;
    });
}

export function gradeFromKey(key) {
  const n = Number(key);
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return REVIEW_GRADES[n - 1];
}
