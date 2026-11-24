import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { sha256FontBytes } from '../../layout/index.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { formFieldDocx } from './form-field-docx.fixture.ts';

const fontBytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);

function open(bytes = formFieldDocx(true)) {
  const container = document.createElement('div');
  document.body.append(container);
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const editor = createDocxEditor({
    container,
    document: bytes,
    locale: 'en-GB',
    fonts: async () => {
      await ready;
      return {
        sources: [
          {
            request: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
            id: 'form-remount-dejavu',
            bytes: fontBytes,
            hash: sha256FontBytes(fontBytes),
            faceIndex: 0,
          },
        ],
      };
    },
  });
  return {
    container,
    editor,
    async resolveFonts() {
      const previous = editor.surface;
      release();
      for (let attempt = 0; attempt < 200 && editor.fontMeasurement().resolving; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(editor.fontMeasurement().measurer).toBe('shaped');
      expect(editor.surface).toBe(previous);
    },
    dispose() {
      release();
      editor.destroy();
      container.remove();
    },
  };
}

function enterDate(editor: DocxEditorInstance, text: string) {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 10 } });
  surface.pasteRich(text, null);
}

function leaveField(editor: DocxEditorInstance) {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  const position = { paragraphId, offset: surface.session.bodyText().length - 1 };
  surface.setSelection({ anchor: position, head: position });
}

for (const changeLocale of [false, true]) {
  test(`font remount preserves pending date input (locale changed: ${changeLocale})`, async () => {
    const { editor, resolveFonts, dispose } = open();
    try {
      enterDate(editor, '03/04/2030'); // April 3 in en-GB; stored picture is MM/dd/yyyy.
      if (changeLocale) editor.setLocale('en-US');
      await resolveFonts();
      leaveField(editor);
      expect(editor.surface!.session.bodyText()).toBe('04/03/2030 tail');
      const saved = editor.surface!.session.save();
      editor.load(saved);
      expect(editor.surface!.session.bodyText()).toBe('04/03/2030 tail');
    } finally {
      dispose();
    }
  });
}

test('font remount preserves date input when an earlier field changes serialized node IDs', async () => {
  const entries = unzipSync(formFieldDocx(true));
  const xml = strFromU8(entries['word/document.xml']!);
  const dateField = xml.match(/<w:p>(.*?)<w:r><w:t xml:space=/)![1]!;
  const emptyField = dateField
    .replace('w:val="Date"', 'w:val="Empty"')
    .replace('w:val="date"', 'w:val="regular"')
    .replace('<w:r><w:t>01/02/2030</w:t></w:r>', '')
    .replace('<w:format w:val="MM/dd/yyyy"/>', '');
  entries['word/document.xml'] = strToU8(
    xml.replace('<w:p>', `<w:p>${emptyField}<w:r><w:t xml:space="preserve"> and </w:t></w:r>`)
  );
  const { editor, resolveFonts, dispose } = open(zipSync(entries));
  try {
    const surface = editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    const start = { paragraphId, offset: 0 };
    surface.setSelection({ anchor: start, head: start });
    surface.pasteRich('A', null);
    surface.setSelection({ anchor: { paragraphId, offset: 6 }, head: { paragraphId, offset: 16 } });
    surface.pasteRich('03/04/2030', null);
    await resolveFonts();
    leaveField(editor);
    expect(editor.surface!.session.bodyText()).toBe('A and 04/03/2030 tail');
  } finally {
    dispose();
  }
});

test('font remount preserves invalid date validation', async () => {
  const { container, editor, resolveFonts, dispose } = open();
  try {
    enterDate(editor, 'invalid');
    await resolveFonts();
    leaveField(editor);
    expect(container.querySelector('dialog[role="alertdialog"]')).not.toBeNull();
    expect(editor.surface!.session.bodyText()).toBe('invalid tail');
  } finally {
    dispose();
  }
});

test('font remount does not reinterpret a date whose edit was undone', async () => {
  const { editor, resolveFonts, dispose } = open();
  try {
    enterDate(editor, '03/04/2030');
    editor.surface!.undo();
    await resolveFonts();
    leaveField(editor);
    expect(editor.surface!.session.bodyText()).toBe('01/02/2030 tail');
  } finally {
    dispose();
  }
});

test('undo after a remount restores the pending date and its input locale', async () => {
  const { editor, resolveFonts, dispose } = open();
  try {
    enterDate(editor, '03/04/2030');
    editor.setLocale('en-US');
    await resolveFonts();
    leaveField(editor);
    expect(editor.surface!.session.bodyText()).toBe('04/03/2030 tail');
    editor.surface!.undo();
    expect(editor.surface!.session.bodyText()).toBe('03/04/2030 tail');
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 10 },
    });
    leaveField(editor);
    expect(editor.surface!.session.bodyText()).toBe('04/03/2030 tail');
  } finally {
    dispose();
  }
});

test('loading another document clears pending date input before fonts resolve', async () => {
  const { editor, resolveFonts, dispose } = open();
  try {
    enterDate(editor, '03/04/2030');
    editor.load(formFieldDocx(true));
    await resolveFonts();
    leaveField(editor);
    expect(editor.surface!.session.bodyText()).toBe('01/02/2030 tail');
  } finally {
    dispose();
  }
});
