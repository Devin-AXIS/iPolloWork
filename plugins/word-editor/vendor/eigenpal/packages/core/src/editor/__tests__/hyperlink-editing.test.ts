// Hyperlink editing and navigation through the mounted editor.
//
// End to end over a real surface: insert a link, edit it, unlink it, jump to a bookmark, and
// confirm the two rules that matter most — the host page never navigates, and `window.open`
// is reachable from exactly one gate that only ever sees a sanitized target.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** Word's own hyperlink character style, for the documents that declare one. */
const STYLES_WITH_HYPERLINK =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>' +
  '<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
  '</w:styles>';

function docx(body: string, rels = '', stylesXml = ''): Uint8Array {
  const stylesRel = stylesXml
    ? `<Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/>`
    : '';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        (stylesXml
          ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${rels}${stylesRel}</Relationships>`
    ),
    ...(stylesXml ? { 'word/styles.xml': strToU8(stylesXml) } : {}),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const PID = (index: number) => `/word/document.xml#0.0.${index}`;

function nestedSmartTags(inner: string, count: number): string {
  let nested = inner;
  for (let index = 0; index < count; index += 1) {
    nested = `<w:smartTag>${nested}</w:smartTag>`;
  }
  return nested;
}

/**
 * A mounted editor and ITS OWN container.
 *
 * Every query below is scoped to this element. `document.querySelector` would find the
 * first editor any test in the file mounted — the painted anchors and the pages layer both
 * exist once per mount, and the whole-document lookup silently answered for a different
 * document than the one under test.
 */
interface Mounted {
  readonly editor: DocxEditorInstance;
  readonly container: HTMLElement;
}

function mount(body: string, rels = '', stylesXml = ''): Mounted {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body, rels, stylesXml) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container };
}

function select(mounted: Mounted, index: number, start: number, end: number): void {
  mounted.editor.surface!.setSelection({
    anchor: { paragraphId: PID(index), offset: start },
    head: { paragraphId: PID(index), offset: end },
  });
}

