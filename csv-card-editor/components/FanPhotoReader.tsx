"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  dedupeDetectionsPerCardKey,
  detectionsToOrderedKeys,
  extractDetectionPredictions,
  visionClassToAppKey,
  type RoboflowDetection,
} from "@/lib/fanVision";
import { uniqueKeysInOrder } from "@/lib/cards";

const LS_CONF = "csv_card_editor_card_vision_confidence";
const LS_LIVE_MS = "csv_card_editor_card_vision_live_ms";
const LS_VISION_TARGET = "csv_card_editor_vision_order_target";

/** Fixed inference request shape (UI for these was removed). */
const VISION_IMGSZ = 960;
const VISION_AUGMENT = false;

/** Live auto-merge after this many lone-card reads of the same key in a row (filters single-frame false positives). */
const LIVE_STABLE_FRAMES = 3;

const LIVE_INTERVAL_OPTIONS = [
  { ms: 350, label: "0.35 s (fastest)" },
  { ms: 500, label: "0.5 s" },
  { ms: 800, label: "0.8 s" },
  { ms: 1200, label: "1.2 s" },
  { ms: 2000, label: "2 s (light)" },
] as const;

type VisionTarget = "start" | "end";

type Props = {
  /** Called whenever a read succeeds; merge into start or end order text. */
  onMergeVisionKeys: (target: VisionTarget, keys: string[]) => void;
  onStatus: (message: string | null) => void;
};

function videoFrameToJpegBase64(
  video: HTMLVideoElement,
  maxWidth: number,
  quality: number,
  canvas: HTMLCanvasElement,
): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw < 2 || vh < 2) return null;
  const scale = Math.min(1, maxWidth / vw);
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const parts = dataUrl.split(",");
  return parts.length > 1 ? parts[1]! : dataUrl;
}

