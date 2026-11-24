// What the edit path must refuse to mint, move or overlook.
//
// Four holes an adversarial read of the op seam found, each one silent: an op that minted
// any element name it was handed into the paragraph mark, a split that inverted a range
// whose start and end both sat on the caret, a `w:pPr` rewrite that emitted the schema
// order only when the input already had it, and a digest that stopped walking at a depth
// the layout still renders — putting those paragraphs back outside the oracle.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  validateOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { applyTreeOp, type TreeDocOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstParagraphId(part: OoxmlPart): string {
  const visit = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'paragraph') return node;
    for (const child of node.children) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  const paragraph = visit(part.root);
  if (!paragraph) throw new Error('no paragraph');
  return paragraph.id;
}

function bodyXml(part: OoxmlPart): string {
  return serializeOoxmlPart(part).replace(/^[\s\S]*?<w:body>|<\/w:body>[\s\S]*$/g, '');
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  return result.part;
}

describe('the paragraph mark takes only the run vocabulary', () => {
  const paragraph = '<w:p><w:r><w:t>x</w:t></w:r></w:p>';

  test('a name outside the accepted set is refused, not minted', () => {
    const part = load(paragraph);
    // `setParagraphMarkProperties` validated only that `properties` was an ARRAY, and the
    // merge's tail loop did not filter by vocabulary, so this applied clean and serialized
    // `<w:pPr><w:rPr><w:sectPr/></w:rPr></w:pPr>` — a section mark inside the paragraph
    // mark, which is not a CT_ParaRPr child at all.
    const result = applyTreeOp(part, {
      op: 'setParagraphMarkProperties',
      paragraphId: firstParagraphId(part),
      properties: [{ localName: 'sectPr' }],
    });
    expect(result).toEqual({ ok: false, reason: 'unsupported-property' });
  });

  test('an attribute name that is not a name is refused', () => {
    const part = load(paragraph);
    const result = applyTreeOp(part, {
      op: 'setParagraphMarkProperties',
      paragraphId: firstParagraphId(part),
      properties: [{ localName: 'b', attributes: { 'val" w:evil="1': '0' } }],
    });
    expect(result).toEqual({ ok: false, reason: 'invalid-property-value' });
  });

  test('an accepted property still applies', () => {
    const part = load(paragraph);
    const written = apply(part, {
      op: 'setParagraphMarkProperties',
      paragraphId: firstParagraphId(part),
      properties: [{ localName: 'sz', attributes: { val: '32' } }],
    });
    expect(bodyXml(written)).toContain('<w:rPr><w:sz w:val="32"/></w:rPr>');
  });
});

describe('a range that opens AND closes at the caret stays paired', () => {
  test('an empty bookmark is not turned inside out by a split', () => {
    const part = load(
      '<w:p><w:r><w:t>alpha</w:t></w:r><w:bookmarkStart w:id="1" w:name="a"/>' +
        '<w:bookmarkEnd w:id="1"/><w:r><w:t>beta</w:t></w:r></w:p>'
    );
    const split = apply(part, {
      op: 'splitParagraph',
      paragraphId: firstParagraphId(part),
      offset: 5,
    });
    // Both markers sit on the caret, so they must travel together: splitting them emitted
    // `…<w:bookmarkEnd/></w:p><w:p><w:bookmarkStart/>…`, a close with no open before it.
    // Bookmark markers at a split stay with the head, so the point stays at the end of the
    // first paragraph.
    const xml = bodyXml(split);
    expect(xml.indexOf('bookmarkStart')).toBeLessThan(xml.indexOf('bookmarkEnd'));
    expect(xml).toBe(
      '<w:p><w:r><w:t>alpha</w:t></w:r><w:bookmarkStart w:id="1" w:name="a"/>' +
        '<w:bookmarkEnd w:id="1"/></w:p>' +
        '<w:p><w:r><w:t>beta</w:t></w:r></w:p>'
    );
  });

  test('the same holds for a comment range through a many-way split', () => {
    const part = load(
      '<w:p><w:r><w:t>alpha</w:t></w:r><w:commentRangeStart w:id="1"/>' +
        '<w:commentRangeEnd w:id="1"/><w:r><w:t>beta</w:t></w:r></w:p>'
    );
    const split = apply(part, {
      op: 'splitParagraphMany',
      paragraphId: firstParagraphId(part),
      offsets: [5],
    });
    const xml = bodyXml(split);
    expect(xml.indexOf('commentRangeStart')).toBeLessThan(xml.indexOf('commentRangeEnd'));
  });

  test('an end marker whose start is behind it still stays with the head', () => {
    // The rule this guards must not swallow the case it was written for.
    const part = load(
      '<w:p><w:bookmarkStart w:id="7" w:name="intro"/><w:r><w:t>alpha</w:t></w:r>' +
        '<w:bookmarkEnd w:id="7"/><w:r><w:t xml:space="preserve"> beta</w:t></w:r></w:p>'
    );
    const split = apply(part, {
      op: 'splitParagraph',
      paragraphId: firstParagraphId(part),
      offset: 5,
    });
    expect(bodyXml(split)).toBe(
      '<w:p><w:bookmarkStart w:id="7" w:name="intro"/><w:r><w:t>alpha</w:t></w:r>' +
        '<w:bookmarkEnd w:id="7"/></w:p>' +
        '<w:p><w:r><w:t xml:space="preserve"> beta</w:t></w:r></w:p>'
    );
  });
});

