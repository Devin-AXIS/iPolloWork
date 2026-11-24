// Round-trip regression: typed content controls (`w:sdt` / `w:sdtContent` / `w:sdtPr`).
//
// Production still types these as `generic`; this suite pins the OpenSpec contract from
// `openspec/changes/typed-content-controls` against the natural node kinds the tree will
// expose: `contentControl`, `contentControlContent`, `contentControlProperties`, and
// `contentControlEndProperties`. Failures caused solely by missing production kinds are
// expected until the lane lands.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';
import {
  W14_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';

const W = WML_NAMESPACE_URI;
const W14 = W14_NAMESPACE_URI;
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
const MAIN_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

const COMPREHENSIVE = `${import.meta.dir}/../../../../../e2e/fixtures/comprehensive-word-element-test.docx`;

const KIND_CONTROL = 'contentControl';
const KIND_CONTENT = 'contentControlContent';
const KIND_PROPERTIES = 'contentControlProperties';
const KIND_END_PROPERTIES = 'contentControlEndProperties';

function load(body: string, extraNamespaces = ''): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"${extraNamespaces}><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: MAIN_CONTENT_TYPE }
  );
  if (!result.ok) throw new Error(`read failed: ${result.reason}`);
  return result.part;
}

function reopen(part: OoxmlPart): OoxmlPart {
  const saved = serializeOoxmlPart(part);
  const result = readOoxmlPart(saved, { name: part.name, contentType: part.contentType });
  if (!result.ok) throw new Error(`reopen failed: ${result.reason}`);
  return result.part;
}

function* walk(node: OoxmlNode): Generator<OoxmlNode> {
  yield node;
  if (node.kind === 'textValue') return;
  for (const child of node.children) yield* walk(child);
}

function nodesOfKind(part: OoxmlPart, kind: string): OoxmlNode[] {
  return [...walk(part.root)].filter((node) => node.kind === kind);
}

/** Every `w:sdt` wrapper, typed or not yet. */
function sdtWrappers(part: OoxmlPart): OoxmlNode[] {
  return [...walk(part.root)].filter(
    (node) => node.kind !== 'textValue' && node.localName === 'sdt'
  );
}

function scalarVal(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find((attribute) => attribute.localName === 'val')?.value;
}

function childByLocalName(parent: OoxmlNode, localName: string): OoxmlNode | undefined {
  if (parent.kind === 'textValue') return undefined;
  return parent.children.find(
    (child) => child.kind !== 'textValue' && child.localName === localName
  );
}

function propertiesOf(control: OoxmlNode): OoxmlNode | undefined {
  return childByLocalName(control, 'sdtPr');
}

function propertiesKind(part: OoxmlPart, control?: OoxmlNode): string | undefined {
  const wrapper = control ?? nodesOfKind(part, KIND_CONTROL)[0] ?? sdtWrappers(part)[0];
  if (!wrapper || wrapper.kind === 'textValue') return undefined;
  return propertiesOf(wrapper)?.kind;
}

function sdtPrChildLocalNames(control: OoxmlNode): string[] {
  const properties = propertiesOf(control);
  if (!properties || properties.kind === 'textValue') return [];
  return properties.children
    .filter((child) => child.kind !== 'textValue')
    .map((child) => child.localName);
}

function declaredControlId(control: OoxmlNode): string | undefined {
  const properties = propertiesOf(control);
  if (!properties || properties.kind === 'textValue') return undefined;
  const idNode = properties.children.find(
    (child) => child.kind !== 'textValue' && child.localName === 'id'
  );
  return idNode ? scalarVal(idNode) : undefined;
}

function mainPartOf(bytes: Uint8Array): OoxmlPart {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(`package read failed: ${loaded.reason}`);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!part) throw new Error('no main document part');
  return part;
}

