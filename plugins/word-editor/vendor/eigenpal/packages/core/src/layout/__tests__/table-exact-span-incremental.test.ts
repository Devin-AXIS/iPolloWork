import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { load, lay, para, cell } from './table-row-keep-fixtures.ts';

// 170pt body, 14pt lines. Three exact 28pt rows (84pt span); the head holds ten 14pt lines.
const exactRow = `<w:trPr><w:trHeight w:val="${560}" w:hRule="exact"/></w:trPr>`;
const head = Array.from({ length: 10 }, (_, i) => para(`M${i}`)).join('');
const tableXml = (count: number) => {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const merged =
      i === 0 ? cell(head, '<w:vMerge w:val="restart"/>') : cell(para(`G${i}`), '<w:vMerge/>');
    rows.push(`<w:tr>${exactRow}${merged}${cell(para(`S${i}`))}</w:tr>`);
  }
  return `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${rows.join('')}</w:tbl>`;
};

const body = (part: any) => part.root.children.find((n: any) => n.kind === 'body')!;
function apply(part: any, op: any) {
  const r = applyTreeOp(part, op);
  if (!r.ok) throw Error(r.reason);
  return r.part;
}
const text = (layout: any) =>
  layout.pages.map((page: any) =>
    page.fragments.flatMap((f: any) =>
      f.kind === 'table'
        ? f.rows.flatMap((r: any) =>
            r.cells.flatMap((c: any) =>
              c.blocks.map((b: any) =>
                b.kind === 'paragraph'
                  ? `${b.lines.map((l: any) => l.spans.map((s: any) => s.text).join('')).join('/')}${b.clipToBox ? '#clip' : ''}@${Math.round(b.box.y)}`
                  : b.kind
              )
            )
          )
        : []
    )
  );

for (const rows of [3, 4]) {
  test(`incremental relayout of an exact span (${rows} rows) matches a fresh layout`, () => {
    let part = load(para('P', 4, {}) + tableXml(rows) + para('After'));
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    lay(part, 15, { session, cache });
    lay(part, 15, { session, cache });
    const check = (label: string) => {
      const inc = lay(part, 15, { session, cache });
      const fresh = lay(part);
      expect({ label, t: text(inc) }).toEqual({ label, t: text(fresh) });
      expect(JSON.stringify(inc.pages)).toBe(JSON.stringify(fresh.pages));
      return inc;
    };
    const pre = () => body(part).children.find((n: any) => n.kind === 'paragraph')!.id;
    // Push the table down one line at a time so the span crosses the page break.
    for (let i = 0; i < 6; i++) {
      part = apply(part, { op: 'insertText', paragraphId: pre(), offset: 0, text: 'Q' });
      part = apply(part, { op: 'splitParagraph', paragraphId: pre(), offset: 1 });
      check(`push ${i}`);
    }
    // Edit inside the head: delete head paragraphs until it fits, then type it back.
    const tbl = () => body(part).children.find((n: any) => n.kind === 'table')!;
    const headCell = () =>
      tbl()
        .children.filter((n: any) => n.kind === 'row' || n.kind === 'tableRow')[0]
        ?.children.find((n: any) => n.kind === 'cell' || n.kind === 'tableCell');
    const firstHeadPara = () => {
      const walk = (n: any): any => {
        if (n.kind === 'paragraph') return n;
        for (const c of n.children ?? []) {
          const f = walk(c);
          if (f) return f;
        }
        return undefined;
      };
      return walk(tbl());
    };
    for (let i = 0; i < 5; i++) {
      part = apply(part, { op: 'deleteBlock', blockId: firstHeadPara().id });
      check(`shrink ${i}`);
    }
    for (let i = 0; i < 5; i++) {
      part = apply(part, { op: 'splitParagraph', paragraphId: firstHeadPara().id, offset: 0 });
      check(`grow ${i}`);
    }
    // Pull the table back up.
    for (let i = 0; i < 6; i++) {
      part = apply(part, { op: 'deleteBlock', blockId: pre() });
      check(`pull ${i}`);
    }
    void headCell;
  });
}

test('incremental relayout of a clipped exact span in repeated header rows matches a fresh layout', () => {
  const headerRow = (i: number) => {
    const merged =
      i === 0 ? cell(head, '<w:vMerge w:val="restart"/>') : cell(para(`G${i}`), '<w:vMerge/>');
    return `<w:tr><w:trPr><w:tblHeader/><w:trHeight w:val="${process.env.H ?? 600}" w:hRule="exact"/></w:trPr>${merged}${cell(para(`S${i}`))}</w:tr>`;
  };
  const bodyRows = Array.from(
    { length: 30 },
    (_, i) => `<w:tr>${cell(para(`B${i}`))}${cell(para('x'))}</w:tr>`
  );
  const xml = `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${[0, 1, 2].map(headerRow).join('')}${bodyRows.join('')}</w:tbl>`;
  let part = load(para('P', 1, {}) + xml + para('After'));
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  lay(part, 15, { session, cache });
  lay(part, 15, { session, cache });
  const check = (label: string) => {
    const inc = lay(part, 15, { session, cache });
    const fresh = lay(part);
    expect(JSON.stringify(inc.pages)).toBe(JSON.stringify(fresh.pages));
  };
  const firstHeadPara = () => {
    const walk = (n: any): any => {
      if (n.kind === 'paragraph') return n;
      for (const c of n.children ?? []) {
        const f = walk(c);
        if (f) return f;
      }
      return undefined;
    };
    return walk(body(part).children.find((n: any) => n.kind === 'table'));
  };
  for (let i = 0; i < 6; i++) {
    part = apply(part, { op: 'deleteBlock', blockId: firstHeadPara().id });
    check(`shrink ${i}`);
  }
  for (let i = 0; i < 6; i++) {
    part = apply(part, { op: 'splitParagraph', paragraphId: firstHeadPara().id, offset: 0 });
    check(`grow ${i}`);
  }
});
