// DocxEditor.PageSetupDialog against the REAL engine: the form seeds from the section,
// Apply writes ONE setPageSetup command (single undo step), orientation swaps the
// stored dimensions, and Cancel writes nothing.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorPageSetupDialog } from '../src/editor/DocxEditorPageSetup.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const PLAIN_SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');

function mountDialog(onClose: () => void = () => {}): {
  view: ReturnType<typeof render>;
  editor: () => DocxEditorInstance;
} {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={PLAIN_SOURCE}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorPageSetupDialog open onClose={onClose} />
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

afterEach(() => {
  cleanup();
});

describe('DocxEditor.PageSetupDialog', () => {
  test('seeds from the section and applies the form as one undo step', async () => {
    let closed = false;
    const { view, editor } = mountDialog(() => {
      closed = true;
    });
    const top = view.getByLabelText('Top') as HTMLInputElement;
    // Seeded from the document: Letter defaults, one-inch margins.
    expect(top.value).toBe('1');

    await act(async () => {
      fireEvent.change(top, { target: { value: '0.5' } });
      fireEvent.change(view.getByLabelText('Left'), { target: { value: '0.75' } });
    });
    await act(async () => {
      fireEvent.click(view.getByText('Apply'));
    });

    expect(closed).toBe(true);
    expect(editor().getPageSetup()!.marginsTwips).toEqual({
      top: 720,
      right: 1440,
      bottom: 1440,
      left: 1080,
    });
    // ONE command: a single undo restores both margins.
    await act(async () => {
      editor().exec({ type: 'undo' });
    });
    expect(editor().getPageSetup()!.marginsTwips).toEqual({
      top: 1440,
      right: 1440,
      bottom: 1440,
      left: 1440,
    });
  });

  test('switching orientation stores swapped dimensions', async () => {
    const { view, editor } = mountDialog();
    await act(async () => {
      fireEvent.change(view.getByLabelText('Orientation'), { target: { value: 'landscape' } });
    });
    await act(async () => {
      fireEvent.click(view.getByText('Apply'));
    });
    expect(editor().getPageSetup()).toMatchObject({
      pageWidthTwips: 15840,
      pageHeightTwips: 12240,
      orientation: 'landscape',
    });
  });

  test('a size preset applies its dimensions', async () => {
    const { view, editor } = mountDialog();
    await act(async () => {
      // Index 1 is A4 in the preset list.
      fireEvent.change(view.getByLabelText('Size'), { target: { value: '1' } });
    });
    await act(async () => {
      fireEvent.click(view.getByText('Apply'));
    });
    expect(editor().getPageSetup()).toMatchObject({
      pageWidthTwips: 11906,
      pageHeightTwips: 16838,
    });
  });

  test('a refused apply keeps the dialog OPEN instead of claiming success', async () => {
    let closed = false;
    const { view, editor } = mountDialog(() => {
      closed = true;
    });
    const before = editor().getDocumentHandle().revision;
    await act(async () => {
      // Each margin is individually legal; together they swallow a Letter page.
      fireEvent.change(view.getByLabelText('Left'), { target: { value: '8' } });
      fireEvent.change(view.getByLabelText('Right'), { target: { value: '8' } });
    });
    await act(async () => {
      fireEvent.click(view.getByText('Apply'));
    });
    expect(closed).toBe(false);
    expect(editor().getDocumentHandle().revision).toBe(before);
  });

  test('Apply to: this section writes only the caret section', async () => {
    const midBody = docx(
      '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
        '<w:r><w:t>first section</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>second section</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
    );
    let instance: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot
        document={midBody}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorPageSetupDialog open onClose={() => {}} />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    const editor = () => instance! as DocxEditorInstance;
    // Caret sits in the FIRST section (the default selection starts at the top).
    await act(async () => {
      fireEvent.change(view.getByLabelText('Apply to'), { target: { value: 'section' } });
      fireEvent.change(view.getByLabelText('Orientation'), { target: { value: 'landscape' } });
    });
    await act(async () => {
      fireEvent.click(view.getByText('Apply'));
    });
    // The caret's section is landscape; the tail section stayed portrait.
    expect(editor().getPageSetup()).toMatchObject({ orientation: 'landscape' });
    const second = editor().surface!.session.paragraphIds()[1]!;
    await act(async () => {
      editor().surface!.setSelection({
        anchor: { paragraphId: second, offset: 0 },
        head: { paragraphId: second, offset: 0 },
      });
    });
    expect(editor().getPageSetup()).toMatchObject({ orientation: 'portrait' });
  });

  test('Cancel writes nothing', async () => {
    let closed = false;
    const { view, editor } = mountDialog(() => {
      closed = true;
    });
    const before = editor().getDocumentHandle().revision;
    await act(async () => {
      fireEvent.change(view.getByLabelText('Top'), { target: { value: '2' } });
      fireEvent.click(view.getByText('Cancel'));
    });
    expect(closed).toBe(true);
    expect(editor().getDocumentHandle().revision).toBe(before);
  });
});
