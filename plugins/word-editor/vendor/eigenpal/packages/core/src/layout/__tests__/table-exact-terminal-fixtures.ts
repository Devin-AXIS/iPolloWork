import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import type { OoxmlElement } from '../../store/package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export interface ExactTerminalOptions {
  width?: number;
  topWidth?: number;
  border?: string;
  rows?: number;
  columns?: number;
  rule?: 'exact' | 'atLeast' | 'auto';
  mixed?: boolean;
  horizontalPrefix?: boolean;
  verticalPrefix?: boolean;
  terminalMerge?: boolean;
  threeRowMerge?: boolean;
  otherColumnMerge?: boolean;
  middleNested?: boolean;
  middleVertical?: boolean;
  terminalSpan?: boolean;
  spacing?: boolean;
  header?: boolean;
  align?: 'top' | 'center' | 'bottom';
  lines?: number;
  pageHeight?: number;
  large?: boolean;
}

function paragraph(text: string, height = 12): string {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${height * 20}" w:lineRule="exact"/><w:widowControl w:val="0"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

export function exactTerminalFixture(options: ExactTerminalOptions = {}) {
  const rows = options.rows ?? 2;
  const columns = options.columns ?? 2;
  const width = options.width ?? 1.5;
  const edge = options.border ?? 'single';
  const columnWidth = Math.floor(3600 / columns);
  const widths = Array.from({ length: columns }, (_, i) =>
    i === columns - 1 ? 3600 - columnWidth * i : columnWidth
  );
  const borders = ['top', 'bottom', 'left', 'right']
    .map(
      (side) =>
        `<w:${side} w:val="${edge}" w:sz="${(side === 'top' ? (options.topWidth ?? width) : width) * 8}"/>`
    )
    .join('');
  let table = `<w:tbl><w:tblPr><w:tblW w:w="3600" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}<w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders><w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar>${options.spacing ? '<w:tblCellSpacing w:w="20" w:type="dxa"/>' : ''}</w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  for (let i = 0; i < rows; i++) {
    const rule = options.mixed && i < 2 ? 'atLeast' : (options.rule ?? 'exact');
    const height = options.mixed && i === 0 ? 477 : options.mixed && i === 1 ? 497 : 397;
    table += `<w:tr><w:trPr><w:cantSplit/>${options.header && i === 0 ? '<w:tblHeader/>' : ''}${rule === 'auto' ? '' : `<w:trHeight w:val="${height}" w:hRule="${rule}"/>`}</w:trPr>`;
    const spans =
      options.terminalSpan && i === rows - 1
        ? [columns]
        : options.horizontalPrefix && i === 0
          ? [1, columns - 1]
          : widths.map(() => 1);
    let column = 0;
    for (const span of spans) {
      const mergeColumn = options.otherColumnMerge ? 1 : 0;
      const start = options.terminalMerge ? rows - 2 : 0;
      const end = options.threeRowMerge ? 2 : start + 1;
      const merged =
        (options.verticalPrefix ||
          options.terminalMerge ||
          options.threeRowMerge ||
          options.otherColumnMerge) &&
        column === mergeColumn;
      const merge =
        merged && i === start
          ? '<w:vMerge w:val="restart"/>'
          : merged && i > start && i <= end
            ? '<w:vMerge/>'
            : '';
      let content = paragraph(
        merge === '<w:vMerge/>' ? '' : `${String.fromCharCode(65 + i)}${column + 1}`
      );
      if (options.lines && i === rows - 1) content += paragraph('Second') + paragraph('Third');
      if (options.large && i === 0)
        content = `<w:p>${'<w:r><w:t>x</w:t></w:r>'.repeat(4097)}</w:p>`;
      if (options.middleNested && i === 1 && column === 0) {
        content += `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="400"/></w:tblGrid><w:tr><w:tc>${paragraph('N')}</w:tc></w:tr></w:tbl>${paragraph('')}`;
      }
      table += `<w:tc><w:tcPr><w:tcW w:w="${widths.slice(column, column + span).reduce((a, b) => a + b, 0)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${merge}${options.middleVertical && i === 1 && column === 0 ? '<w:textDirection w:val="btLr"/>' : ''}<w:vAlign w:val="${options.align ?? 'center'}"/></w:tcPr>${content}</w:tc>`;
      column += span;
    }
    table += '</w:tr>';
  }
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${paragraph('CASE', 14)}${table}</w:tbl>${paragraph('AFTER')}<w:sectPr><w:pgSz w:w="10000" w:h="${options.pageHeight ?? 6000}"/><w:pgMar w:top="360" w:right="360" w:bottom="360" w:left="360"/></w:sectPr></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

export function tableNode(node: OoxmlElement): OoxmlElement {
  if (node.kind === 'table') return node;
  for (const child of node.children) {
    if (child.kind === 'textValue') continue;
    try {
      return tableNode(child);
    } catch {
      /* Try the next subtree. */
    }
  }
  throw new Error('The fixture has no table');
}
