// Session and save diagnostics: an editor reports its start, one activity summary per window of
// use, its end with totals, and each save. The tracker tests drive a fake clock; the editor
// tests use a real editor and read what a module receives.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { EditorDiagnostic, SessionDiagnostic } from '../../contracts/diagnostics.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { runAsAutomation } from '../editor-diagnostics.ts';
import { SESSION_IDLE_MS, createSessionTracker, type SessionClock } from '../editor-session.ts';

type Sent = Omit<SessionDiagnostic, 'schemaVersion' | 'editorSessionId' | 'time'>;

function tracker(enabled = () => true) {
  let time = 1_000;
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 1;
  const clock: SessionClock = {
    now: () => time,
    setTimer(run, ms) {
      const id = nextTimer++;
      timers.set(id, { at: time + ms, run });
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
  };
  const sent: Sent[] = [];
  const instance = createSessionTracker({
    deliver: (payload) => sent.push(payload as Sent),
    enabled,
    windowMs: 60_000,
    clock,
  });
  return {
    sent,
    instance,
    advance(ms: number) {
      time += ms;
      for (const [id, timer] of [...timers])
        if (timer.at <= time) {
          timers.delete(id);
          timer.run();
        }
    },
  };
}

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('session tracker', () => {
  test('a session starts, summarizes each window of use, and ends with totals', async () => {
    const { sent, instance, advance } = tracker();
    await settle();
    expect(sent).toEqual([{ kind: 'session', phase: 'start' }]);
    instance.edit('input');
    advance(1_000);
    instance.edit('input');
    advance(2_000);
    instance.edit('command');
    // The window closes a minute after its first activity.
    advance(57_000);
    expect(sent[1]).toEqual({
      kind: 'session',
      phase: 'active',
      durationMs: 60_000,
      activeMs: 3_000,
      inputEdits: 2,
      commandEdits: 1,
      automationEdits: 0,
    });
    advance(10_000);
    instance.edit('automation');
    advance(5_000);
    instance.end();
    expect(sent.slice(2)).toEqual([
      {
        kind: 'session',
        phase: 'active',
        durationMs: 5_000,
        // A minute after the last activity: a pause, not use.
        activeMs: 0,
        inputEdits: 0,
        commandEdits: 0,
        automationEdits: 1,
      },
      {
        kind: 'session',
        phase: 'end',
        durationMs: 75_000,
        activeMs: 3_000,
        inputEdits: 2,
        commandEdits: 1,
        automationEdits: 1,
      },
    ]);
  });

  test('a pause longer than the idle limit is not use, and an idle editor sends nothing', async () => {
    const { sent, instance, advance } = tracker();
    await settle();
    instance.activity();
    advance(SESSION_IDLE_MS + 1);
    instance.activity();
    advance(120_000);
    expect(sent.filter((event) => event.phase === 'active')).toEqual([
      expect.objectContaining({ activeMs: 0, inputEdits: 0 }),
    ]);
    advance(600_000);
    expect(sent.filter((event) => event.phase === 'active')).toHaveLength(1);
  });

  test('a session no one heard start sends nothing, so every end has its start', async () => {
    const { sent, instance } = tracker(() => false);
    await settle();
    instance.edit('input');
    instance.end();
    expect(sent).toEqual([]);
  });

  test('an editor ended before the next microtask never starts', async () => {
    const { sent, instance } = tracker();
    instance.end();
    await settle();
    expect(sent).toEqual([]);
  });
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SECRET_TEXT = 'Quarterly figures for the board';

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${SECRET_TEXT}</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

function mount(modules?: Parameters<typeof createDocxEditor>[0]['modules']) {
  const events: EditorDiagnostic[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = createDocxEditor({
    container,
    document: docx(),
    modules: modules ?? [{ id: 'observer', onDiagnostic: (event) => events.push(event) }],
  });
  return {
    events,
    container,
    editor,
    destroy() {
      editor.destroy();
      container.remove();
    },
  };
}

describe('editor sessions', () => {
  test('a real editor counts each committed edit by origin, and no refused one', async () => {
    const { events, container, editor, destroy } = mount();
    try {
      await settle();
      const pages = container.querySelector('.docx-pages')!;
      pages.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      pages.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: 'x',
        })
      );
      expect(editor.exec({ type: 'insertText', text: 'y' }).ok).toBe(true);
      // One batch with two edits is one automation edit.
      runAsAutomation(editor, () => {
        editor.exec({ type: 'insertText', text: 'z' });
        editor.exec({ type: 'insertText', text: 'w' });
      });
      editor.setEditingMode('viewing');
      expect(editor.exec({ type: 'insertText', text: 'v' }).ok).toBe(false);
    } finally {
      destroy();
    }
    const session = events.filter((event) => event.kind === 'session');
    expect(session[0]).toMatchObject({ phase: 'start' });
    const end = session.at(-1) as Extract<SessionDiagnostic, { phase: 'end' }>;
    expect(end).toMatchObject({
      phase: 'end',
      inputEdits: 1,
      commandEdits: 1,
      automationEdits: 1,
    });
    expect(events.some((event) => event.kind === 'edit.rejected')).toBe(true);
    expect(JSON.stringify(session)).not.toContain(SECRET_TEXT.split(' ')[0]);
  });

  test('undo and redo count as edits: from the keyboard as input, from exec as a command', async () => {
    const { events, container, editor, destroy } = mount();
    try {
      await settle();
      expect(editor.exec({ type: 'insertText', text: 'y' }).ok).toBe(true);
      const pages = container.querySelector('.docx-pages')!;
      pages.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      expect(editor.exec({ type: 'redo' }).ok).toBe(true);
      // Nothing left to redo: no change, no edit.
      editor.exec({ type: 'redo' });
    } finally {
      destroy();
    }
    expect(events.find((event) => event.kind === 'session' && event.phase === 'end')).toMatchObject(
      { inputEdits: 1, commandEdits: 2 }
    );
  });

  test('a closing page ends the session; a page kept in the back-forward cache does not', async () => {
    const { events, editor, destroy } = mount();
    try {
      await settle();
      editor.exec({ type: 'insertText', text: 'y' });
      const pageHide = (persisted: boolean) =>
        Object.assign(new Event('pagehide'), { persisted }) as Event;
      globalThis.dispatchEvent(pageHide(true));
      expect(events.some((event) => event.kind === 'session' && event.phase === 'end')).toBe(false);
      globalThis.dispatchEvent(pageHide(false));
      const ends = events.filter((event) => event.kind === 'session' && event.phase === 'end');
      expect(ends).toEqual([expect.objectContaining({ commandEdits: 1 })]);
    } finally {
      destroy();
    }
    // Destroying the editor afterwards sends no second end.
    expect(
      events.filter((event) => event.kind === 'session' && event.phase === 'end')
    ).toHaveLength(1);
  });

  test('a module that does not want sessions turns session events off', async () => {
    const events: EditorDiagnostic[] = [];
    const { editor, destroy } = mount([
      {
        id: 'no-sessions',
        onDiagnostic: (event) => events.push(event),
        wantsDiagnostic: (kind) => kind !== 'session' && kind !== 'performance',
      },
    ]);
    await settle();
    editor.exec({ type: 'insertText', text: 'x' });
    destroy();
    expect(events.filter((event) => event.kind === 'session')).toEqual([]);
  });

  test('a save reports its outcome, size bucket, and duration, never the bytes', async () => {
    const { events, editor, destroy } = mount();
    try {
      const bytes = await editor.save();
      expect(bytes.byteLength).toBeGreaterThan(0);
    } finally {
      destroy();
    }
    const saves = events.filter((event) => event.kind === 'document.save');
    expect(saves).toEqual([
      expect.objectContaining({
        kind: 'document.save',
        outcome: 'saved',
        sizeBucket: '0-64KiB',
        durationMs: expect.any(Number),
      }),
    ]);
    expect(JSON.stringify(saves)).not.toContain(SECRET_TEXT.split(' ')[0]);
  });

  test('a failed save reports its code, and the caller still gets the error', async () => {
    const events: EditorDiagnostic[] = [];
    const editor = createDocxEditor({
      modules: [{ id: 'observer', onDiagnostic: (event) => events.push(event) }],
    });
    try {
      await expect(editor.save()).rejects.toThrow();
    } finally {
      editor.destroy();
    }
    expect(events.filter((event) => event.kind === 'document.save')).toEqual([
      expect.objectContaining({ outcome: 'rejected', code: 'save.no-document' }),
    ]);
  });
});
