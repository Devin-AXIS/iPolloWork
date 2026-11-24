// Capability metadata has to MEAN something.
//
// A host that reports `save: false` and then saves, or `events: false` and then notifies, has
// told a consumer a fact it can only discover by trying — which is worse than not reporting
// capabilities at all, because the consumer built a branch on it. So each flag is exercised
// against the composition factory both hosts are built with, over a port whose document
// behaviour is a fixture rather than a real package.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage, type OoxmlPackage } from '../../store/package/ooxml-package.ts';
import {
  AUTOMATION_COMMAND_OPERATIONS,
  AUTOMATION_SOLITARY_OPERATIONS,
  isAutomationCommand,
} from '../operations.ts';
import { createAutomationHost } from '../host.ts';
import type { AutomationDocumentPort } from '../document-port.ts';
import type { AutomationCapabilities, AutomationHandle, AutomationHost } from '../protocol.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function samplePackage(): OoxmlPackage {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>only</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

const FULL: AutomationCapabilities = {
  document: true,
  save: true,
  events: true,
  selection: true,
  scrolling: true,
  layout: true,
};

interface Fixture {
  readonly host: AutomationHost;
  /** Fire the port's change signal, as a real store commit would. */
  publish(): void;
  applied: number;
}

function fixture(
  capabilities: Partial<AutomationCapabilities> = {},
  options: { readonly pkg?: OoxmlPackage | null } = {}
): Fixture {
  const pkg = options.pkg === undefined ? samplePackage() : options.pkg;
  const listeners = new Set<() => void>();
  const state = { applied: 0 };
  const port: AutomationDocumentPort = {
    revision: () => state.applied,
    currentPackage: () => pkg,
    apply: () => {
      state.applied += 1;
      return { ok: true, changed: true };
    },
    applyLifecycle: () => {
      state.applied += 1;
      return { ok: true, changed: true };
    },
    applyCustomNodeWrite: () => {
      state.applied += 1;
      return { ok: true, changed: true };
    },
    applyCommentWrites: () => {
      state.applied += 1;
      return { ok: true, changed: true, commentId: '1' };
    },
    save: () => new Uint8Array([1]),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {},
  };
  const host = createAutomationHost({ port, capabilities: { ...FULL, ...capabilities } });
  return {
    host,
    publish: () => {
      for (const listener of listeners) listener();
    },
    get applied() {
      return state.applied;
    },
  };
}

function bodyHandle(host: AutomationHost): AutomationHandle {
  const document = host.execute({ operations: [{ op: 'getDocument' }] });
  const documentHandle = (document.results[0] as { value: { handle: AutomationHandle } }).value
    .handle;
  const body = host.execute({ operations: [{ op: 'getBody', document: documentHandle }] });
  return (body.results[0] as { value: { handle: AutomationHandle } }).value.handle;
}

function errorCodeAt(
  response: { readonly results: readonly { readonly status: string }[] },
  index: number
): string {
  const result = response.results[index] as
    { status: 'error'; error: { code: string } } | undefined;
  if (result?.status !== 'error') throw new Error(`expected an error at ${index}`);
  return result.error.code;
}

describe('capabilities gate the operations they name', () => {
  test('a host without the document capability refuses document operations', () => {
    const { host } = fixture({ document: false });
    const response = host.execute({ operations: [{ op: 'getDocument' }] });
    expect(response.ok).toBe(false);
    expect(errorCodeAt(response, 0)).toBe('unsupported-capability');
  });

  test('a host without the save capability refuses to save', () => {
    const { host } = fixture({ save: false });
    const saved = host.save();
    expect(saved.ok).toBe(false);
    if (!saved.ok) {
      expect(saved.error.code).toBe('unsupported-capability');
      expect(saved.error.detail).toBe('save');
    }
  });

  test('a host without the events capability never notifies', () => {
    const { host, publish } = fixture({ events: false });
    let seen = 0;
    const unsubscribe = host.subscribe(() => {
      seen += 1;
    });
    publish();
    expect(seen).toBe(0);
    expect(() => unsubscribe()).not.toThrow();
  });

  test('a host WITH the events capability notifies, so the check above is not vacuous', () => {
    const { host, publish } = fixture();
    const seen: number[] = [];
    host.subscribe((event) => seen.push(event.revision));
    publish();
    expect(seen).toEqual([0]);
  });

  test('unsubscribing actually stops the notifications', () => {
    const { host, publish } = fixture();
    let seen = 0;
    const unsubscribe = host.subscribe(() => {
      seen += 1;
    });
    unsubscribe();
    publish();
    expect(seen).toBe(0);
  });

  test('capability metadata is frozen and cannot be edited into a different host', () => {
    const { host } = fixture({ save: false });
    expect(Object.isFrozen(host.capabilities)).toBe(true);
    expect(() => {
      (host.capabilities as { save: boolean }).save = true;
    }).toThrow();
    expect(host.save().ok).toBe(false);
  });
});

