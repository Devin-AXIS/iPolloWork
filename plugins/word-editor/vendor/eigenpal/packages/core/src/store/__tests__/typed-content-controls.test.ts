// Typed content-control canonical nodes: kinds at every level, `CT_SdtPr` projection,
// identity independent of `w:id`, and the D9 fingerprint over the fixtures' controls.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_CONTENT_CONTROL_NESTING,
  allocateContentControlId,
  canonicalOoxmlFingerprint,
  contentControlContentNodeOf,
  contentControlLevelOf,
  contentControlPropertiesOf,
  contentControlTextOf,
  contentControlsIn,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

const docMeta = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}" xmlns:w15="${W15}"><w:body>${bodyInner}</w:body></w:document>`,
    docMeta
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function bodyOf(part: OoxmlPart): OoxmlElement {
  const body = part.root.children.find((child) => child.kind === 'body');
  if (!body || body.kind !== 'body') throw new Error('missing body');
  return body;
}

function controlsOf(part: OoxmlPart): readonly OoxmlElement[] {
  return contentControlsIn(part.root).map((entry) => entry.node);
}

function reparse(part: OoxmlPart): OoxmlPart {
  const result = readOoxmlPart(serializeOoxmlPart(part), docMeta);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

describe('content controls are typed canonical nodes at every level', () => {
  test('a block control in the body types its wrapper, properties and content', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:alias w:val="Intro"/><w:tag w:val="intro"/><w:id w:val="101"/><w:richText/></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    const control = bodyOf(part).children[0]!;
    expect(control.kind).toBe('contentControl');
    if (control.kind === 'textValue') throw new Error('unreachable');
    expect(control.children.map((child) => child.kind)).toEqual([
      'contentControlProperties',
      'contentControlContent',
    ]);
    const content = contentControlContentNodeOf(control);
    expect(content?.children[0]?.kind).toBe('paragraph');
    expect(contentControlLevelOf(control)).toBe('block');
  });

  test('a block control inside a table cell types the same way', () => {
    const part = parseDoc(
      `<w:tbl><w:tr><w:tc><w:sdt><w:sdtPr><w:tag w:val="in-cell"/></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:sdtContent></w:sdt></w:tc></w:tr></w:tbl>`
    );
    const table = bodyOf(part).children[0]!;
    expect(table.kind).toBe('table');
    const controls = controlsOf(part);
    expect(controls).toHaveLength(1);
    expect(contentControlLevelOf(controls[0]!)).toBe('block');
    // The cell keeps its typed kind: a control inside it must not demote its container.
    if (table.kind === 'textValue') throw new Error('unreachable');
    const row = table.children.find((child) => child.kind === 'tableRow');
    expect(row?.kind).toBe('tableRow');
    if (!row || row.kind === 'textValue') throw new Error('unreachable');
    expect(row.children[0]?.kind).toBe('tableCell');
  });

  test('an inline control in run position types, and its paragraph stays typed', () => {
    const part = parseDoc(
      `<w:p><w:r><w:t>a</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="1"/></w14:checkbox></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>b</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    const paragraph = bodyOf(part).children[0]!;
    expect(paragraph.kind).toBe('paragraph');
    if (paragraph.kind === 'textValue') throw new Error('unreachable');
    expect(paragraph.children[1]?.kind).toBe('contentControl');
    expect(contentControlLevelOf(paragraph.children[1] as OoxmlElement)).toBe('inline');
  });

  test('customXml content distinguishes block and inline controls', () => {
    const block = controlsOf(
      parseDoc(
        '<w:sdt><w:sdtContent><w:customXml><w:p><w:r><w:t>block</w:t></w:r></w:p>' +
          '</w:customXml></w:sdtContent></w:sdt>'
      )
    )[0]!;
    const inline = controlsOf(
      parseDoc(
        '<w:p><w:sdt><w:sdtContent><w:customXml><w:r><w:t>inline</w:t></w:r>' +
          '</w:customXml></w:sdtContent></w:sdt></w:p>'
      )
    )[0]!;
    expect(contentControlLevelOf(block)).toBe('block');
    expect(contentControlLevelOf(inline)).toBe('inline');
  });

  test('row-level and cell-level controls type at their own level', () => {
    const part = parseDoc(
      `<w:tbl>` +
        `<w:sdt><w:sdtPr><w:tag w:val="row"/></w:sdtPr><w:sdtContent><w:tr><w:tc><w:p/></w:tc></w:tr></w:sdtContent></w:sdt>` +
        `<w:tr><w:sdt><w:sdtPr><w:tag w:val="cell"/></w:sdtPr><w:sdtContent><w:tc><w:p/></w:tc></w:sdtContent></w:sdt></w:tr>` +
        `</w:tbl>`
    );
    const table = bodyOf(part).children[0]!;
    expect(table.kind).toBe('table');
    const controls = controlsOf(part);
    expect(controls.map((control) => contentControlLevelOf(control))).toEqual(['row', 'cell']);
  });

  test('a misplaced `w:sdtContent` outside a control stays generic rather than demoting its parent', () => {
    const part = parseDoc(`<w:p><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:p>`);
    const paragraph = bodyOf(part).children[0]!;
    expect(paragraph.kind).toBe('paragraph');
    if (paragraph.kind === 'textValue') throw new Error('unreachable');
    expect(paragraph.children[0]?.kind).toBe('generic');
  });
});

describe('CT_SdtPr is projected as typed properties', () => {
  test('alias, tag, id, lock and dropdown items are readable without walking generics', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:alias w:val="Status"/><w:tag w:val="status"/><w:id w:val="202"/>` +
        `<w:lock w:val="sdtContentLocked"/>` +
        `<w:dropDownList w:lastValue="1"><w:listItem w:displayText="Draft" w:value="1"/>` +
        `<w:listItem w:displayText="Final" w:value="2"/></w:dropDownList></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>Draft</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    const properties = contentControlPropertiesOf(controlsOf(part)[0]!);
    expect(properties.alias).toBe('Status');
    expect(properties.tag).toBe('status');
    expect(properties.id).toBe(202);
    expect(properties.lock).toBe('sdtContentLocked');
    expect(properties.type).toBe('dropDownList');
    expect(properties.lastValue).toBe('1');
    expect(properties.listItems).toEqual([
      { displayText: 'Draft', value: '1' },
      { displayText: 'Final', value: '2' },
    ]);
  });

  test('date configuration is typed', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:date w:fullDate="2020-01-01T00:00:00Z">` +
        `<w:dateFormat w:val="MMMM d, yyyy"/><w:lid w:val="en-US"/>` +
        `<w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>January 1, 2020</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    const properties = contentControlPropertiesOf(controlsOf(part)[0]!);
    expect(properties.type).toBe('date');
    expect(properties.date).toEqual({
      fullDate: '2020-01-01T00:00:00Z',
      dateFormat: 'MMMM d, yyyy',
      lid: 'en-US',
      storeMappedDataAs: 'dateTime',
      calendar: 'gregorian',
    });
  });

  test('`w:text` carries multiLine, and an untyped control is a rich-text container', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:text w:multiLine="1"/></w:sdtPr><w:sdtContent><w:p/></w:sdtContent></w:sdt>` +
        `<w:sdt><w:sdtPr><w:alias w:val="None"/></w:sdtPr><w:sdtContent><w:p/></w:sdtContent></w:sdt>`
    );
    const [text, untyped] = controlsOf(part);
    expect(contentControlPropertiesOf(text!).type).toBe('plainText');
    expect(contentControlPropertiesOf(text!).multiLine).toBe(true);
    expect(contentControlPropertiesOf(untyped!).type).toBe('untyped');
  });

  test('the checkbox extension is read before a control is called untyped', () => {
    const part = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="1"/>` +
        `<w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
        `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr>` +
        `<w:sdtContent><w:r><w:sym w:char="2612" w:font="MS Gothic"/></w:r></w:sdtContent></w:sdt></w:p>`
    );
    const properties = contentControlPropertiesOf(controlsOf(part)[0]!);
    expect(properties.type).toBe('checkbox');
    expect(properties.checkbox).toEqual({
      checked: true,
      checkedState: { value: '2612', font: 'MS Gothic' },
      uncheckedState: { value: '2610', font: 'MS Gothic' },
    });
  });

  test('a bare symbol with no checkbox extension is not a checkbox', () => {
    const part = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="sym"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:sym w:char="2612"/></w:r></w:sdtContent></w:sdt></w:p>`
    );
    expect(contentControlPropertiesOf(controlsOf(part)[0]!).type).toBe('untyped');
    expect(contentControlPropertiesOf(controlsOf(part)[0]!).checkbox).toBeUndefined();
  });

  test('placeholder, temporary, showingPlcHdr, tabIndex and label are typed state', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:placeholder><w:docPart w:val="DefaultPlaceholder_1081868574"/></w:placeholder>` +
        `<w:temporary/><w:showingPlcHdr/><w:label w:val="7"/><w:tabIndex w:val="3"/></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>Enter project name</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    const properties = contentControlPropertiesOf(controlsOf(part)[0]!);
    expect(properties.placeholderDocPart).toBe('DefaultPlaceholder_1081868574');
    expect(properties.temporary).toBe(true);
    expect(properties.showingPlaceholder).toBe(true);
    expect(properties.label).toBe('7');
    expect(properties.tabIndex).toBe(3);
  });

  test('data binding is typed and never resolved', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:dataBinding w:prefixMappings="xmlns:ns0='http://example.com/cust'"` +
        ` w:xpath="/ns0:root[1]/ns0:field[1]" w:storeItemID="{1B2C3D4E-0000-0000-0000-000000000001}"/>` +
        `<w:text/></w:sdtPr><w:sdtContent><w:p/></w:sdtContent></w:sdt>`
    );
    const properties = contentControlPropertiesOf(controlsOf(part)[0]!);
    expect(properties.dataBinding).toEqual({
      xpath: '/ns0:root[1]/ns0:field[1]',
      storeItemID: '{1B2C3D4E-0000-0000-0000-000000000001}',
      prefixMappings: "xmlns:ns0='http://example.com/cust'",
    });
  });

  test('an unmodelled property survives as a generic child in position', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:alias w:val="Rows"/><w15:repeatingSection/><w:tag w:val="rows"/></w:sdtPr>` +
        `<w:sdtContent><w:p/></w:sdtContent></w:sdt>`
    );
    const control = controlsOf(part)[0]!;
    const sdtPr = control.children[0]!;
    if (sdtPr.kind === 'textValue') throw new Error('unreachable');
    expect(
      sdtPr.children.map((child) => (child.kind === 'textValue' ? '' : child.localName))
    ).toEqual(['alias', 'repeatingSection', 'tag']);
    expect(contentControlPropertiesOf(control).type).toBe('untyped');
    expect(canonicalOoxmlFingerprint(reparse(part))).toBe(canonicalOoxmlFingerprint(part));
  });

  test('`w:sdtEndPr` is a typed member of the sequence and round-trips', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="end"/></w:sdtPr>` +
        `<w:sdtEndPr><w:rPr><w:b/></w:rPr></w:sdtEndPr>` +
        `<w:sdtContent><w:p/></w:sdtContent></w:sdt>`
    );
    const control = controlsOf(part)[0]!;
    expect(control.children.map((child) => child.kind)).toEqual([
      'contentControlProperties',
      'contentControlEndProperties',
      'contentControlContent',
    ]);
    expect(canonicalOoxmlFingerprint(reparse(part))).toBe(canonicalOoxmlFingerprint(part));
  });
});

