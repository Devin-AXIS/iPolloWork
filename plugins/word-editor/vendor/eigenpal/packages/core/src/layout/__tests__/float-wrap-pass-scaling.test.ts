// Wrap reflow passes must not grow with the document. Pictures positioned against their
// paragraph move whenever the text before them moves. A pass that reads their zones only from
// the previous pass repairs about one page of such a move, so opening a document with many
// pictures, or a page break above them, took a pass count that grew with the page count, each
// pass a full layout.

import { describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { createLayoutSession } from '../layout-session.ts';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  observeExclusionLayoutPassesForTest,
} from '../semantic-layout.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU_PER_PT = 12700;
const COMPATIBILITY_MODE = 15;

const measurer = createFixedMeasurer(6, 14);

/** `count` paragraphs, each with a square-wrapped picture at its top and some text. */
function picturesDocument(count: number): string {
  const paragraphs: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = index + 1;
    const x = (index % 3) * 150 * EMU_PER_PT;
    const size = 90 * EMU_PER_PT;
    paragraphs.push(
      '<w:p><w:r><w:drawing>' +
        `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="${id}">` +
        '<wp:simplePos x="0" y="0"/>' +
        `<wp:positionH relativeFrom="column"><wp:posOffset>${x}</wp:posOffset></wp:positionH>` +
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        `<wp:extent cx="${size}" cy="${size}"/>` +
        '<wp:wrapSquare wrapText="bothSides"/>' +
        `<wp:docPr id="${id}" name="pic ${id}"/>` +
        `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
        '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        `<pic:spPr><a:xfrm><a:ext cx="${size}" cy="${size}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
        '</wp:anchor></w:drawing></w:r>' +
        `<w:r><w:t>${'words of text '.repeat(20)}</w:t></w:r></w:p>`
    );
  }
  return (
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    `<w:body>${paragraphs.join('')}</w:body></w:document>`
  );
}

/** The part with a page-break paragraph first, keeping every other node id. */
function withLeadingPageBreak(part: OoxmlPart): OoxmlPart {
  const lead = load(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r><w:br w:type="page"/></w:r></w:p></w:body></w:document>`,
    '/word/lead.xml'
  );
  const find = (node: OoxmlNode): OoxmlNode | undefined =>
    node.kind === 'textValue'
      ? undefined
      : node.localName === 'p'
        ? node
        : node.children.map(find).find(Boolean);
  const paragraph = find(lead.root)!;
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (node.localName === 'body') return { ...node, children: [paragraph, ...node.children] };
    return { ...node, children: node.children.map(visit) };
  };
  return { ...part, root: visit(part.root) as OoxmlPart['root'] };
}

function countPasses<T>(run: () => T): { result: T; passes: number } {
  let passes = 0;
  const stop = observeExclusionLayoutPassesForTest(() => {
    passes += 1;
  });
  try {
    return { result: run(), passes };
  } finally {
    stop();
  }
}

const layout = (
  part: OoxmlPart,
  revision: number,
  session?: ReturnType<typeof createLayoutSession>
) =>
  layoutSemanticDocument(part, revision, {
    measurer,
    compatibilityMode: COMPATIBILITY_MODE,
    inlineDrawingLayout: layoutContext(part),
    ...(session ? { session } : {}),
  });

/** Opens `count` pictures, then inserts a page break above them in the same session. */
function openThenBreak(count: number) {
  const part = load(picturesDocument(count));
  const session = createLayoutSession();
  const open = countPasses(() => layout(part, 1, session));
  const edited = withLeadingPageBreak(part);
  const edit = countPasses(() => layout(edited, 2, session));
  return { open, edit, edited };
}

describe('wrap reflow pass count', () => {
  test('does not grow with the page count', () => {
    const small = openThenBreak(24);
    const large = openThenBreak(96);
    expect(large.open.result.pages.length).toBeGreaterThanOrEqual(
      small.open.result.pages.length * 3
    );
    // Before: 6 and 18 passes to open, and the same again for the page break.
    expect(large.open.passes).toBeLessThanOrEqual(small.open.passes);
    expect(large.edit.passes).toBeLessThanOrEqual(small.edit.passes);
    expect(large.edit.passes).toBeLessThanOrEqual(3);
  }, 60_000);

  test('lays a page break above many pictures out as a fresh layout does', () => {
    const { edit, edited } = openThenBreak(24);
    expect(edit.result.pages).toEqual(layout(edited, 2).pages);
  }, 60_000);
});
