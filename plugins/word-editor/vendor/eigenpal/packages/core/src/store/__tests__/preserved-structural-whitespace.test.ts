// `xml:space="preserve"` is inherited by every descendant, but it only governs character
// content. Indentation between the children of an element-only container is not content,
// whatever the inherited value: a run, paragraph, table or content control written with
// line breaks and tabs between its children must type exactly as the compact spelling does.
// Where character data sits beside the whitespace, or the container is not modeled, the
// whitespace stays and round-trips as before.

import { describe, expect, test } from 'bun:test';
import {
  WML_NAMESPACE_URI,
  canonicalOoxmlFingerprint,
  ooxmlTreesEqual,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../index.ts';

const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

const NBSP = ' ';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function parse(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, metadata);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function documentXml(body: string, rootAttributes = ''): string {
  return `<w:document xmlns:w="${WML_NAMESPACE_URI}"${rootAttributes}><w:body>${body}</w:body></w:document>`;
}

function elements(node: OoxmlNode): OoxmlElement[] {
  if (node.kind === 'textValue') return [];
  return [node, ...node.children.flatMap(elements)];
}

function kindsByName(part: OoxmlPart): Record<string, string[]> {
  const kinds: Record<string, string[]> = {};
  for (const element of elements(part.root)) {
    const list = (kinds[element.localName] ??= []);
    if (!list.includes(element.kind)) list.push(element.kind);
  }
  return kinds;
}

function ids(node: OoxmlNode): string[] {
  if (node.kind === 'textValue') return [node.id];
  return [node.id, ...node.children.flatMap(ids)];
}

function textValues(node: OoxmlNode): string[] {
  if (node.kind === 'textValue') return [node.value];
  return node.children.flatMap(textValues);
}

function runsOf(part: OoxmlPart): OoxmlElement[] {
  return elements(part.root).filter((element) => element.localName === 'r');
}

function expectRoundTrip(part: OoxmlPart): OoxmlPart {
  const reopened = parse(serializeOoxmlPart(part));
  expect(ooxmlTreesEqual(part, reopened)).toBe(true);
  expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(part));
  expect(ids(reopened.root)).toEqual(ids(part.root));
  return reopened;
}

const LABEL = '<w:r><w:t>(i)</w:t></w:r>';
const BODY_RUN = '<w:r><w:t>a b</w:t></w:r>';
const RUN_PROPERTIES = '<w:rPr><w:rFonts w:ascii="Sans"/></w:rPr>';

