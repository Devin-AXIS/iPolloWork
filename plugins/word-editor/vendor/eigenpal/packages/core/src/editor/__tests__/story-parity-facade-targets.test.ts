// The facade answers about the whole document, and its writes report what they did.
//
// Every case here is a read that the caret reaches happily and an API form does not, which is
// the worst shape this class takes: two members of one lane describe different documents, and
// a caller has no way to tell which one is lying.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { STORY_KINDS } from './story-parity-contract.ts';
import { CONTROL_TAG, CONTROL_TEXT } from './story-parity-fixture.ts';
import { caretInControl, openStory } from './story-parity-harness.ts';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { paragraphFragmentsOfBlocks } from '@docx-editor.dev/core/layout';

describe('the contentControls query covers every story', () => {
  test('the list holds one control per story, whatever the caret is in', () => {
    const open = openStory('body');
    try {
      const tags = open.editor
        .query({ type: 'contentControls' })
        .map((summary) => summary.tag)
        .sort();
      // Reading only the body reported a four-fifths-empty document, and its sibling
      // `contentControlAt` reached each story's own control — so the two disagreed.
      expect(tags).toEqual([...Object.values(CONTROL_TAG)].sort());
    } finally {
      open.destroy();
    }
  });

  for (const story of STORY_KINDS) {
    test(`${story}: the list contains the control the caret is standing in`, () => {
      const open = openStory(story);
      try {
        caretInControl(open);
        const at = open.editor.query({ type: 'contentControlAt' });
        expect(at, 'no control at a caret inside one').not.toBeNull();
        const listed = open.editor
          .query({ type: 'contentControls' })
          .some((summary) => summary.id === at!.id);
        expect(listed, 'the caret’s own control is missing from the list').toBe(true);
      } finally {
        open.destroy();
      }
    });
  }
});

describe('a control in any story is addressable by paraId', () => {
  for (const story of STORY_KINDS) {
    test(`${story}: the paraId the snapshot reports resolves to the control`, () => {
      const open = openStory(story);
      try {
        caretInControl(open);
        const anchor = open.editor.snapshot().selection?.from;
        expect(anchor, 'the snapshot published no anchor').toBeDefined();

        // `DocAnchor` is the only non-caret way to name a control. Resolving it against the
        // body reported `paragraph 'X' was not found` for a paragraph the same index had
        // just resolved — a false claim about the document, from one lane about itself.
        const can = open.editor.can({
          type: 'setContentControlValue',
          target: anchor!,
          value: 'Replaced',
        });
        expect(can.ok, can.ok ? '' : can.reason).toBe(true);
      } finally {
        open.destroy();
      }
    });

    test(`${story}: a successful write reports changed`, () => {
      const open = openStory(story);
      try {
        caretInControl(open);
        const result = open.editor.exec({ type: 'setContentControlValue', value: 'Replaced' });
        expect(result.ok, result.ok ? '' : result.reason).toBe(true);
        // `session.revision()` is the BODY store's clock, and every other story counts its
        // own — so a successful header write compared equal and claimed to be a no-op.
        expect(result.ok && result.changed, 'a real write reported changed: false').toBe(true);
        // `changed` must not be vacuously true: the control really holds the new text.
        expect(open.editor.query({ type: 'contentControlAt' })?.text).not.toBe(CONTROL_TEXT);
      } finally {
        open.destroy();
      }
    });
  }
});

describe('setSelection across two notes of one kind', () => {
  test('selects across them in one note story, and never half-applies an edit', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createDocxEditor({ document: twoFootnoteDocx(), author: 'Parity' });
    try {
      editor.attach(host);
      const surface = editor.surface!;
      expect(surface.enterNote('footnote:1')).toBe(true);

      const anchors = surface.session.paragraphAnchors();
      // The painted layout is what knows which note a paragraph is in — the same read the
      // production path uses. A map order would be fragile; the note's own scopeId is not.
      const firstParagraphOf = (scopeId: string): string => {
        for (const page of surface.layout().pages) {
          for (const note of page.footnotes?.notes ?? []) {
            if (note.scopeId !== scopeId) continue;
            const [fragment] = paragraphFragmentsOfBlocks(note.fragments);
            if (fragment) return fragment.paragraphId;
          }
        }
        throw new Error(`no laid-out paragraph for ${scopeId}`);
      };

      // `StoryScope` answers `notesPart/footnote` for EVERY footnote. The footnotes part is one
      // story (ECMA-376 Part 1 §17.11, issue #2010), so the range is accepted and the head's note opens. What the old
      // refusal protected against — typing that deleted neither endpoint and landed in the
      // wrong note — is refused at the write instead, with both notes left whole.
      const result = editor.exec({
        type: 'setSelection',
        range: {
          from: { paraId: anchors.paraIdByNode.get(firstParagraphOf('footnote:1'))! },
          to: { paraId: anchors.paraIdByNode.get(firstParagraphOf('footnote:2'))! },
        },
      });
      expect(result.ok, result.ok ? '' : result.reason).toBe(true);
      expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:2' });
      const { anchor, head } = surface.state().selection;
      expect(anchor.paragraphId).toBe(firstParagraphOf('footnote:1'));
      expect(head.paragraphId).toBe(firstParagraphOf('footnote:2'));
      const before = surface.session.storyText({ kind: 'notesPart', noteKind: 'footnote' });
      expect(editor.exec({ type: 'insertText', text: 'x' }).ok).toBe(false);
      expect(surface.session.storyText({ kind: 'notesPart', noteKind: 'footnote' })).toBe(before);
    } finally {
      editor.destroy();
      host.remove();
      document.getSelection()?.removeAllRanges();
    }
  });
});

/** Two footnotes in one notes part — the shape a scope comparison cannot tell apart. */
function twoFootnoteDocx(): Uint8Array {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const para = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.' +
        'relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId20" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        '</Relationships>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">` +
        '<w:footnote w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p>' +
        '</w:footnote>' +
        `<w:footnote w:id="1">${para('NoteOne')}</w:footnote>` +
        `<w:footnote w:id="2">${para('NoteTwo')}</w:footnote></w:footnotes>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        `<w:p><w:r><w:t>Body</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r>` +
        '<w:r><w:footnoteReference w:id="2"/></w:r></w:p>' +
        '<w:sectPr/></w:body></w:document>'
    ),
  });
}
