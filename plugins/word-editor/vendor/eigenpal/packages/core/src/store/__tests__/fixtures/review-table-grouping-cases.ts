import { wordCreatedTableAlignment } from './word-created-table-alignment.ts';
/** Synthetic inputs for native Word revision-grouping comparisons. */
import { structuralWordXmlParts } from './structural-word-cases.ts';
import { wordCreatedNestedRow, wordCreatedNestedRowDeletion } from './word-created-nested-row.ts';
import { wordCreatedTableWidth } from './word-created-table-width.ts';
import { wordCreatedNewRowHeight } from './word-created-row-height.ts';
let id = 0;
const date = '2026-01-02T03:04:05Z';
const attr = (author = 'Ada', when = date) =>
  `w:id="${++id}" w:author="${author}" w:date="${when}"`;
const marker = (kind: string, author = 'Ada', when = date) => `<w:${kind} ${attr(author, when)}/>`;
const text = (value: string, kind = '', author = 'Ada', when = date) => {
  const run = `<w:r><w:${kind === 'del' ? 'delText' : 't'}>${value}</w:${kind === 'del' ? 'delText' : 't'}></w:r>`;
  return kind ? `<w:${kind} ${attr(author, when)}>${run}</w:${kind}>` : run;
};
const p = (content: string, mark = '') =>
  `<w:p>${mark ? `<w:pPr><w:rPr>${mark}</w:rPr></w:pPr>` : ''}${content}</w:p>`;
