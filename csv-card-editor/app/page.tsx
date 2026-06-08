"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  humanizeCardKey,
  mergeVisionReadout,
  rowsFromStartEndOrders,
} from "@/lib/cards";
import { FanPhotoReader } from "@/components/FanPhotoReader";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  CSV_HEADERS,
  emptyRow,
  parseCardCsv,
  stringifyCardCsv,
  type CardRow,
} from "@/lib/csv";

type CardRowProps = {
  row: CardRow;
  globalIndex: number;
  updateRow: (index: number, field: keyof CardRow, value: string) => void;
  removeRow: (index: number) => void;
};

const CardRowComponent = memo(function CardRowComponent({
  row,
  globalIndex,
  updateRow,
  removeRow,
}: CardRowProps) {
  return (
    <tr className="border-b border-zinc-100 odd:bg-white even:bg-zinc-50/80 dark:border-zinc-800 dark:odd:bg-zinc-950 dark:even:bg-zinc-900/40">
      <td className="p-1">
        <input
          className="w-full min-w-[6rem] rounded-md border border-transparent bg-transparent px-2 py-1.5 font-mono text-sm outline-none focus:border-zinc-300 focus:bg-white dark:focus:border-zinc-600 dark:focus:bg-zinc-950"
          value={row.trials}
          onChange={(e) => updateRow(globalIndex, "trials", e.target.value)}
          aria-label={`Trials row ${globalIndex + 1}`}
        />
      </td>
      <td className="p-1">
        <input
          className="w-full min-w-[7rem] rounded-md border border-transparent bg-transparent px-2 py-1.5 font-mono text-sm outline-none focus:border-zinc-300 focus:bg-white dark:focus:border-zinc-600 dark:focus:bg-zinc-950"
          value={row.startPosition}
          onChange={(e) => updateRow(globalIndex, "startPosition", e.target.value)}
          aria-label={`start Position row ${globalIndex + 1}`}
        />
      </td>
      <td className="p-1">
        <input
          className="w-full min-w-[7rem] rounded-md border border-transparent bg-transparent px-2 py-1.5 font-mono text-sm outline-none focus:border-zinc-300 focus:bg-white dark:focus:border-zinc-600 dark:focus:bg-zinc-950"
          value={row.endPosition}
          onChange={(e) => updateRow(globalIndex, "endPosition", e.target.value)}
          aria-label={`End position row ${globalIndex + 1}`}
        />
      </td>
      <td className="p-1">
        <input
          className="w-full min-w-[7rem] rounded-md border border-transparent bg-transparent px-2 py-1.5 font-mono text-sm outline-none focus:border-zinc-300 focus:bg-white dark:focus:border-zinc-600 dark:focus:bg-zinc-950"
          value={row.cardNumber}
          onChange={(e) =>
            updateRow(globalIndex, "cardNumber", e.target.value.toUpperCase())
          }
          aria-label={`Card Number row ${globalIndex + 1}`}
        />
      </td>
      <td className="px-2 py-1 text-xs text-zinc-500 dark:text-zinc-500">
        {row.cardNumber
          ? humanizeCardKey(row.cardNumber.trim().toUpperCase())
          : "—"}
      </td>
      <td className="p-1">
        <button
          type="button"
          onClick={() => removeRow(globalIndex)}
          aria-label={`Remove row ${globalIndex + 1}`}
          className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          Remove
        </button>
      </td>
    </tr>
  );
});

