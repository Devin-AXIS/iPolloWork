import { describe, expect, test } from 'bun:test';
import {
  collectOwnerAnchorStates,
  collectOwnerCommentSpans,
  createCommentScanBudget,
} from '../package/comment-lifecycle-scan.ts';
import { isLegacyVmlAtom } from '../package/legacy-vml-projection.ts';
import { canonicalOoxmlFingerprint, readOoxmlPart, type OoxmlNode } from '../package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/tree-op-segments.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const PICTURE = '<w:pict><v:rect style="width:100pt;height:100pt" stroked="f"/></w:pict>';
const START = '<w:commentRangeStart w:id="1"/>';
const END = '<w:commentRangeEnd w:id="1"/>';

function parse(content: string) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:v="${V}"><w:body><w:p>${content}</w:p></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const body = parsed.part.root.children.find((node) => node.kind === 'body');
  if (!body || body.kind === 'textValue') throw new Error('missing body');
  const paragraph = body.children.find((node) => node.kind === 'paragraph');
  if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('missing paragraph');
  return { part: parsed.part, paragraph };
}

function pictureIn(root: OoxmlNode): OoxmlNode {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.localName === 'pict') return node;
    for (const child of node.children) stack.push(child);
  }
  throw new Error('missing picture');
}

describe('VML comment offsets share the drawing atom model', () => {
  test('a comment around a supported picture covers one model unit', () => {
    const { part, paragraph } = parse(`${START}<w:r>${PICTURE}</w:r>${END}`);
    expect(isLegacyVmlAtom(pictureIn(paragraph))).toBe(true);
    const before = canonicalOoxmlFingerprint(part);
    const span = collectOwnerCommentSpans(part.root, createCommentScanBudget()).spans.get('1')!;
    expect({ start: span.startOffset, end: span.endOffset }).toEqual({ start: 0, end: 1 });
    expect(paragraphOffsetIndex(paragraph).spanOf(pictureIn(paragraph).id)).toEqual({
      start: 0,
      end: 1,
    });
    expect(collectOwnerAnchorStates(part.root, createCommentScanBudget()).states.get('1')).toEqual({
      covering: true,
      paired: true,
      anyMarker: true,
    });
    expect(canonicalOoxmlFingerprint(part)).toBe(before);
  });

  test('text after a picture keeps its UTF-16 comment range', () => {
    const { part, paragraph } = parse(
      `<w:r>${PICTURE}</w:r>${START}<w:r><w:t>A😀B</w:t></w:r>${END}`
    );
    const offsets = paragraphOffsetIndex(paragraph);
    const text = offsets.segments.find((segment) => segment.node.kind === 'textValue')!;
    expect({ start: text.start, end: text.end }).toEqual({ start: 1, end: 5 });
    const span = collectOwnerCommentSpans(part.root, createCommentScanBudget()).spans.get('1')!;
    expect({ start: span.startOffset, end: span.endOffset }).toEqual({
      start: text.start,
      end: text.end,
    });
  });

  test('counts a supported picture inside a tracked hyperlink only once', () => {
    const { part, paragraph } = parse(
      `${START}<w:ins w:id="2" w:author="test"><w:hyperlink><w:r>${PICTURE}</w:r></w:hyperlink></w:ins>${END}`
    );
    expect(paragraphOffsetIndex(paragraph).spanOf(pictureIn(paragraph).id)).toEqual({
      start: 0,
      end: 1,
    });
    const span = collectOwnerCommentSpans(part.root, createCommentScanBudget()).spans.get('1')!;
    expect({ start: span.startOffset, end: span.endOffset }).toEqual({ start: 0, end: 1 });
    expect(
      collectOwnerAnchorStates(part.root, createCommentScanBudget()).states.get('1')?.covering
    ).toBe(true);
  });

  test('an unsupported picture on the line is one placeholder unit in both offset models', () => {
    const unsupported = PICTURE.replace('width:100pt;', 'rotation:90;width:100pt;');
    const { part, paragraph } = parse(`${START}<w:r>${unsupported}</w:r>${END}`);
    expect(isLegacyVmlAtom(pictureIn(paragraph))).toBe(true);
    expect(paragraphOffsetIndex(paragraph).spanOf(pictureIn(paragraph).id)).toEqual({
      start: 0,
      end: 1,
    });
    const span = collectOwnerCommentSpans(part.root, createCommentScanBudget()).spans.get('1')!;
    expect({ start: span.startOffset, end: span.endOffset }).toEqual({ start: 0, end: 1 });
  });

  test('an unsupported floating picture stays opaque in both offset models', () => {
    const unsupported = PICTURE.replace(
      'width:100pt;',
      'position:absolute;rotation:90;width:100pt;'
    );
    const { part, paragraph } = parse(`${START}<w:r>${unsupported}</w:r>${END}`);
    expect(isLegacyVmlAtom(pictureIn(paragraph))).toBe(false);
    expect(paragraphOffsetIndex(paragraph).spanOf(pictureIn(paragraph).id)).toEqual({
      start: 0,
      end: 0,
    });
    const span = collectOwnerCommentSpans(part.root, createCommentScanBudget()).spans.get('1')!;
    expect({ start: span.startOffset, end: span.endOffset }).toEqual({ start: 0, end: 0 });
    expect(
      collectOwnerAnchorStates(part.root, createCommentScanBudget()).states.get('1')?.covering
    ).toBe(false);
  });
});

test('a framed object keeps one comment offset through transparent run wrappers', () => {
  const object =
    '<w:object xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><v:shape type="#_x0000_t75" style="width:10pt;height:56pt"><v:imagedata r:id="preview"/></v:shape></w:object>';
  const { part, paragraph } = parse(
    '<w:pPr><w:framePr w:y="-854"/></w:pPr>' +
      `<w:hyperlink><w:r>${object}</w:r></w:hyperlink>${START}<w:r><w:t>A😀B</w:t></w:r>${END}`
  );
  const span = collectOwnerCommentSpans(part.root, createCommentScanBudget()).spans.get('1')!;
  expect({ start: span.startOffset, end: span.endOffset }).toEqual({ start: 1, end: 5 });
  const text = paragraphOffsetIndex(paragraph).segments.find(
    (segment) => segment.node.kind === 'textValue'
  )!;
  expect({ start: text.start, end: text.end }).toEqual({ start: 1, end: 5 });
});