function caret(mounted: Mounted, index: number, offset: number): void {
  select(mounted, index, offset, offset);
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

/** The pages layer of THIS editor, for dispatching keyboard events at. */
function pagesOf(mounted: Mounted): HTMLElement {
  const pages = mounted.container.querySelector('.docx-pages');
  if (!pages) throw new Error('no pages layer');
  return pages as HTMLElement;
}

/** Click an element the way a browser does, and report whether the default was prevented. */
function click(element: HTMLElement, modifiers: { accel?: boolean } = {}): boolean {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    ...(modifiers.accel ? { metaKey: true } : {}),
  });
  element.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('editing a hyperlink through the editor', () => {
  test('insertHyperlink links the selection and the text is unchanged', () => {
    const mounted = mount(p('Visit example today'));
    select(mounted, 0, 6, 13);
    const result = mounted.editor.exec({ type: 'insertHyperlink', href: 'https://example.com' });
    expect(result.ok).toBe(true);
    expect(mounted.editor.surface!.hyperlinks.linksInCaretParagraph()).toHaveLength(1);
    const link = mounted.editor.surface!.hyperlinks.linksInCaretParagraph()[0]!;
    expect(link.text).toBe('example');
    expect(link.href).toBe('https://example.com');
    expect(link.kind).toBe('external');
  });

  test('a refused scheme never reaches the document', () => {
    const mounted = mount(p('Visit example today'));
    select(mounted, 0, 6, 13);
    const result = mounted.editor.exec({ type: 'insertHyperlink', href: 'javascript:alert(1)' });
    expect(result.ok).toBe(false);
    // Nothing partial: no link, and no relationship left behind pointing at it.
    expect(mounted.editor.surface!.hyperlinks.linksInCaretParagraph()).toEqual([]);
  });

  test('a bookmark target links as an internal anchor', () => {
    const mounted = mount(p('Jump there now'));
    select(mounted, 0, 5, 10);
    expect(mounted.editor.exec({ type: 'insertHyperlink', href: '#section3' }).ok).toBe(true);
    const link = mounted.editor.surface!.hyperlinks.linksInCaretParagraph()[0]!;
    expect(link.kind).toBe('internal');
    expect(link.anchor).toBe('section3');
    expect(link.href).toBe('#section3');
  });

  test('hyperlinkAt answers inside a link and null outside it', () => {
    const mounted = mount(p('Visit example today'));
    select(mounted, 0, 6, 13);
    mounted.editor.exec({ type: 'insertHyperlink', href: 'https://example.com' });
    caret(mounted, 0, 8);
    expect(mounted.editor.query({ type: 'hyperlinkAt' })?.href).toBe('https://example.com');
    caret(mounted, 0, 2);
    expect(mounted.editor.query({ type: 'hyperlinkAt' })).toBeNull();
  });

  test('an inert link is REPORTED, with no target to follow', () => {
    const mounted = mount(
      `<w:p><w:hyperlink r:id="rId9"><w:r><w:t>Click</w:t></w:r></w:hyperlink></w:p>`,
      `<Relationship Id="rId9" Type="${R}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>`
    );
    caret(mounted, 0, 2);
    // There IS a link here — an editor must offer to fix or remove it — and no href.
    const info = mounted.editor.query({ type: 'hyperlinkAt' });
    expect(info).not.toBeNull();
    expect(info!.href).toBe('');
  });

  test('removeHyperlink keeps the text and takes the link off', () => {
    const mounted = mount(p('Visit example today'));
    select(mounted, 0, 6, 13);
    mounted.editor.exec({ type: 'insertHyperlink', href: 'https://example.com' });
    caret(mounted, 0, 8);
    expect(mounted.editor.exec({ type: 'removeHyperlink' }).ok).toBe(true);
    expect(mounted.editor.surface!.hyperlinks.linksInCaretParagraph()).toEqual([]);
    expect(mounted.editor.surface!.session.bodyText()).toBe('Visit example today');
  });

  test('removeHyperlink with no link at the caret refuses rather than doing nothing quietly', () => {
    const mounted = mount(p('plain text'));
    caret(mounted, 0, 3);
    const result = mounted.editor.exec({ type: 'removeHyperlink' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe('notFound');
  });

  test('insert then undo is ONE step', () => {
    const mounted = mount(p('Visit example today'));
    select(mounted, 0, 6, 13);
    mounted.editor.exec({ type: 'insertHyperlink', href: 'https://example.com' });
    expect(mounted.editor.surface!.hyperlinks.linksInCaretParagraph()).toHaveLength(1);
    mounted.editor.exec({ type: 'undo' });
    expect(mounted.editor.surface!.hyperlinks.linksInCaretParagraph()).toEqual([]);
    expect(mounted.editor.surface!.session.bodyText()).toBe('Visit example today');
  });

  test('a document open for viewing takes no link, and no relationship either', () => {
    // The ops were always refused here — the lane writes through the gated session. The
    // RELATIONSHIP was not: it is minted on the package before the transaction and a refusal does
    // not take it back, so a reader ended up with an external target in their file's `.rels`.
    const mounted = mount(p('Visit example today'));
    mounted.editor.surface!.setEditingMode('view');
    select(mounted, 0, 6, 13);

    expect(
      mounted.editor.surface!.hyperlinks.applyHyperlink({ url: 'https://example.com/unwanted' })
    ).toBe(false);
    expect(mounted.editor.surface!.hyperlinks.linksInCaretParagraph()).toEqual([]);
    expect(mounted.editor.surface!.session.currentPackage().externalTargets).toEqual([]);
  });

  test('retargeting an existing link keeps its identity and its text', () => {
    const mounted = mount(p('Visit example today'));
    select(mounted, 0, 6, 13);
    mounted.editor.exec({ type: 'insertHyperlink', href: 'https://example.com' });
    const before = mounted.editor.surface!.hyperlinks.linksInCaretParagraph()[0]!;
    caret(mounted, 0, 8);
    expect(mounted.editor.surface!.hyperlinks.applyHyperlink({ url: 'https://example.org' })).toBe(
      true
    );
    const after = mounted.editor.surface!.hyperlinks.linksInCaretParagraph()[0]!;
    expect(after.id).toBe(before.id);
    expect(after.text).toBe('example');
    expect(after.href).toBe('https://example.org');
    expect(mounted.editor.surface!.session.bodyText()).toBe('Visit example today');
  });

  test('editing an existing link’s DISPLAY TEXT keeps the link', () => {
    // The ordinary Ctrl+K-then-change-the-text flow. Replacing the text as
    // delete-then-insert emptied every run in the link, the delete's own cleanup removed the
    // emptied `w:hyperlink`, and the insert landed in a plain run — the link vanished while
    // the operation reported success.
    const mounted = mount(p('Visit example today'), '', STYLES_WITH_HYPERLINK);
    select(mounted, 0, 6, 13);
    mounted.editor.exec({ type: 'insertHyperlink', href: 'https://example.com' });
    caret(mounted, 0, 8);

    expect(
      mounted.editor.surface!.hyperlinks.applyHyperlink({
        url: 'https://example.com/new',
        text: 'our site',
      })
    ).toBe(true);

    const links = mounted.editor.surface!.hyperlinks.linksInCaretParagraph();
    expect(links).toHaveLength(1);
    expect(links[0]!.text).toBe('our site');
    expect(links[0]!.href).toBe('https://example.com/new');
    expect(mounted.editor.surface!.session.bodyText()).toBe('Visit our site today');
  });

  const enclosingLinkCases = [
    { name: 'smartTag', wrap: (inner: string) => `<w:smartTag>${inner}</w:smartTag>` },
    { name: 'customXml', wrap: (inner: string) => `<w:customXml>${inner}</w:customXml>` },
    {
      name: 'w:ins',
      wrap: (inner: string) =>
        `<w:ins w:id="7" w:author="Prior" w:date="2020-01-01T00:00:00Z">${inner}</w:ins>`,
    },
  ] as const;

  test.each(enclosingLinkCases)(
    'right-biased display replacement stays in a hyperlink inside $name',
    ({ wrap }) => {
      const target = 'https://example.com/original';
      const hyperlink = '<w:hyperlink r:id="rId9"><w:r><w:t>Docs</w:t></w:r></w:hyperlink>';
      const mounted = mount(
        `<w:p>${wrap(hyperlink)}<w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>`,
        `<Relationship Id="rId9" Type="${R}/hyperlink" Target="${target}" TargetMode="External"/>`
      );
      const before = mounted.editor.surface!.hyperlinks.linksInCaretParagraph()[0]!;
      caret(mounted, 0, 2);

      expect(
        mounted.editor.surface!.hyperlinks.applyHyperlink({ url: target, text: 'Guide' })
      ).toBe(true);

      const links = mounted.editor.surface!.hyperlinks.linksInCaretParagraph();
      expect(links).toHaveLength(1);
      expect(links[0]!.id).toBe(before.id);
      expect(links[0]!.text).toBe('Guide');
      expect(links[0]!.href).toBe(target);
      expect(mounted.editor.surface!.session.bodyText()).toBe('Guide tail');
      expect(
        mounted.editor
          .surface!.session.currentPackage()
          .externalTargets.some((entry) => entry.id === 'rId9' && entry.rawTarget === target)
      ).toBe(true);
    }
  );

  test('deleting a link’s whole text keeps the bookmark markers that were inside it', () => {
    // Removing the emptied `w:hyperlink` took its subtree with it, so an anchor other links
    // point at disappeared — while the identical marker written OUTSIDE a link survives the
    // same deletion. The bookmark runs past the link, so the deletion does not enclose it.
    const mounted = mount(
      '<w:p><w:r><w:t>ab</w:t></w:r>' +
        '<w:hyperlink w:anchor="t"><w:bookmarkStart w:id="1" w:name="inside"/>' +
        '<w:r><w:t>cd</w:t></w:r></w:hyperlink>' +
        '<w:r><w:t>ef</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
    );
    expect(mounted.editor.surface!.bookmarks().has('inside')).toBe(true);
    select(mounted, 0, 2, 4);
    expect(mounted.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(mounted.editor.surface!.session.bodyText()).toBe('abef');
    // The link is gone (it has no text left); the anchor it contained is not.
    expect(mounted.editor.surface!.hyperlinks.linksInCaretParagraph()).toEqual([]);
    expect(mounted.editor.surface!.bookmarks().has('inside')).toBe(true);
  });

  test('deleting a link’s whole text removes a bookmark that lay entirely inside it', () => {
    const mounted = mount(
      '<w:p><w:r><w:t>ab</w:t></w:r>' +
        '<w:hyperlink w:anchor="t"><w:bookmarkStart w:id="1" w:name="inside"/>' +
        '<w:r><w:t>cd</w:t></w:r><w:bookmarkEnd w:id="1"/></w:hyperlink>' +
        '<w:r><w:t>ef</w:t></w:r></w:p>'
    );
    select(mounted, 0, 2, 4);
    expect(mounted.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(mounted.editor.surface!.session.bodyText()).toBe('abef');
    expect(mounted.editor.surface!.bookmarks().has('inside')).toBe(false);
  });

  test('a collapsed caret links the URL as its own display text', () => {
    const mounted = mount(p(''));
    caret(mounted, 0, 0);
    expect(mounted.editor.exec({ type: 'insertHyperlink', href: 'https://example.com' }).ok).toBe(
      true
    );
    const link = mounted.editor.surface!.hyperlinks.linksInCaretParagraph()[0]!;
    expect(link.text).toBe('https://example.com');
  });

  test('supplied display text replaces the selection', () => {
    const mounted = mount(p('Visit example today'));
    select(mounted, 0, 6, 13);
    expect(
      mounted.editor.exec({
        type: 'insertHyperlink',
        href: 'https://example.com',
        text: 'our site',
      }).ok
    ).toBe(true);
    expect(mounted.editor.surface!.session.bodyText()).toBe('Visit our site today');
    expect(mounted.editor.surface!.hyperlinks.linksInCaretParagraph()[0]!.text).toBe('our site');
  });

  test('a new link takes the document’s Hyperlink character style, by reference', () => {
    // Without this a new link is indistinguishable from the words around it and the user
    // cannot tell the command worked. By REFERENCE (`w:rStyle`), never by baking the
    // style's colour and underline onto the run — the two look identical and only one of
    // them saves as what Word wrote.
    const mounted = mount(p('Visit example today'), '', STYLES_WITH_HYPERLINK);
    select(mounted, 0, 6, 13);
    expect(mounted.editor.exec({ type: 'insertHyperlink', href: 'https://example.com' }).ok).toBe(
      true
    );
    const part = mounted.editor.surface!.session.part();
    const styles: string[] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.localName === 'rStyle') {
        styles.push(node.attributes.find((a) => a.localName === 'val')?.value ?? '');
      }
      for (const child of node.children) walk(child);
    };
    walk(part.root);
    expect(styles).toContain('Hyperlink');
    // One undo step for the whole thing — the style rides the insert's transaction.
    mounted.editor.exec({ type: 'undo' });
    expect(mounted.editor.surface!.hyperlinks.linksInCaretParagraph()).toEqual([]);
  });

  test('a document with no Hyperlink style still gets a working link', () => {
    const mounted = mount(p('Visit example today'));
    select(mounted, 0, 6, 13);
    expect(mounted.editor.exec({ type: 'insertHyperlink', href: 'https://example.com' }).ok).toBe(
      true
    );
    caret(mounted, 0, 8);
    // The built-in style is defined with the link (see hyperlink-style-creation.test.ts).
    expect(mounted.editor.surface!.hyperlinks.linkAtCaret()?.href).toBe('https://example.com');
    const saved = unzipSync(mounted.editor.surface!.session.save());
    expect(new TextDecoder().decode(saved['word/document.xml'])).toContain(
      '<w:rStyle w:val="Hyperlink"/>'
    );
    expect(new TextDecoder().decode(saved['word/styles.xml'])).toContain('w:styleId="Hyperlink"');
  });

  test('a link’s text can be restyled, and the direct formatting wins over the style', () => {
    // Word lets you select a hyperlink and make it red, bold, whatever — the `Hyperlink`
    // character style is a default, not a lock. Formatting must therefore reach the runs
    // INSIDE the `w:hyperlink` (they are ordinary runs at a depth the ops address by id),
    // and the direct property must beat the style reference in the cascade.
    const mounted = mount(p('Visit example today'), '', STYLES_WITH_HYPERLINK);
    select(mounted, 0, 6, 13);
    mounted.editor.exec({ type: 'insertHyperlink', href: 'https://example.com' });

    select(mounted, 0, 6, 13);
    expect(
      mounted.editor.exec({ type: 'setMarkAttr', mark: 'color', attr: 'val', value: 'FF0000' }).ok
    ).toBe(true);

    // The link is intact and still points where it did.
    caret(mounted, 0, 8);
    expect(mounted.editor.surface!.hyperlinks.linkAtCaret()?.href).toBe('https://example.com');
    expect(mounted.editor.surface!.session.bodyText()).toBe('Visit example today');

    // The style REFERENCE survives — a later edit must not have silently unstyled the link —
    // and the direct colour is what the run resolves to.
    const part = mounted.editor.surface!.session.part();
    const seen: string[] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.localName === 'rStyle' || node.localName === 'color') {
        seen.push(
          `${node.localName}=${node.attributes.find((a) => a.localName === 'val')?.value ?? ''}`
        );
      }
      for (const child of node.children) walk(child);
    };
    walk(part.root);
    expect(seen).toContain('rStyle=Hyperlink');
    expect(seen).toContain('color=FF0000');

    // And it PAINTS red: the cascade resolves direct formatting over the character style.
    const painted = [...mounted.container.querySelectorAll('a.docx-hyperlink [data-start]')].map(
      (span) => (span as HTMLElement).style.color
    );
    expect(painted.map((color) => color.toLowerCase())).toContain('#ff0000');
    expect(painted.some((color) => color.toLowerCase() === '#0563c1')).toBe(false);
  });

  test('a link label shows visible hyphens and keeps the hyphen elements', () => {
    // "co<noBreakHyphen/>op": the popup reads and selects the label with U+2011.
    const mounted = mount(
      '<w:p><w:r><w:t>Visit co</w:t><w:noBreakHyphen/><w:t>op now</w:t></w:r></w:p>'
    );
    select(mounted, 0, 6, 11);
    const label = mounted.editor.query({ type: 'selectedText' });
    expect(label).toBe('co\u2011op');
    // Creating the link with the text the popup prefilled must not rewrite the words.
    expect(
      mounted.editor.surface!.hyperlinks.applyHyperlink({ url: 'https://example.com', text: label })
    ).toBe(true);
    const link = mounted.editor.surface!.hyperlinks.linksInCaretParagraph()[0]!;
    expect(link.text).toBe('co\u2011op');
    // Saving the edit panel unchanged writes nothing to the label either.
    caret(mounted, 0, 8);
    expect(
      mounted.editor.surface!.hyperlinks.applyHyperlink({
        url: 'https://example.org',
        text: link.text,
      })
    ).toBe(true);
    const xml = new TextDecoder().decode(
      unzipSync(mounted.editor.surface!.session.save())['word/document.xml']!
    );
    expect(xml).toContain('<w:noBreakHyphen/>');
    expect(xml).not.toContain('\u2011');
    expect(mounted.editor.surface!.session.bodyText()).toBe('Visit co\u001eop now');
  });

  test('a link survives a save and reopen with its target intact', () => {
    const mounted = mount(p('Visit example today'));
    select(mounted, 0, 6, 13);
    mounted.editor.exec({ type: 'insertHyperlink', href: 'https://example.com' });
    const bytes = mounted.editor.surface!.session.save();

    const container = document.createElement('div');
    document.body.append(container);
    const reopened = createDocxEditor({ container, document: bytes });
    reopened.surface!.setSelection({
      anchor: { paragraphId: PID(0), offset: 8 },
      head: { paragraphId: PID(0), offset: 8 },
    });
    const link = reopened.surface!.hyperlinks.linksInCaretParagraph()[0];
    expect(link?.href).toBe('https://example.com');
    expect(reopened.surface!.session.bodyText()).toBe('Visit example today');
  });

  test('a hyperlink at the container cap is not reported or activated', () => {
    const target = 'https://example.com/deep';
    const relationship = `<Relationship Id="rId9" Type="${R}/hyperlink" Target="${target}" TargetMode="External"/>`;
    const link = '<w:hyperlink r:id="rId9"><w:r><w:t>Hidden</w:t></w:r></w:hyperlink>';
    const mounted = mount(`<w:p>${nestedSmartTags(link, 31)}</w:p>`, relationship);
    caret(mounted, 0, 0);

    expect(mounted.editor.surface!.session.bodyText()).toBe('');
    expect(mounted.editor.surface!.hyperlinks.linksInCaretParagraph()).toEqual([]);
    expect(mounted.editor.surface!.hyperlinks.linkAtCaret()).toBeNull();
    expect(mounted.editor.query({ type: 'hyperlinkAt' })).toBeNull();
    expect(mounted.container.querySelector('a.docx-hyperlink')).toBeNull();
  });

  test('a hyperlink below the container cap reports its span and activates', () => {
    const target = 'https://example.com/deep';
    const relationship = `<Relationship Id="rId9" Type="${R}/hyperlink" Target="${target}" TargetMode="External"/>`;
    const link = '<w:hyperlink r:id="rId9"><w:r><w:t>Visible</w:t></w:r></w:hyperlink>';
    const mounted = mount(`<w:p>${nestedSmartTags(link, 30)}</w:p>`, relationship);
    const activations: string[] = [];
    mounted.editor.setHyperlinkChrome({
      onPopover: (activation) => activations.push(activation.link.href ?? ''),
    });
    caret(mounted, 0, 0);

    expect(mounted.editor.surface!.hyperlinks.linksInCaretParagraph()).toMatchObject([
      { start: 0, end: 7, text: 'Visible', href: target },
    ]);
    expect(mounted.editor.surface!.hyperlinks.linkAtCaret()?.href).toBe(target);
    click(anchorFor(mounted, 'Visible'));
    expect(activations).toEqual([target]);
  });
});

