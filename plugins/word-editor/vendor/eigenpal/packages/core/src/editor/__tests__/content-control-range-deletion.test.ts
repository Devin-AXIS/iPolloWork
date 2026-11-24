// SDT-aware range deletion planning.
//
// `planRangeDeletion` must unwrap fully covered typed content controls so emptied shells do
// not survive as join boundaries, treat planned unwraps as transparent for joins, leave
// controls the range does not fully cover as boundaries, and avoid double-removal when
// tables and controls nest. Lock refusal stays with the store — the planner always emits
// `removeContentControl` for a fully covered typed control.

import { describe, expect, test } from 'bun:test';
import type { SemanticLayout } from '@docx-editor.dev/core/layout';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { planRangeDeletion } from '../surface-selection-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

let nextId = 0;
function id(label: string): string {
  nextId += 1;
  return `/word/document.xml#${label}-${nextId}`;
}

function element(
  kind: string,
  localName: string,
  children: readonly OoxmlNode[],
  nodeId = id(localName)
): OoxmlElement {
  return {
    kind,
    id: nodeId,
    namespaceUri: W,
    prefix: 'w',
    localName,
    namespaceBindings: [],
    attributes: [],
    children,
  } as OoxmlElement;
}

function paragraph(text: string, nodeId = id('p')): OoxmlElement & { readonly text: string } {
  const node = element('paragraph', 'p', [], nodeId) as OoxmlElement & { text: string };
  node.text = text;
  return node;
}

function content(children: readonly OoxmlNode[]): OoxmlElement {
  return element('contentControlContent', 'sdtContent', children);
}

function control(children: readonly OoxmlNode[], nodeId = id('sdt')): OoxmlElement {
  return element('contentControl', 'sdt', [content(children)], nodeId);
}

function cell(children: readonly OoxmlNode[]): OoxmlElement {
  return element('tableCell', 'tc', children);
}

function row(children: readonly OoxmlNode[]): OoxmlElement {
  return element('tableRow', 'tr', children);
}

function table(children: readonly OoxmlNode[], nodeId = id('tbl')): OoxmlElement {
  return element('table', 'tbl', children, nodeId);
}

function body(children: readonly OoxmlNode[]): OoxmlElement {
  return element('body', 'body', children, id('body'));
}

function document(bodyNode: OoxmlElement): OoxmlElement {
  return element('document', 'document', [bodyNode], id('document'));
}

function partOf(root: OoxmlElement): OoxmlPart {
  return {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    root,
  };
}

/** Collect paragraphs in document order with their synthetic text. */
function paragraphsIn(node: OoxmlNode): Array<OoxmlElement & { text?: string }> {
  const out: Array<OoxmlElement & { text?: string }> = [];
  const walk = (current: OoxmlNode): void => {
    if (current.kind === 'textValue') return;
    if (current.kind === 'paragraph') out.push(current as OoxmlElement & { text?: string });
    for (const child of current.children) walk(child);
  };
  walk(node);
  return out;
}

function layoutFor(root: OoxmlElement): SemanticLayout {
  const paragraphs = paragraphsIn(root);
  return {
    revision: 0,
    pages: [
      {
        index: 0,
        box: { x: 0, y: 0, width: 612, height: 792 },
        contentBox: { x: 72, y: 72, width: 468, height: 648 },
        fragments: paragraphs.map((p, index) => {
          const text = p.text ?? '';
          return {
            kind: 'paragraph' as const,
            id: `frag-${p.id}`,
            paragraphId: p.id,
            fragmentIndex: 0,
            range: { paragraphId: p.id, start: 0, end: text.length },
            props: [],
            spacing: { before: 0, after: 0, line: 1, lineRule: 'auto' as const },
            indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
            box: { x: 72, y: 72 + index * 20, width: 468, height: 16 },
            lines: [
              {
                id: `line-${p.id}`,
                range: { paragraphId: p.id, start: 0, end: text.length },
                spans:
                  text.length === 0
                    ? []
                    : [
                        {
                          text,
                          range: { paragraphId: p.id, start: 0, end: text.length },
                          box: { x: 72, y: 72 + index * 20, width: text.length * 7, height: 16 },
                          style: {
                            fontFamily: 'Times New Roman',
                            fontSize: 12,
                            bold: false,
                            italic: false,
                            underline: null,
                            strike: false,
                            color: '#000000',
                            highlight: null,
                            vertAlign: 'baseline' as const,
                          },
                        },
                      ],
                box: { x: 72, y: 72 + index * 20, width: 468, height: 16 },
                baseline: 12,
                leading: 0,
              },
            ],
          };
        }),
      },
    ],
  } as SemanticLayout;
}

