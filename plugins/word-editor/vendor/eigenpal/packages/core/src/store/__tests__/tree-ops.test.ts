// Paragraph semantic operations over the canonical tree (tasks 5.1, 5.2) and the
// rejection guarantees (task 5.3): an invalid or stale op leaves the tree, revision and
// derived indexes completely unchanged.

import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  ACCEPTED_PARAGRAPH_PROPERTIES,
  ACCEPTED_RUN_PROPERTIES,
  applyTreeOp,
  paragraphTextOf,
  validateTreeOp,
  type TreeDocOp,
} from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:a="${A}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paraIdAttrOf(part: OoxmlPart, paragraphId: string): string | undefined {
  let found: string | undefined;
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.id === paragraphId) {
      found = node.attributes.find(
        (attribute) => attribute.namespaceUri === W14 && attribute.localName === 'paraId'
      )?.value;
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return found;
}

function paragraphIds(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') ids.push(node.id);
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return ids;
}

const SIMPLE = '<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>';
const FORMATTED =
  '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t xml:space="preserve"> plain</w:t></w:r></w:p>';
const WITH_UNKNOWN =
  '<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>' +
  '<w:r><w:drawing><a:graphic uri="urn:clip"/></w:drawing></w:r>' +
  '<w:r><w:t>after</w:t></w:r></w:p>';

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.part;
}

