// Fixtures shared by the table-row keep-with-next tests.
//
// The page shape is 350pt by 210pt with 20pt margins: a 170pt body that holds twelve exact
// 14pt lines. Eight preamble lines leave four.

import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import type { BlockFragmentRecord, SemanticLayout } from '../semantic-records.ts';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export function read(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

export const SECT =
  '<w:sectPr><w:pgSz w:w="7000" w:h="4200"/><w:pgMar w:top="400" w:bottom="400" ' +
  'w:left="400" w:right="400" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
/**
 * A body ends with a paragraph. One a body ending with a table lacks is written here, as files
 * write it, so a reparse gives it the same id as the first read.
 */
export const endsWithParagraph = (body: string): string =>
  body.endsWith('</w:tbl>') ? `${body}<w:p/>` : body;

export const load = (body: string) =>
  read(
    `<w:document xmlns:w="${W}"><w:body>${endsWithParagraph(body)}${SECT}</w:body></w:document>`,
    '/word/document.xml'
  );

// `Kept` inherits `w:keepNext` through `basedOn`; `KeepTable` states it in its table style.
export const styleCascade = buildStyleCascadeTable(
  read(
    `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="KeepBase"><w:basedOn w:val="Normal"/>' +
      '<w:pPr><w:keepNext/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Kept"><w:basedOn w:val="KeepBase"/></w:style>' +
      '<w:style w:type="table" w:styleId="KeepTable"><w:pPr><w:keepNext/></w:pPr></w:style>' +
      '</w:styles>',
    '/word/styles.xml'
  ).root
);

export const measurer = createFixedMeasurer(6, 14);
export const lay = (part: OoxmlPart, compatibilityMode = 15, extra: object = {}): SemanticLayout =>
  layoutSemanticDocument(part, 1, { measurer, styleCascade, compatibilityMode, ...extra });

export interface ParaOptions {
  readonly keep?: boolean | 'off';
  readonly keepLines?: boolean;
  readonly pageBreakBefore?: boolean;
  readonly widow?: boolean;
  readonly style?: string;
}

/** One paragraph of `count` lines named `${name}1` to `${name}N`, via hard breaks. */
export const para = (name: string, count = 1, options: ParaOptions = {}) => {
  const pPr =
    (options.style ? `<w:pStyle w:val="${options.style}"/>` : '') +
    (options.keep === true
      ? '<w:keepNext/>'
      : options.keep === 'off'
        ? '<w:keepNext w:val="0"/>'
        : '') +
    (options.keepLines ? '<w:keepLines/>' : '') +
    (options.pageBreakBefore ? '<w:pageBreakBefore/>' : '') +
    (options.widow ? '' : '<w:widowControl w:val="0"/>') +
    '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>';
  const runs = Array.from({ length: count }, (_, i) => `<w:t>${name}${i + 1}</w:t>`);
  return `<w:p><w:pPr>${pPr}</w:pPr><w:r>${runs.join('<w:br/>')}</w:r></w:p>`;
};

export const cell = (content: string, tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${tcPr}</w:tcPr>${content}</w:tc>`;

export interface RowOptions {
  /** Lines of the first cell's paragraph. */
  readonly lines?: number;
  /** `w:keepNext` on the first and second cell's paragraph. */
  readonly keep?: readonly [boolean, boolean];
  readonly cantSplit?: boolean;
  readonly header?: boolean;
  readonly exactTwips?: number;
  /** Replaces the first cell's content. */
  readonly first?: string;
  readonly firstTcPr?: string;
}

export const row = (name: string, options: RowOptions = {}) => {
  const trPr =
    (options.cantSplit ? '<w:cantSplit/>' : '') +
    (options.header ? '<w:tblHeader/>' : '') +
    (options.exactTwips ? `<w:trHeight w:val="${options.exactTwips}" w:hRule="exact"/>` : '');
  const [keepFirst, keepSecond] = options.keep ?? [false, false];
  const first = options.first ?? para(`${name}c1-`, options.lines ?? 1, { keep: keepFirst });
  return (
    `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}` +
    cell(first, options.firstTcPr) +
    cell(para(`${name}c2-`, 1, { keep: keepSecond })) +
    '</w:tr>'
  );
};

export const table = (rows: readonly string[], tblPr = '') =>
  `<w:tbl><w:tblPr>${tblPr}<w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
  `<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${rows.join('')}</w:tbl>`;

export const ALL = [true, true] as const;
export const FIRST = [true, false] as const;
export const LAST = [false, true] as const;
export const P8 = para('P', 8);
export const TAIL = para('TAIL');
export const R4 = row('R4', { lines: 2, cantSplit: true });

/** Every line text of a block, in reading order: rows, then cells, then lines. */
export const blockText = (block: BlockFragmentRecord): string[] =>
  block.kind === 'paragraph'
    ? block.lines
        .map((line) =>
          line.spans
            .map((span) => span.text)
            .join('')
            .trim()
        )
        .filter((text) => text !== '')
    : block.rows.flatMap((placed) => placed.cells.flatMap((c) => c.blocks.flatMap(blockText)));
export const pages = (layout: SemanticLayout): string[] =>
  layout.pages.map((page) => page.fragments.flatMap(blockText).join(' '));
