import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import type { ContentControlWidgetSession } from '../popup-sessions.ts';
import { buildingBlocksOf, type OoxmlElement, type OoxmlNode } from '../../store/index.ts';
import { serializeOoxmlPart } from '../../store/package/ooxml-serialize.ts';
import { applyTreeOp } from '../../store/store/tree-op-apply.ts';
import { paraIdOf } from '../../store/package/para-id.ts';
import { contentControlPropertiesOf, sdtPrChild } from '../../store/store/tree-op-nodes.ts';
import {
  captureOneJournal,
  openStore,
  replayAndCompare,
  walkNodes,
} from '../../store/__tests__/canonical-primitive-journal-coverage-support.ts';
import { decodePort, PNG_1X1, settle } from './image-decode-harness.ts';
import { createContentControlPictureWidget } from '../content-control-picture-widget.ts';

const catalog = new Uint8Array(
  readFileSync(new URL('../../../../../e2e/fixtures/form-controls-catalog.docx', import.meta.url))
);
function changed(
  main: (xml: string) => string = (x) => x,
  glossary: (xml: string) => string = (x) => x
) {
  const entries = unzipSync(catalog);
  entries['word/document.xml'] = strToU8(main(strFromU8(entries['word/document.xml']!)));
  entries['word/glossary/document.xml'] = strToU8(
    glossary(strFromU8(entries['word/glossary/document.xml']!))
  );
  return zipSync(entries);
}
function control(root: OoxmlNode, tag: string): OoxmlElement {
  let found: OoxmlElement | undefined;
  walkNodes(root, (node) => {
    if (node.kind !== 'contentControl') return;
    if (
      sdtPrChild(contentControlPropertiesOf(node), 'tag')?.attributes.some((a) => a.value === tag)
    )
      found = node;
  });
  if (!found) throw new Error(`missing ${tag}`);
  return found;
}
function galleryOp(store: ReturnType<typeof openStore>) {
  const block = buildingBlocksOf(store.currentPackage()).find((b) => b.name === 'Address block')!;
  return {
    op: 'insertBuildingBlock' as const,
    controlId: control(store.bodyStore().part.root, 'bbGallery').id,
    name: block.name,
    blocks: block.blocks,
  };
}
const mounted: PaginatedSurface[] = [];
afterEach(() => {
  for (const surface of mounted.splice(0)) surface.destroy();
});
async function pictureSurface(bytes = catalog, port = decodePort()) {
  const container = document.createElement('div');
  document.body.append(container);
  let session: ContentControlWidgetSession | undefined;
  const result = mountPaginatedSurface(container, bytes, {
    scale: 1,
    imageDecodePort: port,
    onRequestContentControlWidget: (value) => {
      session = value;
      return true;
    },
  });
  if (!result.ok) throw new Error(result.reason);
  mounted.push(result.surface);
  await settle();
  const press = () =>
    container
      .querySelector('[data-docx-cc-widget=picture]')!
      .dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
      );
  press();
  return { surface: result.surface, session: () => session!, press, container };
}

test('catalog glossary uses schema-valid types and block GUIDs', () => {
  const xml = strFromU8(unzipSync(catalog)['word/glossary/document.xml']!);
  expect(xml).not.toContain('bbNormal');
  expect(xml.match(/w:val="normal"/g)).toHaveLength(2);
  expect(xml.match(/<w:guid /g)).toHaveLength(6);
});

test('gallery pick has one journal, replica convergence, undo, redo, and repeated picks', () => {
  const store = openStore(catalog);
  const replica = openStore(catalog);
  const before = serializeOoxmlPart(store.bodyStore().part);
  const op = galleryOp(store);
  const captured = captureOneJournal(store, () =>
    store.transact({ kind: 'body' }, (ctx) => {
      ctx.apply(op);
    })
  );
  expect(captured.result.ok).toBe(true);
  expect(captured.journal).not.toBeNull();
  replayAndCompare(replica, store, captured.journal!);
  expect(serializeOoxmlPart(store.bodyStore().part)).toContain('123 Example Street');
  expect(store.undo()).not.toBeNull();
  expect(serializeOoxmlPart(store.bodyStore().part)).toBe(before);
  expect(store.redo()).not.toBeNull();
  expect(
    store.transact({ kind: 'body' }, (ctx) => {
      ctx.apply(op);
    }).ok
  ).toBe(true);
});

