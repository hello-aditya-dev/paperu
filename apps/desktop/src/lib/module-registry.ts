/**
 * Paperu Module Registry — the centralized capability registry.
 *
 * Every major Paperu tool declares itself here. This registry powers:
 *   - Command Center (search and run)
 *   - Smart Action Palette (contextual actions for a selected file)
 *   - Universal Drop (contextual actions for a dropped file)
 *   - Navigation configuration
 *   - Help / deep links
 *   - Next Actions on result cards
 *
 * The registry is the single source of truth for "what can Paperu do".
 * There is no second list of features elsewhere. App.tsx navigation,
 * Command Center, Action Palette, and Next Actions all derive from this.
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
  readonly workspace:
    | "files"
    | "pdf"
    | "images"
    | "capture"
    | "video"
    | "business"
    | "automate";
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
  // ── Mature Core UX fields (Master Prompt 3) ──────────────────────
  /** Single-glyph nav icon (e.g. "⌂", "▾"). Optional. */
  readonly glyph?: string;
  /** Sort order in the nav rail (lower = higher). Default 100. */
  readonly navOrder?: number;
  /** Show in the nav rail. Default: true if available. */
  readonly visibleInNav?: boolean;
  /** Searchable in the Command Center. Default: true if available. */
  readonly visibleInCommand?: boolean;
  /** User can pin this module. Default: true. */
  readonly pinnable?: boolean;
  /** Can be suggested as a Next Action on a result card. Default: true if it has inputKinds. */
  readonly usableAsNextAction?: boolean;
  /** Contextual priority 1-100 when suggesting for a file (higher = more relevant). Default 50. */
  readonly contextualPriority?: number;
}

/** Default values for the optional mature-UX fields. Centralized so
 *  getNavModules/getCommandModules/etc. use identical defaults. */