describe('text operations over UTF-16 offsets (task 5.1)', () => {
  test('insertText places characters at the offset', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'insertText', paragraphId: id!, offset: 5, text: ' there' });
    expect(paragraphTextOf(next, id!)).toBe('Hello there world');
  });

  test('insertText at the start and at the end', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    expect(
      paragraphTextOf(
        apply(part, { op: 'insertText', paragraphId: id!, offset: 0, text: '>' }),
        id!
      )
    ).toBe('>Hello world');
    expect(
      paragraphTextOf(
        apply(part, { op: 'insertText', paragraphId: id!, offset: 11, text: '!' }),
        id!
      )
    ).toBe('Hello world!');
  });

  test('deleteText removes exactly the range', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'deleteText', paragraphId: id!, start: 5, end: 11 });
    expect(paragraphTextOf(next, id!)).toBe('Hello');
  });

  test('deleteText spanning a run boundary removes from both runs', () => {
    const part = load(FORMATTED);
    const [id] = paragraphIds(part);
    // "Bold plain" — remove "ld pl".
    const next = apply(part, { op: 'deleteText', paragraphId: id!, start: 2, end: 7 });
    expect(paragraphTextOf(next, id!)).toBe('Boain');
  });

  test('authored whitespace is preserved verbatim', () => {
    const part = load('<w:p><w:r><w:t xml:space="preserve">  spaced  </w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    expect(paragraphTextOf(part, id!)).toBe('  spaced  ');
    const next = apply(part, { op: 'insertText', paragraphId: id!, offset: 2, text: 'X' });
    expect(paragraphTextOf(next, id!)).toBe('  Xspaced  ');
  });

  test('tab and hard break are addressable content, one offset each', () => {
    const part = load('<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    expect(paragraphTextOf(part, id!)).toBe('a\tb\nc');
    const next = apply(part, { op: 'deleteText', paragraphId: id!, start: 1, end: 2 });
    expect(paragraphTextOf(next, id!)).toBe('ab\nc');
  });

  test('insertTab and insertHardBreak add content at an offset', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const tabbed = apply(part, { op: 'insertTab', paragraphId: id!, offset: 5 });
    expect(paragraphTextOf(tabbed, id!)).toBe('Hello\t world');
    const broken = apply(tabbed, { op: 'insertHardBreak', paragraphId: id!, offset: 6 });
    expect(paragraphTextOf(broken, id!)).toBe('Hello\t\n world');
    expect(serializeOoxmlPart(broken)).toContain('<w:br/>');
  });

  test('insertPageBreak writes w:br w:type="page" and survives save/reopen', () => {
    const part = load('<w:p><w:r><w:t>ab</w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    const withBreak = apply(part, { op: 'insertPageBreak', paragraphId: id!, offset: 1 });
    expect(paragraphTextOf(withBreak, id!)).toBe('a\fb');
    const saved = serializeOoxmlPart(withBreak);
    expect(saved).toContain('<w:br w:type="page"/>');
    const reopened = load(saved);
    const [reopenedId] = paragraphIds(reopened);
    expect(paragraphTextOf(reopened, reopenedId!)).toBe('a\fb');
  });

  test('an edit next to unknown content leaves the unknown node untouched', () => {
    const part = load(WITH_UNKNOWN);
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'insertText', paragraphId: id!, offset: 0, text: 'X' });
    expect(paragraphTextOf(next, id!)).toBe('Xbefore after');
    const out = serializeOoxmlPart(next);
    expect(out).toContain('urn:clip');
    expect(out).toContain('drawing');
  });

  test('typing at a run boundary takes the LEFT run, the way Word does', () => {
    // A PDF-converted document writes every inter-word space as its own run carrying
    // `w:spacing` (character tracking). Joining the run that STARTS at the offset gave typed
    // text that run's tracking, so typing after a word came out letter-spaced: "x x x x".
    const part = load(
      '<w:p><w:r><w:t>word</w:t></w:r>' +
        '<w:r><w:rPr><w:spacing w:val="60"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r>' +
        '<w:r><w:t>next</w:t></w:r></w:p>'
    );
    const [id] = paragraphIds(part);
    const typed = apply(part, { op: 'insertText', paragraphId: id!, offset: 4, text: 'xx' });
    expect(paragraphTextOf(typed, id!)).toBe('wordxx next');
    // The characters joined "word", which authors no spacing — not the tracked space run.
    expect(serializeOoxmlPart(typed)).toContain('<w:r><w:t>wordxx</w:t></w:r>');
  });

  test('typing at the START of a paragraph takes the run to its right', () => {
    const part = load('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    const typed = apply(part, { op: 'insertText', paragraphId: id!, offset: 0, text: 'X' });
    expect(paragraphTextOf(typed, id!)).toBe('Xbold');
    // No run to the left, so the bold run to the right owns it — Word's rule at offset 0.
    expect(serializeOoxmlPart(typed)).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t>Xbold</w:t></w:r>');
  });

  test('typing at the end of a hyperlink stays OUTSIDE the link', () => {
    const part = load(
      '<w:p><w:hyperlink r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<w:r><w:t>link</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>'
    );
    const [id] = paragraphIds(part);
    const typed = apply(part, { op: 'insertText', paragraphId: id!, offset: 4, text: 'X' });
    expect(paragraphTextOf(typed, id!)).toBe('linkX after');
    // The link's own text is unchanged; the new character landed in the run after it.
    expect(serializeOoxmlPart(typed)).toContain('<w:t>link</w:t>');
  });

  test('bias right places text inside the run that starts at the offset', () => {
    const part = load(
      '<w:p><w:r><w:t>plain</w:t></w:r>' + '<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>'
    );
    const [id] = paragraphIds(part);
    const typed = apply(part, {
      op: 'insertText',
      paragraphId: id!,
      offset: 5,
      text: 'X',
      bias: 'right',
    });
    expect(paragraphTextOf(typed, id!)).toBe('plainXbold');
    expect(serializeOoxmlPart(typed)).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t>Xbold</w:t></w:r>');
  });

  test('insertText at boundaries emits xml:space preserve on save/reopen', () => {
    const part = load('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    const leading = apply(part, { op: 'insertText', paragraphId: id!, offset: 0, text: ' ' });
    const both = apply(leading, { op: 'insertText', paragraphId: id!, offset: 6, text: ' ' });
    expect(paragraphTextOf(both, id!)).toBe(' Hello ');
    const saved = serializeOoxmlPart(both);
    expect(saved).toContain('<w:t xml:space="preserve"> Hello </w:t>');
    const reopened = load(saved);
    const [reopenedId] = paragraphIds(reopened);
    expect(paragraphTextOf(reopened, reopenedId!)).toBe(' Hello ');
  });

  test('replace across run boundaries keeps trailing space on save/reopen', () => {
    const part = load(FORMATTED);
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'insertText', paragraphId: id!, offset: 4, text: 'X' });
    expect(paragraphTextOf(next, id!)).toBe('BoldX plain');
    const saved = serializeOoxmlPart(next);
    expect(saved).toContain('<w:t xml:space="preserve"> plain</w:t>');
    const reopened = load(saved);
    expect(paragraphTextOf(reopened, paragraphIds(reopened)[0]!)).toBe('BoldX plain');
  });

  test('split preserves boundary whitespace through save/reopen', () => {
    const part = load('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    const split = apply(part, { op: 'splitParagraph', paragraphId: id!, offset: 5 });
    const ids = paragraphIds(split);
    expect(paragraphTextOf(split, ids[1]!)).toBe(' world');
    const saved = serializeOoxmlPart(split);
    expect(saved).toContain('<w:t xml:space="preserve"> world</w:t>');
    const reopened = load(saved);
    const reopenedIds = paragraphIds(reopened);
    expect(paragraphTextOf(reopened, reopenedIds[1]!)).toBe(' world');
  });

  test('whitespace-only insertText survives save/reopen', () => {
    const part = load('<w:p><w:r><w:t>Helloworld</w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'insertText', paragraphId: id!, offset: 5, text: '  ' });
    expect(paragraphTextOf(next, id!)).toBe('Hello  world');
    const saved = serializeOoxmlPart(next);
    expect(saved).toContain('<w:t>Hello  world</w:t>');
    const reopened = load(saved);
    expect(paragraphTextOf(reopened, paragraphIds(reopened)[0]!)).toBe('Hello  world');
  });
});

