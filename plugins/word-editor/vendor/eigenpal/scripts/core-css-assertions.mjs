// Assertions the SHIPPED core stylesheet must satisfy — shared by the build
// (scripts/build-core-styles.mjs, which refuses to emit a bad file) and the
// standalone guard (scripts/check-core-css-compiled.mjs, which fails CI on one).
//
// The contract: dist/editor.css is fully compiled and namespaced. A raw
// `@tailwind` directive would be re-expanded by a HOST app's Tailwind against
// the host's config (collisions, wrong palette) and silently dropped in a host
// with no Tailwind at all (unstyled chrome). A selector that is not anchored to
// the editor reaches into host markup the editor does not own.
//
// STRUCTURAL, not a denylist. Naming the shapes we forbid only ever catches the
// leaks someone already thought of: `a { color }`, `:root { --doc-x }` and
// `.btn { padding }` all slipped past the four-pattern version of this check.
// The rule is inverted instead — every rule must be anchored — with a short,
// explicit allowlist for the engine's own namespaces.

import postcss from 'postcss';

/** The scope class every shipped rule must be anchored to. */
const SCOPE = '.docx-editor';

/**
 * Class prefixes the engine owns outright, exempt from carrying the scope class.
 *
 * Only `.docx-` is left, and the bar for adding another is that the name cannot
 * plausibly belong to anyone else.
 *
 * `.ProseMirror-` was here and is not ours at all — it is ProseMirror's, and
 * `.ProseMirror-yjs-cursor` belongs to a host's own Yjs binding, so a host running
 * its own ProseMirror editor got our rules on its elements.
 *
 * `.layout-` we do mint, but the names are generic enough that a host could
 * mint them too (`.layout-paragraph`, `.layout-run-text`).
 * The old rationale — that they match painted document elements rather than
 * chrome, so the scope class "would be wrong" — does not hold: painted elements
 * are always inside the viewport, which always carries the scope class. They are
 * scoped now, which costs nothing and keeps the editor's CSS inside the editor.
 */
const OWNED_PREFIXES = ['.docx-'];

/** A keyframe step (`from`, `to`, `47%`) is not a selector. */
const KEYFRAME_STEP = /^(from|to|-?[\d.]+%)$/;

/**
 * Folds every rewrite `postcss-minify-selectors` performs, so a positive
 * assertion below matches the same rule before and after minification.
 *
 * All four are confirmed against the shipped file, and none of them changes what
 * a selector MATCHES, so a normalized comparison stays exact:
 *
 *   1. whitespace around a combinator collapses
 *   2. an attribute value that is a valid identifier loses its quotes
 *   3. the four legacy pseudo-elements collapse to one colon
 *      (`.docx-content-control-widget::after` ships as `…:after`)
 *   4. a `*` qualified by anything is dropped, since what follows already
 *      implies it: `*.b`, `*[data-x]`, `*#id`, `*:hover` and `*::selection`
 *      all lose it (`.docx-run *::selection` ships as `.docx-run ::selection`).
 *      A bare `*` is kept, by cssnano and here, because nothing implies it.
 *
 * Write the readable form in an assertion. This function is what makes the
 * readable form match. Adding an assertion for a shape not folded here is the
 * one way to get a false "missing" against a correct file, so a new positive
 * assertion is a reason to re-check this list, and scripts/__tests__ pins each
 * fold against what cssnano actually emits.
 *
 * Two known warts, both harmless because they are SYMMETRIC — cssnano leaves
 * these selectors alone, so the raw and minified sides fold identically and
 * still compare equal. The quote strip is unconditional, so it also strips
 * quotes cssnano keeps (`[data-foo="a b"]`), and a value that begins with `*:`
 * loses that prefix. Folding them exactly needs a real selector parser, which
 * this assertion does not warrant.
 */
export function normalizeSelector(selector) {
  return selector
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~,])\s*/g, '$1')
    .replace(/\[([^\]=]+)=(["'])([^"']*)\2\]/g, '[$1=$3]')
    .replace(/::(before|after|first-line|first-letter)\b/g, ':$1')
    .replace(/\*(?=[.#:[])/g, '')
    .trim();
}

/**
 * Whether a selector can only ever match inside the editor.
 *
 * Either it names the scope class, or SOME compound names a class the engine owns —
 * an engine ancestor confines a rule exactly as the scope class does
 * (`.docx-paragraph *::selection`), and the class may sit behind a tag or a pseudo
 * (`a.docx-hyperlink`, `:where(.docx-paginated-surface)`). What this rejects is a
 * selector with no engine anchor anywhere in it: `a`, `:root`, `.btn`, `body`.
 */
function isAnchored(selector) {
  if (selector.includes(SCOPE)) return true;
  return OWNED_PREFIXES.some((prefix) => selector.includes(prefix));
}

/** @returns {string[]} problems; empty when the css satisfies the contract */
export function coreCssProblems(rawCss) {
  const problems = [];
  if (/@tailwind\b/.test(rawCss.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    problems.push('contains a raw @tailwind directive — the build did not expand it');
  }

  let root;
  try {
    root = postcss.parse(rawCss);
  } catch (error) {
    return [...problems, `is not parseable CSS: ${String(error)}`];
  }

  const unanchored = new Set();
  root.walkRules((rule) => {
    // Keyframe steps live under an at-rule and are not page selectors.
    if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
    for (const selector of rule.selectors) {
      if (KEYFRAME_STEP.test(selector.trim())) continue;
      if (!isAnchored(selector)) unanchored.add(selector.trim());
    }
  });
  for (const selector of [...unanchored].sort().slice(0, 10)) {
    problems.push(`selector is not anchored to ${SCOPE} or an engine namespace: ${selector}`);
  }
  if (unanchored.size > 10) {
    problems.push(`…and ${unanchored.size - 10} more unanchored selectors`);
  }

  // `@keyframes` names are document-global; no selector strategy can scope them,
  // so they carry the editor's prefix instead (see build-core-styles.mjs).
  root.walkAtRules(/^(-\w+-)?keyframes$/, (rule) => {
    const name = rule.params.trim();
    if (!/^(docx-|hf-)/.test(name)) {
      problems.push(`@keyframes name is in the global namespace: ${name}`);
    }
  });

  // The positive half: the compiled utilities and the scoped editable-surface rules
  // have to actually BE there, or a "clean" file could simply be empty.
  //
  // These read the PARSED selectors, not the raw text, because the shipped file is
  // minified: `.docx-editor {` loses its space, and an attribute value loses its
  // quotes (`[contenteditable='true']` → `[contenteditable=true]`). A raw
  // `includes()` would fail on a correct file. Each one is written in the readable
  // form and matched through `normalizeSelector`; see its docblock before adding
  // another, because a shape it does not fold reports a false "missing".
  const selectors = new Set();
  root.walkRules((rule) => {
    for (const selector of rule.selectors) selectors.add(normalizeSelector(selector));
  });
  if (!selectors.has('.docx-editor .flex')) {
    problems.push("missing '.docx-editor .flex' — utilities absent or not scoped");
  }
  if (!selectors.has('.docx-editor [contenteditable=true]')) {
    problems.push('missing the scoped [contenteditable] caret rule');
  }
  if (!selectors.has('.docx-editor')) {
    problems.push("missing the '.docx-editor' token block");
  }
  let hasDocToken = false;
  root.walkDecls((decl) => {
    if (decl.prop.startsWith('--doc-')) hasDocToken = true;
  });
  if (!hasDocToken) {
    problems.push('missing --doc-* chrome tokens');
  }
  return problems;
}
