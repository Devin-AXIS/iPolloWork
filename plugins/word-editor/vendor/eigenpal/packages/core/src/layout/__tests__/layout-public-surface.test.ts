// Layout barrel authority: internal orchestration helpers stay module-local.
//
// The `/layout` subpath is a public package entry, but only symbols consumed across lane
// boundaries belong in index.ts. Cache keys, field scanners, and multi-section orchestration
// are implementation details — tests import their modules directly.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX = join(dirname(fileURLToPath(import.meta.url)), '../index.ts');

/** Must not appear in `export { … }` blocks of the layout barrel. */
const INTERNAL_ONLY_SYMBOLS = [
  'DEFAULT_MAX_HF_PAGE_CONTEXT_ENTRIES',
  'headerFooterContentKey',
  'HeaderFooterStoryLayout',
  'furnitureFingerprint',
  'furnitureForSection',
  'layoutMultiSectionDocument',
  'multiSectionStructureKey',
  'LayoutSectionFn',
  'SectionLayoutResult',
  'MAX_FIELD_INSTRUCTION_CHARS',
  'MAX_FIELD_NESTING',
  'MAX_STORY_FIELD_SCAN_DEPTH',
  'MAX_STORY_FIELD_SCAN_NODES',
  'NO_STORY_PAGE_FIELDS',
  'allowlistedPageField',
  'detectStoryPageFields',
  'fieldPageContextToken',
  'finalizePageFieldProjection',
  'normalizeFieldInstruction',
  'piecesOfParagraph',
  'projectPageFieldValue',
  'AllowlistedPageField',
  'FieldAwarePiece',
  'FieldPageContext',
  'StoryPageFieldNeeds',
] as const;

function exportNamesFromIndex(source: string): readonly string[] {
  const names: string[] = [];
  const blockRe = /export\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(source)) !== null) {
    for (const part of match[1]!.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const name = trimmed
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]!
        .trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe('layout package public surface', () => {
  test('index does not re-export internal hf / multi-section / field helpers', () => {
    const exports = new Set(exportNamesFromIndex(readFileSync(INDEX, 'utf8')));
    const leaked = INTERNAL_ONLY_SYMBOLS.filter((symbol) => exports.has(symbol));
    expect(leaked).toEqual([]);
  });

  test('layoutHeaderFooterStory remains the cross-lane hf entry', () => {
    const exports = new Set(exportNamesFromIndex(readFileSync(INDEX, 'utf8')));
    expect(exports.has('layoutHeaderFooterStory')).toBe(true);
  });
});
