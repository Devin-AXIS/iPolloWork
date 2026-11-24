// CJK text breaks at the margin, not at run seams (#526).
//
// A Chinese clause carries no spaces, so under space-only break rules it was one giant
// "word": a single-run paragraph wrapped only through the wider-than-empty-line chop, and a
// clause split across runs wrapped AT THE RUN SEAM — the only "boundary" it had. A numbered
// clause ("1." in one piece, the clause in the next) stranded the number alone on its line,
// because the line was never empty and the chop never ran. UAX #14 instead gives ideographic
// characters a break opportunity on both sides, minus the kinsoku prohibitions: a line must
// not start with a closing mark (。，、」…) and must not end with an opening one (「（…).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { breakParagraph } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** 6pt per character, so a 60pt measure holds exactly ten. */
const measurer = createFixedMeasurer(6, 14);

function paragraph(body: string): OoxmlNode {
  // These tests exercise kinsoku carry, independently of default hanging punctuation.
  body = body.replace('<w:p>', '<w:p><w:pPr><w:overflowPunct w:val="0"/></w:pPr>');
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  const found = result.part.root.children[0]!.children.find((child) => child.kind === 'paragraph');
  if (!found) throw new Error('no paragraph');
  return found;
}

const linesOf = (body: string, width = 60): string[] =>
  breakParagraph(paragraph(body), 'p', 0, width, measurer, undefined, null).map((line) =>
    line.spans.map((span) => span.text).join('')
  );

