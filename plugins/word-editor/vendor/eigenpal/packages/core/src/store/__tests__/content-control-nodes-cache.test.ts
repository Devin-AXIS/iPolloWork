// Default-option `contentControlsIn` memoization: same immutable root identity, edit invalidation,
// optioned bypass, and frozen cached results.

import { describe, expect, test } from 'bun:test';
import {
  contentControlsIn,
  MAX_CONTENT_CONTROL_NESTING,
} from '../package/content-control-nodes.ts';
import { bodyStoryRoot, readOoxmlPart, storyParagraphs, type OoxmlPart } from '../index.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import type { TreeDocOp } from '../store/tree-op-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const docMeta = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`,
    docMeta
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.part;
}

const nestedBody =
  `<w:p><w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr>` +
  `<w:sdtContent><w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr>` +
  `<w:sdtContent><w:p><w:r><w:t>text</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
  `</w:sdtContent></w:sdt></w:p>`;

function nestedDoc(): OoxmlPart {
  return parseDoc(nestedBody);
}

describe('contentControlsIn default-option cache', () => {
  test('table row reuse preserves control ancestry and invalidates edited cells', () => {
    const control = (tag: string, content: string) =>
      `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
    const paragraph = '<w:p><w:r><w:t>Cell</w:t></w:r></w:p>';
    const table =
      '<w:tbl><w:tr><w:tc>' +
      control('inner', paragraph) +
      '</w:tc></w:tr><w:tr><w:tc>' +
      paragraph +
      '</w:tc></w:tr></w:tbl>';
    for (const content of [table, control('outer', table)]) {
      const part = parseDoc(content);
      const before = contentControlsIn(part.root);
      expect(before).toEqual(contentControlsIn(part.root, {}));
      const body = bodyStoryRoot(part)!;
      const edited = apply(part, {
        op: 'insertText',
        paragraphId: storyParagraphs(body)[0]!.id,
        offset: 0,
        text: 'Changed',
      });
      expect(contentControlsIn(edited.root)).toEqual(contentControlsIn(edited.root, {}));
      expect(contentControlsIn(part.root)).toBe(before);
    }
  });

  test('same root returns the cached array on a second default call', () => {
    const part = nestedDoc();
    const first = contentControlsIn(part.root);
    const second = contentControlsIn(part.root);
    expect(first).toBe(second);
    expect(first).toHaveLength(2);
  });

  test('a new root after an edit recomputes instead of reusing the prior cache', () => {
    const part = nestedDoc();
    const before = contentControlsIn(part.root);

    const body = bodyStoryRoot(part);
    if (!body) throw new Error('missing body');
    const paragraph = storyParagraphs(body)[0];
    if (!paragraph) throw new Error('missing paragraph');

    const edited = apply(part, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 0,
      text: 'X',
    });
    expect(edited.root).not.toBe(part.root);

    const after = contentControlsIn(edited.root);
    expect(after).not.toBe(before);
    expect(contentControlsIn(edited.root)).toBe(after);
    expect(after).toHaveLength(2);
  });

  test('any options object bypasses the cache even with default-valued properties', () => {
    const part = nestedDoc();
    const withDefaults = contentControlsIn(part.root, {});

    const again = contentControlsIn(part.root, {});
    expect(again).not.toBe(withDefaults);

    const limited = contentControlsIn(part.root, { limit: 1 });
    expect(limited).toHaveLength(1);
    expect(contentControlsIn(part.root, { maxDepth: MAX_CONTENT_CONTROL_NESTING })).toHaveLength(2);

    const cached = contentControlsIn(part.root);
    expect(contentControlsIn(part.root)).toBe(cached);
  });

  test('cached results stay immutable and stable across callers', () => {
    const part = nestedDoc();
    const first = contentControlsIn(part.root);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0]!)).toBe(true);
    expect(Object.isFrozen(first[0]!.ancestors)).toBe(true);

    expect(() => {
      (first as unknown as { push: (entry: unknown) => void }).push({});
    }).toThrow();

    const outerAncestors = first[1]!.ancestors;
    expect(() => {
      (outerAncestors as unknown as { push: (node: unknown) => void }).push(first[0]!.node);
    }).toThrow();

    const second = contentControlsIn(part.root);
    expect(second).toBe(first);
    expect(second[1]!.ancestors).toBe(outerAncestors);
    expect(second[1]!.ancestors).toHaveLength(1);
  });
});
