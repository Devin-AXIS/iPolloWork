import { expect, test } from 'bun:test';
import { createDocxEditor } from '../docx-editor.ts';
import { serializeOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer } from '../../layout/index.ts';
import { cellCheckboxDocx } from './cell-checkbox-docx.fixture.ts';

test('clicking cell-level checkbox widgets preserves paginated table geometry through history and save', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: cellCheckboxDocx(),
    measurer: createFixedMeasurer(6, 14),
  });
  try {
    const geometry = () =>
      editor.surface!.layout().pages.map((page) => ({
        box: page.box,
        tables: page.fragments
          .filter((block) => block.kind === 'table')
          .map((table) => ({
            box: table.box,
            columnEdges: table.columnEdges,
            rows: table.rows.map((row) => ({
              box: row.box,
              cells: row.cells.map((cell) => ({ box: cell.box, column: cell.gridColumn })),
            })),
          })),
      }));
    const initialGeometry = geometry();
    expect(initialGeometry.length).toBeGreaterThan(1);
    const initialXml = serializeOoxmlPart(editor.surface!.session.part());
    const widget = container.querySelector<HTMLElement>('[data-docx-cc-widget="checkbox"]')!;
    const id = widget.dataset.docxCcId!;
    const click = () =>
      container
        .querySelector<HTMLElement>(`[data-docx-cc-id="${id}"][data-docx-cc-widget="checkbox"]`)!
        .dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerId: 1,
            pointerType: 'mouse',
          })
        );
    for (const checked of [true, false, true]) {
      click();
      expect(
        container
          .querySelector(`[data-docx-cc-id="${id}"][role="checkbox"]`)!
          .getAttribute('aria-checked')
      ).toBe(String(checked));
      expect(geometry()).toEqual(initialGeometry);
      expect(serializeOoxmlPart(editor.surface!.session.part()).match(/<w:tc>/g)).toHaveLength(36);
    }
    editor.surface!.undo();
    expect(geometry()).toEqual(initialGeometry);
    editor.surface!.redo();
    expect(geometry()).toEqual(initialGeometry);
    const checkedXml = serializeOoxmlPart(editor.surface!.session.part());
    const saved = await editor.save();
    editor.load(saved);
    expect(geometry()).toEqual(initialGeometry);
    expect(serializeOoxmlPart(editor.surface!.session.part())).toBe(checkedXml);
    expect(checkedXml).toBe(
      initialXml
        .replace('<w14:checked w14:val="0"/>', '<w14:checked w14:val="1"/>')
        .replace('<w:t>☐</w:t>', '<w:sym w:char="2612" w:font="MS Gothic"/>')
    );
  } finally {
    editor.destroy();
    container.remove();
  }
});
