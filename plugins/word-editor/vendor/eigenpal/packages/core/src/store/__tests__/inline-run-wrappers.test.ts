// Inline WordprocessingML run containers stay lossless while their runs join paragraph text.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { canonicalOoxmlFingerprint, serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { isInlineRunContainer } from '../package/ooxml-shared.ts';
import { applyTreeOp, paragraphTextOf, validateTreeOp, type TreeDocOp } from '../store/tree-ops.ts';
import {
  inlineControlEndingAt,
  inlineControlStartingAt,
  paragraphOffsetIndex,
  runsUnder,
  segmentsOf,
} from '../store/tree-op-segments.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WRAPPERS = ['smartTag', 'customXml', 'dir', 'bdo'] as const;

const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

function wrapper(name: (typeof WRAPPERS)[number], content: string): string {
  return `<w:${name}>${content}</w:${name}>`;
}

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstParagraph(part: OoxmlPart): OoxmlParagraphNode {
  const walk = (node: OoxmlNode): OoxmlParagraphNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'paragraph') return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(part.root);
  if (!found) throw new Error('no paragraph');
  return found;
}

function paragraphsOf(part: OoxmlPart): OoxmlParagraphNode[] {
  const paragraphs: OoxmlParagraphNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      paragraphs.push(node);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return paragraphs;
}

function containsNamed(node: OoxmlNode, localName: string): boolean {
  if (node.kind === 'textValue') return false;
  if (node.namespaceUri === W && node.localName === localName) return true;
  return node.children.some((child) => containsNamed(child, localName));
}

