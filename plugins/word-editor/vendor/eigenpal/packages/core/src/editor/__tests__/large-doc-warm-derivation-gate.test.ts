import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { nodeIndexTestRecorder } from '../../store/package/ooxml-edit.ts';
import { listResolveBlockVisitTestRecorder } from '../../layout/list-resolve.ts';
import { bodySectionIndexTestRecorder } from '../body-paragraph-section-index.ts';
import { contentControlEnumerationTestRecorder, contentControlsOf } from '../content-controls.ts';
import { bodySectionIndexOf } from '../section-scope.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const sdt = (pr: string, content: string) =>
  `<w:sdt><w:sdtPr>${pr}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
const numbered = (text: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

function hostileDocument(paragraphCount: number): Uint8Array {
  const blocks: string[] = [para('lead')];
  for (let index = 0; index < paragraphCount; index += 1) {
    if (index % 17 === 0) {
      blocks.push(sdt(`<w:tag w:val="ctl-${index}"/>`, para(`control ${index}`)));
    } else if (index % 5 === 0) {
      blocks.push(numbered(`item ${index}`));
    } else {
      blocks.push(para(`paragraph ${index}`));
    }
    if (index > 0 && index % 400 === 0) {
      blocks.push(
        `<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr></w:p>`
      );
    }
  }
  const body = blocks.join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(
      `<w:numbering xmlns:w="${W}">` +
        `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>` +
        `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>` +
        `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

describe('combined warm derivation gate', () => {
  test('320-paragraph hostile doc: one text insert keeps all warm derivations idle', () => {
    const nodeRecorder = nodeIndexTestRecorder();
    const sectionRecorder = bodySectionIndexTestRecorder();
    const controlRecorder = contentControlEnumerationTestRecorder();
    const listRecorder = listResolveBlockVisitTestRecorder();
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, hostileDocument(320), { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    try {
      surface.layout();
      const paragraphId = surface.session.paragraphIds()[40]!;
      bodySectionIndexOf(surface.session, paragraphId);
      contentControlsOf(surface);
      surface.session.paraIdOf(paragraphId);
      expect(sectionRecorder.rebuilds).toBeGreaterThan(0);
      expect(controlRecorder.rebuilds).toBeGreaterThan(0);
      expect(nodeRecorder.completeBuilds).toBeGreaterThan(0);
      nodeRecorder.reset();
      sectionRecorder.reset();
      controlRecorder.reset();
      listRecorder.reset();
      surface.session.applyTreeOps([{ op: 'insertText', paragraphId, offset: 0, text: 'x' }]);
      surface.layout();
      bodySectionIndexOf(surface.session, paragraphId);
      contentControlsOf(surface);
      surface.session.paraIdOf(paragraphId);
      expect(nodeRecorder.completeBuilds).toBe(0);
      expect(nodeRecorder.completeVisits).toBe(0);
      expect(sectionRecorder.rebuilds).toBe(0);
      expect(sectionRecorder.traversalVisits).toBe(0);
      expect(controlRecorder.rebuilds).toBe(0);
      expect(listRecorder.blockVisits).toBe(0);
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});
