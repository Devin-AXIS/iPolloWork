import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { contentControlPropertiesOf, contentControlsIn } from '../package/content-control-nodes.ts';
import {
  customXmlNodes,
  readCustomXmlNode,
  withCustomXmlNode,
} from '../package/custom-xml-nodes.ts';
import { findCustomXmlDataPart } from '../package/custom-xml-part.ts';
import { boundCustomXmlNodeIds } from '../package/custom-node-payloads.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import {
  insertCustomNodeWrite,
  removeCustomNodeWrite,
  sweepCustomNodePayloads,
  MAX_CUSTOM_NODE_PAYLOAD_LENGTH,
} from '../store/custom-node-writes.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STORY = '/word/document.xml';
const NS = 'https://example.test/nodes';
const ROOT = 'nodes';

const DATA = JSON.stringify({
  sourceId: 'src_9f3',
  authors: ['Smith, J.', 'Okonkwo, A.'],
  year: 2024,
  locator: 'p.42',
});

/** One paragraph reading `Before after`, so offset 6 is a word boundary. */
function fixture(): OoxmlPackage {
  const loaded = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT_NS}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL_NS}">` +
          `<Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>` +
          '</Relationships>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Before after</w:t></w:r></w:p></w:body></w:document>`
      ),
      'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL_NS}"></Relationships>`),
    })
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function firstParagraphId(part: OoxmlPart): string {
  const body = part.root.children.find((child) => child.kind === 'body');
  if (!body || body.kind === 'textValue') throw new Error('no body');
  const paragraph = body.children.find((child) => child.kind === 'paragraph');
  if (!paragraph) throw new Error('no paragraph');
  return paragraph.id;
}

function controls(part: OoxmlPart): readonly OoxmlNode[] {
  return contentControlsIn(part.root).map((entry) => entry.node);
}

/** The `w:sdtPr` children of the first control, by local name and in document order. */
function propertyOrder(part: OoxmlPart): string[] {
  const control = controls(part)[0];
  if (!control) throw new Error('no control');
  const properties = control.children.find(
    (child) => child.kind !== 'textValue' && child.localName === 'sdtPr'
  );
  if (!properties || properties.kind === 'textValue') throw new Error('no sdtPr');
  return properties.children
    .filter((child) => child.kind !== 'textValue')
    .map((child) => child.localName);
}

function storeWith(): TreeDocumentStore {
  const pkg = fixture();
  return new TreeDocumentStore(pkg, pkg.mainDocumentPart);
}

function insert(
  store: TreeDocumentStore,
  overrides: Partial<Parameters<typeof insertCustomNodeWrite>[1]> = {}
) {
  return insertCustomNodeWrite(store, {
    paragraphId: firstParagraphId(store.part),
    offset: 6,
    tag: 'acme:citation?sourceId=src_9f3',
    text: '(Smith 2024)',
    lock: 'contentLocked',
    payload: {
      namespaceUri: NS,
      rootLocalName: ROOT,
      nodeId: 'cx1',
      label: '(Smith 2024)',
      data: DATA,
    },
    ...overrides,
  });
}

