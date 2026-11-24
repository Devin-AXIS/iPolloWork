import { describe, expect, test } from 'bun:test';
import { writeOoxmlPackage, readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { loadFixture, sample, measurer } from './punctuation-kerning-fixture.ts';
import { canonicalOoxmlFingerprint, type OoxmlNode } from '../../store/package/ooxml-tree.ts';
import { semanticDigest } from '../../store/package/ooxml-digest.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const controls = [
  undefined,
  'doNotCompress',
  'compressPunctuation',
  'compressPunctuationAndJapaneseKana',
] as const;

describe('real DOCX fixture punctuation layout', () => {
  for (const compatibility of [14, 15] as const)
    for (const compression of controls)
      for (const kern of [undefined, 0, 2, 60])
        for (const noPunctuation of [false, true])
          test(`mode ${compatibility}, control ${compression}, kern ${kern}, disable ${noPunctuation}`, () => {
            const result = loadFixture({ compatibility, compression, kern, noPunctuation });
            expect(result.lines).toHaveLength(1);
            expect(result.lines[0]!.spans.map((span) => span.text).join('')).toBe(sample);
            expect(result.width).toBe(kern === 2 && !noPunctuation ? 276 : 360);
            expect(
              [...result.view.currentPackage().parts].map(([name, part]) => [
                name,
                JSON.stringify(part.root),
              ])
            ).toEqual(result.before);
          });

  test.each(['」「', '）」', '（「', '、。', '：（', '】【'])(
    'pair class %s crosses every run seam',
    (pair) => {
      const text = '国' + pair + '国国';
      for (let split = 1; split < text.length; split++) {
        expect(loadFixture({ text, split, kern: 2 }).width).toBe(108);
        expect(loadFixture({ text, split, kern: 2, secondKern: 60 }).width).toBe(
          split <= 2 ? 120 : 108
        );
      }
    }
  );

  test.each([
    'SimSun',
    'MS Mincho',
    'MS Gothic',
    'SimHei',
    'Yu Mincho',
    'PMingLiU',
    'Meiryo',
    'Batang',
    'Malgun Gothic',
  ])('East Asian default face %s turns on pair compression', (face) => {
    expect(loadFixture({ text: '国」「国国', kern: 2, face, defaultFace: face }).width).toBe(108);
    // The run's own face does not matter; the document default decides.
    expect(loadFixture({ text: '国」「国国', kern: 2, defaultFace: face }).width).toBe(108);
  });

  test.each(['Arial', 'Times New Roman', 'A Source Face'])(
    'default face %s without an East Asian font table charset keeps natural advances',
    (face) => {
      expect(loadFixture({ text: '国」「国国', kern: 2, defaultFace: face }).width).toBe(120);
    }
  );

  test('an unknown default face counts as East Asian through its font table charset', () => {
    const entry = (name: string, charset: string) => ({
      text: '国」「国国',
      kern: 2,
      defaultFace: name,
      fontTableEntry: { name, charset },
    });
    for (const charset of ['80', '81', '86', '88'])
      expect(loadFixture(entry('A Source Face', charset)).width).toBe(108);
    expect(loadFixture(entry('A Source Face', '00')).width).toBe(120);
    // A known Latin face keeps its own character set.
    expect(loadFixture(entry('Arial', '80')).width).toBe(120);
  });

  test('open+close, Korean, absent source defaults and inactive runs keep natural advances', () => {
    expect(loadFixture({ text: '国（）国国', kern: 2 }).width).toBe(120);
    expect(loadFixture({ text: '国」「国国', kern: 2, language: 'ko-KR' }).width).toBe(120);
    expect(loadFixture({ text: '国」「国国', kern: 2, defaultFace: null }).width).toBe(120);
    expect(loadFixture({ text: '国」「国国', kern: 2, split: 2, secondKern: 0 }).width).toBe(120);
  });

  test('bold, italic, split faces and finite authored tracking retain the pair rule', () => {
    for (const tracking of [-4, 0, 4]) {
      const result = loadFixture({
        text: '国」「国国',
        kern: 2,
        tracking,
        bold: true,
        italic: true,
        split: 2,
        secondFace: 'MS Mincho',
      });
      expect(result.width).toBeCloseTo(108 + (5 * tracking) / 20, 8);
      expect(result.lines[0]!.spans.filter((span) => span.text.includes('」'))[0]!.style.bold).toBe(
        true
      );
    }
    const decorated = loadFixture({ text: '国」「国国', kern: 2, underlineElsewhere: true });
    const spans = decorated.lines[0]!.spans;
    const pairSpans = spans.filter((span) => span.range.end <= 5);
    expect(pairSpans.map((span) => span.text).join('')).toBe('国」「国国');
    expect(pairSpans.reduce((width, span) => width + span.box.width, 0)).toBe(108);
    const underlined = spans.find((span) => span.range.start === 5 && span.range.end === 6)!;
    expect(underlined.text).toBe('字');
    expect(underlined.style.underline).not.toBeNull();
    expect(underlined.box.width).toBe(measurer.measure('字', underlined.style));
    expect(decorated.width).toBe(108 + underlined.box.width);
  });

  test('kana keeps natural advances on fitting and overflowing lines', () => {
    const result = loadFixture({ text: 'アイ', compression: 'compressPunctuationAndJapaneseKana' });
    expect(result.width).toBe(48);
    const full = loadFixture({
      text: 'アイ',
      available: 45,
      compression: 'compressPunctuationAndJapaneseKana',
    });
    expect(full.lines).toHaveLength(2);
    expect(full.lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
      'ア',
      'イ',
    ]);
    expect(full.width).toBe(24);
  });

  test('disabled false values and raw package save/reopen retain source properties', () => {
    for (const noPunctuation of ['0', 'false', 'off'])
      expect(loadFixture({ text: '国」「国国', kern: 2, noPunctuation }).width).toBe(108);
    const result = loadFixture({ text: '国」「国国', kern: 2, tracking: -4 });
    const saved = readOoxmlPackage(writeOoxmlPackage(result.view.currentPackage()));
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.reason);
    const source = result.view.currentPackage();
    const fingerprints = (pkg: typeof source) =>
      [...pkg.parts]
        .map(([name, part]) => [name, canonicalOoxmlFingerprint(part)])
        .sort(([left], [right]) => left!.localeCompare(right!));
    expect(fingerprints(saved.package)).toEqual(fingerprints(source));
    expect(semanticDigest(saved.package.parts.values())).toEqual(
      semanticDigest(source.parts.values())
    );
    const values = (partName: string, element: string, attribute: string) => {
      const found: string[] = [];
      const visit = (node: OoxmlNode) => {
        if (!('children' in node)) return;
        if (node.namespaceUri === W && node.localName === element)
          for (const attr of node.attributes)
            if (attr.namespaceUri === W && attr.localName === attribute) found.push(attr.value);
        for (const child of node.children) visit(child);
      };
      visit(saved.package.parts.get(partName)!.root);
      return found;
    };
    expect(values('/word/document.xml', 'kern', 'val')).toEqual(['2']);
    expect(values('/word/document.xml', 'spacing', 'val')).toEqual(['-4']);
    expect(values('/word/document.xml', 'sz', 'val')).toEqual(['48']);
    expect(values('/word/document.xml', 'rFonts', 'ascii')).toEqual(['Yu Mincho']);
    expect(values('/word/styles.xml', 'rFonts', 'eastAsia')).toEqual(['Yu Mincho']);
    expect(values('/word/settings.xml', 'noPunctuationKerning', 'val')).toEqual([]);
    expect(
      semanticDigest(saved.package.parts.values())
        .stories.find((story) => story.partName === source.mainDocumentPart)!
        .paragraphs.map((paragraph) => paragraph.text)
    ).toEqual(['\u56fd\u300d\u300c\u56fd\u56fd']);
  });
});
