// Tracked changes as the reader sees them.
//
// Reaching layout was the correctness fix; this is the part that makes the difference visible.
// A reviewer looking at a document where an insertion and a deletion both render as plain text
// is reading a third document that exists nowhere — which is the same failure as dropping the
// content, one step later.

import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { paintSemanticLayout, paintSemanticLayoutWithAuthorSlots } from '../semantic-paint.ts';
import {
  authorSlotsOf,
  revisionPresentationOf,
  type RevisionStyles,
} from '../revision-presentation.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const delRun = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;
const ins = (id: string, inner: string, author = 'QA') =>
  `<w:ins w:id="${id}" w:author="${author}" w:date="2026-03-26T11:00:00Z">${inner}</w:ins>`;
const del = (id: string, inner: string, author = 'Dev') =>
  `<w:del w:id="${id}" w:author="${author}" w:date="2026-03-26T11:00:00Z">${inner}</w:del>`;

function paintWithLayout(
  body: string,
  scale = 1,
  revisionStyles?: RevisionStyles
): { root: HTMLElement; layout: ReturnType<typeof layoutSemanticDocument> } {
  const layout = layoutSemanticDocument(load(body), 1, { measurer });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, {
    scale,
    ariaHidden: false,
    ...(revisionStyles !== undefined ? { revisionStyles } : {}),
  });
  return { root: container, layout };
}

function paint(body: string, revisionStyles?: RevisionStyles): HTMLElement {
  return paintWithLayout(body, 1, revisionStyles).root;
}

function trackedSpans(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('.docx-revision')];
}

describe('the reader can see which text is tracked', () => {
  test('an insertion uses the configurable thin Word-like underline', () => {
    const root = paint(`<w:p>${run('keep ')}${ins('1', run('added'))}</w:p>`);
    const spans = trackedSpans(root);
    expect(spans.length).toBeGreaterThan(0);
    const span = spans[0]!;
    expect(span.textContent).toBe('added');
    expect(span.style.textDecorationLine).toBe('underline');
    expect(span.style.textDecorationStyle).toBe('var(--doc-revision-insertion-decoration-style)');
    expect(span.style.textDecorationThickness).toBe(
      'var(--doc-revision-insertion-decoration-thickness)'
    );
    expect(span.style.textUnderlineOffset).toBe('var(--doc-revision-insertion-underline-offset)');
    // Coloured by AUTHOR by default, as Word does — the decoration is what says "added".
    expect(span.style.color).toBe('var(--doc-review-author-0)');
  });

  test('a deletion is struck through', () => {
    const root = paint(`<w:p>${run('keep ')}${del('2', delRun('gone'))}</w:p>`);
    const span = trackedSpans(root)[0]!;
    expect(span.textContent).toBe('gone');
    expect(span.style.textDecorationLine).toBe('line-through');
  });

  test('untracked text carries no revision styling at all', () => {
    const root = paint(`<w:p>${run('plain text')}</w:p>`);
    expect(trackedSpans(root)).toHaveLength(0);
  });

  test('a move reads apart from an ordinary delete/insert pair', () => {
    // Both halves of a move are one decision. Drawing them as a plain deletion and insertion
    // invites resolving one without the other, which duplicates or loses the content.
    const root = paint(
      '<w:p><w:moveFrom w:id="1" w:author="QA" w:date="D">' +
        `${delRun('here')}</w:moveFrom>` +
        '<w:moveTo w:id="2" w:author="QA" w:date="D">' +
        `${run('there')}</w:moveTo></w:p>`
    );
    const spans = trackedSpans(root);
    expect(spans.map((span) => span.style.textDecorationStyle)).toEqual(['double', 'double']);
    expect(spans.map((span) => span.dataset.revisionKind)).toEqual(['moveFrom', 'moveTo']);
  });

  test('opting out of author colours leaves the two a reader tells apart', () => {
    // `'kind'` is the opt-out: scanning a page, "added" versus "removed" becomes the
    // distinction that survives a glance, whoever proposed either.
    const root = paint(`<w:p>${ins('1', run('added'))}${del('2', delRun('gone'))}</w:p>`, 'kind');
    const spans = trackedSpans(root);
    expect(spans.map((span) => span.style.color)).toEqual([
      'var(--doc-revision-insertion)',
      'var(--doc-revision-deletion)',
    ]);
  });

  test('two authors still get distinct slots for a surface that colours by person', () => {
    const layout = layoutSemanticDocument(
      load(`<w:p>${ins('1', run('mine'), 'Ada')}${ins('2', run('theirs'), 'Grace')}</w:p>`),
      1,
      { measurer }
    );
    const slots = authorSlotsOf(layout);
    expect(slots.get('Ada')).not.toBe(slots.get('Grace'));
  });

  test('the same author is the same colour wherever they appear', () => {
    // One slot map for the whole document, so an author does not change colour between pages
    // or between an incremental repaint and a full one.
    const layout = layoutSemanticDocument(
      load(
        `<w:p>${ins('1', run('first'), 'Ada')}</w:p>` +
          `<w:p>${ins('2', run('second'), 'Grace')}</w:p>` +
          `<w:p>${ins('3', run('third'), 'Ada')}</w:p>`
      ),
      1,
      { measurer }
    );
    const slots = authorSlotsOf(layout);
    // Assigned in order of first appearance, which is Word's rule and cannot collide until
    // there are more authors than slots.
    expect(slots.get('Ada')).toBe(0);
    expect(slots.get('Grace')).toBe(1);
  });

  test('a deletion nested in an insertion still reads as removed', () => {
    const presentation = revisionPresentationOf([
      { kind: 'insert', id: '1', author: 'A', nodeId: 'a' },
      { kind: 'delete', id: '2', author: 'B', nodeId: 'b' },
    ]);
    expect(presentation?.line).toBe('line-through');
    expect(presentation?.deleted).toBe(true);
    // The innermost author owns the card and the colour: it is their pending decision.
    expect(presentation?.attribution.author).toBe('B');
  });

  test('the span carries its provenance for the review surface to join on', () => {
    const root = paint(`<w:p>${ins('7', run('added'), 'QA Reviewer')}</w:p>`);
    const span = trackedSpans(root)[0]!;
    expect(span.dataset.revisionId).toBe('7');
    expect(span.dataset.reviewAuthor).toBe('QA Reviewer');
    expect(span.dataset.revisionDate).toBe('2026-03-26T11:00:00Z');
  });
});

