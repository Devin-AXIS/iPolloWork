// Remote carets, ranges and highlights reach text box paragraphs through upright overlay
// boxes. A story that turns, such as vertical text, has no upright boxes, so it contributes
// none rather than boxes beside its glyphs.

import { expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/index.ts';
import type { InlineDrawingLayoutContext } from '../../layout/drawing-layout.ts';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { textboxPresenceLayout } from '../textbox-presence-layout.ts';

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml"';

function addedFragments(textboxStyle: string): number {
  const xml =
    `<w:document ${NS}><w:body><w:p><w:r><w:pict><v:rect style="position:absolute;` +
    'margin-left:144pt;margin-top:200pt;width:200pt;height:100pt;z-index:1;' +
    'mso-position-horizontal-relative:page;mso-position-vertical-relative:page" filled="f">' +
    `<v:textbox${textboxStyle}><w:txbxContent><w:p><w:r><w:t>Story</w:t></w:r></w:p>` +
    '</w:txbxContent></v:textbox></v:rect></w:pict></w:r></w:p></w:body></w:document>';
  const loaded = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.part;
  const atoms = indexInlineDrawingProjectionsInPart(part);
  const drawingLayout: InlineDrawingLayoutContext = {
    ownerPartName: part.name,
    projectionForAtom: (atomId) => atoms.get(atomId) ?? null,
    project: (node) =>
      atoms.get(node.id) ??
      projectDrawing(node, { ownerPartName: part.name, limits: DEFAULT_DRAWING_PROJECTION_LIMITS }),
    resourceOf: () =>
      Object.freeze({
        kind: 'unrenderable' as const,
        partName: null,
        mime: 'unknown' as const,
        reason: 'unsupported-format' as const,
      }),
  };
  const layout = layoutSemanticDocument(part, 1, {
    measurer: createFixedMeasurer(6, 14),
    producer: 'test',
    inlineDrawingLayout: drawingLayout,
  });
  const presence = textboxPresenceLayout(layout);
  return presence.pages[0]!.fragments.length - layout.pages[0]!.fragments.length;
}

test('an upright text box story joins the presence geometry', () => {
  expect(addedFragments('')).toBe(1);
});

test('a turned text box story adds no upright boxes', () => {
  expect(addedFragments(' style="layout-flow:vertical"')).toBe(0);
});
