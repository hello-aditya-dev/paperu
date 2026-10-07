/**
 * @paperu/design-tokens — typed token catalogue.
 *
 * Mirrors the CSS custom properties in `tokens.css` so components
 * can reference token names safely. Components should consume the
 * CSS variables directly; this module is a source of truth and a
 * way to keep JS and CSS in sync.
 */

export const tokens = {
  color: {
    bg: "var(--paperu-bg)",
    bgElevated: "var(--paperu-bg-elevated)",
    surface: "var(--paperu-surface)",
    surfaceMuted: "var(--paperu-surface-muted)",
    surfaceElevated: "var(--paperu-surface-elevated)",
    text: "var(--paperu-text)",
    textMuted: "var(--paperu-text-muted)",
    textSubtle: "var(--paperu-text-subtle)",
    border: "var(--paperu-border)",
    borderStrong: "var(--paperu-border-strong)",
    accent: "var(--paperu-accent)",
    accentHover: "var(--paperu-accent-hover)",
    accentForeground: "var(--paperu-accent-foreground)",
    success: "var(--paperu-success)",
    successForeground: "var(--paperu-success-foreground)",
    warning: "var(--paperu-warning)",
    warningForeground: "var(--paperu-warning-foreground)",
    destructive: "var(--paperu-destructive)",
    destructiveForeground: "var(--paperu-destructive-foreground)",
    info: "var(--paperu-info)",
    infoForeground: "var(--paperu-info-foreground)",
  },
  radius: {
    xs: "var(--paperu-radius-xs)",
    sm: "var(--paperu-radius-sm)",
    md: "var(--paperu-radius-md)",
    lg: "var(--paperu-radius-lg)",
    xl: "var(--paperu-radius-xl)",
    pill: "var(--paperu-radius-pill)",
  },
  space: {
    "0": "var(--paperu-space-0)",
    "1": "var(--paperu-space-1)",
    "2": "var(--paperu-space-2)",
    "3": "var(--paperu-space-3)",
    "4": "var(--paperu-space-4)",
    "5": "var(--paperu-space-5)",
    "6": "var(--paperu-space-6)",
    "7": "var(--paperu-space-7)",
    "8": "var(--paperu-space-8)",
  },
  font: {
    sans: "var(--paperu-font-sans)",
    serif: "var(--paperu-font-serif)",
    mono: "var(--paperu-font-mono)",
  },
  shadow: {
    xs: "var(--paperu-shadow-xs)",
    sm: "var(--paperu-shadow-sm)",
    md: "var(--paperu-shadow-md)",
    lg: "var(--paperu-shadow-lg)",
  },
  duration: {
    fast: "var(--paperu-duration-fast)",
    base: "var(--paperu-duration-base)",
    slow: "var(--paperu-duration-slow)",
  },
  z: {
    base: "var(--paperu-z-base)",
    raised: "var(--paperu-z-raised)",
    sticky: "var(--paperu-z-sticky)",
    overlay: "var(--paperu-z-overlay)",
    modal: "var(--paperu-z-modal)",
    toast: "var(--paperu-z-toast)",
    tooltip: "var(--paperu-z-tooltip)",
  },
} as const;

export type Tokens = typeof tokens;