describe('colouring by author', () => {
  test("'author' draws each change in its author's slot; the decoration still says the kind", () => {
    const root = paint(
      `<w:p>${ins('1', run('added'), 'Ada')}${del('2', delRun('gone'), 'Grace')}</w:p>`,
      'author'
    );
    const spans = trackedSpans(root);
    expect(spans.map((span) => span.style.color)).toEqual([
      'var(--doc-review-author-0)',
      'var(--doc-review-author-1)',
    ]);
    // The colour answers "whose"; added-versus-removed still reads from the decoration.
    expect(spans.map((span) => span.style.textDecorationLine)).toEqual([
      'underline',
      'line-through',
    ]);
    expect(spans.map((span) => span.style.textDecorationColor)).toEqual([
      'var(--doc-review-author-0)',
      'var(--doc-review-author-1)',
    ]);
    // The wash keeps the kind pair: the ink answers "whose", the wash keeps the change
    // findable when scanning.
    expect(spans[0]!.style.backgroundColor).toBe('var(--doc-revision-insertion-wash)');
    // The slot rides as a CSS hook, so `[data-review-author-slot='0']` restyles one
    // reviewer's changes beyond the colour.
    expect(spans.map((span) => span.dataset.reviewAuthorSlot)).toEqual(['0', '1']);
  });

  test('the slot hook is absent under kind colouring', () => {
    // Emitted always, a new author appearing would repaint every page in every scheme —
    // the slot map is in the paint-reuse key only under author colouring.
    const root = paint(`<w:p>${ins('1', run('added'), 'Ada')}</w:p>`, 'kind');
    expect(trackedSpans(root)[0]!.dataset.reviewAuthorSlot).toBeUndefined();
  });

  test('assignments are SELECTIVE: a styled author takes their colour, the rest keep the kind colours', () => {
    // "Highlight one reviewer, leave everyone else green/red" — the whole point of the
    // default `others: 'kind'`.
    const root = paint(
      `<w:p>${ins('1', run('added'), 'Ada')}${ins('2', run('more'), 'Grace')}</w:p>`,
      { others: 'kind', authors: { Ada: 'var(--brand-ada)' } }
    );
    const spans = trackedSpans(root);
    expect(spans.map((span) => span.style.color)).toEqual([
      'var(--brand-ada)',
      'var(--doc-revision-insertion)',
    ]);
  });

  test('by default the unstyled rest stay on the ramp, not the kind colours', () => {
    const root = paint(
      `<w:p>${ins('1', run('added'), 'Ada')}${ins('2', run('more'), 'Grace')}</w:p>`,
      { authors: { Ada: 'var(--brand-ada)' } }
    );
    const spans = trackedSpans(root);
    expect(spans.map((span) => span.style.color)).toEqual([
      'var(--brand-ada)',
      'var(--doc-review-author-1)',
    ]);
  });

  test('the innermost author owns the colour of a nested change', () => {
    const root = paint(`<w:p>${ins('1', del('2', delRun('x'), 'Bea'), 'Ada')}</w:p>`, 'author');
    const span = trackedSpans(root)[0]!;
    // Ada appears first in the stack, Bea second — but the pending decision is Bea's.
    expect(span.style.color).toBe('var(--doc-review-author-1)');
    expect(span.style.textDecorationLine).toBe('line-through');
  });

  test('a deleted paragraph mark follows its author too', () => {
    const root = paint(
      `<w:p><w:pPr><w:rPr><w:del w:id="9" w:author="QA" w:date="D"/></w:rPr></w:pPr>` +
        `${run('merges forward')}</w:p>`,
      'author'
    );
    const glyph = root.querySelector<HTMLElement>('.docx-revision-pmark')!;
    expect(glyph.style.color).toBe('var(--doc-review-author-0)');
    expect(glyph.style.textDecorationLine).toBe('line-through');
    expect(glyph.dataset.reviewAuthorSlot).toBe('0');
  });

  test('switching the scheme repaints pages whose own records did not change', () => {
    // The paint-reuse key must carry the scheme and the author→slot map: a page record that
    // is identical across two paints is otherwise reused verbatim, in the old colours.
    const layout = layoutSemanticDocument(load(`<w:p>${ins('1', run('added'), 'Ada')}</w:p>`), 1, {
      measurer,
    });
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1, ariaHidden: false, revisionStyles: 'kind' });
    expect(container.querySelector<HTMLElement>('.docx-revision')!.style.color).toBe(
      'var(--doc-revision-insertion)'
    );
    paintSemanticLayout(container, layout, {
      scale: 1,
      ariaHidden: false,
      revisionStyles: 'author',
    });
    expect(container.querySelector<HTMLElement>('.docx-revision')!.style.color).toBe(
      'var(--doc-review-author-0)'
    );
  });

  test("a style object can restyle one author's ink and wash; the rest keep their defaults", () => {
    const root = paint(
      `<w:p>${ins('1', run('added'), 'Ada')}${ins('2', run('more'), 'Grace')}</w:p>`,
      { authors: { Ada: { color: 'var(--brand-ada)', background: 'var(--brand-ada-wash)' } } }
    );
    const spans = trackedSpans(root);
    expect(spans.map((span) => span.style.color)).toEqual([
      'var(--brand-ada)',
      'var(--doc-review-author-1)',
    ]);
    expect(spans.map((span) => span.style.backgroundColor)).toEqual([
      'var(--brand-ada-wash)',
      'var(--doc-revision-insertion-wash)',
    ]);
  });

  test("host class names land on one author's spans, split on whitespace", () => {
    const root = paint(
      `<w:p>${ins('1', run('added'), 'Ada')}${ins('2', run('more'), 'Grace')}</w:p>`,
      { authors: { Ada: { spanClassName: 'agent-edit  ring' } } }
    );
    const spans = trackedSpans(root);
    expect(spans[0]!.classList.contains('agent-edit')).toBe(true);
    expect(spans[0]!.classList.contains('ring')).toBe(true);
    expect(spans[1]!.classList.contains('agent-edit')).toBe(false);
  });

  test('a declaration that names no colour leaves the ink alone', () => {
    // "Give this reviewer an avatar" must not recolour their text. Only `color` moves the
    // ink; the other fields say nothing about it. Pinned against `others: 'kind'`, which
    // is where the wrong answer was visible.
    const avatarOnly = paint(`<w:p>${ins('1', run('added'), 'Ada')}</w:p>`, {
      others: 'kind',
      authors: { Ada: { avatarUrl: '/ada.png' } },
    });
    expect(trackedSpans(avatarOnly)[0]!.style.color).toBe('var(--doc-revision-insertion)');

    const classOnly = paint(`<w:p>${ins('1', run('added'), 'Ada')}</w:p>`, {
      others: 'kind',
      authors: { Ada: { spanClassName: 'agent-edit' } },
    });
    const span = trackedSpans(classOnly)[0]!;
    expect(span.style.color).toBe('var(--doc-revision-insertion)');
    // …but the class still lands, which is the whole point of declaring it.
    expect(span.classList.contains('agent-edit')).toBe(true);
  });

  test('an author whose only change is a paragraph mark gets their own slot, not slot 0', () => {
    // The roster reads every list a revision can appear in. Missing one does not leave its
    // author uncoloured — it silently hands them the first author's colour. A paragraph
    // mark is the case with no span of its own to be found through.
    const marks = authorSlotsOf(
      layoutSemanticDocument(
        load(
          `<w:p>${ins('1', run('body'), 'Ada')}</w:p>` +
            `<w:p><w:pPr><w:rPr><w:del w:id="9" w:author="Bea" w:date="D"/></w:rPr></w:pPr>` +
            `${run('merges')}</w:p>`
        ),
        1,
        { measurer }
      )
    );
    expect(marks.get('Ada')).toBe(0);
    expect(marks.get('Bea')).toBe(1);
  });

  test('slots follow reading order: a paragraph mark comes after the text beside it', () => {
    // The pilcrow paints at the END of the last line, so the author who only pressed Enter
    // is met AFTER the author of the words. Reading the mark first gave them the lower
    // slot, shifting everyone's colour and the roster a legend is built from.
    const slots = authorSlotsOf(
      layoutSemanticDocument(
        load(
          `<w:p><w:pPr><w:rPr><w:ins w:id="9" w:author="Bea" w:date="D"/></w:rPr></w:pPr>` +
            `${ins('1', run('added'), 'Ada')}</w:p>`
        ),
        1,
        { measurer }
      )
    );
    expect(slots.get('Ada')).toBe(0);
    expect(slots.get('Bea')).toBe(1);
  });

  test('a format revision carries its author hooks and honours a declared colour', () => {
    const body =
      '<w:p><w:r><w:rPr><w:rPrChange w:id="5" w:author="Zed" w:date="D"><w:rPr/>' +
      '</w:rPrChange></w:rPr><w:t>restyled</w:t></w:r></w:p>';
    const root = paint(body, {
      authors: { Zed: { color: 'var(--brand-zed)', spanClassName: 'z' } },
    });
    const span = root.querySelector<HTMLElement>('.docx-revision-format')!;
    expect(span.dataset.reviewAuthor).toBe('Zed');
    // Format revisions are the largest tracked population in a heavily restyled document;
    // a host rule scoped to the author has to reach them too.
    expect(span.dataset.reviewAuthorSlot).toBe('0');
    expect(span.classList.contains('z')).toBe(true);
    expect(span.style.color).toBe('var(--brand-zed)');
  });

  test("an unstyled author's pilcrow stays kind-coloured under selective assignments", () => {
    const root = paint(
      `<w:p><w:pPr><w:rPr><w:del w:id="9" w:author="QA" w:date="D"/></w:rPr></w:pPr>` +
        `${run('merges forward')}</w:p>`,
      { others: 'kind', authors: { Ada: 'var(--brand-ada)' } }
    );
    const glyph = root.querySelector<HTMLElement>('.docx-revision-pmark')!;
    expect(glyph.style.color).toBe('var(--doc-revision-deletion)');
  });

  test("'author' is the default and an explicit 'author' matches it", () => {
    const implicitDefault = paint(`<w:p>${ins('1', run('added'), 'Ada')}</w:p>`);
    const explicit = paint(`<w:p>${ins('1', run('added'), 'Ada')}</w:p>`, 'author');
    expect(implicitDefault.querySelector<HTMLElement>('.docx-revision')!.style.color).toBe(
      trackedSpans(explicit)[0]!.style.color
    );
    expect(trackedSpans(explicit)[0]!.style.color).toBe('var(--doc-review-author-0)');
  });
});

