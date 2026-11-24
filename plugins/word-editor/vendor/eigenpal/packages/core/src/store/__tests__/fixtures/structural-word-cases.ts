/** Synthetic interoperability inputs. No customer document content. */
export const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export interface StructuralWordCase {
  name: string;
  body: string;
}
let revisionId = 10;
const attr = () => `w:id="${revisionId++}" w:author="Audit" w:date="2026-01-02T03:04:05Z"`;
const mark = (name: string, extra = '') => `<w:${name} ${attr()} ${extra}/>`;
const run = (text: string, pr = '', deleted = false) =>
  `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:${deleted ? 'delText' : 't'} xml:space="preserve">${text}</w:${deleted ? 'delText' : 't'}></w:r>`;
const p = (text: string, pr = '') => `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}${run(text)}</w:p>`;
const wrap = (name: string, contents: string) => `<w:${name} ${attr()}>${contents}</w:${name}>`;
const history = (name: string, prior: string) =>
  `<w:${name}Change ${attr()}><w:${name}>${prior}</w:${name}></w:${name}Change>`;
const cell = (text: string, pr = '', width = 2000) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${pr}</w:tcPr>${p(text)}</w:tc>`;
const row = (cells: string, pr = '') =>
  `<w:tr>${pr ? `<w:trPr>${pr}</w:trPr>` : ''}${cells}</w:tr>`;
const table = (rows: string, widths = [2000, 2000], pr = '') =>
  `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>${pr}</w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
