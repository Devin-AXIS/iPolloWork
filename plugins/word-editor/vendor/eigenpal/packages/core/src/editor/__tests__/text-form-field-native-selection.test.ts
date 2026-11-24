import { test, expect } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { paragraphTextOf } from '../../store/store/index.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const field =
  '<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Input"/><w:textInput><w:type w:val="number"/><w:default w:val="1"/></w:textInput></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
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
    `<w:settings xmlns:w="${W}"><w:documentProtection w:edit="forms" w:enforcement="1"/></w:settings>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p>${field}</w:p><w:p><w:r><w:t>Elsewhere</w:t></w:r></w:p></w:body></w:document>`
  ),
});
test('repaint honors protected field exit validation', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!opened.ok) throw Error(opened.reason);
  const surface = opened.surface;
  try {
    const ids = surface.session.paragraphIds();
    const first = { paragraphId: ids[0]!, offset: 1 };
    surface.setSelection({ anchor: first, head: first });
    surface.type('.2.3');
    expect(paragraphTextOf(surface.session.part(), ids[0]!)).toBe('1.2.3');
    const second = { paragraphId: ids[1]!, offset: 2 };
    surface.setSelection({ anchor: second, head: second });
    expect(surface.state().selection.head.paragraphId).toBe(ids[0]!);
    expect(container.querySelector('[data-field-error]')?.textContent).toContain(
      'valid field value'
    );
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    const target = [...pages.querySelectorAll<HTMLElement>('[data-paragraph-id][data-start]')].find(
      (s) => s.dataset.paragraphId === ids[1]
    )!;
    pages.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'touch' })
    );
    document.getSelection()!.setBaseAndExtent(target.firstChild!, 2, target.firstChild!, 2);
    surface.contentControls.setShowAll(true);
    expect(surface.state().selection.head.paragraphId).toBe(ids[0]!);
    expect(container.querySelector('[data-field-error]')?.textContent).toContain(
      'valid field value'
    );
    const alert = container.querySelector<HTMLDialogElement>('[role="alertdialog"]')!;
    expect(alert.open).toBe(true);
    alert.querySelector('button')!.click();
    expect(paragraphTextOf(surface.session.part(), ids[0]!)).toBe('');
    expect(surface.state().selection.head).toEqual({ paragraphId: ids[0]!, offset: 0 });
    surface.undo();
    expect(paragraphTextOf(surface.session.part(), ids[0]!)).toBe('1.2.3');
  } finally {
    surface.destroy();
    container.remove();
  }
});
