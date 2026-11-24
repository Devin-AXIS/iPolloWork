import { zipSync, strToU8 } from 'fflate';

/** Independently authored files: the processor never calls the editor to produce output. */
export function refreshFixture(version = 0, large = false, tracked = false): Uint8Array {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const paragraphs = Array.from({ length: 40 }, (_, index) => {
    const text = `Section ${index + 1}: ${version > 0 && index === 12 ? 'Updated delivery date' : version > 1 && index === 24 ? 'Updated review date' : 'Project schedule'}.`;
    const run = `<w:r><w:t>${text}</w:t></w:r>`;
    return `<w:p w14:paraId="${(index + 1).toString(16).padStart(8, '0').toUpperCase()}"><w:pPr><w:spacing w:after="480"/></w:pPr>${tracked && index === 12 ? `<w:ins w:id="71" w:author="Processor" w:date="2030-01-01T00:00:00Z">${run}</w:ins>` : run}</w:p>`;
  }).join('');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${w}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`
    ),
  };
  // Inert bytes trigger the real deferred-load path without expensive layout fixtures.
  if (large)
    files['payload.bin'] = Uint8Array.from(
      { length: 530000 },
      (_, i) => (i * 71 + Math.floor(i / 97)) % 256
    );
  return zipSync(files, { level: 0 });
}
export const refreshMetadata = (version = 1) => [
  {
    id: 'delivery-date',
    location: { paragraphId: '0000000D', start: 12, end: 33, text: 'Updated delivery date' },
  },
  ...(version > 1
    ? [
        {
          id: 'review-date',
          location: { paragraphIndex: 24, start: 12, end: 31, text: 'Updated review date' },
        },
      ]
    : []),
];
