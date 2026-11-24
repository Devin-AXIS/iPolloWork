// An inline shape group whose members are a picture and a text box. The picture member paints,
// the text box member's text paints read-only over it, and the group keeps its extent on its
// line, with or without `mc:AlternateContent`.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  CT_NS,
  DRAWING_NS,
  IMG_REL,
  OD_REL,
  PNG_1X1,
  REL_NS,
  mountWithImages,
} from './image-decode-harness.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { selectedImageStateOf } from '../docx-editor-images.ts';
import { selectedDrawingOverlayTargetOf } from '../drawing-overlay-target.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import type { InlineDrawingRecord } from '../../layout/drawing-layout.ts';
import type { PaginatedSurface } from '../paginated-surface.ts';

const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';

const PICTURE_MEMBER =
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="2" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5080000" cy="1270000"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>';

const TEXTBOX_MEMBER =
  '<wps:wsp><wps:cNvPr id="3" name="Caption"/><wps:cNvSpPr txBox="1"/><wps:spPr>' +
  '<a:xfrm><a:off x="0" y="0"/><a:ext cx="5080000" cy="1270000"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr><wps:txbx><w:txbxContent>' +
  '<w:p><w:r><w:t>Caption words</w:t></w:r></w:p></w:txbxContent></wps:txbx>' +
  '<wps:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></wps:bodyPr>' +
  '</wps:wsp>';

/** A 400pt x 100pt inline group, wrapped in `mc:AlternateContent` unless `bare`. */
function groupRun(members: string, bare: boolean): string {
  const drawing =
    '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="5080000" cy="1270000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:docPr id="1" name="Group 1"/><wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${WPG}"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>` +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="5080000" cy="1270000"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="5080000" cy="1270000"/></a:xfrm></wpg:grpSpPr>' +
    `${members}</wpg:wgp></a:graphicData></a:graphic></wp:inline></w:drawing>`;
  if (bare) return `<w:r>${drawing}</w:r>`;
  return (
    `<w:r><mc:AlternateContent><mc:Choice Requires="wpg">${drawing}</mc:Choice>` +
    '<mc:Fallback><w:pict><v:group id="Group 1"/></w:pict></mc:Fallback></mc:AlternateContent></w:r>'
  );
}

function docx(members: string, bare = false): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/></Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
    'word/document.xml': strToU8(
      `<w:document ${DRAWING_NS} xmlns:wpg="${WPG}" xmlns:mc="${MC}" xmlns:v="${V}" ` +
        'mc:Ignorable=""><w:body>' +
        `<w:p>${groupRun(members, bare)}<w:r><w:t>Tail</w:t></w:r></w:p>` +
        '<w:p><w:r><w:t>After the group</w:t></w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

interface Laid {
  readonly drawing: InlineDrawingRecord | undefined;
  /** The top of the line after the group's line, in points. */
  readonly nextLineTop: number;
}

function laidOut(surface: PaginatedSurface): Laid {
  const lines = surface
    .layout()
    .pages[0]!.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' ? fragment.lines.map((line) => ({ fragment, line })) : []
    );
  return {
    drawing: lines[0]!.line.drawings?.[0],
    nextLineTop: lines[1]!.fragment.box.y + lines[1]!.line.box.y,
  };
}

function paintedMemberText(container: HTMLElement): string | undefined {
  return container.querySelector('.docx-drawing-group-text')?.textContent ?? undefined;
}

async function withMounted(
  bytes: Uint8Array,
  run: (surface: PaginatedSurface, container: HTMLElement) => Promise<void> | void
): Promise<void> {
  const { surface, container } = await mountWithImages(bytes);
  try {
    await run(surface, container);
  } finally {
    surface.destroy();
    container.remove();
  }
}

