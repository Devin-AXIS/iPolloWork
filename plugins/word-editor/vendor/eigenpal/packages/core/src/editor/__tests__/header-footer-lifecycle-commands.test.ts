// Editor facade commands for header/footer lifecycle + page fields.
//
// create-on-edit, remove, link/unlink with active-scope rebind, furniture options,
// inherited state, field insertion, first-section refusal, undo/redo, and no partial
// mutation on rejection — all through Editor.exec (not store-only).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { resolveHeaderFooterResolutionBySection } from '../../store/package/hf-references.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

function build(options: {
  readonly references?: string;
  readonly secondSectPr?: string;
  readonly rels?: string;
  readonly headerParts?: Record<string, string>;
  readonly overrides?: string;
}): Uint8Array {
  const body =
    options.secondSectPr !== undefined
      ? `<w:p><w:pPr><w:sectPr>${options.references ?? ''}</w:sectPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p>` +
        '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
        `<w:sectPr>${options.secondSectPr}</w:sectPr>`
      : '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
        `<w:sectPr>${options.references ?? ''}</w:sectPr>`;
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (options.overrides ?? '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (options.rels) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${options.rels}</Relationships>`
    );
  }
  for (const [name, xml] of Object.entries(options.headerParts ?? {})) {
    entries[name] = strToU8(xml);
  }
  return zipSync(entries);
}

const HEADER_XML = (text: string): string =>
  `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:hdr>`;
const HEADER_OVERRIDE =
  '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>';

const blankDoc = (): Uint8Array => build({});
const inheritedDoc = (): Uint8Array =>
  build({
    references: '<w:headerReference w:type="default" r:id="rId7"/>',
    secondSectPr: '',
    rels: `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>`,
    headerParts: { 'word/header1.xml': HEADER_XML('SHARED') },
    overrides: HEADER_OVERRIDE,
  });

function mountEditor(bytes: Uint8Array) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({ document: bytes });
  editor.attach(host);
  return { editor, host };
}

