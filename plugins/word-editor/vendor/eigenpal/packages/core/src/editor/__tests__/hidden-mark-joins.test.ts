// Backspace and Delete at a break whose two sides hold, in the tree, paragraphs a hidden mark
// removed from the flow. The reader sees two neighbours, so the key joins them; the removed
// paragraphs between are absorbed instead of vetoing the join as non-adjacent.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  hiddenMarkRemovedIds,
  hiddenParagraphsBetween,
  shownPosition,
} from '../hidden-mark-joins.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const STYLES =
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:basedOn w:val="Normal"/><w:pPr><w:contextualSpacing/></w:pPr></w:style></w:styles>`;

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const hidden = '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr></w:p>';
const hiddenWithNote =
  '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:r><w:rPr><w:vanish/></w:rPr><w:t>note</w:t></w:r></w:p>';
const inCell = (content: string) =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${content}</w:tc></w:tr></w:tbl>${para('after')}`;

const mounted: { surface: PaginatedSurface; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { surface, container } of mounted.splice(0)) {
    surface.destroy();
    container.remove();
  }
});

function mount(
  body: string,
  author?: string,
  hiddenRevisionAuthors?: readonly string[]
): PaginatedSurface {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body), {
    scale: 1,
    ...(author ? { author } : {}),
    ...(hiddenRevisionAuthors ? { hiddenRevisionAuthors } : {}),
  });
  if (!opened.ok) throw new Error(opened.reason);
  mounted.push({ surface: opened.surface, container });
  return opened.surface;
}

function idOf(surface: PaginatedSurface, text: string): string {
  for (const id of surface.session.paragraphIds()) {
    if (paragraphTextOf(surface.session.part(), id) === text) return id;
  }
  throw new Error(`no paragraph ${text}`);
}

const texts = (surface: PaginatedSurface) =>
  surface.session.paragraphIds().map((id) => paragraphTextOf(surface.session.part(), id));

