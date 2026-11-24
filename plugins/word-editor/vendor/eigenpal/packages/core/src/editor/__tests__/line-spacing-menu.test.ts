import { describe, expect, test } from 'bun:test';
import { lineSpacingMenuRowLabel, lineSpacingMenuRows } from '../line-spacing-menu.ts';

const shown = (rows: ReturnType<typeof lineSpacingMenuRows>) =>
  rows.map((row) => `${row.spacing.rule}:${row.text}${row.selected ? ' ✓' : ''}`);

describe('lineSpacingMenuRows', () => {
  test('ticks the preset in force', () => {
    expect(shown(lineSpacingMenuRows({ rule: 'multiple', value: 1.15 }))).toEqual([
      'multiple:1.0',
      'multiple:1.15 ✓',
      'multiple:1.5',
      'multiple:2.0',
      'multiple:2.5',
      'multiple:3.0',
    ]);
  });

  test('a multiple no preset matches joins the list in order, ticked', () => {
    const rows = lineSpacingMenuRows({ rule: 'multiple', value: 1.08 });
    expect(shown(rows)).toEqual([
      'multiple:1.0',
      'multiple:1.08 ✓',
      'multiple:1.15',
      'multiple:1.5',
      'multiple:2.0',
      'multiple:2.5',
      'multiple:3.0',
    ]);
    expect(rows[1]!.preset).toBe(false);
    expect(shown(lineSpacingMenuRows({ rule: 'multiple', value: 4 })).at(-1)).toBe(
      'multiple:4.0 ✓'
    );
  });

  test('an exact or at-least spacing leads the list as its own ticked row', () => {
    const rows = lineSpacingMenuRows({ rule: 'exact', value: 12.5 });
    expect(shown(rows)[0]).toBe('exact:12.5 ✓');
    expect(rows.filter((row) => row.selected)).toHaveLength(1);
    expect(shown(lineSpacingMenuRows({ rule: 'atLeast', value: 18 }))[0]).toBe('atLeast:18 ✓');
  });

  test('each row carries the command it applies and its label', () => {
    const label = (key: string) =>
      ({ 'lineSpacing.exactlyPoints': '{value} pt exactly' })[key] ?? key;
    const [exact, single] = lineSpacingMenuRows({ rule: 'exact', value: 12.5 });
    // The selected row already holds, and its value is rounded, so it writes nothing.
    expect(exact!.command).toBeNull();
    // The translation decides the word order; the number only fills the placeholder.
    expect(lineSpacingMenuRowLabel(exact!, label)).toBe('12.5 pt exactly');
    expect(single!.command).toEqual({ type: 'setLineSpacing', rule: 'multiple', value: 1 });
    expect(lineSpacingMenuRowLabel(single!, label)).toBe('1.0');
  });

  test('a locale formats the number the way the strings around it read', () => {
    const label = (key: string) =>
      ({ 'lineSpacing.exactlyPoints': 'Genau {value} pt' })[key] ?? key;
    const rows = lineSpacingMenuRows({ rule: 'exact', value: 12.5 });
    expect(rows.map((row) => lineSpacingMenuRowLabel(row, label, 'de'))).toEqual([
      'Genau 12,5 pt',
      '1,0',
      '1,15',
      '1,5',
      '2,0',
      '2,5',
      '3,0',
    ]);
    expect(lineSpacingMenuRowLabel(rows[1]!, label, 'en')).toBe('1.0');
    expect(lineSpacingMenuRowLabel(rows[1]!, label, 'not a tag!')).toBe('1.0');
  });

  test('a mixed selection ticks nothing and adds no row', () => {
    const rows = lineSpacingMenuRows(null);
    expect(rows).toHaveLength(6);
    expect(rows.some((row) => row.selected)).toBe(false);
  });
});