describe('an inline group with a picture and a text box member', () => {
  for (const bare of [false, true]) {
    const label = bare ? 'outside mc:AlternateContent' : 'under mc:AlternateContent';
    test(`${label}, paints the picture at the group extent`, async () => {
      await withMounted(docx(PICTURE_MEMBER + TEXTBOX_MEMBER, bare), (surface, container) => {
        const { drawing, nextLineTop } = laidOut(surface);
        expect(drawing).toMatchObject({ width: 400, height: 100 });
        expect(drawing!.resource.kind).toBe('ready');
        expect(nextLineTop).toBeGreaterThanOrEqual(100);
        const painted = container.querySelector('.docx-drawing-ready img');
        expect(painted).not.toBeNull();
        expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(0);
        expect(paintedMemberText(container)).toBe('Caption words');
      });
    });
  }

  test('a text box alone keeps the group extent and paints its text', async () => {
    await withMounted(docx(TEXTBOX_MEMBER), (surface, container) => {
      const { drawing, nextLineTop } = laidOut(surface);
      expect(drawing).toMatchObject({ width: 400, height: 100 });
      expect(drawing!.accessibility.hidden).toBe(false);
      expect(drawing!.groupTextboxStories).toHaveLength(1);
      expect(nextLineTop).toBeGreaterThanOrEqual(100);
      expect(container.querySelectorAll('.docx-drawing-ready')).toHaveLength(0);
      expect(container.querySelectorAll('.docx-drawing-placeholder')).toHaveLength(0);
      expect(paintedMemberText(container)).toBe('Caption words');
      // An empty frame keeps the group selectable and labelled.
      const frame = container.querySelector<HTMLElement>('.docx-drawing-group-frame');
      expect(frame?.dataset.drawingNodeId).toBe(drawing!.drawingNodeId);
    });
  });

  test('the member text is read-only: no selection or editing bindings, no pointer events', async () => {
    await withMounted(docx(PICTURE_MEMBER + TEXTBOX_MEMBER), (_surface, container) => {
      const layer = container.querySelector<HTMLElement>('.docx-drawing-group-text')!;
      expect(layer.getAttribute('contenteditable')).toBe('false');
      expect(layer.style.pointerEvents).toBe('none');
      for (const name of [
        'data-paragraph-id',
        'data-textbox-paragraph-id',
        'data-start',
        'data-drawing-paragraph-id',
      ]) {
        expect(layer.querySelectorAll(`[${name}]`)).toHaveLength(0);
      }
    });
  });

  test('the group is one offset, so typing on either side of it keeps it', async () => {
    for (const members of [PICTURE_MEMBER + TEXTBOX_MEMBER, TEXTBOX_MEMBER]) {
      await withMounted(docx(members), (surface) => {
        const paragraphId = laidOut(surface).drawing!.paragraphId;
        // Before the group, then after it: the first insertion moved it to offset 1.
        for (const offset of [0, 2]) {
          const at = { paragraphId, offset };
          surface.setSelection({ anchor: at, head: at });
          surface.type('x');
          expect(surface.state().lastRejection).toBeFalsy();
        }
        expect(paragraphTextOf(surface.session.part(), paragraphId)).toBe('x￼xTail');
        expect(laidOut(surface).drawing).toMatchObject({ width: 400, height: 100 });
      });
    }
  });

  test('a selected group offers no resize or move handles that its commands would refuse', async () => {
    for (const members of [TEXTBOX_MEMBER, PICTURE_MEMBER + TEXTBOX_MEMBER]) {
      await withMounted(docx(members), (surface) => {
        const drawing = laidOut(surface).drawing!;
        expect(surface.selectDrawing(drawing.drawingNodeId, drawing.paragraphId)).toBe(true);
        const target = selectedDrawingOverlayTargetOf(surface);
        expect(target).toMatchObject({ canResize: false, canMove: false });
        expect(selectedImageStateOf(surface)).toBeNull();
      });
    }
  });

  test('copy treats a text-only group like a group with a picture', () => {
    const results = [TEXTBOX_MEMBER, PICTURE_MEMBER + TEXTBOX_MEMBER].map((members) => {
      const editor = createDocxEditor({
        container: document.createElement('div'),
        document: docx(members),
      });
      try {
        editor.exec({ type: 'selectAll' });
        return editor.exec({ type: 'copy' });
      } finally {
        editor.destroy();
      }
    });
    expect(results).toEqual([
      { ok: true, changed: false },
      { ok: true, changed: false },
    ]);
  });

  test('find reaches the text around the group', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(PICTURE_MEMBER + TEXTBOX_MEMBER),
    });
    try {
      expect(editor.findMatches('Tail')).toHaveLength(1);
      expect(editor.findMatches('After the group')).toHaveLength(1);
      // Member text is found, and selecting the match selects the group, read-only.
      const [match] = editor.findMatches('Caption words');
      expect(match?.scope?.kind).toBe('frame');
      expect(editor.selectMatch(match!).ok).toBe(true);
      expect(editor.surface!.activeScope().kind).toBe('body');
    } finally {
      editor.destroy();
    }
  });
});