describe('clicking a painted link', () => {
  const EXTERNAL = `<Relationship Id="rId9" Type="${R}/hyperlink" Target="https://example.com" TargetMode="External"/>`;

  test('the host page NEVER navigates, whatever the click means', () => {
    const mounted = mount(
      `<w:p><w:hyperlink r:id="rId9"><w:r><w:t>Example</w:t></w:r></w:hyperlink></w:p>`,
      EXTERNAL
    );
    // Default prevented even with no popover registered and no modifier: the browser is
    // never the one deciding, because following the link would unload unsaved work.
    expect(click(anchorFor(mounted, 'Example'))).toBe(true);
  });

  test('a plain click on an external link asks the host for a popover', () => {
    const mounted = mount(
      `<w:p><w:hyperlink r:id="rId9"><w:r><w:t>Example</w:t></w:r></w:hyperlink></w:p>`,
      EXTERNAL
    );
    const seen: string[] = [];
    mounted.editor.setHyperlinkChrome({
      onPopover: (activation) => seen.push(activation.link.href ?? ''),
    });
    caret(mounted, 0, 3);
    click(anchorFor(mounted, 'Example'));
    expect(seen).toEqual(['https://example.com']);
  });

  test('a click that ends a RANGE selection does not pop', () => {
    const mounted = mount(
      `<w:p><w:hyperlink r:id="rId9"><w:r><w:t>Example</w:t></w:r></w:hyperlink></w:p>`,
      EXTERNAL
    );
    const seen: string[] = [];
    mounted.editor.setHyperlinkChrome({ onPopover: (activation) => seen.push(activation.link.id) });
    select(mounted, 0, 0, 5);
    click(anchorFor(mounted, 'Example'));
    expect(seen).toEqual([]);
  });

  test('an internal link jumps to its bookmark and moves the caret; no popover', () => {
    const mounted = mount(
      `<w:p><w:hyperlink w:anchor="target"><w:r><w:t>Go</w:t></w:r></w:hyperlink></w:p>` +
        p('filler') +
        `<w:p><w:bookmarkStart w:id="1" w:name="target"/><w:r><w:t>Destination</w:t></w:r></w:p>`
    );
    const seen: string[] = [];
    mounted.editor.setHyperlinkChrome({ onPopover: (activation) => seen.push(activation.link.id) });
    caret(mounted, 0, 1);
    click(anchorFor(mounted, 'Go'));
    expect(seen).toEqual([]);
    expect(mounted.editor.surface!.state().selection.head.paragraphId).toBe(PID(2));
  });

  test('an internal link jumps after a wrapped complex field at its model offset', () => {
    const mounted = mount(
      '<w:p><w:hyperlink w:anchor="target"><w:r><w:t>Go</w:t></w:r></w:hyperlink></w:p>' +
        '<w:p><w:smartTag>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>12</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '<w:bookmarkStart w:id="1" w:name="target"/>' +
        '<w:r><w:t>Destination</w:t></w:r>' +
        '</w:smartTag></w:p>'
    );
    expect(mounted.editor.surface!.bookmarks().get('target')?.offset).toBe(1);

    caret(mounted, 0, 1);
    click(anchorFor(mounted, 'Go'));

    expect(mounted.editor.surface!.state().selection.head).toMatchObject({
      paragraphId: PID(1),
      offset: 1,
    });
  });

  test('a dangling anchor is an inert click: no jump, no popover, no error', () => {
    const mounted = mount(
      `<w:p><w:hyperlink w:anchor="nowhere"><w:r><w:t>Go</w:t></w:r></w:hyperlink></w:p>` +
        p('rest')
    );
    const seen: string[] = [];
    mounted.editor.setHyperlinkChrome({ onPopover: (activation) => seen.push(activation.link.id) });
    caret(mounted, 0, 1);
    click(anchorFor(mounted, 'Go'));
    expect(seen).toEqual([]);
    expect(mounted.editor.surface!.state().selection.head.paragraphId).toBe(PID(0));
  });

  test('a duplicate bookmark name resolves to the FIRST in document order', () => {
    const mounted = mount(
      `<w:p><w:bookmarkStart w:id="1" w:name="dup"/><w:r><w:t>first</w:t></w:r></w:p>` +
        `<w:p><w:bookmarkStart w:id="2" w:name="dup"/><w:r><w:t>second</w:t></w:r></w:p>` +
        `<w:p><w:hyperlink w:anchor="dup"><w:r><w:t>Go</w:t></w:r></w:hyperlink></w:p>`
    );
    caret(mounted, 2, 1);
    click(anchorFor(mounted, 'Go'));
    expect(mounted.editor.surface!.state().selection.head.paragraphId).toBe(PID(0));
  });
});

