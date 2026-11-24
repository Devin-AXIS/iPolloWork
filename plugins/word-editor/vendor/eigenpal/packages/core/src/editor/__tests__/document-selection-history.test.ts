import { afterEach, expect, test } from 'bun:test';
import { mount, paragraph } from './paginated-surface-fixtures.ts';

const opened: ReturnType<typeof mount>[] = [];
afterEach(() => {
  for (const { surface, container } of opened.splice(0)) {
    surface.destroy();
    container.remove();
  }
});

test('replacement undo restores the full selection across paragraphs', () => {
  const host = mount(paragraph('First') + paragraph('Second'));
  opened.push(host);
  const { surface } = host;
  surface.selectAll();
  const before = surface.state().selection;
  surface.type('Replacement');
  surface.undo();
  expect(surface.session.bodyText()).toBe('First\nSecond');
  expect(surface.state().selection).toEqual(before);
  surface.type('Q');
  expect(surface.session.bodyText()).toBe('Q');
});

test('replacement undo preserves a backward selection and redo restores the final caret', () => {
  const host = mount(paragraph('First') + paragraph('Second'));
  opened.push(host);
  const { surface } = host;
  const ids = surface.session.paragraphIds();
  const before = {
    anchor: { paragraphId: ids[1]!, offset: 4 },
    head: { paragraphId: ids[0]!, offset: 2 },
  };
  surface.setSelection(before);
  surface.type('XYZ');
  const after = surface.state().selection;
  expect(surface.session.bodyText()).toBe('FiXYZnd');
  surface.undo();
  expect(surface.state().selection).toEqual(before);
  surface.redo();
  expect(surface.state().selection).toEqual(after);
  surface.type('Q');
  expect(surface.session.bodyText()).toBe('FiXYZQnd');
});

test('paste replacement undo restores a cross-paragraph selection', () => {
  const host = mount(paragraph('First') + paragraph('Second'));
  opened.push(host);
  const { surface, container } = host;
  surface.selectAll();
  const before = surface.state().selection;
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', 'Pasted');
  container
    .querySelector('.docx-pages')!
    .dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  expect(surface.session.bodyText()).toBe('Pasted');
  surface.undo();
  expect(surface.state().selection).toEqual(before);
  expect(surface.session.bodyText()).toBe('First\nSecond');
});
