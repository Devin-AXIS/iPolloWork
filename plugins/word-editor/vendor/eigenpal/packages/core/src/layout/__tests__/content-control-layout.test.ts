// A content control is TRANSPARENT to the page and VISIBLE to the reader.
//
// Two claims, and they pull in opposite directions. The wrapper must not move anything — the
// same content laid out with and without it occupies the same geometry, because a control is
// a label on a stretch of a document rather than a box around it. And the content INSIDE an
// inline control must be painted, which it was not while `w:sdt` was opaque: the comprehensive
// fixture's checkbox glyphs existed in the file and appeared nowhere on the page.
//
// The boundary records are the third claim: everything a browser needs to select a control, an
// API needs to answer its range, and chrome needs to say why it is locked — derived from the
// layout rather than read back out of the DOM.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, storyParagraphs, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../index.ts';
import { contentControlBoundaries } from '../content-control-boundaries.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { storyBlocks } from '../story-roots.ts';
import type { LineRecord, SemanticLayout, StyleSpanRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

const docMeta = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}<w:sectPr/></w:body></w:document>`,
    docMeta
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function layoutOf(part: OoxmlPart): SemanticLayout {
  return layoutSemanticDocument(part, 1, { measurer });
}

function spansOf(layout: SemanticLayout): StyleSpanRecord[] {
  const spans: StyleSpanRecord[] = [];
  const walk = (blocks: readonly { kind: string }[]): void => {
    for (const block of blocks) {
      if (block.kind === 'table') {
        for (const row of (block as { rows: { cells: { blocks: unknown[] }[] }[] }).rows) {
          for (const cell of row.cells) walk(cell.blocks as { kind: string }[]);
        }
        continue;
      }
      for (const line of (block as unknown as { lines: { spans: StyleSpanRecord[] }[] }).lines) {
        spans.push(...line.spans);
      }
    }
  };
  for (const page of layout.pages) walk(page.fragments);
  return spans;
}

function linesOf(layout: SemanticLayout): LineRecord[] {
  const lines: LineRecord[] = [];
  const walk = (blocks: readonly { kind: string }[]): void => {
    for (const block of blocks) {
      if (block.kind === 'table') continue;
      lines.push(...(block as unknown as { lines: LineRecord[] }).lines);
    }
  };
  for (const page of layout.pages) walk(page.fragments);
  return lines;
}

function textOf(layout: SemanticLayout): string {
  return spansOf(layout)
    .map((span) => span.text)
    .join('');
}

describe('a control wrapper changes nothing about the page', () => {
  test('an inline control paints the characters inside it', () => {
    const layout = layoutOf(
      parseDoc(
        `<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>` +
          `<w:sdt><w:sdtPr><w:tag w:val="inline"/></w:sdtPr>` +
          `<w:sdtContent><w:r><w:t>inside</w:t></w:r></w:sdtContent></w:sdt>` +
          `<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>`
      )
    );
    expect(textOf(layout)).toBe('before inside after');
  });

  test('geometry is identical with and without the wrapper', () => {
    const bare = layoutOf(parseDoc(`<w:p><w:r><w:t>before inside after</w:t></w:r></w:p>`));
    const wrapped = layoutOf(
      parseDoc(
        `<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>` +
          `<w:sdt><w:sdtContent><w:r><w:t>inside</w:t></w:r></w:sdtContent></w:sdt>` +
          `<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>`
      )
    );
    // Per LINE, not per span: the wrapper divides the text into three runs where the bare
    // paragraph has one, and how text is cut into spans is not geometry. Where the line sits,
    // how wide the text is, and how far it reaches are.
    const geometry = (layout: SemanticLayout): unknown =>
      linesOf(layout).map((line) => [
        line.spans.map((span) => span.text).join(''),
        line.box,
        line.spans[0]?.box.x,
        (line.spans.at(-1)?.box.x ?? 0) + (line.spans.at(-1)?.box.width ?? 0),
      ]);
    expect(geometry(wrapped)).toEqual(geometry(bare));
    expect(wrapped.pages.length).toBe(bare.pages.length);
  });

  test('a block control keeps its paragraphs in the flow', () => {
    const layout = layoutOf(
      parseDoc(
        `<w:sdt><w:sdtPr><w:tag w:val="block"/></w:sdtPr><w:sdtContent>` +
          `<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>` +
          `</w:sdtContent></w:sdt>`
      )
    );
    expect(textOf(layout)).toBe('onetwo');
  });

  test('store and layout agree on paragraphs inside block customXml', () => {
    const part = parseDoc(
      '<w:sdt><w:sdtContent><w:customXml>' +
        '<w:p><w:r><w:t>one</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
        '</w:customXml></w:sdtContent></w:sdt>'
    );
    const body = part.root.children.find((child) => child.kind === 'body');
    if (!body) throw new Error('no body');
    const storeIds = storyParagraphs(body).map((paragraph) => paragraph.id);
    const layoutIds = storyBlocks(part)
      .filter((block) => block.kind === 'paragraph')
      .map((paragraph) => paragraph.id);
    expect(layoutIds).toEqual(storeIds);
    expect(layoutIds).toHaveLength(2);
    expect(textOf(layoutOf(part))).toBe('onetwo');
  });
});

describe('boundary records describe every control the layout laid out', () => {
  const part = parseDoc(
    `<w:sdt><w:sdtPr><w:alias w:val="Intro"/><w:tag w:val="intro"/><w:id w:val="7"/>` +
      `<w:lock w:val="sdtContentLocked"/><w:showingPlcHdr/><w:richText/></w:sdtPr>` +
      `<w:sdtContent><w:p><w:r><w:t>Click here to enter text.</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
      `<w:p><w:r><w:t xml:space="preserve">after </w:t></w:r>` +
      `<w:sdt><w:sdtPr><w:tag w:val="pick"/><w:dropDownList>` +
      `<w:listItem w:displayText="One" w:value="1"/></w:dropDownList></w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>One</w:t></w:r></w:sdtContent></w:sdt></w:p>`
  );

  test('identity, tag, alias, type, lock and placeholder state are reported', () => {
    const records = contentControlBoundaries(part, layoutOf(part));
    expect(records.map((record) => record.tag)).toEqual(['intro', 'pick']);
    const [intro, pick] = records;
    expect(intro!.alias).toBe('Intro');
    expect(intro!.id).toBe(7);
    expect(intro!.type).toBe('richText');
    expect(intro!.lock).toBe('sdtContentLocked');
    expect(intro!.showingPlaceholder).toBe(true);
    expect(intro!.level).toBe('block');
    expect(pick!.type).toBe('dropDownList');
    expect(pick!.lock).toBe('unlocked');
    expect(pick!.level).toBe('inline');
    // A control's node id is its identity — `w:id` is metadata and may be absent.
    expect(intro!.controlId).not.toBe(pick!.controlId);
    expect(pick!.id).toBeUndefined();
  });

  test('every record carries the paragraphs and the geometry of its content', () => {
    const records = contentControlBoundaries(part, layoutOf(part));
    for (const record of records) {
      expect(record.paragraphIds.length).toBeGreaterThan(0);
      expect(record.fragments.length).toBeGreaterThan(0);
      for (const fragment of record.fragments) {
        expect(fragment.pageIndex).toBeGreaterThanOrEqual(0);
        expect(fragment.width).toBeGreaterThan(0);
        expect(fragment.height).toBeGreaterThan(0);
      }
    }
  });

  test('a control whose content splits across pages reports both fragments', () => {
    const filler = Array.from(
      { length: 90 },
      (_, index) => `<w:p><w:r><w:t>line ${String(index)}</w:t></w:r></w:p>`
    ).join('');
    const split = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="long"/></w:sdtPr><w:sdtContent>${filler}</w:sdtContent></w:sdt>`
    );
    const layout = layoutOf(split);
    expect(layout.pages.length).toBeGreaterThan(1);
    const record = contentControlBoundaries(split, layout)[0]!;
    expect(new Set(record.fragments.map((fragment) => fragment.pageIndex)).size).toBe(
      layout.pages.length
    );
  });

  test('a nested control is reported with its depth', () => {
    const nested = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>deep</w:t></w:r></w:p>` +
        `</w:sdtContent></w:sdt></w:sdtContent></w:sdt>`
    );
    const records = contentControlBoundaries(nested, layoutOf(nested));
    expect(records.map((record) => [record.tag, record.depth])).toEqual([
      ['outer', 0],
      ['inner', 1],
    ]);
  });

  test('block custom XML contributes control blocks and nested boundaries', () => {
    const nested = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent><w:customXml>` +
        `<w:p><w:r><w:t>one</w:t></w:r></w:p>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>two</w:t></w:r></w:p>` +
        `</w:sdtContent></w:sdt></w:customXml></w:sdtContent></w:sdt>`
    );
    const records = contentControlBoundaries(nested, layoutOf(nested));
    expect(records.map((record) => [record.tag, record.depth])).toEqual([
      ['outer', 0],
      ['inner', 1],
    ]);
    expect(records[0]!.paragraphIds).toHaveLength(2);
    expect(records[0]!.fragments.length).toBeGreaterThan(0);
    expect(records[1]!.paragraphIds).toHaveLength(1);
    expect(records[1]!.fragments.length).toBeGreaterThan(0);
  });
});