describe('change bars', () => {
  // The painted overlay is one per SHEET, in Word's column: half the left margin in from
  // the page edge, whatever the paragraph's indent.
  const bars = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.docx-change-bar')];
  const sheetTop = (layout: ReturnType<typeof layoutSemanticDocument>) => {
    const page = layout.pages[0]!;
    return page.contentBox.y - page.box.y;
  };
  const fragments = (layout: ReturnType<typeof layoutSemanticDocument>) =>
    layout.pages[0]!.fragments.filter((block) => block.kind === 'paragraph');

  test('a line carrying a revision gets a margin rule', () => {
    const root = paint(`<w:p>${run('before ')}${ins('1', run('added'))}</w:p>`);
    expect(bars(root)).toHaveLength(1);
  });

  test('contiguous tracked lines merge into ONE rule, not one per line', () => {
    // Drawn per line, a multi-line edit reads as a dashed rule with a gap at every line
    // boundary, implying the change stops and restarts.
    const long = 'word '.repeat(60);
    const root = paint(`<w:p>${ins('1', run(long))}</w:p>`);
    const lines = root.querySelectorAll('.layout-line').length;
    expect(lines).toBeGreaterThan(1);
    expect(bars(root)).toHaveLength(1);
  });

  test('adjacent changed paragraphs draw one unbroken rule across the boundary', () => {
    // Word's rule owns each changed line's whole pitch, spacing after included, so two
    // changed paragraphs in a row are one mark. Two short bars with a gap between them read
    // as two separate edits.
    const { root, layout } = paintWithLayout(
      `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr>${ins('1', run('first'))}</w:p>` +
        `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr>${ins('2', run('second'))}</w:p>`
    );
    const [first, second] = fragments(layout);
    expect(second!.box.y).toBeGreaterThan(first!.box.y + first!.box.height - 0.01);
    const rules = bars(root);
    expect(rules).toHaveLength(1);
    expect(parseFloat(rules[0]!.style.top)).toBeCloseTo(sheetTop(layout) + first!.box.y, 3);
    expect(parseFloat(rules[0]!.style.height)).toBeCloseTo(
      first!.box.height + second!.box.height,
      3
    );
  });

  test('an untouched paragraph between two changes keeps them apart', () => {
    const root = paint(
      `<w:p>${ins('1', run('first'))}</w:p>` +
        `<w:p>${run('nothing tracked here')}</w:p>` +
        `<w:p>${ins('2', run('third'))}</w:p>`
    );
    expect(bars(root)).toHaveLength(2);
  });

  test("the rule covers the paragraph's spacing before and after, as Word's does", () => {
    const { root, layout } = paintWithLayout(
      `<w:p>${run('plain')}</w:p>` +
        `<w:p><w:pPr><w:spacing w:before="480" w:after="480"/></w:pPr>${ins('1', run('spaced'))}</w:p>` +
        `<w:p>${run('plain')}</w:p>`
    );
    const spaced = fragments(layout)[1]!;
    expect(spaced.box.height).toBeGreaterThan(spaced.lines[0]!.box.height + 30);
    const rule = bars(root)[0]!;
    expect(parseFloat(rule.style.top)).toBeCloseTo(sheetTop(layout) + spaced.box.y, 3);
    expect(parseFloat(rule.style.height)).toBeCloseTo(spaced.box.height, 3);
  });

  test('a change on one middle line marks that line only, to the next line top', () => {
    const filler = 'word '.repeat(30);
    const { root, layout } = paintWithLayout(
      `<w:p>${run(filler)}${ins('1', run('changed'))}${run(filler)}</w:p>`
    );
    const fragment = fragments(layout)[0]!;
    const changed = fragment.lines.findIndex((line) =>
      line.spans.some((span) => span.revisions?.length)
    );
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(fragment.lines.length - 1);
    const rule = bars(root)[0]!;
    const line = fragment.lines[changed]!;
    const next = fragment.lines[changed + 1]!;
    expect(parseFloat(rule.style.top)).toBeCloseTo(sheetTop(layout) + line.box.y, 3);
    expect(parseFloat(rule.style.height)).toBeCloseTo(next.box.y - line.box.y, 3);
  });

  test('the rule says what happened, not just that something did', () => {
    const inserted = paint(`<w:p>${ins('1', run('added'))}</w:p>`);
    const deleted = paint(`<w:p>${del('2', delRun('gone'))}</w:p>`);
    expect(bars(inserted)[0]!.className).toContain('docx-change-bar-insertion');
    expect(bars(inserted)[0]!.className).not.toContain('deletion');
    expect(bars(deleted)[0]!.className).toContain('docx-change-bar-deletion');
    expect(bars(deleted)[0]!.className).not.toContain('insertion');
    // One rule over a replacement carries both claims.
    const both = paint(`<w:p>${del('2', delRun('gone'))}${ins('1', run('added'))}</w:p>`);
    expect(bars(both)).toHaveLength(1);
    expect(bars(both)[0]!.className).toContain('docx-change-bar-insertion');
    expect(bars(both)[0]!.className).toContain('docx-change-bar-deletion');
  });

  test('a formatting-only change gets a rule too, marked as format', () => {
    const root = paint(
      `<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="3" w:author="QA" w:date="D"><w:rPr/></w:rPrChange></w:rPr>` +
        `<w:t>bold now</w:t></w:r></w:p>`
    );
    expect(bars(root)).toHaveLength(1);
    expect(bars(root)[0]!.className).toContain('docx-change-bar-format');
    expect(bars(root)[0]!.className).not.toContain('insertion');
  });

  test('a tracked paragraph-property change gets a rule, marked as format', () => {
    // Exactly what Suggesting mode writes for an alignment change: the revision lives in
    // the paragraph's own properties, not on any run or on the mark.
    const root = paint(
      '<w:p><w:pPr><w:jc w:val="center"/>' +
        '<w:pPrChange w:id="4" w:author="QA" w:date="D"><w:pPr/></w:pPrChange></w:pPr>' +
        `${run('centered now')}</w:p>`
    );
    expect(bars(root)).toHaveLength(1);
    expect(bars(root)[0]!.className).toContain('docx-change-bar-format');
  });

  test('the rule stops at the content box when the last paragraph overhangs it', () => {
    // A page-final paragraph keeps its spacing after in its box even when that spacing runs
    // past the content bottom; Word's rule stops at the text, not in the bottom margin.
    const fillers = `<w:p>${run('filler')}</w:p>`.repeat(46);
    const { root, layout } = paintWithLayout(
      fillers +
        `<w:p><w:pPr><w:spacing w:after="2400"/></w:pPr>${ins('1', run('tracked last'))}</w:p>`
    );
    const page = layout.pages[0]!;
    const tracked = fragments(layout)[fragments(layout).length - 1]!;
    expect(layout.pages).toHaveLength(1);
    const contentBottom = page.contentBox.y - page.box.y + page.contentBox.height;
    expect(tracked.box.y + tracked.box.height).toBeGreaterThan(page.contentBox.height + 0.01);
    const rule = bars(root)[0]!;
    const bottom = parseFloat(rule.style.top) + parseFloat(rule.style.height);
    expect(bottom).toBeLessThanOrEqual(contentBottom + 0.01);
    const lastLine = tracked.lines[tracked.lines.length - 1]!;
    expect(bottom).toBeGreaterThanOrEqual(
      sheetTop(layout) + lastLine.box.y + lastLine.box.height - 0.01
    );
  });

  test('a merge join at a page break is one Simple Markup site, on the line that holds it', () => {
    // Merged lines are remapped once per FRAGMENT: a removed paragraph mark whose join offset
    // sits exactly at a page break used to be claimed by the last line of one page and the
    // first line of the next. The join belongs to the line whose extent holds it.
    const geometry = {
      width: 200,
      height: 60,
      margin: { top: 10, right: 10, bottom: 10, left: 10 },
    };
    const body =
      `<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="QA" w:date="D"/></w:rPr></w:pPr>` +
      `${run('one')}<w:r><w:br/></w:r>${run('two')}<w:r><w:br/></w:r>${run('three')}` +
      `<w:r><w:br/></w:r></w:p>` +
      `<w:p>${run('four')}</w:p>`;
    const layout = layoutSemanticDocument(load(body), 1, {
      measurer,
      geometry,
      displayMode: 'proposed',
    });
    // Three lines fit a page: the survivor's own line — and the join before it — opens page two.
    expect(layout.pages).toHaveLength(2);
    const sites = layout.pages.flatMap((page) =>
      page.fragments.flatMap((block) =>
        block.kind === 'paragraph'
          ? block.lines.flatMap((line) => (line.changeSites ?? []).map((site) => site.id))
          : []
      )
    );
    expect(sites).toEqual(['1']);
  });

  test('a clean line gets none', () => {
    const root = paint(`<w:p>${run('nothing tracked here')}</w:p>`);
    expect(bars(root)).toHaveLength(0);
    expect(root.querySelector('.docx-change-bars')).toBeNull();
  });

  test('the ink is the neutral change-bar token, never the revision colour', () => {
    // Word's All Markup paints the rule grey whatever the change was; the coloured text
    // already says what happened. A red rule beside a deletion and a green one beside an
    // insertion is the look of no mode Word has.
    const root = paint(`<w:p>${del('2', delRun('gone'))}${ins('1', run('added'))}</w:p>`);
    const rule = bars(root)[0]!;
    expect(rule.style.backgroundColor).toBe('var(--doc-review-change-bar)');
    expect(rule.style.width).toBe('var(--doc-review-change-bar-width)');
  });

  test('the bar stands in the left margin, halfway in, whatever the indent', () => {
    // A bar offset from the paragraph's own box lands at a different x for every indent
    // level, so a nested list draws a staircase instead of a column.
    const { root, layout } = paintWithLayout(
      `<w:p>${ins('1', run('flush'))}</w:p>` +
        `<w:p>${run('plain')}</w:p>` +
        `<w:p><w:pPr><w:ind w:left="1440"/></w:pPr>${ins('2', run('indented'))}</w:p>`
    );
    const page = layout.pages[0]!;
    const margin = page.contentBox.x - page.box.x;
    expect(margin).toBeGreaterThan(0);
    const rules = bars(root);
    expect(rules).toHaveLength(2);
    for (const rule of rules) expect(parseFloat(rule.style.left)).toBe(Math.round(margin / 2));
  });

  test('geometry follows the zoom', () => {
    const body = `<w:p>${ins('1', run('added'))}</w:p>`;
    const one = paintWithLayout(body, 1);
    const two = paintWithLayout(body, 2);
    const a = bars(one.root)[0]!;
    const b = bars(two.root)[0]!;
    expect(parseFloat(b.style.left)).toBeCloseTo(parseFloat(a.style.left) * 2, 0);
    expect(parseFloat(b.style.top)).toBeCloseTo(parseFloat(a.style.top) * 2, 3);
    expect(parseFloat(b.style.height)).toBeCloseTo(parseFloat(a.style.height) * 2, 3);
    // A hairline at every zoom, as Word draws it: the width is the token, unscaled.
    expect(b.style.width).toBe('var(--doc-review-change-bar-width)');
  });

  test('the bar is furniture on the sheet: no model range, inert, hidden from AT', () => {
    const root = paint(`<w:p>${ins('1', run('added'))}</w:p>`);
    const overlay = root.querySelector<HTMLElement>('.docx-change-bars')!;
    expect(overlay.parentElement!.classList.contains('docx-page')).toBe(true);
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.getAttribute('contenteditable')).toBe('false');
    expect(overlay.style.pointerEvents).toBe('none');
    const bar = bars(root)[0]!;
    expect(bar.dataset.paragraphId).toBeUndefined();
    expect(bar.textContent).toBe('');
    expect(bar.closest('.docx-page-content')).toBeNull();
  });

  test('a repaint that adopts the sheet rebuilds the rules for the new blocks', () => {
    // The overlay is per page, not per block, so the block-adoption path — same sheet
    // record, different fragments, same paint parameters — must replace it, or the margin
    // keeps describing the previous revision. The author slot map is pinned as a surface
    // pins its session map: a derived one would move with the authors and rebuild the sheet.
    const container = document.createElement('div');
    const slots = new Map([
      ['QA', 0],
      ['Dev', 1],
    ]);
    const repaint = (layout: ReturnType<typeof layoutSemanticDocument>) =>
      paintSemanticLayoutWithAuthorSlots(container, layout, { scale: 1, ariaHidden: false }, slots);
    const before = layoutSemanticDocument(
      load(`<w:p>${ins('1', run('added'))}</w:p><w:p>${run('plain')}</w:p>`),
      1,
      { measurer }
    );
    repaint(before);
    const sheet = container.querySelector('.docx-page')!;
    expect(bars(container)).toHaveLength(1);
    const adopting = (body: string, revision: number) => {
      const next = layoutSemanticDocument(load(body), revision, { measurer });
      const page = { ...before.pages[0]!, fragments: next.pages[0]!.fragments };
      return { ...before, revision, pages: [page] };
    };
    repaint(adopting(`<w:p>${run('plain')}</w:p>`, 2));
    expect(container.querySelector('.docx-page') === sheet).toBe(true);
    expect(bars(container)).toHaveLength(0);
    repaint(adopting(`<w:p>${run('plain')}</w:p><w:p>${del('2', delRun('gone'))}</w:p>`, 3));
    expect(container.querySelector('.docx-page') === sheet).toBe(true);
    expect(bars(container)).toHaveLength(1);
    expect(bars(container)[0]!.className).toContain('deletion');
    // A keystroke that leaves the rules where they are leaves the overlay alone.
    const overlay = container.querySelector('.docx-change-bars');
    repaint(adopting(`<w:p>${run('plain typed')}</w:p><w:p>${del('2', delRun('gone'))}</w:p>`, 4));
    expect(container.querySelector('.docx-change-bars') === overlay).toBe(true);
    // And the overlay stays the sheet's LAST child, as a fresh paint leaves it.
    expect(sheet.lastElementChild === overlay).toBe(true);
  });
});

