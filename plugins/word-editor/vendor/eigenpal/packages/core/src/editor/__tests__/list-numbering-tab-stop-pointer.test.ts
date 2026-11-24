// Pointer gestures on a numbered first line that starts left of its paragraph box.
//
// The suffix tab stops at an authored stop far before the text indent, so the first line's
// text is painted outside the paragraph box, level with nothing else. Presses and drags on
// that text must land in it, not in the paragraph above.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createFixedMeasurer, paragraphFragmentsOf } from '@docx-editor.dev/core/layout';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

// Marker slot at 42pt (left 150pt, hanging 108pt); the suffix tab stops at 70.9pt.
const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">` +
  '<w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%1)"/>' +
  '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="3000" w:hanging="2160"/></w:pPr>' +
  '<w:rPr><w:sz w:val="22"/></w:rPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>';

const run = (text: string) => `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r>`;
const BODY =
  `<w:p>${run('previous paragraph words')}</w:p>` +
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' +
  `<w:tabs><w:tab w:val="num" w:pos="1418"/></w:tabs></w:pPr>${run('item text here')}</w:p>` +
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="${WML}.numbering+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${R}/numbering" Target="numbering.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${BODY}</w:body></w:document>`
    ),
  });
}

/** The pages layer sits at client (100, 50); page content starts at the 72pt margin. */
const ORIGIN = { x: 100 + 72, y: 50 + 72 };

interface Mounted {
  readonly surface: PaginatedSurface;
  readonly container: HTMLElement;
  readonly pages: HTMLElement;
}

const mounted: Mounted[] = [];

function mount(): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, docx(), {
    scale: 1,
    measurer: createFixedMeasurer(6, 14),
  });
  if (!result.ok) throw new Error(result.reason);
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  // happy-dom has no layout; supply the one rect the pointer controller reads.
  Object.defineProperty(pages, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 100, top: 50, right: 1100, bottom: 1050, width: 1000, height: 1000 }),
  });
  const entry = { surface: result.surface, container, pages };
  mounted.push(entry);
  return entry;
}

afterEach(() => {
  for (const { surface, container } of mounted.splice(0)) {
    surface.destroy();
    container.remove();
  }
});

function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    pointerId: 1,
    pointerType: 'mouse',
    clientX: ORIGIN.x + x,
    clientY: ORIGIN.y + y,
  });
}

const press = (m: Mounted, x: number, y: number) => {
  m.pages.dispatchEvent(pointer('pointerdown', x, y));
};
const move = (x: number, y: number) => document.dispatchEvent(pointer('pointermove', x, y));
const release = (x: number, y: number) => document.dispatchEvent(pointer('pointerup', x, y));

/** Page-content geometry of both paragraphs' first lines. */
function geometry(surface: PaginatedSurface) {
  const [previous, item] = paragraphFragmentsOf(surface.layout().pages[0]!);
  const itemLine = item!.lines[0]!;
  return {
    previousId: previous!.paragraphId,
    previousLine: previous!.lines[0]!,
    itemId: item!.paragraphId,
    itemBoxX: item!.box.x,
    itemTextX: itemLine.spans[0]!.box.x,
    itemY: itemLine.box.y + itemLine.box.height / 2,
  };
}

describe('a press on numbered text before the indent', () => {
  test('places the caret in that text', () => {
    const m = mount();
    const g = geometry(m.surface);
    expect(g.itemTextX).toBeCloseTo(70.9, 5);
    expect(g.itemBoxX).toBeCloseTo(150, 0);
    press(m, g.itemTextX + 13, g.itemY);
    release(g.itemTextX + 13, g.itemY);
    const { anchor, head } = m.surface.state().selection;
    expect(anchor).toEqual({ paragraphId: g.itemId, offset: 2 });
    expect(head).toEqual(anchor);
  });

  test('typing there inserts into that text, and undo restores it', async () => {
    const m = mount();
    const g = geometry(m.surface);
    press(m, g.itemTextX + 13, g.itemY);
    release(g.itemTextX + 13, g.itemY);
    m.pages.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: 'Q',
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(m.surface.session.bodyText()).toContain('itQem text here');
    expect(m.surface.session.bodyText()).toContain('previous paragraph words');
    m.surface.undo();
    expect(m.surface.session.bodyText()).toContain('item text here');
  });

  test('a press on the paragraph above still lands there', () => {
    const m = mount();
    const g = geometry(m.surface);
    const y = g.previousLine.box.y + g.previousLine.box.height - 1;
    press(m, 13, y);
    release(13, y);
    expect(m.surface.state().selection.head).toEqual({ paragraphId: g.previousId, offset: 2 });
  });
});

describe('a drag over numbered text before the indent', () => {
  test('selects within that text', () => {
    const m = mount();
    const g = geometry(m.surface);
    press(m, g.itemTextX + 1, g.itemY);
    move(g.itemTextX + 25, g.itemY);
    release(g.itemTextX + 25, g.itemY);
    const { anchor, head } = m.surface.state().selection;
    expect(anchor).toEqual({ paragraphId: g.itemId, offset: 0 });
    expect(head).toEqual({ paragraphId: g.itemId, offset: 4 });
  });

  test('from the paragraph above ends in that text', () => {
    const m = mount();
    const g = geometry(m.surface);
    const y = g.previousLine.box.y + g.previousLine.box.height / 2;
    press(m, 13, y);
    move(g.itemTextX + 13, g.itemY);
    release(g.itemTextX + 13, g.itemY);
    const { anchor, head } = m.surface.state().selection;
    expect(anchor).toEqual({ paragraphId: g.previousId, offset: 2 });
    expect(head).toEqual({ paragraphId: g.itemId, offset: 2 });
  });
});