const cases: StructuralWordCase[] = [];
const add = (name: string, body: string) => cases.push({ name, body });
for (const kind of ['ins', 'del']) {
  add(
    `paragraph-${kind}`,
    p('First', `<w:jc w:val="right"/><w:rPr>${mark(kind)}</w:rPr>`) +
      p('Second', '<w:jc w:val="center"/>')
  );
  add(`empty-paragraph-${kind}`, p('', `<w:rPr>${mark(kind)}</w:rPr>`) + p('Survivor'));
  add(
    `consecutive-paragraph-${kind}`,
    p('One', `<w:rPr>${mark(kind)}</w:rPr>`) + p('Two', `<w:rPr>${mark(kind)}</w:rPr>`) + p('Three')
  );
  add(
    `paragraph-before-table-${kind}`,
    p('Before', `<w:rPr>${mark(kind)}</w:rPr>`) +
      table(row(cell('Left') + cell('Right'))) +
      p('After')
  );
  add(
    `paragraph-in-cell-${kind}`,
    table(
      row(
        `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${p('First', `<w:rPr>${mark(kind)}</w:rPr>`)}${p('Second')}</w:tc>` +
          cell('Neighbour')
      )
    )
  );
  add(
    `paragraph-properties-${kind}`,
    p(
      'First',
      `<w:jc w:val="right"/><w:rPr>${mark(kind)}</w:rPr>${history('pPr', '<w:jc w:val="left"/>')}`
    ) + p('Second', '<w:jc w:val="center"/>')
  );
  add(
    `section-break-${kind}`,
    p(
      'Before section',
      `<w:rPr>${mark(kind)}</w:rPr><w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:gutter="0" w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360"/></w:sectPr>`
    ) + p('After section')
  );
  add(
    `inline-field-${kind}`,
    `<w:p><w:fldSimple w:instr=" MERGEFIELD audit ">${wrap(kind, run('Field value', '', kind === 'del'))}</w:fldSimple>${run(' tail')}</w:p>`
  );
  add(
    `hyperlink-${kind}`,
    `<w:p><w:hyperlink r:id="rLink">${wrap(kind, run('Link text', '', kind === 'del'))}</w:hyperlink>${run(' tail')}</w:p>`
  );
  add(
    `note-reference-${kind}`,
    `<w:p>${run('Note anchor ')}${wrap(kind, `<w:r><w:footnoteReference w:id="${kind === 'ins' ? 2 : 3}"/></w:r>`)}</w:p>`
  );
  add(
    `bookmarked-text-${kind}`,
    `<w:p><w:bookmarkStart w:id="${revisionId}" w:name="audit${revisionId}"/>${wrap(kind, run('Bookmarked', '', kind === 'del'))}<w:bookmarkEnd w:id="${revisionId - 1}"/>${run(' tail')}</w:p>`
  );
}
add(
  'paragraph-format',
  p(
    'Formatting',
    '<w:keepNext/><w:spacing w:before="240" w:after="120"/><w:jc w:val="right"/>' +
      history('pPr', '<w:keepLines/><w:spacing w:after="300"/><w:jc w:val="center"/>')
  )
);
add(
  'run-format',
  `<w:p>${run('Formatted', '<w:b/><w:color w:val="CC0000"/><w:sz w:val="32"/>' + history('rPr', '<w:i/><w:color w:val="0000CC"/><w:sz w:val="24"/>'))}</w:p>`
);
add(
  'section-format',
  p(
    'Section formatting',
    '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/><w:type w:val="continuous"/><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:gutter="0" w:top="1080" w:right="720" w:bottom="1080" w:left="720" w:header="360" w:footer="360"/><w:cols w:num="2" w:space="360"/>' +
      history(
        'sectPr',
        '<w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:gutter="0" w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360"/><w:cols w:space="720"/>'
      ) +
      '</w:sectPr>'
  )
);
add(
  'section-empty-history',
  p(
    'Default section',
    '<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>' +
      mark('sectPrChange') +
      '</w:sectPr>'
  )
);
add(
  'numbering-insertion',
  p(
    'Numbered item',
    '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/>' + mark('ins') + '</w:numPr>'
  )
);
add(
  'numbering-property-history',
  p(
    'Numbering history',
    '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' +
      history('pPr', '<w:jc w:val="center"/>')
  )
);
add(
  'numbering-insertion-and-history',
  p(
    'Numbering insertion history',
    '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/>' +
      mark('ins') +
      '</w:numPr>' +
      history('pPr', '<w:jc w:val="center"/>')
  )
);
for (const kind of ['ins', 'del']) {
  add(
    `sdt-contained-${kind}`,
    `<w:sdt><w:sdtPr><w:tag w:val="inner-${kind}"/></w:sdtPr><w:sdtContent><w:p>${wrap(kind, run('Controlled', '', kind === 'del'))}</w:p></w:sdtContent></w:sdt>`
  );
  add(
    `nested-table-${kind}`,
    table(
      row(
        `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${table(row(cell('Nested'), mark(kind)), [2000])}${p('Tail')}</w:tc>` +
          cell('Outside')
      )
    )
  );
  add(
    `row-span-${kind}`,
    table(
      row(cell('Spanning', '<w:gridSpan w:val="2"/>', 4000), mark(kind)) +
        row(cell('Left') + cell('Right'))
    )
  );
  add(
    `tracked-content-in-row-${kind}`,
    table(
      row(
        cell('Cell').replace(
          run('Cell'),
          wrap('ins', run('Inserted')) + wrap('del', run('Deleted', '', true))
        ) + cell('Other'),
        mark(kind)
      ) + row(cell('Baseline') + cell('Baseline2'))
    )
  );
}
add(
  'table-properties',
  table(
    row(cell('Left') + cell('Right')),
    [2000, 2000],
    '<w:jc w:val="right"/><w:tblCellMar><w:left w:w="180" w:type="dxa"/></w:tblCellMar>' +
      history('tblPr', '<w:tblW w:w="4000" w:type="dxa"/><w:jc w:val="center"/>')
  )
);
add(
  'row-properties',
  table(
    row(
      cell('Left') + cell('Right'),
      '<w:cantSplit/><w:trHeight w:val="720" w:hRule="atLeast"/>' +
        history('trPr', '<w:trHeight w:val="360" w:hRule="exact"/>')
    )
  )
);
add(
  'cell-properties',
  table(
    row(
      cell(
        'Left',
        '<w:shd w:val="clear" w:fill="FFFF00"/><w:vAlign w:val="bottom"/>' +
          history(
            'tcPr',
            '<w:tcW w:w="2000" w:type="dxa"/><w:shd w:val="clear" w:fill="00FFFF"/><w:vAlign w:val="center"/>'
          )
      ) + cell('Right')
    )
  )
);
const moveName = 'auditMove';
const sourceRange = revisionId++;
const targetRange = revisionId++;
add(
  'paired-move',
  `<w:p><w:moveFromRangeStart w:id="${sourceRange}" w:name="${moveName}" w:author="Audit" w:date="2026-01-02T03:04:05Z"/>${wrap('moveFrom', run('Moved'))}<w:moveFromRangeEnd w:id="${sourceRange}"/></w:p>${p('Between')}<w:p><w:moveToRangeStart w:id="${targetRange}" w:name="${moveName}" w:author="Audit" w:date="2026-01-02T03:04:05Z"/>${wrap('moveTo', run('Moved'))}<w:moveToRangeEnd w:id="${targetRange}"/></w:p>`
);
export const structuralWordCases: readonly StructuralWordCase[] = cases;
export function structuralWordXmlParts(
  selectedCases: readonly StructuralWordCase[] = cases
): Record<string, string> {
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
  return {
    '[Content_Types].xml': xml(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>${['styles', 'numbering', 'settings', 'footnotes', 'header'].map((type) => `<Override PartName="/word/${type}${type === 'header' ? '1' : ''}.xml" ContentType="${CT}.${type}+xml"/>`).join('')}</Types>`
    ),
    '_rels/.rels': xml(
      `<Relationships xmlns="${REL}"><Relationship Id="rMain" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': xml(
      `<Relationships xmlns="${REL}">${['styles', 'numbering', 'settings', 'footnotes'].map((type) => `<Relationship Id="r${type}" Type="${R}/${type}" Target="${type}.xml"/>`).join('')}<Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/><Relationship Id="rLink" Type="${R}/hyperlink" Target="https://example.com/audit" TargetMode="External"/></Relationships>`
    ),
    'word/document.xml': xml(
      `<w:document xmlns:w="${WORD_NS}" xmlns:r="${R}"><w:body>${selectedCases.map((c, i) => `<w:sdt><w:sdtPr><w:alias w:val="${c.name}"/><w:tag w:val="audit:${c.name}"/><w:id w:val="${1000 + i}"/></w:sdtPr><w:sdtContent>${p('CASE ' + c.name)}${c.body}${p('END ' + c.name)}</w:sdtContent></w:sdt>`).join('')}<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:gutter="0" w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360"/></w:sectPr></w:body></w:document>`
    ),
    'word/styles.xml': xml(
      `<w:styles xmlns:w="${WORD_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`
    ),
    'word/settings.xml': xml(
      `<w:settings xmlns:w="${WORD_NS}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`
    ),
    'word/header1.xml': xml(`<w:hdr xmlns:w="${WORD_NS}">${p('Structural audit header')}</w:hdr>`),
    'word/footnotes.xml': xml(
      `<w:footnotes xmlns:w="${WORD_NS}"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${[2, 3].map((id) => `<w:footnote w:id="${id}">${p('Note ' + id)}</w:footnote>`).join('')}</w:footnotes>`
    ),
    'word/numbering.xml': xml(
      `<w:numbering xmlns:w="${WORD_NS}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`
    ),
  };
}
