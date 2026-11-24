import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession } from '../layout-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function read(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const p = (runs: string, height = 12) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${height * 20}" w:lineRule="exact"/></w:pPr><w:r>${runs}</w:r></w:p>`;
export function noticeFixture(
  notice: string | null,
  noticeHeight = 12,
  secondNote = false,
  noteLines = 6,
  noticeParagraphs = 1
) {
  const body =
    Array.from({ length: 47 }, (_, i) => p(`<w:t>Body ${i}</w:t>`)).join('') +
    p(
      '<w:t>Reference</w:t><w:footnoteReference w:id="2"/>' +
        (secondNote ? '<w:footnoteReference w:id="3"/>' : '') +
        '<w:br/><w:t>Required companion</w:t><w:br/><w:t>Following line</w:t><w:br/><w:t>Last line</w:t>'
    );
  const document = read(
    `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`,
    '/word/document.xml'
  );
  const footnotesPart = read(
    `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1">${p('<w:separator/>')}</w:footnote><w:footnote w:type="continuationSeparator" w:id="0">${p('<w:continuationSeparator/>')}</w:footnote>${notice === null ? '' : `<w:footnote w:type="continuationNotice" w:id="1">${Array.from({ length: noticeParagraphs }, () => p(`<w:t>${notice}</w:t>`, noticeHeight)).join('')}</w:footnote>`}<w:footnote w:id="2">${p(Array.from({ length: noteLines }, (_, i) => `${i ? '<w:br/>' : ''}<w:t>Note line ${i + 1}</w:t>`).join(''))}</w:footnote>${secondNote ? `<w:footnote w:id="3">${p('<w:t>Second note</w:t>')}</w:footnote>` : ''}</w:footnotes>`,
    '/word/footnotes.xml'
  );
  const fn = resolveFootnoteProperties();
  const en = resolveEndnoteProperties();
  const measurer = createFixedMeasurer(5, 12);
  const options = {
    measurer,
    session: createLayoutSession(),
    compatibilityMode: 15,
    notes: {
      footnotesPart,
      endnotesPart: null,
      documentFootnoteProps: fn,
      documentEndnoteProps: en,
      footnotePropsBySection: [fn],
      endnotePropsBySection: [en],
      measurer,
      compatibilityMode: 15,
      producer: 'continuation-notice',
    },
  };
  return { document, options };
}
