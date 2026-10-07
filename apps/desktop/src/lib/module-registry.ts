/**
 * Paperu Module Registry — the centralized capability registry.
 *
 * Every major Paperu tool declares itself here. This registry powers:
 *   - Command Center (search and run)
 *   - Smart Action Palette (contextual actions for a selected file)
 *   - Universal Drop (contextual actions for a dropped file)
 *   - Navigation configuration
 *   - Help / deep links
 *
 * The registry is the single source of truth for "what can Paperu do".
 * There is no second list of features elsewhere.
 *
 * Doctrine §47: "Create a centralized Paperu capability registry.
 * Do not maintain five independent lists of features."
 */

import type { FileKind } from "@paperu/contracts";

/** The kind of input a module accepts. */
export type InputKind = FileKind | "any";

/** A registered Paperu capability/tool. */
export interface ModuleEntry {
  /** Stable unique id, e.g. "pdf-fit". */
  readonly id: string;
  /** Human label, e.g. "Make PDF fit". */
  readonly label: string;
  /** Short description, e.g. "Shrink a PDF under a target size." */
  readonly description: string;
  /** Technical/advanced name, e.g. "Target-size PDF compression". */
  readonly advancedName?: string;
  /** Route path for navigation, e.g. "/pdf/fit". */
  readonly route: string;
  /** Workspace this module belongs to. */
  readonly workspace: "files" | "pdf" | "images" | "capture" | "video" | "business" | "automate";
  /** Input file kinds this module accepts. Empty = no file input. */
  readonly inputKinds: readonly InputKind[];
  /** Output file kinds this module produces. Empty = no file output. */
  readonly outputKinds: readonly FileKind[];
  /** Search aliases for the Command Center. */
  readonly aliases: readonly string[];
  /** Keyboard shortcut digit (1-9) for nav rail, or undefined. */
  readonly shortcut?: string;
  /** Whether this module is currently available (implemented + enabled). */
  readonly available: boolean;
  /** Whether this module requires an entitlement (paid tier). */
  readonly entitlement?: "free" | "personal" | "business";
}

/**
 * The canonical Paperu module registry.
 *
 * Only modules that are implemented and available are marked
 * `available: true`. Future modules are listed with `available: false`
 * so the Command Center can show them as "coming soon" without dead
 * links.
 */
