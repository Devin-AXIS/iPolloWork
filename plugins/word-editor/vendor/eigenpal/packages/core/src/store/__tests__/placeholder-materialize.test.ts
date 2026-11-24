// An empty content control opens showing its prompt, the way Word displays the glossary
// placeholder its `w:placeholder/w:docPart` names, so the caret can enter it and the first
// keystroke replaces the prompt whole.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPackage, type OoxmlNode } from '../index.ts';
import { materializeGlossaryPlaceholders } from '../store/placeholder-materialize.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { zipDoc } from './canonical-primitive-journal-coverage-support.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const GLOSSARY_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/glossaryDocument';
const GLOSSARY_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml';

function docPart(name: string, body: string): string {
  return (
    `<w:docPart><w:docPartPr><w:name w:val="${name}"/><w:category><w:name w:val="General"/>` +
    `<w:gallery w:val="placeholder"/></w:category></w:docPartPr><w:docPartBody>${body}</w:docPartBody></w:docPart>`
  );
}

const GLOSSARY =
  `<w:glossaryDocument xmlns:w="${W}"><w:docParts>` +
  docPart(
    'DefaultPlaceholder_Date',
    '<w:p><w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>Click here to enter a date.</w:t></w:r></w:p>'
  ) +
  docPart(
    'TwoParagraphs',
    '<w:p><w:r><w:t>First line.</w:t></w:r></w:p><w:p><w:r><w:t>Second line.</w:t></w:r></w:p>'
  ) +
  '</w:docParts></w:glossaryDocument>';

function open(body: string, glossary: string | null = GLOSSARY) {
  const bytes = zipDoc({
    body,
    ...(glossary
      ? {
          rels: `<Relationship Id="rId9" Type="${GLOSSARY_TYPE}" Target="glossary/document.xml"/>`,
          overrides: `<Override PartName="/word/glossary/document.xml" ContentType="${GLOSSARY_CONTENT_TYPE}"/>`,
          extraXml: { 'word/glossary/document.xml': glossary },
        }
      : {}),
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  return { pkg: loaded.package, main };
}

const EMPTY_DATE =
  '<w:p><w:r><w:t xml:space="preserve">Date: </w:t></w:r><w:sdt><w:sdtPr><w:alias w:val="Date"/><w:id w:val="5"/>' +
  '<w:placeholder><w:docPart w:val="DefaultPlaceholder_Date"/></w:placeholder>' +
  '<w:date w:fullDate="2026-09-17T00:00:00Z"/></w:sdtPr><w:sdtContent/></w:sdt></w:p><w:sectPr/>';

function allIds(node: OoxmlNode, into: string[] = []): string[] {
  into.push(node.id);
  if (node.kind !== 'textValue') node.children.forEach((child) => allIds(child, into));
  return into;
}

describe('materializeGlossaryPlaceholders', () => {
  test('an empty inline control takes its glossary prompt and shows it as a placeholder', () => {
    const { pkg, main } = open(EMPTY_DATE);
    const filled = materializeGlossaryPlaceholders(pkg, main);
    expect(filled).not.toBe(main);
    const xml = serializeOoxmlPart(filled);
    expect(xml).toContain('<w:showingPlcHdr/>');
    expect(xml).toContain('<w:t>Click here to enter a date.</w:t>');
    expect(xml).toContain('<w:rStyle w:val="PlaceholderText"/>');
    // Fresh ids: no node id repeats after the fill.
    const ids = allIds(filled.root);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('an empty control whose glossary block is missing takes the type default prompt', () => {
    const { pkg, main } = open(EMPTY_DATE, null);
    const xml = serializeOoxmlPart(materializeGlossaryPlaceholders(pkg, main));
    expect(xml).toContain('<w:t>Click here to enter a date.</w:t>');
    expect(xml).toContain('<w:showingPlcHdr/>');
  });

  test('a block-level empty control takes the whole block body', () => {
    const { pkg, main } = open(
      '<w:sdt><w:sdtPr><w:id w:val="6"/><w:placeholder><w:docPart w:val="TwoParagraphs"/></w:placeholder><w:richText/></w:sdtPr>' +
        '<w:sdtContent/></w:sdt><w:p><w:r><w:t>after</w:t></w:r></w:p><w:sectPr/>'
    );
    const xml = serializeOoxmlPart(materializeGlossaryPlaceholders(pkg, main));
    expect(xml).toContain('<w:t>First line.</w:t>');
    expect(xml).toContain('<w:t>Second line.</w:t>');
    expect((xml.match(/<w:p>/g) ?? []).length + (xml.match(/<w:p /g) ?? []).length).toBe(3);
  });

  test('a filled control, a checkbox, and a picture are left exactly as they were', () => {
    const { pkg, main } = open(
      '<w:p><w:sdt><w:sdtPr><w:id w:val="1"/><w:placeholder><w:docPart w:val="DefaultPlaceholder_Date"/></w:placeholder><w:date/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>2026-09-17</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:sdt><w:sdtPr><w:id w:val="2"/><w:picture/></w:sdtPr><w:sdtContent/></w:sdt>' +
        '<w:sdt><w:sdtPr><w:id w:val="3"/><w14:checkbox xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w14:checked w14:val="0"/></w14:checkbox></w:sdtPr><w:sdtContent/></w:sdt>' +
        '</w:p><w:sectPr/>'
    );
    expect(materializeGlossaryPlaceholders(pkg, main)).toBe(main);
  });
});
