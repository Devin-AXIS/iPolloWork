// insertHyperlink / setHyperlinkTarget / removeHyperlink over the canonical tree.
//
// The property under test throughout is that a link is a WRAPPER: applying one and taking it
// off again must leave the paragraph's text and every run's formatting exactly as they were.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  validateOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { canonicalOoxmlFingerprint, serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { buildBookmarkIndex } from '../package/bookmarks.ts';
import { applyTreeOp, paragraphTextOf, type TreeDocOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  return result.part;
}

function reject(part: OoxmlPart, op: TreeDocOp): string {
  const result = applyTreeOp(part, op);
  if (result.ok) throw new Error('expected a rejection');
  return result.reason;
}

const PARAGRAPH = '/word/document.xml#0.0.0';

/** A paragraph's children as `name` tokens, so order is readable in a failure. */
function shapeOf(part: OoxmlPart, paragraphId: string): string[] {
  const node = findById(part.root, paragraphId);
  if (!node || node.kind === 'textValue') return [];
  return node.children
    .filter((child) => child.kind !== 'textValue' && child.localName !== 'pPr')
    .map((child) => (child.kind === 'textValue' ? '' : child.localName));
}

function findById(node: OoxmlNode, id: string): OoxmlNode | null {
  if (node.kind === 'textValue') return node.id === id ? node : null;
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

/** The first `w:hyperlink` node id in a part. */
function linkIdOf(part: OoxmlPart): string {
  const walk = (node: OoxmlNode): string | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'hyperlink') return node.id;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const id = walk(part.root);
  if (!id) throw new Error('no hyperlink in part');
  return id;
}

function attributeOf(part: OoxmlPart, nodeId: string, localName: string): string | undefined {
  const node = findById(part.root, nodeId);
  if (!node || node.kind === 'textValue') return undefined;
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

describe('insertHyperlink wraps a range without disturbing it', () => {
  const PLAIN = '<w:p><w:r><w:t>Visit example today</w:t></w:r></w:p>';

  test('the text is unchanged and the range is now a link', () => {
    const part = load(PLAIN);
    const next = apply(part, {
      op: 'insertHyperlink',
      paragraphId: PARAGRAPH,
      start: 6,
      end: 13,
      relationshipId: 'rId9',
    });
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('Visit example today');
    expect(shapeOf(next, PARAGRAPH)).toEqual(['r', 'hyperlink', 'r']);
    expect(attributeOf(next, linkIdOf(next), 'id')).toBe('rId9');
    expect(attributeOf(next, linkIdOf(next), 'history')).toBe('1');
  });

  test('an anchor link carries w:anchor and no r:id', () => {
    const next = apply(load(PLAIN), {
      op: 'insertHyperlink',
      paragraphId: PARAGRAPH,
      start: 6,
      end: 13,
      anchor: 'section3',
    });
    const link = linkIdOf(next);
    expect(attributeOf(next, link, 'anchor')).toBe('section3');
    expect(attributeOf(next, link, 'id')).toBeUndefined();
  });

  test('run formatting on each side of the link survives the cut', () => {
    const part = load('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold link tail</w:t></w:r></w:p>');
    const next = apply(part, {
      op: 'insertHyperlink',
      paragraphId: PARAGRAPH,
      start: 5,
      end: 9,
      anchor: 'top',
    });
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('bold link tail');
    // Three runs now, and every one of them kept the `w:rPr` the original carried.
    const paragraph = findById(next.root, PARAGRAPH)!;
    if (paragraph.kind === 'textValue') throw new Error('unreachable');
    const runs: OoxmlNode[] = [];
    const collect = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'run') runs.push(node);
      for (const child of node.children) collect(child);
    };
    collect(paragraph);
    expect(runs.length).toBe(3);
    for (const run of runs) {
      if (run.kind === 'textValue') continue;
      expect(run.children.some((child) => child.localName === 'rPr')).toBe(true);
    }
  });

  test('a bookmark inside the linked range travels into the link', () => {
    const part = load(
      '<w:p><w:r><w:t>abc</w:t></w:r><w:bookmarkStart w:id="1" w:name="mid"/>' +
        '<w:r><w:t>def</w:t></w:r></w:p>'
    );
    const next = apply(part, {
      op: 'insertHyperlink',
      paragraphId: PARAGRAPH,
      start: 3,
      end: 6,
      anchor: 'top',
    });
    expect(shapeOf(next, PARAGRAPH)).toEqual(['r', 'hyperlink']);
    const link = findById(next.root, linkIdOf(next))!;
    if (link.kind === 'textValue') throw new Error('unreachable');
    expect(
      link.children.map((child) => (child.kind === 'textValue' ? '' : child.localName))
    ).toEqual(['bookmarkStart', 'r']);
  });

  test('a collapsed range is refused', () => {
    expect(
      reject(load(PLAIN), {
        op: 'insertHyperlink',
        paragraphId: PARAGRAPH,
        start: 4,
        end: 4,
        anchor: 'top',
      })
    ).toBe('invalid-range');
  });

  test('naming both a relationship and an anchor is refused, and so is naming neither', () => {
    expect(
      reject(load(PLAIN), {
        op: 'insertHyperlink',
        paragraphId: PARAGRAPH,
        start: 0,
        end: 5,
        anchor: 'top',
        relationshipId: 'rId9',
      })
    ).toBe('invalid-property-value');
    expect(
      reject(load(PLAIN), { op: 'insertHyperlink', paragraphId: PARAGRAPH, start: 0, end: 5 })
    ).toBe('invalid-property-value');
  });

  test('a range overlapping an existing link is refused rather than nested', () => {
    const part = load(
      '<w:p><w:r><w:t xml:space="preserve">a </w:t></w:r>' +
        '<w:hyperlink w:anchor="one"><w:r><w:t>linked</w:t></w:r></w:hyperlink>' +
        '<w:r><w:t xml:space="preserve"> b</w:t></w:r></w:p>'
    );
    expect(
      reject(part, {
        op: 'insertHyperlink',
        paragraphId: PARAGRAPH,
        start: 0,
        end: 6,
        anchor: 'two',
      })
    ).toBe('invalid-property-value');
  });

  test('a rejected op leaves the part byte-identical', () => {
    const part = load(PLAIN);
    const before = canonicalOoxmlFingerprint(part);
    applyTreeOp(part, {
      op: 'insertHyperlink',
      paragraphId: PARAGRAPH,
      start: 0,
      end: 999,
      anchor: 'top',
    });
    expect(canonicalOoxmlFingerprint(part)).toBe(before);
  });
});

