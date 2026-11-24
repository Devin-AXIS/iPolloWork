// An insertion at the outer edge of an inline content control that typing can never enter —
// content-locked, data-bound, a checkbox or a picture — lands BESIDE the control (#1121).
//
// The invariant every point-insert op must keep at such an edge: either the op is refused, or
// the control's own content is exactly what it was. Validation and application resolve the
// landing through one rule, so a write the validator allowed can never reach inside.

import { describe, expect, test } from 'bun:test';
import {
  bodyStoryRoot,
  contentControlTextOf,
  contentControlsIn,
  readOoxmlPart,
  storyParagraphs,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlParagraphNode,
} from '../index.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import type { TreeDocOp } from '../store/tree-op-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${bodyInner}</w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstParagraph(part: OoxmlPart): OoxmlParagraphNode {
  const found = storyParagraphs(bodyStoryRoot(part)!)[0];
  if (!found || found.kind !== 'paragraph') throw new Error('no paragraph');
  return found;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return node.children.map(textOf).join('');
}

/** Each control's own text, in document order. */
function controlTexts(part: OoxmlPart): string[] {
  return contentControlsIn(part.root)
    .filter((entry) => entry.ancestors.length === 0)
    .map((entry) => contentControlTextOf(entry.node));
}

/** The property children that make a control refuse typing, by kind. */
const RESTRICTED: Record<string, string> = {
  contentLocked: '<w:lock w:val="contentLocked"/>',
  sdtContentLocked: '<w:lock w:val="sdtContentLocked"/>',
  dataBinding: '<w:dataBinding w:xpath="/a" w:storeItemID="{G}"/>',
  checkbox: '<w14:checkbox><w14:checked w14:val="0"/></w14:checkbox>',
  picture: '<w:picture/>',
};

const control = (properties: string, held: string): string =>
  `<w:sdt><w:sdtPr>${properties}</w:sdtPr>` +
  `<w:sdtContent><w:r><w:t>${held}</w:t></w:r></w:sdtContent></w:sdt>`;
const run = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const ins = (inner: string): string =>
  `<w:ins w:id="9" w:author="A" w:date="2026-01-01T00:00:00Z">${inner}</w:ins>`;
const link = (inner: string): string => `<w:hyperlink w:anchor="target">${inner}</w:hyperlink>`;

/** Paragraph layouts that put a restricted control's edge at `offset`. */
function layouts(properties: string) {
  return [
    { name: 'at the paragraph start', body: control(properties, 'CC') + run(' z'), offset: 0 },
    { name: 'alone in the paragraph', body: control(properties, 'CC'), offset: 0 },
    { name: 'after text', body: run('ab') + control(properties, 'CC'), offset: 2 },
    {
      name: 'between two controls',
      body: control(properties, 'CC') + control(properties, 'DD'),
      offset: 2,
    },
    { name: 'at the trailing edge', body: run('ab') + control(properties, 'CC'), offset: 4 },
    // A tracked insertion of a chip writes exactly this shape.
    {
      name: 'inside w:ins at the paragraph start',
      body: ins(control(properties, 'CC')),
      offset: 0,
    },
    {
      name: 'inside w:ins after text',
      body: run('ab') + ins(control(properties, 'CC')),
      offset: 2,
    },
    {
      name: 'between two w:ins chips',
      body: ins(control(properties, 'CC')) + ins(control(properties, 'DD')),
      offset: 2,
    },
    { name: 'inside a hyperlink', body: link(control(properties, 'CC')), offset: 0 },
  ];
}

const FRAGMENT = firstParagraph(parseDoc(`<w:p>${run('frag')}</w:p>`));

const POINT_OPS: readonly [string, (paragraphId: string, offset: number) => TreeDocOp][] = [
  ['insertText', (paragraphId, offset) => ({ op: 'insertText', paragraphId, offset, text: '#' })],
  [
    'insertText bias right',
    (paragraphId, offset) => ({ op: 'insertText', paragraphId, offset, text: '#', bias: 'right' }),
  ],
  ['insertTab', (paragraphId, offset) => ({ op: 'insertTab', paragraphId, offset })],
  ['insertHardBreak', (paragraphId, offset) => ({ op: 'insertHardBreak', paragraphId, offset })],
  ['insertPageBreak', (paragraphId, offset) => ({ op: 'insertPageBreak', paragraphId, offset })],
  [
    'insertPageField',
    (paragraphId, offset) => ({ op: 'insertPageField', paragraphId, offset, field: 'PAGE' }),
  ],
  [
    'insertInlineContentControl',
    (paragraphId, offset) => ({
      op: 'insertInlineContentControl',
      paragraphId,
      offset,
      tag: 'new',
      text: 'N',
    }),
  ],
  [
    'insertFragment',
    (paragraphId, offset) => ({ op: 'insertFragment', paragraphId, offset, blocks: [FRAGMENT] }),
  ],
];

