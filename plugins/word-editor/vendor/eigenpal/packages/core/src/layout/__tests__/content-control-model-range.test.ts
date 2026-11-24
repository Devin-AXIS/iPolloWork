// The model range an inline content-control boundary record publishes: `{ paragraphId, start,
// end }` in UTF-16 offsets of its paragraph, so consumers map a control to positions through the
// model, never back from geometry. Block controls publish none. Header controls are covered by
// `editor/__tests__/atomic-navigation-edges.test.ts`, which mounts a package with a header part.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  paragraphTextFromLayout,
  type PageGeometry,
  type SemanticLayout,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const GEOMETRY: PageGeometry = {
  width: 300,
  height: 400,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const run = (text: string) =>
  `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const sdt = (alias: string, content: string, pr = '') =>
  `<w:sdt><w:sdtPr><w:alias w:val="${alias}"/>${pr}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

function lay(body: string, revision = 1): SemanticLayout {
  return layoutSemanticDocument(load(body), revision, { measurer, geometry: GEOMETRY });
}

const byAlias = (layout: SemanticLayout, alias: string) => {
  const record = layout.contentControls?.find((c) => c.alias === alias);
  if (!record) throw new Error(`no control ${alias}`);
  return record;
};

/** The text a published range covers, read back from the laid-out paragraph. */
const coveredText = (layout: SemanticLayout, alias: string) => {
  const { range } = byAlias(layout, alias);
  if (!range) return null;
  return paragraphTextFromLayout(layout, range.paragraphId).slice(range.start, range.end);
};

describe('inline control records carry their model range', () => {
  test('range equals the control offsets in its paragraph', () => {
    const layout = lay(`<w:p>${run('aa')}${sdt('I', run('Token'))}${run('zz')}</w:p>`);
    const record = byAlias(layout, 'I');
    expect(record.level).toBe('inline');
    const paragraphId =
      layout.pages[0]!.fragments[0]!.kind === 'paragraph'
        ? layout.pages[0]!.fragments[0]!.paragraphId
        : '';
    expect(record.range).toEqual({ paragraphId, start: 2, end: 7 });
    expect(coveredText(layout, 'I')).toBe('Token');
  });

  test('a control spanning several runs covers all of them', () => {
    const layout = lay(`<w:p>${run('a')}${sdt('I', `${run('one ')}${run('two')}`)}</w:p>`);
    expect(byAlias(layout, 'I').range).toMatchObject({ start: 1, end: 8 });
    expect(coveredText(layout, 'I')).toBe('one two');
  });

  test('two controls in one paragraph get disjoint ranges', () => {
    const layout = lay(`<w:p>${sdt('A', run('One'))}${run('-')}${sdt('B', run('Two'))}</w:p>`);
    expect(byAlias(layout, 'A').range).toMatchObject({ start: 0, end: 3 });
    expect(byAlias(layout, 'B').range).toMatchObject({ start: 4, end: 7 });
  });

  test('nested inline controls each publish their own range', () => {
    const layout = lay(
      `<w:p>${run('aa')}${sdt('Outer', `${run('pre')}${sdt('Inner', run('In'))}${run('post')}`)}</w:p>`
    );
    expect(byAlias(layout, 'Outer').range).toMatchObject({ start: 2, end: 11 });
    expect(byAlias(layout, 'Inner').range).toMatchObject({ start: 5, end: 7 });
    expect(coveredText(layout, 'Inner')).toBe('In');
    expect(byAlias(layout, 'Inner').range!.paragraphId).toBe(
      byAlias(layout, 'Outer').range!.paragraphId
    );
  });

  test('a control in a table cell names the cell paragraph', () => {
    const cell = `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p>${run('x')}${sdt('I', run('Cell'))}</w:p></w:tc>`;
    const layout = lay(`<w:tbl><w:tr>${cell}</w:tr></w:tbl><w:p/>`);
    expect(byAlias(layout, 'I').range).toMatchObject({ start: 1, end: 5 });
    expect(coveredText(layout, 'I')).toBe('Cell');
  });

  test('a locked control publishes the same range as an unlocked one', () => {
    const plain = lay(`<w:p>${run('aa')}${sdt('I', run('Token'))}</w:p>`);
    const locked = lay(
      `<w:p>${run('aa')}${sdt('I', run('Token'), '<w:lock w:val="sdtContentLocked"/>')}</w:p>`
    );
    expect(byAlias(locked, 'I').range).toEqual(byAlias(plain, 'I').range!);
    expect(byAlias(locked, 'I').effectiveLock).toBe('sdtContentLocked');
  });

  test('the range follows an edit before the control on the next revision', () => {
    const before = lay(`<w:p>${run('aa')}${sdt('I', run('Token'))}</w:p>`, 1);
    const after = lay(`<w:p>${run('aaaa')}${sdt('I', run('Token'))}</w:p>`, 2);
    expect(byAlias(before, 'I').range).toMatchObject({ start: 2, end: 7 });
    expect(byAlias(after, 'I').range).toMatchObject({ start: 4, end: 9 });
  });
});

describe('block control records carry no range', () => {
  test('a block control around one paragraph', () => {
    const layout = lay(sdt('B', `<w:p>${run('inside')}</w:p>`));
    const record = byAlias(layout, 'B');
    expect(record.level).toBe('block');
    expect(record.range).toBeUndefined();
    expect('range' in record).toBe(false);
  });

  test('a block control around an inline control: only the inline one has a range', () => {
    const layout = lay(sdt('B', `<w:p>${run('a')}${sdt('I', run('b'))}</w:p>`));
    expect(byAlias(layout, 'B').range).toBeUndefined();
    expect(byAlias(layout, 'I').range).toMatchObject({ start: 1, end: 2 });
  });
});
