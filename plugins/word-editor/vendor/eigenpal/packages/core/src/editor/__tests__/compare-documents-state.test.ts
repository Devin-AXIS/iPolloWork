// Compare documents: the command gates and the one-step undo unit the result installs as.
//
// The engine is a stub that answers with the revised package itself, so these tests prove the
// editor's half of the contract: who may compare, and that the result is one undo step.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { collectReviewItems, readOoxmlPackage } from '@docx-editor.dev/core/store';
import type {
  CompareDocumentsDialogHost,
  CompareDocumentsEngine,
  EditorModule,
  ReviewModuleContribution,
} from '../../contracts/modules.ts';
import {
  compareDocumentsErrorKey,
  type CompareDocumentsDialogSession,
} from '../../contracts/compare-documents.ts';
import type {
  CompareDocumentsErrorCode,
  CompareDocumentsRefusalReason,
} from '../../contracts/document-compare.ts';
import en from '../../../../i18n/en.json' with { type: 'json' };
import { PRO_REVIEW_REASON } from '../opening-editing-mode.ts';
import { COMPARE_COLLABORATION_REASON } from '../compare-documents-state.ts';
import { setPreviewWriteGuard, setRefreshWriteGuard } from '../refresh-write-guard.ts';
import { EDITOR_ANNOUNCER_CLASS } from '../editor-announcer.ts';
import { createT, type LocaleStrings } from '@docx-editor.dev/i18n';
import { DISABLED_REASON_KEYS } from '../../../../i18n/src/disabled-reasons.ts';
import { stubCollaborationModule, stubCollaborationSession } from './collaboration-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(text: string, protection?: string): Uint8Array {
  const settings = protection
    ? {
        'word/settings.xml': strToU8(
          `<w:settings xmlns:w="${W}"><w:documentProtection w:edit="${protection}" w:enforcement="1"/></w:settings>`
        ),
        'word/_rels/document.xml.rels': strToU8(
          `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`
        ),
      }
    : {};
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (protection
          ? '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
    ),
    ...settings,
  });
}

/** Answers with the revised package, the way a compare would answer with the redline. */
const replaceWithRevised: CompareDocumentsEngine = (_original, revised) => {
  const read = readOoxmlPackage(revised);
  if (!read.ok) return { ok: false, code: 'invalidRevised', message: 'unreadable' };
  return { ok: true, package: read.package, revisionCount: 2, changed: true };
};

function reviewModule(review: Partial<ReviewModuleContribution> = {}): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems,
      revisionItemsOfParagraph: () => [],
      compareDocuments: replaceWithRevised,
      createCompareDocumentsDialog: () => ({ open() {}, destroy() {} }),
      ...review,
    },
  };
}

let cleanup: () => void = () => {};
afterEach(() => cleanup());
let mounted: HTMLElement | null = null;
type Translate = (key: string, params?: Record<string, string | number>) => string;

function mount(
  modules: EditorModule[],
  options: { mode?: 'view'; translate?: Translate } = {},
  original = docx('Original text')
): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  mounted = container;
  const editor = createDocxEditor({
    container,
    document: original,
    author: 'Reviewer',
    modules,
    ...options,
  });
  cleanup = () => {
    editor.destroy();
    container.remove();
  };
  return editor;
}

const bodyText = (editor: DocxEditorInstance) => editor.surface!.session.bodyText();

