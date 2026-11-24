// Tracked changes copied from a word processor paste as revisions, not as formatting.
//
// The fixture is a real desktop clipboard capture (macOS), anonymized: deletions, insertions,
// inserted and deleted paragraph marks, two authors, a deletion inside an insertion, tracked
// run and paragraph formatting, a move, and inserted and deleted table rows. The expected
// markup is what the same word processor rebuilds when it pastes that HTML itself.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import {
  collectReviewItems,
  findNode,
  revisionItemsOf,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import type { EditorModule } from '../../contracts/modules.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { projectExternalHtml } from '../clipboard-html-read.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const WORD_HTML = readFileSync(
  new URL('./fixtures/word-mac-tracked-changes.html', import.meta.url),
  'utf8'
);
const ANN = 'w:author="Ann Author" w:date="2026-03-04T05:06:00Z"';
const BOB = 'w:author="Bob O&apos;Brien &amp; Co" w:date="2026-05-06T07:08:00Z"';

function docxOf(body: string): Uint8Array {
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

function mountEditor(body = '<w:p/>'): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docxOf(body),
    author: 'Grace Hopper',
    modules: [reviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function paste(editor: DocxEditorInstance, html: string, text = 'fallback'): void {
  expect(editor.exec({ type: 'paste', text, html })).toMatchObject({ ok: true });
}

/** The body, without the ids and paragraph identity the merge assigns. */
function rawBodyXml(editor: DocxEditorInstance): string {
  return serializeOoxmlPart(editor.surface!.session.part())
    .replace(/ w14:(?:paraId|textId)="[^"]*"/g, '')
    .replace(/ w:id="\d+"/g, '');
}

/** `rawBodyXml` without run properties that record no revision. */
function bodyXml(editor: DocxEditorInstance): string {
  return rawBodyXml(editor).replace(/<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>/g, (rPr) =>
    /<w:(?:ins|del|rPrChange)\b/.test(rPr) ? rPr : ''
  );
}

function visibleText(editor: DocxEditorInstance): string {
  return editor.surface!.session.bodyText();
}

describe('pasted tracked changes from a word processor', () => {
  test('insertions and deletions keep their authors and dates', () => {
    const editor = mountEditor();
    paste(editor, WORD_HTML);
    const xml = bodyXml(editor);
    expect(xml).toContain(
      `<w:del ${ANN.replace('2026-03-04T05:06', '2026-10-22T14:18')}>` +
        '<w:r><w:delText xml:space="preserve">test </w:delText></w:r></w:del>'
    );
    expect(xml).toContain(`<w:ins ${ANN}><w:r><w:t>ann ins</w:t></w:r></w:ins>`);
    expect(xml).toContain(`<w:ins ${BOB}><w:r><w:t>bob ins</w:t></w:r></w:ins>`);
    expect(xml).toContain(
      `<w:del ${BOB}><w:r><w:delText xml:space="preserve"> bob del</w:delText></w:r></w:del>`
    );
    // Formatting is not how a revision is said: no underline or strike was made up.
    expect(rawBodyXml(editor)).not.toContain('<w:u ');
    expect(rawBodyXml(editor)).not.toContain('<w:strike');
    const authors = new Set(
      editor.getReviewItems({ pairReplacements: false }).map((item) => item.author)
    );
    expect(authors).toEqual(new Set(['Ann Author', "Bob O'Brien & Co"]));
    editor.destroy();
  });

  test('a deletion inside an insertion stays nested', () => {
    const editor = mountEditor();
    paste(editor, WORD_HTML);
    expect(bodyXml(editor)).toContain(
      `<w:ins ${ANN}><w:r><w:t xml:space="preserve">ann </w:t></w:r>` +
        `<w:del ${BOB}><w:r><w:delText>bobgone</w:delText></w:r></w:del>` +
        '<w:r><w:t xml:space="preserve"> kept</w:t></w:r></w:ins>'
    );
    editor.destroy();
  });

  test('inserted and deleted paragraph marks are revisions of the mark', () => {
    const editor = mountEditor();
    paste(editor, WORD_HTML);
    const paragraphs = bodyXml(editor).split('</w:p>');
    const of = (text: string) => paragraphs.find((paragraph) => paragraph.includes(text))!;
    expect(of('Joined first')).toContain(`<w:pPr><w:rPr><w:del ${ANN}/></w:rPr></w:pPr>`);
    expect(of('plain head')).toContain(`<w:pPr><w:rPr><w:ins ${BOB}/></w:rPr></w:pPr>`);
    // `<o:p>` outside the revision: the mark itself is unchanged.
    expect(of('joined second')).not.toContain('<w:pPr>');
    editor.destroy();
  });

  test('tracked run and paragraph formatting keep their previous properties', () => {
    const editor = mountEditor();
    paste(editor, WORD_HTML);
    const xml = bodyXml(editor);
    expect(xml).toMatch(
      new RegExp(
        `<w:r><w:rPr><w:b/>(?:<w:lang [^>]*/>)?<w:rPrChange ${ANN}>` +
          '<w:rPr><w:b w:val="0"/>(?:<w:lang [^>]*/>)?</w:rPr></w:rPrChange></w:rPr><w:t>bolded</w:t>'
      )
    );
    expect(xml).toContain(
      `<w:jc w:val="center"/><w:pPrChange ${ANN}><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange>`
    );
    editor.destroy();
  });

  test('inserted and deleted table rows keep their row revisions', () => {
    const editor = mountEditor();
    paste(editor, WORD_HTML);
    const rows = bodyXml(editor).split('</w:tr>');
    expect(rows.find((row) => row.includes('row two'))).toContain(
      `<w:trPr><w:ins ${ANN}/></w:trPr>`
    );
    expect(rows.find((row) => row.includes('row three'))).toContain(
      `<w:trPr><w:del ${ANN}/></w:trPr>`
    );
    editor.destroy();
  });

  test('moved text pastes as a deletion and an insertion by the same author', () => {
    // The move name and range ids are not renumbered by a paste, so a pasted pair could join
    // a move already in the document. Both halves keep their author, date and decisions.
    const editor = mountEditor();
    paste(editor, WORD_HTML);
    const xml = bodyXml(editor);
    expect(xml).toContain(`<w:del ${ANN}><w:r><w:delText>moved words</w:delText></w:r></w:del>`);
    expect(xml).toContain(`<w:ins ${ANN}><w:r><w:t>moved words</w:t></w:r></w:ins>`);
    expect(xml).not.toContain('moveFrom');
    editor.destroy();
  });

  test('every pasted revision has its own id, unused before the paste', () => {
    const editor = mountEditor(
      `<w:p><w:ins w:id="0" w:author="Grace Hopper"><w:r><w:t>mine</w:t></w:r></w:ins></w:p>`
    );
    paste(editor, WORD_HTML);
    const xml = serializeOoxmlPart(editor.surface!.session.part());
    const ids = [...xml.matchAll(/<w:(?:ins|del|rPrChange|pPrChange) w:author[^>]* w:id="(\d+)"/g)];
    expect(ids.length).toBeGreaterThan(15);
    expect(new Set(ids.map((match) => match[1])).size).toBe(ids.length);
    expect(xml).not.toContain('w:id="?"');
    editor.destroy();
  });

  test('accepting all gives the edited text; rejecting all gives the original; undo restores', () => {
    for (const action of ['accept', 'reject'] as const) {
      const editor = mountEditor();
      paste(editor, WORD_HTML);
      const pasted = bodyXml(editor);
      expect(editor.exec({ type: 'resolveAllReviewChanges', action })).toMatchObject({
        ok: true,
        changed: true,
      });
      const text = visibleText(editor);
      if (action === 'accept') {
        expect(text).toContain('Test tests test setest');
        expect(text).toContain('Joined firstjoined second');
        expect(text).not.toContain('row three deleted');
        expect(text).toContain('row two inserted');
      } else {
        expect(text).toContain('Test tests test test setest');
        expect(text).not.toContain('Tesat');
        expect(text).not.toContain('row two inserted');
        expect(text).toContain('row three deleted');
      }
      expect(editor.surface!.session.reviewItems()).toHaveLength(0);
      editor.exec({ type: 'undo' });
      expect(bodyXml(editor)).toBe(pasted);
      editor.destroy();
    }
  });

  test('a line break does not start the next line with a space', () => {
    const editor = mountEditor();
    paste(editor, WORD_HTML);
    const xml = bodyXml(editor);
    expect(xml).toContain('<w:br/></w:r><w:r><w:t>f;lsdakj');
    expect(xml).not.toContain('<w:t xml:space="preserve"> f;lsdakj');
    editor.destroy();
  });

  test('a single tracked word pasted mid-paragraph keeps its revision', () => {
    const editor = mountEditor('<w:p><w:r><w:t>host text</w:t></w:r></w:p>');
    const root = editor.surface!.session.part().root;
    const body = root.kind === 'textValue' ? undefined : root.children[0];
    const host = body && body.kind !== 'textValue' ? body.children[0] : undefined;
    const caret = { paragraphId: host!.id, offset: 5 };
    expect(
      editor.exec({ type: 'setSelection', range: { anchor: caret, head: caret } })
    ).toMatchObject({ ok: true });
    paste(
      editor,
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><!--StartFragment-->' +
        '<span class=msoIns><ins cite="mailto:Ann%20Author" datetime="2026-03-04T05:06">new </ins></span>' +
        '<!--EndFragment--></body></html>'
    );
    expect(bodyXml(editor)).toContain(
      `<w:t xml:space="preserve">host </w:t></w:r><w:ins ${ANN}><w:r><w:t xml:space="preserve">new </w:t></w:r></w:ins><w:r><w:t>text</w:t>`
    );
    expect(visibleText(editor)).toBe('host new text');
    expect(editor.getReviewItems({ pairReplacements: false })).toHaveLength(1);
    editor.destroy();
  });

  test('one pasted paragraph with an inserted mark lands as a new paragraph', () => {
    const editor = mountEditor('<w:p><w:r><w:t>host text</w:t></w:r></w:p>');
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    const caret = { paragraphId, offset: 5 };
    editor.exec({ type: 'setSelection', range: { anchor: caret, head: caret } });
    paste(
      editor,
      '<p class=MsoNormal><span><ins cite="mailto:Ann%20Author" datetime="2026-03-04T05:06">' +
        'new para<o:p></o:p></ins></span></p>'
    );
    const paragraphs = bodyXml(editor).split('</w:p>');
    expect(paragraphs.find((paragraph) => paragraph.includes('new para'))).toContain(
      `<w:rPr><w:ins ${ANN}/></w:rPr>`
    );
    expect(editor.surface!.session.paragraphIds()).toHaveLength(2);
    expect(editor.exec({ type: 'resolveAllReviewChanges', action: 'reject' })).toMatchObject({
      ok: true,
    });
    expect(visibleText(editor)).toBe('host text');
    editor.destroy();
  });
});

describe('revision markup in other HTML', () => {
  const project = (html: string): string => {
    const projected = projectExternalHtml(html);
    if (!projected.ok) throw new Error(projected.reason);
    const editor = mountEditor();
    paste(editor, html);
    const xml = rawBodyXml(editor);
    editor.destroy();
    return xml;
  };

  test('a web page <ins> / <del> without an author stays underline and strike', () => {
    const xml = project('<p>a <ins>added</ins> b <del>removed</del></p><p>tail</p>');
    expect(xml).not.toContain('<w:ins ');
    expect(xml).not.toContain('<w:del ');
    expect(xml).toContain('<w:u w:val="single"/>');
    expect(xml).toContain('<w:strike/>');
  });

  test('an author in cite makes <ins> / <del> a revision in any HTML', () => {
    const xml = project(
      '<p>a <ins cite="mailto:Ann%20Author" datetime="2026-03-04T05:06:59Z">added</ins>' +
        ' <del cite="mailto:Ann%20Author">removed</del></p><p>tail</p>'
    );
    expect(xml).toContain(`<w:ins ${ANN}><w:r><w:t>added</w:t></w:r></w:ins>`);
    expect(xml).toContain(
      '<w:del w:author="Ann Author"><w:r><w:delText>removed</w:delText></w:r></w:del>'
    );
  });

  test('a hyperlink inside a revision holds the revision', () => {
    const xml = project(
      '<p class=MsoNormal><ins cite="mailto:Ann%20Author" datetime="2026-03-04T05:06">see ' +
        '<a href="https://example.com/">the link</a></ins></p><p>tail</p>'
    );
    expect(xml).toMatch(
      new RegExp(
        `<w:hyperlink r:id="[^"]+"><w:ins ${ANN}><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>` +
          '<w:t>the link</w:t></w:r></w:ins></w:hyperlink>'
      )
    );
    expect(xml).toContain(`<w:ins ${ANN}><w:r><w:t xml:space="preserve">see </w:t></w:r></w:ins>`);
  });

  test('hostile authors and dates are cleaned, bounded, and escaped', () => {
    const xml = project(
      '<p class=MsoNormal>' +
        `<ins cite="mailto:${'%41'.repeat(300)}" datetime="2026-13-40T99:99">a</ins>` +
        '<del cite="mailto:%E0%A4%A" datetime="2026-01-01T00:00">b</del>' +
        '<ins cite="mailto:%3Cx%3E%22%01" datetime="not a date">c</ins>' +
        '<span style=\'mso-prop-change:"Q" 20261340T9999\'>d</span></p><p>tail</p>'
    );
    expect(xml).toContain(`<w:ins w:author="${'A'.repeat(255)}">`);
    expect(xml).toContain('<w:del w:author="%E0%A4%A" w:date="2026-01-01T00:00:00Z">');
    expect(xml).toContain('<w:ins w:author="&lt;x&gt;&quot;">');
    // A formatting revision with a date that does not parse keeps its author, undated.
    expect(xml).toContain('<w:rPrChange w:author="Q">');
  });

  test('a day the month does not have leaves the revision undated', () => {
    const xml = project(
      '<p class=MsoNormal><ins cite="mailto:A" datetime="2026-02-31T05:06">a</ins>' +
        '<ins cite="mailto:B" datetime="0000-01-01T00:00">b</ins>' +
        '<ins cite="mailto:C" datetime="2024-02-29T05:06">c</ins></p><p>tail</p>'
    );
    expect(xml).toContain('<w:ins w:author="A"><w:r>');
    expect(xml).toContain('<w:ins w:author="B"><w:r>');
    expect(xml).toContain('<w:ins w:author="C" w:date="2024-02-29T05:06:00Z">');
  });

  test('an insertion inside a deletion is struck with it, never nested inside w:del', () => {
    const xml = project(
      '<p class=MsoNormal><del cite="mailto:A">gone <ins cite="mailto:B">added</ins></del></p>' +
        '<p>tail</p>'
    );
    expect(xml).not.toMatch(/<w:del [^>]*>(?:(?!<\/w:del>).)*<w:ins /);
    expect(xml).toContain('<w:delText>added</w:delText>');
  });

  test('a line break that ends a revision does not start the next line with a space', () => {
    const xml = project('<p class=MsoNormal><ins cite="mailto:A">one<br></ins> two</p><p>tail</p>');
    expect(xml).toContain('<w:t>two</w:t>');
  });

  test('word processor HTML without an author falls back to Unknown', () => {
    const xml = project('<p class=MsoNormal>a <ins>added</ins></p><p>tail</p>');
    expect(xml).toContain('<w:ins w:author="Unknown"><w:r><w:t>added</w:t></w:r></w:ins>');
  });
});