const DEFAULT_NAV_ORDER = 100;
const DEFAULT_CONTEXTUAL_PRIORITY = 50;

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
    aliases: ["start", "universal drop", "drop", "landing"],
    shortcut: "1",
    available: true,
    glyph: "⌂",
    navOrder: 1,
    pinnable: false,
    usableAsNextAction: false,
  },
  {
    id: "recent-work",
    label: "Recent work",
    description: "What you did and what came out.",
    route: "/history",
    workspace: "files",
    inputKinds: [],
    outputKinds: [],
    aliases: ["recent", "history", "past work", "what did i do"],
    shortcut: "2",
    available: true,
    glyph: "⌛",
    navOrder: 5,
    pinnable: false,
    usableAsNextAction: false,
  },
  {
    id: "pdf-workspace",
    label: "PDF",
    description: "Everything you can do with a PDF.",
    route: "/pdf",
    workspace: "pdf",
    inputKinds: ["pdf"],
    outputKinds: [],
    aliases: ["pdf tools", "pdf workspace", "all pdf"],
    shortcut: "3",
    available: true,
    glyph: "▤",
    navOrder: 10,
    pinnable: false,
    usableAsNextAction: false,
    contextualPriority: 95,
  },
  {
    id: "images-workspace",
    label: "Images",
    description: "Everything you can do with an image.",
    route: "/images",
    workspace: "images",
    inputKinds: ["image"],
    outputKinds: [],
    aliases: ["image tools", "image workspace", "all images"],
    shortcut: "4",
    available: true,
    glyph: "▦",
    navOrder: 20,
    pinnable: false,
    usableAsNextAction: false,
    contextualPriority: 95,
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
    aliases: [
      "compress pdf",
      "reduce pdf size",
      "make smaller",
      "under 500 kb",
      "portal upload",
      "shrink pdf",
    ],
    shortcut: "5",
    available: true,
    glyph: "▾",
    navOrder: 30,
    visibleInNav: false,
    contextualPriority: 90,
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
    aliases: [
      "compress image",
      "reduce image size",
      "resize image",
      "shrink image",
    ],
    shortcut: "6",
    available: true,
    glyph: "▾",
    navOrder: 40,
    visibleInNav: false,
    contextualPriority: 90,
  },
  {
    id: "pdf-merge",
    label: "Merge PDFs",
    description: "Combine multiple PDFs into one.",
    route: "/pdf/merge",
    workspace: "pdf",
    inputKinds: ["pdf"],
    outputKinds: ["pdf"],
    aliases: ["combine pdf", "join pdf", "merge files"],
    shortcut: "7",
    available: true,
    glyph: "⋑",
    navOrder: 50,
    visibleInNav: false,
    contextualPriority: 70,
  },
  {
    id: "pdf-split",
    label: "Split / Extract",
    description: "Extract pages or split into individual files.",
    route: "/pdf/split",
    workspace: "pdf",
    inputKinds: ["pdf"],
    outputKinds: ["pdf"],
    aliases: ["extract pages", "separate pages", "split pdf", "pull pages"],
    shortcut: "8",
    available: true,
    glyph: "⫻",
    navOrder: 60,
    visibleInNav: false,
    contextualPriority: 70,
  },
  {
    id: "pdf-page-ops",
    label: "Rotate / Delete / Extract pages",
    description: "Rotate, delete, or extract pages (Rust-native, lopdf).",
    route: "/pdf/pages",
    workspace: "pdf",
    inputKinds: ["pdf"],
    outputKinds: ["pdf"],
    aliases: ["rotate pdf", "delete pages", "extract pages", "turn pages", "remove pages"],
    available: true,
    glyph: "⟳",
    navOrder: 65,
    visibleInNav: false,
    contextualPriority: 65,
  },
  {
    id: "images-to-pdf",
    label: "Images → PDF",
    description: "Combine images into a single PDF.",
    route: "/pdf/from-images",
    workspace: "pdf",
    inputKinds: ["image"],
    outputKinds: ["pdf"],
    aliases: [
      "images to pdf",
      "jpg to pdf",
      "png to pdf",
      "photos to pdf",
      "convert images",
    ],
    shortcut: "9",
    available: true,
    glyph: "⋐",
    navOrder: 70,
    visibleInNav: false,
    contextualPriority: 80,
  },
  {
    id: "pdf-to-images",
    label: "PDF → Images",
    description: "Render PDF pages to PNG or JPEG.",
    route: "/pdf/to-images",
    workspace: "pdf",
    inputKinds: ["pdf"],
    outputKinds: ["image"],
    aliases: [
      "pdf to png",
      "pdf to jpg",
      "extract images",
      "convert pdf",
      "render pdf",
    ],
    available: true,
    glyph: "⫾",
    navOrder: 80,
    visibleInNav: false,
    contextualPriority: 60,
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
    aliases: ["signature", "sign document", "draw signature", "annotate sign"],
    available: true,
    glyph: "✎",
    navOrder: 90,
    visibleInNav: false,
    contextualPriority: 65,
  },
  {
    id: "fill-pdf",
    label: "Fill PDF",
    description: "Add text, dates, and checkmarks to any PDF.",
    route: "/pdf/fill",
    workspace: "pdf",
    inputKinds: ["pdf"],
    outputKinds: ["pdf"],
    aliases: [
      "annotate",
      "fill form",
      "add text",
      "checkbox",
      "write on pdf",
    ],
    available: true,
    glyph: "✦",
    navOrder: 100,
    visibleInNav: false,
    contextualPriority: 65,
  },
  {
    id: "inspect",
    label: "Inspect file",
    description: "View real file metadata.",
    route: "/inspect",
    workspace: "files",
    inputKinds: ["any"],
    outputKinds: [],
    aliases: ["metadata", "file info", "properties", "about file"],
    available: true,
    glyph: "ℹ",
    navOrder: 90,
    visibleInNav: false, // available in Command + Action Palette, not the rail
    contextualPriority: 30,
    usableAsNextAction: false,
  },
  // Note: 'history' was a former module id. It has been renamed to
  // 'recent-work' to avoid route collision (both would map to /history).
  // Persisted recent_work entries with operation_id === "history" are
  // handled by the HistoryRoute's onRepeat routeMap, which silently
  // no-ops for unknown ids.
  {
    id: "shelf",
    label: "Shelf",
    description: "Collect files, then run an operation across them.",
    route: "#shelf", // overlay, not a route
    workspace: "files",
    inputKinds: [],
    outputKinds: [],
    aliases: ["tray", "collect", "multi file", "staged files"],
    available: true,
    glyph: "▤",
    visibleInNav: false,
    pinnable: false,
    usableAsNextAction: false,
  },
  {
    id: "about",
    label: "About Paperu",
    description: "Version, edition, and local-first promise.",
    route: "/about",
    workspace: "files",
    inputKinds: [],
    outputKinds: [],
    aliases: ["version", "edition", "licence", "credits"],
    available: true,
    glyph: "⊕",
    navOrder: 200,
    visibleInNav: false,
    pinnable: false,
    usableAsNextAction: false,
  },
  // ── Master Prompt 4 consumer modules ───────────────────────────
  {
    id: "assignment-studio",
    label: "Assignment Studio",
    description: "Build one submission-ready PDF from photos + PDFs.",
    route: "/assignment",
    workspace: "files",
    inputKinds: ["image", "pdf"],
    outputKinds: ["pdf"],
    aliases: [
      "assignment",
      "submission",
      "homework",
      "essay",
      "project report",
      "cover page",
    ],
    available: true,
    glyph: "✎",
    navOrder: 110,
    visibleInNav: false,
    contextualPriority: 88,
  },
  {
    id: "portal-ready",
    label: "Make upload-ready",
    description: "Make a file fit a portal's size and format limits.",
    advancedName: "Portal-ready file preparation",
    route: "/portal",
    workspace: "files",
    inputKinds: ["pdf", "image"],
    outputKinds: ["pdf", "image"],
    aliases: [
      "upload ready",
      "portal",
      "upload",
      "under 500 kb",
      "under 1 mb",
      "under 2 mb",
      "passport photo",
      "college photo",
    ],
    available: true,
    glyph: "▴",
    navOrder: 120,
    visibleInNav: false,
    contextualPriority: 92,
  },
  {
    id: "application-kit",
    label: "Application kit",
    description: "Your reusable photos, signatures, and documents.",
    route: "/kit",
    workspace: "files",
    inputKinds: [],
    outputKinds: [],
    aliases: ["kit", "my documents", "signature vault", "resume", "photo"],
    available: true,
    glyph: "▤",
    navOrder: 130,
    visibleInNav: false,
    pinnable: false,
    usableAsNextAction: false,
  },
  {
    id: "study-reader",
    label: "Study reader",
    description: "Read PDFs and pick up where you left off.",
    advancedName: "PDF reader with reading-position memory",
    route: "/reader",
    workspace: "files",
    inputKinds: ["pdf"],
    outputKinds: [],
    aliases: ["reader", "read pdf", "open pdf", "textbook", "study"],
    available: true,
    glyph: "▤",
    navOrder: 140,
    visibleInNav: false,
    usableAsNextAction: false,
  },
  {
    id: "notes",
    label: "Notes",
    description: "Local notes. Autosaves as you type.",
    route: "/notes",
    workspace: "files",
    inputKinds: [],
    outputKinds: [],
    aliases: ["note", "write", "scratchpad", "text", "markdown"],
    available: true,
    glyph: "✎",
    navOrder: 150,
    visibleInNav: false,
    usableAsNextAction: false,
  },
  {
    id: "print-studio",
    label: "Print Studio",
    description: "Produce a print-ready PDF — 2-up, 4-up, grayscale.",
    route: "/print",
    workspace: "files",
    inputKinds: ["pdf"],
    outputKinds: ["pdf"],
    aliases: ["print", "2 up", "4 up", "exam print", "grayscale"],
    available: true,
    glyph: "⎙",
    navOrder: 160,
    visibleInNav: false,
    contextualPriority: 55,
  },
  {
    id: "batch-studio",
    label: "Batch Studio",
    description: "Run one operation across many files.",
    route: "/batch",
    workspace: "files",
    inputKinds: ["image", "pdf"],
    outputKinds: ["pdf", "image"],
    aliases: ["batch", "bulk", "many files", "queue"],
    available: true,
    glyph: "▦",
    navOrder: 170,
    visibleInNav: false,
    contextualPriority: 40,
  },
  {
    id: "paperu-send",
    label: "Paperu Send",
    description: "Send files to your phone over local network.",
    route: "/send",
    workspace: "files",
    inputKinds: [],
    outputKinds: [],
    aliases: ["send", "transfer", "phone", "qr"],
    available: false, // FEATURE-FLAGGED — see route file (§92)
    visibleInNav: false,
    visibleInCommand: false,
    pinnable: false,
    usableAsNextAction: false,
  },
  {
    id: "onboarding",
    label: "Onboarding",
    description: "First-run profile choice.",
    route: "/onboarding",
    workspace: "files",
    inputKinds: [],
    outputKinds: [],
    aliases: ["welcome", "setup", "get started"],
    available: false, // not in Command/Nav — shown only on first launch
    visibleInNav: false,
    visibleInCommand: false,
    pinnable: false,
    usableAsNextAction: false,
  },
  // ── Zero→50% feature expansion (Master Prompt: Zero→50) ─────────
  { id: "rename-studio", label: "Rename Studio", description: "Preview bulk renames before executing.", route: "/rename", workspace: "files", inputKinds: ["any"], outputKinds: [], aliases: ["rename", "bulk rename", "filename", "numbering"], available: true, glyph: "✎", navOrder: 300, visibleInNav: false, contextualPriority: 60 },
  { id: "filename-fixer", label: "Filename Fixer", description: "Clean filenames for email and uploads.", route: "/filename-fixer", workspace: "files", inputKinds: ["any"], outputKinds: [], aliases: ["fix filename", "clean filename", "email filename", "upload filename"], available: true, glyph: "✎", navOrder: 310, visibleInNav: false, contextualPriority: 65 },
  { id: "duplicate-finder", label: "Duplicate Finder", description: "Find exact duplicate files.", route: "/duplicates", workspace: "files", inputKinds: [], outputKinds: [], aliases: ["duplicates", "dupes", "find duplicates", "same file"], available: true, glyph: "▤", navOrder: 320, visibleInNav: false, pinnable: false, usableAsNextAction: false },
  { id: "quick-look", label: "Quick Look", description: "Fast preview without opening an editor.", route: "/quick-look", workspace: "files", inputKinds: ["any"], outputKinds: [], aliases: ["preview", "quick look", "peek"], available: true, glyph: "◉", navOrder: 330, visibleInNav: false, usableAsNextAction: false },
  { id: "downloads-cleaner", label: "Downloads Cleaner", description: "Scan, categorize, and tidy up.", route: "/cleaner", workspace: "files", inputKinds: [], outputKinds: [], aliases: ["downloads", "clean", "tidy", "sort downloads"], available: true, glyph: "⚘", navOrder: 340, visibleInNav: false, pinnable: false, usableAsNextAction: false },
  { id: "folder-organizer", label: "Folder Organizer", description: "Rules-based file automation with dry-run preview.", route: "/organizer", workspace: "files", inputKinds: [], outputKinds: [], aliases: ["organize", "rules", "sort", "automate"], available: true, glyph: "⟐", navOrder: 350, visibleInNav: false, pinnable: false, usableAsNextAction: false },
  { id: "citation-studio", label: "Citation Studio", description: "Deterministic citations — APA, MLA, Chicago, Harvard, BibTeX.", route: "/citations", workspace: "files", inputKinds: [], outputKinds: [], aliases: ["citation", "apa", "mla", "chicago", "harvard", "bibtex", "reference", "bibliography"], available: true, glyph: "✑", navOrder: 360, visibleInNav: false, pinnable: false, usableAsNextAction: false },
  { id: "study-packs", label: "Study Packs", description: "Organize files + notes into named packs by subject + semester.", route: "/study-packs", workspace: "files", inputKinds: [], outputKinds: [], aliases: ["study pack", "collection", "subject", "course", "semester"], available: true, glyph: "◷", navOrder: 370, visibleInNav: false, pinnable: true, usableAsNextAction: false },
  { id: "pdf-notebook", label: "PDF Notebook", description: "Generate blank/ruled/grid/dotted PDF notebooks.", route: "/pdf/notebook", workspace: "pdf", inputKinds: [], outputKinds: ["pdf"], aliases: ["notebook", "blank pdf", "ruled", "grid", "dotted"], available: true, glyph: "▦", navOrder: 70, visibleInNav: false, pinnable: true, usableAsNextAction: false },
  { id: "webpage-to-pdf", label: "Webpage → Clean PDF", description: "Enter a URL, get a clean printable PDF.", route: "/webpage-pdf", workspace: "files", inputKinds: [], outputKinds: ["pdf"], aliases: ["webpage", "url to pdf", "web to pdf", "clean pdf"], available: false, glyph: "▸", navOrder: 390, visibleInNav: false, pinnable: false, usableAsNextAction: false },
  { id: "screenshot-bridge", label: "Screenshot → Assignment", description: "Bridge screenshots to Assignment Studio or Notes.", route: "/screenshot-bridge", workspace: "files", inputKinds: ["image"], outputKinds: ["pdf"], aliases: ["screenshot", "bridge", "capture"], available: false, glyph: "⌖", navOrder: 400, visibleInNav: false, pinnable: false, usableAsNextAction: false },
  { id: "document-scanner", label: "Document Scanner", description: "Turn phone photos of documents into clean PDFs.", route: "/scanner", workspace: "files", inputKinds: ["image"], outputKinds: ["pdf"], aliases: ["scan", "scanner", "document scan", "camera"], available: false, glyph: "⎙", navOrder: 410, visibleInNav: false, pinnable: false, usableAsNextAction: false },
  { id: "clipboard-history", label: "Clipboard History", description: "Opt-in local clipboard history. No uploads.", route: "/clipboard", workspace: "files", inputKinds: [], outputKinds: [], aliases: ["clipboard", "history", "paste"], available: false, glyph: "⋄", navOrder: 420, visibleInNav: false, pinnable: false, usableAsNextAction: false },
  { id: "offline-converter", label: "Offline Converter", description: "Convert between formats locally. No uploads.", route: "/converter", workspace: "files", inputKinds: ["any"], outputKinds: [], aliases: ["convert", "converter", "png to jpg", "pdf to png", "image to pdf"], available: true, glyph: "⇄", navOrder: 430, visibleInNav: false, pinnable: false, usableAsNextAction: false },
  { id: "archive-studio", label: "Archive Studio", description: "Safe ZIP create, list, and extract.", route: "/archive", workspace: "files", inputKinds: ["any"], outputKinds: [], aliases: ["zip", "archive", "extract", "unzip", "compress"], available: true, glyph: "⊞", navOrder: 440, visibleInNav: false, pinnable: true, usableAsNextAction: false },
  { id: "file-rescue", label: "File Rescue", description: "Diagnose and recover damaged files.", route: "/rescue", workspace: "files", inputKinds: ["any"], outputKinds: [], aliases: ["rescue", "recover", "repair", "fix file", "corrupt"], available: true, glyph: "⊥", navOrder: 450, visibleInNav: false, contextualPriority: 30 },
  { id: "usb-toolbox", label: "USB / Drive Toolbox", description: "Copy with SHA-256 verification.", route: "/usb", workspace: "files", inputKinds: [], outputKinds: [], aliases: ["usb", "drive", "copy", "verify", "checksum"], available: true, glyph: "⊡", navOrder: 460, visibleInNav: false, pinnable: true, usableAsNextAction: false },
  { id: "backup-recipes", label: "Local Backup Recipes", description: "Persistent backup definitions with dry-run.", route: "/backup", workspace: "files", inputKinds: [], outputKinds: [], aliases: ["backup", "recipe", "sync", "mirror"], available: false, glyph: "⊨", navOrder: 470, visibleInNav: false, pinnable: false, usableAsNextAction: false },
  { id: "timer-jobs", label: "Timer Jobs", description: "Scheduled Paperu operations.", route: "/timer", workspace: "files", inputKinds: [], outputKinds: [], aliases: ["timer", "schedule", "daily", "weekly", "cron"], available: false, glyph: "⏱", navOrder: 480, visibleInNav: false, pinnable: false, usableAsNextAction: false },
{ id: "forms-vault", label: "Forms Vault", description: "Local-only reusable form field values.", route: "/forms-vault", workspace: "files", inputKinds: [], outputKinds: [], aliases: ["forms", "vault", "fields", "personal", " autofill"], available: true, glyph: "▤", navOrder: 486, visibleInNav: false, pinnable: true, usableAsNextAction: false },
{ id: "signature-vault", label: "Signature Vault", description: "Local-only signature references. Reusable in Sign PDF + Assignment.", route: "/signature-vault", workspace: "files", inputKinds: [], outputKinds: [], aliases: ["signature", "vault", "sign", "initials"], available: true, glyph: "✎", navOrder: 485, visibleInNav: false, pinnable: true, usableAsNextAction: false },
  { id: "watch-folders", label: "Watch Folders", description: "Live filesystem event feed (rule→recipe automation comes next).", route: "/watch", workspace: "files", inputKinds: [], outputKinds: [], aliases: ["watch", "monitor", "folder watch", "automate"], available: true, glyph: "⊙", navOrder: 490, visibleInNav: false, pinnable: true, usableAsNextAction: false },
  {
    id: "diagnostics",
    label: "Diagnostics",
    description: "Local logs, settings, and startup timing.",
    route: "/diagnostics",
    workspace: "files",
    inputKinds: [],
    outputKinds: [],
    aliases: ["logs", "troubleshoot", "debug"],
    available: true,
    glyph: "⊕",
    navOrder: 210,
    visibleInNav: false,
    pinnable: false,
    usableAsNextAction: false,
  },
  // --- Future modules (available: false) ---
  // 'notes' and 'assignments' (Assignment Studio) are now real
  // implemented modules — see the implemented entries above. The
  // remaining entries below are genuinely future/unbuilt.
  {
    id: "assignments-legacy-stub",
    label: "Assignment Studio (legacy stub)",
    description: "Legacy placeholder — replaced by the real Assignment Studio.",
    route: "/assignments-legacy",
    workspace: "files",
    inputKinds: [],
    outputKinds: [],
    aliases: [],
    available: false,
  },
  {
    id: "business-reports",
    label: "Business reports",
    description: "Generate local business documents.",
    route: "/business/reports",
    workspace: "business",
    inputKinds: [],
    outputKinds: ["pdf"],
    aliases: ["invoice", "report"],
    available: false,
  },
  {
    id: "capture",
    label: "Capture",
    description: "Scan documents with your camera.",
    route: "/capture",
    workspace: "capture",
    inputKinds: [],
    outputKinds: ["pdf", "image"],
    aliases: ["scan", "camera"],
    available: false,
  },
];

