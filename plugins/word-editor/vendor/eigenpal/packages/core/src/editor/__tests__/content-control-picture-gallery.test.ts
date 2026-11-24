// Picture and building block gallery controls on the painted surface: each paints a widget,
// a press opens a host session or the engine's own fallback, and a pick lands through the
// same write lanes every image and content-control edit already uses.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { ContentControlWidgetSession } from '../popup-sessions.ts';
import {
  CT_NS,
  DRAWING_NS,
  IMG_REL,
  OD_REL,
  PNG_1X1,
  REL_NS,
  decodePort,
  picture,
  settle,
} from './image-decode-harness.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const GLOSSARY_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/glossaryDocument';
const GLOSSARY_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml';
const MAIN_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

/** A second valid 1x1 PNG: one byte of the IDAT payload differs, the header does not. */
const PNG_OTHER = (() => {
  const bytes = PNG_1X1.slice();
  bytes[45] = bytes[45]! ^ 0x5a;
  return bytes;
})();

function packageOf(entries: Record<string, Uint8Array | string>): Uint8Array {
  const zipped: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(entries)) {
    zipped[name] = typeof value === 'string' ? strToU8(value) : value;
  }
  return zipSync(zipped);
}

function pictureDocx(body: string): Uint8Array {
  return packageOf({
    '[Content_Types].xml':
      `<Types xmlns="${CT_NS}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      `<Override PartName="/word/document.xml" ContentType="${MAIN_CONTENT_TYPE}"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${REL_NS}"><Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/></Relationships>`,
    'word/media/image1.png': PNG_1X1,
    'word/document.xml': `<w:document ${DRAWING_NS}><w:body>${body}</w:body></w:document>`,
  });
}

function galleryDocx(body: string, glossary: string | null): Uint8Array {
  return packageOf({
    '[Content_Types].xml':
      `<Types xmlns="${CT_NS}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      `<Override PartName="/word/document.xml" ContentType="${MAIN_CONTENT_TYPE}"/>` +
      (glossary
        ? `<Override PartName="/word/glossary/document.xml" ContentType="${GLOSSARY_CONTENT_TYPE}"/>`
        : '') +
      '</Types>',
    '_rels/.rels': `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`,
    ...(glossary
      ? {
          'word/_rels/document.xml.rels': `<Relationships xmlns="${REL_NS}"><Relationship Id="rId9" Type="${GLOSSARY_REL}" Target="glossary/document.xml"/></Relationships>`,
          'word/glossary/document.xml': glossary,
        }
      : {}),
    'word/document.xml': `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
  });
}

const PICTURE_SDT =
  '<w:p><w:r><w:t xml:space="preserve">Photo: </w:t></w:r>' +
  '<w:sdt><w:sdtPr><w:alias w:val="Photo"/><w:id w:val="5"/><w:picture/></w:sdtPr><w:sdtContent>' +
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="457200" cy="457200"/><wp:docPr id="3" name="pic"/>' +
  `${picture(3)}</wp:inline></w:drawing></w:r></w:sdtContent></w:sdt></w:p>`;

function docPart(name: string, gallery: string, body: string): string {
  return (
    `<w:docPart><w:docPartPr><w:name w:val="${name}"/><w:category><w:name w:val="General"/>` +
    `<w:gallery w:val="${gallery}"/></w:category></w:docPartPr><w:docPartBody>${body}</w:docPartBody></w:docPart>`
  );
}

const GLOSSARY =
  `<w:glossaryDocument xmlns:w="${W}"><w:docParts>` +
  docPart('DefaultPlaceholder_1', 'placeholder', '<w:p><w:r><w:t>Choose.</w:t></w:r></w:p>') +
  docPart('Sign-off', 'docParts', '<w:p><w:r><w:t>Approved by the board</w:t></w:r></w:p>') +
  docPart('Address', 'docParts', '<w:p><w:r><w:t>1 Main St</w:t></w:r></w:p>') +
  '</w:docParts></w:glossaryDocument>';

