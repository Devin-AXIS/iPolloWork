import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../../store/index.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import type { TextMeasurer } from '../semantic-records.ts';
import { paragraphContentWidthsPt } from '../table-autofit-widths.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string, hidden = false) =>
  `<w:r>${hidden ? '<w:rPr><w:vanish/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
function widths(content: string, measurer = createFixedMeasurer(6, 12)) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const find = (node: OoxmlElement): OoxmlElement | undefined => {
    if (node.localName === 'p') return node;
    for (const child of node.children) {
      if ('localName' in child) {
        const found = find(child);
        if (found) return found;
      }
    }
  };
  const paragraph = find(read.part.root);
  if (!paragraph) throw new Error('Synthetic paragraph required');
  return paragraphContentWidthsPt(paragraph, {
    context: { measurer },
    view: {
      styleCascade: elevenPointDefaults(),
      displayMode: 'all-markup',
      readNested: () => null,
    },
    tableCellStyle: undefined,
  });
}

test('a run-opening dash keeps the current paragraph-wide cut', () => {
  const whole = widths(run('ALPHA-PRIME'));
  expect(whole).toEqual({ min: 36, max: 66 });
  expect(widths(run('ALPHA') + run('-PRIME'))).toEqual(whole);
});

test('unwrapped dash segments retain their contextual measurement', () => {
  const advances: Record<string, number> = { ALPHA: 10, '-': 4, PRIME: 12, '-PRIME': 20 };
  const measurer: TextMeasurer = {
    ...createFixedMeasurer(6, 12),
    measure: (text) => advances[text] ?? text.length * 6,
  };
  expect(widths(run('ALPHA') + run('-PRIME'), measurer)).toEqual({ min: 14, max: 26 });
});

test('a dash chain across runs keeps its existing word grouping', () => {
  const whole = widths(run('ALPHA--PRIME'));
  expect(whole).toEqual({ min: 42, max: 72 });
  expect(widths(run('ALPHA') + run('-') + run('-PRIME'))).toEqual(whole);
});

test('a trailing space and zero-width space hang together', () => {
  const measurer: TextMeasurer = {
    ...createFixedMeasurer(6, 12),
    measure: (text) => [...text].filter((char) => char !== '\u200b').length * 6,
  };
  expect(widths(run('word \u200b'), measurer)).toEqual({ min: 24, max: 24 });
});

test('an interior zero-width space breaks a word without losing the unwrapped line', () => {
  const measurer: TextMeasurer = {
    ...createFixedMeasurer(6, 12),
    measure: (text) => [...text].filter((char) => char !== '\u200b').length * 6,
  };
  expect(widths(run('word\u200bnext'), measurer)).toEqual({ min: 24, max: 48 });
});

test('hidden text does not change a visible cross-run dash boundary', () => {
  expect(widths(run('ALPHA') + run('HIDDEN', true) + run('-PRIME'))).toEqual({ min: 36, max: 66 });
});

test('unspaced non-CJK text keeps the upstream whole-word minimum', () => {
  expect(widths(run('ภาษาไทย'))).toEqual({ min: 42, max: 42 });
});

test('an adjacent CJK run does not split a layout-owned display field', () => {
  expect(
    widths(
      run('甲') + '<w:fldSimple w:instr=" AUTHOR ">' + run('乙丙丁') + '</w:fldSimple>' + run('戊')
    )
  ).toEqual({ min: 18, max: 30 });
});
