// The read rebuilds the shapes that would otherwise hide their content: properties out of
// place or repeated, text holding elements, an insertion inside a run, a stray `w:val`, a
// paragraph written straight into a row, and run content or properties where they apply to
// nothing. Each case saves in its rebuilt shape and reads back the same.
import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { validateOoxmlPart } from '../package/ooxml-validate.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const META = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parse(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    META
  );
  if (!result.ok) throw new Error(`document read failed: ${result.reason}`);
  return result.part;
}

function elements(part: OoxmlPart, localName: string): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === localName) found.push(node);
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return found;
}

function kinds(node: OoxmlNode): string[] {
  if (node.kind === 'textValue') return [];
  return [`${node.localName}:${node.kind}`, ...node.children.flatMap(kinds)];
}

const childKinds = (node: OoxmlElement) =>
  node.children.map((child) =>
    child.kind === 'textValue' ? 'textValue' : `${child.localName}:${child.kind}`
  );

/** The saved body, between `w:body` and its final `w:sectPr`. */
function savedBody(part: OoxmlPart): string {
  const xml = serializeOoxmlPart(part);
  return xml.slice(xml.indexOf('<w:body>') + '<w:body>'.length, xml.lastIndexOf('<w:sectPr/>'));
}

/** The part passes the write-time invariants, and a save reads back to the same save. */
function expectStable(part: OoxmlPart): void {
  expect(validateOoxmlPart(part)).toEqual({ ok: true });
  const saved = serializeOoxmlPart(part);
  const reread = readOoxmlPart(saved, META);
  if (!reread.ok) throw new Error(reread.reason);
  expect(validateOoxmlPart(reread.part)).toEqual({ ok: true });
  expect(serializeOoxmlPart(reread.part)).toBe(saved);
}

describe('paragraph properties', () => {
  test('w:pPr elements before the content merge, the later adding to and winning over the earlier', () => {
    const part = parse(
      '<w:p><w:pPr><w:jc w:val="right"/><w:ind w:left="2880"/><w:rPr><w:sz w:val="72"/></w:rPr></w:pPr>' +
        '<w:bookmarkStart w:id="0" w:name="b"/>' +
        '<w:pPr><w:ind w:firstLine="720"/><w:jc w:val="center"/><w:rPr><w:b/></w:rPr>' +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
        '<w:pPr><w:tabs><w:tab w:val="left" w:pos="5760"/></w:tabs></w:pPr>' +
        '<w:r><w:t>Merged</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>'
    );
    const [paragraph] = elements(part, 'p');
    expect(childKinds(paragraph!)).toEqual([
      'pPr:paragraphProperties',
      'bookmarkStart:bookmarkStart',
      'r:run',
      'bookmarkEnd:bookmarkEnd',
    ]);
    expect(savedBody(part)).toBe(
      '<w:p><w:pPr><w:tabs><w:tab w:pos="5760" w:val="left"/></w:tabs>' +
        '<w:ind w:firstLine="720" w:left="2880"/><w:jc w:val="center"/>' +
        '<w:rPr><w:b/><w:sz w:val="72"/></w:rPr><w:sectPr><w:pgSz w:h="15840" w:w="12240"/></w:sectPr>' +
        '</w:pPr><w:bookmarkStart w:id="0" w:name="b"/><w:r><w:t>Merged</w:t></w:r>' +
        '<w:bookmarkEnd w:id="0"/></w:p>'
    );
    expectStable(part);
  });

  test('two w:tabs keep every stop, the later winning at one position', () => {
    const part = parse(
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="2880"/><w:tab w:val="left" w:pos="5760"/></w:tabs></w:pPr>' +
        '<w:pPr><w:tabs><w:tab w:val="right" w:pos="5760"/><w:tab w:val="left" w:pos="1440"/></w:tabs></w:pPr>' +
        '<w:r><w:t>Tabs</w:t></w:r></w:p>'
    );
    expect(savedBody(part)).toContain(
      '<w:tabs><w:tab w:pos="1440" w:val="left"/><w:tab w:pos="2880" w:val="left"/>' +
        '<w:tab w:pos="5760" w:val="right"/></w:tabs>'
    );
    expectStable(part);
  });

  test('after empty markers, the w:pPr leads and keeps its section break', () => {
    const part = parse(
      '<w:p><w:bookmarkStart w:id="1" w:name="b"/><w:proofErr w:type="spellStart"/>' +
        '<w:pPr><w:jc w:val="center"/><w:sectPr/></w:pPr>' +
        '<w:r><w:t>Marked</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
    );
    const [paragraph] = elements(part, 'p');
    expect(childKinds(paragraph!)).toEqual([
      'pPr:paragraphProperties',
      'bookmarkStart:bookmarkStart',
      'proofErr:generic',
      'r:run',
      'bookmarkEnd:bookmarkEnd',
    ]);
    expect(kinds(paragraph!.children[0]!)).toContain('sectPr:generic');
    expectStable(part);
  });

  test('after content, the w:pPr applies to nothing and stays generic behind an empty one', () => {
    const part = parse(
      '<w:p><w:r><w:t>Late</w:t></w:r><w:pPr><w:jc w:val="right"/><w:sectPr/></w:pPr></w:p>'
    );
    const [paragraph] = elements(part, 'p');
    expect(paragraph!.kind).toBe('paragraph');
    expect(childKinds(paragraph!)).toEqual(['pPr:paragraphProperties', 'r:run', 'pPr:generic']);
    expect(
      paragraph!.children[0]!.kind !== 'textValue' && paragraph!.children[0]!.children
    ).toEqual([]);
    expect(savedBody(part)).toBe(
      '<w:p><w:pPr/><w:r><w:t>Late</w:t></w:r><w:pPr><w:jc w:val="right"/><w:sectPr/></w:pPr></w:p>'
    );
    expectStable(part);
  });
});

