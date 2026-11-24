// Task 9 fix round 1 — i18n catalogue evidence for table chrome vocabulary.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TABLE_BORDER_STYLE_OPTIONS,
  TABLE_BORDER_TARGET_OPTIONS,
  TABLE_BORDER_WIDTH_OPTIONS,
  TABLE_CHROME_SLOT_IDS,
} from '../table-chrome.ts';
import { CHROME_GROUPS, chromeSlotId } from '../chrome-controls.ts';

const repositoryRoot = resolve(import.meta.dir, '../../../../..');
const en = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'packages/i18n/en.json'), 'utf8')
) as Record<string, unknown>;

function keyExists(catalogue: Record<string, unknown>, key: string): boolean {
  const parts = key.split('.');
  let node: unknown = catalogue;
  for (const part of parts) {
    if (!node || typeof node !== 'object' || !(part in (node as Record<string, unknown>))) {
      return false;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' && node.length > 0;
}

describe('table chrome i18n catalogue (Task 9 fix round 1)', () => {
  test('every chrome slot labelKey resolves in en.json', () => {
    const table = CHROME_GROUPS.find((g) => g.id === 'table');
    expect(table).toBeDefined();
    for (const control of table!.controls) {
      expect(keyExists(en, control.labelKey), control.labelKey).toBe(true);
    }
  });

  test('border target/style/width vocabulary keys resolve in en.json', () => {
    for (const option of TABLE_BORDER_TARGET_OPTIONS) {
      expect(keyExists(en, option.labelKey), option.labelKey).toBe(true);
    }
    for (const option of TABLE_BORDER_STYLE_OPTIONS) {
      expect(keyExists(en, option.labelKey), option.labelKey).toBe(true);
    }
    for (const option of TABLE_BORDER_WIDTH_OPTIONS) {
      expect(keyExists(en, option.labelKey), option.labelKey).toBe(true);
    }
    expect(keyExists(en, 'table.clearCellFill')).toBe(true);
    expect(keyExists(en, 'table.insertRowBelow')).toBe(true);
    expect(keyExists(en, 'table.insertColumnRight')).toBe(true);
  });

  test('stable slot ids: five border/fill controls, then merge and split', () => {
    const tableGroup = CHROME_GROUPS.find((g) => g.id === 'table');
    expect(tableGroup).toBeDefined();
    expect(TABLE_CHROME_SLOT_IDS).toEqual([
      'table.borderTarget',
      'table.borderColor',
      'table.borderStyle',
      'table.borderWidth',
      'table.cellFill',
    ]);
    const slots = tableGroup!.controls.map((c) => chromeSlotId(tableGroup!, c));
    expect(slots.slice(1)).toEqual([
      ...TABLE_CHROME_SLOT_IDS,
      'table.mergeCells',
      'table.splitCell',
    ]);
  });
});
