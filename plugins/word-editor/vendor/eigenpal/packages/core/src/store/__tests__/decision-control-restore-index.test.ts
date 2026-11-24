// A tracked-change decision restores the placeholder of each content control it emptied. The
// controls come from the part before the decision, found through its node index, and each
// decision makes a new part. In a long document without any control, building that index for
// every decision was most of a single decision's store time.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import { findNode, nodeIndexTestRecorder, parentNodeOf } from '../package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import {
  holdsContent,
  restoreDecisionEmptiedControls,
  restoreEmptiedPlaceholder,
} from '../store/content-control-prompt-restore.ts';
import { isInlineControl } from '../store/content-control-checkbox.ts';
import { contentControlContentOf, findContentControl } from '../store/tree-op-nodes.ts';
import type { TreeOpEffect, TreeOpResult } from '../store/tree-op-types.ts';
import { MAX_INLINE_CONTAINER_DEPTH } from '../package/ooxml-shared.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const STAMP = 'w:id="1" w:author="Ada" w:date="2026-01-01T00:00:00Z"';

function partOf(body: string): OoxmlPart {
  const read = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
      ),
    })
  );
  if (!read.ok) throw new Error(read.reason);
  return read.package.parts.get('/word/document.xml')!;
}

/** The id of the first `w:ins` in the part. */
function insertionId(part: OoxmlPart): string {
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.localName === 'ins') return node.id;
    stack.push(...node.children);
  }
  throw new Error('no insertion');
}

const inserted = `<w:ins ${STAMP}><w:r><w:t>added</w:t></w:r></w:ins>`;

/** Every node of the part, depth first, for reading what a restore wrote. */
function nodesOf(part: OoxmlPart): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    out.push(node);
    if (node.kind !== 'textValue') stack.push(...node.children);
  }
  return out;
}

const control = (content: string) =>
  `<w:sdt><w:sdtPr><w:text/></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

describe('restoring controls after a decision', () => {
  test('reads no node index when the part holds no content control', () => {
    const before = partOf(`<w:p><w:r><w:t>Plain </w:t></w:r>${inserted}</w:p>`);
    const after = partOf('<w:p><w:r><w:t>Plain </w:t></w:r></w:p>');
    const recorder = nodeIndexTestRecorder();
    recorder.reset();
    expect(restoreDecisionEmptiedControls(before, [insertionId(before)], after)).toBe(after);
    expect(recorder.completeBuilds).toBe(0);
  });

  test('reads no node index when the decision is away from the only control', () => {
    const kept = control('<w:r><w:t>Value</w:t></w:r>');
    const before = partOf(`<w:p>${kept}</w:p><w:p><w:r><w:t>Plain </w:t></w:r>${inserted}</w:p>`);
    const after = partOf(`<w:p>${kept}</w:p><w:p><w:r><w:t>Plain </w:t></w:r></w:p>`);
    const recorder = nodeIndexTestRecorder();
    recorder.reset();
    expect(restoreDecisionEmptiedControls(before, [insertionId(before)], after)).toBe(after);
    expect(recorder.completeBuilds).toBe(0);
  });

  test('reads no node index when a block control wraps the whole body', () => {
    const before = partOf(control(`<w:p><w:r><w:t>Plain </w:t></w:r>${inserted}</w:p>`));
    const after = partOf(control('<w:p><w:r><w:t>Plain </w:t></w:r></w:p>'));
    const recorder = nodeIndexTestRecorder();
    recorder.reset();
    // A block-level control keeps no placeholder, so nothing changes.
    expect(restoreDecisionEmptiedControls(before, [insertionId(before)], after)).toBe(after);
    expect(recorder.completeBuilds).toBe(0);
  });

  test('restores the placeholder of a control the decision emptied', () => {
    // The control: a decision inside a control still finds it and writes its placeholder.
    const before = partOf(`<w:p>${control(inserted)}</w:p>`);
    const after = partOf(`<w:p>${control('')}</w:p>`);
    const restored = restoreDecisionEmptiedControls(before, [insertionId(before)], after);
    expect(restored).not.toBe(after);
    expect(
      nodesOf(restored).some((n) => n.kind !== 'textValue' && n.localName === 'showingPlcHdr')
    ).toBe(true);
  });
});

/**
 * The restore as it was before the single walk: the controls around each decided change and the
 * ones it held, looked up by id, in the order of the decided ids. The order decides which node
 * ids the placeholders get, and collaborating peers on either version must agree on them.
 */
function restoredBefore(before: OoxmlPart, decidedIds: readonly string[], after: OoxmlPart) {
  const controls = new Set<string>();
  const inside = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > MAX_INLINE_CONTAINER_DEPTH) return;
    if (node.kind === 'contentControl') controls.add(node.id);
    for (const child of node.children) inside(child, depth + 1);
  };
  for (const id of decidedIds) {
    for (let node = parentNodeOf(before, id); node; node = parentNodeOf(before, node.id))
      if (node.kind === 'contentControl') controls.add(node.id);
    const decided = findNode(before, id);
    if (decided) inside(decided, 0);
  }
  let result: TreeOpResult = { ok: true, part: after, effect: {} as TreeOpEffect };
  for (const id of controls) {
    if (!isInlineControl(before, id)) continue;
    const control = findContentControl(before, id);
    const content = control && contentControlContentOf(control);
    if (!content || !holdsContent(content, 0)) continue;
    result = restoreEmptiedPlaceholder(result, id, undefined, '     ');
  }
  return result.ok ? result.part : after;
}

/** Every `w:ins` id of the part, in document order. */
function insertionIds(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'ins') ids.push(node.id);
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return ids;
}

describe('the order controls are restored in', () => {
  const nested = control(`<w:r><w:t>a</w:t></w:r>${control(inserted)}`);
  const body =
    `<w:p>${control(inserted)}<w:r><w:t> between </w:t></w:r>${nested}</w:p>` +
    `<w:p>${control(inserted)}</w:p>`;
  const before = partOf(body);
  // A fresh part per restore: the id allocator counts on from its part's earlier allocations.
  const after = () =>
    partOf(
      `<w:p>${control('')}<w:r><w:t> between </w:t></w:r>${control(`<w:r><w:t>a</w:t></w:r>${control('')}`)}</w:p>` +
        `<w:p>${control('')}</w:p>`
    );
  const ids = insertionIds(before);
  const orders = [ids, [...ids].reverse(), [ids[1]!, ids[2]!, ids[0]!]];
  for (const order of orders)
    test(`matches the lookup by id for decisions in order ${order.map((id) => ids.indexOf(id)).join(',')}`, () => {
      expect(JSON.stringify(restoreDecisionEmptiedControls(before, order, after()).root)).toBe(
        JSON.stringify(restoredBefore(before, order, after()).root)
      );
    });
});
