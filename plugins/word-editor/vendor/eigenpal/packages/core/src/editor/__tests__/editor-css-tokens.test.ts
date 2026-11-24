// Every `--doc-*` token a stylesheet CONSUMES must also be DEFINED (interactive-paginated-editing).
//
// `.docx-editor-one-surface__caret { background: var(--doc-caret) }` shipped with `--doc-caret`
// declared only inside the dark-mode block, so in the default theme it resolved to nothing
// and the caret painted as a 1px transparent div: correctly positioned, visible, blinking,
// and completely invisible. A missing custom property fails silently — `var()` with no
// fallback yields the guaranteed-invalid value and the declaration is simply dropped — so
// nothing in the type system or the test suite could catch it.
//
// This pins the whole class: parse the stylesheet, collect what it defines and what it
// reads, and require the second to be a subset of the first.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(
  fileURLToPath(new URL('../../styles/editor.css', import.meta.url)),
  'utf8'
);

/** Strip comments so a token named inside prose is not mistaken for a declaration. */
const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

function declaredTokens(source: string): Set<string> {
  return new Set([...source.matchAll(/(--doc-[\w-]+)\s*:/g)].map((m) => m[1]!));
}

function consumedTokens(source: string): Map<string, boolean> {
  // value -> whether every use of it supplies a fallback.
  const out = new Map<string, boolean>();
  for (const match of source.matchAll(/var\(\s*(--doc-[\w-]+)\s*(,)?/g)) {
    const name = match[1]!;
    const hasFallback = match[2] === ',';
    out.set(name, (out.get(name) ?? true) && hasFallback);
  }
  return out;
}

/**
 * Extents of every dark-mode rule, by brace matching from each dark selector.
 *
 * The invariant is NOT positional. Slicing to "text before the first dark block" was tried
 * and is wrong on this stylesheet: ordinary default-theme declarations sit after it
 * (`--doc-page-gap`, `--doc-page-bg`), so it reports false positives.
 *
 * What actually holds is that DARK MODE OVERRIDES A DEFAULT — it never introduces a token.
 * So a token declared only inside dark rules has no default value, `var()` yields the
 * guaranteed-invalid value, and the declaration is silently dropped in the default theme.
 * That is exactly how the caret shipped invisible, and how the page sheet shipped
 * transparent; declaration ORDER is irrelevant to it.
 */
const DARK_SELECTOR =
  /\.docx-editor\.dark|\[data-theme=['"]dark['"]\]|prefers-color-scheme:\s*dark/g;

function darkRanges(source: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  DARK_SELECTOR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DARK_SELECTOR.exec(source)) !== null) {
    const open = source.indexOf('{', match.index);
    if (open === -1) continue;
    let depth = 0;
    let i = open;
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    ranges.push({ from: match.index, to: i });
  }
  return ranges;
}

const inAnyRange = (at: number, ranges: readonly { from: number; to: number }[]) =>
  ranges.some((r) => at >= r.from && at <= r.to);

describe('editor stylesheet custom properties', () => {
  test('every consumed --doc-* token is declared somewhere, or always has a fallback', () => {
    const declared = declaredTokens(withoutComments);
    const consumed = consumedTokens(withoutComments);
    const missing = [...consumed.entries()]
      .filter(([name, alwaysHasFallback]) => !declared.has(name) && !alwaysHasFallback)
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  test('--doc-caret is declared for the DEFAULT theme, not only for dark', () => {
    // The specific regression: declared once, inside the dark block.
    const darkBlockStart = withoutComments.search(
      /\.docx-editor\.dark|\[data-theme=['"]dark['"]\]|prefers-color-scheme:\s*dark/
    );
    const beforeDark =
      darkBlockStart === -1 ? withoutComments : withoutComments.slice(0, darkBlockStart);
    expect(declaredTokens(beforeDark).has('--doc-caret')).toBe(true);
  });

  test('no --doc-* token is declared ONLY inside dark-mode rules', () => {
    // Mutation-verified, both historical instances:
    //
    //   remove the default `--doc-caret`   -> CAUGHT
    //   remove the default `--doc-page-bg` -> CAUGHT
    //
    // A previous commit recorded this as PARTIAL, catching the caret and missing the page
    // background. That was wrong for an embarrassing reason: the test did not exist. A patch
    // anchor had not matched, `darkRanges` sat unused, and the mutation I ran was exercising
    // the OLD positional check. The lesson is that "the guard is partial" and "the guard is
    // absent" produce the same green suite, so a guard has to be mutation-tested the moment
    // it is written, not reasoned about.
    //
    // Dark mode OVERRIDES a default; it never introduces a token. A token declared only
    // inside dark rules has no default value, so `var()` yields the guaranteed-invalid value
    // and the declaration is silently dropped in the light theme. That is exactly how the
    // caret shipped invisible and the page sheet shipped transparent, and declaration ORDER
    // is irrelevant to it — a positional slice was tried first and produced false positives
    // on this stylesheet.
    const ranges = darkRanges(withoutComments);
    expect(ranges.length).toBeGreaterThan(0);
    const declaredAnywhere = new Set<string>();
    const declaredOutsideDark = new Set<string>();
    for (const match of withoutComments.matchAll(/(--doc-[\w-]+)\s*:/g)) {
      declaredAnywhere.add(match[1]!);
      if (!inAnyRange(match.index!, ranges)) declaredOutsideDark.add(match[1]!);
    }
    const darkOnly = [...declaredAnywhere].filter((t) => !declaredOutsideDark.has(t)).sort();
    expect(darkOnly).toEqual([]);
  });

  test('the caret rule paints a colour rather than relying on a default', () => {
    const rule = /\.docx-editor-one-surface__caret\s*\{([^}]*)\}/.exec(withoutComments);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/background:\s*var\(--doc-caret/);
    // 1.5px, not 1: a hairline caret is a single device pixel on a high-DPI screen and
    // reads as a rendering artefact rather than a cursor. Not 2: with the contrast
    // ring the caret read as a slab that overlapped neighbouring glyphs.
    expect(rule![1]).toMatch(/width:\s*1\.5px/);
  });

  test('the painted image rule applies EXIF orientation rather than the browser default', () => {
    // The resource extent is the EXIF-oriented one; a browser that ignores EXIF would
    // paint a portrait photo sideways inside a portrait frame.
    const rule = /\.docx-drawing-image\s*\{([^}]*)\}/.exec(withoutComments);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/image-orientation:\s*from-image/);
  });
});
