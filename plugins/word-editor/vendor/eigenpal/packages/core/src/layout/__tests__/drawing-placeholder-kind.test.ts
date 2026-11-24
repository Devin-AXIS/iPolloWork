// Two file-derived drawing reads that must not be taken at face value.
//
// `graphicData@uri` keys the placeholder label a refused graphic paints. Looked up on an
// object literal, a uri of `constructor` or `__proto__` hands back a prototype member, and
// the card announces a stringified function instead of naming a kind.
//
// A picture's `a:xfrm` flip is `xsd:boolean`, so reading only `1` silently dropped `true`.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlDrawingNode,
  type OoxmlElement,
} from '../../store/package/ooxml-tree.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../../store/package/image-resources.ts';
import { buildInlineDrawingRecord } from '../drawing-layout.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OWNER = '/word/document.xml';

const RESOURCE: ImageResourceState = Object.freeze({ kind: 'missing', partName: null });

function inlineDrawing(): OoxmlDrawingNode {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="pic"/>' +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
    '<pic:nvPicPr><pic:cNvPr id="1" name="pic"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="914400" cy="457200"/></a:xfrm>' +
    '<a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
  const result = readOoxmlPart(xml, {
    name: OWNER,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  const stack: OoxmlElement[] = [result.part.root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    if (node.kind === 'drawing') return node;
    for (const child of node.children) if (child.kind !== 'textValue') stack.push(child);
  }
  throw new Error('missing drawing');
}

/** The record a refused graphic with this `unsupported-graphic` detail lays out to. */
function placeholderKindFor(detail: string): string | null {
  const projection = projectDrawing(inlineDrawing(), {
    ownerPartName: OWNER,
    limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    supportedMcRequires: new Set<string>(),
  })!;
  const record = buildInlineDrawingRecord({
    input: {
      drawingNodeId: 'n1',
      ownerPartName: OWNER,
      // A refused graphic: no picture, and one diagnostic naming the uri that refused.
      projection: {
        ...projection,
        picture: null,
        diagnostics: [{ code: 'unsupported-graphic', nodeId: 'n1', detail }],
      },
      resource: RESOURCE,
    },
    paragraphId: 'p1',
    start: 0,
    slotX: 0,
    y: 0,
    baseline: 0,
    contentLeft: 0,
    contentRight: 500,
  } as Parameters<typeof buildInlineDrawingRecord>[0]);
  return record.placeholderGraphicKind;
}

describe('placeholder graphic kind', () => {
  test('a known uri names the graphic and a prototype member never does', () => {
    expect(placeholderKindFor('http://schemas.openxmlformats.org/drawingml/2006/chart')).toBe(
      'chart'
    );
    expect(
      placeholderKindFor('http://schemas.microsoft.com/office/word/2010/wordprocessingGroup')
    ).toBe('group');
    for (const hostile of ['constructor', '__proto__', 'toString', 'valueOf']) {
      expect(`${hostile}: ${placeholderKindFor(hostile)}`).toBe(`${hostile}: graphic`);
    }
  });

  test('a refused chart reports its graphic uri, so its placeholder names a chart', () => {
    const CHART = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
    const xml =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
      `xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="Chart 1"/>' +
      `<a:graphic><a:graphicData uri="${CHART}">` +
      `<c:chart xmlns:c="${CHART}" r:id="rId9"/></a:graphicData></a:graphic>` +
      '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
    const result = readOoxmlPart(xml, {
      name: OWNER,
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    if (!result.ok) throw new Error(result.reason);
    const [projection] = [...indexInlineDrawingProjectionsInPart(result.part).values()];
    expect(projection!.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported-graphic', detail: CHART })
    );
  });
});

// A picture's `a:xfrm` flip is `xsd:boolean` too, but unlike a vector shape's the engine CAN
// paint it, so the policy differs: a legal true mirrors, and a spelling the schema forbids
// reads as unset rather than refusing and losing the picture.
describe('picture transform flip', () => {
  const flipsFor = (attrs: string): { h: boolean; v: boolean } => {
    const xml =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
      `xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="pic"/>' +
      `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
      '<pic:nvPicPr><pic:cNvPr id="1" name="pic"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      `<pic:spPr><a:xfrm${attrs}><a:ext cx="914400" cy="457200"/></a:xfrm>` +
      '<a:prstGeom prst="rect"/></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic>' +
      '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
    const result = readOoxmlPart(xml, {
      name: OWNER,
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    });
    if (!result.ok) throw new Error(result.reason);
    const projection = [...indexInlineDrawingProjectionsInPart(result.part).values()][0]!;
    const transform = projection.picture!.transform;
    return { h: transform.flipHorizontal, v: transform.flipVertical };
  };

  test('every legal true mirrors and everything else does not', () => {
    expect(flipsFor('')).toEqual({ h: false, v: false });
    for (const set of ['1', 'true', ' 1 ', '\ntrue\n']) {
      expect(`flipH=${JSON.stringify(set)}: ${flipsFor(` flipH="${set}"`).h}`).toBe(
        `flipH=${JSON.stringify(set)}: true`
      );
      expect(`flipV=${JSON.stringify(set)}: ${flipsFor(` flipV="${set}"`).v}`).toBe(
        `flipV=${JSON.stringify(set)}: true`
      );
    }
    for (const unset of ['0', 'false', ' 0 ', 'TRUE', 'True', 'yes', '2', '']) {
      expect(`flipH=${JSON.stringify(unset)}: ${flipsFor(` flipH="${unset}"`).h}`).toBe(
        `flipH=${JSON.stringify(unset)}: false`
      );
    }
    // A schema-invalid flip must not cost the picture itself.
    expect(flipsFor(' flipH="TRUE"')).toEqual({ h: false, v: false });
    expect(flipsFor(' flipH="1" flipV="1"')).toEqual({ h: true, v: true });
  });
});