describe('split and join (task 5.1)', () => {
  test('split divides a paragraph and keeps its properties on both halves', () => {
    const part = load(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Hello world</w:t></w:r></w:p>'
    );
    const [id] = paragraphIds(part);
    const result = applyTreeOp(part, { op: 'splitParagraph', paragraphId: id!, offset: 5 });
    if (!result.ok) throw new Error(result.reason);
    const ids = paragraphIds(result.part);
    expect(ids).toHaveLength(2);
    expect(paragraphTextOf(result.part, ids[0]!)).toBe('Hello');
    expect(paragraphTextOf(result.part, ids[1]!)).toBe(' world');
    expect(result.effect.split).toEqual({ from: id!, tail: ids[1]! });
    expect(result.effect.impact).toBe('flow-structural');
    // Alignment survives on both halves, as Word does.
    expect(serializeOoxmlPart(result.part).match(/w:jc/g)).toHaveLength(2);
  });

  test('split inside a formatted run keeps the formatting on both halves', () => {
    const part = load('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>BoldText</w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'splitParagraph', paragraphId: id!, offset: 4 });
    const ids = paragraphIds(next);
    expect(paragraphTextOf(next, ids[0]!)).toBe('Bold');
    expect(paragraphTextOf(next, ids[1]!)).toBe('Text');
    expect(serializeOoxmlPart(next).match(/<w:b\/>/g)).toHaveLength(2);
  });

  test('split at the end produces an empty tail that accepts text', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const split = apply(part, { op: 'splitParagraph', paragraphId: id!, offset: 11 });
    const ids = paragraphIds(split);
    expect(paragraphTextOf(split, ids[1]!)).toBe('');
    // The regression the browser checkpoint found, at the model layer: a freshly created
    // paragraph must accept the very next keystroke.
    const typed = apply(split, { op: 'insertText', paragraphId: ids[1]!, offset: 0, text: 'new' });
    expect(paragraphTextOf(typed, ids[1]!)).toBe('new');
  });

  test('join merges adjacent paragraphs and reports the removed one', () => {
    const part = load(
      '<w:p><w:r><w:t>first</w:t></w:r></w:p><w:p><w:r><w:t>second</w:t></w:r></w:p>'
    );
    const [a, b] = paragraphIds(part);
    const result = applyTreeOp(part, { op: 'joinParagraphs', firstId: a!, secondId: b! });
    if (!result.ok) throw new Error(result.reason);
    expect(paragraphIds(result.part)).toEqual([a!]);
    expect(paragraphTextOf(result.part, a!)).toBe('firstsecond');
    expect(result.effect.join).toEqual({ kept: a!, removed: b! });
    expect(result.effect.deleted).toEqual([b!]);
  });

  test('join refuses non-adjacent paragraphs', () => {
    const part = load(
      '<w:p><w:r><w:t>a</w:t></w:r></w:p><w:p><w:r><w:t>b</w:t></w:r></w:p><w:p><w:r><w:t>c</w:t></w:r></w:p>'
    );
    const ids = paragraphIds(part);
    const result = applyTreeOp(part, { op: 'joinParagraphs', firstId: ids[0]!, secondId: ids[2]! });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-adjacent-siblings');
  });
});

