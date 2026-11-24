// Editing a numbered paragraph whose suffix tab stops at an authored stop before the indent.
//
// The first line starts at the stop, so every consumer of that line has to agree on it:
// painted spans, the caret, typing, undo, a retained relayout, and a save and reopen.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  canonicalOoxmlFingerprint,
  diffSemanticDigests,
  readOoxmlPackage,
  semanticDigest,
} from '@docx-editor.dev/core/store';
import { caretAt, createFixedMeasurer, type SemanticLayout } from '@docx-editor.dev/core/layout';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

// Marker `1.` at 36pt, 12pt wide; text indent 72pt; authored stop 60pt; 1in page margins.
const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">` +
  '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="720"/></w:pPr>' +
  '<w:rPr><w:sz w:val="22"/></w:rPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>';

const STYLES =
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr>` +
  '</w:rPrDefault></w:docDefaults></w:styles>';

const SECTION =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';

function docx(stopTwips: number, settings = ''): Uint8Array {
  const body =
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' +
    `<w:tabs><w:tab w:val="left" w:pos="${stopTwips}"/></w:tabs></w:pPr>` +
    '<w:r><w:t>Item text</w:t></w:r></w:p>' +
    // A valid authored empty paragraph must survive everything below untouched.
    '<w:p/>';
  const part = (name: string) =>
    `<Override PartName="/word/${name}.xml" ContentType="${WML}.${name}+xml"/>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
        `${part('numbering')}${part('styles')}${part('settings')}</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId2" Type="${R}/numbering" Target="numbering.xml"/>` +
        `<Relationship Id="rId3" Type="${R}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId4" Type="${R}/settings" Target="settings.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/styles.xml': strToU8(STYLES),
    'word/settings.xml': strToU8(`<w:settings xmlns:w="${W}">${settings}</w:settings>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}${SECTION}</w:body></w:document>`
    ),
  });
}

const FLAG = '<w:compat><w:doNotUseIndentAsNumberingTabStop/></w:compat>';

const mounted: { surface: PaginatedSurface; container: HTMLElement }[] = [];

function mount(bytes: Uint8Array): PaginatedSurface {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, {
    measurer: createFixedMeasurer(6, 14),
  });
  if (!opened.ok) throw new Error(opened.reason);
  mounted.push({ surface: opened.surface, container });
  return opened.surface;
}

afterEach(() => {
  for (const { surface, container } of mounted.splice(0)) {
    surface.destroy();
    container.remove();
  }
});

/** The numbered paragraph's first line, relative to the page content origin. */
function firstLine(layout: SemanticLayout) {
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph' || !fragment.marker) continue;
      // The marker slot is at 36pt from the content origin.
      const origin = fragment.marker.box.x - 36;
      const line = fragment.lines[0]!;
      return {
        origin,
        markerEnd: fragment.marker.box.x + fragment.marker.box.width - origin,
        textX: line.spans[0]!.box.x - origin,
        text: line.spans.map((span) => span.text).join(''),
      };
    }
  }
  throw new Error('no numbered paragraph');
}

function caretX(surface: PaginatedSurface, offset: number): number {
  const paragraphId = surface.session.paragraphIds()[0]!;
  const caret = caretAt(surface.layout(), { paragraphId, offset });
  if (!caret) throw new Error('no caret');
  return caret.x - firstLine(surface.layout()).origin;
}

/** Type at the start of the numbered paragraph through the surface's `beforeinput` path. */
async function type(surface: PaginatedSurface, text: string): Promise<void> {
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 0 } });
  const container = mounted.find((entry) => entry.surface === surface)!.container;
  container.querySelector('.docx-pages')!.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    })
  );
  // Typed text lands as one batch on the next task.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('a numbered first line at an authored stop', () => {
  test('text, marker and caret share one first-line position', () => {
    const surface = mount(docx(1200));
    const line = firstLine(surface.layout());
    expect(line.markerEnd).toBe(48);
    expect(line.textX).toBe(60);
    expect(caretX(surface, 0)).toBe(60);
    // One 6pt glyph further along.
    expect(caretX(surface, 1)).toBe(66);
  });

  test('typing at the start keeps the stop, and undo restores the text', async () => {
    const surface = mount(docx(1200));
    await type(surface, 'New ');
    expect(surface.session.bodyText()).toStartWith('New Item text');
    expect(firstLine(surface.layout()).textX).toBe(60);
    expect(caretX(surface, 4)).toBe(84);
    surface.undo();
    expect(surface.session.bodyText()).toStartWith('Item text');
    const line = firstLine(surface.layout());
    expect(line.textX).toBe(60);
    expect(line.text).toBe('Item text');
  });

  test('a retained relayout agrees with a fresh open', async () => {
    const surface = mount(docx(1200));
    await type(surface, 'Edited ');
    const fresh = mount(surface.session.save());
    expect(firstLine(surface.layout())).toEqual(firstLine(fresh.layout()));
  });

  test('save and reopen keeps the stop, the empty paragraph and both oracles', () => {
    const surface = mount(docx(1200));
    const before = surface.session.part();
    const saved = surface.session.save();
    const reopened = readOoxmlPackage(saved);
    if (!reopened.ok) throw new Error(reopened.reason);
    const after = reopened.package.parts.get(reopened.package.mainDocumentPart)!;
    expect(canonicalOoxmlFingerprint(after)).toBe(canonicalOoxmlFingerprint(before));
    expect(diffSemanticDigests(semanticDigest([before]), semanticDigest([after]))).toEqual([]);
    const again = mount(saved);
    expect(again.session.paragraphIds()).toHaveLength(2);
    expect(firstLine(again.layout()).textX).toBe(60);
  });

  test('the settings flag survives a save and still moves the first line', () => {
    // 1800tw = 90pt, past the 72pt indent: only the flag lets the suffix tab reach it.
    expect(firstLine(mount(docx(1800)).layout()).textX).toBe(72);
    const flagged = mount(docx(1800, FLAG));
    expect(firstLine(flagged.layout()).textX).toBe(90);
    expect(caretX(flagged, 0)).toBe(90);
    expect(firstLine(mount(flagged.session.save()).layout()).textX).toBe(90);
  });
});
