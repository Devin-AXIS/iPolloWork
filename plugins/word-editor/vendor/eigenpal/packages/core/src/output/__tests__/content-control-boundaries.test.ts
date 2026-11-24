// Content-control boundary seam for paint: records ride on the layout; chrome is not
// permanently painted. This pins that pages carrying `contentControls` still paint, and that
// paint options do not yet expose an on-demand furniture flag (records-only slice).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { paintSemanticLayout, type PaintOptions } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function load(body: string) {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType: 'app/xml',
    }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

describe('content-control boundary paint seam', () => {
  test('inactive controls paint discoverable furniture without visible boundaries', () => {
    const layout = layoutSemanticDocument(
      load(
        `<w:sdt><w:sdtPr><w:alias w:val="Name"/></w:sdtPr>` +
          `<w:sdtContent><w:p><w:r><w:t>Ada</w:t></w:r></w:p></w:sdtContent></w:sdt>`
      ),
      1,
      { measurer: createFixedMeasurer(6, 14) }
    );
    expect(layout.contentControls).toHaveLength(1);
    expect(layout.pages[0]!.contentControls).toHaveLength(1);

    const container = document.createElement('div');
    paintSemanticLayout(container, layout);
    expect(container.querySelectorAll('.docx-page').length).toBe(layout.pages.length);
    const chrome = container.querySelector<HTMLElement>('[data-docx-content-control]');
    expect(chrome).not.toBeNull();
    expect(chrome!.hasAttribute('data-boundary-visible')).toBe(false);
    expect(chrome!.hasAttribute('data-active')).toBe(false);
  });

  test('boundary furniture translates content-local geometry into sheet coordinates', () => {
    const layout = layoutSemanticDocument(
      load(
        `<w:sdt><w:sdtPr><w:alias w:val="Name"/><w:dropDownList>` +
          `<w:listItem w:displayText="Ada" w:value="ada"/></w:dropDownList></w:sdtPr>` +
          `<w:sdtContent><w:p><w:r><w:t>Ada</w:t></w:r></w:p></w:sdtContent></w:sdt>`
      ),
      1,
      { measurer: createFixedMeasurer(6, 14) }
    );
    const page = layout.pages[0]!;
    const fragment = page.contentControls![0]!.fragments[0]!;
    const container = document.createElement('div');
    const scale = 1.5;

    paintSemanticLayout(container, layout, {
      scale,
      contentControlChrome: {
        showAll: true,
        activeIds: new Set([page.contentControls![0]!.id]),
      },
    });

    const boundary = container.querySelector<HTMLElement>('.docx-content-control-boundary');
    expect(boundary).not.toBeNull();
    expect(boundary!.style.left).toBe(
      `${(page.contentBox.x - page.box.x + fragment.box.x) * scale}px`
    );
    expect(boundary!.style.top).toBe(
      `${(page.contentBox.y - page.box.y + fragment.box.y) * scale}px`
    );
    const label = container.querySelector<HTMLElement>('.docx-content-control-label');
    expect(label?.textContent).toBe('Name');
    expect(label?.style.left).toBe(
      `${(page.contentBox.x - page.box.x + fragment.box.x) * scale}px`
    );
    expect(label?.style.top).toBe(
      `${Math.max(0, (page.contentBox.y - page.box.y + fragment.box.y) * scale - 16)}px`
    );
    // The value widget sits OUTSIDE the control past its right edge, scaled like the page, and
    // centred on the control's line, so it never covers the last characters of the value.
    const widget = container.querySelector<HTMLElement>('.docx-content-control-widget');
    const size = 16 * scale;
    expect(widget?.style.left).toBe(
      `${(page.contentBox.x - page.box.x + fragment.box.x + fragment.box.width + 2) * scale}px`
    );
    expect(widget?.style.top).toBe(
      `${
        (page.contentBox.y - page.box.y + fragment.box.y) * scale +
        Math.max(0, (fragment.box.height * scale - size) / 2)
      }px`
    );
    expect(widget?.style.width).toBe(`${size}px`);
    expect(widget?.style.height).toBe(`${size}px`);
    expect(widget?.style.fontSize).toBe(`${size}px`);
  });

  test('a checkbox widget covers its glyph box and scales with the font', () => {
    const layout = layoutSemanticDocument(
      load(
        `<w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="1"/></w14:checkbox></w:sdtPr>` +
          `<w:sdtContent><w:p><w:r><w:t>☒</w:t></w:r></w:p></w:sdtContent></w:sdt>`
      ),
      1,
      { measurer: createFixedMeasurer(6, 14) }
    );
    const page = layout.pages[0]!;
    const fragment = page.contentControls![0]!.fragments[0]!;
    const container = document.createElement('div');
    const scale = 2;
    paintSemanticLayout(container, layout, {
      scale,
      contentControlChrome: { showAll: true, checkedIds: new Set([page.contentControls![0]!.id]) },
    });
    const widget = container.querySelector<HTMLElement>('[data-docx-cc-widget="checkbox"]');
    expect(widget).not.toBeNull();
    // Glyph-sized and centred on the line: the fragment is the LINE box, so a tall line must
    // not inflate the widget over the text beside the glyph.
    const size = Math.min(fragment.box.height, 16) * scale;
    const center =
      (page.contentBox.x - page.box.x + fragment.box.x + fragment.box.width / 2) * scale;
    // Compared as numbers: CSS serializes to six decimals.
    expect(Number.parseFloat(widget!.style.left)).toBeCloseTo(center - size / 2, 4);
    expect(Number.parseFloat(widget!.style.top)).toBeCloseTo(
      (page.contentBox.y - page.box.y + fragment.box.y) * scale +
        Math.max(0, (fragment.box.height * scale - size) / 2),
      4
    );
    expect(Number.parseFloat(widget!.style.width)).toBeCloseTo(size, 4);
    expect(Number.parseFloat(widget!.style.height)).toBeCloseTo(size, 4);
    expect(widget!.getAttribute('aria-checked')).toBe('true');
  });

  test('show-all keeps aliases inactive until a control is active', () => {
    const layout = layoutSemanticDocument(
      load(
        `<w:sdt><w:sdtPr><w:alias w:val="Name"/></w:sdtPr>` +
          `<w:sdtContent><w:p><w:r><w:t>Ada</w:t></w:r></w:p></w:sdtContent></w:sdt>`
      ),
      1,
      { measurer: createFixedMeasurer(6, 14) }
    );
    const control = layout.contentControls![0]!;
    const container = document.createElement('div');

    paintSemanticLayout(container, layout, {
      scale: 1,
      contentControlChrome: { showAll: true },
    });
    expect(container.querySelector('.docx-content-control-boundary')).not.toBeNull();
    expect(
      container
        .querySelector<HTMLElement>('[data-docx-content-control]')!
        .hasAttribute('data-active')
    ).toBe(false);

    paintSemanticLayout(container, layout, {
      scale: 1,
      contentControlChrome: { showAll: true, activeIds: new Set([control.id]) },
    });
    expect(
      container
        .querySelector<HTMLElement>('[data-docx-content-control]')!
        .hasAttribute('data-active')
    ).toBe(true);
    expect(container.querySelector('.docx-content-control-label')?.textContent).toBe('Name');
  });

  test('PaintOptions has no show-content-controls flag in this slice', () => {
    const options: PaintOptions = { scale: 1, ariaHidden: true };
    expect('showContentControls' in options).toBe(false);
  });
});
