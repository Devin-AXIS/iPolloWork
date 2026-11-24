// WHAT RESOLVING A REVISION LEAVES BEHIND.
//
// Accept and Reject are one click that rewrites the document under the reader's caret, and
// two things have to survive it: the caret has to still mean the characters it meant, and the
// markup left behind has to be markup the rest of the engine accepts.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import {
  collectReviewItems as engineCollectReviewItems,
  findNode,
  revisionItemsOf,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import type { EditorModule } from '../../contracts/modules.ts';
import { reviewCodeOfRefusal } from '../diagnostic-codes.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const ins = (id: number, author = 'Ada') =>
  `<w:p><w:ins w:id="${id}" w:author="${author}"><w:r><w:t>Added${id}</w:t></w:r></w:ins></w:p>`;

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

function mountEditor(body: string): DocxEditorInstance {
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

describe('shared Review menu commands', () => {
  for (const action of ['acceptReviewItem', 'rejectReviewItem'] as const) {
    test(`${action} resolves an authorless table-grid record attached to a row decision`, () => {
      const editor = mountEditor(
        '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/>' +
          '<w:tblGridChange w:id="1"><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid></w:tblGridChange>' +
          '</w:tblGrid><w:tr><w:trPr><w:trHeight w:val="400"/><w:trPrChange w:id="2" w:author="Ada"><w:trPr/></w:trPrChange></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>'
      );
      const item = editor
        .getReviewItems({ pairReplacements: false })
        .find((item) => item.kind === 'revision');
      expect(item).toBeDefined();
      expect(editor[action](item!.key).ok).toBe(true);
      expect(editor.getReviewItems({ pairReplacements: false })).toHaveLength(0);
      editor.destroy();
    });

    test(`${action} on replacement halves preserves formatting with the same revision address`, () => {
      const editor = mountEditor(
        '<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="1" w:author="Ada"><w:rPr/></w:rPrChange></w:rPr><w:t>Base</w:t></w:r><w:del w:id="1" w:author="Ada"><w:r><w:delText>Old</w:delText></w:r></w:del><w:ins w:id="2" w:author="Ada"><w:r><w:t>New</w:t></w:r></w:ins></w:p>'
      );
      const halves = editor
        .getReviewItems({ pairReplacements: false })
        .filter(
          (item) => item.kind === 'revision' && ['delete', 'insert'].includes(item.revisionKind)
        );
      expect(halves).toHaveLength(2);
      for (const half of halves) expect(editor[action](half.key).ok).toBe(true);
      const remaining = editor.getReviewItems({ pairReplacements: false });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.kind === 'revision' && remaining[0]!.revisionKind).toBe('format');
      expect(editor.surface!.session.bodyText()).toBe(
        action === 'acceptReviewItem' ? 'BaseNew' : 'BaseOld'
      );
      editor.destroy();
    });

    test(`${action} on a paragraph break preserves non-adjacent text with the same address`, () => {
      const address = 'w:id="1" w:author="Ada" w:date="2026-09-09T10:00:00Z"';
      const editor = mountEditor(
        `<w:p><w:pPr><w:rPr><w:ins ${address}/></w:rPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p>` +
          '<w:p><w:r><w:t>Middle</w:t></w:r></w:p>' +
          '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
          `<w:p><w:ins ${address}><w:r><w:t>Other</w:t></w:r></w:ins></w:p>` +
          '</w:sdtContent></w:sdt>'
      );
      const paragraphBreak = editor
        .getReviewItems({ pairReplacements: false })
        .find((item) => item.kind === 'revision' && item.revisionKind === 'paragraphMark');
      expect(paragraphBreak).toBeDefined();
      expect(editor[action](paragraphBreak!.key).ok).toBe(true);
      const remaining = editor.getReviewItems({ pairReplacements: false });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.kind === 'revision' && remaining[0]!.revisionKind).toBe('insert');
      expect(editor.surface!.session.bodyText()).toBe(
        action === 'acceptReviewItem' ? 'First\nMiddle\nOther' : 'FirstMiddle\nOther'
      );
      editor.destroy();
    });
  }

  for (const [name, author, expected] of [
    ['one author at separate editing moments join', 'Ada', 1],
    ['two authors stay separate', 'Grace', 2],
  ] as const) {
    test(`empty adjacent paragraph breaks by ${name}`, () => {
      const mark = (id: number, who: string, date: string) =>
        `<w:p><w:pPr><w:rPr><w:ins w:id="${id}" w:author="${who}" w:date="${date}"/></w:rPr></w:pPr></w:p>`;
      const editor = mountEditor(
        mark(1, 'Ada', '2026-09-08T10:00:00Z') + mark(2, author, '2026-09-09T10:00:00Z')
      );
      const paragraphBreaks = editor
        .getReviewItems({ pairReplacements: false })
        .filter((item) => item.kind === 'revision' && item.revisionKind === 'paragraphMark');
      expect(paragraphBreaks).toHaveLength(expected);
      editor.destroy();
    });
  }
  test('navigation starts from the caret when no change is active', () => {
    const editor = mountEditor(ins(1) + '<w:p><w:r><w:t>Unchanged</w:t></w:r></w:p>' + ins(2));
    const items = editor.getReviewItems({ pairReplacements: false });
    const paragraphId = editor.surface!.session.paragraphIds()[1]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 4 },
      head: { paragraphId, offset: 4 },
    });
    editor.exec({ type: 'navigateReviewChange', direction: 'next' });
    expect(
      editor.getReviewItems({ pairReplacements: false }).find((item) => item.isActive)?.key
    ).toBe(items[1]!.key);
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 4 },
      head: { paragraphId, offset: 4 },
    });
    editor.exec({ type: 'navigateReviewChange', direction: 'previous' });
    expect(
      editor.getReviewItems({ pairReplacements: false }).find((item) => item.isActive)?.key
    ).toBe(items[0]!.key);
    editor.destroy();
  });

  test('accepting a deletion nested in another author’s insertion leaves no blank card', async () => {
    const editor = mountEditor(
      '<w:p><w:r><w:t xml:space="preserve">A </w:t></w:r>' +
        '<w:ins w:id="1" w:author="Ada"><w:del w:id="2" w:author="Grace"><w:r><w:delText>new</w:delText></w:r></w:del></w:ins>' +
        '<w:r><w:t xml:space="preserve"> B</w:t></w:r></w:p>'
    );
    const before = await editor.save();
    const deletion = editor
      .getReviewItems({ pairReplacements: false })
      .find((item) => item.kind === 'revision' && item.revisionKind === 'delete');
    expect(deletion).toBeDefined();
    expect(editor.acceptReviewItem(deletion!.key).ok).toBe(true);
    expect(editor.getReviewItems({ pairReplacements: false })).toHaveLength(0);
    expect(editor.getTrackedChanges()).toHaveLength(0);
    expect(editor.surface!.session.bodyText()).toBe('A  B');
    expect(serializeOoxmlPart(editor.surface!.session.storyParts()[0]!)).not.toContain('<w:ins');
    editor.exec({ type: 'undo' });
    expect(editor.getReviewItems({ pairReplacements: false })).toHaveLength(2);
    expect(await editor.save()).toEqual(before);
    editor.destroy();
  });

  test('bulk resolution keeps review comments', () => {
    const editor = mountEditor(ins(1));
    expect(
      editor.replyToReviewItem(
        editor.getReviewItems({ pairReplacements: false })[0]!.key,
        'Keep this discussion'
      ).ok
    ).toBe(true);
    expect(editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }).ok).toBe(true);
    const items = editor.surface!.session.reviewItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe('comment');
    editor.destroy();
  });
  for (const action of ['accept', 'reject'] as const) {
    test(`bulk ${action} resolves body, header, and footnote changes in one undo`, async () => {
      const relationshipNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
      const files = unzipSync(
        docxOf(
          ins(1) +
            `<w:p><w:r><w:footnoteReference w:id="2"/></w:r></w:p><w:sectPr><w:headerReference xmlns:r="${relationshipNs}" w:type="default" r:id="header"/></w:sectPr>`
        )
      );
      files['[Content_Types].xml'] = strToU8(
        strFromU8(files['[Content_Types].xml']!).replace(
          '</Types>',
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'
        )
      );
      files['word/_rels/document.xml.rels'] = strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="header" Type="${relationshipNs}/header" Target="header1.xml"/><Relationship Id="notes" Type="${relationshipNs}/footnotes" Target="footnotes.xml"/></Relationships>`
      );
      files['word/header1.xml'] = strToU8(`<w:hdr xmlns:w="${W}">${ins(1)}</w:hdr>`);
      files['word/footnotes.xml'] = strToU8(
        `<w:footnotes xmlns:w="${W}"><w:footnote w:id="2">${ins(3)}</w:footnote></w:footnotes>`
      );
      const editor = createDocxEditor({
        container: document.createElement('div'),
        document: zipSync(files),
        modules: [reviewModule()],
      });
      const xml = () => editor.surface!.session.storyParts().map(serializeOoxmlPart);
      const unopened = xml();
      expect(editor.can({ type: 'resolveAllReviewChanges', action }).ok).toBe(true);
      expect(xml()).toEqual(unopened);
      // First mutation initializes an unopened header's paragraph IDs, outside undo history.
      const contentXml = () =>
        xml().map((value) =>
          value.replace(/ xmlns:w14="[^"]*"/g, '').replace(/ w14:(?:paraId|textId)="[^"]*"/g, '')
        );
      const before = contentXml();
      expect(editor.surface!.session.reviewItems()).toHaveLength(3);
      expect(editor.exec({ type: 'resolveAllReviewChanges', action })).toMatchObject({
        ok: true,
        changed: true,
      });
      expect(editor.surface!.session.reviewItems()).toHaveLength(0);
      editor.exec({ type: 'undo' });
      expect(contentXml()).toEqual(before);
      expect(editor.surface!.session.reviewItems()).toHaveLength(3);
      editor.destroy();
    });
  }
  test('navigation wraps visible revisions and honors activation exclusions', () => {
    const editor = mountEditor(ins(1) + ins(2, 'Grace') + ins(3));
    const keys = editor.getReviewItems({ pairReplacements: false }).map((item) => item.key);
    editor.setActiveReviewItem(keys[0]!);
    expect(editor.exec({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(true);
    expect(
      editor.getReviewItems({ pairReplacements: false }).find((item) => item.isActive)?.key
    ).toBe(keys[1]);
    editor.setReviewAuthorVisible('Grace', false);
    editor.setActiveReviewItem(keys[0]!);
    editor.exec({ type: 'navigateReviewChange', direction: 'next' });
    expect(
      editor.getReviewItems({ pairReplacements: false }).find((item) => item.isActive)?.key
    ).toBe(keys[2]);
    editor.exec({ type: 'navigateReviewChange', direction: 'next' });
    expect(
      editor.getReviewItems({ pairReplacements: false }).find((item) => item.isActive)?.key
    ).toBe(keys[0]);
    editor.exec({ type: 'navigateReviewChange', direction: 'previous' });
    expect(
      editor.getReviewItems({ pairReplacements: false }).find((item) => item.isActive)?.key
    ).toBe(keys[2]);
    editor.setReviewActivationExclusions(['insert']);
    expect(editor.can({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(false);
    editor.destroy();
  });

  test('navigation reaches a formatting balloon when the rail hides format cards', () => {
    const editor = mountEditor(
      '<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="1" w:author="Ada"><w:rPr/></w:rPrChange></w:rPr><w:t>Bold</w:t></w:r></w:p>' +
        ins(2)
    );
    const format = editor
      .getReviewItems({ pairReplacements: false })
      .find((item) => item.kind === 'revision' && item.revisionKind === 'format');
    expect(format).toBeDefined();
    editor.setReviewActivationExclusions(['format', 'structural']);
    expect(editor.exec({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(true);
    expect(
      editor.getReviewItems({ pairReplacements: false }).find((item) => item.isActive)?.key
    ).toBe(format!.key);
    editor.destroy();
  });

  test('accepting a card preserves the caret; Next Change continues review', () => {
    const editor = mountEditor(ins(1) + ins(2));
    const items = editor.getReviewItems({ pairReplacements: false });
    editor.setActiveReviewItem(items[0]!.key);
    const before = editor.surface!.state().selection;
    expect(editor.acceptReviewItem(items[0]!.key).ok).toBe(true);
    expect(editor.surface!.state().selection).toEqual(before);
    editor.exec({ type: 'navigateReviewChange', direction: 'next' });
    expect(
      editor.getReviewItems({ pairReplacements: false }).find((item) => item.isActive)?.key
    ).toBe(items[1]!.key);
    editor.destroy();
  });

  for (const action of ['accept', 'reject'] as const) {
    test(`bulk ${action} preserves hidden authors and has one undo`, async () => {
      const editor = mountEditor(ins(1) + ins(2, 'Grace'));
      const before = await editor.save();
      editor.setReviewAuthorVisible('Grace', false);
      expect(editor.exec({ type: 'resolveAllReviewChanges', action })).toMatchObject({
        ok: true,
        changed: true,
      });
      expect(editor.surface!.session.reviewItems()).toHaveLength(1);
      expect(editor.surface!.session.bodyText()).toBe(
        action === 'accept' ? 'Added1\nAdded2' : '\nAdded2'
      );
      editor.exec({ type: 'undo' });
      expect(await editor.save()).toEqual(before);
      expect(editor.surface!.session.reviewItems()).toHaveLength(2);
      editor.destroy();
    });
  }

  test('bulk resolution refuses unsupported changes atomically', async () => {
    const editor = mountEditor(
      ins(1) +
        '<w:tbl><w:tblPr><w:ins w:id="2" w:author="Ada"/></w:tblPr><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>'
    );
    const before = await editor.save();
    expect(
      editor.can({ type: 'resolveAllReviewChanges', action: 'accept', unsupported: 'fail' }).ok
    ).toBe(false);
    expect(
      editor.exec({ type: 'resolveAllReviewChanges', action: 'accept', unsupported: 'fail' }).ok
    ).toBe(false);
    expect(await editor.save()).toEqual(before);
    editor.destroy();
  });

  test('navigation and display work in viewing mode; bulk changes do not', async () => {
    const editor = mountEditor(ins(1));
    const before = await editor.save();
    const key = editor.getReviewItems({ pairReplacements: false })[0]!.key;
    editor.setEditingMode('viewing');
    expect(editor.acceptReviewItem(key).ok).toBe(false);
    expect(editor.rejectReviewItem(key).ok).toBe(false);
    expect(editor.exec({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(true);
    expect(
      editor.exec({ type: 'resolveAllReviewChanges', action: 'accept', unsupported: 'fail' }).ok
    ).toBe(false);
    for (const mode of ['original', 'proposed', 'all-markup'] as const) {
      expect(editor.exec({ type: 'setReviewDisplayMode', mode })).toEqual({
        ok: true,
        changed: false,
      });
      expect(editor.snapshot().reviewDisplayMode).toBe(mode);
      expect(editor.isActive({ type: 'setReviewDisplayMode', mode })).toBe(true);
      expect(await editor.save()).toEqual(before);
      expect(editor.surface!.session.canUndo()).toBe(false);
    }
    editor.destroy();
    expect(editor.exec({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(false);
    expect(editor.exec({ type: 'setReviewDisplayMode', mode: 'original' }).ok).toBe(false);
  });
});

for (const action of ['accept', 'reject'] as const) {
  for (const filter of ['author', 'predicate', 'combined'] as const) {
    test(`${action} honors ${filter} filters, preserves comments, and redoes one decision`, async () => {
      const editor = mountEditor(ins(1) + ins(2, 'Grace') + ins(3));
      try {
        editor.replyToReviewItem(
          editor.getReviewItems({ pairReplacements: false })[1]!.key,
          'Keep discussion'
        );
        const before = await editor.save();
        if (filter !== 'predicate') editor.setReviewAuthorVisible('Grace', false);
        if (filter !== 'author')
          editor.setTrackedChangesFilter(
            (item) => item.author === 'Ada' && (filter !== 'combined' || item.text === 'Added3')
          );
        const count = filter === 'combined' ? 1 : 2;
        const result = editor.exec({ type: 'resolveAllReviewChanges', action });
        expect(result).toMatchObject({
          ok: true,
          changed: true,
          revisions: { remaining: 3 - count },
        });
        expect(result.revisions?.resolved).toHaveLength(count);
        const after = await editor.save();
        editor.exec({ type: 'undo' });
        expect(await editor.save()).toEqual(before);
        editor.exec({ type: 'redo' });
        expect(await editor.save()).toEqual(after);
        expect(
          editor.surface!.session.reviewItems().filter((item) => item.kind === 'comment')
        ).toHaveLength(1);
      } finally {
        editor.destroy();
      }
    });
  }
  // A change in locked content resolves when the decision keeps the content (accepting an
  // insertion) and is skipped when it would remove it (rejecting one).
  test(`${action} skips mixed unsupported changes and changes a content lock keeps`, async () => {
    for (const locked of [false, true]) {
      const supported = locked
        ? '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
          ins(2) +
          '</w:sdtContent></w:sdt>'
        : '';
      const editor = mountEditor(
        ins(1) +
          supported +
          '<w:tbl><w:tblPr><w:ins w:id="20" w:author="Grace"/></w:tblPr><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>'
      );
      try {
        const before = await editor.save();
        const result = editor.exec({ type: 'resolveAllReviewChanges', action });
        expect(result.ok).toBe(true);
        const kept = locked && action === 'reject';
        if (kept)
          expect(result.revisions?.skipped.map((entry) => entry.detail)).toContain(
            'locked-content'
          );
        {
          expect(result.revisions?.skipped).toHaveLength(kept ? 2 : 1);
          expect(result.revisions?.remaining).toBe(kept ? 2 : 1);
          expect(editor.can({ type: 'resolveAllReviewChanges', action }).ok).toBe(false);
          editor.exec({ type: 'undo' });
          expect(await editor.save()).toEqual(before);
        }
      } finally {
        editor.destroy();
      }
    }
  });
  test(`${action} handles all-hidden, empty, unknown and duplicate keys without extra history`, () => {
    const editor = mountEditor(ins(1) + ins(2, 'Grace'));
    try {
      const keys = editor.getReviewItems({ pairReplacements: false }).map((item) => item.key);
      editor.setTrackedChangesFilter(() => false);
      expect(editor.exec({ type: 'resolveAllReviewChanges', action }).ok).toBe(false);
      expect(editor.exec({ type: 'resolveAllReviewChanges', action, keys: [] }).ok).toBe(false);
      expect(editor.surface!.session.canUndo()).toBe(false);
      const strict = editor.exec({
        type: 'resolveAllReviewChanges',
        action,
        keys: [keys[0]!, 'unknown'],
        unsupported: 'fail',
      });
      expect(strict.ok).toBe(false);
      expect(strict.revisions?.resolved).toEqual([]);
      expect(editor.surface!.session.canUndo()).toBe(false);
      const result = editor.exec({
        type: 'resolveAllReviewChanges',
        action,
        keys: [keys[0]!, keys[0]!, 'unknown'],
      });
      expect(result.ok).toBe(true);
      expect(result.revisions?.resolved).toHaveLength(1);
      expect(result.revisions?.skipped).toEqual([{ key: 'unknown', reason: 'unknown-revision' }]);
      expect(editor.exec({ type: 'resolveAllReviewChanges', action, scope: 'document' }).ok).toBe(
        true
      );
      expect(editor.surface!.session.reviewItems()).toHaveLength(0);
    } finally {
      editor.destroy();
    }
  });
}

for (const action of ['accept', 'reject'] as const) {
  test(`bulk ${action} beside malformed table properties exports and undoes as one action`, async () => {
    const editor = mountEditor(
      '<w:tbl><w:tr><w:trPr><w:trPrChange w:id="9" w:author="Grace"><w:trPr/></w:trPrChange><w:trPrChange w:id="9" w:author="Grace"><w:trPr/></w:trPrChange></w:trPr><w:tc>' +
        ins(1) +
        ins(2) +
        '</w:tc></w:tr></w:tbl><w:p/>'
    );
    try {
      const before = await editor.save();
      const result = editor.exec({ type: 'resolveAllReviewChanges', action });
      expect(result).toMatchObject({ ok: true, changed: true, revisions: { remaining: 1 } });
      expect(result.revisions?.resolved).toHaveLength(2);
      expect(result.revisions?.skipped).toHaveLength(1);
      const after = await editor.save();
      expect(strFromU8(unzipSync(new Uint8Array(after))['word/document.xml']!)).toContain(
        'trPrChange'
      );
      editor.exec({ type: 'undo' });
      expect(await editor.save()).toEqual(before);
      editor.exec({ type: 'redo' });
      expect(await editor.save()).toEqual(after);
    } finally {
      editor.destroy();
    }
  });
}

describe('reviewItemReveal', () => {
  const record = (editor: DocxEditorInstance) => {
    const events: { key: string; source: string }[] = [];
    editor.on('reviewItemReveal', (event) => events.push({ ...event }));
    return events;
  };

  test('Next and Previous Change announce every landing', () => {
    const editor = mountEditor(ins(1) + ins(2));
    const keys = editor.getReviewItems({ pairReplacements: false }).map((item) => item.key);
    editor.setActiveReviewItem(keys[0]!, { announce: false });
    const events = record(editor);
    editor.exec({ type: 'navigateReviewChange', direction: 'next' });
    editor.exec({ type: 'navigateReviewChange', direction: 'next' });
    editor.exec({ type: 'navigateReviewChange', direction: 'previous' });
    expect(events).toEqual([
      { key: keys[1]!, source: 'navigate' },
      { key: keys[0]!, source: 'navigate' },
      { key: keys[1]!, source: 'navigate' },
    ]);
    editor.destroy();
  });

  test('a lone change navigates to itself and announces again', () => {
    const editor = mountEditor(ins(1));
    const [only] = editor.getReviewItems({ pairReplacements: false });
    const events = record(editor);
    editor.exec({ type: 'navigateReviewChange', direction: 'next' });
    editor.setActiveReviewItem(null);
    editor.exec({ type: 'navigateReviewChange', direction: 'next' });
    editor.exec({ type: 'navigateReviewChange', direction: 'next' });
    expect(events).toEqual([
      { key: only!.key, source: 'navigate' },
      { key: only!.key, source: 'navigate' },
      { key: only!.key, source: 'navigate' },
    ]);
    editor.destroy();
  });

  test('caret moves, dismissals and refusals announce nothing', () => {
    const editor = mountEditor(ins(1) + '<w:p><w:r><w:t>Plain</w:t></w:r></w:p>');
    const events = record(editor);
    const [changed, plain] = editor.surface!.session.paragraphIds();
    for (const paragraphId of [changed!, plain!, changed!]) {
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: 1 },
        head: { paragraphId, offset: 1 },
      });
    }
    expect(editor.getReviewItems({ pairReplacements: false }).some((item) => item.isActive)).toBe(
      true
    );
    editor.setActiveReviewItem(null);
    expect(editor.setActiveReviewItem('missing').ok).toBe(false);
    editor.setReviewActivationExclusions(['insert']);
    expect(editor.exec({ type: 'navigateReviewChange', direction: 'next' }).ok).toBe(false);
    expect(events).toEqual([]);
    editor.destroy();
  });

  test('setActiveReviewItem announces as the host only with announce: true', () => {
    const editor = mountEditor(ins(1) + ins(2));
    const keys = editor.getReviewItems({ pairReplacements: false }).map((item) => item.key);
    const events = record(editor);
    // The default stays silent, so a host call opens no balloon and no closed pane.
    expect(editor.setActiveReviewItem(keys[0]!).ok).toBe(true);
    expect(editor.setActiveReviewItem(keys[0]!, { announce: false }).ok).toBe(true);
    expect(events).toEqual([]);
    expect(editor.setActiveReviewItem(keys[1]!, { announce: true }).ok).toBe(true);
    expect(editor.setActiveReviewItem(keys[1]!, { announce: true }).ok).toBe(true);
    expect(
      editor.getReviewItems({ pairReplacements: false }).find((item) => item.isActive)?.key
    ).toBe(keys[1]);
    expect(editor.getActivatedReviewItemKey()).toBe(keys[1]);
    expect(events).toEqual([
      { key: keys[1]!, source: 'host' },
      { key: keys[1]!, source: 'host' },
    ]);
    editor.destroy();
  });

  test('re-keying the active change under a new author announces nothing', () => {
    const editor = mountEditor(ins(1) + ins(2));
    const [first] = editor.getReviewItems({ pairReplacements: false });
    editor.setActiveReviewItem(first!.key);
    const events = record(editor);
    const result = editor.exec({
      type: 'setReviewChangesAuthor',
      author: 'Grace Hopper',
      keys: [first!.key],
    });
    expect(result.ok).toBe(true);
    expect(editor.getActivatedReviewItemKey()).not.toBe(first!.key);
    expect(events).toEqual([]);
    editor.destroy();
  });

  test('the payload is frozen', () => {
    const editor = mountEditor(ins(1));
    let payload: object | undefined;
    editor.on('reviewItemReveal', (event) => {
      payload = event;
    });
    editor.exec({ type: 'navigateReviewChange', direction: 'next' });
    expect(Object.isFrozen(payload)).toBe(true);
    editor.destroy();
  });
});

// When one cause keeps every change, the bulk refusal names it, and each card names its code.
test('a bulk decision a lock or a binding keeps everywhere names that cause', () => {
  for (const [action, properties, sentence, code] of [
    [
      'reject',
      '<w:lock w:val="contentLocked"/>',
      'content controls lock every remaining change; remove the locks to decide them',
      'review.locked-content',
    ],
    [
      'accept',
      '<w:dataBinding w:storeItemID="{1}" w:xpath="/a"/>',
      'every remaining change is in a data-bound content control',
      'review.bound-content',
    ],
  ] as const) {
    const editor = mountEditor(
      `<w:sdt><w:sdtPr>${properties}</w:sdtPr><w:sdtContent>${ins(1)}</w:sdtContent></w:sdt>`
    );
    try {
      expect(editor.exec({ type: 'resolveAllReviewChanges', action })).toMatchObject({
        ok: false,
        code: code === 'review.locked-content' ? 'locked' : 'bound',
        reason: sentence,
      });
      expect(reviewCodeOfRefusal(sentence)).toBe(code);
      const [card] = editor.getReviewItems({ pairReplacements: false });
      const result =
        action === 'accept'
          ? editor.acceptReviewItem(card!.key)
          : editor.rejectReviewItem(card!.key);
      // The exec code stays the edit's own, `locked` or `bound`; the reason names the review code.
      expect(result).toMatchObject({ code: code === 'review.locked-content' ? 'locked' : 'bound' });
      expect(reviewCodeOfRefusal(result.ok ? '' : result.reason)).toBe(code);
    } finally {
      editor.destroy();
    }
  }
});
