// Incremental layout of long `w:keepNext` chains (§17.3.1.15).
//
// A kept paragraph reads every member of its chain and whether the story ends inside it.
// Its flow key covers those dependencies, or an
// edit to a member far down a long chain resumes after a block whose decision it changed.
//
// The page is 350pt by 210pt with 20pt margins: the body holds twelve exact 14pt lines.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, TreeDocumentStore, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { keepNextFlowKeys } from '../pagination-keeps.ts';
import type { PageGeometry, PageRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const GEOMETRY: PageGeometry = {
  width: 350,
  height: 210,
  margin: { top: 20, right: 20, bottom: 20, left: 20 },
};
const SPACING = '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>';
const KEEP_NEXT = '<w:keepNext/>';
const FRAME = '<w:framePr w:w="2000" w:x="400" w:y="600"/>';

/** One paragraph of `count` lines named `${name}1` to `${name}N`, via hard breaks. */
const para = (name: string, count: number, pPr = '') => {
  const runs = Array.from({ length: count }, (_, i) => `<w:t>${name}${i + 1}</w:t>`);
  return `<w:p><w:pPr>${pPr}${SPACING}</w:pPr><w:r>${runs.join('<w:br/>')}</w:r></w:p>`;
};

/** One kept paragraph of wrapping words, `chars` characters long. */
const words = (chars: number) => {
  const text = 'six '.repeat(Math.ceil(chars / 4)).slice(0, chars);
  return `<w:p><w:pPr>${KEEP_NEXT}${SPACING}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
};

/**
 * Nine lines of filler, then twelve kept members K0 to K11 and a one-line tail. K3 has four
 * lines and K6 wraps; the others have one line. `frameAfter` puts a positioned frame after
 * that member, inside the chain.
 */
const longChain = (k6Chars: number, frameAfter?: number) => {
  const members = Array.from({ length: 12 }, (_, i) => {
    const member = i === 6 ? words(k6Chars) : para(`K${i}_`, i === 3 ? 4 : 1, KEEP_NEXT);
    return i === frameAfter ? member + para('FRAME', 1, FRAME) : member;
  });
  return para('P', 9) + members.join('') + para('T', 1);
};

const lay = (part: OoxmlPart, revision: number, extra = {}) =>
  layoutSemanticDocument(part, revision, { measurer, geometry: GEOMETRY, ...extra });

/** The visible line texts of each page, in order. */
const pageLines = (pages: readonly PageRecord[]): string[][] =>
  pages.map((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => {
            const text = line.spans
              .map((span) => span.text)
              .join('')
              .trim();
            return text === '' ? [] : [text];
          })
        : []
    )
  );

/** The id of the body paragraph whose text starts with `prefix`. */
const paragraphId = (part: OoxmlPart, prefix: string) => {
  const body = part.root.children.find((child) => child.kind === 'body');
  if (body?.kind !== 'body') throw new Error('The fixture has no body.');
  for (const child of body.children) {
    if (child.kind !== 'paragraph') continue;
    const text = JSON.stringify(child);
    if (text.includes(`"${prefix}`)) return child.id;
  }
  throw new Error(`No paragraph starts with ${prefix}.`);
};

/**
 * Lay out `k6From` characters in K6 over a retained session, then edit K6 to `k6To`
 * characters and lay out again. Each retained pass must equal a cold layout.
 */
const editMember = (k6From: number, k6To: number, extra: object, frameAfter?: number) => {
  const store = new TreeDocumentStore(load(longChain(k6From, frameAfter)));
  const session = createLayoutSession();
  lay(store.part, 1, { ...extra, session });
  const id = paragraphId(store.part, 'six');
  const result = store.transact((tx) => {
    tx.apply(
      k6To > k6From
        ? { op: 'insertText', paragraphId: id, offset: 0, text: 'six '.repeat((k6To - k6From) / 4) }
        : { op: 'deleteText', paragraphId: id, start: 0, end: k6From - k6To }
    );
  });
  expect(result.ok).toBe(true);
  const retained = pageLines(lay(store.part, 2, { ...extra, session }).pages);
  const cold = pageLines(lay(structuredClone(store.part), 2, extra).pages);
  const reference = pageLines(lay(load(longChain(k6To, frameAfter)), 1, extra).pages);
  expect(retained).toEqual(cold);
  expect(cold).toEqual(reference);
  return retained;
};

