export const CSV_HEADERS = [
  "name",
  "sequence_id",
  "trial_id",
  "card_number",
  "start_position",
  "end_position",
] as const;

export type CardRow = {
  id: string;
  name: string;
  sequenceId: string;
  trialId: string;
  cardNumber: string;
  startPosition: string;
  endPosition: string;
};

const HEADER_ALIASES: Record<string, keyof CardRow> = {
  name: "name",
  sequence_id: "sequenceId",
  sequenceid: "sequenceId",
  trial_id: "trialId",
  trialid: "trialId",
  // backward compat for old schema
  trials: "trialId",
  trial: "trialId",
  card_number: "cardNumber",
  cardnumber: "cardNumber",
  "card number": "cardNumber",
  start_position: "startPosition",
  startposition: "startPosition",
  "start position": "startPosition",
  end_position: "endPosition",
  endposition: "endPosition",
  "end position": "endPosition",
};

function parseLine(line: string, delimiter: string): { cells: string[]; unclosedQuote: boolean } {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return { cells: out, unclosedQuote: inQuotes };
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
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return { rows: [], warnings: ["File was empty."] };
  }

  const lines = normalized.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], warnings: ["No rows found."] };

  const delimiter = detectDelimiter(lines[0]!);
  const { cells: headerCells, unclosedQuote: headerUnclosed } = parseLine(lines[0]!, delimiter);
  if (headerUnclosed) warnings.push("Unclosed quote in CSV header.");

  const colMap: Partial<Record<keyof CardRow, number>> = {};
  headerCells.forEach((raw, idx) => {
    const key = HEADER_ALIASES[normalizeHeader(raw)];
    if (key) colMap[key] = idx;
  });

  const required: (keyof CardRow)[] = ["startPosition", "endPosition", "cardNumber"];
  const missing = required.filter((k) => colMap[k] === undefined);
  if (missing.length > 0) {
    warnings.push(
      `Could not find columns: ${missing.join(", ")}. Expected headers like: ${CSV_HEADERS.join(", ")}`,
    );
    return { rows: [], warnings };
  }

  const rows: CardRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const { cells, unclosedQuote } = parseLine(lines[i]!, delimiter);
    if (unclosedQuote) warnings.push(`Unclosed quote in row ${i}.`);
    if (cells.length < headerCells.length) {
      warnings.push(`Row ${i}: only ${cells.length} of ${headerCells.length} columns present — required fields may be empty.`);
    }
    if (cells.every((c) => c === "")) continue;
    const get = (key: keyof CardRow) => {
      const idx = colMap[key];
      return idx !== undefined ? (cells[idx] ?? "") : "";
    };
    rows.push({
      id: crypto.randomUUID(),
      name: get("name"),
      sequenceId: get("sequenceId"),
      trialId: get("trialId"),
      cardNumber: get("cardNumber").toUpperCase(),
      startPosition: get("startPosition"),
      endPosition: get("endPosition"),
    });
  }

  return { rows, warnings };
}

function escapeField(value: string, delimiter: string): string {
  const needsQuote =
    value.includes('"') ||
    value.includes("\n") ||
    value.includes(delimiter) ||
    (value.includes("\t") && delimiter !== "\t");
  if (!needsQuote) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function stringifyCardCsv(rows: CardRow[], delimiter: "," | "\t" = ","): string {
  const d = delimiter;
  const header = CSV_HEADERS.map((h) => escapeField(h, d)).join(d);
  const body = rows.map((row) =>
    [row.name, row.sequenceId, row.trialId, row.cardNumber, row.startPosition, row.endPosition]
      .map((cell) => escapeField(cell, d))
      .join(d),
  );
  return [header, ...body].join("\n") + "\n";
}

export function emptyRow(): CardRow {
  return {
    id: crypto.randomUUID(),
    name: "",
    sequenceId: "",
    trialId: "",
    cardNumber: "",
    startPosition: "",
    endPosition: "",
  };
}
