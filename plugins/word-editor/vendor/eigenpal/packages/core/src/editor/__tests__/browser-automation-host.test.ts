// The browser automation host: the same protocol, over the editor that is already open.
//
// The property that matters is what it does NOT do. It creates no document model of its own,
// derives nothing from the painted DOM, and writes through the session's one transaction path
// — so a scripted edit and a typed edit are the same edit, and the painted pages repaint from
// it exactly as they do for a keystroke.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { createBrowserAutomationHost } from '../automation-host.ts';
import type { AutomationHandle, AutomationHost } from '../../automation/index.ts';
import { storeEditDiagnosticCode } from '../../automation/diagnostics.ts';
import { setRefreshWriteGuard } from '../refresh-write-guard.ts';
import { stubReviewModule } from './review-test-module.ts';
import { stubCollaborationModule, stubCollaborationSession } from './collaboration-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const TWO_PARAGRAPHS = docx(`${p('alpha')}${p('beta')}`);

function mount(): { editor: DocxEditorInstance; container: HTMLElement; host: AutomationHost } {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: TWO_PARAGRAPHS });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container, host: createBrowserAutomationHost(editor) };
}

function handles(host: AutomationHost): {
  body: AutomationHandle;
  paragraphs: readonly AutomationHandle[];
} {
  const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
  const body = handleAt(host.execute({ operations: [{ op: 'getBody', document }] }), 0);
  const listed = host.execute({ operations: [{ op: 'getParagraphs', body }] });
  const result = listed.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'handles') {
    throw new Error('expected paragraph handles');
  }
  return { body, paragraphs: result.value.handles };
}

function handleAt(
  response: { readonly results: readonly { readonly status: string }[] },
  index: number
): AutomationHandle {
  const result = response.results[index] as
    { status: 'ok'; value: { kind: string; handle: AutomationHandle } } | undefined;
  if (result?.status !== 'ok' || result.value.kind !== 'handle') {
    throw new Error(`expected a handle at ${index}`);
  }
  return result.value.handle;
}

function textOf(host: AutomationHost, target: AutomationHandle): string {
  const response = host.execute({ operations: [{ op: 'getText', target }] });
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'text') throw new Error('expected text');
  return result.value.text;
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

describe('the browser host over a mounted editor', () => {
  test('it claims the browser-only capabilities the headless host cannot', () => {
    const { host } = mount();
    expect(host.capabilities).toEqual({
      document: true,
      save: true,
      events: true,
      selection: true,
      scrolling: true,
      layout: true,
    });
    expect(Object.isFrozen(host.capabilities)).toBe(true);
  });

  test('it reads the document that is already open', () => {
    const { host } = mount();
    const { body, paragraphs } = handles(host);
    expect(paragraphs).toHaveLength(2);
    expect(textOf(host, body)).toBe('alpha\rbeta');
    expect(textOf(host, paragraphs[1]!)).toBe('beta');
  });

  test('an insert lands in the model AND repaints the pages', () => {
    // The reason this host may not own a model: the painted surface is subscribed to the
    // same session, so one write updates both. A second model would update neither.
    const { host, container, editor } = mount();
    const { paragraphs } = handles(host);
    const before = editor.snapshot();

    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'ZZ' }],
    });

    expect({ ok: response.ok, changed: response.changed }).toEqual({ ok: true, changed: true });
    expect(textOf(host, paragraphs[0]!)).toBe('ZZalpha');
    expect(container.textContent).toContain('ZZalpha');
    // And the editor's own observable state moved, so host chrome re-renders too.
    expect(editor.snapshot()).not.toBe(before);
  });

  test('the editor and the host report the same document after either one writes', () => {
    // A typed edit through the facade and a scripted edit through the host are the same
    // edit — which is only true because there is one store behind both.
    const { host, editor } = mount();
    const { paragraphs } = handles(host);
    editor.surface!.selectAll();
    editor.exec({ type: 'insertText', text: 'typed ' });
    expect(textOf(host, paragraphs[0]!)).toContain('typed ');

    host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: '#' }],
    });
    expect(editor.query({ type: 'selectedText' })).not.toBeUndefined();
    expect(textOf(host, paragraphs[0]!).startsWith('#')).toBe(true);
  });

  test('a refused batch leaves the open document exactly as it was', () => {
    const { host, container } = mount();
    const { paragraphs } = handles(host);
    const response = host.execute({
      operations: [
        { op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'good' },
        { op: 'insertText', at: { paragraph: paragraphs[1]!, offset: 500 }, text: 'bad' },
      ],
    });
    expect(response.ok).toBe(false);
    expect(errorCodeAt(response, 1)).toBe('invalid-offset');
    expect(textOf(host, paragraphs[0]!)).toBe('alpha');
    expect(container.textContent).not.toContain('good');
  });

  test('a committed batch notifies through the editor, not through a second subscription', () => {
    const { host } = mount();
    const { paragraphs } = handles(host);
    const seen: number[] = [];
    host.subscribe((event) => seen.push(event.revision));
    host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'x' }],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(host.revision());
  });

  test('save reaches the same normalizing serializer the editor saves through', async () => {
    const { host, editor } = mount();
    const { paragraphs } = handles(host);
    host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 5 }, text: '!' }],
    });
    const saved = host.save();
    expect(saved.ok).toBe(true);
    const viaEditor = await editor.save();
    if (!saved.ok) return;
    expect(saved.bytes.byteLength).toBe(viaEditor.byteLength);
  });
});