for (const markup of [
  '<w:rPr><w:rStyle w:val="GlossaryOnly"/></w:rPr>',
  '<w:hyperlink r:id="rId4"/>',
  '<w:fldChar w:fldCharType="begin"/>',
  '<w:instrText>DDEAUTO test</w:instrText>',
  '<w:footnoteReference w:id="1"/>',
  '<w:bookmarkStart w:id="1" w:name="duplicate"/>',
]) {
  test(`gallery refuses resource-dependent content atomically: ${markup}`, () => {
    const bytes = changed(
      (x) => x,
      (xml) => xml.replace('<w:t>123 Example Street', markup + '<w:t>123 Example Street')
    );
    const store = openStore(bytes);
    const before = serializeOoxmlPart(store.bodyStore().part);
    const captured = captureOneJournal(store, () =>
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply(galleryOp(store));
      })
    );
    expect(captured.result.ok).toBe(false);
    expect(captured.result.reason).toBe('unsupported');
    expect(captured.journal).toBeNull();
    expect(serializeOoxmlPart(store.bodyStore().part)).toBe(before);
  });
}

test('gallery validates text and depth budgets before cloning', () => {
  const store = openStore(catalog);
  const op = galleryOp(store);
  const block = op.blocks[0] as OoxmlElement;
  const text = { id: 'bad', kind: 'textValue' as const, value: '\u0000' };
  expect(
    applyTreeOp(store.bodyStore().part, {
      ...op,
      blocks: [{ ...block, children: [text] } as OoxmlNode],
    })
  ).toEqual({ ok: false, reason: 'fragment-invalid-block' });
  expect(
    applyTreeOp(store.bodyStore().part, {
      ...op,
      blocks: [
        { ...block, children: [{ ...text, value: 'x'.repeat(8 * 1024 * 1024 + 1) }] } as OoxmlNode,
      ],
    })
  ).toEqual({ ok: false, reason: 'fragment-resource-budget' });
  let deep: OoxmlNode = block;
  for (let i = 0; i < 65; i++) deep = { ...block, children: [deep] } as OoxmlNode;
  expect(applyTreeOp(store.bodyStore().part, { ...op, blocks: [deep] })).toEqual({
    ok: false,
    reason: 'fragment-too-deep',
  });
});

for (const [pr, reason] of [
  ['<w:temporary/><w:lock w:val="sdtLocked"/>', 'locked'],
  ['<w:lock w:val="contentLocked"/>', 'locked'],
  ['<w:dataBinding w:xpath="/value"/>', 'bound'],
] as const) {
  test(`gallery refuses protected controls: ${pr}`, () => {
    const store = openStore(
      changed((xml) => xml.replace('<w:docPartList>', pr + '<w:docPartList>'))
    );
    expect(applyTreeOp(store.bodyStore().part, galleryOp(store))).toEqual({ ok: false, reason });
  });
}

test('temporary gallery unwraps inside its journal and undo restores the wrapper', () => {
  const bytes = changed((xml) => xml.replace('<w:docPartList>', '<w:temporary/><w:docPartList>'));
  const store = openStore(bytes);
  const replica = openStore(bytes);
  const before = serializeOoxmlPart(store.bodyStore().part);
  const op = galleryOp(store);
  const captured = captureOneJournal(store, () =>
    store.transact({ kind: 'body' }, (ctx) => {
      ctx.apply(op);
    })
  );
  expect(captured.result.ok).toBe(true);
  replayAndCompare(replica, store, captured.journal!);
  expect(serializeOoxmlPart(store.bodyStore().part)).not.toContain('w:val="bbGallery"');
  store.undo();
  expect(serializeOoxmlPart(store.bodyStore().part)).toBe(before);
});

test('nested control and paragraph ids differ across actors and repeated picks', () => {
  const stores = ['actor-a', 'actor-b'].map((actorId) => {
    const store = openStore(catalog);
    const op = galleryOp(store);
    const block = op.blocks[0] as OoxmlElement;
    const nested = control(store.bodyStore().part.root, 'bbGallery');
    const properties = contentControlPropertiesOf(nested)!;
    const plain = {
      ...nested,
      children: nested.children.map((child) =>
        child === properties
          ? {
              ...properties,
              children: properties.children.filter(
                (c) => c.kind !== 'textValue' && ['id', 'tag'].includes(c.localName)
              ),
            }
          : child.kind !== 'textValue' && child.localName === 'sdtContent'
            ? { ...child, children: block.children }
            : child
      ),
    } as OoxmlNode;
    const payload = { ...op, blocks: [{ ...block, children: [plain] } as OoxmlNode] };
    const values: string[] = [];
    for (let i = 0; i < 2; i++) {
      expect(
        store.transact(
          { kind: 'body' },
          (ctx) => {
            ctx.apply(payload);
          },
          { actorId }
        ).ok
      ).toBe(true);
      const xml = serializeOoxmlPart(store.bodyStore().part);
      const own = control(store.bodyStore().part.root, 'bbGallery');
      // The nested control has the last id under the outer control.
      const ids: string[] = [];
      walkNodes(own, (node) => {
        if (node.kind !== 'textValue' && node.localName === 'id')
          ids.push(node.attributes.find((a) => a.localName === 'val')!.value);
      });
      values.push(ids.at(-1)!);
      expect(xml).toContain('123 Example Street');
    }
    return values;
  });
  expect(new Set(stores.flat()).size).toBe(4);
});

