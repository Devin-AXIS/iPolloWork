import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { readTableStructure, tableOriginX } from '../semantic-table.ts';
import { readTableIndentPt } from '../table-widths.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

// `w:tblInd` is a signed offset. Captured controls in compatibility modes 14 and 15 move a
// left-aligned table by -10, 0 and +10pt for -200, 0 and +200 twips, and leave centered and
// right-aligned tables where they are. The whole indent applies whatever the table width, a
// bidiVisual table mirrors it, a nested table ignores a negative one, and a stated zero
// overrides the style.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LIMIT = 1584;

interface Shape {
  readonly jc?: string;
  readonly indent?: string;
  readonly cols?: readonly number[];
  readonly fixed?: boolean;
  readonly sz?: number;
  readonly extra?: string;
  readonly style?: string;
  readonly cellBody?: string;
}

function tableXml(shape: Shape = {}): string {
  const { cols = [3000, 3000], fixed = true, sz = 24 } = shape;
  const rule = (side: string) => `<w:${side} w:val="single" w:sz="${sz}"/>`;
  const sides = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];
  const width = cols.reduce((sum, col) => sum + col, 0);
  const cells = cols
    .map(
      (col, index) =>
        `<w:tc><w:tcPr><w:tcW w:w="${col}" w:type="dxa"/></w:tcPr>` +
        `${index === 0 && shape.cellBody ? shape.cellBody : ''}<w:p><w:r><w:t>C${index}</w:t></w:r></w:p></w:tc>`
    )
    .join('');
  return (
    `<w:tbl><w:tblPr>${shape.style ? `<w:tblStyle w:val="${shape.style}"/>` : ''}` +
    `<w:tblW w:w="${width}" w:type="dxa"/>${fixed ? '<w:tblLayout w:type="fixed"/>' : ''}` +
    `${shape.jc ? `<w:jc w:val="${shape.jc}"/>` : ''}${shape.indent ?? ''}${shape.extra ?? ''}` +
    `<w:tblBorders>${sides.map(rule).join('')}</w:tblBorders><w:tblCellMar>` +
    '<w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${cols.map((col) => `<w:gridCol w:w="${col}"/>`).join('')}</w:tblGrid>` +
    `<w:tr>${cells}</w:tr></w:tbl>`
  );
}

const indent = (w: string, type = 'dxa') => `<w:tblInd w:w="${w}" w:type="${type}"/>`;

function documentPart(bodyXml: string) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyXml}<w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function tableNode(bodyXml: string): OoxmlElement {
  const body = documentPart(bodyXml).root.children.find((node) => node.kind === 'body');
  const table = (body as OoxmlElement).children.find((node) => node.kind === 'table');
  if (!table) throw new Error('no table');
  return table as OoxmlElement;
}