describe('control identity is stable and independent of `w:id`', () => {
  test('a control with no `w:id` is addressable by node identity and gains none on save', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="anon"/></w:sdtPr><w:sdtContent><w:p/></w:sdtContent></w:sdt>`
    );
    const control = controlsOf(part)[0]!;
    expect(contentControlPropertiesOf(control).id).toBeUndefined();
    expect(control.id.length).toBeGreaterThan(0);
    expect(serializeOoxmlPart(part)).not.toContain('<w:id');
  });

  test('two controls declaring the same `w:id` both load and stay separately addressable', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:id w:val="5"/><w:tag w:val="one"/></w:sdtPr><w:sdtContent><w:p/></w:sdtContent></w:sdt>` +
        `<w:sdt><w:sdtPr><w:id w:val="5"/><w:tag w:val="two"/></w:sdtPr><w:sdtContent><w:p/></w:sdtContent></w:sdt>`
    );
    const controls = controlsOf(part);
    expect(controls).toHaveLength(2);
    expect(controls[0]!.id).not.toBe(controls[1]!.id);
    expect(controls.map((control) => contentControlPropertiesOf(control).tag)).toEqual([
      'one',
      'two',
    ]);
  });

  test('an id is allocated from the document maximum plus one, never from a clock', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:id w:val="90210"/></w:sdtPr><w:sdtContent><w:p/></w:sdtContent></w:sdt>`
    );
    expect(allocateContentControlId(part.root)).toBe(90211);
  });

  test('allocation stays inside signed 32-bit and refuses rather than wrapping', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:id w:val="2147483647"/></w:sdtPr><w:sdtContent><w:p/></w:sdtContent></w:sdt>`
    );
    expect(allocateContentControlId(part.root)).toBeNull();
  });
});