describe('external activation has exactly one gate', () => {
  test('openExternal refuses an inert link, a fragment, and nothing at all', () => {
    const mounted = mount(p('text'));
    const navigation = mounted.editor.surface!.navigation;
    expect(navigation.openExternal(null)).toBe(false);
    expect(navigation.openExternal('')).toBe(false);
    // A fragment is an in-document jump, not something to open in a tab.
    expect(navigation.openExternal('#section1')).toBe(false);
  });

  test('a bookmark jump is available headlessly and answers false for an unknown name', () => {
    const mounted = mount(
      p('one') + `<w:p><w:bookmarkStart w:id="1" w:name="known"/><w:r><w:t>two</w:t></w:r></w:p>`
    );
    expect(mounted.editor.surface!.navigation.goToBookmark('known')).toBe(true);
    expect(mounted.editor.surface!.state().selection.head.paragraphId).toBe(PID(1));
    expect(mounted.editor.surface!.navigation.goToBookmark('unknown')).toBe(false);
  });

  test('Word’s own _GoBack scratch bookmark is not a jump target', () => {
    const mounted = mount(
      `<w:p><w:bookmarkStart w:id="0" w:name="_GoBack"/><w:r><w:t>one</w:t></w:r></w:p>`
    );
    expect(mounted.editor.surface!.bookmarks().has('_GoBack')).toBe(false);
  });
});

