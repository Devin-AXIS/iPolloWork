// Text typed right after a note reference takes the face of the text around the reference.
//
// The rule: the nearest text run BEFORE the caret, skipping note references. With no text
// before, the next text run. With no other text run, the paragraph mark. Never the reference
// run's own properties. Plain typing, tracked typing, and the caret reads agree.

import { expect, test } from 'bun:test';
import { bodyStoryRoot, storyParagraphs, type OoxmlNode, type OoxmlPart } from '../index.ts';
import { authoredRunPropertiesAt } from '../../editor/surface-formatting.ts';
import { formattingRunAt } from '../store/direct-properties.ts';
import { noteReferenceEndingAt } from '../store/note-typing-boundary.ts';
import { ADA, apply, paragraphId, part } from './tracked-edit-fixture.ts';

type Kind = 'footnote' | 'endnote';

const text = (value: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${value}</w:t></w:r>`;

/** A reference run. `style: false` leaves out the reference character style. */
function reference(kind: Kind, rPr = '', options: { style?: boolean; tail?: string } = {}) {
  const style = options.style === false ? '' : `<w:rStyle w:val="${kind}Reference"/>`;
  return (
    `<w:r><w:rPr>${style}${rPr}</w:rPr>` +
    `<w:${kind}Reference w:id="1"/>${options.tail ?? ''}</w:r>`
  );
}

const mark = (rPr: string) => `<w:pPr><w:rPr>${rPr}</w:rPr></w:pPr>`;

const BOLD_RED = '<w:b/><w:color w:val="FF0000"/>';
const UNDERLINE = '<w:u w:val="single"/>';

interface Case {
  readonly name: string;
  readonly body: (kind: Kind) => string;
  /** The caret, right after a reference. */
  readonly offset: number;
  /** The typed run's properties, as `name` or `name=val`, in document order. */
  readonly face: readonly string[];
  /** The paragraph has no other text run, so the face comes from the paragraph mark. */
  readonly fromMark?: true;
  /** The reference ends a hyperlink, so the text takes no face at all. */
  readonly noFace?: true;
}

const deleted = (value: string, rPr: string) =>
  '<w:del w:id="91" w:author="Other" w:date="2026-01-01T00:00:00Z">' +
  `<w:r><w:rPr>${rPr}</w:rPr><w:delText>${value}</w:delText></w:r></w:del>`;
const link = (content: string) => `<w:hyperlink w:anchor="target">${content}</w:hyperlink>`;

/** Runs that hold deleted text or only a tab give a face; a run with only a break does not. */
const CONTENT_CASES: readonly Case[] = [
  {
    name: 'italic text, deleted bold run, reference',
    body: (k) => text('Alpha', '<w:i/>') + deleted('Gone', '<w:b/>') + reference(k),
    offset: 10,
    face: ['b'],
  },
  {
    name: 'deleted bold run only, reference, underlined mark',
    body: (k) => mark(UNDERLINE) + deleted('Gone', '<w:b/>') + reference(k),
    offset: 5,
    face: ['b'],
  },
  {
    name: 'deleted bold run, reference, underlined text',
    body: (k) => deleted('Gone', '<w:b/>') + reference(k) + text('tail', UNDERLINE),
    offset: 5,
    face: ['b'],
  },
  {
    name: 'italic text, bold tab-only run, reference',
    body: (k) =>
      text('Alpha', '<w:i/>') + '<w:r><w:rPr><w:b/></w:rPr><w:tab/></w:r>' + reference(k),
    offset: 7,
    face: ['b'],
  },
  {
    name: 'bold tab-only run, reference, underlined text',
    body: (k) =>
      '<w:r><w:rPr><w:b/></w:rPr><w:tab/></w:r>' + reference(k) + text('tail', UNDERLINE),
    offset: 2,
    face: ['b'],
  },
  {
    name: 'italic text, bold break-only run, reference',
    body: (k) => text('Alpha', '<w:i/>') + '<w:r><w:rPr><w:b/></w:rPr><w:br/></w:r>' + reference(k),
    offset: 7,
    face: ['i'],
  },
  {
    name: 'italic text, hyperlink that ends with the reference',
    body: (k) => text('Alpha', '<w:i/>') + link(reference(k)),
    offset: 6,
    face: [],
    noFace: true,
  },
  {
    name: 'underlined mark, italic text, hyperlink that ends with the reference',
    body: (k) => mark(UNDERLINE) + text('Alpha', '<w:i/>') + link(reference(k)),
    offset: 6,
    face: [],
    noFace: true,
  },
  {
    name: 'italic text, hyperlink with bold text and the reference, underlined text',
    body: (k) =>
      text('Alpha', '<w:i/>') +
      link(text('Link', '<w:b/>') + reference(k)) +
      text('tail', UNDERLINE),
    offset: 10,
    face: [],
    noFace: true,
  },
];

const CASES: readonly Case[] = [
  {
    name: 'plain text, terminal reference',
    body: (k) => text('Alpha') + reference(k),
    offset: 6,
    face: [],
  },
  {
    name: 'plain text, reference, plain text',
    body: (k) => text('Bravo') + reference(k) + text(' rest'),
    offset: 6,
    face: [],
  },
  {
    name: 'bold text, bold red styled reference',
    body: (k) => text('Charl', '<w:b/>') + reference(k, BOLD_RED),
    offset: 6,
    face: ['b'],
  },
  {
    name: 'plain text, reference with direct italic superscript and no style',
    body: (k) =>
      text('Delta') + reference(k, '<w:i/><w:vertAlign w:val="superscript"/>', { style: false }),
    offset: 6,
    face: [],
  },
  {
    name: 'plain text, reference run that also holds text',
    body: (k) => text('Echoo') + reference(k, '', { tail: '<w:t>tail</w:t>' }),
    offset: 6,
    face: [],
  },
  {
    name: 'italic blue paragraph mark, plain text, reference',
    body: (k) => mark('<w:i/><w:color w:val="0000FF"/>') + text('Foxtr') + reference(k),
    offset: 6,
    face: [],
  },
  {
    name: 'character-styled text, reference',
    body: (k) => text('Golfo', '<w:rStyle w:val="Strong"/>') + reference(k),
    offset: 6,
    face: ['rStyle=Strong'],
  },
  {
    name: 'plain text, hyperlink that ends with the reference',
    body: (k) => text('Hotel') + `<w:hyperlink w:anchor="x">${reference(k)}</w:hyperlink>`,
    offset: 6,
    face: [],
    noFace: true,
  },
  {
    name: 'bold text, bold reference, bold text',
    body: (k) => text('India', '<w:b/>') + reference(k, '<w:b/>') + text(' rest', '<w:b/>'),
    offset: 6,
    face: ['b'],
  },
  {
    name: 'italic text, bold red reference, underlined text',
    body: (k) => text('Alpha', '<w:i/>') + reference(k, BOLD_RED) + text('tail', UNDERLINE),
    offset: 6,
    face: ['i'],
  },
  {
    name: 'plain text, bold red reference',
    body: (k) => text('Bravo') + reference(k, BOLD_RED),
    offset: 6,
    face: [],
  },
  {
    name: 'reference first, italic mark, underlined text',
    body: (k) => mark('<w:i/>') + reference(k, '<w:b/>') + text('Charl', UNDERLINE),
    offset: 1,
    face: ['u=single'],
  },
  {
    name: 'reference alone, italic mark',
    body: (k) => mark('<w:i/>') + reference(k, '<w:b/>'),
    offset: 1,
    face: ['i'],
    fromMark: true,
  },
  {
    name: 'italic text, two references in a row',
    body: (k) => text('Delta', '<w:i/>') + reference(k) + reference(k),
    offset: 7,
    face: ['i'],
  },
  {
    name: 'italic text, bookmark around the reference',
    body: (k) =>
      text('Echo', '<w:i/>') +
      '<w:bookmarkStart w:id="1" w:name="mark"/>' +
      reference(k) +
      '<w:bookmarkEnd w:id="1"/>',
    offset: 5,
    face: ['i'],
  },
];

function find(root: OoxmlNode, predicate: (node: OoxmlNode) => boolean): OoxmlNode | undefined {
  if (predicate(root)) return root;
  if (root.kind === 'textValue') return undefined;
  for (const child of root.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return undefined;
}

function paragraphOf(source: OoxmlPart) {
  return storyParagraphs(bodyStoryRoot(source)!)[0]!;
}

function faceOf(run: OoxmlNode): string[] {
  if (run.kind === 'textValue') return [];
  const rPr = run.children.find((child) => child.kind === 'runProperties');
  if (!rPr || rPr.kind === 'textValue') return [];
  return rPr.children.flatMap((property) => {
    if (property.kind === 'textValue') return [];
    const val = property.attributes.find((entry) => entry.localName === 'val')?.value;
    return [val === undefined ? property.localName : `${property.localName}=${val}`];
  });
}

function typedRun(source: OoxmlPart): OoxmlNode {
  const run = find(
    paragraphOf(source),
    (node) =>
      node.kind === 'run' &&
      find(node, (child) => child.kind === 'textValue' && child.value.includes('#')) !== undefined
  );
  expect(run?.kind).toBe('run');
  return run!;
}

const faceNames = (face: readonly string[]) => face.map((entry) => entry.split('=')[0]!);

for (const kind of ['footnote', 'endnote'] as const) {
  for (const { name, body, offset, face, fromMark, noFace } of [...CASES, ...CONTENT_CASES]) {
    for (const tracked of [false, true]) {
      test(`${kind}, ${tracked ? 'tracked' : 'plain'}: ${name}`, () => {
        const before = part(`<w:p>${body(kind)}</w:p>`);
        expect(noteReferenceEndingAt(paragraphOf(before), offset)).toBeDefined();
        const after = apply(before, {
          op: 'insertText',
          paragraphId: paragraphId(before),
          offset,
          text: '#',
          ...(tracked ? { revision: ADA } : {}),
        });
        const run = typedRun(after);
        expect(faceOf(run)).toEqual([...face]);
        expect(find(run, (node) => node.kind === 'noteReference')).toBeUndefined();
        if (noFace) {
          const inLink = find(
            paragraphOf(after),
            (node) =>
              node.kind === 'hyperlink' && find(node, (child) => child === run) !== undefined
          );
          expect(inLink).toBeUndefined();
        }
        if (tracked) {
          const insertion = find(
            paragraphOf(after),
            (node) =>
              node.kind === 'revisionInsert' && find(node, (child) => child === run) !== undefined
          );
          expect(insertion).toBeDefined();
        }
      });
    }

    test(`${kind}: the caret after the reference reads the face typing writes: ${name}`, () => {
      const before = part(`<w:p>${body(kind)}</w:p>`);
      // The character style is not a caret property; every other face property is.
      const caret = authoredRunPropertiesAt(before, paragraphId(before), offset);
      expect(caret.map((property) => property.localName).sort()).toEqual(
        faceNames(face)
          .filter((entry) => entry !== 'rStyle')
          .sort()
      );
      const owner = formattingRunAt(paragraphOf(before), offset);
      if (fromMark || noFace) {
        expect(owner).toBeNull();
      } else {
        expect(owner && faceOf(owner)).toEqual([...face]);
      }
    });
  }
}

test('the face holds for every character typed after the reference', () => {
  let source = part(`<w:p>${text('India', '<w:b/>')}${reference('footnote', '<w:b/>')}</w:p>`);
  source = apply(source, {
    op: 'insertText',
    paragraphId: paragraphId(source),
    offset: 6,
    text: '#',
  });
  source = apply(source, {
    op: 'insertText',
    paragraphId: paragraphId(source),
    offset: 7,
    text: '#',
  });
  expect(faceOf(typedRun(source))).toEqual(['b']);
});
