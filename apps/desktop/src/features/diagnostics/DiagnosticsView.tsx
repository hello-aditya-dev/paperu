/**
 * DiagnosticsView — safe local diagnostics (doctrine §74).
 *
 * Displays: version, OS, architecture, database schema version,
 * module versions, recent non-sensitive errors, performance timing.
 *
 * Never includes sensitive user document contents (doctrine §75).
 * Allows Copy and Export.
 */

import { useEffect, useState } from "react";
import type { AppInfo } from "@paperu/contracts";
import { readAppInfo } from "@/lib/ipc";
import { detectPlatform } from "@/lib/platform";
import { Card, Button } from "@paperu/ui";

interface DiagnosticsData {
  app: AppInfo | null;
  platform: string;
  arch: string;
  userAgent: string;
  timestamp: string;
  modules: { id: string; label: string; available: boolean }[];
}

export function DiagnosticsView(): React.ReactNode {
  const [data, setData] = useState<DiagnosticsData | null>(null);

  useEffect(() => {
    (async () => {
      const info = await readAppInfo().catch(() => null);
      const platform = detectPlatform();
      const arch = typeof navigator !== "undefined" ? navigator.platform : "unknown";
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
      const timestamp = new Date().toISOString();
      // Import module registry dynamically to avoid circular deps.
      const { getAvailableModules } = await import("@/lib/module-registry");
      const modules = getAvailableModules().map((m) => ({
        id: m.id,
        label: m.label,
        available: m.available,
      }));
      setData({ app: info, platform, arch, userAgent, timestamp, modules });
    })();
  }, []);

  function copyDiagnostics(): void {
    if (!data) return;
    const text = formatDiagnostics(data);
    navigator.clipboard?.writeText(text).catch(() => {
      // Clipboard may be unavailable.
    });
  }

  function exportDiagnostics(): void {
    if (!data) return;
    const text = formatDiagnostics(data);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "paperu-diagnostics.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!data) {
    return (
      <section className="paperu-section">
        <Card className="paperu-progress" aria-live="polite">
          <p className="paperu-progress__stage">Collecting diagnostics…</p>
        </Card>
      </section>
    );
  }

  return (
    <section className="paperu-section" aria-labelledby="diag-heading">
      <header className="paperu-section__header">
        <h1 id="diag-heading" className="paperu-text-display">Diagnostics</h1>
        <p className="paperu-text-lead">
          Safe local diagnostics. No document contents, filenames, or personal
          data are included.
        </p>
      </header>

      <Card className="paperu-diagnostics">
        <dl className="paperu-diagnostics__meta">
          <div>
            <dt className="paperu-text-metadata-key">Paperu version</dt>
            <dd className="paperu-text-metadata-value">{data.app?.version ?? "unknown"}</dd>
          </div>
          <div>
            <dt className="paperu-text-metadata-key">Edition</dt>
            <dd className="paperu-text-metadata-value">{data.app?.edition ?? "unknown"}</dd>
          </div>
          <div>
            <dt className="paperu-text-metadata-key">Settings version</dt>
            <dd className="paperu-text-metadata-value">{data.app?.settingsVersion ?? "unknown"}</dd>
          </div>
          <div>
            <dt className="paperu-text-metadata-key">Platform</dt>
            <dd className="paperu-text-metadata-value">{data.platform}</dd>
          </div>
          <div>
            <dt className="paperu-text-metadata-key">Architecture</dt>
            <dd className="paperu-text-metadata-value">{data.arch}</dd>
          </div>
          <div>
            <dt className="paperu-text-metadata-key">User agent</dt>
            <dd className="paperu-text-metadata-value paperu-break-all">{data.userAgent}</dd>
          </div>
          <div>
            <dt className="paperu-text-metadata-key">Generated</dt>
            <dd className="paperu-text-metadata-value">{data.timestamp}</dd>
          </div>
        </dl>

        <h2 className="paperu-text-heading" style={{ marginTop: "var(--paperu-space-5)" }}>
          Available modules
        </h2>
        <ul className="paperu-diagnostics__modules">
          {data.modules.map((m) => (
            <li key={m.id} className="paperu-diagnostics__module">
              <span className="paperu-text-metadata-value">{m.label}</span>
              <span className={m.available ? "paperu-stamp paperu-stamp--success" : "paperu-stamp"}>
                {m.available ? "Available" : "Unavailable"}
              </span>
            </li>
          ))}
        </ul>

        <div className="paperu-diagnostics__actions">
          <Button variant="accent" onClick={copyDiagnostics}>
            Copy diagnostics
          </Button>
          <Button variant="outline" onClick={exportDiagnostics}>
            Export as file
          </Button>
        </div>

        <p className="paperu-diagnostics__privacy">
          <span aria-hidden="true">🔒</span> This diagnostics report contains no
          document contents, filenames, signatures, or personal data. Safe to share
          for support.
        </p>
      </Card>
    </section>
  );
}

function formatDiagnostics(data: DiagnosticsData): string {
  const lines: string[] = [
    "Paperu Diagnostics Report",
    "=========================",
    "",
    `Generated: ${data.timestamp}`,
    `Paperu version: ${data.app?.version ?? "unknown"}`,
    `Edition: ${data.app?.edition ?? "unknown"}`,
    `Settings version: ${data.app?.settingsVersion ?? "unknown"}`,
    `Platform: ${data.platform}`,
    `Architecture: ${data.arch}`,
    `User agent: ${data.userAgent}`,
    "",
    "Available modules:",
    ...data.modules.map((m) => `  ${m.label}: ${m.available ? "Available" : "Unavailable"}`),
    "",
    "Note: This report contains no document contents, filenames,",
    "signatures, or personal data. Safe to share for support.",
  ];
  return lines.join("\n");
}