describe('Ctrl/Cmd+K reports the request to the host', () => {
  test('the keymap asks; it does not invent a dialog', () => {
    const mounted = mount(p('alpha'));
    let asked = 0;
    mounted.editor.setHyperlinkChrome({ onRequest: () => (asked += 1) });
    const pages = pagesOf(mounted);
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    pages.dispatchEvent(event);
    expect(asked).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  test('unregistering restores the previous handler', () => {
    const mounted = mount(p('alpha'));
    const order: string[] = [];
    const outer = mounted.editor.setHyperlinkChrome({ onRequest: () => order.push('outer') });
    const inner = mounted.editor.setHyperlinkChrome({ onRequest: () => order.push('inner') });
    const pages = pagesOf(mounted);
    const press = () =>
      pages.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })
      );
    press();
    inner();
    press();
    outer();
    expect(order).toEqual(['inner', 'outer']);
  });
});

/** A complete complex field around one instruction, with an optional cached result. */
function complexField(instr: string, result = ''): string {
  return (
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText>${instr}</w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    result +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
  );
}

describe('a field link at the caret', () => {
  // 'See ' is four characters; the HYPERLINK field's result projects as ONE atom over [4, 5).
  const FIELD_DOC =
    '<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r>' +
    complexField(' HYPERLINK "https://example.com" ', '<w:r><w:t>site</w:t></w:r>') +
    '</w:p>';

  test('resolves the field link when the caret sits on the atom start', () => {
    const mounted = mount(FIELD_DOC);
    caret(mounted, 0, 4);
    const link = mounted.editor.surface!.hyperlinks.fieldLinkAtCaret();
    expect(link).not.toBeNull();
    expect(link!.href).toBe('https://example.com');
    // A field link names no tree node, so it carries no addressable paragraph.
    expect(link!.paragraphId).toBe('');
  });

  test('resolves the field link at the atom trailing edge too', () => {
    const mounted = mount(FIELD_DOC);
    caret(mounted, 0, 5);
    expect(mounted.editor.surface!.hyperlinks.fieldLinkAtCaret()?.href).toBe('https://example.com');
  });

  test('returns null when the caret is off the atom', () => {
    const mounted = mount(FIELD_DOC);
    caret(mounted, 0, 1);
    expect(mounted.editor.surface!.hyperlinks.fieldLinkAtCaret()).toBeNull();
  });

  test('the typed lane never returns the field link', () => {
    const mounted = mount(FIELD_DOC);
    caret(mounted, 0, 4);
    // `linkAtCaret` walks `w:hyperlink` nodes; a field has none, so link-create cannot mistake
    // the atom for an existing editable link.
    expect(mounted.editor.surface!.hyperlinks.linkAtCaret()).toBeNull();
  });

  test('returns null in a document with no field link', () => {
    const mounted = mount(p('plain text'));
    caret(mounted, 0, 3);
    expect(mounted.editor.surface!.hyperlinks.fieldLinkAtCaret()).toBeNull();
  });
});

describe('whether a link target is a pending deletion', () => {
  const DEL = 'w:author="Ada" w:date="2026-01-01T00:00:00Z"';
  // "keep " + struck "GONE" by one author + struck "BYE" by another + " tail".
  const STRUCK =
    '<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r>' +
    `<w:del w:id="1" ${DEL}><w:r><w:delText>GONE</w:delText></w:r></w:del>` +
    `<w:del w:id="2" ${DEL.replace('Ada', 'Bea')}><w:r><w:delText>BYE</w:delText></w:r></w:del>` +
    '<w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>';

  test('struck words, across adjacent deletions, are deleted; live or partial words are not', () => {
    const mounted = mount(STRUCK);
    const deleted = () => mounted.editor.surface!.hyperlinks.selectionIsPendingDeletion();
    select(mounted, 0, 5, 9);
    expect(deleted()).toBe(true);
    select(mounted, 0, 12, 5);
    expect(deleted()).toBe(true);
    select(mounted, 0, 3, 9);
    expect(deleted()).toBe(false);
    select(mounted, 0, 10, 14);
    expect(deleted()).toBe(false);
    caret(mounted, 0, 6);
    expect(deleted()).toBe(false);
  });
});
