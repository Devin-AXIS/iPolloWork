// A pass reads the zones of the pictures it has already placed from the pass itself
// (`live-exclusion-zones.ts`). That only changes how fast the passes settle, never where they
// settle: every layout here, on open and after each edit in one session, must equal a fresh
// layout that reads every zone from the previous pass.

import { describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { createLayoutSession } from '../layout-session.ts';
import { disableLiveExclusionZonesForTest } from '../live-exclusion-zones.ts';

function withoutLiveExclusionZonesForTest<T>(run: () => T): T {
  const restore = disableLiveExclusionZonesForTest();
  try {
    return run();
  } finally {
    restore();
  }
}
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU_PER_PT = 12700;

const measurer = createFixedMeasurer(6, 14);
const TEXT = 'words of text '.repeat(20);

let nextPicture = 1;
/** A square-wrapped picture run, placed against its paragraph or against the page. */
function picture(options: {
  x: number;
  size?: number;
  page?: boolean;
  outsideCell?: boolean;
}): string {
  const id = nextPicture++;
  const size = (options.size ?? 90) * EMU_PER_PT;
  const vertical = options.page
    ? `<wp:positionV relativeFrom="page"><wp:posOffset>${200 * EMU_PER_PT}</wp:posOffset></wp:positionV>`
    : '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>';
  return (
    '<w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="${options.outsideCell ? 0 : 1}" relativeHeight="${id}">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="column"><wp:posOffset>${options.x * EMU_PER_PT}</wp:posOffset></wp:positionH>` +
    vertical +
    `<wp:extent cx="${size}" cy="${size}"/>` +
    '<wp:wrapSquare wrapText="bothSides"/>' +
    `<wp:docPr id="${id}" name="pic ${id}"/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:ext cx="${size}" cy="${size}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
    '</wp:anchor></w:drawing></w:r>'
  );
}

const paragraph = (runs: string, properties = '', text = TEXT): string =>
  `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${runs}<w:r><w:t>${text}</w:t></w:r></w:p>`;

/**
 * `count` paragraphs with a picture each, spread over `width`. Every `pageEvery`th picture is
 * placed on the page. A picture taller than its paragraph wraps the next paragraphs too.
 */
function pictureParagraphs(
  count: number,
  options: { pageEvery?: number; width?: number; size?: number; text?: string } = {}
): string[] {
  const { pageEvery = 0, width = 150, size = width / 2, text = TEXT } = options;
  const out: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const page = pageEvery > 0 && index % pageEvery === pageEvery - 1;
    out.push(paragraph(picture({ x: (index % 3) * (width / 3), size, page }), '', text));
  }
  return out;
}

const document = (body: string, sectionProperties = ''): string =>
  `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
  `<w:body>${body}${sectionProperties ? `<w:sectPr>${sectionProperties}</w:sectPr>` : ''}</w:body></w:document>`;

/** A table whose repeated header row holds a picture, then rows with pictures of their own. */
function tableWithHeaderPicture(rows: number): string {
  const cell = (content: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
  const header =
    '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
    cell(paragraph(picture({ x: 0, size: 120, outsideCell: true }))) +
    cell('<w:p><w:r><w:t>head</w:t></w:r></w:p>') +
    '</w:tr>';
  const body: string[] = [];
  for (let index = 0; index < rows; index += 1)
    body.push(
      '<w:tr>' +
        cell(paragraph(index % 2 ? picture({ x: 0, size: 40 }) : '')) +
        cell(paragraph('')) +
        '</w:tr>'
    );
  return (
    '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>' +
    `${header}${body.join('')}</w:tbl>`
  );
}

const firstOf = (node: OoxmlNode, localName: string): OoxmlNode | undefined =>
  node.kind === 'textValue'
    ? undefined
    : node.localName === localName
      ? node
      : node.children.map((child) => firstOf(child, localName)).find(Boolean);

/** The part with a page-break paragraph first, keeping every other node id. */
function withLeadingPageBreak(part: OoxmlPart): OoxmlPart {
  const lead = load(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r><w:br w:type="page"/></w:r></w:p></w:body></w:document>`,
    '/word/lead.xml'
  );
  const inserted = firstOf(lead.root, 'p')!;
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (node.localName === 'body') return { ...node, children: [inserted, ...node.children] };
    return { ...node, children: node.children.map(visit) };
  };
  return { ...part, root: visit(part.root) as OoxmlPart['root'] };
}

/** The part with the text of its `nth` text node doubled, keeping every node id. */
function withLongerText(part: OoxmlPart, nth: number): OoxmlPart {
  let seen = -1;
  const visit = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') {
      seen += 1;
      return seen === nth ? { ...node, value: node.value + node.value } : node;
    }
    return { ...node, children: node.children.map(visit) };
  };
  return { ...part, root: visit(part.root) as OoxmlPart['root'] };
}

const layout = (
  part: OoxmlPart,
  revision: number,
  session?: ReturnType<typeof createLayoutSession>
) =>
  layoutSemanticDocument(part, revision, {
    measurer,
    compatibilityMode: 15,
    inlineDrawingLayout: layoutContext(part),
    ...(session ? { session } : {}),
  });

/**
 * Opens `xml`, applies each edit in the same session, and checks the open and each edit against
 * a fresh layout that reads every zone from the previous pass.
 */
function expectEditsMatchFresh(
  xml: string,
  edits: readonly ((part: OoxmlPart) => OoxmlPart)[]
): number {
  let part = load(xml);
  const session = createLayoutSession();
  const open = layout(part, 1, session).pages;
  expect(open).toEqual(withoutLiveExclusionZonesForTest(() => layout(part, 1).pages));
  for (const [index, edit] of edits.entries()) {
    part = edit(part);
    const revision = index + 2;
    const fresh = withoutLiveExclusionZonesForTest(() => layout(part, revision).pages);
    expect(layout(part, revision, session).pages).toEqual(fresh);
  }
  return open.length;
}

const edits = [withLeadingPageBreak, (part: OoxmlPart) => withLongerText(part, 9)];

describe('live wrap zones settle where the previous pass zones settle', () => {
  test('in two columns', () => {
    const pages = expectEditsMatchFresh(
      document(
        pictureParagraphs(40, { width: 60, size: 85, text: 'words of text '.repeat(6) }).join(''),
        '<w:cols w:num="2" w:space="720"/>'
      ),
      edits
    );
    expect(pages).toBeGreaterThan(2);
  }, 180_000);

  test('with pictures in table cells and a repeated header row', () => {
    const pages = expectEditsMatchFresh(
      document(
        pictureParagraphs(6).join('') + tableWithHeaderPicture(24) + pictureParagraphs(6).join('')
      ),
      [withLeadingPageBreak]
    );
    expect(pages).toBeGreaterThan(2);
  }, 180_000);

  test('across a continuous section break', () => {
    const pictures = pictureParagraphs(24);
    const breakAt = paragraph(
      '',
      '<w:sectPr><w:type w:val="continuous"/><w:cols w:num="2" w:space="720"/></w:sectPr>'
    );
    const pages = expectEditsMatchFresh(
      document(pictures.slice(0, 12).join('') + breakAt + pictures.slice(12).join('')),
      edits
    );
    expect(pages).toBeGreaterThan(2);
  }, 180_000);

  test('with page-placed pictures among paragraph-placed ones', () => {
    const pages = expectEditsMatchFresh(
      document(pictureParagraphs(30, { pageEvery: 4 }).join('')),
      edits
    );
    expect(pages).toBeGreaterThan(2);
  }, 180_000);

  test('when a session resumes after an edit far down the document', () => {
    const late = (part: OoxmlPart) => withLongerText(part, 50);
    const pages = expectEditsMatchFresh(document(pictureParagraphs(48).join('')), [
      late,
      late,
      withLeadingPageBreak,
    ]);
    expect(pages).toBeGreaterThan(4);
  }, 180_000);
});