describe('run properties', () => {
  test('after a saved page break, the w:rPr leads in the same run', () => {
    const part = parse(
      '<w:p><w:r><w:lastRenderedPageBreak/><w:rPr><w:b/></w:rPr><w:t>Lead</w:t></w:r></w:p>'
    );
    const [run] = elements(part, 'r');
    expect(childKinds(run!)).toEqual([
      'rPr:runProperties',
      'lastRenderedPageBreak:generic',
      't:text',
    ]);
    expect(savedBody(part)).toBe(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:lastRenderedPageBreak/><w:t>Lead</w:t></w:r></w:p>'
    );
    expectStable(part);
  });

  test('after content, the run splits and the content before has no properties', () => {
    const part = parse(
      '<w:p><w:r><w:tab/><w:rPr><w:b/></w:rPr><w:t>After</w:t></w:r>' +
        '<w:r><w:t>Before</w:t><w:rPr><w:i/></w:rPr></w:r></w:p>'
    );
    expect(elements(part, 'r').map((run) => run.kind)).toEqual(['run', 'run', 'run', 'run']);
    expect(savedBody(part)).toBe(
      '<w:p><w:r><w:tab/></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>After</w:t></w:r>' +
        '<w:r><w:t>Before</w:t></w:r><w:r><w:rPr><w:i/></w:rPr></w:r></w:p>'
    );
    expectStable(part);
  });

  test('a later w:rPr adds to the earlier one, winning where both name a property', () => {
    const part = parse(
      '<w:p><w:r><w:rPr><w:i/><w:sz w:val="56"/></w:rPr><w:t>A</w:t>' +
        '<w:rPr><w:sz w:val="20"/><w:b/></w:rPr><w:t>B</w:t></w:r></w:p>'
    );
    expect(savedBody(part)).toBe(
      '<w:p><w:r><w:rPr><w:i/><w:sz w:val="56"/></w:rPr><w:t>A</w:t></w:r>' +
        '<w:r><w:rPr><w:b/><w:i/><w:sz w:val="20"/></w:rPr><w:t>B</w:t></w:r></w:p>'
    );
    // Every node keeps its own id.
    const ids = new Set<string>();
    const visit = (node: OoxmlNode): void => {
      expect(ids.has(node.id)).toBe(false);
      ids.add(node.id);
      if (node.kind !== 'textValue') node.children.forEach(visit);
    };
    visit(part.root);
    expectStable(part);
  });
});