async function savedPackage(editor: ReturnType<typeof createDocxEditor>) {
  const buffer = await editor.save();
  const result = readOoxmlPackage(new Uint8Array(buffer));
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

describe('Editor header/footer lifecycle commands', () => {
  test('editHeaderFooter creates a missing part then enters its rId', async () => {
    const { editor, host } = mountEditor(blankDoc());
    expect(editor.snapshot().scope).toEqual({ kind: 'body' });

    const opened = editor.exec({ type: 'editHeaderFooter', position: 'header' });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.changed).toBe(true);

    const scope = editor.getActiveScope();
    expect(scope.kind).toBe('headerFooter');
    if (scope.kind !== 'headerFooter') return;

    const state = editor.getHeaderFooterState();
    expect(state?.editing).toBe('header');
    expect(state?.sectionIndex).toBe(0);
    expect(state?.variant).toBe('default');
    expect(state?.rId).toBe(scope.rId);
    expect(state?.inherited).toBe(false);
    expect(state?.partName).toBeTruthy();

    const slot = resolveHeaderFooterResolutionBySection(await savedPackage(editor))[0]!.headers.get(
      'default'
    );
    expect(slot?.rId).toBe(scope.rId);
    expect(slot?.inherited).toBe(false);

    editor.destroy();
    host.remove();
  });

  test('typing into a created header keeps the caret after each character', () => {
    const { editor, host } = mountEditor(blankDoc());
    expect(editor.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);

    for (const character of ['a', 'b', 'c']) {
      expect(editor.exec({ type: 'insertText', text: character }).ok).toBe(true);
      // What a host does on every change, and what made this fail: reading the snapshot
      // lays the pending revision out. A header part counts its own revisions, so the
      // scope the keystroke scheduled used to be tagged BELOW the package revision and was
      // discarded as stale — the commit painted the previous revision, the post-edit caret
      // could not be written into pre-edit nodes, and this later pass read that stale DOM
      // caret back. Every character then landed at the start of the story.
      editor.snapshot();
    }

    expect(host.querySelector('[data-docx-hf-active]')?.textContent).toBe('abc');
    editor.destroy();
    host.remove();
  });

  test('editHeaderFooter firstPage create+titlePg undoes/redoes as one unit', async () => {
    const { editor, host } = mountEditor(blankDoc());
    expect(editor.exec({ type: 'editHeaderFooter', position: 'header', firstPage: true }).ok).toBe(
      true
    );
    expect(editor.getHeaderFooterState()?.variant).toBe('first');
    expect(editor.getHeaderFooterState()?.titlePage).toBe(true);
    expect(editor.exec({ type: 'exitHeaderFooter' }).ok).toBe(true);

    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    const undone = resolveHeaderFooterResolutionBySection(await savedPackage(editor))[0]!;
    expect(undone.headers.has('first')).toBe(false);
    expect(undone.titlePage).toBe(false);

    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    const redone = resolveHeaderFooterResolutionBySection(await savedPackage(editor))[0]!;
    expect(redone.headers.get('first')?.inherited).toBe(false);
    expect(redone.titlePage).toBe(true);
    editor.destroy();
    host.remove();
  });

  test('editHeaderFooter variant/evenPage opens even furniture atomically', async () => {
    const { editor, host } = mountEditor(blankDoc());
    expect(editor.can({ type: 'editHeaderFooter', position: 'footer', variant: 'even' }).ok).toBe(
      true
    );
    expect(editor.exec({ type: 'editHeaderFooter', position: 'footer', variant: 'even' }).ok).toBe(
      true
    );
    expect(editor.getHeaderFooterState()?.variant).toBe('even');
    expect(editor.getHeaderFooterState()?.evenAndOddHeaders).toBe(true);
    expect(editor.exec({ type: 'exitHeaderFooter' }).ok).toBe(true);

    // Legacy evenPage flag remains supported.
    const again = mountEditor(blankDoc());
    expect(
      again.editor.exec({ type: 'editHeaderFooter', position: 'header', evenPage: true }).ok
    ).toBe(true);
    expect(again.editor.getHeaderFooterState()?.variant).toBe('even');
    expect(again.editor.getHeaderFooterState()?.evenAndOddHeaders).toBe(true);
    again.editor.destroy();
    again.host.remove();

    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    const undone = resolveHeaderFooterResolutionBySection(await savedPackage(editor))[0]!;
    expect(undone.footers.has('even')).toBe(false);
    expect(undone.evenAndOddHeaders).toBe(false);
    editor.destroy();
    host.remove();
  });

  test('editHeaderFooter first variant on inherited section declares without stealing source', async () => {
    const { editor, host } = mountEditor(inheritedDoc());
    expect(
      editor.exec({
        type: 'editHeaderFooter',
        position: 'header',
        variant: 'first',
        sectionIndex: 1,
      }).ok
    ).toBe(true);
    const state = editor.getHeaderFooterState();
    expect(state?.sectionIndex).toBe(1);
    expect(state?.variant).toBe('first');
    expect(state?.inherited).toBe(false);
    expect(state?.titlePage).toBe(true);

    const pkg = await savedPackage(editor);
    const resolution = resolveHeaderFooterResolutionBySection(pkg);
    expect(resolution[0]!.headers.get('default')?.inherited).toBe(false);
    expect(resolution[0]!.titlePage).toBe(false);
    expect(resolution[1]!.headers.get('first')?.inherited).toBe(false);
    expect(resolution[1]!.titlePage).toBe(true);

    expect(editor.exec({ type: 'exitHeaderFooter' }).ok).toBe(true);
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    const undone = resolveHeaderFooterResolutionBySection(await savedPackage(editor));
    expect(undone[1]!.headers.has('first')).toBe(false);
    expect(undone[1]!.titlePage).toBe(false);
    expect(undone[0]!.headers.get('default')?.rId).toBe('rId7');
    editor.destroy();
    host.remove();
  });

  test('editHeaderFooter on an existing story does not allocate', () => {
    const { editor, host } = mountEditor(inheritedDoc());
    const opened = editor.exec({ type: 'editHeaderFooter', position: 'header' });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.changed).toBe(false);
    expect(editor.getActiveScope()).toEqual({ kind: 'headerFooter', rId: 'rId7' });
    expect(editor.getHeaderFooterState()?.inherited).toBe(false);
    editor.destroy();
    host.remove();
  });

  test('removeHeaderFooter deletes the open story and exits scope', async () => {
    const { editor, host } = mountEditor(inheritedDoc());
    expect(editor.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
    const removed = editor.exec({ type: 'removeHeaderFooter' });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.changed).toBe(true);
    expect(editor.getActiveScope()).toEqual({ kind: 'body' });
    expect(editor.getHeaderFooterState()).toBeNull();
    expect(
      resolveHeaderFooterResolutionBySection(await savedPackage(editor))[0]!.headers.size
    ).toBe(0);
    editor.destroy();
    host.remove();
  });

  test('first-section link is refused by can and exec with no mutation', async () => {
    const { editor, host } = mountEditor(inheritedDoc());
    expect(editor.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
    const before = new Uint8Array(await editor.save());

    const can = editor.can({ type: 'linkHeaderFooterToPrevious' });
    expect(can.ok).toBe(false);
    if (can.ok) return;
    expect(can.reason).toMatch(/first section/i);

    const linked = editor.exec({ type: 'linkHeaderFooterToPrevious' });
    expect(linked.ok).toBe(false);
    expect(new Uint8Array(await editor.save())).toEqual(before);
    expect(editor.getActiveScope()).toEqual({ kind: 'headerFooter', rId: 'rId7' });
    editor.destroy();
    host.remove();
  });

  test('unlink rebinds active scope to the clone; link rebinds to inherited', () => {
    const { editor, host } = mountEditor(inheritedDoc());
    expect(editor.exec({ type: 'editHeaderFooter', position: 'header', sectionIndex: 1 }).ok).toBe(
      true
    );
    expect(editor.getHeaderFooterState()?.inherited).toBe(true);
    expect(editor.getHeaderFooterState()?.sectionIndex).toBe(1);
    const inheritedRId = editor.getHeaderFooterState()?.rId;
    expect(inheritedRId).toBe('rId7');

    expect(editor.exec({ type: 'unlinkHeaderFooterFromPrevious' }).ok).toBe(true);
    const state = editor.getHeaderFooterState();
    expect(state?.inherited).toBe(false);
    expect(state?.rId).toBeTruthy();
    expect(state?.rId).not.toBe(inheritedRId);
    expect(editor.getActiveScope()).toEqual({ kind: 'headerFooter', rId: state!.rId! });

    expect(editor.exec({ type: 'linkHeaderFooterToPrevious' }).ok).toBe(true);
    expect(editor.getHeaderFooterState()?.inherited).toBe(true);
    expect(editor.getHeaderFooterState()?.rId).toBe('rId7');
    editor.destroy();
    host.remove();
  });

  test('setHeaderFooterOptions writes titlePg and reports it on state', () => {
    const { editor, host } = mountEditor(blankDoc());
    expect(editor.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
    expect(
      editor.exec({ type: 'setHeaderFooterOptions', sectionIndex: 0, titlePage: true }).ok
    ).toBe(true);
    expect(editor.getHeaderFooterState()?.titlePage).toBe(true);
    editor.destroy();
    host.remove();
  });

  test('insertPageField requires HF scope and inserts PAGE in one undo unit', async () => {
    const { editor, host } = mountEditor(blankDoc());
    expect(editor.can({ type: 'insertPageField', field: 'PAGE' }).ok).toBe(false);
    expect(editor.exec({ type: 'insertPageField', field: 'PAGE' }).ok).toBe(false);

    expect(editor.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
    const inserted = editor.exec({ type: 'insertPageField', field: 'PAGE' });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    expect(inserted.changed).toBe(true);

    const pkg = await savedPackage(editor);
    const headerPart = [...pkg.parts.values()].find((part) => part.name.includes('header'));
    expect(headerPart).toBeTruthy();
    const xml = JSON.stringify(headerPart);
    expect(xml).toContain('PAGE');
    expect(xml).toContain('fldChar');

    expect(editor.snapshot().canUndo).toBe(true);
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(editor.exec({ type: 'insertPageField', field: 'PAGE_X_OF_Y' }).ok).toBe(true);

    editor.destroy();
    host.remove();
  });

  test('lifecycle undo/redo restores package furniture via Editor.exec', async () => {
    const { editor, host } = mountEditor(blankDoc());
    expect(editor.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
    const rId = (editor.getActiveScope() as { rId: string }).rId;
    expect(editor.exec({ type: 'exitHeaderFooter' }).ok).toBe(true);

    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(
      resolveHeaderFooterResolutionBySection(await savedPackage(editor))[0]!.headers.size
    ).toBe(0);

    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(
      resolveHeaderFooterResolutionBySection(await savedPackage(editor))[0]!.headers.get('default')
        ?.rId
    ).toBe(rId);
    editor.destroy();
    host.remove();
  });

  test('rejected empty options leave package unchanged', async () => {
    const { editor, host } = mountEditor(inheritedDoc());
    const before = new Uint8Array(await editor.save());
    const empty = editor.exec({ type: 'setHeaderFooterOptions' });
    expect(empty.ok).toBe(false);
    expect(new Uint8Array(await editor.save())).toEqual(before);
    editor.destroy();
    host.remove();
  });

  test('getHeaderFooterState snapshots are reference-stable across identical ticks', () => {
    const { editor, host } = mountEditor(inheritedDoc());
    expect(editor.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
    const a = editor.getHeaderFooterState();
    const b = editor.getHeaderFooterState();
    expect(a).toBe(b);
    editor.destroy();
    host.remove();
  });
});
