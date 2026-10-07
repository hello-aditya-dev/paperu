/**
 * InspectView — the first real vertical proof of the Paperu stack.
 *
 * React → typed contract → Tauri command → Rust filesystem layer →
 * structured result → UI. Every value shown is derived from the
 * actual file on disk. The original file is never modified.
 */

import { useCallback, useState } from "react";
import type { AppError, InspectFileResponse } from "@paperu/contracts";
import { inspectFile } from "@/lib/ipc";
import { kindLabel } from "@/lib/format";
import { Card } from "@paperu/ui";
import { FileDropZone } from "./FileDropZone";
import { InspectResultCard } from "./InspectResultCard";
import { ErrorCard } from "./ErrorCard";

type State =
  | { kind: "idle" }
  | { kind: "loading"; path: string }
  | { kind: "success"; result: InspectFileResponse }
  | { kind: "error"; error: AppError };

export function InspectView(): React.ReactNode {
  const [state, setState] = useState<State>({ kind: "idle" });

  const handleFile = useCallback(async (path: string) => {
    setState({ kind: "loading", path });
    try {
      const result = await inspectFile(path);
      setState({ kind: "success", result });
    } catch (err) {
      setState({ kind: "error", error: err as AppError });
    }
  }, []);

  return (
    <section className="paperu-inspect" aria-labelledby="inspect-heading">
      <header className="paperu-inspect__header">
        <h1 id="inspect-heading">Inspect a file</h1>
        <p className="paperu-inspect__lead">
          Pick any file on this PC. Paperu reads its real metadata locally —
          nothing is uploaded.
        </p>
      </header>

      <FileDropZone onFileSelected={handleFile} busy={state.kind === "loading"} />

      {state.kind === "loading" && (
        <Card className="paperu-inspect__status" aria-live="polite">
          <p>Reading {state.path}…</p>
        </Card>
      )}

      {state.kind === "success" && <InspectResultCard result={state.result} />}

      {state.kind === "error" && <ErrorCard error={state.error} />}

      {state.kind === "idle" && (
        <Card className="paperu-inspect__placeholder">
          <p>
            Results appear here. Paperu shows the file name, type, exact byte
            size, human-readable size, local path and modified time — all from
            your filesystem.
          </p>
        </Card>
      )}

      <p className="paperu-inspect__privacy">
        <span aria-hidden="true">🔒</span>{" "}
        {kindLabel("other") && "Local-first: "}Processed on this PC. 0 bytes
        uploaded.
      </p>
    </section>
  );
}
