import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { collectTextMatches } from '../document-search.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const SYMBOL = '<w:sym w:font="Wingdings" w:char="F0FC"/>';
const DRAWING =
  '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
  'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="914400" cy="457200"/><wp:wrapNone/><wp:docPr id="1" name="Shape"/>' +
  `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp><wps:spPr>` +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr><wps:bodyPr/>' +
  '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';

function search(content: string, query: string) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}">` +
      `<w:body><w:p>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return collectTextMatches(parsed.part, query).matches;
}

const CONTENT =
  '<w:r><w:t>co</w:t><w:softHyphen/><w:t>op</w:t></w:r>' +
  DRAWING +
  `<w:r><w:t>tail</w:t>${SYMBOL}<w:t>end</w:t><w:noBreakHyphen/><w:t>piece</w:t></w:r>`;

test('search joins an optional hyphen but never crosses a floating drawing', () => {
  expect(search(CONTENT, 'coop')).toMatchObject([{ start: 0, length: 5 }]);
  expect(search(CONTENT, 'cooptail')).toHaveLength(0);
  expect(search(CONTENT, 'optail')).toHaveLength(0);
  expect(search(CONTENT, 'tail')).toMatchObject([{ start: 6, length: 4 }]);
});

test('symbols remain search barriers after a floating drawing and an optional hyphen', () => {
  expect(search(CONTENT, 'tailend')).toHaveLength(0);
  expect(search(CONTENT, 'tail(end')).toHaveLength(0);
  expect(search(CONTENT, '(')).toHaveLength(0);
  expect(search(CONTENT, 'end\u2011piece')).toMatchObject([{ start: 11, length: 9 }]);
  expect(search(CONTENT, 'piece')).toMatchObject([{ start: 15, length: 5 }]);
});

test('a literal parenthesis remains searchable beside a symbol after a floating drawing', () => {
  const content = DRAWING + `<w:r>${SYMBOL}<w:t>(co</w:t><w:softHyphen/><w:t>op)</w:t></w:r>`;
  expect(search(content, '(coop)')).toMatchObject([{ start: 2, length: 7 }]);
  expect(search(content, '((coop)')).toHaveLength(0);
});