describe('removeHyperlink gives the runs back unchanged', () => {
  const LINKED =
    '<w:p><w:r><w:t xml:space="preserve">Visit </w:t></w:r>' +
    '<w:hyperlink r:id="rId9" w:history="1"><w:r><w:rPr><w:b/></w:rPr><w:t>example</w:t></w:r></w:hyperlink>' +
    '<w:r><w:t xml:space="preserve"> today</w:t></w:r></w:p>';

  test('text and formatting survive; no w:hyperlink remains', () => {
    const part = load(LINKED);
    const next = apply(part, { op: 'removeHyperlink', linkId: linkIdOf(part) });
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('Visit example today');
    expect(shapeOf(next, PARAGRAPH)).toEqual(['r', 'r', 'r']);
    const run = findById(next.root, PARAGRAPH)!;
    if (run.kind === 'textValue') throw new Error('unreachable');
    // The formatted run kept its `w:rPr` and its identity through the splice.
    const middle = run.children[1]!;
    if (middle.kind === 'textValue') throw new Error('unreachable');
    expect(middle.children.some((child) => child.localName === 'rPr')).toBe(true);
  });

  test('link then unlink round-trips to the original tree', () => {
    const part = load('<w:p><w:r><w:t>Visit example today</w:t></w:r></w:p>');
    const linked = apply(part, {
      op: 'insertHyperlink',
      paragraphId: PARAGRAPH,
      start: 6,
      end: 13,
      anchor: 'top',
    });
    const unlinked = apply(linked, { op: 'removeHyperlink', linkId: linkIdOf(linked) });
    // The RUNS were cut in three by the insert and are not re-joined by the unlink — Word
    // behaves the same way — so text and shape are what matter, not node count.
    expect(paragraphTextOf(unlinked, PARAGRAPH)).toBe('Visit example today');
    expect(shapeOf(unlinked, PARAGRAPH)).toEqual(['r', 'r', 'r']);
  });

  test('a bookmark inside the link stays where it was', () => {
    const part = load(
      '<w:p><w:hyperlink w:anchor="x"><w:bookmarkStart w:id="1" w:name="in"/>' +
        '<w:r><w:t>text</w:t></w:r></w:hyperlink></w:p>'
    );
    const next = apply(part, { op: 'removeHyperlink', linkId: linkIdOf(part) });
    expect(shapeOf(next, PARAGRAPH)).toEqual(['bookmarkStart', 'r']);
  });
});

