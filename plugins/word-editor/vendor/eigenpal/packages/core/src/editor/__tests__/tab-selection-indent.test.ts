// Tab and Shift+Tab over a selection outside a list.
//
// A selection over paragraphs, or from a paragraph start, changes the indent and keeps the
// text. A selection that starts inside the text, and a caret, still type a tab character.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { PaginatedSurface } from '../paginated-surface.ts';
import { createKeyDownHandler } from '../surface-input.ts';
import { directParagraphProperties } from '../surface-formatting.ts';
import {
  INDENT_STEP_TWIPS,
  nextGridIndent,
  nextLeftIndent,
  tabIndentFor,
} from '../surface-indent-step.ts';
import { MAX_PARAGRAPH_INDENT_TWIPS } from '../../layout/paragraph-indent.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { placeholderSelectionRange } from '../surface-atomic-controls.ts';
import {
  mount as mountFixture,
  selectCellRectangle,
  trackedDocx,
} from './paginated-surface-fixtures.ts';

const mounted: PaginatedSurface[] = [];
afterEach(() => {
  for (const surface of mounted.splice(0)) surface.destroy();
});

function mount(body: string): PaginatedSurface {
  const { surface } = mountFixture(body);
  mounted.push(surface);
  return surface;
}

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const THREE = paragraph('Alpha beta gamma') + paragraph('Second line') + paragraph('Third');

function paragraphIds(surface: PaginatedSurface): string[] {
  return [...surface.session.paragraphIds()];
}

function indentOf(surface: PaginatedSurface, paragraphId: string): Record<string, string> {
  const ind = directParagraphProperties(surface.session.part(), paragraphId).find(
    (property) => property.localName === 'ind'
  );
  return { ...ind?.attributes };
}

function press(
  surface: PaginatedSurface,
  from: [number, number],
  to: [number, number],
  shiftKey = false
) {
  const ids = paragraphIds(surface);
  surface.setSelection({
    anchor: { paragraphId: ids[from[0]]!, offset: from[1] },
    head: { paragraphId: ids[to[0]]!, offset: to[1] },
  });
  createKeyDownHandler(surface)({
    key: 'Tab',
    preventDefault: () => {},
    shiftKey,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
  } as KeyboardEvent);
  return ids;
}

const xml = (surface: PaginatedSurface) => serializeOoxmlPart(surface.session.part());
// A tab CHARACTER is a bare `<w:tab/>`; a tab stop always carries attributes.
const hasTab = (surface: PaginatedSurface) => xml(surface).includes('<w:tab/>');

describe('Tab over a selection', () => {
  test('a whole selected paragraph gets a first-line indent and keeps its text', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 0], [0, 16]);
    expect(xml(surface)).toContain('Alpha beta gamma');
    expect(hasTab(surface)).toBe(false);
    expect(indentOf(surface, ids[0]!)).toMatchObject({ firstLine: '720' });
    expect(indentOf(surface, ids[1]!)).toEqual({});
  });

  test('a selection that also takes the paragraph mark acts on that paragraph only', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 0], [1, 0]);
    expect(xml(surface)).toContain('Alpha beta gamma');
    expect(indentOf(surface, ids[0]!).firstLine).toBe('720');
    expect(indentOf(surface, ids[1]!)).toEqual({});
  });

  test('a selection from the paragraph start into the text also indents the first line', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 0], [0, 5]);
    expect(xml(surface)).toContain('Alpha beta gamma');
    expect(indentOf(surface, ids[0]!).firstLine).toBe('720');
  });

  test('hidden leading text does not move the paragraph start', () => {
    const surface = mount(
      '<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>hid</w:t></w:r><w:r><w:t>Shown</w:t></w:r></w:p>'
    );
    const ids = press(surface, [0, 3], [0, 8]);
    expect(xml(surface)).toContain('Shown');
    expect(hasTab(surface)).toBe(false);
    expect(indentOf(surface, ids[0]!).firstLine).toBe('720');
  });

  test('a first line already indented one tab stop steps the left indent', () => {
    const surface = mount(paragraph('Indented', '<w:pPr><w:ind w:firstLine="720"/></w:pPr>'));
    const ids = press(surface, [0, 0], [0, 8]);
    expect(indentOf(surface, ids[0]!)).toMatchObject({ left: '720', firstLine: '720' });
    expect(xml(surface)).toContain('Indented');
  });

  test('a hanging-indent paragraph keeps its hanging indent and moves one step', () => {
    const surface = mount(
      paragraph('Hanging entry', '<w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr>')
    );
    const ids = press(surface, [0, 0], [0, 13]);
    expect(indentOf(surface, ids[0]!)).toMatchObject({ left: '1440', hanging: '720' });
    expect(xml(surface)).toContain('Hanging entry');
  });

  test('a selection over several paragraphs steps the left indent of each one', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 6], [1, 3]);
    expect(xml(surface)).toContain('Alpha beta gamma');
    expect(xml(surface)).toContain('Second line');
    expect(hasTab(surface)).toBe(false);
    expect(indentOf(surface, ids[0]!).left).toBe('720');
    expect(indentOf(surface, ids[1]!).left).toBe('720');
    expect(indentOf(surface, ids[2]!)).toEqual({});
  });

  test('an indent at its bound stays put and keeps the text', () => {
    const at = `<w:pPr><w:ind w:left="${MAX_PARAGRAPH_INDENT_TWIPS}"/></w:pPr>`;
    const surface = mount(paragraph('One', at) + paragraph('Two', at));
    press(surface, [0, 1], [1, 2]);
    expect(xml(surface)).toContain('One');
    expect(xml(surface)).toContain('Two');
    expect(hasTab(surface)).toBe(false);
  });

  test('a selection that starts inside the text is replaced by a tab', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 6], [0, 10]);
    expect(xml(surface)).not.toContain('beta');
    expect(hasTab(surface)).toBe(true);
    expect(indentOf(surface, ids[0]!)).toEqual({});
  });

  test('a caret at the paragraph start still types a tab', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 0], [0, 0]);
    expect(hasTab(surface)).toBe(true);
    expect(indentOf(surface, ids[0]!)).toEqual({});
  });

  test('one undo step restores the paragraphs', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 6], [1, 3]);
    surface.undo();
    expect(indentOf(surface, ids[0]!)).toEqual({});
    expect(indentOf(surface, ids[1]!)).toEqual({});
  });
});

