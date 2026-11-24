// `setParagraphBorders`: the op that writes a paragraph's own `w:pBdr`.

import { describe, expect, test } from 'bun:test';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import type { ParagraphBorderEdgeWrite, TreeDocOp } from '../store/tree-op-types.ts';
import { bodyStoryRoot, storyParagraphs } from '../index.ts';
import { ADA, apply, part, xml } from './tracked-edit-fixture.ts';

function paragraphId(source: ReturnType<typeof part>): string {
  return storyParagraphs(bodyStoryRoot(source)!)[0]!.id;
}

const BOTTOM: ParagraphBorderEdgeWrite = {
  edge: 'bottom',
  attributes: { val: 'single', sz: '4', space: '1', color: 'auto' },
};

function borders(
  source: ReturnType<typeof part>,
  edges: readonly ParagraphBorderEdgeWrite[],
  extra: Partial<Extract<TreeDocOp, { op: 'setParagraphBorders' }>> = {}
): TreeDocOp {
  return { op: 'setParagraphBorders', paragraphId: paragraphId(source), edges, ...extra };
}

describe('setParagraphBorders', () => {
  test('creates the paragraph properties and the border', () => {
    const before = part('<w:p><w:r><w:t>text</w:t></w:r></w:p>');
    const saved = xml(apply(before, borders(before, [BOTTOM])));
    expect(saved).toContain(
      '<w:pPr><w:pBdr><w:bottom w:color="auto" w:space="1" w:sz="4" w:val="single"/></w:pBdr></w:pPr>'
    );
  });

  test('writes the edges in schema order whatever order the op lists them in', () => {
    const before = part('<w:p><w:r><w:t>text</w:t></w:r></w:p>');
    const saved = xml(
      apply(
        before,
        borders(before, [
          { edge: 'between', attributes: { val: 'dotted' } },
          BOTTOM,
          { edge: 'top', attributes: { val: 'double', sz: '6' } },
          { edge: 'left', attributes: { val: 'nil' } },
        ])
      )
    );
    const order = [...saved.matchAll(/<w:(top|left|bottom|right|between|bar) /g)].map((m) => m[1]);
    expect(order).toEqual(['top', 'left', 'bottom', 'between']);
  });

  test('replaces an existing border and keeps its place in the sequence', () => {
    const before = part(
      '<w:p><w:pPr><w:keepNext/><w:pBdr><w:top w:val="single" w:sz="8"/></w:pBdr>' +
        '<w:shd w:val="clear" w:fill="FFFF00"/><w:jc w:val="center"/></w:pPr>' +
        '<w:r><w:t>text</w:t></w:r></w:p>'
    );
    const saved = xml(apply(before, borders(before, [BOTTOM])));
    expect(saved).toContain(
      '<w:keepNext/><w:pBdr><w:bottom w:color="auto" w:space="1" w:sz="4" w:val="single"/></w:pBdr>' +
        '<w:shd w:fill="FFFF00" w:val="clear"/><w:jc w:val="center"/>'
    );
    expect(saved).not.toContain('<w:top ');
  });

  test('inserts a new border after the properties the schema puts before it', () => {
    const before = part(
      '<w:p><w:pPr><w:pStyle w:val="Body"/><w:keepNext/><w:jc w:val="center"/></w:pPr>' +
        '<w:r><w:t>text</w:t></w:r></w:p>'
    );
    const saved = xml(apply(before, borders(before, [BOTTOM])));
    expect(saved).toMatch(/<w:keepNext\/><w:pBdr>.*<\/w:pBdr><w:jc w:val="center"\/>/);
  });

  test('an empty list removes the border, and the properties when nothing is left', () => {
    const only = part(
      '<w:p><w:pPr><w:pBdr><w:top w:val="single"/></w:pBdr></w:pPr><w:r><w:t>t</w:t></w:r></w:p>'
    );
    expect(xml(apply(only, borders(only, [])))).not.toContain('<w:pPr');
    const kept = part(
      '<w:p><w:pPr><w:pBdr><w:top w:val="single"/></w:pBdr><w:jc w:val="right"/></w:pPr>' +
        '<w:r><w:t>t</w:t></w:r></w:p>'
    );
    const saved = xml(apply(kept, borders(kept, [])));
    expect(saved).toContain('<w:pPr><w:jc w:val="right"/></w:pPr>');
    const plain = part('<w:p><w:r><w:t>t</w:t></w:r></w:p>');
    expect(xml(apply(plain, borders(plain, [])))).toBe(xml(plain));
  });

  test('a tracked write records the old properties, and reject restores them', () => {
    const before = part(
      '<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="8"/></w:pBdr><w:jc w:val="center"/></w:pPr>' +
        '<w:r><w:t>text</w:t></w:r></w:p>'
    );
    const after = apply(before, borders(before, [BOTTOM], { revision: ADA }));
    const saved = xml(after);
    expect(saved).toContain('<w:pPrChange ');
    expect(saved).toMatch(/<w:pPrChange [^>]*><w:pPr><w:pBdr><w:top w:sz="8" w:val="single"\/>/);
    expect(xml(apply(after, { op: 'rejectAllRevisions' }))).toBe(xml(before));
    const accepted = xml(apply(after, { op: 'acceptAllRevisions' }));
    expect(accepted).toContain('<w:bottom w:color="auto" w:space="1" w:sz="4" w:val="single"/>');
    expect(accepted).not.toContain('<w:pPrChange');
  });

  test('a tracked write back to the original leaves no record', () => {
    const before = part('<w:p><w:r><w:t>text</w:t></w:r></w:p>');
    const once = apply(before, borders(before, [BOTTOM], { revision: ADA }));
    const back = apply(once, borders(once, [], { revision: ADA }));
    expect(xml(back)).toBe(xml(before));
  });

  test('a content lock refuses it and a data binding does not', () => {
    const locked = part(
      '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
        '<w:p><w:r><w:t>text</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    expect(applyTreeOp(locked, borders(locked, [BOTTOM]))).toMatchObject({
      ok: false,
      reason: 'locked',
    });
    const bound = part(
      '<w:sdt><w:sdtPr><w:dataBinding w:xpath="/root/a" w:storeItemID="{00000000-0000-0000-0000-000000000001}"/>' +
        '</w:sdtPr><w:sdtContent><w:p><w:r><w:t>text</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    expect(xml(apply(bound, borders(bound, [BOTTOM])))).toContain('<w:pBdr>');
  });

  const refused: readonly [string, unknown][] = [
    ['a missing val', [{ edge: 'bottom', attributes: { sz: '4' } }]],
    ['an unknown edge', [{ edge: 'middle', attributes: { val: 'single' } }]],
    ['a repeated edge', [BOTTOM, BOTTOM]],
    ['an unknown attribute', [{ edge: 'top', attributes: { val: 'single', width: '4' } }]],
    [
      'a prototype key',
      [{ edge: 'top', attributes: JSON.parse('{"val":"single","__proto__":"x"}') }],
    ],
    ['a style that is not a border', [{ edge: 'top', attributes: { val: 'Single' } }]],
    ['markup in a value', [{ edge: 'top', attributes: { val: 'single"/><w:x' } }]],
    ['a width past the schema', [{ edge: 'top', attributes: { val: 'single', sz: '256' } }]],
    ['a negative width', [{ edge: 'top', attributes: { val: 'single', sz: '-1' } }]],
    ['a gap past 31 points', [{ edge: 'top', attributes: { val: 'single', space: '32' } }]],
    ['a colour that is not hex', [{ edge: 'top', attributes: { val: 'single', color: 'red' } }]],
    ['an unknown theme colour', [{ edge: 'top', attributes: { val: 'single', themeColor: 'x' } }]],
    ['a number for a value', [{ edge: 'top', attributes: { val: 'single', sz: 4 } }]],
    ['too many edges', Array.from({ length: 7 }, () => BOTTOM)],
    ['not a list', { edge: 'top' }],
    ['a null edge', [null]],
  ];
  for (const [name, edges] of refused) {
    test(`refuses ${name}`, () => {
      const before = part('<w:p><w:r><w:t>text</w:t></w:r></w:p>');
      const result = applyTreeOp(before, {
        op: 'setParagraphBorders',
        paragraphId: paragraphId(before),
        edges,
      } as unknown as TreeDocOp);
      expect(result.ok).toBe(false);
    });
  }

  test('refuses an invalid revision attribution', () => {
    const before = part('<w:p><w:r><w:t>text</w:t></w:r></w:p>');
    const result = applyTreeOp(
      before,
      borders(before, [BOTTOM], { revision: { author: '' } as never })
    );
    expect(result).toMatchObject({ ok: false, reason: 'invalid-property-value' });
  });

  test('carries an art value and every attribute a producer wrote', () => {
    const before = part('<w:p><w:r><w:t>text</w:t></w:r></w:p>');
    const saved = xml(
      apply(
        before,
        borders(before, [
          {
            edge: 'bar',
            attributes: {
              frame: '1',
              shadow: 'true',
              space: '4',
              sz: '24',
              themeShade: 'BF',
              themeTint: '99',
              themeColor: 'accent1',
              color: '4472C4',
              val: 'apples',
            },
          },
        ])
      )
    );
    expect(saved).toContain(
      '<w:bar w:color="4472C4" w:frame="1" w:shadow="true" w:space="4" w:sz="24"' +
        ' w:themeColor="accent1" w:themeShade="BF" w:themeTint="99" w:val="apples"/>'
    );
  });
});
