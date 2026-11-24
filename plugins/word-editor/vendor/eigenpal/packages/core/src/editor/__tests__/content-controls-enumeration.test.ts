import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import type { ContentControlSummary } from '../../contracts/document.ts';
import { contentControlEnumerationTestRecorder, contentControlsOf } from '../content-controls.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const WARM_SIZES = [320, 2_560, 12_700] as const;

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const sdt = (pr: string, content: string) =>
  `<w:sdt><w:sdtPr>${pr}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

function docxFromBody(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(
      `<w:numbering xmlns:w="${W}">` +
        `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>` +
        `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>` +
        `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function loadHostileControlDocument(
  paragraphCount: number,
  controlCount: number,
  tocCount: number
): Uint8Array {
  const blocks: string[] = [];
  const tocSdt = `<w:sdt><w:sdtPr><w:docPartObj/></w:sdtPr><w:sdtContent>${para('Entry')}</w:sdtContent></w:sdt>`;
  const controlStride = Math.max(1, Math.floor(paragraphCount / Math.max(controlCount, 1)));
  let controlsPlaced = 0;
  let tocsPlaced = 0;
  for (let index = 0; index < paragraphCount; index += 1) {
    if (tocsPlaced < tocCount && index % controlStride === 0) {
      blocks.push(tocSdt);
      tocsPlaced += 1;
      controlsPlaced += 1;
      continue;
    }
    if (controlsPlaced < controlCount && index % controlStride === 1) {
      const tag = `ctl-${controlsPlaced}`;
      blocks.push(sdt(`<w:tag w:val="${tag}"/><w:alias w:val="${tag}"/>`, para(`block ${tag}`)));
      controlsPlaced += 1;
      continue;
    }
    blocks.push(para(`paragraph ${index}`));
  }
  return docxFromBody(blocks.join(''));
}

describe('contentControls enumeration cache', () => {
  test('returns frozen summaries that cannot be mutated by consumers', () => {
    const body = sdt('<w:tag w:val="frozen"/>', para('one'));
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docxFromBody(body), { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    try {
      const summaries = contentControlsOf(opened.surface);
      expect(Object.isFrozen(summaries)).toBe(true);
      expect(Object.isFrozen(summaries[0]!)).toBe(true);
      expect(() => {
        (summaries as ContentControlSummary[]).push({
          id: 'x',
          controlType: 'richText',
        });
      }).toThrow();
    } finally {
      opened.surface.destroy();
      container.remove();
    }
  });

  for (const size of WARM_SIZES) {
    test(
      `${size} paragraphs: warm text edits reuse enumeration cache with zero traversals`,
      () => {
        const recorder = contentControlEnumerationTestRecorder();
        recorder.reset();
        const bytes = loadHostileControlDocument(size, 340, 20);
        const container = document.createElement('div');
        document.body.append(container);
        const opened = mountPaginatedSurface(container, bytes, { scale: 1 });
        if (!opened.ok) throw new Error(opened.reason);
        const surface = opened.surface;
        try {
          const paragraphId = surface.session.paragraphIds()[Math.floor(size / 2)]!;
          contentControlsOf(surface);
          expect(recorder.rebuilds).toBe(1);
          const visitsAfterCold = {
            topLevel: recorder.topLevelVisits,
            control: recorder.controlVisits,
          };
          for (let index = 0; index < 3; index += 1) {
            surface.session.applyTreeOps([{ op: 'insertText', paragraphId, offset: 0, text: 'w' }]);
            surface.layout();
            contentControlsOf(surface);
          }
          expect(recorder.rebuilds).toBe(1);
          expect(recorder.topLevelVisits).toBe(visitsAfterCold.topLevel);
          expect(recorder.controlVisits).toBe(visitsAfterCold.control);
        } finally {
          surface.destroy();
          container.remove();
        }
      },
      size >= 12_700 ? { timeout: 120_000 } : undefined
    );
  }

  test('insertContentControl invalidates the session enumeration cache', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docxFromBody(para('one')), { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    try {
      const recorder = contentControlEnumerationTestRecorder();
      recorder.reset();
      contentControlsOf(surface);
      expect(recorder.rebuilds).toBe(1);
      const paragraphId = surface.session.paragraphIds()[0]!;
      surface.session.applyTreeOps([
        {
          op: 'insertContentControl',
          paragraphId,
          start: 0,
          end: 1,
          type: 'richText',
          tag: 'new',
        },
      ]);
      surface.layout();
      const after = contentControlsOf(surface);
      expect(recorder.rebuilds).toBe(2);
      expect(after.some((summary) => summary.tag === 'new')).toBe(true);
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('removeContentControl invalidates the session enumeration cache', () => {
    const body = sdt('<w:tag w:val="gone"/>', para('one'));
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docxFromBody(body), { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    try {
      const recorder = contentControlEnumerationTestRecorder();
      recorder.reset();
      const before = contentControlsOf(surface);
      expect(before).toHaveLength(1);
      surface.session.applyTreeOps([
        { op: 'removeContentControl', controlId: before[0]!.id, keepContent: true },
      ]);
      surface.layout();
      contentControlsOf(surface);
      expect(recorder.rebuilds).toBe(2);
      expect(contentControlsOf(surface)).toHaveLength(0);
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('undo and redo invalidate the session enumeration cache', () => {
    const body = sdt('<w:tag w:val="undo"/>', para('one'));
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docxFromBody(body), { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    try {
      const recorder = contentControlEnumerationTestRecorder();
      recorder.reset();
      contentControlsOf(surface);
      surface.session.applyTreeOps([
        {
          op: 'setContentControlProperties',
          controlId: contentControlsOf(surface)[0]!.id,
          tag: 'changed',
        },
      ]);
      surface.layout();
      contentControlsOf(surface);
      expect(recorder.rebuilds).toBe(2);
      surface.session.undo();
      surface.layout();
      contentControlsOf(surface);
      expect(recorder.rebuilds).toBe(3);
      surface.session.redo();
      surface.layout();
      contentControlsOf(surface);
      expect(recorder.rebuilds).toBe(4);
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('outer lock change updates inherited lock on stable inner metadata', () => {
    const body = sdt('<w:tag w:val="outer"/>', sdt('<w:tag w:val="inner"/>', para('nested')));
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docxFromBody(body), { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    try {
      const inner = contentControlsOf(surface, { tag: 'inner' })[0]!;
      expect(inner.locked).toBeUndefined();
      const outer = contentControlsOf(surface, { tag: 'outer' })[0]!;
      surface.session.applyTreeOps([
        {
          op: 'setContentControlProperties',
          controlId: outer.id,
          lock: 'contentLocked',
        },
      ]);
      surface.layout();
      expect(contentControlsOf(surface, { tag: 'inner' })[0]!.locked).toBe(true);
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('body text edits preserve enumeration; structural edits invalidate', () => {
    const body = sdt('<w:tag w:val="plain"/>', para('one'));
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docxFromBody(body), { scale: 1 });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    try {
      const recorder = contentControlEnumerationTestRecorder();
      recorder.reset();
      const baseline = contentControlsOf(surface);
      const paragraphId = surface.session.paragraphIds()[0]!;
      surface.session.applyTreeOps([{ op: 'insertText', paragraphId, offset: 0, text: 'x' }]);
      surface.layout();
      const warm = contentControlsOf(surface);
      expect(recorder.rebuilds).toBe(1);
      expect(warm).toEqual(baseline);
      surface.session.applyTreeOps([{ op: 'splitParagraph', paragraphId, offset: 1 }]);
      surface.layout();
      contentControlsOf(surface);
      expect(recorder.rebuilds).toBe(2);
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});