describe('the document tab grid', () => {
  test('Tab indents the first line by the default tab stop', () => {
    const bytes = trackedDocx('<w:defaultTabStop w:val="708"/>');
    const opened = mountPaginatedSurface(document.createElement('div'), bytes, { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    mounted.push(surface);
    const ids = press(surface, [0, 0], [0, 7]);
    expect(indentOf(surface, ids[0]!).firstLine).toBe('708');
    expect(xml(surface)).toContain('tracked');
  });
});

describe('paragraph starts that are not offset 0', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

  function withFootnote(note: string): PaginatedSurface {
    const xmlType = (part: string) =>
      `application/vnd.openxmlformats-officedocument.wordprocessingml.${part}+xml`;
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="${xmlType('document.main')}"/>` +
          `<Override PartName="/word/footnotes.xml" ContentType="${xmlType('footnotes')}"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1">${note}</w:footnote></w:footnotes>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Alpha</w:t></w:r>` +
          '<w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:sectPr/></w:body></w:document>'
      ),
    });
    const opened = mountPaginatedSurface(document.createElement('div'), bytes, { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    mounted.push(opened.surface);
    return opened.surface;
  }

  test('the note text after the reference mark counts as the start of a note paragraph', () => {
    const surface = withFootnote(
      '<w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve">Note text</w:t></w:r></w:p>'
    );
    expect(surface.enterNote('footnote:1')).toBe(true);
    const [id] = surface.session.paragraphIdsIn({ kind: 'notesPart', noteKind: 'footnote' });
    surface.setSelection({
      anchor: { paragraphId: id!, offset: 1 },
      head: { paragraphId: id!, offset: 10 },
    });
    expect(surface.indentWithTab('increase')).toBe(true);
    const notes = surface.session.partFor({ kind: 'notesPart', noteKind: 'footnote' })!;
    expect(serializeOoxmlPart(notes)).toContain('Note text');
    expect(serializeOoxmlPart(notes)).toContain('w:firstLine="720"');
  });

  test('a right-to-left run-in heading keeps its own start', () => {
    const rtl = '<w:bidi/>';
    const surface = mount(
      `<w:p><w:pPr>${rtl}<w:rPr><w:vanish/><w:specVanish/></w:rPr></w:pPr>` +
        '<w:r><w:rPr><w:rtl/></w:rPr><w:t>שלום</w:t></w:r></w:p>' +
        `<w:p><w:pPr>${rtl}</w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve"> עולם</w:t></w:r></w:p>`
    );
    const ids = press(surface, [0, 0], [0, 4]);
    expect(hasTab(surface)).toBe(false);
    expect(xml(surface)).toContain('שלום');
    expect(indentOf(surface, ids[0]!).firstLine).toBe('720');
  });

  test('a selected placeholder control at the paragraph start takes a tab, as a caret does', () => {
    const surface = mount(
      '<w:p><w:sdt><w:sdtPr><w:showingPlcHdr/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>Click here</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>'
    );
    const layout = surface.layout();
    const control = layout.contentControls?.find((candidate) => candidate.placeholder);
    const range = control ? placeholderSelectionRange(layout, control) : null;
    if (!range) throw new Error('no placeholder range');
    surface.setSelection({ anchor: range.from, head: range.to });
    expect(surface.indentWithTab('increase')).toBe(false);
  });

  test('a paragraph that continues a run-in heading line has no start of its own', () => {
    const surface = mount(
      '<w:p><w:pPr><w:rPr><w:vanish/><w:specVanish/></w:rPr></w:pPr><w:r><w:t>Heading</w:t></w:r></w:p>' +
        paragraph('Body text')
    );
    const ids = press(surface, [1, 0], [1, 9]);
    expect(hasTab(surface)).toBe(true);
    expect(indentOf(surface, ids[1]!)).toEqual({});
  });
});

