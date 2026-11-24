// `can` and `exec` agree on `replaceAcceptedText` for locked, bound, and protected content in
// every story. A text box is written without opening it, so its story lookup was skipped, and
// with it the lock check: `can` answered ok and `exec` answered `locked`.

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { textboxDocx } from './textbox-editing-fixture.ts';
import { storyParityDocx } from './story-parity-fixture.ts';
import { fix, openReviewEditor } from './replace-accepted-text-fixture.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SETTINGS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';

type Condition = 'locked' | 'bound' | 'protected';

const RESTRICTION: Record<Condition, string> = {
  locked: '<w:lock w:val="contentLocked"/>',
  bound:
    '<w:dataBinding w:xpath="/root/term" w:storeItemID="{11111111-2222-3333-4444-555555555555}"/>',
  protected: '',
};

/** The story parity document, a body text box with a control, and the condition applied. */
function restrictedDocx(condition: Condition): Uint8Array {
  const parts = unzipSync(storyParityDocx());
  const boxXml = strFromU8(unzipSync(textboxDocx())['word/document.xml']!);
  const start = boxXml.indexOf('<w:r><mc:AlternateContent');
  const end =
    boxXml.indexOf('</mc:AlternateContent></w:r>') + '</mc:AlternateContent></w:r>'.length;
  const control =
    '<w:sdt><w:sdtPr><w:alias w:val="Boxed"/><w:text/></w:sdtPr><w:sdtContent>' +
    '<w:p><w:r><w:t>Boxed</w:t></w:r></w:p></w:sdtContent></w:sdt>';
  const box = boxXml
    .slice(start, end)
    .replace('<w:p><w:r><w:t>boxed needle</w:t></w:r></w:p>', control);
  for (const name of Object.keys(parts)) {
    if (!/^word\/(document|header1|footnotes)\.xml$/.test(name)) continue;
    let xml = strFromU8(parts[name]!);
    if (name === 'word/document.xml')
      xml = xml.replace('<w:sectPr>', `<w:p>${box}</w:p><w:sectPr>`);
    xml = xml.replaceAll('<w:text/></w:sdtPr>', `${RESTRICTION[condition]}<w:text/></w:sdtPr>`);
    parts[name] = strToU8(xml);
  }
  if (condition === 'protected') {
    parts['word/settings.xml'] = strToU8(
      `<w:settings xmlns:w="${W}"><w:documentProtection w:edit="readOnly" w:enforcement="1"/></w:settings>`
    );
    const rels = strFromU8(parts['word/_rels/document.xml.rels']!);
    parts['word/_rels/document.xml.rels'] = strToU8(
      rels.replace(
        '</Relationships>',
        `<Relationship Id="rId30" Type="${SETTINGS_REL}" Target="settings.xml"/></Relationships>`
      )
    );
    const types = strFromU8(parts['[Content_Types].xml']!);
    parts['[Content_Types].xml'] = strToU8(
      types.replace(
        '</Types>',
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'
      )
    );
  }
  return zipSync(parts);
}

const STORIES = {
  body: (id: string, text: string) => id.startsWith('/word/document.xml') && text === 'Control',
  header: (id: string, text: string) => id.startsWith('/word/header1.xml') && text === 'Control',
  note: (id: string, text: string) => id.startsWith('/word/footnotes.xml') && text === 'Control',
  'text box': (_: string, text: string) => text === 'Boxed',
} as const;

describe.each(['locked', 'bound', 'protected'] as const)('%s content', (condition) => {
  test.each(Object.keys(STORIES) as (keyof typeof STORIES)[])(
    'can and exec agree in the %s',
    (story) => {
      const mounted = openReviewEditor(restrictedDocx(condition));
      cleanups.push(mounted.destroy);
      const editor = mounted.editor;
      const paragraph = editor
        .getParagraphs()
        .find((candidate) => STORIES[story](candidate.blockId, candidate.acceptedText));
      expect(paragraph).toBeDefined();
      const command = fix(paragraph!.blockId, 0, 3, 'Xyz');
      const asked = editor.can(command);
      const revision = editor.getDocumentHandle().revision;
      const done = editor.exec(command);
      expect(asked.ok).toBe(false);
      expect(done).toEqual(asked);
      expect(asked.ok ? null : asked.code).toBe(condition === 'bound' ? 'bound' : 'locked');
      expect(editor.getDocumentHandle().revision).toBe(revision);
    }
  );
});
