import { afterEach, expect, test } from 'bun:test';
import { mount, paragraph, putCaret } from './paginated-surface-fixtures.ts';

const opened: ReturnType<typeof mount>[] = [];
afterEach(() => {
  for (const { surface, container } of opened.splice(0)) {
    surface.destroy();
    container.remove();
  }
});
function setup() {
  const host = mount(paragraph(''));
  opened.push(host);
  return host.surface;
}

test.each(['edit', 'suggest'] as const)(
  'caret formatting separates text undo in %s mode',
  (mode) => {
    const surface = setup();
    surface.setAuthor('Ada');
    surface.setEditingMode(mode);
    surface.type('Alpha');
    surface.toggleRunProperty('b');
    expect(surface.formatting().bold).toBe(true);
    surface.type('Beta');
    surface.undo();
    expect(surface.session.bodyText()).toBe('Alpha');
    surface.undo();
    expect(surface.session.bodyText()).toBe('Alpha');
    expect(surface.formatting().bold).toBe(false);
    surface.undo();
    expect(surface.session.bodyText()).toBe('');
    surface.redo();
    expect(surface.session.bodyText()).toBe('Alpha');
    surface.redo();
    expect(surface.session.bodyText()).toBe('Alpha');
    expect(surface.formatting().bold).toBe(true);
    surface.redo();
    expect(surface.session.bodyText()).toBe('AlphaBeta');
  }
);

test('formatting an empty document formats its paragraph mark as one undo step', () => {
  const surface = setup();
  const before = surface.session.currentPackage();
  expect(surface.state().canUndo).toBe(false);
  surface.toggleRunProperty('b');
  expect(surface.session.currentPackage()).not.toBe(before);
  expect(surface.formatting().bold).toBe(true);
  expect(surface.state().canUndo).toBe(true);
  surface.undo();
  expect(surface.state().canUndo).toBe(false);
  expect(surface.state().canRedo).toBe(true);
  expect(surface.formatting().bold).toBe(false);
  surface.redo();
  expect(surface.formatting().bold).toBe(true);
});

test('new caret formatting abandons document redo', () => {
  const surface = setup();
  surface.type('Alpha');
  surface.undo();
  expect(surface.state().canRedo).toBe(true);
  surface.toggleRunProperty('i');
  expect(surface.state().canRedo).toBe(false);
  surface.redo();
  expect(surface.session.bodyText()).toBe('');
  expect(surface.formatting().italic).toBe(true);
});

test('new text abandons caret-format redo', () => {
  const surface = setup();
  surface.toggleRunProperty('b');
  surface.undo();
  surface.type('Plain');
  expect(surface.state().canRedo).toBe(false);
  surface.redo();
  expect(surface.session.bodyText()).toBe('Plain');
  expect(surface.formatting().bold).toBe(false);
});

test('successive caret format changes undo and redo independently', () => {
  const surface = setup();
  surface.type('Alpha');
  surface.toggleRunProperty('b');
  surface.toggleRunProperty('i');
  surface.undo();
  expect(surface.formatting().bold).toBe(true);
  expect(surface.formatting().italic).toBe(false);
  surface.undo();
  expect(surface.formatting().bold).toBe(false);
  expect(surface.session.bodyText()).toBe('Alpha');
  surface.redo();
  surface.redo();
  expect(surface.formatting().bold).toBe(true);
  expect(surface.formatting().italic).toBe(true);
});

test('caret-format undo restores its location after a selection move', () => {
  const surface = setup();
  surface.type('Alpha');
  surface.toggleRunProperty('b');
  putCaret(surface, 0);
  surface.undo();
  expect(surface.state().selection.head.offset).toBe(5);
  expect(surface.session.bodyText()).toBe('Alpha');
  expect(surface.formatting().bold).toBe(false);
});