describe('compare documents commands', () => {
  test('refuse with the pro reason without the review module', () => {
    const editor = mount([]);
    for (const command of [
      { type: 'openCompareDocumentsDialog' } as const,
      { type: 'compareDocuments', revised: docx('Revised') } as const,
    ]) {
      expect(editor.can(command)).toEqual({
        ok: false,
        code: 'unsupported',
        reason: PRO_REVIEW_REASON,
      });
      expect(editor.exec(command).ok).toBe(false);
    }
  });

  test('refuse with the pro reason when the module has no compare engine or dialog', () => {
    const noEngine = mount([reviewModule({ compareDocuments: undefined })]);
    expect(noEngine.can({ type: 'compareDocuments', revised: docx('x') })).toMatchObject({
      ok: false,
      reason: PRO_REVIEW_REASON,
    });
    cleanup();
    const noDialog = mount([reviewModule({ createCompareDocumentsDialog: undefined })]);
    expect(noDialog.can({ type: 'compareDocuments', revised: docx('x') }).ok).toBe(true);
    expect(noDialog.can({ type: 'openCompareDocumentsDialog' })).toMatchObject({
      ok: false,
      reason: PRO_REVIEW_REASON,
    });
  });

  test('refuse in a collaboration session with a stable reason', () => {
    const editor = mount([reviewModule(), stubCollaborationModule(stubCollaborationSession())]);
    expect(editor.surface!.collaborationSession()).not.toBeNull();
    expect(editor.can({ type: 'openCompareDocumentsDialog' })).toEqual({
      ok: false,
      code: 'unsupported',
      reason: COMPARE_COLLABORATION_REASON,
    });
    expect(editor.exec({ type: 'compareDocuments', revised: docx('Revised') })).toMatchObject({
      ok: false,
      reason: COMPARE_COLLABORATION_REASON,
      compareDocuments: { ok: false, code: 'collaboration' },
    });
    expect(bodyText(editor)).toBe('Original text');
    // The disabled reason reads as a sentence in the reader's language, not as a code.
    expect(DISABLED_REASON_KEYS[COMPARE_COLLABORATION_REASON]).toBe(
      'disabledReason.compareCollaboration'
    );
    expect(en.disabledReason.compareCollaboration).toBeString();
  });

  test('refuse while viewing and in a view-only editor', () => {
    const editor = mount([reviewModule()]);
    expect(editor.exec({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);
    expect(editor.can({ type: 'openCompareDocumentsDialog' })).toMatchObject({
      ok: false,
      code: 'locked',
    });
    cleanup();
    const viewOnly = mount([reviewModule()], { mode: 'view' });
    expect(viewOnly.can({ type: 'compareDocuments', revised: docx('x') })).toMatchObject({
      ok: false,
      code: 'locked',
    });
  });

  test('refuse under comments and tracked-changes protection', () => {
    for (const protection of ['comments', 'trackedChanges']) {
      const editor = mount([reviewModule()], {}, docx('Original text', protection));
      expect(editor.can({ type: 'compareDocuments', revised: docx('x') })).toMatchObject({
        ok: false,
        code: 'locked',
      });
      expect(editor.can({ type: 'openCompareDocumentsDialog' }).ok).toBe(false);
      cleanup();
    }
  });

  test('installs the result as one undo step; redo reapplies it', () => {
    const editor = mount([reviewModule()]);
    expect(editor.can({ type: 'openCompareDocumentsDialog' }).ok).toBe(true);
    const revision = editor.surface!.session.packageRevision();
    const [first] = editor.surface!.session.paragraphIds();
    editor.surface!.setSelection({
      anchor: { paragraphId: first!, offset: 3 },
      head: { paragraphId: first!, offset: 8 },
    });
    const result = editor.exec({ type: 'compareDocuments', revised: docx('Revised text') });
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      // The engine's revision count, as the dialog session reports it.
      compareDocuments: { ok: true, revisionCount: 2, changed: true },
    });
    expect(bodyText(editor)).toBe('Revised text');
    expect(editor.surface!.session.packageRevision()).toBe(revision + 1);
    // The selection still addresses a live paragraph.
    const ids = editor.surface!.session.paragraphIds();
    const selection = editor.surface!.state().selection;
    expect(ids).toContain(selection.anchor.paragraphId);
    expect(ids).toContain(selection.head.paragraphId);

    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(bodyText(editor)).toBe('Original text');
    expect(editor.surface!.session.canUndo()).toBe(false);
    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(bodyText(editor)).toBe('Revised text');
  });

  test('passes the author and formatting option to the engine and reports its refusal', () => {
    const calls: unknown[] = [];
    const editor = mount([
      reviewModule({
        compareDocuments: (_original, _revised, options) => {
          calls.push(options);
          return { ok: false, code: 'invalidRevised', message: 'not a document' };
        },
      }),
    ]);
    expect(
      editor.exec({ type: 'compareDocuments', revised: docx('x'), detectFormatChanges: false })
    ).toEqual({
      ok: false,
      code: 'invalidArgs',
      reason: 'not a document',
      // The refusal as a code to translate, the same one the dialog shows.
      compareDocuments: { ok: false, code: 'invalidRevised', message: 'not a document' },
    });
    editor.exec({ type: 'compareDocuments', revised: docx('x'), authorName: ' Editor ' });
    editor.exec({ type: 'compareDocuments', revised: docx('x'), removeDateAndTime: true });
    expect(calls).toEqual([
      { authorName: 'Reviewer', detectFormatChanges: false },
      { authorName: 'Editor', detectFormatChanges: true },
      { authorName: 'Reviewer', detectFormatChanges: true, removeDateAndTime: true },
    ]);
    expect(editor.exec({ type: 'compareDocuments', revised: new Uint8Array() })).toMatchObject({
      ok: false,
      code: 'invalidArgs',
      compareDocuments: { ok: false, code: 'empty' },
    });
    expect(bodyText(editor)).toBe('Original text');
  });

  test('empty is a zero-length Uint8Array; a revised of another type is invalidOptions', async () => {
    const editor = mount([reviewModule()]);
    for (const revised of [null, 'bytes', [1, 2], new ArrayBuffer(4), new Uint16Array(2)])
      expect(editor.exec({ type: 'compareDocuments', revised } as never)).toMatchObject({
        ok: false,
        code: 'invalidArgs',
        compareDocuments: { ok: false, code: 'invalidOptions' },
      });
    let session: CompareDocumentsDialogSession | null = null;
    editor.setCompareDocumentsChrome({ onRequest: (s) => (session = s) });
    editor.exec({ type: 'openCompareDocumentsDialog' });
    expect(await session!.apply({ revised: 'bytes' } as never)).toMatchObject({
      ok: false,
      code: 'invalidOptions',
    });
    expect(await session!.apply({ revised: new Uint8Array() })).toMatchObject({
      ok: false,
      code: 'empty',
    });
    expect(bodyText(editor)).toBe('Original text');
    session!.cancel();
  });

  test('a preview or an external refresh blocks a compare with busy', async () => {
    const editor = mount([reviewModule()]);
    const container = mounted!;
    let session: CompareDocumentsDialogSession | null = null;
    editor.setCompareDocumentsChrome({ onRequest: (s) => (session = s) });
    editor.exec({ type: 'openCompareDocumentsDialog' });
    for (const guard of [setPreviewWriteGuard, setRefreshWriteGuard]) {
      guard(container, true);
      expect(session!.canApply()).toBe(false);
      expect(await session!.apply({ revised: docx('Revised text') })).toMatchObject({
        ok: false,
        code: 'busy',
      });
      expect(editor.exec({ type: 'compareDocuments', revised: docx('x') })).toMatchObject({
        ok: false,
        compareDocuments: { ok: false, code: 'busy' },
      });
      expect(session!.signal.aborted).toBe(false);
      guard(container, false);
    }
    expect(bodyText(editor)).toBe('Original text');
    expect(session!.canApply()).toBe(true);
    expect(await session!.apply({ revised: docx('Revised text') })).toMatchObject({ ok: true });
  });

  test('a second apply while a compare runs answers busy and runs nothing', async () => {
    let calls = 0;
    const editor = mount([
      reviewModule({
        compareDocuments: (original, revised, options) => {
          calls++;
          return replaceWithRevised(original, revised, options);
        },
      }),
    ]);
    let session: CompareDocumentsDialogSession | null = null;
    editor.setCompareDocumentsChrome({ onRequest: (s) => (session = s) });
    editor.exec({ type: 'openCompareDocumentsDialog' });
    const first = session!.apply({ revised: docx('Revised text') });
    const second = await session!.apply({ revised: docx('Other text') });
    expect(second).toMatchObject({ ok: false, code: 'busy' });
    expect(await first).toEqual({ ok: true, revisionCount: 2, changed: true });
    expect(calls).toBe(1);
    expect(bodyText(editor)).toBe('Revised text');
  });

  test('a compare that changed the document is announced once the dialog closes', async () => {
    const counts = [2, 0];
    for (const revisionCount of counts) {
      const editor = mount(
        [
          reviewModule({
            compareDocuments: (original, revised, options) => {
              const result = replaceWithRevised(original, revised, options);
              return result.ok ? { ...result, revisionCount } : result;
            },
          }),
        ],
        { translate: createT(en as unknown as LocaleStrings) as Translate }
      );
      const container = mounted!;
      let session: CompareDocumentsDialogSession | null = null;
      editor.setCompareDocumentsChrome({ onRequest: (s) => (session = s) });
      editor.exec({ type: 'openCompareDocumentsDialog' });
      await session!.apply({ revised: docx('Revised text') });
      const region = container.querySelector(`.${EDITOR_ANNOUNCER_CLASS}`)!;
      expect(region.getAttribute('aria-live')).toBe('polite');
      expect(region.getAttribute('role')).toBe('status');
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(region.textContent).toBe(
        revisionCount === 2
          ? 'Compare recorded 2 changes.'
          : 'The compare updated the document without tracked changes.'
      );
      cleanup();
    }
  });
});

