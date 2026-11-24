// A bordered paragraph that opens with a page break leaves the border group above it only
// when placement keeps its break line: the paragraph above closes its box exactly when the
// break line draws no rule. Both decisions read what the view displays, so a break or text
// the view hides, and an anchored drawing, keep the ordinary group.

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { SemanticLayoutOptions } from '../semantic-layout-options.ts';
import type { ParagraphFragmentRecord, SemanticLayout } from '../semantic-records.ts';

const OWNER = '/word/document.xml';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

// 350pt by 210pt sheets with 20pt margins: a 170pt text area holds twelve 14pt lines.
const sect =
  '<w:sectPr><w:pgSz w:w="7000" w:h="4200"/>' +
  '<w:pgMar w:top="400" w:right="400" w:bottom="400" w:left="400" ' +
  'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}">` +
      `<w:body>${body}${sect}</w:body></w:document>`,
    { name: OWNER, contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const MISSING_RESOURCE: ImageResourceState = Object.freeze({
  kind: 'missing',
  relationshipId: '',
});

function drawingContext(part: OoxmlPart): InlineDrawingLayoutContext {
  const projections = indexInlineDrawingProjectionsInPart(part);
  return {
    ownerPartName: OWNER,
    projectionForAtom: (atomId) => projections.get(atomId) ?? null,
    project: (node) =>
      projections.get(node.id) ??
      projectDrawing(node, {
        ownerPartName: OWNER,
        supportedMcRequires: new Set<string>(),
        limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
      }),
    resourceOf: () => MISSING_RESOURCE,
  };
}

const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart, extra: Partial<SemanticLayoutOptions> = {}): SemanticLayout =>
  layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: drawingContext(part),
    ...extra,
  });

const spacing = '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>';
const BOX =
  '<w:pBdr>' +
  ['top', 'left', 'bottom', 'right']
    .map((side) => `<w:${side} w:val="single" w:sz="8" w:space="0"/>`)
    .join('') +
  '</w:pBdr>';
const FRAME = '<w:framePr w:x="400" w:y="0" w:w="1000" w:vAnchor="text"/>';
const pageBreak = '<w:br w:type="page"/>';
const br = `<w:r>${pageBreak}</w:r>`;
const text = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`;
const revision = (kind: 'ins' | 'del', content: string) =>
  `<w:${kind} w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z">${content}</w:${kind}>`;

const paragraph = (content: string, pPr = '') =>
  `<w:p><w:pPr>${pPr}${spacing}</w:pPr>${content}</w:p>`;
const fill = (count: number) =>
  Array.from({ length: count }, (_, line) => paragraph(text(`line${line}`))).join('');
const anchoredShape =
  '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
  'relativeHeight="1" behindDoc="0" locked="1" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="page"><wp:posOffset>2540000</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="127000" cy="127000"/><wp:wrapNone/><wp:docPr id="7" name="shape"/>' +
  `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:cNvSpPr/><wps:spPr>` +
  '<a:xfrm><a:off x="0" y="0"/><a:ext cx="127000" cy="127000"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr><wps:bodyPr/></wps:wsp>' +
  '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';
const indexField =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> XE "entry" </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

/** Every placed fragment of the top-level paragraph at `position`, with its page. */
const fragmentsAt = (layout: SemanticLayout, position: number) =>
  layout.pages.flatMap((page, index) =>
    page.fragments
      .filter(
        (fragment): fragment is ParagraphFragmentRecord =>
          fragment.kind === 'paragraph' && fragment.paragraphId.endsWith(`#0.0.${position}`)
      )
      .map((fragment) => ({ fragment, page: index }))
  );
const sides = (fragment: ParagraphFragmentRecord): string[] =>
  (fragment.borders ?? []).map((stroke) => `${stroke.side}@${stroke.box.y}`);

/** `count` filler lines, a boxed paragraph, then a boxed paragraph holding `content`. */
const grouped = (count: number, content: string, abovePPr = BOX) =>
  fill(count) +
  paragraph(text('group'), abovePPr) +
  paragraph(content, BOX) +
  paragraph(text('tail'));

/** The paragraph above keeps its box open, and the next paragraph draws no top rule. */
function expectJoinedGroup(layout: SemanticLayout, count: number): void {
  const [above] = fragmentsAt(layout, count);
  expect(above!.fragment.bottomBorder).toBeUndefined();
  for (const { fragment } of fragmentsAt(layout, count + 1)) {
    expect(sides(fragment).some((side) => side.startsWith('top@'))).toBe(false);
  }
}

