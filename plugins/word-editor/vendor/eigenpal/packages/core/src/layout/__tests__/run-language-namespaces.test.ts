import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { propertiesOfRunContainer } from '../field-run-text.ts';
import { eastAsianLanguage } from '../cjk-typography.ts';
import {
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  cascadeRunProperties,
} from '../style-cascade.ts';
import { piecesOfParagraph } from '../field-projection.ts';
import { canHangCjkPunctuation } from '../cjk-spacing.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const bindings = 'xmlns:w="' + W + '" xmlns:x="' + W + '" xmlns:e="urn:foreign"';
function part(xml: string, name = '/word/document.xml') {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const props = (inner: string) =>
  propertiesOfRunContainer(part('<w:rPr ' + bindings + '>' + inner + '</w:rPr>').root);

describe('run language namespace boundaries', () => {
  const cases: readonly [string, string, string | undefined][] = [
    ['qualified east Asia language', '<w:lang w:eastAsia="zh-CN"/>', 'zh-cn'],
    ['another prefix for the WordprocessingML namespace', '<x:lang x:eastAsia="ja-JP"/>', 'ja-jp'],
    ['foreign language element', '<e:lang w:eastAsia="zh-CN"/>', undefined],
    ['foreign language and attribute', '<e:lang e:eastAsia="zh-CN"/>', undefined],
    ['foreign east Asia attribute', '<w:lang e:eastAsia="zh-CN"/>', undefined],
    ['unqualified east Asia attribute', '<w:lang eastAsia="zh-CN"/>', undefined],
    ['foreign primary language attribute', '<w:lang e:val="zh-CN"/>', undefined],
    [
      'foreign attribute after the qualified one',
      '<w:lang w:eastAsia="ja-JP" e:eastAsia="zh-CN"/>',
      'ja-jp',
    ],
    [
      'foreign attribute before the qualified one',
      '<w:lang e:eastAsia="zh-CN" w:eastAsia="ja-JP"/>',
      'ja-jp',
    ],
  ];
  for (const [label, xml, expected] of cases)
    test(label, () => expect(eastAsianLanguage(props(xml))).toBe(expected));

  for (const level of ['defaults', 'paragraph', 'character', 'direct'] as const) {
    test('foreign language does not replace the qualified language at ' + level, () => {
      const foreign = '<e:lang e:eastAsia="zh-CN"/>';
      const styles = part(
        '<w:styles ' +
          bindings +
          '><w:docDefaults><w:rPrDefault><w:rPr><w:lang w:eastAsia="ja-JP"/>' +
          (level === 'defaults' ? foreign : '') +
          '</w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="P"><w:rPr>' +
          (level === 'paragraph' ? foreign : '') +
          '</w:rPr></w:style><w:style w:type="character" w:styleId="C"><w:rPr>' +
          (level === 'character' ? foreign : '') +
          '</w:rPr></w:style></w:styles>',
        '/word/styles.xml'
      );
      const table = buildStyleCascadeTable(styles.root);
      const pPr = part('<w:pPr ' + bindings + '><w:pStyle w:val="P"/></w:pPr>').root;
      const inherited = cascadeParagraphFormatting(table, pPr).runProperties;
      const direct = props('<w:rStyle w:val="C"/>' + (level === 'direct' ? foreign : ''));
      expect(eastAsianLanguage(cascadeRunProperties(inherited, direct, table))).toBe('ja-jp');
    });
  }
  test('property qualification does not mutate opaque canonical XML', () => {
    const document = part(
      '<w:rPr ' +
        bindings +
        '><w:lang w:eastAsia="ja-JP" e:eastAsia="zh-CN"/><e:lang e:val="zh-CN"/><e:opaque e:keep="exact"><e:child/></e:opaque></w:rPr>'
    );
    const before = serializeOoxmlPart(document);
    propertiesOfRunContainer(document.root);
    expect(serializeOoxmlPart(document)).toBe(before);
    expect(before).toContain('e:opaque');
  });
  test('qualified language admits the ordinary punctuation tail through the actual collector', () => {
    const document = part(
      '<w:p ' +
        bindings +
        '><w:r><w:rPr><x:lang x:eastAsia="zh-CN"/></w:rPr><w:t>A.</w:t></w:r></w:p>'
    );
    const before = serializeOoxmlPart(document);
    const pieces = piecesOfParagraph(document.root);
    expect(pieces.map((piece) => piece.text).join('')).toBe('A.');
    const piece = pieces.at(-1)!;
    expect(piece.text.endsWith('.')).toBe(true);
    const measurer = createFixedMeasurer(6, 14);
    const width = measurer.measure(piece.text, piece.style);
    const remaining = measurer.measure(piece.text.slice(0, -1), piece.style);
    expect(canHangCjkPunctuation(piece.text, piece, remaining, width, measurer)).toBe(true);
    expect(serializeOoxmlPart(document)).toBe(before);
  });
  test('foreign language cannot admit an ordinary punctuation tail', () => {
    for (const language of [
      '<e:lang e:eastAsia="zh-CN"/>',
      '<w:lang e:eastAsia="zh-CN"/>',
      '<w:lang eastAsia="zh-CN"/>',
    ]) {
      const document = part(
        '<w:p ' + bindings + '><w:r><w:rPr>' + language + '</w:rPr><w:t>A.</w:t></w:r></w:p>'
      );
      const pieces = piecesOfParagraph(document.root);
      expect(pieces.map((piece) => piece.text).join('')).toBe('A.');
      const piece = pieces.at(-1)!;
      const measurer = createFixedMeasurer(6, 14);
      const width = measurer.measure(piece.text, piece.style);
      const remaining = measurer.measure(piece.text.slice(0, -1), piece.style);
      expect(canHangCjkPunctuation(piece.text, piece, remaining, width, measurer)).toBe(false);
    }
  });
  test('the projected field cache keeps its atomic source range and conservative hanging', () => {
    const document = part(
      '<w:p ' +
        bindings +
        '><w:fldSimple w:instr="MERGEFIELD Name"><w:r><w:rPr><w:lang w:eastAsia="zh-CN"/><e:lang e:eastAsia="ko-KR"/></w:rPr><w:t>A.</w:t></w:r></w:fldSimple></w:p>'
    );
    const before = serializeOoxmlPart(document);
    const piece = piecesOfParagraph(document.root)[0]!;
    expect(piece.projected).toBe(true);
    expect(piece.end - piece.start).toBe(1);
    expect(canHangCjkPunctuation(piece.text, piece, 6, 12, createFixedMeasurer(6, 14))).toBe(false);
    expect(serializeOoxmlPart(document)).toBe(before);
  });
});
