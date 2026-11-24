import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { findNode, paragraphTextOf, textFormFieldsOf } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const field =
  '<w:bookmarkStart w:id="1" w:name="Input"/><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Input"/><w:textInput><w:default w:val="Sample"/></w:textInput></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Sample</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:bookmarkEnd w:id="1"/>';

function setup(protectedForm = false, wrapped = false, value = 'Sample', suffix = ' right') {
  const fieldXml = field.replaceAll('Sample', value);
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/settings" Target="settings.xml"/></Relationships>`
    ),
    'word/settings.xml': strToU8(
      `<w:settings xmlns:w="${W}">${protectedForm ? '<w:documentProtection w:edit="forms" w:enforcement="1"/>' : ''}</w:settings>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t xml:space="preserve">Left </w:t></w:r>${wrapped ? `<w:smartTag>${fieldXml}</w:smartTag>` : fieldXml}<w:r><w:t xml:space="preserve">${suffix}</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!result.ok) throw new Error(result.reason);
  const surface = result.surface;
  const paragraphId = surface.session.paragraphIds()[0]!;
  return {
    surface,
    pages: container.querySelector<HTMLElement>('.docx-pages')!,
    paragraphId,
    caret(offset: number) {
      const point = { paragraphId, offset };
      surface.setSelection({ anchor: point, head: point });
    },
    text: () => paragraphTextOf(surface.session.part(), paragraphId),
    fields: () => {
      const p = findNode(surface.session.part(), paragraphId);
      if (p?.kind !== 'paragraph') throw new Error('paragraph');
      return textFormFieldsOf(p);
    },
    cleanup() {
      surface.destroy();
      container.remove();
    },
  };
}

for (const backward of [true, false]) {
  for (const input of ['surface', 'keyboard', 'shift-keyboard', 'beforeinput'] as const) {
    test(`${input} ${backward ? 'Backspace' : 'Delete'} selects the boundary field before removing it`, () => {
      const host = setup();
      try {
        host.caret(backward ? 11 : 5);
        const press = () => {
          if (input === 'surface') {
            if (backward) host.surface.deleteBackward();
            else host.surface.deleteForward();
          } else if (input === 'keyboard' || input === 'shift-keyboard') {
            host.pages.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: backward ? 'Backspace' : 'Delete',
                shiftKey: input === 'shift-keyboard',
                bubbles: true,
                cancelable: true,
              })
            );
          } else {
            host.pages.dispatchEvent(
              new InputEvent('beforeinput', {
                inputType: backward ? 'deleteContentBackward' : 'deleteContentForward',
                bubbles: true,
                cancelable: true,
              })
            );
          }
        };
        press();
        expect(host.text()).toBe('Left Sample right');
        expect(host.fields()).toHaveLength(1);
        expect(host.surface.state().selection).toEqual({
          anchor: { paragraphId: host.paragraphId, offset: 5 },
          head: { paragraphId: host.paragraphId, offset: 11 },
        });
        press();
        expect(host.text()).toBe('Left  right');
        expect(host.fields()).toHaveLength(0);
        host.surface.undo();
        expect(host.text()).toBe('Left Sample right');
        expect(host.fields()).toHaveLength(1);
      } finally {
        host.cleanup();
      }
    });
  }
}

for (const backward of [true, false]) {
  test(`interior ${backward ? 'Backspace' : 'Delete'} remains a character edit like Word`, () => {
    const host = setup();
    try {
      host.caret(7);
      if (backward) host.surface.deleteBackward();
      else host.surface.deleteForward();
      expect(host.text()).toBe(backward ? 'Left Smple right' : 'Left Saple right');
      expect(host.fields()).toHaveLength(1);
    } finally {
      host.cleanup();
    }
  });

  test(`protected ${backward ? 'Backspace' : 'Delete'} edits the result without selecting the definition`, () => {
    const host = setup(true);
    try {
      host.caret(backward ? 11 : 5);
      if (backward) host.surface.deleteBackward();
      else host.surface.deleteForward();
      expect(host.text()).toBe(backward ? 'Left Sampl right' : 'Left ample right');
      expect(host.fields()).toHaveLength(1);
      expect(host.fields()[0]?.defaultText).toBe('Sample');
    } finally {
      host.cleanup();
    }
  });
}

test('boundary selection also finds a field inside a transparent wrapper', () => {
  const host = setup(false, true);
  try {
    host.caret(11);
    host.surface.deleteBackward();
    expect(host.text()).toBe('Left Sample right');
    expect(host.surface.state().selection.anchor.offset).toBe(5);
    host.surface.deleteBackward();
    expect(host.text()).toBe('Left  right');
    expect(host.fields()).toHaveLength(0);
  } finally {
    host.cleanup();
  }
});

for (const action of ['Cancel', 'Escape', 'OK']) {
  test(`${action} restores field selection after native focus collapses the DOM range`, () => {
    const host = setup();
    try {
      const fieldSpan = host.pages.querySelector<HTMLElement>('[data-field-atom="form"]')!;
      fieldSpan.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      const dialog = host.pages.parentElement!.querySelector('dialog')!;
      expect(dialog).not.toBeNull();
      const originalFocus = host.pages.focus.bind(host.pages);
      host.pages.focus = (options) => {
        originalFocus(options);
        const text = host.pages.querySelector('[data-start="0"]')!.firstChild!;
        document.getSelection()!.setBaseAndExtent(text, 0, text, 0);
      };
      if (action === 'OK') dialog.querySelector('input')!.value = 'Updated';
      if (action === 'Escape') dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      else
        [...dialog.querySelectorAll('button')]
          .find((button) => button.textContent === action)!
          .click();
      expect(dialog.isConnected).toBe(false);
      expect(document.getSelection()!.toString()).toBe(action === 'OK' ? 'Updated' : 'Sample');
      expect(host.surface.state().selection.anchor.offset).toBe(5);
      expect(host.surface.state().selection.head.offset).toBe(action === 'OK' ? 12 : 11);
    } finally {
      host.cleanup();
    }
  });
}

for (const backward of [true, false]) {
  for (const input of ['surface', 'alt-keyboard', 'ctrl-keyboard', 'beforeinput'] as const) {
    test(`${input} word deletion removes the complete multiword field ${backward ? 'backward' : 'forward'}`, () => {
      const host = setup(false, true, 'Several words');
      try {
        host.caret(backward ? 18 : 5);
        if (input === 'surface') {
          if (backward) host.surface.deleteWordBackward();
          else host.surface.deleteWordForward();
        } else if (input === 'beforeinput') {
          host.pages.dispatchEvent(
            new InputEvent('beforeinput', {
              inputType: backward ? 'deleteWordBackward' : 'deleteWordForward',
              bubbles: true,
              cancelable: true,
            })
          );
        } else {
          host.pages.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: backward ? 'Backspace' : 'Delete',
              altKey: input === 'alt-keyboard',
              ctrlKey: input === 'ctrl-keyboard',
              bubbles: true,
              cancelable: true,
            })
          );
        }
        expect(host.text()).toBe('Left  right');
        expect(host.fields()).toHaveLength(0);
        host.surface.undo();
        expect(host.text()).toBe('Left Several words right');
        expect(host.fields()).toHaveLength(1);
        host.surface.redo();
        expect(host.fields()).toHaveLength(0);
      } finally {
        host.cleanup();
      }
    });
  }

  test(`protected word deletion keeps the field definition ${backward ? 'backward' : 'forward'}`, () => {
    const host = setup(true, false, 'Several words');
    try {
      host.caret(backward ? 18 : 5);
      if (backward) host.surface.deleteWordBackward();
      else host.surface.deleteWordForward();
      expect(host.text()).toBe(backward ? 'Left Several  right' : 'Left  words right');
      expect(host.fields()).toHaveLength(1);
    } finally {
      host.cleanup();
    }
  });
}

test('word deletion removes attached outside text before deleting the field', () => {
  const host = setup(false, false, 'Several words', 'tail');
  try {
    host.caret(22);
    host.surface.deleteWordBackward();
    expect(host.text()).toBe('Left Several words');
    expect(host.fields()).toHaveLength(1);
    host.surface.deleteWordBackward();
    expect(host.text()).toBe('Left ');
    expect(host.fields()).toHaveLength(0);
  } finally {
    host.cleanup();
  }
});

test('word deletion inside a field remains a partial edit', () => {
  const host = setup(false, false, 'Several words');
  try {
    host.caret(12);
    host.surface.deleteWordBackward();
    expect(host.text()).toBe('Left  words right');
    expect(host.fields()).toHaveLength(1);
  } finally {
    host.cleanup();
  }
});
