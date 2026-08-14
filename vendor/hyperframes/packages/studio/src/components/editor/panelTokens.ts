// ── Design Panel Tokens (for inline style={{}} usage) ──────────────────
// Tailwind classes use `panel-*` from tailwind.config.js theme.extend.colors.
// This file provides the same values for inline styles where Tailwind can't reach.

export const P = {
  accent: "#1FBAC0",
  borderInput: "#27272A",
  textMuted: "#52525B",
  white: "#FAFAFA",
} as const;
