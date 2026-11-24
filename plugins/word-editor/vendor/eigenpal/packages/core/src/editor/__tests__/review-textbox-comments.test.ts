// A comment on text inside a text box: the control offers it, the comment lands in the box's
// own paragraph, its card has a place beside the page, and it survives save and reopen.
//
// The selection inside a box was in no story's paragraph order, so the comment range read
// as empty and the control said "a comment needs a selected range" with text plainly
// selected. Box text is also in no story's fragments, so a card on it had no geometry.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { runToolbarCommand, toolbarCommandState } from '../toolbar-commands.ts';
import { collectReviewItems, findNode, revisionItemsOf } from '@docx-editor.dev/core/store';
import type { EditorModule } from '../../contracts/modules.ts';
import type { TextMatch } from '../../contracts/editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;
const NAMESPACES = `xmlns:w="${W}" xmlns:wps="${WPS}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:v="${V}" xmlns:r="${R}"`;
const MIME = (name: string) =>
  `application/vnd.openxmlformats-officedocument.wordprocessingml.${name}+xml`;

/** A document with `body`, and with `header` as its default header when given. */
function docxOf(body: string, header?: string): Uint8Array {
  const sectPr = header
    ? `<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>`
    : '';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${MIME('document.main')}"/>` +
        `<Override PartName="/word/header1.xml" ContentType="${MIME('header')}"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/></Relationships>`
    ),
    'word/header1.xml': strToU8(`<w:hdr ${NAMESPACES}>${header ?? '<w:p/>'}</w:hdr>`),
    'word/document.xml': strToU8(
      `<w:document ${NAMESPACES}><w:body>${body}${sectPr}</w:body></w:document>`
    ),
  });
}

/** The engine's own review derivation, wired as a module (core may not import pro). */
function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems,
      revisionItemsOfParagraph: (part, paragraphId) => {
        const paragraph = findNode(part, paragraphId);
        if (!paragraph || paragraph.kind !== 'paragraph') return [];
        return revisionItemsOf({
          id: part.id,
          name: part.name,
          contentType: part.contentType,
          root: paragraph,
        });
      },
    },
  };
}

const BOX_TEXT = '<w:p><w:r><w:t>Inside the box</w:t></w:r></w:p>';

const DRAWING_BOX =
  '<w:p><w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="2000000" cy="800000"/>' +
  '<wp:wrapNone/><wp:docPr id="1" name="Box"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
  '<wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm><a:prstGeom prst="rect"/></wps:spPr>' +
  `<wps:txbx><w:txbxContent>${BOX_TEXT}</w:txbxContent></wps:txbx>` +
  '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r><w:r><w:t>Host</w:t></w:r></w:p>';

const VML_BOX =
  '<w:p><w:r><w:pict><v:rect style="position:absolute;margin-left:200pt;margin-top:0;' +
  'width:144pt;height:48pt;z-index:1;mso-position-horizontal-relative:page">' +
  `<v:textbox><w:txbxContent>${BOX_TEXT}</w:txbxContent></v:textbox></v:rect></w:pict></w:r>` +
  '<w:r><w:t>Host</w:t></w:r></w:p>';

const BODY = '<w:p><w:r><w:t>Body text</w:t></w:r></w:p>';

const editors: DocxEditorInstance[] = [];
const containers = new WeakMap<DocxEditorInstance, HTMLElement>();
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function mount(document_: Uint8Array): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: document_,
    author: 'Grace',
    modules: [reviewModule()],
  });
  editors.push(editor);
  editor.setCommentDraftChrome({ onRequest: () => {} });
  container.remove();
  containers.set(editor, container);
  return editor;
}

/** Open the box holding the first match of "box", as a press on its text does. */
function openBox(editor: DocxEditorInstance): TextMatch {
  const [match] = editor.findMatches('box') as readonly TextMatch[];
  if (match?.scope?.kind !== 'frame') throw new Error('no text box match');
  const surface = editor.surface!;
  const owner = match.scope.owner;
  if (owner) {
    surface.enterHeaderFooter!({
      rId: owner.rId,
      position: { paragraphId: match.scope.hostParagraphId, offset: 0 },
    });
  }
  expect(surface.setActiveScope(match.scope)).toBe(true);
  return match;
}

async function documentXml(editor: DocxEditorInstance, part: string): Promise<string> {
  return strFromU8(unzipSync(new Uint8Array(await editor.save()))[part]!);
}