/**
 * Get all available modules (for navigation, command search).
 */
export function getAvailableModules(): readonly ModuleEntry[] {
  return MODULES.filter((m) => m.available);
}

/**
 * Get modules that should appear in the nav rail.
 * Sorted by navOrder. This is what App.tsx uses to render the rail —
 * there is no separate hardcoded NAV list.
 */
export function getNavModules(): readonly ModuleEntry[] {
  return getAvailableModules()
    .filter((m) => (m.visibleInNav ?? true))
    .sort((a, b) => (a.navOrder ?? DEFAULT_NAV_ORDER) - (b.navOrder ?? DEFAULT_NAV_ORDER));
}

/**
 * Get modules searchable in the Command Center.
 */
export function getCommandModules(): readonly ModuleEntry[] {
  return getAvailableModules().filter((m) => (m.visibleInCommand ?? true));
}

/**
 * Get modules that accept a given file kind (for Universal Drop and
 * Action Palette contextual suggestions). Sorted by contextualPriority.
 */
export function getModulesForKind(kind: InputKind): readonly ModuleEntry[] {
  return getAvailableModules()
    .filter(
      (m) => m.inputKinds.includes(kind) || m.inputKinds.includes("any"),
    )
    .sort((a, b) => (b.contextualPriority ?? DEFAULT_CONTEXTUAL_PRIORITY) - (a.contextualPriority ?? DEFAULT_CONTEXTUAL_PRIORITY));
}