describe('a live host with no document right now', () => {
  test('operations report document-unavailable rather than an empty document', () => {
    // The browser host between mounts. `disposed` would be wrong — this host may answer
    // again — and an empty read would be indistinguishable from an empty document.
    const { host } = fixture({}, { pkg: null });
    const response = host.execute({ operations: [{ op: 'getDocument' }] });
    expect(response.ok).toBe(false);
    expect(errorCodeAt(response, 0)).toBe('document-unavailable');
  });
});

describe('the operation vocabulary declares which operations write', () => {
  test('exactly the command operations are commands', () => {
    // A proxy layer deciding whether a batch needs a write path reads this, so it must not
    // drift from the union the host actually treats as a command.
    expect([...AUTOMATION_COMMAND_OPERATIONS]).toEqual([
      'removeDocumentInformation',
      'compareFromBase64',
      'replaceDocumentFromBase64',
      'setDocumentProperties',
      'insertTableRows',
      'insertTable',
      'updateTable',
      'updateTableCell',
      'splitTableCell',
      'setInlinePicture',
      'setShapeFill',
      'deleteInlinePicture',
      'insertField',
      'insertOoxml',
      'setFieldCode',
      'setFieldResult',
      'deleteField',
      'updateFieldResult',
      'insertInlinePicture',
      'insertBreak',
      'setChangeTrackingMode',
      'proposeInsertion',
      'proposeDeletion',
      'proposeReplacement',
      'insertText',
      'replaceSpan',
      'replaceStoryBlocks',
      'insertParagraph',
      'splitParagraph',
      'deleteParagraph',
      'selectSpan',
      'selectBookmark',
      'insertBookmark',
      'deleteBookmark',
      'setFont',
      'setParagraphFormat',
      'setStyle',
      'setPageSetup',
      'deleteNote',
      'setListLevel',
      'startNewList',
      'attachToList',
      'detachFromList',
      'setListLevelFormat',
      'insertListParagraph',
      'setHyperlink',
      'insertComment',
      'setCommentResolved',
      'setCommentText',
      'replyToComment',
      'deleteComment',
      'acceptRevision',
      'rejectRevision',
      'resolveRevisionBatch',
      'setRevisionAuthorBatch',
      'acceptAllRevisions',
      'rejectAllRevisions',
      'setContentControlValue',
      'setContentControlProperties',
      'deleteContentControl',
      'insertContentControlText',
      'insertContentControl',
      'insertCustomNode',
    ]);
    // And the ones that commit as a PACKAGE transaction, which is why they travel alone.
    expect([...AUTOMATION_SOLITARY_OPERATIONS]).toEqual([
      'removeDocumentInformation',
      'compareFromBase64',
      'replaceDocumentFromBase64',
      'insertTableRows',
      'resolveRevisionBatch',
      'setRevisionAuthorBatch',
      'insertTable',
      'insertInlinePicture',
      'insertBreak',
      'startNewList',
      'deleteNote',
      'insertComment',
      'setCommentResolved',
      'replyToComment',
      'insertCustomNode',
    ]);
    expect(
      isAutomationCommand({ op: 'insertText', at: { paragraph: FORGED, offset: 0 }, text: 'x' })
    ).toBe(true);
    expect(isAutomationCommand({ op: 'getDocument' })).toBe(false);
    expect(isAutomationCommand({ op: 'getText', target: FORGED })).toBe(false);
  });

  test('an operation this protocol does not define is unknown-operation', () => {
    const { host } = fixture();
    const response = host.execute({
      operations: [{ op: 'deleteEverything' } as unknown as { op: 'getDocument' }],
    });
    expect(response.ok).toBe(false);
    expect(errorCodeAt(response, 0)).toBe('unknown-operation');
  });

  test('a batch with no operations succeeds, changes nothing, and commits nothing', () => {
    const state = fixture();
    const response = state.host.execute({ operations: [] });
    expect(response).toEqual({ ok: true, results: [], revision: 0, changed: false });
    expect(state.applied).toBe(0);
  });

  test('a query-only batch never opens a transaction', () => {
    const state = fixture();
    const body = bodyHandle(state.host);
    state.host.execute({ operations: [{ op: 'getText', target: body }] });
    expect(state.applied).toBe(0);
  });
});

const FORGED = { kind: 'paragraph', ref: 'paragraph:1' } as unknown as AutomationHandle;