describe('a many-way split is equivalent to the singles it stands for', () => {
  // `splitParagraphMany` exists so a paste does not rebuild the body once per line. Its
  // whole contract is equivalence with the sequence of single splits — and the hyperlink
  // walk broke it by measuring a link's zero-length children from offset zero instead of
  // from the link's own start. A bookmark travelled to a paragraph its text did not, and an
  // EMPTY `w:hyperlink` husk was emitted holding the original link's node id.
  const BODY =
    '<w:p><w:r><w:t>0123456789</w:t></w:r>' +
    '<w:hyperlink w:anchor="t"><w:bookmarkStart w:id="1" w:name="lead"/>' +
    '<w:r><w:t>ABCDEFGHIJ</w:t></w:r></w:hyperlink></w:p>';

  /** Paragraph shapes of a part's body, in document order. */
  function bodyShapes(part: OoxmlPart): string[][] {
    const shapes: string[][] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'paragraph') {
        shapes.push(
          node.children
            .filter((child) => child.kind !== 'textValue' && child.localName !== 'pPr')
            .map((child) => (child.kind === 'textValue' ? '' : child.localName))
        );
        return;
      }
      for (const child of node.children) walk(child);
    };
    walk(part.root);
    return shapes;
  }

  test('the many-way result matches two sequential single splits', () => {
    const many = apply(load(BODY), {
      op: 'splitParagraphMany',
      paragraphId: PARAGRAPH,
      offsets: [5, 15],
    });
    // The equivalent singles run LAST offset first, so earlier offsets stay valid.
    let singles = load(BODY);
    const last = applyTreeOp(singles, { op: 'splitParagraph', paragraphId: PARAGRAPH, offset: 15 });
    if (!last.ok) throw new Error(last.reason);
    singles = last.part;
    const first = applyTreeOp(singles, { op: 'splitParagraph', paragraphId: PARAGRAPH, offset: 5 });
    if (!first.ok) throw new Error(first.reason);
    singles = first.part;

    expect(bodyShapes(many)).toEqual(bodyShapes(singles));
  });

  test('no empty hyperlink husk is emitted, and the bookmark rides with its text', () => {
    const next = apply(load(BODY), {
      op: 'splitParagraphMany',
      paragraphId: PARAGRAPH,
      offsets: [5, 15],
    });
    const links: OoxmlNode[] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'hyperlink') links.push(node);
      for (const child of node.children) walk(child);
    };
    walk(next.root);
    // Every link that survives holds content. An empty `w:hyperlink` is markup with nothing
    // to click, and it kept the original node id — so a later retarget addressed the husk.
    for (const link of links) {
      if (link.kind === 'textValue') continue;
      expect(link.children.length).toBeGreaterThan(0);
    }
    // The bookmark stays INSIDE its link, in the paragraph that holds the link's first
    // characters — not stranded in the piece before it. Measured through the index an
    // internal hyperlink actually resolves through.
    const index = buildBookmarkIndex(next);
    const lead = index.get('lead');
    expect(lead).toBeDefined();
    expect(paragraphTextOf(next, lead!.paragraphId)).toBe('56789ABCDE');
    expect(lead!.offset).toBe(5);
  });
});

describe('bookmark offsets use the paragraph field model', () => {
  test('a bookmark after a wrapped complex field follows its one model unit', () => {
    const part = load(
      '<w:p><w:smartTag>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>12</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '<w:bookmarkStart w:id="1" w:name="afterField"/>' +
        '<w:r><w:t>Target</w:t></w:r>' +
        '</w:smartTag></w:p>'
    );
    const anchor = buildBookmarkIndex(part).get('afterField');
    const text = paragraphTextOf(part, PARAGRAPH);

    expect(anchor).toBeDefined();
    expect(anchor?.offset).toBe(1);
    expect(anchor!.offset).toBeLessThanOrEqual(text.length);
    expect(text).toBe('\uFFFCTarget');
  });
});

