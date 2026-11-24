import { expect, test } from 'bun:test';
import { createDocxEditor } from '../docx-editor.ts';
import { createBrowserAutomationHost } from '../automation-host.ts';
import { formFieldDocx } from './form-field-docx.fixture.ts';

function open() {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: formFieldDocx(true), locale: 'en-GB' });
  const automation = createBrowserAutomationHost(editor);
  return {
    editor,
    automation,
    enter(text: string) {
      const surface = editor.surface!;
      const paragraphId = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 10 },
      });
      surface.pasteRich(text, null);
    },
    dispose() {
      automation.dispose();
      editor.destroy();
      container.remove();
    },
  };
}

for (const entry of ['surface', 'automation'] as const) {
  test(`${entry} save commits regional dates without losing their input locale`, () => {
    const host = open();
    try {
      host.enter('3/4/30');
      host.editor.setLocale('en-US');
      const save = () => {
        if (entry === 'surface') return host.editor.surface!.save();
        const result = host.automation.save();
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error.message);
        return result.bytes;
      };
      const bytes = save();
      expect(host.editor.surface!.session.bodyText()).toBe('04/03/1930 tail');
      expect(host.editor.surface!.state().selection.head.offset).toBe(10);
      host.editor.surface!.undo();
      expect(host.editor.surface!.session.bodyText()).toBe('3/4/30 tail');
      save();
      expect(host.editor.surface!.session.bodyText()).toBe('04/03/1930 tail');
      host.editor.load(bytes);
      expect(host.editor.surface!.session.bodyText()).toBe('04/03/1930 tail');
    } finally {
      host.dispose();
    }
  });

  test(`${entry} save refuses invalid values without changing input or history`, () => {
    const host = open();
    try {
      host.enter('invalid');
      const revision = host.editor.getDocumentHandle().revision;
      const selection = host.editor.surface!.state().selection;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (entry === 'surface') {
          expect(() => host.editor.surface!.save()).toThrow(
            expect.objectContaining({ code: 'invalidArgs' })
          );
        } else {
          expect(host.automation.save()).toMatchObject({
            ok: false,
            error: { code: 'transaction-refused' },
          });
        }
        expect(host.editor.surface!.session.bodyText()).toBe('invalid tail');
        expect(host.editor.getDocumentHandle().revision).toBe(revision);
        expect(host.editor.surface!.state().selection).toEqual(selection);
      }
    } finally {
      host.dispose();
    }
  });

  test(`${entry} save refuses during an input callback and succeeds after the edit`, () => {
    const host = open();
    try {
      let calls = 0;
      const off = host.editor.on('change', () => {
        calls++;
        if (entry === 'surface') {
          expect(() => host.editor.surface!.save()).toThrow(
            expect.objectContaining({ code: 'invalidState' })
          );
        } else {
          expect(host.automation.save()).toMatchObject({
            ok: false,
            error: { code: 'transaction-refused' },
          });
        }
      });
      host.enter('3/4/30');
      off();
      expect(calls).toBe(1);
      expect(host.automation.save().ok).toBe(true);
      expect(host.editor.surface!.session.bodyText()).toBe('04/03/1930 tail');
    } finally {
      host.dispose();
    }
  });
}

test('a disposed automation host refuses without committing pending input', () => {
  const host = open();
  try {
    host.enter('03/04/2030');
    host.automation.dispose();
    expect(host.automation.save()).toMatchObject({ ok: false, error: { code: 'disposed' } });
    expect(host.editor.surface!.session.bodyText()).toBe('03/04/2030 tail');
  } finally {
    host.dispose();
  }
});

for (const replace of [false, true]) {
  test(`a destroyed surface cannot save or change ${replace ? 'its replacement' : 'its document'}`, () => {
    const host = open();
    try {
      const stale = host.editor.surface!;
      if (replace) {
        host.editor.load(formFieldDocx(true));
        host.enter('03/04/2030');
      } else {
        host.enter('03/04/2030');
        host.editor.destroy();
      }
      expect(() => stale.save()).toThrow(expect.objectContaining({ code: 'destroyed' }));
      const current = replace ? host.editor.surface! : stale;
      expect(current.session.bodyText()).toBe('03/04/2030 tail');
    } finally {
      host.dispose();
    }
  });
}

test('a save stops if flushing input replaces its surface', () => {
  const host = open();
  try {
    const stale = host.editor.surface!;
    const paragraphId = stale.session.paragraphIds()[0]!;
    stale.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 10 } });
    stale.enqueueType('3/4/30');
    const off = host.editor.on('change', () => {
      off();
      host.editor.load(formFieldDocx(true));
      host.enter('03/04/2030');
    });
    expect(() => stale.save()).toThrow(expect.objectContaining({ code: 'destroyed' }));
    expect(host.editor.surface!.session.bodyText()).toBe('03/04/2030 tail');
  } finally {
    host.dispose();
  }
});

test('destroy removes surface resources even if the final change listener throws', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: formFieldDocx(true) });
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 10 } });
  surface.enqueueType('3/4/30');
  const off = editor.on('change', () => {
    throw new Error('host callback');
  });
  try {
    expect(() => surface.destroy()).toThrow('host callback');
    expect(container.children.length).toBe(0);
    expect(() => surface.save()).toThrow(expect.objectContaining({ code: 'destroyed' }));
    surface.destroy();
    expect(container.children.length).toBe(0);
  } finally {
    off();
    editor.destroy();
    container.remove();
  }
});
