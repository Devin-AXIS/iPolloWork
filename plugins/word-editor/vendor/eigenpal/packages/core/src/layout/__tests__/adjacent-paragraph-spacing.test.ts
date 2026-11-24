// `w:doNotUseHTMLParagraphAutoSpacing` (§17.15.3): the space after one paragraph and the
// space before the next add up instead of collapsing to the larger of the two.
//
// Each paragraph carries 12pt before and 12pt after. Collapsed, the second line sits one line
// plus 12pt below the first; summed, one line plus 24pt.
//
// The setting also turns automatic spacing off (ISO/IEC 29500-1 §17.15.3): `w:beforeAutospacing`
// and `w:afterAutospacing` leave the authored measurement in place of the 14pt HTML paragraph
// margin, in lists, table cells and at story edges as well.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { compatibilityProfileFromSettings } from '../compatibility/compatibility-profile.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { layoutNoteStory } from '../note-layout.ts';
import { keepNextGroupHeight } from '../pagination-keeps.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import {
  paragraphFragmentsOf,
  type ParagraphFragmentRecord,
  type SemanticLayout,
} from '../semantic-records.ts';
import { paragraphSpacing } from '../paragraph-style.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = WML_NAMESPACE_URI;
const measurer = createFixedMeasurer(6, 14);
const FLAG = '<w:doNotUseHTMLParagraphAutoSpacing/>';

function read(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Other"><w:name w:val="Other"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Web"><w:name w:val="Web"/><w:pPr>` +
  `<w:spacing w:before="100" w:beforeAutospacing="1" w:after="100" w:afterAutospacing="1"/>` +
  `</w:pPr></w:style></w:styles>`;

const settingsPart = (compat: string) =>
  read(
    `<w:settings xmlns:w="${W}"><w:compat>${compat}</w:compat></w:settings>`,
    '/word/settings.xml'
  );

const cascade = (compat = '') =>
  buildStyleCascadeTable(
    read(STYLES, '/word/styles.xml').root,
    undefined,
    settingsPart(compat).root
  );

const paragraph = (text: string, spacing = 'w:before="240" w:after="240"', extra = '') =>
  `<w:p><w:pPr>${extra}<w:spacing ${spacing}/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const TWO = paragraph('One') + paragraph('Two');

function document(body: string): OoxmlPart {
  return read(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    '/word/document.xml'
  );
}

/** A paragraph in the automatic-spacing style, with optional extra paragraph properties. */
const web = (text: string, pPr = '') =>
  `<w:p><w:pPr><w:pStyle w:val="Web"/>${pPr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const NUMBERING = buildNumberingIndex(
  read(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">` +
      `<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
      `</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    '/word/numbering.xml'
  ).root
);

