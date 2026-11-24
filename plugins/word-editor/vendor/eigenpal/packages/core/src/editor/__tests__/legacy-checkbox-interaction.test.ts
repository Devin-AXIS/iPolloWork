// Legacy FORMCHECKBOX on the painted surface: the glyph is a real control with a hit target
// that toggles on a press and on Space, in edit mode and under forms protection, and refuses
// when the field is disabled.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

// Every surface registers document-level listeners; tear each one down so nothing leaks into
// the next test or, under the serial run, the next file.
const mounted: PaginatedSurface[] = [];
afterEach(() => {
  for (const surface of mounted.splice(0)) surface.destroy();
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function checkbox(name: string, inner: string, ffDataExtra = ''): string {
  return (
    `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="${name}"/>${ffDataExtra}` +
    `<w:checkBox>${inner}</w:checkBox></w:ffData></w:fldChar></w:r>` +
    `<w:bookmarkStart w:id="0" w:name="${name}"/>` +
    `<w:r><w:instrText xml:space="preserve"> FORMCHECKBOX </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r><w:bookmarkEnd w:id="0"/>`
  );
}

function docx(body: string, protectedForm: boolean): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries({
        '[Content_Types].xml':
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
        '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
        'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/settings" Target="settings.xml"/></Relationships>`,
        'word/settings.xml': `<w:settings xmlns:w="${W}">${protectedForm ? '<w:documentProtection w:edit="forms" w:enforcement="1"/>' : ''}</w:settings>`,
        'word/document.xml': `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
      }).map(([name, xml]) => [name, strToU8(xml)])
    )
  );
}

function mount(
  body: string,
  options: { protectedForm?: boolean; editingMode?: 'edit' | 'view' } = {}
): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  const result = mountPaginatedSurface(container, docx(body, options.protectedForm === true), {
    scale: 1,
    ...(options.editingMode ? { editingMode: options.editingMode } : {}),
  });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  mounted.push(result.surface);
  return { surface: result.surface, container };
}

const box = (container: HTMLElement): HTMLElement | null =>
  container.querySelector<HTMLElement>('[data-docx-form-checkbox]');

function press(node: HTMLElement): PointerEvent {
  const event = new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
  });
  node.dispatchEvent(event);
  return event;
}

const BODY = `<w:p><w:r><w:t xml:space="preserve">Tick: </w:t></w:r>${checkbox(
  'cb',
  '<w:size w:val="24"/><w:default w:val="0"/><w:checked w:val="0"/>'
)}<w:r><w:t xml:space="preserve"> done</w:t></w:r></w:p>`;

describe('legacy checkbox interaction', () => {
  test('paints the field as a checkbox control with a live hit target', () => {
    const { container } = mount(BODY);
    const control = box(container)!;
    expect(control).not.toBeNull();
    expect(control.getAttribute('role')).toBe('checkbox');
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(control.dataset.checked).toBe('false');
    expect(control.dataset.fieldAtom).toBe('form');
    // Projected atoms are inert by default; this one must take the press.
    expect(control.style.pointerEvents).not.toBe('none');
    expect(control.style.cursor).toBe('pointer');
  });

  test('a press toggles w:checked in edit mode and selects the field', () => {
    const { surface, container } = mount(BODY);
    const event = press(box(container)!);
    expect(event.defaultPrevented).toBe(true);
    expect(box(container)!.dataset.checked).toBe('true');
    expect(box(container)!.getAttribute('aria-checked')).toBe('true');
    const selection = surface.state().selection;
    expect(Math.min(selection.anchor.offset, selection.head.offset)).toBe(6);
    expect(Math.max(selection.anchor.offset, selection.head.offset)).toBe(7);
    press(box(container)!);
    expect(box(container)!.dataset.checked).toBe('false');
  });

  test('a press returns keyboard focus from chrome to the selected field', () => {
    const { container } = mount(BODY);
    const toolbarButton = document.createElement('button');
    document.body.append(toolbarButton, container);
    try {
      toolbarButton.focus();
      press(box(container)!);
      const editable = container.querySelector<HTMLElement>('[contenteditable="true"]')!;
      expect(document.activeElement).toBe(editable);
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' })
      );
      expect(box(container)!.dataset.checked).toBe('false');
    } finally {
      toolbarButton.remove();
      container.remove();
    }
  });

  test('a press toggles under forms protection, where filling is the only edit', () => {
    const { container } = mount(BODY, { protectedForm: true });
    press(box(container)!);
    expect(box(container)!.dataset.checked).toBe('true');
    // The press left the field selected, so Space flips it again.
    const editable = container.querySelector<HTMLElement>('[contenteditable="true"]') ?? container;
    const keydown = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' });
    editable.dispatchEvent(keydown);
    expect(keydown.defaultPrevented).toBe(true);
    expect(box(container)!.dataset.checked).toBe('false');
  });

  test('Space toggles the selected field and is otherwise left to typing', () => {
    const { surface, container } = mount(BODY);
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 6 },
      head: { paragraphId, offset: 7 },
    });
    const editable = container.querySelector<HTMLElement>('[contenteditable="true"]') ?? container;
    const onField = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' });
    editable.dispatchEvent(onField);
    expect(onField.defaultPrevented).toBe(true);
    expect(box(container)!.dataset.checked).toBe('true');

    surface.setSelection({
      anchor: { paragraphId, offset: 2 },
      head: { paragraphId, offset: 2 },
    });
    const inText = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' });
    editable.dispatchEvent(inText);
    expect(box(container)!.dataset.checked).toBe('true');
  });

  test('a disabled field and a viewing document refuse the toggle', () => {
    const disabled = mount(
      `<w:p>${checkbox('off', '<w:default w:val="0"/>', '<w:enabled w:val="0"/>')}</w:p>`
    );
    press(box(disabled.container)!);
    expect(box(disabled.container)!.dataset.checked).toBe('false');

    const viewing = mount(BODY, { editingMode: 'view' });
    press(box(viewing.container)!);
    expect(box(viewing.container)!.dataset.checked).toBe('false');
  });

  test('suggesting refuses the toggle with a reason instead of writing it untracked', () => {
    const { surface, container } = mount(BODY);
    surface.setAuthor('Reviewer');
    surface.setEditingMode('suggest');
    const event = press(box(container)!);
    // The press is the control's: it does not fall through to a caret press.
    expect(event.defaultPrevented).toBe(true);
    expect(box(container)!.dataset.checked).toBe('false');
    expect(surface.state().lastRejection).toContain('suggesting cannot change');
  });
});
