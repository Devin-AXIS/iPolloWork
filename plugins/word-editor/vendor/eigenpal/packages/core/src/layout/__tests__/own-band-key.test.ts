// The break cache key of a paragraph that anchors its own topAndBottom band keys where that
// band sits on the page. A band framed to the page vertically keys the paragraph's start Y; a
// band framed to the page or a margin horizontally keys the page's left margin and parity,
// which mirrored margins and inside or outside frames read. `simplePos` is page coordinates on
// both axes.

import { describe, expect, test } from 'bun:test';
import type { OoxmlElement } from '../../store/package/ooxml-tree.ts';
import { ownBandKeyInputs } from '../drawing-placement-exclusion.ts';
import { bodyParagraphBreakKey } from '../paragraph-break-request.ts';
import { layoutContext, load, squareAnchorAtLeft } from './anchored-drawing-test-fixtures.ts';

function topAndBottomParagraph(edit: (xml: string) => string = (xml) => xml) {
  const xml = edit(
    squareAnchorAtLeft({ text: 'Text' }).replace(
      '<wp:wrapSquare wrapText="bothSides" distT="0" distB="0" distL="0" distR="0"/>',
      '<wp:wrapTopAndBottom/>'
    )
  );
  const part = load(xml);
  const root = part.root as OoxmlElement;
  const body = root.children.find((child) => child.kind !== 'textValue') as OoxmlElement;
  const paragraph = body.children.find((child) => child.kind === 'paragraph') as OoxmlElement;
  return { part, paragraph };
}

function inputs(edit: (xml: string) => string) {
  const { part, paragraph } = topAndBottomParagraph(edit);
  return ownBandKeyInputs(paragraph, layoutContext(part));
}

describe('own band key inputs', () => {
  test('a column-framed band is framed by neither axis of the page', () => {
    expect(inputs((xml) => xml)).toMatchObject({
      anchorsTopAndBottom: true,
      ownBandPageFramed: false,
      ownBandPageFramedHorizontally: false,
    });
  });

  test('a margin-framed horizontal position keys the page horizontally', () => {
    const framed = inputs((xml) =>
      xml.replace('<wp:positionH relativeFrom="column">', '<wp:positionH relativeFrom="margin">')
    );
    expect(framed.ownBandPageFramedHorizontally).toBe(true);
    expect(framed.ownBandPageFramed).toBe(false);
  });

  test('simplePos is page coordinates on both axes', () => {
    const simple = inputs((xml) =>
      xml
        .replace('simplePos="0"', 'simplePos="1"')
        .replace('<wp:simplePos x="0" y="0"/>', '<wp:simplePos x="914400" y="914400"/>')
    );
    expect(simple).toMatchObject({ ownBandPageFramed: true, ownBandPageFramedHorizontally: true });
  });
});

describe('own band key inputs per layout context', () => {
  test('a context that projects no anchor does not hide the band from another context', () => {
    const { part, paragraph } = topAndBottomParagraph();
    const context = layoutContext(part);
    const noAnchor = { ...context, projectionForAtom: () => null, project: () => null };
    expect(ownBandKeyInputs(paragraph, noAnchor).anchorsTopAndBottom).toBe(false);
    expect(ownBandKeyInputs(paragraph, context).anchorsTopAndBottom).toBe(true);
  });
});

describe('the break key of a horizontally page-framed band', () => {
  const key = (framed: boolean, frameMarginLeft: number, pageNumber: number) =>
    bodyParagraphBreakKey('k', {
      exclusionToken: '',
      paragraphStartY: 100,
      anchorsTopAndBottom: true,
      ownBandPageFramedHorizontally: framed,
      frameMarginLeft,
      pageNumber,
      columnIndex: 0,
      startOffset: 0,
    });

  test('mirrored margins: odd and even pages, and different margins, key apart', () => {
    expect(key(true, 72, 1)).not.toBe(key(true, 72, 2));
    expect(key(true, 72, 1)).not.toBe(key(true, 90, 1));
    expect(key(true, 72, 1)).toBe(key(true, 72, 3));
  });

  test('a column-framed band keeps one key on every page', () => {
    expect(key(false, 72, 1)).toBe(key(false, 90, 2));
  });
});
