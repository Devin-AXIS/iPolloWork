// A page is reused WHOLE. Convergence appends `previous.pages.slice(...)` and the unchanged
// exit returns the previous pages by identity, so nothing compares a page field by field the
// way `fragmentSignature` compares a fragment. Every field is guarded somewhere else instead,
// and each of those guards is hand-written.
//
// This file is that hand-written set, written down. A new field on `PageRecord` is a type
// error here until somebody says which mechanism keeps it current, because the failure it
// would otherwise ship is silent: a reused page showing a value the document no longer has.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument, type PageGeometry } from '../index.ts';
import { PAGE_REUSE_GUARDS, unguardedPageFields } from '../page-reuse-guards.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const GEOMETRY: PageGeometry = {
  width: 300,
  height: 120,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

describe('every field of a reused page has a named guard', () => {
  test('a real page publishes nothing the table does not classify', () => {
    // A plain paragraph publishes barely half the record. This document carries a table, a
    // column separator and enough content to open a second page, so the optional fields are
    // present to be checked rather than absent and trivially passing.
    const columns = '<w:sectPr><w:cols w:num="2" w:sep="1" w:space="360"/></w:sectPr>';
    const table =
      '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>' +
      '<w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' +
      '<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const body =
      Array.from(
        { length: 24 },
        (_, index) => `<w:p><w:r><w:t>page ${index}</w:t></w:r></w:p>`
      ).join('') +
      table +
      columns;
    const layout = layoutSemanticDocument(load(body), 1, {
      measurer: createFixedMeasurer(6, 14),
      geometry: GEOMETRY,
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    for (const page of layout.pages) expect(unguardedPageFields(page)).toEqual([]);
  });

  test('the flow fields are the ones a stopping pass actually compares', () => {
    // Stated as an assertion rather than a comment, so a field quietly reclassified as
    // `flow` has to face the comparisons that word implies.
    const flowFields = Object.entries(PAGE_REUSE_GUARDS)
      .filter(([, guard]) => guard === 'flow')
      .map(([field]) => field);
    expect(flowFields).toEqual(['fragments', 'anchoredDrawings']);
  });
});