describe('a bordered paragraph whose display does not open with a page break', () => {
  test('keeps the group when the break sits in a deleted run in the proposed view', () => {
    const layout = lay(load(grouped(3, revision('del', br) + text('after'))), {
      displayMode: 'proposed',
    });
    expect(layout.pages).toHaveLength(1);
    expectJoinedGroup(layout, 3);
    expect(sides(fragmentsAt(layout, 4)[0]!.fragment)).toEqual([
      'bottom@71',
      'left@57',
      'right@57',
    ]);
  });

  test('keeps the group when the break sits in an inserted run in the original view', () => {
    const layout = lay(load(grouped(3, revision('ins', br) + text('after'))), {
      displayMode: 'original',
    });
    expect(layout.pages).toHaveLength(1);
    expectJoinedGroup(layout, 3);
  });

  test('keeps the group when the break is hidden text', () => {
    const hidden = `<w:r><w:rPr><w:vanish/></w:rPr>${pageBreak}</w:r>`;
    const layout = lay(load(grouped(3, hidden + text('after'))));
    expect(layout.pages).toHaveLength(1);
    expectJoinedGroup(layout, 3);
  });

  test('leaves the group when the view shows the deleted break', () => {
    const layout = lay(load(grouped(3, revision('del', br) + text('after'))), {
      displayMode: 'all-markup',
    });
    const [above] = fragmentsAt(layout, 3);
    expect(above!.fragment.bottomBorder).toBeDefined();
    const [breakLine, after] = fragmentsAt(layout, 4);
    expect(breakLine!.fragment.borders).toBeUndefined();
    expect(sides(after!.fragment)[0]).toBe('top@0');
  });
});

describe('a bordered paragraph that keeps the ordinary break rule', () => {
  test('keeps the group and two pages with an anchored drawing', () => {
    const layout = lay(load(grouped(10, br + text('after') + anchoredShape)));
    expect(layout.pages).toHaveLength(2);
    expectJoinedGroup(layout, 10);
    const [breakLine] = fragmentsAt(layout, 11);
    expect(breakLine!.page).toBe(0);
    expect(sides(breakLine!.fragment)).toEqual(['left@155', 'right@155']);
  });

  test('keeps the group when only a hidden field follows the break', () => {
    const layout = lay(load(grouped(3, br + indexField)));
    expectJoinedGroup(layout, 3);
    const [breakLine] = fragmentsAt(layout, 4);
    expect(sides(breakLine!.fragment)).toEqual(['bottom@71', 'left@57', 'right@57']);
  });

  test('keeps the group after a framed paragraph with the same borders', () => {
    const layout = lay(load(grouped(3, br + text('after'), FRAME + BOX)));
    expectJoinedGroup(layout, 3);
    const [breakLine] = fragmentsAt(layout, 4);
    expect(sides(breakLine!.fragment)).toEqual(['left@42', 'right@42']);
  });
});

describe('leading break groups through a retained session', () => {
  test('switching the view re-places the paragraph above', () => {
    const part = load(grouped(3, revision('del', br) + text('after')));
    const options: SemanticLayoutOptions = {
      measurer,
      inlineDrawingLayout: drawingContext(part),
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    for (const displayMode of ['proposed', 'all-markup', 'proposed'] as const) {
      const warm = layoutSemanticDocument(part, 1, { ...options, displayMode });
      expect(warm.pages).toEqual(lay(part, { displayMode }).pages);
    }
  });

  for (const [label, before, after] of [
    ['showing', revision('del', br), br],
    ['hiding', br, revision('del', br)],
  ] as const) {
    test(`${label} the break in an edit re-places the paragraph above`, () => {
      const options: SemanticLayoutOptions = {
        measurer,
        displayMode: 'proposed',
        session: createLayoutSession(),
        cache: createParagraphLayoutCache(),
      };
      layoutSemanticDocument(load(grouped(3, before + text('after'))), 1, options);
      const part = load(grouped(3, after + text('after')));
      const warm = layoutSemanticDocument(part, 2, options);
      expect(warm.pages).toEqual(
        layoutSemanticDocument(part, 1, { measurer, displayMode: 'proposed' }).pages
      );
    });
  }
});
