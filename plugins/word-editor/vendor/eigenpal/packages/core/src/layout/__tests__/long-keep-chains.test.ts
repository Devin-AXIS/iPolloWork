import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, TreeDocumentStore } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import {
  keepNextChains,
  keepNextGroupNeed,
  keepNextTailLines,
  type KeepNextSource,
  type KeepNextBlock,
} from '../pagination-keeps.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const geometry = { width: 350, height: 210, margin: { top: 20, bottom: 20, left: 20, right: 20 } };
const measurer = createFixedMeasurer(6, 14);
const paragraph = (text: string, keep = false) =>
  `<w:p><w:pPr>${keep ? '<w:keepNext/>' : ''}<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
function load(body: string) {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
function pages(
  part: ReturnType<typeof load>,
  session?: ReturnType<typeof createLayoutSession>,
  revision = 1,
  styleCascade?: ReturnType<typeof buildStyleCascadeTable>
) {
  return layoutSemanticDocument(part, revision, {
    geometry,
    measurer,
    compatibilityMode: 15,
    session,
    styleCascade,
  }).pages.map((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.map((line) => line.spans.map((span) => span.text).join(''))
        : []
    )
  );
}

test('eleven kept paragraphs move together with their final paragraph', () => {
  const chain =
    Array.from({ length: 11 }, (_, i) => paragraph(`Member ${i}`, true)).join('') +
    paragraph('End');
  const result = pages(load(paragraph('Prefix') + chain));
  expect(result[0]).toEqual(['Prefix']);
  expect(result[1]).toEqual([...Array.from({ length: 11 }, (_, i) => `Member ${i}`), 'End']);
});

test('eleven paragraphs inherit their keep chain through a basedOn style', () => {
  const styles = readOoxmlPart(
    `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:styleId="KeepBase"><w:pPr><w:keepNext/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Kept"><w:basedOn w:val="KeepBase"/></w:style>' +
      '</w:styles>',
    { name: '/word/styles.xml', contentType: 'app/xml' }
  );
  if (!styles.ok) throw new Error(styles.reason);
  const styleCascade = buildStyleCascadeTable(styles.part.root);
  const members = Array.from({ length: 11 }, (_, i) => `Member ${i}`);
  const chain = members
    .map((text) => paragraph(text).replace('<w:pPr>', '<w:pPr><w:pStyle w:val="Kept"/>'))
    .join('');
  const result = pages(
    load(paragraph('Prefix') + chain + paragraph('End')),
    undefined,
    1,
    styleCascade
  );
  expect(result).toEqual([['Prefix'], [...members, 'End']]);
});

for (const breakKind of ['before', 'after'] as const) {
  test(`an explicit page break ${breakKind} a late member ends the long keep group`, () => {
    const members = Array.from({ length: 11 }, (_, i) => `Member ${i}`);
    const chain = members
      .map((text, i) => {
        let xml = paragraph(text, true);
        if (breakKind === 'before' && i === 9)
          xml = xml.replace('<w:pPr>', '<w:pPr><w:pageBreakBefore/>');
        if (breakKind === 'after' && i === 8)
          xml = xml.replace('</w:r>', '<w:br w:type="page"/></w:r>');
        return xml;
      })
      .join('');
    const result = pages(load(paragraph('Prefix') + chain + paragraph('End')));
    expect(result).toEqual([
      [
        'Prefix',
        ...members
          .slice(0, 9)
          .map((text, i) => (breakKind === 'after' && i === 8 ? `${text}\f` : text)),
      ],
      [...members.slice(9), 'End'],
    ]);
  });
}

test('editing the final member beyond eight predecessors reconsiders the retained chain head', () => {
  const part = load(
    paragraph('Prefix') +
      Array.from({ length: 10 }, (_, i) => paragraph(`Member ${i}`, true)).join('') +
      paragraph('End')
  );
  const store = new TreeDocumentStore(part);
  const session = createLayoutSession();
  expect(pages(store.part, session)[0]).toContain('Member 0');
  const body = store.part.root.children.find((node) => node.kind === 'body');
  if (body?.kind !== 'body') throw new Error('Missing body');
  const tail = body.children.at(-1)!;
  expect(
    store.transact((tx) =>
      tx.apply({ op: 'insertText', paragraphId: tail.id, offset: 3, text: ' word'.repeat(15) })
    ).ok
  ).toBe(true);
  const retained = pages(store.part, session, 2);
  expect(retained).toEqual(pages(structuredClone(store.part)));
  expect(retained[0]).toEqual(['Prefix']);
});