const GALLERY_SDT =
  '<w:p><w:r><w:t xml:space="preserve">Pick: </w:t></w:r>' +
  '<w:sdt><w:sdtPr><w:alias w:val="Block"/><w:id w:val="7"/><w:showingPlcHdr/>' +
  '<w:docPartList><w:docPartGallery w:val="Quick Parts"/></w:docPartList></w:sdtPr>' +
  '<w:sdtContent><w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>Choose a building block.</w:t></w:r></w:sdtContent></w:sdt></w:p>';

const mounted: PaginatedSurface[] = [];
afterEach(() => {
  for (const surface of mounted.splice(0)) surface.destroy();
});

async function mount(
  bytes: Uint8Array,
  onRequestContentControlWidget?: (session: ContentControlWidgetSession) => boolean
): Promise<{ surface: PaginatedSurface; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, {
    scale: 1,
    imageDecodePort: decodePort(),
    ...(onRequestContentControlWidget ? { onRequestContentControlWidget } : {}),
  });
  if (!opened.ok) throw new Error(`${opened.reason}: ${opened.detail ?? ''}`);
  await settle();
  mounted.push(opened.surface);
  return { surface: opened.surface, container };
}

function press(widget: Element): void {
  widget.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
    })
  );
}

function embedOf(surface: PaginatedSurface): string {
  return /r:embed="([^"]+)"/.exec(serializeOoxmlPart(surface.session.part()))?.[1] ?? '';
}

describe('picture content controls', () => {
  test('moving the surface to another window closes an open picture picker', async () => {
    const { surface, container } = await mount(pictureDocx(PICTURE_SDT));
    press(container.querySelector<HTMLElement>('[data-docx-cc-widget="picture"]')!);
    expect(container.querySelector('.docx-content-control-picture-picker')).not.toBeNull();
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const away = frame.contentWindow!.document.createElement('div');
    frame.contentWindow!.document.body.append(away);
    surface.moveTo(away);
    // Its dismiss listeners belong to the window it opened in, so the move closes it.
    expect(away.querySelector('.docx-content-control-picture-picker')).toBeNull();
    expect(away.querySelector('[data-docx-content-control][data-open]')).toBeNull();
    surface.moveTo(container);
    frame.remove();
  });

  test('paint a picker widget; a host session replaces the image and keeps the size', async () => {
    const sessions: ContentControlWidgetSession[] = [];
    const { surface, container } = await mount(pictureDocx(PICTURE_SDT), (session) => {
      sessions.push(session);
      return true;
    });
    const widget = container.querySelector<HTMLElement>('[data-docx-cc-widget="picture"]');
    expect(widget).not.toBeNull();
    expect(widget!.getAttribute('role')).toBe('button');
    const before = embedOf(surface);
    press(widget!);
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.kind).toBe('picture');
    const painted = surface
      .layout()
      .pages[0]!.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' ? fragment.lines.flatMap((line) => line.drawings ?? []) : []
      );
    expect(painted).toHaveLength(1);
    expect(session.value).toBe(painted[0]!.drawingNodeId);
    // The press selected the picture, as Word does, so image commands address it.
    expect(surface.state().selection.head.paragraphId).toBe(surface.session.paragraphIds()[0]!);
    // No text stands for an image.
    expect(session.apply('x')).toBe(false);
    expect(await session.replaceImage!(PNG_OTHER)).toBe(true);
    expect(session.signal.aborted).toBe(true);
    expect(embedOf(surface)).not.toBe(before);
    expect(serializeOoxmlPart(surface.session.part())).toContain('cx="457200"');
    expect(surface.state().lastRejection ?? null).toBeNull();
  });

  test('a session refuses bytes that are not an image, with the reason published', async () => {
    const sessions: ContentControlWidgetSession[] = [];
    const { surface, container } = await mount(pictureDocx(PICTURE_SDT), (session) => {
      sessions.push(session);
      return true;
    });
    press(container.querySelector('[data-docx-cc-widget="picture"]')!);
    const before = embedOf(surface);
    expect(await sessions[0]!.replaceImage!(new Uint8Array([1, 2, 3, 4]))).toBe(false);
    expect(surface.state().lastRejection).toBe('unsupported-image');
    expect(sessions[0]!.signal.aborted).toBe(false);
    expect(embedOf(surface)).toBe(before);
  });

  test('without a host renderer the engine opens its own file picker on the pages layer', async () => {
    const { surface, container } = await mount(pictureDocx(PICTURE_SDT));
    const widget = container.querySelector<HTMLElement>('[data-docx-cc-widget="picture"]')!;
    press(widget);
    const picker = container.querySelector<HTMLInputElement>(
      '.docx-content-control-picture-picker'
    );
    expect(picker).not.toBeNull();
    expect(picker!.type).toBe('file');
    expect(picker!.accept).toContain('image/png');
    expect(picker!.hasAttribute('data-docx-marker')).toBe(true);
    const chrome = container.querySelector<HTMLElement>('[data-docx-content-control]');
    expect(chrome?.hasAttribute('data-open')).toBe(true);
    // A second press re-arms the picker; teardown removes it.
    press(widget);
    expect(container.querySelectorAll('.docx-content-control-picture-picker')).toHaveLength(1);
    surface.destroy();
    mounted.splice(mounted.indexOf(surface), 1);
    expect(container.querySelector('.docx-content-control-picture-picker')).toBeNull();
  });
});

