import React from 'react';
import { afterEach, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { VerticalRuler } from '../src/components/ui/VerticalRuler';
import { LocaleProvider } from '../src/i18n/LocaleContext';

afterEach(cleanup);

const ruler = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.docx-vertical-ruler')!;

test('a right-to-left interface mirrors the vertical ruler', () => {
  const rtl = render(
    <LocaleProvider dir="rtl">
      <VerticalRuler />
    </LocaleProvider>
  );
  expect(ruler(rtl.container).getAttribute('dir')).toBe('rtl');
  cleanup();
  const ltr = render(<VerticalRuler />);
  expect(ruler(ltr.container).hasAttribute('dir')).toBe(false);
});
