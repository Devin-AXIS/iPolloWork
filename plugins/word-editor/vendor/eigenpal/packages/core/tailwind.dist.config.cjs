/**
 * Tailwind config for the SHIPPED stylesheet build only (scripts/build-core-styles.mjs).
 *
 * dist/editor.css must be self-contained and collision-proof in a host application:
 *
 * - `important: '.docx-editor'` (the v3 SELECTOR strategy — no `!important` is emitted)
 *   rewrites every utility to `.docx-editor .flex { ... }`. Inside the editor chrome our
 *   utilities win over a host Tailwind's same-named classes by specificity; outside
 *   `.docx-editor` they can never match at all.
 * - `content` covers every package that puts Tailwind classes on editor chrome. The
 *   examples are deliberately excluded — they run their own Tailwind build in dev.
 * - `preflight: false` + the build script's `@tailwind base` prepend emit ONLY the
 *   `--tw-*` custom-property defaults (translate/ring/etc. depend on them), and
 *   `optimizeUniversalDefaults` grafts those onto the scoped utility selectors instead
 *   of a global `*, ::before, ::after` rule. Nothing in the output resets host styles.
 *
 * No safelist: chrome sources use only static class literals (cva variants included).
 * If you ever compose a Tailwind class name dynamically, safelist it here.
 */
const path = require('path');

module.exports = {
  presets: [require('./tailwind-preset.cjs')],
  important: '.docx-editor',
  corePlugins: { preflight: false },
  experimental: { optimizeUniversalDefaults: true },
  content: [
    path.join(__dirname, '../react/src/**/*.{ts,tsx}'),
    path.join(__dirname, '../pro/src/**/*.{ts,tsx}'),
    path.join(__dirname, '../vue/src/**/*.{ts,vue}'),
  ],
};
