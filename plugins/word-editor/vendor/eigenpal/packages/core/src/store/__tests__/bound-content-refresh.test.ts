// A bound content control opens showing its store's value, not the text cached at save.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPackage } from '../index.ts';
import { refreshBoundContent } from '../store/bound-content-refresh.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import {
  CORE_PROPERTIES_STORE_ID,
  parseBindingXPath,
  parsePrefixMappings,
} from '../package/custom-xml-binding.ts';
import { openTreeSession } from '../../binding/tree-session.ts';
import { zipDoc } from './canonical-primitive-journal-coverage-support.ts';

const ITEM_ID = '{4E5C8A11-2B3D-4F60-9A7B-1C2D3E4F5A6B}';
const NS = 'urn:example:contract';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PROPS_TYPE = 'application/vnd.openxmlformats-officedocument.customXmlProperties+xml';
const MAPPINGS = `xmlns:ns0='${NS}'`;

const STORE =
  `<ns0:contract xmlns:ns0="${NS}">` +
  '<ns0:party role="buyer">Northwind Traders</ns0:party>' +
  '<ns0:party role="seller">Contoso Ltd</ns0:party>' +
  '<ns0:signed>2026-03-04T00:00:00</ns0:signed>' +
  '<ns0:approved>true</ns0:approved>' +
  '<ns0:region>north</ns0:region>' +
  '<ns0:note></ns0:note>' +
  '<ns0:address>1 Main St\nSuite 2</ns0:address>' +
  '</ns0:contract>';

function bound(xpath: string, type: string, cached: string, storeId = ITEM_ID): string {
  return (
    `<w:sdt><w:sdtPr><w:id w:val="7"/>` +
    `<w:dataBinding w:prefixMappings="${MAPPINGS}" w:xpath="${xpath}" w:storeItemID="${storeId}"/>` +
    `${type}</w:sdtPr><w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>${cached}</w:t></w:r></w:sdtContent></w:sdt>`
  );
}

function docWith(paragraphs: string, store = STORE): Uint8Array {
  return zipDoc({
    body: `${paragraphs}<w:sectPr/>`,
    rels: `<Relationship Id="rIdX" Type="${OFFICE_REL}/customXml" Target="../customXml/item1.xml"/>`,
    overrides: `<Override PartName="/customXml/itemProps1.xml" ContentType="${PROPS_TYPE}"/>`,
    extraXml: {
      'customXml/item1.xml': store,
      'customXml/_rels/item1.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${OFFICE_REL}/customXmlProps" Target="itemProps1.xml"/>` +
        '</Relationships>',
      'customXml/itemProps1.xml': `<ds:datastoreItem ds:itemID="${ITEM_ID}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs/></ds:datastoreItem>`,
    },
  });
}

function mainXml(bytes: Uint8Array): string {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const pkg = refreshBoundContent(loaded.package);
  return serializeOoxmlPart(pkg.parts.get(pkg.mainDocumentPart)!);
}

const paragraph = (inner: string) => `<w:p>${inner}</w:p>`;