describe('one transaction authors the store, the node and the control', () => {
  test('the control binds to the store the same transaction wrote', () => {
    const store = storeWith();
    const written = insert(store);
    expect(written.ok).toBe(true);

    const pkg = store.package;
    const dataPart = findCustomXmlDataPart(pkg, STORY, NS);
    expect(dataPart).not.toBeNull();
    if (!dataPart) return;

    const node = readCustomXmlNode(pkg, dataPart.partName, 'cx1');
    expect(node?.label).toBe('(Smith 2024)');
    expect(node?.data).toBe(DATA);

    const binding = contentControlPropertiesOf(controls(store.part)[0]!).dataBinding;
    // The one link between the body and the part. A mismatch here is a control Word paints
    // from nothing.
    expect(binding?.storeItemID).toBe(dataPart.itemId);
    expect(binding?.xpath).toBe("/ns0:nodes/ns0:node[@id='cx1']/ns0:label");
    expect(binding?.prefixMappings).toBe(`xmlns:ns0='${NS}'`);
  });

  test('w:dataBinding sits after w:lock, where CT_SdtPr says it does', () => {
    // Out of order Word refuses the whole document rather than ignoring the element, so this
    // is the assertion that keeps the file openable.
    const store = storeWith();
    expect(insert(store).ok).toBe(true);
    expect(propertyOrder(store.part)).toEqual(['tag', 'id', 'lock', 'dataBinding']);
    const xml = serializeOoxmlPart(store.part);
    expect(xml.indexOf('<w:lock')).toBeLessThan(xml.indexOf('<w:dataBinding'));
  });

  test('the payload survives a save and a reopen', () => {
    const store = storeWith();
    expect(insert(store).ok).toBe(true);
    const reopened = readOoxmlPackage(writeOoxmlPackage(store.package));
    if (!reopened.ok) throw new Error(reopened.reason);
    const dataPart = findCustomXmlDataPart(reopened.package, STORY, NS);
    expect(dataPart).not.toBeNull();
    if (!dataPart) return;
    expect(readCustomXmlNode(reopened.package, dataPart.partName, 'cx1')?.data).toBe(DATA);
    // And the story still names it, which is what the sweep reads.
    const story = reopened.package.parts.get(STORY);
    expect(story && [...boundCustomXmlNodeIds(story, dataPart.itemId)]).toEqual(['cx1']);
  });

  test('a second node lands in the store the first one authored', () => {
    const store = storeWith();
    expect(insert(store).ok).toBe(true);
    expect(
      insert(store, {
        offset: 0,
        payload: {
          namespaceUri: NS,
          rootLocalName: ROOT,
          nodeId: 'cx2',
          label: '(Jones 2025)',
          data: '{"sourceId":"src_2"}',
        },
      }).ok
    ).toBe(true);
    const dataPart = findCustomXmlDataPart(store.package, STORY, NS);
    if (!dataPart) throw new Error('no store');
    expect(
      customXmlNodes(store.package, dataPart.partName)
        .map((node) => node.id)
        .sort()
    ).toEqual(['cx1', 'cx2']);
    // One store, not two: a second call must not author a sibling part.
    const names = [...store.package.parts.keys()].filter((name) =>
      /customXml\/item\d+\.xml$/.test(name)
    );
    expect(names).toEqual([dataPart.partName]);
  });

  test('a span is wrapped: the label replaces the words it covered', () => {
    const store = storeWith();
    // `Before` is offsets 0..6; the label takes its place and the rest of the line stays put.
    const written = insert(store, { offset: 0, replaceUntil: 6, text: '(Smith 2024)' });
    expect(written.ok).toBe(true);
    const body = store.part.root.children.find((child) => child.kind === 'body');
    const text = body && body.kind !== 'textValue' ? textOf(body) : '';
    expect(text).toBe('(Smith 2024) after');
  });
});

