import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { writeOoxmlPackage, readOoxmlPackage } from '../package/ooxml-package.ts';
import { commentExportPackage } from '../package/comment-export-cleanup.ts';
import { readOoxmlPart } from '../package/ooxml-tree.ts';
import { deleteCommentThread } from '../package/comment-lifecycle.ts';
import {
  loadCommentFixture,
  markedComment,
  W,
  W14,
  W15,
  W16CID,
} from './comment-lifecycle-test-support.ts';

const record =
  '<w:comment w:id="1" w:author="Reviewer"><w:p w14:paraId="00000001">' +
  '<w:r><w:t>Review text</w:t></w:r></w:p></w:comment>';
const comments = (body: string) =>
  `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">${body}</w:comments>`;

test('export removes emptied comment parts and relationships without mutating the live package', () => {
  const pkg = loadCommentFixture({
    body: markedComment('Keep this text'),
    comments: comments(record),
    extended: `<w15:commentsEx xmlns:w15="${W15}"><w15:commentEx w15:paraId="00000001"/></w15:commentsEx>`,
    commentsIds: `<w16cid:commentsIds xmlns:w16cid="${W16CID}"><w16cid:commentId w16cid:paraId="00000001" w16cid:durableId="00000011"/></w16cid:commentsIds>`,
  });
  const deleted = deleteCommentThread(pkg, '1');
  expect(deleted).not.toBeNull();
  const saved = writeOoxmlPackage(deleted!);
  const files = unzipSync(saved);
  expect(files['word/comments.xml']).toBeUndefined();
  expect(files['word/commentsExtended.xml']).toBeUndefined();
  expect(files['word/commentsIds.xml']).toBeUndefined();
  expect(strFromU8(files['word/_rels/document.xml.rels']!)).not.toContain('comments');
  expect(strFromU8(files['[Content_Types].xml']!)).not.toContain('comments');
  expect(strFromU8(files['word/document.xml']!)).toContain('Keep this text');
  expect(deleted!.parts.has('/word/comments.xml')).toBe(true);
  expect(readOoxmlPackage(saved).ok).toBe(true);
  // The original snapshot still exports the comment, as undo requires.
  expect(unzipSync(writeOoxmlPackage(pkg))['word/comments.xml']).toBeDefined();
});

test('recognized empty source parts normalize without changing the live package', () => {
  const pkg = loadCommentFixture({ body: '<w:p/>', comments: comments('') });
  expect(unzipSync(writeOoxmlPackage(pkg))['word/comments.xml']).toBeUndefined();
  expect(pkg.parts.has('/word/comments.xml')).toBe(true);
});

test('unknown comment extension content survives deletion and export', () => {
  const pkg = loadCommentFixture({
    body: markedComment('Keep'),
    comments: comments(record + '<x:extension xmlns:x="urn:extension">Retain</x:extension>'),
  });
  const deleted = deleteCommentThread(pkg, '1');
  expect(deleted).not.toBeNull();
  const files = unzipSync(writeOoxmlPackage(deleted!));
  expect(strFromU8(files['word/comments.xml']!)).toContain('Retain');
});

test('unresolved markers in another story prevent comment-part removal', () => {
  const pkg = loadCommentFixture({
    body: markedComment('Keep'),
    comments: comments(record),
    header: markedComment('Unresolved comment', '2'),
  });
  const deleted = deleteCommentThread(pkg, '1');
  expect(deleted).not.toBeNull();
  expect(unzipSync(writeOoxmlPackage(deleted!))['word/comments.xml']).toBeDefined();
});

