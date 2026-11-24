import { expect, test } from 'bun:test';
import {
  bodyStoryRoot,
  paragraphTextOf,
  storyParagraphs,
  type OoxmlNode,
  type OoxmlPart,
} from '../index.ts';
import { authoredRunPropertiesAt } from '../../editor/surface-formatting.ts';
import { formattingRunAt } from '../store/direct-properties.ts';
import { ADA, apply, paragraphId, part, xml } from './tracked-edit-fixture.ts';

function reference(kind: 'footnote' | 'endnote', tail = ''): string {
  return (
    '<w:r><w:rPr><w:rStyle w:val="CustomReference"/><w:b/>' +
    '<w:color w:val="FF0000"/><w:vertAlign w:val="superscript"/></w:rPr>' +
    `<w:${kind}Reference w:id="1"/>${tail}</w:r>`
  );
}

function find(root: OoxmlNode, predicate: (node: OoxmlNode) => boolean): OoxmlNode | undefined {
  if (predicate(root)) return root;
  if (root.kind === 'textValue') return undefined;
  for (const child of root.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return undefined;
}

function paragraph(source: OoxmlPart) {
  return storyParagraphs(bodyStoryRoot(source)!)[0]!;
}

function typedRun(source: OoxmlPart): OoxmlNode {
  const run = find(
    paragraph(source),
    (node) =>
      node.kind === 'run' &&
      find(node, (child) => child.kind === 'textValue' && child.value.includes('#')) !== undefined
  );
  expect(run?.kind).toBe('run');
  return run!;
}

function named(root: OoxmlNode, name: string): boolean {
  return find(root, (node) => node.kind !== 'textValue' && node.localName === name) !== undefined;
}

const prefix = '<w:r><w:t>Text</w:t></w:r>';
for (const kind of ['footnote', 'endnote'] as const) {
  for (const tracked of [false, true]) {
    const mode = tracked ? 'tracked' : 'plain';
    for (const layout of [
      'terminal',
      'right-run',
      'shared-run',
      'wrapper-edge',
      'locked-control-edge',
    ] as const) {
      test(`${kind}: ${mode} typing after a ${layout} reference uses paragraph formatting`, () => {
        const note = reference(kind, layout === 'shared-run' ? '<w:t>tail</w:t>' : '');
        const body =
          layout === 'wrapper-edge'
            ? prefix + `<w:hyperlink w:anchor="target">${note}</w:hyperlink>`
            : prefix +
              note +
              (layout === 'right-run'
                ? '<w:r><w:rPr><w:i/></w:rPr><w:t>tail</w:t></w:r>'
                : layout === 'locked-control-edge'
                  ? '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:r><w:t>locked</w:t></w:r></w:sdtContent></w:sdt>'
                  : '');
        const before = part(`<w:p>${body}</w:p>`);
        const oldReference = find(paragraph(before), (node) => node.kind === 'noteReference');
        const after = apply(before, {
          op: 'insertText',
          paragraphId: paragraphId(before),
          offset: 5,
          text: '#',
          ...(tracked ? { revision: ADA } : {}),
        });
        const run = typedRun(after);
        for (const name of ['rStyle', 'vertAlign', 'b', 'color', 'i', `${kind}Reference`]) {
          expect(named(run, name)).toBe(false);
        }
        expect(find(paragraph(after), (node) => node.kind === 'noteReference')).toEqual(
          oldReference
        );
        expect(paragraphTextOf(after, paragraphId(after))).toContain('Text\uFFFC#');
        if (layout === 'shared-run' || layout === 'right-run') {
          expect(paragraphTextOf(after, paragraphId(after))).toBe('Text\uFFFC#tail');
        }
        const reopened = part(xml(after).match(/<w:body>([\s\S]*)<\/w:body>/)![1]!);
        expect(paragraphTextOf(reopened, paragraphId(reopened))).toBe(
          paragraphTextOf(after, paragraphId(after))
        );
        expect(named(typedRun(reopened), 'vertAlign')).toBe(false);
        const removed = apply(after, {
          op: 'deleteText',
          paragraphId: paragraphId(after),
          start: 4,
          end: 5,
        });
        expect(paragraphTextOf(removed, paragraphId(removed))).toContain('Text#');
        expect(find(paragraph(removed), (node) => node.kind === 'noteReference')).toBeUndefined();
      });
    }

    test(`${kind}: ${mode} typing takes the text face before the reference, not the mark`, () => {
      const before = part(
        '<w:p><w:pPr><w:rPr><w:rStyle w:val="MarkFace"/><w:u w:val="single"/>' +
          '<w:color w:val="0000FF"/></w:rPr></w:pPr>' +
          '<w:r><w:rPr><w:rStyle w:val="BodyFace"/><w:i/><w:cs/></w:rPr><w:t>Text</w:t></w:r>' +
          reference(kind) +
          '</w:p>'
      );
      const pid = paragraphId(before);
      const caret = authoredRunPropertiesAt(before, pid, 5);
      expect(caret.some((p) => p.localName === 'i')).toBe(true);
      expect(caret.some((p) => p.localName === 'u')).toBe(false);
      expect(caret.some((p) => p.localName === 'vertAlign')).toBe(false);
      const owner = formattingRunAt(paragraph(before), 5);
      expect(owner && named(owner, `${kind}Reference`)).toBe(false);
      const after = apply(before, {
        op: 'insertText',
        paragraphId: pid,
        offset: 5,
        text: '#',
        ...(tracked ? { revision: ADA } : {}),
      });
      const run = typedRun(after);
      expect(named(run, 'i')).toBe(true);
      expect(named(run, 'rStyle')).toBe(true);
      expect(named(run, 'cs')).toBe(true);
      expect(named(run, 'u')).toBe(false);
      expect(named(run, 'color')).toBe(false);
      expect(named(run, 'vertAlign')).toBe(false);
      expect(named(run, 'b')).toBe(false);
      const style = find(run, (node) => node.kind !== 'textValue' && node.localName === 'rStyle');
      expect(
        style?.kind === 'textValue'
          ? undefined
          : style?.attributes.find((a) => a.localName === 'val')
      ).toMatchObject({ value: 'BodyFace' });
      const original = find(
        paragraph(after),
        (node) => node.kind === 'run' && named(node, `${kind}Reference`)
      );
      expect(named(original!, 'vertAlign')).toBe(true);
      expect(named(original!, 'b')).toBe(true);
    });
  }
}

test('a right-biased insertion keeps its explicit following-run target', () => {
  const before = part(
    '<w:p>' +
      prefix +
      reference('footnote') +
      '<w:r><w:rPr><w:i/></w:rPr><w:t>tail</w:t></w:r></w:p>'
  );
  const after = apply(before, {
    op: 'insertText',
    paragraphId: paragraphId(before),
    offset: 5,
    text: '#',
    bias: 'right',
  });
  expect(named(typedRun(after), 'i')).toBe(true);
});