describe('typed promotion — block and inline controls', () => {
  test('a block control in the body is typed with typed content and paragraph', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:alias w:val="Project"/></w:sdtPr><w:sdtContent>' +
        '<w:p><w:r><w:t>inside</w:t></w:r></w:p>' +
        '</w:sdtContent></w:sdt>'
    );
    const control = nodesOfKind(part, KIND_CONTROL)[0] ?? sdtWrappers(part)[0];
    expect(control?.kind).toBe(KIND_CONTROL);
    const content = childByLocalName(control!, 'sdtContent');
    expect(content?.kind).toBe(KIND_CONTENT);
    const paragraph = content?.children.find((child) => child.kind === 'paragraph');
    expect(paragraph?.kind).toBe('paragraph');
  });

  test('a block control inside a table cell types the same way', () => {
    const part = load(
      '<w:tbl><w:tr><w:tc>' +
        '<w:sdt><w:sdtPr/><w:sdtContent><w:p><w:r><w:t>cell control</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
        '</w:tc></w:tr></w:tbl>'
    );
    const control = nodesOfKind(part, KIND_CONTROL)[0] ?? sdtWrappers(part)[0];
    expect(control?.kind).toBe(KIND_CONTROL);
    expect(childByLocalName(control!, 'sdtContent')?.kind).toBe(KIND_CONTENT);
  });

  test('an inline control in run position is typed among paragraph children', () => {
    const part = load(
      `<w:p><w:r><w:t>before </w:t></w:r>` +
        '<w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>inside</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t> after</w:t></w:r></w:p>'
    );
    const paragraph = nodesOfKind(part, 'paragraph')[0];
    expect(paragraph?.kind).toBe('paragraph');
    if (!paragraph || paragraph.kind === 'textValue') throw new Error('no paragraph');
    const inline = paragraph.children.find(
      (child) =>
        child.kind === KIND_CONTROL || (child.kind !== 'textValue' && child.localName === 'sdt')
    );
    expect(inline?.kind).toBe(KIND_CONTROL);
  });

  test('row-level and cell-level wrappers type their table content', () => {
    const rowPart = load(
      '<w:tbl><w:sdt><w:sdtPr/><w:sdtContent>' +
        '<w:tr><w:tc><w:p><w:r><w:t>row</w:t></w:r></w:p></w:tc></w:tr>' +
        '</w:sdtContent></w:sdt></w:tbl>'
    );
    const rowControl = nodesOfKind(rowPart, KIND_CONTROL)[0] ?? sdtWrappers(rowPart)[0];
    expect(rowControl?.kind).toBe(KIND_CONTROL);
    const rowContent = childByLocalName(rowControl!, 'sdtContent');
    expect(rowContent?.children.some((child) => child.kind === 'tableRow')).toBe(true);

    const cellPart = load(
      '<w:tbl><w:tr>' +
        '<w:sdt><w:sdtPr/><w:sdtContent><w:tc><w:p><w:r><w:t>cell shell</w:t></w:r></w:p></w:tc></w:sdtContent></w:sdt>' +
        '</w:tr></w:tbl>'
    );
    const cellControl = nodesOfKind(cellPart, KIND_CONTROL)[0] ?? sdtWrappers(cellPart)[0];
    expect(cellControl?.kind).toBe(KIND_CONTROL);
    const cellContent = childByLocalName(cellControl!, 'sdtContent');
    expect(cellContent?.children.some((child) => child.kind === 'tableCell')).toBe(true);
  });
});

describe('CT_SdtPr schema order and property preservation', () => {
  const BODY =
    '<w:sdt><w:sdtPr>' +
    '<w:alias w:val="Alias"/><w:tag w:val="Tag"/><w:id w:val="42"/>' +
    '<w:lock w:val="sdtContentLocked"/><w:temporary/>' +
    '<w:showingPlcHdr/>' +
    '<w:dataBinding w:prefixMappings="x" w:storeItemID="{GUID}" w:xpath="/root/item"/>' +
    '<w:dropDownList><w:listItem w:displayText="One" w:value="1"/></w:dropDownList>' +
    '</w:sdtPr><w:sdtContent><w:p><w:r><w:t>x</w:t></w:r></w:p></w:sdtContent></w:sdt>';

  test('w:sdtPr is typed and children stay in schema order', () => {
    const part = load(BODY);
    expect(propertiesKind(part)).toBe(KIND_PROPERTIES);
    const control = nodesOfKind(part, KIND_CONTROL)[0] ?? sdtWrappers(part)[0]!;
    expect(sdtPrChildLocalNames(control)).toEqual([
      'alias',
      'tag',
      'id',
      'lock',
      'temporary',
      'showingPlcHdr',
      'dataBinding',
      'dropDownList',
    ]);
  });

  test('alias, tag, id, lock, showingPlcHdr, temporary, and dataBinding survive reopen', () => {
    const part = load(BODY);
    const reopened = reopen(part);
    const xml = serializeOoxmlPart(reopened);
    expect(xml).toContain('w:val="Alias"');
    expect(xml).toContain('w:val="Tag"');
    expect(xml).toContain('w:val="42"');
    expect(xml).toContain('w:val="sdtContentLocked"');
    expect(xml).toContain('<w:temporary');
    expect(xml).toContain('<w:showingPlcHdr');
    expect(xml).toContain('w:xpath="/root/item"');
    expect(xml).toContain('w:storeItemID="{GUID}"');
    expect(xml).toContain('w:prefixMappings="x"');
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(part));
  });

  test('dropdown list items are readable without walking generic nodes', () => {
    const part = load(BODY);
    const control = nodesOfKind(part, KIND_CONTROL)[0] ?? sdtWrappers(part)[0]!;
    const properties = propertiesOf(control);
    expect(properties?.kind).toBe(KIND_PROPERTIES);
    const dropdown = properties?.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'dropDownList'
    );
    expect(dropdown?.kind).not.toBe('generic');
    const item = dropdown?.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'listItem'
    );
    expect(item?.kind).not.toBe('generic');
    if (!item || item.kind === 'textValue') throw new Error('no list item');
    const display = item.attributes.find(
      (attribute) => attribute.localName === 'displayText'
    )?.value;
    const value = item.attributes.find((attribute) => attribute.localName === 'value')?.value;
    expect(display).toBe('One');
    expect(value).toBe('1');
  });

  test('w:sdtEndPr is typed as contentControlEndProperties', () => {
    const part = load(
      '<w:sdt><w:sdtPr/><w:sdtEndPr><w:rPr><w:i/></w:rPr></w:sdtEndPr>' +
        '<w:sdtContent><w:p><w:r><w:t>x</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const control = nodesOfKind(part, KIND_CONTROL)[0] ?? sdtWrappers(part)[0]!;
    expect(childByLocalName(control, 'sdtEndPr')?.kind).toBe(KIND_END_PROPERTIES);
    expect(canonicalOoxmlFingerprint(reopen(part))).toBe(canonicalOoxmlFingerprint(part));
  });
});

