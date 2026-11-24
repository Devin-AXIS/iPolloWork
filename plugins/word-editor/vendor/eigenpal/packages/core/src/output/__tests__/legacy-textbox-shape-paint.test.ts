// The screen paint of a legacy VML text box shape: outline geometry, centred outlines, dash
// patterns, turned boxes and stories, and shadows that show outside the shape. It paints the
// same constructs the PDF writer does, so a page and its export agree.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/index.ts';
import type { InlineDrawingLayoutContext } from '../../layout/drawing-layout.ts';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';
const POS =
  'position:absolute;margin-left:144pt;margin-top:200pt;width:200pt;height:100pt;z-index:1;' +
  'mso-position-horizontal-relative:page;mso-position-vertical-relative:page';

function painted(
  host: string,
  attrs: string,
  style = POS,
  kids = '',
  textboxAttrs = ''
): HTMLElement {
  const xml =
    `<w:document ${NS}><w:body><w:p><w:r><w:pict><${host} style="${style}" ${attrs}>${kids}` +
    `<v:textbox${textboxAttrs}><w:txbxContent><w:p><w:r><w:t>Story</w:t></w:r></w:p></w:txbxContent>` +
    `</v:textbox></${host}></w:pict></w:r></w:p></w:body></w:document>`;
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
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  const textbox = container.querySelector<HTMLElement>('.docx-drawing-textbox');
  expect(textbox).not.toBeNull();
  return textbox!;
}

const boxOf = (textbox: HTMLElement) =>
  textbox.querySelector<HTMLElement>('.docx-drawing-textbox-box')!;
const contentOf = (textbox: HTMLElement) =>
  textbox.querySelector<HTMLElement>('.docx-drawing-textbox-content')!;

describe('legacy text box shapes', () => {
  test('a stroked box centres its outline on the box edge', () => {
    const textbox = painted('v:rect', 'filled="f" strokeweight="4pt"');
    const box = boxOf(textbox);
    // The paint area grew by the outline's outer half, so the box sits 2 px in from it.
    expect(box.style.left).toBe('0px');
    expect(box.style.width).toBe('204px');
    expect(box.style.border).toContain('4px solid');
  });

  test('an oval paints an elliptical outline', () => {
    const path = boxOf(painted('v:oval', 'filled="f"')).querySelector('path');
    expect(path?.getAttribute('d')).toMatch(/^M0 50 A100 50 /);
    expect(path?.getAttribute('fill')).toBe('none');
  });

  test('a dashed outline paints its pattern in outline widths', () => {
    const path = boxOf(
      painted('v:rect', 'filled="f" strokeweight="1pt"', POS, '<v:stroke dashstyle="dash"/>')
    ).querySelector('path');
    expect(path?.getAttribute('stroke-dasharray')).toBe('4 3');
  });

  test('a quarter-turned box turns its shape and keeps its text upright', () => {
    const textbox = painted('v:rect', 'filled="f"', `${POS};rotation:90`);
    expect(boxOf(textbox).style.transform).toBe('rotate(90deg)');
    expect(contentOf(textbox).style.transform).toBe('');
  });

  test('vertical text turns its story about the text area centre', () => {
    const content = contentOf(
      painted(
        'v:rect',
        'filled="f" stroked="f"',
        POS,
        '',
        ' inset="0,0,0,0" style="layout-flow:vertical"'
      )
    );
    expect(content.style.transform).toBe('rotate(90deg)');
    expect(content.style.transformOrigin).toBe('50px 100px');
  });

  test('a shadow paints a copy of the shape at its offset', () => {
    const textbox = painted(
      'v:rect',
      'fillcolor="#ffd966"',
      POS,
      '<v:shadow on="t" offset="6pt,-4pt"/>'
    );
    const shadow = textbox.querySelector<HTMLElement>('.docx-drawing-textbox-shadow');
    expect(shadow).not.toBeNull();
    expect(shadow!.style.transform).toBe('translate(6px, -4px)');
    expect(shadow!.style.backgroundColor).toBe('#808080');
    expect(shadow!.style.clipPath).toBe('');
    // A filled shape hides its text's shadow.
    expect(contentOf(textbox).style.filter).toBe('');
  });

  test('an obscured shadow is the silhouette, cut out where the shape stands', () => {
    const textbox = painted('v:oval', 'filled="f"', POS, '<v:shadow on="t" obscured="t"/>');
    const shadow = textbox.querySelector<HTMLElement>('.docx-drawing-textbox-shadow')!;
    expect(shadow.style.clipPath).toContain('evenodd');
    expect(shadow.querySelector('path')?.getAttribute('fill')).toBe('#808080');
    expect(contentOf(textbox).style.filter).toBe('');
  });

  test('an obscured shadow is the silhouette, cut out where the shape stands', () => {
    const textbox = painted('v:oval', 'filled="f"', POS, '<v:shadow on="t" obscured="t"/>');
    const shadow = textbox.querySelector<HTMLElement>('.docx-drawing-textbox-shadow')!;
    expect(shadow.style.clipPath).toContain('evenodd');
    expect(shadow.querySelector('path')?.getAttribute('fill')).toBe('#808080');
    expect(contentOf(textbox).style.filter).toBe('');
  });

  test('the text of an unfilled shape casts the shadow too', () => {
    const textbox = painted('v:rect', 'filled="f"', POS, '<v:shadow on="t"/>');
    expect(contentOf(textbox).style.filter).toBe('drop-shadow(2px 2px 0 #808080ff)');
  });
});
