// Frame edits on shapes, lines and groups, and on drawings whose `wp:anchor/@locked` is set.
// A shape moves, deletes and takes alt text; its size also lives in its own geometry, so a
// resize is refused. `locked` fixes only the anchor paragraph, never the frame edits.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  validateOoxmlPart,
  type OoxmlDrawingNode,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  DEFAULT_SUPPORTED_MC_REQUIRES,
  projectDrawing,
} from '../package/drawing-projection.ts';
import { applyTreeOp, type TreeDocOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

const SHAPE =
  `<a:graphicData uri="${WPS}"><wps:wsp><wps:cNvSpPr/><wps:spPr>` +
  '<a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '<a:solidFill><a:srgbClr val="FFE699"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>' +
  '</a:graphicData>';
const LINE =
  `<a:graphicData uri="${WPS}"><wps:wsp><wps:cNvCnPr/><wps:spPr>` +
  '<a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="0"/></a:xfrm>' +
  '<a:prstGeom prst="line"><a:avLst/></a:prstGeom>' +
  '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr>' +
  '<wps:bodyPr/></wps:wsp></a:graphicData>';
const GROUP =
  `<a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm>` +
  '<a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/>' +
  '<a:chOff x="0" y="0"/><a:chExt cx="914400" cy="457200"/></a:xfrm></wpg:grpSpPr>' +
  '<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/>' +
  '<a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '<a:solidFill><a:srgbClr val="9DC3E6"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>' +
  '</wpg:wgp></a:graphicData>';
/** A group whose only member is a frame the shape projection does not read. */
const OPAQUE_GROUP =
  `<a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr/>` +
  '<wpg:graphicFrame><wpg:cNvPr id="9" name="Frame"/><wpg:cNvFrPr/><wpg:xfrm/>' +
  '<a:graphic><a:graphicData uri="urn:example:opaque"/></a:graphic></wpg:graphicFrame>' +
  '</wpg:wgp></a:graphicData>';
const PICTURE =
  `<a:graphicData uri="${PIC}"><pic:pic>` +
  '<pic:nvPicPr><pic:cNvPr id="7" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId15"/></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="914400" cy="914400"/></a:xfrm>' +
  '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData>';

function anchored(graphicData: string, options: { locked?: boolean; frameLocks?: string } = {}) {
  return (
    '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    `relativeHeight="2" behindDoc="1" locked="${options.locked ? 1 : 0}" layoutInCell="1" ` +
    'allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="457200"/><wp:wrapNone/>' +
    '<wp:docPr id="7" name="Background"/>' +
    `<wp:cNvGraphicFramePr>${options.frameLocks ?? ''}</wp:cNvGraphicFramePr>` +
    `<a:graphic>${graphicData}</a:graphic></wp:anchor></w:drawing>`
  );
}

function documentWith(run: string): OoxmlPart {
  const xml =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" ` +
    `xmlns:r="${R}" xmlns:wps="${WPS}" xmlns:wpg="${WPG}" xmlns:mc="${MC}">` +
    `<w:body><w:p><w:r>${run}</w:r><w:r><w:t>Text</w:t></w:r></w:p></w:body></w:document>`;
  const result = readOoxmlPart(xml, metadata);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** The first node `match` accepts, depth first. */
function find(node: OoxmlNode, match: (node: OoxmlElement) => boolean): OoxmlElement | null {
  if (node.kind === 'textValue') return null;
  if (match(node)) return node;
  for (const child of node.children) {
    const found = find(child, match);
    if (found) return found;
  }
  return null;
}

const drawingOf = (part: OoxmlPart) => find(part.root, (node) => node.kind === 'drawing')!;
const named = (localName: string) => (node: OoxmlElement) => node.localName === localName;

function outcome(part: OoxmlPart, op: TreeDocOp): string {
  const result = applyTreeOp(part, op);
  if (!result.ok) return result.reason;
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  return 'ok';
}

const frameEdits = (drawingNodeId: string): Record<string, TreeDocOp> => ({
  position: {
    op: 'positionDrawing',
    drawingNodeId,
    position: { verticalEmu: 254000, relativeToV: 'paragraph' },
  },
  metadata: { op: 'setDrawingMetadata', drawingNodeId, title: 'Band', description: 'Band' },
  delete: { op: 'deleteDrawing', drawingNodeId },
  resize: { op: 'resizeDrawing', drawingNodeId, extentEmu: { cx: 1828800, cy: 457200 } },
  crop: {
    op: 'cropDrawing',
    drawingNodeId,
    crop: { left: 1000, top: 0, right: 0, bottom: 0 },
  },
});

describe('shape frame edits', () => {
  test.each([
    ['a shape', SHAPE],
    ['a line', LINE],
    ['a group', GROUP],
    ['a group whose members do not project', OPAQUE_GROUP],
  ])('%s moves, deletes and takes alt text, and refuses a resize or crop', (_, graphic) => {
    const part = documentWith(anchored(graphic));
    const edits = frameEdits(drawingOf(part).id);
    expect(outcome(part, edits.position!)).toBe('ok');
    expect(outcome(part, edits.metadata!)).toBe('ok');
    expect(outcome(part, edits.delete!)).toBe('ok');
    expect(outcome(part, edits.resize!)).toBe('not-a-picture-drawing');
    expect(outcome(part, edits.crop!)).toBe('not-a-picture-drawing');
  });

  test('a shape in markup compatibility content deletes with its fallback', () => {
    const drawing = anchored(SHAPE);
    const part = documentWith(
      `<mc:AlternateContent><mc:Choice Requires="wps">${drawing}</mc:Choice>` +
        `<mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent>`
    );
    const atom = find(part.root, named('AlternateContent'))!;
    const result = applyTreeOp(part, { op: 'deleteDrawing', drawingNodeId: atom.id });
    if (!result.ok) throw new Error(result.reason);
    expect(find(result.part.root, named('AlternateContent'))).toBeNull();
    expect(find(result.part.root, named('pict'))).toBeNull();
    expect(find(result.part.root, named('t'))).not.toBeNull();
  });

  test('frame locks still refuse the edits they name', () => {
    const part = documentWith(anchored(SHAPE, { frameLocks: '<a:graphicFrameLocks noMove="1"/>' }));
    const edits = frameEdits(drawingOf(part).id);
    expect(outcome(part, edits.position!)).toBe('drawing-locked');
    expect(outcome(part, edits.delete!)).toBe('ok');
  });

  test('locks on the shape itself refuse the edits they name, as frame locks do', () => {
    const shape = documentWith(
      anchored(
        SHAPE.replace('<wps:cNvSpPr/>', '<wps:cNvSpPr><a:spLocks noMove="1"/></wps:cNvSpPr>')
      )
    );
    const shapeEdits = frameEdits(drawingOf(shape).id);
    expect(outcome(shape, shapeEdits.position!)).toBe('drawing-locked');
    expect(outcome(shape, shapeEdits.delete!)).toBe('ok');
    const group = documentWith(
      anchored(
        GROUP.replace(
          '<wpg:cNvGrpSpPr/>',
          '<wpg:cNvGrpSpPr><a:grpSpLocks noSelect="1"/></wpg:cNvGrpSpPr>'
        )
      )
    );
    const groupEdits = frameEdits(drawingOf(group).id);
    expect(outcome(group, groupEdits.delete!)).toBe('drawing-locked');
    const line = documentWith(
      anchored(
        LINE.replace('<wps:cNvCnPr/>', '<wps:cNvCnPr><a:cxnSpLocks noMove="1"/></wps:cNvCnPr>')
      )
    );
    expect(outcome(line, frameEdits(drawingOf(line).id).position!)).toBe('drawing-locked');
  });

  test('the projection reads the shape locks merged with the frame locks', () => {
    const part = documentWith(
      anchored(
        SHAPE.replace('<wps:cNvSpPr/>', '<wps:cNvSpPr><a:spLocks noResize="1"/></wps:cNvSpPr>'),
        { frameLocks: '<a:graphicFrameLocks noMove="1"/>' }
      )
    );
    const projection = projectDrawing(drawingOf(part) as OoxmlDrawingNode, {
      ownerPartName: '/word/document.xml',
      supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
      limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    });
    expect(projection.locks).toEqual({
      select: false,
      move: true,
      resize: true,
      changeAspect: false,
    });
  });
});

describe('an anchor locked to its paragraph', () => {
  test('still moves, resizes and deletes', () => {
    const part = documentWith(anchored(PICTURE, { locked: true }));
    const edits = frameEdits(drawingOf(part).id);
    expect(outcome(part, edits.position!)).toBe('ok');
    expect(outcome(part, edits.resize!)).toBe('ok');
    expect(outcome(part, edits.delete!)).toBe('ok');
  });
});