describe('w:pPr is emitted in CT_PPr order', () => {
  test('even when the paragraph it rewrites was authored out of order', () => {
    // Nothing demotes this `w:pPr`: the shape rule checks where the MARK sits, not the
    // order of the base properties. The op then rewrote both children in place and left
    // them where they were, so an edit on a file Word already disliked produced one Word
    // reports as unreadable — `w:pStyle` must lead CT_PPr's sequence.
    const part = load(
      '<w:p><w:pPr><w:jc w:val="center"/><w:pStyle w:val="Body"/></w:pPr>' +
        '<w:r><w:t>x</w:t></w:r></w:p>'
    );
    const written = apply(part, {
      op: 'setParagraphProperties',
      paragraphId: firstParagraphId(part),
      properties: [
        { localName: 'jc', attributes: { val: 'left' } },
        { localName: 'pStyle', attributes: { val: 'Body' } },
        { localName: 'ind', attributes: { left: '720' } },
      ],
    });
    expect(bodyXml(written)).toBe(
      '<w:p><w:pPr><w:pStyle w:val="Body"/><w:ind w:left="720"/><w:jc w:val="left"/></w:pPr>' +
        '<w:r><w:t>x</w:t></w:r></w:p>'
    );
  });

  test('an unmodelled extension element keeps the slot it was authored in', () => {
    const part = load(
      '<w:p><w:pPr><w:pStyle w:val="Body"/>' +
        '<w14:glow xmlns:w14="urn:vendor-extension"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
    );
    const written = apply(part, {
      op: 'setParagraphProperties',
      paragraphId: firstParagraphId(part),
      properties: [
        { localName: 'pStyle', attributes: { val: 'Body' } },
        { localName: 'jc', attributes: { val: 'center' } },
      ],
    });
    expect(bodyXml(written)).toContain('<w:pStyle w:val="Body"/><w:jc w:val="center"/><w14:glow');
  });

  test('applying the same properties twice changes nothing', () => {
    const part = load('<w:p><w:r><w:t>x</w:t></w:r></w:p>');
    const op: TreeDocOp = {
      op: 'setParagraphProperties',
      paragraphId: firstParagraphId(part),
      properties: [
        { localName: 'jc', attributes: { val: 'center' } },
        { localName: 'ind', attributes: { left: '720' } },
        { localName: 'pStyle', attributes: { val: 'Body' } },
      ],
    };
    const once = apply(part, op);
    expect(bodyXml(apply(once, op))).toBe(bodyXml(once));
  });
});

