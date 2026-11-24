// A new link in a document that does not define the hyperlink character style.
//
// The style is added to the styles part in the same transaction as the link, so the link
// paints in the hyperlink color with an underline, saves with a style reference that
// resolves, and one undo takes both back.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { blankDocumentBytes } from '../blank-document.ts';
import { hyperlinkStyleFor } from '../../store/package/hyperlink-style-edit.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const PID = '/word/document.xml#0.0.0';

const THEME =
  `<a:theme xmlns:a="${A}" name="T"><a:themeElements><a:clrScheme name="T">` +
  '<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="0E2841"/></a:dk2><a:lt2><a:srgbClr val="E8E8E8"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="156082"/></a:accent1><a:accent2><a:srgbClr val="E97132"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="196B24"/></a:accent3><a:accent4><a:srgbClr val="0F9ED5"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="A02B93"/></a:accent5><a:accent6><a:srgbClr val="4EA72E"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="467886"/></a:hlink><a:folHlink><a:srgbClr val="96607D"/></a:folHlink>' +
  '</a:clrScheme></a:themeElements></a:theme>';

function docx(options: { styles?: string; theme?: boolean } = {}): Uint8Array {
  const { styles, theme } = options;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (styles
          ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          : '') +
        (theme
          ? '<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        (styles ? `<Relationship Id="rIdS" Type="${R}/styles" Target="styles.xml"/>` : '') +
        (theme ? `<Relationship Id="rIdT" Type="${R}/theme" Target="theme/theme1.xml"/>` : '') +
        '</Relationships>'
    ),
    ...(styles ? { 'word/styles.xml': strToU8(styles) } : {}),
    ...(theme ? { 'word/theme/theme1.xml': strToU8(THEME) } : {}),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        '<w:p><w:r><w:t xml:space="preserve">Visit example today and tomorrow</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    ),
  });
}

function mount(bytes: Uint8Array): { editor: DocxEditorInstance; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: bytes });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container };
}

function link(editor: DocxEditorInstance, start: number, end: number): void {
  editor.surface!.setSelection({
    anchor: { paragraphId: PID, offset: start },
    head: { paragraphId: PID, offset: end },
  });
  const result = editor.exec({ type: 'insertHyperlink', href: 'https://example.com' });
  if (!result.ok) throw new Error(`link refused: ${JSON.stringify(result)}`);
}

function saved(editor: DocxEditorInstance): Record<string, string> {
  const files = unzipSync(editor.surface!.session.save());
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]));
}

function hyperlinkStyles(stylesXml: string | undefined): string[] {
  return [
    ...(stylesXml ?? '').matchAll(/<w:style\b[^>]*w:styleId="Hyperlink\d*"[^>]*>.*?<\/w:style>/gs),
  ].map((match) => match[0]);
}

/** The `w:color` attributes of a saved style, in any attribute order. */
function colorOf(style: string | undefined): Record<string, string> {
  const element = /<w:color\b([^>]*)\/>/.exec(style ?? '')?.[1] ?? '';
  return Object.fromEntries(
    [...element.matchAll(/w:(\w+)="([^"]*)"/g)].map((match) => [match[1]!, match[2]!])
  );
}

