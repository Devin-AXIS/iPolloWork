// DocxEditor.WatermarkDialog against the REAL engine: the Insert menu opens it, the form
// seeds from the document's watermark, Apply writes ONE setWatermark command (single undo
// step), No watermark removes it, and Cancel writes nothing.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorMenu } from '../src/editor/menu/index.ts';
import { DocxEditorWatermarkDialog } from '../src/editor/DocxEditorWatermark.tsx';

/** The `matrix(a b c d e f)` fit of a preview text transform. */
function fitOf(text: Element): number[] {
  const match = /matrix\(([^)]*)\)/.exec(text.getAttribute('transform') ?? '');
  return match ? match[1]!.split(' ').map(Number) : [];
}

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

const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function mount(children: ReactNode): {
  view: ReturnType<typeof render>;
  editor: () => DocxEditorInstance;
} {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      {children}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

async function click(element: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function change(element: Element, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(element, { target: { value } });
  });
}

/** A kind radio. Its option group shares the accessible name, so pick the input. */
function kind(view: ReturnType<typeof render>, name: string): HTMLInputElement {
  return view
    .getAllByLabelText(name)
    .find((node): node is HTMLInputElement => node instanceof HTMLInputElement)!;
}

const preview = (view: ReturnType<typeof render>) =>
  view.container.querySelector<HTMLElement>(
    '[data-docx-dialog="watermark"] [data-docx-part="preview"]'
  )!;