describe('selections that reach the next paragraph only at its start', () => {
  test('Tab over two paragraphs leaves a third reached only at its start alone', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 3], [2, 0]);
    expect(indentOf(surface, ids[0]!).left).toBe('720');
    expect(indentOf(surface, ids[1]!).left).toBe('720');
    expect(indentOf(surface, ids[2]!)).toEqual({});
  });

  test('a selection that ends in an empty last paragraph indents it too', () => {
    const surface = mount(paragraph('Alpha') + '<w:p/>');
    const ids = press(surface, [0, 0], [1, 0]);
    expect(indentOf(surface, ids[0]!).left).toBe('720');
    expect(indentOf(surface, ids[1]!).left).toBe('720');
    expect(indentOf(surface, ids[0]!).firstLine).toBeUndefined();
  });

  test('an empty paragraph inside the story is reached only at its start', () => {
    const surface = mount(paragraph('Alpha') + '<w:p/>' + paragraph('Omega'));
    const ids = press(surface, [0, 0], [1, 0]);
    expect(indentOf(surface, ids[0]!).firstLine).toBe('720');
    expect(indentOf(surface, ids[1]!)).toEqual({});
  });

  test('indentWithTab over a one-cell rectangle on an empty cell indents the cell', () => {
    const surface = mount(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>` +
        paragraph('After')
    );
    selectCellRectangle(surface, { row: 0, column: 0 }, { row: 0, column: 0 });
    expect(surface.indentWithTab('increase')).toBe(true);
    expect(hasTab(surface)).toBe(false);
    expect(xml(surface)).toContain('w:left="720"');
  });

  test('indentWithTab over a cell rectangle indents the cells and keeps their text', () => {
    // The Tab key moves between cells instead; a host can still indent a rectangle this way.
    const cell = (text: string) => `<w:tc>${paragraph(text)}</w:tc>`;
    const surface = mount(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
        `<w:tr>${cell('Left')}${cell('Right')}</w:tr></w:tbl>` +
        paragraph('After')
    );
    selectCellRectangle(surface, { row: 0, column: 0 }, { row: 0, column: 1 });
    expect(surface.indentWithTab('increase')).toBe(true);
    expect(xml(surface)).toContain('Left');
    expect(xml(surface)).toContain('Right');
    expect(hasTab(surface)).toBe(false);
    expect(xml(surface).match(/w:left="720"/g)).toHaveLength(2);
  });
});

describe('Shift+Tab over a selection', () => {
  test('reverses two Tab presses back to no indent', () => {
    const surface = mount(THREE);
    const ids = press(surface, [0, 0], [0, 16]);
    press(surface, [0, 0], [0, 16]);
    expect(indentOf(surface, ids[0]!)).toMatchObject({ left: '720', firstLine: '720' });
    press(surface, [0, 0], [0, 16], true);
    expect(indentOf(surface, ids[0]!).firstLine).toBeUndefined();
    expect(indentOf(surface, ids[0]!).left).toBe('720');
    press(surface, [0, 0], [0, 16], true);
    expect(indentOf(surface, ids[0]!).left).toBe('0');
    expect(xml(surface)).toContain('Alpha beta gamma');
  });

  test('reverses one Tab on a paragraph that already has a left indent', () => {
    const surface = mount(paragraph('Indented body', '<w:pPr><w:ind w:left="720"/></w:pPr>'));
    const ids = press(surface, [0, 0], [0, 13]);
    expect(indentOf(surface, ids[0]!)).toMatchObject({ left: '720', firstLine: '720' });
    press(surface, [0, 0], [0, 13], true);
    expect(indentOf(surface, ids[0]!).left).toBe('720');
    expect(indentOf(surface, ids[0]!).firstLine).toBeUndefined();
  });

  test('steps the leading indent of a right-to-left paragraph once its first line is clear', () => {
    const surface = mount(
      paragraph('Right to left', '<w:pPr><w:bidi/><w:ind w:left="720" w:firstLine="720"/></w:pPr>')
    );
    const ids = press(surface, [0, 0], [0, 13], true);
    expect(indentOf(surface, ids[0]!).firstLine).toBeUndefined();
    expect(indentOf(surface, ids[0]!).left).toBe('720');
    press(surface, [0, 0], [0, 13], true);
    expect(indentOf(surface, ids[0]!).left).toBe('0');
  });

  test('clears the direct first-line value rather than writing zero', () => {
    const surface = mount(paragraph('Alpha beta gamma'));
    const ids = press(surface, [0, 0], [0, 16]);
    press(surface, [0, 0], [0, 16], true);
    expect(indentOf(surface, ids[0]!).firstLine).toBeUndefined();
    expect(indentOf(surface, ids[0]!).hanging).toBeUndefined();
  });

  test('leaves a last paragraph touched only at its start alone, as Tab does', () => {
    const indented = '<w:pPr><w:ind w:left="720"/></w:pPr>';
    const surface = mount(
      paragraph('One', indented) + paragraph('Two', indented) + paragraph('Three', indented)
    );
    const ids = press(surface, [0, 1], [2, 0], true);
    expect(indentOf(surface, ids[0]!).left).toBe('0');
    expect(indentOf(surface, ids[1]!).left).toBe('0');
    expect(indentOf(surface, ids[2]!).left).toBe('720');
  });
});

describe('tabIndentFor', () => {
  const at = (paragraphId: string, offset: number) => ({ paragraphId, offset });
  const reads = (direct = false, firstLine = 0, startOffset = 0) => ({
    start: () => ({ kind: 'start' as const, offset: startOffset }),
    endsStory: () => false,
    firstLine: () => ({ resolved: firstLine, direct }),
  });

  test('answers null for a caret and for a selection inside one paragraph', () => {
    const caret = { from: at('a', 0), to: at('a', 0) };
    const inside = { from: at('a', 2), to: at('a', 4) };
    expect(tabIndentFor(caret, ['a'], reads(), 'increase', 720)).toBeNull();
    expect(tabIndentFor(inside, ['a'], reads(), 'increase', 720)).toBeNull();
  });

  test('drops a last paragraph that is reached only at its start', () => {
    const toC = { from: at('a', 3), to: at('c', 0) };
    const toB = { from: at('a', 3), to: at('b', 0) };
    expect(tabIndentFor(toC, ['a', 'b', 'c'], reads(), 'increase', 720)).toEqual({
      write: 'stepLeft',
      paragraphs: ['a', 'b'],
    });
    expect(tabIndentFor(toB, ['a', 'b'], reads(), 'increase', 720)).toBeNull();
    const hiddenStart = { from: at('a', 0), to: at('b', 3) };
    expect(tabIndentFor(hiddenStart, ['a', 'b'], reads(false, 0, 3), 'increase', 720)).toEqual({
      write: 'setFirstLine',
      paragraphs: ['a'],
    });
  });

  test('a hanging or wide first line steps the left indent instead', () => {
    const range = { from: at('a', 0), to: at('a', 2) };
    for (const firstLine of [-360, 800]) {
      expect(tabIndentFor(range, ['a'], reads(false, firstLine), 'increase', 720)).toEqual({
        write: 'stepLeft',
        paragraphs: ['a'],
      });
    }
  });

  test('a start before the first painted offset is the paragraph start', () => {
    const range = { from: at('a', 3), to: at('a', 6) };
    expect(tabIndentFor(range, ['a'], reads(false, 0, 3), 'increase', 720)).toEqual({
      write: 'setFirstLine',
      paragraphs: ['a'],
    });
  });

  test('Shift+Tab clears only a first line the paragraph states itself', () => {
    const range = { from: at('a', 0), to: at('a', 2) };
    expect(tabIndentFor(range, ['a'], reads(false, 720), 'decrease', 720)?.write).toBe('stepLeft');
    expect(tabIndentFor(range, ['a'], reads(true, 720), 'decrease', 720)?.write).toBe(
      'clearFirstLine'
    );
  });

  test('a grid step lands on the next tab stop, never a sliver short of the margin', () => {
    expect(nextGridIndent(720, -1, 708)).toBe(708);
    expect(nextGridIndent(708, -1, 708)).toBe(0);
    expect(nextGridIndent(12, -1, 708)).toBe(0);
    expect(nextGridIndent(720, 1, 708)).toBe(1416);
    expect(nextGridIndent(0, 1, 708)).toBe(708);
  });

  test('a step never passes the margin or the bound, and an increase never moves back', () => {
    expect(nextLeftIndent(0, -1)).toBe(0);
    expect(nextLeftIndent(MAX_PARAGRAPH_INDENT_TWIPS - 10, 1)).toBe(MAX_PARAGRAPH_INDENT_TWIPS);
    expect(nextLeftIndent(720, 1)).toBe(720 + INDENT_STEP_TWIPS);
    expect(nextLeftIndent(40_000, 1)).toBe(40_000);
    expect(nextLeftIndent(-720, -1)).toBe(0);
  });
});
