import { expect, test } from 'bun:test';
import { createFieldLinkRegistry } from '../field-link-registry.ts';

test('clear drops lookup state without recycling semantic link ids', () => {
  const registry = createFieldLinkRegistry();
  const first = registry.project({ target: 'https://one.example', anchor: null, tooltip: null });
  expect(first?.id).toBe('field-hyperlink:1');
  expect(registry.linkById(first!.id)?.href).toBe('https://one.example');

  registry.clear();
  expect(registry.linkById(first!.id)).toBeNull();
  const second = registry.project({ target: 'https://two.example', anchor: null, tooltip: null });
  expect(second?.id).toBe('field-hyperlink:2');
});
