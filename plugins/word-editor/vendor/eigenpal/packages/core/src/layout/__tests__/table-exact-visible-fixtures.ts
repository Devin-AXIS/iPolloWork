import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const noMargins =
  '<w:tblPr><w:tblCellMar><w:top w:w="0"/><w:bottom w:w="0"/>' +
  '<w:left w:w="0"/><w:right w:w="0"/></w:tblCellMar></w:tblPr>';
export const p = (text: string, line = 380, indent = '') =>
  `<w:p><w:pPr><w:spacing w:line="${line}" w:lineRule="exact"/>${indent}</w:pPr>` +
  `<w:r><w:rPr><w:sz w:val="28"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
export const cell = (content: string, properties = '') => `<w:tc>${properties}${content}</w:tc>`;
export const exactRow = '<w:trPr><w:trHeight w:val="340" w:hRule="exact"/></w:trPr>';
export function fixture(rule = 'exact', content = p('甲')): OoxmlPart {
  const rows =
    `<w:tr><w:trPr><w:trHeight w:val="340" w:hRule="${rule}"/></w:trPr>` +
    cell(content) +
    '</w:tr>';
  return load(`<w:tbl>${noMargins}<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>${rows}</w:tbl>`);
}
export function load(body: string): OoxmlPart {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}
