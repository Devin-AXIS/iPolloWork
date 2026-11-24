// Footnote-drain vs sectEnd/docEnd endnote ownership regressions.
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
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

describe('footnote drain vs endnote placement', () => {
  test('long footnote drain + sectEnd keeps endnotes off drain pages without overlap', () => {
    // Short page + long pageBottom footnote forces drain sheets; same section also has
    // a long sectEnd endnote that must not treat drain pages as free body hosts.
    const noteParas = Array.from(
      { length: 80 },
      (_, i) => `<w:p><w:r><w:t>Footnote drain ${i} ${'x'.repeat(80)}</w:t></w:r></w:p>`
    ).join('');
    const endParas = Array.from(
      { length: 40 },
      (_, i) => `<w:p><w:r><w:t>Sect endnote ${i} ${'z'.repeat(60)}</w:t></w:r></w:p>`
    ).join('');
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
          `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` +
          '</Relationships>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          `<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/>` +
          `<w:endnoteReference w:id="1"/></w:r></w:p>` +
          `<w:sectPr><w:pgSz w:w="12240" w:h="7200"/>` +
          `<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>` +
          `<w:endnotePr><w:pos w:val="sectEnd"/></w:endnotePr>` +
          `</w:sectPr>` +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:id="1">${noteParas}</w:footnote>` +
          '</w:footnotes>'
      ),
      'word/endnotes.xml': strToU8(
        `<w:endnotes xmlns:w="${W}">` +
          `<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>` +
          `<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>` +
          `<w:endnote w:id="1">${endParas}</w:endnote>` +
          '</w:endnotes>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const sectEnd = resolveEndnoteProperties(undefined, { pos: 'sectEnd' });
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
      footnotePropsBySection: [documentFootnoteProps],
      endnotePropsBySection: [sectEnd],
      documentFootnoteProps,
      documentEndnoteProps: sectEnd,
      measurer: createFixedMeasurer(),
      producer: 'note-drain-sectend',
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-drain-sectend',
    });

    const drainPages = layout.pages.filter((page) => page.noteStream === 'footnote-drain');
    expect(drainPages.length).toBeGreaterThan(0);
    for (const page of drainPages) {
      expect(page.endnotes).toBeUndefined();
      expect((page.footnotes?.notes.length ?? 0) > 0).toBe(true);
    }

    const pagesWithEndnotes = layout.pages.filter((page) => (page.endnotes?.notes.length ?? 0) > 0);
    expect(pagesWithEndnotes.length).toBeGreaterThan(0);
    const lastDrainIndex = Math.max(...drainPages.map((p) => p.index));
    const firstEndnoteAfterDrain = pagesWithEndnotes.filter((p) => p.index > lastDrainIndex);
    // Overflow endnote sheets (if any) must sit after the drain run; shared last-body host
    // may only use room above footnotes.
    for (const page of pagesWithEndnotes) {
      if (page.noteStream === 'footnote-drain') {
        throw new Error('endnotes must not land on footnote-drain pages');
      }
      if (page.footnotes && page.endnotes) {
        expect(page.endnotes.box.y + page.endnotes.box.height).toBeLessThanOrEqual(
          page.footnotes.box.y + 0.05
        );
      }
    }
    expect(
      firstEndnoteAfterDrain.length +
        pagesWithEndnotes.filter((p) => p.index < Math.min(...drainPages.map((d) => d.index)))
          .length
    ).toBeGreaterThan(0);
  });

  test('long footnote drain + docEnd does not start on the final drain page', () => {
    const noteParas = Array.from(
      { length: 80 },
      (_, i) => `<w:p><w:r><w:t>Footnote drain ${i} ${'x'.repeat(80)}</w:t></w:r></w:p>`
    ).join('');
    const endParas = Array.from(
      { length: 40 },
      (_, i) => `<w:p><w:r><w:t>Doc endnote ${i} ${'z'.repeat(60)}</w:t></w:r></w:p>`
    ).join('');
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
          `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` +
          '</Relationships>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          `<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/>` +
          `<w:endnoteReference w:id="1"/></w:r></w:p>` +
          `<w:sectPr><w:pgSz w:w="12240" w:h="7200"/>` +
          `<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>` +
          `<w:endnotePr><w:pos w:val="docEnd"/></w:endnotePr>` +
          `</w:sectPr>` +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:id="1">${noteParas}</w:footnote>` +
          '</w:footnotes>'
      ),
      'word/endnotes.xml': strToU8(
        `<w:endnotes xmlns:w="${W}">` +
          `<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>` +
          `<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>` +
          `<w:endnote w:id="1">${endParas}</w:endnote>` +
          '</w:endnotes>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const docEnd = resolveEndnoteProperties({ pos: 'docEnd' });
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
      footnotePropsBySection: [documentFootnoteProps],
      endnotePropsBySection: [docEnd],
      documentFootnoteProps,
      documentEndnoteProps: docEnd,
      measurer: createFixedMeasurer(),
      producer: 'note-drain-docend',
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-drain-docend',
    });

    const drainPages = layout.pages.filter((page) => page.noteStream === 'footnote-drain');
    expect(drainPages.length).toBeGreaterThan(0);
    const lastDrain = drainPages.reduce((a, b) => (a.index > b.index ? a : b));
    expect(lastDrain.endnotes).toBeUndefined();

    for (const page of layout.pages) {
      if (page.noteStream === 'footnote-drain') {
        expect(page.endnotes).toBeUndefined();
      }
      if (page.footnotes && page.endnotes) {
        expect(page.endnotes.box.y + page.endnotes.box.height).toBeLessThanOrEqual(
          page.footnotes.box.y + 0.05
        );
      }
    }

    const pagesWithEndnotes = layout.pages.filter((page) => (page.endnotes?.notes.length ?? 0) > 0);
    expect(pagesWithEndnotes.length).toBeGreaterThan(0);
    // Placement must not begin on the final drain sheet.
    const firstEndnoteIndex = Math.min(...pagesWithEndnotes.map((p) => p.index));
    expect(firstEndnoteIndex).not.toBe(lastDrain.index);
  });

  test('endnote and footnote boxes never overlap on a shared page', () => {
    // Enough body slack that both can share the last body page — still no overlap.
    const fnParas = Array.from(
      { length: 8 },
      (_, i) => `<w:p><w:r><w:t>FN ${i} ${'f'.repeat(40)}</w:t></w:r></w:p>`
    ).join('');
    const enParas = Array.from(
      { length: 8 },
      (_, i) => `<w:p><w:r><w:t>EN ${i} ${'e'.repeat(40)}</w:t></w:r></w:p>`
    ).join('');
    const bodyParas = Array.from(
      { length: 6 },
      (_, i) => `<w:p><w:r><w:t>Para ${i} ${'body '.repeat(20)}</w:t></w:r></w:p>`
    ).join('');
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
          `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` +
          '</Relationships>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          bodyParas +
          `<w:p><w:r><w:t>Refs</w:t><w:footnoteReference w:id="1"/>` +
          `<w:endnoteReference w:id="1"/></w:r></w:p>` +
          `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
          `<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>` +
          `<w:endnotePr><w:pos w:val="sectEnd"/></w:endnotePr>` +
          `</w:sectPr>` +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:id="1">${fnParas}</w:footnote>` +
          '</w:footnotes>'
      ),
      'word/endnotes.xml': strToU8(
        `<w:endnotes xmlns:w="${W}">` +
          `<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>` +
          `<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>` +
          `<w:endnote w:id="1">${enParas}</w:endnote>` +
          '</w:endnotes>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const sectEnd = resolveEndnoteProperties(undefined, { pos: 'sectEnd' });
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
      footnotePropsBySection: [documentFootnoteProps],
      endnotePropsBySection: [sectEnd],
      documentFootnoteProps,
      documentEndnoteProps: sectEnd,
      measurer: createFixedMeasurer(),
      producer: 'note-no-overlap',
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-no-overlap',
    });
    let shared = 0;
    for (const page of layout.pages) {
      if (!page.footnotes || !page.endnotes) continue;
      shared += 1;
      expect(page.endnotes.box.y + page.endnotes.box.height).toBeLessThanOrEqual(
        page.footnotes.box.y + 0.05
      );
    }
    expect(shared).toBeGreaterThan(0);
  });

  test('multi-section sectEnd with section-0 footnote drain stays before section 1 body', () => {
    // Section 0 ends with a long footnote (document-end drain) + sectEnd endnotes.
    // Section 1 body must remain free of section-0 endnotes; drain sheets stay endnote-free.
    const s0Body = Array.from(
      { length: 12 },
      (_, i) => `<w:p><w:r><w:t>S0 para ${i} ${'body '.repeat(30)}</w:t></w:r></w:p>`
    ).join('');
    const s1Body = Array.from(
      { length: 12 },
      (_, i) => `<w:p><w:r><w:t>S1 para ${i} ${'next '.repeat(30)}</w:t></w:r></w:p>`
    ).join('');
    const fnParas = Array.from(
      { length: 80 },
      (_, i) => `<w:p><w:r><w:t>FN drain ${i} ${'x'.repeat(80)}</w:t></w:r></w:p>`
    ).join('');
    const enParas = Array.from(
      { length: 30 },
      (_, i) => `<w:p><w:r><w:t>S0 endnote ${i} ${'z'.repeat(50)}</w:t></w:r></w:p>`
    ).join('');
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
          `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` +
          '</Relationships>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          s0Body +
          `<w:p><w:r><w:t>S0 refs</w:t><w:footnoteReference w:id="1"/>` +
          `<w:endnoteReference w:id="1"/></w:r></w:p>` +
          `<w:p><w:pPr><w:sectPr>` +
          `<w:pgSz w:w="12240" w:h="7200"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>` +
          `<w:endnotePr><w:pos w:val="sectEnd"/></w:endnotePr>` +
          `</w:sectPr></w:pPr><w:r><w:t>S0 end</w:t></w:r></w:p>` +
          s1Body +
          `<w:sectPr><w:pgSz w:w="12240" w:h="7200"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>` +
          `<w:endnotePr><w:pos w:val="sectEnd"/></w:endnotePr></w:sectPr>` +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:id="1">${fnParas}</w:footnote>` +
          '</w:footnotes>'
      ),
      'word/endnotes.xml': strToU8(
        `<w:endnotes xmlns:w="${W}">` +
          `<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>` +
          `<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>` +
          `<w:endnote w:id="1">${enParas}</w:endnote>` +
          '</w:endnotes>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const sectEnd = resolveEndnoteProperties(undefined, { pos: 'sectEnd' });
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
      footnotePropsBySection: [documentFootnoteProps, documentFootnoteProps],
      endnotePropsBySection: [sectEnd, sectEnd],
      documentFootnoteProps,
      documentEndnoteProps: sectEnd,
      measurer: createFixedMeasurer(),
      producer: 'note-drain-multisection',
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer: notes.measurer,
      notes,
      producer: 'note-drain-multisection',
    });

    const textOf = (page: (typeof layout.pages)[number]): string => {
      const parts: string[] = [];
      for (const fragment of page.fragments) {
        if (fragment.kind !== 'paragraph') continue;
        for (const line of fragment.lines) {
          for (const span of line.spans) parts.push(span.text);
        }
      }
      return parts.join('');
    };

    const s1Pages = layout.pages.filter((page) => textOf(page).includes('S1 para'));
    expect(s1Pages.length).toBeGreaterThan(0);
    const firstS1Index = Math.min(...s1Pages.map((p) => p.index));
    for (const page of s1Pages) {
      expect(page.endnotes).toBeUndefined();
    }
    for (const page of layout.pages.filter((p) => p.noteStream === 'footnote-drain')) {
      expect(page.endnotes).toBeUndefined();
    }
    const pagesWithEndnotes = layout.pages.filter((page) => (page.endnotes?.notes.length ?? 0) > 0);
    expect(pagesWithEndnotes.length).toBeGreaterThan(0);
    for (const page of pagesWithEndnotes) {
      expect(page.index).toBeLessThan(firstS1Index);
      if (page.footnotes) {
        expect(page.endnotes!.box.y + page.endnotes!.box.height).toBeLessThanOrEqual(
          page.footnotes.box.y + 0.05
        );
      }
    }
  });
});
