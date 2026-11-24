import { describe, expect, test } from 'bun:test';
import {
  TOOLBAR_COLLAPSE_ORDER,
  TOOLBAR_PINNED_GROUPS,
  collapseOrder,
  orderToolbarOverflowSections,
} from '../toolbar-fit.ts';

const BAR_GROUPS = [
  'history',
  'zoom',
  'styles',
  'font',
  'text',
  'script',
  'alignment',
  'list',
  'format',
  'image',
  'shape',
  'chart',
] as const;

describe('toolbar collapse policy', () => {
  test('collapseOrder puts undeclared groups first, in reverse bar order', () => {
    const groups = ['history', 'zoom', 'custom', 'text'];
    expect(collapseOrder(groups)).toEqual(['custom', 'zoom', 'text', 'history']);
  });

  test('collapseOrder follows the declared order for known groups', () => {
    expect(collapseOrder([...BAR_GROUPS])).toEqual(['image', ...TOOLBAR_COLLAPSE_ORDER]);
  });

  test('the selected shape or chart controls collapse last and lead the overflow menu', () => {
    const order = collapseOrder([...BAR_GROUPS]);
    expect(order.slice(-2)).toEqual(['shape', 'chart']);
    const sections = ['text', 'image', 'chart', 'history', 'shape'].map((id) => ({ id }));
    expect(orderToolbarOverflowSections(sections).map((s) => s.id)).toEqual([
      'chart',
      'shape',
      'text',
      'image',
      'history',
    ]);
  });

  test('pinned review is excluded from collapsible groups at the toolbar layer', () => {
    expect(TOOLBAR_PINNED_GROUPS.has('review')).toBe(true);
    expect(BAR_GROUPS.includes('review' as (typeof BAR_GROUPS)[number])).toBe(false);
  });
});