function caret(surface: PaginatedSurface, paragraphId: string, offset: number): void {
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

describe('Backspace and Delete across removed paragraphs', () => {
  for (const count of [1, 3]) {
    test(`Backspace joins across ${count} removed paragraph(s)`, () => {
      const surface = mount(para('Alpha') + hidden.repeat(count) + para('Beta'));
      caret(surface, idOf(surface, 'Beta'), 0);
      surface.deleteBackward();
      expect(texts(surface)).toEqual(['AlphaBeta']);
      expect(surface.state().lastRejection).toBeFalsy();
      const joined = idOf(surface, 'AlphaBeta');
      expect(surface.state().selection.head).toEqual({ paragraphId: joined, offset: 5 });
    });

    test(`Delete joins across ${count} removed paragraph(s)`, () => {
      const surface = mount(para('Alpha') + hidden.repeat(count) + para('Beta'));
      caret(surface, idOf(surface, 'Alpha'), 5);
      surface.deleteForward();
      expect(texts(surface)).toEqual(['AlphaBeta']);
      expect(surface.state().lastRejection).toBeFalsy();
    });
  }

  test('inside a table cell', () => {
    const surface = mount(inCell(para('Alpha') + hidden + hidden + para('Beta')));
    caret(surface, idOf(surface, 'Beta'), 0);
    surface.deleteBackward();
    expect(texts(surface)).toEqual(['AlphaBeta', 'after']);

    const other = mount(inCell(para('Alpha') + hidden + para('Beta')));
    caret(other, idOf(other, 'Alpha'), 5);
    other.deleteForward();
    expect(texts(other)).toEqual(['AlphaBeta', 'after']);
  });

  test('hidden text in a removed paragraph moves with the join and stays in the tree', () => {
    const surface = mount(para('Alpha') + hiddenWithNote + para('Beta'));
    caret(surface, idOf(surface, 'Beta'), 0);
    surface.deleteBackward();
    expect(texts(surface)).toEqual(['AlphanoteBeta']);
  });

  test('a selection across removed paragraphs deletes into one paragraph', () => {
    const surface = mount(para('Alpha') + hidden + hidden + para('Beta'));
    const alpha = idOf(surface, 'Alpha');
    const beta = idOf(surface, 'Beta');
    surface.setSelection({
      anchor: { paragraphId: alpha, offset: 3 },
      head: { paragraphId: beta, offset: 1 },
    });
    surface.deleteBackward();
    expect(texts(surface)).toEqual(['Alpeta']);
    expect(surface.state().lastRejection).toBeFalsy();
  });

  test('in suggesting mode, every mark on the way is proposed for deletion', async () => {
    const surface = mount(para('Alpha') + hidden + hidden + para('Beta'), 'Ada');
    surface.setEditingMode('suggest');
    caret(surface, idOf(surface, 'Beta'), 0);
    surface.deleteBackward();
    expect(surface.state().lastRejection).toBeFalsy();
    const xml = strFromU8(unzipSync(await surface.save())['word/document.xml']!);
    expect(xml.match(/<w:pPr><w:rPr><w:del /g)).toHaveLength(3);
    expect(texts(surface)).toEqual(['Alpha', '', '', 'Beta']);
  });

  // Something that is not a removed paragraph sits between, so the join cannot reach the next
  // laid-out paragraph. Delete absorbs only the removed paragraph right after the caret: the
  // edit it made when that paragraph was a blank line, and no visible change.
  for (const [label, between, view, after] of [
    ['a body-level marker', '<w:bookmarkEnd w:id="7"/>', 'all-markup', ['Alpha', 'Beta']],
    [
      'a paragraph the proposed view merges away',
      '<w:p><w:pPr><w:rPr><w:del w:id="5" w:author="X" w:date="2024-01-01T00:00:00Z"/></w:rPr></w:pPr></w:p>',
      'proposed',
      ['Alpha', '', 'Beta'],
    ],
  ] as const) {
    test(`Delete is not refused when ${label} follows a removed paragraph`, () => {
      const surface = mount(para('Alpha') + hidden + between + para('Beta'));
      surface.setRevisionDisplayMode(view);
      const lines = () =>
        surface
          .layout()
          .pages.flatMap((page) =>
            page.fragments.flatMap((fragment) =>
              fragment.kind === 'paragraph' ? fragment.lines : []
            )
          )
          .map((line) => line.spans.map((span) => span.text).join(''));
      const shown = lines();
      caret(surface, idOf(surface, 'Alpha'), 5);
      surface.deleteForward();
      expect(surface.state().lastRejection).toBeFalsy();
      expect(texts(surface)).toEqual([...after]);
      expect(lines()).toEqual(shown);
      expect(surface.state().selection.head).toEqual({
        paragraphId: idOf(surface, 'Alpha'),
        offset: 5,
      });
    });
  }

  test('a visible empty paragraph between is still its own line', () => {
    const surface = mount(para('Alpha') + '<w:p/>' + para('Beta'));
    caret(surface, idOf(surface, 'Beta'), 0);
    surface.deleteBackward();
    expect(texts(surface)).toEqual(['Alpha', 'Beta']);
  });
});

describe('contextual spacing across removed paragraphs while editing', () => {
  const first = '<w:p><w:pPr><w:spacing w:after="200"/></w:pPr><w:r><w:t>first</w:t></w:r></w:p>';
  const hiddenItem =
    '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:rPr><w:vanish/></w:rPr></w:pPr></w:p>';
  const second =
    '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:spacing w:before="240"/></w:pPr><w:r><w:t>second</w:t></w:r></w:p>';

  function gap(surface: PaginatedSurface): number {
    const lines = surface
      .layout()
      .pages.flatMap((page) =>
        page.fragments.flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
      );
    const line = (value: string) =>
      lines.find((candidate) => candidate.spans.map((span) => span.text).join('') === value)!.box;
    return Math.round((line('second').y - (line('first').y + line('first').height)) * 100) / 100;
  }

  test('removing the hidden neighbour updates the spacing it suppressed', () => {
    const surface = mount(first + hiddenItem + second);
    const cold = mount(first + second);
    const withHidden = gap(surface);
    expect(withHidden).toBeLessThan(gap(cold));

    const ids = surface.session.paragraphIds();
    const result = surface.session.applyTreeOps([
      { op: 'joinParagraphs', firstId: ids[0]!, secondId: ids[1]! },
    ]);
    expect(result.committed).toBe(true);
    expect(gap(surface)).toBe(gap(cold));
  });
});

describe('a paragraph that only this view removes', () => {
  // Its only content is a tracked change, so whether it shows depends on the view.
  const deletedOnly =
    '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:del w:id="9" w:author="X"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>';
  const insertedOnly =
    '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:ins w:id="9" w:author="X"><w:r><w:t>added</w:t></w:r></w:ins></w:p>';
  const cases = [
    { view: 'proposed', hiddenParagraph: deletedOnly, kept: '<w:delText>gone</w:delText>' },
    { view: 'original', hiddenParagraph: insertedOnly, kept: '<w:t>added</w:t>' },
  ] as const;

  async function savedXml(surface: PaginatedSurface): Promise<string> {
    return strFromU8(unzipSync(await surface.save())['word/document.xml']!);
  }

  for (const { view, hiddenParagraph, kept } of cases) {
    test(`${view}: Backspace, Delete, and a range delete join across it`, async () => {
      const lanes: ((surface: PaginatedSurface) => void)[] = [
        (surface) => {
          caret(surface, idOf(surface, 'Beta'), 0);
          surface.deleteBackward();
        },
        (surface) => {
          caret(surface, idOf(surface, 'Alpha'), 5);
          surface.deleteForward();
        },
        (surface) => {
          surface.setSelection({
            anchor: { paragraphId: idOf(surface, 'Alpha'), offset: 5 },
            head: { paragraphId: idOf(surface, 'Beta'), offset: 0 },
          });
          surface.deleteBackward();
        },
      ];
      for (const lane of lanes) {
        const surface = mount(para('Alpha') + hiddenParagraph + para('Beta'));
        surface.setRevisionDisplayMode(view);
        lane(surface);
        expect(surface.state().lastRejection).toBeFalsy();
        expect(surface.session.paragraphIds()).toHaveLength(1);
        // The tracked content the view hides moves with the join; it is not lost.
        expect(await savedXml(surface)).toContain(kept);
      }
    });
  }

  test('an author filter that resolves its only content removes it, and Delete joins across', async () => {
    const lines = (surface: PaginatedSurface) =>
      surface
        .layout()
        .pages.flatMap((page) =>
          page.fragments.flatMap((fragment) =>
            fragment.kind === 'paragraph' ? fragment.lines : []
          )
        )
        .map((line) => line.spans.map((span) => span.text).join(''));
    const shown = mount(para('Alpha') + deletedOnly + para('Beta'));
    expect(lines(shown)).toEqual(['Alpha', 'gone', 'Beta']);

    // All markup, with author X's changes hidden: X's deletion no longer shows.
    const surface = mount(para('Alpha') + deletedOnly + para('Beta'), undefined, ['X']);
    expect(lines(surface)).toEqual(['Alpha', 'Beta']);
    caret(surface, idOf(surface, 'Alpha'), 5);
    surface.deleteForward();
    expect(surface.state().lastRejection).toBeFalsy();
    expect(surface.session.paragraphIds()).toHaveLength(1);
    expect(await savedXml(surface)).toContain('<w:delText>gone</w:delText>');
  });

  test('all-markup shows it, so Backspace joins into it as an ordinary paragraph', () => {
    const surface = mount(para('Alpha') + deletedOnly + para('Beta'));
    caret(surface, idOf(surface, 'Beta'), 0);
    surface.deleteBackward();
    expect(surface.state().lastRejection).toBeFalsy();
    expect(surface.session.paragraphIds()).toHaveLength(2);
    expect(texts(surface)[0]).toBe('Alpha');
  });
});

describe('a caret left in a paragraph layout removes', () => {
  // A style separator: the heading's mark is hidden, so the heading runs into the next one.
  const heading = (text: string) =>
    `<w:p><w:pPr><w:rPr><w:specVanish/></w:rPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

  function focused(body: string): { surface: PaginatedSurface; container: HTMLElement } {
    const surface = mount(body);
    surface.focus();
    return { surface, container: mounted[mounted.length - 1]!.container };
  }
  const painted = (container: HTMLElement) => {
    const element = container.querySelector<HTMLElement>('.docx-editor-one-surface__caret');
    return element?.isConnected ? { left: element.style.left, top: element.style.top } : null;
  };
  const lineTexts = (surface: PaginatedSurface) =>
    surface
      .layout()
      .pages.flatMap((page) =>
        page.fragments.flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
      )
      .map((line) => line.spans.map((span) => span.text).join(''));

  test('Enter at the end of a paragraph with a hidden mark shows the caret where the join lands', () => {
    const { surface, container } = focused(heading('Head') + para('Body'));
    caret(surface, idOf(surface, 'Body'), 0);
    const atBody = painted(container);
    expect(atBody).not.toBeNull();

    caret(surface, idOf(surface, 'Head'), 4);
    surface.splitParagraph();
    expect(surface.state().lastRejection).toBeFalsy();
    expect(texts(surface)).toEqual(['Head', '', 'Body']);
    expect(lineTexts(surface)).toEqual(['Head', 'Body']);
    expect(painted(container)).toEqual(atBody);

    // Typing lands in the new paragraph, which then shows as its own line.
    surface.type('X');
    expect(texts(surface)).toEqual(['Head', 'X', 'Body']);
    expect(lineTexts(surface)).toEqual(['Head', 'X', 'Body']);
  });

  function emptied(): { surface: PaginatedSurface; container: HTMLElement } {
    const opened = focused(para('Top') + heading('Hd') + para('Body'));
    caret(opened.surface, idOf(opened.surface, 'Hd'), 2);
    opened.surface.deleteBackward();
    opened.surface.deleteBackward();
    expect(texts(opened.surface)).toEqual(['Top', '', 'Body']);
    expect(lineTexts(opened.surface)).toEqual(['Top', 'Body']);
    expect(painted(opened.container)).not.toBeNull();
    return opened;
  }

  function afterEnter(): { surface: PaginatedSurface; container: HTMLElement } {
    const opened = focused(para('Top') + heading('Head') + para('Body') + para('Tail'));
    caret(opened.surface, idOf(opened.surface, 'Head'), 4);
    opened.surface.splitParagraph();
    expect(texts(opened.surface)).toEqual(['Top', 'Head', '', 'Body', 'Tail']);
    return opened;
  }

  const head = (surface: PaginatedSurface) => surface.state().selection.head;

  test('Backspace after Enter removes the paragraph Enter made, and nothing else', () => {
    const { surface } = afterEnter();
    surface.deleteBackward();
    expect(surface.state().lastRejection).toBeFalsy();
    expect(texts(surface)).toEqual(['Top', 'Head', 'Body', 'Tail']);
    expect(head(surface)).toEqual({ paragraphId: idOf(surface, 'Head'), offset: 4 });
  });

  test('Enter twice then Backspace twice gives back the original paragraphs', () => {
    const { surface, container } = afterEnter();
    surface.splitParagraph();
    expect(texts(surface)).toEqual(['Top', 'Head', '', '', 'Body', 'Tail']);
    expect(painted(container)).not.toBeNull();
    surface.deleteBackward();
    expect(texts(surface)).toEqual(['Top', 'Head', '', 'Body', 'Tail']);
    surface.deleteBackward();
    expect(surface.state().lastRejection).toBeFalsy();
    expect(texts(surface)).toEqual(['Top', 'Head', 'Body', 'Tail']);
  });

  test('Backspace from an emptied one removes only that paragraph', () => {
    const { surface } = emptied();
    surface.deleteBackward();
    expect(surface.state().lastRejection).toBeFalsy();
    expect(texts(surface)).toEqual(['Top', 'Body']);
    expect(head(surface)).toEqual({ paragraphId: idOf(surface, 'Top'), offset: 3 });
  });

  test('word Backspace from an emptied one does the same', () => {
    const { surface } = emptied();
    surface.deleteWordBackward();
    expect(surface.state().lastRejection).toBeFalsy();
    expect(texts(surface)).toEqual(['Top', 'Body']);
  });

  test('Delete from an emptied one removes it and leaves the caret where it showed', () => {
    const { surface, container } = emptied();
    const before = painted(container);
    surface.deleteForward();
    expect(surface.state().lastRejection).toBeFalsy();
    expect(texts(surface)).toEqual(['Top', 'Body']);
    expect(head(surface)).toEqual({ paragraphId: idOf(surface, 'Body'), offset: 0 });
    expect(painted(container)).toEqual(before);
  });

  // Whatever sits between the removed paragraph and the one that takes its join, the caret
  // shows at, and moves from, the start of the paragraph layout actually keeps.
  for (const [label, between, view] of [
    ['a body-level marker', '<w:bookmarkEnd w:id="7"/>', 'all-markup'],
    [
      'a paragraph the proposed view removes',
      '<w:p><w:pPr><w:rPr><w:del w:id="5" w:author="X" w:date="2024-01-01T00:00:00Z"/></w:rPr></w:pPr></w:p>',
      'proposed',
    ],
  ] as const) {
    test(`Enter shows the caret at the next kept paragraph across ${label}`, () => {
      const open = () => {
        const opened = focused(para('Top') + heading('Head') + between + para('Body'));
        opened.surface.setRevisionDisplayMode(view);
        return opened;
      };
      const control = open();
      caret(control.surface, idOf(control.surface, 'Body'), 0);
      const atBody = painted(control.container);
      expect(atBody).not.toBeNull();

      const { surface, container } = open();
      caret(surface, idOf(surface, 'Head'), 4);
      surface.splitParagraph();
      expect(lineTexts(surface)).toEqual(['Top', 'Head', 'Body']);
      expect(painted(container)).toEqual(atBody);
      surface.navigate('right');
      expect(head(surface)).toEqual({ paragraphId: idOf(surface, 'Body'), offset: 1 });
    });
  }

  test('a marker before an emptied one: the caret shows, moves, and Backspace is not refused', () => {
    const open = () => {
      const opened = focused(
        para('Top') + '<w:bookmarkStart w:id="7" w:name="m"/>' + heading('Hd') + para('Body')
      );
      caret(opened.surface, idOf(opened.surface, 'Hd'), 2);
      opened.surface.deleteBackward();
      opened.surface.deleteBackward();
      expect(lineTexts(opened.surface)).toEqual(['Top', 'Body']);
      expect(painted(opened.container)).not.toBeNull();
      return opened;
    };
    const moving = open().surface;
    moving.navigate('right');
    expect(head(moving)).toEqual({ paragraphId: idOf(moving, 'Body'), offset: 1 });

    const { surface, container } = open();
    surface.deleteBackward();
    expect(surface.state().lastRejection).toBeFalsy();
    expect(painted(container)).not.toBeNull();
  });

  for (const [label, setup] of [
    ['after Enter', afterEnter],
    ['after emptying one', emptied],
  ] as const) {
    test(`paragraph formatting and the toolbar read where the caret shows, ${label}`, () => {
      const control = setup().surface;
      caret(control, idOf(control, 'Body'), 0);
      const expected = control.formatting();

      const surface = setup().surface;
      const removedParagraph = head(surface).paragraphId;
      expect(surface.formatting().fontSizeHalfPoints).toBe(expected.fontSizeHalfPoints);
      expect(surface.formatting().fontFamily).toBe(expected.fontFamily);
      surface.setParagraphProperty('jc', { val: 'center' });
      expect(surface.state().lastRejection).toBeFalsy();
      expect(surface.formatting().alignment).toBe('center');
      // Body took the alignment; the caret stays in the removed paragraph for typing.
      expect(head(surface).paragraphId).toBe(removedParagraph);
      caret(surface, idOf(surface, 'Body'), 0);
      expect(surface.formatting().alignment).toBe('center');
    });

    test(`a format armed at the caret applies to what is typed next, ${label}`, () => {
      const surface = setup().surface;
      surface.setRunProperty('b');
      surface.type('X');
      expect(texts(surface)).toContain('X');
      caret(surface, idOf(surface, 'X'), 1);
      expect(surface.formatting().bold).toBe(true);
    });

    test(`arrow keys move from where the caret shows, ${label}`, () => {
      const right = setup().surface;
      right.navigate('right');
      expect(head(right)).toEqual({ paragraphId: idOf(right, 'Body'), offset: 1 });

      const up = setup().surface;
      up.navigate('up');
      const above = label === 'after Enter' ? 'Head' : 'Top';
      expect(head(up).paragraphId).toBe(idOf(up, above));

      const extend = setup().surface;
      extend.navigate('right', true);
      const body = idOf(extend, 'Body');
      expect(extend.state().selection).toEqual({
        anchor: { paragraphId: body, offset: 0 },
        head: { paragraphId: body, offset: 1 },
      });
    });
  }
});

describe('hiddenParagraphsBetween', () => {
  const siblings = (body: string) => {
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const children = result.part.root.children[0]!.children;
    const ids = children.flatMap((child) => (child.kind === 'textValue' ? [] : [child.id]));
    return { children, ids };
  };

  const allMarkup = { displayMode: 'all-markup', authorFilter: undefined } as const;

  test('lists the removed paragraphs between two siblings', () => {
    const { children, ids } = siblings(para('a') + hidden + hidden + para('b'));
    const removed = () => hiddenMarkRemovedIds(children, allMarkup);
    expect([...removed()]).toEqual([ids[1], ids[2]]);
    expect(hiddenParagraphsBetween(children, ids[0]!, ids[3]!, removed)).toEqual([ids[1], ids[2]]);
    expect(hiddenParagraphsBetween(children, ids[0]!, ids[1]!, removed)).toEqual([]);
  });

  test('asks the view: a paragraph of only a tracked deletion leaves in proposed only', () => {
    const deletedOnly =
      '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:del w:id="9" w:author="X"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>';
    const { children, ids } = siblings(para('a') + deletedOnly + para('b'));
    expect([...hiddenMarkRemovedIds(children, allMarkup)]).toEqual([]);
    expect([
      ...hiddenMarkRemovedIds(children, { displayMode: 'proposed', authorFilter: undefined }),
    ]).toEqual([ids[1]]);
  });

  test('shownPosition moves only a position in a removed paragraph', () => {
    const surface = mount(para('a') + hidden + hidden + para('b') + hidden);
    const part = surface.session.part();
    const ids = surface.session.paragraphIds();
    const at = (index: number, offset = 0) =>
      shownPosition(surface.layout(), part, { paragraphId: ids[index]!, offset }, allMarkup);
    expect(at(1)).toEqual({ paragraphId: ids[3], offset: 0 });
    expect(at(2)).toEqual({ paragraphId: ids[3], offset: 0 });
    expect(at(0, 1)).toEqual({ paragraphId: ids[0], offset: 1 });
    // The last paragraph has nothing to join, so layout keeps it and it shows where it is.
    expect(at(4)).toEqual({ paragraphId: ids[4], offset: 0 });
  });

  test('refuses anything else between, and the wrong order', () => {
    const shown = '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:r><w:t>shown</w:t></w:r></w:p>';
    const { children, ids } = siblings(para('a') + shown + para('b'));
    const removed = () => hiddenMarkRemovedIds(children, allMarkup);
    expect(hiddenParagraphsBetween(children, ids[0]!, ids[2]!, removed)).toBeNull();
    expect(hiddenParagraphsBetween(children, ids[2]!, ids[0]!, removed)).toBeNull();
  });
});
