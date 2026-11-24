import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import {
  collectReviewItems,
  findNode,
  revisionItemsOf,
  reviewItemKey,
  serializeOoxmlPart,
} from '../../store/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STAMP = 'w:author="Ada" w:date="2026-03-01T10:00:00Z"';
const STYLES = `<w:styles xmlns:w="${W}">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Indented"><w:name w:val="Indented"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FirstLine"><w:name w:val="FirstLine"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Strong"><w:name w:val="Strong"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>
</w:styles>`;
const NUMBERING = `<w:numbering xmlns:w="${W}">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="1440" w:hanging="720"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const COMMENT = `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Grace" w:date="2026-03-02T10:00:00Z"><w:p><w:r><w:t>Why bold?</w:t></w:r></w:p></w:comment></w:comments>`;

function docx(body: string, comments = false, header?: string): Uint8Array {
  const rel = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const parts: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId1', 'officeDocument', 'word/document.xml')}</Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId1', 'styles', 'styles.xml')}${rel('rId2', 'numbering', 'numbering.xml')}${comments ? rel('rId3', 'comments', 'comments.xml') : ''}${header ? rel('rId4', 'header', 'header1.xml') : ''}</Relationships>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr>${header ? '<w:headerReference w:type="default" r:id="rId4"/>' : ''}</w:sectPr></w:body></w:document>`,
    'word/styles.xml': STYLES,
    'word/numbering.xml': NUMBERING,
    ...(comments ? { 'word/comments.xml': COMMENT } : {}),
    ...(header ? { 'word/header1.xml': `<w:hdr xmlns:w="${W}">${header}</w:hdr>` } : {}),
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])));
}

/** Full review derivations so far, across every mounted editor. */
let derivations = 0;

function mount(body: string, comments = false, header?: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    author: 'Ada',
    document: docx(body, comments, header),
    modules: [
      {
        id: 'review',
        review: {
          displayModes: ['all-markup', 'simple-markup', 'proposed', 'original'],
          collectReviewItems: (input) => {
            derivations += 1;
            return collectReviewItems(input);
          },
          revisionItemsOfParagraph: (part, id) => {
            const paragraph = findNode(part, id);
            return paragraph?.kind === 'paragraph'
              ? revisionItemsOf({ ...part, root: paragraph })
              : [];
          },
        },
      },
    ],
  });
  return {
    editor,
    container,
    count: () => editor.getReviewItems({ pairReplacements: false, placement: false }).length,
    xml: () => serializeOoxmlPart(editor.surface!.session.part()),
    [Symbol.dispose]: () => {
      editor.destroy();
      container.remove();
    },
  };
}

let id = 1;
const ppr = (current: string, previous: string) =>
  `<w:pPr>${current}<w:pPrChange w:id="${id++}" ${STAMP}><w:pPr>${previous}</w:pPr></w:pPrChange></w:pPr>`;
const rpr = (current: string, previous: string, text = 'text') =>
  `<w:r><w:rPr>${current}<w:rPrChange w:id="${id++}" ${STAMP}><w:rPr>${previous}</w:rPr></w:rPrChange></w:rPr><w:t>${text}</w:t></w:r>`;
const p = (properties: string, runs = '<w:r><w:t>text</w:t></w:r>') =>
  `<w:p>${properties}${runs}</w:p>`;
const style = (name: string) => `<w:pStyle w:val="${name}"/>`;
const list = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';

describe('property changes that change nothing', () => {
  for (const [name, body, listed] of [
    [
      'indent the style already sets',
      p(ppr(style('Indented') + '<w:ind w:left="720"/>', style('Indented'))),
      0,
    ],
    [
      'indent the style sets, removed',
      p(ppr(style('Indented'), style('Indented') + '<w:ind w:left="720"/>')),
      0,
    ],
    ['default alignment written out', p(ppr('<w:jc w:val="left"/>', '')), 0],
    [
      'indent the list level sets',
      p(ppr(list + '<w:ind w:left="1440" w:hanging="720"/>', list)),
      0,
    ],
    ['bold turned off where nothing set it', p('', rpr('<w:b w:val="0"/>', '')), 0],
    [
      'bold the paragraph style already sets',
      p(`<w:pPr>${style('Strong')}</w:pPr>`, rpr('<w:b/>', '')),
      0,
    ],
    ['a real indent', p(ppr(style('Indented') + '<w:ind w:left="1440"/>', style('Indented'))), 1],
    ['a list indent that differs', p(ppr(list + '<w:ind w:left="720" w:hanging="720"/>', list)), 1],
    ['a no-op beside a real change', p(ppr('<w:jc w:val="left"/><w:keepNext/>', '')), 1],
    [
      'bold turned off against a bold style',
      p(`<w:pPr>${style('Strong')}</w:pPr>`, rpr('<w:b w:val="0"/>', '')),
      1,
    ],
    ['a style change', p(ppr(style('Indented'), '<w:ind w:left="720"/>')), 1],
    [
      'different tab stops',
      p(
        ppr(
          '<w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs>',
          '<w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs>'
        )
      ),
      1,
    ],
    [
      'hanging zero over a style first-line indent',
      p(ppr(style('FirstLine') + '<w:ind w:hanging="0"/>', style('FirstLine'))),
      1,
    ],
    [
      'start zero over a style left indent',
      p(ppr(style('Indented') + '<w:ind w:start="0"/>', style('Indented'))),
      1,
    ],
    [
      'the start spelling of the style indent',
      p(ppr(style('Indented') + '<w:ind w:start="720"/>', style('Indented'))),
      0,
    ],
    ['an indent in character units', p(ppr('<w:ind w:leftChars="0"/>', '')), 1],
    ['snapping to the grid turned off', p(ppr('<w:snapToGrid w:val="0"/>', '')), 1],
    ['widow control turned off', p(ppr('<w:widowControl w:val="0"/>', '')), 1],
    [
      'a no-op inside a table',
      `<w:tbl><w:tr><w:tc>${p(ppr('<w:jc w:val="left"/>', ''))}</w:tc></w:tr></w:tbl>`,
      1,
    ],
  ] as const) {
    test(`${name}: ${listed === 0 ? 'not listed' : 'listed'}`, () => {
      using view = mount(body);
      expect(view.count()).toBe(listed);
    });
  }

  for (const action of ['accept', 'reject'] as const) {
    test(`${action} all clears an unlisted record with the listed ones`, () => {
      using view = mount(p(ppr('<w:jc w:val="left"/>', '')) + p(ppr('<w:jc w:val="center"/>', '')));
      expect(view.count()).toBe(1);
      const result = view.editor.exec({ type: 'resolveAllReviewChanges', action });
      expect(result.ok).toBe(true);
      expect(view.count()).toBe(0);
      expect(view.xml()).not.toContain('pPrChange');
    });
  }

  test('accept all shown clears the records of a shown author with nothing listed', () => {
    const grace = ppr('<w:jc w:val="left"/>', '').replace('w:author="Ada"', 'w:author="Grace"');
    using view = mount(p(grace) + p(ppr('<w:jc w:val="center"/>', '')));
    expect(view.editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }).ok).toBe(true);
    expect(view.xml()).not.toContain('pPrChange');
  });

  test('accept all shown keeps the records of a hidden author', () => {
    const grace = ppr('<w:jc w:val="left"/>', '').replace('w:author="Ada"', 'w:author="Grace"');
    using view = mount(p(grace) + p(ppr('<w:jc w:val="center"/>', '')));
    view.editor.setReviewAuthorVisible('Grace', false);
    expect(view.editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }).ok).toBe(true);
    expect(view.xml()).toContain('w:author="Grace"');
  });

  test('changing the author of all changes leaves unlisted records alone', () => {
    using view = mount(p(ppr('<w:jc w:val="left"/>', '')) + p(ppr('<w:jc w:val="center"/>', '')));
    const result = view.editor.exec({ type: 'setReviewChangesAuthor', author: 'Lin' });
    expect(result.ok).toBe(true);
    expect(view.xml().split('w:author="Lin"').length - 1).toBe(1);
    expect(view.xml()).toContain('w:author="Ada"');
  });

  test('a comment on an unlisted change stands on its own', () => {
    const run = rpr('<w:b w:val="0"/>', '', 'bold');
    using view = mount(
      `<w:p><w:commentRangeStart w:id="0"/>${run}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>`,
      true
    );
    const items = view.editor.getReviewItems({ pairReplacements: false, placement: false });
    expect(items).toHaveLength(1);
    expect(items[0]!.item).toMatchObject({ kind: 'comment' });
    expect(items[0]!.item).not.toHaveProperty('parentRevisionId');
  });

  test('an unlisted record paints no change bar and no format mark', () => {
    using view = mount(
      p(ppr('<w:jc w:val="left"/>', ''), '<w:r><w:t>unlisted paragraph</w:t></w:r>') +
        p(ppr('<w:jc w:val="center"/>', ''), '<w:r><w:t>listed paragraph</w:t></w:r>') +
        p('', rpr('<w:b w:val="0"/>', '', 'unlisted run'))
    );
    const formatBars = view.container.querySelectorAll('.docx-change-bar-format');
    expect(formatBars).toHaveLength(1);
    const marked = [...view.container.querySelectorAll<HTMLElement>('.docx-revision')].map(
      (element) => element.textContent
    );
    expect(marked.join('')).toContain('listed paragraph');
    expect(marked.join('')).not.toContain('unlisted');
  });

  test('an insertion around an unlisted change keeps its card and its mark', () => {
    const run = rpr('<w:b w:val="0"/>', '', 'added');
    using view = mount(
      `<w:p><w:r><w:t xml:space="preserve">kept </w:t></w:r><w:commentRangeStart w:id="0"/><w:ins w:id="${id++}" ${STAMP}>${run}</w:ins><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>`,
      true
    );
    const items = view.editor.getReviewItems({ pairReplacements: false, placement: false });
    expect(items.map((entry) => entry.item.kind)).toEqual(['revision', 'comment']);
    expect(items[0]!.item).toMatchObject({ revisionKind: 'insert', text: 'added' });
    const marked = [...view.container.querySelectorAll<HTMLElement>('.docx-revision')].map(
      (element) => element.textContent
    );
    expect(marked.join('')).toContain('added');
  });

  test('typing in a paragraph of a joined format change keeps one card with fresh ranges', () => {
    const later = 'w:author="Ada" w:date="2026-05-01T10:00:00Z"';
    const centered = (stamp: string) =>
      `<w:pPr><w:jc w:val="center"/><w:pPrChange w:id="${id++}" ${stamp}><w:pPr/></w:pPrChange></w:pPr>`;
    using view = mount(p(centered(STAMP)) + p(centered(later)) + p(centered(STAMP)));
    expect(view.count()).toBe(1);
    const paragraphId = view.editor.surface!.session.paragraphIds()[1]!;
    const at = { paragraphId, offset: 2 };
    view.editor.surface!.setSelection({ anchor: at, head: at });
    expect(view.editor.exec({ type: 'insertText', text: 'abc' }).ok).toBe(true);
    const listed = view.editor.surface!.session.reviewItems();
    const derived = collectReviewItems({ storyPart: view.editor.surface!.session.part() });
    expect(listed).toHaveLength(1);
    expect(listed.map((item) => (item.kind === 'revision' ? item.ranges : null))).toEqual(
      derived.map((item) => (item.kind === 'revision' ? item.ranges : null))
    );
  });

  test('accept all reports only the changes it listed', () => {
    using view = mount(p(ppr('<w:jc w:val="left"/>', '')) + p(ppr('<w:jc w:val="center"/>', '')));
    const result = view.editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' });
    expect(result).toMatchObject({ ok: true, revisions: { remaining: 0 } });
    expect((result as { revisions: { resolved: unknown[] } }).revisions.resolved).toHaveLength(1);
    expect(view.xml()).not.toContain('pPrChange');
  });

  test('a key that names an unlisted record still resolves it', () => {
    using view = mount(p(ppr('<w:jc w:val="left"/>', '')) + p(ppr('<w:jc w:val="center"/>', '')));
    const [hidden] = revisionItemsOf(view.editor.surface!.session.part());
    expect(hidden).toMatchObject({ formattingKind: 'pPrChange' });
    const result = view.editor.exec({
      type: 'resolveAllReviewChanges',
      action: 'accept',
      keys: [reviewItemKey(hidden!)],
    });
    expect(result).toMatchObject({ ok: true });
    expect(view.xml().split('pPrChange').length - 1).toBe(2);
    expect(view.count()).toBe(1);
  });

  test('accept all under a tracked change predicate leaves unlisted records pending', () => {
    using view = mount(p(ppr('<w:jc w:val="left"/>', '')) + p(ppr('<w:jc w:val="center"/>', '')));
    view.editor.setTrackedChangesFilter((item) => item.revisionKind === 'format');
    expect(view.editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }).ok).toBe(true);
    expect(view.xml()).toContain('pPrChange');
    expect(view.count()).toBe(0);
  });

  test('a suggestion typed in a group\u2019s first paragraph keeps the derived order', () => {
    const centered = () =>
      `<w:pPr><w:jc w:val="center"/><w:pPrChange w:id="${id++}" ${STAMP}><w:pPr/></w:pPrChange></w:pPr>`;
    using view = mount(p(centered()) + p(centered()) + p(centered()));
    const order = () =>
      view.editor
        .surface!.session.reviewItems()
        .map((item) => (item.kind === 'revision' ? item.revisionKind : item.kind));
    expect(order()).toEqual(['format']);
    view.editor.surface!.setEditingMode('suggest');
    const paragraphId = view.editor.surface!.session.paragraphIds()[0]!;
    const at = { paragraphId, offset: 1 };
    view.editor.surface!.setSelection({ anchor: at, head: at });
    expect(view.editor.exec({ type: 'insertText', text: 'z' }).ok).toBe(true);
    const derived = collectReviewItems({ storyPart: view.editor.surface!.session.part() });
    const expected = derived.map((item) =>
      item.kind === 'revision' ? item.revisionKind : item.kind
    );
    expect(expected).toEqual(['insert', 'format']);
    expect(order()).toEqual(expected);
  });

  test('an unlisted record in a header paints no change bar', () => {
    using view = mount(
      p('', '<w:r><w:t>Body</w:t></w:r>'),
      false,
      p(ppr('<w:jc w:val="left"/>', ''), '<w:r><w:t>Unlisted header</w:t></w:r>') +
        p(ppr('<w:jc w:val="center"/>', ''), '<w:r><w:t>Listed header</w:t></w:r>')
    );
    expect(view.count()).toBe(1);
    const header = view.container.querySelector<HTMLElement>('[data-docx-hf]');
    expect(header).not.toBeNull();
    expect(view.container.querySelectorAll('.docx-change-bar-format')).toHaveLength(1);
    const marked = [...view.container.querySelectorAll<HTMLElement>('.docx-revision')].map(
      (element) => element.textContent
    );
    expect(marked.join('')).toContain('Listed header');
    expect(marked.join('')).not.toContain('Unlisted');
  });

  test('Simple Markup draws no change bar for an unlisted record', () => {
    using view = mount(
      // Plain paragraphs between them: bars on touching lines merge into one.
      p(ppr('<w:jc w:val="left"/>', ''), '<w:r><w:t>unlisted paragraph</w:t></w:r>') +
        p('') +
        p(ppr('<w:jc w:val="center"/>', ''), '<w:r><w:t>listed paragraph</w:t></w:r>') +
        p('') +
        p('', rpr('<w:b w:val="0"/>', '', 'unlisted run'))
    );
    expect(view.editor.exec({ type: 'setReviewDisplayMode', mode: 'simple-markup' }).ok).toBe(true);
    expect(view.container.querySelectorAll('.docx-change-bar')).toHaveLength(1);
  });

  for (const [from, to, before, after] of [
    ['Normal', 'Strong', 0, 1],
    ['Strong', 'Normal', 1, 0],
  ] as const) {
    test(`Simple Markup follows a run record when its paragraph style changes (${from} to ${to})`, () => {
      using view = mount(
        p(`<w:pPr>${style(from)}</w:pPr>`, rpr('<w:b w:val="0"/>', '', 'run')) +
          p('') +
          // Another unlisted record, so the set of unlisted records never empties.
          p(ppr('<w:jc w:val="left"/>', ''), '<w:r><w:t>other</w:t></w:r>')
      );
      expect(view.editor.exec({ type: 'setReviewDisplayMode', mode: 'simple-markup' }).ok).toBe(
        true
      );
      expect(view.count()).toBe(before);
      expect(view.container.querySelectorAll('.docx-change-bar')).toHaveLength(before);
      const paragraphId = view.editor.surface!.session.paragraphIds()[0]!;
      const at = { paragraphId, offset: 1 };
      view.editor.surface!.setSelection({ anchor: at, head: at });
      expect(view.editor.exec({ type: 'setParagraphStyle', styleId: to }).ok).toBe(true);
      expect(view.count()).toBe(after);
      expect(view.container.querySelectorAll('.docx-change-bar')).toHaveLength(after);
    });
  }

  for (const [from, to, beforeBars, afterBars] of [
    ['Normal', 'Strong', 0, 2],
    ['Strong', 'Normal', 2, 0],
  ] as const) {
    test(`Simple Markup follows a record split over paragraphs when one changes (${from} to ${to})`, () => {
      // One record in two paragraphs: listed only while the second paragraph's site changes.
      const shared = `w:id="${id++}" ${STAMP}`;
      const run = (on: string, text: string) =>
        `<w:r><w:rPr>${on}<w:rPrChange ${shared}><w:rPr/></w:rPrChange></w:rPr><w:t>${text}</w:t></w:r>`;
      using view = mount(
        p('', run('<w:b w:val="0"/>', 'first')) +
          p('') +
          p(
            `<w:pPr>${style(from === 'Normal' ? 'Normal' : 'Strong')}</w:pPr>`,
            run('<w:b w:val="0"/>', 'second')
          ) +
          p('') +
          // Another unlisted record, so the set of unlisted records never empties.
          p(ppr('<w:jc w:val="left"/>', ''), '<w:r><w:t>other</w:t></w:r>')
      );
      expect(view.editor.exec({ type: 'setReviewDisplayMode', mode: 'simple-markup' }).ok).toBe(
        true
      );
      expect(view.container.querySelectorAll('.docx-change-bar')).toHaveLength(beforeBars);
      const paragraphId = view.editor.surface!.session.paragraphIds()[2]!;
      const at = { paragraphId, offset: 1 };
      view.editor.surface!.setSelection({ anchor: at, head: at });
      expect(view.editor.exec({ type: 'setParagraphStyle', styleId: to }).ok).toBe(true);
      expect(view.container.querySelectorAll('.docx-change-bar')).toHaveLength(afterBars);
    });
  }

  test('an edit that lists a record split over paragraphs marks every paragraph', () => {
    const shared = `w:id="${id++}" ${STAMP}`;
    const run = (text: string) =>
      `<w:r><w:rPr><w:b w:val="0"/><w:rPrChange ${shared}><w:rPr/></w:rPrChange></w:rPr><w:t>${text}</w:t></w:r>`;
    using view = mount(
      p('', run('first')) +
        p('') +
        p('', run('second')) +
        p('') +
        p(ppr('<w:jc w:val="left"/>', ''), '<w:r><w:t>other</w:t></w:r>')
    );
    expect(view.count()).toBe(0);
    expect(view.container.querySelectorAll('.docx-change-bar')).toHaveLength(0);
    const paragraphId = view.editor.surface!.session.paragraphIds()[2]!;
    view.editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 3 },
    });
    expect(view.editor.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
    expect(view.count()).toBe(1);
    expect(view.container.querySelectorAll('.docx-change-bar')).toHaveLength(2);
  });

  test('typing in an unlisted paragraph-property group keeps the fast patch', () => {
    const left = () => p(ppr('<w:jc w:val="left"/>', ''), '<w:r><w:t>member</w:t></w:r>');
    using view = mount(left() + left() + left() + left());
    expect(view.count()).toBe(0);
    const paragraphId = view.editor.surface!.session.paragraphIds()[1]!;
    const at = { paragraphId, offset: 2 };
    view.editor.surface!.setSelection({ anchor: at, head: at });
    const before = derivations;
    for (const text of ['a', 'b', 'c']) {
      expect(view.editor.exec({ type: 'insertText', text }).ok).toBe(true);
      expect(view.count()).toBe(0);
    }
    expect(derivations).toBe(before);
  });

  test('a record shared with a text box keeps its card', () => {
    const shared = `w:id="${id++}" ${STAMP}`;
    const run = (text: string) =>
      `<w:r><w:rPr><w:b w:val="0"/><w:rPrChange ${shared}><w:rPr/></w:rPrChange></w:rPr><w:t>${text}</w:t></w:r>`;
    const box =
      '<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" style="width:100pt;height:40pt"><v:textbox><w:txbxContent>' +
      `<w:p>${run('boxed')}</w:p>` +
      '</w:txbxContent></v:textbox></v:shape></w:pict></w:r>';
    using view = mount(p('', box) + p('') + p('', run('body')));
    expect(view.count()).toBe(1);
  });

  test('typing beside a record shared with a text box keeps its card', () => {
    const shared = `w:id="${id++}" ${STAMP}`;
    const run = (text: string) =>
      `<w:r><w:rPr><w:b w:val="0"/><w:rPrChange ${shared}><w:rPr/></w:rPrChange></w:rPr><w:t>${text}</w:t></w:r>`;
    const box =
      '<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" style="width:100pt;height:40pt"><v:textbox><w:txbxContent>' +
      `<w:p>${run('boxed')}</w:p>` +
      '</w:txbxContent></v:textbox></v:shape></w:pict></w:r>';
    using view = mount(p('', box) + p('') + p('', run('body')));
    expect(view.count()).toBe(1);
    const paragraphId = view.editor.surface!.session.paragraphIds()[2]!;
    const at = { paragraphId, offset: 2 };
    view.editor.surface!.setSelection({ anchor: at, head: at });
    expect(view.editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    expect(view.count()).toBe(1);
  });

  test('typing in the inert half of a listed shared paragraph change keeps both bars', () => {
    const shared = `w:id="${id++}" ${STAMP}`;
    const aligned = (value: string, text: string) =>
      `<w:p><w:pPr><w:jc w:val="${value}"/><w:pPrChange ${shared}><w:pPr/></w:pPrChange></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    using view = mount(aligned('left', 'left') + p('') + aligned('center', 'mid'));
    expect(view.count()).toBe(1);
    expect(view.container.querySelectorAll('.docx-change-bar')).toHaveLength(2);
    const paragraphId = view.editor.surface!.session.paragraphIds()[0]!;
    const at = { paragraphId, offset: 2 };
    view.editor.surface!.setSelection({ anchor: at, head: at });
    expect(view.editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    expect(view.count()).toBe(1);
    expect(view.container.querySelectorAll('.docx-change-bar')).toHaveLength(2);
    const live = view.editor.surface!.session.reviewItems();
    const derived = collectReviewItems({ storyPart: view.editor.surface!.session.part() });
    const ranges = (items: typeof live) =>
      items.map((item) => (item.kind === 'revision' ? item.ranges : null));
    expect(ranges(live)).toEqual(ranges(derived));
  });

  test('typing beside an insertion shared with a text box keeps it acceptable', () => {
    const shared = `w:id="${id++}" ${STAMP}`;
    const inserted = (text: string) => `<w:ins ${shared}><w:r><w:t>${text}</w:t></w:r></w:ins>`;
    const box =
      '<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" style="width:100pt;height:40pt"><v:textbox><w:txbxContent>' +
      `<w:p>${inserted('boxed')}</w:p>` +
      '</w:txbxContent></v:textbox></v:shape></w:pict></w:r>';
    using view = mount(
      p('', box) +
        p('') +
        p('', `<w:r><w:t xml:space="preserve">Body </w:t></w:r>${inserted('added')}`)
    );
    const paragraphId = view.editor.surface!.session.paragraphIds()[2]!;
    const at = { paragraphId, offset: 1 };
    view.editor.surface!.setSelection({ anchor: at, head: at });
    expect(view.editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    const keys = view.editor
      .getReviewItems({ pairReplacements: false, placement: false })
      .map((entry) => entry.key);
    expect(keys).toHaveLength(1);
    const result = view.editor.exec({ type: 'resolveAllReviewChanges', action: 'accept', keys });
    expect(result.ok).toBe(true);
    expect(view.xml()).not.toContain('<w:ins');
  });

  test('a suggestion typed in a text box gets its card', () => {
    const box =
      '<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" style="width:100pt;height:40pt"><v:textbox><w:txbxContent>' +
      '<w:p><w:r><w:t>boxed</w:t></w:r></w:p>' +
      '</w:txbxContent></v:textbox></v:shape></w:pict></w:r>';
    using view = mount(p('', box) + p('') + p(ppr('<w:jc w:val="center"/>', '')));
    expect(view.count()).toBe(1);
    const part = view.editor.surface!.session.part();
    const boxed = (() => {
      const visit = (node: (typeof part.root.children)[number], inBox: boolean): string | null => {
        if (node.kind === 'textValue') return null;
        if (inBox && node.kind === 'paragraph') return node.id;
        for (const child of node.children) {
          const found = visit(child, inBox || node.localName === 'txbxContent');
          if (found) return found;
        }
        return null;
      };
      return visit(part.root, false)!;
    })();
    view.editor.surface!.setEditingMode('suggest');
    const at = { paragraphId: boxed, offset: 2 };
    view.editor.surface!.setSelection({ anchor: at, head: at });
    expect(view.editor.exec({ type: 'insertText', text: 'Q' }).ok).toBe(true);
    const derived = collectReviewItems({ storyPart: view.editor.surface!.session.part() });
    expect(view.editor.surface!.session.reviewItems()).toHaveLength(derived.length);
    expect(derived.length).toBe(2);
  });

  test('typing in a text box with no revision keeps the cached queue', () => {
    const box =
      '<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" style="width:100pt;height:40pt"><v:textbox><w:txbxContent>' +
      '<w:p><w:r><w:t>boxed</w:t></w:r></w:p>' +
      '</w:txbxContent></v:textbox></v:shape></w:pict></w:r>';
    using view = mount(p('', box) + p('') + p(ppr('<w:jc w:val="center"/>', '')));
    expect(view.count()).toBe(1);
    const part = view.editor.surface!.session.part();
    const visit = (node: (typeof part.root.children)[number], inBox: boolean): string | null => {
      if (node.kind === 'textValue') return null;
      if (inBox && node.kind === 'paragraph') return node.id;
      for (const child of node.children) {
        const found = visit(child, inBox || node.localName === 'txbxContent');
        if (found) return found;
      }
      return null;
    };
    const at = { paragraphId: visit(part.root, false)!, offset: 2 };
    view.editor.surface!.setSelection({ anchor: at, head: at });
    const before = derivations;
    expect(view.editor.exec({ type: 'insertText', text: 'Q' }).ok).toBe(true);
    expect(view.count()).toBe(1);
    expect(derivations).toBe(before);
  });

  test('typing in the paragraph keeps the record unlisted', () => {
    using view = mount(p(ppr('<w:jc w:val="left"/>', '')) + p(ppr('<w:jc w:val="center"/>', '')));
    expect(view.count()).toBe(1);
    const paragraphId = view.editor.surface!.session.paragraphIds()[0]!;
    const at = { paragraphId, offset: 1 };
    view.editor.surface!.setSelection({ anchor: at, head: at });
    expect(view.editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(true);
    expect(view.editor.surface!.session.bodyText()).toContain('txext');
    expect(view.count()).toBe(1);
  });
});