describe('a detached or destroyed editor', () => {
  test('a detached editor keeps its document, and re-attaching moves it back unchanged', () => {
    const { host, editor } = mount();
    const { paragraphs } = handles(host);
    host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'x' }],
    });
    const beforeDetach = host.revision();

    editor.detach();
    const detached = host.execute({ operations: [{ op: 'getDocument' }] });
    expect(detached.ok).toBe(true);

    editor.attach(document.createElement('div'));
    const reattached = host.execute({ operations: [{ op: 'getDocument' }] });
    expect(reattached.ok).toBe(true);
    // The same session moved: its revision never goes backwards, so an expectedRevision from
    // before the detach still names the document it was read from.
    expect(host.revision()).toBeGreaterThanOrEqual(beforeDetach);
  });

  test('paragraph handles from before a remount are refused rather than silently retargeted', () => {
    const { host, editor } = mount();
    const { paragraphs } = handles(host);
    editor.detach();
    editor.attach(document.createElement('div'));
    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraphs[0]!, offset: 0 }, text: 'x' }],
    });
    // Either the handle still names a live paragraph (identity survived the remount) or it
    // does not and the host says so. What it must never do is write into a different one.
    if (!response.ok) {
      expect(errorCodeAt(response, 0)).toBe('invalid-handle');
    } else {
      expect(textOf(host, paragraphs[0]!)).toBe('xalpha');
    }
  });

  test('disposing the host does not destroy the editor it borrowed', () => {
    // The host is a lens on someone else's editor. Tearing the editor down with it would
    // make "get me automation over this editor" a destructive call.
    const { host, editor, container } = mount();
    host.dispose();
    expect(host.execute({ operations: [{ op: 'getDocument' }] }).ok).toBe(false);
    expect(editor.surface).not.toBeNull();
    expect(container.textContent).toContain('alpha');
    editor.surface!.selectAll();
    expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toEqual({ ok: true, changed: true });
  });

  test('a destroyed editor leaves the host answering with a code rather than throwing', () => {
    const { host, editor } = mount();
    handles(host);
    editor.destroy();
    const response = host.execute({ operations: [{ op: 'getDocument' }] });
    expect(response.ok).toBe(false);
    expect(errorCodeAt(response, 0)).toBe('document-unavailable');
    expect(host.save().ok).toBe(false);
  });
});