describe('changes that decorate no characters', () => {
  const mark = (kind: 'ins' | 'del', text: string) =>
    `<w:p><w:pPr><w:rPr><w:${kind} w:id="9" w:author="QA" w:date="D"/></w:rPr></w:pPr>` +
    `${run(text)}</w:p>`;
  /** These pin the KIND colours a pilcrow takes, so they opt out of author colouring. */
  const paintKind = (body: string) => paint(body, 'kind');

  test('a deleted paragraph mark draws a struck pilcrow', () => {
    // The change is to the paragraph BREAK, so no character carries it. Without the glyph a
    // reader has no way to see that this paragraph is being merged into the next one.
    const root = paintKind(mark('del', 'merges forward'));
    const glyph = root.querySelector<HTMLElement>('.docx-revision-pmark')!;
    expect(glyph.textContent).toBe('¶');
    expect(glyph.style.textDecorationLine).toBe('line-through');
    expect(glyph.style.color).toBe('var(--doc-revision-deletion)');
  });

  test('an inserted paragraph mark draws one in the insertion colour', () => {
    const root = paintKind(mark('ins', 'splits here'));
    const glyph = root.querySelector<HTMLElement>('.docx-revision-pmark')!;
    expect(glyph.style.color).toBe('var(--doc-revision-insertion)');
    expect(glyph.style.textDecorationLine).toBe('');
  });

  test('a clean paragraph draws none', () => {
    expect(
      paint(`<w:p>${run('untouched')}</w:p>`).querySelectorAll('.docx-revision-pmark')
    ).toHaveLength(0);
  });

  test('a mark carrying both decisions draws ONE pilcrow, and it reads as deleted', () => {
    // `EG_ParaRPrTrackChanges` is `ins? del? …`, and both halves are what Word writes when a
    // second author proposes removing a break the first proposed adding. There is still one
    // pilcrow — a second glyph beside it would read as a second paragraph break — and the
    // deletion takes the face, because that is where the pair lands if every decision is
    // accepted. Both ids stay on the element so review chrome can offer both.
    const root = paint(
      '<w:p><w:pPr><w:rPr><w:ins w:id="7" w:author="A"/><w:del w:id="8" w:author="B"/></w:rPr>' +
        `</w:pPr>${run('proposed, then unproposed')}</w:p>`
    );
    const glyphs = root.querySelectorAll<HTMLElement>('.docx-revision-pmark');
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]!.dataset.revisionKind).toBe('delete');
    expect(glyphs[0]!.dataset.reviewAuthor).toBe('B');
    expect(glyphs[0]!.dataset.revisionIds).toBe('7 8');
  });

  test('a moved-away mark reads as a removal, like the deletion it becomes', () => {
    // `w:moveFrom` on the mark says this copy of the break goes away when the move is
    // accepted. The change bar already counts `moveFrom` as a removal, so a glyph that drew
    // it in the insertion colour put a blue pilcrow beside a red rule.
    const root = paintKind(
      '<w:p><w:pPr><w:rPr><w:moveFrom w:id="4" w:author="A"/></w:rPr></w:pPr>' +
        `${run('moved away')}</w:p>`
    );
    const glyph = root.querySelector<HTMLElement>('.docx-revision-pmark')!;
    expect(glyph.style.color).toBe('var(--doc-revision-deletion)');
    expect(glyph.style.textDecorationLine).toBe('line-through');
    expect(root.querySelector<HTMLElement>('.docx-change-bar')!.className).toContain(
      'docx-change-bar-deletion'
    );
  });

  test('a mark-only change still rules the margin beside its line', () => {
    // The bar is the only signal a reader scanning the margin has. Built from spans alone, a
    // paragraph whose sole change is its own break — a split or a merge, the most ordinary
    // tracked edit there is — announced itself with a coloured ¶ and nothing else.
    const root = paintKind(mark('del', 'merges forward'));
    const bars = root.querySelectorAll<HTMLElement>('.docx-change-bar');
    expect(bars).toHaveLength(1);
    expect(bars[0]!.className).toContain('docx-change-bar-deletion');
  });

  test('the pilcrow is furniture, not text', () => {
    const glyph = paint(mark('del', 'x')).querySelector<HTMLElement>('.docx-revision-pmark')!;
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
    expect(glyph.contentEditable).toBe('false');
    expect(glyph.dataset.paragraphId).toBeUndefined();
  });

  test('a tracked format change carries its provenance and NO inline mark', () => {
    // At the density real documents reach — 18,284 in the main tracked fixture — a rule under
    // every reformatted run draws a dotted line beneath nearly every line on the page, and it
    // competes with the insertions and deletions that are the decisions a reviewer must make.
    // The attributes stay so the review surface can list it and highlight its range on demand,
    // which is where Word puts it too: a "Formatted:" note rather than a mark on the words.
    const root = paint(
      `<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="3" w:author="QA" w:date="D">` +
        `<w:rPr/></w:rPrChange></w:rPr><w:t>reformatted</w:t></w:r></w:p>`
    );
    const span = root.querySelector<HTMLElement>('.docx-revision-format')!;
    expect(span.textContent).toBe('reformatted');
    expect(span.style.textDecorationLine).toBe('');
    expect(span.style.backgroundColor).toBe('');
    expect(span.dataset.revisionKind).toBe('format');
    expect(span.dataset.reviewAuthor).toBe('QA');
  });
});

describe('tracked text is findable when scanning, not only when reading', () => {
  test('an insertion and a deletion each carry a tint', () => {
    // A hairline decoration disappears on a dense page of small type, and a reviewer skims
    // straight past the edit.
    //
    // The WASH, which is the pending end of the ramp. This layer covers every tracked change
    // in the document; the band layer adds the full tint over the one the caret is in. Painting
    // the full tint here made pending and open changes the same weight.
    const root = paint(`<w:p>${ins('1', run('added'))}${del('2', delRun('gone'))}</w:p>`);
    const spans = trackedSpans(root);
    expect(spans.map((span) => span.style.backgroundColor)).toEqual([
      'var(--doc-revision-insertion-wash)',
      'var(--doc-revision-deletion-wash)',
    ]);
  });

  test('untracked text keeps no background of its own', () => {
    const root = paint(`<w:p>${run('plain')}</w:p>`);
    const spans = [...root.querySelectorAll<HTMLElement>('.layout-run-text')];
    expect(spans.every((span) => span.style.backgroundColor === '')).toBe(true);
  });
});
