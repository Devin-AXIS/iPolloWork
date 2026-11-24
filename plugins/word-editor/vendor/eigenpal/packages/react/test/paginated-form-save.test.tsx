import './dom-setup.ts';
import React, { createRef } from 'react';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import {
  PaginatedDocxEditor,
  type PaginatedDocxEditorHandle,
} from '../src/components/PaginatedDocxEditor';
import { formFieldDocx } from '../../core/src/editor/__tests__/form-field-docx.fixture';
import { openTreeSession } from '@docx-editor.dev/core/binding';

afterEach(cleanup);

test('the paginated React ref validates pending form input before saving', async () => {
  const ref = createRef<PaginatedDocxEditorHandle>();
  render(<PaginatedDocxEditor source={formFieldDocx(true)} ref={ref} />);
  await act(async () => {});
  const handle = ref.current!;
  act(() => {
    handle.navigate('documentStart');
    for (let i = 0; i < 10; i++) handle.navigate('right', true);
    handle.type('invalid');
    expect(() => handle.save()).toThrow(expect.objectContaining({ code: 'invalidArgs' }));
    handle.undo();
    const saved = openTreeSession(handle.save()!);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.session.bodyText()).toBe('01/02/2030 tail');
  });
});
