import { expect, test } from 'bun:test';
import type { SemanticLayout } from '../../layout/semantic-records.ts';
import { authorSlotsOf } from '../revision-presentation.ts';

// Slots follow first appearance: every text author of a block list in depth-first reading
// order, then every cell-only author of that list in the same order. A repeated header row
// contributes its cells but not its text, which belongs to the row's first occurrence.

const revision = (author: string) => ({ id: author, author, kind: 'insert' as const });
const change = (localName: string, author: string) => ({ localName, attributes: { author } });

function paragraph(options: {
  spanAuthor?: string;
  formatAuthor?: string;
  paragraphChange?: string;
  mark?: string;
}): object {
  return {
    kind: 'paragraph',
    props: options.paragraphChange ? [change('pPrChange', options.paragraphChange)] : [],
    lines: [
      {
        spans: [
          {
            props: options.formatAuthor ? [change('rPrChange', options.formatAuthor)] : [],
            ...(options.spanAuthor ? { revisions: [revision(options.spanAuthor)] } : {}),
          },
        ],
      },
    ],
    ...(options.mark ? { markRevisions: [revision(options.mark)] } : {}),
  };
}

const cell = (blocks: readonly object[], author?: string) => ({
  blocks,
  ...(author ? { revisionShadingAuthor: author } : {}),
});
const table = (rows: readonly { cells: readonly object[]; isHeaderRepeat?: boolean }[]) => ({
  kind: 'table',
  rows: rows.map((row) => ({ isHeaderRepeat: false, ...row })),
});

test('text authors in reading order, then cell-only authors, repeats adding cells only', () => {
  const layout = {
    pages: [
      {
        fragments: [
          table([
            {
              isHeaderRepeat: true,
              cells: [cell([paragraph({ spanAuthor: 'Repeated text' })], 'Header cell')],
            },
            {
              cells: [
                cell(
                  [
                    paragraph({ spanAuthor: 'Ann' }),
                    table([{ cells: [cell([paragraph({ spanAuthor: 'Nina' })], 'Nested cell')] }]),
                  ],
                  'Cell A'
                ),
              ],
            },
            {
              cells: [
                cell([
                  paragraph({ paragraphChange: 'Pat', formatAuthor: 'Bob', mark: 'Mark' }),
                  paragraph({ spanAuthor: 'Ann', formatAuthor: '' }),
                ]),
              ],
            },
          ]),
        ],
      },
    ],
  } as unknown as SemanticLayout;
  expect([...authorSlotsOf(layout)]).toEqual([
    ['Ann', 0],
    ['Nina', 1],
    ['Pat', 2],
    ['Bob', 3],
    ['Mark', 4],
    ['Header cell', 5],
    ['Cell A', 6],
    ['Nested cell', 7],
  ]);
});
