// A span that repeats a model range: the browser's copy in the same line, or a repeat paint made.
//
// Chromium, composing over a selection set in another face than the text on both sides of it,
// writes the composed text into a copy of an adjacent span, range attributes included, beside
// the original. The readback read each model range once, so it dropped that text. Only the
// composition-start snapshot can tell that copy from a range paint itself repeats.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import {
  compositionSpanChanges,
  paintedTextIn,
  snapshotPaintedSpans,
} from '../surface-composition-readback.ts';

type Span = readonly [text: string, start: number, end: number, field?: 'field'];

function paintSpan(text: string, start: number, end: number, field?: 'field'): HTMLElement {
  const span = document.createElement('span');
  span.dataset.paragraphId = 'p1';
  span.dataset.start = String(start);
  span.dataset.end = String(end);
  if (field) span.dataset.docxField = '';
  span.textContent = text;
  return span;
}

/** One fragment of one line of spans, as the painter stamps them. */
function paintFragment(spans: readonly Span[], index = 0): HTMLElement {
  const fragment = document.createElement('div');
  fragment.className = 'docx-paragraph-fragment';
  fragment.dataset.paragraphId = 'p1';
  fragment.dataset.fragmentIndex = String(index);
  const line = document.createElement('div');
  line.className = 'docx-line';
  line.dataset.paragraphId = 'p1';
  for (const [text, start, end, field] of spans) line.append(paintSpan(text, start, end, field));
  fragment.append(line);
  return fragment;
}

const mounted: HTMLElement[] = [];
afterEach(() => mounted.splice(0).forEach((root) => root.remove()));

/** Mounted: a span counts as erased only while its fragment is still on the page. */
function painted(...fragments: readonly (readonly Span[])[]): HTMLElement {
  const root = document.createElement('div');
  fragments.forEach((spans, index) => root.append(paintFragment(spans, index)));
  document.body.append(root);
  mounted.push(root);
  return root;
}

const spanAt = (root: HTMLElement, start: number): HTMLElement =>
  [...root.querySelectorAll<HTMLElement>('[data-start]')].find(
    (span) => span.dataset.start === String(start)
  )!;

/** What Chromium does: remove the selected spans, then write into a copy of `source`. */
function composeIntoCopy(
  root: HTMLElement,
  erasedStarts: readonly number[],
  sourceStart: number,
  text: string,
  side: 'before' | 'after'
): void {
  for (const start of erasedStarts) spanAt(root, start).remove();
  const source = spanAt(root, sourceStart);
  const copy = source.cloneNode(false) as HTMLElement;
  const face = document.createElement('font');
  face.textContent = text;
  copy.append(face);
  if (side === 'before') source.after(copy);
  else source.before(copy);
}

const MODEL = '시험번호GMEB-26202의';
const SELECTED: readonly Span[] = [
  ['시험번호', 0, 4],
  ['GMEB-', 4, 9],
  ['26202', 9, 14],
  ['의', 14, 15],
];

test("text in the browser's copy of the span before reads after that span", () => {
  const root = painted(SELECTED);
  const snapshot = snapshotPaintedSpans(root, 'p1');
  composeIntoCopy(root, [4, 9], 0, '한', 'before');
  const changes = compositionSpanChanges(snapshot);
  expect([...changes.erased]).toEqual(['4:9', '9:14']);
  expect(paintedTextIn(root, 'p1', MODEL, null, changes)).toBe('시험번호한의');
});

test("text in the browser's copy of the span after reads before that span", () => {
  const root = painted(SELECTED);
  const snapshot = snapshotPaintedSpans(root, 'p1');
  composeIntoCopy(root, [4, 9], 14, '한', 'after');
  expect(paintedTextIn(root, 'p1', MODEL, null, compositionSpanChanges(snapshot))).toBe(
    '시험번호한의'
  );
});

test('a copy whose text matches the span it copied is still read', () => {
  // The DOM alone cannot tell this copy from a repeat: the snapshot can.
  const root = painted([
    ['가나', 0, 2],
    ['AB', 2, 4],
    ['다', 4, 5],
  ]);
  const snapshot = snapshotPaintedSpans(root, 'p1');
  composeIntoCopy(root, [2], 0, '가나', 'before');
  expect(paintedTextIn(root, 'p1', '가나AB다', null, compositionSpanChanges(snapshot))).toBe(
    '가나가나다'
  );
});