function layout(
  body: string,
  compat = '',
  height = 400,
  session?: ReturnType<typeof createLayoutSession>
): SemanticLayout {
  return layoutSemanticDocument(document(body), 1, {
    measurer,
    numberingIndex: NUMBERING,
    styleCascade: cascade(compat),
    geometry: { width: 400, height, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    ...(session ? { session } : {}),
  });
}

const firstLineY = (fragment: ParagraphFragmentRecord) => fragment.lines[0]!.box.y;

/** Distance between the first lines of body paragraphs `at` and `at + 1` on page one. */
function bodyPitch(body: string, compat = '', at = 0): number {
  const fragments = paragraphFragmentsOf(layout(body, compat).pages[0]!);
  return firstLineY(fragments[at + 1]!) - firstLineY(fragments[at]!);
}

function cellParagraphs(result: SemanticLayout): ParagraphFragmentRecord[] {
  const found: ParagraphFragmentRecord[] = [];
  for (const fragment of result.pages[0]!.fragments) {
    if (fragment.kind !== 'table') continue;
    for (const row of fragment.rows) {
      for (const cell of row.cells) {
        for (const block of cell.blocks) if (block.kind === 'paragraph') found.push(block);
      }
    }
  }
  return found;
}

const NO_SPACING = 'w:before="0" w:after="0"';
/** Line pitch with no paragraph spacing at all. */
const LINE = bodyPitch(paragraph('One', NO_SPACING) + paragraph('Two', NO_SPACING));

describe('reading the setting', () => {
  test('presence, and every ST_OnOff spelling', () => {
    const read = (compat: string) =>
      compatibilityProfileFromSettings(settingsPart(compat).root).has('fixedParagraphSpacing');
    expect(read('')).toBe(false);
    expect(read(FLAG)).toBe(true);
    for (const on of ['1', 'true', 'on']) {
      expect(read(`<w:doNotUseHTMLParagraphAutoSpacing w:val="${on}"/>`)).toBe(true);
    }
    for (const off of ['0', 'false', 'off']) {
      expect(read(`<w:doNotUseHTMLParagraphAutoSpacing w:val="${off}"/>`)).toBe(false);
    }
  });

  test('only a compat child of settings counts', () => {
    const outside = read(`<w:settings xmlns:w="${W}">${FLAG}</w:settings>`, '/word/settings.xml');
    expect(compatibilityProfileFromSettings(outside.root).has('fixedParagraphSpacing')).toBe(false);
    expect(compatibilityProfileFromSettings(null).has('fixedParagraphSpacing')).toBe(false);
  });

  test('the setting is part of the cascade cache identity; an off value is not', () => {
    expect(cascade(FLAG).cacheToken).not.toBe(cascade().cacheToken);
    expect(cascade('<w:doNotUseHTMLParagraphAutoSpacing w:val="0"/>').cacheToken).toBe(
      cascade().cacheToken
    );
  });

  test('the settings part keeps the element on save', () => {
    const part = settingsPart(FLAG);
    expect(serializeOoxmlPart(part)).toContain('doNotUseHTMLParagraphAutoSpacing');
  });
});

describe('body paragraphs', () => {
  test('collapse by default and add up with the setting', () => {
    expect(bodyPitch(TWO)).toBeCloseTo(LINE + 12, 6);
    expect(bodyPitch(TWO, FLAG)).toBeCloseTo(LINE + 24, 6);
    expect(bodyPitch(TWO, '<w:doNotUseHTMLParagraphAutoSpacing w:val="off"/>')).toBeCloseTo(
      LINE + 12,
      6
    );
  });

  test('unequal gaps add up instead of taking the larger one', () => {
    const body = paragraph('One', 'w:after="120"') + paragraph('Two', 'w:before="240"');
    expect(bodyPitch(body)).toBeCloseTo(LINE + 12, 6);
    expect(bodyPitch(body, FLAG)).toBeCloseTo(LINE + 18, 6);
  });

  test('the second paragraph publishes the before-spacing it applied', () => {
    const second = paragraphFragmentsOf(layout(TWO, FLAG).pages[0]!)[1]!;
    expect(second.spacing.before).toBe(12);
    expect(paragraphFragmentsOf(layout(TWO).pages[0]!)[1]!.spacing.before).toBe(0);
  });

  test('contextual spacing still removes the gap between same-style paragraphs', () => {
    const contextual = '<w:contextualSpacing/>';
    const same = paragraph('One', undefined, contextual) + paragraph('Two', undefined, contextual);
    expect(bodyPitch(same, FLAG)).toBeCloseTo(LINE, 6);
    const other = '<w:pStyle w:val="Other"/>';
    const mixed =
      paragraph('One', undefined, contextual) + paragraph('Two', undefined, other + contextual);
    expect(bodyPitch(mixed, FLAG)).toBeCloseTo(LINE + 24, 6);
  });

  test('before-spacing is still dropped at the top of a page the paragraph moved to', () => {
    // 12 + LINE + 12 leaves about 13pt on a 50pt page: not enough for 12pt before and a line.
    const result = layout(TWO, FLAG, 50);
    expect(result.pages).toHaveLength(2);
    const moved = paragraphFragmentsOf(result.pages[1]!)[0]!;
    expect(moved.spacing.before).toBe(0);
    expect(firstLineY(moved)).toBe(0);
  });

  test('a sum that no longer fits moves the paragraph where the collapsed gap fits', () => {
    // Collapsed, the second line ends 12pt above where the summed one does, either side of 60.
    expect(12 + LINE + 12 + LINE).toBeLessThan(60);
    expect(12 + LINE + 24 + LINE).toBeGreaterThan(60);
    expect(layout(TWO, '', 60).pages).toHaveLength(1);
    expect(layout(TWO, FLAG, 60).pages).toHaveLength(2);
  });

  test('a keep-with-next chain is priced with the summed gap', () => {
    // Priced collapsed, the chain would seem to fit and the kept paragraph would stay behind.
    const body =
      paragraph('One') + paragraph('Two', undefined, '<w:keepNext/>') + paragraph('Three');
    const pages = (compat: string) =>
      layout(body, compat, 92).pages.map((page) =>
        paragraphFragmentsOf(page).map((fragment) => fragment.lines[0]!.spans[0]!.text)
      );
    expect(pages('')).toEqual([['One', 'Two', 'Three']]);
    expect(pages(FLAG)).toEqual([['One'], ['Two', 'Three']]);
  });

  test('paragraphs sharing a frame add up with the setting', () => {
    const frame = '<w:framePr w:w="3000" w:hAnchor="page" w:vAnchor="page" w:x="400" w:y="400"/>';
    const body = paragraph('One', undefined, frame) + paragraph('Two', undefined, frame);
    expect(bodyPitch(body)).toBeCloseTo(LINE + 12, 6);
    expect(bodyPitch(body, FLAG)).toBeCloseTo(LINE + 24, 6);
  });

  test('a layout session does not reuse placement from the other rule', () => {
    const session = createLayoutSession();
    const body = TWO + paragraph('Three');
    for (const compat of ['', FLAG, '']) {
      const warm = layout(body, compat, 400, session);
      expect(warm.pages).toEqual(layout(body, compat).pages);
    }
  });
});

describe('other stories', () => {
  test('table cell paragraphs add up with the setting', () => {
    const table = `<w:tbl><w:tr><w:tc>${TWO}</w:tc></w:tr></w:tbl>`;
    const pitch = (compat: string) => {
      const [first, second] = cellParagraphs(layout(table, compat));
      return firstLineY(second!) - firstLineY(first!);
    };
    expect(pitch('')).toBeCloseTo(LINE + 12, 6);
    expect(pitch(FLAG)).toBeCloseTo(LINE + 24, 6);
  });

  test('header paragraphs add up with the setting', () => {
    const header = read(`<w:hdr xmlns:w="${W}">${TWO}</w:hdr>`, '/word/header1.xml');
    const pitch = (compat: string) => {
      const [first, second] = layoutHeaderFooterStory(
        header,
        400,
        measurer,
        'test',
        undefined,
        cascade(compat)
      ).fragments.filter((fragment) => fragment.kind === 'paragraph');
      return firstLineY(second!) - firstLineY(first!);
    };
    expect(pitch('')).toBeCloseTo(LINE + 12, 6);
    expect(pitch(FLAG)).toBeCloseTo(LINE + 24, 6);
  });
});

describe('keep-with-next pricing', () => {
  const keeps = (keepNext: boolean) => ({ keepNext, keepLines: false, widowControl: false });
  const blocks = [
    { kind: 'paragraph', spacing: { before: 12, after: 12 }, keeps: keeps(true) },
    { kind: 'paragraph', spacing: { before: 12, after: 12 }, keeps: keeps(false) },
  ];
  const lines = () => [{ height: 14 }];

  test('prices the summed gap between chain members', () => {
    expect(keepNextGroupHeight(blocks, 0, 0, lines)).toBe(12 + 14 + 12 + 14);
    expect(keepNextGroupHeight(blocks, 0, 0, lines, undefined, undefined, true)).toBe(
      12 + 14 + 12 + 12 + 14
    );
  });
});

describe('automatic spacing under the setting', () => {
  test('keeps the authored measurement on each side, outside and inside a list', () => {
    const props = [
      {
        localName: 'spacing',
        attributes: { before: '100', beforeAutospacing: '1', after: '300', afterAutospacing: '1' },
      },
    ];
    expect(paragraphSpacing(props)).toEqual({ before: 14, after: 14 });
    expect(paragraphSpacing(props, { fixedAutoSpacing: true })).toEqual({ before: 5, after: 15 });
    expect(paragraphSpacing(props, { fixedAutoSpacing: true, inList: true })).toEqual({
      before: 5,
      after: 15,
    });
  });

  test('an automatic side without a measurement keeps the inherited one, or none', () => {
    const flagOnly = [
      { localName: 'spacing', attributes: { after: '160' } },
      { localName: 'spacing', attributes: { beforeAutospacing: '1', afterAutospacing: '1' } },
    ];
    expect(paragraphSpacing(flagOnly, { fixedAutoSpacing: true })).toEqual({
      before: 0,
      after: 8,
    });
    const lines = [
      {
        localName: 'spacing',
        attributes: { before: '100', beforeLines: '200', beforeAutospacing: '1' },
      },
    ];
    expect(paragraphSpacing(lines, { fixedAutoSpacing: true }).before).toBe(24);
  });

  test('an inherited automatic style keeps its measurements, which add up', () => {
    const body = web('One') + web('Two');
    expect(bodyPitch(body)).toBeCloseTo(LINE + 14, 6);
    expect(bodyPitch(body, FLAG)).toBeCloseTo(LINE + 5 + 5, 6);
    const first = (compat: string) => paragraphFragmentsOf(layout(body, compat).pages[0]!)[0]!;
    // Only the substituted automatic gap is dropped at the top margin.
    expect(firstLineY(first(''))).toBeCloseTo(0, 6);
    expect(firstLineY(first(FLAG))).toBeCloseTo(5, 6);
  });

  test('a direct measurement overrides the inherited automatic side', () => {
    const body = web('One') + web('Two', '<w:spacing w:before="240" w:beforeAutospacing="0"/>');
    expect(bodyPitch(body)).toBeCloseTo(LINE + 14, 6);
    expect(bodyPitch(body, FLAG)).toBeCloseTo(LINE + 5 + 12, 6);
  });

  test('an automatic side and a measured side add up', () => {
    const explicitThenAuto = paragraph('One', 'w:after="120"') + web('Two');
    expect(bodyPitch(explicitThenAuto)).toBeCloseTo(LINE + 14, 6);
    expect(bodyPitch(explicitThenAuto, FLAG)).toBeCloseTo(LINE + 6 + 5, 6);
    const autoThenExplicit = web('One') + paragraph('Two', 'w:before="240"');
    expect(bodyPitch(autoThenExplicit)).toBeCloseTo(LINE + 14, 6);
    expect(bodyPitch(autoThenExplicit, FLAG)).toBeCloseTo(LINE + 5 + 12, 6);
  });

  test('items of one list keep their measured spacing between them', () => {
    const item = (text: string) =>
      web(text, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
    const body = item('One') + item('Two') + web('Three');
    expect(bodyPitch(body)).toBeCloseTo(LINE, 6);
    expect(bodyPitch(body, FLAG)).toBeCloseTo(LINE + 5 + 5, 6);
    // The list keeps its outer margin: the last item's after-spacing meets the next paragraph.
    expect(bodyPitch(body, '', 1)).toBeCloseTo(LINE + 14, 6);
    expect(bodyPitch(body, FLAG, 1)).toBeCloseTo(LINE + 5 + 5, 6);
  });

  test('a table cell keeps measured spacing at its edges and adds it between paragraphs', () => {
    const table = `<w:tbl><w:tr><w:tc>${web('One') + web('Two')}</w:tc></w:tr></w:tbl>`;
    const cell = (compat: string) => cellParagraphs(layout(table, compat));
    const [first, second] = cell(FLAG);
    expect(first!.spacing.before).toBe(5);
    expect(second!.spacing.after).toBe(5);
    expect(firstLineY(second!) - firstLineY(first!)).toBeCloseTo(LINE + 5 + 5, 6);
    const [base, next] = cell('');
    expect(base!.spacing.before).toBe(0);
    expect(next!.spacing.after).toBe(0);
    expect(firstLineY(next!) - firstLineY(base!)).toBeCloseTo(LINE + 14, 6);
  });

  test('a header keeps the measured space before its first paragraph', () => {
    const firstHeaderParagraph = (compat: string) =>
      layoutHeaderFooterStory(
        read(`<w:hdr xmlns:w="${W}">${web('One')}</w:hdr>`, '/word/header1.xml'),
        400,
        measurer,
        'test',
        undefined,
        cascade(compat)
      ).fragments.find((fragment) => fragment.kind === 'paragraph') as ParagraphFragmentRecord;
    expect(firstHeaderParagraph('').spacing.before).toBe(0);
    expect(firstHeaderParagraph(FLAG).spacing.before).toBe(5);
  });

  test('a footnote keeps the measured space at both of its edges', () => {
    const noteParagraphs = (compat: string) => {
      const notes = read(
        `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1">${web('One')}</w:footnote></w:footnotes>`,
        '/word/footnotes.xml'
      );
      const story = layoutNoteStory(notes.root.children[0]!, 400, {
        measurer,
        producer: 'test',
        styleCascade: cascade(compat),
      });
      return story!.fragments.filter(
        (fragment) => fragment.kind === 'paragraph'
      ) as ParagraphFragmentRecord[];
    };
    const [html] = noteParagraphs('');
    expect([html!.spacing.before, html!.spacing.after]).toEqual([0, 0]);
    const [fixed] = noteParagraphs(FLAG);
    expect([fixed!.spacing.before, fixed!.spacing.after]).toEqual([5, 5]);
  });
});

describe('automatic space before at the start of the document', () => {
  type Furniture = Parameters<typeof layoutSemanticDocument>[2]['furniture'];
  const first = (body: string, top = 50, furniture?: Furniture) =>
    paragraphFragmentsOf(
      layoutSemanticDocument(document(body), 1, {
        measurer,
        numberingIndex: NUMBERING,
        styleCascade: cascade(),
        geometry: {
          width: 400,
          height: 400,
          margin: { top, right: 0, bottom: 0, left: 0 },
          headerDistance: 10,
        },
        ...(furniture ? { furniture } : {}),
      }).pages[0]!
    );

  test('the first paragraph starts at the top margin, and later ones keep the gap', () => {
    const [one, two] = first(web('One') + web('Two'));
    expect(firstLineY(one!)).toBeCloseTo(0, 6);
    expect(firstLineY(two!) - firstLineY(one!)).toBeCloseTo(LINE + 14, 6);
  });

  test('an authored space before stays on the first paragraph', () => {
    const [one] = first(paragraph('One', 'w:before="240" w:after="0"') + web('Two'));
    expect(firstLineY(one!)).toBeCloseTo(12, 6);
  });

  test('a header that pushes the body down does not restore the automatic gap', () => {
    const header = layoutHeaderFooterStory(
      read(`<w:hdr xmlns:w="${W}">${TWO}${TWO}${TWO}</w:hdr>`, '/word/header1.xml'),
      400,
      measurer,
      'test',
      undefined,
      cascade()
    );
    const [one] = first(web('One'), 20, {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default', header]]),
      footers: new Map(),
    });
    // The body starts below the header, and the first line starts at the body top.
    expect(firstLineY(one!)).toBeCloseTo(0, 6);
  });
});