const cell = (content: string, pr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${pr}</w:tcPr>${content}</w:tc>`;
const row = (cells: string, mark = '') =>
  `<w:tr>${mark ? `<w:trPr>${mark}</w:trPr>` : ''}${cells}</w:tr>`;
const table = (rows: string) =>
  `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${rows}</w:tbl>`;
const ordinary = () => row(cell(p(text('Existing A'))) + cell(p(text('Existing B'))));
const trackedRow = (label: string, kind = 'ins', author = 'Ada', when = date, marks = false) =>
  row(
    cell(p(text(label + ' A', kind, author, when), marks ? marker(kind, author, when) : '')) +
      cell(p(text(label + ' B', kind, author, when), marks ? marker(kind, author, when) : '')),
    marker(kind, author, when)
  );
const cases: { name: string; body: string }[] = [];
const add = (name: string, body: string) => cases.push({ name, body });
for (const kind of ['ins', 'del']) {
  add(`one-row-${kind}`, table(trackedRow('First', kind)));
  add(`two-rows-${kind}`, table(trackedRow('First', kind) + trackedRow('Second', kind)));
  add(
    `paragraph-marks-${kind}`,
    table(
      trackedRow('First', kind, 'Ada', date, true) + trackedRow('Second', kind, 'Ada', date, true)
    )
  );
  add(
    `separated-rows-${kind}`,
    table(trackedRow('First', kind) + ordinary() + trackedRow('Last', kind))
  );
  add(
    `different-row-authors-${kind}`,
    table(trackedRow('First', kind) + trackedRow('Second', kind, 'Bob'))
  );
  add(
    `different-row-dates-${kind}`,
    table(trackedRow('First', kind) + trackedRow('Second', kind, 'Ada', '2026-02-03T04:05:06Z'))
  );
  add(
    `plain-row-text-${kind}`,
    table(row(cell(p(text('Plain A'))) + cell(p(text('Plain B'))), marker(kind)))
  );
  add(
    `different-text-author-${kind}`,
    table(row(cell(p(text('Other A', kind, 'Bob'))) + cell(p(text('Same B', kind))), marker(kind)))
  );
  add(
    `different-text-date-${kind}`,
    table(
      row(
        cell(p(text('Later A', kind, 'Ada', '2026-02-03T04:05:06Z'))) +
          cell(p(text('Same B', kind))),
        marker(kind)
      )
    )
  );
  add(
    `cell-markers-${kind}`,
    table(
      row(
        cell(p(text('Cell A', kind)), marker(kind === 'ins' ? 'cellIns' : 'cellDel')) +
          cell(p(text('Cell B', kind)), marker(kind === 'ins' ? 'cellIns' : 'cellDel'))
      )
    )
  );
  add(
    `row-and-cell-markers-${kind}`,
    table(
      row(
        cell(p(text('Cell A', kind)), marker(kind === 'ins' ? 'cellIns' : 'cellDel')) +
          cell(p(text('Cell B', kind)), marker(kind === 'ins' ? 'cellIns' : 'cellDel')),
        marker(kind)
      )
    )
  );
  add(
    `nested-table-${kind}`,
    table(
      row(
        cell(table(trackedRow('Nested', kind)) + p(text('Outer', kind))) +
          cell(p(text('Neighbour', kind))),
        marker(kind)
      )
    )
  );
}
add(
  'untracked-row-inserted-text',
  table(row(cell(p(text('Added A', 'ins'))) + cell(p(text('Added B', 'ins')))))
);
add(
  'row-insert-with-deletion',
  table(
    row(
      cell(p(text('Removed', 'del') + text('Added', 'ins'))) + cell(p(text('Same', 'ins'))),
      marker('ins')
    )
  )
);
add(
  'row-insert-with-format',
  table(
    row(
      cell(
        p(
          `<w:r><w:rPr><w:b/><w:rPrChange ${attr()}><w:rPr/></w:rPrChange></w:rPr><w:t>Formatted</w:t></w:r>`
        )
      ) + cell(p(text('Added', 'ins'))),
      marker('ins')
    )
  )
);
add(
  'adjacent-tables',
  table(trackedRow('First')) + p(text('Between')) + table(trackedRow('Second'))
);
for (const kind of ['ins', 'del']) {
  add(
    `nested-only-${kind}`,
    table(
      row(cell(table(trackedRow('Nested', kind)) + p(text('Outer'))) + cell(p(text('Neighbour'))))
    )
  );
  add(
    `nested-plain-${kind}`,
    table(
      row(
        cell(table(ordinary()) + p(text('Outer', kind))) + cell(p(text('Neighbour', kind))),
        marker(kind)
      )
    )
  );
  add(
    `nested-other-author-${kind}`,
    table(
      row(
        cell(table(trackedRow('Nested', kind, 'Bob')) + p(text('Outer', kind))) +
          cell(p(text('Neighbour', kind))),
        marker(kind)
      )
    )
  );
  add(
    `row-opposite-text-${kind}`,
    table(
      row(
        cell(p(text('Opposite', kind === 'ins' ? 'del' : 'ins'))) + cell(p(text('Same', kind))),
        marker(kind)
      )
    )
  );
  add(
    `row-multiple-paragraphs-${kind}`,
    table(
      row(
        cell(p(text('First', kind)) + p(text('Second', kind))) + cell(p(text('Last', kind))),
        marker(kind)
      )
    )
  );
}
const formattedRun = () =>
  `<w:r><w:rPr><w:b/><w:rPrChange ${attr()}><w:rPr/></w:rPrChange></w:rPr><w:t>Bold</w:t></w:r>`;
add(
  'row-insert-with-inserted-format',
  table(
    row(
      cell(p(`<w:ins ${attr()}>${formattedRun()}</w:ins>`)) + cell(p(text('Added', 'ins'))),
      marker('ins')
    )
  )
);
add('inserted-format-outside-table', p(`<w:ins ${attr()}>${formattedRun()}</w:ins>`));
add('adjacent-identical-format', p(formattedRun() + formattedRun()));
add('separated-identical-format', p(formattedRun() + text('Gap') + formattedRun()));
add(
  'row-insert-with-paragraph-format',
  table(
    row(
      cell(
        `<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange ${attr()}><w:pPr/></w:pPrChange></w:pPr>${text('Added', 'ins')}</w:p>`
      ) + cell(p(text('Second', 'ins'))),
      marker('ins')
    )
  )
);
// Keep property scopes independent so Word comparisons can establish which
// histories a single review entry actually resolves, rather than just its count.
const propertyChange = (scope: string, previous: string, author = 'Ada', when = date) =>
  `<w:${scope}Change ${attr(author, when)}><w:${scope}>${previous}</w:${scope}></w:${scope}Change>`;
const formattedCell = (label: string, author = 'Ada', when = date) =>
  cell(
    p(text(label)),
    `<w:shd w:val="clear" w:fill="FFFF00"/>${propertyChange('tcPr', '<w:tcW w:w="2000" w:type="dxa"/>', author, when)}`
  );
const formattedRow = (label: string, author = 'Ada') =>
  row(
    cell(p(text(label + ' A'))) + cell(p(text(label + ' B'))),
    `<w:trHeight w:val="600"/>${propertyChange('trPr', '', author)}`
  );
add('format-one-cell', table(row(formattedCell('A') + cell(p(text('B'))))));
add('format-adjacent-cells', table(row(formattedCell('A') + formattedCell('B'))));
add('format-cell-authors', table(row(formattedCell('A') + formattedCell('B', 'Bob'))));
add(
  'format-cell-dates',
  table(row(formattedCell('A') + formattedCell('B', 'Ada', '2026-02-03T04:05:06Z')))
);
add('format-adjacent-rows', table(formattedRow('First') + formattedRow('Second')));
add('format-row-authors', table(formattedRow('First') + formattedRow('Second', 'Bob')));
add('format-separated-rows', table(formattedRow('First') + ordinary() + formattedRow('Last')));
add(
  'format-separate-tables',
  table(row(formattedCell('First A') + formattedCell('First B'))) +
    p(text('Between')) +
    table(row(formattedCell('Second A') + formattedCell('Second B')))
);
add(
  'format-nested-cells',
  table(
    row(
      cell(table(row(formattedCell('Nested A') + formattedCell('Nested B'))) + p(text('Outer'))) +
        formattedCell('Neighbour')
    )
  )
);
add(
  'format-row-and-cells',
  table(
    row(
      formattedCell('A') + formattedCell('B'),
      `<w:trHeight w:val="600"/>${propertyChange('trPr', '')}`
    )
  )
);
add(
  'format-table-property',
  table(ordinary()).replace(
    '</w:tblPr>',
    `<w:jc w:val="center"/>${propertyChange('tblPr', '<w:tblW w:w="4000" w:type="dxa"/>')}</w:tblPr>`
  )
);
add(
  'format-grid-and-cells',
  table(row(formattedCell('A') + formattedCell('B'))).replace(
    '</w:tblGrid>',
    `${propertyChange('tblGrid', '<w:gridCol w:w="1800"/><w:gridCol w:w="2200"/>')}</w:tblGrid>`
  )
);
add(
  'format-row-exceptions',
  table(ordinary()).replace(
    '<w:tr>',
    `<w:tr><w:tblPrEx><w:tblW w:w="4000" w:type="dxa"/>${propertyChange('tblPrEx', '<w:tblW w:w="3600" w:type="dxa"/>')}</w:tblPrEx>`
  )
);
const runFormat = (value: string, current: string, previous = '', author = 'Ada', when = date) =>
  `<w:r><w:rPr>${current}${propertyChange('rPr', previous, author, when)}</w:rPr><w:t>${value}</w:t></w:r>`;
add(
  'adjacent-format-authors',
  p(runFormat('First', '<w:b/>') + runFormat('Second', '<w:b/>', '', 'Bob'))
);
add(
  'adjacent-format-dates',
  p(runFormat('First', '<w:b/>') + runFormat('Second', '<w:b/>', '', 'Ada', '2026-02-03T04:05:06Z'))
);
add(
  'adjacent-format-different-current',
  p(runFormat('First', '<w:b/>') + runFormat('Second', '<w:i/>'))
);
add(
  'adjacent-format-different-previous',
  p(runFormat('First', '<w:b/>') + runFormat('Second', '<w:b/>', '<w:i/>'))
);
add(
  'adjacent-format-different-baseline',
  p(runFormat('First', '<w:b/>') + runFormat('Second', '<w:b/><w:i/>', '<w:i/>'))
);
add('format-across-paragraphs', p(runFormat('First', '<w:b/>')) + p(runFormat('Second', '<w:b/>')));
add(
  'format-across-cells',
  table(row(cell(p(runFormat('First', '<w:b/>'))) + cell(p(runFormat('Second', '<w:b/>')))))
);
add(
  'format-grid-with-gap',
  table(formattedRow('First') + ordinary() + formattedRow('Last')).replace(
    '</w:tblGrid>',
    `${propertyChange('tblGrid', '<w:gridCol w:w="1800"/><w:gridCol w:w="2200"/>')}</w:tblGrid>`
  )
);
add(
  'format-grid-row-authors',
  table(formattedRow('First') + formattedRow('Second', 'Bob')).replace(
    '</w:tblGrid>',
    `${propertyChange('tblGrid', '<w:gridCol w:w="1800"/><w:gridCol w:w="2200"/>')}</w:tblGrid>`
  )
);
for (const kind of ['ins', 'del']) {
  add(
    `nested-opposite-row-${kind}`,
    table(
      row(
        cell(table(trackedRow('Nested', kind === 'ins' ? 'del' : 'ins')) + p(text('Outer', kind))) +
          cell(p(text('Neighbour', kind))),
        marker(kind)
      )
    )
  );
  add(
    `nested-partial-rows-${kind}`,
    table(
      row(
        cell(
          table(trackedRow('First', kind) + ordinary() + trackedRow('Last', kind)) +
            p(text('Outer', kind))
        ) + cell(p(text('Neighbour', kind))),
        marker(kind)
      )
    )
  );
  add(
    `nested-deep-${kind}`,
    table(
      row(
        cell(
          table(
            row(
              cell(table(trackedRow('Deep', kind)) + p(text('Middle', kind))) +
                cell(p(text('Middle neighbour', kind))),
              marker(kind)
            )
          ) + p(text('Outer', kind))
        ) + cell(p(text('Neighbour', kind))),
        marker(kind)
      )
    )
  );
}
add(
  'format-grid-only',
  table(ordinary()).replace(
    '</w:tblGrid>',
    `${propertyChange('tblGrid', '<w:gridCol w:w="1800"/><w:gridCol w:w="2200"/>')}</w:tblGrid>`
  )
);
add(
  'nested-two-rows-ins',
  table(
    row(
      cell(table(trackedRow('First') + trackedRow('Second')) + p(text('Outer', 'ins'))) +
        cell(p(text('Neighbour', 'ins'))),
      marker('ins')
    )
  )
);
add(
  'nested-last-unchanged-ins',
  table(
    row(
      cell(table(trackedRow('First') + ordinary()) + p(text('Outer', 'ins'))) +
        cell(p(text('Neighbour', 'ins'))),
      marker('ins')
    )
  )
);
add(
  'nested-only-two-rows-ins',
  table(
    row(
      cell(table(trackedRow('First') + trackedRow('Second')) + p(text('Outer'))) +
        cell(p(text('Neighbour')))
    )
  )
);
add(
  'nested-two-tables-ins',
  table(
    row(
      cell(
        table(trackedRow('First')) +
          p(text('Between')) +
          table(trackedRow('Second')) +
          p(text('Outer', 'ins'))
      ) + cell(p(text('Neighbour', 'ins'))),
      marker('ins')
    )
  )
);
for (const kind of ['ins', 'del']) {
  add(
    `nested-following-gap-${kind}`,
    table(
      row(
        cell(
          table(trackedRow('Nested', kind)) + p(text('Unchanged')) + p(text('Following', kind))
        ) + cell(p(text('Neighbour')))
      )
    )
  );
}
const moveRange = (direction: 'From' | 'To', name: string, content: string) => {
  const rangeId = ++id;
  return `<w:move${direction}RangeStart w:id="${rangeId}" w:name="${name}" w:author="Ada" w:date="${date}"/>${content}<w:move${direction}RangeEnd w:id="${rangeId}"/>`;
};
add('move-range-insertion', p(moveRange('To', 'SyntheticMove', text('Destination', 'ins'))));
add('move-range-deletion', p(moveRange('From', 'SyntheticMove', text('Source', 'del'))));
add(
  'move-range-pair',
  p(moveRange('From', 'SyntheticMove', text('Moved', 'del'))) +
    p(moveRange('To', 'SyntheticMove', text('Moved', 'ins')))
);
add(
  'move-range-multiple-insertions',
  p(moveRange('To', 'SyntheticMove', text('First', 'ins') + text('Second', 'ins')))
);
add('move-wrapper-destination', p(text('Destination', 'moveTo')));
add(
  'move-range-wrapper-destination',
  p(moveRange('To', 'SyntheticMove', text('Destination', 'moveTo')))
);
add(
  'move-range-wrapper-pair',
  p(moveRange('From', 'SyntheticMove', text('Moved', 'moveFrom'))) +
    p(moveRange('To', 'SyntheticMove', text('Moved', 'moveTo')))
);
add('word-created-nested-row-ins', wordCreatedNestedRow);
add('word-created-nested-row-del', wordCreatedNestedRowDeletion);
add('word-created-table-width', wordCreatedTableWidth);
add('word-created-row-height', wordCreatedNewRowHeight);
add('word-created-table-alignment', wordCreatedTableAlignment);
export const reviewTableGroupingCases = cases;
export const reviewTableGroupingParts = (entry: { name: string; body: string }) =>
  structuralWordXmlParts([entry]);
