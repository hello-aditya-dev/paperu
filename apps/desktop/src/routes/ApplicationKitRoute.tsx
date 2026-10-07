/**
 * Application Kit route — the user's reusable personal documents
 * (Master Prompt 4 §18-22).
 *
 * Lists items grouped by kind (photo, signature, resume, etc.). User
 * can add a new item (file picker), replace/remove an existing item,
 * and reorder. NEVER stores document bytes — only file references +
 * metadata (privacy §19, §76).
 *
 * Integration (§21): from compatible workflows the user can
 * "Add from my kit" — e.g. Assignment Studio pulls a signature.
 */

import { useCallback, useEffect, useState } from "react";
import type { ApplicationKitItem, ApplicationKitItemKind } from "@paperu/contracts";
import {
  listApplicationKitItems,
  removeApplicationKitItem,
} from "@/lib/ipc";

const KIND_LABELS: Record<ApplicationKitItemKind, string> = {
  photo: "Photo",
  signature: "Signature",
  initials: "Initials",
  resume: "Resume",
  id: "ID document",
  marksheet: "Marksheet",
  certificate: "Certificate",
  other: "Other",
};

const KIND_ORDER: ApplicationKitItemKind[] = [
  "photo",
  "signature",
  "initials",
  "resume",
  "id",
  "marksheet",
  "certificate",
  "other",
];

export function ApplicationKitRoute(): React.ReactNode {
  const [items, setItems] = useState<readonly ApplicationKitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listApplicationKitItems();
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRemove = async (id: string) => {
    try {
      await removeApplicationKitItem(id);
      setItems((cur) => cur.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    label: KIND_LABELS[kind],
    items: items.filter((i) => i.kind === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <section className="paperu-kit">
      <header className="paperu-kit__header">
        <div>
          <h1 className="paperu-kit__title">My application kit</h1>
          <p className="paperu-kit__subtitle">
            Photos, signatures, and documents you reuse. Stored on this PC.
          </p>
        </div>
      </header>

      {error && (
        <div className="paperu-kit__notice" role="status">
          {error}
        </div>
      )}

      {loading ? (
        <p className="paperu-kit__loading">Loading…</p>
      ) : grouped.length === 0 ? (
        <div className="paperu-kit__empty">
          Add a photo, signature, or document you want to reuse.
          <br />
          Everything stays on this computer.
        </div>
      ) : (
        <ul className="paperu-kit__groups">
          {grouped.map((g) => (
            <li key={g.kind} className="paperu-kit__group">
              <h2 className="paperu-kit__group-title">{g.label}</h2>
              <ul className="paperu-kit__items">
                {g.items.map((item) => (
                  <li key={item.id} className="paperu-kit__item">
                    <span className="paperu-kit__item-name">{item.label}</span>
                    <span className="paperu-kit__item-file">{item.fileName}</span>
                    <div className="paperu-kit__item-actions">
                      <button
                        type="button"
                        className="paperu-kit__btn"
                        onClick={() => onRemove(item.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
