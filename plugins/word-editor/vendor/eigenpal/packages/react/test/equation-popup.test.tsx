import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorEquation } from '../src/editor/DocxEditorEquation.tsx';
import {
  DocxEditor as PublicDocxEditor,
  DocxEditorEquation as PublicDocxEditorEquation,
} from '../src/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function equationDocument(equation: string): Uint8Array {
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
      `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body><w:p>${equation}</w:p></w:body></w:document>`
    ),
  });
}

const SOURCE = equationDocument(
  '<m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e>' +
    '<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>'
);
const REPLACEMENT_SOURCE = equationDocument('<m:oMath><m:r><m:t>y</m:t></m:r></m:oMath>');
// Without m:chr the n-ary operator is an integral, which compact text cannot spell.
const INTEGRAL_SOURCE = equationDocument(
  '<m:oMath><m:nary><m:naryPr/><m:sub><m:r><m:t>a</m:t></m:r></m:sub>' +
    '<m:sup><m:r><m:t>b</m:t></m:r></m:sup><m:e><m:r><m:t>y</m:t></m:r></m:e></m:nary></m:oMath>'
);

interface Mounted {
  readonly view: ReturnType<typeof render>;
  editor(): DocxEditorInstance;
}

function mount(mode: 'edit' | 'view' = 'edit', source = SOURCE): Mounted {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      mode={mode}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorEquation />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function open(mounted: Mounted): void {
  const equation = mounted.view.container.querySelector('[data-docx-equation]');
  if (!equation) throw new Error('no painted equation');
  fireEvent.click(equation);
}

afterEach(cleanup);

describe('default React equation popover', () => {
  test('is available from the public primitive and namespace', () => {
    expect(PublicDocxEditorEquation).toBe(DocxEditorEquation);
    expect(PublicDocxEditor.Equation).toBe(DocxEditorEquation);
  });

  test('mounts from the packaged sugar editor', async () => {
    const view = render(<PublicDocxEditor document={SOURCE} />);
    await tick();
    const equation = view.container.querySelector('[data-docx-equation]');
    if (!equation) throw new Error('no painted equation');
    fireEvent.click(equation);
    await tick();
    expect(view.queryByTestId('equation-popup')).not.toBeNull();
  });

  test('seeds the linear form and applies to the retained equation id', async () => {
    const mounted = mount();
    await tick();
    open(mounted);
    await tick();

    const input = mounted.view.getByTestId('equation-popup-input') as HTMLInputElement;
    expect(input.value).toBe('x^{2}');
    expect(mounted.editor().surface!.retainedSelection()).not.toBeNull();
    const equationId = mounted.editor().surface!.equations.equationAtCaret()!.id;

    fireEvent.change(input, { target: { value: '{a+b}/{2}' } });
    expect(fireEvent.mouseDown(mounted.view.getByTestId('equation-popup-apply'))).toBe(false);
    fireEvent.click(mounted.view.getByTestId('equation-popup-apply'));
    await tick();

    expect(mounted.view.queryByTestId('equation-popup')).toBeNull();
    expect(mounted.editor().surface!.retainedSelection()).toBeNull();
    expect(mounted.editor().surface!.equations.equationById(equationId)?.linear).toBe('{a+b}/{2}');
    expect(document.activeElement).toBe(mounted.view.container.querySelector('.docx-pages'));
  });

  test('describes apply errors and restores focus on Escape', async () => {
    const mounted = mount();
    await tick();
    open(mounted);
    await tick();

    const input = mounted.view.getByTestId('equation-popup-input');
    expect(input.getAttribute('aria-describedby')).toBeNull();
    fireEvent.change(mounted.view.getByTestId('equation-popup-input'), {
      target: { value: 'x^' },
    });
    fireEvent.click(mounted.view.getByTestId('equation-popup-apply'));
    const alert = mounted.view.getByRole('alert');
    expect(alert.textContent).toContain('could not be applied');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);

    fireEvent.keyDown(document, { key: 'Escape' });
    await tick();
    expect(mounted.view.queryByTestId('equation-popup')).toBeNull();
    expect(document.activeElement).toBe(mounted.view.container.querySelector('.docx-pages'));
  });

  test('closes on an outside click without restoring editor focus', async () => {
    const mounted = mount();
    await tick();
    open(mounted);
    await tick();
    const outside = document.createElement('button');
    mounted.view.container.append(outside);
    outside.focus();
    fireEvent.pointerDown(outside);
    expect(mounted.view.queryByTestId('equation-popup')).toBeNull();
    await tick();
    expect(document.activeElement).toBe(outside);
  });

  test('deletes the selected equation and closes', async () => {
    const mounted = mount();
    await tick();
    open(mounted);
    await tick();

    fireEvent.click(mounted.view.getByTestId('equation-popup-delete'));
    await tick();

    expect(mounted.view.queryByTestId('equation-popup')).toBeNull();
    expect(mounted.view.container.querySelector('[data-docx-equation]')).toBeNull();
    expect(document.activeElement).toBe(mounted.view.container.querySelector('.docx-pages'));
  });

  test('closes when the same editor loads a replacement document', async () => {
    const mounted = mount();
    await tick();
    open(mounted);
    await tick();
    fireEvent.change(mounted.view.getByTestId('equation-popup-input'), {
      target: { value: 'stale' },
    });

    mounted.editor().load(REPLACEMENT_SOURCE);
    await tick();

    expect(mounted.view.queryByTestId('equation-popup')).toBeNull();
    expect(mounted.editor().surface!.equations.equationAtCaret()?.linear).toBe('y');
  });

  test('closes when an external edit removes the active equation', async () => {
    const mounted = mount();
    await tick();
    open(mounted);
    await tick();
    const equationId = mounted.editor().surface!.equations.equationAtCaret()!.id;

    expect(mounted.editor().surface!.equations.removeEquation(equationId)).toBe(true);
    await tick();

    expect(mounted.view.queryByTestId('equation-popup')).toBeNull();
  });

  test('disables mutations with the localized viewing reason', async () => {
    const mounted = mount('view');
    await tick();
    open(mounted);
    await tick();

    expect((mounted.view.getByTestId('equation-popup-apply') as HTMLButtonElement).disabled).toBe(
      true
    );
    expect((mounted.view.getByTestId('equation-popup-delete') as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(mounted.view.getByTestId('equation-popup-disabled-reason').textContent).toContain(
      'open for viewing'
    );
  });

  test('explains why an equation without a linear form cannot be replaced', async () => {
    const mounted = mount('edit', INTEGRAL_SOURCE);
    await tick();
    open(mounted);
    await tick();

    expect((mounted.view.getByTestId('equation-popup-apply') as HTMLButtonElement).disabled).toBe(
      true
    );
    expect((mounted.view.getByTestId('equation-popup-delete') as HTMLButtonElement).disabled).toBe(
      false
    );
    expect(mounted.view.getByTestId('equation-popup-disabled-reason').textContent).toBe(
      'This equation has no linear form, so it cannot be replaced from text'
    );
  });

  test('does not apply Enter while an input method is composing', async () => {
    const mounted = mount();
    await tick();
    open(mounted);
    await tick();
    const equationId = mounted.editor().surface!.equations.equationAtCaret()!.id;
    const input = mounted.view.getByTestId('equation-popup-input');
    fireEvent.change(input, { target: { value: 'y' } });

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    expect(mounted.view.queryByTestId('equation-popup')).not.toBeNull();
    expect(mounted.editor().surface!.equations.equationById(equationId)?.linear).toBe('x^{2}');
  });

  test('removes document listeners when the popover unmounts', async () => {
    const mounted = mount();
    await tick();
    const ownerDocument = mounted.view.container.ownerDocument;
    const originalAdd = ownerDocument.addEventListener.bind(ownerDocument);
    const originalRemove = ownerDocument.removeEventListener.bind(ownerDocument);
    const added: Array<[string, unknown]> = [];
    const removed: Array<[string, unknown]> = [];
    ownerDocument.addEventListener = ((type: string, ...args: unknown[]) => {
      if (type === 'keydown' || type === 'pointerdown') added.push([type, args[0]]);
      return originalAdd(type, ...(args as [EventListenerOrEventListenerObject, boolean?]));
    }) as typeof ownerDocument.addEventListener;
    ownerDocument.removeEventListener = ((type: string, ...args: unknown[]) => {
      if (type === 'keydown' || type === 'pointerdown') removed.push([type, args[0]]);
      return originalRemove(type, ...(args as [EventListenerOrEventListenerObject, boolean?]));
    }) as typeof ownerDocument.removeEventListener;
    try {
      open(mounted);
      await tick();
      mounted.view.unmount();
      expect(added).toHaveLength(2);
      for (const [type, listener] of added) {
        expect(
          removed.filter(
            ([removedType, removedListener]) => removedType === type && removedListener === listener
          )
        ).toHaveLength(1);
      }
    } finally {
      ownerDocument.addEventListener = originalAdd as typeof ownerDocument.addEventListener;
      ownerDocument.removeEventListener =
        originalRemove as typeof ownerDocument.removeEventListener;
    }
  });
});
