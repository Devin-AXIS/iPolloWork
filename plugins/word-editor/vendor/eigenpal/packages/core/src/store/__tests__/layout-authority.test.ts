// Layout authority guards (task 7.6).
//
// The rule the architecture rests on: LAYOUT publishes geometry and OUTPUT paints it. If
// output could measure, the DOM would become a second source of geometry, the two would
// drift, and the caret would land where no glyph is. An import graph cannot express that —
// `getBoundingClientRect` needs no import — so this checks for the calls themselves.
//
// Equally, layout must not read or create the DOM: it is the lane that has to run headless,
// and a single `document.createElement` would make it browser-only without anything failing.
// Canvas text measurement is allowed inside the layout lane ONLY through an injected
// TextMeasurer / canvas context — never by mounting elements or reading geometry back.

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { existingLanePath, NESTED_LANE_DIRECTORIES, PACKAGES_ROOT } from './lane-paths.ts';

const REPO = join(PACKAGES_ROOT, '..');

function collectSources(root: string, depth = 0): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    // A lane's tests live inside its source directory since task 10.2; the DOM rule applies
    // to the lane, not to tests that name a DOM API in order to assert it is unused.
    if (entry === '__tests__' || entry === 'test' || entry === 'tests') continue;
    const full = join(root, entry);
    // Do not cross into a nested lane: `core/src` holds every moved lane as a subdirectory,
    // so without this the contracts lane inherits the others' imports.
    if (depth === 0 && NESTED_LANE_DIRECTORIES.has(entry) && !root.endsWith(`/${entry}`)) continue;
    if (statSync(full).isDirectory()) out.push(...collectSources(full, depth + 1));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** Comments explain these rules by naming the very calls they forbid. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Ways to ask the browser how big something is (DOM geometry). */
const DOM_GEOMETRY: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bgetBoundingClientRect\b/, why: 'element geometry read back from the DOM' },
  { pattern: /\bgetClientRects\b/, why: 'element geometry read back from the DOM' },
  { pattern: /\boffset(Width|Height|Top|Left)\b/, why: 'layout read back from the DOM' },
  { pattern: /\bclient(Width|Height)\b/, why: 'layout read back from the DOM' },
  { pattern: /\bscroll(Width|Height)\b/, why: 'layout read back from the DOM' },
  { pattern: /\bgetComputedStyle\b/, why: 'resolved style read back from the DOM' },
  { pattern: /\bcaretRangeFromPoint\b|\bcaretPositionFromPoint\b/, why: 'DOM hit testing' },
];

/**
 * Full remeasurement set for the paint lane: DOM geometry PLUS canvas `measureText`.
 *
 * Paint must never measure. Layout may call `measureText` through an injected canvas
 * TextMeasurer — that is the designed browser measurement path — so the layout scan uses
 * {@link DOM_GEOMETRY} only.
 */
const REMEASUREMENT: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  ...DOM_GEOMETRY,
  { pattern: /\bmeasureText\b/, why: 'canvas text metrics' },
];

/** Ways to create or mount DOM nodes inside a lane that must stay headless. */
const DOM_CREATION: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bcreateElement\b/, why: 'DOM element creation' },
  { pattern: /\bcreateElementNS\b/, why: 'DOM element creation' },
  { pattern: /\bappendChild\b/, why: 'DOM mounting' },
  { pattern: /\.append\s*\(/, why: 'DOM mounting' },
  { pattern: /\binsertBefore\b/, why: 'DOM mounting' },
  { pattern: /\binsertAdjacentElement\b/, why: 'DOM mounting' },
  { pattern: /\breplaceChild\b/, why: 'DOM mounting' },
  { pattern: /\bprepend\s*\(/, why: 'DOM mounting' },
];

/** Ways to build DOM from a string. */
const HTML_FROM_STRING: readonly RegExp[] = [
  /\binnerHTML\b/,
  /\bouterHTML\b/,
  /\binsertAdjacentHTML\b/,
  /document\s*\.\s*write\b/,
];

/** Global DOM host references that make a lane browser-only. */
const DOM_HOST = /\bdocument\s*\.|window\s*\.|\bHTMLElement\b/;

function findAll(source: string, patterns: readonly { pattern: RegExp; why: string }[]): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  for (const entry of patterns) if (entry.pattern.test(code)) found.push(entry.why);
  return [...new Set(found)];
}

