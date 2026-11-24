// Every story's paragraphs are addressable before anyone opens that story.
//
// `w14:paraId` is minted when a story STORE opens, and only reaches the coordinator's package
// on the first commit. So a header nobody had clicked into carried none at all, and indexing
// the package copy verbatim left every one of its paragraphs unaddressable — `snapshot()` could
// not name them, and `exec({ setSelection, anchor })` answered `notFound`.
//
// The contract's own harness enters a story before asking anything, so it is structurally blind
// to this: entering is what mints the ids the assertion then finds.
//
// The id must also be the SAME one before and after opening. A durable anchor that changes
// under the caller is worse than none: it names a real paragraph, just not the one they meant.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { PART_OF_STORY, partOfNodeId, scopeOf } from './story-parity-harness.ts';
import { storyParityDocx, HEADER_R_ID, FOOTER_R_ID } from './story-parity-fixture.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { strToU8, zipSync } from 'fflate';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

/** Mount WITHOUT entering any story, which is the state this is about. */
function mountUntouched(): DocxEditorInstance {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({ document: storyParityDocx(), author: 'Parity' });
  cleanup = () => {
    editor.destroy();
    host.remove();
    document.getSelection()?.removeAllRanges();
  };
  editor.attach(host);
  return editor;
}

/** Every part the paraId index reaches, as zip entry names. */
function partsWithParaIds(editor: DocxEditorInstance): Set<string> {
  const parts = new Set<string>();
  for (const [nodeId] of editor.surface!.session.paragraphAnchors().paraIdByNode) {
    parts.add(partOfNodeId(nodeId));
  }
  return parts;
}

describe('a story nobody has opened is still addressable', () => {
  test('every story part carries paraIds on a fresh mount', () => {
    const editor = mountUntouched();
    const reached = partsWithParaIds(editor);
    for (const part of Object.values(PART_OF_STORY)) {
      expect(reached.has(part), `${part} has no addressable paragraph`).toBe(true);
    }
  });

  test('the paraId does not change when the story is opened', () => {
    const editor = mountUntouched();
    const surface = editor.surface!;

    const before = new Map(
      [...surface.session.paragraphAnchors().paraIdByNode].filter(
        ([nodeId]) => partOfNodeId(nodeId) === PART_OF_STORY.header
      )
    );
    expect(before.size, 'the header contributed no paraIds').toBeGreaterThan(0);

    expect(surface.enterHeaderFooter({ rId: HEADER_R_ID })).toBe(true);
    const after = surface.session.paragraphAnchors().paraIdByNode;
    for (const [nodeId, paraId] of before) {
      // Minting is deterministic and seeded by the structural node id, so the read-side value
      // and the store's are the same value — which is the whole reason an anchor taken before
      // the story opened still names the paragraph the caller meant.
      expect(after.get(nodeId), `${nodeId} was re-minted on open`).toBe(paraId);
    }
  });

  test('an anchor taken before entry selects into the story', () => {
    const editor = mountUntouched();
    const surface = editor.surface!;

    const [nodeId, paraId] = [...surface.session.paragraphAnchors().paraIdByNode].find(
      ([id]) => partOfNodeId(id) === PART_OF_STORY.footer
    )!;
    const result = editor.exec({ type: 'setSelection', anchor: { paraId } });
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);

    // The scope followed the anchor, so the next keystroke lands in the footer rather than
    // in a store that has never heard of this paragraph.
    expect(surface.activeScope()).toEqual(scopeOf('footer'));
    expect(surface.state().selection.head.paragraphId).toBe(nodeId);
  });
});

// A header whose ids are exactly the cases minting has to repair: a DUPLICATE pair, one out of
// range, one missing, and the reserved zero. These are the shapes where a read-side mint and the
// store's could diverge — and a paraId that changes when the reader clicks into the story names
// a real paragraph, just not the one the caller meant.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const AWKWARD_R_ID = 'rId10';

