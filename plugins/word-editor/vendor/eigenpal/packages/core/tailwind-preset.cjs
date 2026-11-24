/**
 * Shared Tailwind theme preset — SINGLE SOURCE OF TRUTH for the editor's
 * Tailwind color/theme config. The root, React, and Vue Tailwind configs all
 * extend this preset so the palette can never drift between adapters.
 *
 * Every color here maps to a CSS variable defined in
 * packages/core/src/styles/editor.css. The shadcn tokens use the
 * `hsl(var(--x) / <alpha-value>)` form so opacity modifiers (e.g. bg-primary/90)
 * work; the --doc-* chrome tokens are plain var() (used mostly in raw CSS).
 *
 * CommonJS so the ESM adapter configs can `require()` it (Tailwind loads configs
 * via jiti, which supports require). Each adapter config still owns its own
 * `content` globs and `important: '.docx-editor'` scoping.
 */
module.exports = {
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        'doc-surface': 'var(--doc-surface)',
        'doc-bg': 'var(--doc-bg)',
        'doc-bg-subtle': 'var(--doc-bg-subtle)',
        'doc-bg-hover': 'var(--doc-bg-hover)',
        'doc-bg-input': 'var(--doc-bg-input)',
        'doc-primary': 'var(--doc-primary)',
        'doc-primary-hover': 'var(--doc-primary-hover)',
        'doc-primary-light': 'var(--doc-primary-light)',
        'doc-accent': 'var(--doc-accent)',
        'doc-accent-bg': 'var(--doc-accent-bg)',
        'doc-on-primary': 'var(--doc-on-primary)',
        'doc-text': 'var(--doc-text)',
        'doc-text-muted': 'var(--doc-text-muted)',
        'doc-text-subtle': 'var(--doc-text-subtle)',
        'doc-text-placeholder': 'var(--doc-text-placeholder)',
        'doc-border': 'var(--doc-border)',
        'doc-border-light': 'var(--doc-border-light)',
        'doc-border-dark': 'var(--doc-border-dark)',
        'doc-border-input': 'var(--doc-border-input)',
        'doc-error': 'var(--doc-error)',
        'doc-error-bg': 'var(--doc-error-bg)',
        'doc-success': 'var(--doc-success)',
        'doc-success-bg': 'var(--doc-success-bg)',
        'doc-warning': 'var(--doc-warning)',
        'doc-warning-bg': 'var(--doc-warning-bg)',
        'doc-warning-text': 'var(--doc-warning-text)',
        'doc-link': 'var(--doc-link)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
