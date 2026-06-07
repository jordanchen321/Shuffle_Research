import type { CardRow } from "@/lib/csv";

/** 1 = Spades, 2 = Hearts, 3 = Diamonds, 4 = Clubs */
export const SUIT_LABELS: Record<number, string> = {
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
    if (!RANK_RE.test(rank)) return null;
    const suit = SUIT_LETTER_TO_NUM[letter];
    if (!suit) return null;
    return { suit, rank, key: `${rank}${letter}` };
  }

  const suit = parseInt(t[0]!, 10);
  if (suit >= 1 && suit <= 4 && !Number.isNaN(suit)) {
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
function uniqueKeysInOrder(keys: string[]): string[] {
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

function multiset<T>(keys: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const k of keys) {
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function multisetsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
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

/**
 * One CSV row per card: start/end position = 1-based index in each list.
 * Rows sorted by start position. Card Number = canonical token (e.g. 10S, AS, KD).
 */
export function rowsFromStartEndOrders(
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

  const startKeys: string[] = [];
  const endKeys: string[] = [];

  for (let i = 0; i < startRaw.length; i++) {
    const p = parseCardToken(startRaw[i]!);
    if (!p)
      errors.push(
        `Start #${i + 1}: invalid token "${startRaw[i]}". Use rank + suit letter (e.g. AS, AD, 10H) or legacy 1–4 + rank (e.g. 1A, 110).`,
      );
    else startKeys.push(p.key);
  }
  for (let i = 0; i < endRaw.length; i++) {
    const p = parseCardToken(endRaw[i]!);
    if (!p)
      errors.push(
        `End #${i + 1}: invalid token "${endRaw[i]}". Use rank + suit letter (e.g. AS, AD, 10H) or legacy 1–4 + rank (e.g. 1A, 110).`,
      );
    else endKeys.push(p.key);
  }
  if (errors.length) return { ok: false, errors };

  const startBag = multiset(startKeys);
  const endBag = multiset(endKeys);
  if (!multisetsEqual(startBag, endBag)) {
    errors.push(
      "Start and end orders must contain the same cards the same number of times (same multiset).",
    );
    return { ok: false, errors };
  }

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
    if (seenEnd.has(k)) dupEnd.add(k);
    seenEnd.add(k);
    endIndex.set(k, idx + 1);
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

  const rows: CardRow[] = startKeys.map((key, idx) => ({
    trials: trialId,
    startPosition: String(idx + 1),
    endPosition: String(endIndex.get(key)),
    cardNumber: key,
  }));

  return { ok: true, rows };
}
