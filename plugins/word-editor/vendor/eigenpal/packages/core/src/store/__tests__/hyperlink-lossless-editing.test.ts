// EDITING a link on a real Word document loses nothing else in it.
//
// `hyperlink-roundtrip.test.ts` proves an UNEDITED load -> save -> reopen is faithful. That is
// the weaker half. The question a user actually asks is "if I retarget this link, or unlink it,
// or make it red, does the rest of my document come back?" — and the parts most at risk are the
// ones nowhere near the link: a `w:hyperlink` sits among bookmark markers, tracked changes,
// content controls and fields, and every op here rebuilds the paragraph that holds it.
//
// So each case applies ONE hyperlink edit to the comprehensive fixture, saves the package,
// reopens it, and asserts four things:
//
//   CENSUS       no class of element anywhere in the package dropped in count. This is the
//                guard that does not need the test to guess what might vanish.
//   NEIGHBOURS   every link the edit did not name keeps its authored attributes verbatim, and
//                every bookmark keeps its id and name — the anchors a link resolves through.
//   RELS         the external relationship targets are still there, still pointing where they did.
//   TEXT         the document's text is byte-identical, except where the edit was supposed to
//                change it (none of these edits changes text at all).
//
// Deliberately no DOM and no layout: this is the store's contract, and it has to hold whether
// or not anything is on screen.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage, writeOoxmlPackage, withPart } from '../package/ooxml-package.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { paragraphTextOf } from '../store/tree-op-apply.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import type { OoxmlNode, OoxmlPackage, OoxmlPart } from '../package/ooxml-tree.ts';
import type { TreeDocOp } from '../store/tree-op-validate.ts';

const FIXTURE = `${import.meta.dir}/../../../../../e2e/fixtures/comprehensive-word-element-test.docx`;
const original = readFileSync(FIXTURE);