/**
 * Get modules that produce a given file kind (for next-action suggestions
 * on result cards).
 */
export function getModulesProducingKind(kind: FileKind): readonly ModuleEntry[] {
  return getAvailableModules().filter((m) => m.outputKinds.includes(kind));
}

/**
 * Get modules that can act on a *result* of the given kind — i.e., the
 * next-action list shown after an operation completes. Returns modules
 * that ACCEPT the result kind, excluding the source module.
 */
export function getNextActionsForKind(
  kind: FileKind,
  excludeId?: string,
): readonly ModuleEntry[] {
  return getAvailableModules()
    .filter((m) => m.id !== excludeId)
    .filter(
      (m) =>
        m.usableAsNextAction !== false &&
        (m.inputKinds.includes(kind) || m.inputKinds.includes("any")),
    )
    .sort((a, b) => (b.contextualPriority ?? DEFAULT_CONTEXTUAL_PRIORITY) - (a.contextualPriority ?? DEFAULT_CONTEXTUAL_PRIORITY));
}

/** Normalize a query string: lowercase, collapse whitespace, trim. */
function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Tokenize a query into ordered terms for token-level matching. */
function tokenize(q: string): readonly string[] {
  return normalizeQuery(q)
    .split(" ")
    .filter((t) => t.length > 0);
}