describe('nesting is bounded and content survives past the bound', () => {
  test('a document nesting controls past the bound loads with its content preserved', () => {
    const depth = MAX_CONTENT_CONTROL_NESTING + 5;
    let inner = `<w:p><w:r><w:t>deep</w:t></w:r></w:p>`;
    for (let index = 0; index < depth; index += 1) {
      inner = `<w:sdt><w:sdtPr><w:tag w:val="n${index}"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
    }
    const part = parseDoc(inner);
    // The walk stops at the bound rather than recursing, and nothing is dropped from the tree.
    expect(contentControlsIn(part.root)).toHaveLength(MAX_CONTENT_CONTROL_NESTING);
    expect(serializeOoxmlPart(part)).toContain('deep');
    expect(canonicalOoxmlFingerprint(reparse(part))).toBe(canonicalOoxmlFingerprint(part));
  });
});

// `CT_SdtRow` and `CT_SdtCell` are read positions, not written ones: the wrapper is unwrapped
// where a walk filters on row or cell, and the serializer never learned about it. The fingerprint
// is what says so.
describe('a control around a row or a cell is preserved as the file wrote it', () => {
  const grid = (columns: number) =>
    `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(columns)}</w:tblGrid>`;
  const cell = (text: string) => `<w:tc><w:tcPr/><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

  test('a controlled row round-trips by fingerprint', () => {
    const part = parseDoc(
      `<w:tbl><w:tblPr/>${grid(1)}` +
        `<w:sdt><w:sdtPr><w:tag w:val="row"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:tr>${cell('held')}</w:tr></w:sdtContent></w:sdt>` +
        `</w:tbl>`
    );
    expect(contentControlsIn(part.root)).toHaveLength(1);
    expect(canonicalOoxmlFingerprint(reparse(part))).toBe(canonicalOoxmlFingerprint(part));
  });

  test('a controlled cell round-trips by fingerprint', () => {
    const part = parseDoc(
      `<w:tbl><w:tblPr/>${grid(2)}<w:tr>${cell('plain')}` +
        `<w:sdt><w:sdtPr><w:tag w:val="cell"/></w:sdtPr>` +
        `<w:sdtContent>${cell('held')}</w:sdtContent></w:sdt>` +
        `</w:tr></w:tbl>`
    );
    expect(contentControlsIn(part.root)).toHaveLength(1);
    expect(canonicalOoxmlFingerprint(reparse(part))).toBe(canonicalOoxmlFingerprint(part));
  });
});

describe('the comprehensive fixture survives the D9 fingerprint oracle', () => {
  function partOf(name: string): OoxmlPart {
    const bytes = readFileSync(join(import.meta.dir, '../../../../../e2e/fixtures', name));

    const { unzipSync } = require('fflate') as typeof import('fflate');
    const entries = unzipSync(new Uint8Array(bytes));
    const xml = new TextDecoder().decode(entries['word/document.xml']!);
    const result = readOoxmlPart(xml, docMeta);
    if (!result.ok) throw new Error(result.reason);
    return result.part;
  }

  function documentPart(): OoxmlPart {
    return partOf('comprehensive-word-element-test.docx');
  }

  test('all seventeen controls type, and an unedited round trip matches by fingerprint', () => {
    const part = documentPart();
    const controls = contentControlsIn(part.root);
    expect(controls).toHaveLength(17);
    const types = controls.map((entry) => contentControlPropertiesOf(entry.node).type);
    expect(types.filter((type) => type === 'checkbox')).toHaveLength(4);
    expect(types.filter((type) => type === 'dropDownList')).toHaveLength(3);
    expect(types.filter((type) => type === 'comboBox')).toHaveLength(2);
    expect(types.filter((type) => type === 'date')).toHaveLength(3);
    expect(types.filter((type) => type === 'plainText')).toHaveLength(2);
    expect(types.filter((type) => type === 'untyped')).toHaveLength(3);
    const round = readOoxmlPart(serializeOoxmlPart(part), docMeta);
    expect(round.ok).toBe(true);
    if (!round.ok) throw new Error(round.reason);
    expect(canonicalOoxmlFingerprint(round.part)).toBe(canonicalOoxmlFingerprint(part));
  });

  // A `w:dataBinding` NAMES a custom XML part and an XPath into it, and a control's placeholder
  // names a glossary entry. Reading either as an instruction to go and get something is the
  // zero-click fetch the file-safety rules forbid, so the whole cycle — load, project, lay out,
  // save — is run with every fetch primitive replaced by a throw.
  test('no part of the cycle fetches anything on account of a binding or a placeholder', () => {
    const reached: string[] = [];
    const trap =
      (name: string) =>
      (...args: readonly unknown[]) => {
        reached.push(`${name}(${String(args[0] ?? '')})`);
        throw new Error(`${name} must not be called`);
      };
    const globals = globalThis as unknown as Record<string, unknown>;
    const saved = {
      fetch: globals.fetch,
      XMLHttpRequest: globals.XMLHttpRequest,
      importScripts: globals.importScripts,
    };
    globals.fetch = trap('fetch');
    globals.XMLHttpRequest = trap('XMLHttpRequest');
    globals.importScripts = trap('importScripts');
    try {
      // Two files: the round-trip fixture, and the one that actually declares bindings.
      const part = documentPart();
      const boundPart = partOf('block-sdt-comprehensive.docx');
      const bound = contentControlsIn(boundPart.root).filter(
        (entry) => contentControlPropertiesOf(entry.node).dataBinding !== undefined
      );
      for (const entry of [...contentControlsIn(part.root), ...contentControlsIn(boundPart.root)]) {
        const properties = contentControlPropertiesOf(entry.node);
        // Both are read as the metadata they are: a string, not a resolver.
        expect(properties.dataBinding?.xpath ?? '').toBeTypeOf('string');
        expect(properties.placeholder ?? '').toBeTypeOf('string');
        contentControlTextOf(entry.node);
      }
      expect(bound.length).toBeGreaterThan(0);
      serializeOoxmlPart(part);
      serializeOoxmlPart(boundPart);
    } finally {
      globals.fetch = saved.fetch;
      globals.XMLHttpRequest = saved.XMLHttpRequest;
      globals.importScripts = saved.importScripts;
    }
    expect(reached).toEqual([]);
  });
});