describe('setHyperlinkTarget re-aims without replacing the element', () => {
  const LINKED =
    '<w:p><w:hyperlink r:id="rId9" w:history="1" w:tgtFrame="_blank">' +
    '<w:r><w:t>example</w:t></w:r></w:hyperlink></w:p>';

  test('a new relationship replaces the old one', () => {
    const part = load(LINKED);
    const next = apply(part, {
      op: 'setHyperlinkTarget',
      linkId: linkIdOf(part),
      relationshipId: 'rId42',
    });
    const link = linkIdOf(next);
    expect(attributeOf(next, link, 'id')).toBe('rId42');
    expect(attributeOf(next, link, 'anchor')).toBeUndefined();
  });

  test('switching to an anchor clears the relationship, and back again clears the anchor', () => {
    const part = load(LINKED);
    const internal = apply(part, {
      op: 'setHyperlinkTarget',
      linkId: linkIdOf(part),
      anchor: 'section2',
    });
    expect(attributeOf(internal, linkIdOf(internal), 'id')).toBeUndefined();
    expect(attributeOf(internal, linkIdOf(internal), 'anchor')).toBe('section2');
    const external = apply(internal, {
      op: 'setHyperlinkTarget',
      linkId: linkIdOf(internal),
      relationshipId: 'rId7',
    });
    expect(attributeOf(external, linkIdOf(external), 'anchor')).toBeUndefined();
    expect(attributeOf(external, linkIdOf(external), 'id')).toBe('rId7');
  });

  test('authored attributes the op did not name are retained', () => {
    const part = load(LINKED);
    const next = apply(part, {
      op: 'setHyperlinkTarget',
      linkId: linkIdOf(part),
      relationshipId: 'rId42',
    });
    const link = linkIdOf(next);
    // `w:tgtFrame` and `w:history` belong to the LINK, not to the target it points at.
    expect(attributeOf(next, link, 'tgtFrame')).toBe('_blank');
    expect(attributeOf(next, link, 'history')).toBe('1');
  });

  test('the display text is untouched', () => {
    const part = load(LINKED);
    const next = apply(part, {
      op: 'setHyperlinkTarget',
      linkId: linkIdOf(part),
      anchor: 'elsewhere',
    });
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('example');
  });

  test('a tooltip replaces the old one; omitting it keeps the old one', () => {
    const part = load(
      '<w:p><w:hyperlink w:anchor="a" w:tooltip="old"><w:r><w:t>t</w:t></w:r></w:hyperlink></w:p>'
    );
    const replaced = apply(part, {
      op: 'setHyperlinkTarget',
      linkId: linkIdOf(part),
      anchor: 'b',
      tooltip: 'new',
    });
    expect(attributeOf(replaced, linkIdOf(replaced), 'tooltip')).toBe('new');
    const kept = apply(part, { op: 'setHyperlinkTarget', linkId: linkIdOf(part), anchor: 'b' });
    expect(attributeOf(kept, linkIdOf(kept), 'tooltip')).toBe('old');
  });

  test('an id that is not a link is refused', () => {
    const part = load('<w:p><w:r><w:t>plain</w:t></w:r></w:p>');
    expect(reject(part, { op: 'setHyperlinkTarget', linkId: PARAGRAPH, anchor: 'x' })).toBe(
      'not-a-paragraph'
    );
  });
});

describe('CT_Hyperlink’s full attribute set (ECMA-376 §17.16.22)', () => {
  // §17.16.22 declares six attributes. Three are MODELED — `r:id`, `w:anchor`, `w:tooltip` are
  // what the ops read and write. The other three are PRESERVED: nothing here interprets
  // `w:tgtFrame`, `w:docLocation` or `w:history`, and they survive only because attributes are
  // carried verbatim. That makes them exactly the kind of thing a refactor drops silently, so
  // it is pinned rather than left to the general preservation guarantee.
  const ALL_SIX =
    '<w:p><w:hyperlink r:id="rId9" w:tgtFrame="_top" w:docLocation="part2" w:tooltip="tip"' +
    ' w:history="1"><w:r><w:t>x</w:t></w:r></w:hyperlink></w:p>';

  test('all six attributes survive a read and re-serialize', () => {
    const part = load(ALL_SIX);
    const link = linkIdOf(part);
    expect(attributeOf(part, link, 'id')).toBe('rId9');
    expect(attributeOf(part, link, 'tgtFrame')).toBe('_top');
    expect(attributeOf(part, link, 'docLocation')).toBe('part2');
    expect(attributeOf(part, link, 'tooltip')).toBe('tip');
    expect(attributeOf(part, link, 'history')).toBe('1');
    // And the element is still typed — none of the six demotes it.
    expect(findById(part.root, link)?.kind).toBe('hyperlink');
  });

  test('retargeting keeps docLocation, the one that changes where a link LANDS', () => {
    const part = load(ALL_SIX);
    const next = apply(part, {
      op: 'setHyperlinkTarget',
      linkId: linkIdOf(part),
      anchor: 'sec1',
    });
    const link = linkIdOf(next);
    // The target attribute swapped, as asked.
    expect(attributeOf(next, link, 'anchor')).toBe('sec1');
    expect(attributeOf(next, link, 'id')).toBeUndefined();
    // Everything the op did not name is exactly as authored. `w:docLocation` names a location
    // INSIDE the target document, so dropping it here would move the link without saying so.
    expect(attributeOf(next, link, 'docLocation')).toBe('part2');
    expect(attributeOf(next, link, 'tgtFrame')).toBe('_top');
    expect(attributeOf(next, link, 'history')).toBe('1');
  });
});

