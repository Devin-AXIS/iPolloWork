import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  normalizeParagraphIdentity,
  readOoxmlPackage,
  relationshipTargetIn,
  resolveHeaderFooterPartsBySection,
  resolveHeaderFooterResolutionBySection,
  TreePackageStore,
  type HeadlessDocumentView,
  type OoxmlNode,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { forEachSemanticSpan } from '../../layout/export-traversal.ts';
import { openDocumentForExport } from '../export-session.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function packageWith(body: string): OoxmlPackage {
  const loaded = readOoxmlPackage(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rDoc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
      ),
    })
  );
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function liveView(store: TreePackageStore): HeadlessDocumentView {
  return {
    part: () => store.bodyStore().part,
    currentPackage: () => store.currentPackage(),
    packageRevision: () => store.packageRevision,
    stylesRoot: () => null,
    numberingRoot: () => null,
    settingsRoot: () => null,
    documentThemeFonts: () => ({ major: null, minor: null }),
    documentProperties: () => ({}),
    headerFooterPartsBySection: () => resolveHeaderFooterPartsBySection(store.currentPackage()),
    headerFooterResolutionBySection: () =>
      resolveHeaderFooterResolutionBySection(store.currentPackage()),
    relationshipTarget: (relationshipId) =>
      relationshipTargetIn(
        store.currentPackage(),
        store.currentPackage().mainDocumentPart,
        relationshipId
      ),
  };
}

test('live ExportSession never recycles field-link ids beside retained paragraph lines', async () => {
  const field = (href: string, text: string): string =>
    `<w:p><w:fldSimple w:instr=' HYPERLINK "${href}" '><w:r><w:t>${text}</w:t></w:r></w:fldSimple></w:p>`;
  const source = packageWith(
    field('https://one.example', 'one') + field('https://two.example', 'two')
  );
  const main = normalizeParagraphIdentity(source.parts.get(source.mainDocumentPart)!);
  const store = new TreePackageStore(source, main);
  const opened = openDocumentForExport(liveView(store));
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  const fieldLinks = async (): Promise<{ href: string; id: string }[]> => {
    const links: { href: string; id: string }[] = [];
    forEachSemanticSpan(await opened.session.layout(), ({ span }) => {
      if (span.link?.href) links.push({ href: span.link.href, id: span.link.id });
    });
    return links;
  };
  const paragraphIds: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'paragraph') paragraphIds.push(node.id);
    if (node.kind === 'textValue') return;
    for (const child of node.children) visit(child);
  };
  visit(main.root);

  try {
    const before = await fieldLinks();
    expect(before.map((link) => link.href)).toEqual(['https://one.example', 'https://two.example']);
    const changed = store.transact({ kind: 'body' }, (context) => {
      context.apply({ op: 'insertText', paragraphId: paragraphIds[1]!, offset: 0, text: '!' });
    });
    expect(changed.ok).toBe(true);
    const after = await fieldLinks();
    expect(after.map((link) => link.href)).toEqual(['https://one.example', 'https://two.example']);
    expect(new Set(after.map((link) => link.id)).size).toBe(2);
    expect(after[0]?.id).toBe(before[0]?.id);
  } finally {
    opened.session.dispose();
  }
});