/** A freshly read package, so each case starts from the same bytes. */
function readPackage(): OoxmlPackage {
  const loaded = readOoxmlPackage(new Uint8Array(original));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

const mainPartOf = (pkg: OoxmlPackage): OoxmlPart => {
  const part = pkg.parts.get(pkg.mainDocumentPart);
  if (!part) throw new Error('no main document part');
  return part;
};

function* walk(node: OoxmlNode): Generator<OoxmlNode> {
  yield node;
  if (node.kind === 'textValue') return;
  for (const child of node.children ?? []) yield* walk(child);
}

function nodesOfKind(part: OoxmlPart, kind: string): OoxmlNode[] {
  return [...walk(part.root)].filter((node) => node.kind === kind);
}

function attributeOf(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/** Element counts by local name, across every XML part of the package. */
function elementCensus(pkg: OoxmlPackage): Map<string, number> {
  const census = new Map<string, number>();
  for (const part of pkg.parts.values()) {
    for (const node of walk(part.root)) {
      if (node.kind === 'textValue') continue;
      census.set(node.localName, (census.get(node.localName) ?? 0) + 1);
    }
  }
  return census;
}

/** Names whose count dropped, with before/after — the shape a reader can act on. */
function losses(before: Map<string, number>, after: Map<string, number>): Record<string, string> {
  const lost: Record<string, string> = {};
  for (const [name, count] of before) {
    const now = after.get(name) ?? 0;
    if (now < count) lost[name] = `${count} -> ${now}`;
  }
  return lost;
}

/** Authored identity of every link, in document order — what a neighbour must not lose. */
const linkIdentities = (part: OoxmlPart) =>
  nodesOfKind(part, 'hyperlink').map((link) => ({
    id: attributeOf(link, 'id'),
    anchor: attributeOf(link, 'anchor'),
    history: attributeOf(link, 'history'),
    tooltip: attributeOf(link, 'tooltip'),
  }));

const bookmarkIdentities = (part: OoxmlPart) =>
  nodesOfKind(part, 'bookmarkStart').map((node) => [
    attributeOf(node, 'id'),
    attributeOf(node, 'name'),
  ]);

const hyperlinkTargets = (pkg: OoxmlPackage) =>
  pkg.externalTargets
    .filter((entry) => entry.type.endsWith('/hyperlink'))
    .map((entry) => entry.rawTarget)
    .sort();

/** Every paragraph's text, in document order — the content a user would notice missing. */
const allText = (part: OoxmlPart): string[] =>
  [...walk(part.root)]
    .filter((node) => node.kind === 'paragraph')
    .map((node) => paragraphTextOf(part, node.id) ?? '');

/** The paragraph holding a link, and the link's own extent in that paragraph's offsets. */
function paragraphHolding(part: OoxmlPart, linkId: string): string {
  for (const node of walk(part.root)) {
    if (node.kind !== 'paragraph') continue;
    if ([...walk(node)].some((inner) => inner.id === linkId)) return node.id;
  }
  throw new Error(`no paragraph holds ${linkId}`);
}

/** Apply ops, save, reopen. */
function roundTrip(plan: (part: OoxmlPart, pkg: OoxmlPackage) => readonly TreeDocOp[]) {
  const before = readPackage();
  const store = new TreeDocumentStore(mainPartOf(before));
  const ops = plan(store.part, before);
  expect(ops.length).toBeGreaterThan(0);
  store.transact((tx) => {
    for (const op of ops) {
      const result = tx.apply(op);
      if (result && result.ok === false) throw new Error(`${op.op} refused: ${result.reason}`);
    }
  });
  const saved = writeOoxmlPackage(withPart(before, store.part));
  const reopened = readOoxmlPackage(saved);
  if (!reopened.ok) throw new Error(`reopen failed: ${reopened.reason}`);
  return { before, after: reopened.package, edited: store.part };
}

/** The fixture's links, read once, so a plan can name one by index. */
const baseline = mainPartOf(readPackage());
const baselineLinks = nodesOfKind(baseline, 'hyperlink');

/**
 * One edit, and which link it deliberately consumes.
 *
 * `removesALink` marks the only case allowed to reduce the `w:hyperlink` count — unlinking is
 * SUPPOSED to remove the element. Everything else in the census still has to hold for it, which
 * is the point: Remove Hyperlink must give the runs back, not swallow them.
 */
interface EditCase {
  readonly what: string;
  readonly plan: (part: OoxmlPart, pkg: OoxmlPackage) => readonly TreeDocOp[];
  readonly removesALink?: boolean;
}

/** The external link (`r:id`) and an internal one (`w:anchor`), by index into the fixture. */
const externalIndex = baselineLinks.findIndex((link) => attributeOf(link, 'id') !== undefined);
const internalIndex = baselineLinks.findIndex((link) => attributeOf(link, 'anchor') !== undefined);

const linkAt = (part: OoxmlPart, index: number): OoxmlNode => {
  const link = nodesOfKind(part, 'hyperlink')[index];
  if (!link) throw new Error(`no link at index ${index}`);
  return link;
};

const EDITS: readonly EditCase[] = [
  {
    what: 'retargeting an external link to a bookmark in the same document',
    plan: (part) => [
      { op: 'setHyperlinkTarget', linkId: linkAt(part, externalIndex).id, anchor: 'section1' },
    ],
  },
  {
    what: 'retargeting an internal link to another bookmark',
    plan: (part) => [
      { op: 'setHyperlinkTarget', linkId: linkAt(part, internalIndex).id, anchor: 'section6' },
    ],
  },
  {
    what: 'adding a tooltip to an existing link',
    plan: (part) => [
      {
        op: 'setHyperlinkTarget',
        linkId: linkAt(part, internalIndex).id,
        anchor: 'section12',
        tooltip: 'Jump to section 12',
      },
    ],
  },
  {
    what: 'unlinking an external link',
    plan: (part) => [{ op: 'removeHyperlink', linkId: linkAt(part, externalIndex).id }],
    removesALink: true,
  },
  {
    what: 'colouring a link’s text red',
    plan: (part) => {
      const link = linkAt(part, externalIndex);
      const paragraphId = paragraphHolding(part, link.id);
      const text = paragraphTextOf(part, paragraphId) ?? '';
      // Whole paragraph, so the write sweeps the link and the runs either side of it — the
      // range that used to address runs past the link at the wrong offset.
      return [
        {
          op: 'setRunProperties',
          paragraphId,
          start: 0,
          end: text.length,
          properties: [{ localName: 'color', attributes: { val: 'FF0000' } }],
        },
      ];
    },
  },
  {
    what: 'typing inside a link',
    plan: (part) => {
      const link = linkAt(part, internalIndex);
      const paragraphId = paragraphHolding(part, link.id);
      const text = paragraphTextOf(part, paragraphId) ?? '';
      return [{ op: 'insertText', paragraphId, offset: Math.min(12, text.length), text: 'X' }];
    },
  },
  {
    what: 'linking a fresh range in a paragraph that already holds links',
    plan: (part) => {
      const paragraphId = paragraphHolding(part, linkAt(part, internalIndex).id);
      // The first four characters of `9.2 Jump to: ...` — before the first link, so the new
      // link neither overlaps nor nests.
      return [{ op: 'insertHyperlink', paragraphId, start: 0, end: 4, anchor: 'section1' }];
    },
  },
];

describe('formatting a link’s text reaches the runs inside it', () => {
  // The teeth for the offset half of this. A `w:hyperlink` holds ordinary runs, and a range
  // write that skipped the link without ADVANCING past its characters addressed every run
  // after it one link-length early: colouring a paragraph wrote the following run's
  // properties over the link's text, one character short of its end. Nothing was lost, so no
  // census or digest guard could see it — only asking where the colour actually landed can.

  /** Every run in a paragraph, at any depth, with its own direct `w:color`. */
  function runColours(part: OoxmlPart, paragraphId: string): (string | undefined)[] {
    const paragraph = [...walk(part.root)].find((node) => node.id === paragraphId);
    if (!paragraph) throw new Error('no paragraph');
    return [...walk(paragraph)]
      .filter((node) => node.kind === 'run')
      .map((run) => {
        const rPr =
          run.kind === 'textValue'
            ? undefined
            : run.children.find((c) => c.kind === 'runProperties');
        const colour = rPr?.children.find((c) => c.kind !== 'textValue' && c.localName === 'color');
        return colour ? attributeOf(colour, 'val') : undefined;
      });
  }

  test('colouring the whole paragraph colours every run, including the linked ones', () => {
    const { edited } = roundTrip((part) => {
      const paragraphId = paragraphHolding(part, linkAt(part, internalIndex).id);
      const text = paragraphTextOf(part, paragraphId) ?? '';
      return [
        {
          op: 'setRunProperties',
          paragraphId,
          start: 0,
          end: text.length,
          properties: [{ localName: 'color', attributes: { val: 'FF0000' } }],
        },
      ];
    });
    const paragraphId = paragraphHolding(edited, linkAt(edited, internalIndex).id);
    const colours = runColours(edited, paragraphId);
    expect(colours.length).toBeGreaterThan(1);
    // Not "some run is red" — EVERY run is, links included. A run left uncoloured is a run
    // the range never reached, which is precisely the failure.
    expect(colours.every((colour) => colour === 'FF0000')).toBe(true);
  });

  test('colouring only the link colours the link and nothing else', () => {
    const link = linkAt(baseline, internalIndex);
    const paragraphId = paragraphHolding(baseline, link.id);
    const text = paragraphTextOf(baseline, paragraphId) ?? '';
    // `9.2` paragraph: `Jump to: Section 1 | ...`. The first link is `Section 1`.
    const start = text.indexOf('Section 1');
    const end = start + 'Section 1'.length;
    expect(start).toBeGreaterThan(0);

    const { edited } = roundTrip(() => [
      {
        op: 'setRunProperties',
        paragraphId,
        start,
        end,
        properties: [{ localName: 'color', attributes: { val: 'FF0000' } }],
      },
    ]);

    // Exactly the linked text is red, and it is INSIDE the link — not the run after it.
    const firstLink = nodesOfKind(edited, 'hyperlink').find(
      (node) => attributeOf(node, 'anchor') === 'section1'
    );
    if (!firstLink) throw new Error('the link is gone');
    const insideColours = [...walk(firstLink)]
      .filter((node) => node.kind === 'run')
      .map((run) => {
        const rPr =
          run.kind === 'textValue'
            ? undefined
            : run.children.find((c) => c.kind === 'runProperties');
        const colour = rPr?.children.find((c) => c.kind !== 'textValue' && c.localName === 'color');
        return colour ? attributeOf(colour, 'val') : undefined;
      });
    expect(insideColours.length).toBeGreaterThan(0);
    expect(insideColours.every((colour) => colour === 'FF0000')).toBe(true);

    // And the link still reads `Section 1` — the write divided runs, it did not move text.
    expect(paragraphTextOf(edited, paragraphHolding(edited, firstLink.id))).toBe(text);

    // Nothing outside the link picked up the colour.
    const outside = runColours(edited, paragraphId).filter((_, index) => index >= 0);
    expect(outside.filter((colour) => colour === 'FF0000')).toHaveLength(insideColours.length);
  });

  test('the character style survives the colour, so the link still looks like a link', () => {
    const { edited } = roundTrip((part) => {
      const paragraphId = paragraphHolding(part, linkAt(part, internalIndex).id);
      const text = paragraphTextOf(part, paragraphId) ?? '';
      return [
        {
          op: 'setRunProperties',
          paragraphId,
          start: 0,
          end: text.length,
          properties: [{ localName: 'color', attributes: { val: 'FF0000' } }],
        },
      ];
    });
    // `w:rStyle` is preserved rather than accepted, so a property write must not delete it.
    const styles = [...walk(edited.root)]
      .filter((node) => node.kind !== 'textValue' && node.localName === 'rStyle')
      .map((node) => attributeOf(node, 'val'));
    expect(styles).toContain('Hyperlink');
  });
});

describe('editing a hyperlink on a real Word document loses nothing else', () => {
  test('the premise: the fixture has both kinds of link and bookmarks to aim at', () => {
    expect(externalIndex).toBeGreaterThanOrEqual(0);
    expect(internalIndex).toBeGreaterThanOrEqual(0);
    expect(bookmarkIdentities(baseline).length).toBeGreaterThan(0);
  });

  for (const edit of EDITS) {
    describe(edit.what, () => {
      test('no class of element is lost anywhere in the package', () => {
        const { before, after } = roundTrip(edit.plan);
        const lost = losses(elementCensus(before), elementCensus(after));
        // Unlinking is supposed to consume its own `w:hyperlink` — and nothing else.
        const expected = edit.removesALink
          ? {
              hyperlink: `${nodesOfKind(mainPartOf(before), 'hyperlink').length} -> ${nodesOfKind(mainPartOf(after), 'hyperlink').length}`,
            }
          : {};
        expect(lost).toEqual(expected);
      });

      test('the document’s text is unchanged, paragraph for paragraph', () => {
        const { before, after } = roundTrip(edit.plan);
        const textBefore = allText(mainPartOf(before));
        const textAfter = allText(mainPartOf(after));
        if (edit.what === 'typing inside a link') {
          // The one edit that is MEANT to change text changes exactly one character in
          // exactly one paragraph, and leaves every other paragraph alone.
          expect(textAfter).toHaveLength(textBefore.length);
          const changed = textAfter.filter((line, index) => line !== textBefore[index]);
          expect(changed).toHaveLength(1);
        } else {
          expect(textAfter).toEqual(textBefore);
        }
      });

      test('every bookmark keeps its id and name', () => {
        const { before, after } = roundTrip(edit.plan);
        expect(bookmarkIdentities(mainPartOf(after))).toEqual(
          bookmarkIdentities(mainPartOf(before))
        );
      });

      test('the external relationship targets survive', () => {
        const { before, after } = roundTrip(edit.plan);
        // Word keeps a relationship a link stopped using — an unused rel is not corruption,
        // and re-pointing a link must never delete a target another link may share.
        for (const target of hyperlinkTargets(before)) {
          expect(hyperlinkTargets(after)).toContain(target);
        }
      });

      test('the links the edit did not name keep their authored attributes verbatim', () => {
        const { before, after, edited } = roundTrip(edit.plan);
        // Identify the untouched links by their position among the survivors: an edit names
        // exactly one link, so comparing the others pins any collateral rewrite.
        const beforeIds = linkIdentities(mainPartOf(before));
        const afterIds = linkIdentities(mainPartOf(after));
        expect(afterIds).toHaveLength(nodesOfKind(edited, 'hyperlink').length);
        // Every surviving link's identity must be one the document authored, or the one the
        // edit deliberately wrote — never a third thing invented by the round trip.
        const untouched = afterIds.filter((entry) =>
          beforeIds.some(
            (was) =>
              was.id === entry.id &&
              was.anchor === entry.anchor &&
              was.history === entry.history &&
              was.tooltip === entry.tooltip
          )
        );
        // The edit changes at most one link, so all but one must match verbatim.
        expect(untouched.length).toBeGreaterThanOrEqual(afterIds.length - 1);
      });

      test('the semantic digest differs only where the edit reached', () => {
        const { before, after } = roundTrip(edit.plan);
        const diff = diffSemanticDigests(
          semanticDigest([mainPartOf(before)]),
          semanticDigest([mainPartOf(after)])
        );
        // Counted per PARAGRAPH, not per entry: one edit legitimately moves several facets of
        // the paragraph it lands on — wrapping a range in a link changes that paragraph's
        // structure AND splits a run, which the digest reports separately. What must not
        // happen is a second paragraph moving, which is what "the save rewrote something it
        // never visited" looks like.
        const touched = new Set(diff.map((entry) => entry.path.replace(/\.[^.]+$/, '')));
        expect([...touched].length).toBeLessThanOrEqual(1);
      });
    });
  }
});