describe('an edit far down a long keep-next chain re-places the chain head', () => {
  for (const [mode, extra] of [
    ['legacy', {}],
    ['Word 2013', { compatibilityMode: 15 }],
  ] as const) {
    test(`${mode}: growing member K6 matches a cold layout`, () => {
      const pages = editMember(152, 600, extra);
      // The edit moves K0 to K2 off page 1, which a stale head decision would keep.
      expect(pages[0]).not.toContain('K0_1');
    });

    test(`${mode}: shrinking member K6 matches a cold layout`, () => {
      const pages = editMember(600, 152, extra);
      expect(pages[0]).toContain('K0_1');
    });

    test(`${mode}: a positioned frame inside the chain does not hide the edit`, () => {
      editMember(152, 600, extra, 2);
      editMember(600, 152, extra, 2);
    });
  }
});

describe('keepNextFlowKeys covers each complete keep chain', () => {
  const allKept = () => true;

  test('each kept block carries the raw keys of the members it prices', () => {
    const keys = Array.from({ length: 14 }, (_, i) => `<${i}>`);
    const flow = keepNextFlowKeys(keys, (index) => index < 12);
    // Every member through the terminator contributes to the chain.
    for (let index = 0; index < 12; index += 1) {
      const window = flow[index]!;
      for (let member = index + 1; member < keys.length; member += 1) {
        expect(window.includes(`<${member}>`)).toBe(member <= 12);
      }
    }
    // The tail keeps nothing and folds nothing.
    expect(flow[12]).toBe('<12>');
    expect(flow[13]).toBe('<13>');
  });

  test('an edit to any member of a long chain changes the head key', () => {
    const keys = Array.from({ length: 20 }, (_, i) => `b${i}`);
    const base = keepNextFlowKeys(keys, allKept);
    for (let edited = 1; edited < keys.length; edited += 1) {
      const changed = keys.map((key, index) => (index === edited ? `${key}x` : key));
      const flow = keepNextFlowKeys(changed, allKept);
      expect(flow[0]).not.toBe(base[0]);
    }
  });

  test('the dependency ends after the first block that keeps nothing', () => {
    const fold = (after: string) =>
      keepNextFlowKeys(['head', 'member', 'end', after], (index) => index < 2);
    expect(fold('x')[0]).toBe(fold('y')[0]);
    expect(fold('x')[0]).toBe('head~kn~6:member3:end');
  });

  test('the key records when the chain reaches the end of the story', () => {
    // The last block keeps with nothing, and a final section mark may drop its page break.
    const ends = keepNextFlowKeys(['head', 'end'], (index) => index === 0);
    const continues = keepNextFlowKeys(['head', 'end', 'more'], (index) => index === 0);
    expect(ends[0]).toBe('head~kn~3:end.');
    expect(continues[0]).toBe('head~kn~3:end');
    // A kept last block has nothing to price.
    expect(keepNextFlowKeys(['a', 'b'], allKept)).toEqual(['a~kn~1:b.', 'b']);
  });

  test('a long chain records whether another block follows', () => {
    const kept = Array.from({ length: 32 }, (_, i) => `b${i}`);
    const atEnd = keepNextFlowKeys(kept, allKept);
    const more = keepNextFlowKeys([...kept, 'next'], allKept);
    expect(atEnd[0]).not.toBe(more[0]);
  });

  test('a positioned frame contributes only its skip marker', () => {
    const fold = (frame: string, keepsNextAt = (index: number) => index !== 3) =>
      keepNextFlowKeys(['head', frame, 'member', 'end'], keepsNextAt, (index) => index === 1);
    expect(fold('frame')[0]).toBe('head~kn~-6:member3:end.');
    expect(fold('frame')[1]).toBe('frame');
    // Frame text moves no flow; it is laid out apart from the chain.
    expect(fold('edited')[0]).toBe(fold('frame')[0]);
  });

  test('a long kept run adds bounded dependency storage to every key', () => {
    const count = 5000;
    const keys = Array.from({ length: count }, (_, i) => `key-${i}`.padEnd(40, '.'));
    const flow = keepNextFlowKeys(keys, allKept);
    const bound = 40 + '~kn~'.length + 256;
    for (const key of flow) expect(key.length).toBeLessThanOrEqual(bound);
    expect(flow.reduce((sum, key) => sum + key.length, 0)).toBeLessThan(count * bound);
  });
});
