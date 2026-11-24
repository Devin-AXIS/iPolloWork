import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { findDrawingOverlayFrameInLayout } from '../../layout/semantic-hit-test.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { resolveSelectedDrawingRecord } from '../docx-editor-images.ts';
import { selectedDrawingOverlayTargetOf } from '../drawing-overlay-target.ts';
import { FOOTNOTE_SCOPE_ID, HEADER_R_ID, storyParityDocx } from './story-parity-fixture.ts';
import { mountAnchorEditor } from './scroll-to-anchor-fixture.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

function textbox(text: string, id = 7, topOffsetEmu = 0): string {
  return (
    `<w:r><w:drawing xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}">` +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" ' +
    'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${topOffsetEmu}</wp:posOffset></wp:positionV>` +
    '<wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    `<wp:wrapNone/><wp:docPr id="${id}" name="Find text box ${id}"/>` +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
    '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>'
  );
}

function wrappedTextbox(text: string): string {
  const run = textbox(text);
  const drawing = run.slice('<w:r>'.length, -'</w:r>'.length);
  return (
    `<w:r><mc:AlternateContent xmlns:mc="${MC}" xmlns:wps="${WPS}">` +
    `<mc:Choice Requires="wps">${drawing}</mc:Choice>` +
    '<mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r>'
  );
}