describe('run content', () => {
  test('a w:t holding elements splits around them, and a w:br among them breaks the line', () => {
    const part = parse('<w:p><w:r><w:t>A<w:br/>B<w:x/>C</w:t></w:r></w:p>');
    const [run] = elements(part, 'r');
    expect(run!.kind).toBe('run');
    expect(childKinds(run!)).toEqual(['t:text', 'br:hardBreak', 't:text', 't:generic', 't:text']);
    // The other element stays inside a text element, where it shows nothing.
    expect(savedBody(part)).toBe(
      '<w:p><w:r><w:t>A</w:t><w:br/><w:t>B</w:t><w:t><w:x/></w:t><w:t>C</w:t></w:r></w:p>'
    );
    expectStable(part);
  });

  test('a w:ins inside a run becomes a tracked insertion beside it', () => {
    const part = parse(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t>' +
        '<w:ins w:id="9" w:author="a"><w:t>B</w:t></w:ins><w:t>C</w:t></w:r></w:p>'
    );
    const [paragraph] = elements(part, 'p');
    expect(childKinds(paragraph!)).toEqual(['r:run', 'ins:revisionInsert', 'r:run']);
    expect(savedBody(part)).toBe(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t></w:r>' +
        '<w:ins w:author="a" w:id="9"><w:r><w:rPr><w:b/></w:rPr><w:t>B</w:t></w:r></w:ins>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>C</w:t></w:r></w:p>'
    );
    expectStable(part);
  });

  test('run content, w:pPr and w:rPr where they apply to nothing stay generic in place', () => {
    const part = parse(
      '<w:p><w:tab/><w:r><w:t>Tab</w:t></w:r></w:p>' +
        '<w:p><w:hyperlink w:anchor="x"><w:pPr><w:jc w:val="center"/></w:pPr>' +
        '<w:r><w:t>Link</w:t></w:r></w:hyperlink></w:p>' +
        '<w:p><w:ins w:id="1" w:author="a"><w:rPr><w:b/></w:rPr><w:r><w:t>Ins</w:t></w:r></w:ins></w:p>'
    );
    const [tab, link, insertion] = elements(part, 'p');
    expect(childKinds(tab!)).toEqual(['tab:generic', 'r:run']);
    expect(childKinds(link!)).toEqual(['hyperlink:hyperlink']);
    expect(childKinds(insertion!)).toEqual(['ins:revisionInsert']);
    expectStable(part);
  });

  test('a stray w:val keeps the paragraph, run, text, table and link typed', () => {
    const body =
      '<w:p w:val="1"><w:hyperlink w:anchor="x" w:val="2"><w:r w:val="3"><w:t w:val="4">V</w:t>' +
      '</w:r></w:hyperlink></w:p><w:tbl w:val="5"><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
      '<w:tr w:val="6"><w:tc w:val="7"><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const part = parse(body);
    const all = kinds(part.root);
    for (const name of ['p', 'hyperlink', 'r', 't', 'tbl', 'tr', 'tc'])
      expect(all.filter((entry) => entry.startsWith(`${name}:`))).not.toContainEqual(
        `${name}:generic`
      );
    // The body ends with the table, so it saves the empty paragraph it reads after it.
    expect(savedBody(part)).toBe(`${body}<w:p/>`);
  });
});

