import { expect, test } from 'bun:test';
import { createDocxEditor } from '../docx-editor.ts';
import { formFieldDocx } from './form-field-docx.fixture.ts';

function open() {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: formFieldDocx(true), locale: 'en-GB' });
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  const select = (start: number, end = start) =>
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: start },
      head: { paragraphId, offset: end },
    });
  return {
    editor,
    container,
    select,
    text: () => editor.surface!.session.bodyText(),
    enter(text: string) {
      select(0, 10);
      editor.surface!.pasteRich(text, null);
    },
    dispose() {
      editor.destroy();
      container.remove();
    },
  };
}

for (const changeLocale of [false, true]) {
  test(`save finalizes regional input before field exit (locale changed: ${changeLocale})`, async () => {
    const host = open();
    try {
      host.enter('03/04/2030');
      if (changeLocale) host.editor.setLocale('en-US');
      const selection = host.editor.surface!.state().selection;
      const saved = await host.editor.save();
      expect(host.text()).toBe('04/03/2030 tail');
      expect(host.editor.surface!.state().selection).toEqual(selection);
      host.editor.load(saved);
      host.select(0);
      host.select(13);
      expect(host.text()).toBe('04/03/2030 tail');
    } finally {
      host.dispose();
    }
  });
}

test('save maps a field-end caret when formatting expands the value without claiming focus', async () => {
  const host = open();
  const button = document.createElement('button');
  document.body.append(button);
  try {
    host.enter('3/4/30');
    button.focus();
    await host.editor.save();
    expect(host.text()).toBe('04/03/1930 tail');
    expect(host.editor.surface!.state().selection.head.offset).toBe(10);
    expect(document.activeElement).toBe(button);
  } finally {
    button.remove();
    host.dispose();
  }
});

test('repeated invalid autosaves reject without a dialog, lost input, or new history', async () => {
  const host = open();
  try {
    host.enter('invalid');
    const revision = host.editor.getDocumentHandle().revision;
    const selection = host.editor.surface!.state().selection;
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(host.editor.save()).rejects.toMatchObject({ code: 'invalidArgs' });
      expect(host.text()).toBe('invalid tail');
      expect(host.editor.getDocumentHandle().revision).toBe(revision);
      expect(host.editor.surface!.state().selection).toEqual(selection);
      expect(host.container.querySelector('dialog')).toBeNull();
    }
    host.editor.surface!.undo();
    expect(host.text()).toBe('01/02/2030 tail');
    await host.editor.save();
    expect(host.text()).toBe('01/02/2030 tail');
  } finally {
    host.dispose();
  }
});

test('save leaves clean authored dates unchanged and adds no history entry', async () => {
  const host = open();
  try {
    host.select(0, 10);
    const revision = host.editor.getDocumentHandle().revision;
    await host.editor.save();
    expect(host.text()).toBe('01/02/2030 tail');
    expect(host.editor.getDocumentHandle().revision).toBe(revision);
  } finally {
    host.dispose();
  }
});

test('undo and redo preserve the saved date input locale', async () => {
  const host = open();
  try {
    host.enter('03/04/2030');
    host.editor.setLocale('en-US');
    await host.editor.save();
    host.editor.surface!.undo();
    expect(host.text()).toBe('03/04/2030 tail');
    await host.editor.save();
    expect(host.text()).toBe('04/03/2030 tail');
    host.editor.surface!.undo();
    host.editor.surface!.redo();
    const revision = host.editor.getDocumentHandle().revision;
    await host.editor.save();
    expect(host.text()).toBe('04/03/2030 tail');
    expect(host.editor.getDocumentHandle().revision).toBe(revision);
  } finally {
    host.dispose();
  }
});

test('a synchronous change callback can save formatted input without parsing it twice', async () => {
  const host = open();
  try {
    host.enter('03/04/2030');
    const nested: Promise<ArrayBuffer>[] = [];
    const off = host.editor.on('change', () => {
      if (nested.length >= 2) throw new Error('save recursed');
      nested.push(host.editor.save());
    });
    await host.editor.save();
    off();
    expect(nested).toHaveLength(1);
    const [saved] = await Promise.all(nested);
    host.editor.load(saved!);
    expect(host.text()).toBe('04/03/2030 tail');
  } finally {
    host.dispose();
  }
});

test('autosave from an input change finalizes the date and preserves the insertion caret', async () => {
  const host = open();
  try {
    const saves: Promise<ArrayBuffer>[] = [];
    const off = host.editor.on('change', () => {
      if (saves.length < 2) saves.push(host.editor.save());
    });
    host.enter('3/4/30');
    off();
    await Promise.all(saves);
    expect(host.text()).toBe('04/03/1930 tail');
    expect(host.editor.surface!.state().selection.head.offset).toBe(10);
  } finally {
    host.dispose();
  }
});