describe('semantic layout is the only geometry authority (task 7.6)', () => {
  test('the semantic painter never measures anything back', () => {
    const file = existingLanePath('core/src/output/semantic-paint.ts');
    const offenders = findAll(readFileSync(file, 'utf8'), REMEASUREMENT);
    expect(offenders).toEqual([]);
  });

  test('the entire production layout lane never reads or creates the DOM', () => {
    // Scan every production source — a hard-coded file list lets a new module (e.g.
    // canvas-measurer) mount a probe and escape the guard. Editor/output seams create DOM
    // on purpose; they are outside this lane.
    const layoutRoot = existingLanePath('core/src/layout');
    const files = collectSources(layoutRoot);
    expect(files.length).toBeGreaterThan(4);
    expect(files.some((file) => file.endsWith('canvas-measurer.ts'))).toBe(true);

    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const rel = relative(REPO, file);
      if (DOM_HOST.test(code)) offenders.push(`${rel}: DOM host reference`);
      for (const why of findAll(code, DOM_GEOMETRY)) offenders.push(`${rel}: ${why}`);
      for (const why of findAll(code, DOM_CREATION)) offenders.push(`${rel}: ${why}`);
    }
    expect(offenders).toEqual([]);
  });

  test('no output module builds DOM from an HTML string', () => {
    const offenders: string[] = [];
    for (const file of collectSources(existingLanePath('core/src/output'))) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const pattern of HTML_FROM_STRING) {
        if (pattern.test(code)) offenders.push(`${relative(REPO, file)}: ${pattern.source}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the canonical model lane never reads the DOM either', () => {
    // Store and save must be usable headless and must not acquire a browser dependency by
    // accident; `engine-core` has no DOM lib, but a bare `document.` would still compile in
    // a file that declared its own.
    const offenders: string[] = [];
    for (const file of collectSources(existingLanePath('core/src/store'))) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/\bdocument\s*\.\s*(createElement|querySelector|body)\b/.test(code)) {
        offenders.push(relative(REPO, file));
      }
      if (findAll(code, REMEASUREMENT).length > 0) offenders.push(relative(REPO, file));
    }
    expect(offenders).toEqual([]);
  });

  test('the guard detects geometry, mounting, and creation violations', () => {
    expect(findAll('const r = el.getBoundingClientRect();', DOM_GEOMETRY)).toEqual([
      'element geometry read back from the DOM',
    ]);
    expect(findAll('const w = node.offsetWidth;', DOM_GEOMETRY)).toEqual([
      'layout read back from the DOM',
    ]);
    expect(findAll('ownerDocument.createElement("span");', DOM_CREATION)).toEqual([
      'DOM element creation',
    ]);
    expect(findAll('document.body.append(probe);', DOM_CREATION)).toEqual(['DOM mounting']);
    // A comment naming the call is not a violation.
    expect(findAll('// never call getBoundingClientRect here\nconst x = 1;', DOM_GEOMETRY)).toEqual(
      []
    );
    expect(findAll('// createElement is forbidden\nconst x = 1;', DOM_CREATION)).toEqual([]);
    // Injected canvas measureText is allowed in layout (not in paint's REMEASUREMENT scan).
    expect(findAll('context.measureText(text);', DOM_GEOMETRY)).toEqual([]);
    expect(findAll('context.measureText(text);', REMEASUREMENT)).toEqual(['canvas text metrics']);
    // And the corpus is real. The output lane shrank to the semantic painter + barrel when
    // the legacy DOM/PDF/reading-order backends were deleted (phase-4 sweep).
    expect(collectSources(existingLanePath('core/src/output')).length).toBeGreaterThan(1);
    expect(collectSources(existingLanePath('core/src/layout')).length).toBeGreaterThan(4);
  });

  test('the ADAPTER and editor seams may still measure, so the guard is not vacuous', () => {
    // React/Vue and the editor composition root legitimately read viewport geometry or
    // create canvas contexts. If they were clean too, these tests would pass because
    // measurement had been removed everywhere rather than confined to where it belongs.
    const adapters = [
      ...collectSources(existingLanePath('react/src')),
      ...collectSources(existingLanePath('core/src/editor')),
    ];
    const measuring = adapters.filter(
      (file) => findAll(readFileSync(file, 'utf8'), REMEASUREMENT).length > 0
    );
    const creating = adapters.filter(
      (file) => findAll(readFileSync(file, 'utf8'), DOM_CREATION).length > 0
    );
    expect(measuring.length + creating.length).toBeGreaterThan(0);
  });
});
