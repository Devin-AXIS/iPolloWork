// Page-aware note mark projection regressions.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession, layoutSemanticDocument } from '../semantic-layout.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';
import { reprojectBodyNoteMarks } from '../note-pagination.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import type { BlockFragmentRecord, SemanticLayout, StyleSpanRecord } from '../semantic-records.ts';
import { noteMarkKey } from '../note-projection.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

describe('eachPage body note mark projection', () => {
  test('eachPage restarts body superscript + note mark on page 2 (not continuous 2)', () => {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          `<w:p><w:r><w:t>Page1</w:t><w:footnoteReference w:id="1"/></w:r></w:p>` +
          `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` +
          `<w:p><w:r><w:t>Page2</w:t><w:footnoteReference w:id="2"/></w:r></w:p>` +
          '<w:sectPr/></w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>one</w:t></w:r></w:p></w:footnote>` +
          `<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/><w:t>two</w:t></w:r></w:p></w:footnote>` +
          '</w:footnotes>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const eachPage = resolveFootnoteProperties({
      numFmt: 'decimal',
      numStart: 1,
      numRestart: 'eachPage',
    });
    const documentEndnoteProps = resolveEndnoteProperties(undefined, undefined);
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      footnotePropsBySection: [eachPage],
      endnotePropsBySection: [documentEndnoteProps],
      documentFootnoteProps: eachPage,
      documentEndnoteProps,
      measurer: createFixedMeasurer(),
      producer: 'note-each-page',
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-each-page',
    });
    expect(layout.pages.length).toBeGreaterThanOrEqual(2);

    const bodyCitations = bodyNoteCitationSpans(layout);
    const page0 = bodyCitations.filter((c) => c.pageIndex === 0);
    const page1 = bodyCitations.filter((c) => c.pageIndex === 1);
    expect(page0.map((c) => c.text)).toEqual(['1']);
    // Continuous provisional would paint "2" here — eachPage must restart at 1.
    expect(page1.map((c) => c.text)).toEqual(['1']);

    const noteStories = layout.pages.flatMap((page) =>
      (page.footnotes?.notes ?? []).filter((n) => !n.continuation)
    );
    expect(noteStories.map((n) => n.mark).sort()).toEqual(['1', '1']);
    for (const note of noteStories) {
      const body = bodyCitations.find((c) => c.scopeId === note.scopeId);
      expect(body?.text).toBe(note.mark);
      const back = note.fragments
        .flatMap((f) => (f.kind === 'paragraph' ? f.lines.flatMap((l) => l.spans) : []))
        .find((s) => s.projected && s.noteNav?.direction === 'to-body');
      expect(back?.text).toBe(note.mark);
    }

    const container = document.createElement('div');
    document.body.append(container);
    paintSemanticLayout(container, layout, { scale: 1, ariaHidden: false });
    const paintedBody = [...container.querySelectorAll('[data-docx-note-ref]')].map(
      (el) => el.textContent
    );
    expect(paintedBody).toEqual(['1', '1']);
    const paintedNotes = [...container.querySelectorAll('[data-docx-note-mark-back]')].map(
      (el) => el.textContent
    );
    expect(paintedNotes).toEqual(['1', '1']);
  });

  test('eachPage endnote body citations restart per page', () => {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          `<w:p><w:r><w:t>Page1</w:t><w:endnoteReference w:id="1"/></w:r></w:p>` +
          `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` +
          `<w:p><w:r><w:t>Page2</w:t><w:endnoteReference w:id="2"/></w:r></w:p>` +
          '<w:sectPr/></w:body></w:document>'
      ),
      'word/endnotes.xml': strToU8(
        `<w:endnotes xmlns:w="${W}">` +
          `<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>` +
          `<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>` +
          `<w:endnote w:id="1"><w:p><w:r><w:endnoteRef/><w:t>one</w:t></w:r></w:p></w:endnote>` +
          `<w:endnote w:id="2"><w:p><w:r><w:endnoteRef/><w:t>two</w:t></w:r></w:p></w:endnote>` +
          '</w:endnotes>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const eachPage = resolveEndnoteProperties({
      numFmt: 'decimal',
      numStart: 1,
      numRestart: 'eachPage',
    });
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const notes: NotesLayoutInput = {
      footnotesPart: null,
      endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
      footnotePropsBySection: [documentFootnoteProps],
      endnotePropsBySection: [eachPage],
      documentFootnoteProps,
      documentEndnoteProps: eachPage,
      measurer: createFixedMeasurer(),
      producer: 'note-each-page-endnote',
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-each-page-endnote',
    });
    const bodyCitations = bodyNoteCitationSpans(layout);
    expect(bodyCitations.map((c) => ({ page: c.pageIndex, text: c.text }))).toEqual([
      { page: 0, text: '1' },
      { page: 1, text: '1' },
    ]);
    const noteStories = layout.pages.flatMap((page) =>
      (page.endnotes?.notes ?? []).filter((n) => !n.continuation)
    );
    expect(noteStories.map((n) => n.mark).sort()).toEqual(['1', '1']);
    for (const note of noteStories) {
      expect(bodyCitations.find((c) => c.scopeId === note.scopeId)?.text).toBe(note.mark);
    }
  });

  test('eachPage incremental no-change pass keeps body/note marks and span geometry', () => {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          `<w:p><w:r><w:t>Page1</w:t><w:footnoteReference w:id="1"/></w:r></w:p>` +
          `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` +
          `<w:p><w:r><w:t>Page2</w:t><w:footnoteReference w:id="2"/></w:r></w:p>` +
          '<w:sectPr/></w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>one</w:t></w:r></w:p></w:footnote>` +
          `<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/><w:t>two</w:t></w:r></w:p></w:footnote>` +
          '</w:footnotes>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const eachPage = resolveFootnoteProperties({
      numFmt: 'decimal',
      numStart: 1,
      numRestart: 'eachPage',
    });
    const documentEndnoteProps = resolveEndnoteProperties(undefined, undefined);
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      footnotePropsBySection: [eachPage],
      endnotePropsBySection: [documentEndnoteProps],
      documentFootnoteProps: eachPage,
      documentEndnoteProps,
      measurer: createFixedMeasurer(),
      producer: 'note-each-page-incr',
    };
    const session = createLayoutSession();
    const first = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'note-each-page-incr',
    });
    const firstCitations = bodyNoteCitationSpans(first);
    expect(firstCitations.map((c) => c.text)).toEqual(['1', '1']);
    const firstBoxes = firstCitations.map((c) => ({ ...c.box }));

    const second = layoutSemanticDocument(part, 2, {
      measurer: notes.measurer,
      notes,
      session,
      producer: 'note-each-page-incr',
    });
    const secondCitations = bodyNoteCitationSpans(second);
    expect(
      secondCitations.map((c) => ({ page: c.pageIndex, text: c.text, scopeId: c.scopeId }))
    ).toEqual(firstCitations.map((c) => ({ page: c.pageIndex, text: c.text, scopeId: c.scopeId })));
    // Geometry reserved at provisional measure must survive no-change incremental attach.
    expect(secondCitations.map((c) => c.box)).toEqual(firstBoxes);
    // Source ranges (model atom) must not drift.
    expect(secondCitations.map((c) => c.range)).toEqual(firstCitations.map((c) => c.range));

    const tagged: SemanticLayout = {
      ...second,
      displayMode: 'proposed',
      controlContextToken: 'metadata-sentinel',
    };
    const changedMarks = {
      marks: new Map([
        [noteMarkKey('footnote', 1), '9'],
        [noteMarkKey('footnote', 2), '9'],
      ]),
    };
    const reprojected = reprojectBodyNoteMarks(tagged, changedMarks);
    expect(reprojected).not.toBe(tagged);
    expect(reprojected.displayMode).toBe('proposed');
    expect(reprojected.controlContextToken).toBe('metadata-sentinel');

    // Pure reproject is a no-op when marks already match (identity).
    const alreadyFinal = {
      marks: new Map([
        [noteMarkKey('footnote', 1), '1'],
        [noteMarkKey('footnote', 2), '1'],
      ]),
    };
    const again = reprojectBodyNoteMarks(second, alreadyFinal);
    expect(again).toBe(second);
  });
});

function bodyNoteCitationSpans(layout: SemanticLayout): readonly {
  readonly pageIndex: number;
  readonly scopeId: string;
  readonly text: string;
  readonly box: StyleSpanRecord['box'];
  readonly range: StyleSpanRecord['range'];
}[] {
  const out: {
    pageIndex: number;
    scopeId: string;
    text: string;
    box: StyleSpanRecord['box'];
    range: StyleSpanRecord['range'];
  }[] = [];
  const visit = (blocks: readonly BlockFragmentRecord[], pageIndex: number): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        for (const line of block.lines) {
          for (const span of line.spans) {
            if (span.projected && span.noteNav?.direction === 'to-note') {
              out.push({
                pageIndex,
                scopeId: span.noteNav.scopeId,
                text: span.text,
                box: span.box,
                range: span.range,
              });
            }
          }
        }
        continue;
      }
      for (const row of block.rows) {
        for (const cell of row.cells) visit(cell.blocks, pageIndex);
      }
    }
  };
  for (const page of layout.pages) visit(page.fragments, page.index);
  return out;
}
