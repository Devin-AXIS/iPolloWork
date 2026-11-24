// A merge at every level of a deeply nested table is a `.docx` an attacker writes.
//
// Planning a merge's height PROBES its rows, and a probe re-enters nested-table layout,
// which plans the level below, which probes again. That multiplies rather than adds: with a
// per-table allowance the same shape ran 63ms at depth 6, 4.3s at depth 10 and extrapolated
// past an hour at `MAX_TABLE_NESTING` — from a document of a few kilobytes.
//
// So a row probe measures the tables inside it WITHOUT planning them, and the re-entry stops
// multiplying. This pins that: the fixture below is small enough to write by hand and deep
// enough to take minutes if a probe ever plans again.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { MAX_TABLE_NESTING } from '../semantic-table.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function loadBody(bodyXml: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`part read failed: ${result.reason}`);
  return result.part;
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const RESTART = '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>';
const CONTINUE = '<w:tcPr><w:vMerge/></w:tcPr>';

/** A two-column table with a merge in each column, `depth` levels of them nested. */
function nestedMerges(depth: number): string {
  const inner = depth > 0 ? nestedMerges(depth - 1) : p('leaf');
  return (
    '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
    `<w:tr><w:tc>${RESTART}${inner}</w:tc><w:tc>${RESTART}${p('b')}</w:tc></w:tr>` +
    `<w:tr><w:tc>${CONTINUE}${p('')}</w:tc><w:tc>${CONTINUE}${p('')}</w:tc></w:tr>` +
    `<w:tr><w:tc>${p('c')}</w:tc><w:tc>${p('d')}</w:tc></w:tr>` +
    '</w:tbl>'
  );
}

describe('a merge at every level of a nested table', () => {
  test('reaches its answer, and reaches it in time a person would wait', () => {
    // Two claims, and the outcome is the load-bearing one: a bound on the clock alone cannot
    // tell "laid this out" from "threw on the first row", so a change that made nested-merge
    // layout throw for ordinary documents would keep a timing-only test green.
    //
    // This nest used to be taller than a page and failed closed with
    // `table-row-split-unsupported`. Word's cell margins took 6pt off every row of every
    // level, so it now fits and lays out. Either answer is fine here — what this file is
    // about is how long reaching one takes — but the outcome is asserted so that "laid it
    // out" stays distinguishable from "threw on the first row".
    const part = loadBody(nestedMerges(MAX_TABLE_NESTING));
    const started = Bun.nanoseconds();
    let thrown: unknown;
    let pageCount = 0;
    try {
      pageCount = layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer() }).pages.length;
    } catch (error) {
      thrown = error;
    }
    const elapsedMs = (Bun.nanoseconds() - started) / 1e6;

    expect(thrown).toBeUndefined();
    expect(pageCount).toBeGreaterThan(0);
    // Generous by three orders of magnitude against the fixed measurer, because the failure
    // it guards against is minutes, not milliseconds: probes that plan the tables inside them
    // multiply through the nest instead of adding to it.
    expect(elapsedMs).toBeLessThan(5_000);
  });

  test('two nests in one document cost the sum of them, not the product', () => {
    // Both nests lay out — no throw, so the page count is a real answer and not an artefact
    // of failing early.
    const twice = loadBody(nestedMerges(6) + p('between') + nestedMerges(6));
    const started = Bun.nanoseconds();
    const layout = layoutSemanticDocument(twice, 0, { measurer: createFixedMeasurer() });
    const elapsedMs = (Bun.nanoseconds() - started) / 1e6;

    // One page, not two: the same 6pt a row no longer spends on cell margins compounds
    // through six levels of nesting, so both nests now fit on one sheet.
    expect(layout.pages).toHaveLength(1);
    expect(elapsedMs).toBeLessThan(5_000);
  });
});
