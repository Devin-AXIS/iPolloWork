// Fields nested inside another field's instruction are input to that field, never displayed.
//
// A conditional field can compare the results of nested fields: `IF { STYLEREF x } <> "…"`.
// Those nested results sit between the outer `begin` and `separate`, and only the outer cached
// result is displayed. A nested `w:fldSimple` used to paint its own cached result there, so a
// cached line break inside it added lines to a header table row. The rule holds at every open
// level, keeps each nested field's model unit, and leaves nested fields in a result phase alone.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { segmentsOf } from '../../store/store/tree-op-segments.ts';
import { paragraphModelTextOf } from '../../store/store/paragraph-model-text.ts';
import { projectVisibleParagraphText } from '../../store/store/text-projection.ts';
import type { OoxmlParagraphNode } from '../../store/package/ooxml-tree.ts';
import {
  piecesOfParagraph,
  type FieldLinkProjector,
  type FieldPageContext,
} from '../field-projection.ts';
import type { HyperlinkFieldSpec } from '../field-link.ts';
import { piecesOfParagraphForDisplay } from '../field-projection-walk.ts';
import {
  createFieldParseState,
  MAX_FIELD_NESTING,
  onFldCharBegin,
  onFldCharEnd,
  onFldCharSeparate,
} from '../field-instruction.ts';
import { isInsideOpenFieldInstruction } from '../field-instruction-scope.ts';
import type { MutableModelRange } from '../field-pieces.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { createFixedMeasurer } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

const BEGIN = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>';
const SEPARATE = '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const instr = (text: string) =>
  `<w:r><w:instrText xml:space="preserve">${text}</w:instrText></w:r>`;
const run = (content: string) => `<w:r>${content}</w:r>`;
const text = (value: string) => run(`<w:t xml:space="preserve">${value}</w:t>`);
const simple = (instruction: string, result: string) =>
  `<w:fldSimple w:instr="${instruction}">${result}</w:fldSimple>`;
const styleRef = (result: string) => simple(' STYLEREF Heading ', result);

/** `IF {a} <> "x" {b}` with a cached outer result. */
const conditional = (first: string, second: string, result: string) =>
  BEGIN +
  instr(' IF ') +
  first +
  instr(' &lt;&gt; "x" ') +
  second +
  instr(' ') +
  SEPARATE +
  result +
  END;