test('block insertion mints paragraph ids without source identities, per actor and pick', () => {
  const bytes = changed((xml) =>
    xml.replace(
      /<w:group\s*\/>/,
      '<w:docPartList><w:docPartGallery w:val="Quick Parts"/></w:docPartList>'
    )
  );
  const ids: string[] = [];
  for (const actorId of ['actor-a', 'actor-b']) {
    const store = openStore(bytes);
    const replica = openStore(bytes);
    const op = { ...galleryOp(store), controlId: control(store.bodyStore().part.root, 'group').id };
    for (let index = 0; index < 2; index++) {
      const captured = captureOneJournal(store, () =>
        store.transact(
          { kind: 'body' },
          (ctx) => {
            ctx.apply(op);
          },
          { actorId }
        )
      );
      expect(captured.result.ok).toBe(true);
      replayAndCompare(replica, store, captured.journal!);
      expect(
        replica.transact(
          { kind: 'body' },
          (ctx) => {
            ctx.apply(op);
          },
          { actorId }
        ).ok
      ).toBe(true);
      walkNodes(control(store.bodyStore().part.root, 'group'), (node) => {
        if (node.kind === 'paragraph') {
          expect(paraIdOf(node)).not.toBeNull();
          ids.push(paraIdOf(node)!);
        }
      });
    }
  }
  expect(new Set(ids).size).toBe(4);
});

test('picture replacement clears placeholder state, unwraps temporary controls, and undoes both', async () => {
  const bytes = changed((xml) =>
    xml.replace(/<w:picture\s*\/>/, '<w:picture/><w:temporary/><w:showingPlcHdr/>')
  );
  const { surface, session } = await pictureSurface(bytes);
  const before = serializeOoxmlPart(surface.session.part());
  expect(await session().replaceImage!(PNG_1X1)).toBe(true);
  expect(serializeOoxmlPart(surface.session.part())).not.toContain('w:val="picture"');
  surface.undo();
  expect(serializeOoxmlPart(surface.session.part())).toBe(before);
});

for (const action of ['cancel', 'destroy', 'suggest'] as const) {
  test(`picture decode cannot commit after ${action}`, async () => {
    let release: (() => void) | undefined;
    let gate = false;
    const decode = decodePort();
    const mounted = await pictureSurface(catalog, {
      async decode(bytes, mime, limits) {
        if (gate)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return decode.decode(bytes, mime, limits);
      },
    });
    const before = serializeOoxmlPart(mounted.surface.session.part());
    gate = true;
    const pending = mounted.session().replaceImage!(PNG_1X1);
    expect(release).toBeDefined();
    expect(await mounted.session().replaceImage!(PNG_1X1)).toBe(false);
    if (action === 'cancel') mounted.session().cancel();
    if (action === 'destroy') mounted.surface.destroy();
    if (action === 'suggest') mounted.surface.setEditingMode('suggest');
    release!();
    expect(await pending).toBe(false);
    expect(serializeOoxmlPart(mounted.surface.session.part())).toBe(before);
  });
}

test('engine picker refuses oversize files before reading and reports retry UI', async () => {
  const store = openStore(catalog);
  const layer = document.createElement('div');
  document.body.append(layer);
  let reads = 0;
  const errors: string[] = [];
  const widget = createContentControlPictureWidget({
    document,
    layer,
    find: () => control(store.bodyStore().part.root, 'picture'),
    layout: () => null as never,
    allowed: () => true,
    translate: (key) => key,
    selectDrawing: () => true,
    replaceImage: async () => {
      throw new Error('must not decode');
    },
    setOpen: () => {},
    reject: (reason) => errors.push(reason),
  });
  widget.pick('picture');
  const input = layer.querySelector('input')!;
  Object.defineProperty(input, 'files', {
    value: [
      {
        size: 32 * 1024 * 1024 + 1,
        arrayBuffer: async () => {
          reads++;
          return new ArrayBuffer(0);
        },
      },
    ],
  });
  input.dispatchEvent(new Event('change'));
  await settle();
  expect(reads).toBe(0);
  expect(errors).toEqual(['image-resource-limit']);
  expect(layer.querySelector('[role=dialog]')!.hasAttribute('hidden')).toBe(false);
  expect(layer.querySelector('[role=alert]')).not.toBeNull();
  widget.destroy();
});

