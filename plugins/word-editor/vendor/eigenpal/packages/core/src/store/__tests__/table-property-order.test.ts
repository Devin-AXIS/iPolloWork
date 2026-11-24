// Table, row, and cell property containers open and save the way the schema allows.
//
// `CT_TblPr`, `CT_TcPr`, and `CT_TblPrEx` are strict sequences. `CT_TrPr` is a choice
// followed by its revision marks. Two collaborators who each give one row or cell a property
// at once can leave the row with two `w:trPr`, the cell with two `w:tcPr`, or one `w:tcPr`
// with two `w:vAlign`, which the schema does not allow. The reader and the serializer merge
// those into one container in schema order, as reference renderings do: a later copy
// replaces a property an earlier one states, and adds the ones it alone states.

import { expect, test } from 'bun:test';
import { canonicalOoxmlFingerprint } from '../package/ooxml-serialize.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function read(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const opened = (row: string): OoxmlPart =>
  read(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body><w:tbl><w:tblPr>` +
      '<w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
      `${row}</w:tbl><w:p/></w:body></w:document>`
  );

/** The first element named `localName` below `node`, in document order. */
function find(node: OoxmlElement, localName: string): OoxmlElement {
  const search = (at: OoxmlNode): OoxmlElement | null => {
    if (at.kind === 'textValue') return null;
    if (at !== node && at.localName === localName) return at;
    for (const child of at.children) {
      const found = search(child);
      if (found) return found;
    }
    return null;
  };
  const found = search(node);
  if (!found) throw new Error(`no ${localName}`);
  return found;
}

const names = (element: OoxmlElement): string[] =>
  element.children.flatMap((child) => (child.kind === 'textValue' ? [] : [child.localName]));

const cell = (tcPr: string) => `<w:tc>${tcPr}<w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>`;

/** `part` saved and reopened has the fingerprint it opened with. */
function expectStable(part: OoxmlPart): void {
  expect(canonicalOoxmlFingerprint(read(serializeOoxmlPart(part)))).toBe(
    canonicalOoxmlFingerprint(part)
  );
}

test('table, row, and cell properties open in schema order', () => {
  const part = read(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblLook w:val="04A0"/>` +
      '<w:tblW w:w="0" w:type="auto"/><w:tblStyle w:val="TableGrid"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr>' +
      '<w:tblPrEx><w:tblLook w:val="04A0"/><w:jc w:val="center"/></w:tblPrEx>' +
      '<w:trPr><w:trPrChange w:id="1" w:author="A"><w:trPr/></w:trPrChange>' +
      '<w:tblHeader/></w:trPr>' +
      cell(
        '<w:tcPr><w:vAlign w:val="center"/><w:shd w:val="clear" w:fill="FF0000"/>' +
          '<w:tcW w:w="3000" w:type="dxa"/></w:tcPr>'
      ) +
      '</w:tr></w:tbl><w:p/></w:body></w:document>'
  );
  expect(names(find(part.root, 'tblPr'))).toEqual(['tblStyle', 'tblW', 'tblLook']);
  expect(names(find(part.root, 'tblPrEx'))).toEqual(['jc', 'tblLook']);
  expect(names(find(part.root, 'trPr'))).toEqual(['tblHeader', 'trPrChange']);
  expect(names(find(part.root, 'tcPr'))).toEqual(['tcW', 'shd', 'vAlign']);
  expectStable(part);
});

test('a row with two w:trPr opens and saves with one', () => {
  const part = opened(
    '<w:tr><w:trPr><w:trHeight w:val="400"/></w:trPr><w:trPr><w:tblHeader/>' +
      '<w:trHeight w:val="900"/></w:trPr>' +
      cell('') +
      '</w:tr>'
  );
  const row = find(part.root, 'tr');
  expect(names(row)).toEqual(['trPr', 'tc']);
  const trPr = find(row, 'trPr');
  // The later copy replaces the height both state, and adds the header row it alone states.
  expect(names(trPr)).toEqual(['trHeight', 'tblHeader']);
  expect(serializeOoxmlPart(part)).toContain(
    '<w:trPr><w:trHeight w:val="900"/><w:tblHeader/></w:trPr>'
  );
  expectStable(part);
});

