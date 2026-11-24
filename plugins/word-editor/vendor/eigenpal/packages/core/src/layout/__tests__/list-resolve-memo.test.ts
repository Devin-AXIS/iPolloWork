// The `withResolvedListItems` memo: identical raw inputs return the same item map and
// linked index, so a no-change layout flush skips the sequential full-story counter walk;
// any input moving by identity recomputes.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import {
  listResolveBlockVisitTestRecorder,
  listResolveSessionMemoListItemsForTest,
  withResolvedListItems,
  withResolvedListItemsForSession,
} from '../list-resolve.ts';
import { createSurfaceStyleDeps } from '../../editor/surface-pages.ts';
import { storyBlocks } from '../story-roots.ts';
import { createLayoutSession } from '../layout-session.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { mountPaginatedSurface } from '../../editor/paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const WARM_SIZES = [320, 2_560, 12_700] as const;

function loadNumbering(body: string) {
  const result = readOoxmlPart(`<w:numbering xmlns:w="${W}">${body}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return buildNumberingIndex(result.part.root);
}

const DECIMAL = `
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
`;

function loadBodyPart() {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>` +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
      '<w:r><w:t>one</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
      '<w:r><w:t>two</w:t></w:r></w:p>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function loadThreeItemBodyPart() {
  const item = (text: string) =>
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
    `<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${item('one')}${item('two')}${item('three')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

describe('withResolvedListItems memo', () => {
  test('identical raw inputs return the same item map and linked index', () => {
    const numberingIndex = loadNumbering(DECIMAL);
    const blocks = storyBlocks(loadBodyPart());
    const first = withResolvedListItems({ numberingIndex }, blocks);
    const second = withResolvedListItems({ numberingIndex }, blocks);
    expect(first.listItems).toBeDefined();
    expect(second.listItems).toBe(first.listItems!);
    expect(second.numberingIndex).toBe(first.numberingIndex);
    expect(first.listItems!.size).toBe(2);
  });

  test('a different numbering index or block list recomputes', () => {
    const numberingIndex = loadNumbering(DECIMAL);
    const blocks = storyBlocks(loadBodyPart());
    const first = withResolvedListItems({ numberingIndex }, blocks);

    const freshIndex = loadNumbering(DECIMAL);
    const byIndex = withResolvedListItems({ numberingIndex: freshIndex }, blocks);
    expect(byIndex.listItems).not.toBe(first.listItems!);

    const freshBlocks = storyBlocks(loadBodyPart());
    const byBlocks = withResolvedListItems({ numberingIndex }, freshBlocks);
    expect(byBlocks.listItems).not.toBe(first.listItems!);
    expect(byBlocks.listItems!.size).toBe(first.listItems!.size);
  });

  test('a caller-supplied item map bypasses the memo untouched', () => {
    const numberingIndex = loadNumbering(DECIMAL);
    const blocks = storyBlocks(loadBodyPart());
    const supplied = new Map();
    const result = withResolvedListItems({ numberingIndex, listItems: supplied }, blocks);
    expect(result.listItems).toBe(supplied);
  });

  test('typing in a list item reuses the sequential list result', () => {
    const numberingIndex = loadNumbering(DECIMAL);
    const part = loadThreeItemBodyPart();
    const blocks = storyBlocks(part);
    const first = withResolvedListItems({ numberingIndex }, blocks);
    const edited = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: blocks[1]!.id,
      offset: 3,
      text: '!',
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    const editedBlocks = storyBlocks(edited.part);
    expect(editedBlocks[0]).toBe(blocks[0]);
    expect(editedBlocks[2]).toBe(blocks[2]);
    const second = withResolvedListItems({ numberingIndex }, editedBlocks);
    expect(second.listItems).toBe(first.listItems!);
  });

  test('with a style cascade: repeated resolves stay identity-stable, edits stay correct', () => {
    const stylesXml =
      `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:styleId="ListNum">' +
      '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
      '</w:style></w:styles>';
    const stylesResult = readOoxmlPart(stylesXml, {
      name: '/word/styles.xml',
      contentType: 'app/xml',
    });
    if (!stylesResult.ok) throw new Error(stylesResult.reason);
    const styleCascade = buildStyleCascadeTable(stylesResult.part.root);
    const numberingIndex = loadNumbering(DECIMAL);

    // Numbering arrives through the STYLE, so the per-paragraph prelude must run the
    // cascade to find it — the exact path the prelude memo shortcuts.
    const styledDoc = () => {
      const result = readOoxmlPart(
        `<w:document xmlns:w="${W}"><w:body>` +
          '<w:p><w:pPr><w:pStyle w:val="ListNum"/></w:pPr><w:r><w:t>one</w:t></w:r></w:p>' +
          '<w:p><w:pPr><w:pStyle w:val="ListNum"/></w:pPr><w:r><w:t>two</w:t></w:r></w:p>' +
          '</w:body></w:document>',
        { name: '/word/document.xml', contentType: 'app/xml' }
      );
      if (!result.ok) throw new Error(result.reason);
      return result.part;
    };

    const blocks = storyBlocks(styledDoc());
    const first = withResolvedListItems({ numberingIndex, styleCascade }, blocks);
    expect(first.listItems).toBeDefined();
    expect(first.listItems!.size).toBe(2);
    const markers = [...first.listItems!.values()].map((item) => item.markerText);
    expect(markers).toEqual(['1.', '2.']);

    // Same inputs: the outer memo returns the same map and the same linked index.
    const second = withResolvedListItems({ numberingIndex, styleCascade }, blocks);
    expect(second.listItems).toBe(first.listItems!);
    expect(second.numberingIndex).toBe(first.numberingIndex);

    // A simulated edit (fresh part → fresh blocks) recomputes to EQUAL content; the
    // per-paragraph preludes are keyed on node identity, so fresh nodes re-cascade.
    const editedBlocks = storyBlocks(styledDoc());
    const third = withResolvedListItems({ numberingIndex, styleCascade }, editedBlocks);
    expect(third.listItems).not.toBe(first.listItems!);
    expect([...third.listItems!.values()].map((item) => item.markerText)).toEqual(['1.', '2.']);
    expect(third.numberingIndex).toBe(first.numberingIndex);
  });

  test('with a layout session: first-block plain edit keeps listItems identity', () => {
    const numberingIndex = loadNumbering(DECIMAL);
    const leadDoc = () => {
      const result = readOoxmlPart(
        `<w:document xmlns:w="${W}"><w:body>` +
          '<w:p><w:r><w:t>lead</w:t></w:r></w:p>' +
          '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
          '<w:r><w:t>one</w:t></w:r></w:p>' +
          '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
          '<w:r><w:t>two</w:t></w:r></w:p>' +
          '</w:body></w:document>',
        { name: '/word/document.xml', contentType: 'app/xml' }
      );
      if (!result.ok) throw new Error(result.reason);
      return result.part;
    };
    const session = createLayoutSession();
    const part = leadDoc();
    const blocksA = storyBlocks(part);
    const first = withResolvedListItemsForSession({ numberingIndex }, blocksA, session);
    const leadParagraph = blocksA.find((block) => block.kind === 'paragraph');
    expect(leadParagraph?.kind).toBe('paragraph');
    const edited = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: leadParagraph!.id,
      offset: 0,
      text: 'X',
    });
    if (!edited.ok) throw new Error(String(edited.issues));
    const blocksB = storyBlocks(edited.part);
    expect(blocksB[0]).not.toBe(blocksA[0]);
    const second = withResolvedListItemsForSession({ numberingIndex }, blocksB, session);
    expect(second.listItems).toBe(first.listItems!);
  });

  test('a paragraph split near the top re-reads only the blocks it changed', () => {
    const numberingIndex = loadNumbering(DECIMAL);
    const item = (text: string) =>
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
      `<w:r><w:t>${text}</w:t></w:r></w:p>`;
    const items: string[] = [];
    for (let index = 0; index < 300; index += 1) items.push(item(`Item ${index}`));
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>${items.join('')}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const session = createLayoutSession();
    const blocksA = storyBlocks(read.part);
    withResolvedListItemsForSession({ numberingIndex }, blocksA, session);
    const edited = applyTreeOp(read.part, {
      op: 'splitParagraph',
      paragraphId: blocksA[2]!.id,
      offset: 2,
    });
    if (!edited.ok) throw new Error(String(edited.issues));
    const blocksB = storyBlocks(edited.part);
    const recorder = listResolveBlockVisitTestRecorder();
    recorder.reset();
    const warm = withResolvedListItemsForSession({ numberingIndex }, blocksB, session);
    // The two halves of the split paragraph, not the 297 blocks after it.
    expect(recorder.blockScans).toBeLessThan(5);
    const cold = withResolvedListItemsForSession(
      { numberingIndex },
      blocksB,
      createLayoutSession()
    );
    const markers = (map: typeof warm.listItems) =>
      blocksB.map((block) => map?.get(block.id)?.markerText ?? '');
    expect(markers(warm.listItems)).toEqual(markers(cold.listItems));
    expect(markers(warm.listItems)[300]).toBe('301.');
  });

  test('independent layout sessions do not share list item maps', () => {
    const numberingIndex = loadNumbering(DECIMAL);
    const blocks = storyBlocks(loadBodyPart());
    const firstSession = createLayoutSession();
    const secondSession = createLayoutSession();
    const first = withResolvedListItemsForSession({ numberingIndex }, blocks, firstSession);
    const second = withResolvedListItemsForSession({ numberingIndex }, blocks, secondSession);
    expect(first.listItems).not.toBe(second.listItems!);
    expect([...first.listItems!.values()].map((item) => item.markerText)).toEqual(['1.', '2.']);
  });

  test('multi-section document: numbered dependency change recomputes', () => {
    const numberingIndex = loadNumbering(DECIMAL);
    const multiSectionDoc = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
        '<w:r><w:t>one</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr></w:p>' +
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
        '<w:r><w:t>two</w:t></w:r></w:p>' +
        '</w:body></w:document>',
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!multiSectionDoc.ok) throw new Error(multiSectionDoc.reason);
    const session = createLayoutSession();
    const blocks = storyBlocks(multiSectionDoc.part);
    const first = withResolvedListItemsForSession({ numberingIndex }, blocks, session);
    const numbered = blocks.flatMap((block) => (block.kind === 'paragraph' ? [block] : []));
    const edited = applyTreeOp(multiSectionDoc.part, {
      op: 'insertText',
      paragraphId: numbered[0]!.id,
      offset: 0,
      text: 'n',
    });
    if (!edited.ok) throw new Error(String(edited.issues));
    const freshIndex = loadNumbering(DECIMAL);
    const second = withResolvedListItemsForSession(
      { numberingIndex: freshIndex },
      storyBlocks(edited.part),
      session
    );
    expect(second.listItems).not.toBe(first.listItems!);
  });
});

