/**
 * Watch Folders route — debounced filesystem watching via `notify`
 * (CC0) + `notify-debouncer-mini` (MIT/Apache). OSS harvest §22.
 *
 * The watcher runs in the Rust side (uses ReadDirectoryChangesW on
 * Windows, FSEvents on macOS, inotify on Linux). Events are debounced
 * 400ms, then emitted to the frontend as `paperu://watch-event`.
 *
 * Self-loop prevention: events whose paths contain Paperu's own output
 * suffixes (-paperu-, -portal-ready, -print-, -fit, -rescued, -archive)
 * are filtered so a rule doesn't re-trigger on Paperu's finalize_output.
 *
 * Paperu takes NO destructive automatic action (§22). The event feed
 * is shown live; the user decides what to do. A future "recipes"
 * feature can wire events to non-destructive actions (copy/move).
 */

import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { WatchEvent } from "@paperu/contracts";
import { WATCH_EVENT_CHANNEL } from "@paperu/contracts";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  currentWatchFolder,
  revealPath,
  startWatchFolder,
  stopWatchFolder,
} from "@/lib/ipc";
import { Button, Card } from "@paperu/ui";

interface FeedEntry {
  readonly path: string;
  readonly kind: string;
  readonly at: number;
}

const MAX_FEED = 200;

export function WatchFoldersRoute(): React.ReactNode {
  const [watching, setWatching] = useState<string | null>(null);
  const [feed, setFeed] = useState<readonly FeedEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // On mount, check if a watcher is already active.
  useEffect(() => {
    let cancelled = false;
    currentWatchFolder()
      .then((p) => { if (!cancelled && p) setWatching(p); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Listen for watch events (live feed).
  useEffect(() => {
    let cancelled = false;
    listen<WatchEvent>(WATCH_EVENT_CHANNEL, (event) => {
      if (cancelled) return;
      const payload = event.payload;
      if (!payload) return;
      const entry: FeedEntry = {
        path: payload.path,
        kind: payload.kind,
        at: Date.now(),
      };
      setFeed((cur) => [entry, ...cur].slice(0, MAX_FEED));
    })
      .then((un) => {
        if (cancelled) un();
        else unlistenRef.current = un;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, []);

  async function pickAndStart(): Promise<void> {
    setError(null);
    try {
      const selected = await open({
        multiple: false,
        directory: true,
        title: "Choose a folder to watch — Paperu",
      });
      if (typeof selected !== "string" || selected.length === 0) return;
      setBusy(true);
      await startWatchFolder(selected);
      setWatching(selected);
      setFeed([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop(): Promise<void> {
    setBusy(true);
    try {
      await stopWatchFolder();
      setWatching(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="paperu-section" aria-labelledby="wf-heading">
      <header className="paperu-section__header">
        <h1 id="wf-heading" className="paperu-text-display">Watch Folders</h1>
        <p className="paperu-text-lead">
          Live, debounced filesystem events from a folder. Paperu takes no destructive action — you see the changes and decide. Self-loop prevention filters Paperu's own outputs.
        </p>
      </header>

      <Card>
        <div style={{ padding: "var(--paperu-space-5)" }}>
          {watching ? (
            <div>
              <div className="paperu-text-code paperu-break-all" title={watching}>👁 watching: {watching}</div>
              <div style={{ display: "flex", gap: "var(--paperu-space-2)", marginTop: "var(--paperu-space-3)" }}>
                <Button variant="outline" onClick={() => void revealPath(watching)}>Open folder</Button>
                <Button variant="ghost" onClick={stop} disabled={busy}>Stop watching</Button>
              </div>
            </div>
          ) : (
            <Button variant="accent" onClick={pickAndStart} disabled={busy}>
              {busy ? "Starting…" : "Choose a folder to watch"}
            </Button>
          )}
        </div>
      </Card>

      {feed.length > 0 && (
        <Card>
          <div style={{ padding: "var(--paperu-space-5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--paperu-space-3)" }}>
              <span className="paperu-text-label">Live events ({feed.length})</span>
              <button type="button" className="paperu-btn paperu-btn--ghost" onClick={() => setFeed([])}>Clear</button>
            </div>
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "var(--paperu-space-1)", maxHeight: "400px", overflowY: "auto" }}>
              {feed.map((e, i) => (
                <li key={`${e.at}-${i}`} style={{ display: "flex", gap: "var(--paperu-space-2)", alignItems: "baseline", padding: "var(--paperu-space-1) 0", borderBottom: "1px solid var(--paperu-border-subtle)" }}>
                  <span className="paperu-text-code" style={{ minWidth: "64px", fontSize: "var(--paperu-text-xs)" }}>{kindLabel(e.kind)}</span>
                  <span className="paperu-text-code paperu-break-all paperu-truncate" style={{ flex: 1, fontSize: "var(--paperu-text-xs)" }} title={e.path}>{e.path}</span>
                  <span className="paperu-text-caption paperu-text-numeric" style={{ minWidth: "60px", textAlign: "right" }}>{timeAgo(e.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {error && (
        <Card className="paperu-error" role="status">
          <div className="paperu-error__head">
            <span className="paperu-error__badge" aria-hidden="true">!</span>
            <h2 className="paperu-error__title">{error}</h2>
          </div>
        </Card>
      )}
    </section>
  );
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "create": return "+ create";
    case "modify": return "✎ modify";
    case "remove": return "− remove";
    case "access": return "○ access";
    default: return "? other";
  }
}

function timeAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m`;
}
