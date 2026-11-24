import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { formFieldDocx } from './form-field-docx.fixture.ts';

// A filler part defers the mount without adding expensive layout content.
function largeFormDocx(): Uint8Array {
  const entries = unzipSync(formFieldDocx(true));
  const filler = new Uint8Array(530 * 1024);
  let seed = 123456789;
  for (let index = 0; index < filler.length; index++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    filler[index] = seed & 255;
  }
  entries['word/media/filler.bin'] = filler;
  entries['[Content_Types].xml'] = strToU8(
    strFromU8(entries['[Content_Types].xml']!).replace(
      '</Types>',
      '<Default Extension="bin" ContentType="application/octet-stream"/></Types>'
    )
  );
  return zipSync(entries);
}

const LARGE_FORM = largeFormDocx();

function container(): HTMLDivElement {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

function enter(editor: DocxEditorInstance, text: string): void {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 10 },
  });
  surface.pasteRich(text, null);
}

for (const deferred of [false, true]) {
  for (const move of ['detach', 'attach'] as const) {
    for (const input of ['03/04/2030', 'invalid']) {
      test(`${move} preserves ${JSON.stringify(input)} across a move of a ${deferred ? 'large' : 'small'} document`, async () => {
        const first = container();
        const second = container();
        const editor = createDocxEditor({
          container: first,
          document: deferred ? LARGE_FORM : formFieldDocx(true),
          locale: 'en-GB',
        });
        try {
          await editor.save(); // Flush an initial deferred mount.
          enter(editor, input);
          editor.setLocale('en-US');
          if (move === 'detach') editor.detach();
          editor.attach(second);
          // A move is not a remount: nothing reopens, the live input travels with the pages.
          expect(editor.snapshot().isOpening).toBe(false);
          if (deferred) {
            editor.detach();
            editor.attach(first);
            expect(editor.snapshot().isOpening).toBe(false);
          }
          if (input === 'invalid') {
            await expect(editor.save()).rejects.toMatchObject({ code: 'invalidArgs' });
            expect(editor.surface!.session.bodyText()).toBe('invalid tail');
            expect(document.querySelector('dialog')).toBeNull();
          } else {
            const bytes = await editor.save();
            editor.load(bytes);
            await editor.save();
            expect(editor.surface!.session.bodyText()).toBe('04/03/2030 tail');
          }
        } finally {
          editor.destroy();
          first.remove();
          second.remove();
        }
      });
    }
  }
}

for (const scheduled of [false, true]) {
  test(`a ${scheduled ? 'scheduled' : 'detached'} replacement clears the previous form input`, async () => {
    const first = container();
    const second = container();
    const editor = createDocxEditor({
      container: first,
      document: formFieldDocx(true),
      locale: 'en-GB',
    });
    try {
      enter(editor, '03/04/2030');
      if (!scheduled) editor.detach();
      editor.load(scheduled ? LARGE_FORM : formFieldDocx(true));
      if (scheduled) {
        expect(editor.snapshot().isOpening).toBe(true);
        editor.detach();
      }
      editor.attach(second);
      await editor.save();
      expect(editor.surface!.session.bodyText()).toBe('01/02/2030 tail');
    } finally {
      editor.destroy();
      first.remove();
      second.remove();
    }
  });
}

test('destroying a moved editor clears input before another editor uses its container', async () => {
  const element = container();
  const editor = createDocxEditor({ container: element, document: LARGE_FORM, locale: 'en-GB' });
  try {
    await editor.save();
    enter(editor, 'invalid');
    editor.detach();
    editor.attach(element);
    expect(editor.snapshot().isOpening).toBe(false);
  } finally {
    editor.destroy();
  }
  const replacement = createDocxEditor({
    container: element,
    document: formFieldDocx(true),
    locale: 'en-GB',
  });
  try {
    await replacement.save();
    expect(replacement.surface!.session.bodyText()).toBe('01/02/2030 tail');
  } finally {
    replacement.destroy();
    element.remove();
  }
});