function loadScaleNumberedDocument(paragraphCount: number): Uint8Array {
  const numberedPara = (text: string) =>
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const body =
    `<w:p><w:r><w:t>lead</w:t></w:r></w:p>` +
    Array.from({ length: paragraphCount }, (_, index) => numberedPara(`item ${index}`)).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(`<w:numbering xmlns:w="${W}">${DECIMAL}</w:numbering>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

describe('withResolvedListItems session warm path', () => {
  for (const size of WARM_SIZES) {
    test(
      `${size} blocks: proven text-local edits perform zero block visits`,
      () => {
        const recorder = listResolveBlockVisitTestRecorder();
        recorder.reset();
        const container = document.createElement('div');
        document.body.append(container);
        const opened = mountPaginatedSurface(container, loadScaleNumberedDocument(size), {
          scale: 1,
        });
        if (!opened.ok) throw new Error(opened.reason);
        const surface = opened.surface;
        try {
          surface.layout();
          expect(recorder.blockVisits).toBeGreaterThan(0);
          const session = surface.layoutSession();
          const listItemsBefore = listResolveSessionMemoListItemsForTest(session);
          expect(listItemsBefore).toBeDefined();
          const blocks = storyBlocks(surface.session.part());
          const leadParagraph = blocks.find((block) => block.kind === 'paragraph');
          expect(leadParagraph?.kind).toBe('paragraph');
          recorder.reset();
          surface.session.applyTreeOps([
            { op: 'insertText', paragraphId: leadParagraph!.id, offset: 0, text: 'x' },
          ]);
          surface.layout();
          expect(recorder.blockVisits).toBe(0);
          expect(listResolveSessionMemoListItemsForTest(session)).toBe(listItemsBefore);
        } finally {
          surface.destroy();
          container.remove();
        }
      },
      size >= 12_700 ? { timeout: 120_000 } : undefined
    );
  }

  test('numbering dependency changes fall back and recompute', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, loadScaleNumberedDocument(4), { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    try {
      surface.layout();
      const session = surface.layoutSession();
      const { numberingIndex } = createSurfaceStyleDeps(surface.session);
      const first = withResolvedListItemsForSession(
        { numberingIndex: numberingIndex() },
        storyBlocks(surface.session.part()),
        session
      );
      const freshIndex = buildNumberingIndex(surface.session.numberingRoot()!);
      const second = withResolvedListItemsForSession(
        { numberingIndex: freshIndex },
        storyBlocks(surface.session.part()),
        session
      );
      expect(second.listItems).not.toBe(first.listItems);
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});

describe('withResolvedListItems session resume', () => {
  const TWO_LISTS = `
    <w:abstractNum w:abstractNumId="1">
      <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
      <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/></w:lvl>
    </w:abstractNum>
    <w:abstractNum w:abstractNumId="2">
      <w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    <w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
  `;
  const item = (index: number) => {
    const numId = index % 7 === 0 ? 2 : 1;
    const ilvl = numId === 1 && index % 3 === 1 ? 1 : 0;
    return (
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
      `<w:r><w:t>item ${index}</w:t></w:r></w:p>`
    );
  };

  function longBody() {
    // More numbered paragraphs than several resume checkpoints, with plain ones between.
    const paragraphs = Array.from({ length: 900 }, (_, index) =>
      index % 11 === 5 ? `<w:p><w:r><w:t>plain ${index}</w:t></w:r></w:p>` : item(index)
    ).join('');
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>${paragraphs}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    return result.part;
  }

  const shape = (
    items: ReadonlyMap<string, { markerText: string; ilvl: number; numId: string }>
  ): string[] =>
    [...items].map(([id, entry]) => `${id}:${entry.numId}:${entry.ilvl}:${entry.markerText}`);

  test('every edit resumes to the items a fresh resolve gives', () => {
    const numberingIndex = loadNumbering(TWO_LISTS);
    const session = createLayoutSession();
    let part = longBody();
    withResolvedListItemsForSession({ numberingIndex }, storyBlocks(part), session);
    const paragraphAt = (index: number): string => {
      const root = part.root.children[0];
      if (!root || root.kind === 'textValue') throw new Error('no body');
      return root.children[index]!.id;
    };
    const edits = [
      () => ({ op: 'splitParagraph' as const, paragraphId: paragraphAt(620), offset: 2 }),
      () => ({
        op: 'setParagraphProperties' as const,
        paragraphId: paragraphAt(300),
        properties: [
          {
            localName: 'numPr',
            children: [
              { localName: 'ilvl', attributes: { val: '1' } },
              { localName: 'numId', attributes: { val: '1' } },
            ],
          },
        ],
      }),
      () => ({
        op: 'joinParagraphs' as const,
        firstId: paragraphAt(100),
        secondId: paragraphAt(101),
      }),
      () => ({ op: 'splitParagraph' as const, paragraphId: paragraphAt(3), offset: 1 }),
    ];
    for (const edit of edits) {
      const result = applyTreeOp(part, edit() as Parameters<typeof applyTreeOp>[1]);
      if (!result.ok) throw new Error(result.reason);
      part = result.part;
      const resumed = withResolvedListItemsForSession(
        { numberingIndex },
        storyBlocks(part),
        session
      );
      const fresh = withResolvedListItems({ numberingIndex }, storyBlocks(part));
      expect(shape(resumed.listItems!)).toEqual(shape(fresh.listItems!));
    }
  });

  test('a style that starts numbering a paragraph numbers it on the next resolve', () => {
    const cascade = (stylePr: string) => {
      const result = readOoxmlPart(
        `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="S">` +
          `<w:pPr>${stylePr}</w:pPr></w:style></w:styles>`,
        { name: '/word/styles.xml', contentType: 'app/xml' }
      );
      if (!result.ok) throw new Error(result.reason);
      return buildStyleCascadeTable(result.part.root);
    };
    const numberingIndex = loadNumbering(TWO_LISTS);
    const blocks = storyBlocks(longBody());
    const session = createLayoutSession();
    withResolvedListItemsForSession({ numberingIndex, styleCascade: cascade('') }, blocks, session);
    const styled = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:pPr><w:pStyle w:val="S"/></w:pPr><w:r><w:t>styled</w:t></w:r></w:p>' +
        '</w:body></w:document>',
      { name: '/word/styled.xml', contentType: 'app/xml' }
    );
    if (!styled.ok) throw new Error(styled.reason);
    const withStyled = [...storyBlocks(styled.part), ...blocks];
    const numbered = cascade('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
    withResolvedListItemsForSession(
      { numberingIndex, styleCascade: cascade('') },
      withStyled,
      session
    );
    const resumed = withResolvedListItemsForSession(
      { numberingIndex, styleCascade: numbered },
      withStyled,
      session
    );
    const fresh = withResolvedListItems({ numberingIndex, styleCascade: numbered }, withStyled);
    expect(shape(resumed.listItems!)).toEqual(shape(fresh.listItems!));
    expect(resumed.listItems!.get(withStyled[0]!.id)?.markerText).toBe('1.');
  });
});
