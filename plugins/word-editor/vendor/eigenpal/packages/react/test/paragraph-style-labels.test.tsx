// The style picker labels built-in paragraph styles in the UI language.
//
// A document stores the English `w:name` of a built-in style whatever language wrote it. The
// picker reads the label from the catalogue for those, and shows every other style exactly as
// the document names it.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { en } from '@docx-editor.dev/i18n';
import { LocaleProvider } from '../src/i18n/index.ts';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import { StylePicker } from '../src/components/ui/StylePicker.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const style = (id: string, name: string, extra = '') =>
  `<w:style w:type="paragraph" w:styleId="${id}"${extra}><w:name w:val="${name}"/></w:style>`;

const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rIdStyles" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
  ),
  // Both `heading 1` and `Heading 2` occur. A style id can be localized (`Ttulo1`), so the
  // label comes from the name.
  'word/styles.xml': strToU8(
    `<w:styles xmlns:w="${W}">` +
      style('Normal', 'Normal', ' w:default="1"') +
      style('Title', 'Title') +
      style('Ttulo1', 'heading 1') +
      style('Heading2', 'Heading 2') +
      style('NoSpacing', 'No Spacing') +
      style('ListParagraph', 'List Paragraph') +
      style('Callout', 'Callout') +
      '</w:styles>'
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>`
  ),
});

const CATALOGUE = {
  ...en,
  styles: {
    ...en.styles,
    normal: 'Padrão',
    title: 'Título',
    headingLevel: 'Título {level}',
    noSpacing: 'Sem Espaçamento',
    listParagraph: 'Parágrafo da Lista',
  },
};

afterEach(cleanup);

test('built-in styles take the catalogue label, and the document own styles keep their name', async () => {
  const view = render(
    <LocaleProvider i18n={CATALOGUE as typeof en}>
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorToolbar />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    </LocaleProvider>
  );
  await act(async () => {});
  const trigger = view.container.querySelector(
    '[data-slot="styles.style"] .docx-toolbar__style-trigger'
  ) as HTMLButtonElement;
  expect(trigger.textContent).toBe('Padrão');
  await act(async () => {
    trigger.click();
  });
  const rows = [...view.container.querySelectorAll('[data-slot="styles.style"] [role="option"]')];
  expect(rows.map((row) => row.querySelector('span')?.textContent)).toEqual([
    'Padrão',
    'Título',
    'Título 1',
    'Título 2',
    'Sem Espaçamento',
    'Parágrafo da Lista',
    'Callout',
  ]);
});

test('the standalone style picker labels built-in styles by name, not style id', () => {
  const preview = { fontFamily: null, fontSizePt: null, bold: false, italic: false, color: null };
  const styles = [
    { styleId: 'Normal', name: 'Normal', type: 'paragraph', preview },
    { styleId: 'Ttulo4', name: 'heading 4', type: 'paragraph', preview },
    { styleId: 'Callout', name: 'Callout', type: 'paragraph', preview },
  ];
  const label = (value: string) =>
    render(
      <LocaleProvider i18n={CATALOGUE as typeof en}>
        <StylePicker value={value} styles={styles} />
      </LocaleProvider>
    ).container.querySelector('[aria-label] span')?.textContent;
  expect(label('Ttulo4')).toBe('Título 4');
  expect(label('Callout')).toBe('Callout');
  // This picker keeps its own label for the default style.
  expect(label('Normal')).toBe(en.styles.normalText);
});
