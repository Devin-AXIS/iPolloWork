// A rendered-graphic preview must pass presses to the drawing, so the drawing stays
// selectable, while interactive controls inside the preview keep their own input.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';

const root = postcss.parse(readFileSync(resolve(import.meta.dir, '../editor.css'), 'utf8'));

function pointerEvents(selector: string): string | undefined {
  let value: string | undefined;
  root.walkRules((rule) => {
    if (rule.selectors.map((s) => s.replace(/\s+/g, ' ')).includes(selector)) {
      rule.walkDecls('pointer-events', (decl) => {
        value = decl.value;
      });
    }
  });
  return value;
}

test('rendered-graphic preview slots pass presses through except on controls', () => {
  const slot = '.docx-drawing[data-docx-customized] > .docx-unsupported-slot';
  expect(pointerEvents(slot)).toBe('none');
  expect(
    pointerEvents(
      `${slot} :is(a[href], button, input, select, textarea, [tabindex], [role='button'])`
    )
  ).toBe('auto');
});
