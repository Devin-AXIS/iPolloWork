import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  readOoxmlPart,
  revisionItemsOf,
  reviewItemKey,
  serializeOoxmlPart,
  type OoxmlPart,
} from '../index.ts';
import { planRevisionBatch } from '../store/revision-batch.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const mark = (name: string, id = 1, extra = '') =>
  `<w:${name} w:author="Ada" w:id="${id}" ${extra}/>`;
const p = (text = 'keep') => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string, pr = '') => `<w:tc><w:tcPr>${pr}</w:tcPr>${p(text)}</w:tc>`;
const row = (cells: string, pr = '') => `<w:tr><w:trPr>${pr}</w:trPr>${cells}</w:tr>`;
const table = (rows: string) =>
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${rows}</w:tbl>`;
function load(body: string): OoxmlPart {
  const r = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!r.ok) throw Error(r.reason);
  return r.part;
}
function resolve(part: OoxmlPart, action: 'accept' | 'reject', keys?: readonly string[]) {
  const plan = planRevisionBatch(part, action, keys);
  let current = part;
  for (const op of plan.ops) {
    const r = applyTreeOp(current, op);
    if (!r.ok) throw Error(r.reason);
    current = r.part;
  }
  expect(revisionItemsOf(current)).toHaveLength(plan.result.remaining);
  const xml = serializeOoxmlPart(current);
  const read = readOoxmlPart(xml, { name: part.name, contentType: part.contentType });
  if (!read.ok) throw Error(read.reason);
  expect(revisionItemsOf(read.part)).toHaveLength(plan.result.remaining);
  return { xml, plan, part: current };
}
const containers: Record<string, (properties: string) => string> = {
  rPr: (x) => `<w:p><w:r><w:rPr>${x}</w:rPr><w:t>keep</w:t></w:r></w:p>`,
  pPr: (x) => `<w:p><w:pPr>${x}</w:pPr><w:r><w:t>keep</w:t></w:r></w:p>`,
  trPr: (x) => table(row(cell('keep'), x)),
  tcPr: (x) => table(row(cell('keep', x))),
  tblPr: (x) => `<w:tbl><w:tblPr>${x}</w:tblPr>${row(cell('keep'))}</w:tbl>`,
  tblPrEx: (x) => `<w:tbl><w:tr><w:tblPrEx>${x}</w:tblPrEx>${cell('keep')}</w:tr></w:tbl>`,
  tblGrid: (x) => `<w:tbl><w:tblGrid>${x}</w:tblGrid>${row(cell('keep'))}</w:tbl>`,
  sectPr: (x) => `${p()}<w:sectPr>${x}</w:sectPr>`,
};
for (const action of ['accept', 'reject'] as const) {
  for (const [name, wrap] of Object.entries(containers)) {
    test(`${action} ${name} property snapshot restores only the recorded state`, () => {
      const prop =
        name === 'tblGrid'
          ? 'gridCol'
          : name === 'sectPr'
            ? 'pgSz'
            : name === 'trPr'
              ? 'trHeight'
              : name === 'tcPr' || name === 'tblPr' || name === 'tblPrEx'
                ? 'shd'
                : 'color';
      const current = `<w:${prop} w:val="current"/>`,
        prior = `<w:${prop} w:val="prior"/>`;
      const part = load(
        wrap(
          `${current}<w:${name}Change w:id="1" ${name === 'tblGrid' ? '' : 'w:author="Ada"'}><w:${name}>${prior}</w:${name}></w:${name}Change>`
        )
      );
      expect(revisionItemsOf(part)).toHaveLength(1);
      expect(revisionItemsOf(part)[0]?.readOnly).toBe(false);
      const { xml, plan } = resolve(part, action);
      expect(plan.result.skipped).toEqual([]);
      expect(xml).toContain(action === 'accept' ? current : prior);
      expect(xml).not.toContain(`${name}Change`);
    });
  }
  for (const kind of ['ins', 'del']) {
    test(`${action} row-only ${kind} without requiring cell markers`, () => {
      const result = resolve(
        load(table(row(cell('changed1') + cell('changed2'), mark(kind)) + row(cell('baseline')))),
        action
      );
      expect(result.plan.result.skipped).toEqual([]);
      expect(result.xml.includes('changed1')).toBe((kind === 'ins') === (action === 'accept'));
      expect(result.xml).toContain('baseline');
    });
    test(`${action} independent cell ${kind} preserves other cells`, () => {
      const result = resolve(
        load(
          table(
            row(cell('changed', mark(kind === 'ins' ? 'cellIns' : 'cellDel')) + cell('baseline'))
          )
        ),
        action
      );
      expect(result.plan.result.skipped).toEqual([]);
      expect(result.xml.includes('changed')).toBe((kind === 'ins') === (action === 'accept'));
      expect(result.xml).toContain('baseline');
    });
  }
  test(`${action} row and cell revisions with independent authors remain independently selectable`, () => {
    const part = load(
      table(
        row(
          cell('selected', mark('cellIns', 2)) + cell('keep'),
          '<w:ins w:author="Grace" w:id="1"/>'
        )
      )
    );
    const keys = revisionItemsOf(part)
      .filter((i) => i.author === 'Ada')
      .map(reviewItemKey);
    const result = resolve(part, action, keys);
    expect(result.plan.result.resolved).toHaveLength(1);
    expect(result.xml).toContain('w:author="Grace"');
  });
  test(`${action} removing all cells removes the empty row and table`, () => {
    const kind = action === 'accept' ? 'cellDel' : 'cellIns';
    const result = resolve(load(table(row(cell('gone', mark(kind)))) + p('outside')), action);
    expect(result.plan.result.skipped).toEqual([]);
    expect(result.xml).not.toContain('<w:tbl>');
    expect(result.xml).toContain('outside');
  });
  test(`${action} removing an only nested table leaves a required paragraph in the outer cell`, () => {
    const kind = action === 'accept' ? 'del' : 'ins';
    const inner = table(row(cell('gone'), mark(kind)));
    const part = load(table(row(`<w:tc>${inner}</w:tc>`)));
    const result = resolve(part, action);
    expect(result.plan.result.skipped).toEqual([]);
    expect(result.xml).toContain('<w:tc><w:p/></w:tc>');
  });
  for (const [current, prior] of [
    ['rest', undefined],
    ['cont', 'rest'],
    [undefined, 'cont'],
  ] as const) {
    test(`${action} cellMerge ${current}/${prior} applies the selected merge state`, () => {
      const attrs =
        (current ? `w:vMerge="${current}" ` : '') + (prior ? `w:vMergeOrig="${prior}"` : '');
      const value = action === 'accept' ? current : prior;
      const result = resolve(
        load(
          table(
            row(cell('top', value === 'cont' ? '<w:vMerge w:val="restart"/>' : '')) +
              row(cell('bottom', mark('cellMerge', 1, attrs)))
          )
        ),
        action
      );
      expect(result.plan.result.skipped).toEqual([]);
      expect(result.xml).not.toContain('cellMerge');
      expect(result.xml.includes('bottom')).toBe(value !== 'cont');
      if (value)
        expect(result.xml).toContain(`w:val="${value === 'rest' ? 'restart' : 'continue'}"`);
      else expect(result.xml).not.toContain('w:vMerge');
    });
  }
  test(`${action} malformed merge revisions stay pending without blocking independent cells`, () => {
    const result = resolve(
      load(
        table(
          row(
            cell('keep', mark('cellMerge', 1, 'w:vMerge="invalid"')) +
              cell('neighbour') +
              cell('change', mark('cellIns', 2))
          )
        )
      ),
      action
    );
    expect(result.plan.result.resolved).toHaveLength(1);
    expect(result.plan.result.skipped).toHaveLength(1);
    expect(result.xml).toContain('invalid');
  });
  test(`${action} duplicate cell markers refuse rather than count as two covered cells`, () => {
    const part = load(
      table(row(cell('keep', mark('cellIns') + mark('cellIns', 2)) + cell('other')))
    );
    const result = resolve(part, action);
    expect(result.plan.result.resolved).toHaveLength(0);
    expect(result.xml).toEqual(serializeOoxmlPart(part));
  });
}

test('cell snapshots contain history, not additional pending cell decisions', () => {
  const part = load(
    table(
      row(
        cell(
          'keep',
          `${mark('cellIns', 1)}<w:tcPrChange w:author="Ada" w:id="2"><w:tcPr>${mark('cellIns', 3)}</w:tcPr></w:tcPrChange>`
        )
      )
    )
  );
  expect(revisionItemsOf(part)).toHaveLength(2);
  const keys = revisionItemsOf(part)
    .filter((i) => i.revisionKind === 'format')
    .map(reviewItemKey);
  const result = resolve(part, 'reject', keys);
  expect(result.xml).toContain('w:id="1"');
  expect(result.xml).not.toContain('w:id="3"');
});
test('rejecting section properties preserves live header and footer references', () => {
  const refs =
    '<w:headerReference xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1" w:type="default"/>';
  const result = resolve(
    load(
      `${p()}<w:sectPr>${refs}<w:pgSz w:w="10000"/><w:sectPrChange w:author="Ada" w:id="1"><w:sectPr><w:pgSz w:w="12000"/></w:sectPr></w:sectPrChange></w:sectPr>`
    ),
    'reject'
  );
  expect(result.xml).toContain('rId1');
  expect(result.xml).toContain('12000');
  expect(result.xml).not.toContain('10000');
});
test('an empty section snapshot leaves unrecorded properties unchanged, as in Word', () => {
  const result = resolve(
    load(
      `${p()}<w:sectPr><w:pgSz w:w="10000"/><w:sectPrChange w:author="Ada" w:id="1"/></w:sectPr>`
    ),
    'reject'
  );
  expect(result.plan.result.skipped).toEqual([]);
  expect(result.xml).toContain('<w:pgSz w:w="10000"/>');
  expect(result.xml).not.toContain('sectPrChange');
});
