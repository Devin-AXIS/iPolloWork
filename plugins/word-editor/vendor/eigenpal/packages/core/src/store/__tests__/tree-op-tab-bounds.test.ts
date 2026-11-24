// Tab-stop op bounds (store lane).
//
// `setParagraphFormat` refuses every one of these before the op sees it, so a test written
// at the command layer passes with the op's own bounds deleted — which is how the 64-entry
// cap, the range check and the duplicate check all ended up with no coverage at all.
// `TreeDocOp` is public and reachable without the command layer, and the bounds exist for
// exactly those callers, so the test has to name the op.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { applyTreeOp, validateTreeOp, type TreeDocOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** The first paragraph node's id — the tree is walked, there is no flat index on the part. */
function firstParagraphId(part: OoxmlPart): string | undefined {
  let found: string | undefined;
  const walk = (node: OoxmlNode): void => {
    if (found !== undefined || node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      found = node.id;
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return found;
}

const part = load('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>');
const paragraphId = firstParagraphId(part);

const stop = (positionTwips: number) => ({ positionTwips, alignment: 'left' as const });

describe('setParagraphTabStops bounds its own inputs', () => {
  test('the fixture addresses a real paragraph, so a typo cannot pass this file', () => {
    expect(paragraphId).toBeTruthy();
  });

  const refused: { readonly name: string; readonly stops: readonly unknown[] }[] = [
    {
      name: 'more tab stops than Word allows',
      stops: Array.from({ length: 65 }, (_unused, index) => stop(100 + index)),
    },
    { name: 'a position past the page bound', stops: [stop(99_999_999)] },
    { name: 'a fractional position the reader would round away', stops: [stop(1440.5)] },
    {
      name: 'two stops at one position, which the reader would silently dedupe',
      stops: [stop(1440), { positionTwips: 1440, alignment: 'right' as const }],
    },
  ];

  for (const scenario of refused) {
    test(`${scenario.name} is refused, and changes nothing`, () => {
      const op = {
        op: 'setParagraphTabStops',
        paragraphId: paragraphId!,
        stops: scenario.stops,
      } as unknown as TreeDocOp;
      expect(validateTreeOp(part, op)).toBe('invalid-range');
      const result = applyTreeOp(part, op);
      expect(result.ok).toBe(false);
    });
  }

  test('a stop inside every bound is accepted, so the checks are not refusing everything', () => {
    const op: TreeDocOp = {
      op: 'setParagraphTabStops',
      paragraphId: paragraphId!,
      stops: [stop(1440)],
    };
    expect(validateTreeOp(part, op)).toBeNull();
    expect(applyTreeOp(part, op).ok).toBe(true);
  });
});