describe('compare documents dialog session', () => {
  test('host chrome receives the session; apply compares once and closes it', async () => {
    const editor = mount([reviewModule()]);
    const sessions: CompareDocumentsDialogSession[] = [];
    const dispose = editor.setCompareDocumentsChrome({ onRequest: (s) => sessions.push(s) });
    expect(editor.exec({ type: 'openCompareDocumentsDialog' })).toEqual({
      ok: true,
      changed: false,
    });
    const session = sessions[0]!;
    expect(session.defaultAuthor).toBe('Reviewer');
    expect(session.canApply()).toBe(true);
    const outcome = await session.apply({ revised: docx('Revised text') });
    expect(outcome).toEqual({ ok: true, revisionCount: 2, changed: true });
    expect(session.signal.aborted).toBe(true);
    expect(bodyText(editor)).toBe('Revised text');
    dispose();
  });

  test('a compare with no differences keeps the session open, so the dialog can say so', async () => {
    const editor = mount([
      reviewModule({
        compareDocuments: (original) => ({
          ok: true,
          package: original,
          revisionCount: 0,
          changed: false,
        }),
      }),
    ]);
    let session: CompareDocumentsDialogSession | null = null;
    editor.setCompareDocumentsChrome({ onRequest: (s) => (session = s) });
    editor.exec({ type: 'openCompareDocumentsDialog' });
    const revision = editor.surface!.session.packageRevision();
    const outcome = await session!.apply({ revised: docx('Original text') });
    expect(outcome).toEqual({ ok: true, revisionCount: 0, changed: false });
    // No step: nothing to undo, and the document is not marked as changed.
    expect(editor.surface!.session.packageRevision()).toBe(revision);
    expect(editor.can({ type: 'undo' }).ok).toBe(false);
    expect(session!.signal.aborted).toBe(false);
    expect(session!.canApply()).toBe(true);
    expect(bodyText(editor)).toBe('Original text');
    // The dialog says so itself; the editor announces nothing.
    expect(mounted!.querySelector(`.${EDITOR_ANNOUNCER_CLASS}`)).toBeNull();
    session!.cancel();
  });

  test('a history group is refused, never ignored', () => {
    const editor = mount([reviewModule()]);
    const revision = editor.surface!.session.packageRevision();
    const gesture = editor.beginHistoryGroup();
    for (const command of [
      { type: 'compareDocuments', revised: docx('Revised text') } as const,
      { type: 'openCompareDocumentsDialog' } as const,
    ]) {
      expect(editor.exec(command, { historyGroup: gesture })).toMatchObject({
        ok: false,
        code: 'unsupported',
      });
      // A refusal from before the compare carries the outcome too.
      if (command.type === 'compareDocuments')
        expect(editor.exec(command, { historyGroup: gesture })).toMatchObject({
          compareDocuments: { ok: false, code: 'failed' },
        });
    }
    expect(editor.surface!.session.packageRevision()).toBe(revision);
    gesture.end();
  });

  test('a protected original is refused with its own reason', async () => {
    const editor = mount([
      reviewModule({
        compareDocuments: () => ({ ok: false, code: 'protected', message: 'protected' }),
      }),
    ]);
    const result = editor.exec({ type: 'compareDocuments', revised: docx('x') });
    // The exec code names the kind of refusal, not an argument error.
    expect(result).toMatchObject({
      ok: false,
      code: 'locked',
      compareDocuments: { code: 'protected' },
    });
  });

  test('an engine refusal reason reaches the command and the dialog session', async () => {
    const refusal = {
      ok: false as const,
      code: 'unsupportedContent' as const,
      reason: 'lockedContent' as const,
      message: 'locked',
    };
    const editor = mount([reviewModule({ compareDocuments: () => refusal })]);
    expect(editor.exec({ type: 'compareDocuments', revised: docx('x') })).toMatchObject({
      compareDocuments: { ok: false, code: 'unsupportedContent', reason: 'lockedContent' },
    });
    let session: CompareDocumentsDialogSession | undefined;
    editor.setCompareDocumentsChrome({ onRequest: (s) => (session = s) });
    editor.exec({ type: 'openCompareDocumentsDialog' });
    const outcome = await session!.apply({ revised: docx('x') });
    expect(outcome).toEqual({
      ok: false,
      code: 'unsupportedContent',
      reason: 'lockedContent',
      message: 'locked',
    });
    expect(compareDocumentsErrorKey(outcome as typeof refusal)).toBe(
      'compareDocuments.reasons.lockedContent'
    );
    expect(compareDocumentsErrorKey({ code: 'tooLarge' })).toBe('compareDocuments.errors.tooLarge');
  });

  test('limits and content refusals answer unsupported', () => {
    for (const code of ['tooLarge', 'unsupportedContent', 'invalidOriginal'] as const) {
      const editor = mount([
        reviewModule({ compareDocuments: () => ({ ok: false, code, message: code }) }),
      ]);
      expect(editor.exec({ type: 'compareDocuments', revised: docx('x') })).toMatchObject({
        ok: false,
        code: 'unsupported',
        compareDocuments: { code },
      });
      cleanup();
    }
  });

  test('options of the wrong type are refused, not coerced', () => {
    let calls = 0;
    const editor = mount([
      reviewModule({
        compareDocuments: (original) => {
          calls++;
          return { ok: true, package: original, revisionCount: 0, changed: false };
        },
      }),
    ]);
    for (const options of [
      { detectFormatChanges: 'false' },
      { removeDateAndTime: 1 },
      { authorName: 7 },
    ])
      expect(
        editor.exec({ type: 'compareDocuments', revised: docx('x'), ...options } as never)
      ).toMatchObject({
        ok: false,
        code: 'invalidArgs',
        compareDocuments: { ok: false, code: 'invalidOptions' },
      });
    expect(calls).toBe(0);
  });

  test('an engine that throws gives a failed result, not a throw', () => {
    const editor = mount([
      reviewModule({
        compareDocuments: () => {
          throw new Error('engine defect');
        },
      }),
    ]);
    expect(editor.exec({ type: 'compareDocuments', revised: docx('x') })).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'engine defect',
      compareDocuments: { ok: false, code: 'failed', message: 'engine defect' },
    });
    expect(bodyText(editor)).toBe('Original text');
  });

  test('a refused compare keeps the session open with the message', async () => {
    const editor = mount([
      reviewModule({
        compareDocuments: () => ({ ok: false, code: 'tooLarge', message: 'too large' }),
      }),
    ]);
    let session: CompareDocumentsDialogSession | null = null;
    editor.setCompareDocumentsChrome({ onRequest: (s) => (session = s) });
    editor.exec({ type: 'openCompareDocumentsDialog' });
    const outcome = await session!.apply({ revised: docx('Revised') });
    expect(outcome).toEqual({ ok: false, code: 'tooLarge', message: 'too large' });
    expect(session!.signal.aborted).toBe(false);
    session!.cancel();
    expect(session!.signal.aborted).toBe(true);
    expect(session!.canApply()).toBe(false);
  });

  test('without host chrome the module dialog opens; detach closes it', () => {
    const hosts: CompareDocumentsDialogHost[] = [];
    let destroyed = 0;
    const editor = mount([
      reviewModule({
        createCompareDocumentsDialog: (host) => {
          hosts.push(host);
          return { open() {}, destroy: () => (destroyed += 1) };
        },
      }),
    ]);
    expect(editor.exec({ type: 'openCompareDocumentsDialog' }).ok).toBe(true);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]!.container).toBeInstanceOf(HTMLElement);
    editor.detach();
    expect(hosts[0]!.signal.aborted).toBe(true);
    expect(destroyed).toBe(1);
  });
});

// Every refusal code, engine codes included, has a message: the dialogs translate
// `compareDocuments.errors.<reason>` with a cast the type checker cannot follow.
test('every compare refusal has an English message', () => {
  const reasons: Record<CompareDocumentsErrorCode, true> = {
    invalidOptions: true,
    invalidOriginal: true,
    invalidRevised: true,
    tooLarge: true,
    protected: true,
    unsupportedContent: true,
    unavailable: true,
    collaboration: true,
    viewing: true,
    closed: true,
    empty: true,
    busy: true,
    documentChanged: true,
    failed: true,
  };
  const messages = en.compareDocuments.errors as Record<string, string>;
  for (const reason of Object.keys(reasons)) expect(messages[reason]).toBeString();
  expect(Object.keys(messages).sort()).toEqual(Object.keys(reasons).sort());
  const details: Record<CompareDocumentsRefusalReason, true> = {
    lockedContent: true,
    unresolvedRevisions: true,
    untrackedContent: true,
    unrecordedSettings: true,
    headerFooter: true,
    packageStructure: true,
    unverified: true,
  };
  const detailMessages = en.compareDocuments.reasons as Record<string, string>;
  expect(Object.keys(detailMessages).sort()).toEqual(Object.keys(details).sort());
});
