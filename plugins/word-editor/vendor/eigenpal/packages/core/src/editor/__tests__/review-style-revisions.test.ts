import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import {
  collectReviewItems,
  revisionItemsOf,
  serializeOoxmlPart,
  stylesPartOf,
} from '../../store/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const history = (author = 'Ada') =>
  `<w:rPr><w:b/><w:rPrChange w:id="1" w:author="${author}"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr>`;
function mount(styles: string, bodyRevision = true, protectedDocument = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const documentBytes = zipSync(
    Object.fromEntries(
      Object.entries({
        '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/><Override PartName="/word/settings.xml" ContentType="${CT}.settings+xml"/></Types>`,
        '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
        'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rSettings" Type="${R}/settings" Target="settings.xml"/></Relationships>`,
        'word/document.xml': `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${bodyRevision ? '<w:ins w:id="1" w:author="Ada"><w:r><w:t>body</w:t></w:r></w:ins>' : '<w:r><w:t>body</w:t></w:r>'}</w:p></w:body></w:document>`,
        'word/styles.xml': `<w:styles xmlns:w="${W}">${styles}</w:styles>`,
        'word/settings.xml': `<w:settings xmlns:w="${W}">${protectedDocument ? '<w:documentProtection w:edit="readOnly" w:enforcement="1"/>' : ''}</w:settings>`,
      }).map(([name, xml]) => [name, strToU8(xml)])
    )
  );
  const editor = createDocxEditor({
    container,
    document: documentBytes,
    modules: [
      {
        id: 'review',
        review: {
          displayModes: ['all-markup', 'proposed', 'original'],
          collectReviewItems,
          revisionItemsOfParagraph: () => [],
        },
      },
    ],
  });
  const session = editor.surface!.session;
  const xml = () => serializeOoxmlPart(stylesPartOf(session.currentPackage())!);
  return { editor, session, xml };
}
const style = (properties: string, id = 'Normal', type = 'paragraph') =>
  `<w:style w:type="${type}" w:styleId="${id}"><w:name w:val="${id}"/>${properties}</w:style>`;