async function seededDialog(watermark: Parameters<DocxEditorInstance['exec']>[0] | null) {
  const { view, editor } = mount(null);
  await settle();
  if (watermark) {
    await act(async () => {
      editor().exec(watermark);
    });
  }
  let closed = 0;
  view.rerender(
    <DocxEditorRoot document={SOURCE}>
      <DocxEditorWatermarkDialog open onClose={() => (closed += 1)} />
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  await settle();
  return { view, editor, closed: () => closed };
}

afterEach(() => {
  cleanup();
});

describe('DocxEditor.WatermarkDialog', () => {
  test('the Insert menu opens the dialog, and Apply sets a text watermark in one undo step', async () => {
    const { view, editor } = mount(<DocxEditorMenu />);
    await settle();
    const trigger = [
      ...view.container.querySelectorAll<HTMLButtonElement>('.docx-menubar__trigger'),
    ].find((button) => button.textContent === 'Insert')!;
    await click(trigger);
    const row = view.container.querySelector<HTMLElement>('[data-slot="insert.watermark"]')!;
    expect(row.getAttribute('aria-disabled')).not.toBe('true');
    await click(row);
    const dialog = view.getByRole('dialog', { name: 'Watermark' });
    expect(dialog.getAttribute('data-docx-dialog')).toBe('watermark');

    // No watermark yet: the first choice is selected and the text controls are disabled.
    expect((kind(view, 'No watermark') as HTMLInputElement).checked).toBe(true);
    expect((view.getByLabelText('Text') as HTMLInputElement).disabled).toBe(true);

    await click(kind(view, 'Text watermark'));
    expect((view.getByLabelText('Text') as HTMLInputElement).disabled).toBe(false);
    await change(view.getByLabelText('Text'), 'CONFIDENTIAL');
    await change(view.getByLabelText('Size'), '72');
    await click(view.getByLabelText('Bold'));
    await change(view.getAllByLabelText('Transparency')[0]!, '25');
    await change(view.getByLabelText('Color'), '#ff0000');
    await click(view.getByLabelText('Horizontal'));
    await click(view.getByText('Apply'));

    expect(view.queryByRole('dialog', { name: 'Watermark' })).toBeNull();
    expect(editor().getWatermark()).toMatchObject({
      kind: 'text',
      text: 'CONFIDENTIAL',
      fontSizePt: 72,
      bold: true,
      italic: false,
      color: 'FF0000',
      layout: 'horizontal',
    });
    expect(editor().getWatermark()!.transparency).toBeCloseTo(0.25, 2);

    await act(async () => {
      editor().exec({ type: 'undo' });
    });
    expect(editor().getWatermark()).toBeNull();
  });

  test('seeds from the existing watermark, and No watermark removes it', async () => {
    const { view, editor } = mount(null);
    await settle();
    await act(async () => {
      editor().exec({
        type: 'setWatermark',
        watermark: { text: 'SAMPLE', italic: true, layout: 'horizontal', fontSizePt: 54 },
      });
    });
    let closed = false;
    view.rerender(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorWatermarkDialog open onClose={() => (closed = true)} />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await settle();
    expect((kind(view, 'Text watermark') as HTMLInputElement).checked).toBe(true);
    expect((view.getByLabelText('Text') as HTMLInputElement).value).toBe('SAMPLE');
    expect((view.getByLabelText('Italic') as HTMLInputElement).checked).toBe(true);
    expect((view.getByLabelText('Size') as HTMLSelectElement).value).toBe('54');
    expect((view.getByLabelText('Horizontal') as HTMLInputElement).checked).toBe(true);

    await click(kind(view, 'No watermark'));
    await click(view.getByText('Apply'));
    expect(closed).toBe(true);
    expect(editor().getWatermark()).toBeNull();
  });

  test('Cancel writes nothing', async () => {
    let closed = false;
    const { view, editor } = mount(
      <DocxEditorWatermarkDialog open onClose={() => (closed = true)} />
    );
    await settle();
    const before = editor().getDocumentHandle().revision;
    await click(kind(view, 'Text watermark'));
    await change(view.getByLabelText('Text'), 'URGENT');
    await click(view.getByText('Cancel'));
    expect(closed).toBe(true);
    expect(editor().getDocumentHandle().revision).toBe(before);
    expect(editor().getWatermark()).toBeNull();
  });

  test('a chosen picture applies as a picture watermark with washout and scale', async () => {
    const { view, editor } = mount(<DocxEditorWatermarkDialog open onClose={() => {}} />);
    await settle();
    await click(kind(view, 'Picture watermark'));
    // Apply waits for a picture.
    expect((view.getByText('Apply') as HTMLButtonElement).disabled).toBe(true);
    const input = view.container.querySelector<HTMLInputElement>(
      '[data-docx-dialog="watermark"] input[type="file"]'
    )!;
    const file = new File([PNG_1X1], 'logo.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(view.container.textContent).toContain('logo.png');
    await change(view.getByLabelText('Scale'), '2');
    await click(view.getByLabelText('Washout'));
    await click(view.getByText('Apply'));
    expect(editor().getWatermark()).toMatchObject({ kind: 'image', washout: false });
    const full = editor().query({ type: 'watermark' });
    expect(full?.imageData?.length).toBeGreaterThan(0);
  });

  test('custom presets fill the preset select, and typed text shows Custom', async () => {
    const { view } = mount(
      <DocxEditorWatermarkDialog open onClose={() => {}} presets={['INTERNAL', 'PUBLIC']} />
    );
    await settle();
    const select = view.getByLabelText('Preset') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Custom',
      'INTERNAL',
      'PUBLIC',
    ]);
    expect(select.disabled).toBe(true);
    await click(kind(view, 'Text watermark'));
    // The default text is not one of these presets.
    expect(select.value).toBe('');
    await change(select, 'PUBLIC');
    expect((view.getByLabelText('Text') as HTMLInputElement).value).toBe('PUBLIC');
    expect(select.value).toBe('PUBLIC');
    await change(view.getByLabelText('Text'), 'PUBLIC v2');
    expect(select.value).toBe('');
    expect(select.selectedOptions[0]!.textContent).toBe('Custom');
  });

  test('the preview draws the draft and follows every field', async () => {
    const { view } = mount(<DocxEditorWatermarkDialog open onClose={() => {}} />);
    await settle();
    const part = preview(view);
    expect(part.getAttribute('aria-hidden')).toBe('true');
    expect(part.querySelector('[data-docx-watermark-preview]')).toBeNull();

    await click(kind(view, 'Text watermark'));
    let text = part.querySelector('[data-docx-watermark-preview="text"]')!;
    expect(text.textContent).toBe('DRAFT');
    expect(text.getAttribute('fill')).toBe('#C0C0C0');
    expect(text.getAttribute('fill-opacity')).toBe('0.5');
    expect(text.getAttribute('transform')).toContain('rotate(-45');
    expect(fitOf(text)).toHaveLength(6);

    await change(view.getByLabelText('Text'), 'SECRET');
    await change(view.getByLabelText('Color'), '#ff0000');
    await change(view.getAllByLabelText('Transparency')[0]!, '25');
    await click(view.getByLabelText('Bold'));
    await click(view.getByLabelText('Horizontal'));
    text = part.querySelector('[data-docx-watermark-preview="text"]')!;
    expect(text.textContent).toBe('SECRET');
    expect(text.getAttribute('fill')).toBe('#FF0000');
    expect(text.getAttribute('fill-opacity')).toBe('0.75');
    expect(text.getAttribute('font-weight')).toBe('bold');
    expect(text.getAttribute('transform')).not.toContain('rotate');

    // The preview uses the page's box rule. Auto fills the 6.5 inch text area of a Letter
    // page, so the box starts at the 72 point margin and the ink at the 7.2 point inset.
    // A fixed 72 point size is a 79.2 point estimated advance centered on the page.
    await change(view.getByLabelText('Text'), 'xd');
    text = part.querySelector('[data-docx-watermark-preview="text"]')!;
    expect(text.textContent).toBe('xd');
    expect(fitOf(text)[4]).toBeCloseTo(79.2, 3);
    await change(view.getByLabelText('Size'), '72');
    text = part.querySelector('[data-docx-watermark-preview="text"]')!;
    expect(fitOf(text)[4]).toBeCloseTo(273.6, 3);

    await click(kind(view, 'No watermark'));
    expect(part.querySelector('[data-docx-watermark-preview]')).toBeNull();
  });

  test('Select picture is enabled for any kind, and a chosen file switches to Picture', async () => {
    const { view } = mount(<DocxEditorWatermarkDialog open onClose={() => {}} />);
    await settle();
    await click(kind(view, 'Text watermark'));
    const select = view.getByText('Select picture…') as HTMLButtonElement;
    expect(select.disabled).toBe(false);
    expect((view.getByLabelText('Scale') as HTMLSelectElement).disabled).toBe(true);
    expect((view.getByLabelText('Washout') as HTMLInputElement).disabled).toBe(true);

    const input = view.container.querySelector<HTMLInputElement>(
      '[data-docx-dialog="watermark"] input[type="file"]'
    )!;
    const file = new File([PNG_1X1], 'logo.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(kind(view, 'Picture watermark').checked).toBe(true);
    expect((view.getByLabelText('Scale') as HTMLSelectElement).disabled).toBe(false);
    const picture = preview(view).querySelector<SVGImageElement>(
      '[data-docx-watermark-preview="picture"]'
    )!;
    expect(picture.getAttribute('href')).toMatch(/^blob:/);
    expect(picture.style.filter).toContain('brightness');
    // Auto fits the picture to the text area; a scale multiplies its natural size.
    expect(
      preview(view).querySelector('[data-docx-watermark-preview="picture"]')!.getAttribute('width')
    ).toBe('468');
    await change(view.getByLabelText('Scale'), '2');
    expect(
      preview(view).querySelector('[data-docx-watermark-preview="picture"]')!.getAttribute('width')
    ).toBe('1.5');
    await click(view.getByLabelText('Washout'));
    expect(
      preview(view).querySelector<SVGImageElement>('[data-docx-watermark-preview="picture"]')!.style
        .filter
    ).toBe('');

    // The button alone switches the kind too.
    await click(kind(view, 'Text watermark'));
    await click(select);
    expect(kind(view, 'Picture watermark').checked).toBe(true);
  });

  test('initial focus lands on the checked kind', async () => {
    const { view } = await seededDialog({
      type: 'setWatermark',
      watermark: { text: 'SAMPLE' },
    });
    expect(document.activeElement).toBe(kind(view, 'Text watermark'));
  });

  test('an unchanged Apply closes without writing', async () => {
    const { view, editor, closed } = await seededDialog({
      type: 'setWatermark',
      watermark: { text: 'SAMPLE', italic: true },
    });
    const before = editor().getDocumentHandle().revision;
    await click(view.getByText('Apply'));
    expect(closed()).toBe(1);
    expect(editor().getDocumentHandle().revision).toBe(before);
    // One undo removes the watermark: the Apply added no empty step on top of it.
    await act(async () => {
      editor().exec({ type: 'undo' });
    });
    expect(editor().getWatermark()).toBeNull();
  });

  test('No watermark on a document without one applies as no change', async () => {
    const { view, editor, closed } = await seededDialog(null);
    const before = editor().getDocumentHandle().revision;
    await click(view.getByText('Apply'));
    expect(closed()).toBe(1);
    expect(editor().getDocumentHandle().revision).toBe(before);
    expect(editor().snapshot().canUndo ?? false).toBe(false);
  });
});
