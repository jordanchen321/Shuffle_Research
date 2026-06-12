"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CARD_FORMAT_HINT,
  humanizeCardKey,
  mergeVisionReadout,
  parseOrderTokens,
  rowsFromStartEndOrders,
  splitOrderText,
} from "@/lib/cards";
import { FIELD, SECONDARY_BTN } from "@/lib/ui";
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
const TABLE_HEADERS = [...CSV_HEADERS.slice(0, 4), "label", ...CSV_HEADERS.slice(4), ""] as const;

function sequenceIdError(value: string): string | null {
  const len = value.trim().length;
  return len === 10 ? null : `Sequence ID must be exactly 10 characters (currently ${len}).`;
}

function trialIdError(value: string): string | null {
  const t = value.trim();
  return /^\d+$/.test(t) && parseInt(t, 10) >= 1 ? null : "Trial ID must be a positive integer.";
}

function AlertModal({ message, onClose, onConfirm }: { message: string; onClose: () => void; onConfirm?: () => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const msgId = useId();

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    okRef.current?.focus();
    return () => { prev?.focus(); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    el.addEventListener("keydown", trap);
    return () => el.removeEventListener("keydown", trap);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={onConfirm ? "Confirmation" : "Alert"}
      aria-describedby={msgId}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <p id={msgId} className="mb-5 text-sm text-zinc-800 dark:text-zinc-200">{message}</p>
        <div className="flex justify-end gap-2">
          {onConfirm && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          )}
          <button
            ref={okRef}
            type="button"
            onClick={() => { try { onConfirm?.(); } finally { onClose(); } }}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {onConfirm ? "Continue" : "OK"}
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
  const bySequence = new Map<string, CardRow[]>();
  for (const r of rows) {
    if (!r.sequenceId) continue;
    const group = bySequence.get(r.sequenceId);
    if (group) group.push(r);
    else bySequence.set(r.sequenceId, [r]);
  }
  return [...bySequence].map(([seqId, seqRows]) => {
    const trialIds = [...new Set(seqRows.map((r) => r.trialId))];
    trialIds.sort((a, b) => {
      const na = parseInt(a, 10), nb = parseInt(b, 10);
      return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b);
    });
    const lastTrialId = trialIds[trialIds.length - 1] ?? "0";
    const lastTrialRows = seqRows.filter((r) => r.trialId === lastTrialId);
    const sorted = [...lastTrialRows].sort((a, b) => {
      const na = parseInt(a.endPosition, 10);
      const nb = parseInt(b.endPosition, 10);
      if (isNaN(na) && isNaN(nb)) return 0;
      if (isNaN(na)) return 1;
      if (isNaN(nb)) return -1;
      return na - nb;
    });
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
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]!).join("");
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
          checked={isSelected}
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
        {row.cardNumber ? humanizeCardKey(row.cardNumber) : "—"}
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

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CardRow[]>([emptyRow()]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
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
  const [confirmNewSequence, setConfirmNewSequence] = useState(false);
  const [confirmRestoreStart, setConfirmRestoreStart] = useState(false);

  const availableSequences = useMemo(() => computeAvailableSequences(rows), [rows]);
  const startCardCount = useMemo(() => splitOrderText(startOrderText).length, [startOrderText]);
  const endCardCount = useMemo(() => splitOrderText(endOrderText).length, [endOrderText]);

  const rowCount = rows.length;
  const [currentPage, setCurrentPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rowCount / ROWS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages - 1);
  const pageOffset = safePage * ROWS_PER_PAGE;
  const pageRows = useMemo(() => rows.slice(pageOffset, pageOffset + ROWS_PER_PAGE), [rows, pageOffset]);
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
      const allSelected = pageRows.length > 0 && pageRows.every((r) => prev.has(r.id));
      if (allSelected) {
        pageRows.forEach((r) => next.delete(r.id));
      } else {
        pageRows.forEach((r) => next.add(r.id));
      }
      return next;
    });
  }, [pageRows]);

  const commitPageInput = useCallback((draft: string, pages: number, current: number) => {
    const n = parseInt(draft, 10);
    if (Number.isNaN(n)) {
      setPageInputDraft(String(current + 1));
      return;
    }
    const clamped = Math.min(pages - 1, Math.max(0, n - 1));
    setCurrentPage(clamped);
    setPageInputDraft(String(clamped + 1));
  }, []);

  useEffect(() => {
    setPageInputDraft(String(safePage + 1));
  }, [safePage]);

  useEffect(() => {
    setCurrentPage((p) => Math.min(p, totalPages - 1));
  }, [totalPages]);

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
    const removedId = rowsRef.current[index]?.id;
    if (removedId) setSelectedIds((s) => { const ns = new Set(s); ns.delete(removedId); return ns; });
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
    const seqError = bulkSequenceId ? sequenceIdError(bulkSequenceId) : null;
    if (seqError) {
      setLastMessage(seqError);
      return;
    }
    const trialError = bulkTrialId ? trialIdError(bulkTrialId) : null;
    if (trialError) {
      setLastMessage(trialError);
      return;
    }
    setRows((prev) =>
      prev.map((r) => {
        if (!selectedIds.has(r.id)) return r;
        return {
          ...r,
          ...(bulkName ? { name: bulkName } : {}),
          ...(bulkSequenceId ? { sequenceId: bulkSequenceId.trim() } : {}),
          ...(bulkTrialId ? { trialId: bulkTrialId.trim() } : {}),
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
      if (parsed.length > 10_000) {
        setLastMessage(`File has ${parsed.length} rows — too large to load. Check this is a shuffle data CSV.`);
        return;
      }
      setRows(parsed.length > 0 ? parsed : [emptyRow()]);
      setSelectedIds(new Set());
      setCurrentPage(0);
      setBuildName("");
      setBuildSequenceId("");
      setTrialId("1");
      setStartOrderText("");
      setEndOrderText("");
      setResumeSelectedId("");
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
    const safeName = fileName.replace(/[/\\]/g, "_").replace(/^\.+/, "") || "data";
    a.download = safeName.endsWith(".csv") ? safeName : `${safeName}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    const seqError = sequenceIdError(buildSequenceId);
    if (seqError) {
      setPopupMessage(seqError);
      return;
    }
    const trialError = trialIdError(trialId);
    if (trialError) {
      setPopupMessage(trialError);
      return;
    }
    const startTokens = splitOrderText(startOrderText);
    const endTokens = splitOrderText(endOrderText);
    const countErrors: string[] = [];
    if (startTokens.length !== 52) {
      countErrors.push(`Start order has ${startTokens.length} card${startTokens.length === 1 ? "" : "s"} — expected exactly 52.`);
    }
    if (endTokens.length !== 52) {
      countErrors.push(`End order has ${endTokens.length} card${endTokens.length === 1 ? "" : "s"} — expected exactly 52.`);
    }
    if (countErrors.length > 0) {
      const invalidErrors = [
        ...parseOrderTokens(startTokens, "Start").errors,
        ...parseOrderTokens(endTokens, "End").errors,
      ];
      if (invalidErrors.length > 0) invalidErrors.push(CARD_FORMAT_HINT);
      setPopupMessage([...countErrors, ...invalidErrors].join(" "));
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
      setPopupMessage(result.errors.join(" "));
      return;
    }
    const existingCount = rows.filter(
      (r) => hasAnyCell(r) && r.trialId.trim() === trialId.trim() && r.sequenceId.trim() === buildSequenceId.trim(),
    ).length;
    if (existingCount + result.rows.length > 52) {
      if (existingCount >= 52) {
        const nextNum = parseInt(trialId.trim(), 10);
        setPopupMessage(`Trial "${trialId.trim()}" in sequence "${buildSequenceId.trim()}" is already complete. Did you mean trial ${nextNum + 1}?`);
      } else {
        setPopupMessage(`Trial "${trialId.trim()}" in sequence "${buildSequenceId.trim()}" already has ${existingCount} row(s) — appending would exceed the 52-row limit.`);
      }
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
      setBuildName(seq.name);
    },
    [availableSequences],
  );

  const applyRestoreStartOrder = useCallback(() => {
    const seq = availableSequences.find((s) => s.sequenceId === buildSequenceId.trim());
    if (!seq?.lastEndOrder) return;
    setStartOrderText(seq.lastEndOrder);
    setLastMessage(`Start order restored from the end order of trial ${seq.lastTrialId}.`);
  }, [availableSequences, buildSequenceId]);

  const requestRestoreStartOrder = useCallback(() => {
    const seqId = buildSequenceId.trim();
    if (!seqId) {
      setPopupMessage("Enter a sequence ID first — the start order is restored from that sequence's saved rows.");
      return;
    }
    const seq = availableSequences.find((s) => s.sequenceId === seqId);
    if (!seq?.lastEndOrder) {
      setPopupMessage(`No saved trials for sequence "${seqId}" — nothing to restore.`);
      return;
    }
    if (startOrderText.trim() && startOrderText.trim() !== seq.lastEndOrder) {
      setConfirmRestoreStart(true);
    } else {
      applyRestoreStartOrder();
    }
  }, [availableSequences, buildSequenceId, startOrderText, applyRestoreStartOrder]);

  const mergeVisionKeys = useCallback(
    (target: "start" | "end", keys: string[]) => {
      if (target === "start") {
        setStartOrderText((prev) => mergeVisionReadout(prev, keys));
      } else {
        setEndOrderText((prev) => mergeVisionReadout(prev, keys));
      }
    },
    [],
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
        onMergeVisionKeys={mergeVisionKeys}
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
              className={`${FIELD} cursor-pointer px-3 py-2`}
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
                className={`${FIELD} w-full py-2 pl-3 pr-20`}
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
              className={`${FIELD} px-3 py-2`}
              placeholder="e.g. 1"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={applyBulkFill}
              className={SECONDARY_BTN}
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
                className={`${FIELD} cursor-pointer px-3 py-2`}
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
              className={`${FIELD} cursor-pointer px-3 py-2`}
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
                onChange={(e) => { setBuildSequenceId(e.target.value); if (resumeSelectedId) setResumeSelectedId(""); }}
                className={`${FIELD} w-full py-2 pl-3 pr-20`}
                placeholder="e.g. A3kX9mPq2T"
              />
              <button
                type="button"
                onClick={() => { setBuildSequenceId(generateSequenceId()); if (resumeSelectedId) setResumeSelectedId(""); }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                Generate
              </button>
            </div>
            {buildSequenceId.trim().length > 0 && (
              <span className={`text-xs ${buildSequenceId.trim().length === 10 ? "text-zinc-400 dark:text-zinc-600" : "text-amber-600 dark:text-amber-400"}`}>
                {buildSequenceId.trim().length}/10
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Trial ID</span>
            <input
              value={trialId}
              onChange={(e) => setTrialId(e.target.value)}
              className={`${FIELD} px-3 py-2`}
              placeholder="1"
            />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              label: "Start order (top → bottom, spaces or commas)",
              value: startOrderText,
              setValue: setStartOrderText,
              count: startCardCount,
              placeholder: "e.g. AS AH 10S 4C KS …",
              action: {
                label: "Restore last end order",
                title: "Refill from the saved end order of this sequence's last trial",
                onClick: requestRestoreStartOrder,
              },
            },
            {
              label: "End order (same cards, shuffled order)",
              value: endOrderText,
              setValue: setEndOrderText,
              count: endCardCount,
              placeholder: "e.g. KS AS 4C 10S AH …",
              action: undefined,
            },
          ].map((field) => (
            <label key={field.label} className="flex min-h-35 flex-col gap-1">
              <span className="flex items-baseline justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400">
                <span>{field.label}</span>
                <span className="flex items-baseline gap-2">
                  {field.action && (
                    <button
                      type="button"
                      onClick={field.action.onClick}
                      title={field.action.title}
                      className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {field.action.label}
                    </button>
                  )}
                  {field.value.trim() && (
                    <span className={`tabular-nums ${field.count === 52 ? "text-green-600 dark:text-green-400" : "text-zinc-400 dark:text-zinc-500"}`}>
                      {field.count}/52
                    </span>
                  )}
                </span>
              </span>
              <textarea
                value={field.value}
                onChange={(e) => field.setValue(e.target.value)}
                className={`${FIELD} min-h-30 flex-1 px-3 py-2`}
                placeholder={field.placeholder}
                spellCheck={false}
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={appendFromOrders}
            className={SECONDARY_BTN}
          >
            Append rows
          </button>
          <button
            type="button"
            onClick={() => setConfirmNewSequence(true)}
            className={SECONDARY_BTN}
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
          className={SECONDARY_BTN}
        >
          Open CSV
        </button>
        <button
          type="button"
          onClick={addRow}
          className={SECONDARY_BTN}
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
              <th scope="col" className="px-3 py-2">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleSelectAll}
                  aria-label="Select all rows"
                  className="h-4 w-4 cursor-pointer rounded border-zinc-300 accent-zinc-800 dark:accent-zinc-200"
                />
              </th>
              {TABLE_HEADERS.map((h) => (
                <th
                  key={h || "actions"}
                  scope="col"
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
            className={`${SECONDARY_BTN} disabled:opacity-40`}
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
              onBlur={() => commitPageInput(pageInputDraft, totalPages, safePage)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitPageInput(pageInputDraft, totalPages, safePage);
              }}
              className="w-14 sm:w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-center font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
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
            className={`${SECONDARY_BTN} disabled:opacity-40`}
          >
            Next
          </button>
        </div>
      )}

      {popupMessage && (
        <AlertModal message={popupMessage} onClose={() => setPopupMessage(null)} />
      )}
      {confirmNewSequence && (
        <AlertModal
          message="Start a new sequence? This generates a fresh sequence ID and resets the trial counter to 1. The name field is preserved."
          onClose={() => setConfirmNewSequence(false)}
          onConfirm={startNewSequence}
        />
      )}
      {confirmRestoreStart && (
        <AlertModal
          message="Replace the current Start order with the saved end order of this sequence's last trial?"
          onClose={() => setConfirmRestoreStart(false)}
          onConfirm={applyRestoreStartOrder}
        />
      )}
    </div>
  );
}