for (const action of ['accept', 'reject'] as const) {
  for (const bodyRevision of [false, true])
    test(`${action}: shared styles and stories resolve as one undo unit (${bodyRevision})`, () => {
      const { editor, session, xml } = mount(style(history()), bodyRevision);
      const before = xml();
      expect(session.reviewItems()).toHaveLength(bodyRevision ? 2 : 1);
      expect(session.hasReviewContent()).toBe(true);
      const result = editor.exec({ type: 'resolveAllReviewChanges', action, scope: 'document' });
      expect(result).toMatchObject({ ok: true, revisions: { remaining: 0 } });
      expect(xml()).not.toContain('rPrChange');
      expect(xml()).toContain(action === 'accept' ? '<w:b' : '<w:i');
      const after = xml();
      session.undo();
      expect(xml()).toBe(before);
      expect(revisionItemsOf(session.part())).toHaveLength(bodyRevision ? 1 : 0);
      session.redo();
      expect(xml()).toBe(after);
      expect(session.reviewItems()).toHaveLength(0);
      expect(session.hasReviewContent()).toBe(false);
      editor.destroy();
    });
  test(`${action}: individual shared-style review decision`, () => {
    const { editor, xml } = mount(style(history()), false);
    const item = editor.getReviewItems()[0]!;
    expect(item).toBeDefined();
    expect(
      (action === 'accept' ? editor.acceptReviewItem(item.key) : editor.rejectReviewItem(item.key))
        .ok
    ).toBe(true);
    expect(xml()).not.toContain('rPrChange');
    editor.destroy();
  });
  test(`${action}: an explicit story-only selection preserves shared styles`, () => {
    const { editor, session, xml } = mount(style(history('Grace')));
    const before = xml();
    const item = editor
      .getReviewItems()
      .find((item) => item.kind === 'revision' && item.author === 'Ada')!;
    expect(editor.exec({ type: 'resolveAllReviewChanges', action, keys: [item.key] }).ok).toBe(
      true
    );
    expect(xml()).toBe(before);
    expect(session.reviewItems()).toHaveLength(1);
    editor.destroy();
  });
  test(`${action}: document protection guards style-only decisions`, () => {
    const { editor, session, xml } = mount(style(history()), false, true);
    const before = xml();
    expect(editor.exec({ type: 'resolveAllReviewChanges', action, scope: 'document' }).ok).toBe(
      false
    );
    const part = stylesPartOf(session.currentPackage())!;
    const op = { op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions' } as const;
    expect(
      session.applyTreeOpsAtomic([], { partOps: [{ partName: part.name, ops: [op] }] }).committed
    ).toBe(false);
    expect(xml()).toBe(before);
    editor.destroy();
  });
}

for (const action of ['accept', 'reject'] as const) {
  test(`${action}: character, paragraph, table and conditional style properties retain metadata`, () => {
    const paragraphHistory =
      '<w:pPr><w:spacing w:after="300"/><w:pPrChange w:id="2" w:author="Ada"><w:pPr><w:spacing w:after="100"/></w:pPr></w:pPrChange></w:pPr>';
    const { editor, session, xml } = mount(
      style(paragraphHistory) +
        style(history(), 'Emphasis', 'character') +
        style(
          '<w:basedOn w:val="TableNormal"/><w:tblStylePr w:type="firstRow">' +
            history('Grace') +
            paragraphHistory +
            '</w:tblStylePr>',
          'Grid',
          'table'
        ),
      false
    );
    const revision = session.packageRevision();
    expect(editor.exec({ type: 'resolveAllReviewChanges', action, scope: 'document' }).ok).toBe(
      true
    );
    expect(session.packageRevision()).toBeGreaterThan(revision);
    expect(xml()).not.toContain('PrChange');
    expect(xml()).toContain(`w:after="${action === 'accept' ? '300' : '100'}"`);
    expect(xml()).toContain('w:type="firstRow"');
    expect(xml()).toContain('w:val="TableNormal"');
    expect(xml()).toContain('w:styleId="Emphasis"');
    editor.destroy();
  });
  test(`${action}: unsupported style history is visible and does not block unrelated decisions`, () => {
    const { editor, session, xml } = mount(style(history().replace(' w:author="Ada"', '')));
    const before = xml();
    const result = editor.exec({ type: 'resolveAllReviewChanges', action, scope: 'document' });
    expect(result).toMatchObject({ ok: true, revisions: { remaining: 1 } });
    expect(xml()).toBe(before);
    expect(session.reviewItems()).toHaveLength(1);
    editor.destroy();
  });
  test(`${action}: raw story operations leave shared-style history unchanged`, () => {
    const { editor, session, xml } = mount(style(history()));
    const before = xml();
    expect(
      session.applyTreeOps([
        { op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions' },
      ]).committed
    ).toBe(true);
    expect(xml()).toBe(before);
    expect(session.reviewItems()).toHaveLength(1);
    editor.destroy();
  });
  test(`${action}: a related-part refusal rolls back the story and shared-style edits`, () => {
    const { editor, session, xml } = mount(style(history()));
    const before = xml();
    const body = serializeOoxmlPart(session.part());
    const op = { op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions' } as const;
    expect(
      session.applyTreeOpsAtomic([{ scope: { kind: 'body' }, ops: [op] }], {
        partOps: [
          { partName: '/word/styles.xml', ops: [op] },
          { partName: '/word/missing.xml', ops: [op] },
        ],
      }).committed
    ).toBe(false);
    expect(xml()).toBe(before);
    expect(serializeOoxmlPart(session.part())).toBe(body);
    expect(session.canUndo()).toBe(false);
    editor.destroy();
  });
}

test('rejecting shared style formatting invalidates the live formatting cache and undo restores it', () => {
  const { editor, session } = mount(style(history()), false);
  const surface = editor.surface!;
  const paragraphId = session.paragraphIds()[0]!;
  surface.setSelection({ anchor: { paragraphId, offset: 1 }, head: { paragraphId, offset: 1 } });
  surface.layout();
  expect(surface.formatting().bold).toBe(true);
  expect(surface.formatting().italic).toBe(false);
  expect(
    editor.exec({ type: 'resolveAllReviewChanges', action: 'reject', scope: 'document' }).ok
  ).toBe(true);
  surface.layout();
  expect(surface.formatting().bold).toBe(false);
  expect(surface.formatting().italic).toBe(true);
  session.undo();
  surface.layout();
  expect(surface.formatting().bold).toBe(true);
  expect(surface.formatting().italic).toBe(false);
  editor.destroy();
});

test('missing style revision IDs remain visible and cannot silently disappear from counts', () => {
  const { editor, session, xml } = mount(style(history().replace(' w:id="1"', '')));
  const before = xml();
  expect(session.reviewItems()).toHaveLength(2);
  const result = editor.exec({
    type: 'resolveAllReviewChanges',
    action: 'accept',
    scope: 'document',
  });
  expect(result).toMatchObject({ ok: true, revisions: { remaining: 1 } });
  expect(xml()).toBe(before);
  expect(session.reviewItems()[0]).toMatchObject({ readOnly: true });
  editor.destroy();
});
