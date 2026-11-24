import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { NO_THEME_FONTS } from '../run-style.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type LineRecord } from '../semantic-records.ts';
import { loadBody, W } from './float-over-table-harness.ts';

// 10pt per character at 11pt and a 100pt measure; default tab stops every 36pt.
const measurer = createFixedMeasurer(10, 14);
const geometry = { width: 120, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } };
const RPR = '<w:rPr><w:sz w:val="22"/></w:rPr>';
const TAB = `<w:r>${RPR}<w:tab/></w:r>`;
/** `text` with each `\t` as a `w:tab` run. */
const runs = (text: string) =>
  text
    .split('\t')
    .map((part) => (part ? `<w:r>${RPR}<w:t xml:space="preserve">${part}</w:t></w:r>` : ''))
    .join(TAB);
const paragraph = (text: string, tabs = '') =>
  `<w:p><w:pPr>${tabs ? `<w:tabs>${tabs}</w:tabs>` : ''}<w:jc w:val="distribute"/></w:pPr>${runs(text)}</w:p>`;
const stop = (alignment: string, positionPt: number) =>
  `<w:tab w:val="${alignment}" w:pos="${positionPt * 20}"/>`;

function root(xml: string) {
  const result = readOoxmlPart(xml, { name: '/word/part.xml', contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}
/** A mode 15 cascade; `rPrDefault` selects character distribution for distributed lines. */
function cascade(rPrDefault: boolean) {
  const styles = root(
    `<w:styles xmlns:w="${W}"><w:docDefaults>${rPrDefault ? '<w:rPrDefault/>' : ''}<w:pPrDefault/></w:docDefaults></w:styles>`
  );
  const settings = root(
    `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`
  );
  return buildStyleCascadeTable(styles, NO_THEME_FONTS, settings);
}
const CHARACTERS = cascade(true);
const SPACES = cascade(false);

function firstLine(body: string, styleCascade: ReturnType<typeof cascade>): LineRecord {
  const [line] = linesOf(
    layoutSemanticDocument(loadBody(body), 0, { measurer, geometry, styleCascade })
  );
  return line as LineRecord;
}

/** Each visible character of a line as `[character, start x]`, x is content-relative. */
function placed(line: LineRecord) {
  return line.spans
    .filter((span) => span.text !== '\t')
    .flatMap((span) =>
      [...span.text].map((character, index) => [character, span.box.x + 10 * index] as const)
    )
    .filter(([character]) => character.trim() !== '')
    .map(([character, x]) => [character, Number(x.toFixed(4))] as const);
}

test('text after a left tab spreads its characters from the tab stop to the line end', () => {
  // Cd sits at the 36pt stop and ends at 56pt; its one gap takes the 44pt of slack.
  expect(placed(firstLine(paragraph('Ab\tCd'), CHARACTERS))).toEqual([
    ['A', 0],
    ['b', 10],
    ['C', 36],
    ['d', 90],
  ]);
});

test('only the text after the last tab stretches', () => {
  // Characters: Ef after the second stop (72pt) takes the 8pt of slack; Cd keeps its place.
  expect(placed(firstLine(paragraph('Ab\tCd\tEf'), CHARACTERS))).toEqual([
    ['A', 0],
    ['b', 10],
    ['C', 36],
    ['d', 46],
    ['E', 72],
    ['f', 90],
  ]);
  // Spaces: the space before the tab keeps its advance; the one after it takes the slack.
  const xs = placed(firstLine(paragraph('a b\tc d'), SPACES));
  expect(xs.map(([text]) => text.trim())).toEqual(['a', 'b', 'c', 'd']);
  expect(xs[1]![1]).toBeCloseTo(20, 4);
  expect(xs[2]![1]).toBeCloseTo(36, 4);
  expect(xs[3]![1]).toBeCloseTo(90, 4);
});

for (const alignment of ['right', 'center', 'decimal']) {
  test(`a line whose last tab reaches a ${alignment} stop centers with its tab positions`, () => {
    const tabs = stop(alignment, 60);
    for (const styleCascade of [CHARACTERS, SPACES]) {
      const natural = placed(
        firstLine(paragraph('Ab\tCd', tabs).replace('distribute', 'left'), styleCascade)
      );
      // The whole line moves by half the room after its content, tab positions included.
      const shift = (100 - (natural[natural.length - 1]![1] + 10)) / 2;
      expect(placed(firstLine(paragraph('Ab\tCd', tabs), styleCascade))).toEqual(
        natural.map(([character, x]) => [character, x + shift])
      );
    }
  });
}

test('kerned text after a left tab keeps its letters together', () => {
  const kerned = buildStyleCascadeTable(
    root(
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
    ),
    NO_THEME_FONTS,
    root(
      `<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`
    )
  );
  // One kerned word has nothing to stretch: the whole line centers, Cd ending at 56pt.
  expect(placed(firstLine(paragraph('Ab\tCd'), kerned))).toEqual([
    ['A', 22],
    ['b', 32],
    ['C', 58],
    ['d', 68],
  ]);
  // Kerned words after the tab stretch only at their space.
  expect(placed(firstLine(paragraph('Ab\tCd Ef'), kerned))).toEqual([
    ['A', 0],
    ['b', 10],
    ['C', 36],
    ['d', 46],
    ['E', 80],
    ['f', 90],
  ]);
});

test('a line with nothing to stretch after its last left tab centers', () => {
  for (const styleCascade of [CHARACTERS, SPACES]) {
    // One character after the tab ends at 46pt.
    expect(placed(firstLine(paragraph('Ab\tC'), styleCascade))).toEqual([
      ['A', 27],
      ['b', 37],
      ['C', 63],
    ]);
    // A closing tab ends the content at its 36pt stop.
    expect(placed(firstLine(paragraph('Ab\t'), styleCascade))).toEqual([
      ['A', 32],
      ['b', 42],
    ]);
  }
});
