// One user action that writes several parts is ONE transaction.
//
// A comment write touches the story, `comments.xml`, `commentsExtended.xml`, the relationship
// part and the content types. Applying that as five part-scoped transactions would publish five
// `ModelChange`s and five undo entries for one intent, and would leave the package inconsistent
// in between — a story referencing a comment part that does not exist yet.
//
// The rule this file pins down is the one the part-level transaction already states, lifted a
// level: nothing escapes between the unvalidated intermediate and the validated result.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TreeDocumentStore,
  readOoxmlPackage,
  readOoxmlPart,
  relationshipsOf,
  resolveContentTypeOf,
  withContentTypeOverride,
  withNewPart,
  withPart,
  withRelationship,
  writeOoxmlPackage,
  validatePackageInvariants,
  type OoxmlPackage,
  type OoxmlPart,
} from '../index.ts';
import { PackageEditRefusal } from '../store/package-edit-refusal.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const FIXTURE = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);
const COMMENTS_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';

function fixture(): OoxmlPackage {
  const pkg = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
  if (!pkg.ok) throw new Error(pkg.reason);
  return pkg.package;
}

function part(name: string, xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function storyOf(pkg: OoxmlPackage): OoxmlPart {
  const story = pkg.parts.get(pkg.mainDocumentPart);
  if (!story) throw new Error('no main document part');
  return story;
}

function firstParagraphId(story: OoxmlPart): string {
  const body = story.root.children.find((child) => child.kind === 'body');
  if (!body || body.kind === 'textValue') throw new Error('no body');
  const paragraph = body.children.find((child) => child.kind === 'paragraph');
  if (!paragraph) throw new Error('no paragraph');
  return paragraph.id;
}

describe('package primitives are pure', () => {
  test('adding a part leaves the original package untouched', () => {
    const before = fixture();
    const partCount = before.parts.size;
    const added = withNewPart(
      before,
      '/word/commentsExtended.xml',
      part('/word/commentsExtended.xml', `<w:x xmlns:w="${W}"/>`).root,
      'application/xml'
    );
    expect(before.parts.size).toBe(partCount);
    expect(added.parts.size).toBe(partCount + 1);
    expect(added.parts.get('/word/commentsExtended.xml')).toBeDefined();
  });

  test('a new part gains a content-type override, so the package stays openable', () => {
    const added = withNewPart(
      fixture(),
      '/word/commentsExtended.xml',
      part('/word/commentsExtended.xml', `<w:x xmlns:w="${W}"/>`).root,
      COMMENTS_TYPE
    );
    expect(resolveContentTypeOf(added, '/word/commentsExtended.xml')).toBe(COMMENTS_TYPE);
    // And the override reaches the written package, not just the in-memory index.
    const reread = readOoxmlPackage(writeOoxmlPackage(added));
    expect(reread.ok).toBe(true);
    if (reread.ok) {
      expect(resolveContentTypeOf(reread.package, '/word/commentsExtended.xml')).toBe(
        COMMENTS_TYPE
      );
    }
  });

  test('adding a relationship mints an id that is unused in that owner', () => {
    const before = fixture();
    const existing = relationshipsOf(before, before.mainDocumentPart).map((rel) => rel.id);
    const { pkg, relationshipId } = withRelationship(
      before,
      before.mainDocumentPart,
      COMMENTS_REL,
      'commentsExtended.xml'
    );
    expect(existing).not.toContain(relationshipId);
    const after = relationshipsOf(pkg, pkg.mainDocumentPart);
    expect(after.map((rel) => rel.id)).toContain(relationshipId);
    expect(after.find((rel) => rel.id === relationshipId)?.rawTarget).toBe('commentsExtended.xml');
  });

  test('a relationship survives a write and reopen', () => {
    const { pkg } = withRelationship(
      fixture(),
      '/word/document.xml',
      COMMENTS_REL,
      'commentsExtended.xml'
    );
    const reread = readOoxmlPackage(writeOoxmlPackage(pkg));
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    expect(
      relationshipsOf(reread.package, '/word/document.xml').some(
        (rel) => rel.rawTarget === 'commentsExtended.xml'
      )
    ).toBe(true);
  });

  test('an unedited package writes and reopens with the same parts', () => {
    const before = fixture();
    const reread = readOoxmlPackage(writeOoxmlPackage(before));
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    expect([...reread.package.parts.keys()].sort()).toEqual([...before.parts.keys()].sort());
  });
});

describe('package invariants', () => {
  test('a package whose relationship points nowhere is refused', () => {
    const { pkg } = withRelationship(
      fixture(),
      '/word/document.xml',
      COMMENTS_REL,
      'nothing-here.xml'
    );
    const result = validatePackageInvariants(pkg);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe('dangling-relationship');
  });

  test('a part whose extension has no Default is refused', () => {
    // An `.xml` part is already typed by the package's `Default Extension="xml"`, which is
    // correct OPC behaviour, so the invariant only bites where nothing declares a type at all.
    const naive = withPart(fixture(), part('/word/embedded.custom', `<w:x xmlns:w="${W}"/>`));
    const result = validatePackageInvariants(naive);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe('missing-content-type');
  });

  test('a new part gets its SPECIFIC type, not the xml default it would have inherited', () => {
    // The `.xml` default would satisfy the invariant while leaving the part typed
    // `application/xml`. Word reads the comment part by content type, so inheriting the
    // default produces a package that opens and has no comments in it.
    const before = fixture();
    const naive = withPart(before, part('/word/commentsExtended.xml', `<w:x xmlns:w="${W}"/>`));
    expect(resolveContentTypeOf(naive, '/word/commentsExtended.xml')).not.toBe(COMMENTS_TYPE);

    const proper = withNewPart(
      before,
      '/word/commentsExtended.xml',
      part('/word/commentsExtended.xml', `<w:x xmlns:w="${W}"/>`).root,
      COMMENTS_TYPE
    );
    expect(resolveContentTypeOf(proper, '/word/commentsExtended.xml')).toBe(COMMENTS_TYPE);
  });

  test('the fixture as authored satisfies both', () => {
    expect(validatePackageInvariants(fixture()).ok).toBe(true);
  });
});

describe('the store commits many parts as one transaction', () => {
  test('it still exposes the story part, so every existing caller is unchanged', () => {
    const pkg = fixture();
    const store = new TreeDocumentStore(pkg, pkg.mainDocumentPart);
    expect(store.part.name).toBe(pkg.mainDocumentPart);
    expect(store.package.parts.size).toBe(pkg.parts.size);
  });

  test('a part-only transaction publishes one change and one undo entry', () => {
    const pkg = fixture();
    const store = new TreeDocumentStore(pkg, pkg.mainDocumentPart);
    const paragraphId = firstParagraphId(store.part);
    const changes: number[] = [];
    store.subscribe((change) => changes.push(change.toRevision));

    const result = store.transact((ctx) => {
      ctx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'Hi ' });
    });
    expect(result.ok).toBe(true);
    expect(changes).toHaveLength(1);
    expect(store.historyDepth).toBe(1);
  });

  test('a write spanning three parts is still one change and one undo entry', () => {
    const pkg = fixture();
    const store = new TreeDocumentStore(pkg, pkg.mainDocumentPart);
    const paragraphId = firstParagraphId(store.part);
    const changes: number[] = [];
    store.subscribe((change) => changes.push(change.toRevision));

    const result = store.transact((ctx) => {
      ctx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'X' });
      ctx.applyPackage((current) =>
        withNewPart(
          current,
          '/word/commentsExtended.xml',
          part('/word/commentsExtended.xml', `<w:x xmlns:w="${W}"/>`).root,
          COMMENTS_TYPE
        )
      );
      ctx.applyPackage(
        (current) =>
          withRelationship(current, '/word/document.xml', COMMENTS_REL, 'commentsExtended.xml').pkg
      );
    });

    expect(result.ok).toBe(true);
    expect(changes).toHaveLength(1);
    expect(store.historyDepth).toBe(1);
    expect(store.package.parts.get('/word/commentsExtended.xml')).toBeDefined();
    expect(
      relationshipsOf(store.package, '/word/document.xml').some(
        (rel) => rel.rawTarget === 'commentsExtended.xml'
      )
    ).toBe(true);
  });

  test('a refusing package edit refuses the whole transaction as package-changed', () => {
    const pkg = fixture();
    const store = new TreeDocumentStore(pkg, pkg.mainDocumentPart);
    const paragraphId = firstParagraphId(store.part);
    const changes: number[] = [];
    store.subscribe((change) => changes.push(change.toRevision));

    const result = store.transact((ctx) => {
      ctx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'X' });
      expect(
        ctx.applyPackage(() => {
          throw new PackageEditRefusal('allocation moved');
        })
      ).toBe(false);
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'package-changed',
      detail: 'allocation moved',
    });
    expect(store.package).toBe(pkg);
    expect(changes).toHaveLength(0);
    expect(store.historyDepth).toBe(0);
  });

  test('a refusing package edit can name its own reason', () => {
    const pkg = fixture();
    const store = new TreeDocumentStore(pkg, pkg.mainDocumentPart);
    const result = store.transact((ctx) => {
      ctx.applyPackage(() => {
        throw new PackageEditRefusal('cannot number this paragraph', 'locked');
      });
    });
    expect(result).toMatchObject({ ok: false, reason: 'locked' });
    expect(store.package).toBe(pkg);
  });

  test('any other throw from a package edit still escapes', () => {
    const pkg = fixture();
    const store = new TreeDocumentStore(pkg, pkg.mainDocumentPart);
    expect(() =>
      store.transact((ctx) => {
        ctx.applyPackage(() => {
          throw new Error('bug');
        });
      })
    ).toThrow('bug');
    expect(store.package).toBe(pkg);
  });

  test('one undo reverses every part the transaction touched', () => {
    const pkg = fixture();
    const store = new TreeDocumentStore(pkg, pkg.mainDocumentPart);
    const paragraphId = firstParagraphId(store.part);
    const partsBefore = store.package.parts.size;

    store.transact((ctx) => {
      ctx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'X' });
      ctx.applyPackage((current) =>
        withNewPart(
          current,
          '/word/commentsExtended.xml',
          part('/word/commentsExtended.xml', `<w:x xmlns:w="${W}"/>`).root,
          COMMENTS_TYPE
        )
      );
    });
    expect(store.package.parts.size).toBe(partsBefore + 1);

    store.undo();
    expect(store.package.parts.size).toBe(partsBefore);
    expect(store.package.parts.get('/word/commentsExtended.xml')).toBeUndefined();
  });

  test('a failure anywhere abandons the whole transaction, leaving no part changed', () => {
    const pkg = fixture();
    const store = new TreeDocumentStore(pkg, pkg.mainDocumentPart);
    const paragraphId = firstParagraphId(store.part);
    const before = store.package;

    const result = store.transact((ctx) => {
      ctx.applyPackage((current) =>
        withNewPart(
          current,
          '/word/commentsExtended.xml',
          part('/word/commentsExtended.xml', `<w:x xmlns:w="${W}"/>`).root,
          COMMENTS_TYPE
        )
      );
      // Out of range: the part-level op refuses, and the package edit above must not survive.
      ctx.apply({ op: 'insertText', paragraphId, offset: 99_999, text: 'nope' });
    });

    expect(result.ok).toBe(false);
    expect(store.package).toBe(before);
    expect(store.package.parts.get('/word/commentsExtended.xml')).toBeUndefined();
    expect(store.historyDepth).toBe(0);
  });

  test('a transaction that breaks a package invariant is refused, not published', () => {
    // A relationship to a part nobody created: exactly the half-written state that splitting
    // the write across transactions would leave behind.
    const pkg = fixture();
    const store = new TreeDocumentStore(pkg, pkg.mainDocumentPart);
    const before = store.package;

    const result = store.transact((ctx) => {
      ctx.applyPackage(
        (current) =>
          withRelationship(current, '/word/document.xml', COMMENTS_REL, 'never-written.xml').pkg
      );
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('package-invariant');
    expect(store.package).toBe(before);
  });

  test('an edit to a non-story part goes through applyTo', () => {
    const pkg = fixture();
    const store = new TreeDocumentStore(pkg, pkg.mainDocumentPart);
    const comments = store.package.parts.get('/word/comments.xml');
    expect(comments).toBeDefined();
    if (!comments) return;
    const body = comments.root.children.find((child) => child.kind === 'comment');
    expect(body).toBeDefined();
    if (!body || body.kind === 'textValue') return;
    const paragraph = body.children.find((child) => child.kind === 'paragraph');
    expect(paragraph).toBeDefined();
    if (!paragraph) return;

    const result = store.transact((ctx) => {
      ctx.applyTo('/word/comments.xml', {
        op: 'insertText',
        paragraphId: paragraph.id,
        offset: 0,
        text: 'Edited: ',
      });
    });
    expect(result.ok).toBe(true);
    expect(store.part.name).toBe(pkg.mainDocumentPart);
    const edited = store.package.parts.get('/word/comments.xml');
    expect(edited).not.toBe(comments);
  });

  test('a single-part construction still works, so existing callers are unaffected', () => {
    const story = storyOf(fixture());
    const store = new TreeDocumentStore(story);
    expect(store.part).toBe(story);
    const result = store.transact((ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: firstParagraphId(story), offset: 0, text: 'A' });
    });
    expect(result.ok).toBe(true);
  });
});

describe('content types are edited as a tree, not regenerated', () => {
  test('adding an override leaves every other override authored as it was', () => {
    const before = fixture();
    const overridesBefore = before.contentTypes.overrides.size;
    const after = withContentTypeOverride(before, '/word/commentsExtended.xml', COMMENTS_TYPE);
    expect(after.contentTypes.overrides.size).toBe(overridesBefore + 1);
    const reread = readOoxmlPackage(writeOoxmlPackage(after));
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    // Every override the file already had still resolves to what it resolved to before.
    for (const [name, mime] of before.contentTypes.overrides) {
      expect(reread.package.contentTypes.overrides.get(name)).toBe(mime);
    }
  });
});
