import type { CardRow } from "@/lib/csv";

/** 1 = Spades, 2 = Hearts, 3 = Diamonds, 4 = Clubs */
const SUIT_LABELS: Record<number, string> = {
  1: "Spades",
  2: "Hearts",
  3: "Diamonds",
  4: "Clubs",
};

const SUIT_NUM_TO_LETTER: Record<number, string> = {
  1: "S",
  2: "H",
  3: "D",
  4: "C",
};

const SUIT_LETTER_TO_NUM: Record<string, number> = {
  S: 1,
  H: 2,
  D: 3,
  C: 4,
};

const RANK_RE = /^(10|[2-9]|[AJQK])$/;
const RANK_SUIT_RE = /^(10|[2-9]|[AJQK])([SHDC])$/;

/**
 * Canonical card key: rank + suit letter (S/H/D/C). Examples: AS, AD, 10H, KH.
 * Legacy input like 1A (suit 1 + A) or 110 (10♠) is still accepted and normalized to this form.
 */
export function cardKeyFromSuitRank(suit: number, rank: string): string | null {
  if (suit < 1 || suit > 4) return null;
  const letter = SUIT_NUM_TO_LETTER[suit];
  if (!letter) return null;
  return `${rank}${letter}`;
}

export function parseCardToken(raw: string): { suit: number; rank: string; key: string } | null {
  const t = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (t.length < 2) return null;

  const mNew = t.match(RANK_SUIT_RE);
  if (mNew) {
    const rank = mNew[1]!;
    const letter = mNew[2]!;
    const suit = SUIT_LETTER_TO_NUM[letter];
    if (suit === undefined) return null;
    return { suit, rank, key: `${rank}${letter}` };
  }

  const suit = parseInt(t[0]!, 10);
  if (suit >= 1 && suit <= 4) {
    const rankPart = t.slice(1);
    if (RANK_RE.test(rankPart)) {
      const letter = SUIT_NUM_TO_LETTER[suit];
      return { suit, rank: rankPart, key: `${rankPart}${letter}` };
    }
  }

  return null;
}

