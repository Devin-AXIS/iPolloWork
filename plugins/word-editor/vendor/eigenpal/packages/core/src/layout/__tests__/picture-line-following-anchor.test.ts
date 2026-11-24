import { expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { layoutContext, load } from './anchored-drawing-test-fixtures.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU = 12700;
const graphic = (width: number, height: number) =>
  `<wp:extent cx="${width * EMU}" cy="${height * EMU}"/><wp:docPr id="1" name="pic"/><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="${width * EMU}" cy="${height * EMU}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
const spacing = '<w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr>';

test('a picture line under an auto multiple probes its published height against the next anchor', () => {
  const inline = `<w:p>${spacing}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">${graphic(300, 36)}</wp:inline></w:drawing></w:r></w:p>`;
  const anchored = `<w:p>${spacing}<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" allowOverlap="1" layoutInCell="1" relativeHeight="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${150 * EMU}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>${graphic(100, 100).replace('<wp:docPr', '<wp:wrapSquare wrapText="bothSides"/><wp:docPr')}</wp:anchor></w:drawing></w:r></w:p>`;
  const part = load(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body>${inline}${anchored}<w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>`
  );
  const layout = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    inlineDrawingLayout: layoutContext(part),
  });
  const [picture, anchor] = paragraphFragmentsOf(layout.pages[0]!);
  // The picture line is 36 pt plus half a text band; its after spacing reaches the anchored
  // picture's top exactly, so the line does not move below that picture.
  const line = picture!.lines[0]!;
  expect(line.box.y).toBe(0);
  expect(line.box.height).toBeLessThan(36 * 1.5);
  expect(anchor!.box.y).toBeCloseTo(line.box.height + 8, 6);
});