for (const [name, body, header, part] of [
  ['DrawingML', DRAWING_BOX, undefined, 'word/document.xml'],
  ['VML', VML_BOX, undefined, 'word/document.xml'],
  ['header', BODY, VML_BOX, 'word/header1.xml'],
] as const) {
  test(`a comment on ${name} text box text is offered, written in the box, and kept`, async () => {
    const editor = mount(docxOf(body, header));
    const match = openBox(editor);
    const paragraphId = match.blockId;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 6 },
    });

    expect(toolbarCommandState(editor, 'review.addComment').enabled).toBe(true);
    expect(editor.getSelectionPlacement()?.pageIndex).toBe(0);
    expect(editor.addComment('Check this')).toEqual({ ok: true, changed: true });

    const [card] = editor.getReviewItems();
    expect(card?.item.kind).toBe('comment');
    // The card sits beside the page, so the rail can place it.
    expect(card?.pageIndex).toBe(0);
    expect(card?.anchorY).not.toBeNull();
    const range = card?.item.kind === 'comment' ? card.item.range : null;
    expect(range?.start).toEqual({ paragraphId, offset: 0 });
    expect(range?.end).toEqual({ paragraphId, offset: 6 });
    // The commented text carries its band, as commented body text does.
    expect(
      containers.get(editor)!.querySelector('.docx-comment-overlay')!.children.length
    ).toBeGreaterThan(0);

    // Opening the card opens the box it annotates.
    editor.surface!.setActiveScope({ kind: 'body' });
    editor.surface!.exitHeaderFooter?.();
    expect(editor.setActiveReviewItem(card!.key).ok).toBe(true);
    expect(editor.surface!.activeScope().kind).toBe('frame');

    const xml = await documentXml(editor, part);
    const box = xml.slice(xml.indexOf('<w:txbxContent>'), xml.indexOf('</w:txbxContent>'));
    expect(box).toContain('<w:commentRangeStart w:id="0"/><w:r><w:t>Inside</w:t></w:r>');
    expect(box).toContain('<w:commentRangeEnd w:id="0"/>');

    const reopened = mount(new Uint8Array(await editor.save()));
    const [kept] = reopened.getReviewItems();
    expect(kept?.item.kind === 'comment' && kept.item.range?.start.offset).toBe(0);
    expect(kept?.anchorY).not.toBeNull();
  });
}

test('a caret in a word inside a text box comments on that word', () => {
  const editor = mount(docxOf(VML_BOX));
  const { blockId: paragraphId } = openBox(editor);
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 2 },
    head: { paragraphId, offset: 2 },
  });
  expect(toolbarCommandState(editor, 'review.addComment').enabled).toBe(true);
  expect(runToolbarCommand(editor, 'review.addComment').ok).toBe(true);
  expect(editor.surface!.state().selection).toEqual({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 6 },
  });
});

test('a comment card sits level with its line in the box, not at the box top', () => {
  const lines = ['First', 'Second', 'Third', 'Fourth'].map(
    (text) => `<w:p><w:r><w:t>${text} line</w:t></w:r></w:p>`
  );
  const tall = VML_BOX.replace(BOX_TEXT, lines.join('')).replace('height:48pt', 'height:200pt');
  const editor = mount(docxOf(tall));
  const [first] = editor.findMatches('First') as readonly TextMatch[];
  const [fourth] = editor.findMatches('Fourth') as readonly TextMatch[];
  expect(editor.surface!.setActiveScope(first!.scope!)).toBe(true);
  const placementOf = (match: TextMatch) => {
    editor.surface!.setSelection({
      anchor: { paragraphId: match.blockId, offset: 0 },
      head: { paragraphId: match.blockId, offset: 4 },
    });
    return editor.getSelectionPlacement()!.anchorY;
  };
  const top = placementOf(first!);
  const low = placementOf(fourth!);
  expect(low).toBeGreaterThan(top + 20);
  expect(editor.addComment('Low line')).toEqual({ ok: true, changed: true });
  expect(editor.getReviewItems()[0]?.anchorY).toBe(low);
});

test('a selection from a text box into the body offers no comment', () => {
  const editor = mount(docxOf(VML_BOX + BODY));
  const { blockId: paragraphId } = openBox(editor);
  const bodyParagraph = editor.surface!.session.paragraphIds().at(-1)!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId: bodyParagraph, offset: 4 },
  });
  expect(editor.getSelectionPlacement()).toBeNull();
  expect(editor.addComment('Spans two stories').ok).toBe(false);
  expect(editor.getReviewItems()).toHaveLength(0);
});
