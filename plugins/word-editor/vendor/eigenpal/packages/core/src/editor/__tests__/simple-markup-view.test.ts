// Simple Markup, as Word offers it: the document reads as the proposed result — no
// underlines, no strikes, no author colour — and a red bar in the margin marks every line a
// change touched. A click on the bar swaps to All Markup and back.
//
// The resolved views (No Markup, Original) must show NEITHER: they promise the document as
// accepting or rejecting everything would leave it, with nothing in the margin.

import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import {
  collectReviewItems as engineCollectReviewItems,
  findNode,
  revisionItemsOf,
} from '@docx-editor.dev/core/store';
import type { EditorModule } from '../../contracts/modules.ts';
import { CHROME_GROUPS, CHROME_MENUS } from '../chrome-controls.ts';
import { commandForSlot } from '../toolbar-commands.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const D = 'w:author="QA" w:date="2026-01-01T00:00:00Z"';
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const ins = (id: string, text: string) => `<w:ins w:id="${id}" ${D}>${run(text)}</w:ins>`;
const del = (id: string, text: string) =>
  `<w:del w:id="${id}" ${D}><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/** The engine's own review derivation, wired as a module (core may not import pro). */
function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'simple-markup', 'proposed', 'original'],
      collectReviewItems: engineCollectReviewItems,
      revisionItemsOfParagraph: (part, paragraphId) => {
        const paragraph = findNode(part, paragraphId);
        if (!paragraph || paragraph.kind !== 'paragraph') return [];
        return revisionItemsOf({
          id: part.id,
          name: part.name,
          contentType: part.contentType,
          root: paragraph,
        });
      },
    },
  };
}

const mounted: { editor: DocxEditorInstance; container: HTMLElement }[] = [];

function mount(body: string): { editor: DocxEditorInstance; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx(body),
    author: 'Grace Hopper',
    modules: [reviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  const entry = { editor, container };
  mounted.push(entry);
  return entry;
}

afterEach(() => {
  for (const { editor, container } of mounted.splice(0)) {
    editor.destroy();
    container.remove();
  }
});

const bars = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.docx-change-bar')];
const paintedSpans = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('.layout-run-text')].map((span) => ({
    text: span.textContent,
    color: span.style.color,
    decoration: span.style.textDecorationLine,
    revision: span.dataset.revisionKind,
  }));

const REDLINE =
  `<w:p>${run('plain ')}${ins('1', 'added')}${del('2', 'gone')}</w:p>` +
  `<w:p>${run('untouched')}</w:p>` +
  `<w:p>${run('Bold ')}<w:r><w:rPr><w:b/><w:rPrChange w:id="3" ${D}><w:rPr/></w:rPrChange></w:rPr><w:t>now</w:t></w:r></w:p>`;

describe('Simple Markup', () => {
  test('reads as the proposed result with a red bar beside every changed line', () => {
    const { editor, container } = mount(REDLINE);
    expect(editor.exec({ type: 'setReviewDisplayMode', mode: 'simple-markup' }).ok).toBe(true);
    expect(editor.snapshot().reviewDisplayMode).toBe('simple-markup');
    expect(editor.isActive({ type: 'setReviewDisplayMode', mode: 'simple-markup' })).toBe(true);
    // The text is the proposal: the deletion is gone, the insertion is plain.
    const spans = paintedSpans(container);
    expect(spans.map((span) => span.text)).toEqual([
      'plain ',
      'added',
      'untouched',
      'Bold ',
      'now',
    ]);
    expect(spans.every((span) => span.color === '' && span.decoration === '')).toBe(true);
    expect(spans.every((span) => span.revision === undefined)).toBe(true);
    // The bars: one for the replacement line, one for the formatting line, none between.
    const rules = bars(container);
    expect(rules).toHaveLength(2);
    expect(rules[0]!.className).toContain('docx-change-bar-insertion');
    expect(rules[0]!.className).toContain('docx-change-bar-deletion');
    expect(rules[1]!.className).toContain('docx-change-bar-format');
    for (const rule of rules) {
      expect(rule.style.backgroundColor).toBe('var(--doc-review-change-bar-simple)');
      expect(rule.style.width).toBe('var(--doc-review-change-bar-simple-width)');
      expect(rule.style.cursor).toBe('pointer');
      expect(rule.style.pointerEvents).toBe('auto');
    }
    expect(
      container.querySelector<HTMLElement>('.docx-change-bars')!.dataset.docxChangeBarsMode
    ).toBe('simple-markup');
  });

  test('All Markup keeps the grey bar and the inline markup', () => {
    const { editor, container } = mount(REDLINE);
    expect(editor.snapshot().reviewDisplayMode).toBe('all-markup');
    const rules = bars(container);
    expect(rules).toHaveLength(2);
    expect(rules[0]!.style.backgroundColor).toBe('var(--doc-review-change-bar)');
    expect(paintedSpans(container).some((span) => span.revision === 'delete')).toBe(true);
  });

  test('the resolved views draw neither markup nor bars', () => {
    const { editor, container } = mount(REDLINE);
    for (const mode of ['proposed', 'original'] as const) {
      expect(editor.exec({ type: 'setReviewDisplayMode', mode }).ok).toBe(true);
      expect(bars(container)).toHaveLength(0);
      const spans = paintedSpans(container);
      expect(spans.every((span) => span.color === '' && span.decoration === '')).toBe(true);
      expect(spans.every((span) => span.revision === undefined)).toBe(true);
    }
    expect(paintedSpans(container).map((span) => span.text)).toContain('gone');
  });

  test("a click on the bar toggles the view both ways, as Word's does", () => {
    const { editor, container } = mount(REDLINE);
    const press = (): void => {
      const bar = bars(container)[0]!;
      const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
      bar.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    };
    const before = editor.snapshot().selection;
    press();
    expect(editor.snapshot().reviewDisplayMode).toBe('simple-markup');
    expect(editor.surface!.revisionDisplayMode()).toBe('simple-markup');
    expect(bars(container)[0]!.style.backgroundColor).toBe('var(--doc-review-change-bar-simple)');
    press();
    expect(editor.snapshot().reviewDisplayMode).toBe('all-markup');
    expect(bars(container)[0]!.style.backgroundColor).toBe('var(--doc-review-change-bar)');
    // The caret never moved to the margin: the press was consumed by the toggle.
    expect(editor.snapshot().selection).toEqual(before);
  });

  test('the layout lays out the proposal while the surface reports the view', () => {
    const { editor } = mount(REDLINE);
    editor.exec({ type: 'setReviewDisplayMode', mode: 'simple-markup' });
    expect(editor.surface!.layout().displayMode).toBe('proposed');
    expect(editor.surface!.revisionDisplayMode()).toBe('simple-markup');
  });

  test('the Review menu and the chrome registry offer Simple Markup', () => {
    expect(commandForSlot('review.simpleMarkup')).toEqual({
      type: 'setReviewDisplayMode',
      mode: 'simple-markup',
    });
    const review = CHROME_GROUPS.find((group) => group.id === 'review')!;
    expect(review.controls.map((control) => control.id)).toEqual(
      expect.arrayContaining(['simpleMarkup', 'allMarkup', 'noMarkup', 'original'])
    );
    const slots = JSON.stringify(CHROME_MENUS);
    // Word's order: Simple Markup first, then All Markup, No Markup, Original.
    expect(slots.indexOf('review.simpleMarkup')).toBeLessThan(slots.indexOf('review.allMarkup'));
    expect(slots.indexOf('review.allMarkup')).toBeLessThan(slots.indexOf('review.noMarkup'));
  });
});
