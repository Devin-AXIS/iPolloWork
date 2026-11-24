import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { stubReviewModule } from './review-test-module.ts';
import { trackedDocx } from './paginated-surface-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function packageDocx(parts: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)]))
  );
}

function drawingDocx(): Uint8Array {
  const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
  const drawing =
    '<w:r><w:drawing><wp:inline><wp:extent cx="228600" cy="114300"/>' +
    '<wp:docPr id="1" name="picture"/><a:graphic><a:graphicData ' +
    `uri="${PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/>` +
    '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg"/>' +
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm>' +
    '<a:ext cx="228600" cy="114300"/></a:xfrm><a:prstGeom prst="rect"/>' +
    '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  return packageDocx({
    '[Content_Types].xml':
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rIdImg" Type="${R}/image" Target="https://example.com/image.png" TargetMode="External"/></Relationships>`,
    'word/document.xml': `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p>${drawing}</w:p></w:body></w:document>`,
  });
}

function tocDocx(): Uint8Array {
  const stylesRel = `${R}/styles`;
  const heading =
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>';
  return packageDocx({
    '[Content_Types].xml':
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rIdStyles" Type="${stylesRel}" Target="styles.xml"/></Relationships>`,
    'word/styles.xml':
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>` +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style></w:styles>',
    'word/document.xml': `<w:document xmlns:w="${W}"><w:body>${heading}</w:body></w:document>`,
  });
}

function mounted(author: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: 'blank', author });
  editor.exec({ type: 'insertText', text: 'abcd' });
  return {
    editor,
    dispose() {
      editor.destroy();
      container.remove();
    },
  };
}

function select(editor: DocxEditorInstance, start: number, end: number): void {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

function xmlOf(editor: DocxEditorInstance): string {
  return serializeOoxmlPart(editor.surface!.session.part());
}

describe('live author state', () => {
  test('commits buffered text under the author active when it was typed', () => {
    const { editor, dispose } = mounted('Author A');
    try {
      editor.surface!.setEditingMode('suggest');
      editor.surface!.enqueueType('X');

      editor.setAuthor('Author B');
      editor.surface!.enqueueType('Y');
      editor.surface!.flushPendingInput();

      const xml = xmlOf(editor);
      expect(xml).toMatch(/<w:ins\b[^>]*w:author="Author A"[^>]*>.*?<w:t>X<\/w:t>.*?<\/w:ins>/);
      expect(xml).toMatch(/<w:ins\b[^>]*w:author="Author B"[^>]*>.*?<w:t>Y<\/w:t>.*?<\/w:ins>/);
    } finally {
      dispose();
    }
  });

  test('attributes later replacements without rewriting an existing revision', () => {
    const { editor, dispose } = mounted('Author A');
    try {
      select(editor, 0, 1);
      expect(editor.exec({ type: 'proposeReplacement', replaceWith: 'X' })).toMatchObject({
        ok: true,
        changed: true,
      });

      editor.setAuthor('  Author B  ');
      expect(editor.getConfiguredAuthor()).toBe('Author B');
      select(editor, 1, 2);
      expect(editor.exec({ type: 'proposeReplacement', replaceWith: 'Y' })).toMatchObject({
        ok: true,
        changed: true,
      });

      const xml = xmlOf(editor);
      expect(xml.match(/w:author="Author A"/g)).toHaveLength(2);
      expect(xml.match(/w:author="Author B"/g)).toHaveLength(2);
    } finally {
      dispose();
    }
  });

  test('publishes author changes, clears whitespace, and keeps the value across reloads', () => {
    const { editor, dispose } = mounted('Author A');
    try {
      let selectionChanges = 0;
      const off = editor.on('selectionChange', () => {
        selectionChanges += 1;
      });

      editor.setAuthor('Author B');
      expect(selectionChanges).toBe(1);
      editor.setAuthor(' Author B ');
      expect(selectionChanges).toBe(1);

      editor.load('blank');
      expect(editor.getConfiguredAuthor()).toBe('Author B');
      editor.exec({ type: 'insertText', text: 'ab' });
      select(editor, 0, 1);
      expect(editor.exec({ type: 'proposeReplacement', replaceWith: 'X' })).toMatchObject({
        ok: true,
        changed: true,
      });
      expect(xmlOf(editor)).toContain('w:author="Author B"');

      editor.setAuthor('  ');
      expect(editor.getConfiguredAuthor()).toBeNull();
      editor.surface!.setEditingMode('suggest');
      editor.surface!.insertPlainText('z');
      expect(editor.surface!.state().lastRejection).toBe(
        'suggesting needs an author before it can propose a change'
      );
      expect(editor.exec({ type: 'proposeInsertion', text: 'z' })).toMatchObject({
        ok: false,
        code: 'invalidArgs',
        reason: 'tracked changes need a non-empty author',
      });
      off();
    } finally {
      dispose();
    }
  });
});

describe('live host configuration', () => {
  test('mode changes enforce and lift the host view lock', () => {
    const { editor, dispose } = mounted('Author A');
    try {
      let changes = 0;
      editor.on('selectionChange', () => changes++);
      editor.setMode('view');
      expect(changes).toBe(1);
      editor.setMode('view');
      expect(changes).toBe(1);
      expect(editor.getEditingMode()).toBe('viewing');
      expect(editor.exec({ type: 'insertText', text: 'x' })).toMatchObject({
        ok: false,
        code: 'locked',
      });
      expect(editor.can({ type: 'setEditingMode', mode: 'editing' })).toMatchObject({
        ok: false,
        code: 'locked',
      });

      editor.setMode('edit');
      expect(editor.getEditingMode()).toBe('editing');
      expect(editor.exec({ type: 'insertText', text: 'x' })).toMatchObject({ ok: true });
    } finally {
      dispose();
    }
  });

  test('an editor constructed for viewing can become editable', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: 'blank', mode: 'view' });
    try {
      expect(editor.getEditingMode()).toBe('viewing');
      editor.setMode('edit');
      expect(editor.getEditingMode()).toBe('editing');
      expect(editor.exec({ type: 'insertText', text: 'x' })).toMatchObject({ ok: true });
    } finally {
      editor.destroy();
      container.remove();
    }
  });

  test('mode changes resolve suggesting and let document tracking decide again', () => {
    const { editor, dispose } = mounted('Author A');
    try {
      editor.setMode('suggesting');
      expect(editor.getEditingMode()).toBe('editing');
      expect(editor.snapshot().lastRejection).toContain('pro review module');
    } finally {
      dispose();
    }

    const container = document.createElement('div');
    document.body.append(container);
    const tracked = createDocxEditor({
      container,
      author: 'Author A',
      mode: 'edit',
      modules: [stubReviewModule()],
    });
    try {
      tracked.load(trackedDocx());
      expect(tracked.snapshot().parseError).toBeNull();
      expect(tracked.getEditingMode()).toBe('editing');
      tracked.setMode(undefined);
      expect(tracked.getEditingMode()).toBe('suggesting');
    } finally {
      tracked.destroy();
      container.remove();
    }
  });

  test('translation changes repaint drawing placeholder labels', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const translate = (key: string) => `initial:${key}`;
    const editor = createDocxEditor({ container, translate });
    try {
      editor.load(drawingDocx());
      expect(editor.snapshot().parseError).toBeNull();
      const placeholder = container.querySelector('.docx-drawing-placeholder');
      expect(placeholder?.textContent).toBe('initial:image.pendingResource');
      let changes = 0;
      editor.on('selectionChange', () => changes++);
      editor.setTranslate((key) => `initial:${key}`);
      expect(changes).toBe(0);
      expect(container.querySelector('.docx-drawing-placeholder')).toBe(placeholder);

      editor.setTranslate((key) => `updated:${key}`);
      expect(changes).toBe(1);
      expect(container.querySelector('.docx-drawing-placeholder')?.textContent).toBe(
        'updated:image.pendingResource'
      );
    } finally {
      editor.destroy();
      container.remove();
    }
  });

  test('locale changes apply to later TOC insertions', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container });
    try {
      editor.load(tocDocx());
      expect(editor.snapshot().parseError).toBeNull();
      let changes = 0;
      editor.on('selectionChange', () => changes++);
      editor.setLocale('de-DE');
      expect(changes).toBe(1);
      editor.setLocale('de-DE');
      expect(changes).toBe(1);
      expect(editor.exec({ type: 'insertToc' })).toMatchObject({ ok: true, changed: true });
      expect(xmlOf(editor)).toContain('w:alias w:val="Inhaltsverzeichnis"');
    } finally {
      editor.destroy();
      container.remove();
    }
  });
});