function stylesTable(styles: string) {
  const parsed = readOoxmlPart(`<w:styles xmlns:w="${W}">${styles}</w:styles>`, {
    name: '/word/styles.xml',
    contentType: 'app/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return buildStyleCascadeTable(parsed.part.root);
}

function structure(
  bodyXml: string,
  options: { mode?: number; styles?: string; width?: number } = {}
) {
  const cascade = options.styles ? stylesTable(options.styles) : undefined;
  return readTableStructure(
    tableNode(bodyXml),
    options.width ?? 330,
    0,
    cascade,
    'proposed',
    undefined,
    options.mode
  )!;
}

// The captured controls: a 400 x 210pt page with 35pt side margins and a 300pt fixed table.
const GEOMETRY = { width: 400, height: 210, margin: { top: 20, right: 35, bottom: 20, left: 35 } };

function layout(
  part: ReturnType<typeof documentPart>,
  mode: number,
  session = createLayoutSession(),
  revision = 0,
  geometry = GEOMETRY
) {
  return layoutSemanticDocument(part, revision, {
    compatibilityMode: mode,
    measurer: createFixedMeasurer(6, 12),
    session,
    geometry,
  });
}

function firstTable(result: ReturnType<typeof layout>): TableFragmentRecord {
  const fragment = result.pages[0]!.fragments.find(
    (item): item is TableFragmentRecord => item.kind === 'table'
  );
  if (!fragment) throw new Error('no table fragment');
  return fragment;
}

/** The first cell's first text line, from the leading text edge. */
function textLeft(result: ReturnType<typeof layout>): number {
  const paragraph = firstTable(result).rows[0]!.cells[0]!.blocks.find(
    (block) => block.kind === 'paragraph'
  );
  if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('no paragraph');
  return paragraph.lines[0]!.box.x;
}

describe('readTableIndentPt', () => {
  const read = (attributes: string) =>
    readTableIndentPt(
      tableNode(tableXml({ indent: `<w:tblInd ${attributes}/>` }))
        .children.find((node) => node.kind !== 'textValue' && node.localName === 'tblPr')!
        .children.find(
          (node): node is OoxmlElement => node.kind !== 'textValue' && node.localName === 'tblInd'
        ),
      LIMIT
    );

  test('reads signed twips and universal measures', () => {
    expect(read('w:w="-200" w:type="dxa"')).toBe(-10);
    expect(read('w:w="200" w:type="dxa"')).toBe(10);
    expect(read('w:w="+200"')).toBe(10);
    expect(read('w:w="-200"')).toBe(-10);
    // A universal measure reads as its magnitude: a captured `-0.5in` sits at +36pt.
    expect(read('w:w="-0.5in" w:type="dxa"')).toBe(36);
    expect(read('w:w="0.5in"')).toBe(36);
    expect(read('w:w="-12pt" w:type="pct"')).toBe(12);
    expect(read('w:w="+1pc"')).toBe(12);
    expect(read('w:w="-2.54cm"')).toBeCloseTo(72, 10);
  });

  test('a stated zero is a value, and a stated -0 is zero', () => {
    expect(read('w:w="0" w:type="dxa"')).toBe(0);
    expect(Object.is(read('w:w="-0" w:type="dxa"'), 0)).toBe(true);
    expect(Object.is(read('w:w="-0mm"'), 0)).toBe(true);
  });

  test('unusable types and values state no indent', () => {
    for (const attributes of [
      'w:w="-200" w:type="pct"',
      'w:w="-200" w:type="nil"',
      'w:w="-200" w:type="auto"',
      'w:w="-200" w:type="DXA"',
      'w:w="-200" w:type="__proto__"',
      'w:w="-50%"',
      'w:w="50%"',
      'w:type="dxa"',
      'w:w=""',
      'w:w="-"',
      'w:w="--200"',
      'w:w="- 200"',
      'w:w=" -200"',
      'w:w="-200 "',
      'w:w="-1e5"',
      'w:w="NaN"',
      'w:w="Infinity"',
      'w:w="-Infinity"',
      'w:w="-0x10"',
      'w:w="-1in1"',
      'w:w="-1km"',
      'w:w="-1constructor"',
      `w:w="-${'9'.repeat(400)}"`,
      `w:w="-${'9'.repeat(40)}pt"`,
      `w:w="-1.${'5'.repeat(40)}in"`,
    ]) {
      expect(read(attributes)).toBeUndefined();
    }
  });

  test('a decimal twips value truncates toward zero', () => {
    expect(read('w:w="-720.6"')).toBe(-36);
    expect(read('w:w="1443.74" w:type="dxa"')).toBe(72.15);
    expect(read('w:w="-0.4"')).toBe(0);
  });

  test('clamps to the bound in both directions', () => {
    expect(read('w:w="-999999999"')).toBe(-LIMIT);
    expect(read('w:w="999999999"')).toBe(LIMIT);
    expect(read('w:w="-999999999.9999in"')).toBe(LIMIT);
    expect(readTableIndentPt(undefined, LIMIT)).toBeUndefined();
  });
});

describe('captured controls: a signed indent moves only a left-aligned table', () => {
  // Text left edge from the margin in the captured controls, rounded to 0.01pt.
  // Mode 14 aligns the first cell's content, and retains the signed indent deltas.
  const MODE_15_LEFT: Record<number, number> = { [-200]: -3.08, 0: 7.0, 200: 16.84 };
  const MODE_15_CENTER = 20.44;
  const MODE_15_RIGHT = 33.88;

  for (const mode of [14, 15]) {
    for (const jc of ['left', 'center', 'right']) {
      test(`mode ${mode} ${jc}`, () => {
        const at = (w: number) =>
          textLeft(layout(documentPart(tableXml({ jc, indent: indent(String(w)) })), mode));
        const base = at(0);
        for (const w of [-200, 200]) {
          expect(at(w) - base).toBeCloseTo(jc === 'left' ? w / 20 : 0, 8);
        }
        if (mode !== 15) return;
        for (const w of [-200, 0, 200]) {
          const captured =
            jc === 'left' ? MODE_15_LEFT[w]! : jc === 'center' ? MODE_15_CENTER : MODE_15_RIGHT;
          expect(Math.abs(at(w) - captured)).toBeLessThan(0.25);
        }
      });
    }
  }

  test('the mode 15 outer rule offset travels with a negative indent', () => {
    const part = documentPart(tableXml({ indent: indent('-200') }));
    const before = serializeOoxmlPart(part);
    const result = layout(part, 15);
    expect(firstTable(result).box.x).toBe(-10 + 1.5);
    expect(textLeft(result)).toBeCloseTo(-10 + 1.5 + 5.4, 8);
    expect(serializeOoxmlPart(part)).toBe(before);
  });
});

describe('follow-up captured controls', () => {
  // Same page as the first set. Mode 15 values are the captured text left edges from the
  // margin; mode 14 compares deltas against a stated zero. Invalid indentation keeps its
  // separate edge-based placement, whose captured text edge is 5.32pt.
  const style = (id: string, w: string) =>
    `<w:style w:type="table" w:styleId="${id}"><w:name w:val="${id}"/>` +
    `<w:tblPr>${indent(w)}</w:tblPr></w:style>`;
  const styles = stylesTable(style('Pull', '-200') + style('Push', '200'));
  const edge = (shape: Shape, mode: number) =>
    textLeft(
      layoutSemanticDocument(documentPart(tableXml(shape)), 0, {
        compatibilityMode: mode,
        measurer: createFixedMeasurer(6, 12),
        styleCascade: styles,
        geometry: GEOMETRY,
      })
    );
  const wide = [3700, 3700];
  const cases: readonly (readonly [string, Shape, number])[] = [
    ['over-wide fixed -600', { cols: wide, indent: indent('-600') }, -23],
    ['over-wide fixed +600', { cols: wide, indent: indent('600') }, 37],
    ['over-wide autofit -600', { cols: wide, fixed: false, indent: indent('-600') }, -23],
    ['over-wide autofit 0', { cols: wide, fixed: false, indent: indent('0') }, 7],
    ['over-wide autofit +600', { cols: wide, fixed: false, indent: indent('600') }, 37],
    ['+1200 past the slack', { indent: indent('1200') }, 67],
    ['-0.5in', { indent: indent('-0.5in') }, 43],
    ['style -200', { style: 'Pull' }, -3.08],
    ['style -200, direct 0', { style: 'Pull', indent: indent('0') }, 7],
    ['style +200, direct 0', { style: 'Push', indent: indent('0') }, 7],
    ['style +200, direct -200', { style: 'Push', indent: indent('-200') }, -3.08],
    ['pct type -200', { indent: indent('-200', 'pct') }, 7],
    ['nil type -200', { indent: indent('-200', 'nil') }, 7],
  ];
  for (const [name, shape, captured] of cases) {
    test(name, () => {
      expect(Math.abs(edge(shape, 15) - captured)).toBeLessThan(0.25);
      if (shape.indent?.includes('"pct"') || shape.indent?.includes('"nil"')) {
        expect(Math.abs(edge(shape, 14) - 5.32)).toBeLessThan(0.25);
        return;
      }
      const cols = shape.cols;
      const zero = edge({ ...(cols ? { cols } : {}), fixed: shape.fixed, indent: indent('0') }, 14);
      expect(edge(shape, 14) - zero).toBeCloseTo(captured - 7, 0);
    });
  }

  test('a bidiVisual table measures a signed indent from its leading edge', () => {
    for (const mode of [14, 15]) {
      for (const jc of [undefined, 'left', 'right']) {
        const at = (w: string) =>
          edge({ jc, indent: indent(w), extra: '<w:bidiVisual/>' }, mode) -
          edge({ jc, indent: indent('0'), extra: '<w:bidiVisual/>' }, mode);
        // Captured: -200 moves the leading-aligned table 10pt right, +200 10pt left; a table
        // aligned to its trailing edge (`jc="right"`) ignores the indent.
        expect(at('-200')).toBeCloseTo(jc === 'right' ? 0 : 10, 8);
        expect(at('200')).toBeCloseTo(jc === 'right' ? 0 : -10, 8);
      }
    }
  });

  test('a nested table ignores a negative indent and applies a positive one', () => {
    const inner = (w: string) =>
      tableXml({ cols: [2000], indent: indent(w) }).replace('>C0<', '>INNER<');
    const innerEdge = (w: string) => {
      const outer = firstTable(layout(documentPart(tableXml({ cellBody: inner(w) })), 15));
      const nested = outer.rows[0]!.cells[0]!.blocks.find(
        (block): block is TableFragmentRecord => block.kind === 'table'
      )!;
      const paragraph = nested.rows[0]!.cells[0]!.blocks[0]!;
      if (paragraph.kind !== 'paragraph') throw new Error('no paragraph');
      return paragraph.lines[0]!.box.x;
    };
    // Captured mode 15 edges: 13.72, 13.72 and 23.8pt for -200, 0 and +200.
    expect(Math.abs(innerEdge('-200') - 13.72)).toBeLessThan(0.25);
    expect(Math.abs(innerEdge('0') - 13.72)).toBeLessThan(0.25);
    expect(Math.abs(innerEdge('200') - 23.8)).toBeLessThan(0.25);
  });
});

describe('an over-wide left table', () => {
  // 500pt of grid in a 430pt text column, 0.5pt rules.
  const wide = { cols: [5000, 5000], sz: 4 };
  const geometry = {
    width: 530,
    height: 400,
    margin: { top: 20, right: 50, bottom: 20, left: 50 },
  };

  test('keeps a negative indent when autofit', () => {
    const part = documentPart(tableXml({ ...wide, fixed: false, indent: indent('-900') }));
    const fragment = firstTable(layout(part, 15, createLayoutSession(), 0, geometry));
    // A stated absolute width keeps the edge-aligned rule offset when the table overflows.
    expect(fragment.box.x).toBe(-45 + 0.25);
  });

  test('keeps a negative indent and its rule offset when fixed', () => {
    const part = documentPart(tableXml({ ...wide, indent: indent('-900') }));
    expect(firstTable(layout(part, 15, createLayoutSession(), 0, geometry)).box.x).toBe(-45 + 0.25);
    expect(firstTable(layout(part, 14, createLayoutSession(), 0, geometry)).box.x).toBe(-45 - 5.4);
  });

  test('applies a positive indent too', () => {
    const part = documentPart(tableXml({ ...wide, fixed: false, indent: indent('900') }));
    expect(firstTable(layout(part, 15, createLayoutSession(), 0, geometry)).box.x).toBe(45 + 0.25);
    const s = structure(tableXml({ ...wide, fixed: false, indent: indent('900') }), { width: 430 });
    expect(s.indentPt).toBe(45);
    // Legacy AutoFit with a stated indent puts the first content edge on the indent.
    expect(tableOriginX(s, 430)).toBe(45 - 5.4);
  });

  test('a positive indent past the slack of a narrower table applies in full', () => {
    const s = structure(tableXml({ indent: indent('2000') }), { mode: 14 });
    expect(tableOriginX(s, 330)).toBe(100 - 5.4);
  });
});

describe('the indent cascade', () => {
  const style = (id: string, tblPr: string, basedOn?: string) =>
    `<w:style w:type="table" w:styleId="${id}"><w:name w:val="${id}"/>` +
    `${basedOn ? `<w:basedOn w:val="${basedOn}"/>` : ''}<w:tblPr>${tblPr}</w:tblPr></w:style>`;
  const styles =
    style('Pulled', indent('-300')) +
    style('Pushed', indent('300')) +
    style('Zeroed', indent('0'), 'Pulled');

  test('a table style can supply a negative indent', () => {
    expect(structure(tableXml({ style: 'Pulled' }), { styles }).indentPt).toBe(-15);
  });

  test('a direct zero overrides the style indent in both directions', () => {
    for (const id of ['Pulled', 'Pushed']) {
      expect(structure(tableXml({ style: id, indent: indent('0') }), { styles }).indentPt).toBe(0);
    }
  });

  test('a derived style zero overrides its base style', () => {
    expect(structure(tableXml({ style: 'Zeroed' }), { styles }).indentPt).toBe(0);
  });

  test('a direct negative overrides a positive style indent', () => {
    expect(
      structure(tableXml({ style: 'Pushed', indent: indent('-100') }), { styles }).indentPt
    ).toBe(-5);
  });

  test('an unusable direct value falls back to the style indent', () => {
    for (const bad of [indent('-100', 'pct'), indent('-100', 'nil'), indent('oops')]) {
      expect(structure(tableXml({ style: 'Pulled', indent: bad }), { styles }).indentPt).toBe(-15);
    }
  });

  test('no indent anywhere is zero', () => {
    expect(structure(tableXml()).indentPt).toBe(0);
  });
});

describe('placements the indent does not reach', () => {
  test('centered and right-aligned tables ignore it', () => {
    for (const jc of ['center', 'right']) {
      const pulled = structure(tableXml({ jc, indent: indent('-400') }));
      const flush = structure(tableXml({ jc }));
      expect(tableOriginX(pulled, 330)).toBe(tableOriginX(flush, 330));
    }
  });

  test('a positioned table takes its horizontal position from w:tblpPr', () => {
    const float = '<w:tblpPr w:horzAnchor="margin" w:vertAnchor="text" w:tblpX="400"/>';
    const at = (extra: string) =>
      firstTable(layout(documentPart(tableXml({ extra: float + extra })), 15)).box.x;
    expect(at(indent('-400'))).toBe(at(''));
  });

  test('a bidiVisual table mirrors a negative indent, or ignores it when trailing-aligned', () => {
    for (const jc of [undefined, 'right']) {
      const pulled = structure(tableXml({ jc, indent: indent('-400'), extra: '<w:bidiVisual/>' }));
      const flush = structure(tableXml({ jc, indent: indent('0'), extra: '<w:bidiVisual/>' }));
      expect(pulled.indentPt).toBe(-20);
      expect(tableOriginX(pulled, 330) - tableOriginX(flush, 330)).toBe(jc ? 0 : 20);
    }
  });

  test('a nested table keeps a non-negative indent, and a positive one still applies', () => {
    const inner = (w: string) => tableXml({ cols: [1000], indent: indent(w) });
    const at = (w: string) => {
      const outer = firstTable(
        layout(documentPart(tableXml({ cols: [5000, 1000], cellBody: inner(w) })), 15)
      );
      const nested = outer.rows[0]!.cells[0]!.blocks.find(
        (block): block is TableFragmentRecord => block.kind === 'table'
      );
      if (!nested) throw new Error('no nested table');
      return nested.box.x;
    };
    expect(at('-400')).toBe(at('0'));
    expect(at('400') - at('0')).toBeCloseTo(20, 8);
    const nestedStructure = readTableStructure(
      tableNode(inner('-400')),
      200,
      1,
      undefined,
      'proposed',
      undefined,
      15
    )!;
    expect(nestedStructure.indentPt).toBe(0);
  });
});

describe('warm and cold layouts agree', () => {
  test('a relayout through the same session keeps and updates the signed indent', () => {
    const session = createLayoutSession();
    const pulled = documentPart(tableXml({ indent: indent('-200') }));
    const flush = documentPart(tableXml({ indent: indent('0') }));
    const cold = firstTable(layout(pulled, 15)).box.x;
    expect(firstTable(layout(pulled, 15, session, 0)).box.x).toBe(cold);
    expect(firstTable(layout(pulled, 15, session, 0)).box.x).toBe(cold);
    expect(firstTable(layout(flush, 15, session, 1)).box.x).toBe(
      firstTable(layout(flush, 15)).box.x
    );
    expect(firstTable(layout(pulled, 15, session, 2)).box.x).toBe(cold);
    expect(cold).toBe(-8.5);
  });

  test('a hostile indent stays finite and bounded in the layout', () => {
    const part = documentPart(tableXml({ indent: indent('-999999999') }));
    const fragment = firstTable(layout(part, 14));
    expect(Number.isFinite(fragment.box.x)).toBe(true);
    expect(fragment.box.x).toBe(-LIMIT - 5.4);
    for (const cell of fragment.rows[0]!.cells) expect(Number.isFinite(cell.box.x)).toBe(true);
  });
});
