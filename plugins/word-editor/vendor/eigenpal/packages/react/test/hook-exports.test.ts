// Public hook return types must be importable from the package entry.

import { describe, expect, test } from 'bun:test';
import type { HeaderFooterState, NotePropertiesState } from '../src/index.ts';
import { useHeaderFooterState, useNotePropertiesState } from '../src/index.ts';

type Assert<T, U extends T> = U;

type _HeaderFooterStateExport = Assert<
  NonNullable<ReturnType<typeof useHeaderFooterState>>,
  HeaderFooterState
>;

type _NotePropertiesStateExport = Assert<
  NonNullable<ReturnType<typeof useNotePropertiesState>>,
  NotePropertiesState
>;

describe('React hook public exports', () => {
  test('HeaderFooterState and NotePropertiesState are exported from package entry', () => {
    expect(typeof useHeaderFooterState).toBe('function');
    expect(typeof useNotePropertiesState).toBe('function');
  });
});