function awkwardIdsDocx(): Uint8Array {
  const header =
    `<w:hdr xmlns:w="${W}" xmlns:w14="${W14}">` +
    // `AAAAAAAA` is above the legal range, and it appears twice.
    '<w:p w14:paraId="AAAAAAAA"><w:r><w:t>One</w:t></w:r></w:p>' +
    '<w:p w14:paraId="AAAAAAAA"><w:r><w:t>Two</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Three</w:t></w:r></w:p>' +
    '<w:p w14:paraId="00000000"><w:r><w:t>Four</w:t></w:r></w:p>' +
    '</w:hdr>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.' +
        'relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="${AWKWARD_R_ID}" Type="${R}/header" Target="header1.xml"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(header),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p>` +
        `<w:sectPr><w:headerReference w:type="default" r:id="${AWKWARD_R_ID}"/></w:sectPr>` +
        '</w:body></w:document>'
    ),
  });
}

describe('a read-side mint is the mint the store will make', () => {
  test('duplicate, out-of-range, missing and zero ids all survive opening unchanged', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createDocxEditor({ document: awkwardIdsDocx(), author: 'Parity' });
    cleanup = () => {
      editor.destroy();
      host.remove();
      document.getSelection()?.removeAllRanges();
    };
    editor.attach(host);
    const surface = editor.surface!;

    const headerIds = (): Map<string, string> =>
      new Map(
        [...surface.session.paragraphAnchors().paraIdByNode].filter(
          ([nodeId]) => partOfNodeId(nodeId) === PART_OF_STORY.header
        )
      );

    const before = headerIds();
    expect(before.size, 'the header contributed no paraIds').toBe(4);
    // Repaired, not preserved: `AAAAAAAA` is above the legal range and appears twice, and the
    // reserved zero is never a real id.
    expect([...before.values()]).not.toContain('AAAAAAAA');
    expect([...before.values()]).not.toContain('00000000');
    expect(new Set(before.values()).size, 'the repair minted a duplicate').toBe(4);

    expect(surface.enterHeaderFooter({ rId: AWKWARD_R_ID })).toBe(true);
    expect(headerIds()).toEqual(before);
  });
});

/** The same paraId on a body paragraph and a header paragraph, which an authored file may do. */
const TWIN_PARA_ID = '4C000001';

function twinIdDocx(): Uint8Array {
  const para = (text: string): string =>
    `<w:p w14:paraId="${TWIN_PARA_ID}" w14:textId="${TWIN_PARA_ID}">` +
    `<w:r><w:t>${text}</w:t></w:r></w:p>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.' +
        'relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="${AWKWARD_R_ID}" Type="${R}/header" Target="header1.xml"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}" xmlns:w14="${W14}">${para('Header')}</w:hdr>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}" xmlns:r="${R}"><w:body>${para('Body')}` +
        `<w:sectPr><w:headerReference w:type="default" r:id="${AWKWARD_R_ID}"/></w:sectPr>` +
        '</w:body></w:document>'
    ),
  });
}

describe('a paraId two stories claim is refused through the facade', () => {
  test('setSelection by a clashing paraId does not land in the body twin', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createDocxEditor({ document: twinIdDocx(), author: 'Parity' });
    cleanup = () => {
      editor.destroy();
      host.remove();
      document.getSelection()?.removeAllRanges();
    };
    editor.attach(host);
    const surface = editor.surface!;

    const anchors = surface.session.paragraphAnchors();
    expect([...anchors.ambiguousParaIds], 'the fixture does not clash').toEqual([TWIN_PARA_ID]);

    // This is the shape production uses: `exec` resolves against the MAIN part. Preferring the
    // caller's own part therefore could only ever pick the body twin — so an automation caller
    // holding the HEADER paragraph's paraId would be told `ok` with the caret in the body, and
    // its next write would go to the wrong story. Refusing is the visible failure.
    const result = editor.exec({ type: 'setSelection', anchor: { paraId: TWIN_PARA_ID } });
    expect(result.ok, 'a clashing paraId resolved instead of refusing').toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ambiguous');
    // And nothing moved: the caret is where it started, in the body.
    expect(surface.activeScope()).toEqual({ kind: 'body' });
  });
});