describe('bound content refresh', () => {
  test('a plain text control shows the bound value and keeps its run formatting', () => {
    const xml = mainXml(
      docWith(paragraph(bound('/ns0:contract[1]/ns0:party[2]', '<w:text/>', 'Old seller')))
    );
    expect(xml).toContain('Contoso Ltd');
    expect(xml).not.toContain('Old seller');
    expect(xml).toMatch(/<w:rPr><w:b\/><\/w:rPr><w:t>Contoso Ltd<\/w:t>/);
  });

  test('an attribute, a date, a checkbox and a dropdown refresh by their own rules', () => {
    const checkbox =
      '<w14:checkbox><w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/>' +
      '<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>';
    const dropdown =
      '<w:dropDownList><w:listItem w:displayText="North region" w:value="north"/>' +
      '<w:listItem w:displayText="South region" w:value="south"/></w:dropDownList>';
    const xml = mainXml(
      docWith(
        paragraph(bound('/ns0:contract/ns0:party[1]/@role', '<w:text/>', 'stale')) +
          paragraph(
            bound(
              '/ns0:contract/ns0:signed',
              '<w:date><w:dateFormat w:val="yyyy-MM-dd"/></w:date>',
              '2020-01-01'
            )
          ) +
          paragraph(bound('/ns0:contract/ns0:approved', checkbox, '☐')) +
          paragraph(bound('/ns0:contract/ns0:region', dropdown, 'South region'))
      )
    );
    expect(xml).toContain('<w:t>buyer</w:t>');
    expect(xml).toContain('2026-03-04');
    expect(xml).toContain('w:fullDate="2026-03-04T00:00:00Z"');
    expect(xml).toContain('w14:val="1"');
    expect(xml).toContain('North region');
    expect(xml).not.toContain('South region</w:t>');
  });

  test('an empty value empties the control, and a multi-line value breaks only when allowed', () => {
    const xml = mainXml(
      docWith(
        paragraph(bound('/ns0:contract/ns0:note', '<w:text/>', 'Old note')) +
          paragraph(bound('/ns0:contract/ns0:address', '<w:text w:multiLine="1"/>', 'Old')) +
          paragraph(bound('/ns0:contract/ns0:address', '<w:text/>', 'Old'))
      )
    );
    expect(xml).not.toContain('Old note');
    // No placeholder is named, so the control shows nothing, not a prompt.
    expect(xml).not.toContain('<w:showingPlcHdr/>');
    expect(xml).not.toContain('Click here to enter text.');
    expect(xml).toMatch(/1 Main St<\/w:t><w:br\/><w:t>Suite 2/);
    // A single-line control drops the break; no space stands in for it.
    expect(xml).toContain('1 Main StSuite 2');
    expect(xml).not.toContain('1 Main St Suite 2');
  });

  test('a session opens an empty bound value as an empty control', () => {
    const opened = openTreeSession(
      docWith(paragraph(bound('/ns0:contract/ns0:note', '<w:text/>', 'Old note')))
    );
    if (!opened.ok) throw new Error(opened.reason);
    expect(opened.session.bodyText()).not.toContain('Old note');
    expect(opened.session.bodyText()).not.toContain('Click here to enter text.');
  });

  test('an empty value shows the placeholder the control names', () => {
    const named = '<w:placeholder><w:docPart w:val="NotePrompt"/></w:placeholder><w:text/>';
    const bytes = docWith(paragraph(bound('/ns0:contract/ns0:note', named, 'Old note')));
    expect(mainXml(bytes)).toContain('<w:showingPlcHdr/>');
    const opened = openTreeSession(bytes);
    if (!opened.ok) throw new Error(opened.reason);
    // The glossary has no such block, so the open shows the type's prompt.
    expect(opened.session.bodyText()).toContain('Click here to enter text.');
    expect(opened.session.bodyText()).not.toContain('Old note');
  });

  test('a list control without a saved last value is left alone when its text matches', () => {
    const dropdown =
      '<w:dropDownList><w:listItem w:displayText="North region" w:value="north"/></w:dropDownList>';
    const combo =
      '<w:comboBox><w:listItem w:displayText="North region" w:value="north"/></w:comboBox>';
    const bytes = docWith(
      paragraph(bound('/ns0:contract/ns0:region', dropdown, 'North region')) +
        paragraph(bound('/ns0:contract/ns0:region', combo, 'North region'))
    );
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    expect(refreshBoundContent(loaded.package)).toBe(loaded.package);
  });

  test('a value that cannot be placed keeps the cached content', () => {
    const dropdown =
      '<w:dropDownList><w:listItem w:displayText="East" w:value="east"/></w:dropDownList>';
    const bytes = docWith(
      paragraph(bound('/ns0:contract/ns0:region', dropdown, 'East')) +
        paragraph(bound('/ns0:contract/ns0:missing', '<w:text/>', 'Kept one')) +
        paragraph(bound('//ns0:party', '<w:text/>', 'Kept two')) +
        paragraph(
          bound(
            '/ns0:contract/ns0:party',
            '<w:text/>',
            'Kept three',
            '{00000000-0000-0000-0000-000000000000}'
          )
        ) +
        paragraph(bound('/ns0:contract/ns0:party', '', 'Rich kept'))
    );
    const xml = mainXml(bytes);
    // A control with no type element is rich text: its paragraphs stay as the file wrote them.
    for (const kept of ['>East<', 'Kept one', 'Kept two', 'Kept three', 'Rich kept'])
      expect(xml).toContain(kept);
  });

  test('a date whose stored day matches keeps the text in its own format', () => {
    const date = (fullDate: string) =>
      `<w:date w:fullDate="${fullDate}"><w:dateFormat w:val="dddd, d MMMM yyyy"/><w:lid w:val="fr-FR"/></w:date>`;
    const xml = mainXml(
      docWith(
        paragraph(
          bound('/ns0:contract/ns0:signed', date('2026-03-04T00:00:00Z'), 'mercredi 4 mars 2026')
        ) +
          paragraph(
            bound(
              '/ns0:contract/ns0:signed',
              date('2020-01-01T00:00:00Z'),
              'mercredi 1 janvier 2020'
            )
          )
      )
    );
    expect(xml).toContain('mercredi 4 mars 2026');
    // A different stored day is rewritten.
    expect(xml).not.toContain('janvier 2020');
  });

  test('an attribute value past the bound keeps the cached content', () => {
    const store = `<ns0:contract xmlns:ns0="${NS}"><ns0:party role="${'r'.repeat(40_000)}"/></ns0:contract>`;
    const xml = mainXml(
      docWith(paragraph(bound('/ns0:contract/ns0:party/@role', '<w:text/>', 'Kept role')), store)
    );
    expect(xml).toContain('Kept role');
  });

  test('a control already showing the value leaves the package untouched', () => {
    const loaded = readOoxmlPackage(
      docWith(paragraph(bound('/ns0:contract/ns0:party[1]', '<w:text/>', 'Northwind Traders')))
    );
    if (!loaded.ok) throw new Error(loaded.reason);
    expect(refreshBoundContent(loaded.package)).toBe(loaded.package);
  });

  test('core document properties bind through their fixed store ID', () => {
    const bytes = zipDoc({
      body:
        paragraph(
          `<w:sdt><w:sdtPr><w:dataBinding w:prefixMappings="xmlns:ns0='http://purl.org/dc/elements/1.1/' xmlns:ns1='http://schemas.openxmlformats.org/package/2006/metadata/core-properties'" w:xpath="/ns1:coreProperties[1]/ns0:title[1]" w:storeItemID="${CORE_PROPERTIES_STORE_ID}"/><w:text/></w:sdtPr>` +
            '<w:sdtContent><w:r><w:t>Old title</w:t></w:r></w:sdtContent></w:sdt>'
        ) + '<w:sectPr/>',
      extraXml: {
        '_rels/.rels':
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          `<Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="word/document.xml"/>` +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
          '</Relationships>',
        'docProps/core.xml':
          '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Annual Report</dc:title></cp:coreProperties>',
      },
      overrides:
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    });
    const xml = mainXml(bytes);
    expect(xml).toContain('Annual Report');
    expect(xml).not.toContain('Old title');
  });

  test('the session opens refreshed and saves the refreshed text', () => {
    const opened = openTreeSession(
      docWith(paragraph(bound('/ns0:contract/ns0:party[2]', '<w:text/>', 'Old seller')))
    );
    if (!opened.ok) throw new Error(opened.reason);
    const saved = readOoxmlPackage(opened.session.save());
    if (!saved.ok) throw new Error(saved.reason);
    const xml = serializeOoxmlPart(saved.package.parts.get(saved.package.mainDocumentPart)!);
    expect(xml).toContain('Contoso Ltd');
    expect(xml).not.toContain('Old seller');
  });
});

describe('binding XPath shape', () => {
  const mappings = parsePrefixMappings(MAPPINGS)!;
  test('accepts child steps, positions, an attribute and text()', () => {
    expect(parseBindingXPath('/ns0:a[1]/ns0:b[3]/@id', mappings)).not.toBeNull();
    expect(parseBindingXPath('/ns0:a/ns0:b/text()', mappings)).not.toBeNull();
  });
  test('refuses anything else', () => {
    for (const xpath of [
      'ns0:a',
      '//ns0:a',
      '/ns0:a[@id="1"]',
      '/ns0:a/ns0:b[last()]',
      '/ns0:a/..',
      '/ns1:a',
      '/ns0:a[0]',
      `/${'ns0:a/'.repeat(40)}ns0:b`,
    ])
      expect(parseBindingXPath(xpath, mappings)).toBeNull();
    expect(parsePrefixMappings('xmlns:ns0="x" junk')).toBeNull();
  });
});