describe('a range edge divides the run it falls inside', () => {
  /** Each run as `[properties]content`, with tab and break spelled out. */
  function runsOf(part: OoxmlPart): string[] {
    const visit = (node: OoxmlNode): OoxmlNode | null => {
      if (node.kind === 'textValue') return null;
      if (node.kind === 'paragraph') return node;
      for (const child of node.children) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    const paragraph = visit(part.root);
    if (!paragraph || paragraph.kind === 'textValue') return [];
    const textOf = (node: OoxmlNode): string =>
      node.kind === 'textValue'
        ? node.value
        : node.kind === 'tab'
          ? '<TAB>'
          : node.kind === 'hardBreak'
            ? '<BR>'
            : node.children.map(textOf).join('');
    return paragraph.children
      .filter((child) => child.kind === 'run')
      .map((run) => {
        if (run.kind === 'textValue') return '';
        const rPr = run.children.find(
          (child) => child.kind !== 'textValue' && child.localName === 'rPr'
        );
        const names =
          rPr && rPr.kind !== 'textValue'
            ? rPr.children.map((child) => (child.kind === 'textValue' ? '?' : child.localName))
            : [];
        const content = run.children
          .filter((child) => child.kind !== 'textValue' && child.localName !== 'rPr')
          .map(textOf)
          .join('');
        return `[${names.join(',')}]${content}`;
      });
  }

  test('a boundary between a w:t and a w:tab inside one run', () => {
    // Neither edge straddles a TEXT value, so the run was never divided; the range then
    // matched the whole run through the tab's segment and bolded all three characters.
    const part = load('<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r></w:p>');
    const written = apply(part, {
      op: 'setRunProperties',
      paragraphId: firstParagraphId(part),
      start: 1,
      end: 2,
      properties: [{ localName: 'b' }],
    });
    expect(runsOf(written)).toEqual(['[]a', '[b]<TAB>', '[]b']);
  });

  test('the same for a hard break', () => {
    const part = load('<w:p><w:r><w:t>a</w:t><w:br/><w:t>b</w:t></w:r></w:p>');
    const written = apply(part, {
      op: 'setRunProperties',
      paragraphId: firstParagraphId(part),
      start: 2,
      end: 3,
      properties: [{ localName: 'b' }],
    });
    expect(runsOf(written)).toEqual(['[]a<BR>', '[b]b']);
  });

  test('a range that already lands on run boundaries is left alone', () => {
    const part = load('<w:p><w:r><w:t>a</w:t></w:r><w:r><w:t>b</w:t></w:r></w:p>');
    const written = apply(part, {
      op: 'setRunProperties',
      paragraphId: firstParagraphId(part),
      start: 1,
      end: 2,
      properties: [{ localName: 'b' }],
    });
    expect(runsOf(written)).toEqual(['[]a', '[b]b']);
  });

  test('splitting a paragraph at the same boundary already divided the run', () => {
    // The mirror check the split path passes on its own: it decides per CONTENT CHILD, so
    // a tab boundary was never the text-value assumption `splitRunsAt` made.
    const part = load('<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r></w:p>');
    const split = apply(part, {
      op: 'splitParagraph',
      paragraphId: firstParagraphId(part),
      offset: 1,
    });
    expect(bodyXml(split)).toBe(
      '<w:p><w:r><w:t>a</w:t></w:r></w:p><w:p><w:r><w:tab/><w:t>b</w:t></w:r></w:p>'
    );
  });
});

describe('a run whose w:rPr the read demoted is still its w:rPr', () => {
  // `w:val` on the container makes the node incompatible with its known kind, so the
  // canonical read demotes `w:rPr` to generic — reachable from any file, since every value
  // in it is attacker-controlled.
  const DEMOTED = '<w:p><w:r><w:rPr w:val="x"><w:b/></w:rPr><w:t>hello</w:t></w:r></w:p>';

  function runPropertyCount(part: OoxmlPart): number {
    let count = 0;
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.localName === 'rPr') count += 1;
      for (const child of node.children) walk(child);
    };
    walk(part.root);
    return count;
  }

  test('the fixture demotes (guards the premise)', () => {
    const part = load(DEMOTED);
    expect(bodyXml(part)).toContain('<w:rPr w:val="x">');
    expect(runPropertyCount(part)).toBe(1);
    const kinds: string[] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.localName === 'rPr') kinds.push(node.kind);
      for (const child of node.children) walk(child);
    };
    walk(part.root);
    expect(kinds).toEqual(['generic']);
  });

  test('formatting the run rewrites that container instead of minting a second', () => {
    const part = load(DEMOTED);
    const written = apply(part, {
      op: 'setRunProperties',
      paragraphId: firstParagraphId(part),
      start: 0,
      end: 5,
      properties: [{ localName: 'i' }],
    });
    expect(runPropertyCount(written)).toBe(1);
    expect(bodyXml(written)).toBe(
      '<w:p><w:r><w:rPr w:val="x"><w:i/></w:rPr><w:t>hello</w:t></w:r></w:p>'
    );
  });

  test('splitting the run keeps the formatting on BOTH halves', () => {
    const part = load(DEMOTED);
    const split = apply(part, {
      op: 'splitParagraph',
      paragraphId: firstParagraphId(part),
      offset: 2,
    });
    expect(runPropertyCount(split)).toBe(2);
    expect(bodyXml(split)).toBe(
      '<w:p><w:r><w:rPr w:val="x"><w:b/></w:rPr><w:t>he</w:t></w:r></w:p>' +
        '<w:p><w:r><w:rPr w:val="x"><w:b/></w:rPr><w:t>llo</w:t></w:r></w:p>'
    );
  });

  test('a many-way split keeps it on every piece', () => {
    const part = load(DEMOTED);
    const split = apply(part, {
      op: 'splitParagraphMany',
      paragraphId: firstParagraphId(part),
      offsets: [2, 4],
    });
    expect(runPropertyCount(split)).toBe(3);
  });
});

describe('the digest reaches every paragraph the parser admits', () => {
  /** `levels` of `w:sdt > w:sdtContent > w:tbl > w:tr > w:tc` around one paragraph. */
  function nested(levels: number, text: string): string {
    let inner = `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    for (let level = 0; level < levels; level += 1) {
      inner =
        '<w:sdt><w:sdtContent><w:tbl><w:tr><w:tc>' +
        inner +
        '</w:tc></w:tr></w:tbl></w:sdtContent></w:sdt>';
    }
    return inner;
  }

  test('a deep cell that loses its text is reported, not overlooked', () => {
    // Thirteen levels: inside `MAX_TABLE_NESTING` (16) and `MAX_SDT_NESTING` (32), so the
    // layout still renders this paragraph — but past a 64-level walk, which returned
    // silently and left it outside the oracle exactly as the body-only walk had.
    const before = load(`<w:p><w:r><w:t>top</w:t></w:r></w:p>${nested(13, 'deep')}`);
    const after = load(`<w:p><w:r><w:t>top</w:t></w:r></w:p>${nested(13, '')}`);
    const differences = diffSemanticDigests(semanticDigest([before]), semanticDigest([after]));
    expect(differences.map((difference) => difference.path)).toEqual([
      '/word/document.xml.p[1].text',
    ]);
  });
});