describe('a new link where the document has no hyperlink style', () => {
  test('a document with no styles part gets the part and the style, and the link paints', () => {
    const { editor, container } = mount(docx());
    link(editor, 6, 13);
    const files = saved(editor);
    const [style] = hyperlinkStyles(files['word/styles.xml']);
    expect(style).toContain('w:type="character"');
    // No theme part: a literal color only, so every reader paints the same color.
    expect(colorOf(style)).toEqual({ val: '0563C1' });
    expect(style).toContain('<w:u w:val="single"/>');
    expect(files['word/document.xml']).toContain('<w:rStyle w:val="Hyperlink"/>');
    expect(files['[Content_Types].xml']).toContain('/word/styles.xml');
    expect(files['word/_rels/document.xml.rels']).toContain('styles.xml');

    const anchor = container.querySelector('a.docx-hyperlink') as HTMLElement | null;
    const span = anchor?.querySelector('span') ?? anchor;
    expect(span?.textContent).toBe('example');
    const painted = getComputedStyle(span!);
    expect(painted.color.replace(/\s/g, '')).toMatch(/rgb\(5,99,193\)|#0563c1/i);
    expect(painted.textDecorationLine || painted.textDecoration).toContain('underline');
  });

  test('the color comes from the theme and the style is based on the default character style', () => {
    const styles =
      `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">' +
      '<w:name w:val="Default Paragraph Font"/></w:style></w:styles>';
    const { editor } = mount(docx({ styles, theme: true }));
    link(editor, 6, 13);
    const [style] = hyperlinkStyles(saved(editor)['word/styles.xml']);
    expect(style).toContain('<w:basedOn w:val="DefaultParagraphFont"/>');
    expect(colorOf(style)).toEqual({ val: '467886', themeColor: 'hyperlink' });
  });

  test('one undo removes the link and the style; a second link adds no second style', () => {
    const { editor } = mount(docx());
    link(editor, 6, 13);
    editor.exec({ type: 'undo' });
    expect(editor.surface!.hyperlinks.linksInCaretParagraph()).toEqual([]);
    expect(hyperlinkStyles(saved(editor)['word/styles.xml'])).toEqual([]);

    link(editor, 6, 13);
    link(editor, 24, 32);
    const files = saved(editor);
    expect(hyperlinkStyles(files['word/styles.xml'])).toHaveLength(1);
    expect(files['word/document.xml'].match(/<w:rStyle w:val="Hyperlink"\/>/g)).toHaveLength(2);
  });

  test('a paragraph style that already uses the id leaves it alone', () => {
    const styles =
      `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:styleId="Hyperlink"><w:name w:val="Link Heading"/></w:style>' +
      '</w:styles>';
    const { editor } = mount(docx({ styles }));
    link(editor, 6, 13);
    const files = saved(editor);
    expect(files['word/styles.xml']).toContain('w:styleId="Hyperlink1"');
    expect(files['word/document.xml']).toContain('<w:rStyle w:val="Hyperlink1"/>');
    expect(files['word/styles.xml']).toContain('<w:name w:val="Link Heading"/>');
    // The next link finds the added style by its name and adds no other.
    link(editor, 24, 32);
    const again = saved(editor);
    expect(again['word/document.xml'].match(/<w:rStyle w:val="Hyperlink1"\/>/g)).toHaveLength(2);
    expect(again['word/styles.xml']).not.toContain('w:styleId="Hyperlink2"');
  });

  test('a character style named Hyperlink under another id is reused', () => {
    const styles =
      `<w:styles xmlns:w="${W}"><w:style w:type="character" w:styleId="Lienhypertexte">` +
      '<w:name w:val="Hyperlink"/><w:rPr><w:color w:val="FF0000"/></w:rPr></w:style></w:styles>';
    const { editor } = mount(docx({ styles }));
    link(editor, 6, 13);
    const out = saved(editor);
    expect(out['word/document.xml']).toContain('<w:rStyle w:val="Lienhypertexte"/>');
    expect(hyperlinkStyles(out['word/styles.xml'])).toEqual([]);
  });

  test('the blank document gets the style on its first link', () => {
    const { editor } = mount(blankDocumentBytes());
    editor.surface!.setSelection({
      anchor: { paragraphId: PID, offset: 0 },
      head: { paragraphId: PID, offset: 0 },
    });
    editor.surface!.type('gamma');
    editor.surface!.setSelection({
      anchor: { paragraphId: PID, offset: 0 },
      head: { paragraphId: PID, offset: 5 },
    });
    expect(editor.exec({ type: 'insertHyperlink', href: 'https://example.com' }).ok).toBe(true);
    expect(hyperlinkStyles(saved(editor)['word/styles.xml'])).toHaveLength(1);
  });

  test('an existing character style is reused by id, case-insensitively', () => {
    const styles =
      `<w:styles xmlns:w="${W}"><w:style w:type="character" w:styleId="hyperlink">` +
      '<w:name w:val="Hyperlink"/></w:style></w:styles>';
    const files = unzipSync(docx({ styles }));
    expect(files['word/styles.xml']).toBeDefined();
    const { editor } = mount(docx({ styles }));
    link(editor, 6, 13);
    const out = saved(editor);
    expect(out['word/document.xml']).toContain('<w:rStyle w:val="hyperlink"/>');
    expect(hyperlinkStyles(out['word/styles.xml'])).toEqual([]);
    expect(hyperlinkStyleFor(null).styleId).toBe('Hyperlink');
  });
});
