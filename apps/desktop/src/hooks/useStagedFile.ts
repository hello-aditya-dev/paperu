/**
 * useStagedFile — a hook that views call on mount to auto-load a staged
 * working file (if one exists and the kind matches).
 *
 * This enables composable workflows: when the user clicks "Sign this"
 * on a result card, the output is staged and the user navigates to
 * Sign. The Sign view calls useStagedFile("pdf") on mount, which
 * inspects the staged path and auto-loads it — no re-selection.
 *
 * Returns the inspected file response, or null if no staged file
 * exists or the kind doesn't match.
 */

import { useEffect, useState } from "react";
import type { InspectFileResponse, AppError } from "@paperu/contracts";
import { inspectFile } from "@/lib/ipc";
import { useWorkingFile } from "@/lib/working-file";

export function useStagedFile(expectedKind: string): {
  staged: InspectFileResponse | null;
  loading: boolean;
  error: AppError | null;
} {
  const workingFile = useWorkingFile((s) => s.workingFile);
  const [staged, setStaged] = useState<InspectFileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    if (!workingFile || workingFile.kind !== expectedKind) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    inspectFile(workingFile.path)
      .then((result) => {
        if (cancelled) return;
        if (result.kind !== expectedKind) {
          // Kind mismatch — the staged file isn't what we expected.
          // Don't auto-load; let the user pick manually.
          return;
        }
        setStaged(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err as AppError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // We intentionally only run this once on mount (or when the staged
    // file's path changes). We do NOT re-run when `clear` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingFile?.path, expectedKind]);

  return { staged, loading, error };
}
