// Dark mode inverts the document ink, never the sheet. The ink is not one element: the
// header and footer bands, the notes area, and the floating drawing layers are siblings of
// `.docx-page-content` on the sheet. A rule that named only the body painted header and
// footnote text black on the dark page. This pins every ink layer into the rule, and into
// the print reset that undoes it.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(
  fileURLToPath(new URL('../../styles/editor.css', import.meta.url)),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

const INK_LAYERS = [
  '.docx-page-content',
  '.docx-page > .docx-hf > :not([data-no-color-invert])',
  '.docx-page > .docx-hf-behind-layer',
  '.docx-page > .docx-notes',
  '.docx-page > .docx-drawing-layer',
];

/** Every rule whose selector starts at the dark root and whose body sets `filter`. */
function darkFilterRules(source: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!.replace(/\s+/g, ' ').trim();
    const body = match[2]!;
    if (selector.includes('.docx-editor.dark') && /\bfilter\s*:/.test(body)) {
      out.push({ selector, body });
    }
  }
  return out;
}

describe('dark mode inverts every layer of document ink', () => {
  const rules = darkFilterRules(CSS);
  const inversion = rules.find(
    (rule) => rule.body.includes('contrast(0.92)') && !rule.body.includes('none')
  );
  const media = rules.find(
    (rule) =>
      rule.selector.includes(':is(img, svg, canvas, video, [data-no-color-invert])') &&
      !rule.body.includes('none')
  );
  const printReset = rules.filter((rule) => rule.body.includes('none'));

  test.each(INK_LAYERS)('%s is inverted, with its media counter-inverted', (layer) => {
    expect(inversion?.selector).toContain(layer);
    expect(media?.selector).toContain(layer);
  });

  test.each(INK_LAYERS)('%s returns to plain ink for print', (layer) => {
    expect(printReset.some((rule) => rule.selector.includes(layer))).toBe(true);
  });

  test('the header band itself stays out, so its hover tint and edit border are not inverted', () => {
    expect(inversion?.selector).not.toMatch(/\.docx-page > \.docx-hf\s*[,)]/);
  });
});