describe('an external document refresh', () => {
  test('a picture insert during an external refresh is refused, not reported as committed', () => {
    // The refresh guard skips the surface commit without running it. Reported as a commit that
    // changed nothing, the picture's answer then found no drawing and threw a plain Error.
    const { host, container, editor } = mount();
    const { paragraphs } = handles(host);
    const before = editor.surface!.session.packageRevision();
    setRefreshWriteGuard(container, true);
    const response = host.execute({
      operations: [
        {
          op: 'insertInlinePicture',
          span: { paragraph: paragraphs[0]! },
          base64:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          location: 'End',
        },
      ],
    });
    setRefreshWriteGuard(container, false);
    expect(response.ok).toBe(false);
    expect(errorCodeAt(response, 0)).toBe('transaction-refused');
    const failure = response.results[0] as { error: { detail?: string } };
    expect(storeEditDiagnosticCode(failure.error.detail ?? '')).toBe('edit.refresh-in-progress');
    expect(editor.surface!.session.packageRevision()).toBe(before);
  });

  test('a comment refused by viewing names viewing, not a refresh', () => {
    // `commitReviewOps` also skips the write for viewing and collaboration gates. Only a
    // skipped refresh may report the refresh; a gate reports its own reason.
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: TWO_PARAGRAPHS,
      modules: [stubReviewModule()],
    });
    const host = createBrowserAutomationHost(editor);
    const { paragraphs } = handles(host);
    editor.surface!.setEditingMode('view');
    const response = host.execute({
      operations: [
        { op: 'insertComment', span: { paragraph: paragraphs[0]! }, text: 'Note', author: 'Ann' },
      ],
    });
    expect(response.ok).toBe(false);
    const failure = response.results[0] as { error: { detail?: string } };
    expect(storeEditDiagnosticCode(failure.error.detail ?? '')).toBe('edit.read-only');
    editor.destroy();
  });

  // A custom-node write has no review gate in front of the surface, so it reaches both of the
  // surface's skip reasons: the refresh guard and the viewing gate.
  test.each([
    ['an external refresh', 'edit.refresh-in-progress'],
    ['viewing', 'edit.read-only'],
  ] as const)('a custom node refused by %s names it', (cause, code) => {
    const { host, container, editor } = mount();
    const { paragraphs } = handles(host);
    const before = editor.surface!.session.packageRevision();
    if (cause === 'viewing') editor.surface!.setEditingMode('view');
    else setRefreshWriteGuard(container, true);
    const response = host.execute({
      operations: [
        {
          op: 'insertCustomNode',
          at: { paragraph: paragraphs[0]!, at: 'end' },
          tag: 'citation',
          text: '(Smith 2024)',
        },
      ],
    });
    setRefreshWriteGuard(container, false);
    expect(response.ok).toBe(false);
    const failure = response.results[0] as { error: { detail?: string } };
    expect(storeEditDiagnosticCode(failure.error.detail ?? '')).toBe(code);
    expect(editor.surface!.session.packageRevision()).toBe(before);
  });

  test('a comment refused by the collaboration gate names the session state', () => {
    const container = document.createElement('div');
    const session = stubCollaborationSession({
      gateOperations: () => 'collaboration-session-not-ready',
    });
    const editor = createDocxEditor({
      container,
      document: TWO_PARAGRAPHS,
      modules: [stubReviewModule(), stubCollaborationModule(session)],
    });
    const host = createBrowserAutomationHost(editor);
    const { paragraphs } = handles(host);
    const response = host.execute({
      operations: [
        { op: 'insertComment', span: { paragraph: paragraphs[0]! }, text: 'Note', author: 'Ann' },
      ],
    });
    expect(response.ok).toBe(false);
    const failure = response.results[0] as { error: { detail?: string } };
    expect(storeEditDiagnosticCode(failure.error.detail ?? '')).toBe(
      'edit.collaboration-not-ready'
    );
    editor.destroy();
  });

  test('a comment written during an external refresh names the refresh', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: TWO_PARAGRAPHS,
      modules: [stubReviewModule()],
    });
    const host = createBrowserAutomationHost(editor);
    const { paragraphs } = handles(host);
    const before = editor.surface!.session.packageRevision();
    setRefreshWriteGuard(container, true);
    const response = host.execute({
      operations: [
        { op: 'insertComment', span: { paragraph: paragraphs[0]! }, text: 'Note', author: 'Ann' },
      ],
    });
    setRefreshWriteGuard(container, false);
    expect(response.ok).toBe(false);
    const failure = response.results[0] as { error: { detail?: string } };
    expect(storeEditDiagnosticCode(failure.error.detail ?? '')).toBe('edit.refresh-in-progress');
    expect(editor.surface!.session.packageRevision()).toBe(before);
    editor.destroy();
  });
});
