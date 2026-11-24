import { strToU8, zipSync } from 'fflate';

/** Authored regression fixture: a paginated table whose checkbox SDTs wrap whole cells. */
export function cellCheckboxDocx(): Uint8Array {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const w14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
  const rows = Array.from(
    { length: 18 },
    (_, i) => `<w:tr><w:trPr><w:trHeight w:val="360"/><w:cantSplit/></w:trPr>
    <w:sdt><w:sdtPr><w:id w:val="${i + 1}"/><w14:checkbox><w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr><w:sdtEndPr/><w:sdtContent>
      <w:tc><w:tcPr><w:tcW w:w="434" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/></w:tcBorders></w:tcPr>
        <w:p w:rsidR="00FA4ED4"><w:pPr><w:spacing w:after="0"/></w:pPr><w:r w:rsidRPr="00D55315"><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic"/></w:rPr><w:t>☐</w:t></w:r></w:p>
      </w:tc>
    </w:sdtContent></w:sdt>
    <w:tc><w:tcPr><w:tcW w:w="7566" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:t>Questionnaire option ${i + 1}</w:t></w:r></w:p></w:tc>
  </w:tr>`
  ).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${w}" xmlns:w14="${w14}"><w:body><w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="434"/><w:gridCol w:w="7566"/></w:tblGrid>${rows}</w:tbl><w:sectPr><w:pgSz w:w="10000" w:h="5000"/><w:pgMar w:top="500" w:right="500" w:bottom="500" w:left="500"/></w:sectPr></w:body></w:document>`
    ),
  });
}