describe('tables', () => {
  test('two w:tblPr merge into the first, the later winning, and a second grid stays generic', () => {
    const part = parse(
      '<w:tbl><w:tblPr><w:jc w:val="right"/><w:tblW w:w="2000" w:type="dxa"/></w:tblPr>' +
        '<w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="1500"/></w:tblGrid><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:p><w:r><w:t>T</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    );
    const [table] = elements(part, 'tbl');
    expect(childKinds(table!)).toEqual([
      'tblPr:tableProperties',
      'tblGrid:tableGrid',
      'tblGrid:generic',
      'tr:tableRow',
    ]);
    expect(savedBody(part)).toContain(
      '<w:tblPr><w:tblW w:type="dxa" w:w="4000"/><w:jc w:val="right"/></w:tblPr>'
    );
    expectStable(part);
  });

  test('a paragraph written straight into a row joins the next cell, or stays generic after the last', () => {
    const part = parse(
      '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>' +
        '<w:tc><w:p><w:r><w:t>One</w:t></w:r></w:p></w:tc><w:p><w:r><w:t>Stray</w:t></w:r></w:p>' +
        '<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Two</w:t></w:r></w:p></w:tc>' +
        '<w:p><w:r><w:t>Trailing</w:t></w:r></w:p></w:tr></w:tbl>'
    );
    const [row] = elements(part, 'tr');
    expect(row!.kind).toBe('tableRow');
    expect(childKinds(row!)).toEqual(['tc:tableCell', 'tc:tableCell', 'p:generic']);
    const second = row!.children[1] as OoxmlElement;
    expect(childKinds(second)).toEqual(['tcPr:generic', 'p:paragraph', 'p:paragraph']);
    expectStable(part);
  });
});

describe('text white space', () => {
  test('without its own xml:space, a w:t drops boundary white space and shows a tab as a space', () => {
    const part = parse(
      '<w:p><w:r><w:t> Lead</w:t><w:t>Trail </w:t><w:t>In  side</w:t><w:t>Tab\there</w:t>' +
        '<w:t> </w:t><w:t>\n    Pretty\n  </w:t></w:r></w:p>'
    );
    expect(savedBody(part)).toBe(
      '<w:p><w:r><w:t>Lead</w:t><w:t>Trail</w:t><w:t>In  side</w:t><w:t>Tab here</w:t>' +
        '<w:t/><w:t>Pretty</w:t></w:r></w:p>'
    );
    expectStable(part);
  });

  test('xml:space on an ancestor does not keep it; on the w:t it keeps spaces and tabs', () => {
    const part = parse(
      '<w:p xml:space="preserve"><w:r xml:space="preserve"><w:t>Inherited </w:t>' +
        '<w:t xml:space="preserve"> Own\ttab </w:t><w:t xml:space="default">Default </w:t></w:r></w:p>'
    );
    expect(savedBody(part)).toContain(
      '<w:t>Inherited</w:t><w:t xml:space="preserve"> Own\ttab </w:t><w:t>Default</w:t>'
    );
    expectStable(part);
  });

  test('xml:space on the part root keeps the white space, unless the w:t sets default', () => {
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W}" xml:space="preserve"><w:body><w:p><w:r><w:t>Root </w:t>` +
        '<w:t> </w:t><w:t xml:space="default">Own </w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
      META
    );
    if (!result.ok) throw new Error(result.reason);
    expect(savedBody(result.part)).toContain(
      '<w:t xml:space="preserve">Root </w:t><w:t xml:space="preserve"> </w:t><w:t>Own</w:t>'
    );
    expectStable(result.part);
  });

  test('a line break in text is a space, and deleted text follows the same rule', () => {
    const part = parse(
      '<w:p><w:r><w:t xml:space="preserve">One\r\nTwo\nThree</w:t></w:r>' +
        '<w:del w:id="1" w:author="a"><w:r><w:delText> Gone </w:delText></w:r></w:del></w:p>'
    );
    expect(savedBody(part)).toContain('<w:t>One Two Three</w:t>');
    expect(savedBody(part)).toContain('<w:delText>Gone</w:delText>');
    expectStable(part);
  });

  test('a saved tab inside text keeps xml:space so it reads back as a tab', () => {
    const part = parse('<w:p><w:r><w:t xml:space="preserve">A\tB</w:t></w:r></w:p>');
    expect(savedBody(part)).toBe('<w:p><w:r><w:t xml:space="preserve">A\tB</w:t></w:r></w:p>');
    expectStable(part);
  });
});