test('an oversized chain still places all content without empty pages', () => {
  const labels = Array.from({ length: 100 }, (_, i) => `Member ${i}`);
  const result = pages(load(labels.map((text) => paragraph(text, true)).join('')));
  expect(result.flat()).toEqual(labels);
  expect(result.every((page) => page.length > 0)).toBe(true);
});

const kept = { keepNext: true, keepLines: false, widowControl: true };
const placement = {
  cursorY: 35,
  contentHeight: 170,
  lead: 0,
  pricedLead: 0,
  freshLead: 0,
  topExtent: 0,
};

test('long chains measure each member a bounded number of times across all tail decisions', () => {
  const blocks: KeepNextBlock[] = Array.from({ length: 5000 }, () => ({
    kind: 'paragraph',
    spacing: { before: 0, after: 0 },
    keeps: kept,
  }));
  let reads = 0;
  const chains = keepNextChains(
    {
      blocks,
      linesFor: () => {
        reads += 1;
        return [{ height: 0 }];
      },
    },
    15
  );
  for (let start = 0; start < blocks.length; start++) {
    chains.need(start, 0, placement);
    chains.tailBreak(start, 1, 0, 170);
  }
  expect(reads).toBeLessThan(blocks.length * 6);
});

describe('range summaries preserve paragraph split and spacing decisions', () => {
  for (const sumAdjacentSpacing of [false, true]) {
    test(`summed spacing=${sumAdjacentSpacing}`, () => {
      let seed = 79;
      const random = (max: number) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed % max;
      };
      for (let trial = 0; trial < 40; trial++) {
        const blocks: KeepNextBlock[] = Array.from({ length: 45 }, (_, i) => ({
          kind: 'paragraph',
          spacing: { before: random(10), after: random(10) },
          keeps: { keepNext: i < 44, keepLines: random(3) === 0, widowControl: random(2) === 0 },
        }));
        const lines = blocks.map(() =>
          Array.from({ length: random(6) + 1 }, () => ({
            height: random(12) + 1,
            trailingSpacing: random(2),
          }))
        );
        const source: KeepNextSource = { blocks, linesFor: (at) => lines[at]!, sumAdjacentSpacing };
        const chains = keepNextChains(source, 15);
        for (let start = 0; start < blocks.length; start++) {
          expect(chains.need(start, 3, placement)).toEqual(
            keepNextGroupNeed(
              { ...source, start, carry: 3 },
              { ...placement, compatibilityMode: 15 }
            )
          );
          expect(chains.tailBreak(start, lines[start]!.length, 35, 170)).toBe(
            lines[start]!.length -
              keepNextTailLines({ ...source, start, carry: 0, headLead: 0 }, 135, 170, 15)
          );
        }
      }
    });
  }
});

test('a chain longer than thirty-two members reserves the complete group', () => {
  const blocks = Array.from({ length: 65 }, () => ({
    kind: 'paragraph',
    spacing: { before: 0, after: 0 },
    keeps: kept,
  }));
  const chains = keepNextChains({ blocks, linesFor: () => [{ height: 1 }] }, 15);
  expect(chains.need(0, 0, { ...placement, cursorY: 50, contentHeight: 100 })).toBe(65);
});

test('changing measurement contexts does not measure the remainder of an oversized chain', () => {
  const count = 2000;
  const blocks = Array.from({ length: count }, () => ({
    kind: 'paragraph',
    spacing: { before: 0, after: 0 },
    keeps: kept,
  }));
  let context = 0;
  let reads = 0;
  let skips = 0;
  const chains = keepNextChains(
    {
      blocks,
      contextKey: () => String(context),
      skipBlock: () => {
        skips += 1;
        return false;
      },
      linesFor: () => {
        reads += 1;
        return [{ height: 14 }];
      },
    },
    15
  );
  for (context = 0; context < count; context++) {
    chains.tailBreak(context, 1, 0, 170);
  }
  expect(reads).toBeLessThan(count * 35);
  expect(skips).toBeLessThan(count * 45);
});

test('a cursor-dependent member does not keep stale line measurements', () => {
  const blocks = Array.from({ length: 20 }, (_, at) => ({
    kind: 'paragraph',
    spacing: { before: 0, after: 0 },
    keeps: { ...kept, keepNext: at < 19 },
  }));
  let height = 1;
  const source = {
    blocks,
    dynamicBlock: (at: number) => at === 10,
    linesFor: (at: number) => [{ height: at === 10 ? height : 1 }],
  };
  const chains = keepNextChains(source, 15);
  expect(chains.need(0, 0, placement)).toBe(20);
  height = 100;
  expect(chains.need(0, 0, placement)).toBe(119);
});
