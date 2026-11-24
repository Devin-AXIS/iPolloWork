// Save-time REF result refresh: the planner reuses the layout's resolution AND its
// per-field calibration verdict, the op rewrites only plain-run results, and a fresh
// document plans nothing at all.
//
// Calibration shapes every fixture here: a field goes live only after its computed value
// reproduced its authored cache once, so the stale states worth refreshing are the ones an
// EDIT creates after that calibration. A field that never matched its cache paints the
// cache — and must save it too.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { applyTreeOp } from '../../store/store/tree-op-apply.ts';
import { validateTreeOp } from '../../store/store/tree-op-validate.ts';
import { locateFieldResults } from '../../store/store/tree-op-field-results.ts';
import { planRefFieldResultRefresh } from '../field-ref-refresh.ts';
import { buildNumberingIndex } from '../numbering-index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const NUMBERING = `
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>
`;

function numberingIndexOf() {
  const result = readOoxmlPart(`<w:numbering xmlns:w="${W}">${NUMBERING}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return buildNumberingIndex(result.part.root);
}
const numberingIndex = numberingIndexOf();

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const numbered = (inner: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr></w:pPr>${inner}</w:p>`;
const bookmarked = (name: string, text: string) =>
  `<w:bookmarkStart w:id="1" w:name="${name}"/><w:r><w:t>${text}</w:t></w:r>` +
  `<w:bookmarkEnd w:id="1"/>`;
const refField = (instr: string, result: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText>${instr}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  result +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function paragraphs(part: OoxmlPart): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const walk = (node: OoxmlElement): void => {
    if (node.kind === 'paragraph') found.push(node);
    for (const child of node.children) {
      if (child.kind !== 'textValue') walk(child);
    }
  };
  walk(part.root);
  return found;
}

/**
 * Structural-sharing body edit — every surviving node kept BY IDENTITY, like a store commit.
 * Keeping the ends intact is what carries the sticky calibration verdicts across the edit.
 */
function withBlocks(
  part: OoxmlPart,
  edit: (blocks: readonly OoxmlElement[]) => readonly OoxmlElement[]
): OoxmlPart {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  )!;
  const blocks = body.children.filter(
    (child): child is OoxmlElement => child.kind === 'paragraph' || child.kind === 'table'
  );
  const edited = edit(blocks);
  const nextChildren = [
    ...edited,
    ...body.children.filter(
      (child) =>
        child.kind === 'textValue' || (child.kind !== 'paragraph' && child.kind !== 'table')
    ),
  ];
  const nextBody = { ...body, children: nextChildren } as OoxmlElement;
  const nextRoot = {
    ...part.root,
    children: part.root.children.map((child) => (child === body ? nextBody : child)),
  } as OoxmlElement;
  return { ...part, root: nextRoot };
}

/** Plan, validate and apply the refresh; answers the refreshed part (or the same one). */
function refresh(part: OoxmlPart): { part: OoxmlPart; planned: boolean } {
  const op = planRefFieldResultRefresh(part, { numberingIndex });
  if (op === null) return { part, planned: false };
  expect(validateTreeOp(part, op)).toBeNull();
  const applied = applyTreeOp(part, op);
  expect(applied.ok).toBe(true);
  if (!applied.ok || !applied.part) throw new Error('apply failed');
  return { part: applied.part, planned: true };
}

/** The instruction/cachedText pairs the store locator reads back, in document order. */
function fieldsOf(part: OoxmlPart) {
  return paragraphs(part).flatMap((paragraph) =>
    locateFieldResults(paragraph).map((field) => ({
      instruction: field.instruction,
      cachedText: field.cachedText,
    }))
  );
}

// A calibration-eligible document: the cache reproduces the computed value ('2'), and the
// REF paragraph sits LAST so the verdict registry's anchor block survives the edit below.
const calibratedBody =
  numbered('<w:r><w:t>gone soon</w:t></w:r>') +
  numbered(bookmarked('target', 'The section')) +
  `<w:p>${refField(' REF target \\r \\h \\* MERGEFORMAT ', '<w:r><w:t>2</w:t></w:r>')}</w:p>`;

describe('planRefFieldResultRefresh', () => {
  test('a calibrated field gone stale after a renumbering edit is rewritten', () => {
    const before = load(calibratedBody);
    // Calibration pass: the cache matches, so nothing is planned and the verdict sticks.
    const calibrated = refresh(before);
    expect(calibrated.planned).toBe(false);
    expect(calibrated.part).toBe(before);

    // The edit renumbers the target from 2 to 1; the cache now trails the live value.
    const after = withBlocks(before, (blocks) => blocks.filter((_, index) => index !== 0));
    const { part, planned } = refresh(after);
    expect(planned).toBe(true);
    expect(fieldsOf(part)).toEqual([
      { instruction: ' REF target \\r \\h \\* MERGEFORMAT ', cachedText: '1' },
    ]);
  });

  test('a field whose computed value never matched its cache is NOT in the plan', () => {
    // Stale from birth: '9.9' cannot be reproduced, so the field fails calibration, paints
    // its cache, and must keep that cache on save — rewriting it would export the very
    // value the calibration gate suppresses.
    const before = load(
      numbered(bookmarked('_RefA', 'First')) +
        numbered(bookmarked('_RefB', 'Second')) +
        `<w:p>${refField(' REF _RefB \\r \\h ', '<w:r><w:t>9.9</w:t></w:r>')}</w:p>`
    );
    expect(planRefFieldResultRefresh(before, { numberingIndex })).toBeNull();
  });

  test('calibration is whitespace-tolerant, and the rewrite then aligns bytes with paint', () => {
    // NBSP and doubled spaces normalize for the verdict, so these fields go LIVE — and the
    // painted value differs from the raw cache, so the save rewrites both shapes.
    const before = load(
      `<w:p>${bookmarked('term', 'Closing Date')}</w:p>` +
        `<w:p>${refField(' REF term ', '<w:r><w:t>Closing Date</w:t></w:r>')}</w:p>` +
        '<w:p><w:fldSimple w:instr=" REF term ">' +
        '<w:r><w:t xml:space="preserve">Closing  Date</w:t></w:r></w:fldSimple></w:p>'
    );
    const { part, planned } = refresh(before);
    expect(planned).toBe(true);
    expect(fieldsOf(part).map((field) => field.cachedText)).toEqual([
      'Closing Date',
      'Closing Date',
    ]);
  });

  test('preserves the first result run properties and empties surplus result runs', () => {
    // Two result runs whose combined text ('2 ') normalizes to the computed value: the
    // field calibrates live, and the raw difference drives one rewrite.
    const before = load(
      numbered(bookmarked('_RefA', 'First')) +
        numbered(bookmarked('_RefB', 'Second')) +
        `<w:p>${refField(
          ' REF _RefB \\r ',
          '<w:r><w:rPr><w:b/></w:rPr><w:t>2</w:t></w:r>' +
            '<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> </w:t></w:r>'
        )}</w:p>`
    );
    const { part, planned } = refresh(before);
    expect(planned).toBe(true);
    const field = paragraphs(part)
      .flatMap((paragraph) => locateFieldResults(paragraph))
      .find((entry) => entry.instruction.includes('REF'))!;
    expect(field.cachedText).toBe('2');
    // Bold survives on the rewritten run; the surplus run keeps its italic properties and
    // holds no text.
    const shapes: string[] = [];
    const walk = (node: OoxmlElement): void => {
      if (node.kind === 'run') {
        const hasBold = JSON.stringify(node).includes('"localName":"b"');
        const hasItalic = JSON.stringify(node).includes('"localName":"i"');
        const text = JSON.stringify(node).includes('"kind":"text"');
        shapes.push(`${hasBold ? 'b' : ''}${hasItalic ? 'i' : ''}${text ? 't' : ''}`);
      }
      for (const child of node.children) {
        if (child.kind !== 'textValue') walk(child);
      }
    };
    walk(paragraphs(part)[2]!);
    expect(shapes).toContain('bt');
    expect(shapes).toContain('i');
    expect(shapes).not.toContain('it');
  });

  test('a fresh document plans nothing and the part is untouched by identity', () => {
    const before = load(
      numbered(bookmarked('_RefA', 'First')) +
        numbered(bookmarked('_RefB', 'Second')) +
        `<w:p>${refField(' REF _RefB \\r \\h ', '<w:r><w:t>2</w:t></w:r>')}</w:p>` +
        '<w:p><w:fldSimple w:instr=" REF _RefA \\r "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>'
    );
    const { part, planned } = refresh(before);
    expect(planned).toBe(false);
    expect(part).toBe(before);
  });

  test('a calibrated result holding revision markup is skipped, never rewritten', () => {
    const before = load(
      numbered('<w:r><w:t>gone soon</w:t></w:r>') +
        numbered(bookmarked('target', 'The section')) +
        `<w:p>${refField(
          ' REF target \\r ',
          '<w:ins w:id="9" w:author="QA" w:date="2020-01-01T00:00:00Z">' +
            '<w:r><w:t>2</w:t></w:r></w:ins>'
        )}</w:p>`
    );
    expect(planRefFieldResultRefresh(before, { numberingIndex })).toBeNull();
    // The edit makes the (calibrated, live-painting) field stale — but its result carries
    // revision markup, so the refresh leaves it alone rather than corrupting the w:ins.
    const after = withBlocks(before, (blocks) => blocks.filter((_, index) => index !== 0));
    expect(planRefFieldResultRefresh(after, { numberingIndex })).toBeNull();
  });

  test('a tracked formatting change on a result run (w:rPrChange) is skipped', () => {
    const before = load(
      numbered('<w:r><w:t>gone soon</w:t></w:r>') +
        numbered(bookmarked('target', 'The section')) +
        `<w:p>${refField(
          ' REF target \\r ',
          '<w:r><w:rPr><w:b/><w:rPrChange w:id="3" w:author="QA" ' +
            'w:date="2020-01-01T00:00:00Z"><w:rPr/></w:rPrChange></w:rPr><w:t>2</w:t></w:r>'
        )}</w:p>`
    );
    expect(planRefFieldResultRefresh(before, { numberingIndex })).toBeNull();
    const after = withBlocks(before, (blocks) => blocks.filter((_, index) => index !== 0));
    expect(planRefFieldResultRefresh(after, { numberingIndex })).toBeNull();
  });

  test('a locked field (w:fldLock) is skipped', () => {
    const before = load(
      numbered('<w:r><w:t>gone soon</w:t></w:r>') +
        numbered(bookmarked('target', 'The section')) +
        '<w:p><w:r><w:fldChar w:fldCharType="begin" w:fldLock="1"/></w:r>' +
        '<w:r><w:instrText> REF target \\r </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>2</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    );
    expect(planRefFieldResultRefresh(before, { numberingIndex })).toBeNull();
    const after = withBlocks(before, (blocks) => blocks.filter((_, index) => index !== 0));
    expect(planRefFieldResultRefresh(after, { numberingIndex })).toBeNull();
  });

  test('an unsupported switch and a missing bookmark keep their cached results', () => {
    const before = load(
      numbered(bookmarked('_RefA', 'First')) +
        `<w:p>${refField(' REF _RefA \\p ', '<w:r><w:t>kept-a</w:t></w:r>')}</w:p>` +
        `<w:p>${refField(' REF _Gone \\r ', '<w:r><w:t>kept-b</w:t></w:r>')}</w:p>`
    );
    expect(planRefFieldResultRefresh(before, { numberingIndex })).toBeNull();
  });

  test('a second refresh after a first one plans nothing (idempotent)', () => {
    const before = load(calibratedBody);
    expect(refresh(before).planned).toBe(false);
    const after = withBlocks(before, (blocks) => blocks.filter((_, index) => index !== 0));
    const first = refresh(after);
    expect(first.planned).toBe(true);
    const second = refresh(first.part);
    expect(second.planned).toBe(false);
    expect(second.part).toBe(first.part);
  });
});