describe('a link nested in a link', () => {
  // `CT_Hyperlink`'s content model is `EG_PContent`, which lists `w:hyperlink` among its own
  // members — so a link inside a link is schema-legal, and Word can write one. The reader
  // keeps BOTH typed. Demoting the inner one to `generic` would be the easier type and would
  // reintroduce the bug typing this element fixed: a generic link's runs never reach the
  // token stream, so the words inside it stop painting.
  const NESTED =
    '<w:p><w:hyperlink w:anchor="outer"><w:r><w:t xml:space="preserve">a </w:t></w:r>' +
    '<w:hyperlink w:anchor="inner"><w:r><w:t>b</w:t></w:r></w:hyperlink>' +
    '<w:r><w:t xml:space="preserve"> c</w:t></w:r></w:hyperlink></w:p>';

  const linksOf = (part: OoxmlPart): OoxmlNode[] => {
    const found: OoxmlNode[] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'hyperlink') found.push(node);
      for (const child of node.children) walk(child);
    };
    walk(part.root);
    return found;
  };

  test('both links stay typed and the part validates', () => {
    const part = load(NESTED);
    const links = linksOf(part);
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.kind)).toEqual(['hyperlink', 'hyperlink']);
    expect(links.map((link) => attributeOf(part, link.id, 'anchor'))).toEqual(['outer', 'inner']);
    expect(validateOoxmlPart(part).ok).toBe(true);
  });

  test('the inner link’s text is addressable, so its runs measure and paint', () => {
    // The whole point: offsets run THROUGH both links. If the inner one were generic its
    // character would vanish from the paragraph's text and every offset past it would drift.
    expect(paragraphTextOf(load(NESTED), PARAGRAPH)).toBe('a b c');
  });

  test('a range edit reaches the run inside the inner link', () => {
    const part = load(NESTED);
    const next = apply(part, {
      op: 'setRunProperties',
      paragraphId: PARAGRAPH,
      start: 0,
      end: 5,
      properties: [{ localName: 'b' }],
    });
    // Every run at every depth, bolded — including the doubly-nested one.
    const runs: OoxmlNode[] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'run') runs.push(node);
      for (const child of node.children) walk(child);
    };
    walk(next.root);
    expect(runs).toHaveLength(3);
    const bolded = runs.filter(
      (run) =>
        run.kind !== 'textValue' &&
        run.children.some(
          (child) =>
            child.kind !== 'textValue' &&
            child.localName === 'rPr' &&
            child.children.some((g) => g.kind !== 'textValue' && g.localName === 'b')
        )
    );
    expect(bolded).toHaveLength(3);
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('a b c');
  });

  test('the nesting survives a real serialize -> reparse unchanged', () => {
    const part = load(NESTED);
    // Serialize what was PARSED and read the output back, rather than loading the same source
    // twice — comparing two fresh loads of one string proves nothing about the writer.
    const reparsed = readOoxmlPart(serializeOoxmlPart(part), {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!reparsed.ok) throw new Error(reparsed.reason);
    expect(canonicalOoxmlFingerprint(reparsed.part)).toBe(canonicalOoxmlFingerprint(part));
    const links = linksOf(reparsed.part);
    expect(links).toHaveLength(2);
    expect(links.map((link) => attributeOf(reparsed.part, link.id, 'anchor'))).toEqual([
      'outer',
      'inner',
    ]);
    expect(paragraphTextOf(reparsed.part, PARAGRAPH)).toBe('a b c');
  });

  test('unlinking the OUTER link leaves the inner one intact', () => {
    const part = load(NESTED);
    const outer = linksOf(part)[0]!;
    const next = apply(part, { op: 'removeHyperlink', linkId: outer.id });
    const left = linksOf(next);
    // Exactly one link goes — the one named — and the inner survives with its own target.
    expect(left).toHaveLength(1);
    expect(attributeOf(next, left[0]!.id, 'anchor')).toBe('inner');
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('a b c');
  });

  test('unlinking the INNER link leaves the outer one intact', () => {
    const part = load(NESTED);
    const inner = linksOf(part)[1]!;
    const next = apply(part, { op: 'removeHyperlink', linkId: inner.id });
    const left = linksOf(next);
    expect(left).toHaveLength(1);
    expect(attributeOf(next, left[0]!.id, 'anchor')).toBe('outer');
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('a b c');
  });
});
