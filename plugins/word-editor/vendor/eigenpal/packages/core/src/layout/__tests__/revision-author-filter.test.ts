import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import { piecesOfParagraph } from '../field-projection.ts';
import {
  EMPTY_REVISION_AUTHOR_SET,
  revisionAuthorFilter,
  type RevisionDisplayMode,
} from '../revision-projection.ts';
import { storyBlocks } from '../story-roots.ts';
import { projectedSectionSourceIndexes } from '../section-properties.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraph(body: string): OoxmlNode {
  const part = load(body);
  const found = part.root.children[0]!.children.find((node) => node.kind === 'paragraph');
  if (!found) throw new Error('no paragraph');
  return found;
}

const run = (text: string, properties = '') =>
  `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const delRun = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;
const ins = (author: string, text: string) =>
  `<w:ins w:id="1" w:author="${author}">${run(text)}</w:ins>`;
const del = (author: string, text: string) =>
  `<w:del w:id="2" w:author="${author}">${delRun(text)}</w:del>`;

function pieces(
  body: string,
  hidden: readonly string[],
  displayMode: RevisionDisplayMode = 'all-markup'
) {
  return piecesOfParagraph(
    paragraph(body),
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    displayMode,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    revisionAuthorFilter(hidden)
  );
}

describe('review author layout filter', () => {
  test('canonical filters expose no mutating Set methods or divergent cache identity', () => {
    const filter = revisionAuthorFilter(['Grace', 'Ada', 'Ada']);
    expect(filter).toBeDefined();
    if (!filter) return;
    expect([...filter.hiddenAuthors]).toEqual(['Ada', 'Grace']);
    expect(filter.cacheKey).toBe('["Ada","Grace"]');
    expect((filter.hiddenAuthors as unknown as { add?: unknown }).add).toBeUndefined();
    expect((filter.hiddenAuthors as unknown as { delete?: unknown }).delete).toBeUndefined();
    expect((filter.hiddenAuthors as unknown as { clear?: unknown }).clear).toBeUndefined();
  });

  test('hidden insertions remain as ordinary accepted text', () => {
    const result = pieces(`<w:p>${ins('Ada', 'new')}${ins('Grace', 'other')}</w:p>`, ['Ada']);
    expect(result.map((piece) => piece.text)).toEqual(['new', 'other']);
    expect(result[0]!.revisions).toBeUndefined();
    expect(result[1]!.revisions?.map((revision) => revision.author)).toEqual(['Grace']);
  });

  test('hidden deletions leave the text flow while visible deletions remain', () => {
    const result = pieces(`<w:p>${run('A')}${del('Ada', 'old')}${del('Grace', 'shown')}</w:p>`, [
      'Ada',
    ]);
    expect(result.map((piece) => piece.text).join('')).toBe('Ashown');
    expect(result.at(-1)!.revisions?.[0]?.author).toBe('Grace');
  });

  test('a hidden inner insertion stays inside a visible outer deletion', () => {
    const nested = `<w:p><w:del w:id="1" w:author="Grace"><w:ins w:id="2" w:author="Ada">${run(
      'word'
    )}</w:ins></w:del></w:p>`;
    const result = pieces(nested, ['Ada']);
    expect(result[0]!.text).toBe('word');
    expect(result[0]!.revisions?.map((revision) => revision.author)).toEqual(['Grace']);
  });

  test('hidden authors use the accepted projection inside the original view', () => {
    const result = pieces(
      `<w:p>${ins('Ada', 'accepted')}${ins('Grace', 'originally absent')}${del(
        'Ada',
        'removed'
      )}${del('Grace', 'original')}</w:p>`,
      ['Ada'],
      'original'
    );
    expect(result.map((piece) => piece.text).join('')).toBe('acceptedoriginal');
    expect(result[0]!.text).toBe('accepted');
    expect(result[0]!.revisions).toBeUndefined();
  });

  test('a hidden formatting change keeps applied formatting without markup', () => {
    const change = '<w:rPrChange w:id="3" w:author="Ada"><w:rPr><w:i/></w:rPr></w:rPrChange>';
    const [hidden] = pieces(`<w:p>${run('formatted', `<w:b/>${change}`)}</w:p>`, ['Ada']);
    const [shown] = pieces(`<w:p>${run('formatted', `<w:b/>${change}`)}</w:p>`, []);
    expect(hidden!.style.bold).toBe(true);
    expect(hidden!.props.some((property) => property.localName === 'rPrChange')).toBe(false);
    expect(shown!.props.some((property) => property.localName === 'rPrChange')).toBe(true);
    for (const displayMode of ['proposed', 'original'] as const) {
      const [resolved] = pieces(
        `<w:p>${run('formatted', `<w:b/>${change}`)}</w:p>`,
        ['Ada'],
        displayMode
      );
      expect(resolved!.style.bold).toBe(true);
      expect(resolved!.props.some((property) => property.localName === 'rPrChange')).toBe(false);
    }
  });

  test('a hidden paragraph-mark deletion merges only that reviewer', () => {
    const marked = (author: string, text: string) =>
      `<w:p><w:pPr><w:rPr><w:del w:id="4" w:author="${author}"/></w:rPr></w:pPr>${run(text)}</w:p>`;
    const part = load(`${marked('Ada', 'one')}${marked('Grace', 'two')}<w:p>${run('three')}</w:p>`);
    const blocks = storyBlocks(part, 'all-markup', revisionAuthorFilter(['Ada']));
    expect(blocks).toHaveLength(2);
    expect(
      blocks[0]!.children.flatMap((child) => (child.kind === 'run' ? child.children : []))
    ).not.toEqual([]);
    expect(blocks[1]!.id).not.toBe(blocks[0]!.id);
  });

  test('hidden paragraph marks use the accepted projection in the original view', () => {
    const marked = (kind: 'ins' | 'del', text: string) =>
      `<w:p><w:pPr><w:rPr><w:${kind} w:id="5" w:author="Ada"/></w:rPr></w:pPr>${run(text)}</w:p>`;
    const survivor = `<w:p>${run('survivor')}</w:p>`;
    expect(
      storyBlocks(
        load(`${marked('del', 'merged')}${survivor}`),
        'original',
        revisionAuthorFilter(['Ada'])
      )
    ).toHaveLength(1);
    expect(
      storyBlocks(
        load(`${marked('ins', 'kept')}${survivor}`),
        'original',
        revisionAuthorFilter(['Ada'])
      )
    ).toHaveLength(2);
  });

  describe('editable and demoted field results', () => {
    // A FORMTEXT result is EDITABLE, so its runs keep real model offsets and the walk buffers
    // them instead of pushing; the same route serves a demoted (unterminated) field. Both
    // once bypassed the reviewer projection that `push` applies, so a hidden author's change
    // kept its colour on the page while the review list had dropped it.
    const FORMTEXT_OPEN =
      '<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Text1"/><w:enabled/>' +
      '<w:calcOnExit w:val="0"/><w:textInput><w:default w:val="x"/></w:textInput></w:ffData>' +
      '</w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
    const FIELD_END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const formText = (result: string) => `${FORMTEXT_OPEN}${result}${FIELD_END}`;
    const DEMOTED_OPEN =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> REF _Ref1 \\h </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
    const change = '<w:rPrChange w:id="3" w:author="Ada"><w:rPr><w:i/></w:rPr></w:rPrChange>';
    const insRaw = (author: string, inner: string) =>
      `<w:ins w:id="1" w:author="${author}">${inner}</w:ins>`;
    const moveTo = (author: string, text: string) =>
      `<w:moveTo w:id="5" w:author="${author}">${run(text)}</w:moveTo>`;
    const symbol = '<w:r><w:sym w:font="Symbol" w:char="F0B7"/></w:r>';
    const attributionOf = (result: ReturnType<typeof pieces>, text: string) =>
      result.find((piece) => piece.text === text)!.revisions?.map((r) => r.author);
    /** `push`'s verdict for the same change in an ordinary run: the buffered route must match. */
    const pushed = (inner: string, hidden: readonly string[] = ['Ada']) =>
      pieces(`<w:p>${run('A ')}${inner}</w:p>`, hidden);

    for (const [label, wrap] of [
      ['a FORMTEXT result', formText],
      ['a demoted field result', (result: string) => `${DEMOTED_OPEN}${result}`],
    ] as const) {
      test(`a hidden insertion inside ${label} paints as ordinary text`, () => {
        const result = pieces(`<w:p>${wrap(run('A ') + ins('Ada', 'new'))}</w:p>`, ['Ada']);
        expect(result.map((piece) => piece.text)).toEqual(['A ', 'new']);
        expect(attributionOf(result, 'new')).toBeUndefined();
        expect(attributionOf(pushed(ins('Ada', 'new')), 'new')).toBeUndefined();
        expect(result.every((piece) => piece.fieldAtom !== undefined)).toBe(true);
      });

      test(`a hidden move-to inside ${label} paints as ordinary text`, () => {
        const result = pieces(`<w:p>${wrap(run('A ') + moveTo('Ada', 'moved'))}</w:p>`, ['Ada']);
        expect(attributionOf(result, 'moved')).toBeUndefined();
      });

      // The two guards below pass on the old route too; they pin the boundary so the fix
      // cannot over-filter a visible author or resurrect a hidden deletion.
      test(`a visible insertion inside ${label} keeps its attribution`, () => {
        const result = pieces(`<w:p>${wrap(run('A ') + ins('Ada', 'new'))}</w:p>`, ['Grace']);
        expect(attributionOf(result, 'new')).toEqual(['Ada']);
      });

      test(`a hidden deletion inside ${label} leaves the text flow`, () => {
        const result = pieces(`<w:p>${wrap(run('A ') + del('Ada', 'old'))}</w:p>`, ['Ada']);
        expect(result.map((piece) => piece.text)).toEqual(['A ']);
      });

      test(`a hidden formatting change inside ${label} keeps the format, drops the record`, () => {
        const [piece] = pieces(`<w:p>${wrap(run('styled', `<w:b/>${change}`))}</w:p>`, ['Ada']);
        expect(piece!.style.bold).toBe(true);
        expect(piece!.props.some((property) => property.localName === 'rPrChange')).toBe(false);
        const [shown] = pieces(`<w:p>${wrap(run('styled', `<w:b/>${change}`))}</w:p>`, ['Grace']);
        expect(shown!.props.some((property) => property.localName === 'rPrChange')).toBe(true);
      });

      test(`a hidden symbol insertion inside ${label} paints as ordinary text`, () => {
        const result = pieces(`<w:p>${wrap(run('A ') + insRaw('Ada', symbol))}</w:p>`, ['Ada']);
        const glyph = result.find((piece) => piece.projected);
        expect(glyph).toBeDefined();
        expect(glyph!.revisions).toBeUndefined();
        const shown = pieces(`<w:p>${wrap(run('A ') + insRaw('Ada', symbol))}</w:p>`, ['Grace']);
        expect(shown.find((piece) => piece.projected)!.revisions?.[0]?.author).toBe('Ada');
      });
    }

    test('a hidden insertion around a whole FORMTEXT field paints as ordinary text', () => {
      const result = pieces(`<w:p>${run('A ')}${insRaw('Ada', formText(run('new')))}</w:p>`, [
        'Ada',
      ]);
      expect(result.map((piece) => piece.text)).toEqual(['A ', 'new']);
      expect(attributionOf(result, 'new')).toBeUndefined();
    });

    test('a hidden inner insertion inside a FORMTEXT keeps a visible outer deletion', () => {
      const nested = `<w:p>${formText(`<w:del w:id="1" w:author="Grace"><w:ins w:id="2" w:author="Ada">` + `${run('word')}</w:ins></w:del>`)}</w:p>`;
      const result = pieces(nested, ['Ada']);
      expect(result[0]!.text).toBe('word');
      expect(attributionOf(result, 'word')).toEqual(['Grace']);
    });

    test('a node filter in accept mode drops the attribution inside a FORMTEXT', () => {
      // The shape `setTrackedChangesFilter` builds: nothing hidden by author, one revision
      // node excluded, projected as accepted.
      const body = `<w:p>${formText(run('A ') + ins('Ada', 'new'))}</w:p>`;
      const nodeId = pieces(body, []).find((piece) => piece.text === 'new')!.revisions![0]!.nodeId;
      const filterFor = (mode: 'proposed' | 'original') =>
        Object.freeze({
          hiddenAuthors: EMPTY_REVISION_AUTHOR_SET,
          includes: (revision: { nodeId: string }) => revision.nodeId !== nodeId,
          includesNode: (id: string) => id !== nodeId,
          excludedNodeMode: () => mode,
          cacheKey: `node:${mode}`,
        });
      const accepted = piecesOfParagraph(
        paragraph(body),
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        'all-markup',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        filterFor('proposed')
      );
      expect(accepted.map((piece) => piece.text)).toEqual(['A ', 'new']);
      expect(attributionOf(accepted, 'new')).toBeUndefined();
      const rejected = piecesOfParagraph(
        paragraph(body),
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        'all-markup',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        filterFor('original')
      );
      expect(rejected.map((piece) => piece.text)).toEqual(['A ']);
    });
  });

  test('a deleted positional tab follows the display mode like the text beside it', () => {
    // `w:ptab` is pushed without its own visibility gate; the projection in `push` is what
    // resolves it away, so a struck tab must vanish from the proposed view with its words.
    const struck = `<w:p>${run('A')}<w:del w:id="6" w:author="Ada"><w:r><w:ptab w:alignment="right" w:relativeTo="margin"/></w:r></w:del>${run('B')}</w:p>`;
    const shown = pieces(struck, []);
    expect(shown.some((piece) => piece.positionalTab !== undefined)).toBe(true);
    expect(shown.find((piece) => piece.positionalTab)!.revisions?.[0]?.kind).toBe('delete');
    const proposed = pieces(struck, [], 'proposed');
    expect(proposed.map((piece) => piece.text)).toEqual(['A', 'B']);
    expect(proposed.some((piece) => piece.positionalTab !== undefined)).toBe(false);
    const hidden = pieces(struck, ['Ada']);
    expect(hidden.some((piece) => piece.positionalTab !== undefined)).toBe(false);
  });

  test('projected sections retain the canonical source index of their surviving break', () => {
    const section = (width: number, text: string, markRevision = '') =>
      `<w:p><w:pPr><w:sectPr><w:pgSz w:w="${width}" w:h="15840"/></w:sectPr>${markRevision}</w:pPr>${run(text)}</w:p>`;
    const hiddenMark = '<w:rPr><w:del w:id="9" w:author="Ada"/></w:rPr>';
    const part = load(
      section(10000, 'absorbed', hiddenMark) +
        section(12000, 'survivor') +
        `<w:p>${run('final')}</w:p><w:sectPr><w:pgSz w:w="14000" w:h="15840"/></w:sectPr>`
    );

    expect(
      projectedSectionSourceIndexes(part, 'all-markup', revisionAuthorFilter(['Ada']))
    ).toEqual([1, 2]);
  });
});
