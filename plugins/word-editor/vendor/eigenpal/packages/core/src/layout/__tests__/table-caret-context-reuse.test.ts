import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { fragmentHolding } from '../line-segments.ts';
import { tableContextAt } from '../semantic-cell-selection.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { lay, load } from './table-row-keep-fixtures.ts';

test('table context survives width edits and refreshes after a paragraph split', () => {
  const row = '<w:tr>' + '<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>'.repeat(3) + '</w:tr>';
  let part = load(
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/>' +
      '<w:gridCol w:w="1000"/></w:tblGrid>' +
      row.repeat(24) +
      '</w:tbl>'
  );
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let layout = lay(part, 15, { session, cache });
  const id = [...paragraphFragmentsOf(layout.pages[0]!)][0]!.paragraphId;
  const context = tableContextAt(layout, id);
  expect(context).toMatchObject({ rows: 24, columns: 3, rowIndex: 0, columnIndex: 0 });
  let reused = 0;
  for (let offset = 0; offset < 6; offset++) {
    const edit = applyTreeOp(part, { op: 'insertText', paragraphId: id, offset, text: 'W' });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    layout = lay(part, 15, { session, cache });
    const answer = tableContextAt(layout, id);
    expect(answer).toEqual(tableContextAt(lay(part), id));
    if (answer === context) reused++;
  }
  expect(reused).toBe(6);
  const split = applyTreeOp(part, { op: 'splitParagraph', paragraphId: id, offset: 3 });
  if (!split.ok) throw Error(split.reason);
  const after = lay(split.part, 15, { session, cache });
  const cold = lay(split.part);
  for (const page of after.pages) {
    for (const paragraph of paragraphFragmentsOf(page)) {
      expect(fragmentHolding(after, paragraph.paragraphId)).toEqual(
        fragmentHolding(cold, paragraph.paragraphId)
      );
      expect(tableContextAt(after, paragraph.paragraphId)).toEqual(
        tableContextAt(cold, paragraph.paragraphId)
      );
    }
  }
});