for (const raw of ['3/4/30', ' 03/04/2030 ']) {
  test(`undo and redo restore the caret after formatting ${JSON.stringify(raw)}`, async () => {
    const host = open();
    try {
      host.enter(raw);
      const before = host.editor.surface!.state().selection;
      await host.editor.save();
      const after = host.editor.surface!.state().selection;
      expect(after.head.offset).toBe(10);
      host.editor.surface!.undo();
      expect(host.text()).toBe(`${raw} tail`);
      expect(host.editor.surface!.state().selection).toEqual(before);
      host.editor.surface!.redo();
      expect(host.editor.surface!.state().selection).toEqual(after);
    } finally {
      host.dispose();
    }
  });
}

test('a normal save captures its document before a later load', async () => {
  const host = open();
  try {
    host.enter('03/04/2030');
    const saved = host.editor.save();
    host.editor.load(formFieldDocx(true));
    host.editor.load(await saved);
    expect(host.text()).toBe('04/03/2030 tail');
  } finally {
    host.dispose();
  }
});

test('a save waiting for the active edit rejects if its document was replaced', async () => {
  const host = open();
  try {
    let pending: Promise<ArrayBuffer> | undefined;
    const off = host.editor.on('change', () => {
      pending ??= host.editor.save();
    });
    host.enter('03/04/2030');
    off();
    host.editor.load(formFieldDocx(true));
    await expect(pending!).rejects.toMatchObject({ code: 'invalidState' });
    expect(host.text()).toBe('01/02/2030 tail');
  } finally {
    host.dispose();
  }
});

test('a thrown change listener does not restore raw-input provenance onto a committed date', async () => {
  const host = open();
  try {
    host.enter('03/04/2030');
    const off = host.editor.on('change', () => {
      throw new Error('host callback failed');
    });
    await expect(host.editor.save()).rejects.toThrow('host callback failed');
    off();
    expect(host.text()).toBe('04/03/2030 tail');
    await host.editor.save();
    expect(host.text()).toBe('04/03/2030 tail');
  } finally {
    host.dispose();
  }
});

for (const remount of [false, true]) {
  test(`a thrown field-exit change listener preserves the committed date${remount ? ' across remount' : ''}`, async () => {
    const host = open();
    try {
      host.enter('03/04/2030');
      const off = host.editor.on('change', () => {
        throw new Error('host callback failed');
      });
      expect(() => host.select(13)).toThrow('host callback failed');
      off();
      expect(host.text()).toBe('04/03/2030 tail');
      if (remount) {
        host.editor.detach();
        host.editor.attach(host.container);
      }
      host.select(13);
      expect(host.editor.surface!.state().selection.head.offset).toBe(13);
      await host.editor.save();
      expect(host.text()).toBe('04/03/2030 tail');
      if (!remount) {
        host.editor.surface!.undo();
        expect(host.text()).toBe('03/04/2030 tail');
        await host.editor.save();
        expect(host.text()).toBe('04/03/2030 tail');
      }
    } finally {
      host.dispose();
    }
  });
}

for (const throws of [false, true]) {
  test(`a field-exit change listener can remount${throws ? ' and throw' : ''} without reinterpreting the date`, async () => {
    const host = open();
    try {
      host.enter('03/04/2030');
      const off = host.editor.on('change', () => {
        off();
        host.editor.detach();
        host.editor.attach(host.container);
        if (throws) throw new Error('host callback failed');
      });
      if (throws) expect(() => host.select(13)).toThrow('host callback failed');
      else host.select(13);
      expect(host.text()).toBe('04/03/2030 tail');
      await host.editor.save();
      expect(host.text()).toBe('04/03/2030 tail');
      host.select(13);
      expect(host.editor.surface!.state().selection.head.offset).toBe(13);
    } finally {
      host.dispose();
    }
  });
}

test('a refused save retains input provenance until editing resumes', async () => {
  const host = open();
  try {
    host.enter('03/04/2030');
    host.editor.setMode('view');
    await expect(host.editor.save()).rejects.toMatchObject({ code: 'locked' });
    expect(host.text()).toBe('03/04/2030 tail');
    host.editor.setLocale('en-US');
    host.editor.setMode('edit');
    await host.editor.save();
    expect(host.text()).toBe('04/03/2030 tail');
  } finally {
    host.dispose();
  }
});

test('empty history does not restore a stale save selection', async () => {
  const host = open();
  try {
    host.enter('3/4/30');
    await host.editor.save();
    host.editor.surface!.undo();
    host.editor.surface!.redo();
    host.select(3);
    const selected = host.editor.surface!.state().selection;
    const revision = host.editor.getDocumentHandle().revision;
    host.editor.surface!.redo();
    expect(host.editor.surface!.state().selection).toEqual(selected);
    expect(host.editor.getDocumentHandle().revision).toBe(revision);
    host.editor.surface!.undo();
    host.editor.surface!.undo();
    host.select(3);
    host.editor.surface!.undo();
    expect(host.editor.surface!.state().selection.head.offset).toBe(3);
  } finally {
    host.dispose();
  }
});