function textboxDocx(
  inHeader = false,
  includeBodyFrame = !inHeader,
  headerTopOffsetEmu = 0
): Uint8Array {
  const headerReference = inHeader
    ? '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/></w:sectPr>'
    : '';
  const body =
    '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
    (includeBodyFrame ? `<w:p>${wrappedTextbox('boxed needle')}</w:p>` : '') +
    headerReference;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (inHeader
          ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${DOC_REL}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (inHeader) {
    files['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rHeader" Type="${DOC_REL}/header" Target="header1.xml"/></Relationships>`
    );
    files['word/header1.xml'] = strToU8(
      `<w:hdr xmlns:w="${W}"><w:p>${textbox('boxed needle', 7, headerTopOffsetEmu)}</w:p></w:hdr>`
    );
  }
  return zipSync(files);
}

function docx(body: string): Uint8Array {
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

function storyParityDocxWithBodyTable(): Uint8Array {
  const files = unzipSync(storyParityDocx());
  const documentXml = strFromU8(files['word/document.xml']!);
  const table =
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>table cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  files['word/document.xml'] = strToU8(documentXml.replace('<w:sectPr>', `${table}<w:sectPr>`));
  return zipSync(files);
}

describe('document search facade', () => {
  test('anchor scrolling refuses text-box content without selecting its drawing', () => {
    const mounted = mountAnchorEditor(textboxDocx());
    const { editor } = mounted;
    try {
      const surface = editor.surface!;
      const match = editor.findMatches('needle')[0]!;
      expect(match.scope?.kind).toBe('frame');
      const paraId = surface.session.paraIdOf(match.blockId);
      expect(paraId).toBeTruthy();
      const selection = surface.state().selection;
      expect(editor.scrollToAnchor({ paraId: paraId!, search: 'needle' })).toBe(false);
      expect(mounted.scrollCalls()).toBe(0);
      expect(surface.state().selection).toEqual(selection);
      expect(surface.drawingSelectionIntent()).toEqual({ kind: 'none' });
    } finally {
      mounted.destroy();
    }
  });

  test('selects a wrapped body text-box drawing without selecting its story text', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: textboxDocx(),
    });
    if (!editor.surface) throw new Error('surface did not open');
    const match = editor.findMatches('needle')[0];
    const frame = match?.scope?.kind === 'frame' ? match.scope : null;
    if (!match || !frame) throw new Error('frame match missing');
    let revealed: string | null = null;
    const revealParagraph = editor.surface.revealParagraph.bind(editor.surface);
    editor.surface.revealParagraph = (paragraphId, options) => {
      revealed = paragraphId;
      return revealParagraph(paragraphId, options);
    };

    expect(editor.selectMatch(match)).toEqual({ ok: true, changed: false });
    expect(revealed).toBe(frame.hostParagraphId);
    expect(editor.surface.state().selection).toEqual({
      anchor: { paragraphId: frame.hostParagraphId, offset: 0 },
      head: { paragraphId: frame.hostParagraphId, offset: 0 },
    });
    expect(editor.surface.drawingSelectionIntent()).toEqual({
      kind: 'pointer',
      drawingNodeId: frame.drawingNodeId,
    });
    expect(
      findDrawingOverlayFrameInLayout(editor.surface.layout(), frame.drawingNodeId)
    ).not.toBeNull();
    expect(resolveSelectedDrawingRecord(editor.surface)?.drawingNodeId).toBe(frame.drawingNodeId);

    expect(editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    expect(editor.findMatches('boxed needle')[0]?.blockId).toBe(match.blockId);
    editor.destroy();
  });

  test('opens a header before selecting its text-box drawing', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: textboxDocx(true),
    });
    if (!editor.surface) throw new Error('surface did not open');
    const match = editor.findMatches('needle')[0];
    const frame = match?.scope?.kind === 'frame' ? match.scope : null;
    if (!match || !frame) throw new Error('frame match missing');

    expect(match.scope).toMatchObject({
      kind: 'frame',
      owner: { kind: 'headerFooter', rId: 'rHeader' },
    });
    expect(editor.selectMatch(match)).toEqual({ ok: true, changed: false });
    expect(editor.getActiveScope()).toEqual({ kind: 'headerFooter', rId: 'rHeader' });
    expect(editor.surface.drawingSelectionIntent()).toEqual({
      kind: 'pointer',
      drawingNodeId: frame.drawingNodeId,
    });
    expect(selectedDrawingOverlayTargetOf(editor.surface)?.id).toBe(frame.drawingNodeId);
    editor.destroy();
  });

  test('selects the second of two text boxes anchored to one paragraph', () => {
    // Both anchors sit in the same paragraph at adjacent offsets, so resolving the drawing by
    // offset alone answers with the first one and the second can never be addressed.
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(`<w:p>${textbox('alpha needle', 7)}${textbox('beta needle', 8)}</w:p>`),
    });
    if (!editor.surface) throw new Error('surface did not open');
    const [alpha, beta] = editor.findMatches('needle');
    const first = alpha?.scope?.kind === 'frame' ? alpha.scope : null;
    const second = beta?.scope?.kind === 'frame' ? beta.scope : null;
    if (!alpha || !beta || !first || !second) throw new Error('two frame matches missing');

    expect(first.drawingNodeId).not.toBe(second.drawingNodeId);
    expect(editor.selectMatch(beta)).toEqual({ ok: true, changed: false });
    expect(selectedDrawingOverlayTargetOf(editor.surface)?.id).toBe(second.drawingNodeId);
    expect(editor.selectMatch(alpha)).toEqual({ ok: true, changed: false });
    expect(selectedDrawingOverlayTargetOf(editor.surface)?.id).toBe(first.drawingNodeId);
    editor.destroy();
  });

  test('does not offer, or open the header for, a text box with no painted frame', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: textboxDocx(true, false, 12_000_000),
    });
    if (!editor.surface) throw new Error('surface did not open');
    const before = editor.surface.state().selection;
    expect(editor.findMatches('needle')).toEqual([]);
    const unplaced = {
      blockId: 'missing',
      start: 0,
      length: 6,
      scope: {
        kind: 'frame' as const,
        id: 'missing',
        drawingNodeId: 'missing-drawing',
        hostParagraphId: 'missing-host',
        owner: { kind: 'headerFooter' as const, rId: 'rHeader' },
      },
    };

    expect(editor.selectMatch(unplaced)).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'the text box drawing could not be selected',
    });
    expect(editor.getActiveScope()).toEqual({ kind: 'body' });
    expect(editor.surface.state().selection).toEqual(before);
    editor.destroy();
  });

  test('reports and selects a match inside an inline text box', () => {
    const inline = textbox('inline needle').replace(/wp:anchor/g, 'wp:inline');
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(`<w:p><w:r><w:t>body needle</w:t></w:r></w:p><w:p>${inline}</w:p>`),
    });

    const matches = editor.findMatches('needle');
    expect(matches.map((match) => match.scope?.kind)).toEqual([undefined, 'frame']);
    const frame = matches[1]!.scope?.kind === 'frame' ? matches[1]!.scope : null;
    expect(editor.selectMatch(matches[1]!)).toEqual({ ok: true, changed: false });
    expect(resolveSelectedDrawingRecord(editor.surface)?.drawingNodeId).toBe(frame?.drawingNodeId);
    editor.destroy();
  });

  test('keeps body text-box Find navigation available in viewing mode', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: textboxDocx(true, true),
      mode: 'view',
    });
    const match = editor.findMatches('needle')[0];
    const frame = match?.scope?.kind === 'frame' ? match.scope : null;
    if (!match || !frame) throw new Error('frame match missing');

    expect(frame.owner).toBeUndefined();
    expect(editor.findMatches('needle')).toHaveLength(1);
    expect(editor.selectMatch(match)).toEqual({ ok: true, changed: false });
    expect(resolveSelectedDrawingRecord(editor.surface)?.drawingNodeId).toBe(frame.drawingNodeId);
    editor.destroy();
  });

  test('selects a match inside a table cell by paragraph id', () => {
    const body =
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>one</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>four</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(body),
    });
    if (!editor.surface) throw new Error('surface did not open');
    const matches = editor.findMatches('four');

    expect(matches).toHaveLength(1);
    expect(editor.selectMatch(matches[0]!)).toEqual({ ok: true, changed: false });
    const paraId = editor.surface.session.paraIdOf(matches[0]!.blockId);
    expect(paraId).not.toBeNull();
    expect(editor.snapshot().selection).toEqual({
      from: { paraId },
      to: { paraId },
    });
    expect(editor.surface.state().selection).toEqual({
      anchor: { paragraphId: matches[0]!.blockId, offset: 0 },
      head: { paragraphId: matches[0]!.blockId, offset: 4 },
    });
  });

  test('opens a header and selects its match', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: storyParityDocx(),
    });
    const match = editor
      .findMatches('Alpha')
      .find((candidate) => candidate.scope?.kind === 'headerFooter');
    if (!match || !editor.surface) throw new Error('header match did not open');

    expect(editor.selectMatch(match)).toEqual({ ok: true, changed: false });
    expect(editor.getActiveScope()).toEqual({ kind: 'headerFooter', rId: HEADER_R_ID });
    expect(editor.surface.state().selection).toEqual({
      anchor: { paragraphId: match.blockId, offset: 0 },
      head: { paragraphId: match.blockId, offset: 5 },
    });
    editor.destroy();
  });

  test('opens a footnote and selects its match', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: storyParityDocx(),
    });
    const match = editor.findMatches('Alpha').find((candidate) => candidate.scope?.kind === 'note');
    if (!match || !editor.surface) throw new Error('footnote match did not open');

    expect(editor.selectMatch(match)).toEqual({ ok: true, changed: false });
    expect(editor.getActiveScope()).toEqual({ kind: 'note', id: FOOTNOTE_SCOPE_ID });
    expect(editor.surface.state().selection).toEqual({
      anchor: { paragraphId: match.blockId, offset: 0 },
      head: { paragraphId: match.blockId, offset: 5 },
    });
    editor.destroy();
  });

  test('selects every note match that search reports', () => {
    const scroller = document.createElement('div');
    scroller.className = 'docx-editor__scroll-container';
    const container = document.createElement('div');
    scroller.append(container);
    document.body.append(scroller);
    Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(scroller, 'scrollHeight', { value: 100_000, configurable: true });
    scroller.scrollTo = (() => {}) as HTMLElement['scrollTo'];
    const editor = createDocxEditor({
      container,
      document: storyParityDocx(),
    });
    const matches = editor
      .findMatches('Alpha')
      .filter((candidate) => candidate.scope?.kind === 'note');

    expect(matches).toHaveLength(2);
    for (const match of matches) {
      expect(editor.selectMatch(match)).toEqual({ ok: true, changed: false });
      expect(editor.getActiveScope()).toEqual(match.scope);
      expect(editor.surface?.revealParagraph(match.blockId)).toBe(true);
    }
    editor.destroy();
    scroller.remove();
  });

  test('leaves an open header when selecting a body match', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: storyParityDocx(),
    });
    const matches = editor.findMatches('Alpha');
    const header = matches.find((candidate) => candidate.scope?.kind === 'headerFooter');
    const body = matches.find((candidate) => candidate.scope === undefined);
    if (!header || !body) throw new Error('search matches are incomplete');
    expect(editor.selectMatch(header).ok).toBe(true);

    expect(editor.selectMatch(body)).toEqual({ ok: true, changed: false });
    expect(editor.getActiveScope()).toEqual({ kind: 'body' });
    expect(editor.surface?.state().selection.head.paragraphId).toBe(body.blockId);
    editor.destroy();
  });

  test('searches scoped stories only while the surface can open them', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: storyParityDocx(),
    });

    expect(editor.findMatches('Alpha')).toHaveLength(5);
    expect(editor.exec({ type: 'setEditingMode', mode: 'viewing' }).ok).toBe(true);
    expect(editor.findMatches('Alpha')).toHaveLength(1);
    expect(editor.findMatches('Alpha')[0]!.scope).toBeUndefined();
    expect(editor.exec({ type: 'setEditingMode', mode: 'editing' }).ok).toBe(true);
    expect(editor.findMatches('Alpha')).toHaveLength(5);
    editor.destroy();
  });

  test('limits a view-only editor to body matches', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: storyParityDocx(),
      mode: 'view',
    });

    expect(editor.findMatches('Alpha')).toHaveLength(1);
    expect(editor.findMatches('Alpha')[0]!.scope).toBeUndefined();
    editor.destroy();
  });

  test('limits search to the body when a scoped entry method is unavailable', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: storyParityDocx(),
    });
    if (!editor.surface) throw new Error('surface did not open');
    Object.defineProperty(editor.surface, 'enterNote', { configurable: true, value: undefined });

    expect(editor.findMatches('Alpha')).toHaveLength(1);
    expect(editor.findMatches('Alpha')[0]!.scope).toBeUndefined();
    editor.destroy();
  });

  test('keeps an open note when scrollToBlock receives a table id', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: storyParityDocxWithBodyTable(),
    });
    if (!editor.surface) throw new Error('surface did not open');
    const table = editor.surface
      .layout()
      .pages.flatMap((page) => page.fragments)
      .find((fragment) => fragment.kind === 'table');
    if (!table || table.kind !== 'table') throw new Error('table did not lay out');
    expect(editor.surface.enterNote(FOOTNOTE_SCOPE_ID)).toBe(true);

    editor.scrollToBlock(table.tableId);

    expect(editor.getActiveScope()).toEqual({ kind: 'note', id: FOOTNOTE_SCOPE_ID });
    editor.destroy();
  });
});