test('a copy the browser put outside the link that holds the original is still read', () => {
  const root = painted(SELECTED);
  const link = document.createElement('a');
  const original = spanAt(root, 0);
  original.before(link);
  link.append(original);
  const snapshot = snapshotPaintedSpans(root, 'p1');
  for (const start of [4, 9]) spanAt(root, start).remove();
  const copy = original.cloneNode(false) as HTMLElement;
  copy.textContent = '한';
  link.after(copy);
  expect(paintedTextIn(root, 'p1', MODEL, null, compositionSpanChanges(snapshot))).toBe(
    '시험번호한의'
  );
});

test("a copy of a field span reads as the browser's text, and the field as the model's", () => {
  // The copy comes first in the DOM, so it takes the range until the original gives it back.
  const root = painted([
    ['A', 0, 1],
    ['Page 1', 1, 2, 'field'],
  ]);
  const snapshot = snapshotPaintedSpans(root, 'p1');
  const field = spanAt(root, 1);
  const copy = field.cloneNode(false) as HTMLElement;
  copy.textContent = '한';
  field.before(copy);
  expect(paintedTextIn(root, 'p1', 'AB', null, compositionSpanChanges(snapshot))).toBe('A한B');
});

test('text in a copy lands where the selection was, past unpainted text before it', () => {
  // `HH` is hidden (`w:vanish`): nothing paints 3:5. Read at the copy's own offset, the
  // composed text went in front of it, and the diff rewrote the hidden run as typed text.
  const root = painted([
    ['abc', 0, 3],
    ['XYZ', 5, 8],
    ['def', 8, 11],
  ]);
  const snapshot = snapshotPaintedSpans(root, 'p1');
  composeIntoCopy(root, [5], 0, 'ko', 'before');
  expect(paintedTextIn(root, 'p1', 'abcHHXYZdef', null, compositionSpanChanges(snapshot))).toBe(
    'abcHHkodef'
  );
});

test('a copy of the span after the selection also lands past unpainted text', () => {
  const root = painted([
    ['abc', 0, 3],
    ['XYZ', 5, 8],
    ['def', 8, 11],
  ]);
  const snapshot = snapshotPaintedSpans(root, 'p1');
  composeIntoCopy(root, [5], 8, 'ko', 'after');
  expect(paintedTextIn(root, 'p1', 'abcHHXYZdef', null, compositionSpanChanges(snapshot))).toBe(
    'abcHHkodef'
  );
});

test('a field result cut into words in one line contributes ONCE', () => {
  // Every word of a field result publishes the whole field range, in the same line.
  const root = painted([
    ['A', 0, 1],
    ['Page ', 1, 2, 'field'],
    ['one', 1, 2, 'field'],
  ]);
  const snapshot = snapshotPaintedSpans(root, 'p1');
  spanAt(root, 0).textContent = 'A한';
  expect(paintedTextIn(root, 'p1', 'AB', null, compositionSpanChanges(snapshot))).toBe('A한B');
});

test('a repaint mid-composition is not read as spans the browser added', () => {
  // A collaborator's edit replaces the fragment. Its spans are new, but paint stamped them.
  const root = painted([
    ['Hello', 0, 5],
    ['world', 5, 10],
  ]);
  const snapshot = snapshotPaintedSpans(root, 'p1');
  root.replaceChildren(
    paintFragment([
      ['Hello', 0, 5],
      ['Hel', 0, 5],
      ['world', 5, 10],
    ])
  );
  expect(paintedTextIn(root, 'p1', 'Helloworld', null, compositionSpanChanges(snapshot))).toBe(
    'Helloworld'
  );
});

test('without a composition snapshot, a repeat in the same line contributes ONCE', () => {
  const root = painted([
    ['시험번호', 0, 4],
    ['한', 0, 4],
    ['의', 14, 15],
  ]);
  expect(paintedTextIn(root, 'p1', MODEL, null)).toBe('시험번호GMEB-26202의');
});

test('a range repeated on another sheet contributes ONCE', () => {
  // A repeat on another sheet is the same characters, whatever it shows: reading it as written
  // text put the paragraph in twice.
  const root = painted([['Helxlo', 0, 5]], [['Hello', 0, 5]]);
  const snapshot = snapshotPaintedSpans(root, 'p1');
  expect(paintedTextIn(root, 'p1', 'Hello', null, compositionSpanChanges(snapshot))).toBe('Helxlo');
});