function partOf(root: string, name = '/word/document.xml'): OoxmlPart {
  const result = readOoxmlPart(root, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphOf(body: string): OoxmlParagraphNode {
  const root = partOf(
    `<w:document xmlns:w="${W}"><w:body><w:p>${body}</w:p></w:body></w:document>`
  ).root;
  const find = (node: OoxmlNode): OoxmlNode | undefined => {
    if (node.kind === 'paragraph') return node;
    if (node.kind === 'textValue') return undefined;
    for (const child of node.children ?? []) {
      const hit = find(child);
      if (hit) return hit;
    }
    return undefined;
  };
  return find(root) as OoxmlParagraphNode;
}

type Painted = [text: string, start: number, end: number];

function painted(body: string, pageContext?: FieldPageContext): Painted[] {
  return piecesOfParagraph(paragraphOf(body), [], pageContext).map((piece) => [
    piece.text,
    piece.start,
    piece.end,
  ]);
}

/** The store's model length — layout never moves an offset the store assigns. */
function modelLength(body: string): number {
  const segments = segmentsOf(paragraphOf(body));
  return segments.length === 0 ? 0 : segments[segments.length - 1]!.end;
}

describe('nested simple fields inside a complex field instruction', () => {
  test('cached results do not paint; the outer cached result does', () => {
    const body =
      text('A') +
      conditional(styleRef(run('<w:cr/>')), styleRef(run('<w:cr/>')), text('R')) +
      text('Z');
    // Units: A, the IF atom, two nested simple atoms, Z. Z keeps the store offset.
    expect(modelLength(body)).toBe(5);
    expect(painted(body)).toEqual([
      ['A', 0, 1],
      ['R', 1, 2],
      ['Z', 4, 5],
    ]);
  });

  test('text, tab, break, carriage return, and hyperlink results stay out', () => {
    const rich = run('<w:t>nested</w:t><w:tab/><w:br/><w:cr/>');
    const linked = `<w:hyperlink w:anchor="target">${text('linked')}</w:hyperlink>`;
    const body = conditional(styleRef(rich), styleRef(linked), text('shown'));
    expect(painted(body)).toEqual([['shown', 0, 1]]);
  });

  test('empty nested caches and an empty outer cache paint nothing', () => {
    const body = text('A') + conditional(styleRef(''), styleRef(''), '') + text('Z');
    expect(painted(body)).toEqual([
      ['A', 0, 1],
      ['Z', 4, 5],
    ]);
  });

  test('a nested field result never becomes part of the outer instruction', () => {
    const seen: HyperlinkFieldSpec[] = [];
    const projector: FieldLinkProjector = (spec) => {
      seen.push(spec);
      return null;
    };
    const body =
      BEGIN +
      instr(' HYPERLINK ') +
      styleRef(text('https://nested.example')) +
      SEPARATE +
      text('Go') +
      END;
    const pieces = piecesOfParagraph(
      paragraphOf(body),
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      projector
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Go']);
    expect(seen.some((spec) => spec.target?.includes('nested'))).toBe(false);
  });

  test('a nested hyperlink field in the instruction is never projected', () => {
    const seen: HyperlinkFieldSpec[] = [];
    const projector: FieldLinkProjector = (spec) => {
      seen.push(spec);
      return null;
    };
    const nested = simple(' HYPERLINK &quot;https://example.test&quot; ', text('link'));
    const pieces = piecesOfParagraph(
      paragraphOf(conditional(nested, '', text('R'))),
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      projector
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['R']);
    expect(seen).toEqual([]);
  });

  test('a deleted nested field keeps its deleted model unit', () => {
    const deleted = `<w:del w:id="1" w:author="Reviewer">${styleRef(text('gone'))}</w:del>`;
    const ranges: MutableModelRange[] = [];
    const pieces = piecesOfParagraph(
      paragraphOf(conditional(deleted, '', text('R'))),
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      'allMarkup',
      ranges
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['R']);
    expect(ranges).toEqual([{ start: 1, end: 2 }]);
  });
});

describe('the rule holds at every open level', () => {
  test('a simple field in a nested instruction inside a cached result stays out', () => {
    const body =
      text('A') +
      BEGIN +
      instr(' QUOTE ') +
      SEPARATE +
      text('R1') +
      conditional(styleRef(text('S')), '', text('R2')) +
      END +
      text('Z');
    expect(modelLength(body)).toBe(4);
    expect(painted(body)).toEqual([
      ['A', 0, 1],
      ['R1R2', 1, 2],
      ['Z', 3, 4],
    ]);
  });

  test('a complex field result in a nested instruction stays out of the cached result', () => {
    const inner = BEGIN + instr(' STYLEREF Heading ') + SEPARATE + text('C') + END;
    const body =
      BEGIN + instr(' QUOTE ') + SEPARATE + text('R1') + conditional(inner, '', text('R2')) + END;
    expect(painted(body)).toEqual([['R1R2', 0, 1]]);
  });

  test('a complex field result in the outer instruction stays out, as before', () => {
    const inner = BEGIN + instr(' STYLEREF Heading ') + SEPARATE + text('C') + END;
    expect(painted(conditional(inner, '', text('R')))).toEqual([['R', 0, 1]]);
  });

  test('a page field inside a nested instruction never adds a live number', () => {
    const page = BEGIN + instr(' PAGE ') + SEPARATE + text('9') + END;
    const context = { pageNumber: 3, pageCount: 5 };
    const hidden =
      BEGIN + instr(' QUOTE ') + SEPARATE + text('R1') + conditional(page, '', text('R2')) + END;
    expect(painted(hidden, context)).toEqual([['R1R2', 0, 1]]);
    // The same page field directly in the cached result still evaluates per sheet.
    const shown = BEGIN + instr(' QUOTE ') + SEPARATE + text('R1') + page + END;
    expect(painted(shown, context)).toEqual([['R13', 0, 1]]);
  });
});

describe('fields outside an atomic instruction keep painting', () => {
  test('a simple field in the outer cached result paints its own result', () => {
    const body = BEGIN + instr(' QUOTE ') + SEPARATE + text('R') + styleRef(text('S')) + END;
    expect(painted(body)).toEqual([
      ['S', 1, 2],
      ['R', 0, 1],
    ]);
  });

  test('an unterminated field demotes and its nested field paints as inert text', () => {
    const body = text('A') + BEGIN + instr(' IF ') + styleRef(text('S')) + SEPARATE + text('R');
    expect(modelLength(body)).toBe(3);
    expect(painted(body)).toEqual([
      ['A', 0, 1],
      ['S', 1, 2],
      ['R', 2, 3],
    ]);
  });

  test('nesting past the depth bound demotes; offsets still follow the store', () => {
    let body = styleRef(text('S'));
    for (let level = 0; level <= MAX_FIELD_NESTING; level += 1) {
      body = BEGIN + instr(' IF ') + body + SEPARATE + text(`R${level}`) + END;
    }
    const length = modelLength(body);
    const pieces = painted(body);
    expect(pieces.map(([value]) => value).join('')).toContain('S');
    for (const [, start, end] of pieces) {
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(length);
    }
  });

  test('the instruction text itself never paints', () => {
    const pieces = painted(conditional(styleRef(text('S')), '', text('R')));
    expect(pieces.map(([value]) => value).join('')).not.toMatch(/IF|STYLEREF|&lt;|<>/);
  });
});

describe('saved results inside a simple field', () => {
  const quote = (result: string) => text('A') + simple(' QUOTE x ', result) + text('Z');
  const pageContext = { pageNumber: 3, pageCount: 5 };
  const complexPage = BEGIN + instr(' PAGE ') + SEPARATE + text('9') + END;

  test('a simple field in a nested instruction adds no text or line break', () => {
    const body = quote(conditional(styleRef(run('<w:t>S</w:t><w:cr/>')), '', text('R')));
    expect(painted(body)).toEqual([
      ['A', 0, 1],
      ['R', 1, 2],
      ['Z', 2, 3],
    ]);
  });

  test('a complex field result in a nested instruction adds no text', () => {
    const inner = BEGIN + instr(' STYLEREF H ') + SEPARATE + text('C') + END;
    expect(painted(quote(conditional(inner, '', text('R'))))).toEqual([
      ['A', 0, 1],
      ['R', 1, 2],
      ['Z', 2, 3],
    ]);
  });

  test('a begin with no separate and no end hides nothing after it', () => {
    const body = quote(text('R') + BEGIN + instr(' IF ') + text('T'));
    expect(painted(body)[1]).toEqual(['RT', 1, 2]);
  });

  test('a begin with a separate and no end hides only its instruction', () => {
    const body = quote(text('R') + BEGIN + instr(' IF ') + text('X') + SEPARATE + text('T'));
    expect(painted(body)[1]).toEqual(['RT', 1, 2]);
  });

  test('a begin with an end and no separate hides its content', () => {
    const body = quote(text('R') + BEGIN + instr(' IF ') + text('X') + END + text('T'));
    expect(painted(body)[1]).toEqual(['RT', 1, 2]);
  });

  test('a page field in a nested instruction adds neither saved digits nor a live number', () => {
    const complexInInstruction = simple(' STYLEREF H ', conditional(complexPage, '', text('R')));
    expect(painted(complexInInstruction, pageContext)).toEqual([['R', 0, 1]]);
    const simplePage = simple(' PAGE ', text('9'));
    const simpleInInstruction = simple(' STYLEREF H ', conditional(simplePage, '', text('R')));
    expect(painted(simpleInInstruction, pageContext)).toEqual([['R', 0, 1]]);
  });

  test('a page field in a saved result still evaluates per sheet', () => {
    const direct = simple(' STYLEREF H ', text('R') + complexPage);
    expect(painted(direct, pageContext)).toEqual([['R3', 0, 1]]);
    const inNestedResult = simple(' STYLEREF H ', conditional('', '', text('R') + complexPage));
    expect(painted(inNestedResult, pageContext)).toEqual([['R3', 0, 1]]);
  });

  test('a simple field in a nested saved result still displays', () => {
    const body = simple(' QUOTE x ', conditional('', '', text('R') + styleRef(text('S'))));
    expect(painted(body)).toEqual([['RS', 0, 1]]);
  });

  test('field-code view is unchanged', () => {
    const body = quote(conditional(styleRef(run('<w:t>S</w:t><w:cr/>')), '', text('R')));
    const codes = piecesOfParagraphForDisplay(
      paragraphOf(body),
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      true
    ).map((piece) => [piece.text, piece.start, piece.end]);
    expect(codes).toEqual([
      ['A', 0, 1],
      ['{ QUOTE x }', 1, 2],
      ['Z', 2, 3],
    ]);
  });
});

describe('layout and the store show the same text', () => {
  /** Painted text in model order, which is the store's visible order. */
  const paintedText = (body: string) =>
    [...painted(body)]
      .sort((left, right) => left[1] - right[1])
      .map(([value]) => value)
      .join('');
  const storeText = (body: string) => {
    const paragraph = paragraphOf(body);
    return projectVisibleParagraphText(paragraph, paragraphModelTextOf(paragraph)).text;
  };
  const inserted = `<w:ins w:id="1" w:author="Reviewer">${styleRef(text('S'))}</w:ins>`;
  const deleted = `<w:del w:id="2" w:author="Reviewer">${styleRef(text('S'))}</w:del>`;
  const linked = `<w:hyperlink w:anchor="target">${styleRef(text('S'))}</w:hyperlink>`;
  const complexRef = BEGIN + instr(' STYLEREF H ') + SEPARATE + text('C') + END;
  const quote = (result: string) => BEGIN + instr(' QUOTE ') + SEPARATE + result + END;
  /** A conditional with a nested simple field, inside `wraps` nested simple fields. */
  const wrapped = (wraps: number) => {
    let field = conditional(styleRef(text('S')), '', text('R'));
    for (let level = 0; level < wraps; level += 1) field = simple(' QUOTE x ', field);
    return field;
  };
  const cases: Record<string, string> = {
    'level 1': conditional(styleRef(run('<w:t>S1</w:t><w:cr/>')), styleRef(text('S2')), text('R')),
    'level 2': quote(text('R1') + conditional(styleRef(text('S')), '', text('R2'))),
    'level 3': quote(quote(conditional(styleRef(text('S')), '', text('R3')))),
    tracked: conditional(inserted, deleted, text('R')),
    linked: conditional(linked, '', text('R')),
    'no separate in a result': quote(text('R') + BEGIN + instr(' IF ') + text('X') + END),
    'result phase': quote(text('R') + styleRef(text('S'))),
    demoted: BEGIN + instr(' IF ') + styleRef(text('S')) + SEPARATE + text('R'),
    'editable form field': BEGIN + instr(' FORMTEXT ') + styleRef(text('S')) + SEPARATE + END,
    'simple outer, simple nested': wrapped(1),
    'simple outer, complex nested': simple(' QUOTE x ', conditional(complexRef, '', text('R'))),
    'simple outer, no end': simple(' QUOTE x ', text('R') + BEGIN + instr(' IF ') + text('T')),
    'simple outer, no separate': simple(' QUOTE x ', BEGIN + instr(' IF ') + text('X') + END),
    // The innermost simple field is the last one the store scans for markers.
    'simple nesting at the depth bound': wrapped(MAX_FIELD_NESTING + 1),
    // Past the bound, the store reads plain text and shows the nested result.
    'simple nesting past the depth bound': wrapped(MAX_FIELD_NESTING + 2),
  };
  for (const [name, field] of Object.entries(cases)) {
    test(name, () => {
      const body = text('A') + field + text('Z');
      expect(paintedText(body)).toBe(storeText(body));
    });
  }

  test('the depth bound cases differ as the store reads them', () => {
    expect(storeText(wrapped(MAX_FIELD_NESTING + 1))).toBe('R');
    expect(storeText(wrapped(MAX_FIELD_NESTING + 2))).toBe('SR');
  });
});

describe('isInsideOpenFieldInstruction', () => {
  test('answers for every open level', () => {
    const state = createFieldParseState();
    expect(isInsideOpenFieldInstruction(state)).toBe(false);
    onFldCharBegin(state);
    expect(isInsideOpenFieldInstruction(state)).toBe(true);
    onFldCharSeparate(state);
    expect(isInsideOpenFieldInstruction(state)).toBe(false);
    onFldCharBegin(state);
    expect(isInsideOpenFieldInstruction(state)).toBe(true);
    onFldCharBegin(state);
    onFldCharSeparate(state);
    // Level 3 is in its result, but level 2 is still reading its instruction.
    expect(isInsideOpenFieldInstruction(state)).toBe(true);
    onFldCharEnd(state);
    onFldCharSeparate(state);
    expect(isInsideOpenFieldInstruction(state)).toBe(false);
    onFldCharEnd(state);
    onFldCharEnd(state);
    expect(isInsideOpenFieldInstruction(state)).toBe(false);
  });

  test('levels past the depth bound answer through the captured levels', () => {
    const state = createFieldParseState();
    onFldCharBegin(state);
    onFldCharSeparate(state);
    for (let level = 2; level <= MAX_FIELD_NESTING + 2; level += 1) {
      onFldCharBegin(state);
      onFldCharSeparate(state);
    }
    expect(state.nestingOverflow).toBe(true);
    expect(isInsideOpenFieldInstruction(state)).toBe(false);
  });
});

describe('header use', () => {
  const cell = (paragraph: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="1531" w:type="dxa"/></w:tcPr>${paragraph}</w:tc>`;
  const plain = (value: string) => `<w:p>${text(value)}</w:p>`;
  const header = (fieldParagraph: string) =>
    partOf(
      `<w:hdr xmlns:w="${W}"><w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>` +
        '<w:tblGrid><w:gridCol w:w="1531"/><w:gridCol w:w="1531"/></w:tblGrid>' +
        `<w:tr>${cell(plain('P'))}${cell(plain('T'))}</w:tr>` +
        `<w:tr>${cell(fieldParagraph)}${cell('<w:p/>')}</w:tr>` +
        `</w:tbl><w:p/></w:hdr>`,
      '/word/header1.xml'
    );

  /** Line count of each table row's tallest cell. */
  function rowLines(part: OoxmlPart): number[] {
    const story = layoutHeaderFooterStory(part, 400, measurer, '/word/header1.xml');
    const lines = (node: unknown): number => {
      if (!node || typeof node !== 'object') return 0;
      const record = node as Record<string, unknown>;
      const own =
        record.kind === 'paragraph' && Array.isArray(record.lines) ? record.lines.length : 0;
      return own + Object.values(record).reduce<number>((sum, value) => sum + lines(value), 0);
    };
    const rows: number[] = [];
    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (record.kind === 'table' && Array.isArray(record.rows)) {
        for (const row of record.rows as { cells: unknown[] }[]) {
          rows.push(Math.max(...row.cells.map(lines)));
        }
        return;
      }
      for (const value of Object.values(record)) visit(value);
    };
    visit(story);
    return rows;
  }

  test('nested results do not add lines to a table row', () => {
    const withNested = conditional(
      styleRef(run('<w:cr/>')),
      styleRef(run('<w:cr/>')),
      run('<w:cr/>')
    );
    const withoutNested = conditional(styleRef(''), styleRef(''), run('<w:cr/>'));
    expect(rowLines(header(`<w:p>${withNested}</w:p>`))).toEqual([1, 2]);
    expect(rowLines(header(`<w:p>${withoutNested}</w:p>`))).toEqual([1, 2]);
  });

  test('the nested fields stay in the tree and survive serialization', () => {
    const part = header(
      `<w:p>${conditional(styleRef(text('S1')), styleRef(text('S2')), text('R'))}</w:p>`
    );
    rowLines(part);
    const xml = serializeOoxmlPart(part);
    expect(xml.match(/<w:fldSimple w:instr=" STYLEREF Heading ">/g)?.length).toBe(2);
    expect(xml).toContain('S1');
    expect(xml).toContain('S2');
    const reopened = partOf(xml, '/word/header1.xml');
    expect(rowLines(reopened)).toEqual(rowLines(part));
  });
});