describe('nesting', () => {
  test('a paragraph inside a paragraph joins it, its w:pPr adds, and the outer mark follows empty', () => {
    const part = parse(
      '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Outer</w:t></w:r>' +
        '<w:p><w:pPr><w:spacing w:before="2000"/></w:pPr><w:r><w:t>Inner</w:t></w:r></w:p></w:p>'
    );
    expect(elements(part, 'p').map((paragraph) => paragraph.kind)).toEqual([
      'paragraph',
      'paragraph',
    ]);
    expect(savedBody(part)).toBe(
      '<w:p><w:pPr><w:spacing w:before="2000"/><w:jc w:val="right"/></w:pPr>' +
        '<w:r><w:t>Outer</w:t></w:r><w:r><w:t>Inner</w:t></w:r></w:p><w:p/>'
    );
    expectStable(part);
  });

  test('a table inside a paragraph stays a table, the content before it starting the first cell', () => {
    const part = parse(
      '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Before</w:t></w:r>' +
        '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Cell</w:t></w:r></w:p>' +
        '</w:tc></w:tr></w:tbl></w:p>'
    );
    expect(elements(part, 'tbl').map((table) => table.kind)).toEqual(['table']);
    expect(savedBody(part)).toBe(
      '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p>' +
        '<w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Before</w:t></w:r><w:r><w:t>Cell</w:t></w:r>' +
        '</w:p></w:tc></w:tr></w:tbl><w:p><w:pPr><w:jc w:val="right"/></w:pPr></w:p>'
    );
    expectStable(part);
  });

  test('a run inside a run joins it, its properties adding to the ones in effect', () => {
    const part = parse(
      '<w:p><w:r><w:rPr><w:sz w:val="56"/></w:rPr><w:t>Outer</w:t>' +
        '<w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>Inner</w:t></w:r></w:r></w:p>'
    );
    expect(savedBody(part)).toBe(
      '<w:p><w:r><w:rPr><w:sz w:val="56"/></w:rPr><w:t>Outer</w:t></w:r>' +
        '<w:r><w:rPr><w:color w:val="FF0000"/><w:sz w:val="56"/></w:rPr><w:t>Inner</w:t></w:r></w:p>'
    );
    expectStable(part);
  });

  test('a later w:rPr element of the same name adds its attributes', () => {
    const part = parse(
      '<w:p><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>One</w:t>' +
        '<w:rPr><w:u w:color="FF0000"/></w:rPr><w:t>Two</w:t></w:r></w:p>'
    );
    expect(savedBody(part)).toContain(
      '<w:r><w:rPr><w:u w:color="FF0000" w:val="single"/></w:rPr><w:t>Two</w:t></w:r>'
    );
    expectStable(part);
  });
});

