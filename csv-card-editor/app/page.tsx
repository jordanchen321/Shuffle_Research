"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const RESEARCHER_NAMES = ["Sam", "Seena", "Jordan", "Caleb", "Peter"] as const;
const TABLE_HEADERS = [...CSV_HEADERS, "label", ""] as const;

function AlertModal({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-5 text-sm text-zinc-800 dark:text-zinc-200">{message}</p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

type SequenceOption = {
  sequenceId: string;
  name: string;
  lastTrialId: string;
  nextTrialId: string;
  lastEndOrder: string;
};

function computeAvailableSequences(rows: CardRow[]): SequenceOption[] {
  const ids = [...new Set(rows.map((r) => r.sequenceId).filter(Boolean))];
  return ids.map((seqId) => {
    const seqRows = rows.filter((r) => r.sequenceId === seqId);
    const trialIds = [...new Set(seqRows.map((r) => r.trialId))];
    trialIds.sort((a, b) => {
      const na = parseInt(a, 10), nb = parseInt(b, 10);
      return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b);
    });
    const lastTrialId = trialIds[trialIds.length - 1] ?? "0";
    const lastTrialRows = seqRows.filter((r) => r.trialId === lastTrialId);
    const sorted = [...lastTrialRows].sort(
      (a, b) => parseInt(a.endPosition, 10) - parseInt(b.endPosition, 10),
    );
    const lastEndOrder = sorted.map((r) => r.cardNumber).join(" ");
    const lastNum = parseInt(lastTrialId, 10);
    const nextTrialId = isNaN(lastNum) ? "" : String(lastNum + 1);
    const names = [...new Set(seqRows.map((r) => r.name).filter(Boolean))];
    return {
      sequenceId: seqId,
      name: names.length === 1 ? names[0]! : "",
      lastTrialId,
      nextTrialId,
      lastEndOrder,
    };
  });
}

function generateSequenceId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

type CardRowProps = {
  row: CardRow;
  globalIndex: number;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  updateRow: (index: number, field: keyof CardRow, value: string) => void;
  removeRow: (index: number) => void;
};

const CardRowComponent = memo(function CardRowComponent({
  row,
  globalIndex,
  isSelected,
  onToggleSelect,
  updateRow,
  removeRow,
}: CardRowProps) {
  const inputClass =
    "w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 font-mono text-sm outline-none focus:border-zinc-300 focus:bg-white dark:focus:border-zinc-600 dark:focus:bg-zinc-950";
  return (
    <tr className="border-b border-zinc-100 odd:bg-white even:bg-zinc-50/80 dark:border-zinc-800 dark:odd:bg-zinc-950 dark:even:bg-zinc-900/40">
      <td className="px-3 py-1">
        <input
          type="checkbox"
          checked={isSelected ?? false}
          onChange={() => onToggleSelect(row.id)}
          aria-label={`Select row ${globalIndex + 1}`}
          className="h-4 w-4 cursor-pointer rounded border-zinc-300 accent-zinc-800 dark:accent-zinc-200"
        />
      </td>
      <td className="p-1">
        <select
          className={`${inputClass} min-w-24 cursor-pointer`}
          value={row.name}
          onChange={(e) => updateRow(globalIndex, "name", e.target.value)}
          aria-label={`Name row ${globalIndex + 1}`}
        >
          <option value="" />
          {RESEARCHER_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </td>
      <td className="p-1">
        <input
          className={`${inputClass} min-w-32`}
          value={row.sequenceId}
          onChange={(e) => updateRow(globalIndex, "sequenceId", e.target.value)}
          aria-label={`Sequence ID row ${globalIndex + 1}`}
        />
      </td>
      <td className="p-1">
        <input
          className={`${inputClass} min-w-20`}
          value={row.trialId}
          onChange={(e) => updateRow(globalIndex, "trialId", e.target.value)}
          aria-label={`Trial ID row ${globalIndex + 1}`}
        />
      </td>
      <td className="p-1">
        <input
          className={`${inputClass} min-w-28`}
          value={row.cardNumber}
          onChange={(e) =>
            updateRow(globalIndex, "cardNumber", e.target.value.toUpperCase())
          }
          aria-label={`Card number row ${globalIndex + 1}`}
        />
      </td>
      <td className="px-2 py-1 text-xs text-zinc-500 dark:text-zinc-500">
        {row.cardNumber
          ? humanizeCardKey(row.cardNumber.trim().toUpperCase())
          : "—"}
      </td>
      <td className="p-1">
        <input
          className={`${inputClass} min-w-28`}
          value={row.startPosition}
          onChange={(e) => updateRow(globalIndex, "startPosition", e.target.value)}
          aria-label={`Start position row ${globalIndex + 1}`}
        />
      </td>
      <td className="p-1">
        <input
          className={`${inputClass} min-w-28`}
          value={row.endPosition}
          onChange={(e) => updateRow(globalIndex, "endPosition", e.target.value)}
          aria-label={`End position row ${globalIndex + 1}`}
        />
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
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CardRow[]>([emptyRow()]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [fileName, setFileName] = useState<string>("Name_wash_shuffle_data.csv");
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [popupMessage, setPopupMessage] = useState<string | null>(null);

  // Bulk-fill state
  const [bulkName, setBulkName] = useState("");
  const [bulkSequenceId, setBulkSequenceId] = useState("");
  const [bulkTrialId, setBulkTrialId] = useState("");

  // Build-rows-from-orders state
  const [buildName, setBuildName] = useState("");
  const [buildSequenceId, setBuildSequenceId] = useState("");
  const [trialId, setTrialId] = useState("1");
  const [startOrderText, setStartOrderText] = useState("");
  const [endOrderText, setEndOrderText] = useState("");
  const [resumeSelectedId, setResumeSelectedId] = useState("");

  const availableSequences = useMemo(() => computeAvailableSequences(rows), [rows]);

  const rowCount = rows.length;
  const [currentPage, setCurrentPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rowCount / ROWS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages - 1);
  const pageOffset = safePage * ROWS_PER_PAGE;
  const pageRows = rows.slice(pageOffset, pageOffset + ROWS_PER_PAGE);
  const [pageInputDraft, setPageInputDraft] = useState(String(safePage + 1));

  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selectedIds.has(r.id));
  const somePageSelected = pageRows.some((r) => selectedIds.has(r.id)) && !allPageSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = somePageSelected;
  }, [somePageSelected]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        pageRows.forEach((r) => next.delete(r.id));
      } else {
        pageRows.forEach((r) => next.add(r.id));
      }
      return next;
    });
  }, [allPageSelected, pageRows]);

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

  const removeSelectedRows = useCallback(() => {
    setRows((prev) => prev.filter((r) => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
  }, [selectedIds]);

  const applyBulkFill = useCallback(() => {
    if (!bulkName && !bulkSequenceId && !bulkTrialId) {
      setLastMessage("Enter at least one field to apply.");
      return;
    }
    if (selectedIds.size === 0) {
      setLastMessage("No rows selected — check the boxes next to the rows you want to update.");
      return;
    }
    setRows((prev) =>
      prev.map((r) => {
        if (!selectedIds.has(r.id)) return r;
        return {
          ...r,
          ...(bulkName ? { name: bulkName } : {}),
          ...(bulkSequenceId ? { sequenceId: bulkSequenceId } : {}),
          ...(bulkTrialId ? { trialId: bulkTrialId } : {}),
        };
      }),
    );
    const parts = [
      bulkName && `name "${bulkName}"`,
      bulkSequenceId && `sequence ID "${bulkSequenceId}"`,
      bulkTrialId && `trial ID "${bulkTrialId}"`,
    ].filter(Boolean).join(", ");
    setLastMessage(`Applied ${parts} to ${selectedIds.size} row(s).`);
  }, [bulkName, bulkSequenceId, bulkTrialId, selectedIds]);

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
    const missing: string[] = [];
    if (!buildName.trim()) missing.push("Name");
    if (!buildSequenceId.trim()) missing.push("Sequence ID");
    if (!trialId.trim()) missing.push("Trial ID");
    if (missing.length > 0) {
      setPopupMessage(`Please fill in the following required fields: ${missing.join(", ")}.`);
      return;
    }
    if (buildSequenceId.trim().length !== 10) {
      setPopupMessage(`Sequence ID must be exactly 10 characters (currently ${buildSequenceId.trim().length}).`);
      return;
    }
    const result = rowsFromStartEndOrders(
      buildName.trim(),
      buildSequenceId.trim(),
      trialId.trim(),
      startOrderText,
      endOrderText,
    );
    if (!result.ok) {
      setLastMessage(result.errors.join(" "));
      return;
    }
    const existingCount = rows.filter(
      (r) => r.trialId === trialId.trim() && r.sequenceId === buildSequenceId.trim(),
    ).length;
    if (existingCount + result.rows.length > 52) {
      setPopupMessage(
        `This would create ${existingCount + result.rows.length} rows for trial "${trialId.trim()}" in sequence "${buildSequenceId.trim()}" — the maximum is 52 (one per card).`,
      );
      return;
    }
    setRows((prev) => [...prev.filter(hasAnyCell), ...result.rows]);
    setLastMessage(`Appended ${result.rows.length} row(s) for trial "${trialId.trim()}".`);
    setStartOrderText(endOrderText);
    setEndOrderText("");
    const nextNum = parseInt(trialId.trim(), 10);
    if (!isNaN(nextNum)) setTrialId(String(nextNum + 1));
  }, [buildName, buildSequenceId, trialId, startOrderText, endOrderText, rows]);

  const startNewSequence = useCallback(() => {
    setBuildSequenceId(generateSequenceId());
    setTrialId("1");
    setStartOrderText("");
    setEndOrderText("");
    setResumeSelectedId("");
  }, []);

  const handleResumeSequence = useCallback(
    (seqId: string) => {
      setResumeSelectedId(seqId);
      if (!seqId) return;
      const seq = availableSequences.find((s) => s.sequenceId === seqId);
      if (!seq) return;
      setBuildSequenceId(seq.sequenceId);
      setTrialId(seq.nextTrialId);
      setStartOrderText(seq.lastEndOrder);
      setEndOrderText("");
      if (seq.name) setBuildName(seq.name);
    },
    [availableSequences],
  );

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

      {/* Bulk-fill */}
      <section className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Bulk fill rows
        </h2>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Stamp name, sequence ID, and/or trial ID onto selected rows. Only non-empty fields are applied.
        </p>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Name</span>
            <select
              value={bulkName}
              onChange={(e) => setBulkName(e.target.value)}
              className="cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="">— select —</option>
              {RESEARCHER_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Sequence ID</span>
            <div className="relative">
              <input
                value={bulkSequenceId}
                onChange={(e) => setBulkSequenceId(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-3 pr-20 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                placeholder="e.g. A3kX9mPq2T"
              />
              <button
                type="button"
                onClick={() => setBulkSequenceId(generateSequenceId())}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                Generate
              </button>
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Trial ID</span>
            <input
              value={bulkTrialId}
              onChange={(e) => setBulkTrialId(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              placeholder="e.g. 1"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={applyBulkFill}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              Apply to selected rows{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
            </button>
          </div>
        </div>
      </section>

      {/* Build rows from card order */}
      <section className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Build rows from card order
        </h2>
        {availableSequences.length > 0 && (
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Resume existing sequence
              </span>
              <select
                value={resumeSelectedId}
                onChange={(e) => handleResumeSequence(e.target.value)}
                className="cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="">— or start fresh below —</option>
                {availableSequences.map((s) => (
                  <option key={s.sequenceId} value={s.sequenceId}>
                    {s.sequenceId}{s.name ? ` (${s.name})` : ""} — trial {s.nextTrialId}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Name</span>
            <select
              value={buildName}
              onChange={(e) => setBuildName(e.target.value)}
              className="cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="">— select —</option>
              {RESEARCHER_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Sequence ID</span>
            <div className="relative">
              <input
                value={buildSequenceId}
                onChange={(e) => setBuildSequenceId(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-3 pr-20 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                placeholder="e.g. A3kX9mPq2T"
              />
              <button
                type="button"
                onClick={() => setBuildSequenceId(generateSequenceId())}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                Generate
              </button>
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Trial ID</span>
            <input
              value={trialId}
              onChange={(e) => setTrialId(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              placeholder="1"
            />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex min-h-35 flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Start order (top → bottom, spaces or commas)
            </span>
            <textarea
              value={startOrderText}
              onChange={(e) => setStartOrderText(e.target.value)}
              className="min-h-30 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              placeholder="e.g. AS AH 10S 4C KS …"
              spellCheck={false}
            />
          </label>
          <label className="flex min-h-35 flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              End order (same cards, shuffled order)
            </span>
            <textarea
              value={endOrderText}
              onChange={(e) => setEndOrderText(e.target.value)}
              className="min-h-30 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
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
          <button
            type="button"
            onClick={startNewSequence}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Start New Sequence
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
        <button
          type="button"
          onClick={removeSelectedRows}
          disabled={selectedIds.size === 0}
          className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 shadow-sm hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          Remove selected{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
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
              <th className="px-3 py-2">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleSelectAll}
                  aria-label="Select all rows"
                  className="h-4 w-4 cursor-pointer rounded border-zinc-300 accent-zinc-800 dark:accent-zinc-200"
                />
              </th>
              {TABLE_HEADERS.map((h, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap px-3 py-2 font-medium text-zinc-800 dark:text-zinc-200"
                >
                  {h}
                </th>
              ))}
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
                  isSelected={selectedIds.has(row.id)}
                  onToggleSelect={toggleSelect}
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

      {popupMessage && (
        <AlertModal message={popupMessage} onClose={() => setPopupMessage(null)} />
      )}
    </div>
  );
}

function hasAnyCell(r: CardRow): boolean {
  return (
    r.name.trim() !== "" ||
    r.sequenceId.trim() !== "" ||
    r.trialId.trim() !== "" ||
    r.startPosition.trim() !== "" ||
    r.endPosition.trim() !== "" ||
    r.cardNumber.trim() !== ""
  );
}