test('a cell with two w:tcPr, or one w:tcPr with two w:vAlign, keeps the last of each', () => {
  const part = opened(
    '<w:tr>' +
      cell(
        '<w:tcPr><w:vAlign w:val="bottom"/></w:tcPr><w:tcPr><w:shd w:val="clear" ' +
          'w:fill="FF0000"/><w:vAlign w:val="center"/></w:tcPr>'
      ) +
      cell('<w:tcPr><w:vAlign w:val="bottom"/><w:vAlign w:val="center"/></w:tcPr>') +
      '</w:tr>'
  );
  const xml = serializeOoxmlPart(part);
  expect(xml).toContain(
    '<w:tc><w:tcPr><w:shd w:fill="FF0000" w:val="clear"/><w:vAlign w:val="center"/></w:tcPr>'
  );
  expect(xml).toContain('<w:tc><w:tcPr><w:vAlign w:val="center"/></w:tcPr>');
  expect(xml).not.toContain('w:val="bottom"');
  expectStable(part);
});

test('a repeated row property is valid and stays, and an extension keeps its slot', () => {
  const part = opened(
    '<w:tr><w:trPr><w:trHeight w:val="400"/><w:cantSplit/><w:trHeight w:val="900"/></w:trPr>' +
      cell(
        '<w:tcPr><w:vAlign w:val="center"/><w14:paraId w14:val="1"/><w:tcW w:w="3000" ' +
          'w:type="dxa"/></w:tcPr>'
      ) +
      '</w:tr>'
  );
  expect(names(find(part.root, 'trPr'))).toEqual(['cantSplit', 'trHeight', 'trHeight']);
  expect(names(find(part.root, 'tcPr'))).toEqual(['tcW', 'paraId', 'vAlign']);
  expectStable(part);
});

test('a later copy replaces the last repeat a first w:trPr holds', () => {
  const part = opened(
    '<w:tr><w:trPr><w:trHeight w:val="100"/><w:trHeight w:val="200"/></w:trPr>' +
      '<w:trPr><w:trHeight w:val="300"/></w:trPr>' +
      cell('') +
      '</w:tr>'
  );
  expect(serializeOoxmlPart(part)).toContain(
    '<w:trPr><w:trHeight w:val="100"/><w:trHeight w:val="300"/></w:trPr>'
  );
  expectStable(part);
});

test('a tree a merge left with two w:trPr saves with one', () => {
  const part = opened('<w:tr><w:trPr><w:trHeight w:val="400"/></w:trPr>' + cell('') + '</w:tr>');
  const row = find(part.root, 'tr');
  const trPr = find(row, 'trPr');
  const second: OoxmlElement = {
    ...trPr,
    id: `${trPr.id}-peer`,
    children: [
      { ...trPr.children[0]!, id: `${trPr.id}-peer-h`, localName: 'tblHeader', attributes: [] },
    ],
  } as OoxmlElement;
  const swap = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (node === row) return { ...node, children: [trPr, second, ...node.children.slice(1)] };
    return { ...node, children: node.children.map(swap) };
  };
  const merged = { ...part, root: swap(part.root) as OoxmlElement };
  expect(names(find(merged.root, 'tr'))).toEqual(['trPr', 'trPr', 'tc']);
  expect(serializeOoxmlPart(merged)).toContain(
    '<w:tr><w:trPr><w:trHeight w:val="400"/><w:tblHeader/></w:trPr><w:tc>'
  );
});

test('repeated revision markup stays as authored, for the revision walks to refuse', () => {
  const change = '<w:tcPrChange w:id="1" w:author="A"><w:tcPr/></w:tcPrChange>';
  const part = opened(
    '<w:tr>' +
      cell(`<w:tcPr><w:vAlign w:val="center"/>${change}${change}</w:tcPr>`) +
      cell(
        `<w:tcPr>${change}</w:tcPr>` +
          `<w:tcPr><w:shd w:val="clear" w:fill="FF0000"/>${change}</w:tcPr>`
      ) +
      '</w:tr>'
  );
  const [first, second] = find(part.root, 'tr').children.filter(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'tc'
  );
  expect(names(find(first!, 'tcPr'))).toEqual(['vAlign', 'tcPrChange', 'tcPrChange']);
  expect(names(second!)).toEqual(['tcPr', 'tcPr', 'p']);
  expectStable(part);
});