function firstNamed(part: OoxmlPart, localName: string): Exclude<OoxmlNode, { kind: 'textValue' }> {
  const walk = (node: OoxmlNode): Exclude<OoxmlNode, { kind: 'textValue' }> | null => {
    if (node.kind === 'textValue') return null;
    if (node.localName === localName && node.namespaceUri === W) return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(part.root);
  if (!found) throw new Error(`no ${localName}`);
  return found;
}

function textUnder(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  let text = '';
  for (const child of node.children) text += textUnder(child);
  return text;
}

function findById(node: OoxmlNode, id: string): OoxmlNode | null {
  if (node.id === id) return node;
  if (node.kind === 'textValue') return null;
  for (const child of node.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.part;
}

describe('inline run wrapper projection', () => {
  for (const name of WRAPPERS) {
    test(`${name} contributes text, segments, runs, and its own span`, () => {
      const part = load(`<w:p>${run('before ')}${wrapper(name, run(name))}${run(' after')}</w:p>`);
      const paragraph = firstParagraph(part);
      const container = firstNamed(part, name);
      const index = paragraphOffsetIndex(paragraph);

      expect(paragraph.kind).toBe('paragraph');
      expect(container.kind).toBe('generic');
      expect(isInlineRunContainer(container)).toBe(true);
      expect(paragraphTextOf(part, paragraph.id)).toBe(`before ${name} after`);
      expect(segmentsOf(paragraph).map((segment) => segment.node.id)).toEqual(
        index.segments.map((segment) => segment.node.id)
      );
      expect(runsUnder(container)).toHaveLength(1);
      expect(index.spanOf(container)).toEqual({ start: 7, end: 7 + name.length });
    });
  }

  test('wrappers flatten through hyperlinks, insertions, and other wrappers', () => {
    let content = '';
    for (const name of WRAPPERS) {
      content +=
        `<w:ins w:id="1" w:author="A"><w:hyperlink w:anchor="x">` +
        `${wrapper(name, run(name))}</w:hyperlink></w:ins>`;
    }
    content += wrapper('smartTag', wrapper('customXml', run('nested')));
    const part = load(`<w:p>${content}</w:p>`);
    const paragraph = firstParagraph(part);

    expect(isInlineRunContainer(firstNamed(part, 'hyperlink'))).toBe(true);
    expect(isInlineRunContainer(firstNamed(part, 'ins'))).toBe(true);
    expect(paragraphTextOf(part, paragraph.id)).toBe('smartTagcustomXmldirbdonested');
    expect(segmentsOf(paragraph)).toHaveLength(5);
  });

  test('a customXml that holds a paragraph is not an inline run container', () => {
    const part = load(`<w:customXml><w:p>${run('block')}</w:p></w:customXml>`);
    expect(isInlineRunContainer(firstNamed(part, 'customXml'))).toBe(false);
  });

  test('typing, deleting, and formatting stay inside a smartTag', () => {
    const original = load(`<w:p>${wrapper('smartTag', run('word'))}${run(' after')}</w:p>`);
    const paragraphId = firstParagraph(original).id;
    const typed = apply(original, {
      op: 'insertText',
      paragraphId,
      offset: 2,
      text: 'X',
    });
    expect(textUnder(firstNamed(typed, 'smartTag'))).toBe('woXrd');

    const formatted = apply(typed, {
      op: 'setRunProperties',
      paragraphId,
      start: 1,
      end: 5,
      properties: [{ localName: 'b' }],
    });
    expect(serializeOoxmlPart(formatted)).toContain('<w:b/>');

    const single = load(`<w:p>${wrapper('smartTag', run('x'))}</w:p>`);
    const emptied = apply(single, {
      op: 'deleteText',
      paragraphId: firstParagraph(single).id,
      start: 0,
      end: 1,
    });
    expect(paragraphTextOf(emptied, paragraphId)).toBe('');
    expect(firstNamed(emptied, 'smartTag').kind).toBe('generic');
  });

  test('deletion sweeps empty runs through generic wrappers but preserves the wrapper', () => {
    for (const outer of ['hyperlink', 'ins'] as const) {
      const open =
        outer === 'hyperlink'
          ? '<w:hyperlink w:anchor="target">'
          : '<w:ins w:id="7" w:author="Prior">';
      const original = load(`<w:p>${open}${wrapper('smartTag', run('x'))}</w:${outer}></w:p>`);
      const paragraphId = firstParagraph(original).id;
      const outerId = firstNamed(original, outer).id;
      const smartTagId = firstNamed(original, 'smartTag').id;
      const emptied = apply(original, {
        op: 'deleteText',
        paragraphId,
        start: 0,
        end: 1,
      });
      const smartTag = findById(emptied.root, smartTagId)!;

      expect(findById(emptied.root, outerId)).toBeNull();
      expect(smartTag.kind).toBe('generic');
      expect(runsUnder(smartTag)).toEqual([]);
    }

    const remaining = load(
      `<w:p><w:hyperlink w:anchor="target">${wrapper('smartTag', run('xy'))}` +
        '</w:hyperlink></w:p>'
    );
    const kept = apply(remaining, {
      op: 'deleteText',
      paragraphId: firstParagraph(remaining).id,
      start: 0,
      end: 1,
    });
    expect(textUnder(firstNamed(kept, 'smartTag'))).toBe('y');
    expect(runsUnder(firstNamed(kept, 'smartTag'))).toHaveLength(1);
    expect(firstNamed(kept, 'hyperlink').kind).toBe('hyperlink');
  });

  const edgeWrappers = [
    { name: 'smartTag', xml: `<w:smartTag>${run('B')}</w:smartTag>` },
    { name: 'hyperlink', xml: `<w:hyperlink w:anchor="target">${run('B')}</w:hyperlink>` },
    {
      name: 'ins',
      xml: `<w:ins w:id="7" w:author="Prior" w:date="2020-01-01T00:00:00Z">${run('B')}</w:ins>`,
    },
  ] as const;
  const edgeInsertions = [
    {
      name: 'text',
      model: 'X',
      op: (paragraphId: string, tracked: boolean, offset = 1): TreeDocOp => ({
        op: 'insertText',
        paragraphId,
        offset,
        text: 'X',
        ...(tracked ? { revision: { author: 'New' } } : {}),
      }),
    },
    {
      name: 'tab',
      model: '\t',
      op: (paragraphId: string, tracked: boolean, offset = 1): TreeDocOp => ({
        op: 'insertTab',
        paragraphId,
        offset,
        ...(tracked ? { revision: { author: 'New' } } : {}),
      }),
    },
    {
      name: 'hard break',
      model: '\n',
      op: (paragraphId: string, tracked: boolean, offset = 1): TreeDocOp => ({
        op: 'insertHardBreak',
        paragraphId,
        offset,
        ...(tracked ? { revision: { author: 'New' } } : {}),
      }),
    },
  ] as const;

  for (const wrapperCase of edgeWrappers) {
    for (const insertion of edgeInsertions) {
      test.each([false, true])(
        `unowned ${insertion.name} exits a trailing ${wrapperCase.name} (tracked=%s)`,
        (tracked) => {
          const original = load(`<w:p>${wrapperCase.xml}</w:p>`);
          const paragraphId = firstParagraph(original).id;
          const wrapperId = firstNamed(original, wrapperCase.name).id;
          const next = apply(original, insertion.op(paragraphId, tracked));
          const paragraph = firstParagraph(next);
          const wrapperIndex = paragraph.children.findIndex((child) => child.id === wrapperId);
          const updatedWrapper = findById(next.root, wrapperId)!;

          expect(textUnder(updatedWrapper)).toBe('B');
          expect(paragraphTextOf(next, paragraphId)).toBe(`B${insertion.model}`);
          expect(wrapperIndex).toBeGreaterThanOrEqual(0);
          expect(paragraph.children[wrapperIndex + 1]).toBeDefined();
        }
      );
    }
  }

  for (const insertion of edgeInsertions) {
    test.each([false, true])(
      `unowned ${insertion.name} stays outside a paragraph-initial smartTag (tracked=%s)`,
      (tracked) => {
        const original = load(`<w:p>${wrapper('smartTag', run('B'))}</w:p>`);
        const paragraphId = firstParagraph(original).id;
        const wrapperId = firstNamed(original, 'smartTag').id;
        const next = apply(original, insertion.op(paragraphId, tracked, 0));
        const paragraph = firstParagraph(next);
        const wrapperIndex = paragraph.children.findIndex((child) => child.id === wrapperId);

        expect(paragraphTextOf(next, paragraphId)).toBe(`${insertion.model}B`);
        expect(textUnder(findById(next.root, wrapperId)!)).toBe('B');
        expect(wrapperIndex).toBeGreaterThan(0);
      }
    );

    test.each([false, true])(
      `unowned ${insertion.name} stays between adjacent wrappers (tracked=%s)`,
      (tracked) => {
        const original = load(
          `<w:p>${wrapper('smartTag', run('A'))}${wrapper('customXml', run('B'))}</w:p>`
        );
        const paragraphId = firstParagraph(original).id;
        const leftId = firstNamed(original, 'smartTag').id;
        const rightId = firstNamed(original, 'customXml').id;
        const next = apply(original, insertion.op(paragraphId, tracked, 1));
        const paragraph = firstParagraph(next);
        const leftIndex = paragraph.children.findIndex((child) => child.id === leftId);
        const rightIndex = paragraph.children.findIndex((child) => child.id === rightId);

        expect(paragraphTextOf(next, paragraphId)).toBe(`A${insertion.model}B`);
        expect(textUnder(findById(next.root, leftId)!)).toBe('A');
        expect(textUnder(findById(next.root, rightId)!)).toBe('B');
        expect(rightIndex).toBeGreaterThan(leftIndex + 1);
      }
    );
  }

  const neutralBiasWrappers = ['smartTag', 'customXml', 'dir', 'bdo'] as const;

  test.each(neutralBiasWrappers)(
    'bias right joins the run at a paragraph-initial %s edge',
    (name) => {
      const original = load(`<w:p>${wrapper(name, run('B'))}</w:p>`);
      const paragraphId = firstParagraph(original).id;
      const wrapperId = firstNamed(original, name).id;
      const runId = firstNamed(original, 'r').id;
      const next = apply(original, {
        op: 'insertText',
        paragraphId,
        offset: 0,
        text: 'X',
        bias: 'right',
      });

      expect(paragraphTextOf(next, paragraphId)).toBe('XB');
      expect(textUnder(findById(next.root, wrapperId)!)).toBe('XB');
      expect(textUnder(findById(next.root, runId)!)).toBe('XB');
    }
  );

  test.each(neutralBiasWrappers)(
    'an unowned insert before a %s inherits the left run formatting',
    (name) => {
      // The minted run sits right after `A`, so the left run still wins its formatting; a
      // bare run would come out unformatted next to the text it continues.
      const bold = '<w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t></w:r>';
      const original = load(`<w:p>${bold}${wrapper(name, run('B'))}</w:p>`);
      const paragraphId = firstParagraph(original).id;
      const next = apply(original, { op: 'insertText', paragraphId, offset: 1, text: 'X' });

      expect(paragraphTextOf(next, paragraphId)).toBe('AXB');
      const typed: OoxmlNode[] = [];
      const collect = (node: OoxmlNode): void => {
        if (node.kind === 'textValue') return;
        if (node.localName === 'r' && textUnder(node) === 'X') typed.push(node);
        for (const child of node.children) collect(child);
      };
      collect(firstParagraph(next));
      expect(typed).toHaveLength(1);
      expect(
        typed[0]!.kind !== 'textValue' &&
          typed[0]!.children.some((child) => child.kind === 'runProperties')
      ).toBe(true);
    }
  );

  test.each(neutralBiasWrappers)(
    'a TRACKED right-biased insert reaches a %s after a preceding run',
    (name) => {
      // The offset is both the end of `A` and the start of the wrapper. Validation resolves
      // the wrapper as the destination, so the tracked insertion must land there too, not in
      // the run on the left.
      const original = load(`<w:p>${run('A')}${wrapper(name, run('B'))}</w:p>`);
      const paragraphId = firstParagraph(original).id;
      const wrapperId = firstNamed(original, name).id;
      const next = apply(original, {
        op: 'insertText',
        paragraphId,
        offset: 1,
        text: 'X',
        bias: 'right',
        revision: { author: 'Ada', date: '2026-09-05T00:00:00Z' },
      });

      expect(paragraphTextOf(next, paragraphId)).toBe('AXB');
      expect(textUnder(findById(next.root, wrapperId)!)).toBe('XB');
    }
  );

  test.each(neutralBiasWrappers)(
    'default bias stays outside a paragraph-initial %s edge',
    (name) => {
      const original = load(`<w:p>${wrapper(name, run('B'))}</w:p>`);
      const paragraphId = firstParagraph(original).id;
      const wrapperId = firstNamed(original, name).id;
      const next = apply(original, {
        op: 'insertText',
        paragraphId,
        offset: 0,
        text: 'X',
      });
      const paragraph = firstParagraph(next);
      const wrapperIndex = paragraph.children.findIndex((child) => child.id === wrapperId);

      expect(paragraphTextOf(next, paragraphId)).toBe('XB');
      expect(textUnder(findById(next.root, wrapperId)!)).toBe('B');
      expect(wrapperIndex).toBeGreaterThan(0);
    }
  );

  const internalBoundaries = [
    {
      name: 'hyperlink',
      xml: `<w:hyperlink w:anchor="target">${run('A')}${run('B')}</w:hyperlink>`,
      owner: 'hyperlink',
    },
    {
      name: 'smartTag',
      xml: wrapper('smartTag', `${run('A')}${run('B')}`),
      owner: 'smartTag',
    },
    {
      name: 'nested smartTag/customXml',
      xml: wrapper('smartTag', wrapper('customXml', `${run('A')}${run('B')}`)),
      owner: 'customXml',
    },
  ] as const;

  for (const sample of internalBoundaries) {
    test(`an internal run boundary stays inside ${sample.name}`, () => {
      const original = load(`<w:p>${sample.xml}</w:p>`);
      const paragraphId = firstParagraph(original).id;
      const next = apply(original, {
        op: 'insertText',
        paragraphId,
        offset: 1,
        text: 'X',
      });

      expect(paragraphTextOf(next, paragraphId)).toBe('AXB');
      expect(textUnder(firstNamed(next, sample.owner))).toBe('AXB');
    });
  }

  test('an unowned tracked insertion still creates its own revision', () => {
    const original = load(`<w:p><w:ins w:id="7" w:author="Prior">${run('B')}</w:ins></w:p>`);
    const paragraphId = firstParagraph(original).id;
    const priorId = firstNamed(original, 'ins').id;
    const next = apply(original, {
      op: 'insertText',
      paragraphId,
      offset: 1,
      text: 'X',
      revision: { author: 'New' },
    });

    expect(paragraphTextOf(next, paragraphId)).toBe('BX');
    expect(textUnder(findById(next.root, priorId)!)).toBe('B');
    expect(serializeOoxmlPart(next).match(/<w:ins/g)).toHaveLength(2);
  });

  test('comment range markers land inside a smartTag', () => {
    const original = load(`<w:p>${wrapper('smartTag', run('inside'))}</w:p>`);
    const paragraphId = firstParagraph(original).id;
    const started = apply(original, {
      op: 'insertCommentMarker',
      paragraphId,
      offset: 1,
      commentId: '7',
      marker: 'start',
    });
    const ended = apply(started, {
      op: 'insertCommentMarker',
      paragraphId,
      offset: 5,
      commentId: '7',
      marker: 'end',
    });
    const names: string[] = [];
    const collect = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      names.push(node.localName);
      for (const child of node.children) collect(child);
    };
    collect(firstNamed(ended, 'smartTag'));
    expect(names).toContain('commentRangeStart');
    expect(names).toContain('commentRangeEnd');
  });

  test('a paragraph split copies smartTag properties onto both halves', () => {
    const original = load(
      `<w:p><w:smartTag><w:smartTagPr w:uri="urn:test"/>${run('word')}</w:smartTag></w:p>`
    );
    const split = apply(original, {
      op: 'splitParagraph',
      paragraphId: firstParagraph(original).id,
      offset: 2,
    });
    const xml = serializeOoxmlPart(split);
    expect(xml.match(/<w:smartTagPr/g)).toHaveLength(2);
    expect(xml.match(/<w:smartTag>/g)).toHaveLength(2);
    const reopened = readOoxmlPart(xml, {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(serializeOoxmlPart(reopened.part)).toBe(xml);
  });

  test('a multi-split copies customXml properties onto every result', () => {
    const original = load(`<w:p><w:customXml><w:customXmlPr/>${run('abcdef')}</w:customXml></w:p>`);
    const split = apply(original, {
      op: 'splitParagraphMany',
      paragraphId: firstParagraph(original).id,
      offsets: [2, 4],
    });
    const xml = serializeOoxmlPart(split);
    expect(xml.match(/<w:customXmlPr/g)).toHaveLength(3);
    expect(xml.match(/<w:customXml>/g)).toHaveLength(3);
  });

  const simpleField = '<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>';

  test('a single split separates a runless field from following wrapper text', () => {
    const original = load(`<w:p>${wrapper('smartTag', `${simpleField}${run('B')}`)}</w:p>`);
    const split = apply(original, {
      op: 'splitParagraph',
      paragraphId: firstParagraph(original).id,
      offset: 1,
    });
    const paragraphs = paragraphsOf(split);

    expect(paragraphs).toHaveLength(2);
    expect(paragraphTextOf(split, paragraphs[0]!.id)).toBe('\uFFFC');
    expect(paragraphTextOf(split, paragraphs[1]!.id)).toBe('B');
    expect(containsNamed(paragraphs[0]!, 'fldSimple')).toBe(true);
    expect(containsNamed(paragraphs[1]!, 'fldSimple')).toBe(false);
  });

  test('a many-split distributes a runless field and wrapper text by model offset', () => {
    const original = load(`<w:p>${wrapper('smartTag', `${simpleField}${run('AB')}`)}</w:p>`);
    const split = apply(original, {
      op: 'splitParagraphMany',
      paragraphId: firstParagraph(original).id,
      offsets: [1, 2],
    });
    const paragraphs = paragraphsOf(split);

    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.map((paragraph) => paragraphTextOf(split, paragraph.id))).toEqual([
      '\uFFFC',
      'A',
      'B',
    ]);
    expect(containsNamed(paragraphs[0]!, 'fldSimple')).toBe(true);
    expect(containsNamed(paragraphs[1]!, 'fldSimple')).toBe(false);
    expect(containsNamed(paragraphs[2]!, 'fldSimple')).toBe(false);
  });

  test('an insertion before a wrapper-leading runless field succeeds outside the wrapper', () => {
    const original = load(`<w:p>${wrapper('smartTag', `${simpleField}${run('B')}`)}</w:p>`);
    const paragraphId = firstParagraph(original).id;
    const wrapperId = firstNamed(original, 'smartTag').id;
    const result = applyTreeOp(original, { op: 'insertText', paragraphId, offset: 0, text: 'X' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(paragraphTextOf(result.part, paragraphId)).toBe('X\uFFFCB');
    expect(containsNamed(findById(result.part.root, wrapperId)!, 'fldSimple')).toBe(true);
    expect(firstParagraph(result.part).children[0]?.kind).toBe('run');
  });

  test('a tracked right-biased insertion follows validation into a leading smartTag', () => {
    const original = load(`<w:p>${wrapper('smartTag', run('B'))}</w:p>`);
    const paragraphId = firstParagraph(original).id;
    const wrapperId = firstNamed(original, 'smartTag').id;
    const op: TreeDocOp = {
      op: 'insertText',
      paragraphId,
      offset: 0,
      text: 'X',
      bias: 'right',
      revision: { author: 'Reviewer' },
    };

    expect(validateTreeOp(original, op)).toBeNull();
    const result = applyTreeOp(original, op);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updatedWrapper = findById(result.part.root, wrapperId)!;
    expect(paragraphTextOf(result.part, paragraphId)).toBe('XB');
    expect(textUnder(updatedWrapper)).toBe('XB');
    expect(containsNamed(updatedWrapper, 'ins')).toBe(true);
  });

  test('all four wrappers survive a normalized serialize and reopen round trip', () => {
    let content = '';
    for (const name of WRAPPERS) content += wrapper(name, run(name));
    const original = load(`<w:p>${content}</w:p>`);
    const serialized = serializeOoxmlPart(original);
    for (const name of WRAPPERS) expect(serialized).toContain(`<w:${name}>`);

    const reopened = readOoxmlPart(serialized, {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(serializeOoxmlPart(reopened.part)).toBe(serialized);
    expect(canonicalOoxmlFingerprint(reopened.part)).toBe(canonicalOoxmlFingerprint(original));
    expect(
      diffSemanticDigests(semanticDigest([original]), semanticDigest([reopened.part]))
    ).toEqual([]);
    const paragraph = firstParagraph(reopened.part);
    expect(paragraphTextOf(reopened.part, paragraph.id)).toBe('smartTagcustomXmldirbdo');
  });
});

describe('inline wrapper review regressions', () => {
  for (const name of WRAPPERS) {
    test(`${name} cannot be named as an insertion owner`, () => {
      const original = load(`<w:p>${wrapper(name, run('AB'))}</w:p>`);
      const paragraphId = firstParagraph(original).id;
      const inside = firstNamed(original, name).id;
      const ops: TreeDocOp[] = [{ op: 'insertText', paragraphId, offset: 1, text: 'X', inside }];
      for (const op of ops) {
        expect(validateTreeOp(original, op)).toBe('not-a-content-control');
        expect(applyTreeOp(original, op).ok).toBe(false);
      }
    });

    test.each(['', '<w:lock w:val="contentLocked"/>'])(
      `${name} preserves control edge deletion (%s)`,
      (lock) => {
        const original = load(
          `<w:p>${run('L')}<w:sdt><w:sdtPr><w:text/>${lock}</w:sdtPr><w:sdtContent>${wrapper(name, run('chip'))}</w:sdtContent></w:sdt>${run('R')}</w:p>`
        );
        const paragraph = firstParagraph(original);
        const control = firstNamed(original, 'sdt');
        const span = { controlId: control.id, start: 1, end: 5 };
        expect(inlineControlStartingAt(paragraph, 1)).toEqual(span);
        expect(inlineControlEndingAt(paragraph, 5)).toEqual(span);
        const next = apply(original, {
          op: 'removeContentControl',
          controlId: control.id,
          keepContent: false,
        });
        expect(paragraphTextOf(next, paragraph.id)).toBe('LR');
      }
    );

    test.each([false, true])(
      `${name} retracts with its author's insertion (properties=%s)`,
      (properties) => {
        const metadata =
          properties && (name === 'smartTag' || name === 'customXml') ? `<w:${name}Pr/>` : '';
        const original = load(
          `<w:p><w:ins w:id="7" w:author="A">${wrapper(name, metadata + run('word'))}</w:ins></w:p>`
        );
        const paragraphId = firstParagraph(original).id;
        const next = apply(original, {
          op: 'deleteText',
          paragraphId,
          start: 0,
          end: 4,
          revision: { author: 'A' },
        });
        expect(paragraphTextOf(next, paragraphId)).toBe('');
        expect(containsNamed(next.root, 'ins')).toBe(false);
        expect(containsNamed(next.root, name)).toBe(false);
      }
    );

    test.each(['hyperlink', 'sdt'])(`${name} exit inherits left formatting within %s`, (owner) => {
      const bold = '<w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t></w:r>';
      const content = wrapper(name, bold) + run('B');
      const xml =
        owner === 'sdt'
          ? `<w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`
          : `<w:hyperlink w:anchor="target">${content}</w:hyperlink>`;
      const original = load(`<w:p>${xml}</w:p>`);
      const paragraphId = firstParagraph(original).id;
      const next = apply(original, { op: 'insertText', paragraphId, offset: 1, text: 'X' });
      expect(paragraphTextOf(next, paragraphId)).toBe('AXB');
      expect(textUnder(firstNamed(next, name))).toBe('A');
      const holder = firstNamed(next, owner === 'sdt' ? 'sdtContent' : 'hyperlink');
      const inserted = holder.children[1]!;
      expect(inserted.kind).toBe('run');
      expect(textUnder(inserted)).toBe('X');
      expect(containsNamed(inserted, 'b')).toBe(true);
    });
  }
});

test.each(['hyperlink', ...WRAPPERS])(
  'new boundary runs escape a deletion containing %s',
  (name) => {
    const deleted = (value: string) => `<w:r><w:delText>${value}</w:delText></w:r>`;
    const part = load(
      `<w:p><w:del w:id="7" w:author="Prior">${deleted('A')}<w:${name}>${deleted('B')}</w:${name}></w:del></w:p>`
    );
    const paragraphId = firstParagraph(part).id;
    for (const op of [
      { op: 'insertText', paragraphId, offset: 1, text: 'X' },
      { op: 'insertTab', paragraphId, offset: 1 },
      { op: 'insertHardBreak', paragraphId, offset: 1 },
    ] satisfies TreeDocOp[]) {
      const next = apply(part, op);
      expect(textUnder(firstNamed(next, 'del'))).toBe('AB');
      const accepted = apply(next, { op: 'acceptAllRevisions' });
      expect(paragraphTextOf(accepted, paragraphId)).toBe(
        op.op === 'insertText' ? 'X' : op.op === 'insertTab' ? '\t' : '\n'
      );
    }
  }
);

test.each(WRAPPERS)('runless atom boundaries inside %s accept insertions', (name) => {
  const math =
    '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x</m:t></m:r></m:oMath>';
  const original = load(`<w:p>${wrapper(name, math + math)}</w:p>`);
  const paragraphId = firstParagraph(original).id;
  expect(paragraphTextOf(original, paragraphId)).toBe('\u{fffc}\u{fffc}');
  for (const op of [
    { op: 'insertText', paragraphId, offset: 1, text: 'X' },
    { op: 'insertTab', paragraphId, offset: 1 },
    { op: 'insertHardBreak', paragraphId, offset: 1 },
  ] satisfies TreeDocOp[]) {
    expect(validateTreeOp(original, op)).toBeNull();
    const next = apply(original, op);
    const inserted = op.op === 'insertText' ? 'X' : op.op === 'insertTab' ? '\t' : '\n';
    expect(paragraphTextOf(next, paragraphId)).toBe(`\u{fffc}${inserted}\u{fffc}`);
    const holder = firstNamed(next, name);
    expect(holder.children.map((node) => node.kind)).toEqual(['generic', 'run', 'generic']);
  }
});