describe('whitespace between the children of a modeled container under xml:space="preserve"', () => {
  test('an indented run keeps its type and its no-break space', () => {
    const indented = parse(
      documentXml(
        `<w:p>${LABEL}<w:r xml:space="preserve">${RUN_PROPERTIES}\n\t\t\t<w:t xml:space="preserve">${NBSP}</w:t>\n\t\t</w:r>${BODY_RUN}</w:p>`
      )
    );
    const compact = parse(
      documentXml(
        `<w:p>${LABEL}<w:r xml:space="preserve">${RUN_PROPERTIES}<w:t xml:space="preserve">${NBSP}</w:t></w:r>${BODY_RUN}</w:p>`
      )
    );

    const run = runsOf(indented)[1]!;
    expect(run.kind).toBe('run');
    expect(run.children.map((child) => child.kind)).toEqual(['runProperties', 'text']);
    expect(textValues(run)).toEqual([NBSP]);
    expect(ooxmlTreesEqual(indented, compact)).toBe(true);
    expect(ids(indented.root)).toEqual(ids(compact.root));
  });

  test('a run holding only an indented tab keeps its type', () => {
    const part = parse(
      documentXml(`<w:p>${LABEL}<w:r xml:space="preserve">\n\t<w:tab/>\n</w:r>${BODY_RUN}</w:p>`)
    );
    const run = runsOf(part)[1]!;
    expect(run.kind).toBe('run');
    expect(run.children.map((child) => child.kind)).toEqual(['tab']);
    expectRoundTrip(part);
  });

  test('text with its own xml:space keeps every space and tab; an ancestor xml:space does not', () => {
    const part = parse(
      documentXml(
        '<w:p><w:r xml:space="preserve">\n  <w:tab/>\n  <w:t xml:space="preserve">  a\tb  </w:t>\n  <w:br/>\n' +
          '  <w:t>\n</w:t>\n</w:r></w:p>'
      )
    );
    const run = runsOf(part)[0]!;
    expect(run.kind).toBe('run');
    expect(run.children.map((child) => child.kind)).toEqual(['tab', 'text', 'hardBreak', 'text']);
    // The second w:t takes no preserve from its run: its line break is a boundary space.
    expect(textValues(run)).toEqual(['  a\tb  ']);
    expectRoundTrip(part);
  });

  test('preserve inherited from the root types every structural container', () => {
    const indent = (xml: string): string => xml.replace(/></g, '>\n\t<');
    const body =
      '<w:p><w:pPr><w:jc w:val="both"/><w:rPr><w:b/></w:rPr></w:pPr>' +
      '<w:r><w:rPr><w:i/></w:rPr><w:t>one</w:t></w:r>' +
      '<w:hyperlink w:anchor="target"><w:r><w:t>link</w:t></w:r></w:hyperlink>' +
      '<w:ins w:id="1" w:author="A"><w:r><w:t>added</w:t></w:r></w:ins>' +
      '<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>' +
      '<w:sdt><w:sdtPr><w:alias w:val="Field"/></w:sdtPr><w:sdtContent>' +
      '<w:r><w:t>control</w:t></w:r></w:sdtContent></w:sdt></w:p>' +
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p/>';
    const compact = parse(documentXml(body, ' xml:space="preserve"'));
    const indented = parse(indent(documentXml(body, ' xml:space="preserve"')));

    expect(kindsByName(indented)).toEqual(kindsByName(compact));
    expect(kindsByName(indented)).toMatchObject({
      document: ['document'],
      body: ['body'],
      p: ['paragraph'],
      pPr: ['paragraphProperties'],
      rPr: ['runProperties'],
      r: ['run'],
      hyperlink: ['hyperlink'],
      ins: ['revisionInsert'],
      fldSimple: ['fldSimple'],
      sdt: ['contentControl'],
      sdtPr: ['contentControlProperties'],
      sdtContent: ['contentControlContent'],
      tbl: ['table'],
      tblPr: ['tableProperties'],
      tblGrid: ['tableGrid'],
      tr: ['tableRow'],
      tc: ['tableCell'],
    });
    expect(ooxmlTreesEqual(indented, compact)).toBe(true);
    expect(ids(indented.root)).toEqual(ids(compact.root));
    expectRoundTrip(indented);
  });

  test('xml:space="default" below a preserved ancestor reads the same', () => {
    const part = parse(
      documentXml(
        `<w:p xml:space="preserve">\n  <w:r xml:space="default">\n    <w:t xml:space="preserve">${NBSP}</w:t>\n  </w:r>\n</w:p>`
      )
    );
    expect(elements(part.root).find((element) => element.localName === 'p')!.kind).toBe(
      'paragraph'
    );
    expect(runsOf(part)[0]!.kind).toBe('run');
    expect(textValues(part.root)).toEqual([NBSP]);
  });

  test('an indented picture in a preserved run keeps its drawing types', () => {
    const drawing =
      '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="152400" cy="152400"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      '<wp:docPr id="1" name="picture"/><wp:cNvGraphicFramePr/>' +
      `<a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
      '<pic:nvPicPr><pic:cNvPr id="0" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="152400" cy="152400"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
    const drawingDocument = (run: string): string =>
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
      `xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p>${run}</w:p></w:body></w:document>`;
    const run = `<w:r xml:space="preserve">${drawing}</w:r>`;
    const compact = parse(drawingDocument(run));
    const indented = parse(drawingDocument(run.replace(/></g, '>\n\t<')));

    expect(kindsByName(indented)).toEqual(kindsByName(compact));
    expect(kindsByName(indented)).toMatchObject({
      drawing: ['drawing'],
      inline: ['inlineDrawing'],
      pic: ['picture'],
      blip: ['pictureBlip'],
    });
    expect(ooxmlTreesEqual(indented, compact)).toBe(true);
    expectRoundTrip(indented);
  });

  test('a known container that demotes for another reason reads like its compact spelling', () => {
    // A paragraph is not run content, so the run is generic either way.
    const indented = parse(
      documentXml('<w:p><w:r xml:space="preserve">\n  <w:t>a</w:t>\n  <w:p/>\n</w:r></w:p>')
    );
    const compact = parse(
      documentXml('<w:p><w:r xml:space="preserve"><w:t>a</w:t><w:p/></w:r></w:p>')
    );
    expect(runsOf(indented)[0]!.kind).toBe('generic');
    expect(ooxmlTreesEqual(indented, compact)).toBe(true);
    expectRoundTrip(indented);
  });

  test('the saved part drops the indentation and reopens with identical content', () => {
    const part = parse(
      documentXml(
        `<w:p>${LABEL}<w:r xml:space="preserve">${RUN_PROPERTIES}\n\t\t\t<w:t xml:space="preserve">${NBSP}</w:t>\n\t\t</w:r>${BODY_RUN}</w:p>`
      )
    );
    const saved = serializeOoxmlPart(part);
    expect(saved).not.toContain('\n');
    expect(saved).toContain(`>${NBSP}</w:t>`);
    const reopened = expectRoundTrip(part);
    expect(runsOf(reopened)[1]!.kind).toBe('run');
  });
});

describe('whitespace that stays significant under xml:space="preserve"', () => {
  test('character data beside the children keeps the run generic and every text node', () => {
    const part = parse(
      documentXml(`<w:p><w:r xml:space="preserve">\n  x<w:t>a</w:t>\n</w:r></w:p>`)
    );
    const run = runsOf(part)[0]!;
    expect(run.kind).toBe('generic');
    expect(run.children.map((child) => child.kind)).toEqual(['textValue', 'text', 'textValue']);
    expect(textValues(run)).toEqual(['\n  x', 'a', '\n']);
    expectRoundTrip(part);
  });

  test.each([
    ['a no-break space', NBSP],
    ['an ideographic space', '　'],
    ['a zero-width no-break space', '﻿'],
  ])('%s as direct run content is kept, not read as indentation', (_label, character) => {
    const part = parse(
      documentXml(`<w:p><w:r xml:space="preserve"><w:t>a</w:t>${character}<w:t>b</w:t></w:r></w:p>`)
    );
    const run = runsOf(part)[0]!;
    expect(run.kind).toBe('generic');
    expect(textValues(run)).toEqual(['a', character, 'b']);
    expect(serializeOoxmlPart(part)).toContain(`</w:t>${character}<w:t>`);
    expectRoundTrip(part);
  });

  test('a no-break space between runs of a preserved paragraph is kept with its indentation', () => {
    const part = parse(
      documentXml(
        `<w:p xml:space="preserve">\n  <w:r><w:t>a</w:t></w:r>\n  ${NBSP}<w:r><w:t>b</w:t></w:r>\n</w:p>`
      )
    );
    const paragraph = elements(part.root).find((element) => element.localName === 'p')!;
    expect(paragraph.kind).toBe('generic');
    expect(textValues(paragraph)).toEqual(['\n  ', 'a', `\n  ${NBSP}`, 'b', '\n']);
    expect(serializeOoxmlPart(part)).toContain(`\n  ${NBSP}<w:r>`);
    expectRoundTrip(part);
  });

  test('an unmodeled container keeps its whitespace, including one inside a typed run', () => {
    const extension = '<x:ext xmlns:x="urn:extension">\n  <x:a/>\n</x:ext>';
    const part = parse(
      documentXml(`<w:p><w:r xml:space="preserve">\n  <w:t>a</w:t>\n  ${extension}\n</w:r></w:p>`)
    );
    const run = runsOf(part)[0]!;
    expect(run.kind).toBe('run');
    const ext = run.children.find(
      (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'ext'
    )!;
    expect(ext.kind).toBe('generic');
    expect(textValues(ext)).toEqual(['\n  ', '\n']);
    expect(serializeOoxmlPart(part)).toContain('\n  <x:a/>\n</x:ext>');
    expectRoundTrip(part);
  });

  test('an element outside its modeled position keeps its whitespace', () => {
    // A content control cannot sit inside a run, so it is not modeled there.
    const part = parse(
      documentXml(
        '<w:p><w:r xml:space="preserve"><w:t>a</w:t>' +
          '<w:sdt>\n  <w:sdtContent>\n    <w:t>b</w:t>\n  </w:sdtContent>\n</w:sdt></w:r></w:p>'
      )
    );
    const control = elements(part.root).find((element) => element.localName === 'sdt')!;
    expect(control.kind).toBe('generic');
    expect(
      control.children.map((child) => (child.kind === 'textValue' ? child.value : 'sdtContent'))
    ).toEqual(['\n  ', 'sdtContent', '\n']);
    expect(runsOf(part)[0]!.kind).toBe('run');
    expectRoundTrip(part);
  });

  test('an unmodeled root keeps whitespace-only mixed content', () => {
    const spaced = parse('<r xmlns="urn:mixed" xml:space="preserve">\n  <a/>\n</r>');
    const compact = parse('<r xmlns="urn:mixed" xml:space="preserve"><a/></r>');
    expect(textValues(spaced.root)).toEqual(['\n  ', '\n']);
    expect(ooxmlTreesEqual(spaced, compact)).toBe(false);
    expectRoundTrip(spaced);
  });
});