test('retained metadata keeps the comments part and its outgoing relationship', () => {
  const pkg = loadCommentFixture({
    body: markedComment('Keep'),
    comments: comments(record),
    extendedFrom: 'comments',
    extended: `<w15:commentsEx xmlns:w15="${W15}"><w15:commentEx w15:paraId="00000001"/><x:extension xmlns:x="urn:extension">Retain</x:extension></w15:commentsEx>`,
  });
  const deleted = deleteCommentThread(pkg, '1')!;
  const files = unzipSync(writeOoxmlPackage(deleted));
  expect(files['word/comments.xml']).toBeDefined();
  expect(strFromU8(files['word/_rels/comments.xml.rels']!)).toContain('commentsExtended.xml');
  expect(strFromU8(files['word/commentsExtended.xml']!)).toContain('Retain');
});

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
for (const relationship of [
  'unknown-incoming',
  'unknown-outgoing',
  'external-outgoing',
  'extension-attribute',
] as const) {
  test(`export preserves ${relationship} records`, () => {
    const original = loadCommentFixture({
      body: markedComment('Keep'),
      comments: comments(record),
    });
    const files = unzipSync(writeOoxmlPackage(original));
    if (relationship === 'unknown-incoming') {
      const name = 'word/_rels/document.xml.rels';
      files[name] = strToU8(
        strFromU8(files[name]!).replace(
          '</Relationships>',
          '<Relationship Id="custom" Type="urn:custom" Target="comments.xml"/></Relationships>'
        )
      );
    } else {
      const attributes =
        relationship === 'external-outgoing'
          ? 'Id="custom" Type="urn:custom" Target="https://example.com/retained" TargetMode="External"'
          : relationship === 'extension-attribute'
            ? 'Id="custom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml" x:keep="yes" xmlns:x="urn:custom"'
            : 'Id="custom" Type="urn:custom" Target="document.xml"';
      files['word/_rels/comments.xml.rels'] = strToU8(
        `<Relationships xmlns="${REL}"><Relationship ${attributes}/></Relationships>`
      );
    }
    const parsed = readOoxmlPackage(zipSync(files));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const deleted = deleteCommentThread(parsed.package, '1')!;
    expect(deleted).not.toBeNull();
    const saved = unzipSync(writeOoxmlPackage(deleted));
    expect(saved['word/comments.xml']).toBeDefined();
    const name =
      relationship === 'unknown-incoming'
        ? 'word/_rels/document.xml.rels'
        : 'word/_rels/comments.xml.rels';
    expect(strFromU8(saved[name]!)).toContain('urn:custom');
  });
}

test('empty metadata linked from comments can be removed together', () => {
  const pkg = loadCommentFixture({
    body: markedComment('Keep'),
    comments: comments(record),
    extendedFrom: 'comments',
    extended: `<w15:commentsEx xmlns:w15="${W15}"><w15:commentEx w15:paraId="00000001"/></w15:commentsEx>`,
  });
  const saved = unzipSync(writeOoxmlPackage(deleteCommentThread(pkg, '1')!));
  expect(saved['word/comments.xml']).toBeUndefined();
  expect(saved['word/commentsExtended.xml']).toBeUndefined();
  expect(saved['word/_rels/comments.xml.rels']).toBeUndefined();
});

test('a known root with the wrong comment content type remains unchanged', () => {
  const pkg = loadCommentFixture({ body: '<w:p/>', comments: comments('') });
  const wrong = readOoxmlPart(`<w15:commentsEx xmlns:w15="${W15}"/>`, {
    name: '/word/comments.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
  });
  expect(wrong.ok).toBe(true);
  if (!wrong.ok) return;
  const parts = new Map(pkg.parts);
  parts.set(wrong.part.name, wrong.part);
  const changed = { ...pkg, parts };
  expect(commentExportPackage(changed)).toBe(changed);
});

