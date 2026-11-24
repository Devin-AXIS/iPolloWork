import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function section(columns = 1, type = 'continuous'): string {
  return (
    `<w:sectPr><w:type w:val="${type}"/><w:pgSz w:w="4000" w:h="2400"/>` +
    '<w:pgMar w:top="200" w:bottom="200" w:left="200" w:right="200" w:header="0" w:footer="0"/>' +
    `<w:cols w:num="${columns}" w:space="200"/></w:sectPr>`
  );
}

function paragraph(text: string, height: number, before = 0, sectPr = ''): string {
  return (
    '<w:p><w:pPr>' +
    `<w:spacing w:before="${before * 20}" w:after="0" w:line="${height * 20}" w:lineRule="exact"/>` +
    `${sectPr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
  );
}

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function fixture(host = 80, columns = 2, mark = true, heading = 26, before = 18): OoxmlPart {
  return load(
    paragraph('HOST', host) +
      paragraph('', 21, 0, section()) +
      (mark ? paragraph('', 21, 0, section(columns)) : '') +
      paragraph('CONTENTS', heading, before) +
      paragraph('TAIL', 10) +
      section(columns)
  );
}

function layout(part: OoxmlPart, session?: ReturnType<typeof createLayoutSession>, revision = 1) {
  return layoutSemanticDocument(part, revision, { measurer, ...(session ? { session } : {}) });
}

function at(result: ReturnType<typeof layout>, text: string) {
  const matches = result.pages.flatMap((page, pageIndex) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' &&
      fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('') === text
        ? [{ pageIndex, fragment }]
        : []
    )
  );
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

function paintedLinesFit(result: ReturnType<typeof layout>): void {
  for (const page of result.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph' || fragment.outOfFlow) continue;
      for (const line of fragment.lines) {
        // A retained empty section mark has a caret box but paints no text.
        if (line.spans.some((span) => span.text.length > 0)) {
          expect(line.box.y + line.box.height).toBeLessThanOrEqual(
            page.contentBox.height + 0.000001
          );
        }
      }
    }
  }
}

test('consecutive continuous marks keep the first painted line inside the next sheet', () => {
  const result = layout(fixture());
  expect(at(result, 'CONTENTS').pageIndex).toBe(1);
  expect(at(result, 'CONTENTS').fragment.box.y).toBe(0);
  expect(at(result, 'TAIL').pageIndex).toBe(1);
  expect(result.pages).toHaveLength(2);
  paintedLinesFit(result);
});

test('a continued first line advances past both occupied columns', () => {
  const result = layout(fixture(90, 2, false, 20, 0));
  expect(at(result, 'CONTENTS').pageIndex).toBe(1);
  expect(at(result, 'CONTENTS').fragment.box.x).toBe(0);
  paintedLinesFit(result);
});

test('a continued first line advances past three occupied columns without looping', () => {
  const result = layout(fixture(90, 3, false, 20, 0));
  expect(at(result, 'CONTENTS').pageIndex).toBe(1);
  expect(at(result, 'CONTENTS').fragment.box.x).toBe(0);
  expect(result.pages).toHaveLength(2);
  paintedLinesFit(result);
});

test('a fitting first line keeps the occupied host position', () => {
  const result = layout(fixture(40, 2, false, 20, 0));
  expect(at(result, 'CONTENTS').pageIndex).toBe(0);
  expect(at(result, 'CONTENTS').fragment.box.y).toBe(40);
  expect(result.pages).toHaveLength(1);
  paintedLinesFit(result);
});

test('single-column continuous flow still moves a nonfitting first line', () => {
  const result = layout(fixture(90, 1, false, 20, 0));
  expect(at(result, 'CONTENTS').pageIndex).toBe(1);
  expect(at(result, 'CONTENTS').fragment.box.y).toBe(0);
  expect(result.pages).toHaveLength(2);
  paintedLinesFit(result);
});

test('an oversized line on a fresh sheet is emitted once', () => {
  const result = layout(load(paragraph('GIANT', 140) + section(2, 'nextPage')));
  expect(result.pages).toHaveLength(1);
  expect(at(result, 'GIANT').fragment.box.y).toBe(0);
  expect(at(result, 'GIANT').fragment.box.height).toBe(140);
});

test('an oversized first line leaves an occupied host before the fresh-sheet escape', () => {
  const result = layout(fixture(90, 2, false, 140, 0));
  expect(at(result, 'CONTENTS').pageIndex).toBe(1);
  expect(at(result, 'CONTENTS').fragment.box.y).toBe(0);
  expect(at(result, 'CONTENTS').fragment.box.height).toBe(140);
});

test('retained layout matches cold layout without extra sheets', () => {
  const session = createLayoutSession();
  const part = fixture();
  layout(part, session);
  const warm = layout(part, session, 2);
  const cold = layout(part, undefined, 2);
  expect(warm.pages).toEqual(cold.pages);
  expect(at(warm, 'CONTENTS').pageIndex).toBe(1);
  expect(warm.pages).toHaveLength(2);
  paintedLinesFit(warm);
});
