// The Left-to-right and Right-to-left toolbar buttons, against the real engine.
//
// What these pin down: the buttons remain available as named parts, a press
// writes the paragraph base direction (`w:bidi`), and `aria-pressed` follows the caret
// from a right-to-left paragraph to a left-to-right one.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { ar, en, es, he } from '@docx-editor.dev/i18n';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { LocaleProvider } from '../src/i18n/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const p = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function mount(toolbar: ReactNode, body: string) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={docx(body)}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      {toolbar}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

const button = (view: ReturnType<typeof render>, label: string): HTMLButtonElement => {
  const found = view.container.querySelector(`button[aria-label=${JSON.stringify(label)}]`);
  if (!found) throw new Error(`no toolbar button labelled ${label}`);
  return found as HTMLButtonElement;
};

const caretIn = (editor: DocxEditorInstance, index: number): void => {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 1 },
    head: { paragraphId, offset: 1 },
  });
};

afterEach(cleanup);

describe('the paragraph direction buttons', () => {
  test('the default toolbar omits direction shortcuts', () => {
    const { view } = mount(<DocxEditorToolbar />, p('alpha'));
    expect(
      view.container.querySelector('button[aria-label="' + en.toolbar.leftToRight + '"]')
    ).toBeNull();
    expect(
      view.container.querySelector('button[aria-label="' + en.toolbar.rightToLeft + '"]')
    ).toBeNull();
  });

  test('explicit direction controls write w:bidi and read back pressed', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar>
        <DocxEditorToolbar.LeftToRight />
        <DocxEditorToolbar.RightToLeft />
      </DocxEditorToolbar>,
      p('alpha')
    );
    await act(async () => {
      caretIn(editor(), 0);
    });
    const rtl = button(view, en.toolbar.rightToLeft);
    const ltr = button(view, en.toolbar.leftToRight);
    expect(rtl.disabled).toBe(false);
    expect(rtl.getAttribute('aria-pressed')).toBe('false');
    expect(ltr.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      rtl.click();
    });
    expect(editor().snapshot().formatting?.direction).toBe('rtl');
    expect(serializeOoxmlPart(editor().surface!.session.part())).toContain('<w:bidi');
    expect(rtl.getAttribute('aria-pressed')).toBe('true');
    expect(ltr.getAttribute('aria-pressed')).toBe('false');
  });

  test('the pressed state follows the caret between paragraphs of each direction', async () => {
    const { view, editor } = mount(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.LeftToRight />
        <DocxEditorToolbar.RightToLeft />
      </DocxEditorToolbar>,
      p('one', '<w:bidi/>') + p('two')
    );
    const rtl = button(view, en.toolbar.rightToLeft);
    const ltr = button(view, en.toolbar.leftToRight);

    await act(async () => {
      caretIn(editor(), 0);
    });
    expect(rtl.getAttribute('aria-pressed')).toBe('true');
    expect(ltr.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      caretIn(editor(), 1);
    });
    expect(rtl.getAttribute('aria-pressed')).toBe('false');
    expect(ltr.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('a right-to-left interface language', () => {
  test('the default toolbar shows the direction buttons after alignment', () => {
    const { view } = mount(
      <LocaleProvider i18n={ar}>
        <DocxEditorToolbar />
      </LocaleProvider>,
      p('alpha')
    );
    const rtl = button(view, ar.toolbar!.rightToLeft!);
    const ltr = button(view, ar.toolbar!.leftToRight!);
    const alignment = view.container.querySelector('[data-slot="alignment"]')!;
    expect(alignment.compareDocumentPosition(ltr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ltr.compareDocumentPosition(rtl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('composed chrome parts mirror under the provider without a wrapper', () => {
    const { view } = mount(
      <LocaleProvider i18n={ar}>
        <DocxEditorToolbar />
      </LocaleProvider>,
      p('alpha')
    );
    expect(view.container.querySelector('.docx-toolbar')!.getAttribute('dir')).toBe('rtl');
  });

  test('the provider dir prop decides over the catalog', () => {
    const { view } = mount(
      <LocaleProvider i18n={es} dir="rtl">
        <DocxEditorToolbar />
      </LocaleProvider>,
      p('alpha')
    );
    expect(view.container.querySelector('.docx-toolbar')!.getAttribute('dir')).toBe('rtl');
    expect(button(view, es.toolbar!.rightToLeft!)).toBeDefined();
  });

  test('a left-to-right provider leaves chrome parts without dir', () => {
    const { view } = mount(<DocxEditorToolbar />, p('alpha'));
    expect(view.container.querySelector('.docx-toolbar')!.hasAttribute('dir')).toBe(false);
  });

  test('the packaged editor mirrors its chrome for Arabic and Hebrew', () => {
    for (const catalog of [ar, he]) {
      const view = render(<DocxEditor document={docx(p('alpha'))} i18n={catalog} />);
      expect(view.container.querySelector('.docx-editor')!.getAttribute('dir')).toBe('rtl');
      cleanup();
    }
  });

  test('a left-to-right catalog leaves the host direction in charge', () => {
    const view = render(<DocxEditor document={docx(p('alpha'))} i18n={es} />);
    expect(view.container.querySelector('.docx-editor')!.hasAttribute('dir')).toBe(false);
  });
});