test('equal canonical packages export identically despite different source comment bytes', () => {
  const populated = loadCommentFixture({ body: markedComment('Keep'), comments: comments(record) });
  const deleted = deleteCommentThread(populated, '1')!;
  const empty = loadCommentFixture({ body: '<w:p/>', comments: comments('') });
  const localBytes = new Map(deleted.partBytes);
  localBytes.set('/word/comments.xml', empty.partBytes.get('/word/comments.xml')!);
  const remoteParts = new Map(deleted.parts);
  const remoteComments = remoteParts.get('/word/comments.xml')!;
  remoteParts.set(remoteComments.name, { ...remoteComments, contentType: 'application/xml' });
  const remote = { ...deleted, parts: remoteParts, partBytes: localBytes };
  const expected = writeOoxmlPackage(deleted);
  expect(writeOoxmlPackage(remote)).toEqual(expected);
  localBytes.delete('/word/comments.xml');
  expect(writeOoxmlPackage({ ...deleted, partBytes: localBytes })).toEqual(expected);
  expect(unzipSync(expected)['word/comments.xml']).toBeUndefined();
  expect(deleted.parts.has('/word/comments.xml')).toBe(true);
});

test('export normalization remains stable after reopen', () => {
  const pkg = loadCommentFixture({ body: '<w:p/>', comments: comments('') });
  const first = writeOoxmlPackage(pkg);
  const loaded = readOoxmlPackage(first);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const second = unzipSync(writeOoxmlPackage(loaded.package));
  const expected = unzipSync(first);
  expect(Object.keys(second).sort()).toEqual(Object.keys(expected).sort());
  for (const name of Object.keys(expected)) expect(second[name]).toEqual(expected[name]);
});

test('a wrong package content type prevents removal despite a cached comment MIME type', () => {
  const populated = loadCommentFixture({ body: '<w:p/>', comments: comments(record) });
  const files = unzipSync(writeOoxmlPackage(populated));
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
      'application/xml'
    )
  );
  files['word/comments.xml'] = strToU8(comments(''));
  const loaded = readOoxmlPackage(zipSync(files));
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  const parts = new Map(loaded.package.parts);
  const part = parts.get('/word/comments.xml')!;
  parts.set(part.name, {
    ...part,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
  });
  const pkg = { ...loaded.package, parts };
  expect(commentExportPackage(pkg)).toBe(pkg);
  expect(unzipSync(writeOoxmlPackage(pkg))['word/comments.xml']).toBeDefined();
});

for (const extension of ['attribute', 'child'] as const) {
  test(`comment export preserves targeted content-type ${extension} extensions`, () => {
    const populated = loadCommentFixture({ body: '<w:p/>', comments: comments(record) });
    const files = unzipSync(writeOoxmlPackage(populated));
    const original = strFromU8(files['[Content_Types].xml']!);
    files['[Content_Types].xml'] = strToU8(
      original.replace(/<Override\b[^>]*PartName="\/word\/comments.xml"[^>]*\/>/, (declaration) =>
        extension === 'attribute'
          ? declaration.replace('<Override ', '<Override xmlns:x="urn:retained" x:keep="Retain" ')
          : declaration.replace('/>', '><x:keep xmlns:x="urn:retained">Retain</x:keep></Override>')
      )
    );
    expect(strFromU8(files['[Content_Types].xml']!)).toContain('Retain');
    files['word/comments.xml'] = strToU8(comments(''));
    const loaded = readOoxmlPackage(zipSync(files));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(commentExportPackage(loaded.package)).toBe(loaded.package);
    const saved = writeOoxmlPackage(loaded.package);
    const first = unzipSync(saved);
    expect(first['word/comments.xml']).toBeDefined();
    expect(strFromU8(first['[Content_Types].xml']!)).toContain('Retain');
    const reopened = readOoxmlPackage(saved);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const second = unzipSync(writeOoxmlPackage(reopened.package));
    expect(second['[Content_Types].xml']).toEqual(first['[Content_Types].xml']);
    expect(second['word/comments.xml']).toEqual(first['word/comments.xml']);
  });
}

