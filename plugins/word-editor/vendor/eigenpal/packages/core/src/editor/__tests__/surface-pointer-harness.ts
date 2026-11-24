// Shared mount and pointer helpers for the surface pointer tests.

import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdStyles" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}</w:styles>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

// The surface measurer's 6pt base describes an 11pt run, so fixtures author `w:sz="22"`
// rather than resolving to the 10pt terminal fallback (see `DEFAULT_RUN_STYLE`).
export const paragraph = (text: string) =>
  `<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

/** The page's content box origin, which page-content coordinates are measured from. */
export const MARGIN = 72;

export interface Mounted {
  readonly surface: PaginatedSurface;
  readonly container: HTMLElement;
  readonly pages: HTMLElement;
}

export function mount(body: string, options: { pointer?: 'engine' | 'native' } = {}): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, docx(body), {
    scale: 1,
    ...(options.pointer ? { pointer: options.pointer } : {}),
  });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  // happy-dom reports no layout at all, so the one measurement the controller makes — where
  // the pages layer sits on screen — is supplied. A deliberately non-zero origin, so a
  // controller that forgot to subtract it would fail rather than pass by coincidence.
  stubRect(pages, { left: 100, top: 50, bottom: 50 });
  return { surface: result.surface, container, pages };
}

export function stubRect(
  element: HTMLElement,
  rect: { left: number; top: number; bottom?: number }
): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: rect.left,
      top: rect.top,
      right: rect.left + 1000,
      bottom: rect.bottom ?? rect.top + 1000,
      width: 1000,
      height: (rect.bottom ?? rect.top + 1000) - rect.top,
      x: rect.left,
      y: rect.top,
    }),
  });
}

/** Page-content coordinates to the client point that lands on them. */
export const clientOf = (x: number, y: number) => ({
  clientX: 100 + MARGIN + x,
  clientY: 50 + MARGIN + y,
});

export function pointer(
  type: string,
  x: number,
  y: number,
  init: PointerEventInit = {}
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    ...clientOf(x, y),
    ...init,
  });
}

/** A press, at page-content coordinates. Returns the event so its defaults can be inspected. */
export function press(
  mounted: Mounted,
  x: number,
  y: number,
  init: PointerEventInit = {}
): PointerEvent {
  const event = pointer('pointerdown', x, y, init);
  mounted.pages.dispatchEvent(event);
  return event;
}

export const release = (x: number, y: number): void => {
  document.dispatchEvent(pointer('pointerup', x, y));
};

export const offsets = (surface: PaginatedSurface): [number, number] => {
  const { anchor, head } = surface.state().selection;
  return [anchor.offset, head.offset];
};

export const move = (x: number, y: number): void => {
  document.dispatchEvent(pointer('pointermove', x, y));
};
