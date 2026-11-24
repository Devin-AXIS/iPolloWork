// Collapsed selection and same-paragraph reads use direct para-id lookup; cross-paragraph
// ranges still use the complete anchor index oracle.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { nodeIndexTestRecorder } from '../../store/package/ooxml-edit.ts';
import { selectionRangeOf } from '../docx-editor-derive.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import type { DocRange } from '../../contracts/editor.ts';
import type { PaginatedSurface } from '../paginated-surface-contract.ts';
import { STORY_KINDS } from './story-parity-contract.ts';
import { PROBE, storyParityDocx } from './story-parity-fixture.ts';
import { caretIn, openStory } from './story-parity-harness.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function docxFromBody(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function mountUntouched(): DocxEditorInstance {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({ document: storyParityDocx(), author: 'Parity' });
  editor.attach(host);
  return editor;
}

function selectionRangeOracle(surface: PaginatedSurface): DocRange | null {
  const { anchor, head } = surface.state().selection;
  const anchors = surface.session.paragraphAnchors();
  const anchorParaId = anchors.paraIdByNode.get(anchor.paragraphId);
  const headParaId = anchors.paraIdByNode.get(head.paragraphId);
  if (anchorParaId === undefined || headParaId === undefined) return null;
  const anchorOrdinal = anchors.ordinalByNode.get(anchor.paragraphId) ?? 0;
  const headOrdinal = anchors.ordinalByNode.get(head.paragraphId) ?? 0;
  const reversed =
    headOrdinal < anchorOrdinal || (headOrdinal === anchorOrdinal && head.offset < anchor.offset);
  return reversed
    ? { from: { paraId: headParaId }, to: { paraId: anchorParaId } }
    : { from: { paraId: anchorParaId }, to: { paraId: headParaId } };
}

const WARM_SIZES = [320, 2_560, 12_700] as const;

function loadScaleDocument(paragraphCount: number): Uint8Array {
  const body = Array.from({ length: paragraphCount }, (_, index) =>
    para(`paragraph ${index}`)
  ).join('');
  return docxFromBody(body);
}

describe('direct paraIdOf warm path', () => {
  for (const size of WARM_SIZES) {
    test(`${size} paragraphs: warm insertText performs zero complete index builds`, () => {
      const recorder = nodeIndexTestRecorder();
      recorder.reset();
      const container = document.createElement('div');
      document.body.append(container);
      const opened = mountPaginatedSurface(container, loadScaleDocument(size), { scale: 1 });
      if (!opened.ok) throw new Error(opened.reason);
      const surface = opened.surface;
      try {
        const paragraphId = surface.session.paragraphIds()[Math.floor(size / 2)]!;
        expect(surface.session.paraIdOf(paragraphId)).toMatch(/^[0-9A-F]{8}$/);
        expect(recorder.completeBuilds).toBeGreaterThan(0);
        recorder.reset();
        surface.session.applyTreeOps([{ op: 'insertText', paragraphId, offset: 0, text: 'x' }]);
        expect(surface.session.paraIdOf(paragraphId)).toMatch(/^[0-9A-F]{8}$/);
        expect(recorder.completeBuilds).toBe(0);
        expect(recorder.completeVisits).toBe(0);
      } finally {
        surface.destroy();
        container.remove();
      }
    });
  }
});

describe('paragraph anchor hot path', () => {
  test('collapsed body caret resolves through session.paraIdOf', () => {
    const open = openStory('body');
    try {
      const paragraphId = open.paragraphIds[0]!;
      open.surface.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 0 },
      });
      const range = selectionRangeOf(open.surface);
      expect(range).not.toBeNull();
      expect(range!.from.paraId).toBe(range!.to.paraId);
      expect(open.surface.session.paraIdOf(paragraphId)).toBe(range!.from.paraId);
    } finally {
      open.destroy();
    }
  });

  test('cross-paragraph forward and reversed ranges match the complete index oracle', () => {
    const open = openStory('body');
    try {
      const [first, second] = open.paragraphIds;
      open.surface.setSelection({
        anchor: { paragraphId: first!, offset: 0 },
        head: { paragraphId: second!, offset: 2 },
      });
      expect(selectionRangeOf(open.surface)).toEqual(selectionRangeOracle(open.surface));

      open.surface.setSelection({
        anchor: { paragraphId: second!, offset: 2 },
        head: { paragraphId: first!, offset: 0 },
      });
      expect(selectionRangeOf(open.surface)).toEqual(selectionRangeOracle(open.surface));
    } finally {
      open.destroy();
    }
  });

  for (const story of STORY_KINDS) {
    test(`${story} collapsed caret matches oracle`, () => {
      const open = openStory(story);
      try {
        caretIn(open, PROBE.plain);
        expect(selectionRangeOf(open.surface)).toEqual(selectionRangeOracle(open.surface));
      } finally {
        open.destroy();
      }
    });
  }

  test('unopened header paraId resolves through direct lookup', () => {
    const editor = mountUntouched();
    const host = document.body.lastElementChild as HTMLElement;
    try {
      const surface = editor.surface!;
      const headerParagraph = [...surface.session.paragraphAnchors().paraIdByNode].find(
        ([nodeId]) => nodeId.includes('header1.xml')
      );
      expect(headerParagraph).toBeTruthy();
      const [nodeId, paraId] = headerParagraph!;
      expect(surface.session.paraIdOf(nodeId)).toBe(paraId);
      surface.setSelection({
        anchor: { paragraphId: nodeId, offset: 0 },
        head: { paragraphId: nodeId, offset: 0 },
      });
      expect(selectionRangeOf(surface)).toEqual({
        from: { paraId },
        to: { paraId },
      });
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  test('invalid node ids answer null on direct lookup', () => {
    const editor = createDocxEditor({ document: storyParityDocx(), author: 'Parity' });
    const host = document.createElement('div');
    document.body.append(host);
    editor.attach(host);
    try {
      expect(editor.surface!.session.paraIdOf('/word/document.xml#nope')).toBeNull();
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});

describe('direct paraId lookup on a fresh document', () => {
  test('body paragraphs resolve without building the complete index first', () => {
    const bytes = docxFromBody(`${para('one')}${para('two')}`);
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createDocxEditor({ document: bytes, author: 'Test' });
    editor.attach(host);
    try {
      const [first, second] = editor.surface!.session.paragraphIds();
      expect(editor.surface!.session.paraIdOf(first!)).toMatch(/^[0-9A-F]{8}$/);
      expect(editor.surface!.session.paraIdOf(second!)).toMatch(/^[0-9A-F]{8}$/);
      expect(editor.surface!.session.paraIdOf('/word/document.xml#missing')).toBeNull();
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});