/** Score a single module against a single token. */
function scoreToken(m: ModuleEntry, token: string): number {
  let score = 0;
  const label = m.label.toLowerCase();
  if (label === token) score += 100;
  else if (label.startsWith(token)) score += 60;
  else if (label.includes(token)) score += 35;

  for (const a of m.aliases) {
    const al = a.toLowerCase();
    if (al === token) score += 90;
    else if (al.startsWith(token)) score += 45;
    else if (al.includes(token)) score += 25;
  }
  if (m.description.toLowerCase().includes(token)) score += 8;
  if (m.advancedName?.toLowerCase().includes(token)) score += 8;
  return score;
}

/**
 * Deterministic fuzzy search modules for the Command Center.
 * Matches against label, description, aliases, and advancedName.
 * Behavior:
 *   - Empty query returns all command-visible modules (RECENT-style).
 *   - Multi-word query: every token must score > 0 (AND semantics).
 *   - Score is summed across tokens.
 *   - Ties broken by navOrder (stable, deterministic).
 * No AI, no ML, no remote calls. Pure string matching.
 */
export function searchModules(query: string): readonly ModuleEntry[] {
  const tokens = tokenize(query);
  const pool = getCommandModules();
  if (tokens.length === 0) {
    // Stable default ordering for empty query.
    return [...pool].sort(
      (a, b) => (a.navOrder ?? DEFAULT_NAV_ORDER) - (b.navOrder ?? DEFAULT_NAV_ORDER),
    );
  }
  const results: { module: ModuleEntry; score: number }[] = [];
  for (const m of pool) {
    let total = 0;
    let allMatch = true;
    for (const t of tokens) {
      const s = scoreToken(m, t);
      if (s <= 0) {
        allMatch = false;
        break;
      }
      total += s;
    }
    if (allMatch) {
      results.push({ module: m, score: total });
    }
  }
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.module.navOrder ?? DEFAULT_NAV_ORDER) - (b.module.navOrder ?? DEFAULT_NAV_ORDER);
  });
  return results.map((r) => r.module);
}

/**
 * Get a module by id.
 */
export function getModule(id: string): ModuleEntry | undefined {
  return MODULES.find((m) => m.id === id);
}

/**
 * Get modules in a given workspace.
 */
export function getModulesInWorkspace(
  workspace: ModuleEntry["workspace"],
): readonly ModuleEntry[] {
  return getAvailableModules()
    .filter((m) => m.workspace === workspace)
    .sort((a, b) => (a.navOrder ?? DEFAULT_NAV_ORDER) - (b.navOrder ?? DEFAULT_NAV_ORDER));
}

/**
 * List all workspaces that currently have at least one available module.
 * Future workspaces (capture, video, business, automate) are excluded
 * until they have an available module.
 */
export function getActiveWorkspaces(): readonly ModuleEntry["workspace"][] {
  const seen = new Set<ModuleEntry["workspace"]>();
  for (const m of getAvailableModules()) {
    seen.add(m.workspace);
  }
  // Stable order: files, pdf, images — then anything else alphabetical.
  const order: ModuleEntry["workspace"][] = [
    "files",
    "pdf",
    "images",
    "capture",
    "video",
    "business",
    "automate",
  ];
  return order.filter((w) => seen.has(w));
}