describe('nested controls and control identity', () => {
  test('nested controls each type independently', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:alias w:val="outer"/></w:sdtPr><w:sdtContent>' +
        '<w:sdt><w:sdtPr><w:alias w:val="inner"/></w:sdtPr><w:sdtContent>' +
        '<w:p><w:r><w:t>nested</w:t></w:r></w:p>' +
        '</w:sdtContent></w:sdt>' +
        '</w:sdtContent></w:sdt>'
    );
    const controls = nodesOfKind(part, KIND_CONTROL);
    expect(controls.length).toBe(2);
    expect(controls.every((control) => control.kind === KIND_CONTROL)).toBe(true);
    expect(
      controls.map((control) => scalarVal(childByLocalName(propertiesOf(control)!, 'alias')!))
    ).toEqual(['outer', 'inner']);
  });

  test('duplicate w:id values load as separately addressable controls', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>a</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
        '<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>b</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const controls = nodesOfKind(part, KIND_CONTROL).length
      ? nodesOfKind(part, KIND_CONTROL)
      : sdtWrappers(part);
    expect(controls).toHaveLength(2);
    expect(controls[0]?.id).not.toBe(controls[1]?.id);
    expect(controls.map(declaredControlId)).toEqual(['7', '7']);
  });

  test('a control without w:id is not given one on save', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:alias w:val="NoId"/></w:sdtPr><w:sdtContent>' +
        '<w:p><w:r><w:t>text</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const reopened = reopen(part);
    const control = nodesOfKind(reopened, KIND_CONTROL)[0] ?? sdtWrappers(reopened)[0]!;
    expect(declaredControlId(control)).toBeUndefined();
    expect(serializeOoxmlPart(reopened)).not.toContain('<w:id');
  });
});

describe('unmodelled properties and malformed sdtPr', () => {
  test('a foreign-namespace child in w:sdtPr is preserved in position', () => {
    const part = load(
      '<w:sdt><w:sdtPr>' +
        '<w:alias w:val="A"/>' +
        '<w15:custom xmlns:w15="' +
        W15 +
        '" w15:val="ext"/>' +
        '<w:tag w:val="B"/>' +
        '</w:sdtPr><w:sdtContent><w:p><w:r><w:t>x</w:t></w:r></w:p></w:sdtContent></w:sdt>',
      ` xmlns:w15="${W15}"`
    );
    const control = nodesOfKind(part, KIND_CONTROL)[0] ?? sdtWrappers(part)[0]!;
    const properties = propertiesOf(control);
    expect(properties?.kind).toBe(KIND_PROPERTIES);
    const names = sdtPrChildLocalNames(control);
    expect(names).toEqual(['alias', 'custom', 'tag']);
    const extension = properties?.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'custom'
    );
    expect(extension?.kind).toBe('generic');
    expect(canonicalOoxmlFingerprint(reopen(part))).toBe(canonicalOoxmlFingerprint(part));
  });

  test('duplicate w:sdtPr children demote the malformed control wrapper', () => {
    const part = load(
      '<w:sdt>' +
        '<w:sdtPr><w:alias w:val="first"/></w:sdtPr>' +
        '<w:sdtPr><w:tag w:val="second"/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>x</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    expect(sdtWrappers(part)[0]?.kind).toBe('generic');
    // Lossless even when demoted — both property blocks must survive.
    const xml = serializeOoxmlPart(reopen(part));
    expect(xml).toContain('w:val="first"');
    expect(xml).toContain('w:val="second"');
    expect(canonicalOoxmlFingerprint(reopen(part))).toBe(canonicalOoxmlFingerprint(part));
  });
});

