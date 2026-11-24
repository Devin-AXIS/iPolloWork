import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { NO_THEME_FONTS } from '../run-style.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type LineRecord } from '../semantic-records.ts';
import { SPACE_SHARE_LIMIT } from '../distributed-character-spacing.ts';
import { loadBody, W } from './float-over-table-harness.ts';

// 10pt per character at 11pt and a 100pt measure, so every position is checkable by hand.
// An East Asian character followed by Latin text opens an automatic gap of a quarter of the
// font size (2.75pt); the fixed face has no average width, so the reverse boundary opens none.
const measurer = createFixedMeasurer(10, 14);
const geometry = { width: 120, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } };
const AUTOMATIC_GAP = 11 / 4;
const run = (text: string) =>
  `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (text: string, jc: string, rightIndent = 0) =>
  `<w:p><w:pPr><w:ind w:left="0" w:right="${rightIndent}"/><w:jc w:val="${jc}"/></w:pPr>${run(text)}</w:p>`;

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
const SPACES = cascade(false);
const CHARACTERS = cascade(true);

function lines(body: string, styleCascade = SPACES): LineRecord[] {
  return linesOf(
    layoutSemanticDocument(loadBody(body), 0, { measurer, geometry, styleCascade })
  ) as LineRecord[];
}

/** Each visible span of a line as `[text, start x]`, x is content-relative. */
function placed(line: LineRecord) {
  return line.spans
    .filter((span) => span.text !== '' && span.text !== '\n')
    .map((span) => [span.text, Number(span.box.x.toFixed(4))] as const);
}

test('a distributed line gives every East Asian character the same gap, punctuation included', () => {
  for (const text of ['漢字、漢字。', '「漢字」です', 'あ、い']) {
    const [line] = lines(paragraph(text, 'distribute'));
    const characters = [...text];
    // The slack after the characters' own advances, shared by every gap between them.
    const step = (100 - 10 * characters.length) / (characters.length - 1);
    expect(placed(line!)).toEqual(
      characters.map((character, index) => [character, Number((index * (10 + step)).toFixed(4))])
    );
  }
});

test('a justified line gives every East Asian character the same gap, punctuation included', () => {
  // A 95pt measure holds nine characters; the line breaks before an ordinary character.
  const [first] = lines(paragraph('あ、いう「えお」かきくけこさしすせそ', 'both', 100));
  const step = (95 - 90) / 8;
  expect(placed(first!)).toEqual(
    [...'あ、いう「えお」か'].map((character, index) => [
      character,
      Number((index * (10 + step)).toFixed(4)),
    ])
  );
});

test('on a line with East Asian text a space takes a bounded share and opens one slot', () => {
  const [line] = lines(paragraph('漢字 漢字', 'distribute'));
  // 50pt of slack: the space takes its share, and three slots share the rest. The boundary
  // before the space opens nothing; the one after it does.
  const share = SPACE_SHARE_LIMIT * 10;
  const step = (50 - share) / 3;
  const xs = placed(line!);
  expect(xs.map(([text]) => text)).toEqual(['漢', '字', ' ', '漢', '字']);
  expect(xs[1]![1]).toBeCloseTo(10 + step, 4);
  expect(xs[2]![1]).toBeCloseTo(20 + step, 4);
  expect(xs[3]![1]).toBeCloseTo(30 + 2 * step + share, 4);
  expect(xs[4]![1]).toBeCloseTo(90, 4);
});

test('an automatic inter-script gap grows up to twice its size before the characters spread', () => {
  // 漢字 + gap + abc + 漢字漢字 is 92.75pt in a 95pt measure: the 2.25pt of slack is less than
  // the gap can take, so only the gap grows and the East Asian characters keep their advance.
  const [first] = lines(paragraph('漢字abc漢字漢字漢字漢字漢字漢字', 'both', 100));
  const xs = placed(first!);
  expect(xs.map(([text]) => text).join('')).toBe('漢字abc漢字漢字');
  expect(xs[0]).toEqual(['漢', 0]);
  expect(xs[1]).toEqual(['字', 10]);
  expect(xs[2]![1]).toBeCloseTo(20 + AUTOMATIC_GAP + 2.25, 4);
  // Without an automatic gap, the boundary between Latin and East Asian text opens no slot.
  expect(xs[3]![1]).toBeCloseTo(55, 4);
});

test('the slack beyond the automatic gap goes in equal steps to the East Asian slots', () => {
  const [line] = lines(paragraph('漢字ab', 'distribute'));
  // 100 - (40 + 2.75) of slack: the gap doubles, and the two slots share the rest.
  const step = (100 - 40 - 2 * AUTOMATIC_GAP) / 2;
  const xs = placed(line!);
  expect(xs.map(([text]) => text)).toEqual(['漢', '字', 'ab']);
  expect(xs[1]![1]).toBeCloseTo(10 + step, 4);
  expect(xs[2]![1]).toBeCloseTo(80, 4);
});

test('character distribution doubles an automatic gap before it spreads the characters', () => {
  // The run names an East Asian font, so the empty run defaults keep its automatic gap.
  const named = `<w:p><w:pPr><w:jc w:val="distribute"/></w:pPr><w:r><w:rPr><w:rFonts w:eastAsia="MS Mincho"/><w:sz w:val="22"/></w:rPr><w:t>漢字ab</w:t></w:r></w:p>`;
  const [line] = lines(named, CHARACTERS);
  // Three character gaps share the slack the doubled automatic gap leaves.
  const step = (100 - 40 - 2 * AUTOMATIC_GAP) / 3;
  const xs = placed(line!);
  expect(xs.map(([text]) => text)).toEqual(['漢', '字', 'a', 'b']);
  expect(xs[1]![1]).toBeCloseTo(10 + step, 4);
  expect(xs[2]![1]).toBeCloseTo(20 + 2 * step + 2 * AUTOMATIC_GAP, 4);
  expect(xs[3]![1]).toBeCloseTo(90, 4);
  // A run that resolves no East Asian font opens no automatic gap: three equal steps.
  const [plain] = lines(paragraph('漢字ab', 'distribute'), CHARACTERS);
  expect(placed(plain!).map(([, x]) => x)).toEqual([0, 30, 60, 90]);
});

/** Each visible span's x against its natural x, from its source offset on the line. */
function naturalDrift(line: LineRecord) {
  const visible = line.spans.filter((span) => span.text.trim() !== '');
  const start = visible[0]!.range.start;
  return Math.max(...visible.map((span) => Math.abs(span.box.x - 10 * (span.range.start - start))));
}

test('a justified Korean word keeps its syllables together', () => {
  // A word longer than the 95pt measure breaks; its first line keeps its 5pt of slack.
  const [first] = lines(paragraph('가나다라마바사아자차카타파하', 'both', 100));
  expect(first!.spans.map((span) => span.text).join('')).toBe('가나다라마바사아자');
  expect(naturalDrift(first!)).toBeLessThan(1e-6);
});

test('a justified Korean line stretches only its spaces', () => {
  const [first] = lines(paragraph('가나 다라 마바 사아', 'both'));
  // 20pt of slack over the two spaces between the words.
  expect(placed(first!).filter(([text]) => text.trim() !== '')).toEqual([
    ['가나', 0],
    ['다라', 40],
    ['마바', 80],
  ]);
});

test('a distributed Korean word spreads its syllables', () => {
  for (const styles of [SPACES, CHARACTERS]) {
    const [line] = lines(paragraph('가나다라', 'distribute'), styles);
    expect(placed(line!)).toEqual([
      ['가', 0],
      ['나', 30],
      ['다', 60],
      ['라', 90],
    ]);
  }
});

test('a symbol hinted to the East Asian face takes an East Asian gap', () => {
  const hinted = `<w:p><w:pPr><w:jc w:val="distribute"/></w:pPr><w:r><w:rPr><w:rFonts w:hint="eastAsia" w:eastAsia="MS Mincho"/><w:sz w:val="22"/></w:rPr><w:t>漢“字</w:t></w:r></w:p>`;
  const [line] = lines(hinted);
  expect(line!.spans.find((span) => span.text === '“')?.fontSlot).toBe('eastAsia');
  expect(placed(line!)).toEqual([
    ['漢', 0],
    ['“', 45],
    ['字', 90],
  ]);
});
