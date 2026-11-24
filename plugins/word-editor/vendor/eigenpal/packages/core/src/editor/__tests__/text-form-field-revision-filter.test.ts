// A reviewer filter reaches into a text form field.
//
// Hiding an author (Review → Markup Options → Reviewers) and `setTrackedChangesFilter` are
// view-time projections: the review list drops the card, the change bar goes, and the text
// paints as accepted. A change inside a legacy FORMTEXT result took a different route to the
// page — buffered while the field was open, flushed at its end — and that route skipped the
// projection, so the page still showed the reviewer's colour after the other two surfaces had
// let go. These pin the three surfaces to one answer in the body, a table cell, a header, a
// footer, a footnote and an anchored text box — every story the walk serves.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  collectReviewItems as engineCollectReviewItems,
  findNode,
  revisionItemsOf,
} from '@docx-editor.dev/core/store';
import type { EditorModule } from '../../contracts/modules.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const NS = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}"`;

interface StoryParts {
  readonly header?: string;
  readonly footer?: string;
  readonly footnotes?: string;
}

function docxOf(body: string, extra: StoryParts = {}): Uint8Array {
  const overrides: string[] = [];
  const rels: string[] = [];
  const parts: Record<string, Uint8Array> = {};
  if (extra.header) {
    overrides.push(
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
    );
    rels.push(`<Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/>`);
    parts['word/header1.xml'] = strToU8(`<w:hdr ${NS}>${extra.header}</w:hdr>`);
  }
  if (extra.footer) {
    overrides.push(
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
    );
    rels.push(`<Relationship Id="rIdF1" Type="${R}/footer" Target="footer1.xml"/>`);
    parts['word/footer1.xml'] = strToU8(`<w:ftr ${NS}>${extra.footer}</w:ftr>`);
  }
  if (extra.footnotes) {
    overrides.push(
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
    );
    rels.push(`<Relationship Id="rIdF" Type="${R}/footnotes" Target="footnotes.xml"/>`);
    parts['word/footnotes.xml'] = strToU8(`<w:footnotes ${NS}>${extra.footnotes}</w:footnotes>`);
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        overrides.join('') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${rels.join('')}</Relationships>`
    ),
    'word/document.xml': strToU8(`<w:document ${NS}><w:body>${body}</w:body></w:document>`),
    ...parts,
  });
}

/** The engine's own review derivation, wired as a module (core may not import pro). */
function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems: engineCollectReviewItems,
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

function mount(bytes: Uint8Array): {
  editor: DocxEditorInstance;
  container: HTMLElement;
  dispose: () => void;
} {
  const container = document.createElement('div');
  document.body.append(container);
  let editor: DocxEditorInstance | undefined;
  try {
    editor = createDocxEditor({
      container,
      document: bytes,
      author: 'Grace Hopper',
      modules: [reviewModule()],
    });
    if (!editor.surface) throw new Error('surface failed to mount');
  } catch (error) {
    editor?.destroy();
    container.remove();
    throw error;
  }
  const mounted = editor;
  // `destroy` unmounts the editor, not the host: the container must leave `document` too, or
  // every test after this one queries a page the previous test painted.
  const dispose = () => {
    mounted.destroy();
    container.remove();
  };
  return { editor: mounted, container, dispose };
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const ins = (author: string, inner: string) =>
  `<w:ins w:id="1" w:author="${author}" w:date="2026-09-01T10:00:00Z">${inner}</w:ins>`;
const FORMTEXT_OPEN =
  '<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Text1"/><w:enabled/>' +
  '<w:calcOnExit w:val="0"/><w:textInput><w:default w:val="x"/></w:textInput></w:ffData>' +
  '</w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const FIELD_END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const formText = (result: string) =>
  `<w:bookmarkStart w:id="0" w:name="Text1"/>${FORMTEXT_OPEN}${result}${FIELD_END}<w:bookmarkEnd w:id="0"/>`;
const TABLE_OPEN =
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc><w:tcPr/>';
const TABLE_CLOSE = '</w:tc></w:tr></w:tbl><w:p/>';
/** An anchored text box holding one paragraph: the only shape whose story the engine paints. */
const textBox = (paragraph: string) =>
  '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
  'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/>' +
  '<wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH>' +
  '<wp:positionV relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionV>' +
  '<wp:extent cx="2743200" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
  '<wp:wrapNone/><wp:docPr id="3" name="Text box"/>' +
  `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
  '<wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
  `<wps:txbx><w:txbxContent>${paragraph}</w:txbxContent></wps:txbx><wps:bodyPr/>` +
  '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';

/** What the page says about tracked text: every marked span, with its author. */
function markedText(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('.docx-revision')].map(
    (element) => `${element.dataset.reviewAuthor ?? ''}:${element.textContent ?? ''}`
  );
}
const changeBars = (container: HTMLElement) =>
  container.querySelectorAll('.docx-revision-band').length;
const cardCount = (editor: DocxEditorInstance) =>
  editor.getReviewItems().filter((item) => item.kind === 'revision').length;

describe('reviewer filters inside a text form field', () => {
  const fieldParagraph = `<w:p>${formText(run('A ') + ins('Ada', run('new')))}</w:p>`;
  const stories: ReadonlyArray<{
    readonly name: string;
    readonly body: string;
    readonly extra?: StoryParts;
    /** Body stories draw a change bar in the margin; furniture and text boxes do not. */
    readonly changeBar: boolean;
  }> = [
    { name: 'a body paragraph', body: fieldParagraph, changeBar: true },
    { name: 'a table cell', body: `${TABLE_OPEN}${fieldParagraph}${TABLE_CLOSE}`, changeBar: true },
    {
      name: 'a header',
      body: `<w:p>${run('Body')}</w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>`,
      extra: { header: fieldParagraph },
      changeBar: false,
    },
    {
      name: 'a footer',
      body: `<w:p>${run('Body')}</w:p><w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/></w:sectPr>`,
      extra: { footer: fieldParagraph },
      changeBar: false,
    },
    {
      name: 'a footnote',
      body: `<w:p>${run('Body')}<w:r><w:footnoteReference w:id="1"/></w:r></w:p>`,
      extra: { footnotes: `<w:footnote w:id="1">${fieldParagraph}</w:footnote>` },
      changeBar: false,
    },
    {
      name: 'an anchored text box',
      body: `<w:p>${run('Body')}${textBox(fieldParagraph)}</w:p>`,
      changeBar: false,
    },
  ];

  for (const story of stories) {
    test(`hiding the author clears the markup in ${story.name}`, () => {
      const { editor, container, dispose } = mount(docxOf(story.body, story.extra));
      try {
        expect(markedText(container)).toEqual(['Ada:new']);
        expect(changeBars(container)).toBe(story.changeBar ? 1 : 0);
        expect(cardCount(editor)).toBe(1);

        editor.setReviewAuthorVisible('Ada', false);
        expect(markedText(container)).toEqual([]);
        expect(changeBars(container)).toBe(0);
        expect(cardCount(editor)).toBe(0);
        // Accepted, not removed: the text stays, only the markup goes.
        expect(container.textContent).toContain('A new');

        editor.setReviewAuthorVisible('Ada', true);
        expect(markedText(container)).toEqual(['Ada:new']);
        expect(cardCount(editor)).toBe(1);
      } finally {
        dispose();
      }
    });
  }

  test('a tracked-changes predicate projects the field content as accepted or rejected', () => {
    const { editor, container, dispose } = mount(docxOf(fieldParagraph));
    try {
      expect(changeBars(container)).toBe(1);
      editor.setTrackedChangesFilter(() => false);
      expect(markedText(container)).toEqual([]);
      expect(changeBars(container)).toBe(0);
      expect(cardCount(editor)).toBe(0);
      expect(container.textContent).toContain('A new');

      editor.setTrackedChangesFilter(() => false, 'reject');
      expect(markedText(container)).toEqual([]);
      expect(container.textContent).not.toContain('new');

      editor.setTrackedChangesFilter(null);
      expect(markedText(container)).toEqual(['Ada:new']);
    } finally {
      dispose();
    }
  });

  test('a hidden author around the whole field, and a visible one inside it, keep their own answers', () => {
    const inside = `<w:del w:id="2" w:author="Grace Hopper"><w:r><w:delText>gone</w:delText></w:r></w:del>`;
    const { editor, container, dispose } = mount(
      docxOf(`<w:p>${run('A ')}${ins('Ada', formText(run('new') + inside))}</w:p>`)
    );
    try {
      editor.setReviewAuthorVisible('Ada', false);
      expect(markedText(container)).toEqual(['Grace Hopper:gone']);
    } finally {
      dispose();
    }
  });

  test('a suggestion typed into the field follows the reviewer filter and saves unchanged', async () => {
    const { editor, container, dispose } = mount(
      docxOf(`<w:p>${formText(run('Just a text'))}</w:p>`)
    );
    try {
      editor.setEditingMode('suggesting');
      const paragraphId = editor.surface!.session.paragraphIds()[0]!;
      const at = { paragraphId, offset: 6 };
      editor.surface!.setSelection({ anchor: at, head: at });
      expect(editor.exec({ type: 'insertText', text: 'XX' }).ok).toBe(true);
      expect(markedText(container)).toEqual(['Grace Hopper:XX']);
      const saved = new Uint8Array(await editor.save());

      editor.setReviewAuthorVisible('Grace Hopper', false);
      expect(markedText(container)).toEqual([]);
      expect(cardCount(editor)).toBe(0);
      expect(container.textContent).toContain('Just aXX text');
      expect(new Uint8Array(await editor.save())).toEqual(saved);
    } finally {
      dispose();
    }
  });
});