describe('w14:checkbox extension', () => {
  test('w14:checkbox is typed separately from ECMA type elements', () => {
    const part = load(
      `<w:p>` +
        `<w:sdt><w:sdtPr>` +
        `<w14:checkbox xmlns:w14="${W14}">` +
        `<w14:checked w14:val="1"/>` +
        `<w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
        `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>` +
        `</w14:checkbox>` +
        `</w:sdtPr><w:sdtContent><w:r><w:sym w:font="MS Gothic" w:char="2612"/></w:r></w:sdtContent></w:sdt>` +
        `</w:p>`,
      ` xmlns:w14="${W14}"`
    );
    const control = nodesOfKind(part, KIND_CONTROL)[0] ?? sdtWrappers(part)[0]!;
    const properties = propertiesOf(control);
    expect(properties?.kind).toBe(KIND_PROPERTIES);
    const checkbox = properties?.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'checkbox'
    );
    expect(checkbox?.kind).not.toBe('generic');
    expect(checkbox?.namespaceUri).toBe(W14);
    expect(canonicalOoxmlFingerprint(reopen(part))).toBe(canonicalOoxmlFingerprint(part));
  });
});

describe('malformed control payload preservation', () => {
  test('duplicate sdtContent and extension siblings survive serialize/reopen', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>first</w:t></w:r></w:sdtContent>' +
        '<w:extLst><w:ext w:uri="{hostile}"/></w:extLst>' +
        '<w:sdtContent><w:r><w:t>second</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    const control = sdtWrappers(part)[0]!;
    const contents = control.children.filter(
      (child) => child.kind !== 'textValue' && child.localName === 'sdtContent'
    );
    const extension = childByLocalName(control, 'extLst');
    expect(contents.length).toBe(2);
    expect(extension).toBeDefined();
    const reopened = reopen(part);
    const again = sdtWrappers(reopened)[0]!;
    expect(
      again.children.filter(
        (child) => child.kind !== 'textValue' && child.localName === 'sdtContent'
      )
    ).toHaveLength(2);
    expect(childByLocalName(again, 'extLst')).toBeDefined();
    expect(serializeOoxmlPart(reopened)).toContain('first');
    expect(serializeOoxmlPart(reopened)).toContain('second');
    expect(serializeOoxmlPart(reopened)).toContain('{hostile}');
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(part));
  });
});

const comprehensiveBytes = readFileSync(COMPREHENSIVE);

function readComprehensivePackage() {
  const loaded = readOoxmlPackage(new Uint8Array(comprehensiveBytes));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

describe('the comprehensive fixture round-trips all seventeen controls unedited', () => {
  test('the premise: seventeen w:sdt wrappers in the main story', () => {
    const part = mainPartOf(new Uint8Array(comprehensiveBytes));
    expect(sdtWrappers(part)).toHaveLength(17);
  });

  test('every control is typed once production lands', () => {
    const part = mainPartOf(new Uint8Array(comprehensiveBytes));
    expect(nodesOfKind(part, KIND_CONTROL)).toHaveLength(17);
    expect(nodesOfKind(part, KIND_CONTENT)).toHaveLength(17);
  });

  test('five controls omit w:id and saving does not fabricate one', () => {
    const part = mainPartOf(new Uint8Array(comprehensiveBytes));
    const controls = nodesOfKind(part, KIND_CONTROL).length
      ? nodesOfKind(part, KIND_CONTROL)
      : sdtWrappers(part);
    const withoutId = controls.filter((control) => declaredControlId(control) === undefined);
    expect(withoutId).toHaveLength(5);
    const reopened = mainPartOf(writeOoxmlPackage(readComprehensivePackage()));
    const reopenedControls = nodesOfKind(reopened, KIND_CONTROL).length
      ? nodesOfKind(reopened, KIND_CONTROL)
      : sdtWrappers(reopened);
    for (const control of withoutId) {
      const match = reopenedControls.find((candidate) => candidate.id === control.id);
      expect(match).toBeDefined();
      expect(declaredControlId(match!)).toBeUndefined();
    }
  });

  test('the canonical fingerprint is unchanged by a save and reopen', () => {
    const first = mainPartOf(new Uint8Array(comprehensiveBytes));
    const reopened = mainPartOf(writeOoxmlPackage(readComprehensivePackage()));
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(first));
  });

  test('the semantic digest reports no difference', () => {
    const first = mainPartOf(new Uint8Array(comprehensiveBytes));
    const reopened = mainPartOf(writeOoxmlPackage(readComprehensivePackage()));
    expect(diffSemanticDigests(semanticDigest([first]), semanticDigest([reopened]))).toEqual([]);
  });
});