describe('the complete D8 property boundary (task 5.1)', () => {
  test('every accepted RUN property can be authored', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    for (const localName of ACCEPTED_RUN_PROPERTIES) {
      const result = applyTreeOp(part, {
        op: 'setRunProperties',
        paragraphId: id!,
        start: 0,
        end: 5,
        properties: [{ localName, attributes: { val: 'x' } }],
      });
      expect(result.ok).toBe(true);
    }
  });

  test('every accepted PARAGRAPH property can be authored', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    for (const localName of ACCEPTED_PARAGRAPH_PROPERTIES) {
      const result = applyTreeOp(part, {
        op: 'setParagraphProperties',
        paragraphId: id!,
        properties: [{ localName, attributes: { val: 'x' } }],
      });
      expect(result.ok).toBe(true);
    }
  });

  test('setRunProperties applies to exactly the requested range', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const next = apply(part, {
      op: 'setRunProperties',
      paragraphId: id!,
      start: 0,
      end: 5,
      properties: [{ localName: 'b' }],
    });
    expect(paragraphTextOf(next, id!)).toBe('Hello world');
    const out = serializeOoxmlPart(next);
    // The bolded half carries the property; the rest does not.
    expect(out.match(/<w:b\/>/g)).toHaveLength(1);
    expect(out.indexOf('<w:b/>')).toBeLessThan(out.indexOf('Hello'));
  });

  test('setParagraphProperties replaces the container and clearing removes it', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const styled = apply(part, {
      op: 'setParagraphProperties',
      paragraphId: id!,
      properties: [{ localName: 'pStyle', attributes: { val: 'Heading1' } }],
    });
    expect(serializeOoxmlPart(styled)).toContain('w:val="Heading1"');
    const cleared = apply(styled, {
      op: 'setParagraphProperties',
      paragraphId: id!,
      properties: [],
    });
    expect(serializeOoxmlPart(cleared)).not.toContain('pPr');
  });

  test('a property outside D8 is refused rather than silently authored', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const result = applyTreeOp(part, {
      op: 'setRunProperties',
      paragraphId: id!,
      start: 0,
      end: 5,
      properties: [{ localName: 'lang', attributes: { val: 'en-US' } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-property');
  });
});

describe('revision-tagged effect evidence (task 5.2)', () => {
  test('a text edit is text-local and names the paragraph it dirtied', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const result = applyTreeOp(part, { op: 'insertText', paragraphId: id!, offset: 0, text: 'x' });
    if (!result.ok) throw new Error(result.reason);
    expect(result.effect.impact).toBe('text-local');
    expect(result.effect.dirty).toEqual([id!]);
    expect(result.effect.dependencyKeys.length).toBeGreaterThan(0);
  });

  test('a paragraph property change is paragraph-local', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const result = applyTreeOp(part, {
      op: 'setParagraphProperties',
      paragraphId: id!,
      properties: [{ localName: 'keepNext' }],
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.effect.impact).toBe('paragraph-local');
  });

  test('split and join are flow-structural', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const split = applyTreeOp(part, { op: 'splitParagraph', paragraphId: id!, offset: 5 });
    if (!split.ok) throw new Error(split.reason);
    expect(split.effect.impact).toBe('flow-structural');
    const ids = paragraphIds(split.part);
    const join = applyTreeOp(split.part, {
      op: 'joinParagraphs',
      firstId: ids[0]!,
      secondId: ids[1]!,
    });
    if (!join.ok) throw new Error(join.reason);
    expect(join.effect.impact).toBe('flow-structural');
  });
});