export function FanPhotoReader({ onMergeVisionKeys, onStatus }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const capturingRef = useRef(false);
  const liveStartingRef = useRef(false);
  /** Last key we merged from live auto-read; ignore repeats until the camera shows a different key. */
  const lastLiveMergedKeyRef = useRef<string | null>(null);
  /** Running single-card label for consecutive-frame agreement (silent / live only). */
  const liveStableKeyRef = useRef<string | null>(null);
  const liveStableCountRef = useRef(0);
  const visionTargetRef = useRef<VisionTarget>("start");

  const [visionTarget, setVisionTarget] = useState<VisionTarget>("start");
  const [confidence, setConfidence] = useState(0.22);
  const [liveIntervalMs, setLiveIntervalMs] = useState(500);
  const [cameraActive, setCameraActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastTokens, setLastTokens] = useState<string | null>(null);
  const [lastDetections, setLastDetections] = useState<RoboflowDetection[]>([]);
  const [decodeNote, setDecodeNote] = useState<string | null>(null);
  /** Distinct cards when last read saw more than one; user must pick one to merge. */
  const [pendingPickKeys, setPendingPickKeys] = useState<string[] | null>(null);

  useEffect(() => {
    try {
      const c = localStorage.getItem(LS_CONF);
      if (c) {
        const n = Number(c);
        if (!Number.isNaN(n) && n >= 0 && n <= 1) setConfidence(n);
      }
      const live = localStorage.getItem(LS_LIVE_MS);
      if (live) {
        const n = Number(live);
        if (!Number.isNaN(n) && LIVE_INTERVAL_OPTIONS.some((o) => o.ms === n)) {
          setLiveIntervalMs(n);
        }
      }
      const vt = localStorage.getItem(LS_VISION_TARGET);
      if (vt === "end" || vt === "start") setVisionTarget(vt);
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_CONF, String(confidence));
    } catch {
      /* ignore */
    }
  }, [confidence]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_LIVE_MS, String(liveIntervalMs));
    } catch {
      /* ignore */
    }
  }, [liveIntervalMs]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_VISION_TARGET, visionTarget);
    } catch {
      /* ignore */
    }
  }, [visionTarget]);

  useEffect(() => {
    lastLiveMergedKeyRef.current = null;
    liveStableKeyRef.current = null;
    liveStableCountRef.current = 0;
  }, [visionTarget]);

  useEffect(() => { visionTargetRef.current = visionTarget; }, [visionTarget]);

  const runInference = useCallback(
    async (imageBase64: string, opts?: { silent?: boolean }) => {
      let res: Response;
      try {
        res = await fetch("/api/card-vision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64,
            confidence,
            imgsz: Math.round(VISION_IMGSZ / 32) * 32,
            augment: VISION_AUGMENT,
          }),
          signal: AbortSignal.timeout(35_000), // 5 s longer than the server's 30 s so the server's TimeoutError fires first with a clear message
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Network error";
        onStatus(`Cannot reach /api/card-vision: ${msg}. Is the dev server running?`);
        setLastTokens(null);
        setLastDetections([]);
        setPendingPickKeys(null);
        return;
      }
      let data: Record<string, unknown>;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        onStatus(`Server returned a non-JSON response (${res.status}).`);
        setLastTokens(null);
        setLastDetections([]);
        setPendingPickKeys(null);
        return;
      }
      if (!res.ok) {
        const hint = typeof data.hint === "string" ? ` ${data.hint}` : "";
        const err =
          typeof data.error === "string"
            ? `${data.error}${hint}`
            : `Request failed (${res.status}).${hint}`;
        onStatus(err);
        setLastTokens(null);
        setLastDetections([]);
        setPendingPickKeys(null);
        return;
      }

      const silent = opts?.silent === true;
      const rawPreds = extractDetectionPredictions(data);
      const preds = dedupeDetectionsPerCardKey(rawPreds);
      const merged = rawPreds.length - preds.length;
      setLastDetections(preds);
      const decoded = detectionsToOrderedKeys(preds);
      if (!decoded.ok) {
        onStatus(decoded.errors.join(" "));
        setDecodeNote(
          decoded.partial.map((p) => `${p.className}`).join(", ") || null,
        );
        setLastTokens(decoded.keys.length > 0 ? decoded.keys.map((k) => k.toUpperCase()).join(" ") : null);
        setPendingPickKeys(null);
        return;
      }
      const keysUpper = decoded.keys.map((k) => k.toUpperCase());
      const line = keysUpper.join(" ");
      setLastTokens(line.length > 0 ? line : null);

      const distinct = uniqueKeysInOrder(keysUpper);
      if (distinct.length > 1) {
        liveStableKeyRef.current = null;
        liveStableCountRef.current = 0;
        setPendingPickKeys(distinct);
        const dedupeNote =
          merged > 0
            ? `Merged ${merged} duplicate box(es) (same card, lower confidence dropped).`
            : null;
        setDecodeNote(
          [dedupeNote, decoded.warnings.length > 0 ? decoded.warnings.join(" ") : null]
            .filter(Boolean)
            .join(" ") || null,
        );
        if (!silent) {
          onStatus(
            [
              `Multiple cards detected (${distinct.join(", ")}) — pick one below for ${visionTargetRef.current} order.`,
              dedupeNote,
              decoded.warnings.length > 0 ? decoded.warnings.join(" ") : null,
            ]
              .filter(Boolean)
              .join(" "),
          );
        }
        return;
      }

      setPendingPickKeys(null);
      if (distinct.length === 1) {
        const k = distinct[0]!;
        if (silent) {
          if (lastLiveMergedKeyRef.current === k) {
            /* same key still in view — do not fire merge again */
          } else if (liveStableKeyRef.current !== k) {
            liveStableKeyRef.current = k;
            liveStableCountRef.current = 1;
          } else {
            liveStableCountRef.current += 1;
          }
          if (
            lastLiveMergedKeyRef.current !== k &&
            liveStableKeyRef.current === k &&
            liveStableCountRef.current >= LIVE_STABLE_FRAMES
          ) {
            onMergeVisionKeys(visionTargetRef.current, distinct);
            lastLiveMergedKeyRef.current = k;
            liveStableKeyRef.current = null;
            liveStableCountRef.current = 0;
          }
        } else {
          onMergeVisionKeys(visionTargetRef.current, distinct);
        }
      }
      /* distinct.length === 0: do not reset live stability — empty frames between reads are normal */

      const dedupeNote =
        merged > 0
          ? `Merged ${merged} duplicate box(es) (same card, lower confidence dropped).`
          : null;
      setDecodeNote(
        [dedupeNote, decoded.warnings.length > 0 ? decoded.warnings.join(" ") : null]
          .filter(Boolean)
          .join(" ") || null,
      );
      if (!silent) {
        onStatus(
          decoded.warnings.length > 0
            ? [dedupeNote, decoded.warnings.join(" ")].filter(Boolean).join(" ")
            : distinct.length === 1
              ? (dedupeNote ??
                  `Updated ${visionTargetRef.current} order with ${distinct[0]}. Edit text areas below if needed.`)
              : (dedupeNote ??
                  "No cards detected in this frame. Lower min confidence or adjust the shot."),
        );
      }
    },
    [confidence, onMergeVisionKeys, onStatus],
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setPendingPickKeys(null);
    capturingRef.current = false;
    liveStartingRef.current = false;
    lastLiveMergedKeyRef.current = null;
    liveStableKeyRef.current = null;
    liveStableCountRef.current = 0;
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, []);

  const beginLiveCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      onStatus("Camera API not available in this browser.");
      return;
    }
    if (streamRef.current || liveStartingRef.current) return;
    liveStartingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => undefined);
      }
      setCameraActive(true);
      onStatus(null);
    } catch (e) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      let msg = "Could not open camera.";
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        msg = "Permission denied.";
      } else if (e instanceof DOMException && e.name === "NotFoundError") {
        msg = "No camera found.";
      } else if (e instanceof Error) {
        msg = e.message;
      }
      onStatus(`Camera: ${msg} (needs https or localhost).`);
    } finally {
      liveStartingRef.current = false;
    }
  }, [onStatus]);

  useEffect(() => {
    if (!cameraActive) return;
    const tick = async () => {
      if (capturingRef.current) return;
      const v = videoRef.current;
      if (!v) return;
      const b64 = videoFrameToJpegBase64(
        v,
        1920,
        0.85,
        canvasRef.current ?? (canvasRef.current = document.createElement("canvas")),
      );
      if (!b64) return;
      capturingRef.current = true;
      setBusy(true);
      try {
        await runInference(b64, { silent: true });
      } finally {
        capturingRef.current = false;
        setBusy(false);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), liveIntervalMs);
    return () => clearInterval(id);
  }, [cameraActive, liveIntervalMs, runInference]);

  return (
    <section className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Fan photo (local YOLO)
      </h2>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Merge reads into</span>
        <div className="inline-flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-600">
          <button
            type="button"
            onClick={() => setVisionTarget("start")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              visionTarget === "start"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            Start order
          </button>
          <button
            type="button"
            onClick={() => setVisionTarget("end")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              visionTarget === "end"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            End order
          </button>
        </div>
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="cv-confidence" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Min confidence (0–1)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="cv-confidence"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={confidence}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isNaN(n)) setConfidence(Math.max(0, Math.min(1, n)));
              }}
              className="max-w-32 rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
            <button
              type="button"
              onClick={() => setConfidence(0.22)}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              Use 0.22
            </button>
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Live interval</span>
          <select
            value={liveIntervalMs}
            onChange={(e) => setLiveIntervalMs(Number(e.target.value))}
            className="max-w-40 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            {LIVE_INTERVAL_OPTIONS.map((o) => (
              <option key={o.ms} value={o.ms}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void beginLiveCamera()}
          disabled={busy || cameraActive}
          className="rounded-lg border border-emerald-600/50 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-950 shadow-sm hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-900/50"
        >
          Start live camera
        </button>
        <button
          type="button"
          onClick={stopCamera}
          disabled={!cameraActive}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Stop live camera
        </button>
      </div>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-hidden={!cameraActive}
        aria-label={cameraActive ? "Live camera feed for card detection" : undefined}
        className={
          cameraActive
            ? "mb-3 max-h-72 min-h-55 w-full rounded-lg border border-zinc-200 bg-black object-contain dark:border-zinc-800"
            : "pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        }
      />

      {lastTokens && (
        <p className="mb-2 break-all font-mono text-xs text-zinc-800 dark:text-zinc-200">{lastTokens}</p>
      )}
      {cameraActive && (
        <p className="mb-2 text-[10px] text-zinc-500 dark:text-zinc-400">
          Live: about every {liveIntervalMs / 1000}s when not busy. A lone card merges on the first
          stable read of that key until you show a different card (empty frames are ignored). Merges
          into <span className="font-mono">{visionTarget}</span> order; multiple detections in one
          frame require a pick below.
        </p>
      )}
      {decodeNote && (
        <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">{decodeNote}</p>
      )}

      {pendingPickKeys && pendingPickKeys.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300/90 bg-amber-50 p-3 dark:border-amber-600 dark:bg-amber-950/50">
          <p className="mb-2 text-xs font-medium text-amber-950 dark:text-amber-100">
            Multiple cards in frame — pick one to add to{" "}
            <span className="font-mono">{visionTarget}</span> order:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {pendingPickKeys.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  onMergeVisionKeys(visionTarget, [k]);
                  lastLiveMergedKeyRef.current = k;
                  liveStableKeyRef.current = null;
                  liveStableCountRef.current = 0;
                  setPendingPickKeys(null);
                  setLastTokens(k);
                  onStatus(`Added ${k} to ${visionTarget} order.`);
                }}
                className="rounded-md border border-amber-600/60 bg-white px-3 py-1.5 font-mono text-sm font-medium text-amber-950 shadow-sm hover:bg-amber-100 dark:border-amber-500/50 dark:bg-zinc-900 dark:text-amber-50 dark:hover:bg-zinc-800"
              >
                {k}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setPendingPickKeys(null);
                onStatus(null);
              }}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {lastDetections.length > 0 && (
        <div className="max-h-40 overflow-auto rounded border border-zinc-200 bg-white text-xs dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                <th scope="col" className="px-2 py-1">#</th>
                <th scope="col" className="px-2 py-1">Class</th>
                <th scope="col" className="px-2 py-1" aria-label="App key">→</th>
                <th scope="col" className="px-2 py-1">x</th>
                <th scope="col" className="px-2 py-1">conf</th>
              </tr>
            </thead>
            <tbody>
              {lastDetections.map((d, i) => (
                <tr
                  key={`${d.class}-${i}-${d.x}`}
                  className="border-b border-zinc-100 dark:border-zinc-800"
                >
                  <td className="px-2 py-0.5">{i + 1}</td>
                  <td className="px-2 py-0.5 font-mono">{d.class}</td>
                  <td className="px-2 py-0.5 font-mono text-zinc-500">
                    {visionClassToAppKey(d.class) ?? "—"}
                  </td>
                  <td className="px-2 py-0.5">{Math.round(d.x)}</td>
                  <td className="px-2 py-0.5">{d.confidence.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
