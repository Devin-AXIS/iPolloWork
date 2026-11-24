// Compiles the engine stylesheet into packages/core/dist.
//
// The source keeps a raw `@tailwind utilities;` so in-repo examples can expand
// it with their own dev Tailwind build — but the SHIPPED file must not: a host
// app's Tailwind would re-expand the directive against the HOST's config, and a
// host with no Tailwind would drop it, leaving the chrome unstyled. So the
// build expands it here, against packages/core/tailwind.dist.config.cjs, which
// scopes every utility under `.docx-editor` (Tailwind v3 `important` selector
// strategy — no `!important` emitted).
//
// `@tailwind base` is prepended with preflight DISABLED: that emits only the
// `--tw-*` custom-property defaults that translate/ring/zoom utilities read,
// and `optimizeUniversalDefaults` grafts them onto the scoped utility selectors
// instead of a global `*, ::before, ::after` rule. The output is asserted to
// contain no directive and no unscoped global selector before it is written.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
// cssnano 9 declares `engines.node ^22.22.3 || ^24.15.0 || >=26.0`, and its plugins
// call `Set.prototype.difference`, which lands in Node 22. bun does not enforce
// `engines`, so an older Node installs it and then throws
// `trustedFunctions.difference is not a function` at build time. Every CI and
// release job that builds runs setup-node with Node 24, which satisfies it.
import cssnano from 'cssnano';
import { coreCssProblems } from './core-css-assertions.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'core');
const from = join(root, 'src', 'styles', 'editor.css');
const to = join(root, 'dist', 'editor.css');

const source = readFileSync(from, 'utf8');
const input = `@tailwind base;\n${source}`;

// `optimizeUniversalDefaults` grafts the `--tw-*` defaults onto the utility
// class names that read them (`.transform, .shadow-lg, ...`) — grouped, but NOT
// run through the `important: '.docx-editor'` selector rewrite, so they would still
// match host-app elements. Scope every rule that declares only `--tw-*` custom
// properties. `:is()` keeps each selector's own specificity semantics intact.
const scopeTailwindDefaults = {
  postcssPlugin: 'scope-tailwind-defaults',
  OnceExit(cssRoot) {
    cssRoot.walkRules((rule) => {
      if (rule.selector.includes('.docx-editor')) return;
      const nodes = rule.nodes ?? [];
      if (nodes.length === 0) return;
      const onlyTwVars = nodes.every(
        (node) => node.type === 'decl' && node.prop.startsWith('--tw-')
      );
      if (!onlyTwVars) return;
      rule.selectors = rule.selectors.map((selector) => `.docx-editor :is(${selector})`);
    });
  },
};

// `@keyframes` names are DOCUMENT-GLOBAL: no selector strategy can scope them, so a
// generic name we ship (tailwindcss-animate emits `enter` and `exit`) silently overrides
// a host's own animation of the same name, or is overridden by it, depending on import
// order. Every name we emit gets the editor's prefix, and every reference is rewritten.
const prefixKeyframes = {
  postcssPlugin: 'prefix-keyframes',
  OnceExit(cssRoot) {
    const renamed = new Map();
    cssRoot.walkAtRules(/^(-\w+-)?keyframes$/, (rule) => {
      const name = rule.params.trim();
      if (name.startsWith('docx-') || name.startsWith('hf-')) return;
      const next = `docx-editor-${name}`;
      renamed.set(name, next);
      rule.params = next;
    });
    if (renamed.size === 0) return;
    cssRoot.walkDecls(/^(-\w+-)?animation(-name)?$/, (decl) => {
      decl.value = decl.value.replace(/[\w-]+/g, (token) => renamed.get(token) ?? token);
    });
  },
};

// The shipped file is minified. Tailwind emits every utility the config generates,
// pretty-printed, which is ~three times the bytes a host actually downloads.
//
// The preset is pinned to `default`, and the pin is the safety property, not a
// default worth leaving implicit. `default` runs 29 plugins that rewrite VALUES
// and selectors, and none that rewrite identifiers. `advanced` adds four that do,
// and each one breaks this file:
//
//   reduceIdents   renames `@keyframes docx-editor-enter` to `a`, undoing the
//                  prefixing above — and the global-namespace collision that
//                  prefixing exists to prevent comes straight back.
//   mergeIdents    same hazard from the other direction: it unifies two prefixed
//                  names into one shared short name.
//   discardUnused  drops `@keyframes` and `@font-face` with no reference IN THIS
//                  FILE. For a library stylesheet the reference is in the host's
//                  markup, which the minifier cannot see.
//   zindex         renumbers a stacking order this file shares with inline styles
//                  the engine sets at runtime, which no stylesheet pass can see.
//
// Naming them as `false` here does NOT hold that line: cssnano validates nothing,
// so an option for a plugin the preset does not load is silently ignored. The
// post-minify `coreCssProblems` run below is the real guard — it fails on a
// keyframe name that lost its prefix, whatever produced it.
const minify = cssnano({ preset: ['default'] });

const compiled = await postcss([
  tailwindcss({ config: join(root, 'tailwind.dist.config.cjs') }),
  scopeTailwindDefaults,
  prefixKeyframes,
  autoprefixer(),
]).process(input, { from, map: false });

// Asserted TWICE, on either side of the minifier, because the two runs blame
// different steps. A failure before means the compile is wrong; a failure after
// means cssnano broke the scoping contract on correct input. The shipped bytes
// are the ones that have to satisfy it, so the second run is the load-bearing one.
const refuse = (stage, problems) => {
  if (problems.length === 0) return;
  console.error(`core: refusing to emit dist/editor.css (${stage}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
};

refuse('compiled', coreCssProblems(compiled.css));

const result = await postcss([minify]).process(compiled.css, { from, map: false });

refuse('minified', coreCssProblems(result.css));

mkdirSync(dirname(to), { recursive: true });
writeFileSync(to, result.css);
const before = (compiled.css.length / 1024).toFixed(0);
const after = (result.css.length / 1024).toFixed(0);
console.log(
  `core: compiled editor.css into dist (${after} KiB minified from ${before} KiB, utilities scoped to .docx-editor)`
);