describe('rejections leave everything unchanged (task 5.3)', () => {
  const part = load(SIMPLE);
  const [id] = paragraphIds(part);
  const fingerprintBefore = canonicalOoxmlFingerprint(part);

  const rejected: { name: string; op: TreeDocOp; reason: string }[] = [
    {
      name: 'an unknown paragraph',
      op: { op: 'insertText', paragraphId: 'no-such-id', offset: 0, text: 'x' },
      reason: 'unknown-paragraph',
    },
    {
      name: 'an offset past the end',
      op: { op: 'insertText', paragraphId: id!, offset: 999, text: 'x' },
      reason: 'offset-out-of-range',
    },
    {
      name: 'a negative offset',
      op: { op: 'insertText', paragraphId: id!, offset: -1, text: 'x' },
      reason: 'offset-out-of-range',
    },
    {
      name: 'a non-integer offset',
      op: { op: 'insertText', paragraphId: id!, offset: 1.5, text: 'x' },
      reason: 'offset-out-of-range',
    },
    {
      name: 'an inverted range',
      op: { op: 'deleteText', paragraphId: id!, start: 5, end: 2 },
      reason: 'invalid-range',
    },
    {
      name: 'an empty range',
      op: { op: 'deleteText', paragraphId: id!, start: 3, end: 3 },
      reason: 'invalid-range',
    },
    {
      name: 'a range past the end',
      op: { op: 'deleteText', paragraphId: id!, start: 0, end: 99 },
      reason: 'offset-out-of-range',
    },
    {
      name: 'a property outside the D8 boundary',
      op: {
        op: 'setRunProperties',
        paragraphId: id!,
        start: 0,
        end: 2,
        properties: [{ localName: 'noSuchProperty' }],
      },
      reason: 'unsupported-property',
    },
    {
      name: 'an attribute name that is not an XML name',
      op: {
        op: 'setRunProperties',
        paragraphId: id!,
        start: 0,
        end: 2,
        properties: [{ localName: 'b', attributes: { 'bad name"/><w:object': 'x' } }],
      },
      reason: 'invalid-property-value',
    },
    {
      name: 'text containing a character XML cannot represent',
      op: { op: 'insertText', paragraphId: id!, offset: 0, text: '\u0000' },
      reason: 'invalid-text',
    },
  ];

  for (const scenario of rejected) {
    test(`${scenario.name} is refused with a typed reason`, () => {
      const result = applyTreeOp(part, scenario.op);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(scenario.reason as never);
      // The tree is untouched — not merely equal, but the same fingerprint, and the
      // original object is still usable for the next scenario.
      expect(canonicalOoxmlFingerprint(part)).toBe(fingerprintBefore);
      expect(paragraphTextOf(part, id!)).toBe('Hello world');
    });
  }

  test('validate agrees with apply, so a caller can pre-check without side effects', () => {
    for (const scenario of rejected) {
      expect(validateTreeOp(part, scenario.op)).toBe(scenario.reason as never);
    }
  });

  test('a split inside a surrogate pair is refused', () => {
    const astral = load('<w:p><w:r><w:t>😀X</w:t></w:r></w:p>');
    const [emojiId] = paragraphIds(astral);
    const bad = applyTreeOp(astral, { op: 'splitParagraph', paragraphId: emojiId!, offset: 1 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('splits-surrogate-pair');
    // Splitting AFTER the whole character is fine.
    const good = applyTreeOp(astral, { op: 'splitParagraph', paragraphId: emojiId!, offset: 2 });
    expect(good.ok).toBe(true);
  });

  test('a deletion boundary inside a surrogate pair is refused', () => {
    const astral = load('<w:p><w:r><w:t>😀X</w:t></w:r></w:p>');
    const [emojiId] = paragraphIds(astral);
    const result = applyTreeOp(astral, {
      op: 'deleteText',
      paragraphId: emojiId!,
      start: 1,
      end: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('splits-surrogate-pair');
  });

  test('an op targeting a non-paragraph node is refused', () => {
    const runId = (() => {
      let found: string | null = null;
      const walk = (node: OoxmlNode): void => {
        if (node.kind === 'textValue') return;
        if (node.kind === 'run' && !found) found = node.id;
        for (const child of node.children) walk(child);
      };
      walk(part.root);
      return found!;
    })();
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: runId,
      offset: 0,
      text: 'x',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-a-paragraph');
  });
});

describe('splitParagraphMany equals the sequence of single splits it stands for', () => {
  // The op exists so a paste rebuilds the body once instead of once per line; its whole
  // contract is equivalence with the single splits it replaces, so that is what is tested:
  // same paragraph texts, same serialized XML shape, one op against many.
  const bodies = [
    {
      name: 'one plain run',
      body: '<w:p><w:r><w:t>alpha bravo charlie delta echo</w:t></w:r></w:p>',
    },
    {
      name: 'formatted runs',
      body: '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Bold text</w:t></w:r><w:r><w:t xml:space="preserve"> and plain tail</w:t></w:r></w:p>',
    },
    {
      name: 'tabs and breaks',
      body: '<w:p><w:r><w:t>ab</w:t><w:tab/><w:t>cd</w:t><w:br/><w:t>ef</w:t></w:r></w:p>',
    },
    {
      // With identity present, BOTH routes mint tail paraIds — the serialized-XML
      // equality below is then the byte-level determinism oracle for the minting
      // scheme, including how a repeated offset's seed collision bumps.
      name: 'a paragraph carrying w14 identity',
      body: '<w:p w14:paraId="4C000001" w14:textId="4C000001"><w:r><w:t>alpha bravo charlie</w:t></w:r></w:p>',
    },
  ];
  // Repeated offsets are legal and mean a blank line: two boundaries at one position put
  // an empty paragraph between them, which is what a paste containing "\n\n" carries.
  const offsetSets = [[1], [2, 4], [1, 2, 3], [0, 5], [3, 3], [2, 2, 2]];

  for (const { name, body } of bodies) {
    for (const offsets of offsetSets) {
      test(`${name}, offsets [${offsets.join(', ')}]`, () => {
        const part = load(body);
        const [id] = paragraphIds(part);
        const length = paragraphTextOf(part, id!)!.length;
        const usable = offsets.filter((offset) => offset <= length);
        if (usable.length === 0) return;

        const many = applyTreeOp(part, {
          op: 'splitParagraphMany',
          paragraphId: id!,
          offsets: usable,
        });
        expect(many.ok).toBe(true);
        if (!many.ok) return;

        let sequential = part;
        for (let index = usable.length - 1; index >= 0; index -= 1) {
          const step = applyTreeOp(sequential, {
            op: 'splitParagraph',
            paragraphId: id!,
            offset: usable[index]!,
          });
          expect(step.ok).toBe(true);
          if (!step.ok) return;
          sequential = step.part;
        }

        const textsOf = (candidate: OoxmlPart) =>
          paragraphIds(candidate).map((paragraphId) => paragraphTextOf(candidate, paragraphId));
        expect(textsOf(many.part)).toEqual(textsOf(sequential));
        // Ids differ between the two routes; the SERIALIZED document must not.
        expect(serializeOoxmlPart(many.part)).toBe(serializeOoxmlPart(sequential));
        // The effect reports every minted tail, so layout knows where the flow moved.
        expect(many.effect.created).toHaveLength(usable.length);
        expect(many.effect.splits).toHaveLength(usable.length);
      });
    }
  }

  test('unsorted or empty offset lists are refused before any tree work', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    for (const offsets of [[4, 2], []]) {
      const result = applyTreeOp(part, { op: 'splitParagraphMany', paragraphId: id!, offsets });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('invalid-range');
    }
  });

  test('an out-of-range offset is refused', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const result = applyTreeOp(part, {
      op: 'splitParagraphMany',
      paragraphId: id!,
      offsets: [2, 999],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('offset-out-of-range');
  });
});

// ---------------------------------------------------------------------------------------
// setSectionProperties: the body-level section write path (page setup).
// ---------------------------------------------------------------------------------------

/** The body-level `w:sectPr`, plus attribute maps of a named child, straight off the tree. */
function sectionOf(part: OoxmlPart): OoxmlNode | null {
  let found: OoxmlNode | null = null;
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue' || found) return;
    if (node.kind === 'body') {
      for (const child of node.children) {
        if (child.kind !== 'textValue' && 'localName' in child && child.localName === 'sectPr') {
          found = child;
        }
      }
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(part.root);
  return found;
}

function sectionChildAttrs(part: OoxmlPart, localName: string): Record<string, string> | null {
  const sectPr = sectionOf(part);
  if (!sectPr || sectPr.kind === 'textValue') return null;
  for (const child of sectPr.children) {
    if (child.kind === 'textValue' || !('localName' in child) || child.localName !== localName) {
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const entry of child.attributes ?? []) attrs[entry.localName] = entry.value;
    return attrs;
  }
  return null;
}

const WITH_SECTION =
  '<w:p><w:r><w:t>x</w:t></w:r></w:p>' +
  '<w:sectPr><w:headerReference w:type="default" r:id="rId9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>' +
  '<w:pgSz w:w="12240" w:h="15840" w:code="1"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="120"/>' +
  '<w:cols w:num="2" w:space="708"/><w:titlePg/></w:sectPr>';

describe('setSectionProperties writes page setup surgically', () => {
  test('a margin write touches only the sides it names', () => {
    const part = load(WITH_SECTION);
    const next = apply(part, {
      op: 'setSectionProperties',
      marginLeftTwips: 720,
      marginTopTwips: 900,
    });
    expect(sectionChildAttrs(next, 'pgMar')).toEqual({
      top: '900',
      right: '1440',
      bottom: '1440',
      left: '720',
      header: '708',
      footer: '708',
      gutter: '120',
    });
    // Untouched siblings keep their authored form, references included.
    expect(sectionChildAttrs(next, 'cols')).toEqual({ num: '2', space: '708' });
    expect(serializeOoxmlPart(next)).toContain('headerReference');
    expect(serializeOoxmlPart(next)).toContain('titlePg');
  });

  test('landscape writes swapped-ready orient and drops a stale paper code on resize', () => {
    const part = load(WITH_SECTION);
    const next = apply(part, {
      op: 'setSectionProperties',
      pageWidthTwips: 15840,
      pageHeightTwips: 12240,
      orientation: 'landscape',
    });
    expect(sectionChildAttrs(next, 'pgSz')).toEqual({
      w: '15840',
      h: '12240',
      orient: 'landscape',
    });
  });

  test('portrait is the absence of the orient attribute', () => {
    const part = load(WITH_SECTION.replace('w:code="1"', 'w:code="1" w:orient="landscape"'));
    const next = apply(part, { op: 'setSectionProperties', orientation: 'portrait' });
    // Only orientation changed: the dimensions and the paper code survive.
    expect(sectionChildAttrs(next, 'pgSz')).toEqual({ w: '12240', h: '15840', code: '1' });
  });

  test('a document with no sectPr gets one, as the body last child', () => {
    const part = load(SIMPLE);
    const next = apply(part, {
      op: 'setSectionProperties',
      pageWidthTwips: 11906,
      pageHeightTwips: 16838,
      marginLeftTwips: 1080,
    });
    expect(sectionChildAttrs(next, 'pgSz')).toEqual({ w: '11906', h: '16838' });
    // A minted pgMar carries the full schema set, defaults made explicit.
    expect(sectionChildAttrs(next, 'pgMar')).toEqual({
      top: '1440',
      right: '1440',
      bottom: '1440',
      left: '1080',
      header: '720',
      footer: '720',
      gutter: '0',
    });
    const serialized = serializeOoxmlPart(next);
    expect(serialized.indexOf('<w:sectPr')).toBeGreaterThan(serialized.indexOf('</w:p>'));
  });

  test('a sectPr without pgMar gains one placed after pgSz', () => {
    const part = load(
      '<w:p><w:r><w:t>x</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:cols w:num="1"/></w:sectPr>'
    );
    const next = apply(part, { op: 'setSectionProperties', marginTopTwips: 720 });
    const serialized = serializeOoxmlPart(next);
    expect(serialized.indexOf('<w:pgMar')).toBeGreaterThan(serialized.indexOf('<w:pgSz'));
    expect(serialized.indexOf('<w:pgMar')).toBeLessThan(serialized.indexOf('<w:cols'));
  });

  test('a multi-section document is updated WHOLE — every sectPr, not just the last', () => {
    // Word's dialog semantics: page setup applies to the whole document. Touching only
    // the body-level section leaves "portrait, …, landscape", which Word renders as one
    // landscape page among portrait ones.
    const part = load(
      '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>' +
        '</w:sectPr></w:pPr><w:r><w:t>section one</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>section two</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
    );
    const next = apply(part, {
      op: 'setSectionProperties',
      pageWidthTwips: 15840,
      pageHeightTwips: 12240,
      orientation: 'landscape',
      marginLeftTwips: 720,
    });
    const serialized = serializeOoxmlPart(next);
    // Both sections carry the landscape size…
    expect(serialized.match(/w:orient="landscape"/g)).toHaveLength(2);
    expect(serialized.match(/<w:pgSz [^>]*w:w="15840"/g)).toHaveLength(2);
    expect(serialized).not.toContain('w:w="12240"');
    // …and both carry the margin, the mid-body one keeping its authored header/footer.
    expect(serialized.match(/w:left="720"/g)).toHaveLength(2);
    expect(serialized).toContain('w:header="708"');
  });

  test('the effect is flow-structural, so everything repaginates', () => {
    const part = load(WITH_SECTION);
    const result = applyTreeOp(part, { op: 'setSectionProperties', marginLeftTwips: 720 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.effect.impact).toBe('flow-structural');
  });

  test('hostile or empty writes are refused before any tree work', () => {
    const part = load(WITH_SECTION);
    const fingerprint = canonicalOoxmlFingerprint(part);
    const hostile: TreeDocOp[] = [
      { op: 'setSectionProperties' },
      { op: 'setSectionProperties', pageWidthTwips: 0 },
      { op: 'setSectionProperties', pageWidthTwips: 999999999 },
      { op: 'setSectionProperties', pageWidthTwips: 612.5 },
      { op: 'setSectionProperties', marginLeftTwips: -720 },
      { op: 'setSectionProperties', orientation: 'sideways' as 'portrait' },
      // Margins that swallow the page: layout would fall back silently; the write refuses.
      { op: 'setSectionProperties', marginLeftTwips: 8000, marginRightTwips: 8000 },
    ];
    for (const op of hostile) {
      const result = applyTreeOp(part, op);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('invalid-property-value');
    }
    expect(canonicalOoxmlFingerprint(part)).toBe(fingerprint);
  });
});

describe('a section mark survives a split exactly once (the phantom-section fix)', () => {
  const BOUNDARY =
    '<w:p><w:pPr><w:jc w:val="center"/><w:sectPr><w:pgSz w:w="15840" w:h="12240"/></w:sectPr></w:pPr>' +
    '<w:r><w:t>end of section one</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>section two</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';

  test('Enter in a section-boundary paragraph keeps ONE mark, on the tail', () => {
    const part = load(BOUNDARY);
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'splitParagraph', paragraphId: id!, offset: 6 });
    const serialized = serializeOoxmlPart(next);
    // Still exactly two sectPr: the (moved) mid-body one and the body-level one. The
    // section boundary stays after ALL the original content — with the tail — while
    // other paragraph properties survive on both halves.
    expect(serialized.match(/<w:sectPr>/g)).toHaveLength(2);
    const [head, tail] = paragraphIds(next);
    const headXml = serialized.slice(serialized.indexOf('<w:p>'), serialized.indexOf('</w:p>'));
    expect(headXml).not.toContain('sectPr');
    expect(serialized.match(/w:jc/g)).toHaveLength(2);
    void head;
    void tail;
  });

  test('a many-way split keeps the mark on the LAST piece only', () => {
    const part = load(BOUNDARY);
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'splitParagraphMany', paragraphId: id!, offsets: [3, 6, 10] });
    const serialized = serializeOoxmlPart(next);
    expect(serialized.match(/<w:sectPr>/g)).toHaveLength(2);
    // The mid-body mark sits in the last produced piece: after it, only "section two"
    // and the body-level sectPr remain.
    const afterMark = serialized.slice(serialized.indexOf('<w:sectPr>') + 1);
    expect(afterMark).toContain('section two');
  });
});

describe('split and join carry w14 paragraph identity', () => {
  const IDENTIFIED =
    '<w:p w14:paraId="4C000001" w14:textId="4C000001"><w:r><w:t>Hello world</w:t></w:r></w:p>';

  test('split: the head keeps its paraId, the tail gets a fresh valid one', () => {
    const part = load(IDENTIFIED);
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'splitParagraph', paragraphId: id!, offset: 5 });
    const [head, tail] = paragraphIds(next);
    expect(paraIdAttrOf(next, head!)).toBe('4C000001');
    const tailId = paraIdAttrOf(next, tail!);
    expect(tailId).toMatch(/^[0-9A-F]{8}$/);
    expect(tailId).not.toBe('4C000001');
    expect(Number.parseInt(tailId!, 16)).toBeGreaterThan(0);
    expect(Number.parseInt(tailId!, 16)).toBeLessThan(0x80000000);
    // Word writes the pair together; the tail's textId mirrors its paraId.
    const serialized = serializeOoxmlPart(next);
    expect(serialized).toContain(`w14:paraId="${tailId}" w14:textId="${tailId}"`);
  });

  test('split is deterministic: the same split mints the same tail id', () => {
    const part = load(IDENTIFIED);
    const [id] = paragraphIds(part);
    const first = apply(part, { op: 'splitParagraph', paragraphId: id!, offset: 5 });
    const second = apply(part, { op: 'splitParagraph', paragraphId: id!, offset: 5 });
    expect(serializeOoxmlPart(first)).toBe(serializeOoxmlPart(second));
  });

  test('a head without identity mints nothing (low-level harness behavior)', () => {
    const part = load(SIMPLE);
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'splitParagraph', paragraphId: id!, offset: 5 });
    const [head, tail] = paragraphIds(next);
    expect(paraIdAttrOf(next, head!)).toBeUndefined();
    expect(paraIdAttrOf(next, tail!)).toBeUndefined();
  });

  test('join: the surviving head keeps ITS paraId and the removed one is gone', () => {
    const part = load(
      '<w:p w14:paraId="4C000001" w14:textId="4C000001"><w:r><w:t xml:space="preserve">Hello </w:t></w:r></w:p>' +
        '<w:p w14:paraId="4C000002" w14:textId="4C000002"><w:r><w:t>world</w:t></w:r></w:p>'
    );
    const [first, second] = paragraphIds(part);
    const next = apply(part, { op: 'joinParagraphs', firstId: first!, secondId: second! });
    const [kept] = paragraphIds(next);
    expect(paraIdAttrOf(next, kept!)).toBe('4C000001');
    expect(serializeOoxmlPart(next)).not.toContain('4C000002');
    expect(paragraphTextOf(next, kept!)).toBe('Hello world');
  });
});

describe('minting fails soft under hostile prefix shadowing', () => {
  test('Enter inside a subtree that shadows w14 commits without minting — never a refusal', () => {
    // The harness root binds w14 correctly; the SDT rebinds it. An attribute minted
    // under `w14` would resolve to the wrong URI at this depth and the whole
    // transaction would be refused (`invalid-qname`) — an editing lockout. The split
    // must instead give up on identity for this tail and keep editing alive.
    const part = load(
      '<w:sdt xmlns:w14="urn:evil"><w:sdtContent>' +
        `<w:p xmlns:wx="${W14}" wx:paraId="4C000009" wx:textId="4C000009"><w:r><w:t>shadowed</w:t></w:r></w:p>` +
        '</w:sdtContent></w:sdt>'
    );
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'splitParagraph', paragraphId: id!, offset: 4 });
    const [head, tail] = paragraphIds(next);
    expect(paraIdAttrOf(next, head!)).toBe('4C000009');
    expect(paraIdAttrOf(next, tail!)).toBeUndefined();
  });
});
