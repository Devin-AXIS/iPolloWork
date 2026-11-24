import { zipSync, strToU8 } from 'fflate';
import { CHROME_GROUPS, chromeSlotId } from '@docx-editor.dev/core/editor';
import { stepZoomLevel } from '../src/editor/zoom-levels.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

export function differentialDocx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

export const DIFFERENTIAL_SOURCE = differentialDocx(
  '<w:p><w:r><w:t>parity differential</w:t></w:r></w:p>'
);

export const DIFFERENTIAL_SLOTS = CHROME_GROUPS.flatMap((group) =>
  group.controls.map((control) => chromeSlotId(group, control))
);

export const OFF_LADDER_ZOOM = 0.73;

export function offLadderZoomIn(): number | null {
  return stepZoomLevel(OFF_LADDER_ZOOM, 'in');
}
