import { describe, expect, test } from 'bun:test';
import type { EditorCommand } from '../../contracts/editor.ts';
import { editorCommandKey } from '../command-key.ts';

describe('editorCommandKey', () => {
  test('sorts keys at every nesting level', () => {
    const first = {
      type: 'setCellFill',
      color: { kind: 'hex', value: 'FF0000' },
    } satisfies EditorCommand;
    const reordered = {
      color: { value: 'FF0000', kind: 'hex' },
      type: 'setCellFill',
    } satisfies EditorCommand;

    expect(editorCommandKey(first)).toBe(editorCommandKey(reordered));
  });

  test('distinguishes nested payload values', () => {
    const red = {
      type: 'setCellFill',
      color: { kind: 'hex', value: 'FF0000' },
    } satisfies EditorCommand;
    const blue = {
      type: 'setCellFill',
      color: { kind: 'hex', value: '0000FF' },
    } satisfies EditorCommand;

    expect(editorCommandKey(red)).not.toBe(editorCommandKey(blue));
  });
});