function opsOf(plan: ReturnType<typeof planRangeDeletion>) {
  return plan.ops as ReadonlyArray<{ readonly op: string; readonly [key: string]: unknown }>;
}

function byOp(plan: ReturnType<typeof planRangeDeletion>, op: string) {
  return opsOf(plan).filter((entry) => entry.op === op);
}

describe('planRangeDeletion with typed content controls', () => {
  test('fully covered block control is unwrapped and joins across it', () => {
    const head = paragraph('head');
    const inner = paragraph('inner');
    const tail = paragraph('tail');
    const sdt = control([inner]);
    const root = document(body([head, sdt, tail]));
    const part = partOf(root);
    const layout = layoutFor(root);

    const plan = planRangeDeletion(
      layout,
      part,
      { paragraphId: head.id, offset: 0 },
      { paragraphId: tail.id, offset: 4 }
    );

    expect(byOp(plan, 'removeContentControl')).toEqual([
      { op: 'removeContentControl', controlId: sdt.id },
    ]);
    expect(byOp(plan, 'deleteText')).toEqual([
      { op: 'deleteText', paragraphId: head.id, start: 0, end: 4 },
      { op: 'deleteText', paragraphId: inner.id, start: 0, end: 5 },
      { op: 'deleteText', paragraphId: tail.id, start: 0, end: 4 },
    ]);
    expect(byOp(plan, 'joinParagraphs')).toEqual([
      { op: 'joinParagraphs', firstId: head.id, secondId: inner.id },
      { op: 'joinParagraphs', firstId: head.id, secondId: tail.id },
    ]);
    expect(plan.collapseTo).toEqual({ paragraphId: head.id, offset: 0 });
  });

  test('a control the range does not fully cover stays a join boundary', () => {
    const before = paragraph('before');
    const kept = paragraph('kept');
    const partial = paragraph('partial');
    // Control holds kept + partial; range covers before..partial but ends mid-partial, so the
    // control is not fully covered and must not be unwrapped.
    const sdt = control([kept, partial]);
    const root = document(body([before, sdt, paragraph('after')]));
    const part = partOf(root);
    const layout = layoutFor(root);

    const plan = planRangeDeletion(
      layout,
      part,
      { paragraphId: before.id, offset: 0 },
      { paragraphId: partial.id, offset: 4 }
    );

    expect(byOp(plan, 'removeContentControl')).toEqual([]);
    // `before` (body) and `kept` (inside the surviving control) do not join across the wrapper.
    // Inside the control, fully-covered `kept` can still join onto the trimmed `partial`.
    expect(byOp(plan, 'joinParagraphs')).toEqual([
      { op: 'joinParagraphs', firstId: kept.id, secondId: partial.id },
    ]);
    expect(byOp(plan, 'deleteText')).toEqual([
      { op: 'deleteText', paragraphId: before.id, start: 0, end: 6 },
      { op: 'deleteText', paragraphId: kept.id, start: 0, end: 4 },
      { op: 'deleteText', paragraphId: partial.id, start: 0, end: 4 },
    ]);
  });

  test('fully covered control is always planned for unwrap; lock refusal is store-side', () => {
    const first = paragraph('one');
    const second = paragraph('two');
    const sdt = control([first, second]);
    const root = document(body([sdt]));
    const part = partOf(root);
    const layout = layoutFor(root);

    const plan = planRangeDeletion(
      layout,
      part,
      { paragraphId: first.id, offset: 0 },
      { paragraphId: second.id, offset: 3 }
    );

    // Even if the control declared sdtLocked / sdtContentLocked, planning still emits the
    // unwrap — the store refuses the atomic transaction. No lock bit is read here.
    expect(byOp(plan, 'removeContentControl')).toEqual([
      { op: 'removeContentControl', controlId: sdt.id },
    ]);
    expect(byOp(plan, 'joinParagraphs')).toEqual([
      { op: 'joinParagraphs', firstId: first.id, secondId: second.id },
    ]);
  });

  test('nested fully covered controls are each unwrapped', () => {
    const head = paragraph('a');
    const inner = paragraph('b');
    const tail = paragraph('c');
    const innerControl = control([inner]);
    const outerControl = control([innerControl]);
    const root = document(body([head, outerControl, tail]));
    const part = partOf(root);
    const layout = layoutFor(root);

    const plan = planRangeDeletion(
      layout,
      part,
      { paragraphId: head.id, offset: 0 },
      { paragraphId: tail.id, offset: 1 }
    );

    const removals = byOp(plan, 'removeContentControl').map((op) => op.controlId);
    expect(new Set(removals)).toEqual(new Set([outerControl.id, innerControl.id]));
    expect(byOp(plan, 'joinParagraphs')).toEqual([
      { op: 'joinParagraphs', firstId: head.id, secondId: inner.id },
      { op: 'joinParagraphs', firstId: head.id, secondId: tail.id },
    ]);
  });

  test('table inside a fully covered control is deleted and the control unwrapped once', () => {
    const head = paragraph('head');
    const cellA = paragraph('A1');
    const cellB = paragraph('B1');
    const tbl = table([row([cell([cellA]), cell([cellB])])]);
    const sdt = control([tbl]);
    const tail = paragraph('tail');
    const root = document(body([head, sdt, tail]));
    const part = partOf(root);
    const layout = layoutFor(root);

    const plan = planRangeDeletion(
      layout,
      part,
      { paragraphId: head.id, offset: 0 },
      { paragraphId: tail.id, offset: 4 }
    );

    expect(byOp(plan, 'deleteBlock')).toEqual([{ op: 'deleteBlock', blockId: tbl.id }]);
    expect(byOp(plan, 'removeContentControl')).toEqual([
      { op: 'removeContentControl', controlId: sdt.id },
    ]);
    expect(byOp(plan, 'deleteText').map((op) => op.paragraphId)).toEqual([head.id, tail.id]);
    expect(byOp(plan, 'joinParagraphs')).toEqual([
      { op: 'joinParagraphs', firstId: head.id, secondId: tail.id },
    ]);
  });

  test('control nested inside a fully covered table is not also unwrapped', () => {
    const head = paragraph('head');
    const inner = paragraph('cell');
    const sdt = control([inner]);
    const tbl = table([row([cell([sdt])])]);
    const tail = paragraph('tail');
    const root = document(body([head, tbl, tail]));
    const part = partOf(root);
    const layout = layoutFor(root);

    const plan = planRangeDeletion(
      layout,
      part,
      { paragraphId: head.id, offset: 0 },
      { paragraphId: tail.id, offset: 4 }
    );

    expect(byOp(plan, 'deleteBlock')).toEqual([{ op: 'deleteBlock', blockId: tbl.id }]);
    expect(byOp(plan, 'removeContentControl')).toEqual([]);
    expect(byOp(plan, 'joinParagraphs')).toEqual([
      { op: 'joinParagraphs', firstId: head.id, secondId: tail.id },
    ]);
  });

  test('tables without content controls are unchanged', () => {
    const head = paragraph('head');
    const cellA = paragraph('A');
    const cellB = paragraph('B');
    const tbl = table([row([cell([cellA]), cell([cellB])])]);
    const tail = paragraph('tail');
    const root = document(body([head, tbl, tail]));
    const part = partOf(root);
    const layout = layoutFor(root);

    const plan = planRangeDeletion(
      layout,
      part,
      { paragraphId: head.id, offset: 0 },
      { paragraphId: tail.id, offset: 4 }
    );

    expect(byOp(plan, 'removeContentControl')).toEqual([]);
    expect(byOp(plan, 'deleteBlock')).toEqual([{ op: 'deleteBlock', blockId: tbl.id }]);
    expect(byOp(plan, 'joinParagraphs')).toEqual([
      { op: 'joinParagraphs', firstId: head.id, secondId: tail.id },
    ]);
  });
});
