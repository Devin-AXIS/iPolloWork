// A collaboration status change is observable without a document edit or a caret move.
//
// The status moves no revision and no caret, and the facade emitted neither signal for it, so
// `snapshot().collaborationStatus` changed silently. A status chip, or a notice waiting for the
// session, only caught up when something unrelated happened.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { CollaborationStatus } from '../../collaboration/index.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { stubCollaborationModule, stubCollaborationSession } from './collaboration-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const DOCUMENT = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>text</w:t></w:r></w:p></w:body></w:document>`
  ),
});

test('a status change emits selectionChange and moves the snapshot', () => {
  let status: CollaborationStatus = 'connecting';
  const listeners = new Set<() => void>();
  const session = stubCollaborationSession({
    status: () => status,
    statusSnapshot: () => Object.freeze({ status, reason: undefined, lastFailure: undefined }),
    subscribeStatus: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: DOCUMENT,
    modules: [stubCollaborationModule(session)],
  });
  try {
    expect(editor.snapshot().collaborationStatus).toBe('connecting');
    let heard = 0;
    const off = editor.on('selectionChange', () => (heard += 1));
    status = 'ready';
    for (const listener of [...listeners]) listener();
    expect(heard).toBe(1);
    expect(editor.snapshot().collaborationStatus).toBe('ready');
    // The same status again is not news.
    for (const listener of [...listeners]) listener();
    expect(heard).toBe(1);
    off();
  } finally {
    editor.destroy();
  }
});
