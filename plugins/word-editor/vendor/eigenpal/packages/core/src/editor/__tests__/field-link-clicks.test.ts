// Clicking a HYPERLINK FIELD's painted result, end to end over a mounted editor.
//
// A field link has no `w:hyperlink` node, so the typed-link lane cannot resolve its id — the
// surface registers every projected field link and routes `linkById` through that registry
// first. These prove the registration is real: a plain click reaches the host popover with
// the sanitized target, an `\l` field jumps to its bookmark, and a refused scheme paints no
// anchor at all.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const PID = (index: number) => `/word/document.xml#0.0.${index}`;

/** A complete complex field around one instruction, with a cached result. */
function complexField(instr: string, result: string): string {
  return (
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText>${instr}</w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    result +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
  );
}

interface Mounted {
  readonly editor: DocxEditorInstance;
  readonly container: HTMLElement;
}

function mount(body: string): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container };
}

function caret(mounted: Mounted, index: number, offset: number): void {
  mounted.editor.surface!.setSelection({
    anchor: { paragraphId: PID(index), offset },
    head: { paragraphId: PID(index), offset },
  });
}

/** The painted anchor whose text is `text`, within THIS editor's container. */
function anchorFor(mounted: Mounted, text: string): HTMLElement {
  const anchors = [...mounted.container.querySelectorAll('a.docx-hyperlink')] as HTMLElement[];
  const found = anchors.find((anchor) => anchor.textContent === text);
  if (!found) {
    const seen = anchors.map((anchor) => anchor.textContent);
    throw new Error(
      `no painted anchor with text ${JSON.stringify(text)}; saw ${JSON.stringify(seen)}`
    );
  }
  return found;
}

/** Click an element the way a browser does, and report whether the default was prevented. */
function click(element: HTMLElement): boolean {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('clicking a painted HYPERLINK field', () => {
  test('the result paints as an anchor with the sanitized href and a registered id', () => {
    const mounted = mount(
      '<w:p><w:r><w:t>See </w:t></w:r>' +
        complexField(
          ' HYPERLINK "https://example.com" \\o "Visit" ',
          '<w:r><w:t>the site</w:t></w:r>'
        ) +
        '<w:r><w:t>.</w:t></w:r></w:p>'
    );
    const anchor = anchorFor(mounted, 'the site');
    expect(anchor.getAttribute('href')).toBe('https://example.com');
    expect(anchor.getAttribute('title')).toBe('Visit');
    expect(anchor.dataset.docxLink).toStartWith('field-hyperlink:');
  });

  test('a plain click resolves through the registry to the host popover', () => {
    const mounted = mount(
      '<w:p><w:r><w:t>See </w:t></w:r>' +
        complexField(' HYPERLINK "https://example.com" ', '<w:r><w:t>the site</w:t></w:r>') +
        '<w:r><w:t>.</w:t></w:r></w:p>'
    );
    const seen: (string | null)[] = [];
    mounted.editor.setHyperlinkChrome({
      onPopover: (activation) => seen.push(activation.link.href),
    });
    caret(mounted, 0, 2);
    expect(click(anchorFor(mounted, 'the site'))).toBe(true);
    expect(seen).toEqual(['https://example.com']);
  });

  test('an \\l field jumps to its bookmark and moves the caret; no popover', () => {
    const mounted = mount(
      `<w:p>${complexField(' HYPERLINK \\l "target" ', '<w:r><w:t>Go</w:t></w:r>')}</w:p>` +
        '<w:p><w:r><w:t>filler</w:t></w:r></w:p>' +
        '<w:p><w:bookmarkStart w:id="1" w:name="target"/><w:r><w:t>Destination</w:t></w:r></w:p>'
    );
    const seen: string[] = [];
    mounted.editor.setHyperlinkChrome({ onPopover: (activation) => seen.push(activation.link.id) });
    caret(mounted, 0, 0);
    click(anchorFor(mounted, 'Go'));
    expect(seen).toEqual([]);
    expect(mounted.editor.surface!.state().selection.head.paragraphId).toBe(PID(2));
  });

  test('a fldSimple HYPERLINK resolves the same way', () => {
    const mounted = mount(
      '<w:p><w:fldSimple w:instr=\' HYPERLINK "https://example.com" \'>' +
        '<w:r><w:t>entry</w:t></w:r></w:fldSimple></w:p>'
    );
    const seen: (string | null)[] = [];
    mounted.editor.setHyperlinkChrome({
      onPopover: (activation) => seen.push(activation.link.href),
    });
    caret(mounted, 0, 0);
    click(anchorFor(mounted, 'entry'));
    expect(seen).toEqual(['https://example.com']);
  });

  test('a javascript: target paints its text with NO anchor at all', () => {
    const mounted = mount(
      `<w:p>${complexField(' HYPERLINK "javascript:alert(1)" ', '<w:r><w:t>Click me</w:t></w:r>')}</w:p>`
    );
    expect(mounted.container.textContent).toContain('Click me');
    const anchors = [...mounted.container.querySelectorAll('a.docx-hyperlink')];
    expect(anchors).toEqual([]);
  });
});
