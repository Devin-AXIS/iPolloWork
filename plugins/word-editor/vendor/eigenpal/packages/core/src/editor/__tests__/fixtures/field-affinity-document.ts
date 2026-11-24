import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
export const FIELD_AFFINITY_RESULTS = [
  ['hard breaks', '<w:t>aaa</w:t><w:br/><w:t>bbb</w:t><w:br/><w:t>ccc</w:t>'],
  ['soft wraps', '<w:t>' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(14) + '</w:t>'],
] as const;

export function fieldAffinityDocument(result: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:fldSimple w:instr="QUOTE x"><w:r><w:rPr><w:sz w:val="22"/></w:rPr>' +
        result +
        '</w:r></w:fldSimple></w:p></w:body></w:document>'
    ),
  });
}