describe('an insertion at the edge of a control that typing cannot enter', () => {
  for (const [kind, properties] of Object.entries(RESTRICTED)) {
    for (const layout of layouts(properties)) {
      test(`${kind} ${layout.name}: typed text lands beside the control`, () => {
        const part = parseDoc(`<w:p>${layout.body}</w:p>`);
        const before = controlTexts(part);
        const result = applyTreeOp(part, {
          op: 'insertText',
          paragraphId: firstParagraph(part).id,
          offset: layout.offset,
          text: '#',
        });
        if (!result.ok) throw new Error(`refused: ${result.reason}`);
        expect(controlTexts(result.part)).toEqual(before);
        const text = textOf(firstParagraph(part));
        expect(textOf(firstParagraph(result.part))).toBe(
          text.slice(0, layout.offset) + '#' + text.slice(layout.offset)
        );
      });

      test(`${kind} ${layout.name}: no point insert reaches inside`, () => {
        let written = 0;
        for (const [name, build] of POINT_OPS) {
          const part = parseDoc(`<w:p>${layout.body}</w:p>`);
          const before = contentControlsIn(part.root).map(
            (entry) => [entry.node.id, contentControlTextOf(entry.node)] as const
          );
          const result = applyTreeOp(part, build(firstParagraph(part).id, layout.offset));
          if (!result.ok) continue;
          written += 1;
          // Compared by id: `insertInlineContentControl` adds a control of its own beside them.
          const after = new Map(
            contentControlsIn(result.part.root).map((entry) => [
              entry.node.id,
              contentControlTextOf(entry.node),
            ])
          );
          for (const [id, text] of before)
            expect({ name, text: after.get(id) }).toEqual({ name, text });
        }
        // Refusing every op would pass the loop above vacuously.
        expect(written).toBeGreaterThan(0);
      });
    }

    // A checkbox holds one glyph and a picture one drawing, so neither has an inside to test.
    if (kind === 'checkbox' || kind === 'picture') continue;
    test(`${kind}: an insert one character inside is still refused`, () => {
      const part = parseDoc(`<w:p>${run('ab')}${control(properties, 'CCC')}</w:p>`);
      const result = applyTreeOp(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset: 3,
        text: '#',
      });
      expect(result.ok).toBe(false);
    });
  }

  test('consecutive keystrokes before the control join one run', () => {
    let part = parseDoc(`<w:p>${control(RESTRICTED.contentLocked!, 'CC')}</w:p>`);
    for (const [offset, text] of [
      [0, 'x'],
      [1, 'y'],
    ] as const) {
      const result = applyTreeOp(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset,
        text,
      });
      if (!result.ok) throw new Error(`refused: ${result.reason}`);
      part = result.part;
    }
    const runs = firstParagraph(part).children.filter((child) => child.kind === 'run');
    expect(runs.map(textOf)).toEqual(['xy']);
  });

  test('text typed after a note reference before a chip does not join the reference run', () => {
    // The reference run is an atom: joining it would style the text as a reference, and
    // deleting the note would take the text with it.
    const part = parseDoc(
      `<w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/>` +
        `</w:rPr><w:footnoteReference w:id="1"/></w:r>` +
        control(RESTRICTED.contentLocked!, 'CC') +
        `</w:p>`
    );
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: firstParagraph(part).id,
      offset: 1,
      text: '#',
    });
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    const runs = firstParagraph(result.part).children.filter((child) => child.kind === 'run');
    const typed = runs.find((candidate) => textOf(candidate) === '#');
    expect(typed).toBeDefined();
    const names = (node: OoxmlNode): string[] =>
      node.kind === 'textValue'
        ? []
        : [node.kind === 'generic' ? node.localName : node.kind, ...node.children.flatMap(names)];
    expect(names(typed!).some((name) => name === 'footnoteReference')).toBe(false);
    expect(controlTexts(result.part)).toEqual(['CC']);
  });

  test('tracked typing at a chip edge is a proposal beside the chip', () => {
    for (const offset of [0, 2]) {
      const part = parseDoc(
        `<w:p>${control(RESTRICTED.contentLocked!, 'CC')}${control(RESTRICTED.dataBinding!, 'DD')}</w:p>`
      );
      const result = applyTreeOp(part, {
        op: 'insertText',
        paragraphId: firstParagraph(part).id,
        offset,
        text: '#',
        revision: { author: 'A', date: '2026-01-01T00:00:00Z' },
      });
      if (!result.ok) throw new Error(`refused: ${result.reason}`);
      expect(controlTexts(result.part)).toEqual(['CC', 'DD']);
      const inserted = firstParagraph(result.part).children.find(
        (child) => child.kind === 'revisionInsert'
      );
      expect(inserted && textOf(inserted)).toBe('#');
    }
  });

  test('a text control keeps its leading edge: typing there fills it in', () => {
    const part = parseDoc(`<w:p>${control('<w:text/>', 'Name')}</w:p>`);
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: firstParagraph(part).id,
      offset: 0,
      text: '#',
    });
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    expect(controlTexts(result.part)).toEqual(['#Name']);
  });

  test('a locked control inside a text control is left, but the text control is not', () => {
    const part = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
        control(RESTRICTED.contentLocked!, 'IN') +
        `${run('out')}</w:sdtContent></w:sdt></w:p>`
    );
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: firstParagraph(part).id,
      offset: 0,
      text: '#',
    });
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    const [outer] = contentControlsIn(result.part.root);
    expect(contentControlTextOf(outer!.node)).toBe('#INout');
    const inner = contentControlsIn(result.part.root).find((entry) => entry.ancestors.length > 0);
    expect(contentControlTextOf(inner!.node)).toBe('IN');
  });
});
