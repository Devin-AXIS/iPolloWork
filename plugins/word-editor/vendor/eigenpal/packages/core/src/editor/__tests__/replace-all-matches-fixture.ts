// Fixtures shared by the `replaceAllMatches` tests: documents, a review module, and a mount.
// Callers register the DOM before importing this module.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  collectReviewItems as engineCollectReviewItems,
  findNode,
  revisionItemsOf,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { EditorModule } from '../../contracts/modules.ts';
import { storyParityDocx } from './story-parity-fixture.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

export function docx(body: string, settings?: string): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (settings
          ? '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (settings) {
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`
    );
    files['word/settings.xml'] = strToU8(`<w:settings xmlns:w="${W}">${settings}</w:settings>`);
  }
  return zipSync(files);
}

function textbox(text: string): string {
  return (
    `<w:r><w:drawing xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}">` +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" ' +
    'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:wrapNone/><wp:docPr id="7" name="Text box 7"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
    '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>'
  );
}

/** Every story of the parity fixture says "Beta"; add a table cell and a text box that do too. */
export function everyStoryDocx(): Uint8Array {
  const files = unzipSync(storyParityDocx());
  const documentXml = strFromU8(files['word/document.xml']!);
  const extra =
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell Beta</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    `<w:p><w:r><w:t>box</w:t></w:r>${textbox('boxed Beta')}</w:p>`;
  files['word/document.xml'] = strToU8(documentXml.replace('<w:sectPr>', `${extra}<w:sectPr>`));
  return zipSync(files);
}

function reviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems: engineCollectReviewItems,
      revisionItemsOfParagraph: (part, paragraphId) => {
        const paragraph = findNode(part, paragraphId);
        if (!paragraph || paragraph.kind !== 'paragraph') return [];
        return revisionItemsOf({ ...part, root: paragraph });
      },
    },
  };
}

/** Mount a document: package bytes, or body XML for a one-part document. */
export function mount(source: Uint8Array | string): {
  editor: DocxEditorInstance;
  dispose(): void;
} {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: typeof source === 'string' ? docx(source) : source,
    author: 'Grace Hopper',
    modules: [reviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return {
    editor,
    dispose() {
      editor.destroy();
      container.remove();
    },
  };
}

/** Every story part's XML, by part name, so a test can see what each story now holds. */
export function storyXml(editor: DocxEditorInstance): Record<string, string> {
  const pkg = editor.surface!.session.currentPackage();
  const out: Record<string, string> = {};
  for (const name of [
    '/word/document.xml',
    '/word/header1.xml',
    '/word/footer1.xml',
    '/word/footnotes.xml',
    '/word/endnotes.xml',
  ]) {
    const part = pkg.parts.get(name);
    if (part) out[name] = serializeOoxmlPart(part);
  }
  return out;
}

export const bodyXml = (editor: DocxEditorInstance) =>
  serializeOoxmlPart(editor.surface!.session.part());