for (const level of ['row', 'cell'] as const) {
  test(`gallery refuses ${level} structure without changing the table`, () => {
    const bytes = changed((xml) =>
      xml.replace(
        /<w:p(?=[\s>])(?:(?!<\/w:p>).)*w:val="bbGallery"(?:(?!<\/w:p>).)*<\/w:p>/s,
        (paragraph) => {
          const sdt = paragraph.match(/<w:sdt>.*<\/w:sdt>/s)![0];
          const cell =
            '<w:tc><w:tcPr/><w:p><w:r><w:t>Choose a building block.</w:t></w:r></w:p></w:tc>';
          const nested = sdt.replace(
            /<w:sdtContent>.*<\/w:sdtContent>/s,
            `<w:sdtContent>${level === 'row' ? `<w:tr>${cell}</w:tr>` : cell}</w:sdtContent>`
          );
          return `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>${level === 'row' ? nested : `<w:tr>${nested}</w:tr>`}</w:tbl>`;
        }
      )
    );
    const store = openStore(bytes);
    expect(applyTreeOp(store.bodyStore().part, galleryOp(store))).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });
}

test('a picture control without a drawing reports no-picture without creating a picker', () => {
  const store = openStore(catalog);
  const picture = control(store.bodyStore().part.root, 'picture');
  const empty = {
    ...picture,
    children: picture.children.filter(
      (child) => child.kind !== 'textValue' && child.localName !== 'sdtContent'
    ),
  } as OoxmlElement;
  const layer = document.createElement('div');
  const errors: string[] = [];
  const widget = createContentControlPictureWidget({
    document,
    layer,
    find: () => empty,
    layout: () => null as never,
    allowed: () => true,
    translate: (key) => key,
    selectDrawing: () => true,
    replaceImage: async () => ({ ok: false, reason: 'unknown-drawing' }),
    setOpen: () => {},
    reject: (reason) => errors.push(reason),
  });
  widget.pick('picture');
  expect(errors).toEqual(['no-picture']);
  expect(layer.querySelector('input')).toBeNull();
  widget.destroy();
});

test('the gallery ignores schema-invalid block types', () => {
  const store = openStore(
    changed(
      (x) => x,
      (xml) => xml.replaceAll('w:val="normal"', 'w:val="invalidType"')
    )
  );
  expect(
    buildingBlocksOf(store.currentPackage()).filter((block) => block.gallery === 'docParts')
  ).toEqual([]);
});

for (const [properties, reason] of [
  ['<w:lock w:val="contentLocked"/>', 'locked'],
  ['<w:dataBinding w:xpath="/value"/>', 'bound'],
  ['<w:temporary/><w:lock w:val="sdtLocked"/>', 'locked'],
] as const) {
  test(`picture replacement respects control protection: ${properties}`, () => {
    const store = openStore(
      changed((xml) => xml.replace(/<w:picture\s*\/>/, '<w:picture/>' + properties))
    );
    let drawingId = '';
    walkNodes(control(store.bodyStore().part.root, 'picture'), (node) => {
      if (node.kind === 'drawing') drawingId = node.id;
    });
    expect(
      applyTreeOp(store.bodyStore().part, {
        op: 'replaceDrawingResource',
        drawingNodeId: drawingId,
        relationshipId: 'rId4',
      })
    ).toEqual({ ok: false, reason });
  });
}

test('a superseded native picture read cannot replace the next picker’s image', async () => {
  const store = openStore(catalog);
  const layer = document.createElement('div');
  let resolveRead: ((bytes: ArrayBuffer) => void) | undefined;
  let writes = 0;
  const widget = createContentControlPictureWidget({
    document,
    layer,
    find: () => control(store.bodyStore().part.root, 'picture'),
    layout: () => null as never,
    allowed: () => true,
    translate: (key) => key,
    selectDrawing: () => true,
    replaceImage: async () => {
      writes++;
      return { ok: true, change: null, drawingNodeId: 'picture' };
    },
    setOpen: () => {},
    reject: () => {},
  });
  widget.pick('picture');
  const first = layer.querySelector('input')!;
  Object.defineProperty(first, 'files', {
    value: [
      {
        size: PNG_1X1.length,
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((resolve) => {
            resolveRead = resolve;
          }),
      },
    ],
  });
  first.dispatchEvent(new Event('change'));
  widget.pick('picture');
  resolveRead!(PNG_1X1.slice().buffer);
  await settle();
  expect(writes).toBe(0);
  expect(layer.querySelectorAll('input')).toHaveLength(1);
  widget.destroy();
});
