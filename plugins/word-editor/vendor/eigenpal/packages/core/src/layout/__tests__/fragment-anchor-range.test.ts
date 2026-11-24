// Each fragment publishes the anchors its own lines hold.

import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { holdsDrawingIn } from '../body-flow-helpers.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

const drawing =
  '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
  'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset>' +
  '</wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset>' +
  '</wp:positionV><wp:extent cx="914400" cy="914400"/><wp:wrapNone/><wp:docPr id="1" name="A"/>' +
  '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
  '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"/>' +
  '</a:graphic></wp:anchor></w:drawing></w:r>';

function paragraph(content: string): OoxmlElement {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}"><w:body><w:p>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  const body = result.part.root.children.find(
    (node): node is OoxmlElement => node.kind !== 'textValue' && node.localName === 'body'
  )!;
  return body.children.find((node): node is OoxmlElement => node.kind === 'paragraph')!;
}

test('a fragment holds the drawings inside its own model range', () => {
  const p = paragraph(`${drawing}<w:r><w:t>Text</w:t></w:r>${drawing}`);
  expect(holdsDrawingIn(p, { start: 0, end: 3 })).toBe(true);
  expect(holdsDrawingIn(p, { start: 1, end: 5 })).toBe(false);
  expect(holdsDrawingIn(p, { start: 3, end: Infinity })).toBe(true);
});