export function splitOrderText(text: string): string[] {
  return text
    .split(/[\s,;]+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** First occurrence of each key only, order preserved. */
export function uniqueKeysInOrder(keys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function appendWithoutDuplicates(prev: string[], tail: string[]): string[] {
  const seen = new Set(prev);
  const out = [...prev];
  for (const k of tail) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * Merge a new left-to-right vision readout into the existing order line.
 *
 * Vision **never** shortens the list, **never** replaces the whole line, and **never** reorders
 * existing tokens. It may only **append** after the current list (or leave it unchanged).
 * A card that is **already anywhere** in the line is never added again (each card at most once).
 *
 * - **Extend**: if `next` begins with the same sequence as all of `prev`, append any extra tokens
 *   on the right that are not already in the line.
 * - **Tail overlap**: if the start of `next` matches the end of `prev`, append only new trailing
 *   tokens that are not already in the line.
 * - **Single new card** with no overlap: append one token if it is not already in the line.
 * - **Shorter read** or **multi-card read** with no safe rule above: leave `prev` unchanged.
 */
export function mergeVisionReadout(prevLine: string, newKeys: string[]): string {
  const next = newKeys.map((k) => k.toUpperCase());
  if (next.length === 0) return prevLine.trim();

  const prev = splitOrderText(prevLine).map((t) => t.toUpperCase());
  if (prev.length === 0) return uniqueKeysInOrder(next).join(" ");

  let i = 0;
  const max = Math.min(prev.length, next.length);
  while (i < max && prev[i] === next[i]) i++;

  if (i === prev.length) {
    return appendWithoutDuplicates(prev, next.slice(prev.length)).join(" ");
  }

  if (i === next.length && next.length <= prev.length) {
    return prev.join(" ");
  }

  let overlap = Math.min(prev.length, next.length);
  while (overlap > 0) {
    const suf = prev.slice(-overlap);
    const pre = next.slice(0, overlap);
    if (suf.every((t, idx) => t === pre[idx])) {
      const rest = next.slice(overlap);
      if (rest.length === 0) {
        return prev.join(" ");
      }
      return appendWithoutDuplicates(prev, rest).join(" ");
    }
    overlap--;
  }

  if (next.length === 1) {
    if (new Set(prev).has(next[0]!)) {
      return prev.join(" ");
    }
    return [...prev, next[0]!].join(" ");
  }

  return prev.join(" ");
}

export function humanizeCardKey(key: string): string {
  const p = parseCardToken(key);
  if (!p) return key;
  const suitName = SUIT_LABELS[p.suit] ?? String(p.suit);
  return `${p.rank} of ${suitName}`;
}

export type GenerateResult =
  | { ok: true; rows: CardRow[] }
  | { ok: false; errors: string[] };

export const CARD_FORMAT_HINT =
  "Cards are rank + suit letter (e.g. AS, 10H, KD) or legacy suit 1–4 + rank (e.g. 1A, 110).";

const MAX_TOKEN_ERRORS = 5;

/** Parse raw order tokens to canonical keys, collecting one error per invalid token (capped at 5 per order). */
export function parseOrderTokens(
  raw: string[],
  orderLabel: "Start" | "End",
): { keys: string[]; errors: string[] } {
  const keys: string[] = [];
  const errors: string[] = [];
  let overflow = 0;
  for (let i = 0; i < raw.length; i++) {
    const p = parseCardToken(raw[i]!);
    if (p) keys.push(p.key);
    else if (errors.length < MAX_TOKEN_ERRORS) {
      errors.push(`"${raw[i]}" is not a valid card in ${orderLabel} order (position ${i + 1}).`);
    } else overflow++;
  }
  if (overflow > 0) {
    errors.push(`…and ${overflow} more invalid token${overflow === 1 ? "" : "s"} in ${orderLabel} order.`);
  }
  return { keys, errors };
}

/**
 * One CSV row per card: start/end position = 1-based index in each list.
 * Rows sorted by start position. Card Number = canonical token (e.g. 10S, AS, KD).
 */
export function rowsFromStartEndOrders(
  name: string,
  sequenceId: string,
  trialId: string,
  startText: string,
  endText: string,
): GenerateResult {
  const errors: string[] = [];
  const startRaw = splitOrderText(startText);
  const endRaw = splitOrderText(endText);

  if (startRaw.length === 0) errors.push("Start order is empty.");
  if (endRaw.length === 0) errors.push("End order is empty.");
  if (errors.length) return { ok: false, errors };

  const start = parseOrderTokens(startRaw, "Start");
  const end = parseOrderTokens(endRaw, "End");
  errors.push(...start.errors, ...end.errors);
  if (errors.length) {
    errors.push(CARD_FORMAT_HINT);
    return { ok: false, errors };
  }
  const startKeys = start.keys;
  const endKeys = end.keys;

  const endIndex = new Map<string, number>();
  const dupStart = new Set<string>();
  const dupEnd = new Set<string>();
  const seenStart = new Set<string>();
  const seenEnd = new Set<string>();

  startKeys.forEach((k) => {
    if (seenStart.has(k)) dupStart.add(k);
    seenStart.add(k);
  });
  endKeys.forEach((k, idx) => {
    if (seenEnd.has(k)) {
      dupEnd.add(k);
    } else {
      endIndex.set(k, idx + 1);
    }
    seenEnd.add(k);
  });

  if (dupStart.size > 0) {
    errors.push(
      `Duplicate cards in start order: ${[...dupStart].map((k) => `${k} (${humanizeCardKey(k)})`).join(", ")}.`,
    );
  }
  if (dupEnd.size > 0) {
    errors.push(
      `Duplicate cards in end order: ${[...dupEnd].map((k) => `${k} (${humanizeCardKey(k)})`).join(", ")}.`,
    );
  }
  if (errors.length) return { ok: false, errors };

  // Both lists are duplicate-free past this point, so multiset equality reduces to set
  // equality, and endIndex holds every end key exactly once.
  if (startKeys.length !== endKeys.length || !startKeys.every((k) => endIndex.has(k))) {
    errors.push(
      "Start and end orders must contain the same cards the same number of times (same multiset).",
    );
    return { ok: false, errors };
  }

  if (startKeys.every((k, i) => k === endKeys[i])) {
    errors.push("Start order and end order are identical — every card is in the same position. This is likely a copy-paste error.");
    return { ok: false, errors };
  }

  const rows: CardRow[] = startKeys.map((key, idx) => ({
    id: crypto.randomUUID(),
    name,
    sequenceId,
    trialId,
    cardNumber: key,
    startPosition: String(idx + 1),
    endPosition: String(endIndex.get(key)!), // safe: set equality + no-duplicates checks above guarantee every startKey appears exactly once in endIndex
  }));

  return { ok: true, rows };
}
