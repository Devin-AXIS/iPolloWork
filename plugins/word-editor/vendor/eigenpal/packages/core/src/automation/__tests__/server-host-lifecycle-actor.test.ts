// Headless writes must bind the collaboration actor before minting ids: furniture `rId`s in
// `applyLifecycle`, and the ids a scripted picture insert plans and then commits.
//
// `apply` and the comment/custom-node entries wrap in `runWithTransactionActor`. The
// lifecycle path used to call `store.applyLifecycleOp` bare, so two hosts creating a header
// from the same snapshot both took `rId${max + 1}`.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  MAX_RELATIONSHIP_NUMBER,
  nextStripedDecimalId,
  relationshipIdFromNumber,
} from '../../store/package/actor-scoped-ids.ts';
import { normalizeParagraphIdentity } from '../../store/package/para-id.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { TreePackageStore } from '../../store/store/tree-package-store.ts';
import { stubCollaborationSession } from '../../editor/__tests__/collaboration-test-module.ts';
import { createAutomationHost } from '../host.ts';
import { SERVER_AUTOMATION_CAPABILITIES } from '../server-host.ts';
import { handleAt, handlesAt, roots } from './support/protocol.ts';
import { packageStorePort } from '../server-host.ts';
import type { AutomationDocumentPort } from '../document-port.ts';
import { storeEditDiagnosticCode } from '../diagnostics.ts';
import { allocateDrawingPropertyId } from '../../store/package/drawing-package-edit.ts';
import { projectDrawingsInPart } from '../../store/package/drawing-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function blankDoc(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>body</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`
    ),
  });
}

function portFor(actorId: string) {
  const loaded = readOoxmlPackage(blankDoc());
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('no main');
  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  const port = packageStorePort(
    store,
    stubCollaborationSession({ identity: { actorId, name: actorId } })
  );
  return { port, store };
}

function headerRId(store: TreePackageStore): string {
  const rels = store.currentPackage().relationships.get(store.currentPackage().mainDocumentPart);
  const header = rels?.find((rel) => rel.type.endsWith('/header'));
  if (!header) throw new Error('no header relationship');
  return header.id;
}

describe('headless applyLifecycle binds the collaboration actor', () => {
  test('two actors mint different header rIds from the same snapshot', () => {
    const left = portFor('alice');
    const right = portFor('bob');
    const op = {
      op: 'createHeaderFooter' as const,
      sectionIndex: 0,
      kind: 'header' as const,
      variant: 'default' as const,
    };
    expect(left.port.applyLifecycle(op).ok).toBe(true);
    expect(right.port.applyLifecycle(op).ok).toBe(true);
    const leftId = headerRId(left.store);
    const rightId = headerRId(right.store);
    expect(leftId).not.toBe(rightId);
    const used = new Set(['1']);
    expect(leftId).toBe(
      relationshipIdFromNumber(Number(nextStripedDecimalId(used, 'alice', MAX_RELATIONSHIP_NUMBER)))
    );
    expect(rightId).toBe(
      relationshipIdFromNumber(Number(nextStripedDecimalId(used, 'bob', MAX_RELATIONSHIP_NUMBER)))
    );
  });
});

test('startNewList returns the actor-allocated ID used by the committed paragraph', () => {
  const created = ['alice', 'bob'].map((actor) => {
    const { port, store } = portFor(actor);
    const host = createAutomationHost({ port, capabilities: SERVER_AUTOMATION_CAPABILITIES });
    const { body } = roots(host);
    const paragraph = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body }] }),
      0
    )[0]!;
    const list = handleAt(host.execute({ operations: [{ op: 'startNewList', paragraph }] }), 0);
    const id = host.execute({ operations: [{ op: 'getListId', list }] }).results[0]!;
    const found = handleAt(
      host.execute({ operations: [{ op: 'getParagraphList', paragraph }] }),
      0
    );
    expect(found).toEqual(list);
    expect(store.currentPackage().parts.has('/word/numbering.xml')).toBe(true);
    expect(id.status).toBe('ok');
    return id;
  });
  expect(created[0]).not.toEqual(created[1]);
});

// #1348. The planner previews a picture's `docPr` id, relationship and media part, and the
// commit allocates them again. Planned outside the actor, the preview took the dense sequence
// while the commit took the actor's stripe, and the commit refused its own plan.
describe('insertInlinePicture under a collaboration actor', () => {
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  function insertPicture(port: AutomationDocumentPort) {
    const host = createAutomationHost({ port, capabilities: SERVER_AUTOMATION_CAPABILITIES });
    const { body } = roots(host);
    const paragraph = handlesAt(
      host.execute({ operations: [{ op: 'getParagraphs', body }] }),
      0
    )[0]!;
    return host.execute({
      operations: [
        { op: 'insertInlinePicture', span: { paragraph }, base64: PNG, location: 'End' },
      ],
    });
  }

  test('commits the actor-striped allocation the planner previewed', () => {
    const { port, store } = portFor('alice');
    const expected = allocateDrawingPropertyId(store.currentPackage(), 'alice');
    if (!expected.ok) throw new Error('no expected id');
    expect(insertPicture(port).ok).toBe(true);
    const main = store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!;
    expect(projectDrawingsInPart(main).map((drawing) => drawing.docPrId)).toEqual([expected.id]);
  });

  test('refuses with a typed error when the commit allocates differently', () => {
    const { port, store } = portFor('alice');
    const before = store.currentPackage();
    const revision = port.revision();
    // Plan under one actor, commit under another: the drawing would name ids it does not own.
    const response = insertPicture({ ...port, allocationActor: () => 'bob' });
    expect(response.ok).toBe(false);
    const failure = response.results.find((result) => result.status === 'error');
    if (failure?.status !== 'error') throw new Error('expected a refusal');
    expect(failure.error.code).toBe('transaction-refused');
    expect(failure.error.detail).toStartWith('package-changed');
    expect(storeEditDiagnosticCode(failure.error.detail!)).toBe('edit.internal-invariant');
    expect(store.currentPackage()).toBe(before);
    expect(port.revision()).toBe(revision);
  });
});