// The 6pt measurer base describes an 11pt run, so runs author `w:sz="22"` rather than the
// 10pt terminal fallback (see `DEFAULT_RUN_STYLE`), which widens the measure by 11/10.
const run = (text: string) =>
  `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

const LINE_START_FORBIDDEN = /^[。，、；：？！」』）】]/;
const LINE_END_FORBIDDEN = /[「『（【]$/;

describe('CJK text wraps at the column width', () => {
  test('a single all-CJK run fills every line', () => {
    // 24 ideographs at 6pt each against a 60pt measure: ten per line, no chop needed.
    expect(
      linesOf(`<w:p>${run('天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏')}</w:p>`)
    ).toEqual(['天地玄黄宇宙洪荒日月', '盈昃辰宿列张寒来暑往', '秋收冬藏']);
  });

  test('ideographic break opportunities do not fragment the painted spans', () => {
    // Break opportunities between ideographs make every character its own placement
    // candidate; the closed line merges them back, so a clause paints as one span per
    // style run rather than one per character.
    const lines = breakParagraph(
      paragraph(`<w:p>${run('天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏')}</w:p>`),
      'p',
      0,
      60,
      measurer,
      undefined,
      null
    );
    expect(lines.map((line) => line.spans.length)).toEqual([1, 1, 1]);
    expect(lines[0]!.spans[0]!.text).toBe('天地玄黄宇宙洪荒日月');
    expect(lines[0]!.spans[0]!.range).toEqual({ paragraphId: 'p', start: 0, end: 10 });
    expect(lines[0]!.spans[0]!.box.width).toBeCloseTo(60, 5);
  });

  test('a CJK clause split across runs wraps at the margin, not at the run seam (#526)', () => {
    // Seven ideographs per run. Under space-only rules the seam was the only boundary, so
    // the first line carried seven characters and the margin was ignored.
    expect(linesOf(`<w:p>${run('天地玄黄宇宙洪')}${run('荒日月盈昃辰宿')}</w:p>`)).toEqual([
      '天地玄黄宇宙洪荒日月',
      '盈昃辰宿',
    ]);
  });

  test('a numbered clause fills its first line instead of stranding the number', () => {
    // "1." in its own piece, the clause in the next — the shape the eastAsia font-slot split
    // produces for 「1.甲方…」. The number must stay glued to the first ideograph (no break
    // between "." and 甲) and the line must fill to the measure.
    const lines = linesOf(`<w:p>${run('1.')}${run('甲方必须遵守安全管理规定')}</w:p>`);
    expect(lines).toEqual(['1.甲方必须遵守安全', '管理规定']);
  });
});

describe('kinsoku prohibitions', () => {
  test('a closing mark never opens a line; its carrier wraps down with it', () => {
    // Ten ideographs fill the line exactly, and the eleventh character is 、 — breaking
    // before it would fit ten but start the next line with the mark, so 月 wraps down too.
    expect(linesOf(`<w:p>${run('天地玄黄宇宙洪荒日月、盈昃辰宿')}</w:p>`)).toEqual([
      '天地玄黄宇宙洪荒日',
      '月、盈昃辰宿',
    ]);
  });

  test('an opening bracket never ends a line; it wraps down to its content', () => {
    expect(linesOf(`<w:p>${run('天地玄黄宇宙洪荒日「月盈昃辰宿')}</w:p>`)).toEqual([
      '天地玄黄宇宙洪荒日',
      '「月盈昃辰宿',
    ]);
  });

  test('no wrap position violates kinsoku across a punctuated paragraph', () => {
    // Every measure holds the widest group, ０．５％。 at 30 pt. A narrower one cuts the
    // groups wider than it (kinsoku-oversized-group).
    const text =
      '甲方（以下简称「买方」）应当按照本合同第３条、第４条之约定，向乙方支付全部价款。逾期未付的，每日加收０．５％。';
    for (const width of [30, 36, 48, 60, 72, 90]) {
      const lines = linesOf(`<w:p>${run(text)}</w:p>`, width);
      expect(lines.join('')).toBe(text);
      for (const line of lines) {
        expect(line).not.toMatch(LINE_START_FORBIDDEN);
        expect(line).not.toMatch(LINE_END_FORBIDDEN);
      }
    }
  });

  test('a literal space before a full-width comma no longer forces a premature break', () => {
    // The authored-space shape 「…职责 ，因此…」: the space boundary sits directly before 、
    // a closing mark, which used to hand the comma's whole tail to the next line and close
    // this one seven characters early. The space stays a break opportunity everywhere else;
    // only the position directly before the comma is vetoed.
    expect(linesOf(`<w:p>${run('安全管理职责 ，因此甲乙双方')}</w:p>`)).toEqual([
      '安全管理职责 ，因此',
      '甲乙双方',
    ]);
  });
});

describe('kinsoku beside tabs and inside the chop', () => {
  test('a tab keeps its stop when a no-break-before character follows it', () => {
    // The ー veto must not cancel the forced word-open a tab grants: with it cancelled,
    // an overflow at ー took the mid-word carry, re-laid the tab with a stale advance
    // that no longer reached its stop, and closed the first line seven characters early.
    const body = `<w:p>${run('AA BBBB')}<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:tab/></w:r>${run('ー天地玄黄宇宙洪')}</w:p>`;
    // The stop at the edge keeps the tab on the first line.
    const edgeStop = {
      stops: [{ positionPt: 60, alignment: 'left' as const }],
      defaultIntervalPt: 36,
    };
    const lines = breakParagraph(
      paragraph(body),
      'p',
      0,
      60,
      measurer,
      undefined,
      null,
      [],
      edgeStop
    );
    expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
      'AA BBBB\t',
      'ー天地玄黄宇宙洪',
    ]);
    const tab = lines[0]!.spans.find((span) => span.text === '\t')!;
    expect(tab.box.x + tab.box.width).toBeCloseTo(60, 5);
  });

  test('unit signs outside the ideographic ranges cannot change Latin wrapping', () => {
    // ‰ ′ ″ ℃ appear in ordinary scientific prose; while they sat in the no-break-before
    // set the veto applied with no East Asian context at all, and 'aa bb ℃cccc' wrapped
    // differently from 'aa bb Ccccc' against the byte-identical guarantee.
    expect(linesOf(`<w:p>${run('aa bb ℃cccc')}</w:p>`)).toEqual(['aa bb ', '℃cccc']);
  });

  test('the ideographic space and the middle dot never open a line', () => {
    expect(linesOf(`<w:p>${run('天地玄黄宇宙洪荒日月　盈昃')}</w:p>`)).toEqual([
      '天地玄黄宇宙洪荒日',
      '月　盈昃',
    ]);
    expect(linesOf(`<w:p>${run('天地玄黄宇宙洪荒日月・盈昃')}</w:p>`)).toEqual([
      '天地玄黄宇宙洪荒日',
      '月・盈昃',
    ]);
  });

  test('half-width katakana wraps at the margin, not the run seam', () => {
    expect(linesOf(`<w:p>${run('ｱｲｳｴｵｶｷｸ')}${run('ｹｺｻｼｽｾｿﾀ')}</w:p>`)).toEqual([
      'ｱｲｳｴｵｶｷｸｹｺ',
      'ｻｼｽｾｿﾀ',
    ]);
  });

  test('the half-width prolonged-sound mark never opens a line', () => {
    // ｰ sat in the no-break-before set but outside every ideographic range, so no
    // boundary could reach it; its carrier must wrap down with it.
    expect(linesOf(`<w:p>${run('ｱｲｳｴｵｶｷｸｹｺｰｻｼ')}</w:p>`)).toEqual(['ｱｲｳｴｵｶｷｸｹ', 'ｺｰｻｼ']);
  });

  test('NFD kana never orphans its combining voicing mark', () => {
    const nfd = 'あ' + 'が'.repeat(7);
    const lines = linesOf(`<w:p>${run(nfd)}</w:p>`, 54);
    expect(lines.join('')).toBe(nfd);
    for (const line of lines) expect(line.charCodeAt(0)).not.toBe(0x3099);
  });

  test('a kinsoku group holds at a two-character measure and is cut at a one-character one', () => {
    expect(linesOf(`<w:p>${run('天。地。人。')}</w:p>`, 13)).toEqual(['天。', '地。', '人。']);
    // Wider than its whole line, the group is cut where it stops fitting.
    expect(linesOf(`<w:p>${run('天。地。人。')}</w:p>`, 7)).toEqual([
      '天',
      '。',
      '地',
      '。',
      '人',
      '。',
    ]);
  });

  test('a protected group split across runs never breaks at the run seam', () => {
    // The group starts the line and fits it, so it stays whole, as the same text in ONE run
    // does. Before this, the overflow branch closed the line at the seam and the veto never
    // applied: a line opened on 、 and one ended on （.
    // A no-break-before character behind the seam.
    expect(linesOf(`<w:p>${run('月')}${run('、盈')}</w:p>`, 13)).toEqual(['月、', '盈']);
    // A no-break-after character in front of it.
    expect(linesOf(`<w:p>${run('（')}${run('以来')}</w:p>`, 13)).toEqual(['（以', '来']);
    // The half-width prolonged-sound mark, reachable only since the range covers ｰ.
    expect(linesOf(`<w:p>${run('ア')}${run('ｰ月')}</w:p>`, 13)).toEqual(['アｰ', '月']);
    // On a one-character line each group is wider than the line and is cut at the seam.
    expect(linesOf(`<w:p>${run('月')}${run('、盈')}</w:p>`, 7)).toEqual(['月', '、', '盈']);
    expect(linesOf(`<w:p>${run('ア')}${run('ｰ月')}</w:p>`, 7)).toEqual(['ア', 'ｰ', '月']);
  });

  test('a grapheme cluster split across runs never orphans its combining mark', () => {
    // U+3099 is inside the ideographic ranges and outside both kinsoku sets, so the seam
    // reads as an ordinary ideographic break opportunity. `wordBoundaries` filters cuts
    // through `segmentGraphemes`, but a cluster split across pieces has no single text to
    // segment: the two code points around the seam are segmented on their own.
    for (const width of [7, 13]) {
      const lines = linesOf(`<w:p>${run('か')}${run('\u3099月')}</w:p>`, width);
      expect(lines.join('')).toBe('か\u3099月');
      for (const line of lines) expect(line.charCodeAt(0)).not.toBe(0x3099);
    }
  });

  test('a Latin word split across runs still chops at the margin', () => {
    // The other reason a candidate cannot open a line. A word wider than its line has no
    // legal cut of its own and IS chopped; only a group a rule protects is pushed out.
    expect(linesOf(`<w:p>${run('01234')}${run('56789ABCDE')}</w:p>`, 25)).toEqual([
      '0123',
      '4567',
      '89AB',
      'CDE',
    ]);
  });

  test('the chop never cuts inside a surrogate pair', () => {
    const text = '𠀋𠀌𠀍𠀎';
    const lines = linesOf(`<w:p>${run(text)}</w:p>`, 13);
    expect(lines.join('')).toBe(text);
    for (const line of lines) expect(line.length % 2).toBe(0);
  });
});

describe('span merging under decorations', () => {
  // decorationsMatch works by reference equality, which holds only because placement
  // passes piece.revisions / piece.link through without copying — these pin that a
  // defensive copy on that path cannot silently return CJK to one span per ideograph.
  test('a tracked-insert CJK run still paints one span per line', () => {
    const ins = `<w:ins w:id="1" w:author="QA" w:date="2026-03-26T11:00:00Z">${run('天地玄黄宇宙洪荒日月盈昃辰宿')}</w:ins>`;
    const lines = breakParagraph(
      paragraph(`<w:p>${ins}</w:p>`),
      'p',
      0,
      60,
      measurer,
      undefined,
      null
    );
    expect(lines.map((line) => line.spans.length)).toEqual([1, 1]);
    expect(lines[0]!.spans[0]!.revisions?.length).toBe(1);
  });

  test('a hyperlinked CJK run still paints one span per line', () => {
    const body = `<w:p><w:hyperlink w:anchor="top">${run('天地玄黄宇宙洪荒日月盈昃辰宿')}</w:hyperlink></w:p>`;
    const lines = breakParagraph(
      paragraph(body),
      'p',
      0,
      60,
      measurer,
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      { projectLink: () => ({ id: 'link', kind: 'internal', href: '#top', anchor: 'top' }) }
    );
    expect(lines.map((line) => line.spans.length)).toEqual([1, 1]);
    expect(lines[0]!.spans[0]!.link).toBeDefined();
  });
});

describe('layout-owned pieces', () => {
  test('a CJK field result wraps at the measure without per-ideograph spans', () => {
    // Every span of a layout-owned piece publishes the piece's whole model range, so a
    // per-ideograph split painted dozens of spans all claiming the same range. An oversized
    // result is cut once per line instead, inside the measure.
    const result = '二〇二六年八月三十日签署完成生效';
    const body = `<w:p><w:fldSimple w:instr=" DATE "><w:r><w:t>${result}</w:t></w:r></w:fldSimple></w:p>`;
    const lines = breakParagraph(paragraph(body), 'p', 0, 60, measurer, undefined, null);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((line) => line.spans.length)).toEqual(lines.map(() => 1));
    expect(lines.map((line) => line.spans[0]!.text).join('')).toBe(result);
    for (const line of lines) expect(line.width).toBeLessThanOrEqual(60.01);
  });
});

describe('Latin behaviour is unchanged', () => {
  test('spaces stay the only boundary inside Latin text', () => {
    expect(linesOf(`<w:p>${run('aaa ')}${run('bbbbb')}${run('ccccc')}</w:p>`)).toEqual([
      'aaa ',
      'bbbbbccccc',
    ]);
  });

  test('a Latin word beside CJK stays whole while the CJK wraps freely', () => {
    const source = '天地玄黄ABCD宇宙洪荒日月盈';
    const body = `<w:p>${run(source)}</w:p>`;
    const automatic = breakParagraph(paragraph(body), 'p', 0, 60, measurer, undefined, null);
    expect(automatic.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
      '天地玄黄ABCD宇',
      '宙洪荒日月盈',
    ]);
    // The fixed measurer has no authored reverse metric. Only the 11/4 forward gap applies.
    expect(automatic[0]!.width).toBeCloseTo(9 * 6 + 11 / 4, 8);
    const latin = automatic[0]!.spans.find((span) => span.text === 'ABCD')!;
    expect(latin.range).toEqual({ paragraphId: 'p', start: 4, end: 8 });
    expect(latin.box.width).toBeCloseTo(24, 8);
    expect(automatic[0]!.spans[0]!.box.x).toBeCloseTo(0, 8);
    expect(latin.box.x - automatic[0]!.spans[0]!.box.x).toBeCloseTo(4 * 6 + 11 / 4, 8);
    const following = automatic[0]!.spans.find((span) => span.range.start === 8)!;
    expect(following.box.x - latin.box.x - latin.box.width).toBeCloseTo(0, 8);
    for (const line of automatic) {
      expect(line.width).toBeLessThanOrEqual(60);
      for (const span of line.spans)
        expect(span.text).toBe(source.slice(span.range.start, span.range.end));
    }
    expect(
      automatic
        .flatMap((line) => line.spans)
        .map((span) => span.text)
        .join('')
    ).toBe(source);
    expect(automatic.at(-1)!.spans.at(-1)!.range.end).toBe(source.length);
    // An authored false preserves the complete old wrapping contract, without changing text.
    const original = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:overflowPunct w:val="0"/><w:autoSpaceDE w:val="0"/></w:pPr>${run(source)}</w:p></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!original.ok) throw new Error(original.reason);
    const p = original.part.root.children[0]!.children.find((child) => child.kind === 'paragraph')!;
    const disabled = breakParagraph(p, 'p', 0, 60, measurer, undefined, null);
    expect(disabled.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
      '天地玄黄ABCD宇宙',
      '洪荒日月盈',
    ]);
    expect(disabled[0]!.width).toBeCloseTo(60, 8);
    for (const line of disabled)
      for (const span of line.spans)
        expect(span.text).toBe(source.slice(span.range.start, span.range.end));
  });
});
