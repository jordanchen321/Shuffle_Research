export const CSV_HEADERS = [
  "Trials",
  "start Position",
  "End position",
  "Card Number",
] as const;

export type CardRow = {
  trials: string;
  startPosition: string;
  endPosition: string;
  cardNumber: string;
};

const HEADER_ALIASES: Record<string, keyof CardRow> = {
  trials: "trials",
  trial: "trials",
  "start position": "startPosition",
  startposition: "startPosition",
  "end position": "endPosition",
  endposition: "endPosition",
  "card number": "cardNumber",
  cardnumber: "cardNumber",
};

function parseLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

function detectDelimiter(headerLine: string): string {
  let commas = 0;
  let tabs = 0;
  let inQuotes = false;
  for (const c of headerLine) {
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (c === ",") commas++;
      if (c === "\t") tabs++;
    }
  }
  return tabs > commas ? "\t" : ",";
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseCardCsv(text: string): { rows: CardRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return { rows: [], warnings: ["File was empty."] };
  }

  const lines = normalized.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], warnings: ["No rows found."] };

  const delimiter = detectDelimiter(lines[0]);
  const headerCells = parseLine(lines[0], delimiter).map((c) =>
    c.replace(/^"|"$/g, "").trim(),
  );

  const colMap: Partial<Record<keyof CardRow, number>> = {};
  headerCells.forEach((raw, idx) => {
    const key = HEADER_ALIASES[normalizeHeader(raw)];
    if (key) colMap[key] = idx;
  });

  const required: (keyof CardRow)[] = [
    "trials",
    "startPosition",
    "endPosition",
    "cardNumber",
  ];
  const missing = required.filter((k) => colMap[k] === undefined);
  if (missing.length > 0) {
    warnings.push(
      `Could not find columns: ${missing.join(", ")}. Expected headers like: ${CSV_HEADERS.join(", ")}`,
    );
  }

  const rows: CardRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i], delimiter).map((c) =>
      c.replace(/^"|"$/g, "").trim(),
    );
    const get = (key: keyof CardRow) => {
      const idx = colMap[key];
      return idx !== undefined ? (cells[idx] ?? "") : "";
    };
    rows.push({
      trials: get("trials"),
      startPosition: get("startPosition"),
      endPosition: get("endPosition"),
      cardNumber: get("cardNumber").trim().toUpperCase(),
    });
  }

  return { rows, warnings };
}

function escapeField(value: string, delimiter: string): string {
  const needsQuote =
    value.includes('"') ||
    value.includes("\n") ||
    value.includes(delimiter) ||
    value.includes("\t");
  if (!needsQuote) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function stringifyCardCsv(rows: CardRow[], delimiter: "," | "\t" = ","): string {
  const d = delimiter;
  const header = CSV_HEADERS.map((h) => escapeField(h, d)).join(d);
  const body = rows.map((row) =>
    [row.trials, row.startPosition, row.endPosition, row.cardNumber]
      .map((cell) => escapeField(cell, d))
      .join(d),
  );
  return [header, ...body].join("\n");
}

export function emptyRow(): CardRow {
  return {
    trials: "",
    startPosition: "",
    endPosition: "",
    cardNumber: "",
  };
}
