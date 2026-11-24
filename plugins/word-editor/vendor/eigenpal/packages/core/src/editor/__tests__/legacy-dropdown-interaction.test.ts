// Legacy dropdowns use native selects without changing the painted document text.

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

function dropdown(enabled = ''): string {
  return `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Color"/>${enabled}<w:ddList><w:result w:val="1"/><w:listEntry w:val="Red"/><w:listEntry w:val="Green"/><w:listEntry w:val="Blue"/></w:ddList></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMDROPDOWN </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Green</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
}

function docx(body: string, protection: 'forms' | 'comments' | 'readOnly' | null): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries({
        '[Content_Types].xml':
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
        '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
        'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/settings" Target="settings.xml"/></Relationships>`,
        'word/settings.xml': `<w:settings xmlns:w="${W}">${protection ? `<w:documentProtection w:edit="${protection}" w:enforcement="1"/>` : ''}</w:settings>`,
        'word/document.xml': `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
      }).map(([name, xml]) => [name, strToU8(xml)])
    )
  );
}

function mount(
  body: string,
  options: {
    protectedForm?: boolean;
    protection?: 'comments' | 'readOnly';
    editingMode?: 'edit' | 'view' | 'suggest';
  } = {}
): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  const result = mountPaginatedSurface(
    container,
    docx(body, options.protection ?? (options.protectedForm ? 'forms' : null)),
    {
      scale: 1,
      ...(options.editingMode ? { editingMode: options.editingMode } : {}),
    }
  );
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  mounted.push(result.surface);
  return { surface: result.surface, container };
}

const select = (container: HTMLElement) =>
  container.querySelector<HTMLSelectElement>('select[data-docx-form-dropdown]')!;
const body = (enabled = '') =>
  `<w:p><w:r><w:t>Color: </w:t></w:r>${dropdown(enabled)}<w:r><w:t> tail</w:t></w:r></w:p>`;
function choose(control: HTMLSelectElement, index: number) {
  control.selectedIndex = index;
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('legacy dropdown interaction', () => {
  test('paints a native select and changing it writes the document with undo', () => {
    const { surface, container } = mount(body());
    document.body.append(container);
    try {
      expect(select(container).getAttribute('aria-label')).toBe('Color');
      expect([...select(container).options].map((o) => o.text)).toEqual(['Red', 'Green', 'Blue']);
      expect(select(container).selectedIndex).toBe(1);
      choose(select(container), 2);
      expect(select(container).selectedIndex).toBe(2);
      expect(document.activeElement).toBe(select(container));
      surface.undo();
      expect(select(container).selectedIndex).toBe(1);
      surface.redo();
      expect(select(container).selectedIndex).toBe(2);
    } finally {
      container.remove();
    }
  });
  test('an empty choice keeps the picker reachable for the next choice', () => {
    const { container } = mount(
      body().replace('<w:listEntry w:val="Red"/>', '<w:listEntry w:val=""/>')
    );
    choose(select(container), 0);
    expect(select(container)).not.toBeNull();
    expect(select(container).selectedIndex).toBe(0);
    choose(select(container), 2);
    expect(select(container).selectedIndex).toBe(2);
  });
  test('native keyboard input does not type in the document', () => {
    const { surface, container } = mount(body());
    const before = surface.session.bodyText();
    for (const key of ['b', ' ', 'ArrowDown', 'Enter', 'Tab']) {
      select(container).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      );
    }
    expect(surface.session.bodyText()).toBe(before);
    expect(select(container).selectedIndex).toBe(1);
  });
  test('choosing an entry fills a forms-protected document', () => {
    const { container } = mount(body(), { protectedForm: true });
    expect(select(container).disabled).toBe(false);
    choose(select(container), 0);
    expect(select(container).selectedIndex).toBe(0);
  });
  test('changing mode while a select is focused refuses the pending choice', () => {
    const { surface, container } = mount(body());
    const oldControl = select(container);
    surface.setEditingMode('suggest');
    choose(oldControl, 2);
    choose(select(container), 2);
    expect(select(container).selectedIndex).toBe(1);
  });
  test('comments-only and read-only protection disable the native picker', () => {
    for (const protection of ['comments', 'readOnly'] as const) {
      const { container } = mount(body(), { protection });
      expect(select(container).disabled).toBe(true);
      choose(select(container), 2);
      expect(select(container).selectedIndex).toBe(1);
    }
  });
  test('disabled fields and view mode reject even a synthetic change event', () => {
    for (const args of [
      { body: body('<w:enabled w:val="0"/>'), options: {} },
      { body: body(), options: { editingMode: 'view' as const } },
    ]) {
      const { container } = mount(args.body, args.options);
      expect(select(container).disabled).toBe(true);
      choose(select(container), 2);
      expect(select(container).selectedIndex).toBe(1);
    }
  });
});