export const MODULES: readonly ModuleEntry[] = [
  {
    id: "home",
    label: "Home",
    description: "Drop files and let Paperu suggest actions.",
    route: "/",
    workspace: "files",
    inputKinds: ["any"],
    outputKinds: [],
    aliases: ["start", "universal drop", "drop"],
    shortcut: "1",
    available: true,
  },
  {
    id: "pdf-fit",
    label: "Make PDF fit",
    description: "Shrink a PDF under a target size.",
    advancedName: "Target-size PDF compression",
    route: "/pdf/fit",
    workspace: "pdf",
    inputKinds: ["pdf"],
    outputKinds: ["pdf"],
    aliases: ["compress pdf", "reduce pdf size", "make smaller", "under 500 kb", "portal upload"],
    shortcut: "2",
    available: true,
  },
  {
    id: "image-fit",
    label: "Make image fit",
    description: "Shrink an image under a target size.",
    advancedName: "Target-size image compression",
    route: "/image/fit",
    workspace: "images",
    inputKinds: ["image"],
    outputKinds: ["image"],
    aliases: ["compress image", "reduce image size", "resize image"],
    shortcut: "3",
    available: true,
  },
  {
    id: "pdf-merge",
    label: "Merge PDFs",
    description: "Combine multiple PDFs into one.",
    route: "/pdf/merge",
    workspace: "pdf",
    inputKinds: ["pdf"],
    outputKinds: ["pdf"],
    aliases: ["combine pdf", "join pdf"],
    shortcut: "4",
    available: true,
  },
  {
    id: "pdf-split",
    label: "Split / Extract",
    description: "Extract pages or split into individual files.",
    route: "/pdf/split",
    workspace: "pdf",
    inputKinds: ["pdf"],
    outputKinds: ["pdf"],
    aliases: ["extract pages", "separate pages", "split pdf"],
    shortcut: "5",
    available: true,
  },
  {
    id: "images-to-pdf",
    label: "Images → PDF",
    description: "Combine images into a single PDF.",
    route: "/pdf/from-images",
    workspace: "pdf",
    inputKinds: ["image"],
    outputKinds: ["pdf"],
    aliases: ["images to pdf", "jpg to pdf", "png to pdf", "photos to pdf"],
    shortcut: "6",
    available: true,
  },
  {
    id: "pdf-to-images",
    label: "PDF → Images",
    description: "Render PDF pages to PNG or JPEG.",
    route: "/pdf/to-images",
    workspace: "pdf",
    inputKinds: ["pdf"],
    outputKinds: ["image"],
    aliases: ["pdf to png", "pdf to jpg", "extract images", "convert pdf"],
    shortcut: "7",
    available: true,
  },
  {
    id: "sign-pdf",
    label: "Sign PDF",
    description: "Place a visible electronic signature.",
    advancedName: "Electronic signature placement (not PKI)",
    route: "/pdf/sign",
    workspace: "pdf",
    inputKinds: ["pdf"],
    outputKinds: ["pdf"],
    aliases: ["signature", "sign document", "draw signature"],
    shortcut: "8",
    available: true,
  },
  {
    id: "fill-pdf",
    label: "Fill PDF",
    description: "Add text, dates, and checkmarks to any PDF.",
    route: "/pdf/fill",
    workspace: "pdf",
    inputKinds: ["pdf"],
    outputKinds: ["pdf"],
    aliases: ["annotate", "fill form", "add text", "checkbox"],
    shortcut: "9",
    available: true,
  },
  // --- Future modules (available: false) ---
  {
    id: "inspect",
    label: "Inspect file",
    description: "View real file metadata.",
    route: "/inspect",
    workspace: "files",
    inputKinds: ["any"],
    outputKinds: [],
    aliases: ["metadata", "file info", "properties"],
    available: true,
  },
];

/**
 * Get all available modules (for navigation, command search).
 */
export function getAvailableModules(): readonly ModuleEntry[] {
  return MODULES.filter((m) => m.available);
}

/**
 * Get modules that accept a given file kind (for Universal Drop and
 * Action Palette contextual suggestions).
 */
export function getModulesForKind(kind: InputKind): readonly ModuleEntry[] {
  return MODULES.filter(
    (m) => m.available && (m.inputKinds.includes(kind) || m.inputKinds.includes("any")),
  );
}

/**
 * Get modules that produce a given file kind (for next-action suggestions
 * on result cards — though typically we suggest modules that *accept*
 * the output kind, not produce it).
 */
export function getModulesProducingKind(kind: FileKind): readonly ModuleEntry[] {
  return MODULES.filter((m) => m.available && m.outputKinds.includes(kind));
}

/**
 * Fuzzy search modules for the Command Center.
 * Matches against label, description, aliases, and advancedName.
 * Deterministic — no AI, no ML. Pure string matching.
 */
export function searchModules(query: string): readonly ModuleEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return getAvailableModules();
  const results: { module: ModuleEntry; score: number }[] = [];
  for (const m of MODULES) {
    if (!m.available) continue;
    let score = 0;
    // Exact label match — highest score.
    if (m.label.toLowerCase() === q) score += 100;
    // Label starts with query.
    else if (m.label.toLowerCase().startsWith(q)) score += 50;
    // Label contains query.
    else if (m.label.toLowerCase().includes(q)) score += 30;
    // Alias exact match.
    if (m.aliases.some((a) => a.toLowerCase() === q)) score += 80;
    // Alias starts with query.
    if (m.aliases.some((a) => a.toLowerCase().startsWith(q))) score += 40;
    // Alias contains query.
    if (m.aliases.some((a) => a.toLowerCase().includes(q))) score += 20;
    // Description contains query.
    if (m.description.toLowerCase().includes(q)) score += 10;
    // Advanced name contains query.
    if (m.advancedName?.toLowerCase().includes(q)) score += 10;
    if (score > 0) results.push({ module: m, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results.map((r) => r.module);
}

/**
 * Get a module by id.
 */
export function getModule(id: string): ModuleEntry | undefined {
  return MODULES.find((m) => m.id === id);
}
