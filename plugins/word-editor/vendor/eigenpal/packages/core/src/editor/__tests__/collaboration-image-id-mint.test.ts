// Inserting or replacing a picture must bind the collaboration actor before it mints ids.
//
// The allocator stripes when an actor is bound and stays dense when none is. The live image
// path is async — it awaits a decode before it mints — so the ambient
// `runWithTransactionActor` binding cannot reach the mint. The actor travels as a value from
// the surface instead, down to the `transact` that wraps the synchronous build.
//
// Both halves matter. Without the striping two peers inserting from one snapshot both take
// `wp:docPr/@id="1"`, and Word renumbers the merged document on open. Without the dense
// fallback a solo author's first picture stops being `id="1"`, which is a fidelity regression
// nobody asked for.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  ACTOR_ID_STRIPE,
  actorStripe,
  nextStripedDecimalId,
  relationshipNumberOf,
} from '../../store/package/actor-scoped-ids.ts';
import type { OoxmlNode } from '../../store/package/ooxml-tree.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { stubCollaborationSession } from './collaboration-test-module.ts';
import {
  CT_NS,
  OD_REL,
  PNG_1X1,
  REL_NS,
  W_NS,
  decodePort,
  settle,
} from './image-decode-harness.ts';

/** `xsd:unsignedInt` ceiling, the bound `allocateDrawingPropertyId` allocates within. */
const MAX_UNSIGNED_INT = 4_294_967_295;

/** A package with no drawings seeds only `0` as used, so the stripe walk starts from scratch. */
const NO_DOC_PR_IDS: ReadonlySet<string> = new Set(['0']);

/** A second raster, one pixel of a different colour, so a replace really swaps the bytes. */
const GIF_1X1 = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (character) => character.charCodeAt(0)
);

const opened: { surface: PaginatedSurface; container: HTMLElement }[] = [];

afterEach(() => {
  for (const item of opened.splice(0)) {
    item.surface.destroy();
    item.container.remove();
  }
});

function textDoc(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t>Alpha</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

function mount(actorId?: string): PaginatedSurface {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, textDoc(), {
    scale: 1,
    imageDecodePort: decodePort(),
    ...(actorId
      ? {
          collaborationModel: {
            session: stubCollaborationSession({ identity: { actorId, name: actorId } }),
          },
        }
      : {}),
  });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  opened.push({ surface: result.surface, container });
  return result.surface;
}

function attributeOf(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find(
    (attribute) => attribute.localName === localName && attribute.namespaceUri === ''
  )?.value;
}

function collect(surface: PaginatedSurface, read: (node: OoxmlNode) => string | undefined) {
  const found: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    const value = read(node);
    if (value !== undefined) found.push(value);
    for (const child of node.children) visit(child);
  };
  visit(surface.session.part().root);
  return found;
}

function docPrIds(surface: PaginatedSurface): string[] {
  return collect(surface, (node) =>
    node.kind === 'drawingDocPr' ? attributeOf(node, 'id') : undefined
  );
}

/** `r:embed` carries the relationships namespace, so this one is matched on local name alone. */
function embedIds(surface: PaginatedSurface): string[] {
  return collect(surface, (node) =>
    node.kind === 'textValue'
      ? undefined
      : node.attributes.find((attribute) => attribute.localName === 'embed')?.value
  );
}

async function insertFirstPicture(surface: PaginatedSurface): Promise<string> {
  const paragraphId = surface.session.paragraphIds()[0];
  if (!paragraphId) throw new Error('no paragraph');
  const result = await surface.insertImage({
    paragraphId,
    offset: 0,
    bytes: PNG_1X1,
    mime: 'image/png',
    widthPoints: 12,
    heightPoints: 12,
    expectedPackageRevision: surface.session.packageRevision(),
  });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  await settle();
  const drawingNodeId = result.drawingNodeId;
  if (drawingNodeId === undefined) throw new Error('insert reported no drawing');
  return drawingNodeId;
}

describe('the live image insert binds the collaboration actor', () => {
  test('a solo author still writes the dense id="1"', async () => {
    const surface = mount();
    await insertFirstPicture(surface);
    expect(docPrIds(surface)).toEqual(['1']);
  });

  test('two actors mint different docPr ids from the same empty snapshot', async () => {
    const alice = mount('alice');
    const bob = mount('bob');
    await insertFirstPicture(alice);
    await insertFirstPicture(bob);

    const left = docPrIds(alice)[0];
    const right = docPrIds(bob)[0];
    expect(left).not.toBe(right);
    expect(left).toBe(nextStripedDecimalId(NO_DOC_PR_IDS, 'alice', MAX_UNSIGNED_INT));
    expect(right).toBe(nextStripedDecimalId(NO_DOC_PR_IDS, 'bob', MAX_UNSIGNED_INT));
  });

  test('replace mints the swapped image relationship in the actor stripe', async () => {
    const surface = mount('alice');
    const drawingNodeId = await insertFirstPicture(surface);
    const before = embedIds(surface)[0];

    const replaced = await surface.replaceImage(drawingNodeId, GIF_1X1, 'image/gif', {
      expectedPackageRevision: surface.session.packageRevision(),
    });
    expect(replaced.ok).toBe(true);
    await settle();

    const after = embedIds(surface)[0];
    expect(after).not.toBe(before);
    const number = relationshipNumberOf(after!);
    expect(number).not.toBeNull();
    expect(number! % ACTOR_ID_STRIPE).toBe(actorStripe('alice'));
  });
});
