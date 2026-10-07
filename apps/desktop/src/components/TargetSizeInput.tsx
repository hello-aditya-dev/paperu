/**
 * TargetSizeInput — presets + custom size entry for the "make it fit"
 * features. Validates that the target is less than the source size and
 * rejects nonsense (0, negative, NaN, ridiculous values).
 */

import { useState } from "react";

export interface TargetSize {
  value: number;
  unit: "KB" | "MB";
}

export interface TargetSizeInputProps {
  sourceBytes: number;
  value: TargetSize | null;
  onChange: (t: TargetSize | null) => void;
}

const PRESETS: { label: string; value: number; unit: "KB" | "MB" }[] = [
  { label: "50 KB", value: 50, unit: "KB" },
  { label: "100 KB", value: 100, unit: "KB" },
  { label: "200 KB", value: 200, unit: "KB" },
  { label: "500 KB", value: 500, unit: "KB" },
  { label: "1 MB", value: 1, unit: "MB" },
  { label: "2 MB", value: 2, unit: "MB" },
];

function targetToBytes(t: TargetSize): number {
  const kb = t.unit === "KB" ? t.value : t.value * 1024;
  return Math.round(kb * 1024);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 100 ? kb.toFixed(0) : kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function TargetSizeInput({
  sourceBytes,
  value,
  onChange,
}: TargetSizeInputProps): React.ReactNode {
  const [customText, setCustomText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function selectPreset(p: { value: number; unit: "KB" | "MB" }): void {
    const t: TargetSize = { value: p.value, unit: p.unit };
    if (targetToBytes(t) >= sourceBytes) {
      setError(`This file is already ${formatBytes(sourceBytes)} — no compression needed.`);
      onChange(null);
      return;
    }
    setError(null);
    onChange(t);
  }

  function applyCustom(): void {
    const raw = customText.trim().toLowerCase();
    if (!raw) {
      setError("Enter a size like 500 KB or 1 MB.");
      onChange(null);
      return;
    }
    const m = raw.match(/^(\d+(?:\.\d+)?)\s*(kb|mb|k|m)?$/);
    if (!m) {
      setError("Use a format like 500 KB, 1 MB, or 200.");
      onChange(null);
      return;
    }
    const v = parseFloat(m[1]!);
    if (!Number.isFinite(v) || v <= 0) {
      setError("Target must be greater than zero.");
      onChange(null);
      return;
    }
    const unitTok = (m[2] ?? "").toLowerCase();
    let unit: "KB" | "MB";
    if (unitTok === "") {
      if (v >= 1024) unit = "MB";
      else unit = "KB";
    } else if (unitTok.startsWith("k")) unit = "KB";
      else unit = "MB";
    if (unit === "KB" && v > 1024 * 1024) {
      setError("Target is too large.");
      onChange(null);
      return;
    }
    if (unit === "MB" && v > 1024) {
      setError("Target is too large.");
      onChange(null);
      return;
    }
    const t: TargetSize = { value: unit === "MB" && unitTok === "" ? v / 1024 : v, unit };
    if (targetToBytes(t) >= sourceBytes) {
      setError(`This file is already ${formatBytes(sourceBytes)} — no compression needed.`);
      onChange(null);
      return;
    }
    setError(null);
    onChange(t);
  }

  return (
    <div className="paperu-target">
      <label className="paperu-target__label">Target maximum size</label>
      <div className="paperu-target__presets" role="group" aria-label="Target size presets">
        {PRESETS.map((p) => {
          const active = value?.value === p.value && value?.unit === p.unit;
          return (
            <button
              key={p.label}
              type="button"
              className={`paperu-target__preset${active ? " is-active" : ""}`}
              onClick={() => selectPreset(p)}
              aria-pressed={active}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <label
        className="paperu-target__label"
        htmlFor="target-custom"
        style={{ marginTop: "var(--paperu-space-3)" }}
      >
        Or enter a custom size
      </label>
      <div className="paperu-target__custom">
        <input
          id="target-custom"
          className="paperu-target__input"
          inputMode="decimal"
          placeholder="e.g. 500 KB or 1.5 MB"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyCustom();
            }
          }}
          aria-invalid={!!error}
          aria-describedby={error ? "target-error" : undefined}
        />
        <button type="button" className="paperu-target__preset" onClick={applyCustom}>
          Set
        </button>
      </div>
      {error && (
        <p id="target-error" className="paperu-target__error">
          {error}
        </p>
      )}
      {value && !error && (
        <p className="paperu-target__hint">
          Paperu will iterate to produce a valid file at or under{" "}
          <strong>{formatBytes(targetToBytes(value))}</strong>.
        </p>
      )}
    </div>
  );
}