describe('building block gallery controls', () => {
  test('paint a list widget whose engine menu lists the glossary blocks; a pick lands the body', async () => {
    const { surface, container } = await mount(galleryDocx(GALLERY_SDT, GLOSSARY));
    const widget = container.querySelector<HTMLElement>(
      '[data-docx-cc-widget="buildingBlockGallery"]'
    );
    expect(widget).not.toBeNull();
    expect(widget!.getAttribute('role')).toBe('listbox');
    press(widget!);
    const menu = container.querySelector<HTMLElement>('.docx-content-control-menu');
    expect(menu).not.toBeNull();
    const options = [...menu!.querySelectorAll<HTMLElement>('[role="option"]')];
    // Placeholders sit in their own gallery; the Quick Parts blocks come sorted by name.
    expect(options.map((option) => option.textContent)).toEqual(['Address', 'Sign-off']);
    options[1]!.click();
    expect(menu!.isConnected).toBe(false);
    expect(surface.session.bodyText()).toBe('Pick: Approved by the board');
    expect(serializeOoxmlPart(surface.session.part())).not.toContain('showingPlcHdr');
    expect(surface.state().lastRejection ?? null).toBeNull();
  });

  test('a gallery with nothing to offer says so instead of opening an empty list', async () => {
    const { container } = await mount(galleryDocx(GALLERY_SDT, null));
    press(container.querySelector('[data-docx-cc-widget="buildingBlockGallery"]')!);
    const menu = container.querySelector<HTMLElement>('.docx-content-control-menu');
    expect(menu).not.toBeNull();
    expect(menu!.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(menu!.querySelector('[data-docx-part="empty"]')?.textContent).toContain(
      'no building blocks'
    );
  });

  test('a host session is list-shaped and applies by block name, refusing unknown names', async () => {
    const sessions: ContentControlWidgetSession[] = [];
    const { surface, container } = await mount(galleryDocx(GALLERY_SDT, GLOSSARY), (session) => {
      sessions.push(session);
      return true;
    });
    press(container.querySelector('[data-docx-cc-widget="buildingBlockGallery"]')!);
    const session = sessions[0]!;
    expect(session.kind).toBe('buildingBlockGallery');
    expect(session.items.map((item) => item.value)).toEqual(['Address', 'Sign-off']);
    expect(session.value).toBe('');
    expect(session.apply('Nope')).toBe(false);
    expect(surface.state().lastRejection).toBe('unknown-building-block');
    expect(session.apply('Address')).toBe(true);
    expect(surface.session.bodyText()).toBe('Pick: 1 Main St');
  });
});
