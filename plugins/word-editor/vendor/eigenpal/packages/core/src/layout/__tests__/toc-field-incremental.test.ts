// TOC field verdicts across an INCREMENTAL pass.
//
// A TOC is a complex field spanning paragraphs: a begin paragraph carrying `fldChar begin`
// and the `TOC` instruction, cached result paragraphs, an end paragraph. Layout answers three
// questions per paragraph from that shape — suppress the field chrome, keep one placeholder
// line on a begin paragraph whose TOC resolved to nothing, suppress a blank cached result row
// — and every answer is read from the OTHER paragraphs of the same field.
//
// The begin paragraph is the sharp one. Whether it keeps a placeholder line depends on
// whether any RESULT paragraph after it still carries visible text, and refreshing a TOC that
// comes back empty rewrites the results while leaving the begin paragraph byte-identical. Its
// content key never moved, resume started at the first result, and the placeholder line the
// begin paragraph had just earned simply never appeared — for the life of the session.
//
// Every test here is DIFFERENTIAL: the same tree laid out cold is the oracle.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { paragraphFragmentsOf } from '../index.ts';
import type { SemanticLayout } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);

const BEGIN =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/>' +
  '<w:instrText> TOC \\o "1-3" \\h </w:instrText>' +
  '<w:fldChar w:fldCharType="separate"/></w:r></w:p>';
const END = '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
const entry = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
/** A cached row the refresh left behind with nothing in it. */
const BLANK_ENTRY = '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr></w:p>';
const after = '<w:p><w:r><w:t>after</w:t></w:r></w:p>';

const sdt = (inner: string) => `<w:sdt><w:sdtPr/><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;

/**
 * What each painted row is and where it sits.
 *
 * Node ids are minted per parse, so they cannot cross between two loads of the same markup.
 * Geometry plus text is what the verdicts decide, and it is what a reader sees.
 */
const shapeOf = (layout: SemanticLayout): unknown =>
  layout.pages.map((page) =>
    paragraphFragmentsOf(page).map((fragment) => ({
      y: fragment.box.y,
      height: fragment.box.height,
      text: fragment.lines
        .flatMap((line) => line.spans.map((span) => span.text))
        .join('')
        .trim(),
    }))
  );

/** Lay `before` out, then `after` over the same session; the oracle is `after` laid out cold. */
function differential(before: string, next: string): { warm: unknown; oracle: unknown } {
  const options = {
    measurer,
    session: createLayoutSession(),
    cache: createParagraphLayoutCache(),
  };
  layoutSemanticDocument(load(before), 1, options);
  const warm = layoutSemanticDocument(load(next), 2, options);
  return {
    warm: shapeOf(warm),
    oracle: shapeOf(layoutSemanticDocument(load(next), 1, { measurer })),
  };
}

describe('the empty-TOC placeholder on the begin paragraph', () => {
  test('a refresh that empties the TOC gives the begin paragraph its placeholder line', () => {
    // The result paragraphs go; the begin paragraph does not change one byte. Its verdict
    // does: it now has to keep the one line that stands in for an empty TOC.
    const { warm, oracle } = differential(
      sdt(BEGIN + entry('Introduction') + END) + after,
      sdt(BEGIN + END) + after
    );
    expect(warm).toEqual(oracle);
  });

  test('a refresh that leaves the rows blank rather than removing them', () => {
    // Same verdict flip, reached the other way: the rows survive with no visible text, so
    // the begin paragraph takes the placeholder and the blank rows are suppressed.
    const { warm, oracle } = differential(
      sdt(BEGIN + entry('Introduction') + entry('Method') + END) + after,
      sdt(BEGIN + BLANK_ENTRY + BLANK_ENTRY + END) + after
    );
    expect(warm).toEqual(oracle);
  });

  test('a refresh that FILLS an empty TOC takes the placeholder back off', () => {
    const { warm, oracle } = differential(
      sdt(BEGIN + END) + after,
      sdt(BEGIN + entry('Introduction') + END) + after
    );
    expect(warm).toEqual(oracle);
  });

  test('the placeholder is really the thing being compared', () => {
    // Guards the differential above from passing vacuously: the two trees must genuinely
    // disagree about what the begin paragraph emits.
    const filled = shapeOf(
      layoutSemanticDocument(load(sdt(BEGIN + entry('Introduction') + END) + after), 1, {
        measurer,
      })
    );
    const empty = shapeOf(layoutSemanticDocument(load(sdt(BEGIN + END) + after), 1, { measurer }));
    expect(empty).not.toEqual(filled);
  });
});

describe('a document with no TOC is not made to churn', () => {
  test('a no-change pass still returns the previous pages by identity', () => {
    const part = load(after + after + after);
    const options = {
      measurer,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    const first = layoutSemanticDocument(part, 1, options);
    expect(layoutSemanticDocument(part, 2, options).pages).toBe(first.pages);
  });

  test('a no-change pass over a document WITH a TOC also returns pages by identity', () => {
    const part = load(sdt(BEGIN + entry('Introduction') + END) + after);
    const options = {
      measurer,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    const first = layoutSemanticDocument(part, 1, options);
    expect(layoutSemanticDocument(part, 2, options).pages).toBe(first.pages);
  });
});