describe('bounds and stability', () => {
  test('a run with many w:rPr stays as written instead of copying properties per part', () => {
    const parts = Array.from(
      { length: 1000 },
      (_, index) => `<w:rPr><w:x${index}/></w:rPr><w:t>a</w:t>`
    ).join('');
    const part = parse(`<w:p><w:r>${parts}</w:r></w:p>`);
    let nodes = 0;
    const visit = (node: OoxmlNode): void => {
      nodes += 1;
      if (node.kind !== 'textValue') node.children.forEach(visit);
    };
    visit(part.root);
    expect(nodes).toBeLessThan(5000);
    expect(elements(part, 'r').map((run) => run.kind)).toEqual(['generic']);
  });

  test('a w:pPr after the text stays inert beside a nested paragraph or table, across saves', () => {
    for (const body of [
      '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>a</w:t></w:r>' +
        '<w:pPr><w:jc w:val="center"/></w:pPr><w:p><w:r><w:t>b</w:t></w:r></w:p></w:p>',
      '<w:p><w:r><w:t>a</w:t></w:r><w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        '<w:pPr><w:jc w:val="center"/></w:pPr></w:p>',
      '<w:p><w:r><w:t>z</w:t></w:r><w:p><w:r><w:t>a</w:t></w:r>' +
        '<w:pPr><w:jc w:val="center"/></w:pPr></w:p></w:p>',
    ]) {
      const part = parse(body);
      const leading = elements(part, 'p')
        .map((paragraph) => paragraph.children[0])
        .filter((child) => child?.kind === 'paragraphProperties');
      for (const properties of leading) {
        expect(
          properties!.kind !== 'textValue' &&
            properties!.children.some(
              (child) =>
                child.kind !== 'textValue' &&
                child.localName === 'jc' &&
                child.attributes.some((attribute) => attribute.value === 'center')
            )
        ).toBe(false);
      }
      expectStable(part);
    }
  });

  test('a w:pPr after an empty inner paragraph stays inert across saves', () => {
    for (const body of [
      '<w:p><w:p/><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>',
      '<w:p><w:p><w:p/><w:pPr><w:jc w:val="center"/></w:pPr></w:p></w:p>',
      '<w:p><w:pPr><w:spacing w:after="1"/></w:pPr><w:p><w:bookmarkStart w:id="1" w:name="b"/>' +
        '<w:p></w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p></w:p>',
      '<w:p><w:r><w:t>q</w:t></w:r><w:pPr><w:jc w:val="center"/></w:pPr><w:tbl><w:tr><w:tc>' +
        '<w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:p>',
    ]) {
      const part = parse(body);
      for (const paragraph of elements(part, 'p')) {
        const lead = paragraph.children[0];
        if (lead?.kind === 'paragraphProperties') expect(kinds(lead)).not.toContain('jc:generic');
      }
      expectStable(part);
    }
  });

  test('nested runs each count their own w:rPr', () => {
    const inner = '<w:r><w:rPr><w:i/></w:rPr><w:t>a</w:t><w:rPr><w:b/></w:rPr><w:t>b</w:t></w:r>';
    const part = parse(`<w:p><w:r>${inner.repeat(20)}</w:r></w:p>`);
    expect(elements(part, 'r').every((run) => run.kind === 'run')).toBe(true);
    expectStable(part);
  });

  test('elements with attributes their kind refuses stay generic', () => {
    const breakPart = parse('<w:p><w:r><w:t>a<w:br w:val="x"/>b</w:t></w:r></w:p>');
    expect(kinds(breakPart.root)).not.toContain('br:hardBreak');
    expectStable(breakPart);
    const nestedPart = parse(
      '<w:p><w:p><w:pPr w:val="x"><w:jc w:val="center"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p></w:p>'
    );
    expectStable(nestedPart);
  });

  test('text pieces split around an element show their own white space', () => {
    const part = parse('<w:p><w:r><w:t>a\nb<w:br/>c\td </w:t></w:r></w:p>');
    expect(savedBody(part)).toBe('<w:p><w:r><w:t>a b</w:t><w:br/><w:t>c d</w:t></w:r></w:p>');
    expectStable(part);
  });

  test('an inner paragraph before a table keeps its w:pPr on the paragraph after the table', () => {
    const part = parse(
      '<w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>a</w:t></w:r></w:p>' +
        '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr>' +
        '</w:tbl></w:p>'
    );
    expect(savedBody(part)).toContain('</w:tbl><w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>');
    expectStable(part);
  });

  test('a stray paragraph in a row stays in place unless a typed cell follows it', () => {
    const part = parse(
      '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr>' +
        '<w:tc><w:p><w:r><w:t>One</w:t></w:r></w:p></w:tc><w:p><w:r><w:t>Stray</w:t></w:r></w:p>' +
        '<w:bookmarkStart w:id="1" w:name="b"/><w:tc w:val="x" xml:space="bogus"><w:p/></w:tc>' +
        '</w:tr></w:tbl>'
    );
    const [row] = elements(part, 'tr');
    expect(childKinds(row!)).toEqual([
      'tc:tableCell',
      'p:generic',
      'bookmarkStart:bookmarkStart',
      'tc:generic',
    ]);
  });

  test('a nested run ends its properties where it ends', () => {
    const part = parse(
      '<w:p><w:r><w:t>x</w:t><w:rPr><w:b/></w:rPr><w:r><w:rPr><w:i/></w:rPr><w:t>a</w:t></w:r>' +
        '<w:t>c</w:t></w:r></w:p>'
    );
    expect(savedBody(part)).toBe(
      '<w:p><w:r><w:t>x</w:t></w:r><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>a</w:t></w:r>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>c</w:t></w:r></w:p>'
    );
    expectStable(part);
  });

  test('properties after the last text are kept, also behind an empty marker', () => {
    const part = parse(
      '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>a</w:t><w:rPr><w:b/></w:rPr>' +
        '<w:lastRenderedPageBreak/></w:r></w:p>'
    );
    expect(savedBody(part)).toBe(
      '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>a</w:t></w:r>' +
        '<w:r><w:rPr><w:b/><w:i/></w:rPr><w:lastRenderedPageBreak/></w:r></w:p>'
    );
    expectStable(part);
  });
});
