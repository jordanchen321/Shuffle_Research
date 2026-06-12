import { cardKeyFromSuitRank, parseCardToken } from "@/lib/cards";

export type RoboflowDetection = {
  x: number;
  y: number;
  width: number;
  height: number;
  class: string;
  confidence: number;
};

const SUIT_WORD: Record<string, string> = {
  SPADE: "1",
  SPADES: "1",
  HEART: "2",
  HEARTS: "2",
  DIAMOND: "3",
  DIAMONDS: "3",
  CLUB: "4",
  CLUBS: "4",
};

const RANK_WORD: Record<string, string> = {
  ACE: "A",
  JACK: "J",
  QUEEN: "Q",
  KING: "K",
};

const SUIT_SYM: Record<string, string> = {
  "♠": "S",
  "♥": "H",
  "♦": "D",
  "♣": "C",
};

function normalizeRank(r: string): string | null {
  const u = r.toUpperCase();
  if (u === "10" || u === "T") return "10";
  if (/^[2-9]$/.test(u)) return u;
  if (u === "A") return "A";
  if (u === "J") return "J";
  if (u === "Q") return "Q";
  if (u === "K") return "K";
  return RANK_WORD[u] ?? null;
}

/**
 * Map a YOLO class label to app card key (e.g. AS, 10S, AD).
 * Supports: rank+suit (AH, 10S); legacy 1A / 110; suit+rank (SA, H10); Ace of Spades; unicode suits.
 */
export function visionClassToAppKey(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;

  for (const [sym, letter] of Object.entries(SUIT_SYM)) {
    s = s.replaceAll(sym, letter);
  }

  s = s.replace(/\s+/g, " ").replace(/_/g, " ");
  const compact = s.replace(/\s/g, "").toUpperCase()
    .replace(/^T([SHDC])$/, "10$1")
    .replace(/^([SHDC])T$/, "$110");

  const direct = parseCardToken(compact);
  if (direct) return direct.key;

  const sr = compact.match(/^([SHDC])(10|[2-9]|[AJQK])$/);
  if (sr) {
    const letter = sr[1]!;
    const rank = normalizeRank(sr[2]!);
    if (rank && letter) return `${rank}${letter}`;
  }

  const of = s.match(
    /^(king|queen|jack|ace|\d{1,2})\s+of\s+(spades?|hearts?|diamonds?|clubs?)$/i,
  );
  if (of) {
    const rRaw = of[1]!.toLowerCase();
    const sRaw = of[2]!.toLowerCase();
    let suit: string | undefined;
    if (sRaw.startsWith("spade")) suit = "1";
    else if (sRaw.startsWith("heart")) suit = "2";
    else if (sRaw.startsWith("diamond")) suit = "3";
    else if (sRaw.startsWith("club")) suit = "4";
    let rank: string | null = null;
    if (/^\d+$/.test(rRaw)) {
      const n = parseInt(rRaw, 10);
      if (n === 10) rank = "10";
      else if (n === 1) rank = "A";
      else if (n >= 2 && n <= 9) rank = String(n);
    } else {
      rank = normalizeRank(rRaw);
    }
    if (rank && suit) return cardKeyFromSuitRank(Number(suit), rank) ?? null;
  }

  const us = compact.match(/^(ACE|KING|QUEEN|JACK|10|[2-9])(SPADES?|HEARTS?|DIAMONDS?|CLUBS?)$/);
  if (us) {
    const rank = normalizeRank(us[1]!);
    const suit = SUIT_WORD[us[2]!];
    if (rank && suit) return cardKeyFromSuitRank(Number(suit), rank) ?? null;
  }

  return null;
}

const X_SORT_THRESHOLD_PX = 2;

function sortDetectionsLeftToRight(d: RoboflowDetection[]): RoboflowDetection[] {
  return [...d].sort((a, b) => {
    const dx = a.x - b.x;
    if (Math.abs(dx) > X_SORT_THRESHOLD_PX) return dx;
    return a.y - b.y;
  });
}

function dedupeDetectionsPerCardKey(detections: RoboflowDetection[]): RoboflowDetection[] {
  const best = new Map<string, RoboflowDetection>();
  for (const d of detections) {
    const appKey = visionClassToAppKey(d.class);
    const bucket = appKey ?? `__raw__:${d.class.trim()}`;
    const cur = best.get(bucket);
    if (!cur || d.confidence > cur.confidence) best.set(bucket, d);
  }
  return sortDetectionsLeftToRight([...best.values()]);
}

export type FanDecodeResult =
  | { ok: true; keys: string[]; warnings: string[]; detections: RoboflowDetection[] }
  | {
      ok: false;
      errors: string[];
      keys: string[];
      partial: { className: string; reason: string }[];
      detections: RoboflowDetection[];
    };

/**
 * Decode raw detections to ordered card keys. Dedupes per card key (best confidence wins)
 * and sorts left-to-right internally; `detections` in the result is that deduped, sorted list.
 */
export function detectionsToOrderedKeys(predictions: RoboflowDetection[]): FanDecodeResult {
  const sorted = dedupeDetectionsPerCardKey(predictions);
  if (sorted.length === 0) {
    return {
      ok: true,
      keys: [],
      warnings: [
        "No cards detected. Lower min confidence (try 0.15–0.28), check lighting, or confirm the vision server and model.",
      ],
      detections: sorted,
    };
  }
  const keys: string[] = [];
  const partial: { className: string; reason: string }[] = [];
  const warnings: string[] = [];

  for (const p of sorted) {
    const k = visionClassToAppKey(p.class);
    if (!k) {
      partial.push({
        className: p.class,
        reason: "Unrecognized class name for this app",
      });
    } else {
      keys.push(k);
    }
  }

  if (partial.length > 0) {
    return {
      ok: false,
      errors: [
        `${partial.length} detection(s) could not be mapped. Edit class names in the model or enter those cards manually.`,
      ],
      keys,
      partial,
      detections: sorted,
    };
  }

  return { ok: true, keys, warnings, detections: sorted };
}

export function extractDetectionPredictions(data: unknown): RoboflowDetection[] {
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  const raw = Array.isArray(o.predictions) ? o.predictions : null;
  if (!raw) return [];
  const out: RoboflowDetection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const x = Number(p.x);
    const y = Number(p.y);
    const w = Number(p.width);
    const h = Number(p.height);
    const cls = String(p.class ?? p.class_name ?? "");
    const conf = Number(p.confidence ?? p.score ?? 0);
    if (Number.isFinite(x) && Number.isFinite(y) && cls) {
      out.push({
        x,
        y,
        width: Number.isFinite(w) ? w : 0,
        height: Number.isFinite(h) ? h : 0,
        class: cls,
        confidence: Number.isFinite(conf) ? conf : 0,
      });
    }
  }
  return out;
}
