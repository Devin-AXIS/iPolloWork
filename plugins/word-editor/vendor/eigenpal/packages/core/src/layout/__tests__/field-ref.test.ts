// REF instruction recognition, story resolution and calibration (field-ref.ts).
//
// The instruction is attacker-controlled: everything outside the supported grammar must
// resolve to null so the field keeps its cached result. Resolution reads the bookmark target
// and the resolved list items; a missing bookmark or an unnumbered target under a number
// switch resolves to null the same way. Live values are gated per field by CALIBRATION: a
// non-empty authored cache the computed value cannot reproduce keeps that cache permanently.

import { describe, expect, test } from 'bun:test';
import {
  isFldSimple,
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { parseRefInstruction, resolveStoryRefFields, type RefFieldSpec } from '../field-ref.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { resolveStoryListItems } from '../list-resolve.ts';
import { isFldChar, MAX_FIELD_INSTRUCTION_CHARS } from '../field-instruction.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

describe('parseRefInstruction', () => {
  test('recognizes the bare form and each supported switch', () => {
    expect(parseRefInstruction(' REF _Ref137575642 ')).toEqual({
      bookmark: '_Ref137575642',
      numberSwitch: null,
      hyperlink: false,
    });
    expect(parseRefInstruction(' REF _Ref137575642 \\r \\h \\* MERGEFORMAT ')).toEqual({
      bookmark: '_Ref137575642',
      numberSwitch: 'r',
      hyperlink: true,
    });
    expect(parseRefInstruction('REF target \\w')?.numberSwitch).toBe('w');
    expect(parseRefInstruction('REF target \\n')?.numberSwitch).toBe('n');
    // The keyword matches case-insensitively; the bookmark name keeps its authored case.
    expect(parseRefInstruction('ref MixedCase \\R')).toEqual({
      bookmark: 'MixedCase',
      numberSwitch: 'r',
      hyperlink: false,
    });
    expect(parseRefInstruction('REF "quoted name" \\h')?.bookmark).toBe('quoted name');
  });

  test('several number switches take the deterministic precedence n over r over w', () => {
    // Real instructions write `\w \n \h` and cache the `\n`-shaped value.
    expect(parseRefInstruction('REF x \\w \\n \\h')?.numberSwitch).toBe('n');
    expect(parseRefInstruction('REF x \\r \\w')?.numberSwitch).toBe('r');
    expect(parseRefInstruction('REF x \\w \\r')?.numberSwitch).toBe('r');
  });

  test('the `\\t` switch parses, stacked or alone, without changing the public members', () => {
    // The suppress flag rides the modifier side channel, so the spec object stays this shape.
    expect(parseRefInstruction('REF target \\t')).toEqual({
      bookmark: 'target',
      numberSwitch: null,
      hyperlink: false,
    });
    // The certificate-template stack: number switches, hyperlink, `\t`, MERGEFORMAT.
    expect(parseRefInstruction(' REF _Ref1 \\w \\n \\h \\t \\* MERGEFORMAT ')).toEqual({
      bookmark: '_Ref1',
      numberSwitch: 'n',
      hyperlink: true,
    });
  });

  test('NOTEREF parses its bookmark, `\\h` and MERGEFORMAT — nothing else', () => {
    expect(parseRefInstruction(' NOTEREF _Ref9 ')).toEqual({
      bookmark: '_Ref9',
      numberSwitch: null,
      hyperlink: false,
    });
    expect(parseRefInstruction('noteref _Ref9 \\h \\* MERGEFORMAT')).toEqual({
      bookmark: '_Ref9',
      numberSwitch: null,
      hyperlink: true,
    });
    // `\p` (above/below text) and `\f` (note-style formatting) are out of scope on purpose:
    // their presence keeps the whole field on its cached result.
    expect(parseRefInstruction('NOTEREF _Ref9 \\p')).toBeNull();
    expect(parseRefInstruction('NOTEREF _Ref9 \\f')).toBeNull();
    expect(parseRefInstruction('NOTEREF _Ref9 \\h \\p')).toBeNull();
    // Number switches belong to REF, not NOTEREF.
    expect(parseRefInstruction('NOTEREF _Ref1 \\r')).toBeNull();
    expect(parseRefInstruction('NOTEREF')).toBeNull();
    expect(parseRefInstruction(`NOTEREF ${'x'.repeat(257)}`)).toBeNull();
  });

  test('anything outside the supported grammar stays inert (null)', () => {
    // Unknown switches fall back to the cached result — never a guess.
    expect(parseRefInstruction('REF target \\p')).toBeNull();
    expect(parseRefInstruction('REF target \\f')).toBeNull();
    expect(parseRefInstruction('REF target \\d "-"')).toBeNull();
    expect(parseRefInstruction('REF target \\# 0.00')).toBeNull();
    expect(parseRefInstruction('REF target \\* Upper')).toBeNull();
    // Missing or malformed bookmark argument.
    expect(parseRefInstruction('REF')).toBeNull();
    expect(parseRefInstruction('REF \\r')).toBeNull();
    expect(parseRefInstruction(`REF ${'x'.repeat(257)}`)).toBeNull();
    expect(parseRefInstruction('REF "unterminated')).toBeNull();
    // Other keywords are not this field.
    expect(parseRefInstruction('SEQ figure')).toBeNull();
    // PAGEREF parses (its value defers to pagination finalize), but only `\h` and the inert
    // `\* MERGEFORMAT` are in its grammar — `\p` keeps the cache.
    expect(parseRefInstruction('PAGEREF _Ref1 \\h')?.bookmark).toBe('_Ref1');
    expect(parseRefInstruction('PAGEREF _Ref1 \\p')).toBeNull();
    // Over the shared instruction cap fails closed.
    expect(parseRefInstruction(`REF ${'y'.repeat(MAX_FIELD_INSTRUCTION_CHARS)}`)).toBeNull();
  });

  test('a hostile bookmark name is only ever a Map key', () => {
    // `__proto__` parses as an ordinary name; resolution looks it up in a Map and finds
    // nothing, polluting nothing.
    expect(parseRefInstruction('REF __proto__ \\r')?.bookmark).toBe('__proto__');
  });
});

function numberingOf(xml: string) {
  const result = readOoxmlPart(`<w:numbering xmlns:w="${W}">${xml}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return buildNumberingIndex(result.part.root);
}

function document(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function blocksOf(part: OoxmlPart): OoxmlElement[] {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  )!;
  return body.children.filter(
    (child): child is OoxmlElement => child.kind === 'paragraph' || child.kind === 'table'
  );
}

/** Field anchor ids (begin `w:fldChar` / `w:fldSimple`) in document order, for lookups. */
function refAnchorIds(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (isFldChar(node, 'begin') || isFldSimple(node)) ids.push(node.id);
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return ids;
}

const numbered = (ilvl: number, inner: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="5"/></w:numPr></w:pPr>${inner}</w:p>`;
const bookmarked = (name: string, text: string) =>
  `<w:bookmarkStart w:id="1" w:name="${name}"/><w:r><w:t>${text}</w:t></w:r>` +
  `<w:bookmarkEnd w:id="1"/>`;
/** A complex REF; an empty `cached` writes NO result run (always calibration-eligible). */
const refField = (instr: string, cached = '') =>
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText>${instr}</w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  (cached ? `<w:r><w:t>${cached}</w:t></w:r>` : '') +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';

const TWO_LEVEL_NUMBERING = `
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>
`;

function contextUnder(numberingXml: string, part: OoxmlPart) {
  const blocks = blocksOf(part);
  const listItems = resolveStoryListItems(blocks, numberingOf(numberingXml), undefined);
  return resolveStoryRefFields(blocks, listItems);
}

/** The live value the `ordinal`-th field (document order) paints, or null for its cache. */
function liveAt(
  part: OoxmlPart,
  context: ReturnType<typeof resolveStoryRefFields>,
  ordinal: number,
  spec: RefFieldSpec
): string | null {
  const anchorId = refAnchorIds(part)[ordinal];
  if (anchorId === undefined) throw new Error('no such field');
  return context!.liveValueOf(anchorId, spec);
}

const spec = (
  bookmark: string,
  numberSwitch: RefFieldSpec['numberSwitch'] = null
): RefFieldSpec => ({ bookmark, numberSwitch, hyperlink: false });

describe('resolveStoryRefFields', () => {
  test('a story with no REF field resolves to null', () => {
    const part = document(numbered(0, bookmarked('_Ref1', 'Heading')) + '<w:p/>');
    expect(contextUnder(TWO_LEVEL_NUMBERING, part)).toBeNull();
  });

  test('number switches resolve the number with the trailing period trimmed', () => {
    const part = document(
      numbered(0, bookmarked('top', 'One')) +
        numbered(1, bookmarked('sub', 'One point one')) +
        refField(' REF top \\r ') +
        refField(' REF sub \\w ') +
        refField(' REF sub \\n ')
    );
    const context = contextUnder(TWO_LEVEL_NUMBERING, part);
    // `1.` trims its bare trailing period; `1.1` keeps its interior one.
    expect(liveAt(part, context, 0, spec('top', 'r'))).toBe('1');
    expect(liveAt(part, context, 1, spec('sub', 'w'))).toBe('1.1');
    expect(liveAt(part, context, 2, spec('sub', 'n'))).toBe('1.1');
  });

  test('a plain REF extracts the bookmarked text, capped inside the target paragraph', () => {
    const part = document(
      `<w:p><w:r><w:t>lead </w:t></w:r>${bookmarked('term', 'Closing Date')}` +
        `<w:r><w:t> tail</w:t></w:r></w:p>` +
        refField(' REF term ')
    );
    const context = contextUnder(TWO_LEVEL_NUMBERING, part);
    expect(liveAt(part, context, 0, spec('term'))).toBe('Closing Date');
  });

  test('missing bookmark and unnumbered target resolve to null (cached fallback)', () => {
    const part = document(
      `<w:p>${bookmarked('plain', 'no number here')}</w:p>` +
        refField(' REF absent ') +
        refField(' REF plain \\r ')
    );
    const context = contextUnder(TWO_LEVEL_NUMBERING, part);
    expect(liveAt(part, context, 0, spec('absent'))).toBeNull();
    expect(liveAt(part, context, 1, spec('plain', 'r'))).toBeNull();
  });

  test('the first declaration of a duplicated name wins, in document order', () => {
    const part = document(
      numbered(0, bookmarked('dup', 'first')) +
        numbered(0, bookmarked('dup', 'second')) +
        refField(' REF dup \\r ')
    );
    const context = contextUnder(TWO_LEVEL_NUMBERING, part);
    expect(liveAt(part, context, 0, spec('dup', 'r'))).toBe('1');
  });

  test('a spec that disagrees with the scanned field fails to the cache', () => {
    const part = document(numbered(0, bookmarked('t', 'A')) + refField(' REF t \\r '));
    const context = contextUnder(TWO_LEVEL_NUMBERING, part);
    expect(liveAt(part, context, 0, spec('t', 'w'))).toBeNull();
    expect(liveAt(part, context, 0, spec('other', 'r'))).toBeNull();
  });

  test('paragraph tokens and the story token move with the resolved values', () => {
    const before = document(
      numbered(0, bookmarked('t', 'A')) +
        numbered(0, '<w:r><w:t>B</w:t></w:r>') +
        refField(' REF t \\r ')
    );
    // Same markup with one numbered paragraph inserted ahead: the target renumbers 1 → 2.
    const after = document(
      numbered(0, '<w:r><w:t>Z</w:t></w:r>') +
        numbered(0, bookmarked('t', 'A')) +
        numbered(0, '<w:r><w:t>B</w:t></w:r>') +
        refField(' REF t \\r ')
    );
    const beforeContext = contextUnder(TWO_LEVEL_NUMBERING, before)!;
    const afterContext = contextUnder(TWO_LEVEL_NUMBERING, after)!;
    expect(beforeContext.valuesToken).not.toBe(afterContext.valuesToken);
    const refParagraphBefore = blocksOf(before).at(-1)!;
    const refParagraphAfter = blocksOf(after).at(-1)!;
    expect(beforeContext.tokenForParagraph(refParagraphBefore.id)).not.toBe(
      afterContext.tokenForParagraph(refParagraphAfter.id)
    );
    // A paragraph with no REF field keys nothing.
    expect(beforeContext.tokenForParagraph(blocksOf(before)[0]!.id)).toBe('');
  });
});

/** The standard legal shape: deep levels state only their OWN placeholder. */
const LEGAL_NUMBERING = `
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/>
      <w:lvlText w:val="(%3)"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="3"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/>
      <w:lvlText w:val="(%4)"/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>
`;

describe('number switches compose from the counter path', () => {
  // Counters at the deep targets: 1, 2, 3, 2 — the `(c)` marker alone is not the number a
  // reader cites; Word's cached result says `1.2(c)`, and the live value must match it.
  const body =
    numbered(0, bookmarked('art', 'Article one')) +
    numbered(1, '<w:r><w:t>1.1</w:t></w:r>') +
    numbered(1, bookmarked('sec', 'Section 1.2')) +
    numbered(2, '<w:r><w:t>(a)</w:t></w:r>') +
    numbered(2, '<w:r><w:t>(b)</w:t></w:r>') +
    numbered(2, bookmarked('clause', 'Clause (c)')) +
    numbered(3, '<w:r><w:t>(i)</w:t></w:r>') +
    numbered(3, bookmarked('item', 'Item (ii)')) +
    refField(' REF clause \\w ') +
    refField(' REF item \\r ') +
    refField(' REF sec \\w ') +
    refField(' REF art \\r ') +
    refField(' REF clause \\n ') +
    refField(' REF item \\n ');
  const part = document(body);
  const context = contextUnder(LEGAL_NUMBERING, part);

  test('`\\r` / `\\w` paint the full context, not the bare marker', () => {
    expect(liveAt(part, context, 0, spec('clause', 'w'))).toBe('1.2(c)');
    expect(liveAt(part, context, 1, spec('item', 'r'))).toBe('1.2(c)(ii)');
  });

  test('a level whose placeholder a deeper kept text displays is dropped once, not twice', () => {
    // lvl0's %1 appears in lvl1's `%1.%2`, so `1.` is dropped and the result is not `1.1.2`.
    expect(liveAt(part, context, 2, spec('sec', 'w'))).toBe('1.2');
    // The shallowest target keeps only itself; the bare trailing period trims.
    expect(liveAt(part, context, 3, spec('art', 'r'))).toBe('1');
  });

  test('`\\n` paints the target level alone, without its ancestors', () => {
    expect(liveAt(part, context, 4, spec('clause', 'n'))).toBe('(c)');
    expect(liveAt(part, context, 5, spec('item', 'n'))).toBe('(ii)');
  });

  test('w:isLgl renders inherited placeholders decimal in the composition too', () => {
    const numbering = `
      <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/>
          <w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:isLgl/>
          <w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>
    `;
    const lglPart = document(
      numbered(0, '<w:r><w:t>I.</w:t></w:r>') +
        numbered(1, bookmarked('lgl', 'legal item')) +
        refField(' REF lgl \\w ')
    );
    const lglContext = contextUnder(numbering, lglPart);
    // The upperRoman `%1` renders decimal under the legal level, exactly as its marker does:
    // `1.1`, never `I.1`.
    expect(liveAt(lglPart, lglContext, 0, spec('lgl', 'w'))).toBe('1.1');
  });

  test('a bullet target still falls back to the cached result, never a glyph', () => {
    const numbering = `
      <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/>
          <w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>
    `;
    const bulletPart = document(numbered(0, bookmarked('b', 'bulleted')) + refField(' REF b \\r '));
    const bulletContext = contextUnder(numbering, bulletPart);
    expect(liveAt(bulletPart, bulletContext, 0, spec('b', 'r'))).toBeNull();
  });
});

describe('calibration: the authored cache is the oracle', () => {
  // A mixed roman/letter/decimal chain whose level texts never chain: the composition joins
  // every ancestor (`II` + `b.3`) while Word's cache reads `2.3`. Such a field must stay on
  // its cache verbatim, while a field the composition reproduces goes live.
  const MIXED_NUMBERING = `
    <w:abstractNum w:abstractNumId="0">
      <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/>
        <w:lvlText w:val="%1"/><w:lvlJc w:val="left"/></w:lvl>
      <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/>
        <w:lvlText w:val="%2."/><w:lvlJc w:val="left"/></w:lvl>
      <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
        <w:lvlText w:val="%2.%3"/><w:lvlJc w:val="left"/></w:lvl>
    </w:abstractNum>
    <w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>
  `;
  const body =
    numbered(0, '<w:r><w:t>First</w:t></w:r>') +
    numbered(0, '<w:r><w:t>Second</w:t></w:r>') +
    numbered(1, '<w:r><w:t>a</w:t></w:r>') +
    numbered(1, '<w:r><w:t>b</w:t></w:r>') +
    numbered(2, '<w:r><w:t>one</w:t></w:r>') +
    numbered(2, '<w:r><w:t>two</w:t></w:r>') +
    numbered(2, bookmarked('deep', 'three')) +
    // Word's cache is `2.3`; the composition joins `IIb.3` — this field must stay cached.
    refField(' REF deep \\w ', '2.3') +
    // The own-level `\n` value IS `b.3`; this field calibrates and goes live.
    refField(' REF deep \\n ', 'b.3');

  test('a mismatching field keeps its cache, a matching one goes live', () => {
    const part = document(body);
    const context = contextUnder(MIXED_NUMBERING, part)!;
    expect(liveAt(part, context, 0, spec('deep', 'w'))).toBeNull();
    expect(liveAt(part, context, 1, spec('deep', 'n'))).toBe('b.3');
    // The token carries the painted output of both: the constant cache and the live value.
    const refParagraphs = blocksOf(part).slice(-2);
    expect(context.tokenForParagraph(refParagraphs[0]!.id)).toContain('2.3');
    expect(context.tokenForParagraph(refParagraphs[1]!.id)).toContain('b.3');
  });

  test('a `\\t` value that cannot reproduce the authored cache keeps that cache', () => {
    // The filter yields `1`, the cache says `Section 1` — the field stays cached forever.
    const part = document(
      numbered(0, bookmarked('t', 'A')) + refField(' REF t \\r \\t ', 'Section 1')
    );
    const context = contextUnder(TWO_LEVEL_NUMBERING, part);
    expect(liveAt(part, context, 0, parseRefInstruction(' REF t \\r \\t ')!)).toBeNull();
  });

  test('normalization: NBSP and whitespace runs do not fail an otherwise exact match', () => {
    const part = document(
      numbered(0, bookmarked('t', 'A')) +
        // The cache says `1` with a leading NBSP and a trailing space.
        refField(' REF t \\r ', '\u00A01 ')
    );
    const context = contextUnder(TWO_LEVEL_NUMBERING, part);
    expect(liveAt(part, context, 0, spec('t', 'r'))).toBe('1');
  });
});

/** Level texts with literal words — what the `\t` switch exists to suppress. */
const WORDY_NUMBERING = `
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="Section %1."/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
      <w:lvlText w:val="Section %1.%2"/><w:lvlJc w:val="left"/></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/>
      <w:lvlText w:val="(%3)"/><w:lvlJc w:val="left"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>
`;

describe('the \\t switch suppresses non-delimiter text in the referenced number', () => {
  // Counters at the targets: `Section 1.2` (ilvl 1, second item) and `(c)` (ilvl 2, third).
  const body =
    numbered(0, '<w:r><w:t>Section one</w:t></w:r>') +
    numbered(1, '<w:r><w:t>1.1</w:t></w:r>') +
    numbered(1, bookmarked('sec', 'Section 1.2')) +
    numbered(2, '<w:r><w:t>(a)</w:t></w:r>') +
    numbered(2, '<w:r><w:t>(b)</w:t></w:r>') +
    numbered(2, bookmarked('clause', 'Clause (c)')) +
    refField(' REF sec \\w \\t ') +
    refField(' REF sec \\w ') +
    refField(' REF clause \\n \\t ') +
    refField(' REF clause \\w \\n \\h \\t \\* MERGEFORMAT ') +
    refField(' REF clause \\w \\t ') +
    refField(' REF sec \\t ');
  const part = document(body);
  const context = contextUnder(WORDY_NUMBERING, part);

  test('`Section %1.%2` yields `1.2`; without `\\t` the words stay', () => {
    expect(liveAt(part, context, 0, parseRefInstruction(' REF sec \\w \\t ')!)).toBe('1.2');
    expect(liveAt(part, context, 1, spec('sec', 'w'))).toBe('Section 1.2');
  });

  test('a letter level `(%3)` keeps `(c)` — parentheses are delimiters, wherever they sit', () => {
    expect(liveAt(part, context, 2, parseRefInstruction(' REF clause \\n \\t ')!)).toBe('(c)');
    // The full stacked shape: `\n` outranks `\w`; `\h` and MERGEFORMAT stay inert.
    expect(
      liveAt(part, context, 3, parseRefInstruction(' REF clause \\w \\n \\h \\t \\* MERGEFORMAT ')!)
    ).toBe('(c)');
  });

  test('`\\w \\t` filters every kept level of the full context', () => {
    expect(liveAt(part, context, 4, parseRefInstruction(' REF clause \\w \\t ')!)).toBe('1.2(c)');
  });

  test('`\\t` on a plain REF has no counter template to filter — cached fallback', () => {
    expect(liveAt(part, context, 5, parseRefInstruction(' REF sec \\t ')!)).toBeNull();
  });
});
