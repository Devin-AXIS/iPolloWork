// The anchored drawings of a header or footer stack by `wp:anchor/@relativeHeight` within each
// layer, as they do in the body. Document order decides only between equal ranks. A picture
// watermark (`v:shape` with a negative `z-index`) and a behind-text DrawingML picture in one
// header are the common case: the higher rank paints last, so an opaque watermark hides the
// picture under it.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';
const W10 = 'urn:schemas-microsoft-com:office:word';
const EMU = 12700;
const CONTENT_WIDTH = 451;

/** A picture anchored on the margin box, centered on both axes, without wrap. */
function marginCenteredPicture(options: {
  readonly id: number;
  readonly widthPt: number;
  readonly relativeHeight: number;
  readonly behind: boolean;
}): string {
  const cx = options.widthPt * EMU;
  const cy = 40 * EMU;
  return (
    '<w:r><w:drawing>' +
    `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="${options.relativeHeight}" ` +
    `behindDoc="${options.behind ? 1 : 0}" locked="0" layoutInCell="0" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH>' +
    '<wp:positionV relativeFrom="margin"><wp:align>center</wp:align></wp:positionV>' +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:wrapNone/><wp:docPr id="${options.id}" name="Picture ${options.id}"/>` +
    `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="${options.id}" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  );
}

/** A VML picture watermark with washout on, as a header stores it. */
function vmlPictureWatermark(options: { readonly widthPt: number; readonly zIndex: number }) {
  return (
    '<w:r><w:pict>' +
    '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" ' +
    'path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/>' +
    '<v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/>' +
    '<o:lock v:ext="edit" aspectratio="t"/></v:shapetype>' +
    '<v:shape id="WordPictureWatermark1" o:spid="_x0000_s2049" type="#_x0000_t75" ' +
    `style="position:absolute;margin-left:0;margin-top:0;width:${options.widthPt}pt;height:50pt;` +
    `z-index:${options.zIndex};mso-position-horizontal:center;mso-position-horizontal-relative:margin;` +
    'mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f">' +
    '<v:imagedata r:id="rId1" o:title="mark" gain="19661f" blacklevel="22938f"/>' +
    '<w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>'
  );
}

function layoutStory(kind: 'header' | 'footer', runs: string) {
  const tag = kind === 'header' ? 'hdr' : 'ftr';
  const owner = `/word/${kind}1.xml`;
  const part = load(
    `<w:${tag} xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" ` +
      `xmlns:r="${R}" xmlns:v="${V}" xmlns:o="${O}" xmlns:w10="${W10}">` +
      `<w:p>${runs}<w:r><w:t>Running head</w:t></w:r></w:p></w:${tag}>`,
    owner
  );
  return layoutHeaderFooterStory(
    part,
    CONTENT_WIDTH,
    createFixedMeasurer(6, 14),
    'test',
    undefined,
    undefined,
    undefined,
    128,
    undefined,
    undefined,
    layoutContext(part, owner),
    undefined,
    undefined,
    {
      pageNumber: 1,
      pageWidth: 595,
      pageHeight: 842,
      marginLeft: 72,
      marginRight: 72,
      marginTop: 85,
      marginBottom: 72,
    }
  );
}

/** Widths identify the drawings; the story lists them in the order they paint. */
function paintedWidths(kind: 'header' | 'footer', runs: string): number[] {
  const story = layoutStory(kind, runs);
  return (story.anchoredDrawings ?? []).map((drawing) => Math.round(drawing.width));
}

describe('header and footer drawings stack by relativeHeight', () => {
  for (const kind of ['header', 'footer'] as const) {
    test(`a ${kind} paints a lower rank first, whatever the document order`, () => {
      const runs =
        marginCenteredPicture({ id: 1, widthPt: 300, relativeHeight: 2048, behind: true }) +
        marginCenteredPicture({ id: 2, widthPt: 200, relativeHeight: 1024, behind: true }) +
        marginCenteredPicture({ id: 3, widthPt: 100, relativeHeight: 512, behind: false });
      // Behind-text drawings come first, then in-front ones, each layer by rank.
      expect(paintedWidths(kind, runs)).toEqual([200, 300, 100]);
    });
  }

  test('equal ranks keep document order', () => {
    // Enough runs before the pictures that their node ids do not sort as text does.
    const runs =
      '<w:r><w:t>x</w:t></w:r>'.repeat(9) +
      marginCenteredPicture({ id: 1, widthPt: 300, relativeHeight: 1024, behind: true }) +
      marginCenteredPicture({ id: 2, widthPt: 200, relativeHeight: 1024, behind: true });
    expect(paintedWidths('header', runs)).toEqual([300, 200]);
  });

  test('a picture watermark paints over a behind-text picture of a lower rank', () => {
    // The behind-text VML `z-index` -251610112 ranks above relativeHeight 251703296, so the
    // watermark paints last.
    const runs =
      vmlPictureWatermark({ widthPt: 360, zIndex: -251610112 }) +
      marginCenteredPicture({ id: 2, widthPt: 280, relativeHeight: 251703296, behind: true });
    expect(paintedWidths('header', runs)).toEqual([280, 360]);
  });
});
