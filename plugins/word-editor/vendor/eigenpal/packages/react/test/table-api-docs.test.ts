import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const API_SNAPSHOT = join(import.meta.dir, '../../../docs/api/docx-editor-react/index.api.md');

describe('Task 10 table public API docs', () => {
  test('React snapshot has no undocumented table compound namespace members', () => {
    const api = readFileSync(API_SNAPSHOT, 'utf8');
    const namespaces = [
      'TableBorderColorNamespace',
      'TableBorderStyleNamespace',
      'TableBorderTargetNamespace',
      'TableBorderWidthNamespace',
      'TableCellFillNamespace',
      'TableChromePartComponent',
    ];
    for (const name of namespaces) {
      const start = api.indexOf(`export interface ${name}`);
      expect(start).toBeGreaterThan(-1);
      const end = api.indexOf('\n// @public', start + 1);
      const block = api.slice(start, end > start ? end : start + 1200);
      expect(block.includes('(undocumented)')).toBe(false);
    }
  });
});