const ROWS_PER_PAGE = 52;

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CardRow[]>([emptyRow()]);
  const [fileName, setFileName] = useState<string>("trials.csv");
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const [trialId, setTrialId] = useState("1");
  const [startOrderText, setStartOrderText] = useState("");
  const [endOrderText, setEndOrderText] = useState("");

  const rowCount = rows.length;
  const [currentPage, setCurrentPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rowCount / ROWS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages - 1);
  const pageOffset = safePage * ROWS_PER_PAGE;
  const pageRows = rows.slice(pageOffset, pageOffset + ROWS_PER_PAGE);
  const [pageInputDraft, setPageInputDraft] = useState(String(safePage + 1));

  const commitPageInput = useCallback((draft: string, pages: number) => {
    const n = parseInt(draft, 10);
    const clamped = Number.isNaN(n) ? 0 : Math.min(pages - 1, Math.max(0, n - 1));
    setCurrentPage(clamped);
    setPageInputDraft(String(clamped + 1));
  }, []);

  useEffect(() => {
    setPageInputDraft(String(safePage + 1));
  }, [safePage]);

  const updateRow = useCallback(
    (index: number, field: keyof CardRow, value: string) => {
      setRows((prev) =>
        prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
      );
    },
    [],
  );

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, emptyRow()]);
  }, []);

  const removeRow = useCallback((index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10_000_000) {
      setLastMessage("File too large (max 10 MB).");
      e.target.value = "";
      return;
    }
    setFileName(file.name.replace(/\.[^.]+$/, "") + ".csv");
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const { rows: parsed, warnings } = parseCardCsv(text);
      setRows(parsed);
      setCurrentPage(0);
      setLastMessage(warnings.length > 0 ? warnings.join(" ") : null);
    };
    reader.onerror = () => setLastMessage("Failed to read file.");
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const downloadCsv = useCallback(() => {
    const blob = new Blob([stringifyCardCsv(rows, ",")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setLastMessage("Download started.");
  }, [rows, fileName]);

  const appendFromOrders = useCallback(() => {
    const result = rowsFromStartEndOrders(
      trialId.trim() || "1",
      startOrderText,
      endOrderText,
    );
    if (!result.ok) {
      setLastMessage(result.errors.join(" "));
      return;
    }
    setRows((prev) => [...prev.filter(hasAnyCell), ...result.rows]);
    setLastMessage(
      `Appended ${result.rows.length} row(s) for trial "${trialId.trim() || "1"}".`,
    );
  }, [trialId, startOrderText, endOrderText]);

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Card trial CSV editor
          </h1>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-500">
            <li>
              <span className="font-mono text-foreground">S H D C</span> = Spades, Hearts, Diamonds,
              Clubs (rank first, e.g. <span className="font-mono text-foreground">AD</span>,{" "}
              <span className="font-mono text-foreground">10S</span>)
            </li>
          </ul>
        </div>
        <ThemeToggle />
      </header>

      <FanPhotoReader
        onMergeVisionKeys={(target, keys) => {
          if (target === "start") {
            setStartOrderText((prev) => mergeVisionReadout(prev, keys));
          } else {
            setEndOrderText((prev) => mergeVisionReadout(prev, keys));
          }
        }}
        onStatus={setLastMessage}
      />

      <section className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Build rows from card order
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Trial label (CSV &quot;Trials&quot; column)
            </span>
            <input
              value={trialId}
              onChange={(e) => setTrialId(e.target.value)}
              className="max-w-xs rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              placeholder="1"
            />
          </label>
          <label className="flex min-h-[140px] flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Start order (top → bottom, spaces or commas)
            </span>
            <textarea
              value={startOrderText}
              onChange={(e) => setStartOrderText(e.target.value)}
              className="min-h-[120px] flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              placeholder="e.g. AS AH 10S 4C KS …"
              spellCheck={false}
            />
          </label>
          <label className="flex min-h-[140px] flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              End order (same cards, shuffled order)
            </span>
            <textarea
              value={endOrderText}
              onChange={(e) => setEndOrderText(e.target.value)}
              className="min-h-[120px] flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              placeholder="e.g. KS AS 4C 10S AH …"
              spellCheck={false}
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={appendFromOrders}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Append rows
          </button>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={onFile}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Open CSV
        </button>
        <button
          type="button"
          onClick={addRow}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Add row
        </button>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <span>Download name</span>
          <input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className="w-48 rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
        <button
          type="button"
          onClick={downloadCsv}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Download CSV
        </button>
        <span className="text-sm text-zinc-500">
          {rowCount} row(s) &mdash; page {safePage + 1} of {totalPages}
        </span>
      </div>

      {lastMessage && (
        <p role="status" className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
          <span className="flex-1">{lastMessage}</span>
          <button
            type="button"
            onClick={() => setLastMessage(null)}
            aria-label="Dismiss"
            className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            ×
          </button>
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 shadow-sm dark:border-zinc-800">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
              {CSV_HEADERS.map((h) => (
                <th
                  key={h}
                  className="whitespace-nowrap px-3 py-2 font-medium text-zinc-800 dark:text-zinc-200"
                >
                  {h}
                </th>
              ))}
              <th className="px-3 py-2 font-medium text-zinc-800 dark:text-zinc-200">
                Label
              </th>
              <th className="w-24 px-3 py-2 font-medium text-zinc-800 dark:text-zinc-200" />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => {
              const globalIndex = pageOffset + i;
              return (
                <CardRowComponent
                  key={row.id}
                  row={row}
                  globalIndex={globalIndex}
                  updateRow={updateRow}
                  removeRow={removeRow}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Previous
          </button>
          <span className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <span>Page</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={pageInputDraft}
              onChange={(e) => setPageInputDraft(e.target.value)}
              onBlur={() => commitPageInput(pageInputDraft, totalPages)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitPageInput(pageInputDraft, totalPages);
              }}
              className="w-14 rounded-md border border-zinc-300 bg-white px-2 py-1 text-center font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <span>of {totalPages}</span>
            <span className="text-zinc-400 dark:text-zinc-600">
              (rows {pageOffset + 1}–{Math.min(pageOffset + ROWS_PER_PAGE, rowCount)})
            </span>
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage === totalPages - 1}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function hasAnyCell(r: CardRow): boolean {
  return (
    r.trials.trim() !== "" ||
    r.startPosition.trim() !== "" ||
    r.endPosition.trim() !== "" ||
    r.cardNumber.trim() !== ""
  );
}
