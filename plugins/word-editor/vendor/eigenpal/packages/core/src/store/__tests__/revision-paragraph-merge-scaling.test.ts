// How the paragraph join after a tracked-change decision GROWS with the length of the body.
//
// The join runs over every block of the container that holds a decided paragraph mark, so in a
// long body it walks thousands of blocks for one decision. Two of its loops once asked about
// the rest of the list per block (the blocks after an emptied paragraph, the last block written
// so far), which made a decision in a long body quadratic.
//
// Like `clipboard-fragment-dos.test.ts`, the guard measures the shape of the curve, not the
// clock: the same join at two sizes, 16x apart, and a slow machine slows both measurements
// together. Measured here, linear work grew by about 11x to 16x and the quadratic join by
// about 170x. A 16x step, not 8x: at 8x the quadratic join read only 42x, too close to the
// tail linear work reaches on a loaded runner.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { mergeRevisionParagraphs } from '../store/revision-paragraph-merge.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** The size step between the two measurements. Linear grows by this; quadratic by its square. */
const SIZE_FACTOR = 16;
/** Clear of both shapes: linear lands near 16x, quadratic far above. */
const NEAR_LINEAR_GROWTH = SIZE_FACTOR * 4;

/**
 * A body of `pairs` emptied paragraphs, each followed by a block content control, and a last
 * paragraph. A paragraph before a block control has nothing to join, so each emptied one asks
 * whether more text follows it.
 */
function body(pairs: number): OoxmlNode[] {
  const blocks: string[] = [];
  for (let index = 0; index < pairs; index += 1)
    blocks.push(
      `<w:p/><w:sdt><w:sdtContent><w:p><w:r><w:t>Control ${index}</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
  blocks.push('<w:p><w:r><w:t>End</w:t></w:r></w:p>');
  const read = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${blocks.join('')}</w:body></w:document>`
      ),
    })
  );
  if (!read.ok) throw new Error(read.reason);
  const root = read.package.parts.get('/word/document.xml')?.root;
  const bodyNode = root?.children.find((n) => n.kind !== 'textValue' && n.localName === 'body');
  if (!bodyNode || bodyNode.kind === 'textValue') throw new Error('no body');
  return [...bodyNode.children];
}

/** The emptied paragraphs: every paragraph directly in the body but the last. */
function emptiedMarks(children: readonly OoxmlNode[]): Set<string> {
  const paragraphs = children.filter((n) => n.kind === 'paragraph');
  return new Set(paragraphs.slice(0, -1).map((n) => n.id));
}

/** The fastest of several runs, in milliseconds; noise only ever adds time. */
function fastestMs(pairs: number, repeats = 5): number {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < repeats; attempt += 1) {
    const children = body(pairs);
    const marks = emptiedMarks(children);
    let next = 0;
    Bun.gc(true);
    const start = performance.now();
    mergeRevisionParagraphs(children, marks, () => `minted-${next++}`, false, 'body');
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe('the paragraph join after a decision', () => {
  test('drops each emptied paragraph before a block control and keeps the rest', () => {
    const children = body(3);
    const out = mergeRevisionParagraphs(
      children,
      emptiedMarks(children),
      () => 'minted',
      false,
      'body'
    );
    expect(out.map((n) => n.kind)).toEqual([
      'contentControl',
      'contentControl',
      'contentControl',
      'paragraph',
    ]);
  });

  test('grows linearly with the length of the body', () => {
    fastestMs(200, 2); // Warm the JIT outside the measurement.
    const small = fastestMs(1000);
    const large = fastestMs(1000 * SIZE_FACTOR, 3);
    expect(large / Math.max(small, 0.05)).toBeLessThan(NEAR_LINEAR_GROWTH);
  });
});