for (const location of ['root', 'relationship', 'override'] as const) {
  for (const [kind, whitespace] of [
    ['xml', ' \t\r\n'],
    ['nbsp', '\u00a0'],
  ] as const) {
    test(`comment export handles ${kind} whitespace in ${location}`, () => {
      const populated = loadCommentFixture({ body: '<w:p/>', comments: comments(record) });
      const files = unzipSync(writeOoxmlPackage(populated));
      files['word/comments.xml'] = strToU8(comments(location === 'root' ? whitespace : ''));
      if (location === 'override') {
        files['[Content_Types].xml'] = strToU8(
          strFromU8(files['[Content_Types].xml']!).replace(
            /<Override\b[^>]*PartName="\/word\/comments.xml"[^>]*\/>/,
            (declaration) => declaration.replace('/>', `>${whitespace}</Override>`)
          )
        );
      }
      if (location === 'relationship') {
        const name = 'word/_rels/document.xml.rels';
        const xml = strFromU8(files[name]!);
        files[name] = strToU8(
          xml.replace(/<Relationship\b[^>]*Target="comments.xml"[^>]*\/>/, (declaration) =>
            declaration.replace('/>', `>${whitespace}</Relationship>`)
          )
        );
      }
      const parsed = readOoxmlPackage(zipSync(files));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const saved = writeOoxmlPackage(parsed.package);
      const output = unzipSync(saved);
      expect(!!output['word/comments.xml']).toBe(kind === 'nbsp');
      const reopened = readOoxmlPackage(saved);
      expect(reopened.ok).toBe(true);
      if (reopened.ok)
        expect(!!unzipSync(writeOoxmlPackage(reopened.package))['word/comments.xml']).toBe(
          kind === 'nbsp'
        );
    });
  }
}

test('canonical relationship-root NBSP prevents comment export cleanup', async () => {
  const { replaceChildren } = await import('../package/ooxml-edit.ts');
  const { withPart } = await import('../package/ooxml-package.ts');
  const pkg = loadCommentFixture({ body: '<w:p/>', comments: comments('') });
  const part = pkg.parts.get('/word/_rels/document.xml.rels')!;
  const children = Array.from(part.root.children);
  children.push({ kind: 'textValue', id: 'retained-whitespace', value: '\u00a0' });
  const replaced = replaceChildren(part, part.root.id, children);
  expect(replaced.ok).toBe(true);
  if (!replaced.ok) return;
  const changed = withPart(pkg, replaced.part);
  expect(commentExportPackage(changed)).toBe(changed);
});

for (const extended of [false, true]) {
  test(`comment export preserves companion relationship overrides${extended ? ' with extensions' : ''}`, () => {
    const populated = loadCommentFixture({ body: '<w:p/>', comments: comments(record) });
    const files = unzipSync(writeOoxmlPackage(populated));
    files['word/comments.xml'] = strToU8(comments(''));
    files['word/_rels/comments.xml.rels'] = strToU8(`<Relationships xmlns="${REL}"/>`);
    const extension = extended ? ' xmlns:x="urn:retained" x:keep="Retain"' : '';
    files['[Content_Types].xml'] = strToU8(
      strFromU8(files['[Content_Types].xml']!).replace(
        '</Types>',
        `<Override PartName="/word/_rels/comments.xml.rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"${extension}/></Types>`
      )
    );
    const parsed = readOoxmlPackage(zipSync(files));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(commentExportPackage(parsed.package)).toBe(parsed.package);
    const saved = writeOoxmlPackage(parsed.package);
    const output = unzipSync(saved);
    expect(output['word/comments.xml']).toBeDefined();
    expect(output['word/_rels/comments.xml.rels']).toBeDefined();
    expect(strFromU8(output['[Content_Types].xml']!)).toContain('/word/_rels/comments.xml.rels');
    if (extended) expect(strFromU8(output['[Content_Types].xml']!)).toContain('Retain');
    const reopened = readOoxmlPackage(saved);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const second = unzipSync(writeOoxmlPackage(reopened.package));
    expect(second['word/_rels/comments.xml.rels']).toEqual(output['word/_rels/comments.xml.rels']);
    expect(second['[Content_Types].xml']).toEqual(output['[Content_Types].xml']);
  });
}