describe('the write answers which control it authored', () => {
  test('an insert names the control it created', () => {
    const store = storeWith();
    const result = insert(store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const controls = contentControlsIn(store.part.root);
    expect(controls).toHaveLength(1);
    expect(result.nodeId).toBe(controls[0]!.node.id);
  });

  test('a rewrite names the NEW control, not the one it replaced', () => {
    const store = storeWith();
    const first = insert(store);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const replaced = insert(store, {
      replaceControlId: first.nodeId,
      text: '(Smith 2025)',
      payload: {
        namespaceUri: NS,
        rootLocalName: ROOT,
        nodeId: 'cx2',
        label: '(Smith 2025)',
        data: DATA,
      },
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    // The id the caller passed in names nothing now, which is the whole reason it is answered.
    expect(replaced.nodeId).toBeDefined();
    expect(replaced.nodeId).not.toBe(first.nodeId);
    const controls = contentControlsIn(store.part.root);
    expect(controls).toHaveLength(1);
    expect(replaced.nodeId).toBe(controls[0]!.node.id);
  });

  test('a control with no payload is named too', () => {
    const store = storeWith();
    const result = insert(store, { payload: undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodeId).toBe(contentControlsIn(store.part.root)[0]!.node.id);
  });
});

describe('a refusal leaves nothing behind', () => {
  test('an id no XPath can name refuses, and authors no store', () => {
    const store = storeWith();
    const before = store.package;
    const written = insert(store, {
      payload: {
        namespaceUri: NS,
        rootLocalName: ROOT,
        // A quote would close the predicate and let the rest be an expression of the sender's.
        nodeId: "cx1']|//*[1]",
        label: 'x',
        data: '{}',
      },
    });
    expect(written.ok).toBe(false);
    if (!written.ok) expect(written.reason).toBe('unaddressable-payload');
    expect(findCustomXmlDataPart(store.package, STORY, NS)).toBeNull();
    expect(store.package).toBe(before);
  });

  test('a payload past the cap refuses before anything is written', () => {
    const store = storeWith();
    const written = insert(store, {
      payload: {
        namespaceUri: NS,
        rootLocalName: ROOT,
        nodeId: 'cx1',
        label: 'x',
        data: 'x'.repeat(MAX_CUSTOM_NODE_PAYLOAD_LENGTH + 1),
      },
    });
    expect(written.ok).toBe(false);
    if (!written.ok) expect(written.reason).toBe('payload-too-large');
    expect(findCustomXmlDataPart(store.package, STORY, NS)).toBeNull();
  });

  test('a body edit the tree refuses takes the store write with it', () => {
    // The half that matters: a store authored for a control that never landed is a payload
    // nothing points at, and the next call would author a second one beside it.
    const store = storeWith();
    const written = insert(store, { offset: 9_999 });
    expect(written.ok).toBe(false);
    if (!written.ok) expect(written.reason).toBe('offset-out-of-range');
    expect(findCustomXmlDataPart(store.package, STORY, NS)).toBeNull();
    expect(controls(store.part)).toHaveLength(0);
  });
});

describe('a label with an edge space keeps it', () => {
  test('the store re-asserts xml:space, which Word drops when the text does not need it', () => {
    const store = storeWith();
    expect(
      insert(store, {
        text: '(Smith 2024) ',
        payload: {
          namespaceUri: NS,
          rootLocalName: ROOT,
          nodeId: 'cx1',
          label: '(Smith 2024) ',
          data: '{}',
        },
      }).ok
    ).toBe(true);
    const dataPart = findCustomXmlDataPart(store.package, STORY, NS);
    if (!dataPart) throw new Error('no store');
    const part = store.package.parts.get(dataPart.partName);
    expect(part && serializeOoxmlPart(part)).toContain('xml:space="preserve"');
    // And it reads back with the space still on it, through a real save.
    const reopened = readOoxmlPackage(writeOoxmlPackage(store.package));
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(readCustomXmlNode(reopened.package, dataPart.partName, 'cx1')?.label).toBe(
      '(Smith 2024) '
    );
  });

  test('a label that does not need the attribute does not get one', () => {
    const store = storeWith();
    expect(insert(store).ok).toBe(true);
    const dataPart = findCustomXmlDataPart(store.package, STORY, NS);
    if (!dataPart) throw new Error('no store');
    const part = store.package.parts.get(dataPart.partName);
    expect(part && serializeOoxmlPart(part)).not.toContain('xml:space');
  });
});

describe('a payload does not outlive the control that bound it', () => {
  test('deleting the control removes its node in the same transaction', () => {
    const store = storeWith();
    expect(insert(store).ok).toBe(true);
    const dataPart = findCustomXmlDataPart(store.package, STORY, NS);
    if (!dataPart) throw new Error('no store');
    const controlId = controls(store.part)[0]!.id;

    const removed = removeCustomNodeWrite(store, controlId);
    expect(removed.ok).toBe(true);
    expect(controls(store.part)).toHaveLength(0);
    expect(customXmlNodes(store.package, dataPart.partName)).toEqual([]);
  });

  test('the sweep collects a node whose control was deleted in Word, and nothing else', () => {
    const store = storeWith();
    expect(insert(store).ok).toBe(true);
    const dataPart = findCustomXmlDataPart(store.package, STORY, NS);
    if (!dataPart) throw new Error('no store');
    // What Word leaves behind: the node, with the control gone and nothing binding it.
    const orphaned = withOrphanNode(store.package, dataPart.partName);

    const swept = sweepCustomNodePayloads(orphaned, STORY, [NS]);
    expect(swept.removed).toEqual(['deletedInWord']);
    expect(customXmlNodes(swept.pkg, dataPart.partName).map((node) => node.id)).toEqual(['cx1']);
  });

  test('a namespace no host claims is left alone', () => {
    // Word's own Cover Page Properties store rides in most templates. A sweep that walked every
    // customXml part would be deleting from it on the strength of a name collision.
    const store = storeWith();
    expect(insert(store).ok).toBe(true);
    const dataPart = findCustomXmlDataPart(store.package, STORY, NS);
    if (!dataPart) throw new Error('no store');
    const orphaned = withOrphanNode(store.package, dataPart.partName);

    const swept = sweepCustomNodePayloads(orphaned, STORY, ['https://example.test/other']);
    expect(swept.removed).toEqual([]);
    expect(customXmlNodes(swept.pkg, dataPart.partName)).toHaveLength(2);
  });
});

/** What a control deleted in Word leaves behind: a node with nothing binding it. */
function withOrphanNode(pkg: OoxmlPackage, partName: string): OoxmlPackage {
  return withCustomXmlNode(pkg, partName, { id: 'deletedInWord', label: 'D', data: '{}' });
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  let text = '';
  for (const child of node.children) text += textOf(child);
  return text;
}
